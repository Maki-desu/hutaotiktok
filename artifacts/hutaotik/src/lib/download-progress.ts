export interface DownloadProgressState {
  percent: number;
  loadedBytes?: number;
  totalBytes?: number;
  etaSeconds?: number;
  status?: string;
}

type ProgressListener = (progress: DownloadProgressState) => void;

declare global {
  interface Window {
    onNativeDownloadProgress?: (requestId: string, payload: string) => void;
  }
}

const nativeProgressListeners = new Map<string, ProgressListener>();

export function formatByteSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let size = bytes;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  const decimals = unitIndex === 0 ? 0 : size >= 100 ? 0 : 1;
  return `${size.toFixed(decimals)} ${units[unitIndex]}`;
}

export function formatEtaSeconds(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "";
  const rounded = Math.round(seconds);
  if (rounded < 60) return `${rounded}s left`;
  const mins = Math.floor(rounded / 60);
  const secs = rounded % 60;
  return `${mins}m ${secs}s left`;
}

export function formatProgressDetail(progress: DownloadProgressState): string {
  const parts: string[] = [];
  if (progress.status) {
    parts.push(progress.status);
  }
  if (
    typeof progress.loadedBytes === "number" &&
    progress.loadedBytes > 0 &&
    typeof progress.totalBytes === "number" &&
    progress.totalBytes > 0
  ) {
    parts.push(`${formatByteSize(progress.loadedBytes)} / ${formatByteSize(progress.totalBytes)}`);
  } else if (typeof progress.loadedBytes === "number" && progress.loadedBytes > 0) {
    parts.push(`${formatByteSize(progress.loadedBytes)} downloaded`);
  }
  if (typeof progress.etaSeconds === "number" && progress.etaSeconds > 0) {
    parts.push(formatEtaSeconds(progress.etaSeconds));
  }
  return parts.join(" · ") || "Preparing download…";
}

export function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function registerNativeDownloadProgressListener(
  requestId: string,
  onProgress?: ProgressListener,
): () => void {
  if (!onProgress || typeof window === "undefined") {
    return () => {};
  }

  window.onNativeDownloadProgress ??= (id: string, rawPayload: string) => {
    const listener = nativeProgressListeners.get(id);
    if (!listener) return;
    try {
      const parsed = JSON.parse(rawPayload) as Partial<DownloadProgressState>;
      listener({
        percent: clampPercent(typeof parsed.percent === "number" ? parsed.percent : 0),
        loadedBytes:
          typeof parsed.loadedBytes === "number" && parsed.loadedBytes > 0
            ? parsed.loadedBytes
            : undefined,
        totalBytes:
          typeof parsed.totalBytes === "number" && parsed.totalBytes > 0
            ? parsed.totalBytes
            : undefined,
        etaSeconds:
          typeof parsed.etaSeconds === "number" && parsed.etaSeconds > 0
            ? parsed.etaSeconds
            : undefined,
        status: typeof parsed.status === "string" && parsed.status.trim() ? parsed.status.trim() : undefined,
      });
    } catch {
      /* ignore malformed progress payload */
    }
  };

  nativeProgressListeners.set(requestId, onProgress);
  return () => {
    nativeProgressListeners.delete(requestId);
  };
}

export async function fetchBlobWithProgress(
  response: Response,
  onProgress?: ProgressListener,
  options?: { startPercent?: number; endPercent?: number; status?: string },
): Promise<Blob> {
  const startPercent = options?.startPercent ?? 0;
  const endPercent = options?.endPercent ?? 88;
  const span = Math.max(1, endPercent - startPercent);
  const status = options?.status ?? "Downloading media…";
  const contentType = response.headers.get("content-type") || "";
  const contentLengthHeader = response.headers.get("content-length");
  const totalBytes = contentLengthHeader ? Number.parseInt(contentLengthHeader, 10) : 0;
  const hasKnownTotal = Number.isFinite(totalBytes) && totalBytes > 0;

  onProgress?.({
    percent: startPercent,
    totalBytes: hasKnownTotal ? totalBytes : undefined,
    status,
  });

  const reader = response.body?.getReader();
  if (!reader) {
    const blob = await response.blob();
    onProgress?.({
      percent: endPercent,
      loadedBytes: blob.size,
      totalBytes: blob.size || undefined,
      status,
    });
    return blob;
  }

  const chunks: Uint8Array[] = [];
  let loadedBytes = 0;
  let lastEmitAt = 0;
  let lastPercent = startPercent;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value || value.length === 0) continue;

    chunks.push(value);
    loadedBytes += value.length;

    const fraction = hasKnownTotal
      ? Math.min(1, loadedBytes / totalBytes)
      : Math.min(0.92, 1 - Math.exp(-loadedBytes / (3 * 1024 * 1024)));
    const percent = clampPercent(startPercent + fraction * span);
    const now = Date.now();
    if (percent !== lastPercent || now - lastEmitAt >= 120) {
      lastPercent = percent;
      lastEmitAt = now;
      onProgress?.({
        percent,
        loadedBytes,
        totalBytes: hasKnownTotal ? totalBytes : undefined,
        status,
      });
    }
  }

  const blob = new Blob(chunks as unknown as BlobPart[], contentType ? { type: contentType } : undefined);
  onProgress?.({
    percent: endPercent,
    loadedBytes: blob.size,
    totalBytes: hasKnownTotal ? totalBytes : blob.size || undefined,
    status,
  });
  return blob;
}
