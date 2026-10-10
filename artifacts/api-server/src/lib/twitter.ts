import { execFile } from "child_process";
import { promisify } from "util";
import { unlink } from "fs";
import { tmpdir } from "os";
import { join, resolve } from "path";
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

export async function fetchTwitterInfo(url: string): Promise<TwitterInfo | null> {
  if (!isTwitterUrl(url)) return null;

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
