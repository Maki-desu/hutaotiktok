import { execFile } from "child_process";
import { existsSync } from "fs";
import { promisify } from "util";
import { resolve } from "path";
import { Router, type IRouter } from "express";
import { FetchTiktokVideoBody } from "@workspace/api-zod";
import { logger } from "../lib/logger";

const router: IRouter = Router();
const execFileAsync = promisify(execFile);
const YT_DLP = process.env.YT_DLP_PATH ?? [
  resolve(process.cwd(), "yt-dlp"),
  resolve(process.cwd(), "../../yt-dlp"),
].find(existsSync) ?? resolve(process.cwd(), "yt-dlp");

const TIKWM_APIS = ["https://www.tikwm.com/api/", "https://tikwm.com/api/"];

const rateLimitMap = new Map<string, number>();
const RATE_LIMIT_MS = 3000;
const TIKWM_TIMEOUT_MS = 6_000;
const TIKWM_MIN_INTERVAL_MS = 1100;
const TIKWM_CACHE_TTL_MS = 60_000;

interface TikwmApiResponse {
  code: number;
  msg: string;
  data?: TikwmFullData;
}

class TikwmProviderError extends Error {
  constructor(readonly status: number, readonly host: string) {
    super(`TikWM host ${host} returned HTTP ${status}`);
    this.name = "TikwmProviderError";
  }
}

function isTikTokUrl(value: string): boolean {
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase();
    return (url.protocol === "https:" || url.protocol === "http:") &&
      (hostname === "tiktok.com" || hostname.endsWith(".tiktok.com"));
  } catch {
    return false;
  }
}

interface TikwmFullData {
  id?: string;
  title?: string;
  play?: string;
  hdplay?: string;
  wmplay?: string;
  music?: string;
  music_info?: {
    id?: string;
    title?: string;
    play?: string;
    cover?: string;
    author?: string;
    original?: boolean;
    duration?: number;
    album?: string;
  };
  author?: {
    id?: string;
    unique_id?: string;
    nickname?: string;
    avatar?: string;
    signature?: string;
    verified?: boolean;
    followers?: number;
    following?: number;
    likes?: number;
    video_count?: number;
  };
  cover?: string;
  origin_cover?: string;
  duration?: number;
  images?: string[];
  play_count?: number;
  digg_count?: number;
  comment_count?: number;
  share_count?: number;
  download_count?: number;
  create_time?: number;
  size?: number;
  hd_size?: number;
  wm_size?: number;
  ratio?: string;
  region?: string;
  format?: string;
  width?: number;
  height?: number;
}

interface YtDlpFormat {
  url?: string;
  height?: number;
  vcodec?: string;
  acodec?: string;
  tbr?: number;
}

interface YtDlpTikTokData {
  id?: string;
  title?: string;
  description?: string;
  thumbnail?: string;
  uploader?: string;
  uploader_id?: string;
  uploader_url?: string;
  channel_follower_count?: number;
  duration?: number;
  timestamp?: number;
  view_count?: number;
  like_count?: number;
  comment_count?: number;
  repost_count?: number;
  formats?: YtDlpFormat[];
  url?: string;
}

const tikwmCache = new Map<string, { expiresAt: number; response: TikwmApiResponse }>();
const tikwmRequests = new Map<string, Promise<TikwmApiResponse>>();
let tikwmRequestQueue: Promise<void> = Promise.resolve();
let lastTikwmRequestAt = 0;

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function requestTikwm(url: string, apiUrl: string): Promise<Response> {
  const request = tikwmRequestQueue.then(async () => {
    const delay = lastTikwmRequestAt + TIKWM_MIN_INTERVAL_MS - Date.now();
    if (delay > 0) await wait(delay);
    lastTikwmRequestAt = Date.now();
    const origin = new URL(apiUrl).origin;

    return fetch(apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        "Accept": "application/json, text/plain, */*",
        "Origin": origin,
        "Referer": `${origin}/`,
      },
      body: new URLSearchParams({ url, hd: "1" }),
      signal: AbortSignal.timeout(TIKWM_TIMEOUT_MS),
    });
  });

  tikwmRequestQueue = request.then(() => undefined, () => undefined);
  return request;
}

