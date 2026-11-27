import { integer, pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

export const suggestionsTable = pgTable("suggestions", {
  id: serial("id").primaryKey(),
  authorName: text("author_name").notNull().default("Anonymous"),
  content: text("content").notNull(),
  status: text("status").notNull().default("reviewing"), // "reviewing" | "approved" | "rejected" | "archived"
  upvotes: integer("upvotes").notNull().default(0),
  adminNote: text("admin_note"),
  reviewedAt: timestamp("reviewed_at"),
  archivedAt: timestamp("archived_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const suggestionVotesTable = pgTable(
  "suggestion_votes",
  {
    id: serial("id").primaryKey(),
    suggestionId: integer("suggestion_id")
      .notNull()
      .references(() => suggestionsTable.id, { onDelete: "cascade" }),
    voterId: text("voter_id").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("suggestion_votes_suggestion_voter_idx").on(table.suggestionId, table.voterId),
  ],
);

export type Suggestion = typeof suggestionsTable.$inferSelect;
export type InsertSuggestion = typeof suggestionsTable.$inferInsert;
export type SuggestionVote = typeof suggestionVotesTable.$inferSelect;
