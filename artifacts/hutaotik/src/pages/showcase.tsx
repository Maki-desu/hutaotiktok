import { useState } from "react";
import { useGetPublicSettings, getGetPublicSettingsQueryKey } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Pin, ExternalLink, Loader2, Clapperboard, Send, X, LockKeyhole } from "lucide-react";
import { SiTiktok } from "react-icons/si";
import { formatDistanceToNow } from "date-fns";
import { useToast } from "@/hooks/use-toast";

interface ShowcaseVideo {
  id: number;
  tiktokUrl: string;
  videoId: string;
  title: string;
  authorUsername: string;
  authorDisplayName: string | null;
  authorAvatar: string | null;
  thumbnail: string | null;
  playUrl: string;
  isPinned: boolean;
  pinnedAt: string | null;
  createdAt: string;
}

function useShowcase() {
  const [videos, setVideos] = useState<ShowcaseVideo[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [fetched, setFetched] = useState(false);

  const load = async () => {
    if (fetched) return;
    setLoading(true);
    try {
      const res = await fetch("/api/showcase");
      if (res.ok) setVideos(await res.json());
    } finally {
      setLoading(false);
      setFetched(true);
    }
  };

  if (!fetched && !loading) {
    load();
  }

  const submit = async (tiktokUrl: string): Promise<ShowcaseVideo | null> => {
    const res = await fetch("/api/showcase", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tiktokUrl }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? "Failed to submit");
    const newVideo = data as ShowcaseVideo;
    setVideos((prev) => (prev ? [newVideo, ...prev] : [newVideo]));
    return newVideo;
  };

  const refresh = async () => {
    const res = await fetch("/api/showcase");
    if (res.ok) setVideos(await res.json());
  };

  return { videos, loading, submit, refresh };
}

