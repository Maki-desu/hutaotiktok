import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  AlertTriangle,
  Archive,
  CheckCircle2,
  Clock,
  Flame,
  Lightbulb,
  Loader2,
  MessageSquareText,
  RefreshCw,
  Send,
  ThumbsUp,
  XCircle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import {
  fetchSuggestions,
  formatArchiveCountdown,
  formatRelativeTime,
  getSuggestionStatusLabel,
  submitSuggestion,
  toggleSuggestionUpvote,
  type SuggestionCounts,
  type SuggestionItem,
  type SuggestionSort,
  type SuggestionStatus,
} from "@/lib/suggestions";

const SAVED_AUTHOR_KEY = "hutaotik_suggestion_author";

type FilterValue = "all" | SuggestionStatus;

function StatusBadge({ status }: { status: SuggestionStatus }) {
  if (status === "approved") {
    return (
      <Badge className="gap-1 border border-emerald-500/35 bg-emerald-500/15 text-[11px] font-semibold text-emerald-400 hover:bg-emerald-500/20">
        <CheckCircle2 className="h-3 w-3 shrink-0" />
        {getSuggestionStatusLabel(status)}
      </Badge>
    );
  }
  if (status === "rejected") {
    return (
      <Badge className="gap-1 border border-rose-500/35 bg-rose-500/15 text-[11px] font-semibold text-rose-400 hover:bg-rose-500/20">
        <XCircle className="h-3 w-3 shrink-0" />
        {getSuggestionStatusLabel(status)}
      </Badge>
    );
  }
  if (status === "archived") {
    return (
      <Badge variant="outline" className="gap-1 border-border bg-muted/60 text-[11px] font-semibold text-muted-foreground">
        <Archive className="h-3 w-3 shrink-0" />
        {getSuggestionStatusLabel(status)}
      </Badge>
    );
  }
  return (
    <Badge className="gap-1 border border-amber-500/35 bg-amber-500/15 text-[11px] font-semibold text-amber-400 hover:bg-amber-500/20">
      <Clock className="h-3 w-3 shrink-0" />
      {getSuggestionStatusLabel(status)}
    </Badge>
  );
}

