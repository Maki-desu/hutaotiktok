import { useState, useRef } from "react";
import { useAnalyzeTiktokVideo } from "@workspace/api-client-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Link2,
  Loader2,
  AlertCircle,
  Eye,
  Heart,
  MessageCircle,
  Share2,
  Download,
  User,
  Users,
  Video,
  Music2,
  Calendar,
  Clock,
  Globe,
  CheckCircle2,
  HardDrive,
  Layers,
  Gauge,
  MonitorPlay,
  CloudDownload,
  BadgeCheck,
  Play,
} from "lucide-react";
import { SiTiktok } from "react-icons/si";

type TiktokAnalysis = {
  id: string;
  caption: string;
  createTime: number | null;
  duration: number | null;
  region: string | null;
  thumbnail: string | null;
  isPhoto: boolean;
  photos: string[];
  stats: {
    views: number | null;
    likes: number | null;
    comments: number | null;
    shares: number | null;
    downloads: number | null;
  };
  videoMeta: {
    ratio: string | null;
    hdSize: number | null;
    normalSize: number | null;
    format: string | null;
  };
  author: {
    username: string;
    displayName: string;
    avatar: string | null;
    bio: string | null;
    verified: boolean;
    followers: number | null;
    following: number | null;
    likes: number | null;
    videoCount: number | null;
  };
  music: {
    title: string;
    author: string;
    url: string | null;
    cover: string | null;
    duration: number | null;
    album: string | null;
    original: boolean | null;
  };
  downloadUrls: {
    hd: string | null;
    normal: string | null;
    low: string | null;
    audio: string | null;
  };
};

function fmt(n: number | null | undefined): string {
  if (n == null) return "—";
  return new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(n);
}

