import { execFile } from "child_process";
import { promisify } from "util";
import { createReadStream, unlink, stat } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { resolve } from "path";
import { logger } from "./logger";

const execFileAsync = promisify(execFile);
const unlinkAsync = promisify(unlink);
const statAsync = promisify(stat);

// Use the bundled up-to-date yt-dlp binary
const YT_DLP = process.env.YT_DLP_PATH ?? resolve(process.cwd(), "yt-dlp");
const YOUTUBE_HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "music.youtube.com",
  "youtube-nocookie.com",
  "www.youtube-nocookie.com",
  "youtu.be",
]);

export function isYouTubeUrl(input: string): boolean {
  try {
    const url = new URL(input);
    return (
      (url.protocol === "https:" || url.protocol === "http:") &&
      YOUTUBE_HOSTS.has(url.hostname.toLowerCase())
    );
  } catch {
    return false;
  }
}

export interface YouTubeFormat {
  formatStr: string;    // yt-dlp format selector e.g. "18" or "137+140"
  qualityLabel: string;
  needsMux: boolean;    // true = needs temp file muxing
}

export interface YouTubeInfo {
  id: string;
  title: string;
  thumbnail: string | null;
  channelName: string;
  duration: number;
  formats: YouTubeFormat[];
}

interface YtDlpFormat {
  format_id?: string;
  height?: number;
  vcodec?: string;
  acodec?: string;
  ext?: string;
  tbr?: number;
}

interface YtDlpOutput {
  id?: string;
  title?: string;
  thumbnail?: string;
  uploader?: string;
  channel?: string;
  duration?: number;
  formats?: YtDlpFormat[];
}

const YOUTUBE_INFO_CACHE_TTL_MS = 300_000;
const youtubeInfoCache = new Map<string, { expiresAt: number; info: YouTubeInfo }>();
const youtubeInfoInFlight = new Map<string, Promise<YouTubeInfo | null>>();

export async function fetchYouTubeInfo(url: string): Promise<YouTubeInfo | null> {
  if (!isYouTubeUrl(url)) return null;

  const cacheKey = url.trim();
  const cached = youtubeInfoCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.info;

  const existing = youtubeInfoInFlight.get(cacheKey);
  if (existing) return existing;

  const task = (async (): Promise<YouTubeInfo | null> => {
    try {
      const { stdout } = await execFileAsync(
        YT_DLP,
        [
          "--dump-json",
          "--no-playlist",
          "--no-warnings",
          "--no-check-certificates",
          "--extractor-args", "youtube:skip=translated_subs",
          "--socket-timeout", "12",
          url,
        ],
        { timeout: 25_000, maxBuffer: 8 * 1024 * 1024 }
      );

      const data = JSON.parse(stdout) as YtDlpOutput;
      const allFormats = data.formats ?? [];

      // Prefer AAC audio so high-resolution video-only streams can be muxed into MP4.
      const bestAudio = allFormats
        .filter((f) => f.vcodec === "none" && f.acodec?.startsWith("mp4a") && f.ext === "m4a")
        .sort((a, b) => (b.tbr ?? 0) - (a.tbr ?? 0))[0];
      const audioId = bestAudio?.format_id;
      const candidates = allFormats
        .filter((f) =>
          typeof f.format_id === "string" &&
          typeof f.vcodec === "string" &&
          f.vcodec !== "none" &&
          typeof f.acodec === "string" &&
          (f.ext === "mp4" || f.ext === "webm") &&
          (f.acodec !== "none" || audioId !== undefined)
        )
        .sort((a, b) =>
          (b.height ?? 0) - (a.height ?? 0) ||
          (b.tbr ?? 0) - (a.tbr ?? 0) ||
          Number(b.acodec !== "none") - Number(a.acodec !== "none")
        );

      const seenHeights = new Set<number>();
      const formats: YouTubeFormat[] = [];

      for (const f of candidates) {
        const h = f.height ?? 0;
        if (h <= 0 || seenHeights.has(h) || !f.format_id) continue;
        const needsMux = f.acodec === "none";
        seenHeights.add(h);
        formats.push({
          formatStr: needsMux ? `${f.format_id}+${audioId}` : f.format_id,
          qualityLabel: `${h}p`,
          needsMux,
        });
      }

      const result: YouTubeInfo = {
        id: data.id ?? "",
        title: data.title ?? "YouTube Video",
        thumbnail: data.thumbnail ?? null,
        channelName: data.channel ?? data.uploader ?? "Unknown",
        duration: data.duration ?? 0,
        formats,
      };
      if (youtubeInfoCache.size >= 200) {
        const oldest = youtubeInfoCache.keys().next().value;
        if (oldest) youtubeInfoCache.delete(oldest);
      }
      youtubeInfoCache.set(cacheKey, { expiresAt: Date.now() + YOUTUBE_INFO_CACHE_TTL_MS, info: result });
      return result;
    } catch (err) {
      logger.error({ err, url }, "youtube: fetchInfo error");
      return null;
    }
  })();

  youtubeInfoInFlight.set(cacheKey, task);
  try {
    return await task;
  } finally {
    youtubeInfoInFlight.delete(cacheKey);
  }
}

