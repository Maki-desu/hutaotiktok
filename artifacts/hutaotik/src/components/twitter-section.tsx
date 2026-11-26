import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertCircle,
  CheckCircle2,
  Download,
  FolderCheck,
  Loader2,
} from "lucide-react";
import { SiX } from "react-icons/si";
import { apiUrl } from "@/lib/api-url";
import { saveBlobToDevice } from "@/lib/download-folder";
import { saveLocalHistoryRecord } from "@/lib/local-history";
import { fetchTwitterFromFx } from "@/lib/twitter-fx";
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

export function TwitterSection({ url, folderName, onOpenFolderPicker }: Props) {
  const [info, setInfo] = useState<TwitterInfo | null>(null);
  const [selectedHeight, setSelectedHeight] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [downloadSuccessInfo, setDownloadSuccessInfo] = useState<{
    filename: string;
    folder: string;
  } | null>(null);
  const { toast } = useToast();

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setInfo(null);
    setSelectedHeight(null);
    setError(null);
    setDownloadSuccessInfo(null);

    const requestInfo = async () => {
      try {
        const response = await fetch(apiUrl(`/api/twitter/info?url=${encodeURIComponent(url)}`), {
          signal: controller.signal,
        });
        if (response.ok) {
          const data = await parseApiResponse<TwitterInfo>(response, "X video information");
          if (data.formats.length > 0) return data;
        } else {
          await response.body?.cancel();
        }
      } catch (cause) {
        if (controller.signal.aborted) throw cause;
      }

      return fetchTwitterFromFx(url, controller.signal);
    };

    requestInfo()
      .then((data) => {
        if (controller.signal.aborted) return;
        setInfo(data);
        if (data.formats.length > 0) {
          setSelectedHeight(data.formats[0].height);
        }
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        setError(cause instanceof Error ? cause.message : "Could not fetch X video information.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [url]);

  const handleDownload = async () => {
    if (!info) return;
    if (!folderName) {
      onOpenFolderPicker?.();
      return;
    }

    setDownloading(true);
    setDownloadSuccessInfo(null);
    const safeTitle = (info.title || "X Video")
      .replace(/[<>:"/\\|?*\x00-\x1f]/g, " ")
      .trim()
      .substring(0, 60) || "X Video";
    const selectedFormat = info.formats.find((format) => format.height === selectedHeight);
    const quality = selectedHeight === null ? "best" : String(selectedHeight);
    const qualityLabel = selectedFormat?.qualityLabel ?? "Best available";
    const filename = `${safeTitle}${selectedHeight === null ? "" : ` - ${selectedHeight}p`}.mp4`;
    const apiDownloadUrl = apiUrl(
      `/api/twitter/download?url=${encodeURIComponent(url)}&quality=${encodeURIComponent(quality)}&title=${encodeURIComponent(safeTitle)}`
    );
    let downloadUrl = selectedFormat?.downloadUrl ?? apiDownloadUrl;

    try {
      const requestOptions = {
        referrerPolicy: "no-referrer" as ReferrerPolicy,
        signal: AbortSignal.timeout(120_000),
      };
      let response: Response | null = null;
      if (selectedFormat?.downloadUrl) {
        response = await fetch(downloadUrl, requestOptions);
      } else {
        response = null;
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
          const fallbackFormat = fallbackInfo.formats.find((format) => format.height === selectedHeight) ??
            fallbackInfo.formats[0];
          if (!fallbackFormat) throw new Error("No downloadable video format was found for this X post.");
          downloadUrl = fallbackFormat.downloadUrl;
          response = await fetch(downloadUrl, requestOptions);
        }
      }
      if (!response) throw new Error("The X video provider did not return a response.");
      if (!response.ok) {
        await response.body?.cancel();
        throw new Error(`X video download failed (HTTP ${response.status}).`);
      }

      const blob = await response.blob();
      if (blob.size === 0) throw new Error("The server returned an empty video file.");
      if (blob.type.includes("text/html") || blob.type.includes("application/json")) {
        throw new Error("The download provider returned an error page instead of the X video.");
      }
      await saveBlobToDevice(blob, filename, folderName);

      saveLocalHistoryRecord({
        title: info.title || "X Video",
        author: info.channelName,
        authorUsername: info.channelName,
        thumbnail: info.thumbnail,
        quality: qualityLabel,
        sourceUrl: url,
        downloadUrl: downloadUrl === apiDownloadUrl ? downloadUrl : url,
        platform: "twitter",
      });
      setDownloadSuccessInfo({ filename, folder: folderName });
      toast({
        title: "X Video Download Complete!",
        description: `Saved ${filename} inside ${folderName}`,
      });
    } catch (cause: unknown) {
      toast({
        title: "Download failed",
        description: cause instanceof Error ? cause.message : "Could not download this X video.",
        variant: "destructive",
      });
    } finally {
      setDownloading(false);
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
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-start gap-2.5 bg-destructive/10 border border-destructive/30 rounded-xl px-3 py-2.5">
        <AlertCircle className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
        <p className="text-sm text-destructive leading-snug">{error}</p>
      </div>
    );
  }

  if (!info) return null;

  const selectedFormat = info.formats.find((format) => format.height === selectedHeight);

  return (
    <div className="bg-card rounded-2xl border border-border overflow-hidden shadow-sm animate-in fade-in zoom-in-95 duration-300">
      <div className="flex gap-4 p-4">
        <div className="relative w-32 shrink-0 rounded-xl overflow-hidden aspect-video bg-secondary border border-border">
          {info.thumbnail ? (
            <img src={info.thumbnail} alt={info.title} className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <SiX className="w-8 h-8 text-foreground/30" />
            </div>
          )}
          {info.duration > 0 && (
            <div className="absolute bottom-1 right-1 bg-black/70 text-white text-[9px] font-mono px-1 py-px rounded">
              {formatDuration(info.duration)}
            </div>
          )}
        </div>
        <div className="flex-1 min-w-0 flex flex-col gap-1.5">
          <p className="text-sm font-semibold leading-snug line-clamp-2">{info.title}</p>
          <p className="text-xs text-muted-foreground flex items-center gap-1">
            <SiX className="w-3 h-3 shrink-0" />
            {info.channelName}
          </p>
        </div>
      </div>

      <div className="px-4 pb-3">
        <p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-2 font-semibold">
          Video Quality
        </p>
        {info.formats.length > 0 ? (
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
        ) : (
          <p className="text-xs text-muted-foreground">No downloadable video formats were found.</p>
        )}
      </div>

      {downloadSuccessInfo && (
        <div className="mx-4 mb-3 bg-emerald-500/10 border border-emerald-500/30 rounded-xl p-3 flex items-start gap-3">
          <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0 mt-0.5" />
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

      <div className="px-4 pb-4">
        {!folderName ? (
          <Button
            type="button"
            onClick={onOpenFolderPicker}
            className="w-full h-11 font-bold text-sm rounded-xl"
          >
            Select a download location
          </Button>
        ) : (
          <Button
            type="button"
            onClick={handleDownload}
            disabled={!selectedFormat || downloading}
            className="w-full h-11 font-bold text-sm rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground shadow-md shadow-primary/25 flex items-center justify-center gap-2"
          >
            {downloading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Downloading X video…</span>
              </>
            ) : (
              <>
                <Download className="w-4 h-4" />
                <span>Save {selectedFormat?.qualityLabel ?? "X Video"} to {folderName}</span>
              </>
            )}
          </Button>
        )}
      </div>
    </div>
  );
}
