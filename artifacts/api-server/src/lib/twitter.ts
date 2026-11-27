import { execFile } from "child_process";
import { promisify } from "util";
import { createWriteStream, unlink } from "fs";
import { tmpdir } from "os";
import { join, resolve } from "path";
import { Readable } from "stream";
import { pipeline } from "stream/promises";
import { logger } from "./logger";

const execFileAsync = promisify(execFile);
const unlinkAsync = promisify(unlink);
const YT_DLP = process.env.YT_DLP_PATH ?? resolve(process.cwd(), "yt-dlp");
const FFMPEG = process.env.FFMPEG_PATH ?? "ffmpeg";

const TWITTER_HOSTS = new Set([
  "x.com",
  "www.x.com",
  "twitter.com",
  "www.twitter.com",
  "mobile.twitter.com",
]);

export interface TwitterFormat {
  height: number | null;
  qualityLabel: string;
}

export interface TwitterInfo {
  id: string;
  title: string;
  thumbnail: string | null;
  channelName: string;
  duration: number;
  isGif: boolean;
  formats: TwitterFormat[];
}

interface YtDlpFormat {
  height?: number;
  vcodec?: string;
  acodec?: string;
  ext?: string;
  url?: string;
}

interface YtDlpOutput {
  id?: string;
  title?: string;
  thumbnail?: string;
  uploader?: string;
  channel?: string;
  uploader_id?: string;
  duration?: number;
  formats?: YtDlpFormat[];
}

interface FxTwitterVariant {
  url?: string;
  bitrate?: number;
  container?: string;
  codec?: string;
}

interface FxTwitterVideo {
  type?: string;
  url?: string;
  thumbnail_url?: string;
  duration?: number;
  width?: number;
  height?: number;
  formats?: FxTwitterVariant[];
}

interface FxTwitterResponse {
  code?: number;
  message?: string;
  tweet?: {
    text?: string;
    author?: {
      name?: string;
      screen_name?: string;
    };
    media?: {
      videos?: FxTwitterVideo[];
      all?: FxTwitterVideo[];
    };
  };
}

interface FxTwitterDownload {
  height: number;
  bitrate: number;
  url: string;
}

export function isTwitterUrl(input: string): boolean {
  try {
    const url = new URL(input);
    return (
      (url.protocol === "https:" || url.protocol === "http:") &&
      TWITTER_HOSTS.has(url.hostname.toLowerCase())
    );
  } catch {
    return false;
  }
}

function isTwitterMediaUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "video.twimg.com";
  } catch {
    return false;
  }
}

function isMp4Variant(format: FxTwitterVariant): format is FxTwitterVariant & { url: string } {
  if (typeof format.url !== "string" || !isTwitterMediaUrl(format.url)) return false;
  if (format.container === "mp4") return true;
  try {
    return new URL(format.url).pathname.toLowerCase().endsWith(".mp4");
  } catch {
    return false;
  }
}

