import { pgTable, text, serial, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const downloadHistoryTable = pgTable("download_history", {
  id: serial("id").primaryKey(),
  videoId: text("video_id").notNull(),
  title: text("title").notNull(),
  author: text("author").notNull(),
  authorUsername: text("author_username").notNull(),
  thumbnail: text("thumbnail"),
  quality: text("quality").notNull(),
  downloadedAt: timestamp("downloaded_at").notNull().defaultNow(),
});

export const insertDownloadHistorySchema = createInsertSchema(downloadHistoryTable).omit({ id: true, downloadedAt: true });
export type InsertDownloadHistory = z.infer<typeof insertDownloadHistorySchema>;
export type DownloadHistory = typeof downloadHistoryTable.$inferSelect;
