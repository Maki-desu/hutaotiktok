import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Download, Music, Loader2, AlertCircle } from "lucide-react";
import { SiYoutube } from "react-icons/si";
import { apiUrl } from "@/lib/api-url";

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

export function YoutubeSection({ url }: Props) {
  const [info, setInfo] = useState<YTInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Selection | null>(null);
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    if (!url || !/(youtube\.com|youtu\.be)/i.test(url)) {
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

    fetch(apiUrl(`/api/youtube/info?url=${encodeURIComponent(url)}`), {
      signal: controller.signal,
    })
      .then(async (r) => {
        if (!r.ok) {
          const d = (await r.json()) as { error?: string };
          throw new Error(d.error ?? "Failed to fetch");
        }
        return r.json() as Promise<YTInfo>;
      })
      .then((data) => {
        setInfo(data);
        if (data.formats.length > 0)
          setSelected({ type: "video", formatStr: data.formats[0].formatStr });
      })
      .catch((err: Error) => {
        if (err.name !== "AbortError")
          setError(err.message || "Could not fetch video info");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [url]);

  const handleDownload = () => {
    if (!selected || !info) return;
    setDownloading(true);

    let href: string;
    let filename: string;
    const safeTitle = info.title.replace(/[<>:"/\\|?*\x00-\x1f]/g, " ").trim().substring(0, 60);

    if (selected.type === "audio") {
      href = apiUrl(`/api/youtube/download?url=${encodeURIComponent(url)}&audio=true&title=${encodeURIComponent(safeTitle)}`);
      filename = `${safeTitle}.mp3`;
    } else {
      const fmt = info.formats.find((f) => f.formatStr === selected.formatStr);
      const ql = fmt?.qualityLabel ?? "";
      href = apiUrl(`/api/youtube/download?url=${encodeURIComponent(url)}&formatStr=${encodeURIComponent(selected.formatStr)}&title=${encodeURIComponent(safeTitle)}&quality=${encodeURIComponent(ql)}`);
      filename = `${safeTitle}${ql ? ` - ${ql}` : ""}.mp4`;
    }

    const a = document.createElement("a");
    a.href = href;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => setDownloading(false), 3000);
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
      <div className="flex items-start gap-2.5 bg-destructive/10 border border-destructive/30 rounded-xl px-3 py-2.5">
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
  const dlLabel = isAudio ? "MP3" : selFmt ? `${selFmt.qualityLabel} MP4` : "";
  const isMuxed = selFmt?.needsMux ?? false;

  return (
    <div className="bg-card rounded-2xl border border-border overflow-hidden shadow-sm animate-in fade-in zoom-in-95 duration-300">
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
          <p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-2">
            Video Quality
          </p>
          {info.formats.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {info.formats.map((f) => (
                <button
                  key={f.formatStr}
                  onClick={() => setSelected({ type: "video", formatStr: f.formatStr })}
                  className={`px-3 py-1 rounded-full text-xs font-semibold border transition-all ${
                    selected?.type === "video" && selected.formatStr === f.formatStr
                      ? "bg-primary border-primary text-primary-foreground shadow-sm shadow-primary/30"
                      : "border-border text-muted-foreground hover:border-primary/50 hover:text-foreground"
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
          <p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-2">
            Audio Only
          </p>
          <button
            onClick={() => setSelected({ type: "audio" })}
            className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold border transition-all ${
              isAudio
                ? "bg-primary border-primary text-primary-foreground shadow-sm shadow-primary/30"
                : "border-border text-muted-foreground hover:border-primary/50 hover:text-foreground"
            }`}
          >
            <Music className="w-3 h-3" />
            MP3
          </button>
        </div>
      </div>

      {/* Mux warning */}
      {isMuxed && (
        <div className="px-4 pb-2">
          <p className="text-[11px] text-muted-foreground">
            ⏳ High-quality downloads process server-side before starting — may take a minute.
          </p>
        </div>
      )}

      {/* Download button */}
      <div className="px-4 pb-4">
        <Button
          className="w-full h-11 font-bold text-sm rounded-xl shadow-sm shadow-primary/25 hover:shadow-primary/40 transition-all"
          onClick={handleDownload}
          disabled={!selected || downloading}
        >
          {downloading ? (
            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
          ) : (
            <Download className="w-4 h-4 mr-2" />
          )}
          {downloading ? (isMuxed ? "Processing…" : "Starting…") : `Download${dlLabel ? " " + dlLabel : ""}`}
        </Button>
      </div>
    </div>
  );
}
