import { execFile, spawn } from "child_process";
import { resolve } from "path";
import { promisify } from "util";
import { logger } from "./logger";
import { cobaltFetch } from "./cobalt";

const execFileAsync = promisify(execFile);

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
  const commands = [
    ...(process.env.YT_DLP_PATH ? [{ cmd: process.env.YT_DLP_PATH, args: [] as string[] }] : []),
    { cmd: "python", args: ["-m", "yt_dlp"] },
    { cmd: "python3", args: ["-m", "yt_dlp"] },
    { cmd: "yt-dlp", args: [] },
    {
      cmd: resolve(process.cwd(), process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp"),
      args: [],
    },
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
  for (const { cmd, args } of getYtDlpCommands()) {
    try {
      const fullArgs = [
        ...args,
        "--dump-json",
        "--no-playlist",
        "--no-warnings",
        "--no-check-certificates",
        "--socket-timeout", "25",
        "--add-header", "Referer:https://www.facebook.com/",
        url,
      ];

      const { stdout } = await execFileAsync(cmd, fullArgs, { timeout: 35_000 });
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
  const ytdlpResult = await fetchViaYtdlp(url);
  if (ytdlpResult) return ytdlpResult;

  logger.info({ url }, "facebook: yt-dlp failed, trying cobalt fallback");
  return fetchViaCobalt(url);
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
