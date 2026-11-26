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
  formats: TwitterFormat[];
}

interface YtDlpFormat {
  height?: number;
  vcodec?: string;
  ext?: string;
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

function getFxTwitterDownloads(video: FxTwitterVideo): FxTwitterDownload[] {
  return (video.formats ?? [])
    .filter((format): format is FxTwitterVariant & { url: string } =>
      format.container === "mp4" &&
      format.codec === "h264" &&
      typeof format.url === "string" &&
      isTwitterMediaUrl(format.url)
    )
    .map((format) => {
      const resolution = new URL(format.url).pathname.match(/\/(\d{2,4})x(\d{2,4})\//);
      return {
        height: resolution ? Number(resolution[2]) : video.height ?? 0,
        bitrate: format.bitrate ?? 0,
        url: format.url,
      };
    })
    .filter((format) => format.height > 0)
    .sort((a, b) => a.height - b.height || a.bitrate - b.bitrate);
}

function isTwitterMediaUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "video.twimg.com";
  } catch {
    return false;
  }
}

async function fetchFxTwitterVideo(url: string): Promise<{
  info: TwitterInfo;
  videos: Array<{ video: FxTwitterVideo; downloads: FxTwitterDownload[] }>;
} | null> {
  const statusId = new URL(url).pathname.match(/\/status(?:es)?\/(\d+)/i)?.[1];
  if (!statusId) return null;

  try {
    const response = await fetch(`https://api.fxtwitter.com/i/status/${statusId}`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) {
      await response.body?.cancel();
      logger.warn({ status: response.status, statusId }, "twitter: FXTwitter metadata request failed");
      return null;
    }

    const result = await response.json() as FxTwitterResponse;
    if (result.code !== 200 || !result.tweet) return null;

    const videos = (result.tweet.media?.videos ?? [])
      .map((video) => ({ video, downloads: getFxTwitterDownloads(video) }))
      .filter(({ downloads }) => downloads.length > 0);
    if (videos.length === 0) return null;

    const primaryVideo = videos[0];
    const heights = [...new Set(primaryVideo.downloads.map((format) => format.height))]
      .sort((a, b) => b - a);
    return {
      info: {
        id: statusId,
        title: result.tweet.text?.trim() || "X Video",
        thumbnail: primaryVideo.video.thumbnail_url ?? null,
        channelName: result.tweet.author?.name ??
          result.tweet.author?.screen_name ??
          "X Creator",
        duration: primaryVideo.video.duration ?? 0,
        formats: heights.map((height) => ({ height, qualityLabel: `${height}p` })),
      },
      videos,
    };
  } catch (err) {
    logger.warn({ err, statusId }, "twitter: FXTwitter metadata request failed");
    return null;
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
        "--socket-timeout", "20",
        url,
      ],
      { timeout: 45_000, maxBuffer: 5 * 1024 * 1024 }
    );

    const data = JSON.parse(stdout) as YtDlpOutput;
    const heights = [...new Set(
      (data.formats ?? [])
        .filter((format) =>
          format.ext === "mp4" &&
          (format.vcodec?.startsWith("avc1") || format.vcodec?.startsWith("h264"))
        )
        .map((format) => format.height)
        .filter((height): height is number =>
          typeof height === "number" && Number.isInteger(height) && height > 0
        )
    )].sort((a, b) => b - a);

    const formats: TwitterFormat[] = heights.map((height) => ({
      height,
      qualityLabel: `${height}p`,
    }));

    return {
      id: data.id ?? "",
      title: data.title ?? "X Video",
      thumbnail: data.thumbnail ?? null,
      channelName: data.channel ?? data.uploader ?? data.uploader_id ?? "X Creator",
      duration: data.duration ?? 0,
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
        if (!response.headers.get("content-type")?.toLowerCase().includes("video/mp4")) {
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
    ? "best[ext=mp4][vcodec^=avc1]/best[ext=mp4][vcodec^=h264]"
    : `best[height<=${height}][ext=mp4][vcodec^=avc1]/best[height<=${height}][ext=mp4][vcodec^=h264]`;
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
