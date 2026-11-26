import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Download, Music, Loader2, AlertCircle, LockKeyhole, FolderCheck, CheckCircle2, ArrowDown, Sparkles } from "lucide-react";
import { SiFacebook } from "react-icons/si";
import { apiUrl } from "@/lib/api-url";
import {
  downloadFacebookOnDevice,
  fetchFacebookInfoOnDevice,
  isNativeFacebookAvailable,
} from "@/lib/facebook-native";
import { saveBlobToDevice, saveUrlToDevice } from "@/lib/download-folder";
import { saveLocalHistoryRecord } from "@/lib/local-history";
import { useToast } from "@/hooks/use-toast";

interface FBInfo {
  title: string;
  thumbnail: string | null;
  hdUrl: string | null;
  sdUrl: string | null;
  nativeDownload?: boolean;
}

type Selection = "hd" | "sd" | "audio";

interface Props {
  url: string;
  folderName?: string | null;
  onOpenFolderPicker?: () => void;
}

async function fetchFacebookInfoDirect(inputUrl: string): Promise<FBInfo> {
  const enc = encodeURIComponent(inputUrl);
  try {
    const res = await fetch(`https://api.vtdown.com/api/facebook?url=${enc}`, { signal: AbortSignal.timeout(5000), referrerPolicy: "no-referrer" });
    if (res.ok) {
      const data = await res.json();
      if (data.hd || data.sd || data.hd_url || data.sd_url) {
        return {
          title: data.title || "Facebook Video",
          thumbnail: data.thumbnail || data.cover || null,
          hdUrl: data.hd || data.hd_url || null,
          sdUrl: data.sd || data.sd_url || null,
        };
      }
    }
  } catch {
    /* continue */
  }

  return {
    title: "Facebook Video / Reel",
    thumbnail: null,
    hdUrl: apiUrl(`/api/facebook/download?url=${enc}&quality=hd`),
    sdUrl: apiUrl(`/api/facebook/download?url=${enc}&quality=sd`),
  };
}

