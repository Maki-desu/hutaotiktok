import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Download, Music, Loader2, AlertCircle } from "lucide-react";
import { SiFacebook } from "react-icons/si";

interface FBInfo {
  title: string;
  thumbnail: string | null;
  hdUrl: string | null;
  sdUrl: string | null;
}

type Selection = "hd" | "sd" | "audio";

interface Props {
  url: string;
}

export function FacebookSection({ url }: Props) {
  const [info, setInfo] = useState<FBInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Selection | null>(null);
  const [downloading, setDownloading] = useState(false);

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

    fetch(`/api/facebook/info?url=${encodeURIComponent(url)}`, {
      signal: controller.signal,
    })
      .then(async (r) => {
        if (!r.ok) {
          const d = (await r.json()) as { error?: string };
          throw new Error(d.error ?? "Failed to fetch");
        }
        return r.json() as Promise<FBInfo>;
      })
      .then((data) => {
        setInfo(data);
        setSelected(data.hdUrl ? "hd" : data.sdUrl ? "sd" : "audio");
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

    const safeTitle = info.title.replace(/[<>:"/\\|?*\x00-\x1f]/g, " ").trim().substring(0, 60);
    let href: string;
    let filename: string;

    if (selected === "audio") {
      href = `/api/facebook/download?url=${encodeURIComponent(url)}&audio=true`;
      filename = `${safeTitle}.mp3`;
    } else {
      const videoUrl = selected === "hd" ? info.hdUrl! : info.sdUrl!;
      const quality = selected === "hd" ? "HD" : "SD";
      filename = `${safeTitle} - ${quality}.mp4`;
      href = `/api/proxy-download?url=${encodeURIComponent(videoUrl)}&filename=${encodeURIComponent(filename)}`;
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
  const canDownload =
    selected === "audio" ||
    (selected === "hd" && !!info.hdUrl) ||
    (selected === "sd" && !!info.sdUrl);

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
          <p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-2">
            Video Quality
          </p>
          <div className="flex flex-wrap gap-1.5">
            {info.hdUrl && (
              <button
                onClick={() => setSelected("hd")}
                className={`px-3 py-1 rounded-full text-xs font-semibold border transition-all ${
                  selected === "hd"
                    ? "bg-primary border-primary text-primary-foreground shadow-sm shadow-primary/30"
                    : "border-border text-muted-foreground hover:border-primary/50 hover:text-foreground"
                }`}
              >
                HD
              </button>
            )}
            {info.sdUrl && (
              <button
                onClick={() => setSelected("sd")}
                className={`px-3 py-1 rounded-full text-xs font-semibold border transition-all ${
                  selected === "sd"
                    ? "bg-primary border-primary text-primary-foreground shadow-sm shadow-primary/30"
                    : "border-border text-muted-foreground hover:border-primary/50 hover:text-foreground"
                }`}
              >
                SD
              </button>
            )}
          </div>
        </div>

        {/* Audio — clearly separated */}
        <div className="border-t border-border/50 pt-3">
          <p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-2">
            Audio Only
          </p>
          <button
            onClick={() => setSelected("audio")}
            className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold border transition-all ${
              selected === "audio"
                ? "bg-primary border-primary text-primary-foreground shadow-sm shadow-primary/30"
                : "border-border text-muted-foreground hover:border-primary/50 hover:text-foreground"
            }`}
          >
            <Music className="w-3 h-3" />
            MP3
          </button>
        </div>
      </div>

      {/* Download button */}
      <div className="px-4 pb-4">
        <Button
          className="w-full h-11 font-bold text-sm rounded-xl shadow-sm shadow-primary/25 hover:shadow-primary/40 transition-all"
          onClick={handleDownload}
          disabled={!canDownload || downloading}
        >
          {downloading ? (
            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
          ) : (
            <Download className="w-4 h-4 mr-2" />
          )}
          {downloading ? "Starting…" : `Download${dlLabel ? " " + dlLabel : ""}`}
        </Button>
      </div>
    </div>
  );
}
