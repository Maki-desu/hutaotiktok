import { Router, type IRouter } from "express";
import {
  downloadTwitterGif,
  downloadTwitterVideo,
  fetchTwitterInfo,
  isTwitterUrl,
} from "../lib/twitter";
import { streamTempFile } from "../lib/youtube";
import { logger } from "../lib/logger";

const router: IRouter = Router();

function readTwitterUrl(value: unknown): string | null {
  return typeof value === "string" && isTwitterUrl(value) ? value : null;
}

router.get("/twitter/info", async (req, res): Promise<void> => {
  const url = readTwitterUrl(req.query.url);
  if (!url) {
    res.status(400).json({ error: "A valid X/Twitter video URL is required." });
    return;
  }

  const info = await fetchTwitterInfo(url);
  if (!info) {
    res.status(400).json({
      error: "Could not fetch this X/Twitter video. It may be private, unavailable, or unsupported.",
    });
    return;
  }

  res.json(info);
});

router.get("/twitter/download", async (req, res): Promise<void> => {
  const url = readTwitterUrl(req.query.url);
  if (!url) {
    res.status(400).json({ error: "A valid X/Twitter video URL is required." });
    return;
  }

  const quality = req.query.quality;
  let height: number | null = null;
  if (quality !== "best") {
    if (typeof quality !== "string" || !/^\d{3,4}$/.test(quality)) {
      res.status(400).json({ error: "A valid video quality is required." });
      return;
    }
    height = Number(quality);
    if (height < 144 || height > 4320) {
      res.status(400).json({ error: "The selected video quality is not supported." });
      return;
    }
  }

  const requestedTitle = typeof req.query.title === "string" ? req.query.title : "X Video";
  const safeTitle = requestedTitle
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, " ")
    .trim()
    .substring(0, 80) || "X Video";
  const qualityLabel = height === null ? "" : ` - ${height}p`;

  try {
    res.setHeader("Content-Type", "video/mp4");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename*=UTF-8''${encodeURIComponent(`${safeTitle}${qualityLabel}.mp4`)}`
    );
    const tmpPath = await downloadTwitterVideo(url, height);
    await streamTempFile(tmpPath, res);
  } catch (err) {
    logger.error({ err, url, height }, "twitter: download route error");
    if (!res.headersSent) {
      res.status(500).json({ error: "The X/Twitter video download failed. Please try another quality." });
    } else {
      res.destroy(err instanceof Error ? err : undefined);
    }
  }
});

router.get("/twitter/gif", async (req, res): Promise<void> => {
  const url = readTwitterUrl(req.query.url);
  if (!url) {
    res.status(400).json({ error: "A valid X/Twitter post URL is required." });
    return;
  }

  const quality = req.query.quality;
  let height: number | null = null;
  if (typeof quality === "string" && quality !== "best" && /^\d{3,4}$/.test(quality)) {
    const parsed = Number(quality);
    if (parsed >= 144 && parsed <= 4320) height = parsed;
  }

  const requestedTitle = typeof req.query.title === "string" ? req.query.title : "X GIF";
  const safeTitle = requestedTitle
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, " ")
    .trim()
    .substring(0, 80) || "X GIF";

  try {
    const gifPath = await downloadTwitterGif(url, height, 15);
    res.setHeader("Content-Type", "image/gif");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename*=UTF-8''${encodeURIComponent(`${safeTitle}.gif`)}`
    );
    await streamTempFile(gifPath, res);
  } catch (err) {
    logger.error({ err, url }, "twitter: gif route error");
    if (!res.headersSent) {
      res.status(500).json({
        error: err instanceof Error ? err.message : "Could not convert this X post to GIF.",
      });
    } else {
      res.destroy(err instanceof Error ? err : undefined);
    }
  }
});

export default router;
