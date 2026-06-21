import { Router, type IRouter } from "express";
import { fetchFacebookVideoInfo, spawnFacebookAudioDownload } from "../lib/facebook";
import { logger } from "../lib/logger";
import { db, adminSettingsTable } from "@workspace/db";

const router: IRouter = Router();

async function isFacebookEnabled(): Promise<boolean> {
  const [s] = await db
    .select({ facebookEnabled: adminSettingsTable.facebookEnabled })
    .from(adminSettingsTable)
    .limit(1);
  return s?.facebookEnabled !== false;
}

router.get("/facebook/info", async (req, res): Promise<void> => {
  if (!(await isFacebookEnabled())) {
    res.status(403).json({ error: "Facebook downloads are currently disabled." });
    return;
  }

  const url = req.query.url as string | undefined;
  if (!url) {
    res.status(400).json({ error: "url is required" });
    return;
  }

  const info = await fetchFacebookVideoInfo(url);
  if (!info) {
    res.status(400).json({
      error:
        "Could not extract this Facebook video. Facebook only allows downloading public videos, and some may require you to be logged in. Try a different public video link.",
    });
    return;
  }

  res.json(info);
});

router.get("/facebook/download", async (req, res): Promise<void> => {
  if (!(await isFacebookEnabled())) {
    res.status(403).json({ error: "Facebook downloads are currently disabled." });
    return;
  }

  const url = req.query.url as string | undefined;
  const audio = req.query.audio === "true";

  if (!url || !audio) {
    res.status(400).json({ error: "url and audio=true are required" });
    return;
  }

  try {
    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename*=UTF-8''${encodeURIComponent("facebook_audio.mp3")}`
    );

    const proc = spawnFacebookAudioDownload(url);
    proc.stdout?.pipe(res);
    proc.stderr?.on("data", (d: Buffer) =>
      logger.debug({ msg: d.toString().trim() }, "facebook: yt-dlp stderr")
    );
    proc.on("error", (err) => {
      logger.error({ err }, "facebook: yt-dlp process error");
      if (!res.headersSent) res.status(500).end();
    });
    proc.on("close", (code) => {
      if (code !== 0) logger.warn({ code, url }, "facebook: yt-dlp exit");
    });
  } catch (err) {
    logger.error({ err }, "facebook: audio download error");
    if (!res.headersSent) res.status(500).json({ error: "Download failed" });
  }
});

export default router;
