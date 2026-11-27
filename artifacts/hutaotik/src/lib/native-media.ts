import { Capacitor } from "@capacitor/core";
import {
  clampPercent,
  registerNativeDownloadProgressListener,
  type DownloadProgressState,
} from "@/lib/download-progress";

interface NativeMediaBridge {
  beginTempSave?(extension: string): string;
  appendTempSaveChunk?(saveId: string, base64Chunk: string): boolean;
  abortTempSave?(saveId: string): void;
  convertTempVideoToGif?(
    saveId: string,
    filename: string,
    folderName: string,
    maxSeconds: number,
    requestId: string,
  ): void;
  compressTempVideo?(
    saveId: string,
    crf: number,
    maxHeight: number,
    requestId: string,
  ): void;
  saveCompressedVideo?(
    compressedId: string,
    filename: string,
    folderName: string,
    requestId: string,
  ): void;
  shareCompressedVideo?(compressedId: string, filename: string): boolean;
  discardCompressedVideo?(compressedId: string): void;
}

declare global {
  interface Window {
    onNativeMediaResult?: (requestId: string, response: string) => void;
  }
}

const pendingMediaRequests = new Map<
  string,
  { resolve: (data: Record<string, unknown>) => void; reject: (error: Error) => void }
>();

function getBridge(): NativeMediaBridge | undefined {
  if (typeof window === "undefined") return undefined;
  return (window as Window & { AndroidStorageBridge?: NativeMediaBridge }).AndroidStorageBridge;
}

function ensureResultHandler(): void {
  if (typeof window === "undefined") return;
  window.onNativeMediaResult ??= (requestId, response) => {
    const pending = pendingMediaRequests.get(requestId);
    if (!pending) return;
    pendingMediaRequests.delete(requestId);
    try {
      const parsed = JSON.parse(response) as Record<string, unknown>;
      if (typeof parsed.error === "string" && parsed.error.length > 0) {
        pending.reject(new Error(parsed.error));
      } else {
        pending.resolve(parsed);
      }
    } catch {
      pending.reject(new Error("Invalid response from native media processor."));
    }
  };
}

function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = "";
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) {
    binary += String.fromCharCode(...bytes.subarray(i, i + step));
  }
  return btoa(binary);
}

async function streamBlobToTempSave(
  blob: Blob,
  extension: string,
  onProgress?: (fraction: number) => void,
): Promise<string> {
  const bridge = getBridge();
  if (!bridge?.beginTempSave || !bridge?.appendTempSaveChunk) {
    throw new Error("Android storage bridge is not available.");
  }

  const saveId = bridge.beginTempSave(extension);
  if (!saveId) {
    throw new Error("Could not allocate temporary file on device.");
  }

  const chunkSize = 256 * 1024;
  const totalSize = Math.max(1, blob.size);
  try {
    for (let offset = 0; offset < blob.size; offset += chunkSize) {
      const end = Math.min(offset + chunkSize, blob.size);
      const buffer = await blob.slice(offset, end).arrayBuffer();
      const base64Chunk = uint8ArrayToBase64(new Uint8Array(buffer));
      if (!bridge.appendTempSaveChunk(saveId, base64Chunk)) {
        throw new Error("Failed while sending media chunk to native processor.");
      }
      onProgress?.(end / totalSize);
    }
    return saveId;
  } catch (err) {
    bridge.abortTempSave?.(saveId);
    throw err;
  }
}

export function hasNativeGifConverter(): boolean {
  const bridge = getBridge();
  return Boolean(
    bridge?.beginTempSave &&
      bridge?.appendTempSaveChunk &&
      bridge?.convertTempVideoToGif,
  );
}

export function hasNativeVideoCompressor(): boolean {
  const bridge = getBridge();
  return Boolean(
    bridge?.beginTempSave &&
      bridge?.appendTempSaveChunk &&
      bridge?.compressTempVideo &&
      bridge?.saveCompressedVideo,
  );
}

