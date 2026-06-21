import { pgTable, text, serial, boolean, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const postNotificationsTable = pgTable("post_notifications", {
  id: serial("id").primaryKey(),
  monitoredAccountId: integer("monitored_account_id").notNull(),
  username: text("username").notNull(),
  avatarUrl: text("avatar_url"),
  videoId: text("video_id").notNull(),
  videoTitle: text("video_title").notNull(),
  thumbnail: text("thumbnail"),
  videoUrl: text("video_url").notNull(),
  isRead: boolean("is_read").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertPostNotificationSchema = createInsertSchema(postNotificationsTable).omit({ id: true, createdAt: true });
export type InsertPostNotification = z.infer<typeof insertPostNotificationSchema>;
export type PostNotification = typeof postNotificationsTable.$inferSelect;
