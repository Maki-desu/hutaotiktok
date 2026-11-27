import { useEffect, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Download,
  FolderCheck,
  Image as ImageIcon,
  Loader2,
  LockKeyhole,
  RefreshCw,
} from "lucide-react";
import { SiInstagram, SiPinterest } from "react-icons/si";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { apiUrl } from "@/lib/api-url";
import { saveBlobToDevice } from "@/lib/download-folder";
import {
  fetchBlobWithProgress,
  type DownloadProgressState,
} from "@/lib/download-progress";
import { DownloadProgressCard } from "@/components/download-progress-card";
import { saveLocalHistoryRecord } from "@/lib/local-history";
import {
  downloadSocialVideoOnDevice,
  fetchSocialVideoInfoOnDevice,
  isNativeSocialVideoAvailable,
  type SocialVideoPlatform,
} from "@/lib/social-native";
import { useToast } from "@/hooks/use-toast";

interface SocialVideoInfo {
  id: string;
  title: string;
  thumbnail: string | null;
  channelName: string;
  duration: number;
  height: number | null;
  mediaType?: "video" | "image";
  directUrl?: string | null;
  canonicalUrl?: string | null;
  nativeDownload?: boolean;
}

interface Props {
  platform: SocialVideoPlatform;
  url: string;
  folderName?: string | null;
  onOpenFolderPicker?: () => void;
}

function isSocialVideoInfo(value: unknown): value is SocialVideoInfo {
  if (typeof value !== "object" || value === null) return false;
  const info = value as Record<string, unknown>;
  return (
    typeof info.id === "string" &&
    typeof info.title === "string" &&
    typeof info.channelName === "string" &&
    (info.thumbnail === null || typeof info.thumbnail === "string") &&
    typeof info.duration === "number" &&
    (info.height === null || (typeof info.height === "number" && Number.isFinite(info.height)))
  );
}

async function readApiInfo(response: Response, providerName: string): Promise<SocialVideoInfo> {
  const body = await response.text();
  let data: unknown;
  try {
    data = JSON.parse(body);
  } catch {
    throw new Error(response.ok
      ? `The ${providerName} service returned an invalid response.`
      : `${providerName} request failed (HTTP ${response.status}).`);
  }

  if (!response.ok) {
    const message = typeof data === "object" && data !== null && "error" in data &&
      typeof data.error === "string"
      ? data.error
      : `${providerName} request failed (HTTP ${response.status}).`;
    throw new Error(message);
  }
  if (!isSocialVideoInfo(data)) {
    throw new Error(`The ${providerName} service returned invalid media information.`);
  }
  return {
    ...data,
    mediaType: data.mediaType === "image" ? "image" : "video",
  };
}

