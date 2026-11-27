import type { TiktokVideoInfo } from "@workspace/api-client-react";
import {
  registerNativeDownloadProgressListener,
  type DownloadProgressState,
} from "@/lib/download-progress";

export interface NativeTwitterFormat {
  height: number | null;
  qualityLabel: string;
  downloadUrl?: string;
}

export interface NativeTwitterInfo {
  id: string;
  title: string;
  thumbnail: string | null;
  channelName: string;
  duration: number;
  isGif?: boolean;
  formats: NativeTwitterFormat[];
}

export type BackgroundFetchPlatform =
  | "tiktok"
  | "youtube"
  | "facebook"
  | "twitter"
  | "instagram"
  | "pinterest";

export interface PendingBackgroundFetch {
  requestId: string;
  platform: BackgroundFetchPlatform;
  url: string;
  data: Record<string, unknown>;
  completedAt: number;
}

interface NativeBackgroundFetchBridge {
  getTikTokInfo?(url: string, requestId: string): void;
  getTwitterInfo?(url: string, requestId: string): void;
  getPendingBackgroundFetch?(): string;
  clearPendingBackgroundFetch?(requestId: string): void;
}

declare global {
  interface Window {
    onNativeTikTokResult?: (requestId: string, response: string) => void;
    onNativeTwitterResult?: (requestId: string, response: string) => void;
  }
}

function getBridge(): NativeBackgroundFetchBridge | undefined {
  if (typeof window === "undefined") return undefined;
  return (window as Window & { AndroidStorageBridge?: NativeBackgroundFetchBridge })
    .AndroidStorageBridge;
}

const pendingTikTok = new Map<
  string,
  { resolve: (info: TiktokVideoInfo) => void; reject: (err: Error) => void }
>();

const pendingTwitter = new Map<
  string,
  { resolve: (info: NativeTwitterInfo) => void; reject: (err: Error) => void }
>();

export function clearPendingBackgroundFetch(requestId: string): void {
  try {
    getBridge()?.clearPendingBackgroundFetch?.(requestId);
  } catch {
    /* ignore */
  }
}

export function consumePendingBackgroundFetch(): PendingBackgroundFetch | null {
  try {
    const raw = getBridge()?.getPendingBackgroundFetch?.();
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PendingBackgroundFetch>;
    const validPlatforms: BackgroundFetchPlatform[] = [
      "tiktok",
      "youtube",
      "facebook",
      "twitter",
      "instagram",
      "pinterest",
    ];
    if (
      !parsed ||
      typeof parsed.url !== "string" ||
      !parsed.url.trim() ||
      typeof parsed.platform !== "string" ||
      !validPlatforms.includes(parsed.platform as BackgroundFetchPlatform) ||
      typeof parsed.data !== "object" ||
      parsed.data === null
    ) {
      return null;
    }
    return {
      requestId: typeof parsed.requestId === "string" ? parsed.requestId : "",
      platform: parsed.platform as BackgroundFetchPlatform,
      url: parsed.url.trim(),
      data: parsed.data as Record<string, unknown>,
      completedAt: typeof parsed.completedAt === "number" ? parsed.completedAt : Date.now(),
    };
  } catch {
    return null;
  }
}

const DEFAULT_NATIVE_FETCH_TIMEOUT_MS = 65_000;

export function hasValidTikTokMedia(data: unknown): data is TiktokVideoInfo {
  if (!data || typeof data !== "object") return false;
  const candidate = data as Partial<TiktokVideoInfo>;
  if (Array.isArray(candidate.photos) && candidate.photos.length > 0) return true;
  const dl = candidate.downloadUrls;
  return Boolean(dl && (dl.hd || dl.normal || dl.low || dl.audio));
}

export function isNativeTikTokFetchAvailable(): boolean {
  return Boolean(getBridge()?.getTikTokInfo);
}

