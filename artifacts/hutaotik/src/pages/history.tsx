import { useState, useEffect, useMemo } from "react";
import {
  fetchTiktokVideo,
  useGetPublicSettings,
  getGetPublicSettingsQueryKey,
} from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatDistanceToNow } from "date-fns";
import {
  Loader2,
  History as HistoryIcon,
  Download,
  LockKeyhole,
  Trash2,
  X,
} from "lucide-react";
import { SiTiktok, SiYoutube, SiFacebook, SiX, SiPinterest, SiInstagram } from "react-icons/si";
import {
  getLocalHistory,
  clearLocalHistory,
  removeLocalHistoryRecord,
  onLocalHistoryChanged,
  type LocalHistoryRecord,
} from "@/lib/local-history";
import { getStoredFolderName, saveBlobToDevice } from "@/lib/download-folder";
import {
  fetchBlobWithProgress,
  type DownloadProgressState,
} from "@/lib/download-progress";
import {
  downloadUrlInBackgroundNative,
  isNativeBackgroundDownloadAvailable,
} from "@/lib/background-download";
import {
  convertVideoBlobToGifNative,
  hasNativeGifConverter,
} from "@/lib/native-media";
import { DownloadProgressCard } from "@/components/download-progress-card";
import { downloadFacebookOnDevice, isNativeFacebookAvailable } from "@/lib/facebook-native";
import {
  downloadSocialVideoOnDevice,
  isNativeSocialVideoAvailable,
} from "@/lib/social-native";
import {
  downloadYouTubeOnDevice,
  fetchYouTubeInfoOnDevice,
  isNativeYouTubeAvailable,
} from "@/lib/youtube-native";
import { apiUrl } from "@/lib/api-url";
import { fetchTikTokFromTikwm } from "@/lib/tikwm";
import { fetchTwitterFromFx } from "@/lib/twitter-fx";
import { useToast } from "@/hooks/use-toast";

type PlatformFilter = "all" | LocalHistoryRecord["platform"];

function safeRelativeDate(raw: string): string {
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return "recently";
  return formatDistanceToNow(parsed, { addSuffix: true });
}

