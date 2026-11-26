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
  const quality = (req.query.quality as string) || "hd";

  if (!url) {
    res.status(400).json({ error: "url is required" });
    return;
  }

  if (audio) {
    try {
      const proc = await spawnFacebookAudioDownload(url);
      res.setHeader("Content-Type", "audio/mpeg");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename*=UTF-8''${encodeURIComponent("facebook_audio.mp3")}`
      );

      proc.stdout?.pipe(res);
      proc.stderr?.on("data", (d: Buffer) =>
        logger.debug({ msg: d.toString().trim() }, "facebook: yt-dlp stderr")
      );
      proc.on("error", (err) => {
        logger.error({ err }, "facebook: yt-dlp process error");
        if (res.headersSent) res.destroy(err);
        else res.status(500).json({ error: "Audio download failed" });
      });
      proc.on("close", (code) => {
        if (code !== 0) {
          logger.warn({ code, url }, "facebook: yt-dlp exit");
          res.destroy(new Error(`yt-dlp audio process exited with code ${code}`));
        }
      });
      return;
    } catch (err) {
      logger.error({ err }, "facebook: audio download error");
      if (!res.headersSent) res.status(500).json({ error: "Download failed" });
      return;
    }
  }

  // Handle Video MP4 Download
  try {
    const info = await fetchFacebookVideoInfo(url);
    if (!info) {
      res.status(400).json({ error: "Could not extract Facebook video for download." });
      return;
    }

    const videoStreamUrl = quality === "sd" ? (info.sdUrl || info.hdUrl) : (info.hdUrl || info.sdUrl);
    if (!videoStreamUrl) {
      res.status(400).json({ error: "No video stream URL found for this Facebook video." });
      return;
    }

    const safeTitle = (info.title || "facebook_video").replace(/[<>:"/\\|?*\x00-\x1f]/g, " ").trim().substring(0, 60);
    res.setHeader("Content-Type", "video/mp4");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename*=UTF-8''${encodeURIComponent(`${safeTitle}.mp4`)}`
    );

    const upstream = await fetch(videoStreamUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Referer": "https://www.facebook.com/",
      },
    });

    if (!upstream.ok || !upstream.body) {
      res.status(upstream.status || 500).json({ error: "Upstream Facebook CDN error" });
      return;
    }

    const { Readable } = await import("stream");
    const reader = upstream.body.getReader();
    const nodeStream = new Readable({
      async read() {
        const { done, value } = await reader.read();
        if (done) {
          this.push(null);
        } else {
          this.push(Buffer.from(value));
        }
      },
    });

    nodeStream.pipe(res);
  } catch (err) {
    logger.error({ err }, "facebook: video download error");
    if (!res.headersSent) res.status(500).json({ error: "Download failed" });
  }
});

export default router;