export function fetchTikTokInfoOnDevice(
  url: string,
  onProgress?: (progress: DownloadProgressState) => void,
  timeoutMs = DEFAULT_NATIVE_FETCH_TIMEOUT_MS,
): Promise<TiktokVideoInfo> {
  const bridge = getBridge();
  if (!bridge?.getTikTokInfo) {
    return Promise.reject(new Error("Background TikTok fetching is unavailable."));
  }

  window.onNativeTikTokResult ??= (requestId, response) => {
    const pending = pendingTikTok.get(requestId);
    if (!pending) return;
    pendingTikTok.delete(requestId);
    clearPendingBackgroundFetch(requestId);

    try {
      const parsed = JSON.parse(response) as Partial<TiktokVideoInfo> & { error?: string };
      if (parsed.error) {
        pending.reject(new Error(parsed.error));
      } else if (!hasValidTikTokMedia(parsed)) {
        pending.reject(new Error("Could not fetch TikTok video details."));
      } else {
        const normalized: TiktokVideoInfo = {
          ...(parsed as TiktokVideoInfo),
          id:
            typeof parsed.id === "string" && parsed.id.trim().length > 0
              ? parsed.id.trim()
              : `tt-${Date.now()}`,
        };
        pending.resolve(normalized);
      }
    } catch (err) {
      pending.reject(err instanceof Error ? err : new Error("Invalid TikTok fetch response."));
    }
  };

  const requestId = `tiktok-fetch-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const unregisterProgress = registerNativeDownloadProgressListener(requestId, onProgress);
  return new Promise<TiktokVideoInfo>((resolve, reject) => {
    const timer =
      timeoutMs > 0
        ? setTimeout(() => {
            if (!pendingTikTok.has(requestId)) return;
            pendingTikTok.delete(requestId);
            reject(new Error("TikTok background fetch timed out. Please try again."));
          }, timeoutMs)
        : null;

    const cleanupTimer = () => {
      if (timer !== null) clearTimeout(timer);
    };

    pendingTikTok.set(requestId, {
      resolve: (info) => {
        cleanupTimer();
        resolve(info);
      },
      reject: (err) => {
        cleanupTimer();
        reject(err);
      },
    });
    try {
      bridge.getTikTokInfo!(url, requestId);
    } catch (err) {
      cleanupTimer();
      pendingTikTok.delete(requestId);
      reject(err instanceof Error ? err : new Error("Could not start TikTok fetch."));
    }
  }).finally(() => {
    unregisterProgress();
  });
}

export function isNativeTwitterFetchAvailable(): boolean {
  return Boolean(getBridge()?.getTwitterInfo);
}

export function fetchTwitterInfoOnDevice(
  url: string,
  onProgress?: (progress: DownloadProgressState) => void,
  timeoutMs = DEFAULT_NATIVE_FETCH_TIMEOUT_MS,
): Promise<NativeTwitterInfo> {
  const bridge = getBridge();
  if (!bridge?.getTwitterInfo) {
    return Promise.reject(new Error("Background X fetching is unavailable."));
  }

  window.onNativeTwitterResult ??= (requestId, response) => {
    const pending = pendingTwitter.get(requestId);
    if (!pending) return;
    pendingTwitter.delete(requestId);
    clearPendingBackgroundFetch(requestId);

    try {
      const parsed = JSON.parse(response) as Partial<NativeTwitterInfo> & { error?: string };
      if (parsed.error) {
        pending.reject(new Error(parsed.error));
      } else if (!Array.isArray(parsed.formats) || parsed.formats.length === 0) {
        pending.reject(new Error("No downloadable video or GIF was found in this X post."));
      } else {
        pending.resolve(parsed as NativeTwitterInfo);
      }
    } catch (err) {
      pending.reject(err instanceof Error ? err : new Error("Invalid X fetch response."));
    }
  };

  const requestId = `twitter-fetch-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const unregisterProgress = registerNativeDownloadProgressListener(requestId, onProgress);
  return new Promise<NativeTwitterInfo>((resolve, reject) => {
    const timer =
      timeoutMs > 0
        ? setTimeout(() => {
            if (!pendingTwitter.has(requestId)) return;
            pendingTwitter.delete(requestId);
            reject(new Error("X background fetch timed out. Please try again."));
          }, timeoutMs)
        : null;

    const cleanupTimer = () => {
      if (timer !== null) clearTimeout(timer);
    };

    pendingTwitter.set(requestId, {
      resolve: (info) => {
        cleanupTimer();
        resolve(info);
      },
      reject: (err) => {
        cleanupTimer();
        reject(err);
      },
    });
    try {
      bridge.getTwitterInfo!(url, requestId);
    } catch (err) {
      cleanupTimer();
      pendingTwitter.delete(requestId);
      reject(err instanceof Error ? err : new Error("Could not start X fetch."));
    }
  }).finally(() => {
    unregisterProgress();
  });
}
