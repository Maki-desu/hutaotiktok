export type SocialVideoPlatform = "pinterest" | "instagram";

export interface NativeSocialVideoInfo {
  id: string;
  title: string;
  thumbnail: string | null;
  channelName: string;
  duration: number;
  height: number | null;
  mediaType: "video" | "image";
  directUrl: string | null;
  canonicalUrl: string | null;
  nativeDownload: true;
}

interface NativeSocialVideoResponse {
  error?: string;
  id?: string;
  title?: string;
  thumbnail?: string | null;
  channelName?: string;
  duration?: number;
  height?: number | null;
  mediaType?: "video" | "image";
  directUrl?: string | null;
  canonicalUrl?: string | null;
  filename?: string;
}

interface NativeSocialVideoBridge {
  getSocialVideoInfo(platform: string, url: string, requestId: string): void;
  downloadSocialVideo(
    platform: string,
    url: string,
    directUrl: string,
    mediaType: string,
    filename: string,
    folderName: string,
    requestId: string,
  ): void;
}

declare global {
  interface Window {
    onNativeSocialVideoResult?: (requestId: string, response: string) => void;
  }
}

const pendingRequests = new Map<
  string,
  {
    resolve: (response: NativeSocialVideoResponse) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }
>();

function getNativeSocialBridge(): NativeSocialVideoBridge | undefined {
  if (typeof window === "undefined") return undefined;
  return (window as Window & { AndroidStorageBridge?: Partial<NativeSocialVideoBridge> })
    .AndroidStorageBridge as NativeSocialVideoBridge | undefined;
}

function requestNativeSocialVideo(
  timeoutMs: number,
  startRequest: (bridge: NativeSocialVideoBridge, requestId: string) => void,
): Promise<NativeSocialVideoResponse> {
  const bridge = getNativeSocialBridge();
  if (!bridge?.getSocialVideoInfo || !bridge?.downloadSocialVideo) {
    return Promise.reject(new Error("On-device social media downloads are unavailable."));
  }

  window.onNativeSocialVideoResult ??= (requestId, response) => {
    const pending = pendingRequests.get(requestId);
    if (!pending) return;
    clearTimeout(pending.timer);
    pendingRequests.delete(requestId);

    try {
      const result = JSON.parse(response) as NativeSocialVideoResponse;
      if (result.error) pending.reject(new Error(result.error));
      else pending.resolve(result);
    } catch (error) {
      pending.reject(
        error instanceof Error ? error : new Error("Invalid response from on-device downloader."),
      );
    }
  };

  const requestId = `social-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingRequests.delete(requestId);
      reject(new Error("On-device download request timed out."));
    }, timeoutMs);

    pendingRequests.set(requestId, { resolve, reject, timer });
    try {
      startRequest(bridge, requestId);
    } catch (error) {
      clearTimeout(timer);
      pendingRequests.delete(requestId);
      reject(error instanceof Error ? error : new Error("Could not start on-device download."));
    }
  });
}

export function isNativeSocialVideoAvailable(): boolean {
  const bridge = getNativeSocialBridge();
  return Boolean(bridge?.getSocialVideoInfo && bridge?.downloadSocialVideo);
}

export function fetchSocialVideoInfoOnDevice(
  platform: SocialVideoPlatform,
  url: string,
): Promise<NativeSocialVideoInfo> {
  const providerName = platform === "instagram" ? "Instagram" : "Pinterest";
  return requestNativeSocialVideo(90_000, (bridge, requestId) =>
    bridge.getSocialVideoInfo(platform, url, requestId),
  ).then((response) => ({
    id: response.id ?? "",
    title: response.title ?? `${providerName} Video`,
    thumbnail: response.thumbnail ?? null,
    channelName: response.channelName ?? providerName,
    duration: typeof response.duration === "number" && Number.isFinite(response.duration) ? response.duration : 0,
    height: typeof response.height === "number" && Number.isFinite(response.height) && response.height > 0
      ? response.height
      : null,
    mediaType: response.mediaType === "image" ? "image" : "video",
    directUrl: typeof response.directUrl === "string" ? response.directUrl : null,
    canonicalUrl: typeof response.canonicalUrl === "string" ? response.canonicalUrl : null,
    nativeDownload: true,
  }));
}

export function downloadSocialVideoOnDevice(
  platform: SocialVideoPlatform,
  url: string,
  directUrl: string | null,
  mediaType: "video" | "image",
  filename: string,
  folderName: string,
): Promise<{ filename: string; mediaType: "video" | "image" }> {
  return requestNativeSocialVideo(600_000, (bridge, requestId) =>
    bridge.downloadSocialVideo(
      platform,
      url,
      directUrl ?? "",
      mediaType,
      filename,
      folderName,
      requestId,
    ),
  ).then((response) => ({
    filename: response.filename || filename,
    mediaType: response.mediaType === "image" ? "image" : mediaType,
  }));
}