function getFxTwitterDownloads(video: FxTwitterVideo): FxTwitterDownload[] {
  const mp4Formats = (video.formats ?? []).filter(isMp4Variant);
  const h264Formats = mp4Formats.filter((format) => format.codec === "h264");
  const sourceFormats = h264Formats.length > 0 ? h264Formats : mp4Formats;

  const downloads = sourceFormats
    .map((format) => {
      const resolution = new URL(format.url).pathname.match(/\/(\d{2,4})x(\d{2,4})\//);
      const height = resolution
        ? Number(resolution[2])
        : (video.height && video.height > 0 ? video.height : 480);
      return {
        height,
        bitrate: format.bitrate ?? 0,
        url: format.url,
      };
    })
    .filter((format) => format.height > 0)
    .sort((a, b) => a.height - b.height || a.bitrate - b.bitrate);

  // Twitter GIFs (type === "gif") often only populate `video.url` (e.g. /tweet_video/*.mp4)
  if (
    downloads.length === 0 &&
    typeof video.url === "string" &&
    isTwitterMediaUrl(video.url) &&
    new URL(video.url).pathname.toLowerCase().endsWith(".mp4")
  ) {
    downloads.push({
      height: video.height && video.height > 0 ? video.height : 480,
      bitrate: 0,
      url: video.url,
    });
  }

  return downloads;
}

function isFxVideoGif(video: FxTwitterVideo, downloads: FxTwitterDownload[]): boolean {
  if (video.type?.toLowerCase() === "gif") return true;
  if (typeof video.url === "string" && video.url.includes("/tweet_video/")) return true;
  return downloads.some((download) => download.url.includes("/tweet_video/"));
}

type FxTwitterFetchResult = {
  info: TwitterInfo;
  videos: Array<{ video: FxTwitterVideo; downloads: FxTwitterDownload[]; isGif: boolean }>;
};

const TWITTER_CACHE_TTL_MS = 300_000;
const fxTwitterCache = new Map<string, { expiresAt: number; result: FxTwitterFetchResult }>();
const fxTwitterInFlight = new Map<string, Promise<FxTwitterFetchResult | null>>();

async function fetchFxTwitterVideo(url: string): Promise<FxTwitterFetchResult | null> {
  const statusId = new URL(url).pathname.match(/\/status(?:es)?\/(\d+)/i)?.[1];
  if (!statusId) return null;

  const cached = fxTwitterCache.get(statusId);
  if (cached && cached.expiresAt > Date.now()) return cached.result;

  const existing = fxTwitterInFlight.get(statusId);
  if (existing) return existing;

  const task = (async (): Promise<FxTwitterFetchResult | null> => {
    try {
      const response = await fetch(`https://api.fxtwitter.com/i/status/${statusId}`, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(8_000),
      });
      if (!response.ok) {
        await response.body?.cancel();
        logger.warn({ status: response.status, statusId }, "twitter: FXTwitter metadata request failed");
        return null;
      }

      const result = await response.json() as FxTwitterResponse;
      if (result.code !== 200 || !result.tweet) return null;

      const rawMedia =
        result.tweet.media?.videos && result.tweet.media.videos.length > 0
          ? result.tweet.media.videos
          : (result.tweet.media?.all ?? []).filter(
              (item) => item.type === "video" || item.type === "gif",
            );

      const videos = rawMedia
        .map((video) => {
          const downloads = getFxTwitterDownloads(video);
          return { video, downloads, isGif: isFxVideoGif(video, downloads) };
        })
        .filter(({ downloads }) => downloads.length > 0);
      if (videos.length === 0) return null;

      const primaryVideo = videos[0];
      const heights = [...new Set(primaryVideo.downloads.map((format) => format.height))]
        .sort((a, b) => b - a);
      const resolved: FxTwitterFetchResult = {
        info: {
          id: statusId,
          title: result.tweet.text?.trim() || (primaryVideo.isGif ? "X GIF" : "X Video"),
          thumbnail: primaryVideo.video.thumbnail_url ?? null,
          channelName: result.tweet.author?.name ??
            result.tweet.author?.screen_name ??
            "X Creator",
          duration: primaryVideo.video.duration ?? 0,
          isGif: primaryVideo.isGif,
          formats: heights.map((height) => ({ height, qualityLabel: `${height}p` })),
        },
        videos,
      };
      if (fxTwitterCache.size >= 250) {
        const oldest = fxTwitterCache.keys().next().value;
        if (oldest) fxTwitterCache.delete(oldest);
      }
      fxTwitterCache.set(statusId, { expiresAt: Date.now() + TWITTER_CACHE_TTL_MS, result: resolved });
      return resolved;
    } catch (err) {
      logger.warn({ err, statusId }, "twitter: FXTwitter metadata request failed");
      return null;
    }
  })();

  fxTwitterInFlight.set(statusId, task);
  try {
    return await task;
  } finally {
    fxTwitterInFlight.delete(statusId);
  }
}

export async function fetchTwitterInfo(url: string): Promise<TwitterInfo | null> {
  if (!isTwitterUrl(url)) return null;

  const fxTwitterResult = await fetchFxTwitterVideo(url);
  if (fxTwitterResult) return fxTwitterResult.info;

  try {
    const { stdout } = await execFileAsync(
      YT_DLP,
      [
        "--dump-single-json",
        "--no-playlist",
        "--no-warnings",
        "--no-check-certificates",
        "--socket-timeout", "12",
        url,
      ],
      { timeout: 30_000, maxBuffer: 5 * 1024 * 1024 }
    );

    const data = JSON.parse(stdout) as YtDlpOutput;
    const mp4Formats = (data.formats ?? []).filter((format) => format.ext === "mp4");
    const h264Formats = mp4Formats.filter(
      (format) => format.vcodec?.startsWith("avc1") || format.vcodec?.startsWith("h264"),
    );
    const chosenFormats = h264Formats.length > 0 ? h264Formats : mp4Formats;

    const isGif = chosenFormats.some(
      (format) => typeof format.url === "string" && format.url.includes("/tweet_video/"),
    );

    const heights = [...new Set(
      chosenFormats
        .map((format) => format.height)
        .filter((height): height is number =>
          typeof height === "number" && Number.isInteger(height) && height > 0
        )
    )].sort((a, b) => b - a);

    const formats: TwitterFormat[] =
      heights.length > 0
        ? heights.map((height) => ({ height, qualityLabel: `${height}p` }))
        : (chosenFormats.length > 0 ? [{ height: null, qualityLabel: isGif ? "GIF" : "Best" }] : []);

    return {
      id: data.id ?? "",
      title: data.title ?? (isGif ? "X GIF" : "X Video"),
      thumbnail: data.thumbnail ?? null,
      channelName: data.channel ?? data.uploader ?? data.uploader_id ?? "X Creator",
      duration: data.duration ?? 0,
      isGif,
      formats,
    };
  } catch (err) {
    logger.error({ err, url }, "twitter: fetchInfo error");
    return null;
  }
}

