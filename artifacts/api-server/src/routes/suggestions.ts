import { Router, type IRouter } from "express";
import { and, desc, eq, lte, sql } from "drizzle-orm";
import { db, suggestionsTable, suggestionVotesTable, type Suggestion } from "@workspace/db";
import { requireAdmin } from "../middlewares/admin";
import { logger } from "../lib/logger";

const router: IRouter = Router();

export const SUGGESTION_AUTO_ARCHIVE_DAYS = 3;
export const SUGGESTION_AUTO_ARCHIVE_MS = SUGGESTION_AUTO_ARCHIVE_DAYS * 24 * 60 * 60 * 1000;
const ALLOWED_STATUSES = new Set(["reviewing", "approved", "rejected", "archived"] as const);
type SuggestionStatus = "reviewing" | "approved" | "rejected" | "archived";

// Lightweight per-IP rate limiter to prevent spam (max 6 submissions per 5 minutes)
const RATE_LIMIT_WINDOW_MS = 5 * 60 * 1000;
const RATE_LIMIT_MAX = 6;
const recentSubmissionsByIp = new Map<string, number[]>();

function isRateLimited(ip: string, nowMs = Date.now()): boolean {
  const history = recentSubmissionsByIp.get(ip) ?? [];
  const fresh = history.filter((ts) => nowMs - ts < RATE_LIMIT_WINDOW_MS);
  if (fresh.length >= RATE_LIMIT_MAX) {
    recentSubmissionsByIp.set(ip, fresh);
    return true;
  }
  fresh.push(nowMs);
  recentSubmissionsByIp.set(ip, fresh);
  if (recentSubmissionsByIp.size > 500) {
    for (const [key, timestamps] of recentSubmissionsByIp.entries()) {
      if (timestamps.every((ts) => nowMs - ts >= RATE_LIMIT_WINDOW_MS)) {
        recentSubmissionsByIp.delete(key);
      }
    }
  }
  return false;
}

function isValidVoterId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{8,80}$/.test(value);
}

export function getAutoArchiveCutoff(now = new Date()): Date {
  return new Date(now.getTime() - SUGGESTION_AUTO_ARCHIVE_MS);
}

export async function archiveStaleSuggestions(now = new Date()): Promise<number> {
  const cutoff = getAutoArchiveCutoff(now);
  try {
    const archived = await db
      .update(suggestionsTable)
      .set({
        status: "archived",
        archivedAt: now,
        updatedAt: now,
      })
      .where(
        and(
          eq(suggestionsTable.status, "reviewing"),
          lte(suggestionsTable.createdAt, cutoff),
        ),
      )
      .returning({ id: suggestionsTable.id });
    return archived.length;
  } catch (err) {
    logger.error({ err }, "Failed to auto-archive stale suggestions.");
    return 0;
  }
}

