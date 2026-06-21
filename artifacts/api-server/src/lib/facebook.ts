import { execFile, spawn } from "child_process";
import { promisify } from "util";
import { logger } from "./logger";

const execFileAsync = promisify(execFile);

// Use the bundled up-to-date yt-dlp binary (system package may be outdated)
const YT_DLP = "/home/runner/workspace/yt-dlp";

export interface FacebookVideoInfo {
  title: string;
  thumbnail: string | null;
  hdUrl: string | null;
  sdUrl: string | null;
}

interface YtDlpFormat {
  url?: string;
  height?: number;
  vcodec?: string;
  acodec?: string;
}

interface YtDlpOutput {
  title?: string;
  thumbnail?: string;
  url?: string;
  formats?: YtDlpFormat[];
}

export async function fetchFacebookVideoInfo(url: string): Promise<FacebookVideoInfo | null> {
  try {
    const { stdout } = await execFileAsync(
      YT_DLP,
      [
        "--dump-json",
        "--no-playlist",
        "--no-warnings",
        "--socket-timeout", "20",
        url,
      ],
      { timeout: 35_000 }
    );

    const data = JSON.parse(stdout) as YtDlpOutput;

    let hdUrl: string | null = null;
    let sdUrl: string | null = null;

    if (data.formats?.length) {
      // Combined (audio+video) formats, sorted best-first
      const combined = data.formats
        .filter((f) => f.url && f.vcodec !== "none" && f.acodec !== "none")
        .sort((a, b) => (b.height ?? 0) - (a.height ?? 0));

      hdUrl = combined[0]?.url ?? null;
      const sdFmt = combined.length > 1 ? combined[combined.length - 1] : null;
      sdUrl = sdFmt && sdFmt.url !== hdUrl ? sdFmt.url ?? null : null;
    } else if (data.url) {
      hdUrl = data.url;
    }

    if (!hdUrl && !sdUrl) return null;

    return {
      title: data.title ?? "Facebook Video",
      thumbnail: data.thumbnail ?? null,
      hdUrl,
      sdUrl,
    };
  } catch (err) {
    logger.error({ err, url }, "facebook: yt-dlp error");
    return null;
  }
}

/**
 * Spawns a yt-dlp process that streams MP3 audio to stdout.
 */
export function spawnFacebookAudioDownload(url: string) {
  return spawn(YT_DLP, [
    "-x",
    "--audio-format", "mp3",
    "--audio-quality", "0",
    "--no-playlist",
    "--no-warnings",
    "-o", "-",
    url,
  ]);
}
