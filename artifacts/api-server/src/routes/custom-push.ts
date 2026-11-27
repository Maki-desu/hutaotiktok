import { Router, type IRouter } from "express";
import { desc, eq, sql } from "drizzle-orm";
import {
  db,
  customPushNotificationsTable,
  type CustomPushNotification,
} from "@workspace/db";
import { requireAdmin } from "../middlewares/admin";
import { logger } from "../lib/logger";
import { notifyCustomPushDevices } from "../lib/push-notifications";

const router: IRouter = Router();

const ALLOWED_ACCENTS = new Set(["info", "update", "warning", "promo"] as const);
const ALLOWED_ROUTES = new Set([
  "/",
  "/updates",
  "/suggestions",
  "/history",
  "/taotools",
  "/settings",
] as const);

type AccentType = "info" | "update" | "warning" | "promo";

let tableEnsured = false;

async function ensureCustomPushTable(): Promise<void> {
  if (tableEnsured) return;
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS custom_push_notifications (
        id serial PRIMARY KEY,
        title text NOT NULL,
        body text NOT NULL,
        accent_type text NOT NULL DEFAULT 'info',
        target_route text NOT NULL DEFAULT '/',
        fcm_delivered_count integer NOT NULL DEFAULT 0,
        fcm_device_count integer NOT NULL DEFAULT 0,
        created_at timestamp NOT NULL DEFAULT now()
      )
    `);
    tableEnsured = true;
  } catch (err) {
    logger.warn({ err }, "Could not auto-ensure custom_push_notifications table.");
  }
}

function serializeCustomPush(row: CustomPushNotification) {
  const accentType: AccentType = ALLOWED_ACCENTS.has(row.accentType as AccentType)
    ? (row.accentType as AccentType)
    : "info";
  const targetRoute = ALLOWED_ROUTES.has(row.targetRoute as "/" | "/updates")
    ? row.targetRoute
    : "/";
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    accentType,
    targetRoute,
    fcmDeliveredCount: Math.max(0, row.fcmDeliveredCount ?? 0),
    fcmDeviceCount: Math.max(0, row.fcmDeviceCount ?? 0),
    createdAt: row.createdAt.toISOString(),
  };
}

/* ── Public endpoint polled by hutaotik.apk (background + foreground) ── */
router.get("/push-notifications/latest", async (_req, res): Promise<void> => {
  await ensureCustomPushTable();
  try {
    const [latest] = await db
      .select()
      .from(customPushNotificationsTable)
      .orderBy(desc(customPushNotificationsTable.id))
      .limit(1);

    res.json({
      notification: latest ? serializeCustomPush(latest) : null,
    });
  } catch (err) {
    logger.error({ err }, "Failed to fetch latest custom push notification.");
    res.status(500).json({ error: "Could not load push notifications." });
  }
});

/* ── Admin endpoints (Hutaotik-Admin.apk) ─────────────────────────────── */
router.get("/admin/push-notifications", requireAdmin, async (_req, res): Promise<void> => {
  await ensureCustomPushTable();
  try {
    const rows = await db
      .select()
      .from(customPushNotificationsTable)
      .orderBy(desc(customPushNotificationsTable.id))
      .limit(50);

    res.json({
      notifications: rows.map(serializeCustomPush),
    });
  } catch (err) {
    logger.error({ err }, "Failed to list admin custom push notifications.");
    res.status(500).json({ error: "Could not load custom push history." });
  }
});

router.post("/admin/push-notifications", requireAdmin, async (req, res): Promise<void> => {
  await ensureCustomPushTable();
  try {
    const raw = (req.body ?? {}) as Record<string, unknown>;
    const title = typeof raw.title === "string" ? raw.title.trim() : "";
    const body = typeof raw.body === "string" ? raw.body.trim() : "";
    const rawAccent = typeof raw.accentType === "string" ? raw.accentType.trim().toLowerCase() : "info";
    const rawRoute = typeof raw.targetRoute === "string" ? raw.targetRoute.trim() : "/";

    if (!title || title.length > 100) {
      res.status(400).json({ error: "Enter a notification title (1–100 characters)." });
      return;
    }
    if (!body || body.length > 500) {
      res.status(400).json({ error: "Enter a notification message (1–500 characters)." });
      return;
    }

    const accentType: AccentType = ALLOWED_ACCENTS.has(rawAccent as AccentType)
      ? (rawAccent as AccentType)
      : "info";
    const targetRoute = ALLOWED_ROUTES.has(rawRoute as "/" | "/updates") ? rawRoute : "/";

    const [created] = await db
      .insert(customPushNotificationsTable)
      .values({
        title,
        body,
        accentType,
        targetRoute,
      })
      .returning();

    const push = await notifyCustomPushDevices(
      created.id,
      created.title,
      created.body,
      created.accentType,
      created.targetRoute,
    );

    let finalRow = created;
    if (push.deliveredCount > 0 || push.deviceCount > 0) {
      const [updated] = await db
        .update(customPushNotificationsTable)
        .set({
          fcmDeliveredCount: push.deliveredCount,
          fcmDeviceCount: push.deviceCount,
        })
        .where(eq(customPushNotificationsTable.id, created.id))
        .returning();
      if (updated) finalRow = updated;
    }

    res.status(201).json({
      notification: serializeCustomPush(finalRow),
      push,
    });
  } catch (err) {
    logger.error({ err }, "Failed to send custom push notification.");
    res.status(500).json({ error: "Could not send custom push notification." });
  }
});

router.delete("/admin/push-notifications/:id", requireAdmin, async (req, res): Promise<void> => {
  await ensureCustomPushTable();
  const id = Number.parseInt(String(req.params.id ?? ""), 10);
  if (!Number.isSafeInteger(id) || id < 1) {
    res.status(400).json({ error: "Invalid push notification ID." });
    return;
  }
  try {
    const [deleted] = await db
      .delete(customPushNotificationsTable)
      .where(eq(customPushNotificationsTable.id, id))
      .returning();

    if (!deleted) {
      res.status(404).json({ error: "Custom push notification not found." });
      return;
    }
    res.json({ success: true });
  } catch (err) {
    logger.error({ err }, "Failed to delete custom push notification.");
    res.status(500).json({ error: "Could not delete custom push notification." });
  }
});

export default router;
