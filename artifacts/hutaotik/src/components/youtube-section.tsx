import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Download, Music, Loader2, AlertCircle, LockKeyhole, FolderCheck, CheckCircle2 } from "lucide-react";
import { SiYoutube } from "react-icons/si";
import { apiUrl } from "@/lib/api-url";
import { saveBlobToDevice } from "@/lib/download-folder";
import {
  fetchBlobWithProgress,
  type DownloadProgressState,
} from "@/lib/download-progress";
import { DownloadProgressCard } from "@/components/download-progress-card";
import { saveLocalHistoryRecord } from "@/lib/local-history";
import { useToast } from "@/hooks/use-toast";
import { isYouTubeUrl } from "@/lib/youtube-url";
import {
  downloadYouTubeOnDevice,
  fetchYouTubeInfoOnDevice,
  isNativeYouTubeAvailable,
} from "@/lib/youtube-native";

interface YTFormat {
  formatStr: string;
  qualityLabel: string;
  needsMux: boolean;
}

interface YTInfo {
  id: string;
  title: string;
  thumbnail: string | null;
  channelName: string;
  duration: number;
  formats: YTFormat[];
}

interface Props {
  url: string;
  folderName?: string | null;
  onOpenFolderPicker?: () => void;
}

function fmtDuration(s: number) {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  if (h > 0)
    return `${h}:${String(m).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
  return `${m}:${String(ss).padStart(2, "0")}`;
}

type Selection = { type: "video"; formatStr: string } | { type: "audio" };

async function parseApiResponse<T>(response: Response): Promise<T> {
  const body = await response.text();
  let data: unknown;
  try {
    data = JSON.parse(body);
  } catch {
    if (!response.ok && response.status >= 500) {
      throw new Error("The YouTube API server is having a problem. Please try again later or contact the app administrator.");
    }
    if (!response.ok) throw new Error(`YouTube request failed (${response.status}).`);
    throw new Error("The YouTube service returned an invalid response.");
  }

  if (!response.ok) {
    const message =
      typeof data === "object" && data !== null && "error" in data && typeof data.error === "string"
        ? data.error
        : response.status >= 500
          ? "The YouTube API server is having a problem. Please try again later or contact the app administrator."
          : `YouTube request failed (${response.status}).`;
    throw new Error(message);
  }
  return data as T;
}

export function YoutubeSection({ url, folderName, onOpenFolderPicker }: Props) {
  const [info, setInfo] = useState<YTInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Selection | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState<DownloadProgressState>({ percent: 0 });
  const [nativeOnDevice, setNativeOnDevice] = useState(false);
  const [downloadSuccessInfo, setDownloadSuccessInfo] = useState<{ filename: string; folder: string } | null>(null);

  const { toast } = useToast();

  useEffect(() => {
    if (!isYouTubeUrl(url)) {
      setInfo(null);
      setError(null);
      setSelected(null);
      setNativeOnDevice(false);
      return;
    }

    const controller = new AbortController();
    setLoading(true);
    setInfo(null);
    setError(null);
    setSelected(null);
    setDownloadSuccessInfo(null);
    const useNativeDownloader = isNativeYouTubeAvailable();
    setNativeOnDevice(useNativeDownloader);

    const infoRequest = useNativeDownloader
      ? fetchYouTubeInfoOnDevice(url)
      : fetch(apiUrl(`/api/youtube/info?url=${encodeURIComponent(url)}`), {
          signal: controller.signal,
        }).then((response) => parseApiResponse<YTInfo>(response));

    infoRequest
      .then((data) => {
        if (controller.signal.aborted) return;
        setInfo(data);
        if (data.formats.length > 0) {
          setSelected({ type: "video", formatStr: data.formats[0].formatStr });
        } else {
          setSelected({ type: "audio" });
        }
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        setError(cause instanceof Error ? cause.message : "Could not fetch YouTube video information.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [url]);

  const handleDownload = async () => {
    if (!selected || !info) return;

    if (!folderName) {
      if (onOpenFolderPicker) onOpenFolderPicker();
      return;
    }

    setDownloading(true);
    setDownloadProgress({ percent: 0, status: "Starting YouTube download…" });
    setDownloadSuccessInfo(null);

    let downloadUrl: string;
    let filename: string;
    let selectedLabel: string;
    const safeTitle = info.title.replace(/[<>:"/\\|?*\x00-\x1f]/g, " ").trim().substring(0, 60) || "YouTube Video";

    if (selected.type === "audio") {
      selectedLabel = nativeOnDevice ? "M4A" : "MP3";
      downloadUrl = apiUrl(`/api/youtube/download?url=${encodeURIComponent(url)}&audio=true&title=${encodeURIComponent(safeTitle)}`);
      filename = `${safeTitle}.${nativeOnDevice ? "m4a" : "mp3"}`;
    } else {
      const fmt = info.formats.find((f) => f.formatStr === selected.formatStr);
      const ql = fmt?.qualityLabel ?? "";
      filename = `${safeTitle}${ql ? ` - ${ql}` : ""}.mp4`;
      selectedLabel = `${ql || "MP4"} MP4`;
      downloadUrl = apiUrl(`/api/youtube/download?url=${encodeURIComponent(url)}&formatStr=${encodeURIComponent(selected.formatStr)}&title=${encodeURIComponent(safeTitle)}&quality=${encodeURIComponent(ql)}`);
    }

    try {
      if (nativeOnDevice) {
        await downloadYouTubeOnDevice(
          url,
          selected.type === "audio" ? "audio" : selected.formatStr,
          filename,
          folderName,
          setDownloadProgress,
        );
        saveLocalHistoryRecord({
          title: info.title || "YouTube Video",
          author: info.channelName,
          authorUsername: info.channelName,
          thumbnail: info.thumbnail,
          quality: selectedLabel,
          sourceUrl: url,
          downloadUrl,
          platform: "youtube",
        });
        setDownloadSuccessInfo({ filename, folder: folderName });
        toast({
          title: "YouTube Download Complete!",
          description: `Your download is complete and saved to Documents/${folderName}/${filename}`,
        });
        return;
      }

      const res = await fetch(downloadUrl, { referrerPolicy: "no-referrer" });
      if (!res.ok) {
        await parseApiResponse<{ error?: string }>(res);
        throw new Error(`YouTube download failed (${res.status}).`);
      }
      const blob = await fetchBlobWithProgress(res, setDownloadProgress, {
        startPercent: 2,
        endPercent: 88,
        status: selected.type === "audio" ? "Downloading YouTube audio…" : "Downloading YouTube video…",
      });
      if (blob.size === 0) throw new Error("The server returned an empty video file.");
      if (blob.type.includes("text/html") || blob.type.includes("application/json")) {
        throw new Error("The server returned an error page instead of the YouTube video.");
      }
      await saveBlobToDevice(blob, filename, folderName, setDownloadProgress, {
        startPercent: 88,
        endPercent: 100,
      });

      saveLocalHistoryRecord({
        title: info.title || "YouTube Video",
        author: info.channelName,
        authorUsername: info.channelName,
        thumbnail: info.thumbnail,
        quality: selectedLabel,
        sourceUrl: url,
        downloadUrl,
        platform: "youtube",
      });

      setDownloadSuccessInfo({ filename, folder: folderName });
      toast({
        title: "YouTube Download Complete!",
        description: `Your download is complete and saved to Documents/${folderName}/${filename}`,
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Download failed";
      toast({
        title: "Download failed",
        description: msg,
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
        <div className="flex gap-4">
          <Skeleton className="w-32 shrink-0 aspect-video rounded-xl bg-secondary/60" />
          <div className="flex-1 space-y-3 pt-1">
            <Skeleton className="h-4 w-3/4 bg-secondary/60 rounded-lg" />
            <Skeleton className="h-3 w-1/2 bg-secondary/60 rounded-lg" />
            <div className="flex gap-2 pt-2">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-7 w-14 bg-secondary/60 rounded-full" />
              ))}
            </div>
          </div>
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

  const isAudio = selected?.type === "audio";
  const selFmt =
    selected?.type === "video"
      ? info.formats.find((f) => f.formatStr === selected.formatStr)
      : null;
  const dlLabel = isAudio ? (nativeOnDevice ? "M4A" : "MP3") : selFmt ? `${selFmt.qualityLabel} MP4` : "";
  const isMuxed = selFmt?.needsMux ?? false;

  return (
    <div className="animate-card-bounce-in bg-card rounded-2xl border border-border overflow-hidden shadow-sm">
      {/* Header row */}
      <div className="flex gap-4 p-4">
        <div className="relative w-32 shrink-0 rounded-xl overflow-hidden aspect-video bg-secondary border border-border">
          {info.thumbnail ? (
            <img src={info.thumbnail} alt={info.title} className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <SiYoutube className="w-8 h-8 text-red-500/30" />
            </div>
          )}
          <div className="absolute bottom-1 right-1 bg-black/70 text-white text-[9px] font-mono px-1 py-px rounded">
            {fmtDuration(info.duration)}
          </div>
        </div>

        <div className="flex-1 min-w-0 flex flex-col gap-1.5">
          <p className="text-sm font-semibold leading-snug line-clamp-2">{info.title}</p>
          <p className="text-xs text-muted-foreground flex items-center gap-1">
            <SiYoutube className="w-3 h-3 text-red-500 shrink-0" />
            {info.channelName}
          </p>
        </div>
      </div>

      {/* Selectors */}
      <div className="px-4 pb-3 space-y-3">
        {/* Video qualities */}
        <div>
          <p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-2 font-semibold">
            Video Quality
          </p>
          {info.formats.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {info.formats.map((f, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => setSelected({ type: "video", formatStr: f.formatStr })}
                  className={`px-3 py-1 rounded-full text-xs font-semibold border transition-all cursor-pointer ${
                    selected?.type === "video" && selected.formatStr === f.formatStr
                      ? "bg-primary border-primary text-primary-foreground shadow-sm shadow-primary/30"
                      : "border-border text-muted-foreground hover:border-primary/50 hover:text-foreground active:scale-95"
                  }`}
                >
                  {f.qualityLabel}
                </button>
              ))}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">No downloadable video formats found.</p>
          )}
        </div>

        {/* Audio */}
        <div className="border-t border-border/50 pt-3">
          <p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-2 font-semibold">
            Audio Only
          </p>
          <button
            type="button"
            onClick={() => setSelected({ type: "audio" })}
            className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold border transition-all cursor-pointer ${
              isAudio
                ? "bg-primary border-primary text-primary-foreground shadow-sm shadow-primary/30"
                : "border-border text-muted-foreground hover:border-primary/50 hover:text-foreground active:scale-95"
            }`}
          >
            <Music className="w-3 h-3" />
            {nativeOnDevice ? "M4A Audio" : "MP3 Audio"}
          </button>
        </div>
      </div>

      {/* Mux warning */}
      {isMuxed && (
        <div className="px-4 pb-2">
          <p className="text-[11px] text-muted-foreground">
            ⏳ High-quality downloads process server-side before starting — may take a moment.
          </p>
        </div>
      )}

      {/* Downloading Animation */}
      {downloading && (
        <DownloadProgressCard
          title={`Downloading YouTube ${isAudio ? "audio" : "video"} to ${folderName}…`}
          progress={downloadProgress}
        />
      )}

      {/* Download Complete Visual */}
      {downloadSuccessInfo && !downloading && (
        <div className="px-4 pb-4 animate-success-pop">
          <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-xl p-3 flex items-start gap-3">
            <div className="w-8 h-8 rounded-full bg-emerald-500/20 flex items-center justify-center text-emerald-500 shrink-0 mt-0.5">
              <CheckCircle2 className="w-5 h-5 animate-pill-pop" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-extrabold text-emerald-400 leading-tight">YouTube Download Complete!</p>
              <p className="text-[11px] text-foreground font-medium truncate mt-0.5">{downloadSuccessInfo.filename}</p>
              <p className="text-[10px] text-muted-foreground mt-0.5 flex items-center gap-1">
                <FolderCheck className="w-3 h-3 text-emerald-400 shrink-0" />
                Saved in device folder: <strong>{downloadSuccessInfo.folder}</strong>
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Download button */}
      <div className="px-4 pb-4">
        {!folderName ? (
          <Button
            type="button"
            onClick={onOpenFolderPicker}
            className="w-full max-w-full h-auto min-h-11 py-2.5 px-4 whitespace-normal text-center leading-snug font-bold text-xs sm:text-sm rounded-xl bg-amber-500/15 border border-amber-500/40 text-amber-500 hover:bg-amber-500/25 flex items-center justify-center gap-2 cursor-pointer"
          >
            <LockKeyhole className="w-4 h-4 shrink-0 text-amber-500 animate-pulse" />
            <span className="min-w-0">Download Locked – Select a download location</span>
          </Button>
        ) : (
          <Button
            type="button"
            className="w-full max-w-full overflow-hidden h-11 px-4 font-bold text-sm rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground shadow-md shadow-primary/25 flex items-center justify-center gap-2"
            onClick={handleDownload}
            disabled={!selected || downloading}
          >
            {downloading ? (
              <>
                <Loader2 className="w-4 h-4 shrink-0 animate-spin" />
                <span className="min-w-0 truncate">Downloading… {downloadProgress.percent}%</span>
              </>
            ) : (
              <>
                <Download className="w-4 h-4 shrink-0" />
                <span className="min-w-0 truncate">Save {dlLabel || "YouTube Video"} to {folderName}</span>
              </>
            )}
          </Button>
        )}
      </div>
    </div>
  );
}
