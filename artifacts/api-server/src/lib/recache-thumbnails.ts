import { db, showcaseVideosTable, downloadHistoryTable } from "@workspace/db";
import { eq, isNotNull } from "drizzle-orm";
import { cacheExternalImage, isLocalUpload } from "./cache-image";
import { logger } from "./logger";

/**
 * On server startup, scan both tables for any thumbnail/avatar URLs that
 * still point to external CDNs (TikTok URLs expire quickly) and re-download
 * them into the local uploads folder so they survive indefinitely.
 */
export async function recacheThumbnails(): Promise<void> {
  try {
    await recacheShowcase();
    await recacheDownloadHistory();
  } catch (err) {
    logger.error({ err }, "recacheThumbnails: unexpected error");
  }
}

async function recacheShowcase(): Promise<void> {
  const rows = await db
    .select()
    .from(showcaseVideosTable)
    .where(isNotNull(showcaseVideosTable.thumbnail));

  const stale = rows.filter(
    (r) => !isLocalUpload(r.thumbnail) || !isLocalUpload(r.authorAvatar),
  );

  if (!stale.length) return;
  logger.info({ count: stale.length }, "recacheThumbnails: re-caching showcase thumbnails");

  for (const row of stale) {
    const updates: Record<string, string | null> = {};

    if (!isLocalUpload(row.thumbnail) && row.thumbnail) {
      const local = await cacheExternalImage(row.thumbnail);
      if (local) updates["thumbnail"] = local;
    }

    if (!isLocalUpload(row.authorAvatar) && row.authorAvatar) {
      const local = await cacheExternalImage(row.authorAvatar);
      if (local) updates["authorAvatar"] = local;
    }

    if (Object.keys(updates).length) {
      await db
        .update(showcaseVideosTable)
        .set(updates)
        .where(eq(showcaseVideosTable.id, row.id));
    }
  }

  logger.info({ count: stale.length }, "recacheThumbnails: showcase done");
}

async function recacheDownloadHistory(): Promise<void> {
  const rows = await db
    .select()
    .from(downloadHistoryTable)
    .where(isNotNull(downloadHistoryTable.thumbnail));

  const stale = rows.filter((r) => !isLocalUpload(r.thumbnail));

  if (!stale.length) return;
  logger.info({ count: stale.length }, "recacheThumbnails: re-caching download history thumbnails");

  for (const row of stale) {
    if (!row.thumbnail) continue;
    const local = await cacheExternalImage(row.thumbnail);
    if (local) {
      await db
        .update(downloadHistoryTable)
        .set({ thumbnail: local })
        .where(eq(downloadHistoryTable.id, row.id));
    }
  }

  logger.info({ count: stale.length }, "recacheThumbnails: download history done");
}
