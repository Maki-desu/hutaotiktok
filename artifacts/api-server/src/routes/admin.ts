import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, adminSettingsTable } from "@workspace/db";
import {
  AdminLoginBody,
  UpdateAdminSettingsBody,
} from "@workspace/api-zod";
import {
  requireAdmin,
  createAdminToken,
  timingSafeStringEqual,
} from "../middlewares/admin";

const router: IRouter = Router();

router.post("/admin/login", async (req, res): Promise<void> => {
  const parsed = AdminLoginBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }

  const adminPassword = process.env.ADMIN_PASSWORD;
  const sessionSecret = process.env.ADMIN_SESSION_SECRET;
  if (!adminPassword || !sessionSecret || sessionSecret.length < 32) {
    res.status(503).json({ error: "Admin login is not securely configured on the server." });
    return;
  }

  if (!timingSafeStringEqual(parsed.data.password, adminPassword)) {
    res.status(401).json({ error: "Invalid password" });
    return;
  }

  res.json({ token: createAdminToken(), success: true });
});

async function getOrCreateSettings() {
  const existing = await db.select().from(adminSettingsTable).limit(1);
  if (existing.length > 0) return existing[0];
  const [created] = await db.insert(adminSettingsTable).values({
    siteTitle: "HutaoTik",
    footerText: "Powered by Makisensei",
    downloadsEnabled: true,
    alertsEnabled: true,
    historyEnabled: true,
    showcaseEnabled: true,
    maxShowcasePins: 3,
    adminName: "Admin",
    youtubeEnabled: true,
    facebookEnabled: true,
    analyzeEnabled: true,
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
    analyzeEnabled: settings.analyzeEnabled,
  });
});

export default router;
