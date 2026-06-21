import { pgTable, text, serial, boolean, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const adminSettingsTable = pgTable("admin_settings", {
  id: serial("id").primaryKey(),
  logoUrl: text("logo_url"),
  bannerUrl: text("banner_url"),
  tiktokProfileUrl: text("tiktok_profile_url"),
  tiktokAvatarUrl: text("tiktok_avatar_url"),
  siteTitle: text("site_title").notNull().default("HutaoTik"),
  footerText: text("footer_text").notNull().default("Powered by HutaoTik"),
  downloadsEnabled: boolean("downloads_enabled").notNull().default(true),
  alertsEnabled: boolean("alerts_enabled").notNull().default(true),
  historyEnabled: boolean("history_enabled").notNull().default(true),
  showcaseEnabled: boolean("showcase_enabled").notNull().default(true),
  maxShowcasePins: integer("max_showcase_pins").notNull().default(3),
  adminName: text("admin_name").notNull().default("Admin"),
  youtubeEnabled: boolean("youtube_enabled").notNull().default(true),
  facebookEnabled: boolean("facebook_enabled").notNull().default(true),
  analyzeEnabled: boolean("analyze_enabled").notNull().default(true),
});

export const insertAdminSettingsSchema = createInsertSchema(adminSettingsTable).omit({ id: true });
export type InsertAdminSettings = z.infer<typeof insertAdminSettingsSchema>;
export type AdminSettings = typeof adminSettingsTable.$inferSelect;
