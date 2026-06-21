import { Router, type IRouter } from "express";
import {
  fetchYouTubeInfo,
  getYouTubeCdnUrl,
  spawnYouTubeAudioChain,
  downloadYouTubeMuxed,
  streamTempFile,
} from "../lib/youtube";
import { logger } from "../lib/logger";
import { db, adminSettingsTable } from "@workspace/db";

const router: IRouter = Router();

async function isYouTubeEnabled(): Promise<boolean> {
  const [s] = await db
    .select({ youtubeEnabled: adminSettingsTable.youtubeEnabled })
    .from(adminSettingsTable)
    .limit(1);
  return s?.youtubeEnabled !== false;
}

router.get("/youtube/info", async (req, res): Promise<void> => {
  if (!(await isYouTubeEnabled())) {
    res.status(403).json({ error: "YouTube downloads are currently disabled." });
    return;
  }

  const url = req.query.url as string | undefined;
  if (!url) {
    res.status(400).json({ error: "url is required" });
    return;
  }

  const info = await fetchYouTubeInfo(url);
  if (!info) {
    res.status(400).json({
      error: "Could not fetch video info. The video may be unavailable, age-restricted, or private.",
    });
    return;
  }

  res.json(info);
});

router.get("/youtube/download", async (req, res): Promise<void> => {
  if (!(await isYouTubeEnabled())) {
    res.status(403).json({ error: "YouTube downloads are currently disabled." });
    return;
  }

  const url = req.query.url as string | undefined;
  const formatStr = (req.query.formatStr as string | undefined) ?? (req.query.itag as string | undefined);
  const audio = req.query.audio === "true";
  // title passed from frontend to avoid a redundant yt-dlp info call
  const titleParam = (req.query.title as string | undefined) ?? "YouTube Video";
  const safeTitle = titleParam.replace(/[<>:"/\\|?*\x00-\x1f]/g, " ").trim().substring(0, 80);
  const quality = (req.query.quality as string | undefined) ?? "";

  if (!url) {
    res.status(400).json({ error: "url is required" });
    return;
  }

  // ── Audio: yt-dlp raw stream → ffmpeg MP3 conversion ──────────────────────
  if (audio) {
    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename*=UTF-8''${encodeURIComponent(safeTitle + ".mp3")}`
    );

    const { ytdlpProc, ffmpegProc } = spawnYouTubeAudioChain(url);
    ffmpegProc.stdout?.pipe(res);

    ytdlpProc.stderr?.on("data", (d: Buffer) =>
      logger.debug({ msg: d.toString().trim() }, "youtube: yt-dlp audio stderr")
    );
    ffmpegProc.stderr?.on("data", (d: Buffer) =>
      logger.debug({ msg: d.toString().trim() }, "youtube: ffmpeg stderr")
    );
    ffmpegProc.on("error", (err) => {
      logger.error({ err }, "youtube: ffmpeg error");
      if (!res.headersSent) res.status(500).end();
    });
    ytdlpProc.on("error", (err) => {
      logger.error({ err }, "youtube: yt-dlp audio error");
    });
    ffmpegProc.on("close", (code) => {
      if (code !== 0) logger.warn({ code }, "youtube: ffmpeg non-zero exit");
    });
    return;
  }

  // ── Video ──────────────────────────────────────────────────────────────────
  if (!formatStr) {
    res.status(400).json({ error: "formatStr is required for video downloads" });
    return;
  }

  const filename = `${safeTitle}${quality ? ` - ${quality}` : ""}.mp4`;
  const needsMux = formatStr.includes("+");

  if (needsMux) {
    // High-quality: mux to temp file, then stream
    res.setHeader("Content-Type", "video/mp4");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`
    );
    try {
      const tmpPath = await downloadYouTubeMuxed(url, formatStr);
      await streamTempFile(tmpPath, res);
    } catch (err) {
      logger.error({ err, url, formatStr }, "youtube: muxed download error");
      if (!res.headersSent) res.status(500).json({ error: "High-quality download failed. Try a lower quality." });
    }
    return;
  }

  // Non-muxed (combined stream): get CDN URL and redirect to proxy-download
  const cdnUrl = await getYouTubeCdnUrl(url, formatStr);
  if (!cdnUrl) {
    res.status(400).json({ error: "Could not get video download URL. Try a different quality." });
    return;
  }

  res.redirect(
    307,
    `/api/proxy-download?url=${encodeURIComponent(cdnUrl)}&filename=${encodeURIComponent(filename)}`
  );
});

export default router;
