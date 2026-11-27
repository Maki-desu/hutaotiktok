import { execFile, spawn } from "child_process";
import { existsSync } from "fs";
import { resolve } from "path";
import { promisify } from "util";
import { logger } from "./logger";
import { cobaltFetch } from "./cobalt";

const execFileAsync = promisify(execFile);
const FACEBOOK_INFO_CACHE_TTL_MS = 300_000;
const facebookInfoCache = new Map<string, { expiresAt: number; info: FacebookVideoInfo }>();
const facebookInfoInFlight = new Map<string, Promise<FacebookVideoInfo | null>>();
let preferredYtDlpCommand: { cmd: string; args: string[] } | null = null;

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

function getYtDlpCommands() {
  const binaryName = process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp";
  const localPaths = [
    resolve(process.cwd(), binaryName),
    resolve(process.cwd(), "../../", binaryName),
  ].filter((candidate) => existsSync(candidate));

  const commands = [
    ...(preferredYtDlpCommand ? [preferredYtDlpCommand] : []),
    ...(process.env.YT_DLP_PATH ? [{ cmd: process.env.YT_DLP_PATH, args: [] as string[] }] : []),
    ...localPaths.map((cmd) => ({ cmd, args: [] as string[] })),
    { cmd: "yt-dlp", args: [] as string[] },
    { cmd: "python3", args: ["-m", "yt_dlp"] },
    { cmd: "python", args: ["-m", "yt_dlp"] },
  ];

  return commands.filter(
    (command, index) =>
      commands.findIndex(
        (candidate) =>
          candidate.cmd === command.cmd &&
          candidate.args.join("\0") === command.args.join("\0")
      ) === index
  );
}

async function fetchViaYtdlp(url: string): Promise<FacebookVideoInfo | null> {
  for (const command of getYtDlpCommands()) {
    const { cmd, args } = command;
    try {
      const fullArgs = [
        ...args,
        "--dump-json",
        "--no-playlist",
        "--no-warnings",
        "--no-check-certificates",
        "--socket-timeout", "12",
        "--add-header", "Referer:https://www.facebook.com/",
        url,
      ];

      const { stdout } = await execFileAsync(cmd, fullArgs, { timeout: 25_000, maxBuffer: 6 * 1024 * 1024 });
      preferredYtDlpCommand = command;
      const data = JSON.parse(stdout) as YtDlpOutput;

      let hdUrl: string | null = null;
      let sdUrl: string | null = null;

      if (data.formats?.length) {
        const combined = data.formats
          .filter((f) => f.url && f.vcodec !== "none" && f.acodec !== "none")
          .sort((a, b) => (b.height ?? 0) - (a.height ?? 0));

        hdUrl = combined[0]?.url ?? data.url ?? null;
        const sdFmt = combined.length > 1 ? combined[combined.length - 1] : null;
        sdUrl = sdFmt && sdFmt.url !== hdUrl ? sdFmt.url ?? null : null;
      } else if (data.url) {
        hdUrl = data.url;
      }

      if (!hdUrl) continue;

      return {
        title: data.title ?? "Facebook Video",
        thumbnail: data.thumbnail ?? null,
        hdUrl,
        sdUrl,
      };
    } catch (err) {
      logger.debug({ err, url, cmd }, "facebook: yt-dlp attempt failed");
    }
  }

  return null;
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
  const cacheKey = url.trim();
  const cached = facebookInfoCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.info;

  const existing = facebookInfoInFlight.get(cacheKey);
  if (existing) return existing;

  const task = (async (): Promise<FacebookVideoInfo | null> => {
    const ytdlpResult = await fetchViaYtdlp(url);
    const resolved = ytdlpResult ?? (
      logger.info({ url }, "facebook: yt-dlp failed, trying cobalt fallback"),
      await fetchViaCobalt(url)
    );
    if (resolved) {
      if (facebookInfoCache.size >= 200) {
        const oldest = facebookInfoCache.keys().next().value;
        if (oldest) facebookInfoCache.delete(oldest);
      }
      facebookInfoCache.set(cacheKey, { expiresAt: Date.now() + FACEBOOK_INFO_CACHE_TTL_MS, info: resolved });
    }
    return resolved;
  })();

  facebookInfoInFlight.set(cacheKey, task);
  try {
    return await task;
  } finally {
    facebookInfoInFlight.delete(cacheKey);
  }
}

export async function spawnFacebookAudioDownload(url: string) {
  let commandToUse: ReturnType<typeof getYtDlpCommands>[number] | undefined;

  for (const command of getYtDlpCommands()) {
    try {
      await execFileAsync(command.cmd, [...command.args, "--version"], { timeout: 5_000 });
      commandToUse = command;
      break;
    } catch (err) {
      logger.debug({ err, cmd: command.cmd }, "facebook: yt-dlp command unavailable");
    }
  }

  if (!commandToUse) {
    throw new Error("No working yt-dlp command is available for Facebook audio downloads.");
  }

  return spawn(commandToUse.cmd, [
    ...commandToUse.args,
    "-x",
    "--audio-format", "mp3",
    "--audio-quality", "0",
    "--no-playlist",
    "--no-warnings",
    "--no-check-certificates",
    "--add-header", "Referer:https://www.facebook.com/",
    "-o", "-",
    url,
  ]);
}
