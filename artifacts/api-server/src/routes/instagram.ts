import { Router, type IRouter } from "express";
import { downloadInstagramVideo, fetchInstagramInfo, isInstagramUrl } from "../lib/pinterest";
import { logger } from "../lib/logger";
import { streamTempFile } from "../lib/youtube";

const router: IRouter = Router();

router.get("/instagram/info", async (req, res): Promise<void> => {
  const url = req.query.url;
  if (typeof url !== "string" || !isInstagramUrl(url)) {
    res.status(400).json({ error: "A valid Instagram post or Reel URL is required." });
    return;
  }

  const info = await fetchInstagramInfo(url);
  if (!info) {
    res.status(400).json({
      error: "Could not fetch this Instagram video. It may be private, unavailable, or require login.",
    });
    return;
  }

  res.json(info);
});

router.get("/instagram/download", async (req, res): Promise<void> => {
  const url = req.query.url;
  if (typeof url !== "string" || !isInstagramUrl(url)) {
    res.status(400).json({ error: "A valid Instagram post or Reel URL is required." });
    return;
  }

  const requestedTitle = typeof req.query.title === "string" ? req.query.title : "Instagram Video";
  const safeTitle = requestedTitle
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, " ")
    .trim()
    .substring(0, 80) || "Instagram Video";

  try {
    const tmpPath = await downloadInstagramVideo(url);
    res.setHeader("Content-Type", "video/mp4");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename*=UTF-8''${encodeURIComponent(`${safeTitle}.mp4`)}`,
    );
    await streamTempFile(tmpPath, res);
  } catch (err) {
    logger.error({ err, url }, "instagram: download route error");
    if (!res.headersSent) {
      res.status(500).json({ error: "The Instagram video download failed. Please try again later." });
    } else {
      res.destroy(err instanceof Error ? err : undefined);
    }
  }
});

export default router;