function serializeSuggestion(row: Suggestion, votedIds?: Set<number>) {
  const status: SuggestionStatus = ALLOWED_STATUSES.has(row.status as SuggestionStatus)
    ? (row.status as SuggestionStatus)
    : "reviewing";
  const autoArchiveAt =
    status === "reviewing"
      ? new Date(row.createdAt.getTime() + SUGGESTION_AUTO_ARCHIVE_MS).toISOString()
      : null;

  return {
    id: row.id,
    authorName: row.authorName || "Anonymous",
    content: row.content,
    status,
    upvotes: Math.max(0, row.upvotes ?? 0),
    hasUpvoted: votedIds ? votedIds.has(row.id) : false,
    adminNote: row.adminNote ?? null,
    reviewedAt: row.reviewedAt ? row.reviewedAt.toISOString() : null,
    archivedAt: row.archivedAt ? row.archivedAt.toISOString() : null,
    autoArchiveAt,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function buildCounts(rows: Suggestion[]) {
  let reviewing = 0;
  let approved = 0;
  let rejected = 0;
  let archived = 0;

  for (const row of rows) {
    if (row.status === "approved") approved += 1;
    else if (row.status === "rejected") rejected += 1;
    else if (row.status === "archived") archived += 1;
    else reviewing += 1;
  }

  return {
    total: rows.length,
    reviewing,
    approved,
    rejected,
    archived,
  };
}

/* ── Public Suggestion Endpoints (hutaotik.apk) ────────────── */

router.get("/suggestions", async (req, res): Promise<void> => {
  await archiveStaleSuggestions();

  const sortByTop = req.query.sort === "top";
  const voterId = isValidVoterId(req.query.voterId) ? req.query.voterId : null;

  const [rows, voterRows] = await Promise.all([
    db
      .select()
      .from(suggestionsTable)
      .orderBy(
        ...(sortByTop
          ? [desc(suggestionsTable.upvotes), desc(suggestionsTable.createdAt)]
          : [desc(suggestionsTable.createdAt)]),
      )
      .limit(120),
    voterId
      ? db
          .select({ suggestionId: suggestionVotesTable.suggestionId })
          .from(suggestionVotesTable)
          .where(eq(suggestionVotesTable.voterId, voterId))
      : Promise.resolve([]),
  ]);

  const votedIds = new Set(voterRows.map((v) => v.suggestionId));

  res.json({
    suggestions: rows.map((row) => serializeSuggestion(row, votedIds)),
    counts: buildCounts(rows),
    autoArchiveDays: SUGGESTION_AUTO_ARCHIVE_DAYS,
  });
});

router.post("/suggestions", async (req, res): Promise<void> => {
  const clientIp =
    (typeof req.headers["x-forwarded-for"] === "string"
      ? req.headers["x-forwarded-for"].split(",")[0]?.trim()
      : undefined) ||
    req.socket.remoteAddress ||
    "unknown";

  if (isRateLimited(clientIp)) {
    res.status(429).json({
      error: "You have sent too many suggestions recently. Please wait a few minutes and try again.",
    });
    return;
  }

  const rawContent = typeof req.body?.content === "string" ? req.body.content.trim() : "";
  const rawAuthor = typeof req.body?.authorName === "string" ? req.body.authorName.trim() : "";
  const voterId = isValidVoterId(req.body?.voterId) ? req.body.voterId : null;

  if (rawContent.length < 3 || rawContent.length > 1000) {
    res.status(400).json({
      error: "Please write a suggestion between 3 and 1,000 characters.",
    });
    return;
  }

  if (rawAuthor.length > 40) {
    res.status(400).json({
      error: "Name must be 40 characters or fewer.",
    });
    return;
  }

  const now = new Date();
  const [created] = await db
    .insert(suggestionsTable)
    .values({
      authorName: rawAuthor || "Anonymous",
      content: rawContent,
      status: "reviewing",
      upvotes: voterId ? 1 : 0,
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  const votedIds = new Set<number>();
  if (voterId && created) {
    try {
      await db
        .insert(suggestionVotesTable)
        .values({ suggestionId: created.id, voterId })
        .onConflictDoNothing();
      votedIds.add(created.id);
    } catch {
      /* non-fatal auto-upvote */
    }
  }

  res.status(201).json({
    suggestion: serializeSuggestion(created, votedIds),
  });
});

router.post("/suggestions/:id/upvote", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const voterId = req.body?.voterId;
  if (!Number.isSafeInteger(id) || id < 1) {
    res.status(400).json({ error: "Invalid suggestion ID." });
    return;
  }
  if (!isValidVoterId(voterId)) {
    res.status(400).json({ error: "Valid voter ID is required." });
    return;
  }

  const [existingSuggestion] = await db
    .select({ id: suggestionsTable.id })
    .from(suggestionsTable)
    .where(eq(suggestionsTable.id, id))
    .limit(1);

  if (!existingSuggestion) {
    res.status(404).json({ error: "Suggestion not found." });
    return;
  }

  const deletedVote = await db
    .delete(suggestionVotesTable)
    .where(
      and(
        eq(suggestionVotesTable.suggestionId, id),
        eq(suggestionVotesTable.voterId, voterId),
      ),
    )
    .returning({ id: suggestionVotesTable.id });

  let hasUpvoted: boolean;
  if (deletedVote.length > 0) {
    hasUpvoted = false;
  } else {
    await db
      .insert(suggestionVotesTable)
      .values({ suggestionId: id, voterId })
      .onConflictDoNothing();
    hasUpvoted = true;
  }

  const [voteCountRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(suggestionVotesTable)
    .where(eq(suggestionVotesTable.suggestionId, id));

  const nextUpvotes = Math.max(0, voteCountRow?.count ?? 0);
  await db
    .update(suggestionsTable)
    .set({ upvotes: nextUpvotes })
    .where(eq(suggestionsTable.id, id));

  res.json({
    id,
    upvotes: nextUpvotes,
    hasUpvoted,
  });
});

/* ── Admin Suggestion Box Endpoints (Hutaotik-Admin.apk) ───── */

router.get("/admin/suggestions", requireAdmin, async (req, res): Promise<void> => {
  await archiveStaleSuggestions();

  const sortByTop = req.query.sort === "top";
  const rows = await db
    .select()
    .from(suggestionsTable)
    .orderBy(
      ...(sortByTop
        ? [desc(suggestionsTable.upvotes), desc(suggestionsTable.createdAt)]
        : [desc(suggestionsTable.createdAt)]),
    )
    .limit(200);

  res.json({
    suggestions: rows.map((row) => serializeSuggestion(row)),
    counts: buildCounts(rows),
    autoArchiveDays: SUGGESTION_AUTO_ARCHIVE_DAYS,
  });
});

router.patch("/admin/suggestions/:id", requireAdmin, async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id < 1) {
    res.status(400).json({ error: "Invalid suggestion ID." });
    return;
  }

  const now = new Date();
  const updates: Partial<typeof suggestionsTable.$inferInsert> = {
    updatedAt: now,
  };

  if (req.body?.status !== undefined) {
    if (
      typeof req.body.status !== "string" ||
      !ALLOWED_STATUSES.has(req.body.status as SuggestionStatus)
    ) {
      res.status(400).json({ error: "Status must be reviewing, approved, rejected, or archived." });
      return;
    }
    const nextStatus = req.body.status as SuggestionStatus;
    updates.status = nextStatus;

    if (nextStatus === "approved" || nextStatus === "rejected") {
      updates.reviewedAt = now;
      updates.archivedAt = null;
    } else if (nextStatus === "archived") {
      updates.archivedAt = now;
    } else {
      updates.reviewedAt = null;
      updates.archivedAt = null;
      updates.createdAt = now;
    }
  }

  if (req.body?.adminNote !== undefined) {
    if (req.body.adminNote === null || req.body.adminNote === "") {
      updates.adminNote = null;
    } else if (typeof req.body.adminNote === "string" && req.body.adminNote.trim().length <= 500) {
      updates.adminNote = req.body.adminNote.trim();
    } else {
      res.status(400).json({ error: "Admin note must be 500 characters or fewer." });
      return;
    }
  }

  const [updated] = await db
    .update(suggestionsTable)
    .set(updates)
    .where(eq(suggestionsTable.id, id))
    .returning();

  if (!updated) {
    res.status(404).json({ error: "Suggestion not found." });
    return;
  }

  res.json({ suggestion: serializeSuggestion(updated) });
});

router.delete("/admin/suggestions/:id", requireAdmin, async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id < 1) {
    res.status(400).json({ error: "Invalid suggestion ID." });
    return;
  }

  const [deleted] = await db
    .delete(suggestionsTable)
    .where(eq(suggestionsTable.id, id))
    .returning({ id: suggestionsTable.id });

  if (!deleted) {
    res.status(404).json({ error: "Suggestion not found." });
    return;
  }

  res.json({ success: true, id: deleted.id });
});

export default router;
