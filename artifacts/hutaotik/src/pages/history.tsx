import { useState, useEffect } from "react";
import {
  fetchTiktokVideo,
  useListDownloadHistory,
  getListDownloadHistoryQueryKey,
  useGetPublicSettings,
  getGetPublicSettingsQueryKey,
} from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatDistanceToNow } from "date-fns";
import { Loader2, History as HistoryIcon, Download, LockKeyhole, Trash2, ArrowDown, Sparkles, CheckCircle2 } from "lucide-react";
import { SiTiktok, SiYoutube, SiFacebook, SiX, SiPinterest, SiInstagram } from "react-icons/si";
import { getLocalHistory, clearLocalHistory, LocalHistoryRecord } from "@/lib/local-history";
import { getStoredFolderName, saveBlobToDevice } from "@/lib/download-folder";
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
import { fetchTwitterFromFx } from "@/lib/twitter-fx";
import { useToast } from "@/hooks/use-toast";

export default function History() {
  const [localRecords, setLocalRecords] = useState<LocalHistoryRecord[]>([]);
  const [redownloadingId, setRedownloadingId] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);

  const { toast } = useToast();

  const { data: publicSettings } = useGetPublicSettings({
    query: { queryKey: getGetPublicSettingsQueryKey() },
  });

  const { data: apiHistory, isLoading } = useListDownloadHistory({
    query: { queryKey: getListDownloadHistoryQueryKey() },
  });

  const isEnabled = publicSettings?.historyEnabled !== false;

  useEffect(() => {
    setLocalRecords(getLocalHistory());
  }, []);

  const handleClearHistory = () => {
    clearLocalHistory();
    setLocalRecords([]);
    toast({
      title: "History Cleared",
      description: "Download history has been reset.",
    });
  };

  const handleRedownload = async (record: LocalHistoryRecord) => {
    const folderName = getStoredFolderName() || "HutaoTik Downloads";
    let downloadUrl: string | null = record.downloadUrl ?? record.sourceUrl ?? null;

    if (!downloadUrl && record.platform !== "tiktok") {
      toast({
        title: "Download Link Unavailable",
        description: "Please copy and paste the original video link on the home page.",
        variant: "destructive",
      });
      return;
    }
    if (record.platform === "tiktok" && !record.sourceUrl && !record.downloadUrl) {
      toast({
        title: "Download Link Unavailable",
        description: "Please copy and paste the original TikTok link on the home page.",
        variant: "destructive",
      });
      return;
    }

    setRedownloadingId(record.id);
    setProgress(0);

    try {
      const isYouTubeAudio = record.platform === "youtube" &&
        /(m4a|mp3|audio)/i.test(record.quality);
      const isSocialImage = (record.platform === "pinterest" || record.platform === "instagram") &&
        /image|photo/i.test(record.quality);
      const ext = isYouTubeAudio
        ? "m4a"
        : isSocialImage
          ? "jpg"
          : record.quality.toLowerCase().includes("mp3") || record.quality.toLowerCase().includes("audio")
            ? "mp3"
            : "mp4";
      const safeTitle = (record.title || "video").replace(/[<>:"/\\|?*\x00-\x1f]/g, " ").trim().substring(0, 50);
      const filename = `${record.authorUsername}_${safeTitle}.${ext}`;

      if (record.platform === "tiktok" && record.sourceUrl) {
        const video = await fetchTiktokVideo(
          { url: record.sourceUrl },
          { signal: AbortSignal.timeout(120_000) },
        );
        const isTikTokAudio = /(mp3|audio)/i.test(record.quality);
        downloadUrl = isTikTokAudio
          ? video.downloadUrls.audio
          : video.downloadUrls.hd || video.downloadUrls.normal || video.downloadUrls.low;
        if (!downloadUrl) {
          throw new Error(`The requested TikTok ${isTikTokAudio ? "audio" : "video"} format is no longer available.`);
        }
      }

      if (record.platform === "twitter" && record.sourceUrl) {
        const info = await fetchTwitterFromFx(record.sourceUrl, AbortSignal.timeout(30_000));
        const requestedHeight = Number.parseInt(record.quality, 10);
        const selectedFormat = info.formats.find((format) => format.height === requestedHeight) ??
          info.formats[0];
        if (!selectedFormat) {
          throw new Error("No downloadable video format is currently available for this X post.");
        }
        downloadUrl = selectedFormat.downloadUrl;
      }

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
            );
            setProgress(100);
            toast({
              title: "Re-download Complete!",
              description: `Saved to Documents/${folderName}/${nativeResult.filename}`,
            });
            return;
          } catch {
            // Fall through to API fallback below
          }
        }
        downloadUrl = apiUrl(`/api/${record.platform}/download?${new URLSearchParams({
          url: record.sourceUrl,
          title: safeTitle,
        }).toString()}`);
      }

      if (record.platform === "youtube" && isNativeYouTubeAvailable()) {
        const nativeInfo = await fetchYouTubeInfoOnDevice(record.sourceUrl);
        let formatStr = "audio";
        if (!isYouTubeAudio) {
          const requestedHeight = Number.parseInt(record.quality, 10);
          const selectedFormat = nativeInfo.formats.find((format) =>
            format.qualityLabel === `${requestedHeight}p`
          ) ?? nativeInfo.formats[0];
          if (!selectedFormat) {
            throw new Error("No directly playable YouTube MP4 format is currently available.");
          }
          formatStr = selectedFormat.formatStr;
        }
        await downloadYouTubeOnDevice(record.sourceUrl, formatStr, filename, folderName);
        setProgress(100);
        toast({
          title: "Re-download Complete!",
          description: `Saved to Documents/${folderName}/${filename}`,
        });
        return;
      }

      if (record.platform === "facebook" && isNativeFacebookAvailable()) {
        const quality = ext === "mp3" ? "audio" : record.quality.toLowerCase().includes("sd") ? "sd" : "hd";
        await downloadFacebookOnDevice(record.sourceUrl, quality, filename, folderName);
        setProgress(100);
        toast({
          title: "Re-download Complete!",
          description: `Saved to Documents/${folderName}/${filename}`,
        });
        return;
      }

      if (!downloadUrl) {
        throw new Error("Download URL is unavailable.");
      }

      const requestUrl = record.platform === "tiktok"
        ? apiUrl(`/api/proxy-download?${new URLSearchParams({ url: downloadUrl, filename }).toString()}`)
        : downloadUrl;
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
              setProgress(Math.min(100, Math.round((loaded / total) * 100)));
            } else {
              setProgress((p) => (p >= 90 ? 90 : p + 10));
            }
          }
        }
      }

      setProgress(100);
      const blob = chunks.length > 0 ? new Blob(chunks as unknown as BlobPart[]) : await res.blob();
      await saveBlobToDevice(blob, filename, folderName);

      toast({
        title: "Re-download Complete!",
        description: `Saved to Documents/${folderName}/${filename}`,
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
      setProgress(0);
    }
  };

  // Merge local records and server records
  const allRecords: LocalHistoryRecord[] = [
    ...localRecords,
    ...(apiHistory || []).map((rec: any) => ({
      id: rec.id,
      title: rec.title || "Downloaded Video",
      author: rec.author || rec.authorUsername || "Creator",
      authorUsername: rec.authorUsername || "user",
      thumbnail: rec.thumbnail || null,
      quality: rec.quality || "HD",
      sourceUrl: "",
      downloadUrl: null,
      platform: "tiktok" as const,
      downloadedAt: rec.downloadedAt || new Date().toISOString(),
    })),
  ];

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-8 h-8 text-primary animate-spin" />
      </div>
    );
  }

  return (
    <div className="relative space-y-6 animate-in fade-in duration-500 max-w-2xl mx-auto">
      {/* Feature-disabled overlay */}
      {!isEnabled && (
        <div className="absolute inset-0 z-30 flex items-center justify-center rounded-2xl backdrop-blur-sm bg-background/60 min-h-[200px]">
          <div className="w-20 h-20 rounded-full bg-card border-2 border-border flex items-center justify-center shadow-xl">
            <LockKeyhole className="w-9 h-9 text-muted-foreground" />
          </div>
        </div>
      )}

      {allRecords.length === 0 ? (
        <div className="text-center py-20 border border-border border-dashed rounded-2xl bg-card p-6 space-y-3">
          <div className="w-16 h-16 bg-primary/10 border border-primary/25 rounded-2xl flex items-center justify-center mx-auto text-primary">
            <HistoryIcon className="w-8 h-8" />
          </div>
          <h2 className="text-xl font-syne font-bold">No Download History Yet</h2>
          <p className="text-muted-foreground text-xs max-w-xs mx-auto leading-relaxed">
            All videos and audio you download will be saved here automatically so you can easily re-download them anytime!
          </p>
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-syne font-bold">Download History</h1>
              <p className="text-xs text-muted-foreground mt-0.5">
                Re-download any video or audio anytime if deleted from your device.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={handleClearHistory}
                className="h-8 px-2.5 text-xs text-muted-foreground hover:text-destructive border-border gap-1"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Clear</span>
              </Button>
              <Badge variant="outline" className="bg-primary/10 border-primary/30 text-primary font-bold">
                {allRecords.length} Saved
              </Badge>
            </div>
          </div>

          <div className="space-y-3">
            {allRecords.map((record) => {
              const isDownloadingThis = redownloadingId === record.id;
              const PlatformIcon = record.platform === "youtube"
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
                <Card key={record.id} className="border-border bg-card overflow-hidden hover:border-primary/40 transition-all duration-200 shadow-sm">
                  <CardContent className="p-3 flex gap-3 items-center">
                    <div className="w-20 h-20 rounded-xl bg-secondary shrink-0 relative overflow-hidden border border-border">
                      {record.thumbnail ? (
                        <img src={record.thumbnail} alt={record.title} className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center">
                          <Download className="w-6 h-6 text-muted-foreground" />
                        </div>
                      )}
                      <div className="absolute top-1 left-1 bg-black/70 p-1 rounded-md text-white">
                        <PlatformIcon className="w-2.5 h-2.5" />
                      </div>
                    </div>

                    <div className="flex-1 min-w-0 space-y-1.5">
                      <h3 className="font-bold text-xs truncate leading-snug">{record.title || "Downloaded Video"}</h3>
                      <p className="text-[11px] text-muted-foreground truncate">@{record.authorUsername || record.author}</p>

                      <div className="flex items-center justify-between pt-0.5">
                        <Badge variant="secondary" className="text-[9px] px-2 py-0 h-4 bg-primary/15 border-primary/30 text-primary font-bold uppercase">
                          {record.quality}
                        </Badge>
                        <span className="text-[10px] text-muted-foreground font-mono">
                          {formatDistanceToNow(new Date(record.downloadedAt), { addSuffix: true })}
                        </span>
                      </div>
                    </div>

                    <div className="shrink-0">
                      <Button
                        size="sm"
                        onClick={() => handleRedownload(record)}
                        disabled={isDownloadingThis}
                        className="h-9 px-3 text-xs font-bold bg-primary hover:bg-primary/90 text-primary-foreground rounded-xl flex items-center gap-1.5 shadow-sm active:scale-95 transition-all"
                      >
                        {isDownloadingThis ? (
                          <>
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            <span>{progress}%</span>
                          </>
                        ) : (
                          <>
                            <Download className="w-3.5 h-3.5" />
                            <span>Re-download</span>
                          </>
                        )}
                      </Button>
                    </div>
                  </CardContent>

                  {/* Progress bar overlay if re-downloading */}
                  {isDownloadingThis && (
                    <div className="w-full bg-secondary/80 h-1 overflow-hidden">
                      <div
                        className="bg-primary h-full transition-all duration-300"
                        style={{ width: `${progress}%` }}
                      />
                    </div>
                  )}
                </Card>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