function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "";
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${String(secs).padStart(2, "0")}`;
}

export function SocialVideoSection({ platform, url, folderName, onOpenFolderPicker }: Props) {
  const providerName = platform === "instagram" ? "Instagram" : "Pinterest";
  const ProviderIcon = platform === "instagram" ? SiInstagram : SiPinterest;
  const [info, setInfo] = useState<SocialVideoInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState<DownloadProgressState>({ percent: 0 });
  const [error, setError] = useState<string | null>(null);
  const [thumbFailed, setThumbFailed] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const [downloadSuccessInfo, setDownloadSuccessInfo] = useState<{
    filename: string;
    folder: string;
  } | null>(null);
  const { toast } = useToast();

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setInfo(null);
    setError(null);
    setThumbFailed(false);
    setDownloadSuccessInfo(null);

    const loadInfo = async (): Promise<SocialVideoInfo> => {
      let nativeError: unknown = null;
      if (isNativeSocialVideoAvailable()) {
        try {
          return await fetchSocialVideoInfoOnDevice(platform, url);
        } catch (err) {
          nativeError = err;
        }
      }

      if (controller.signal.aborted) {
        throw new DOMException("Aborted", "AbortError");
      }

      try {
        const response = await fetch(
          apiUrl(`/api/${platform}/info?url=${encodeURIComponent(url)}`),
          { signal: controller.signal },
        );
        return await readApiInfo(response, providerName);
      } catch (apiError) {
        if (controller.signal.aborted) throw apiError;
        if (nativeError instanceof Error && nativeError.message) {
          throw nativeError;
        }
        throw apiError;
      }
    };

    void loadInfo()
      .then((data) => {
        if (!controller.signal.aborted) setInfo(data);
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) {
          setError(
            cause instanceof Error
              ? cause.message
              : `Could not fetch ${providerName} media information.`,
          );
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [platform, providerName, url, retryCount]);

  const downloadViaApi = async (safeTitle: string, isImage: boolean, targetFolder: string) => {
    const response = await fetch(
      apiUrl(`/api/${platform}/download?${new URLSearchParams({ url, title: safeTitle }).toString()}`),
      { signal: AbortSignal.timeout(600_000) },
    );
    if (!response.ok) {
      const body = await response.text();
      let message = `${providerName} download failed (HTTP ${response.status}).`;
      try {
        const data: unknown = JSON.parse(body);
        if (
          typeof data === "object" &&
          data !== null &&
          "error" in data &&
          typeof data.error === "string"
        ) {
          message = data.error;
        }
      } catch {
        if (response.status >= 500) {
          message = `${providerName} downloads are temporarily unavailable. Please try again later.`;
        }
      }
      throw new Error(message);
    }

    const blob = await fetchBlobWithProgress(response, setDownloadProgress, {
      startPercent: 2,
      endPercent: 88,
      status: `Downloading ${providerName} ${isImage ? "image" : "video"}…`,
    });
    if (blob.size === 0) throw new Error(`The ${providerName} service returned an empty file.`);
    if (blob.type.includes("text/html") || blob.type.includes("application/json")) {
      throw new Error(`The ${providerName} service returned an error instead of media.`);
    }

    let ext = isImage ? "jpg" : "mp4";
    if (blob.type.includes("image/png")) ext = "png";
    else if (blob.type.includes("image/webp")) ext = "webp";
    else if (blob.type.includes("image/gif")) ext = "gif";
    else if (blob.type.includes("image/jpeg")) ext = "jpg";

    const filename = `${safeTitle}.${ext}`;
    await saveBlobToDevice(blob, filename, targetFolder, setDownloadProgress, {
      startPercent: 88,
      endPercent: 100,
    });
    return filename;
  };

  const download = async () => {
    if (!info) return;
    if (!folderName) {
      onOpenFolderPicker?.();
      return;
    }

    setDownloading(true);
    setDownloadProgress({ percent: 0, status: `Starting ${providerName} download…` });
    setDownloadSuccessInfo(null);
    const isImage = info.mediaType === "image";
    const safeTitle =
      info.title
        .replace(/[<>:"/\\|?*\x00-\x1f]/g, " ")
        .trim()
        .slice(0, 60) || `${providerName} ${isImage ? "Image" : "Video"}`;
    const initialFilename = `${safeTitle}.${isImage ? "jpg" : "mp4"}`;

    try {
      let savedFilename = initialFilename;
      if (isNativeSocialVideoAvailable()) {
        try {
          const nativeResult = await downloadSocialVideoOnDevice(
            platform,
            info.canonicalUrl || url,
            info.directUrl ?? null,
            isImage ? "image" : "video",
            initialFilename,
            folderName,
            setDownloadProgress,
          );
          savedFilename = nativeResult.filename || initialFilename;
        } catch (nativeErr) {
          try {
            savedFilename = await downloadViaApi(safeTitle, isImage, folderName);
          } catch {
            throw nativeErr;
          }
        }
      } else {
        savedFilename = await downloadViaApi(safeTitle, isImage, folderName);
      }

      saveLocalHistoryRecord({
        title: info.title || `${providerName} ${isImage ? "Image" : "Video"}`,
        author: info.channelName,
        authorUsername: info.channelName,
        thumbnail: info.thumbnail,
        quality: isImage
          ? "Original Image"
          : info.height
            ? `Best available (${info.height}p)`
            : "Best available",
        sourceUrl: info.canonicalUrl || url,
        downloadUrl: null,
        platform,
      });
      setDownloadSuccessInfo({ filename: savedFilename, folder: folderName });
      toast({
        title: `${providerName} Download Complete!`,
        description: `Saved ${savedFilename} inside ${folderName}`,
      });
    } catch (cause) {
      toast({
        title: "Download failed",
        description:
          cause instanceof Error
            ? cause.message
            : `Could not download this ${providerName} ${isImage ? "image" : "video"}.`,
        variant: "destructive",
      });
    } finally {
      setDownloading(false);
      setDownloadProgress({ percent: 0 });
    }
  };

  if (loading) {
    return (
      <div className="bg-card rounded-2xl border border-border p-4 space-y-3">
        <div className="flex items-center gap-3">
          <Skeleton className="w-24 h-16 rounded-lg" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-3 w-1/2" />
          </div>
        </div>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin" />
          Finding the highest available quality…
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="animate-error-shake bg-card rounded-2xl border border-destructive/30 p-4 space-y-3">
        <div className="flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-destructive shrink-0 mt-0.5" />
          <div className="min-w-0 flex-1">
            <p className="font-semibold text-sm">Could not fetch {providerName} media</p>
            <p className="text-sm text-muted-foreground mt-1 break-words">{error}</p>
          </div>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setRetryCount((count) => count + 1)}
          className="w-full h-9 rounded-xl text-xs font-semibold gap-1.5"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Try again
        </Button>
      </div>
    );
  }

  if (!info) return null;

  const isImage = info.mediaType === "image";

  return (
    <div className="animate-card-bounce-in bg-card rounded-2xl border border-border overflow-hidden shadow-sm">
      <div className="flex gap-4 p-4">
        <div className="relative w-32 shrink-0 rounded-xl overflow-hidden aspect-video bg-secondary border border-border flex items-center justify-center">
          {info.thumbnail && !thumbFailed ? (
            <img
              src={info.thumbnail}
              alt=""
              referrerPolicy="no-referrer"
              onError={() => setThumbFailed(true)}
              className="w-full h-full object-cover"
            />
          ) : (
            <ProviderIcon
              className={`w-8 h-8 ${platform === "instagram" ? "text-pink-600/40" : "text-red-600/40"}`}
            />
          )}
          {!isImage && info.duration > 0 && (
            <div className="absolute bottom-1 right-1 bg-black/70 text-white text-[9px] font-mono px-1 py-px rounded">
              {formatDuration(info.duration)}
            </div>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <ProviderIcon
              className={`w-3.5 h-3.5 ${platform === "instagram" ? "text-pink-600" : "text-red-600"}`}
            />
            <span>{providerName} {isImage ? "image" : "video"}</span>
            {isImage && <ImageIcon className="w-3 h-3 ml-0.5" />}
          </div>
          <p className="font-semibold text-sm mt-1 line-clamp-2">{info.title}</p>
          <p className="text-xs text-muted-foreground mt-1 truncate">{info.channelName}</p>
        </div>
      </div>

      {downloading && (
        <DownloadProgressCard
          title={`Downloading ${providerName} ${isImage ? "image" : "video"} to ${folderName}…`}
          progress={downloadProgress}
          className="px-4 pb-3"
        />
      )}

      {downloadSuccessInfo && !downloading && (
        <div className="px-4 pb-3 animate-success-pop">
          <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-xl p-3 flex items-start gap-3">
            <div className="w-8 h-8 rounded-full bg-emerald-500/20 flex items-center justify-center text-emerald-500 shrink-0 mt-0.5">
              <CheckCircle2 className="w-5 h-5 animate-pill-pop" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-extrabold text-emerald-400 leading-tight">
                {providerName} Download Complete!
              </p>
              <p className="text-[11px] text-foreground font-medium truncate mt-0.5">
                {downloadSuccessInfo.filename}
              </p>
              <p className="text-[10px] text-muted-foreground mt-0.5 flex items-center gap-1">
                <FolderCheck className="w-3 h-3 text-emerald-400 shrink-0" />
                Saved in device folder: <strong>{downloadSuccessInfo.folder}</strong>
              </p>
            </div>
          </div>
        </div>
      )}

      <div className="px-4 pb-4 space-y-3">
        <div className="flex items-center justify-between rounded-xl bg-primary/5 border border-primary/20 p-3 text-xs">
          <span className="text-muted-foreground">Download quality</span>
          <span className="font-bold text-primary">
            {isImage
              ? "Original resolution"
              : `Highest available${info.height ? ` · ${info.height}p` : ""}`}
          </span>
        </div>
        {!folderName ? (
          <Button
            type="button"
            onClick={onOpenFolderPicker}
            className="w-full max-w-full h-auto min-h-11 py-2.5 px-4 whitespace-normal text-center leading-snug font-bold text-xs sm:text-sm rounded-xl bg-amber-500/15 border border-amber-500/40 text-amber-500 hover:bg-amber-500/25 flex items-center justify-center gap-2"
          >
            <LockKeyhole className="w-4 h-4 shrink-0 text-amber-500 animate-pulse" />
            <span className="min-w-0">Select a download location to continue</span>
          </Button>
        ) : (
          <Button
            type="button"
            onClick={download}
            disabled={downloading}
            className="w-full max-w-full overflow-hidden h-11 px-4 font-bold text-sm rounded-xl flex items-center justify-center gap-2"
          >
            {downloading ? (
              <>
                <Loader2 className="w-4 h-4 shrink-0 animate-spin" />
                <span className="min-w-0 truncate">Downloading… {downloadProgress.percent}%</span>
              </>
            ) : (
              <>
                <Download className="w-4 h-4 shrink-0" />
                <span className="min-w-0 truncate">
                  Save {isImage ? "Original Image" : "Highest Quality MP4"} to {folderName}
                </span>
              </>
            )}
          </Button>
        )}
        {folderName && (
          <p className="text-[11px] text-muted-foreground flex items-center justify-center gap-1 min-w-0 px-2">
            <FolderCheck className="w-3.5 h-3.5 shrink-0" />
            <span className="truncate">Saves to Documents/{folderName}</span>
          </p>
        )}
      </div>
    </div>
  );
}
