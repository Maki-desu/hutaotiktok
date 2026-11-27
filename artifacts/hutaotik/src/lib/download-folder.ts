import { Filesystem, Directory } from "@capacitor/filesystem";
import {
  clampPercent,
  fetchBlobWithProgress,
  type DownloadProgressState,
} from "@/lib/download-progress";

let currentDirHandle: FileSystemDirectoryHandle | null = null;

interface NativeStorageSaveBridge {
  openDeviceFolderPicker?(): void;
  beginTempSave?(extension: string): string;
  appendTempSaveChunk?(saveId: string, base64Chunk: string): boolean;
  abortTempSave?(saveId: string): void;
  finishTempSave?(
    saveId: string,
    filename: string,
    folderName: string,
    mimeType: string,
    requestId: string,
  ): void;
}

declare global {
  interface Window {
    onNativeStorageSaveResult?: (requestId: string, response: string) => void;
  }
}

const pendingStorageSaves = new Map<
  string,
  { resolve: () => void; reject: (error: Error) => void }
>();

function getNativeStorageBridge(): NativeStorageSaveBridge | undefined {
  if (typeof window === "undefined") return undefined;
  return (window as Window & { AndroidStorageBridge?: NativeStorageSaveBridge }).AndroidStorageBridge;
}

function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = "";
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) {
    binary += String.fromCharCode(...bytes.subarray(i, i + step));
  }
  return btoa(binary);
}

