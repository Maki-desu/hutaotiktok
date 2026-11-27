import { pgTable, text, integer, timestamp } from "drizzle-orm/pg-core";

export const appInstallationsTable = pgTable("app_installations", {
  installId: text("install_id").primaryKey(),
  versionCode: integer("version_code").notNull(),
  versionName: text("version_name").notNull(),
  platform: text("platform").notNull().default("android"),
  deviceModel: text("device_model"),
  androidVersion: text("android_version"),
  lastSeenAt: timestamp("last_seen_at").notNull().defaultNow(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type AppInstallation = typeof appInstallationsTable.$inferSelect;