/**
 * Download and optionally mux the selected format to a temp file.
 * Returns the temp file path; caller must delete it after streaming.
 */
export async function downloadYouTubeMuxed(url: string, formatStr: string): Promise<string> {
  if (!isYouTubeUrl(url)) {
    throw new Error("Only YouTube video URLs are supported.");
  }
  if (!/^(?:\d+|bestaudio)(?:\+(?:\d+|bestaudio))?$/.test(formatStr)) {
    throw new Error("The requested YouTube format is invalid.");
  }

  const tmpPath = join(
    tmpdir(),
    `yt_${Date.now()}_${Math.random().toString(36).slice(2)}.mp4`
  );
  await execFileAsync(
    YT_DLP,
    [
      "-f", formatStr,
      "--merge-output-format", "mp4",
      "--remux-video", "mp4",
      "--no-playlist",
      "--no-warnings",
      "-o", tmpPath,
      url,
    ],
    { timeout: 600_000 }
  ).catch(async (err: unknown) => {
    await unlinkAsync(tmpPath).catch(() => {});
    throw err;
  });
  return tmpPath;
}

export async function streamTempFile(tmpPath: string, res: import("express").Response): Promise<void> {
  try {
    const { size } = await statAsync(tmpPath);
    if (size <= 0) throw new Error("The downloaded media file is empty.");
    res.setHeader("Content-Length", size);
    await new Promise<void>((resolve, reject) => {
      const rs = createReadStream(tmpPath);
      rs.pipe(res);
      rs.on("end", resolve);
      rs.on("error", reject);
    });
  } finally {
    await unlinkAsync(tmpPath).catch(() => {});
  }
}

/**
 * Returns two spawned processes: ytdlp (raw audio → stdout) and ffmpeg (mp3 → stdout).
 * Pipe: ytdlpProc.stdout → ffmpegProc.stdin → response.
 */
export async function downloadYouTubeAudio(url: string): Promise<string> {
  if (!isYouTubeUrl(url)) {
    throw new Error("Only YouTube video URLs are supported.");
  }

  const tmpPath = join(
    tmpdir(),
    `yt_audio_${Date.now()}_${Math.random().toString(36).slice(2)}.mp3`
  );

  try {
    await execFileAsync(
      YT_DLP,
      [
        "-f", "bestaudio/best",
        "--extract-audio",
        "--audio-format", "mp3",
        "--audio-quality", "192K",
        "--no-playlist",
        "--no-warnings",
        "-o", tmpPath,
        url,
      ],
      { timeout: 600_000 }
    );
    return tmpPath;
  } catch (err) {
    await unlinkAsync(tmpPath).catch(() => {});
    logger.error({ err, url }, "youtube: audio download error");
    throw err;
  }
}