async function saveBlobViaAndroidBridge(
  blob: Blob,
  filename: string,
  folderName: string,
  onSaveProgress?: (fraction: number) => void,
): Promise<boolean> {
  const bridge = getNativeStorageBridge();
  if (
    !bridge?.beginTempSave ||
    !bridge?.appendTempSaveChunk ||
    !bridge?.finishTempSave
  ) {
    return false;
  }

  window.onNativeStorageSaveResult ??= (requestId, response) => {
    const pending = pendingStorageSaves.get(requestId);
    if (!pending) return;
    pendingStorageSaves.delete(requestId);
    try {
      const parsed = JSON.parse(response) as { error?: string };
      if (parsed.error) pending.reject(new Error(parsed.error));
      else pending.resolve();
    } catch {
      pending.reject(new Error("Invalid response from Android storage bridge."));
    }
  };

  const ext = filename.split(".").pop() || "bin";
  const saveId = bridge.beginTempSave(ext);
  if (!saveId) return false;

  const chunkSize = 256 * 1024;
  try {
    const totalSize = Math.max(1, blob.size);
    for (let offset = 0; offset < blob.size; offset += chunkSize) {
      const end = Math.min(offset + chunkSize, blob.size);
      const slice = blob.slice(offset, end);
      const buffer = await slice.arrayBuffer();
      const base64Chunk = uint8ArrayToBase64(new Uint8Array(buffer));
      if (!bridge.appendTempSaveChunk(saveId, base64Chunk)) {
        throw new Error("Failed while streaming file chunk to device storage.");
      }
      onSaveProgress?.(Math.min(0.85, (end / totalSize) * 0.85));
    }

    const requestId = `save-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    await new Promise<void>((resolve, reject) => {
      pendingStorageSaves.set(requestId, { resolve, reject });
      bridge.finishTempSave!(
        saveId,
        filename,
        folderName,
        blob.type || "",
        requestId,
      );
    });
    onSaveProgress?.(1);
    return true;
  } catch (err) {
    bridge.abortTempSave?.(saveId);
    throw err;
  }
}

export async function ensureStoragePermissions(): Promise<boolean> {
  try {
    const status = await Filesystem.checkPermissions();
    if (status.publicStorage !== "granted") {
      const request = await Filesystem.requestPermissions();
      return request.publicStorage === "granted";
    }
    return true;
  } catch {
    return true;
  }
}

export function getStoredFolderName(): string | null {
  return localStorage.getItem("hutaotik_download_folder_name");
}

export function setStoredFolderName(name: string): void {
  localStorage.setItem("hutaotik_download_folder_name", name);
}

export function clearStoredFolderName(): void {
  localStorage.removeItem("hutaotik_download_folder_name");
  currentDirHandle = null;
}

export function getDirHandle(): FileSystemDirectoryHandle | null {
  return currentDirHandle;
}

export function setDirHandle(handle: FileSystemDirectoryHandle | null): void {
  currentDirHandle = handle;
  if (handle?.name) {
    setStoredFolderName(handle.name);
  }
}

export async function createAndSetDeviceFolder(folderName: string): Promise<string> {
  await ensureStoragePermissions();
  const cleanName = folderName.trim().replace(/[<>:"/\\|?*\x00-\x1f]/g, " ") || "HutaoTik Downloads";

  try {
    await Filesystem.mkdir({
      path: cleanName,
      directory: Directory.Documents,
      recursive: true,
    });
  } catch {
    try {
      await Filesystem.mkdir({
        path: cleanName,
        directory: Directory.Cache,
        recursive: true,
      });
    } catch {
      /* ignore if directory already exists */
    }
  }

  setStoredFolderName(cleanName);
  return cleanName;
}

export async function openDeviceStorageFolderPicker(): Promise<string | null> {
  await ensureStoragePermissions();

  return new Promise((resolve) => {
    const bridge = getNativeStorageBridge();
    if (bridge?.openDeviceFolderPicker) {
      (window as Window & { onAndroidFolderPicked?: (name: string) => void }).onAndroidFolderPicked = (
        folderName: string,
      ) => {
        const trimmed = folderName?.trim() ?? "";
        resolve(trimmed ? trimmed : null);
      };
      try {
        bridge.openDeviceFolderPicker();
        return;
      } catch {
        /* fallback */
      }
    }

    if ("showDirectoryPicker" in window) {
      (window as unknown as { showDirectoryPicker: (opts: { mode: string }) => Promise<FileSystemDirectoryHandle> })
        .showDirectoryPicker({ mode: "readwrite" })
        .then((handle: FileSystemDirectoryHandle) => {
          if (handle) {
            setDirHandle(handle);
            resolve(handle.name);
          } else {
            resolve(null);
          }
        })
        .catch(() => resolve(null));
      return;
    }

    const input = document.createElement("input");
    input.type = "file";
    input.setAttribute("webkitdirectory", "");
    input.setAttribute("directory", "");
    input.style.display = "none";

    let settled = false;
    const cleanup = (result: string | null) => {
      if (settled) return;
      settled = true;
      window.removeEventListener("focus", handleWindowFocus);
      if (document.body.contains(input)) {
        document.body.removeChild(input);
      }
      resolve(result);
    };

    const handleWindowFocus = () => {
      setTimeout(() => {
        if (!settled && (!input.files || input.files.length === 0)) {
          cleanup(null);
        }
      }, 400);
    };

    input.onchange = (e: Event) => {
      const target = e.target as HTMLInputElement;
      if (target.files && target.files.length > 0) {
        const firstFile = target.files[0];
        const relPath = firstFile.webkitRelativePath || firstFile.name;
        const pickedName = relPath.split("/")[0] || "HutaoTik Downloads";
        cleanup(pickedName);
      } else {
        cleanup(null);
      }
    };
    input.addEventListener("cancel", () => cleanup(null));
    window.addEventListener("focus", handleWindowFocus);

    document.body.appendChild(input);
    input.click();
  });
}

export async function promptSelectDirectory(): Promise<{ name: string; handle?: FileSystemDirectoryHandle } | null> {
  const pickedName = await openDeviceStorageFolderPicker();
  if (pickedName) {
    return { name: pickedName };
  }
  return null;
}

export async function saveBlobToDevice(
  blob: Blob,
  filename: string,
  folderName: string,
  onProgress?: (progress: DownloadProgressState) => void,
  progressRange?: { startPercent?: number; endPercent?: number },
): Promise<void> {
  await ensureStoragePermissions();
  const cleanFolder = folderName.trim() || "HutaoTik Downloads";
  const startPercent = progressRange?.startPercent ?? 88;
  const endPercent = progressRange?.endPercent ?? 100;
  const span = Math.max(1, endPercent - startPercent);
  const emitSaveProgress = (fraction: number) => {
    onProgress?.({
      percent: clampPercent(startPercent + Math.max(0, Math.min(1, fraction)) * span),
      loadedBytes: blob.size,
      totalBytes: blob.size,
      status: fraction >= 1 ? "Saved to device folder" : "Saving to device folder…",
    });
  };
  emitSaveProgress(0);

  // 1. Native Android SAF / MediaStore chunked writer (respects custom folder picker & avoids Base64 OOM)
  try {
    if (await saveBlobViaAndroidBridge(blob, filename, cleanFolder, emitSaveProgress)) {
      return;
    }
  } catch (err) {
    console.warn("Native Android storage save failed; trying fallback.", err);
  }

  // 2. Desktop File System Access API
  if (currentDirHandle) {
    try {
      const fileHandle = await currentDirHandle.getFileHandle(filename, { create: true });
      const writable = await (fileHandle as unknown as {
        createWritable: () => Promise<{ write: (b: Blob) => Promise<void>; close: () => Promise<void> }>;
      }).createWritable();
      await writable.write(blob);
      await writable.close();
      emitSaveProgress(1);
      return;
    } catch {
      /* fallback to Capacitor Filesystem or Blob URL */
    }
  }

  // 3. Capacitor Filesystem fallback (only for smaller payloads if native bridge unavailable)
  let savedLocally = false;
  if (blob.size <= 35 * 1024 * 1024) {
    try {
      const base64Data = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => {
          const res = reader.result as string;
          const base64 = res.split(",")[1] || res;
          resolve(base64);
        };
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
      emitSaveProgress(0.5);

      try {
        await Filesystem.writeFile({
          path: `${cleanFolder}/${filename}`,
          data: base64Data,
          directory: Directory.Documents,
          recursive: true,
        });
        savedLocally = true;
      } catch {
        try {
          await Filesystem.writeFile({
            path: `${cleanFolder}/${filename}`,
            data: base64Data,
            directory: Directory.ExternalStorage,
            recursive: true,
          });
          savedLocally = true;
        } catch {
          /* fallback to browser blob link */
        }
      }
    } catch {
      /* fallback to browser blob link */
    }
  }

  if (!savedLocally) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }
  emitSaveProgress(1);
}

export async function saveUrlToDevice(
  url: string,
  filename: string,
  folderName: string,
  onProgress?: (progress: DownloadProgressState) => void,
): Promise<void> {
  await ensureStoragePermissions();
  const cleanFolder = folderName.trim() || "HutaoTik Downloads";

  const bridge = getNativeStorageBridge();
  if (!bridge?.beginTempSave && !onProgress) {
    try {
      await Filesystem.downloadFile({
        url,
        path: `${cleanFolder}/${filename}`,
        directory: Directory.Documents,
        recursive: true,
      });
      return;
    } catch {
      /* fallback to fetch blob */
    }
  }

  const res = await fetch(url, { referrerPolicy: "no-referrer" });
  if (!res.ok) throw new Error("Server returned HTTP " + res.status);
  const blob = await fetchBlobWithProgress(res, onProgress, {
    startPercent: 0,
    endPercent: 88,
    status: "Downloading media…",
  });
  await saveBlobToDevice(blob, filename, cleanFolder, onProgress, {
    startPercent: 88,
    endPercent: 100,
  });
}
