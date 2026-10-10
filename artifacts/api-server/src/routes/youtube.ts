import { Router, type IRouter } from "express";
import {
  fetchYouTubeInfo,
  isYouTubeUrl,
  downloadYouTubeAudio,
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
  let enabled: boolean;
  try {
    enabled = await isYouTubeEnabled();
  } catch (err) {
    logger.error({ err }, "youtube: feature setting lookup failed");
    res.status(503).json({ error: "YouTube downloads are temporarily unavailable. Please try again later." });
    return;
  }
  if (!enabled) {
    res.status(403).json({ error: "YouTube downloads are currently disabled." });
    return;
  }

  const url = req.query.url as string | undefined;
  if (!url || !isYouTubeUrl(url)) {
    res.status(400).json({ error: "A valid YouTube video URL is required." });
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
  let enabled: boolean;
  try {
    enabled = await isYouTubeEnabled();
  } catch (err) {
    logger.error({ err }, "youtube: feature setting lookup failed");
    res.status(503).json({ error: "YouTube downloads are temporarily unavailable. Please try again later." });
    return;
  }
  if (!enabled) {
    res.status(403).json({ error: "YouTube downloads are currently disabled." });
    return;
  }

  const url = req.query.url as string | undefined;
  const formatStr = (req.query.formatStr as string | undefined) ?? (req.query.itag as string | undefined);
  const audio = req.query.audio === "true";
  // title passed from frontend to avoid a redundant yt-dlp info call
  const titleParam = (req.query.title as string | undefined) ?? "YouTube Video";
  const safeTitle = titleParam.replace(/[<>:"/\\|?*\x00-\x1f]/g, " ").trim().substring(0, 80) || "YouTube Video";
  const quality = (req.query.quality as string | undefined) ?? "";

  if (!url || !isYouTubeUrl(url)) {
    res.status(400).json({ error: "A valid YouTube video URL is required." });
    return;
  }

  if (!audio && (!formatStr || !/^(?:\d+|bestaudio)(?:\+(?:\d+|bestaudio))?$/.test(formatStr))) {
    res.status(400).json({ error: "A valid YouTube video format is required." });
    return;
  }

  // ── Audio: yt-dlp raw stream → ffmpeg MP3 conversion ──────────────────────
  if (audio) {
    try {
      const tmpPath = await downloadYouTubeAudio(url);
      res.setHeader("Content-Type", "audio/mpeg");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename*=UTF-8''${encodeURIComponent(safeTitle + ".mp3")}`
      );
      await streamTempFile(tmpPath, res);
    } catch (err) {
      logger.error({ err, url }, "youtube: audio route error");
      if (!res.headersSent) {
        res.status(500).json({ error: "YouTube audio conversion failed. Please try again later." });
      } else {
        res.destroy(err instanceof Error ? err : undefined);
      }
    }
    return;
  }

  // ── Video ──────────────────────────────────────────────────────────────────
  if (!formatStr) {
    res.status(400).json({ error: "formatStr is required for video downloads" });
    return;
  }

  const filename = `${safeTitle}${quality ? ` - ${quality}` : ""}.mp4`;
  try {
    const tmpPath = await downloadYouTubeMuxed(url, formatStr!);
    res.setHeader("Content-Type", "video/mp4");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`
    );
    await streamTempFile(tmpPath, res);
  } catch (err) {
    logger.error({ err, url, formatStr }, "youtube: video download error");
    if (!res.headersSent) {
      res.status(500).json({ error: "YouTube download failed. Please try a different quality." });
    } else {
      res.destroy(err instanceof Error ? err : undefined);
    }
  }
});

export default router;
