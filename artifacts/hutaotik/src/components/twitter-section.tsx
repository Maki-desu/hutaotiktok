import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertCircle,
  CheckCircle2,
  Download,
  Film,
  FolderCheck,
  Loader2,
} from "lucide-react";
import { SiX } from "react-icons/si";
import { apiUrl } from "@/lib/api-url";
import { saveBlobToDevice } from "@/lib/download-folder";
import {
  fetchBlobWithProgress,
  type DownloadProgressState,
} from "@/lib/download-progress";
import { DownloadProgressCard } from "@/components/download-progress-card";
import { saveLocalHistoryRecord } from "@/lib/local-history";
import {
  convertVideoBlobToGifNative,
  hasNativeGifConverter,
} from "@/lib/native-media";
import {
  downloadUrlInBackgroundNative,
  isNativeBackgroundDownloadAvailable,
} from "@/lib/background-download";
import { fetchTwitterFromFx } from "@/lib/twitter-fx";
import { createTimedCache, raceFastest } from "@/lib/fetch-cache";
import {
  fetchTwitterInfoOnDevice,
  isNativeTwitterFetchAvailable,
} from "@/lib/background-fetch";
import { notifyWebFetchComplete } from "@/lib/notifications";
import { useToast } from "@/hooks/use-toast";

interface TwitterFormat {
  height: number | null;
  qualityLabel: string;
  downloadUrl?: string;
}

interface TwitterInfo {
  id: string;
  title: string;
  thumbnail: string | null;
  channelName: string;
  duration: number;
  isGif?: boolean;
  formats: TwitterFormat[];
}

interface Props {
  url: string;
  folderName?: string | null;
  onOpenFolderPicker?: () => void;
}

function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "";
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.floor(seconds % 60);
  return `${minutes}:${String(remainingSeconds).padStart(2, "0")}`;
}

async function parseApiResponse<T>(response: Response, platform: string): Promise<T> {
  const body = await response.text();
  let data: unknown;
  try {
    data = JSON.parse(body);
  } catch {
    if (!response.ok) throw new Error(`${platform} request failed (${response.status}).`);
    throw new Error(`The ${platform} service returned an invalid response.`);
  }

  if (!response.ok) {
    const message =
      typeof data === "object" && data !== null && "error" in data && typeof data.error === "string"
        ? data.error
        : `${platform} request failed (${response.status}).`;
    throw new Error(message);
  }
  if (typeof data !== "object" || data === null || !Array.isArray((data as { formats?: unknown }).formats)) {
    throw new Error(`The ${platform} service returned invalid video information.`);
  }
  return data as T;
}

const twitterInfoCache = createTimedCache<TwitterInfo>(300_000, 60);

export function seedTwitterInfoCache(url: string, data: unknown): void {
  if (!data || typeof data !== "object") return;
  const info = data as Partial<TwitterInfo>;
  if (!Array.isArray(info.formats) || info.formats.length === 0) return;
  twitterInfoCache.set(url, {
    id: info.id ?? "",
    title: info.title ?? "X Video",
    thumbnail: info.thumbnail ?? null,
    channelName: info.channelName ?? "X Creator",
    duration: info.duration ?? 0,
    isGif: info.isGif,
    formats: info.formats,
  });
}

