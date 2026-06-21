import { execFile, spawn } from "child_process";
import { promisify } from "util";
import { logger } from "./logger";
import { cobaltFetch } from "./cobalt";

const execFileAsync = promisify(execFile);

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

async function fetchViaYtdlp(url: string): Promise<FacebookVideoInfo | null> {
  try {
    const { stdout } = await execFileAsync(
      YT_DLP,
      [
        "--dump-json",
        "--no-playlist",
        "--no-warnings",
        "--no-check-certificates",
        "--socket-timeout", "25",
        "--extractor-args", "facebook:webpage_url_basename=videos",
        "--add-header", "Referer:https://www.facebook.com/",
        url,
      ],
      { timeout: 40_000 }
    );

    const data = JSON.parse(stdout) as YtDlpOutput;

    let hdUrl: string | null = null;
    let sdUrl: string | null = null;

    if (data.formats?.length) {
      const combined = data.formats
        .filter((f) => f.url && f.vcodec !== "none" && f.acodec !== "none")
        .sort((a, b) => (b.height ?? 0) - (a.height ?? 0));

      hdUrl = combined[0]?.url ?? null;
      const sdFmt = combined.length > 1 ? combined[combined.length - 1] : null;
      sdUrl = sdFmt && sdFmt.url !== hdUrl ? sdFmt.url ?? null : null;
    } else if (data.url) {
      hdUrl = data.url;
    }

    if (!hdUrl) return null;

    return {
      title: data.title ?? "Facebook Video",
      thumbnail: data.thumbnail ?? null,
      hdUrl,
      sdUrl,
    };
  } catch (err) {
    logger.debug({ err, url }, "facebook: yt-dlp attempt failed");
    return null;
  }
}

async function fetchViaCobalt(url: string): Promise<FacebookVideoInfo | null> {
  try {
    const result = await cobaltFetch(url, { downloadMode: "auto" });
    if (!result?.url) return null;

    return {
      title: "Facebook Video",
      thumbnail: null,
      hdUrl: result.url,
      sdUrl: null,
    };
  } catch (err) {
    logger.error({ err, url }, "facebook: cobalt attempt failed");
    return null;
  }
}

export async function fetchFacebookVideoInfo(url: string): Promise<FacebookVideoInfo | null> {
  const ytdlpResult = await fetchViaYtdlp(url);
  if (ytdlpResult) return ytdlpResult;

  logger.info({ url }, "facebook: yt-dlp failed, trying cobalt fallback");
  return fetchViaCobalt(url);
}

export function spawnFacebookAudioDownload(url: string) {
  return spawn(YT_DLP, [
    "-x",
    "--audio-format", "mp3",
    "--audio-quality", "0",
    "--no-playlist",
    "--no-warnings",
    "--no-check-certificates",
    "--extractor-args", "facebook:webpage_url_basename=videos",
    "--add-header", "Referer:https://www.facebook.com/",
    "-o", "-",
    url,
  ]);
}