export default function History() {
  const [localRecords, setLocalRecords] = useState<LocalHistoryRecord[]>(() => getLocalHistory());
  const [platformFilter, setPlatformFilter] = useState<PlatformFilter>("all");
  const [redownloadingId, setRedownloadingId] = useState<string | null>(null);
  const [progressState, setProgressState] = useState<DownloadProgressState>({ percent: 0 });

  const { toast } = useToast();

  const { data: publicSettings } = useGetPublicSettings({
    query: { queryKey: getGetPublicSettingsQueryKey() },
  });

  const isEnabled = publicSettings?.historyEnabled !== false;

  useEffect(() => {
    const refresh = () => setLocalRecords(getLocalHistory());
    refresh();
    const unsub = onLocalHistoryChanged(refresh);
    window.addEventListener("focus", refresh);
    return () => {
      unsub();
      window.removeEventListener("focus", refresh);
    };
  }, []);

  const availablePlatforms = useMemo(() => {
    const set = new Set<LocalHistoryRecord["platform"]>();
    localRecords.forEach((r) => set.add(r.platform));
    return Array.from(set);
  }, [localRecords]);

  const visibleRecords = useMemo(() => {
    if (platformFilter === "all") return localRecords;
    return localRecords.filter((r) => r.platform === platformFilter);
  }, [localRecords, platformFilter]);

  const handleClearHistory = () => {
    clearLocalHistory();
    setLocalRecords([]);
    setPlatformFilter("all");
    toast({
      title: "History Cleared",
      description: "Saved download history has been removed.",
    });
  };

  const handleRemoveOne = (id: string) => {
    const updated = removeLocalHistoryRecord(id);
    setLocalRecords(updated);
  };

  const handleRedownload = async (record: LocalHistoryRecord) => {
    const folderName = getStoredFolderName() || "HutaoTik Downloads";
    let downloadUrl: string | null = record.downloadUrl ?? record.sourceUrl ?? null;

    if (!record.sourceUrl && !record.downloadUrl) {
      toast({
        title: "Download Link Unavailable",
        description: "Copy and paste the original link on the Home screen to download it again.",
        variant: "destructive",
      });
      return;
    }

    setRedownloadingId(record.id);
    setProgressState({ percent: 2, status: "Preparing re-download…" });

    try {
      const isYouTubeAudio =
        record.platform === "youtube" && /(m4a|mp3|audio)/i.test(record.quality);
      const isSocialImage =
        (record.platform === "pinterest" || record.platform === "instagram") &&
        /image|photo/i.test(record.quality);
      const isTwitterGif = record.platform === "twitter" && /^gif$/i.test(record.quality.trim());
      const isTikTokPhotos =
        record.platform === "tiktok" && /photo|zip/i.test(record.quality);

      const ext = isTikTokPhotos
        ? "zip"
        : isTwitterGif
          ? "gif"
          : isYouTubeAudio
            ? "m4a"
            : isSocialImage
              ? "jpg"
              : record.quality.toLowerCase().includes("mp3") ||
                  record.quality.toLowerCase().includes("audio")
                ? "mp3"
                : "mp4";
      const safeTitle =
        (record.title || "video")
          .replace(/[<>:"/\\|?*\x00-\x1f]/g, " ")
          .trim()
          .substring(0, 50) || "video";
      const safeAuthor = (record.authorUsername || record.author || "media")
        .replace(/[<>:"/\\|?*\x00-\x1f]/g, "")
        .trim();
      const filename = `${safeAuthor}_${safeTitle}.${ext}`;

      // 1. TikTok (fresh URL + photo ZIP or background native video/audio)
      if (record.platform === "tiktok" && record.sourceUrl) {
        setProgressState({ percent: 6, status: "Fetching fresh TikTok link…" });
        const video = await fetchTiktokVideo(
          { url: record.sourceUrl },
          { signal: AbortSignal.timeout(120_000) },
        ).catch(() => fetchTikTokFromTikwm(record.sourceUrl, AbortSignal.timeout(30_000)));

        if (isTikTokPhotos && video.photos?.length) {
          const JSZip = (await import("jszip")).default;
          const zip = new JSZip();
          const folder = zip.folder("photos")!;
          let savedCount = 0;
          await Promise.all(
            video.photos.map(async (photoUrl, i) => {
              const name = `photo-${String(i + 1).padStart(2, "0")}.jpg`;
              try {
                const proxyUrl = apiUrl(
                  `/api/proxy-download?${new URLSearchParams({ url: photoUrl, filename: name }).toString()}`,
                );
                const resp = await fetch(proxyUrl, { referrerPolicy: "no-referrer" });
                if (resp.ok) {
                  const blob = await resp.blob();
                  if (blob.size > 0 && !blob.type.includes("text/html")) {
                    folder.file(name, blob);
                    savedCount += 1;
                  }
                }
              } catch {
                /* skip */
              }
            }),
          );
          if (savedCount === 0) throw new Error("Could not re-download photos from this TikTok post.");
          const zipBlob = await zip.generateAsync({ type: "blob" });
          await saveBlobToDevice(zipBlob, filename, folderName, setProgressState, {
            startPercent: 75,
            endPercent: 100,
          });
          toast({
            title: "Re-download Complete!",
            description: `Saved ${filename} inside ${folderName}`,
          });
          return;
        }

        const isTikTokAudio = /(mp3|audio)/i.test(record.quality);
        downloadUrl = isTikTokAudio
          ? video.downloadUrls.audio
          : video.downloadUrls.hd || video.downloadUrls.normal || video.downloadUrls.low;
        if (!downloadUrl) {
          throw new Error(
            `The requested TikTok ${isTikTokAudio ? "audio" : "video"} format is no longer available.`,
          );
        }

        const requestUrl = apiUrl(
          `/api/proxy-download?${new URLSearchParams({ url: downloadUrl, filename }).toString()}`,
        );
        if (isNativeBackgroundDownloadAvailable() && requestUrl.startsWith("https://")) {
          await downloadUrlInBackgroundNative({
            url: requestUrl,
            filename,
            folderName,
            title: `TikTok · ${safeTitle}`,
            mimeType: isTikTokAudio ? "audio/mpeg" : "video/mp4",
            onProgress: setProgressState,
          });
          toast({
            title: "Re-download Complete!",
            description: `Saved ${filename} inside ${folderName}`,
          });
          return;
        }
      }

      // 2. X / Twitter (GIF or MP4 with native background download)
      if (record.platform === "twitter" && record.sourceUrl) {
        setProgressState({ percent: 6, status: "Fetching fresh X link…" });
        const info = await fetchTwitterFromFx(record.sourceUrl, AbortSignal.timeout(30_000));
        const requestedHeight = Number.parseInt(record.quality, 10);
        const selectedFormat =
          info.formats.find((format) => format.height === requestedHeight) ?? info.formats[0];
        if (!selectedFormat) {
          throw new Error("No downloadable media is currently available for this X post.");
        }
        downloadUrl = selectedFormat.downloadUrl;

        if (isTwitterGif) {
          if (hasNativeGifConverter()) {
            const resp = await fetch(downloadUrl, { referrerPolicy: "no-referrer" });
            if (!resp.ok) throw new Error(`X GIF download failed (HTTP ${resp.status}).`);
            const srcBlob = await fetchBlobWithProgress(resp, setProgressState, {
              startPercent: 10,
              endPercent: 52,
              status: "Downloading X GIF source…",
            });
            await convertVideoBlobToGifNative(srcBlob, filename, folderName, 15, setProgressState, 55);
          } else {
            const gifApiUrl = apiUrl(
              `/api/twitter/gif?url=${encodeURIComponent(record.sourceUrl)}&quality=best&title=${encodeURIComponent(safeTitle)}`,
            );
            const resp = await fetch(gifApiUrl, { signal: AbortSignal.timeout(180_000) });
            if (!resp.ok) throw new Error(`X GIF conversion failed (HTTP ${resp.status}).`);
            const gifBlob = await fetchBlobWithProgress(resp, setProgressState, {
              startPercent: 15,
              endPercent: 88,
              status: "Downloading animated GIF…",
            });
            await saveBlobToDevice(gifBlob, filename, folderName, setProgressState, {
              startPercent: 88,
              endPercent: 100,
            });
          }
          toast({
            title: "GIF Re-download Complete!",
            description: `Saved ${filename} inside ${folderName}`,
          });
          return;
        }

        if (isNativeBackgroundDownloadAvailable() && downloadUrl.startsWith("https://")) {
          await downloadUrlInBackgroundNative({
            url: downloadUrl,
            filename,
            folderName,
            title: `X · ${safeTitle}`,
            mimeType: "video/mp4",
            onProgress: setProgressState,
          });
          toast({
            title: "Re-download Complete!",
            description: `Saved ${filename} inside ${folderName}`,
          });
          return;
        }
      }

      // 3. Pinterest & Instagram
      if ((record.platform === "pinterest" || record.platform === "instagram") && record.sourceUrl) {
        if (isNativeSocialVideoAvailable()) {
          try {
            const nativeResult = await downloadSocialVideoOnDevice(
              record.platform,
              record.sourceUrl,
              null,
              isSocialImage ? "image" : "video",
              filename,
              folderName,
              setProgressState,
            );
            toast({
              title: "Re-download Complete!",
              description: `Saved ${nativeResult.filename} inside ${folderName}`,
            });
            return;
          } catch {
            // Fall through to API fallback below
          }
        }
        downloadUrl = apiUrl(
          `/api/${record.platform}/download?${new URLSearchParams({
            url: record.sourceUrl,
            title: safeTitle,
          }).toString()}`,
        );
      }

      // 4. YouTube
      if (record.platform === "youtube" && record.sourceUrl && isNativeYouTubeAvailable()) {
        setProgressState({ percent: 5, status: "Fetching YouTube streams…" });
        const nativeInfo = await fetchYouTubeInfoOnDevice(record.sourceUrl);
        let formatStr = "audio";
        if (!isYouTubeAudio) {
          const requestedHeight = Number.parseInt(record.quality, 10);
          const selectedFormat =
            nativeInfo.formats.find((format) => format.qualityLabel === `${requestedHeight}p`) ??
            nativeInfo.formats[0];
          if (!selectedFormat) {
            throw new Error("No directly playable YouTube MP4 format is currently available.");
          }
          formatStr = selectedFormat.formatStr;
        }
        await downloadYouTubeOnDevice(
          record.sourceUrl,
          formatStr,
          filename,
          folderName,
          setProgressState,
        );
        toast({
          title: "Re-download Complete!",
          description: `Saved ${filename} inside ${folderName}`,
        });
        return;
      }

      // 5. Facebook
      if (record.platform === "facebook" && record.sourceUrl && isNativeFacebookAvailable()) {
        const quality =
          ext === "mp3" ? "audio" : record.quality.toLowerCase().includes("sd") ? "sd" : "hd";
        await downloadFacebookOnDevice(
          record.sourceUrl,
          quality,
          filename,
          folderName,
          setProgressState,
        );
        toast({
          title: "Re-download Complete!",
          description: `Saved ${filename} inside ${folderName}`,
        });
        return;
      }

      if (!downloadUrl) {
        throw new Error("Download URL is unavailable.");
      }

      const requestUrl =
        record.platform === "tiktok"
          ? apiUrl(
              `/api/proxy-download?${new URLSearchParams({ url: downloadUrl, filename }).toString()}`,
            )
          : downloadUrl;
      let res = await fetch(requestUrl, { referrerPolicy: "no-referrer" });
      if (!res.ok && record.platform === "tiktok") {
        res = await fetch(downloadUrl, { referrerPolicy: "no-referrer" });
      }
      if (!res.ok) throw new Error("Server returned HTTP " + res.status);

      const blob = await fetchBlobWithProgress(res, setProgressState, {
        startPercent: 2,
        endPercent: 88,
        status: "Downloading media…",
      });
      await saveBlobToDevice(blob, filename, folderName, setProgressState, {
        startPercent: 88,
        endPercent: 100,
      });

      toast({
        title: "Re-download Complete!",
        description: `Saved ${filename} inside ${folderName}`,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Re-download failed";
      toast({
        title: "Re-download failed",
        description: msg,
        variant: "destructive",
      });
    } finally {
      setRedownloadingId(null);
      setProgressState({ percent: 0 });
    }
  };

  return (
    <div className="relative space-y-4 max-w-2xl mx-auto">
      {/* Feature-disabled overlay */}
      {!isEnabled && (
        <div className="absolute inset-0 z-30 flex items-center justify-center rounded-2xl backdrop-blur-sm bg-background/60 min-h-[200px]">
          <div className="w-20 h-20 rounded-full bg-card border-2 border-border flex items-center justify-center shadow-xl">
            <LockKeyhole className="w-9 h-9 text-muted-foreground" />
          </div>
        </div>
      )}

      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="flex items-center gap-2 text-2xl font-syne font-bold">
            <HistoryIcon className="h-6 w-6 text-primary shrink-0" />
            Download History
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
            Tap Re-download to save any past video, GIF, or audio again. Clearing cache in Settings also clears this list.
          </p>
        </div>
        {localRecords.length > 0 && (
          <div className="flex shrink-0 items-center gap-1.5">
            <Badge variant="outline" className="bg-primary/10 border-primary/30 text-primary font-bold font-mono text-[11px]">
              {localRecords.length}
            </Badge>
            <Button
              size="sm"
              variant="outline"
              onClick={handleClearHistory}
              className="h-8 px-2.5 text-xs text-muted-foreground hover:text-destructive border-border gap-1 rounded-xl"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Clear</span>
            </Button>
          </div>
        )}
      </header>

      {/* Platform filter pills when multiple platforms exist */}
      {availablePlatforms.length > 1 && (
        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            onClick={() => setPlatformFilter("all")}
            className={`rounded-full border px-3 py-1 text-[11px] font-bold transition-colors ${
              platformFilter === "all"
                ? "border-primary bg-primary text-primary-foreground shadow-sm"
                : "border-border bg-card text-muted-foreground hover:text-foreground"
            }`}
          >
            All ({localRecords.length})
          </button>
          {availablePlatforms.map((plat) => (
            <button
              key={plat}
              type="button"
              onClick={() => setPlatformFilter(plat)}
              className={`rounded-full border px-3 py-1 text-[11px] font-bold capitalize transition-colors ${
                platformFilter === plat
                  ? "border-primary bg-primary text-primary-foreground shadow-sm"
                  : "border-border bg-card text-muted-foreground hover:text-foreground"
              }`}
            >
              {plat === "twitter" ? "X / Twitter" : plat}
            </button>
          ))}
        </div>
      )}

      {visibleRecords.length === 0 ? (
        <div className="animate-card-bounce-in text-center py-16 border border-border border-dashed rounded-2xl bg-card p-6 space-y-3">
          <div className="w-16 h-16 bg-primary/10 border border-primary/25 rounded-2xl flex items-center justify-center mx-auto text-primary">
            <HistoryIcon className="w-8 h-8" />
          </div>
          <h2 className="text-xl font-syne font-bold">No Download History Yet</h2>
          <p className="text-muted-foreground text-xs max-w-xs mx-auto leading-relaxed">
            Videos, GIFs, and audio you download will appear here automatically so you can re-download them anytime.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {visibleRecords.map((record, index) => {
            const isDownloadingThis = redownloadingId === record.id;
            const PlatformIcon =
              record.platform === "youtube"
                ? SiYoutube
                : record.platform === "facebook"
                  ? SiFacebook
                  : record.platform === "twitter"
                    ? SiX
                    : record.platform === "pinterest"
                      ? SiPinterest
                      : record.platform === "instagram"
                        ? SiInstagram
                        : SiTiktok;

            return (
              <Card
                key={record.id}
                style={{ animationDelay: `${Math.min(index, 8) * 45}ms` }}
                className="animate-card-bounce-in border-border bg-card overflow-hidden hover:border-primary/40 transition-all duration-200 shadow-sm rounded-2xl"
              >
                <CardContent className="p-3 space-y-2.5">
                  <div className="flex gap-3 items-center">
                    <div className="w-16 h-16 rounded-xl bg-secondary shrink-0 relative overflow-hidden border border-border">
                      {record.thumbnail ? (
                        <img
                          src={record.thumbnail}
                          alt={record.title}
                          referrerPolicy="no-referrer"
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center">
                          <Download className="w-5 h-5 text-muted-foreground" />
                        </div>
                      )}
                      <div className="absolute top-1 left-1 bg-black/75 p-1 rounded-md text-white">
                        <PlatformIcon className="w-2.5 h-2.5" />
                      </div>
                    </div>

                    <div className="flex-1 min-w-0 space-y-1">
                      <h3 className="font-bold text-xs line-clamp-2 leading-snug">
                        {record.title || "Downloaded Media"}
                      </h3>
                      <p className="text-[11px] text-muted-foreground truncate">
                        @{String(record.authorUsername || record.author).replace(/^@/, "")}
                      </p>

                      <div className="flex items-center gap-2 pt-0.5">
                        <Badge
                          variant="secondary"
                          className="text-[9px] px-2 py-0 h-4 bg-primary/15 border-primary/30 text-primary font-bold uppercase"
                        >
                          {record.quality}
                        </Badge>
                        <span className="text-[10px] text-muted-foreground font-mono">
                          {safeRelativeDate(record.downloadedAt)}
                        </span>
                      </div>
                    </div>

                    <button
                      type="button"
                      disabled={isDownloadingThis}
                      onClick={() => handleRemoveOne(record.id)}
                      aria-label="Remove from history"
                      className="flex h-7 w-7 shrink-0 items-center justify-center self-start rounded-lg text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:opacity-40"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>

                  {isDownloadingThis ? (
                    <DownloadProgressCard
                      title={`Re-downloading ${record.title || "media"}…`}
                      progress={progressState}
                      className=""
                    />
                  ) : (
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => void handleRedownload(record)}
                      disabled={redownloadingId !== null}
                      className="h-9 w-full px-3 text-xs font-bold bg-primary hover:bg-primary/90 text-primary-foreground rounded-xl flex items-center justify-center gap-1.5 shadow-sm"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>Re-download</span>
                    </Button>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
