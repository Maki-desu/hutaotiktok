import { Router, type IRouter } from "express";
import { eq, desc, asc, count } from "drizzle-orm";
import { db, showcaseVideosTable, adminSettingsTable } from "@workspace/db";
import { requireAdmin } from "../middlewares/admin";
import { fetchTikwmVideo } from "../lib/tikwm";
import { cacheExternalImage } from "../lib/cache-image";

const router: IRouter = Router();

function serializeVideo(v: typeof showcaseVideosTable.$inferSelect) {
  return {
    id: v.id,
    tiktokUrl: v.tiktokUrl,
    videoId: v.videoId,
    title: v.title,
    authorUsername: v.authorUsername,
    authorDisplayName: v.authorDisplayName ?? null,
    authorAvatar: v.authorAvatar ?? null,
    thumbnail: v.thumbnail ?? null,
    playUrl: v.playUrl,
    isPinned: v.isPinned,
    pinnedAt: v.pinnedAt ? v.pinnedAt.toISOString() : null,
    createdAt: v.createdAt.toISOString(),
  };
}

async function getMaxPins(): Promise<number> {
  const [settings] = await db
    .select({ maxShowcasePins: adminSettingsTable.maxShowcasePins })
    .from(adminSettingsTable)
    .limit(1);
  return settings?.maxShowcasePins ?? 3;
}

// Public: list all showcase videos (pinned first by pinnedAt, then rest by createdAt desc)
router.get("/showcase", async (_req, res): Promise<void> => {
  const pinned = await db
    .select()
    .from(showcaseVideosTable)
    .where(eq(showcaseVideosTable.isPinned, true))
    .orderBy(asc(showcaseVideosTable.pinnedAt));

  const rest = await db
    .select()
    .from(showcaseVideosTable)
    .where(eq(showcaseVideosTable.isPinned, false))
    .orderBy(desc(showcaseVideosTable.createdAt));

  res.json([...pinned, ...rest].map(serializeVideo));
});

// Public: submit a TikTok link
router.post("/showcase", async (req, res): Promise<void> => {
  const body = req.body as { tiktokUrl?: unknown };
  if (typeof body?.tiktokUrl !== "string" || !body.tiktokUrl) {
    res.status(400).json({ error: "tiktokUrl is required" });
    return;
  }

  const tiktokUrl = body.tiktokUrl.trim();

  if (!tiktokUrl.includes("tiktok.com")) {
    res.status(400).json({ error: "Only TikTok links are allowed." });
    return;
  }

  const videoData = await fetchTikwmVideo(tiktokUrl);
  if (!videoData) {
    res.status(400).json({ error: "Could not fetch TikTok video. Please check the link and try again." });
    return;
  }

  // Check for duplicate
  const existing = await db
    .select({ id: showcaseVideosTable.id })
    .from(showcaseVideosTable)
    .where(eq(showcaseVideosTable.videoId, videoData.videoId))
    .limit(1);

  if (existing.length > 0) {
    res.status(409).json({ error: "This video is already in the showcase." });
    return;
  }

  // Cache thumbnail and avatar locally so TikTok CDN expiry never breaks them
  const [cachedThumb, cachedAvatar] = await Promise.all([
    videoData.thumbnail ? cacheExternalImage(videoData.thumbnail) : null,
    videoData.authorAvatar ? cacheExternalImage(videoData.authorAvatar) : null,
  ]);

  const [created] = await db
    .insert(showcaseVideosTable)
    .values({
      tiktokUrl: videoData.tiktokUrl,
      videoId: videoData.videoId,
      title: videoData.title,
      authorUsername: videoData.authorUsername,
      authorDisplayName: videoData.authorDisplayName,
      authorAvatar: cachedAvatar ?? videoData.authorAvatar,
      thumbnail: cachedThumb ?? videoData.thumbnail,
      playUrl: videoData.playUrl,
      isPinned: false,
    })
    .returning();

  res.status(201).json(serializeVideo(created));
});

// Admin: delete a showcase video
router.delete("/admin/showcase/:id", requireAdmin, async (req, res): Promise<void> => {
  const id = parseInt(req.params["id"] as string, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid ID" });
    return;
  }

  const [deleted] = await db
    .delete(showcaseVideosTable)
    .where(eq(showcaseVideosTable.id, id))
    .returning();

  if (!deleted) {
    res.status(404).json({ error: "Video not found" });
    return;
  }

  res.json({ success: true });
});

// Admin: pin or unpin a showcase video
router.patch("/admin/showcase/:id", requireAdmin, async (req, res): Promise<void> => {
  const id = parseInt(req.params["id"] as string, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid ID" });
    return;
  }

  const body = req.body as { isPinned?: unknown };
  if (typeof body?.isPinned !== "boolean") {
    res.status(400).json({ error: "isPinned (boolean) is required" });
    return;
  }

  const { isPinned } = body;

  if (isPinned) {
    const maxPins = await getMaxPins();

    const [{ pinnedCount }] = await db
      .select({ pinnedCount: count() })
      .from(showcaseVideosTable)
      .where(eq(showcaseVideosTable.isPinned, true));

    if (Number(pinnedCount) >= maxPins) {
      // Unpin the oldest pinned video to make room
      const [oldest] = await db
        .select()
        .from(showcaseVideosTable)
        .where(eq(showcaseVideosTable.isPinned, true))
        .orderBy(asc(showcaseVideosTable.pinnedAt))
        .limit(1);

      if (oldest) {
        await db
          .update(showcaseVideosTable)
          .set({ isPinned: false, pinnedAt: null })
          .where(eq(showcaseVideosTable.id, oldest.id));
      }
    }
  }

  const [updated] = await db
    .update(showcaseVideosTable)
    .set({ isPinned, pinnedAt: isPinned ? new Date() : null })
    .where(eq(showcaseVideosTable.id, id))
    .returning();

  if (!updated) {
    res.status(404).json({ error: "Video not found" });
    return;
  }

  res.json(serializeVideo(updated));
});

export default router;