export function FacebookSection({ url, folderName, onOpenFolderPicker }: Props) {
  const [info, setInfo] = useState<FBInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Selection | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [downloadSuccessInfo, setDownloadSuccessInfo] = useState<{ filename: string; folder: string } | null>(null);

  const { toast } = useToast();

  useEffect(() => {
    if (!url || !/(facebook\.com|fb\.watch)/i.test(url)) {
      setInfo(null);
      setError(null);
      setSelected(null);
      return;
    }

    const controller = new AbortController();
    setLoading(true);
    setInfo(null);
    setError(null);
    setSelected(null);
    setDownloadSuccessInfo(null);

    const nativeBridge = isNativeFacebookAvailable();
    const infoRequest = nativeBridge
      ? fetchFacebookInfoOnDevice(url)
      : fetch(apiUrl(`/api/facebook/info?url=${encodeURIComponent(url)}`), {
          signal: controller.signal,
        }).then(async (r) => {
          if (!r.ok) {
            const d = (await r.json()) as { error?: string };
            throw new Error(d.error ?? "Failed to fetch Facebook info");
          }
          return r.json() as Promise<FBInfo>;
        });

    infoRequest
      .then((data) => {
        if (controller.signal.aborted) return;
        setInfo(data);
        setSelected(data.nativeDownload ? "hd" : data.hdUrl ? "hd" : data.sdUrl ? "sd" : "audio");
      })
      .catch(async (err: Error) => {
        if (controller.signal.aborted || err.name === "AbortError") return;
        if (nativeBridge) {
          setError(err.message || "Could not fetch Facebook video info");
          return;
        }
        try {
          const directData = await fetchFacebookInfoDirect(url);
          if (controller.signal.aborted) return;
          setInfo(directData);
          setSelected("hd");
        } catch (fallbackErr: unknown) {
          setError(fallbackErr instanceof Error ? fallbackErr.message : "Could not fetch Facebook video info");
        }
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
    setDownloadSuccessInfo(null);

    const safeTitle = (info.title || "facebook_video").replace(/[<>:"/\\|?*\x00-\x1f]/g, " ").trim().substring(0, 60);
    let downloadUrl: string | null = null;
    let filename: string;

    if (selected === "audio") {
      filename = `${safeTitle}.mp3`;
    } else {
      const q = selected === "hd" ? "hd" : "sd";
      filename = `${safeTitle} - ${selected.toUpperCase()}.mp4`;
      if (!info.nativeDownload) {
        const rawUrl = selected === "hd" ? (info.hdUrl || info.sdUrl) : (info.sdUrl || info.hdUrl);
        downloadUrl = (rawUrl && rawUrl.startsWith("http") && !rawUrl.includes("facebook.com") && !rawUrl.includes("/api/facebook/download"))
          ? rawUrl
          : apiUrl(`/api/facebook/download?url=${encodeURIComponent(url)}&quality=${q}`);
      }
    }
    if (selected === "audio" && !info.nativeDownload) {
      downloadUrl = apiUrl(`/api/facebook/download?url=${encodeURIComponent(url)}&audio=true`);
    }

    try {
      if (info.nativeDownload) {
        await downloadFacebookOnDevice(url, selected, filename, folderName);
      } else if (downloadUrl?.startsWith("http") && !downloadUrl.includes("/api/facebook/download")) {
        await saveUrlToDevice(downloadUrl, filename, folderName);
      } else {
        if (!downloadUrl) throw new Error("No Facebook download URL is available.");
        const res = await fetch(downloadUrl, { referrerPolicy: "no-referrer" });
        if (!res.ok) throw new Error("Server returned HTTP " + res.status);
        const blob = await res.blob();
        await saveBlobToDevice(blob, filename, folderName);
      }

      saveLocalHistoryRecord({
        title: info.title || "Facebook Video",
        author: "Facebook Creator",
        authorUsername: "facebook",
        thumbnail: info.thumbnail,
        quality: selected === "audio" ? "MP3" : selected.toUpperCase(),
        sourceUrl: url,
        downloadUrl,
        platform: "facebook",
      });

      setDownloadSuccessInfo({ filename, folder: folderName });
      toast({
        title: "Facebook Download Complete!",
        description: `Saved ${filename} inside ${folderName}`,
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
    }
  };

  if (loading) {
    return (
      <div className="bg-card rounded-2xl border border-border p-4 space-y-3">
        <div className="flex gap-4">
          <Skeleton className="w-28 shrink-0 aspect-video rounded-xl bg-secondary/60" />
          <div className="flex-1 space-y-3 pt-1">
            <Skeleton className="h-4 w-3/4 bg-secondary/60 rounded-lg" />
            <Skeleton className="h-3 w-1/2 bg-secondary/60 rounded-lg" />
            <div className="flex gap-2 pt-2">
              {[1, 2].map((i) => (
                <Skeleton key={i} className="h-7 w-12 bg-secondary/60 rounded-full" />
              ))}
            </div>
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

  const dlLabel =
    selected === "audio" ? "MP3" : selected === "hd" ? "HD MP4" : selected === "sd" ? "SD MP4" : "";
  const canDownload = !!selected;

  return (
    <div className="bg-card rounded-2xl border border-border overflow-hidden shadow-sm animate-in fade-in zoom-in-95 duration-300">
      {/* Header row */}
      <div className="flex gap-4 p-4">
        <div className="relative w-28 shrink-0 rounded-xl overflow-hidden aspect-video bg-secondary border border-border">
          {info.thumbnail ? (
            <img src={info.thumbnail} alt={info.title} className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <SiFacebook className="w-8 h-8 text-blue-500/30" />
            </div>
          )}
        </div>

        <div className="flex-1 min-w-0 flex flex-col gap-1.5 pt-0.5">
          <p className="text-sm font-semibold leading-snug line-clamp-2">{info.title}</p>
          <p className="text-xs text-muted-foreground flex items-center gap-1">
            <SiFacebook className="w-3 h-3 text-blue-500 shrink-0" />
            Facebook Video
          </p>
        </div>
      </div>

      {/* Selectors */}
      <div className="px-4 pb-3 space-y-3">
        {/* Video quality */}
        <div>
          <p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-2 font-semibold">
            Video Quality
          </p>
          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={() => setSelected("hd")}
              className={`px-3.5 py-1.5 rounded-full text-xs font-bold border transition-all cursor-pointer ${
                selected === "hd"
                  ? "bg-primary border-primary text-primary-foreground shadow-sm shadow-primary/30"
                  : "border-border text-muted-foreground hover:border-primary/50 hover:text-foreground active:scale-95"
              }`}
            >
              HD MP4
            </button>
            <button
              type="button"
              onClick={() => setSelected("sd")}
              className={`px-3.5 py-1.5 rounded-full text-xs font-bold border transition-all cursor-pointer ${
                selected === "sd"
                  ? "bg-primary border-primary text-primary-foreground shadow-sm shadow-primary/30"
                  : "border-border text-muted-foreground hover:border-primary/50 hover:text-foreground active:scale-95"
              }`}
            >
              SD MP4
            </button>
          </div>
        </div>

        {/* Audio — clearly separated */}
        <div className="border-t border-border/50 pt-3">
          <p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-2 font-semibold">
            Audio Only
          </p>
          <button
            type="button"
            onClick={() => setSelected("audio")}
            className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-bold border transition-all cursor-pointer ${
              selected === "audio"
                ? "bg-primary border-primary text-primary-foreground shadow-sm shadow-primary/30"
                : "border-border text-muted-foreground hover:border-primary/50 hover:text-foreground active:scale-95"
            }`}
          >
            <Music className="w-3.5 h-3.5 text-primary" />
            <span>MP3 Audio</span>
          </button>
        </div>
      </div>

      {/* Downloading Animation */}
      {downloading && (
        <div className="px-4 pb-4 animate-in fade-in duration-300">
          <div className="bg-primary/10 border border-primary/30 rounded-xl p-3 flex flex-col gap-2">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-full bg-primary/20 flex items-center justify-center shrink-0">
                <ArrowDown className="w-5 h-5 text-primary animate-bounce" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-bold text-foreground leading-tight flex items-center gap-1.5">
                  <span>Downloading Facebook video to {folderName}…</span>
                  <Sparkles className="w-3.5 h-3.5 text-primary animate-spin" />
                </p>
                <p className="text-[11px] text-muted-foreground truncate mt-0.5">Saving directly to device folder…</p>
              </div>
            </div>
            <div className="w-full bg-secondary/80 h-1.5 rounded-full overflow-hidden">
              <div className="bg-gradient-to-r from-primary/40 via-primary to-primary/40 h-full rounded-full animate-pulse w-full" />
            </div>
          </div>
        </div>
      )}

      {/* Download Complete Visual */}
      {downloadSuccessInfo && !downloading && (
        <div className="px-4 pb-4 animate-in fade-in zoom-in-95 duration-300">
          <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-xl p-3 flex items-start gap-3">
            <div className="w-8 h-8 rounded-full bg-emerald-500/20 flex items-center justify-center text-emerald-500 shrink-0 mt-0.5">
              <CheckCircle2 className="w-5 h-5 animate-in zoom-in-50 duration-300" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-extrabold text-emerald-400 leading-tight">Facebook Download Complete!</p>
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
            className="w-full h-11 font-bold text-sm rounded-xl bg-amber-500/15 border border-amber-500/40 text-amber-500 hover:bg-amber-500/25 active:scale-[0.98] transition-all flex items-center justify-center gap-2 cursor-pointer"
          >
            <LockKeyhole className="w-4 h-4 text-amber-500 animate-pulse" />
            <span>Download Locked – Select a download location to continue</span>
          </Button>
        ) : (
          <Button
            type="button"
            className="w-full h-11 font-bold text-sm rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground shadow-md shadow-primary/25 active:scale-[0.98] transition-all flex items-center justify-center gap-2"
            onClick={handleDownload}
            disabled={!canDownload || downloading}
          >
            {downloading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Downloading Facebook video…</span>
              </>
            ) : (
              <>
                <Download className="w-4 h-4" />
                <span>Save {dlLabel || "Facebook Video"} to {folderName}</span>
              </>
            )}
          </Button>
        )}
      </div>
    </div>
  );
}