export async function convertVideoBlobToGifNative(
  blob: Blob,
  filename: string,
  folderName: string,
  maxSeconds = 15,
  onProgress?: (progress: DownloadProgressState) => void,
  startPercent = 55,
): Promise<{ filename: string }> {
  const bridge = getBridge();
  if (!hasNativeGifConverter() || !bridge?.convertTempVideoToGif) {
    throw new Error("On-device GIF conversion is not available on this device.");
  }
  ensureResultHandler();

  const uploadEnd = Math.min(startPercent + 10, 70);
  onProgress?.({ percent: clampPercent(startPercent), status: "Preparing video for GIF conversion…" });

  const saveId = await streamBlobToTempSave(blob, "mp4", (fraction) => {
    const pct = startPercent + Math.round(fraction * (uploadEnd - startPercent));
    onProgress?.({ percent: clampPercent(pct), status: "Preparing video for GIF conversion…" });
  });

  const requestId = `gif-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const unsubscribe = registerNativeDownloadProgressListener(requestId, (nativeProgress) => {
    const mapped = uploadEnd + Math.round((clampPercent(nativeProgress.percent) / 100) * (100 - uploadEnd));
    onProgress?.({
      ...nativeProgress,
      percent: clampPercent(mapped),
    });
  });

  try {
    const result = await new Promise<Record<string, unknown>>((resolve, reject) => {
      pendingMediaRequests.set(requestId, { resolve, reject });
      bridge.convertTempVideoToGif!(saveId, filename, folderName, maxSeconds, requestId);
    });
    onProgress?.({ percent: 100, status: "GIF saved to device folder" });
    return {
      filename: typeof result.filename === "string" && result.filename ? result.filename : filename,
    };
  } finally {
    unsubscribe();
    pendingMediaRequests.delete(requestId);
  }
}

export interface NativeCompressedVideo {
  compressedId: string;
  size: number;
  filePath: string;
  previewUrl: string;
}

export async function compressVideoNative(
  file: File,
  options: { crf: number; maxHeight: number },
  onProgress?: (percent: number, status?: string) => void,
): Promise<NativeCompressedVideo> {
  const bridge = getBridge();
  if (!hasNativeVideoCompressor() || !bridge?.compressTempVideo) {
    throw new Error("On-device FFmpeg video compression is unavailable.");
  }
  ensureResultHandler();

  const rawExt = file.name.split(".").pop()?.replace(/[^a-zA-Z0-9]/g, "") || "mp4";
  onProgress?.(2, "Loading video into native H.264 encoder…");

  const saveId = await streamBlobToTempSave(file, rawExt, (fraction) => {
    onProgress?.(2 + Math.round(fraction * 16), "Preparing video for H.264 compression…");
  });

  const requestId = `compress-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const unsubscribe = registerNativeDownloadProgressListener(requestId, (nativeProgress) => {
    const mapped = 18 + Math.round((clampPercent(nativeProgress.percent) / 100) * 81);
    onProgress?.(Math.min(99, mapped), nativeProgress.status || "Compressing to H.264 MP4…");
  });

  try {
    const result = await new Promise<Record<string, unknown>>((resolve, reject) => {
      pendingMediaRequests.set(requestId, { resolve, reject });
      bridge.compressTempVideo!(saveId, options.crf, options.maxHeight, requestId);
    });

    const compressedId = typeof result.compressedId === "string" ? result.compressedId : "";
    const filePath = typeof result.filePath === "string" ? result.filePath : "";
    const size = typeof result.size === "number" ? result.size : 0;
    if (!compressedId || !filePath || size <= 0) {
      throw new Error("The native video compressor returned an invalid output.");
    }

    onProgress?.(100, "Compressed to compatible H.264 MP4");
    return {
      compressedId,
      size,
      filePath,
      previewUrl: Capacitor.convertFileSrc(filePath),
    };
  } finally {
    unsubscribe();
    pendingMediaRequests.delete(requestId);
  }
}

export async function saveCompressedVideoNative(
  compressedId: string,
  filename: string,
  folderName: string,
  onProgress?: (progress: DownloadProgressState) => void,
): Promise<{ filename: string }> {
  const bridge = getBridge();
  if (!bridge?.saveCompressedVideo) {
    throw new Error("Native compressed video export is unavailable.");
  }
  ensureResultHandler();
  onProgress?.({ percent: 25, status: "Saving MP4 to device Gallery / Movies…" });

  const requestId = `save-comp-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const result = await new Promise<Record<string, unknown>>((resolve, reject) => {
    pendingMediaRequests.set(requestId, { resolve, reject });
    bridge.saveCompressedVideo!(compressedId, filename, folderName, requestId);
  });

  onProgress?.({ percent: 100, status: "Saved compatible MP4 to device" });
  return {
    filename: typeof result.filename === "string" && result.filename ? result.filename : filename,
  };
}

export function shareCompressedVideoNative(compressedId: string, filename: string): boolean {
  const bridge = getBridge();
  if (!bridge?.shareCompressedVideo) return false;
  try {
    return Boolean(bridge.shareCompressedVideo(compressedId, filename));
  } catch {
    return false;
  }
}

export function discardCompressedVideoNative(compressedId: string | null): void {
  if (!compressedId) return;
  try {
    getBridge()?.discardCompressedVideo?.(compressedId);
  } catch {
    /* ignore */
  }
}
