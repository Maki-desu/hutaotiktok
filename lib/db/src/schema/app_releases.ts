import {
  pgTable,
  serial,
  integer,
  text,
  boolean,
  timestamp,
} from "drizzle-orm/pg-core";

export const appReleasesTable = pgTable("app_releases", {
  id: serial("id").primaryKey(),
  versionCode: integer("version_code").notNull().unique(),
  versionName: text("version_name").notNull(),
  changelog: text("changelog").notNull(),
  downloadUrl: text("download_url"),
  fileName: text("file_name"),
  fileSize: integer("file_size"),
  sha256: text("sha256"),
  isMandatory: boolean("is_mandatory").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type AppRelease = typeof appReleasesTable.$inferSelect;
