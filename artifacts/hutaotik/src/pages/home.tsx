import { useState, useRef, useEffect } from "react";
import {
  useFetchTiktokVideo,
  fetchTiktokVideo,
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
  FolderPlus,
  FolderCheck,
  CheckCircle2,
  ArrowDown,
  ChevronDown,
} from "lucide-react";
import { SiTiktok, SiFacebook, SiYoutube, SiX, SiPinterest, SiInstagram } from "react-icons/si";
import { FacebookSection } from "@/components/facebook-section";
import { SocialVideoSection } from "@/components/social-video-section";
import { YoutubeSection } from "@/components/youtube-section";
import { TwitterSection } from "@/components/twitter-section";
import { isTwitterUrl } from "@/lib/twitter-url";
import { extractFirstHttpUrl, isPinterestUrl } from "@/lib/pinterest-url";
import { isInstagramUrl } from "@/lib/instagram-url";
import { isYouTubeUrl } from "@/lib/youtube-url";
import { fetchTikTokFromTikwm } from "@/lib/tikwm";
import { apiUrl } from "@/lib/api-url";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  getStoredFolderName,
  openDeviceStorageFolderPicker,
  createAndSetDeviceFolder,
  saveBlobToDevice,
} from "@/lib/download-folder";
import { saveLocalHistoryRecord } from "@/lib/local-history";
import { useToast } from "@/hooks/use-toast";

