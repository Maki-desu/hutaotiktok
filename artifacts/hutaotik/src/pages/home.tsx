import { useState, useRef } from "react";
import {
  useFetchTiktokVideo,
  useListAnnouncements,
  getListAnnouncementsQueryKey,
  useAddDownloadRecord,
  useGetPublicSettings,
  getGetPublicSettingsQueryKey,
} from "@workspace/api-client-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Link2,
  Download,
  AlertCircle,
  Info,
  Music,
  Image as ImageIcon,
  Video,
  Loader2,
  CloudDownload,
  Copy,
  ExternalLink,
  Package,
  LockKeyhole,
} from "lucide-react";
import { SiTiktok, SiYoutube, SiFacebook } from "react-icons/si";
import { YoutubeSection } from "@/components/youtube-section";
import { FacebookSection } from "@/components/facebook-section";

type Platform = "tiktok" | "youtube" | "facebook";

function detectPlatform(url: string): Platform {
  if (/youtube\.com|youtu\.be/i.test(url)) return "youtube";
  if (/facebook\.com|fb\.watch/i.test(url)) return "facebook";
  return "tiktok";
}

const PLATFORM_ICONS = [
  { id: "tiktok" as Platform, Icon: SiTiktok, label: "TikTok" },
  { id: "youtube" as Platform, Icon: SiYoutube, label: "YouTube" },
  { id: "facebook" as Platform, Icon: SiFacebook, label: "Facebook" },
];

