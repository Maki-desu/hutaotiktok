import { Router, type IRouter } from "express";
import { eq, and, or, isNull, gt } from "drizzle-orm";
import { db, announcementsTable } from "@workspace/db";
import {
  ListAnnouncementsResponse,
  AdminListAnnouncementsResponse,
  CreateAnnouncementBody,
  UpdateAnnouncementBody,
  UpdateAnnouncementParams,
  DeleteAnnouncementParams,
} from "@workspace/api-zod";
import { requireAdmin } from "../middlewares/admin";

const router: IRouter = Router();

router.get("/announcements", async (_req, res): Promise<void> => {
  const now = new Date();
  const announcements = await db
    .select()
    .from(announcementsTable)
    .where(
      and(
        eq(announcementsTable.isActive, true),
        or(
          eq(announcementsTable.isPermanent, true),
          and(
            isNull(announcementsTable.expiresAt),
            eq(announcementsTable.isPermanent, false)
          ),
          gt(announcementsTable.expiresAt, now)
        )
      )
    )
    .orderBy(announcementsTable.createdAt);

  res.json(ListAnnouncementsResponse.parse(announcements.map(a => ({
    ...a,
    expiresAt: a.expiresAt ? a.expiresAt.toISOString() : null,
    createdAt: a.createdAt.toISOString(),
  }))));
});

router.get("/admin/announcements", requireAdmin, async (_req, res): Promise<void> => {
  const announcements = await db
    .select()
    .from(announcementsTable)
    .orderBy(announcementsTable.createdAt);

  res.json(AdminListAnnouncementsResponse.parse(announcements.map(a => ({
    ...a,
    expiresAt: a.expiresAt ? a.expiresAt.toISOString() : null,
    createdAt: a.createdAt.toISOString(),
  }))));
});

router.post("/admin/announcements", requireAdmin, async (req, res): Promise<void> => {
  const parsed = CreateAnnouncementBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { content, colorType, durationDays, isPermanent } = parsed.data;

  let expiresAt: Date | null = null;
  if (!isPermanent && durationDays != null) {
    expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + durationDays);
  }

  const [announcement] = await db
    .insert(announcementsTable)
    .values({ content, colorType, expiresAt, isPermanent, isActive: true })
    .returning();

  res.status(201).json({
    ...announcement,
    expiresAt: announcement.expiresAt ? announcement.expiresAt.toISOString() : null,
    createdAt: announcement.createdAt.toISOString(),
  });
});

router.put("/admin/announcements/:id", requireAdmin, async (req, res): Promise<void> => {
  const params = UpdateAnnouncementParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid ID" });
    return;
  }

  const parsed = UpdateAnnouncementBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { content, colorType, durationDays, isPermanent, isActive } = parsed.data;

  const updateData: Record<string, unknown> = {};
  if (content !== undefined) updateData.content = content;
  if (colorType !== undefined) updateData.colorType = colorType;
  if (isActive !== undefined) updateData.isActive = isActive;
  if (isPermanent !== undefined) {
    updateData.isPermanent = isPermanent;
    if (isPermanent) {
      updateData.expiresAt = null;
    } else if (durationDays != null) {
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + durationDays);
      updateData.expiresAt = expiresAt;
    }
  }

  const [announcement] = await db
    .update(announcementsTable)
    .set(updateData)
    .where(eq(announcementsTable.id, params.data.id))
    .returning();

  if (!announcement) {
    res.status(404).json({ error: "Announcement not found" });
    return;
  }

  res.json({
    ...announcement,
    expiresAt: announcement.expiresAt ? announcement.expiresAt.toISOString() : null,
    createdAt: announcement.createdAt.toISOString(),
  });
});

router.delete("/admin/announcements/:id", requireAdmin, async (req, res): Promise<void> => {
  const params = DeleteAnnouncementParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid ID" });
    return;
  }

  const [deleted] = await db
    .delete(announcementsTable)
    .where(eq(announcementsTable.id, params.data.id))
    .returning();

  if (!deleted) {
    res.status(404).json({ error: "Announcement not found" });
    return;
  }

  res.json({ success: true });
});

export default router;