export default function Suggestions() {
  const { toast } = useToast();
  const [authorName, setAuthorName] = useState(
    () => localStorage.getItem(SAVED_AUTHOR_KEY) ?? "",
  );
  const [content, setContent] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const [suggestions, setSuggestions] = useState<SuggestionItem[]>([]);
  const [counts, setCounts] = useState<SuggestionCounts>({
    total: 0,
    reviewing: 0,
    approved: 0,
    rejected: 0,
    archived: 0,
  });
  const [autoArchiveDays, setAutoArchiveDays] = useState(3);
  const [filter, setFilter] = useState<FilterValue>("all");
  const [sort, setSort] = useState<SuggestionSort>("top");
  const [votingIds, setVotingIds] = useState<Record<number, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadSuggestions = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchSuggestions(sort);
      setSuggestions(data.suggestions);
      setCounts(data.counts);
      setAutoArchiveDays(data.autoArchiveDays);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load suggestions.");
    } finally {
      setLoading(false);
    }
  }, [sort]);

  useEffect(() => {
    void loadSuggestions();
  }, [loadSuggestions]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = content.trim();
    if (trimmed.length < 3) {
      toast({
        title: "Suggestion is too short",
        description: "Write at least 3 characters before sending.",
        variant: "destructive",
      });
      return;
    }

    setSubmitting(true);
    try {
      const trimmedAuthor = authorName.trim();
      if (trimmedAuthor) {
        localStorage.setItem(SAVED_AUTHOR_KEY, trimmedAuthor);
      } else {
        localStorage.removeItem(SAVED_AUTHOR_KEY);
      }

      const created = await submitSuggestion({
        authorName: trimmedAuthor,
        content: trimmed,
      });

      setSuggestions((prev) => [created, ...prev]);
      setCounts((prev) => ({
        ...prev,
        total: prev.total + 1,
        reviewing: prev.reviewing + 1,
      }));
      setContent("");
      setFilter("all");
      toast({
        title: "Suggestion sent!",
        description: "Sent to Hutaotik Admin — status is now Reviewing.",
      });
    } catch (err) {
      toast({
        title: "Could not send suggestion",
        description: err instanceof Error ? err.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleUpvote = async (item: SuggestionItem) => {
    if (votingIds[item.id]) return;
    const prevUpvotes = item.upvotes;
    const prevVoted = item.hasUpvoted;

    // Optimistic toggle
    setVotingIds((prev) => ({ ...prev, [item.id]: true }));
    setSuggestions((prev) =>
      prev.map((s) =>
        s.id === item.id
          ? {
              ...s,
              hasUpvoted: !prevVoted,
              upvotes: Math.max(0, prevUpvotes + (prevVoted ? -1 : 1)),
            }
          : s,
      ),
    );

    try {
      const updated = await toggleSuggestionUpvote(item.id);
      setSuggestions((prev) =>
        prev.map((s) =>
          s.id === item.id
            ? { ...s, upvotes: updated.upvotes, hasUpvoted: updated.hasUpvoted }
            : s,
        ),
      );
    } catch (err) {
      // Rollback optimistic change on failure
      setSuggestions((prev) =>
        prev.map((s) =>
          s.id === item.id ? { ...s, upvotes: prevUpvotes, hasUpvoted: prevVoted } : s,
        ),
      );
      toast({
        title: "Could not update upvote",
        description: err instanceof Error ? err.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setVotingIds((prev) => {
        const next = { ...prev };
        delete next[item.id];
        return next;
      });
    }
  };

  const filteredSuggestions = suggestions.filter((item) => {
    if (filter === "all") return item.status !== "archived";
    return item.status === filter;
  });

  const activeCount = counts.reviewing + counts.approved + counts.rejected;

  const filterButtons: Array<{ key: FilterValue; label: string; count: number }> = [
    { key: "all", label: "All", count: activeCount },
    { key: "reviewing", label: "Reviewing", count: counts.reviewing },
    { key: "approved", label: "Approved", count: counts.approved },
    { key: "rejected", label: "Rejected", count: counts.rejected },
    { key: "archived", label: "Archived", count: counts.archived },
  ];

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 animate-card-bounce-in">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/15 text-primary">
              <Lightbulb className="h-5 w-5" />
            </span>
            <div>
              <h2 className="font-syne text-xl font-extrabold leading-tight">Suggestions</h2>
              <p className="text-xs text-muted-foreground">
                Send ideas to Hutaotik Admin and upvote the features you want most.
              </p>
            </div>
          </div>
        </div>
        <Button
          type="button"
          variant="outline"
          size="icon"
          onClick={() => void loadSuggestions()}
          disabled={loading}
          title="Refresh suggestions"
          className="h-9 w-9 shrink-0 rounded-xl"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
        </Button>
      </div>

      {/* Submit Box */}
      <section className="rounded-2xl border border-border bg-card p-4 sm:p-5 shadow-sm animate-card-bounce-in">
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-bold text-foreground">Submit a suggestion</h3>
            <span className="font-mono text-[11px] text-muted-foreground">
              {content.trim().length}/1000
            </span>
          </div>

          <Input
            value={authorName}
            onChange={(e) => setAuthorName(e.target.value)}
            maxLength={40}
            placeholder="Your name (optional — defaults to Anonymous)"
            className="h-10 rounded-xl bg-background/70 text-sm"
          />

          <Textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            maxLength={1000}
            rows={3}
            placeholder="Type your feature idea, improvement, or bug report…"
            className="min-h-[88px] rounded-xl bg-background/70 text-sm"
            required
          />

          <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5">
            <p className="text-[11px] text-muted-foreground">
              Unnoticed requests auto-archive after {autoArchiveDays} days.
            </p>
            <Button
              type="submit"
              disabled={submitting || content.trim().length < 3}
              className="h-10 gap-2 rounded-xl px-4 font-bold"
            >
              {submitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Sending…
                </>
              ) : (
                <>
                  <Send className="h-4 w-4" />
                  Send Suggestion
                </>
              )}
            </Button>
          </div>
        </form>
      </section>

      {/* Filter & Sort Bar */}
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-1.5">
          {filterButtons.map((btn) => {
            const active = filter === btn.key;
            return (
              <button
                key={btn.key}
                type="button"
                onClick={() => setFilter(btn.key)}
                className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${
                  active
                    ? "border-primary bg-primary/15 text-primary"
                    : "border-border bg-card text-muted-foreground hover:border-primary/40 hover:text-foreground"
                }`}
              >
                <span>{btn.label}</span>
                <span className="rounded-full bg-background/80 px-1.5 py-0.5 font-mono text-[10px]">
                  {btn.count}
                </span>
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-1.5">
          <span className="text-[11px] font-semibold text-muted-foreground">Sort:</span>
          <button
            type="button"
            onClick={() => setSort("top")}
            className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 text-[11px] font-semibold transition-colors ${
              sort === "top"
                ? "border-primary bg-primary/15 text-primary"
                : "border-border bg-card text-muted-foreground hover:text-foreground"
            }`}
          >
            <Flame className="h-3 w-3" />
            Most Upvoted
          </button>
          <button
            type="button"
            onClick={() => setSort("newest")}
            className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 text-[11px] font-semibold transition-colors ${
              sort === "newest"
                ? "border-primary bg-primary/15 text-primary"
                : "border-border bg-card text-muted-foreground hover:text-foreground"
            }`}
          >
            <Clock className="h-3 w-3" />
            Newest
          </button>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div
          role="alert"
          className="flex items-start gap-2.5 rounded-2xl border border-destructive/35 bg-destructive/10 p-3.5 text-xs text-destructive"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <div className="min-w-0 flex-1 space-y-2">
            <p className="break-words">{error}</p>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => void loadSuggestions()}
              className="h-7 rounded-lg text-xs"
            >
              Try again
            </Button>
          </div>
        </div>
      )}

      {/* Suggestions Feed */}
      {loading && suggestions.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-border bg-card p-10 text-muted-foreground">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
          <p className="text-xs">Loading community suggestions…</p>
        </div>
      ) : filteredSuggestions.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-border bg-card/50 p-10 text-center">
          <MessageSquareText className="h-7 w-7 text-muted-foreground/60" />
          <p className="text-sm font-semibold text-foreground">
            {filter === "all"
              ? "No suggestions yet"
              : `No ${getSuggestionStatusLabel(filter).toLowerCase()} suggestions`}
          </p>
          <p className="max-w-xs text-xs text-muted-foreground">
            {filter === "all"
              ? "Be the first to share an idea for the next HutaoTik update!"
              : "Switch tabs above or send a new suggestion."}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredSuggestions.map((item) => {
            const countdown =
              item.status === "reviewing" ? formatArchiveCountdown(item.autoArchiveAt) : null;
            const isVoting = Boolean(votingIds[item.id]);
            return (
              <article
                key={item.id}
                className="rounded-2xl border border-border bg-card p-4 space-y-2.5 shadow-sm"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-xs font-bold text-foreground">{item.authorName}</p>
                    <p className="text-[11px] text-muted-foreground">
                      {formatRelativeTime(item.createdAt)}
                      {countdown ? ` • ${countdown}` : ""}
                    </p>
                  </div>
                  <StatusBadge status={item.status} />
                </div>

                <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-foreground/95">
                  {item.content}
                </p>

                {item.adminNote && (
                  <div className="rounded-xl border border-primary/25 bg-primary/5 px-3 py-2 text-xs">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-primary">
                      Admin response
                    </p>
                    <p className="mt-0.5 whitespace-pre-wrap break-words text-foreground/90">
                      {item.adminNote}
                    </p>
                  </div>
                )}

                <div className="flex items-center justify-between pt-1">
                  <button
                    type="button"
                    disabled={isVoting}
                    onClick={() => void handleUpvote(item)}
                    aria-pressed={item.hasUpvoted}
                    className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-bold transition-colors ${
                      item.hasUpvoted
                        ? "border-primary bg-primary/15 text-primary"
                        : "border-border bg-background/70 text-muted-foreground hover:border-primary/50 hover:text-foreground"
                    }`}
                  >
                    <ThumbsUp className={`h-3.5 w-3.5 ${item.hasUpvoted ? "fill-current" : ""}`} />
                    <span className="font-mono">{item.upvotes}</span>
                    <span>{item.hasUpvoted ? "Upvoted" : "Upvote"}</span>
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
