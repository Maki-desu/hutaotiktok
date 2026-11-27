import {
  registerNativeDownloadProgressListener,
  type DownloadProgressState,
} from "@/lib/download-progress";

interface NativeBackgroundDownloadBridge {
  downloadUrlInBackground?(
    url: string,
    filename: string,
    folderName: string,
    title: string,
    mimeType: string,
    requestId: string,
  ): void;
}

declare global {
  interface Window {
    onNativeDirectDownloadResult?: (requestId: string, response: string) => void;
  }
}

const pendingDirectDownloads = new Map<
  string,
  { resolve: (result: { filename: string }) => void; reject: (error: Error) => void }
>();

function getBridge(): NativeBackgroundDownloadBridge | undefined {
  if (typeof window === "undefined") return undefined;
  return (window as Window & { AndroidStorageBridge?: NativeBackgroundDownloadBridge })
    .AndroidStorageBridge;
}

export function isNativeBackgroundDownloadAvailable(): boolean {
  return Boolean(getBridge()?.downloadUrlInBackground);
}

export async function downloadUrlInBackgroundNative(params: {
  url: string;
  filename: string;
  folderName: string;
  title: string;
  mimeType?: string;
  onProgress?: (progress: DownloadProgressState) => void;
}): Promise<{ filename: string }> {
  const bridge = getBridge();
  if (!bridge?.downloadUrlInBackground) {
    throw new Error("Native background downloader is unavailable.");
  }

  window.onNativeDirectDownloadResult ??= (requestId, rawPayload) => {
    const pending = pendingDirectDownloads.get(requestId);
    if (!pending) return;
    pendingDirectDownloads.delete(requestId);
    try {
      const parsed = JSON.parse(rawPayload) as { filename?: string; error?: string };
      if (parsed.error) {
        pending.reject(new Error(parsed.error));
      } else {
        pending.resolve({ filename: parsed.filename || "" });
      }
    } catch {
      pending.reject(new Error("Invalid response from native background downloader."));
    }
  };

  const requestId = `bgdl-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const unsubscribe = registerNativeDownloadProgressListener(requestId, params.onProgress);

  try {
    const result = await new Promise<{ filename: string }>((resolve, reject) => {
      pendingDirectDownloads.set(requestId, { resolve, reject });
      bridge.downloadUrlInBackground!(
        params.url,
        params.filename,
        params.folderName,
        params.title,
        params.mimeType ?? "",
        requestId,
      );
    });
    return {
      filename: result.filename || params.filename,
    };
  } finally {
    unsubscribe();
    pendingDirectDownloads.delete(requestId);
  }
}