function fmtBytes(bytes: number | null | undefined): string {
  if (bytes == null) return "—";
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function fmtDur(s: number | null | undefined): string {
  if (s == null) return "—";
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
  return `${m}:${String(ss).padStart(2, "0")}`;
}

function fmtDate(unix: number | null | undefined): string {
  if (unix == null) return "—";
  return new Intl.DateTimeFormat("en", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(unix * 1000));
}

function fmtBitrate(size: number | null | undefined, dur: number | null | undefined): string {
  if (!size || !dur || dur === 0) return "—";
  const kbps = Math.round((size * 8) / dur / 1000);
  return `~${kbps.toLocaleString()} kbps`;
}

function StatCard({
  icon: Icon,
  label,
  value,
  color,
}: {
  icon: React.ElementType;
  label: string;
  value: string;
  color: string;
}) {
  return (
    <div className="bg-card border border-border rounded-2xl p-3.5 flex flex-col gap-1.5">
      <div className={`w-8 h-8 rounded-xl flex items-center justify-center ${color}`}>
        <Icon className="w-4 h-4" />
      </div>
      <p className="text-xl font-bold text-foreground tabular-nums leading-none">{value}</p>
      <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-medium">{label}</p>
    </div>
  );
}

function MetaRow({ icon: Icon, label, value }: { icon: React.ElementType; label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2 border-b border-border/40 last:border-0">
      <div className="flex items-center gap-2 text-muted-foreground min-w-0">
        <Icon className="w-3.5 h-3.5 shrink-0" />
        <span className="text-xs">{label}</span>
      </div>
      <span className="text-xs font-semibold text-foreground text-right truncate max-w-[55%]">{value}</span>
    </div>
  );
}

export default function Analyze() {
  const [url, setUrl] = useState("");
  const [submittedUrl, setSubmittedUrl] = useState("");
  const [videoPlaying, setVideoPlaying] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const cooldownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastFetchTime = useRef<number>(0);
  const [cooldown, setCooldown] = useState(0);

  const analyzeMutation = useAnalyzeTiktokVideo();

  const handleAnalyze = (inputUrl: string) => {
    const trimmed = inputUrl.trim();
    if (!trimmed || !trimmed.includes("tiktok.com")) return;

    const now = Date.now();
    const diff = now - lastFetchTime.current;
    if (diff < 3000) {
      const remaining = Math.ceil((3000 - diff) / 1000);
      setCooldown(remaining);
      if (cooldownRef.current) clearInterval(cooldownRef.current);
      cooldownRef.current = setInterval(() => {
        setCooldown((c) => {
          if (c <= 1) { clearInterval(cooldownRef.current!); return 0; }
          return c - 1;
        });
      }, 1000);
      return;
    }

    lastFetchTime.current = now;
    setSubmittedUrl(trimmed);
    setVideoPlaying(false);
    analyzeMutation.mutate({ data: { url: trimmed } });
  };

  const handlePaste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      setUrl(text);
      handleAnalyze(text);
    } catch { /* unavailable */ }
  };

  const data = analyzeMutation.data as TiktokAnalysis | undefined;
  const isPending = analyzeMutation.isPending;
  const isError = analyzeMutation.isError;
  const errorMsg =
    (analyzeMutation.error as { error?: { error?: string } } | null)?.error?.error ||
    "Failed to fetch video info. Check the URL.";

  const previewVideoUrl = data?.downloadUrls?.hd ?? data?.downloadUrls?.normal ?? null;

  return (
    <div className="space-y-4 animate-in fade-in slide-in-from-bottom-4 duration-400">

      {/* ── URL Input ─────────────────────────────────── */}
      <div className="bg-card rounded-2xl border border-border p-4 space-y-3 shadow-sm">
        <div className="flex items-center gap-2 mb-1">
          <div className="w-8 h-8 rounded-xl bg-primary/15 flex items-center justify-center">
            <SiTiktok className="w-4 h-4 text-primary" />
          </div>
          <div>
            <p className="text-sm font-bold text-foreground leading-none">TikTok Video Analysis</p>
            <p className="text-[11px] text-muted-foreground mt-0.5">Paste a TikTok link to explore full stats & metadata</p>
          </div>
        </div>

        <div className="flex gap-2">
          <div className="relative flex-1">
            <Link2 className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
            <Input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleAnalyze(url)}
              onPaste={(e) => {
                const pasted = e.clipboardData.getData("text");
                if (pasted) setTimeout(() => handleAnalyze(pasted), 0);
              }}
              placeholder="https://www.tiktok.com/@user/video/…"
              className="pl-9 h-11 bg-background/60 border-border/60 rounded-xl text-sm focus-visible:ring-1 focus-visible:ring-primary focus-visible:border-primary transition-all"
            />
          </div>
          <Button
            onClick={() => handleAnalyze(url)}
            disabled={isPending || cooldown > 0}
            className="h-11 w-11 p-0 rounded-xl bg-primary hover:bg-primary/90 shrink-0 shadow-sm shadow-primary/30"
          >
            {isPending ? (
              <Loader2 className="w-4 h-4 animate-spin text-primary-foreground" />
            ) : cooldown > 0 ? (
              <span className="text-[11px] font-bold text-primary-foreground">{cooldown}s</span>
            ) : (
              <CloudDownload className="w-4 h-4 text-primary-foreground" />
            )}
          </Button>
        </div>

        <button
          onClick={handlePaste}
          className="text-[11px] text-primary/80 hover:text-primary font-medium transition-colors"
        >
          Tap to paste from clipboard
        </button>
      </div>

      {/* ── Error ─────────────────────────────────────── */}
      {isError && (
        <div className="flex items-start gap-2.5 bg-destructive/10 border border-destructive/30 rounded-xl px-3 py-2.5">
          <AlertCircle className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
          <p className="text-sm text-destructive leading-snug">{errorMsg}</p>
        </div>
      )}

      {/* ── Loading skeleton ──────────────────────────── */}
      {isPending && (
        <div className="space-y-4">
          <Skeleton className="w-full aspect-video rounded-2xl bg-secondary/60" />
          <div className="grid grid-cols-2 gap-3">
            {[1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="h-24 rounded-2xl bg-secondary/60" />
            ))}
          </div>
          <Skeleton className="h-32 rounded-2xl bg-secondary/60" />
          <Skeleton className="h-32 rounded-2xl bg-secondary/60" />
        </div>
      )}

      {/* ── Results ───────────────────────────────────── */}
      {data && !isPending && (
        <div className="space-y-4">

          {/* Video Preview Player */}
          {previewVideoUrl && !data.isPhoto && (
            <div className="relative rounded-2xl overflow-hidden bg-black border border-border shadow-lg">
              <video
                ref={videoRef}
                src={previewVideoUrl}
                poster={data.thumbnail ?? undefined}
                controls
                playsInline
                preload="metadata"
                className="w-full max-h-[420px] object-contain bg-black"
                onPlay={() => setVideoPlaying(true)}
                onPause={() => setVideoPlaying(false)}
              />
              {!videoPlaying && (
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <div className="w-14 h-14 rounded-full bg-black/60 border border-white/20 flex items-center justify-center backdrop-blur-sm">
                    <Play className="w-6 h-6 text-white ml-0.5" />
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Photo post thumbnail fallback */}
          {(data.isPhoto || !previewVideoUrl) && data.thumbnail && (
            <div className="rounded-2xl overflow-hidden border border-border">
              <img src={data.thumbnail} alt="thumbnail" className="w-full object-cover" />
            </div>
          )}

          {/* Stats Grid */}
          <div className="grid grid-cols-2 gap-3">
            <StatCard icon={Eye} label="Views" value={fmt(data.stats.views)} color="bg-blue-500/15 text-blue-400" />
            <StatCard icon={Heart} label="Likes" value={fmt(data.stats.likes)} color="bg-rose-500/15 text-rose-400" />
            <StatCard icon={MessageCircle} label="Comments" value={fmt(data.stats.comments)} color="bg-green-500/15 text-green-400" />
            <StatCard icon={Share2} label="Shares" value={fmt(data.stats.shares)} color="bg-purple-500/15 text-purple-400" />
          </div>

          {/* Downloads stat (full width if available) */}
          {data.stats.downloads != null && (
            <div className="bg-card border border-border rounded-2xl p-3.5 flex items-center gap-3">
              <div className="w-8 h-8 rounded-xl bg-orange-500/15 text-orange-400 flex items-center justify-center shrink-0">
                <Download className="w-4 h-4" />
              </div>
              <div>
                <p className="text-sm font-bold tabular-nums">{fmt(data.stats.downloads)}</p>
                <p className="text-[10px] uppercase tracking-widest text-muted-foreground">Downloads</p>
              </div>
            </div>
          )}

          {/* Author card */}
          <div className="bg-card border border-border rounded-2xl p-4 space-y-3">
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold">Author</p>

            <div className="flex items-center gap-3">
              {data.author.avatar ? (
                <img
                  src={data.author.avatar}
                  alt={data.author.username}
                  className="w-12 h-12 rounded-full border-2 border-primary/30 object-cover shrink-0"
                />
              ) : (
                <div className="w-12 h-12 rounded-full bg-secondary border border-border flex items-center justify-center shrink-0">
                  <User className="w-5 h-5 text-muted-foreground" />
                </div>
              )}
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <p className="text-sm font-bold truncate">{data.author.displayName}</p>
                  {data.author.verified && (
                    <BadgeCheck className="w-4 h-4 text-primary shrink-0" />
                  )}
                </div>
                <p className="text-xs text-muted-foreground">@{data.author.username}</p>
                {data.author.bio && (
                  <p className="text-xs text-foreground/70 mt-1 line-clamp-2 leading-relaxed">{data.author.bio}</p>
                )}
              </div>
            </div>

            <div className="grid grid-cols-4 gap-2 pt-1">
              {[
                { label: "Followers", value: fmt(data.author.followers) },
                { label: "Following", value: fmt(data.author.following) },
                { label: "Likes", value: fmt(data.author.likes) },
                { label: "Videos", value: fmt(data.author.videoCount) },
              ].map((item) => (
                <div key={item.label} className="text-center">
                  <p className="text-sm font-bold tabular-nums">{item.value}</p>
                  <p className="text-[9px] uppercase tracking-widest text-muted-foreground mt-0.5">{item.label}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Video metadata */}
          <div className="bg-card border border-border rounded-2xl p-4 space-y-1">
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold mb-2">Video Details</p>
            <MetaRow icon={Clock} label="Duration" value={fmtDur(data.duration)} />
            <MetaRow icon={MonitorPlay} label="Resolution" value={data.videoMeta.ratio ?? "—"} />
            <MetaRow icon={Gauge} label="Bitrate" value={fmtBitrate(data.videoMeta.hdSize ?? data.videoMeta.normalSize, data.duration)} />
            <MetaRow icon={HardDrive} label="HD File Size" value={fmtBytes(data.videoMeta.hdSize)} />
            <MetaRow icon={HardDrive} label="Normal File Size" value={fmtBytes(data.videoMeta.normalSize)} />
            <MetaRow icon={Layers} label="Format" value={data.videoMeta.format ?? "—"} />
            <MetaRow icon={Video} label="Type" value={data.isPhoto ? "Photo Post" : "Video"} />
            <MetaRow icon={Calendar} label="Upload Date" value={fmtDate(data.createTime)} />
            <MetaRow icon={Globe} label="Region" value={data.region ?? "—"} />
            <MetaRow icon={Users} label="Video ID" value={data.id} />
          </div>

          {/* Music card */}
          <div className="bg-card border border-border rounded-2xl p-4 space-y-3">
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold">Music</p>
            <div className="flex items-center gap-3">
              {data.music.cover ? (
                <img
                  src={data.music.cover}
                  alt={data.music.title}
                  className="w-12 h-12 rounded-xl object-cover border border-border shrink-0"
                />
              ) : (
                <div className="w-12 h-12 rounded-xl bg-secondary border border-border flex items-center justify-center shrink-0">
                  <Music2 className="w-5 h-5 text-primary" />
                </div>
              )}
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold leading-snug line-clamp-1">{data.music.title}</p>
                <p className="text-xs text-muted-foreground line-clamp-1">{data.music.author}</p>
                <div className="flex items-center gap-2 mt-1">
                  {data.music.original && (
                    <span className="flex items-center gap-1 text-[10px] text-primary font-semibold">
                      <CheckCircle2 className="w-3 h-3" /> Original Sound
                    </span>
                  )}
                  {data.music.album && (
                    <span className="text-[10px] text-muted-foreground">Album: {data.music.album}</span>
                  )}
                </div>
              </div>
            </div>
            <div className="space-y-0">
              <MetaRow icon={Clock} label="Music Duration" value={fmtDur(data.music.duration)} />
            </div>
          </div>

          {/* Caption */}
          {data.caption && (
            <div className="bg-card border border-border rounded-2xl p-4 space-y-2">
              <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold">Caption</p>
              <p className="text-sm text-foreground/90 leading-relaxed whitespace-pre-wrap break-words">{data.caption}</p>
            </div>
          )}
        </div>
      )}

      {/* Empty state */}
      {!data && !isPending && !isError && (
        <div className="bg-card rounded-2xl border border-border p-8 flex flex-col items-center gap-3 shadow-sm text-center">
          <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center">
            <SiTiktok className="w-7 h-7 text-primary" />
          </div>
          <p className="text-sm font-semibold text-foreground">Paste a TikTok URL above</p>
          <p className="text-xs text-muted-foreground max-w-[260px] leading-relaxed">
            View views, likes, comments, shares, author stats, video metadata, music info and more — all in one place.
          </p>
        </div>
      )}
    </div>
  );
}
