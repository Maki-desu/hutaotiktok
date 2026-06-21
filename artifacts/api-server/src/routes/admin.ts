import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, adminSettingsTable } from "@workspace/db";
import {
  AdminLoginBody,
  UpdateAdminSettingsBody,
} from "@workspace/api-zod";
import { requireAdmin, ADMIN_PASSWORD, ADMIN_TOKEN } from "../middlewares/admin";

const router: IRouter = Router();

router.post("/admin/login", async (req, res): Promise<void> => {
  const parsed = AdminLoginBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }

  if (parsed.data.password !== ADMIN_PASSWORD) {
    res.status(401).json({ error: "Invalid password" });
    return;
  }

  res.json({ token: ADMIN_TOKEN, success: true });
});

async function getOrCreateSettings() {
  const existing = await db.select().from(adminSettingsTable).limit(1);
  if (existing.length > 0) return existing[0];
  const [created] = await db.insert(adminSettingsTable).values({
    siteTitle: "HutaoTik",
    footerText: "Powered by HutaoTik",
    downloadsEnabled: true,
    alertsEnabled: true,
    historyEnabled: true,
    showcaseEnabled: true,
    maxShowcasePins: 3,
    adminName: "Admin",
    youtubeEnabled: true,
    facebookEnabled: true,
  }).returning();
  return created;
}

router.get("/admin/settings", requireAdmin, async (_req, res): Promise<void> => {
  const settings = await getOrCreateSettings();
  res.json(settings);
});

router.put("/admin/settings", requireAdmin, async (req, res): Promise<void> => {
  const parsed = UpdateAdminSettingsBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const settings = await getOrCreateSettings();
  const [updated] = await db
    .update(adminSettingsTable)
    .set(parsed.data)
    .where(eq(adminSettingsTable.id, settings.id))
    .returning();

  res.json(updated);
});

router.get("/admin/settings/public", async (_req, res): Promise<void> => {
  const settings = await getOrCreateSettings();
  res.json({
    logoUrl: settings.logoUrl ?? null,
    bannerUrl: settings.bannerUrl ?? null,
    tiktokProfileUrl: settings.tiktokProfileUrl ?? null,
    tiktokAvatarUrl: settings.tiktokAvatarUrl ?? null,
    siteTitle: settings.siteTitle,
    footerText: settings.footerText,
    downloadsEnabled: settings.downloadsEnabled,
    alertsEnabled: settings.alertsEnabled,
    historyEnabled: settings.historyEnabled,
    showcaseEnabled: settings.showcaseEnabled,
    adminName: settings.adminName,
    youtubeEnabled: settings.youtubeEnabled,
    facebookEnabled: settings.facebookEnabled,
  });
});

export default router;
