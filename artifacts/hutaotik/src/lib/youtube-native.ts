import {
  registerNativeDownloadProgressListener,
  type DownloadProgressState,
} from "@/lib/download-progress";
import { clearPendingBackgroundFetch } from "@/lib/background-fetch";

export interface NativeYouTubeFormat {
  formatStr: string;
  qualityLabel: string;
  needsMux: false;
}

export interface NativeYouTubeInfo {
  id: string;
  title: string;
  thumbnail: string | null;
  channelName: string;
  duration: number;
  formats: NativeYouTubeFormat[];
}

interface NativeYouTubeResponse extends Partial<NativeYouTubeInfo> {
  error?: string;
}

interface NativeYouTubeBridge {
  getYouTubeInfo(url: string, requestId: string): void;
  downloadYouTube(url: string, formatStr: string, filename: string, folderName: string, requestId: string): void;
}

declare global {
  interface Window {
    onNativeYouTubeResult?: (requestId: string, response: string) => void;
  }
}

const pendingRequests = new Map<
  string,
  { resolve: (response: NativeYouTubeResponse) => void; reject: (error: Error) => void }
>();

function requestNativeYouTube(
  startRequest: (bridge: NativeYouTubeBridge, requestId: string) => void,
  onProgress?: (progress: DownloadProgressState) => void,
): Promise<NativeYouTubeResponse> {
  const bridge = (window as Window & { AndroidStorageBridge?: NativeYouTubeBridge }).AndroidStorageBridge;
  if (!bridge) return Promise.reject(new Error("On-device YouTube downloads are unavailable."));

  window.onNativeYouTubeResult ??= (requestId, response) => {
    const pending = pendingRequests.get(requestId);
    if (!pending) return;
    pendingRequests.delete(requestId);
    clearPendingBackgroundFetch(requestId);

    try {
      const result = JSON.parse(response) as NativeYouTubeResponse;
      if (result.error) pending.reject(new Error(result.error));
      else pending.resolve(result);
    } catch (error) {
      pending.reject(error instanceof Error ? error : new Error("Invalid response from YouTube downloader."));
    }
  };

  const requestId = `youtube-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const unregisterProgress = registerNativeDownloadProgressListener(requestId, onProgress);
  return new Promise<NativeYouTubeResponse>((resolve, reject) => {
    pendingRequests.set(requestId, { resolve, reject });
    try {
      startRequest(bridge, requestId);
    } catch (error) {
      pendingRequests.delete(requestId);
      reject(error instanceof Error ? error : new Error("Could not start YouTube download."));
    }
  }).finally(() => {
    unregisterProgress();
  });
}

export function isNativeYouTubeAvailable(): boolean {
  if (typeof window === "undefined") return false;
  const bridge = (window as Window & { AndroidStorageBridge?: NativeYouTubeBridge }).AndroidStorageBridge;
  return !!bridge?.getYouTubeInfo && !!bridge.downloadYouTube;
}

export function fetchYouTubeInfoOnDevice(
  url: string,
  onProgress?: (progress: DownloadProgressState) => void,
): Promise<NativeYouTubeInfo> {
  return requestNativeYouTube(
    (bridge, requestId) => bridge.getYouTubeInfo(url, requestId),
    onProgress,
  )
    .then((response) => {
      if (!response.id || !Array.isArray(response.formats)) {
        throw new Error("The on-device YouTube downloader returned invalid video information.");
      }
      return {
        id: response.id,
        title: response.title ?? "YouTube Video",
        thumbnail: response.thumbnail ?? null,
        channelName: response.channelName ?? "Unknown",
        duration: response.duration ?? 0,
        formats: response.formats,
      };
    });
}

export function downloadYouTubeOnDevice(
  url: string,
  formatStr: string,
  filename: string,
  folderName: string,
  onProgress?: (progress: DownloadProgressState) => void,
): Promise<void> {
  return requestNativeYouTube(
    (bridge, requestId) => bridge.downloadYouTube(url, formatStr, filename, folderName, requestId),
    onProgress,
  ).then(() => undefined);
}
