export interface NativeFacebookInfo {
  title: string;
  thumbnail: string | null;
  hdUrl: null;
  sdUrl: null;
  nativeDownload: true;
}

interface NativeFacebookResponse {
  error?: string;
  title?: string;
  thumbnail?: string | null;
}

interface NativeFacebookBridge {
  getFacebookInfo(url: string, requestId: string): void;
  downloadFacebook(url: string, quality: string, filename: string, folderName: string, requestId: string): void;
  installAppUpdate?(url: string, sha256: string): string;
}

declare global {
  interface Window {
    AndroidStorageBridge?: NativeFacebookBridge;
    onNativeFacebookResult?: (requestId: string, response: string) => void;
  }
}

const pendingRequests = new Map<
  string,
  { resolve: (response: NativeFacebookResponse) => void; reject: (error: Error) => void }
>();

function requestNativeFacebook(
  startRequest: (bridge: NativeFacebookBridge, requestId: string) => void
): Promise<NativeFacebookResponse> {
  const bridge = window.AndroidStorageBridge;
  if (!bridge) return Promise.reject(new Error("On-device Facebook downloads are unavailable."));

  window.onNativeFacebookResult ??= (requestId, response) => {
    const pending = pendingRequests.get(requestId);
    if (!pending) return;
    pendingRequests.delete(requestId);

    try {
      const result = JSON.parse(response) as NativeFacebookResponse;
      if (result.error) pending.reject(new Error(result.error));
      else pending.resolve(result);
    } catch (error) {
      pending.reject(error instanceof Error ? error : new Error("Invalid response from Facebook downloader."));
    }
  };

  const requestId = `facebook-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return new Promise((resolve, reject) => {
    pendingRequests.set(requestId, { resolve, reject });
    try {
      startRequest(bridge, requestId);
    } catch (error) {
      pendingRequests.delete(requestId);
      reject(error instanceof Error ? error : new Error("Could not start Facebook download."));
    }
  });
}

export function isNativeFacebookAvailable(): boolean {
  return typeof window !== "undefined" && !!window.AndroidStorageBridge;
}

export function fetchFacebookInfoOnDevice(url: string): Promise<NativeFacebookInfo> {
  return requestNativeFacebook((bridge, requestId) => bridge.getFacebookInfo(url, requestId))
    .then((response) => ({
      title: response.title ?? "Facebook Video",
      thumbnail: response.thumbnail ?? null,
      hdUrl: null,
      sdUrl: null,
      nativeDownload: true,
    }));
}

export function downloadFacebookOnDevice(
  url: string,
  quality: string,
  filename: string,
  folderName: string
): Promise<void> {
  return requestNativeFacebook((bridge, requestId) =>
    bridge.downloadFacebook(url, quality, filename, folderName, requestId)
  ).then(() => undefined);
}
