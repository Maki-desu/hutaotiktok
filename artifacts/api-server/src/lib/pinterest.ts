import { execFile } from "child_process";
import { promisify } from "util";
import { unlink } from "fs";
import { tmpdir } from "os";
import { join, resolve } from "path";
import { logger } from "./logger";

const execFileAsync = promisify(execFile);
const unlinkAsync = promisify(unlink);
const YT_DLP = process.env.YT_DLP_PATH ?? resolve(process.cwd(), "yt-dlp");
const VIDEO_HOSTS = {
  pinterest: new Set(["pinterest.com", "pin.it"]),
  instagram: new Set(["instagram.com", "instagr.am"]),
} as const;
type SocialVideoPlatform = keyof typeof VIDEO_HOSTS;

interface YtDlpFormat {
  height?: number;
  vcodec?: string;
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

export interface SocialVideoInfo {
  id: string;
  title: string;
  thumbnail: string | null;
  channelName: string;
  duration: number;
  height: number | null;
}

function isSocialVideoUrl(input: string, platform: SocialVideoPlatform): boolean {
  try {
    const url = new URL(input);
    const hostname = url.hostname.toLowerCase();
    return (
      (url.protocol === "https:" || url.protocol === "http:") &&
      [...VIDEO_HOSTS[platform]].some((host) => hostname === host || hostname.endsWith(`.${host}`))
    );
  } catch {
    return false;
  }
}

export const isPinterestUrl = (input: string) => isSocialVideoUrl(input, "pinterest");
export const isInstagramUrl = (input: string) => isSocialVideoUrl(input, "instagram");

async function fetchSocialVideoInfo(
  url: string,
  platform: SocialVideoPlatform,
): Promise<SocialVideoInfo | null> {
  if (!isSocialVideoUrl(url, platform)) return null;
  const providerName = platform === "instagram" ? "Instagram" : "Pinterest";

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
      { timeout: 45_000, maxBuffer: 10 * 1024 * 1024 },
    );
    const data = JSON.parse(stdout) as YtDlpOutput;
    const heights = (data.formats ?? [])
      .filter((format) => format.vcodec !== "none" && Number.isFinite(format.height))
      .map((format) => format.height!)
      .filter((height) => height > 0);
    if (heights.length === 0) {
      logger.warn({ url, platform }, "social video: no downloadable video formats found");
      return null;
    }

    return {
      id: data.id ?? "",
      title: data.title ?? `${providerName} Video`,
      thumbnail: data.thumbnail ?? null,
      channelName: data.channel ?? data.uploader ?? providerName,
      duration: data.duration ?? 0,
      height: Math.max(...heights),
    };
  } catch (err) {
    logger.error({ err, url, platform }, "social video: fetchInfo error");
    return null;
  }
}

export function fetchPinterestInfo(url: string): Promise<SocialVideoInfo | null> {
  return fetchSocialVideoInfo(url, "pinterest");
}

export function fetchInstagramInfo(url: string): Promise<SocialVideoInfo | null> {
  return fetchSocialVideoInfo(url, "instagram");
}

async function downloadSocialVideo(url: string, platform: SocialVideoPlatform): Promise<string> {
  if (!isSocialVideoUrl(url, platform)) {
    throw new Error(`Only ${platform} video URLs are supported.`);
  }

  const tmpPath = join(
    tmpdir(),
    `${platform}_${Date.now()}_${Math.random().toString(36).slice(2)}.mp4`,
  );
  try {
    await execFileAsync(
      YT_DLP,
      [
        "-f", "bestvideo+bestaudio/best",
        "--merge-output-format", "mp4",
        "--remux-video", "mp4",
        "--no-playlist",
        "--no-warnings",
        "--socket-timeout", "30",
        "-o", tmpPath,
        url,
      ],
      { timeout: 600_000, maxBuffer: 10 * 1024 * 1024 },
    );
    return tmpPath;
  } catch (err) {
    await unlinkAsync(tmpPath).catch(() => {});
    logger.error({ err, url, platform }, "social video: download error");
    throw err;
  }
}

export function downloadPinterestVideo(url: string): Promise<string> {
  return downloadSocialVideo(url, "pinterest");
}

export function downloadInstagramVideo(url: string): Promise<string> {
  return downloadSocialVideo(url, "instagram");
}