export default function Showcase() {
  const { data: publicSettings } = useGetPublicSettings({
    query: { queryKey: getGetPublicSettingsQueryKey() },
  });
  const { videos, loading, submit, refresh } = useShowcase();
  const [url, setUrl] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [activeVideo, setActiveVideo] = useState<ShowcaseVideo | null>(null);
  const { toast } = useToast();

  const isEnabled = publicSettings?.showcaseEnabled !== false;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = url.trim();
    if (!trimmed) return;
    if (!trimmed.includes("tiktok.com")) {
      toast({ title: "Only TikTok links are allowed", variant: "destructive" });
      return;
    }
    setSubmitting(true);
    try {
      await submit(trimmed);
      setUrl("");
      toast({ title: "Video added to showcase!" });
    } catch (err: unknown) {
      toast({ title: (err as Error).message || "Failed to add video", variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-500 relative">
      {/* Feature-disabled overlay */}
      {!isEnabled && (
        <div className="absolute inset-0 z-30 flex items-center justify-center rounded-2xl backdrop-blur-sm bg-background/60">
          <div className="w-20 h-20 rounded-full bg-card border-2 border-border flex items-center justify-center shadow-xl">
            <LockKeyhole className="w-9 h-9 text-muted-foreground" />
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-primary/20 flex items-center justify-center">
          <Clapperboard className="w-5 h-5 text-primary" />
        </div>
        <div>
          <h1 className="text-2xl font-syne font-bold leading-tight">Edits Showcase</h1>
          <p className="text-xs text-muted-foreground">Share your best TikTok edits with the community</p>
        </div>
      </div>

      {/* Submit form */}
      <Card className="bg-card border-border">
        <CardContent className="p-4">
          <form onSubmit={handleSubmit} className="flex gap-2">
            <div className="relative flex-1">
              <SiTiktok className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="Paste a TikTok link to share your edit…"
                className="pl-9 bg-background border-border"
                disabled={submitting}
              />
            </div>
            <Button type="submit" disabled={submitting || !url.trim()} className="shrink-0 gap-2">
              {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              Share
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* Video grid */}
      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="w-8 h-8 text-primary animate-spin" />
        </div>
      ) : !videos || videos.length === 0 ? (
        <div className="text-center py-20 border border-border border-dashed rounded-2xl bg-secondary/10">
          <div className="w-16 h-16 bg-secondary rounded-full flex items-center justify-center mx-auto mb-4">
            <Clapperboard className="w-8 h-8 text-muted-foreground" />
          </div>
          <h2 className="text-xl font-syne font-bold mb-2">No Edits Yet</h2>
          <p className="text-muted-foreground text-sm max-w-xs mx-auto">
            Be the first to share a TikTok edit! Paste any TikTok link above.
          </p>
        </div>
      ) : (
        <>
          {/* Pinned section */}
          {videos.some((v) => v.isPinned) && (
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-primary">
                <Pin className="w-3 h-3" /> Pinned
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {videos.filter((v) => v.isPinned).map((video) => (
                  <VideoCard key={video.id} video={video} onPlay={() => setActiveVideo(video)} pinned />
                ))}
              </div>
            </div>
          )}

          {/* All videos */}
          {videos.some((v) => !v.isPinned) && (
            <div className="space-y-3">
              {videos.some((v) => v.isPinned) && (
                <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">All Edits</p>
              )}
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {videos.filter((v) => !v.isPinned).map((video) => (
                  <VideoCard key={video.id} video={video} onPlay={() => setActiveVideo(video)} />
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {/* Video player modal */}
      {activeVideo && (
        <VideoModal video={activeVideo} onClose={() => { setActiveVideo(null); refresh(); }} />
      )}
    </div>
  );
}

function VideoCard({ video, onPlay, pinned }: { video: ShowcaseVideo; onPlay: () => void; pinned?: boolean }) {
  return (
    <div
      className={`relative group cursor-pointer rounded-xl overflow-hidden border bg-card transition-all hover:scale-[1.02] hover:shadow-lg hover:shadow-primary/10
        ${pinned ? "border-primary/40 shadow-[0_0_12px_rgba(249,115,22,0.1)]" : "border-border"}`}
      onClick={onPlay}
    >
      {/* Thumbnail */}
      <div className="aspect-[9/16] bg-secondary relative overflow-hidden">
        {video.thumbnail ? (
          <img src={video.thumbnail} alt={video.title} className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105" />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <Clapperboard className="w-8 h-8 text-muted-foreground" />
          </div>
        )}
        <div className="absolute inset-0 bg-black/20 group-hover:bg-black/10 transition-colors" />
        {/* Play button overlay */}
        <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
          <div className="w-12 h-12 rounded-full bg-primary/90 flex items-center justify-center shadow-lg">
            <svg className="w-5 h-5 text-white ml-0.5" fill="currentColor" viewBox="0 0 24 24">
              <path d="M8 5v14l11-7z" />
            </svg>
          </div>
        </div>
        {pinned && (
          <div className="absolute top-2 left-2">
            <Badge className="bg-primary text-primary-foreground text-[10px] px-1.5 py-0 h-5 gap-1">
              <Pin className="w-2.5 h-2.5" /> Pinned
            </Badge>
          </div>
        )}
      </div>
      {/* Info */}
      <div className="p-2.5">
        <p className="text-xs font-semibold line-clamp-2 leading-tight">{video.title}</p>
        <div className="flex items-center gap-1.5 mt-1.5">
          {video.authorAvatar && (
            <img src={video.authorAvatar} alt="" className="w-4 h-4 rounded-full object-cover shrink-0" />
          )}
          <p className="text-[10px] text-muted-foreground truncate">@{video.authorUsername}</p>
        </div>
      </div>
    </div>
  );
}

function VideoModal({ video, onClose }: { video: ShowcaseVideo; onClose: () => void }) {
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm p-0 bg-background border-border overflow-hidden">
        <DialogHeader className="px-4 pt-4 pb-2">
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              {video.authorAvatar && (
                <img src={video.authorAvatar} alt="" className="w-8 h-8 rounded-full object-cover shrink-0 border border-border" />
              )}
              <div className="min-w-0">
                <DialogTitle className="text-sm font-bold truncate">{video.authorDisplayName || `@${video.authorUsername}`}</DialogTitle>
                <p className="text-xs text-muted-foreground">@{video.authorUsername}</p>
              </div>
            </div>
            <button onClick={onClose} className="shrink-0 p-1 rounded-full hover:bg-secondary transition-colors">
              <X className="w-4 h-4" />
            </button>
          </div>
        </DialogHeader>

        {/* Video player */}
        <div className="bg-black">
          <video
            src={video.playUrl}
            controls
            autoPlay
            className="w-full max-h-[60vh] object-contain"
            playsInline
          />
        </div>

        {/* Caption + actions */}
        <div className="px-4 py-3 space-y-3">
          <p className="text-sm text-foreground line-clamp-3">{video.title}</p>
          <div className="flex gap-2">
            <a
              href={video.tiktokUrl}
              target="_blank"
              rel="noreferrer"
              className="flex-1"
            >
              <Button variant="outline" className="w-full gap-2 border-border hover:border-primary/50 hover:text-primary">
                <SiTiktok className="w-4 h-4" />
                Open on TikTok
                <ExternalLink className="w-3.5 h-3.5 ml-auto opacity-60" />
              </Button>
            </a>
          </div>
          <p className="text-[10px] text-muted-foreground text-center">
            Shared {formatDistanceToNow(new Date(video.createdAt), { addSuffix: true })}
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
