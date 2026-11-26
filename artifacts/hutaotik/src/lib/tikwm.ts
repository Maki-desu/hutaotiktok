import type { TiktokVideoInfo } from "@workspace/api-client-react";

interface TikwmData {
  id?: string | number;
  title?: string;
  play?: string;
  hdplay?: string;
  wmplay?: string;
  music?: string;
  music_info?: {
    title?: string;
    author?: string;
    play?: string;
  };
  author?: {
    unique_id?: string;
    nickname?: string;
    avatar?: string;
  };
  cover?: string;
  duration?: number;
  images?: string[];
}

interface TikwmResponse {
  code: number;
  msg?: string;
  data?: TikwmData;
}

const TIKWM_APIS = ["https://www.tikwm.com/api/", "https://tikwm.com/api/"];

function isTikwmResponse(value: unknown): value is TikwmResponse {
  if (typeof value !== "object" || value === null || !("code" in value)) return false;
  return typeof value.code === "number";
}

function toVideoInfo(data: TikwmData): TiktokVideoInfo {
  const photos = Array.isArray(data.images)
    ? data.images.filter((image): image is string => typeof image === "string")
    : [];
  const authorUsername = data.author?.unique_id ?? "unknown";

  return {
    id: String(data.id ?? ""),
    title: data.title ?? "TikTok video",
    author: data.author?.nickname ?? authorUsername,
    authorUsername,
    authorAvatar: data.author?.avatar ?? null,
    thumbnail: data.cover ?? null,
    duration: data.duration ?? null,
    downloadUrls: {
      hd: data.hdplay ?? data.play ?? null,
      normal: data.play ?? null,
      low: data.wmplay ?? data.play ?? null,
      audio: data.music ?? data.music_info?.play ?? null,
    },
    isPhoto: photos.length > 0,
    photos,
    music: {
      title: data.music_info?.title ?? "Unknown",
      author: data.music_info?.author ?? "Unknown",
      url: data.music_info?.play ?? data.music ?? null,
    },
  };
}

export async function fetchTikTokFromTikwm(
  url: string,
  signal?: AbortSignal,
): Promise<TiktokVideoInfo> {
  let lastError = "TikTok providers did not return video information.";

  for (const apiUrl of TIKWM_APIS) {
    try {
      const response = await fetch(apiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ url, hd: "1" }),
        signal,
      });

      if (!response.ok) {
        lastError = `TikWM returned HTTP ${response.status}.`;
        await response.body?.cancel();
        continue;
      }

      const result: unknown = await response.json();
      if (!isTikwmResponse(result)) {
        lastError = "TikWM returned an invalid response.";
        continue;
      }
      if (result.code !== 0 || !result.data) {
        lastError = result.msg || "TikWM could not fetch this TikTok link.";
        continue;
      }

      return toVideoInfo(result.data);
    } catch (error) {
      if (signal?.aborted) throw error;
      lastError = error instanceof Error ? error.message : "TikWM request failed.";
    }
  }

  throw new Error(lastError);
}
