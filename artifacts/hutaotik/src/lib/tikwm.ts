import type { TiktokVideoInfo } from "@workspace/api-client-react";
import { createLinkedAbortController } from "@/lib/fetch-cache";

interface TikwmData {
  id?: string | number;
  aweme_id?: string | number;
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
  origin_cover?: string;
  duration?: number;
  images?: string[];
}

interface TikwmResponse {
  code: number;
  msg?: string;
  data?: TikwmData;
}

const TIKWM_APIS = ["https://www.tikwm.com/api/", "https://tikwm.com/api/"];
const TIKWM_CLIENT_TIMEOUT_MS = 25_000;

function isTikwmResponse(value: unknown): value is TikwmResponse {
  if (typeof value !== "object" || value === null || !("code" in value)) return false;
  return typeof value.code === "number";
}

export function normalizeTikwmMediaUrl(value?: string | null): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.toLowerCase() === "null") return null;
  if (trimmed.startsWith("//")) return `https:${trimmed}`;
  if (trimmed.startsWith("/")) return `https://www.tikwm.com${trimmed}`;
  return trimmed;
}

export function toTikwmVideoInfo(data: TikwmData, fallbackUrl = ""): TiktokVideoInfo {
  const photos = Array.isArray(data.images)
    ? data.images
        .map((image) => normalizeTikwmMediaUrl(image))
        .filter((image): image is string => Boolean(image))
    : [];
  const authorUsername = data.author?.unique_id || "unknown";
  const play = normalizeTikwmMediaUrl(data.play);
  const hdplay = normalizeTikwmMediaUrl(data.hdplay);
  const wmplay = normalizeTikwmMediaUrl(data.wmplay);
  const music = normalizeTikwmMediaUrl(data.music);
  const musicInfoPlay = normalizeTikwmMediaUrl(data.music_info?.play);
  const rawId = data.id ?? data.aweme_id;
  const fallbackMatch = fallbackUrl.match(/\/(?:video|photo)\/(\d+)/i);
  const resolvedId =
    rawId !== undefined && rawId !== null && String(rawId).trim() !== ""
      ? String(rawId).trim()
      : fallbackMatch?.[1] ?? `tt-${Date.now()}`;

  return {
    id: resolvedId,
    title: data.title || "TikTok video",
    author: data.author?.nickname || authorUsername,
    authorUsername,
    authorAvatar: normalizeTikwmMediaUrl(data.author?.avatar),
    thumbnail: normalizeTikwmMediaUrl(data.cover) ?? normalizeTikwmMediaUrl(data.origin_cover),
    duration: typeof data.duration === "number" ? data.duration : null,
    downloadUrls: {
      hd: hdplay ?? play ?? null,
      normal: play ?? null,
      low: wmplay ?? play ?? null,
      audio: music ?? musicInfoPlay ?? null,
    },
    isPhoto: photos.length > 0,
    photos,
    music: {
      title: data.music_info?.title || "Unknown",
      author: data.music_info?.author || "Unknown",
      url: musicInfoPlay ?? music ?? null,
    },
  };
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason ?? new DOMException("Aborted", "AbortError"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export async function fetchTikTokFromTikwm(
  url: string,
  signal?: AbortSignal,
): Promise<TiktokVideoInfo> {
  let lastError = "TikTok providers did not return video information.";

  for (let i = 0; i < TIKWM_APIS.length; i++) {
    const apiUrl = TIKWM_APIS[i];
    const { controller, cleanup } = createLinkedAbortController(signal, TIKWM_CLIENT_TIMEOUT_MS);
    try {
      const response = await fetch(apiUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json, text/plain, */*",
        },
        body: new URLSearchParams({ url, hd: "1" }),
        signal: controller.signal,
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
        if (i === 0 && /rate limit|request\s*\/\s*second|limit/i.test(lastError)) {
          await sleep(950, signal);
        }
        continue;
      }

      return toTikwmVideoInfo(result.data, url);
    } catch (error) {
      if (signal?.aborted) throw error;
      lastError = error instanceof Error ? error.message : "TikWM request failed.";
    } finally {
      cleanup();
    }
  }

  throw new Error(lastError);
}
