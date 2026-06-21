import { Router, type IRouter } from "express";
import { sql } from "drizzle-orm";
import { db, downloadHistoryTable } from "@workspace/db";
import {
  ListDownloadHistoryResponse,
  AddDownloadRecordBody,
} from "@workspace/api-zod";
import { cacheExternalImage } from "../lib/cache-image";

const router: IRouter = Router();

router.get("/downloads/history", async (_req, res): Promise<void> => {
  const history = await db
    .select()
    .from(downloadHistoryTable)
    .orderBy(sql`${downloadHistoryTable.downloadedAt} DESC`)
    .limit(50);

  res.json(
    ListDownloadHistoryResponse.parse(
      history.map((h) => ({ ...h, downloadedAt: h.downloadedAt.toISOString() })),
    ),
  );
});

router.post("/downloads/history", async (req, res): Promise<void> => {
  const parsed = AddDownloadRecordBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const data = { ...parsed.data };

  // Download and cache the thumbnail locally so the CDN URL never expires
  if (data.thumbnail) {
    const local = await cacheExternalImage(data.thumbnail);
    if (local) data.thumbnail = local;
  }

  const [record] = await db
    .insert(downloadHistoryTable)
    .values(data)
    .returning();

  res.status(201).json({
    ...record,
    downloadedAt: record.downloadedAt.toISOString(),
  });
});

export default router;
