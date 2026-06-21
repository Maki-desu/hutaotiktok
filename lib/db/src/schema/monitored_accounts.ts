import { pgTable, text, serial, boolean, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const monitoredAccountsTable = pgTable("monitored_accounts", {
  id: serial("id").primaryKey(),
  tiktokUrl: text("tiktok_url").notNull(),
  username: text("username").notNull(),
  displayName: text("display_name"),
  bio: text("bio"),
  avatarUrl: text("avatar_url"),
  notificationsEnabled: boolean("notifications_enabled").notNull().default(true),
  lastCheckedAt: timestamp("last_checked_at"),
  lastVideoId: text("last_video_id"),
  lastVideoCount: integer("last_video_count"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertMonitoredAccountSchema = createInsertSchema(monitoredAccountsTable).omit({ id: true, createdAt: true });
export type InsertMonitoredAccount = z.infer<typeof insertMonitoredAccountSchema>;
export type MonitoredAccount = typeof monitoredAccountsTable.$inferSelect;
