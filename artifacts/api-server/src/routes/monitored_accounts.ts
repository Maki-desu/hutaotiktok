import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, monitoredAccountsTable } from "@workspace/db";
import {
  AddMonitoredAccountBody,
  RemoveMonitoredAccountParams,
  ToggleMonitoredAccountBody,
  ToggleMonitoredAccountParams,
  ListMonitoredAccountsResponse,
} from "@workspace/api-zod";
import { requireAdmin } from "../middlewares/admin";
import { fetchTikwmUserInfo } from "../lib/tikwm";

const router: IRouter = Router();

function serializeAccount(a: typeof monitoredAccountsTable.$inferSelect) {
  return {
    id: a.id,
    tiktokUrl: a.tiktokUrl,
    username: a.username,
    displayName: a.displayName ?? null,
    bio: a.bio ?? null,
    avatarUrl: a.avatarUrl ?? null,
    notificationsEnabled: a.notificationsEnabled,
    lastCheckedAt: a.lastCheckedAt ? a.lastCheckedAt.toISOString() : null,
    createdAt: a.createdAt.toISOString(),
  };
}

router.get("/admin/monitored-accounts", requireAdmin, async (_req, res): Promise<void> => {
  const accounts = await db
    .select()
    .from(monitoredAccountsTable)
    .orderBy(monitoredAccountsTable.createdAt);

  res.json(ListMonitoredAccountsResponse.parse(accounts.map(serializeAccount)));
});

router.post("/admin/monitored-accounts", requireAdmin, async (req, res): Promise<void> => {
  const parsed = AddMonitoredAccountBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const info = await fetchTikwmUserInfo(parsed.data.username).catch(() => null);

  const [account] = await db
    .insert(monitoredAccountsTable)
    .values({
      tiktokUrl: parsed.data.tiktokUrl,
      username: parsed.data.username,
      notificationsEnabled: true,
      avatarUrl: info?.avatarUrl ?? null,
      displayName: info?.nickname ?? null,
      bio: info?.bio ?? null,
      lastVideoCount: info?.videoCount ?? null,
      lastCheckedAt: new Date(),
    })
    .returning();

  res.status(201).json(serializeAccount(account));
});

router.delete("/admin/monitored-accounts/:id", requireAdmin, async (req, res): Promise<void> => {
  const params = RemoveMonitoredAccountParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid ID" });
    return;
  }

  const [deleted] = await db
    .delete(monitoredAccountsTable)
    .where(eq(monitoredAccountsTable.id, params.data.id))
    .returning();

  if (!deleted) {
    res.status(404).json({ error: "Account not found" });
    return;
  }

  res.json({ success: true });
});

router.patch("/admin/monitored-accounts/:id", requireAdmin, async (req, res): Promise<void> => {
  const params = ToggleMonitoredAccountParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid ID" });
    return;
  }

  const parsed = ToggleMonitoredAccountBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [account] = await db
    .update(monitoredAccountsTable)
    .set({ notificationsEnabled: parsed.data.notificationsEnabled })
    .where(eq(monitoredAccountsTable.id, params.data.id))
    .returning();

  if (!account) {
    res.status(404).json({ error: "Account not found" });
    return;
  }

  res.json(serializeAccount(account));
});

export default router;
