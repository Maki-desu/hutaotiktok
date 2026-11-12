import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const appUpdateDevicesTable = pgTable("app_update_devices", {
  token: text("token").primaryKey(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  lastSeenAt: timestamp("last_seen_at").notNull().defaultNow(),
});