export async function downloadTwitterVideo(url: string, height: number | null): Promise<string> {
  if (!isTwitterUrl(url)) {
    throw new Error("Only X/Twitter video URLs are supported.");
  }

  const fxTwitterResult = await fetchFxTwitterVideo(url);
  if (fxTwitterResult) {
    const candidates = fxTwitterResult.videos.flatMap(({ downloads }) => downloads);
    const eligibleFormats = height === null
      ? candidates
      : candidates.filter((format) => format.height <= height);
    const selected = (eligibleFormats.length > 0 ? eligibleFormats : candidates)
      .sort((a, b) => b.height - a.height || b.bitrate - a.bitrate)[0];
    if (selected) {
      const tmpPath = join(
        tmpdir(),
        `twitter_${Date.now()}_${Math.random().toString(36).slice(2)}.mp4`
      );
      try {
        const response = await fetch(selected.url, {
          headers: { "User-Agent": "Mozilla/5.0 (compatible; HutaoTik/1.0)" },
          signal: AbortSignal.timeout(120_000),
        });
        if (!response.ok || !response.body) {
          await response.body?.cancel();
          throw new Error(`X video provider returned HTTP ${response.status}.`);
        }
        const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
        if (!contentType.includes("video/mp4") && !contentType.includes("application/octet-stream")) {
          await response.body.cancel();
          throw new Error("X video provider returned a non-MP4 resource.");
        }
        await pipeline(
          Readable.fromWeb(response.body as import("stream/web").ReadableStream),
          createWriteStream(tmpPath)
        );
        return tmpPath;
      } catch (err) {
        await unlinkAsync(tmpPath).catch(() => {});
        logger.warn({ err, url, height }, "twitter: FXTwitter media download failed; trying yt-dlp");
      }
    }
  }

  const formatSelector = height === null
    ? "best[ext=mp4][vcodec^=avc1]/best[ext=mp4][vcodec^=h264]/best[ext=mp4]/best"
    : `best[height<=${height}][ext=mp4][vcodec^=avc1]/best[height<=${height}][ext=mp4][vcodec^=h264]/best[height<=${height}][ext=mp4]/best[ext=mp4]`;
  const tmpPath = join(
    tmpdir(),
    `twitter_${Date.now()}_${Math.random().toString(36).slice(2)}.mp4`
  );

  try {
    await execFileAsync(
      YT_DLP,
      [
        "-f", formatSelector,
        "--merge-output-format", "mp4",
        "--no-playlist",
        "--no-warnings",
        "-o", tmpPath,
        "--remux-video", "mp4",
        url,
      ],
      { timeout: 600_000 }
    );
    return tmpPath;
  } catch (err) {
    await unlinkAsync(tmpPath).catch(() => {});
    logger.error({ err, url, height }, "twitter: download error");
    throw err;
  }
}

export async function downloadTwitterGif(
  url: string,
  height: number | null,
  maxSeconds = 15,
): Promise<string> {
  const mp4Path = await downloadTwitterVideo(url, height);
  const gifPath = join(
    tmpdir(),
    `twitter_gif_${Date.now()}_${Math.random().toString(36).slice(2)}.gif`,
  );
  const clampedSeconds = Math.max(1, Math.min(30, Math.round(maxSeconds)));

  try {
    await execFileAsync(
      FFMPEG,
      [
        "-y",
        "-i", mp4Path,
        "-t", String(clampedSeconds),
        "-vf",
        "fps=15,scale='min(480,iw)':-2:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=256:stats_mode=diff[p];[s1][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle",
        "-loop", "0",
        gifPath,
      ],
      { timeout: 180_000, maxBuffer: 10 * 1024 * 1024 },
    );
    return gifPath;
  } catch (err) {
    await unlinkAsync(gifPath).catch(() => {});
    logger.error({ err, url }, "twitter: gif conversion error");
    throw new Error("Could not convert this X post to GIF on the server.");
  } finally {
    await unlinkAsync(mp4Path).catch(() => {});
  }
}