export default function Home() {
  const [url, setUrl] = useState("");
  const [submittedUrl, setSubmittedUrl] = useState("");
  const [fetchNonce, setFetchNonce] = useState(0);
  const [platform, setPlatform] = useState<"tiktok" | "facebook" | "youtube" | "twitter" | "pinterest" | "instagram">("tiktok");
  const [cooldown, setCooldown] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [quality, setQuality] = useState<"hd" | "normal" | "low" | "audio">("hd");

  // Download Folder Selection (Defaults to pre-created app folder on device storage)
  const [folderName, setFolderName] = useState<string | null>(getStoredFolderName() || "HutaoTik Downloads");

  useEffect(() => {
    if (!getStoredFolderName()) {
      createAndSetDeviceFolder("HutaoTik Downloads").then((name) => {
        setFolderName(name);
      });
    }
    return () => {
      if (cooldownRef.current) clearInterval(cooldownRef.current);
    };
  }, []);

  // Downloading Animation & Completion Visual State
  const [isDownloadingInApp, setIsDownloadingInApp] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [downloadSuccessInfo, setDownloadSuccessInfo] = useState<{ filename: string; folder: string } | null>(null);

  const { toast } = useToast();

  const cooldownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastFetchTime = useRef<number>(0);
  const lastSharedUrl = useRef<{ url: string; at: number } | null>(null);

  const { data: publicSettings } = useGetPublicSettings({
    query: { queryKey: getGetPublicSettingsQueryKey() },
  });

  const { data: announcements } = useListAnnouncements({
    query: { queryKey: getListAnnouncementsQueryKey() },
  });
  const activeAnnouncements = Array.isArray(announcements) ? announcements : [];

  const [isZipping, setIsZipping] = useState(false);

  const fetchMutation = useFetchTiktokVideo({
    mutation: {
      mutationFn: async ({ data }) => {
        const signal = AbortSignal.timeout(120_000);
        try {
          return await fetchTiktokVideo(data, { signal });
        } catch (error) {
          if (
            typeof error !== "object" ||
            error === null ||
            !("status" in error) ||
            typeof error.status !== "number" ||
            error.status < 500
          ) {
            throw error;
          }
          return fetchTikTokFromTikwm(data.url, signal);
        }
      },
    },
  });
  const addHistoryMutation = useAddDownloadRecord();

  const handleOpenFolderPicker = async () => {
    const selected = await openDeviceStorageFolderPicker();
    if (selected) {
      await createAndSetDeviceFolder(selected);
      setFolderName(selected);
      toast({
        title: "Download Location Updated",
        description: `Folder set to: ${selected}`,
      });
    }
  };

  const selectPlatform = (nextPlatform: typeof platform) => {
    fetchMutation.reset();
    setPlatform(nextPlatform);
    setError(null);
    setSubmittedUrl("");
  };

  const handleFetch = (inputUrl: string) => {
    const trimmed = extractFirstHttpUrl(inputUrl);
    if (!trimmed) return;
    setUrl(trimmed);

    if (isTwitterUrl(trimmed)) {
      fetchMutation.reset();
      setPlatform("twitter");
      setError(null);
      setSubmittedUrl(trimmed);
      return;
    }

    if (isPinterestUrl(trimmed)) {
      fetchMutation.reset();
      setPlatform("pinterest");
      setError(null);
      setSubmittedUrl(trimmed);
      setFetchNonce((n) => n + 1);
      return;
    }

    if (isInstagramUrl(trimmed)) {
      fetchMutation.reset();
      setPlatform("instagram");
      setError(null);
      setSubmittedUrl(trimmed);
      setFetchNonce((n) => n + 1);
      return;
    }

    const isFacebookUrl = /(facebook\.com|fb\.watch)/i.test(trimmed);
    if (isYouTubeUrl(trimmed)) {
      fetchMutation.reset();
      setPlatform("youtube");
      setError(null);
      setSubmittedUrl(trimmed);
      return;
    }

    if (isFacebookUrl) {
      fetchMutation.reset();
      setPlatform("facebook");
      setError(null);
      setSubmittedUrl(trimmed);
      return;
    }

    if (fetchMutation.isPending) return;

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

    fetchMutation.reset();
    setPlatform("tiktok");
    setSubmittedUrl(trimmed);
    lastFetchTime.current = now;
    setError(null);
    setDownloadSuccessInfo(null);

    fetchMutation.mutate(
      { data: { url: trimmed } },
      {
        onError: (e: unknown) => {
          setError(e instanceof Error ? e.message : "Failed to fetch video. Please check the URL.");
        },
      }
    );
  };

  const handleFetchRef = useRef(handleFetch);
  handleFetchRef.current = handleFetch;

  // Auto-handle shared URLs from TikTok or Facebook Share Intents
  useEffect(() => {
    const processRawSharedText = (rawText: string) => {
      if (!rawText) return false;
      const match = rawText.match(/https?:\/\/[^\s<>"']+/i);
      const targetUrl = (match?.[0] ?? rawText.trim()).replace(/[),.;!?]+$/, "");
      let parsedUrl: URL;
      try {
        parsedUrl = new URL(targetUrl);
      } catch {
        return false;
      }

      const hostname = parsedUrl.hostname.toLowerCase();
      const isTikTok = hostname === "tiktok.com" || hostname.endsWith(".tiktok.com");
      const isFacebook = hostname === "facebook.com" || hostname.endsWith(".facebook.com") || hostname === "fb.watch";
      if (!["http:", "https:"].includes(parsedUrl.protocol) ||
        (!isTikTok && !isFacebook && !isYouTubeUrl(targetUrl) && !isTwitterUrl(targetUrl) &&
          !isPinterestUrl(targetUrl) && !isInstagramUrl(targetUrl))) {
        return false;
      }

      const normalizedUrl = parsedUrl.toString();
      const previous = lastSharedUrl.current;
      if (previous?.url === normalizedUrl && Date.now() - previous.at < 5000) return true;
      lastSharedUrl.current = { url: normalizedUrl, at: Date.now() };
      setUrl(normalizedUrl);
      handleFetchRef.current(normalizedUrl);
      return true;
    };

    const checkSharedPending = () => {
      let nativeText = "";
      if (typeof window !== "undefined" && (window as any).AndroidStorageBridge?.getPendingSharedText) {
        try {
          nativeText = (window as any).AndroidStorageBridge.getPendingSharedText();
        } catch (e) {
          console.error("Could not read a shared link from Android.", e);
        }
      }

      let pending = "";
      try {
        pending = localStorage.getItem("shared_pending_url") ?? "";
        if (pending) localStorage.removeItem("shared_pending_url");
      } catch (e) {
        console.error("Could not read a pending shared link.", e);
      }
      if (nativeText && processRawSharedText(nativeText)) return;
      if (pending) processRawSharedText(pending);
    };

    checkSharedPending();

    const interval = setInterval(checkSharedPending, 1000);
    window.addEventListener("focus", checkSharedPending);

    const listenerHandles: Array<{ remove?: () => Promise<void> }> = [];
    if (typeof window !== "undefined" && (window as any).Capacitor?.Plugins?.App) {
      Promise.resolve(
        (window as any).Capacitor.Plugins.App.addListener("appUrlOpen", (data: { url: string }) => {
          if (data?.url) processRawSharedText(data.url);
        }),
      ).then((handle) => {
        if (handle) listenerHandles.push(handle);
      }).catch(() => {});
      Promise.resolve(
        (window as any).Capacitor.Plugins.App.addListener("appStateChange", (state: { isActive: boolean }) => {
          if (state?.isActive) checkSharedPending();
        }),
      ).then((handle) => {
        if (handle) listenerHandles.push(handle);
      }).catch(() => {});
    }

    return () => {
      clearInterval(interval);
      window.removeEventListener("focus", checkSharedPending);
      listenerHandles.forEach((handle) => {
        void handle.remove?.();
      });
    };
  }, []);

  const video = fetchMutation.data;
  const isLoading = fetchMutation.isPending;
  const getVideoDownloadUrl = (qualityOption: "hd" | "normal" | "low") => {
    if (!video) return null;
    if (qualityOption === "hd") return video.downloadUrls.hd || video.downloadUrls.normal || video.downloadUrls.low || null;
    if (qualityOption === "normal") return video.downloadUrls.normal || video.downloadUrls.hd || video.downloadUrls.low || null;
    return video.downloadUrls.low || video.downloadUrls.normal || video.downloadUrls.hd || null;
  };
  const audioDownloadUrl = video?.downloadUrls.audio || null;
  const selectedDownloadUrl = quality === "audio" ? audioDownloadUrl : getVideoDownloadUrl(quality);

  useEffect(() => {
    if (!video) return;

    const hasHdDownload = Boolean(video.downloadUrls.hd);
    const hasNormalDownload = Boolean(video.downloadUrls.normal);
    const hasLowDownload = Boolean(video.downloadUrls.low);
    const hasAudioDownload = Boolean(audioDownloadUrl);
    setQuality((current) => {
      if (current === "audio") return hasAudioDownload ? "audio" : hasHdDownload || hasNormalDownload || hasLowDownload ? "hd" : "hd";
      if (current === "normal" && hasNormalDownload) return "normal";
      if (current === "low" && hasLowDownload) return "low";
      if (current === "hd" && hasHdDownload) return "hd";
      if (hasHdDownload) return "hd";
      if (hasNormalDownload) return "normal";
      if (hasLowDownload) return "low";
      return hasAudioDownload ? "audio" : "hd";
    });
  }, [video, audioDownloadUrl]);

  const handleDownloadInApp = async () => {
    if (!video) return;

    if (!folderName) {
      handleOpenFolderPicker();
      return;
    }

    const downloadUrl = selectedDownloadUrl;
    let ext = "mp4";

    if (quality === "audio") {
      ext = "mp3";
    }

    if (!downloadUrl) {
      setError(`Requested quality (${quality}) is not available for this video.`);
      return;
    }

    setIsDownloadingInApp(true);
    setDownloadProgress(0);
    setDownloadSuccessInfo(null);

    try {
      try {
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
      } catch {
        /* ignore history record error if offline */
      }

      const safeTitle = (video.title || "video")
        .substring(0, 50)
        .replace(/[<>:"/\\|?*\x00-\x1f]/g, " ")
        .trim();
      const filename = `${video.authorUsername}_${safeTitle}.${ext}`;

      const requestUrl = apiUrl(
        `/api/proxy-download?${new URLSearchParams({ url: downloadUrl, filename }).toString()}`
      );
      const res = await fetch(requestUrl, { referrerPolicy: "no-referrer" });
      if (!res.ok) throw new Error("Server returned HTTP " + res.status);

      const contentLength = res.headers.get("content-length");
      const total = contentLength ? parseInt(contentLength, 10) : 0;
      let loaded = 0;

      const reader = res.body?.getReader();
      const chunks: Uint8Array[] = [];

      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value) {
            chunks.push(value);
            loaded += value.length;
            if (total > 0) {
              const percent = Math.min(100, Math.round((loaded / total) * 100));
              setDownloadProgress(percent);
            } else {
              setDownloadProgress((prev) => (prev >= 90 ? 90 : prev + 10));
            }
          }
        }
      }

      setDownloadProgress(100);
      const blob = chunks.length > 0 ? new Blob(chunks as unknown as BlobPart[]) : await res.blob();
      await saveBlobToDevice(blob, filename, folderName);

      saveLocalHistoryRecord({
        title: video.title || "TikTok Video",
        author: video.author,
        authorUsername: video.authorUsername,
        thumbnail: video.thumbnail || null,
        quality,
        sourceUrl: submittedUrl || url,
        downloadUrl,
        platform: "tiktok",
      });

      setDownloadSuccessInfo({ filename, folder: folderName });

      toast({
        title: "Download Complete!",
        description: `Your download is complete and saved to Documents/${folderName}/${filename}`,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Download failed";
      toast({
        title: "Download failed",
        description: msg,
        variant: "destructive",
      });
    } finally {
      setIsDownloadingInApp(false);
      setDownloadProgress(0);
    }
  };

  const downloadAllPhotos = async () => {
    if (!video?.photos?.length) return;
    if (!folderName) {
      handleOpenFolderPicker();
      return;
    }

    setIsZipping(true);
    setDownloadProgress(0);
    setDownloadSuccessInfo(null);

    try {
      const JSZip = (await import("jszip")).default;
      const zip = new JSZip();
      const folder = zip.folder("photos")!;

      const totalPhotos = video.photos.length;
      let completedPhotos = 0;
      let savedPhotos = 0;

      await Promise.all(
        video.photos.map(async (photoUrl, i) => {
          const filenameInZip = `photo-${String(i + 1).padStart(2, "0")}.jpg`;
          try {
            let blob: Blob | null = null;
            const proxyUrl = apiUrl(
              `/api/proxy-download?${new URLSearchParams({ url: photoUrl, filename: filenameInZip }).toString()}`,
            );
            try {
              const proxyResp = await fetch(proxyUrl, { referrerPolicy: "no-referrer" });
              if (proxyResp.ok) {
                const candidate = await proxyResp.blob();
                if (candidate.size > 0 && !candidate.type.includes("text/html") && !candidate.type.includes("application/json")) {
                  blob = candidate;
                }
              }
            } catch {
              // Fall back to direct no-referrer fetch below
            }

            if (!blob) {
              const directResp = await fetch(photoUrl, { referrerPolicy: "no-referrer" });
              if (directResp.ok) {
                const candidate = await directResp.blob();
                if (candidate.size > 0 && !candidate.type.includes("text/html")) {
                  blob = candidate;
                }
              }
            }

            if (blob) {
              folder.file(filenameInZip, blob);
              savedPhotos++;
            }
          } catch {
            /* skip failed photo */
          }
          completedPhotos++;
          setDownloadProgress(Math.round((completedPhotos / totalPhotos) * 100));
        }),
      );

      if (savedPhotos === 0) {
        throw new Error("Could not download any photos from this TikTok post.");
      }

      const blob = await zip.generateAsync({ type: "blob" });
      const safeTitle = (video.title || "photos").replace(/[^a-z0-9\s]/gi, "").trim() || "photos";
      const filename = `${safeTitle}.zip`;

      await saveBlobToDevice(blob, filename, folderName);

      setDownloadSuccessInfo({ filename, folder: folderName });

      toast({
        title: "ZIP Download Complete!",
        description: `Your download is complete and saved to Documents/${folderName}/${filename}`,
      });
    } catch {
      toast({ title: "ZIP creation failed", variant: "destructive" });
    } finally {
      setIsZipping(false);
      setDownloadProgress(0);
    }
  };

  return (
    <div className="space-y-4">

      {/* ── PASTE LINK / SECTION SELECTOR card ─────────────────────────── */}
      <div className="animate-card-bounce-in bg-card rounded-2xl border border-border p-4 space-y-3 shadow-sm">
        <p key={platform} className="animate-pill-pop text-[11px] font-semibold uppercase tracking-widest text-muted-foreground px-0.5 flex items-center gap-1.5">
          {platform === "facebook" ? (
            <SiFacebook className="w-3.5 h-3.5 text-blue-500" />
          ) : platform === "youtube" ? (
            <SiYoutube className="w-3.5 h-3.5 text-red-500" />
          ) : platform === "twitter" ? (
            <SiX className="w-3.5 h-3.5" />
          ) : platform === "pinterest" ? (
            <SiPinterest className="w-3.5 h-3.5 text-red-600" />
          ) : platform === "instagram" ? (
            <SiInstagram className="w-3.5 h-3.5 text-pink-600" />
          ) : (
            <SiTiktok className="w-3.5 h-3.5 text-primary" />
          )}
          <span>
            {platform === "facebook"
              ? "Facebook Downloader"
              : platform === "youtube"
                ? "YouTube Downloader"
                : platform === "twitter"
                  ? "X / Twitter Downloader"
                  : platform === "pinterest"
                    ? "Pinterest Video Downloader"
                    : platform === "instagram"
                      ? "Instagram Video Downloader"
                  : "TikTok Downloader"}
          </span>
        </p>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="outline"
              aria-label={`Selected platform: ${platform}. Choose another downloader`}
              className="w-full h-10 justify-between rounded-xl border-primary/40 bg-primary/5 px-3 text-xs font-bold hover:bg-primary/10"
            >
              <span className="inline-flex items-center gap-2">
                {platform === "facebook" ? (
                  <SiFacebook className="h-4 w-4 text-blue-500" />
                ) : platform === "youtube" ? (
                  <SiYoutube className="h-4 w-4 text-red-500" />
                ) : platform === "twitter" ? (
                  <SiX className="h-4 w-4" />
                ) : platform === "pinterest" ? (
                  <SiPinterest className="h-4 w-4 text-red-600" />
                ) : platform === "instagram" ? (
                  <SiInstagram className="h-4 w-4 text-pink-600" />
                ) : (
                  <SiTiktok className="h-4 w-4 text-primary" />
                )}
                {platform === "facebook"
                  ? "Facebook"
                  : platform === "youtube"
                    ? "YouTube"
                    : platform === "twitter"
                      ? "X / Twitter"
                      : platform === "pinterest"
                        ? "Pinterest"
                        : platform === "instagram"
                          ? "Instagram"
                      : "TikTok"}
              </span>
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-[var(--radix-dropdown-menu-trigger-width)]">
            <DropdownMenuLabel>Choose downloader</DropdownMenuLabel>
            <DropdownMenuItem onSelect={() => selectPlatform("tiktok")} aria-selected={platform === "tiktok"}>
              <SiTiktok className="h-4 w-4 text-primary" />
              TikTok
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => selectPlatform("facebook")} aria-selected={platform === "facebook"}>
              <SiFacebook className="h-4 w-4 text-blue-500" />
              Facebook
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => selectPlatform("youtube")} aria-selected={platform === "youtube"}>
              <SiYoutube className="h-4 w-4 text-red-500" />
              YouTube
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => selectPlatform("twitter")} aria-selected={platform === "twitter"}>
              <SiX className="h-4 w-4" />
              X / Twitter
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => selectPlatform("pinterest")} aria-selected={platform === "pinterest"}>
              <SiPinterest className="h-4 w-4 text-red-600" />
              Pinterest
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => selectPlatform("instagram")} aria-selected={platform === "instagram"}>
              <SiInstagram className="h-4 w-4 text-pink-600" />
              Instagram
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <div className="flex gap-2 pt-1">
          <div className="relative flex-1">
            <Link2 className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
            <Input
              data-testid="input-url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleFetch(url)}
              onPaste={(e) => {
                const pasted = e.clipboardData.getData("text");
                if (pasted) {
                  e.preventDefault();
                  const cleaned = extractFirstHttpUrl(pasted);
                  setUrl(cleaned || pasted.trim());
                  setTimeout(() => handleFetch(pasted), 0);
                }
              }}
              placeholder={
                platform === "facebook"
                  ? "Paste a Facebook video, Reel, or fb.watch link…"
                  : platform === "youtube"
                    ? "Paste a YouTube video, Shorts, or youtu.be link…"
                    : platform === "twitter"
                      ? "Paste a public X or Twitter video link…"
                      : platform === "pinterest"
                        ? "Paste a Pinterest video or Pin link…"
                        : platform === "instagram"
                          ? "Paste an Instagram Reel or post link…"
                      : "Paste any TikTok video or photo link here…"
              }
              className="pl-9 h-11 bg-background/60 border-border/60 rounded-xl text-sm focus-visible:ring-1 focus-visible:ring-primary focus-visible:border-primary transition-all"
            />
          </div>

          <Button
            data-testid="button-fetch"
            type="button"
            onClick={() => handleFetch(url)}
            disabled={platform === "tiktok" && (isLoading || cooldown > 0)}
            className="h-11 px-4 rounded-xl bg-primary hover:bg-primary/90 shrink-0 font-bold text-sm shadow-sm shadow-primary/30 flex items-center gap-1.5 active:scale-95 transition-transform cursor-pointer"
          >
            {platform === "tiktok" && isLoading ? (
              <Loader2 className="w-4 h-4 animate-spin text-primary-foreground" />
            ) : platform === "tiktok" && cooldown > 0 ? (
              <span className="text-[11px] font-bold text-primary-foreground">{cooldown}s</span>
            ) : (
              <>
                <CloudDownload className="w-4 h-4 text-primary-foreground" />
                <span>Fetch</span>
              </>
            )}
          </Button>
        </div>

        {error && (
          <div className="animate-error-shake flex items-start gap-2.5 bg-destructive/10 border border-destructive/30 rounded-xl px-3 py-2.5 mt-1">
            <AlertCircle className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
            <p className="text-sm text-destructive leading-snug">{error}</p>
          </div>
        )}
      </div>

      {/* ── DOWNLOAD LOCATION CARD ─────────────────── */}
      <div className="animate-card-bounce-in bg-card rounded-2xl border border-border p-4 shadow-sm space-y-3" style={{ animationDelay: "75ms" }}>
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5 min-w-0 flex-1">
            <div className="w-9 h-9 rounded-xl bg-primary/15 flex items-center justify-center shrink-0 border border-primary/30">
              <FolderCheck className="w-5 h-5 text-primary" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[11px] uppercase tracking-widest text-muted-foreground font-semibold">
                Download Location
              </p>
              <p className="text-sm font-bold text-foreground flex items-center gap-1.5 mt-0.5 min-w-0">
                <span className="truncate">Documents/{folderName || "HutaoTik Downloads"}</span>
              </p>
            </div>
          </div>
          <Badge variant="outline" className="shrink-0 bg-primary/10 border-primary/30 text-primary text-[10px] font-bold px-2 py-0.5">
            Active
          </Badge>
        </div>

        <p className="text-xs text-muted-foreground leading-relaxed">
          Downloaded videos, audio, and photos are saved directly inside this folder on your device.
        </p>

        <Button
          type="button"
          onClick={handleOpenFolderPicker}
          variant="outline"
          className="w-full max-w-full overflow-hidden h-10 px-3 rounded-xl border-primary/40 text-primary hover:bg-primary/10 hover:border-primary font-bold text-xs flex items-center justify-center gap-2 cursor-pointer shadow-sm"
        >
          <FolderPlus className="w-4 h-4 shrink-0" />
          <span className="min-w-0 truncate">Change Folder Download Location</span>
        </Button>
      </div>

      {/* ── Feature section renderer ─────────────────────────── */}
      {platform === "facebook" ? (
        /(facebook\.com|fb\.watch)/i.test(submittedUrl) ? (
          <FacebookSection
            url={submittedUrl}
            folderName={folderName}
            onOpenFolderPicker={handleOpenFolderPicker}
          />
        ) : (
          <div key="fb-hint" className="animate-bounce-pop bg-card rounded-2xl border border-border p-4 flex items-start gap-3 shadow-sm" style={{ animationDelay: "120ms" }}>
            <div className="w-9 h-9 rounded-xl bg-blue-500/10 flex items-center justify-center shrink-0">
              <SiFacebook className="w-4 h-4 text-blue-500" />
            </div>
            <div>
              <p className="text-sm font-semibold text-foreground leading-tight">Copy Facebook Link</p>
              <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
                Paste a public Facebook video or Reel link, including fb.watch links, to see download options.
              </p>
            </div>
          </div>
        )
      ) : platform === "youtube" ? (
        /(youtube\.com|youtu\.be)/i.test(submittedUrl) ? (
          <YoutubeSection
            url={submittedUrl}
            folderName={folderName}
            onOpenFolderPicker={handleOpenFolderPicker}
          />
        ) : (
          <div key="yt-hint" className="animate-bounce-pop bg-card rounded-2xl border border-border p-4 flex items-start gap-3 shadow-sm" style={{ animationDelay: "120ms" }}>
            <div className="w-9 h-9 rounded-xl bg-red-500/10 flex items-center justify-center shrink-0">
              <SiYoutube className="w-4 h-4 text-red-500" />
            </div>
            <div>
              <p className="text-sm font-semibold text-foreground leading-tight">Paste a YouTube Link</p>
              <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
                Download YouTube videos in available quality options or save audio as MP3.
              </p>
            </div>
          </div>
        )
      ) : platform === "twitter" ? (
        isTwitterUrl(submittedUrl) ? (
          <TwitterSection
            url={submittedUrl}
            folderName={folderName}
            onOpenFolderPicker={handleOpenFolderPicker}
          />
        ) : (
          <div key="tw-hint" className="animate-bounce-pop bg-card rounded-2xl border border-border p-4 flex items-start gap-3 shadow-sm" style={{ animationDelay: "120ms" }}>
            <div className="w-9 h-9 rounded-xl bg-foreground/10 flex items-center justify-center shrink-0">
              <SiX className="w-4 h-4 text-foreground" />
            </div>
            <div>
              <p className="text-sm font-semibold text-foreground leading-tight">Paste an X / Twitter Video Link</p>
              <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
                Paste a public post link containing a video to see available download quality options.
              </p>
            </div>
          </div>
        )
      ) : platform === "pinterest" ? (
        isPinterestUrl(submittedUrl) ? (
          <SocialVideoSection
            key={`pinterest:${submittedUrl}:${fetchNonce}`}
            platform="pinterest"
            url={submittedUrl}
            folderName={folderName}
            onOpenFolderPicker={handleOpenFolderPicker}
          />
        ) : (
          <div key="pin-hint" className="animate-bounce-pop bg-card rounded-2xl border border-border p-4 flex items-start gap-3 shadow-sm" style={{ animationDelay: "120ms" }}>
            <div className="w-9 h-9 rounded-xl bg-red-600/10 flex items-center justify-center shrink-0">
              <SiPinterest className="w-4 h-4 text-red-600" />
            </div>
            <div>
              <p className="text-sm font-semibold text-foreground leading-tight">Paste a Pinterest Video Link</p>
              <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
                Paste a public Pinterest Pin or pin.it link to download its highest available video quality.
              </p>
            </div>
          </div>
        )
      ) : platform === "instagram" ? (
        isInstagramUrl(submittedUrl) ? (
          <SocialVideoSection
            key={`instagram:${submittedUrl}:${fetchNonce}`}
            platform="instagram"
            url={submittedUrl}
            folderName={folderName}
            onOpenFolderPicker={handleOpenFolderPicker}
          />
        ) : (
          <div key="ig-hint" className="animate-bounce-pop bg-card rounded-2xl border border-border p-4 flex items-start gap-3 shadow-sm" style={{ animationDelay: "120ms" }}>
            <div className="w-9 h-9 rounded-xl bg-pink-600/10 flex items-center justify-center shrink-0">
              <SiInstagram className="w-4 h-4 text-pink-600" />
            </div>
            <div>
              <p className="text-sm font-semibold text-foreground leading-tight">Paste an Instagram Video Link</p>
              <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
                Paste a public Instagram Reel or video post to download its highest available quality.
              </p>
            </div>
          </div>
        )
      ) : (
        <>
          {/* How-to hint */}
          {!video && !isLoading && (
            <div key="tt-hint" className="animate-bounce-pop bg-card rounded-2xl border border-border p-4 flex items-start gap-3 shadow-sm" style={{ animationDelay: "140ms" }}>
              <div className="w-9 h-9 rounded-xl bg-primary/15 flex items-center justify-center shrink-0">
                <Copy className="w-4 h-4 text-primary" />
              </div>
              <div>
                <p className="text-sm font-semibold text-foreground leading-tight">Copy TikTok Link</p>
                <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">Grab any video or photo carousel URL from TikTok, paste it above, or share directly to HutaoTik.</p>
              </div>
            </div>
          )}

          {/* Loading skeleton */}
          {isLoading && (
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
          {video && !isLoading && (
            <div className="animate-card-bounce-in bg-card rounded-2xl border border-border overflow-hidden shadow-sm">
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
                      className="w-7 h-7 rounded-full border border-border shrink-0 object-cover"
                    />
                    <div className="min-w-0">
                      <p className="text-sm font-semibold leading-tight truncate">{video.author}</p>
                      <p className="text-[11px] text-muted-foreground truncate">@{video.authorUsername.replace(/^@/, "")}</p>
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
                <p className="text-[11px] uppercase tracking-widest text-muted-foreground mb-2 font-semibold">
                  Quality Options
                </p>
                <div className="flex flex-wrap gap-2">
                  {video.downloadUrls.hd && (
                    <button
                      type="button"
                      data-testid="quality-hd"
                      onClick={() => setQuality("hd")}
                      className={`px-3.5 py-1.5 rounded-full text-xs font-bold border transition-all cursor-pointer ${
                        quality === "hd"
                          ? "bg-primary border-primary text-primary-foreground shadow-sm shadow-primary/30"
                          : "border-border text-muted-foreground hover:border-primary/50 hover:text-foreground active:scale-95"
                      }`}
                    >
                      HD MP4
                    </button>
                  )}

                  {video.downloadUrls.normal && (
                    <button
                      type="button"
                      data-testid="quality-normal"
                      onClick={() => setQuality("normal")}
                      className={`px-3.5 py-1.5 rounded-full text-xs font-bold border transition-all cursor-pointer ${
                        quality === "normal"
                          ? "bg-primary border-primary text-primary-foreground shadow-sm shadow-primary/30"
                          : "border-border text-muted-foreground hover:border-primary/50 hover:text-foreground active:scale-95"
                      }`}
                    >
                      Normal MP4
                    </button>
                  )}

                  {video.downloadUrls.low && (
                    <button
                      type="button"
                      data-testid="quality-low"
                      onClick={() => setQuality("low")}
                      className={`px-3.5 py-1.5 rounded-full text-xs font-bold border transition-all cursor-pointer ${
                        quality === "low"
                          ? "bg-primary border-primary text-primary-foreground shadow-sm shadow-primary/30"
                          : "border-border text-muted-foreground hover:border-primary/50 hover:text-foreground active:scale-95"
                      }`}
                    >
                      Low MP4
                    </button>
                  )}

                  {video.downloadUrls.audio && (
                    <button
                      type="button"
                      data-testid="quality-audio"
                      onClick={() => setQuality("audio")}
                      className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-bold border transition-all cursor-pointer ${
                        quality === "audio"
                          ? "bg-primary border-primary text-primary-foreground shadow-sm shadow-primary/30"
                          : "border-border text-muted-foreground hover:border-primary/50 hover:text-foreground active:scale-95"
                      }`}
                    >
                      <Music className="w-3.5 h-3.5 text-primary" />
                      <span>Audio MP3</span>
                    </button>
                  )}
                </div>
              </div>

              {/* ── ANIMATED DOWNLOADING BANNER / PROGRESS VISUAL ───────────────── */}
              {isDownloadingInApp && (
                <div className="px-4 pb-4 animate-bounce-pop">
                  <div className="bg-primary/10 border border-primary/30 rounded-xl p-3 flex flex-col gap-2">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-full bg-primary/20 flex items-center justify-center shrink-0">
                        <ArrowDown className="w-5 h-5 text-primary animate-bounce" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-bold text-foreground leading-tight flex items-center justify-between">
                          <span>Downloading to {folderName}…</span>
                          <span className="text-primary font-mono font-bold text-sm">{downloadProgress}%</span>
                        </p>
                        <p className="text-[11px] text-muted-foreground truncate mt-0.5">Writing file directly to device folder…</p>
                      </div>
                    </div>
                    {/* Live progress bar */}
                    <div className="w-full bg-secondary/80 h-2 rounded-full overflow-hidden">
                      <div
                        className="bg-primary h-full rounded-full transition-all duration-300"
                        style={{ width: `${downloadProgress}%` }}
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* ── DOWNLOAD COMPLETE SUCCESS NOTIFICATION BANNER ──────────────────── */}
              {downloadSuccessInfo && !isDownloadingInApp && (
                <div className="px-4 pb-4 animate-success-pop">
                  <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-xl p-3 flex items-start gap-3 shadow-md">
                    <div className="w-8 h-8 rounded-full bg-emerald-500/20 flex items-center justify-center text-emerald-500 shrink-0 mt-0.5">
                      <CheckCircle2 className="w-5 h-5 animate-pill-pop" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-extrabold text-emerald-400 leading-tight">Download Complete!</p>
                      <p className="text-[11px] text-foreground font-medium truncate mt-0.5">Your download is complete and saved to Documents/{downloadSuccessInfo.folder}/{downloadSuccessInfo.filename}</p>
                    </div>
                  </div>
                </div>
              )}

              {/* Download Button */}
              <div className="px-4 pb-4">
                <Button
                  data-testid="button-download"
                  type="button"
                  disabled={isDownloadingInApp || !selectedDownloadUrl}
                  onClick={handleDownloadInApp}
                  className="w-full max-w-full overflow-hidden h-11 px-4 font-bold text-sm rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground shadow-md shadow-primary/25 flex items-center justify-center gap-2 cursor-pointer"
                >
                  {isDownloadingInApp ? (
                    <>
                      <Loader2 className="w-4 h-4 shrink-0 animate-spin" />
                      <span className="min-w-0 truncate">Downloading… {downloadProgress}%</span>
                    </>
                  ) : (
                    <>
                      <Download className="w-4 h-4 shrink-0" />
                      <span className="min-w-0 truncate">Save {quality === "audio" ? "MP3 Audio" : `${quality.toUpperCase()} Video`} to {folderName}</span>
                    </>
                  )}
                </Button>
              </div>

              {video.isPhoto && video.photos && video.photos.length > 0 && (
                <div className="px-4 pb-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <p className="text-[11px] uppercase tracking-widest text-muted-foreground font-semibold">
                      Photos ({video.photos.length})
                    </p>
                    <Button
                      size="sm"
                      variant="outline"
                      type="button"
                      className="h-7 px-3 text-xs gap-1.5 border-primary/40 text-primary hover:bg-primary/10 hover:border-primary transition-all duration-200 active:scale-95 cursor-pointer"
                      onClick={downloadAllPhotos}
                      disabled={isZipping}
                    >
                      {isZipping ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Package className="w-3.5 h-3.5" />}
                      {isZipping ? `Zipping… ${downloadProgress}%` : "Download ZIP"}
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
                <p className="text-sm text-foreground/90 leading-relaxed whitespace-pre-wrap">
                  {ann.content.split(/(https:\/\/[^\s<>()]+)/g).map((part, index) => {
                    if (!part.startsWith("https://")) return part;
                    try {
                      const url = new URL(part);
                      if (url.protocol !== "https:") return part;
                      return (
                        <a
                          key={index}
                          href={url.toString()}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="break-all underline underline-offset-2"
                        >
                          {part}
                        </a>
                      );
                    } catch {
                      return part;
                    }
                  })}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
