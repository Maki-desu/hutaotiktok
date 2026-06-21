import { execFile, spawn } from "child_process";
import { promisify } from "util";
import { createReadStream, unlink, stat } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { logger } from "./logger";

const execFileAsync = promisify(execFile);
const unlinkAsync = promisify(unlink);
const statAsync = promisify(stat);

// Use the bundled up-to-date yt-dlp binary
const YT_DLP = "/home/runner/workspace/yt-dlp";

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

export async function fetchYouTubeInfo(url: string): Promise<YouTubeInfo | null> {
  try {
    const { stdout } = await execFileAsync(
      YT_DLP,
      [
        "--dump-json",
        "--no-playlist",
        "--no-warnings",
        "--no-check-certificates",
        "--socket-timeout", "20",
        "--extractor-args", "youtube:player_client=ios,web",
        url,
      ],
      { timeout: 35_000 }
    );

    const data = JSON.parse(stdout) as YtDlpOutput;
    const allFormats = data.formats ?? [];

    // Best m4a audio format for muxing
    const bestAudio = allFormats
      .filter((f) => f.vcodec === "none" && f.acodec !== "none" && f.ext === "m4a")
      .sort((a, b) => (b.tbr ?? 0) - (a.tbr ?? 0))[0];
    const audioId = bestAudio?.format_id ?? "140";

    // Combined (audio+video) formats — direct CDN proxy, no muxing
    const combined = allFormats
      .filter((f) => f.vcodec !== "none" && f.acodec !== "none" && f.ext === "mp4")
      .sort((a, b) => (b.height ?? 0) - (a.height ?? 0));

    // Video-only mp4 formats for muxed downloads
    const videoOnly = allFormats
      .filter((f) => f.vcodec !== "none" && f.acodec === "none" && f.ext === "mp4")
      .sort((a, b) => (b.height ?? 0) - (a.height ?? 0));

    const seenHeights = new Set<number>();
    const formats: YouTubeFormat[] = [];

    for (const f of combined) {
      const h = f.height ?? 0;
      if (seenHeights.has(h)) continue;
      seenHeights.add(h);
      formats.push({ formatStr: f.format_id!, qualityLabel: h ? `${h}p` : f.format_id!, needsMux: false });
    }

    const muxHeights = [2160, 1440, 1080, 720, 480];
    for (const targetH of muxHeights) {
      if (seenHeights.has(targetH)) continue;
      const vFmt = videoOnly.find((f) => f.height === targetH);
      if (!vFmt) continue;
      seenHeights.add(targetH);
      formats.push({ formatStr: `${vFmt.format_id}+${audioId}`, qualityLabel: `${targetH}p`, needsMux: true });
    }

    formats.sort((a, b) => parseInt(b.qualityLabel) - parseInt(a.qualityLabel));

    return {
      id: data.id ?? "",
      title: data.title ?? "YouTube Video",
      thumbnail: data.thumbnail ?? null,
      channelName: data.channel ?? data.uploader ?? "Unknown",
      duration: data.duration ?? 0,
      formats,
    };
  } catch (err) {
    logger.error({ err, url }, "youtube: fetchInfo error");
    return null;
  }
}

/**
 * Get the direct CDN URL for a non-muxed format (single combined stream).
 * Returns the first URL from yt-dlp's --get-url output.
 */
export async function getYouTubeCdnUrl(url: string, formatStr: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(
      YT_DLP,
      [
        "--get-url",
        "-f", formatStr,
        "--no-playlist",
        "--no-warnings",
        "--no-check-certificates",
        "--extractor-args", "youtube:player_client=ios,web",
        url,
      ],
      { timeout: 30_000 }
    );
    const cdnUrl = stdout.trim().split("\n")[0];
    return cdnUrl || null;
  } catch (err) {
    logger.error({ err, url, formatStr }, "youtube: getCdnUrl error");
    return null;
  }
}

/**
 * Download a muxed format (video+audio) to a temp file using yt-dlp + ffmpeg.
 * Returns the temp file path; caller must delete it after streaming.
 */
export async function downloadYouTubeMuxed(url: string, formatStr: string): Promise<string> {
  const tmpPath = join(
    tmpdir(),
    `yt_${Date.now()}_${Math.random().toString(36).slice(2)}.mp4`
  );
  await execFileAsync(
    YT_DLP,
    [
      "-f", formatStr,
      "--merge-output-format", "mp4",
      "--no-playlist",
      "--no-warnings",
      "--no-check-certificates",
      "--extractor-args", "youtube:player_client=ios,web",
      "-o", tmpPath,
      url,
    ],
    { timeout: 600_000 }
  );
  return tmpPath;
}

export async function streamTempFile(tmpPath: string, res: import("express").Response): Promise<void> {
  try {
    const { size } = await statAsync(tmpPath);
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
export function spawnYouTubeAudioChain(url: string) {
  const ytdlpProc = spawn(YT_DLP, [
    "-f", "bestaudio[ext=webm]/bestaudio[ext=m4a]/bestaudio",
    "--no-playlist",
    "--no-warnings",
    "--no-check-certificates",
    "--extractor-args", "youtube:player_client=ios,web",
    "-o", "-",
    url,
  ]);

  const ffmpegProc = spawn("ffmpeg", [
    "-i", "pipe:0",
    "-f", "mp3",
    "-ab", "192k",
    "-vn",
    "-loglevel", "error",
    "pipe:1",
  ]);

  // Chain: yt-dlp stdout → ffmpeg stdin
  ytdlpProc.stdout?.pipe(ffmpegProc.stdin!);
  ytdlpProc.on("error", () => ffmpegProc.stdin?.destroy());
  ytdlpProc.on("close", (code) => {
    if (code !== 0) ffmpegProc.stdin?.end();
  });

  return { ytdlpProc, ffmpegProc };
}