async function fetchTikwmData(url: string): Promise<TikwmApiResponse> {
  const cached = tikwmCache.get(url);
  if (cached && cached.expiresAt > Date.now()) return cached.response;

  const existingRequest = tikwmRequests.get(url);
  if (existingRequest) return existingRequest;

  const request = (async () => {
    let lastResult: TikwmApiResponse | null = null;
    let lastError: unknown;

    for (let attempt = 0; attempt < 2; attempt++) {
      const apiUrl = TIKWM_APIS[attempt];
      try {
        const response = await requestTikwm(url, apiUrl);
        if (!response.ok) {
          await response.body?.cancel();
          throw new TikwmProviderError(response.status, new URL(apiUrl).host);
        }

        const result = await response.json() as TikwmApiResponse;
        if (result.code === 0 && result.data) {
          if (tikwmCache.size >= 500) {
            const oldestKey = tikwmCache.keys().next().value;
            if (oldestKey) tikwmCache.delete(oldestKey);
          }
          tikwmCache.set(url, { expiresAt: Date.now() + TIKWM_CACHE_TTL_MS, response: result });
          return result;
        }

        lastResult = result;
        if (attempt === 0) {
          logger.warn(
            { code: result.code, msg: result.msg, host: new URL(apiUrl).host },
            "TikTok provider returned an error; trying backup"
          );
          if (/rate limit|request\s*\/\s*second/i.test(result.msg)) {
            await wait(TIKWM_MIN_INTERVAL_MS);
          }
        }
      } catch (err) {
        lastError = err;
        if (attempt === 1) {
          if (lastResult) return lastResult;
          throw err;
        }
        logger.warn(
          { err, host: new URL(apiUrl).host },
          "TikTok provider request failed; trying backup"
        );
      }
    }

    if (lastResult) return lastResult;
    if (lastError) throw lastError;
    throw new Error("TikWM request retries were exhausted.");
  })();

  tikwmRequests.set(url, request);
  try {
    return await request;
  } finally {
    tikwmRequests.delete(url);
  }
}

async function fetchTikTokWithYtDlp(url: string): Promise<TikwmApiResponse | null> {
  try {
    const { stdout } = await execFileAsync(
      YT_DLP,
      ["--dump-single-json", "--no-playlist", "--no-warnings", "--socket-timeout", "12", url],
      { timeout: 18_000, maxBuffer: 5 * 1024 * 1024 }
    );
    const video = JSON.parse(stdout) as YtDlpTikTokData;
    const hasAudio = (format: YtDlpFormat) =>
      typeof format.acodec === "string" && format.acodec !== "none";
    const videoFormats = (video.formats ?? [])
      .filter((format) => format.url && format.vcodec && format.vcodec !== "none")
      .sort((a, b) =>
        (b.height ?? 0) - (a.height ?? 0) ||
        Number(hasAudio(b)) - Number(hasAudio(a)) ||
        (b.tbr ?? 0) - (a.tbr ?? 0)
      );
    const hdUrl = videoFormats[0]?.url ?? video.url;
    const normalUrl = videoFormats.find(hasAudio)?.url ?? hdUrl;

    if (!video.id || !hdUrl) return null;

    const authorName = video.uploader ?? video.uploader_id ?? "Unknown";
    const authorUsername = video.uploader_id ??
      video.uploader_url?.match(/@([^/]+)/)?.[1] ??
      "unknown";

    return {
      code: 0,
      msg: "ok",
      data: {
        id: video.id,
        title: video.title ?? video.description ?? "Untitled",
        play: normalUrl,
        hdplay: hdUrl,
        cover: video.thumbnail,
        duration: video.duration,
        create_time: video.timestamp,
        play_count: video.view_count,
        digg_count: video.like_count,
        comment_count: video.comment_count,
        share_count: video.repost_count,
        author: {
          unique_id: authorUsername,
          nickname: authorName,
          followers: video.channel_follower_count,
        },
      },
    };
  } catch (err) {
    logger.error({ err }, "TikTok yt-dlp fallback failed");
    return null;
  }
}

async function fetchTikTokData(url: string): Promise<TikwmApiResponse> {
  let tikwmResult: TikwmApiResponse | null = null;
  let tikwmError: unknown;

  try {
    tikwmResult = await fetchTikwmData(url);
    if (tikwmResult.code === 0 && tikwmResult.data) return tikwmResult;
    logger.warn(
      { code: tikwmResult.code, msg: tikwmResult.msg },
      "TikTok TikWM lookup failed; trying yt-dlp fallback"
    );
  } catch (err) {
    tikwmError = err;
    logger.warn({ err }, "TikTok TikWM lookup failed; trying yt-dlp fallback");
  }

  const fallback = await fetchTikTokWithYtDlp(url);
  if (fallback) return fallback;
  if (tikwmResult) return tikwmResult;
  throw tikwmError;
}