export function TwitterSection({ url, folderName, onOpenFolderPicker }: Props) {
  const [info, setInfo] = useState<TwitterInfo | null>(null);
  const [selectedHeight, setSelectedHeight] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [fetchStatus, setFetchStatus] = useState<string>("Fetching X video…");
  const [downloadingMode, setDownloadingMode] = useState<"mp4" | "gif" | null>(null);
  const [downloadProgress, setDownloadProgress] = useState<DownloadProgressState>({ percent: 0 });
  const [error, setError] = useState<string | null>(null);
  const [downloadSuccessInfo, setDownloadSuccessInfo] = useState<{
    filename: string;
    folder: string;
  } | null>(null);
  const { toast } = useToast();

  const downloading = downloadingMode !== null;

  useEffect(() => {
    const cached = twitterInfoCache.get(url);
    if (cached) {
      setInfo(cached);
      setSelectedHeight(cached.formats.length > 0 ? cached.formats[0].height : null);
      setError(null);
      setLoading(false);
      setDownloadSuccessInfo(null);
      return;
    }

    const controller = new AbortController();
    setLoading(true);
    setFetchStatus("Fetching in background — safe to exit app…");
    setInfo(null);
    setSelectedHeight(null);
    setError(null);
    setDownloadSuccessInfo(null);

    const requestInfo = async (): Promise<TwitterInfo> => {
      if (isNativeTwitterFetchAvailable()) {
        try {
          return await fetchTwitterInfoOnDevice(url, (progress) => {
            if (progress.status) setFetchStatus(progress.status);
          });
        } catch (nativeErr) {
          if (controller.signal.aborted) throw nativeErr;
          if (nativeErr instanceof Error && /cancelled/i.test(nativeErr.message)) {
            throw nativeErr;
          }
        }
      }
      return raceFastest<TwitterInfo>(
        [
          (childSignal) => fetchTwitterFromFx(url, childSignal),
          async (childSignal) => {
            const response = await fetch(apiUrl(`/api/twitter/info?url=${encodeURIComponent(url)}`), {
              signal: childSignal,
            });
            const data = await parseApiResponse<TwitterInfo>(response, "X video information");
            if (data.formats.length === 0) {
              throw new Error("No downloadable video or GIF was found in this X post.");
            }
            return data;
          },
        ],
        controller.signal,
      );
    };

    requestInfo()
      .then((data) => {
        if (controller.signal.aborted) return;
        twitterInfoCache.set(url, data);
        notifyWebFetchComplete("X", data.title);
        setInfo(data);
        if (data.formats.length > 0) {
          setSelectedHeight(data.formats[0].height);
        }
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        setError(cause instanceof Error ? cause.message : "Could not fetch X video or GIF.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [url]);

  const fetchSourceMp4Blob = async (
    safeTitle: string,
    selectedFormat: TwitterFormat | undefined,
    endPercent: number,
  ): Promise<{ blob: Blob; usedApiUrl: string | null }> => {
    const quality = selectedHeight === null ? "best" : String(selectedHeight);
    const apiDownloadUrl = apiUrl(
      `/api/twitter/download?url=${encodeURIComponent(url)}&quality=${encodeURIComponent(quality)}&title=${encodeURIComponent(safeTitle)}`,
    );
    let downloadUrl = selectedFormat?.downloadUrl ?? apiDownloadUrl;

    const requestOptions = {
      referrerPolicy: "no-referrer" as ReferrerPolicy,
      signal: AbortSignal.timeout(120_000),
    };
    let response: Response | null = null;
    if (selectedFormat?.downloadUrl) {
      response = await fetch(downloadUrl, requestOptions);
    } else {
      try {
        response = await fetch(downloadUrl, requestOptions);
      } catch (cause) {
        if (cause instanceof Error && (cause.name === "AbortError" || cause.name === "TimeoutError")) {
          throw cause;
        }
      }
      const contentType = response?.headers.get("content-type") ?? "";
      if (!response?.ok || contentType.includes("text/html") || contentType.includes("application/json")) {
        await response?.body?.cancel();
        const fallbackInfo = await fetchTwitterFromFx(url);
        const fallbackFormat =
          fallbackInfo.formats.find((format) => format.height === selectedHeight) ??
          fallbackInfo.formats[0];
        if (!fallbackFormat) throw new Error("No downloadable video or GIF format was found for this X post.");
        downloadUrl = fallbackFormat.downloadUrl;
        response = await fetch(downloadUrl, requestOptions);
      }
    }

    if (!response) throw new Error("The X provider did not return a response.");
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`X download failed (HTTP ${response.status}).`);
    }

    const blob = await fetchBlobWithProgress(response, setDownloadProgress, {
      startPercent: 2,
      endPercent,
      status: info?.isGif ? "Downloading X GIF…" : "Downloading X video…",
    });
    if (blob.size === 0) throw new Error("The server returned an empty file.");
    if (blob.type.includes("text/html") || blob.type.includes("application/json")) {
      throw new Error("The download provider returned an error page instead of media.");
    }

    return {
      blob,
      usedApiUrl: downloadUrl === apiDownloadUrl ? downloadUrl : null,
    };
  };

  const handleDownloadMp4 = async () => {
    if (!info) return;
    if (!folderName) {
      onOpenFolderPicker?.();
      return;
    }

    setDownloadingMode("mp4");
    setDownloadProgress({ percent: 0, status: "Connecting to X…" });
    setDownloadSuccessInfo(null);
    const safeTitle = (info.title || (info.isGif ? "X GIF" : "X Video"))
      .replace(/[<>:"/\\|?*\x00-\x1f]/g, " ")
      .trim()
      .substring(0, 60) || "X Video";
    const selectedFormat = info.formats.find((format) => format.height === selectedHeight);
    const qualityLabel = selectedFormat?.qualityLabel ?? "Best available";
    const filename = `${safeTitle}${selectedHeight === null ? "" : ` - ${selectedHeight}p`}.mp4`;

    try {
      let usedApiUrl: string | null = null;
      if (isNativeBackgroundDownloadAvailable()) {
        const quality = selectedHeight === null ? "best" : String(selectedHeight);
        const apiDownloadUrl = apiUrl(
          `/api/twitter/download?url=${encodeURIComponent(url)}&quality=${encodeURIComponent(quality)}&title=${encodeURIComponent(safeTitle)}`,
        );
        let targetUrl = selectedFormat?.downloadUrl ?? apiDownloadUrl;
        let nativeSucceeded = false;

        if (targetUrl.startsWith("https://")) {
          try {
            await downloadUrlInBackgroundNative({
              url: targetUrl,
              filename,
              folderName,
              title: `X · ${safeTitle}`,
              mimeType: "video/mp4",
              onProgress: setDownloadProgress,
            });
            usedApiUrl = targetUrl === apiDownloadUrl ? apiDownloadUrl : null;
            nativeSucceeded = true;
          } catch (firstErr) {
            if (
              firstErr instanceof Error &&
              /cancelled/i.test(firstErr.message)
            ) {
              throw firstErr;
            }
            if (!selectedFormat?.downloadUrl) {
              const fallbackInfo = await fetchTwitterFromFx(url);
              const fallbackFormat =
                fallbackInfo.formats.find((format) => format.height === selectedHeight) ??
                fallbackInfo.formats[0];
              if (fallbackFormat?.downloadUrl?.startsWith("https://")) {
                await downloadUrlInBackgroundNative({
                  url: fallbackFormat.downloadUrl,
                  filename,
                  folderName,
                  title: `X · ${safeTitle}`,
                  mimeType: "video/mp4",
                  onProgress: setDownloadProgress,
                });
                nativeSucceeded = true;
              } else {
                throw firstErr;
              }
            } else {
              throw firstErr;
            }
          }
        }

        if (!nativeSucceeded) {
          const { blob, usedApiUrl: fallbackUrl } = await fetchSourceMp4Blob(safeTitle, selectedFormat, 88);
          usedApiUrl = fallbackUrl;
          await saveBlobToDevice(blob, filename, folderName, setDownloadProgress, {
            startPercent: 88,
            endPercent: 100,
          });
        }
      } else {
        const { blob, usedApiUrl: fetchedApiUrl } = await fetchSourceMp4Blob(safeTitle, selectedFormat, 88);
        usedApiUrl = fetchedApiUrl;
        await saveBlobToDevice(blob, filename, folderName, setDownloadProgress, {
          startPercent: 88,
          endPercent: 100,
        });
      }

      saveLocalHistoryRecord({
        title: info.title || "X Video",
        author: info.channelName,
        authorUsername: info.channelName,
        thumbnail: info.thumbnail,
        quality: info.isGif ? `${qualityLabel} MP4` : qualityLabel,
        sourceUrl: url,
        downloadUrl: usedApiUrl ?? url,
        platform: "twitter",
      });
      setDownloadSuccessInfo({ filename, folder: folderName });
      toast({
        title: "X Download Complete!",
        description: `Saved ${filename} to ${folderName}`,
      });
    } catch (cause: unknown) {
      toast({
        title: "Download failed",
        description: cause instanceof Error ? cause.message : "Could not download this X video.",
        variant: "destructive",
      });
    } finally {
      setDownloadingMode(null);
      setDownloadProgress({ percent: 0 });
    }
  };

  const handleDownloadGif = async () => {
    if (!info) return;
    if (!folderName) {
      onOpenFolderPicker?.();
      return;
    }

    setDownloadingMode("gif");
    setDownloadProgress({ percent: 0, status: "Preparing animated GIF…" });
    setDownloadSuccessInfo(null);

    const safeTitle = (info.title || "X GIF")
      .replace(/[<>:"/\\|?*\x00-\x1f]/g, " ")
      .trim()
      .substring(0, 60) || "X GIF";
    const selectedFormat = info.formats.find((format) => format.height === selectedHeight);
    const filename = `${safeTitle}.gif`;

    try {
      let savedFilename = filename;

      if (hasNativeGifConverter()) {
        // Android APK: download source MP4 directly and convert to crisp looping GIF via bundled FFmpeg
        const { blob } = await fetchSourceMp4Blob(safeTitle, selectedFormat, 52);
        const result = await convertVideoBlobToGifNative(
          blob,
          filename,
          folderName,
          15,
          setDownloadProgress,
          55,
        );
        savedFilename = result.filename;
      } else {
        // Web fallback: request server-side GIF conversion
        const quality = selectedHeight === null ? "best" : String(selectedHeight);
        const gifUrl = apiUrl(
          `/api/twitter/gif?url=${encodeURIComponent(url)}&quality=${encodeURIComponent(quality)}&title=${encodeURIComponent(safeTitle)}`,
        );
        setDownloadProgress({ percent: 15, status: "Converting X clip to GIF on server…" });
        const response = await fetch(gifUrl, { signal: AbortSignal.timeout(180_000) });
        if (!response.ok) {
          let errMsg = `GIF conversion failed (HTTP ${response.status}).`;
          try {
            const errJson = (await response.json()) as { error?: string };
            if (errJson.error) errMsg = errJson.error;
          } catch {
            /* ignore */
          }
          throw new Error(errMsg);
        }
        const gifBlob = await fetchBlobWithProgress(response, setDownloadProgress, {
          startPercent: 20,
          endPercent: 88,
          status: "Downloading animated GIF…",
        });
        if (gifBlob.size === 0) throw new Error("The server returned an empty GIF file.");
        await saveBlobToDevice(gifBlob, filename, folderName, setDownloadProgress, {
          startPercent: 88,
          endPercent: 100,
        });
      }

      saveLocalHistoryRecord({
        title: info.title || "X GIF",
        author: info.channelName,
        authorUsername: info.channelName,
        thumbnail: info.thumbnail,
        quality: "GIF",
        sourceUrl: url,
        downloadUrl: url,
        platform: "twitter",
      });
      setDownloadSuccessInfo({ filename: savedFilename, folder: folderName });
      toast({
        title: "X GIF Saved!",
        description: `Saved ${savedFilename} inside ${folderName}`,
      });
    } catch (cause: unknown) {
      toast({
        title: "GIF Download Failed",
        description: cause instanceof Error ? cause.message : "Could not convert this X post to GIF.",
        variant: "destructive",
      });
    } finally {
      setDownloadingMode(null);
      setDownloadProgress({ percent: 0 });
    }
  };

  if (loading) {
    return (
      <div className="bg-card rounded-2xl border border-border p-4 space-y-3">
        <div className="flex gap-4">
          <Skeleton className="w-32 shrink-0 aspect-video rounded-xl bg-secondary/60" />
          <div className="flex-1 space-y-3 pt-1">
            <Skeleton className="h-4 w-3/4 bg-secondary/60 rounded-lg" />
            <Skeleton className="h-3 w-1/2 bg-secondary/60 rounded-lg" />
            <Skeleton className="h-7 w-16 bg-secondary/60 rounded-full" />
          </div>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="w-3.5 h-3.5 animate-spin text-primary shrink-0" />
          <span className="truncate">{fetchStatus} · You can leave the app &amp; we&apos;ll notify you when ready.</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="animate-error-shake flex items-start gap-2.5 bg-destructive/10 border border-destructive/30 rounded-xl px-3 py-2.5">
        <AlertCircle className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
        <p className="text-sm text-destructive leading-snug">{error}</p>
      </div>
    );
  }

  if (!info) return null;

  const selectedFormat = info.formats.find((format) => format.height === selectedHeight);
  const isGifPost = Boolean(info.isGif);

  return (
    <div className="animate-card-bounce-in bg-card rounded-2xl border border-border overflow-hidden shadow-sm">
      <div className="flex gap-4 p-4">
        <div className="relative w-32 shrink-0 rounded-xl overflow-hidden aspect-video bg-secondary border border-border">
          {info.thumbnail ? (
            <img src={info.thumbnail} alt={info.title} className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <SiX className="w-8 h-8 text-foreground/30" />
            </div>
          )}
          {isGifPost && (
            <div className="absolute top-1 left-1 bg-primary text-primary-foreground text-[9px] font-extrabold uppercase tracking-wider px-1.5 py-0.5 rounded shadow">
              GIF
            </div>
          )}
          {info.duration > 0 && (
            <div className="absolute bottom-1 right-1 bg-black/70 text-white text-[9px] font-mono px-1 py-px rounded">
              {formatDuration(info.duration)}
            </div>
          )}
        </div>
        <div className="flex-1 min-w-0 flex flex-col gap-1.5">
          <div className="flex items-start gap-1.5">
            <p className="text-sm font-semibold leading-snug line-clamp-2 flex-1">{info.title}</p>
            {isGifPost && (
              <Badge className="shrink-0 bg-primary/15 text-primary border border-primary/30 text-[10px] font-bold">
                X GIF
              </Badge>
            )}
          </div>
          <p className="text-xs text-muted-foreground flex items-center gap-1">
            <SiX className="w-3 h-3 shrink-0" />
            {info.channelName}
          </p>
        </div>
      </div>

      {info.formats.length > 0 && (
        <div className="px-4 pb-3">
          <p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-2 font-semibold">
            {isGifPost ? "Source Quality" : "Video Quality"}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {info.formats.map((format) => (
              <button
                key={format.qualityLabel}
                type="button"
                onClick={() => setSelectedHeight(format.height)}
                aria-pressed={selectedHeight === format.height}
                className={`px-3 py-1 rounded-full text-xs font-semibold border transition-all cursor-pointer ${
                  selectedHeight === format.height
                    ? "bg-primary border-primary text-primary-foreground shadow-sm shadow-primary/30"
                    : "border-border text-muted-foreground hover:border-primary/50 hover:text-foreground"
                }`}
              >
                {format.qualityLabel}
              </button>
            ))}
          </div>
        </div>
      )}

      {downloading && (
        <DownloadProgressCard
          title={
            downloadingMode === "gif"
              ? `Creating animated GIF in ${folderName}…`
              : `Downloading X video to ${folderName}…`
          }
          progress={downloadProgress}
          className="px-4 pb-3"
        />
      )}

      {downloadSuccessInfo && !downloading && (
        <div className="animate-success-pop mx-4 mb-3 bg-emerald-500/10 border border-emerald-500/30 rounded-xl p-3 flex items-start gap-3">
          <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0 mt-0.5 animate-pill-pop" />
          <div className="min-w-0">
            <p className="text-xs font-extrabold text-emerald-400">Download Complete!</p>
            <p className="text-[11px] text-foreground truncate mt-0.5">{downloadSuccessInfo.filename}</p>
            <p className="text-[10px] text-muted-foreground mt-0.5 flex items-center gap-1">
              <FolderCheck className="w-3 h-3 text-emerald-400 shrink-0" />
              Saved in device folder: <strong>{downloadSuccessInfo.folder}</strong>
            </p>
          </div>
        </div>
      )}

      <div className="px-4 pb-4 space-y-2">
        {!folderName ? (
          <Button
            type="button"
            onClick={onOpenFolderPicker}
            className="w-full max-w-full h-auto min-h-11 py-2.5 px-4 whitespace-normal text-center leading-snug font-bold text-xs sm:text-sm rounded-xl"
          >
            <span className="min-w-0">Select a download location</span>
          </Button>
        ) : isGifPost ? (
          <>
            <Button
              type="button"
              onClick={handleDownloadGif}
              disabled={!selectedFormat || downloading}
              className="w-full max-w-full overflow-hidden h-11 px-4 font-bold text-sm rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground shadow-md shadow-primary/25 flex items-center justify-center gap-2"
            >
              {downloadingMode === "gif" ? (
                <>
                  <Loader2 className="w-4 h-4 shrink-0 animate-spin" />
                  <span className="min-w-0 truncate">Converting GIF… {downloadProgress.percent}%</span>
                </>
              ) : (
                <>
                  <Film className="w-4 h-4 shrink-0" />
                  <span className="min-w-0 truncate">Download GIF (.gif) to {folderName}</span>
                </>
              )}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={handleDownloadMp4}
              disabled={!selectedFormat || downloading}
              className="w-full max-w-full overflow-hidden h-10 px-4 font-semibold text-xs sm:text-sm rounded-xl flex items-center justify-center gap-2"
            >
              {downloadingMode === "mp4" ? (
                <>
                  <Loader2 className="w-4 h-4 shrink-0 animate-spin" />
                  <span className="min-w-0 truncate">Downloading MP4… {downloadProgress.percent}%</span>
                </>
              ) : (
                <>
                  <Download className="w-4 h-4 shrink-0" />
                  <span className="min-w-0 truncate">Save Original as MP4 ({selectedFormat?.qualityLabel ?? "Best"})</span>
                </>
              )}
            </Button>
          </>
        ) : (
          <>
            <Button
              type="button"
              onClick={handleDownloadMp4}
              disabled={!selectedFormat || downloading}
              className="w-full max-w-full overflow-hidden h-11 px-4 font-bold text-sm rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground shadow-md shadow-primary/25 flex items-center justify-center gap-2"
            >
              {downloadingMode === "mp4" ? (
                <>
                  <Loader2 className="w-4 h-4 shrink-0 animate-spin" />
                  <span className="min-w-0 truncate">Downloading… {downloadProgress.percent}%</span>
                </>
              ) : (
                <>
                  <Download className="w-4 h-4 shrink-0" />
                  <span className="min-w-0 truncate">Save {selectedFormat?.qualityLabel ?? "X Video"} to {folderName}</span>
                </>
              )}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={handleDownloadGif}
              disabled={!selectedFormat || downloading}
              className="w-full max-w-full overflow-hidden h-10 px-4 font-semibold text-xs sm:text-sm rounded-xl flex items-center justify-center gap-2"
            >
              {downloadingMode === "gif" ? (
                <>
                  <Loader2 className="w-4 h-4 shrink-0 animate-spin" />
                  <span className="min-w-0 truncate">Creating GIF… {downloadProgress.percent}%</span>
                </>
              ) : (
                <>
                  <Film className="w-4 h-4 shrink-0 text-primary" />
                  <span className="min-w-0 truncate">
                    Save as Animated GIF (.gif){info.duration > 15 ? " • first 15s" : ""}
                  </span>
                </>
              )}
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
