import { apiUrl } from "@/lib/api-url";
import { getOrCreateInstallId } from "@/lib/app-updates";

export type SuggestionStatus = "reviewing" | "approved" | "rejected" | "archived";
export type SuggestionSort = "newest" | "top";

export interface SuggestionItem {
  id: number;
  authorName: string;
  content: string;
  status: SuggestionStatus;
  upvotes: number;
  hasUpvoted: boolean;
  adminNote: string | null;
  reviewedAt: string | null;
  archivedAt: string | null;
  autoArchiveAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SuggestionCounts {
  total: number;
  reviewing: number;
  approved: number;
  rejected: number;
  archived: number;
}

export interface SuggestionsResponse {
  suggestions: SuggestionItem[];
  counts: SuggestionCounts;
  autoArchiveDays: number;
}

export function getSuggestionStatusLabel(status: SuggestionStatus): string {
  switch (status) {
    case "approved":
      return "Approved";
    case "rejected":
      return "Rejected";
    case "archived":
      return "Archived";
    case "reviewing":
    default:
      return "Reviewing";
  }
}

export function formatRelativeTime(iso: string, nowMs = Date.now()): string {
  const parsed = new Date(iso).getTime();
  if (Number.isNaN(parsed)) return "";
  const diffSec = Math.max(0, Math.floor((nowMs - parsed) / 1000));
  if (diffSec < 60) return "Just now";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 7) return `${diffDay}d ago`;
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric" }).format(new Date(parsed));
}

export function formatArchiveCountdown(autoArchiveAt: string | null, nowMs = Date.now()): string | null {
  if (!autoArchiveAt) return null;
  const targetMs = new Date(autoArchiveAt).getTime();
  if (Number.isNaN(targetMs)) return null;
  const remainingMs = targetMs - nowMs;
  if (remainingMs <= 0) return "Archiving soon";
  const totalHours = Math.ceil(remainingMs / (60 * 60 * 1000));
  const days = Math.floor(totalHours / 24);
  const hours = totalHours % 24;
  if (days > 0 && hours > 0) return `Archives in ${days}d ${hours}h`;
  if (days > 0) return `Archives in ${days}d`;
  return `Archives in ${Math.max(1, hours)}h`;
}

async function parseJsonSafe(res: Response): Promise<Record<string, unknown>> {
  const text = await res.text();
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return {};
  } catch {
    if (res.status === 404) {
      throw new Error("Suggestions are not live on the API server yet. Push the latest backend to Render.");
    }
    throw new Error(`Unexpected response from server (HTTP ${res.status}).`);
  }
}

function normalizeSuggestion(raw: Record<string, unknown>): SuggestionItem {
  const item = raw as unknown as Partial<SuggestionItem>;
  return {
    id: typeof item.id === "number" ? item.id : 0,
    authorName: typeof item.authorName === "string" && item.authorName ? item.authorName : "Anonymous",
    content: typeof item.content === "string" ? item.content : "",
    status:
      item.status === "approved" ||
      item.status === "rejected" ||
      item.status === "archived"
        ? item.status
        : "reviewing",
    upvotes: typeof item.upvotes === "number" && Number.isFinite(item.upvotes) ? Math.max(0, item.upvotes) : 0,
    hasUpvoted: item.hasUpvoted === true,
    adminNote: typeof item.adminNote === "string" ? item.adminNote : null,
    reviewedAt: typeof item.reviewedAt === "string" ? item.reviewedAt : null,
    archivedAt: typeof item.archivedAt === "string" ? item.archivedAt : null,
    autoArchiveAt: typeof item.autoArchiveAt === "string" ? item.autoArchiveAt : null,
    createdAt: typeof item.createdAt === "string" ? item.createdAt : new Date().toISOString(),
    updatedAt: typeof item.updatedAt === "string" ? item.updatedAt : new Date().toISOString(),
  };
}

export async function fetchSuggestions(sort: SuggestionSort = "newest"): Promise<SuggestionsResponse> {
  const voterId = getOrCreateInstallId();
  const res = await fetch(
    apiUrl(`/api/suggestions?sort=${encodeURIComponent(sort)}&voterId=${encodeURIComponent(voterId)}`),
    { cache: "no-store" },
  );
  const data = await parseJsonSafe(res);
  if (!res.ok) {
    throw new Error(
      typeof data.error === "string" ? data.error : `Could not load suggestions (HTTP ${res.status}).`,
    );
  }
  const suggestions = Array.isArray(data.suggestions)
    ? data.suggestions.map((entry) => normalizeSuggestion(entry as Record<string, unknown>))
    : [];
  const counts = (data.counts as SuggestionCounts | undefined) ?? {
    total: suggestions.length,
    reviewing: suggestions.filter((s) => s.status === "reviewing").length,
    approved: suggestions.filter((s) => s.status === "approved").length,
    rejected: suggestions.filter((s) => s.status === "rejected").length,
    archived: suggestions.filter((s) => s.status === "archived").length,
  };
  const autoArchiveDays = typeof data.autoArchiveDays === "number" ? data.autoArchiveDays : 3;
  return { suggestions, counts, autoArchiveDays };
}

export async function submitSuggestion(input: {
  authorName: string;
  content: string;
}): Promise<SuggestionItem> {
  const voterId = getOrCreateInstallId();
  const res = await fetch(apiUrl("/api/suggestions"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      authorName: input.authorName.trim(),
      content: input.content.trim(),
      voterId,
    }),
  });
  const data = await parseJsonSafe(res);
  if (!res.ok || !data.suggestion) {
    throw new Error(
      typeof data.error === "string" ? data.error : `Could not send suggestion (HTTP ${res.status}).`,
    );
  }
  return normalizeSuggestion(data.suggestion as Record<string, unknown>);
}

export async function toggleSuggestionUpvote(
  suggestionId: number,
): Promise<{ id: number; upvotes: number; hasUpvoted: boolean }> {
  const voterId = getOrCreateInstallId();
  const res = await fetch(apiUrl(`/api/suggestions/${suggestionId}/upvote`), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ voterId }),
  });
  const data = await parseJsonSafe(res);
  if (!res.ok) {
    throw new Error(
      typeof data.error === "string" ? data.error : `Could not update vote (HTTP ${res.status}).`,
    );
  }
  return {
    id: suggestionId,
    upvotes: typeof data.upvotes === "number" ? Math.max(0, data.upvotes) : 0,
    hasUpvoted: data.hasUpvoted === true,
  };
}
