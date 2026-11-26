import { useState, useRef, ChangeEvent } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Slider } from "@/components/ui/slider";
import {
  Archive,
  Upload,
  Download,
  CheckCircle2,
  FolderCheck,
  RefreshCw,
  Sliders,
  Zap,
  Loader2,
  Video,
  FileVideo,
  ArrowRight,
} from "lucide-react";
import { saveBlobToDevice, getStoredFolderName } from "@/lib/download-folder";
import { useToast } from "@/hooks/use-toast";

function formatBytes(bytes: number, decimals = 2) {
  if (bytes === 0) return "0 Bytes";
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ["Bytes", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + " " + sizes[i];
}

function getSupportedMimeType(): string {
  if (typeof MediaRecorder === "undefined") return "";
  const types = [
    "video/webm;codecs=vp9",
    "video/webm;codecs=vp8",
    "video/webm",
    "video/mp4;codecs=avc1",
    "video/mp4",
  ];
  for (const t of types) {
    if (MediaRecorder.isTypeSupported(t)) {
      return t;
    }
  }
  return "";
}

export function TaoCompressorSection({
  folderName,
  onOpenFolderPicker,
}: {
  folderName?: string | null;
  onOpenFolderPicker?: () => void;
}) {
  const [videoSrc, setVideoSrc] = useState<string | null>(null);
  const [originalSize, setOriginalSize] = useState<number>(0);
  const [compressedSize, setCompressedSize] = useState<number>(0);
  const [hasCompressed, setHasCompressed] = useState(false);
  const [crfQuality, setCrfQuality] = useState(24);
  const [targetScale, setTargetScale] = useState<"100%" | "720p" | "480p" | "360p">("720p");
  const [preset, setPreset] = useState<"small" | "balanced" | "high">("balanced");
  const [isCompressing, setIsCompressing] = useState(false);
  const [compressProgress, setCompressProgress] = useState(0);
  const [compressedBlob, setCompressedBlob] = useState<Blob | null>(null);
  const [compressedUrl, setCompressedUrl] = useState<string | null>(null);
  const [downloadSuccessInfo, setDownloadSuccessInfo] = useState<{ filename: string; folder: string } | null>(null);

  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const handleVideoUpload = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.type && !file.type.startsWith("video/")) {
      toast({
        title: "Unsupported file",
        description: "Choose a video file to compress.",
        variant: "destructive",
      });
      e.target.value = "";
      return;
    }

    if (videoSrc) URL.revokeObjectURL(videoSrc);
    if (compressedUrl) URL.revokeObjectURL(compressedUrl);
    setOriginalSize(file.size);
    setCompressedSize(0);
    const url = URL.createObjectURL(file);
    setVideoSrc(url);
    setHasCompressed(false);
    setCompressedBlob(null);
    setCompressedUrl(null);
    setDownloadSuccessInfo(null);
    setCompressProgress(0);
  };

  const applyPreset = (p: "small" | "balanced" | "high") => {
    setPreset(p);
    if (p === "small") {
      setCrfQuality(28);
      setTargetScale("480p");
    } else if (p === "balanced") {
      setCrfQuality(23);
      setTargetScale("720p");
    } else if (p === "high") {
      setCrfQuality(19);
      setTargetScale("100%");
    }
  };

  const compressVideo = async () => {
    if (!videoSrc || !videoRef.current) return;
    setIsCompressing(true);
    setCompressProgress(5);

    const video = videoRef.current;
    let stream: MediaStream | null = null;
    video.muted = true;
    video.playsInline = true;

    try {
      if (video.readyState < 2) {
        await new Promise<void>((resolve, reject) => {
          const timeout = window.setTimeout(() => {
            cleanup();
            reject(new Error("The video did not finish loading."));
          }, 15000);
          const cleanup = () => {
            window.clearTimeout(timeout);
            video.removeEventListener("loadeddata", onLoaded);
            video.removeEventListener("error", onError);
          };
          const onLoaded = () => {
            cleanup();
            resolve();
          };
          const onError = () => {
            cleanup();
            reject(new Error("This video format could not be decoded."));
          };
          video.addEventListener("loadeddata", onLoaded, { once: true });
          video.addEventListener("error", onError, { once: true });
          video.load();
        });
      }

      setCompressProgress(15);

      const canvas = canvasRef.current;
      if (!canvas?.captureStream) {
        throw new Error("Video compression is not supported by this browser.");
      }

      const mimeType = getSupportedMimeType();
      if (!mimeType) {
        throw new Error("This browser does not support a compatible video encoder.");
      }

      let w = video.videoWidth;
      let h = video.videoHeight;
      if (w === 0 || h === 0) throw new Error("Video dimensions could not be read.");

      if (targetScale === "720p" && h > 720) {
        const ratio = 720 / h;
        w = Math.round(w * ratio);
        h = 720;
      } else if (targetScale === "480p" && h > 480) {
        const ratio = 480 / h;
        w = Math.round(w * ratio);
        h = 480;
      } else if (targetScale === "360p" && h > 360) {
        const ratio = 360 / h;
        w = Math.round(w * ratio);
        h = 360;
      }

      canvas.width = w;
      canvas.height = h;

      const ctx = canvas.getContext("2d");
      if (!ctx) {
        throw new Error("Could not initialize the video encoder.");
      }

      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";

      const targetBitrate = Math.max(250_000, Math.round(2_000_000 * Math.pow(0.85, crfQuality - 18)));
      stream = canvas.captureStream(24);
      const recorder = new MediaRecorder(stream, {
        mimeType,
        videoBitsPerSecond: targetBitrate,
      });
      const duration = video.duration;
      if (!Number.isFinite(duration) || duration <= 0) {
        throw new Error("The video duration could not be read.");
      }
      video.currentTime = 0;
      const chunks: Blob[] = [];
      let animationFrame = 0;
      let lastProgressUpdate = 0;
      const blob = await new Promise<Blob>((resolve, reject) => {
        recorder.ondataavailable = (event) => {
          if (event.data.size > 0) chunks.push(event.data);
        };
        recorder.onerror = () => {
          stopRecording();
          reject(new Error("The video encoder stopped unexpectedly."));
        };
        recorder.onstop = () => {
          cancelAnimationFrame(animationFrame);
          const result = new Blob(chunks, { type: recorder.mimeType || mimeType });
          if (result.size === 0) {
            reject(new Error("The video encoder produced an empty file."));
          } else {
            resolve(result);
          }
        };

        const stopRecording = () => {
          if (recorder.state === "recording") recorder.stop();
        };
        const drawFrame = () => {
          if (video.paused && !video.ended) {
            stopRecording();
            reject(new Error("Video playback stopped before compression finished."));
            return;
          }
          if (video.ended || video.currentTime >= duration) {
            stopRecording();
            return;
          }

          try {
            ctx.drawImage(video, 0, 0, w, h);
          } catch {
            stopRecording();
            reject(new Error("Could not read frames from this video."));
            return;
          }

          const now = performance.now();
          if (now - lastProgressUpdate >= 250) {
            setCompressProgress(Math.min(99, Math.round((video.currentTime / duration) * 100)));
            lastProgressUpdate = now;
          }
          animationFrame = requestAnimationFrame(drawFrame);
        };

        recorder.start(250);
        video.play().then(drawFrame).catch(() => {
          stopRecording();
          reject(new Error("Playback was blocked. Tap Compress again to retry."));
        });
      });

      const blobUrl = URL.createObjectURL(blob);
      setCompressedBlob(blob);
      setCompressedSize(blob.size);
      setCompressedUrl(blobUrl);
      setHasCompressed(true);
      setCompressProgress(100);
    } catch (e) {
      console.error("Video compression error:", e);
      setCompressProgress(0);
      toast({
        title: "Compression Error",
        description: e instanceof Error ? e.message : "Could not compress this video file.",
        variant: "destructive",
      });
    } finally {
      stream?.getTracks().forEach((track) => track.stop());
      setIsCompressing(false);
    }
  };

  const handleDownloadCompressed = async () => {
    if (!compressedBlob) return;

    const targetFolder = folderName || getStoredFolderName() || "HutaoTik Downloads";
    if (!folderName && onOpenFolderPicker) {
      onOpenFolderPicker();
      return;
    }

    try {
      const extension = compressedBlob.type.includes("mp4") ? "mp4" : "webm";
      const filename = `Taocompress_${Date.now()}.${extension}`;

      await saveBlobToDevice(compressedBlob, filename, targetFolder);

      setDownloadSuccessInfo({ filename, folder: targetFolder });
      toast({
        title: "Taocompress Export Complete!",
        description: `Compressed video saved to Documents/${targetFolder}/${filename}`,
      });
    } catch (e) {
      console.error("Video export error:", e);
      toast({
        title: "Export Failed",
        description: e instanceof Error ? e.message : "Could not save compressed video.",
        variant: "destructive",
      });
    }
  };

  const savedPercent = originalSize > 0 && compressedSize > 0
    ? Math.max(0, Math.round(((originalSize - compressedSize) / originalSize) * 100))
    : 0;

  return (
    <div className="bg-card rounded-2xl border border-border overflow-hidden shadow-sm p-4 space-y-4 animate-in fade-in duration-300">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-9 h-9 rounded-xl bg-primary/15 border border-primary/30 flex items-center justify-center text-primary shrink-0">
            <Archive className="w-5 h-5 animate-pulse" />
          </div>
          <div>
            <h2 className="text-base font-syne font-bold flex items-center gap-1.5">
              <span>Taocompress</span>
              <Badge className="bg-primary text-primary-foreground text-[9px] font-bold px-1.5 py-0">
                Video Compressor
              </Badge>
            </h2>
            <p className="text-[11px] text-muted-foreground">
              Reduce file size by lowering the video bitrate and output resolution.
            </p>
          </div>
        </div>
      </div>

      <canvas ref={canvasRef} className="hidden" />

      {/* Upload Box */}
      {!videoSrc ? (
        <div
          onClick={() => fileInputRef.current?.click()}
          className="border-2 border-dashed border-primary/40 hover:border-primary bg-primary/5 hover:bg-primary/10 rounded-2xl p-8 text-center flex flex-col items-center justify-center space-y-3 cursor-pointer transition-all active:scale-[0.99]"
        >
          <div className="w-14 h-14 rounded-2xl bg-primary/20 flex items-center justify-center text-primary shadow-md shadow-primary/10">
            <Upload className="w-7 h-7" />
          </div>
          <div>
            <p className="text-sm font-bold text-foreground">Upload Video to Compress</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Tap here to select any MP4, WebM, or MOV video file
            </p>
          </div>
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleVideoUpload}
            accept="video/*"
            className="hidden"
          />
        </div>
      ) : (
        <div className="space-y-4">
          {/* File Size Comparison Banner */}
          <div className="bg-secondary/60 border border-border rounded-xl p-3.5 flex items-center justify-between">
            <div className="flex items-center gap-2.5 min-w-0">
              <FileVideo className="w-5 h-5 text-primary shrink-0" />
              <div className="min-w-0">
                <p className="text-xs font-bold text-foreground truncate">Original Video File</p>
                <p className="text-[11px] text-muted-foreground font-mono">{formatBytes(originalSize)}</p>
              </div>
            </div>

            {hasCompressed && compressedSize > 0 && (
              <div className="flex items-center gap-2">
                <ArrowRight className="w-4 h-4 text-muted-foreground shrink-0" />
                <div className="text-right">
                  <p className="text-xs font-extrabold text-emerald-400 font-mono">{formatBytes(compressedSize)}</p>
                  <p className="text-[10px] text-emerald-500 font-bold">Saved {savedPercent}%</p>
                </div>
              </div>
            )}
          </div>

          {/* Video Preview Player */}
          <div className="space-y-1">
            <span className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider px-1 flex items-center gap-1">
              <Video className="w-3 h-3" />
              <span>Video Preview</span>
            </span>
            <div className="relative aspect-video rounded-xl overflow-hidden bg-black border border-border flex items-center justify-center">
              <video
                ref={videoRef}
                src={compressedUrl || videoSrc}
                controls={!isCompressing}
                muted
                playsInline
                className={`w-full h-full object-contain ${isCompressing ? "invisible" : ""}`}
              />
              {isCompressing && (
                <div className="absolute inset-0 flex flex-col items-center justify-center p-6 space-y-3 bg-black/80 backdrop-blur-sm rounded-xl">
                  <Loader2 className="w-8 h-8 text-primary animate-spin" />
                  <div className="w-full space-y-1.5 text-center">
                    <p className="text-xs font-bold text-primary flex items-center justify-between font-mono">
                      <span>Compressing Video…</span>
                      <span>{compressProgress}%</span>
                    </p>
                    <div className="w-full bg-secondary/80 h-2 rounded-full overflow-hidden">
                      <div
                        className="bg-primary h-full rounded-full transition-all duration-300"
                        style={{ width: `${compressProgress}%` }}
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Explicit COMPRESS VIDEO Button */}
          {!hasCompressed && (
            <Button
              type="button"
              onClick={compressVideo}
              disabled={isCompressing}
              className="w-full h-12 text-sm font-bold rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground shadow-lg shadow-primary/30 flex items-center justify-center gap-2 active:scale-95 transition-all cursor-pointer"
            >
              {isCompressing ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  <span>Compressing Video… {compressProgress}%</span>
                </>
              ) : (
                <>
                  <Archive className="w-5 h-5 text-primary-foreground animate-pulse" />
                  <span>Compress Video Now</span>
                </>
              )}
            </Button>
          )}

          {/* Presets */}
          <div className="space-y-2 pt-1">
            <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1">
              <Zap className="w-3.5 h-3.5 text-primary" />
              <span>Compression Presets</span>
            </p>
            <div className="flex gap-2 flex-wrap">
              <button
                type="button"
                onClick={() => applyPreset("balanced")}
                className={`px-3 py-1.5 rounded-full text-xs font-bold border transition-all cursor-pointer ${
                  preset === "balanced"
                    ? "bg-primary border-primary text-primary-foreground shadow-sm shadow-primary/30"
                    : "border-border text-muted-foreground hover:border-primary/50"
                }`}
              >
                ⚖️ Balanced (~50% Reduction)
              </button>
              <button
                type="button"
                onClick={() => applyPreset("small")}
                className={`px-3 py-1.5 rounded-full text-xs font-bold border transition-all cursor-pointer ${
                  preset === "small"
                    ? "bg-primary border-primary text-primary-foreground shadow-sm shadow-primary/30"
                    : "border-border text-muted-foreground hover:border-primary/50"
                }`}
              >
                🚀 Smallest File Size (~70% Reduction)
              </button>
              <button
                type="button"
                onClick={() => applyPreset("high")}
                className={`px-3 py-1.5 rounded-full text-xs font-bold border transition-all cursor-pointer ${
                  preset === "high"
                    ? "bg-primary border-primary text-primary-foreground shadow-sm shadow-primary/30"
                    : "border-border text-muted-foreground hover:border-primary/50"
                }`}
              >
                💎 High Quality (~30% Reduction)
              </button>
            </div>
          </div>

          {/* Fine Tuning Controls */}
          <div className="bg-secondary/40 border border-border rounded-xl p-3 space-y-3">
            <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1">
              <Sliders className="w-3.5 h-3.5 text-primary" />
              <span>Compression Tuning Controls</span>
            </p>

            <div className="space-y-2">
              <div className="flex justify-between text-xs font-semibold">
                <span>Compression Level (CRF)</span>
                <span className="text-primary font-mono">{crfQuality}</span>
              </div>
              <Slider
                value={[crfQuality]}
                onValueChange={(v) => setCrfQuality(v[0])}
                min={18}
                max={32}
                step={1}
              />
            </div>

            <div className="space-y-2">
              <div className="flex justify-between text-xs font-semibold">
                <span>Scale Output Resolution</span>
                <span className="text-primary font-mono">{targetScale}</span>
              </div>
              <div className="flex gap-2 flex-wrap">
                {(["100%", "720p", "480p", "360p"] as const).map((scale) => (
                  <button
                    key={scale}
                    type="button"
                    onClick={() => setTargetScale(scale)}
                    className={`px-3 py-1 rounded-lg text-xs font-bold border transition-all cursor-pointer ${
                      targetScale === scale
                        ? "bg-primary border-primary text-primary-foreground"
                        : "border-border text-muted-foreground hover:border-primary/50"
                    }`}
                  >
                    {scale}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Export Success Visual */}
          {downloadSuccessInfo && (
            <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-xl p-3 flex items-start gap-3 animate-in fade-in duration-300">
              <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0 mt-0.5" />
              <div className="min-w-0 flex-1">
                <p className="text-xs font-extrabold text-emerald-400">Export Complete!</p>
                <p className="text-[11px] text-foreground truncate mt-0.5">{downloadSuccessInfo.filename}</p>
                <p className="text-[10px] text-muted-foreground mt-0.5 flex items-center gap-1">
                  <FolderCheck className="w-3 h-3 text-emerald-400 shrink-0" />
                  Saved in device folder: <strong>{downloadSuccessInfo.folder}</strong>
                </p>
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-2 pt-1">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                if (videoSrc) URL.revokeObjectURL(videoSrc);
                if (compressedUrl) URL.revokeObjectURL(compressedUrl);
                setVideoSrc(null);
                setOriginalSize(0);
                setCompressedSize(0);
                setHasCompressed(false);
                setCompressedBlob(null);
                setCompressedUrl(null);
                setDownloadSuccessInfo(null);
                setCompressProgress(0);
              }}
              className="h-11 px-4 text-xs font-bold border-border gap-1.5 cursor-pointer"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Change Video</span>
            </Button>

            {hasCompressed && (
              <Button
                type="button"
                onClick={handleDownloadCompressed}
                disabled={isCompressing}
                className="flex-1 h-11 text-xs font-bold rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground shadow-md shadow-primary/25 gap-2 cursor-pointer"
              >
                <Download className="w-4 h-4" />
                <span>Download Compressed Video</span>
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