export default function Home() {
  const [url, setUrl] = useState("");
  const [submittedUrl, setSubmittedUrl] = useState("");
  const [activePlatform, setActivePlatform] = useState<Platform>("tiktok");
  const [cooldown, setCooldown] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [quality, setQuality] = useState<"hd" | "normal" | "low" | "audio">("hd");

  const cooldownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastFetchTime = useRef<number>(0);

  const { data: publicSettings } = useGetPublicSettings({
    query: { queryKey: getGetPublicSettingsQueryKey() },
  });
  const downloadsEnabled = publicSettings?.downloadsEnabled !== false;

  const { data: announcements } = useListAnnouncements({
    query: { queryKey: getListAnnouncementsQueryKey() },
  });
  const activeAnnouncements = Array.isArray(announcements) ? announcements : [];

  const [isZipping, setIsZipping] = useState(false);

  const fetchMutation = useFetchTiktokVideo();
  const addHistoryMutation = useAddDownloadRecord();

  const handleFetch = (inputUrl: string) => {
    const trimmed = inputUrl.trim();
    if (!trimmed) return;

    const platform = detectPlatform(trimmed);
    setActivePlatform(platform);
    setSubmittedUrl(trimmed);

    if (platform !== "tiktok") return;

    const now = Date.now();
    const diff = now - lastFetchTime.current;

    if (diff < 3000) {
      const remaining = Math.ceil((3000 - diff) / 1000);
      setCooldown(remaining);
      if (cooldownRef.current) clearInterval(cooldownRef.current);
      cooldownRef.current = setInterval(() => {
        setCooldown((c) => {
          if (c <= 1) {
            clearInterval(cooldownRef.current!);
            return 0;
          }
          return c - 1;
        });
      }, 1000);
      return;
    }

    lastFetchTime.current = now;
    setError(null);
    fetchMutation.mutate(
      { data: { url: trimmed } },
      {
        onError: (err) => {
          setError(
            (err as { error?: { error?: string } }).error?.error ||
              "Failed to fetch video. Please check the URL."
          );
        },
      }
    );
  };

  const handlePaste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      setUrl(text);
      handleFetch(text);
    } catch {
      /* clipboard unavailable */
    }
  };

  const handleDownload = () => {
    const video = fetchMutation.data;
    if (!video) return;

    let downloadUrl: string | null = null;
    let ext = "mp4";

    if (quality === "audio") {
      downloadUrl = video.downloadUrls.audio;
      ext = "mp3";
    } else {
      downloadUrl = video.downloadUrls[quality];
    }

    if (!downloadUrl) {
      setError(`Requested quality (${quality}) is not available for this video.`);
      return;
    }

    addHistoryMutation.mutate({
      data: {
        videoId: video.id,
        title: video.title,
        author: video.author,
        authorUsername: video.authorUsername,
        thumbnail: video.thumbnail,
        quality,
      },
    });

    const safeTitle = video.title
      .substring(0, 60)
      .replace(/[<>:"/\\|?*\x00-\x1f]/g, " ")
      .trim();
    const filename = `video_${video.authorUsername} - ${safeTitle}.${ext}`;

    const proxyUrl =
      `/api/proxy-download?url=${encodeURIComponent(downloadUrl)}` +
      `&filename=${encodeURIComponent(filename)}`;

    const a = document.createElement("a");
    a.href = proxyUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const downloadAllPhotos = async () => {
    const v = fetchMutation.data;
    if (!v?.photos?.length) return;
    setIsZipping(true);
    try {
      const JSZip = (await import("jszip")).default;
      const zip = new JSZip();
      const folder = zip.folder("photos")!;

      await Promise.all(
        v.photos.map(async (photoUrl, i) => {
          try {
            const proxyUrl = `/api/proxy-download?url=${encodeURIComponent(photoUrl)}&filename=photo-${i + 1}.jpg`;
            const resp = await fetch(proxyUrl);
            if (resp.ok) folder.file(`photo-${String(i + 1).padStart(2, "0")}.jpg`, await resp.blob());
          } catch { /* skip */ }
        }),
      );

      const blob = await zip.generateAsync({ type: "blob" });
      const safeTitle = (v.title || "photos").replace(/[^a-z0-9\s]/gi, "").trim() || "photos";
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = `${safeTitle}.zip`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(link.href);
    } finally {
      setIsZipping(false);
    }
  };

  const video = fetchMutation.data;

  const platformHints: Record<Platform, { title: string; body: string }> = {
    tiktok: {
      title: "Copy Link",
      body: "Grab any video URL from TikTok, paste it above, and hit the download button.",
    },
    youtube: {
      title: "Copy YouTube Link",
      body: "Grab any YouTube video URL, paste it above, and hit the download button to see available resolutions.",
    },
    facebook: {
      title: "Copy Facebook Link",
      body: "Grab any public Facebook video URL, paste it above, and hit the download button.",
    },
  };
  const hint = platformHints[activePlatform];

  return (
    <div className="space-y-4 animate-in fade-in slide-in-from-bottom-4 duration-400">

      {/* ── PASTE LINK card ─────────────────────────── */}
      <div className="bg-card rounded-2xl border border-border p-4 space-y-3 shadow-sm">
        <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground px-0.5">
          Paste Link
        </p>

        <div className="flex gap-2">
          <div className="relative flex-1">
            <Link2 className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
            <Input
              data-testid="input-url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleFetch(url)}
              onPaste={(e) => {
                const pasted = e.clipboardData.getData("text");
                if (pasted) setTimeout(() => handleFetch(pasted), 0);
              }}
              placeholder="Paste any video link here…"
              className="pl-9 h-11 bg-background/60 border-border/60 rounded-xl text-sm focus-visible:ring-1 focus-visible:ring-primary focus-visible:border-primary transition-all"
            />
          </div>

          <Button
            data-testid="button-fetch"
            onClick={() => handleFetch(url)}
            disabled={fetchMutation.isPending || cooldown > 0}
            className="h-11 w-11 p-0 rounded-xl bg-primary hover:bg-primary/90 shrink-0 shadow-sm shadow-primary/30"
          >
            {fetchMutation.isPending ? (
              <Loader2 className="w-4 h-4 animate-spin text-primary-foreground" />
            ) : cooldown > 0 ? (
              <span className="text-[11px] font-bold text-primary-foreground">{cooldown}s</span>
            ) : (
              <CloudDownload className="w-4 h-4 text-primary-foreground" />
            )}
          </Button>
        </div>

        {/* Platform tabs */}
        <div className="pt-1">
          <p className="text-[11px] text-muted-foreground mb-2">Choose a download section.</p>
          <div className="flex gap-2 flex-wrap">
            {PLATFORM_ICONS.map(({ id, Icon, label }) => {
              const isDisabled =
                (id === "youtube" && publicSettings?.youtubeEnabled === false) ||
                (id === "facebook" && publicSettings?.facebookEnabled === false);
              return (
                <button
                  key={id}
                  title={isDisabled ? `${label} downloads are disabled` : label}
                  onClick={() => setActivePlatform(id)}
                  className={`flex items-center gap-1.5 px-3 h-9 rounded-full border text-xs font-semibold transition-all ${
                    activePlatform === id
                      ? "border-primary bg-primary/15 text-primary"
                      : isDisabled
                      ? "border-border bg-background/50 text-muted-foreground/40 cursor-not-allowed"
                      : "border-border bg-background/50 text-muted-foreground hover:border-primary/50 hover:text-foreground"
                  }`}
                >
                  <Icon className="w-3.5 h-3.5 shrink-0" />
                  {label}
                  {isDisabled && <LockKeyhole className="w-2.5 h-2.5 shrink-0 opacity-60" />}
                </button>
              );
            })}
          </div>
        </div>

        {/* Error (TikTok only) */}
        {activePlatform === "tiktok" && error && (
          <div className="flex items-start gap-2.5 bg-destructive/10 border border-destructive/30 rounded-xl px-3 py-2.5 mt-1">
            <AlertCircle className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
            <p className="text-sm text-destructive leading-snug">{error}</p>
          </div>
        )}
      </div>

      {/* ── TikTok section ──────────────────────────── */}
      {activePlatform === "tiktok" && (
        <>
          {/* How-to hint */}
          {!video && !fetchMutation.isPending && (
            <div className="bg-card rounded-2xl border border-border p-4 flex items-start gap-3 shadow-sm">
              <div className="w-9 h-9 rounded-xl bg-primary/15 flex items-center justify-center shrink-0">
                <Copy className="w-4 h-4 text-primary" />
              </div>
              <div>
                <p className="text-sm font-semibold text-foreground leading-tight">{hint.title}</p>
                <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{hint.body}</p>
              </div>
            </div>
          )}

          {/* Loading skeleton */}
          {fetchMutation.isPending && (
            <div className="bg-card rounded-2xl border border-border p-4 space-y-3">
              <div className="flex gap-4">
                <Skeleton className="w-28 shrink-0 aspect-[9/16] rounded-xl bg-secondary/60" />
                <div className="flex-1 space-y-3 pt-1">
                  <Skeleton className="h-4 w-3/4 bg-secondary/60 rounded-lg" />
                  <div className="flex items-center gap-2">
                    <Skeleton className="w-8 h-8 rounded-full bg-secondary/60" />
                    <Skeleton className="h-3 w-24 bg-secondary/60 rounded-lg" />
                  </div>
                  <Skeleton className="h-16 w-full bg-secondary/60 rounded-lg" />
                  <div className="flex gap-2">
                    {[1, 2, 3].map((i) => (
                      <Skeleton key={i} className="h-8 w-16 bg-secondary/60 rounded-full" />
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Video preview card */}
          {video && !fetchMutation.isPending && (
            <div className="bg-card rounded-2xl border border-border overflow-hidden shadow-sm animate-in fade-in zoom-in-95 duration-300">
              <div className="flex gap-4 p-4">
                <div className="relative w-24 shrink-0 rounded-xl overflow-hidden aspect-[9/16] bg-secondary border border-border">
                  {video.thumbnail ? (
                    <img src={video.thumbnail} alt={video.title} className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <Video className="w-8 h-8 text-muted-foreground/40" />
                    </div>
                  )}
                  {video.isPhoto && (
                    <div className="absolute top-1 right-1">
                      <Badge className="text-[9px] px-1 py-px bg-primary text-primary-foreground border-none font-bold">
                        <ImageIcon className="w-2.5 h-2.5 mr-0.5" />{video.photos?.length || 0}
                      </Badge>
                    </div>
                  )}
                  {video.duration != null && (
                    <div className="absolute bottom-1 right-1 bg-black/70 text-white text-[9px] font-mono px-1 py-px rounded">
                      {Math.floor(video.duration / 60)}:{String(video.duration % 60).padStart(2, "0")}
                    </div>
                  )}
                </div>

                <div className="flex-1 min-w-0 flex flex-col gap-2">
                  <div className="flex items-center gap-2">
                    <img
                      src={video.authorAvatar || `https://api.dicebear.com/7.x/initials/svg?seed=${video.authorUsername}`}
                      alt={video.authorUsername}
                      className="w-7 h-7 rounded-full border border-border shrink-0"
                    />
                    <div className="min-w-0">
                      <p className="text-sm font-semibold leading-tight truncate">{video.author}</p>
                      <p className="text-[11px] text-muted-foreground">@{video.authorUsername}</p>
                    </div>
                  </div>
                  <p className="text-xs text-foreground/80 line-clamp-3 leading-relaxed">{video.title}</p>
                  {video.music && (
                    <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground bg-secondary/50 px-2 py-1 rounded-lg max-w-fit">
                      <Music className="w-2.5 h-2.5 text-primary shrink-0" />
                      <span className="truncate max-w-[140px]">
                        {video.music.title} – {video.music.author}
                      </span>
                    </div>
                  )}
                </div>
              </div>

              <div className="px-4 pb-3">
                <p className="text-[11px] uppercase tracking-widest text-muted-foreground mb-2">Quality</p>
                <div className="flex flex-wrap gap-1.5">
                  {(["hd", "normal", "low"] as const).map((q) => {
                    if (!video.downloadUrls[q]) return null;
                    const label = q === "hd" ? "HD" : q === "normal" ? "Normal" : "Low";
                    return (
                      <button
                        key={q}
                        data-testid={`quality-${q}`}
                        onClick={() => setQuality(q)}
                        className={`px-3 py-1 rounded-full text-xs font-semibold border transition-all ${
                          quality === q
                            ? "bg-primary border-primary text-primary-foreground shadow-sm shadow-primary/30"
                            : "border-border text-muted-foreground hover:border-primary/50 hover:text-foreground"
                        }`}
                      >
                        {label}
                      </button>
                    );
                  })}
                  {video.downloadUrls.audio && (
                    <button
                      data-testid="quality-audio"
                      onClick={() => setQuality("audio")}
                      className={`flex items-center gap-1 px-3 py-1 rounded-full text-xs font-semibold border transition-all ${
                        quality === "audio"
                          ? "bg-primary border-primary text-primary-foreground shadow-sm shadow-primary/30"
                          : "border-border text-muted-foreground hover:border-primary/50 hover:text-foreground"
                      }`}
                    >
                      <Music className="w-3 h-3" /> MP3
                    </button>
                  )}
                </div>
              </div>

              <div className="px-4 pb-4">
                <Button
                  data-testid="button-download"
                  className="w-full h-11 font-bold text-sm rounded-xl shadow-sm shadow-primary/25 hover:shadow-primary/40 transition-all"
                  onClick={handleDownload}
                >
                  <Download className="w-4 h-4 mr-2" />
                  Download {quality === "audio" ? "MP3" : `${quality.toUpperCase()} MP4`}
                </Button>
              </div>

              {video.isPhoto && video.photos && video.photos.length > 0 && (
                <div className="px-4 pb-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <p className="text-[11px] uppercase tracking-widest text-muted-foreground">
                      Photos ({video.photos.length})
                    </p>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 px-3 text-xs gap-1.5 border-primary/40 text-primary hover:bg-primary/10 hover:border-primary transition-all duration-200 active:scale-95"
                      onClick={downloadAllPhotos}
                      disabled={isZipping}
                    >
                      {isZipping ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Package className="w-3.5 h-3.5" />}
                      {isZipping ? "Zipping…" : "Download ZIP"}
                    </Button>
                  </div>
                  <div className="flex gap-2 overflow-x-auto no-scrollbar pb-1">
                    {video.photos.map((src, i) => (
                      <a key={i} href={src} target="_blank" rel="noreferrer" className="shrink-0 group">
                        <div
                          className="relative w-20 aspect-square rounded-lg overflow-hidden border border-border transition-all duration-200 group-hover:border-primary/50 group-hover:scale-105"
                          style={{ animation: `pop-in 0.35s ${i * 0.06}s ease both` }}
                        >
                          <img src={src} alt={`photo-${i}`} className="w-full h-full object-cover" />
                          <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 flex items-center justify-center transition-all duration-200">
                            <ExternalLink className="w-4 h-4 text-white opacity-0 group-hover:opacity-100 transition-opacity" />
                          </div>
                        </div>
                      </a>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* ── YouTube section ─────────────────────────── */}
      {activePlatform === "youtube" && (
        <>
          {publicSettings?.youtubeEnabled === false ? (
            <div className="bg-card rounded-2xl border border-border p-4 flex items-start gap-3 shadow-sm">
              <div className="w-9 h-9 rounded-xl bg-secondary flex items-center justify-center shrink-0">
                <LockKeyhole className="w-4 h-4 text-muted-foreground" />
              </div>
              <div>
                <p className="text-sm font-semibold text-foreground leading-tight">YouTube Downloads Disabled</p>
                <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">This feature has been turned off by the administrator.</p>
              </div>
            </div>
          ) : (
            <>
              {!submittedUrl && (
                <div className="bg-card rounded-2xl border border-border p-4 flex items-start gap-3 shadow-sm">
                  <div className="w-9 h-9 rounded-xl bg-red-500/15 flex items-center justify-center shrink-0">
                    <SiYoutube className="w-4 h-4 text-red-500" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-foreground leading-tight">{hint.title}</p>
                    <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{hint.body}</p>
                  </div>
                </div>
              )}
              <YoutubeSection url={submittedUrl} />
            </>
          )}
        </>
      )}

      {/* ── Facebook section ─────────────────────────── */}
      {activePlatform === "facebook" && (
        <>
          {publicSettings?.facebookEnabled === false ? (
            <div className="bg-card rounded-2xl border border-border p-4 flex items-start gap-3 shadow-sm">
              <div className="w-9 h-9 rounded-xl bg-secondary flex items-center justify-center shrink-0">
                <LockKeyhole className="w-4 h-4 text-muted-foreground" />
              </div>
              <div>
                <p className="text-sm font-semibold text-foreground leading-tight">Facebook Downloads Disabled</p>
                <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">This feature has been turned off by the administrator.</p>
              </div>
            </div>
          ) : (
            <>
              {!submittedUrl && (
                <div className="bg-card rounded-2xl border border-border p-4 flex items-start gap-3 shadow-sm">
                  <div className="w-9 h-9 rounded-xl bg-blue-500/15 flex items-center justify-center shrink-0">
                    <SiFacebook className="w-4 h-4 text-blue-500" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-foreground leading-tight">{hint.title}</p>
                    <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{hint.body}</p>
                  </div>
                </div>
              )}
              <FacebookSection url={submittedUrl} />
            </>
          )}
        </>
      )}

      {/* ── Announcements ────────────────────────────── */}
      {activeAnnouncements.length > 0 && (
        <div className="space-y-3 pt-2">
          <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground px-0.5">
            Announcements
          </p>
          {activeAnnouncements.map((ann) => (
            <div
              key={ann.id}
              className={`rounded-2xl border p-4 flex items-start gap-3 ${
                ann.colorType === "info"
                  ? "bg-primary/8 border-primary/25"
                  : ann.colorType === "warning"
                  ? "bg-destructive/8 border-destructive/25"
                  : "bg-blue-500/8 border-blue-500/25"
              }`}
            >
              <Info
                className={`w-4 h-4 mt-0.5 shrink-0 ${
                  ann.colorType === "info"
                    ? "text-primary"
                    : ann.colorType === "warning"
                    ? "text-destructive"
                    : "text-blue-400"
                }`}
              />
              <div>
                <p className="text-xs font-bold uppercase tracking-wide mb-1 text-foreground/80">
                  Admin Announcement
                </p>
                <p className="text-sm text-foreground/90 leading-relaxed">{ann.content}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
