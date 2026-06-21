import { pgTable, text, serial, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const showcaseVideosTable = pgTable("showcase_videos", {
  id: serial("id").primaryKey(),
  tiktokUrl: text("tiktok_url").notNull(),
  videoId: text("video_id").notNull(),
  title: text("title").notNull(),
  authorUsername: text("author_username").notNull(),
  authorDisplayName: text("author_display_name"),
  authorAvatar: text("author_avatar"),
  thumbnail: text("thumbnail"),
  playUrl: text("play_url").notNull(),
  isPinned: boolean("is_pinned").notNull().default(false),
  pinnedAt: timestamp("pinned_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertShowcaseVideoSchema = createInsertSchema(showcaseVideosTable).omit({ id: true, createdAt: true });
export type InsertShowcaseVideo = z.infer<typeof insertShowcaseVideoSchema>;
export type ShowcaseVideo = typeof showcaseVideosTable.$inferSelect;