router.post("/tiktok/analyze", async (req, res): Promise<void> => {
  const parsed = FetchTiktokVideoBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request body" });
    return;
  }

  const { url } = parsed.data;

  if (!isTikTokUrl(url)) {
    res.status(400).json({ error: "Invalid TikTok URL. Please paste a valid TikTok link." });
    return;
  }

  const ip = (req.headers["x-forwarded-for"] as string) || req.socket.remoteAddress || "unknown";
  const lastRequest = rateLimitMap.get(ip) || 0;
  const now = Date.now();
  if (now - lastRequest < RATE_LIMIT_MS) {
    res.status(429).json({ error: `Please wait ${Math.ceil((RATE_LIMIT_MS - (now - lastRequest)) / 1000)} seconds.` });
    return;
  }
  rateLimitMap.set(ip, now);

  try {
    const data = await fetchTikTokData(url);

    if (data.code !== 0 || !data.data) {
      if (/rate limit|request\s*\/\s*second/i.test(data.msg)) {
        res.setHeader("Retry-After", "2");
        res.status(429).json({ error: data.msg });
        return;
      }
      res.status(400).json({ error: data.msg || "Could not fetch video. The link may be invalid or private." });
      return;
    }

    const d = data.data;
    const isPhoto = !!(d.images && d.images.length > 0);

    res.json({
      id: d.id ?? "",
      caption: d.title ?? "Untitled",
      createTime: d.create_time ?? null,
      duration: d.duration ?? null,
      region: d.region ?? null,
      thumbnail: d.cover ?? d.origin_cover ?? null,
      isPhoto,
      photos: d.images ?? [],
      stats: {
        views: d.play_count ?? null,
        likes: d.digg_count ?? null,
        comments: d.comment_count ?? null,
        shares: d.share_count ?? null,
        downloads: d.download_count ?? null,
      },
      videoMeta: {
        ratio: d.ratio ?? null,
        hdSize: d.hd_size ?? null,
        normalSize: d.size ?? null,
        format: d.format ?? null,
        width: d.width ?? null,
        height: d.height ?? null,
      },
      author: {
        username: d.author?.unique_id ?? "unknown",
        displayName: d.author?.nickname ?? d.author?.unique_id ?? "Unknown",
        avatar: d.author?.avatar ?? null,
        bio: d.author?.signature ?? null,
        verified: d.author?.verified ?? false,
        followers: d.author?.followers ?? null,
        following: d.author?.following ?? null,
        likes: d.author?.likes ?? null,
        videoCount: d.author?.video_count ?? null,
      },
      music: {
        title: d.music_info?.title ?? "Unknown",
        author: d.music_info?.author ?? "Unknown",
        url: d.music_info?.play ?? null,
        cover: d.music_info?.cover ?? null,
        duration: d.music_info?.duration ?? null,
        album: d.music_info?.album ?? null,
        original: d.music_info?.original ?? null,
      },
      downloadUrls: {
        hd: d.hdplay ?? d.play ?? null,
        normal: d.play ?? null,
        low: d.wmplay ?? d.play ?? null,
        audio: d.music ?? null,
      },
    });
  } catch (err) {
    req.log.error({ err }, "TikTok analyze error");
    if (err instanceof TikwmProviderError) {
      req.log.warn({ status: err.status, host: err.host }, "TikTok analyze providers failed");
      res.status(502).json({ error: "TikTok service is temporarily unavailable. Please try again shortly." });
      return;
    }
    if (err instanceof Error && err.name === "TimeoutError") {
      res.status(504).json({ error: "TikTok lookup timed out. Please try again." });
      return;
    }
    res.status(500).json({ error: "Failed to connect to TikTok service. Please try again." });
  }
});

router.post("/tiktok/fetch", async (req, res): Promise<void> => {
  const parsed = FetchTiktokVideoBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request body" });
    return;
  }

  const { url } = parsed.data;

  if (!isTikTokUrl(url)) {
    res.status(400).json({ error: "Invalid TikTok URL. Please paste a valid TikTok link." });
    return;
  }

  const ip = (req.headers["x-forwarded-for"] as string) || req.socket.remoteAddress || "unknown";
  const lastRequest = rateLimitMap.get(ip) || 0;
  const now = Date.now();
  if (now - lastRequest < RATE_LIMIT_MS) {
    res.status(429).json({ error: `Please wait ${Math.ceil((RATE_LIMIT_MS - (now - lastRequest)) / 1000)} seconds before fetching again.` });
    return;
  }
  rateLimitMap.set(ip, now);

  try {
    const data = await fetchTikTokData(url);

    if (data.code !== 0 || !data.data) {
      if (/rate limit|request\s*\/\s*second/i.test(data.msg)) {
        res.setHeader("Retry-After", "2");
        res.status(429).json({ error: data.msg });
        return;
      }
      res.status(400).json({ error: data.msg || "Could not fetch video. The link may be invalid or private." });
      return;
    }

    const d = data.data;
    const isPhoto = !!(d.images && d.images.length > 0);

    res.json({
      id: d.id,
      title: d.title || "Untitled",
      author: d.author?.nickname || d.author?.unique_id || "Unknown",
      authorUsername: d.author?.unique_id ?? "unknown",
      authorAvatar: d.author?.avatar || null,
      thumbnail: d.cover || null,
      duration: d.duration || null,
      downloadUrls: {
        hd: d.hdplay || d.play || null,
        normal: d.play || null,
        low: d.wmplay || d.play || null,
        audio: d.music || null,
      },
      isPhoto,
      photos: d.images || [],
      music: {
        title: d.music_info?.title || "Unknown",
        author: d.music_info?.author || "Unknown",
        url: d.music_info?.play || null,
      },
    });
  } catch (err) {
    req.log.error({ err }, "TikTok fetch error");
    if (err instanceof TikwmProviderError) {
      req.log.warn({ status: err.status, host: err.host }, "TikTok fetch providers failed");
      res.status(502).json({ error: "TikTok service is temporarily unavailable. Please try again shortly." });
      return;
    }
    if (err instanceof Error && err.name === "TimeoutError") {
      res.status(504).json({ error: "TikTok lookup timed out. Please try again." });
      return;
    }
    res.status(500).json({ error: "Failed to connect to TikTok service. Please try again." });
  }
});

export default router;
