import { Router, type IRouter } from "express";
import { eq, sql } from "drizzle-orm";
import { db, postNotificationsTable } from "@workspace/db";
import {
  ListNotificationsResponse,
  MarkNotificationReadParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/notifications", async (_req, res): Promise<void> => {
  const notifications = await db
    .select()
    .from(postNotificationsTable)
    .orderBy(sql`${postNotificationsTable.createdAt} DESC`)
    .limit(50);

  res.json(ListNotificationsResponse.parse(notifications.map(n => ({
    ...n,
    createdAt: n.createdAt.toISOString(),
  }))));
});

router.get("/notifications/unread-count", async (_req, res): Promise<void> => {
  const result = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(postNotificationsTable)
    .where(eq(postNotificationsTable.isRead, false));

  res.json({ count: result[0]?.count ?? 0 });
});

router.post("/notifications/:id/read", async (req, res): Promise<void> => {
  const params = MarkNotificationReadParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid ID" });
    return;
  }

  const [notification] = await db
    .update(postNotificationsTable)
    .set({ isRead: true })
    .where(eq(postNotificationsTable.id, params.data.id))
    .returning();

  if (!notification) {
    res.status(404).json({ error: "Notification not found" });
    return;
  }

  res.json({
    ...notification,
    createdAt: notification.createdAt.toISOString(),
  });
});

export default router;
