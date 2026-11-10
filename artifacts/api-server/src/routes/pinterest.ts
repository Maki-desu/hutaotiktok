import { Router, type IRouter } from "express";
import { downloadPinterestVideo, fetchPinterestInfo, isPinterestUrl } from "../lib/pinterest";
import { logger } from "../lib/logger";
import { streamTempFile } from "../lib/youtube";

const router: IRouter = Router();

router.get("/pinterest/info", async (req, res): Promise<void> => {
  const url = req.query.url;
  if (typeof url !== "string" || !isPinterestUrl(url)) {
    res.status(400).json({ error: "A valid Pinterest video URL is required." });
    return;
  }

  const info = await fetchPinterestInfo(url);
  if (!info) {
    res.status(400).json({
      error: "Could not fetch this Pinterest video. It may be private, unavailable, or unsupported.",
    });
    return;
  }

  res.json(info);
});

router.get("/pinterest/download", async (req, res): Promise<void> => {
  const url = req.query.url;
  if (typeof url !== "string" || !isPinterestUrl(url)) {
    res.status(400).json({ error: "A valid Pinterest video URL is required." });
    return;
  }

  const requestedTitle = typeof req.query.title === "string" ? req.query.title : "Pinterest Video";
  const safeTitle = requestedTitle
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, " ")
    .trim()
    .substring(0, 80) || "Pinterest Video";

  try {
    const tmpPath = await downloadPinterestVideo(url);
    res.setHeader("Content-Type", "video/mp4");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename*=UTF-8''${encodeURIComponent(`${safeTitle}.mp4`)}`,
    );
    await streamTempFile(tmpPath, res);
  } catch (err) {
    logger.error({ err, url }, "pinterest: download route error");
    if (!res.headersSent) {
      res.status(500).json({ error: "The Pinterest video download failed. Please try again later." });
    } else {
      res.destroy(err instanceof Error ? err : undefined);
    }
  }
});

export default router;
