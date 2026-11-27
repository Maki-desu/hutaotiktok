import { integer, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

export const customPushNotificationsTable = pgTable("custom_push_notifications", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  body: text("body").notNull(),
  accentType: text("accent_type").notNull().default("info"), // "info" | "update" | "warning" | "promo"
  targetRoute: text("target_route").notNull().default("/"),
  fcmDeliveredCount: integer("fcm_delivered_count").notNull().default(0),
  fcmDeviceCount: integer("fcm_device_count").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type CustomPushNotification = typeof customPushNotificationsTable.$inferSelect;
export type InsertCustomPushNotification = typeof customPushNotificationsTable.$inferInsert;
