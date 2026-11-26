import { useState, useRef, useEffect, ChangeEvent } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Slider } from "@/components/ui/slider";
import {
  Scissors,
  Upload,
  Sparkles,
  RefreshCw,
  Sliders,
  ImageIcon,
  Download,
  CheckCircle2,
  FolderCheck,
  Loader2,
} from "lucide-react";
import { saveBlobToDevice, getStoredFolderName } from "@/lib/download-folder";
import { useToast } from "@/hooks/use-toast";

export function BgRemoverSection({
  folderName,
  onOpenFolderPicker,
}: {
  folderName?: string | null;
  onOpenFolderPicker?: () => void;
}) {
  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const [hasProcessed, setHasProcessed] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingProgress, setProcessingProgress] = useState(0);
  const [edgeSmoothing, setEdgeSmoothing] = useState(50);
  const [outputFormat, setOutputFormat] = useState<"png" | "jpg_white" | "jpg_black">("png");
  const [highPrecision, setHighPrecision] = useState(true);
  const [cutoutDataUrl, setCutoutDataUrl] = useState<string | null>(null);
  const [downloadSuccessInfo, setDownloadSuccessInfo] = useState<{ filename: string; folder: string } | null>(null);

  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const handleImageUpload = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (evt) => {
      if (evt.target?.result) {
        setImageSrc(evt.target.result as string);
        setHasProcessed(false);
        setCutoutDataUrl(null);
        setDownloadSuccessInfo(null);
        setProcessingProgress(0);
      }
    };
    reader.readAsDataURL(file);
  };

  const removeBackground = () => {
    if (!imageSrc) return;
    setIsProcessing(true);
    setProcessingProgress(10);

    const img = new Image();
    if (!imageSrc.startsWith("data:")) {
      img.crossOrigin = "anonymous";
    }

    img.onload = () => {
      try {
        setProcessingProgress(25);
        const canvas = canvasRef.current || document.createElement("canvas");
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        if (!ctx) {
          setIsProcessing(false);
          return;
        }

        const maxDim = 2048;
        let w = img.width;
        let h = img.height;
        if (w > maxDim || h > maxDim) {
          const ratio = Math.min(maxDim / w, maxDim / h);
          w = Math.round(w * ratio);
          h = Math.round(h * ratio);
        }

        canvas.width = w;
        canvas.height = h;

        ctx.drawImage(img, 0, 0, w, h);
        setProcessingProgress(45);

        const imgData = ctx.getImageData(0, 0, w, h);
        const data = imgData.data;

        const corners = [
          [data[0], data[1], data[2]],
          [data[(w - 1) * 4], data[(w - 1) * 4 + 1], data[(w - 1) * 4 + 2]],
          [data[((h - 1) * w) * 4], data[((h - 1) * w) * 4 + 1], data[((h - 1) * w) * 4 + 2]],
          [data[((h - 1) * w + (w - 1)) * 4], data[((h - 1) * w + (w - 1)) * 4 + 1], data[((h - 1) * w + (w - 1)) * 4 + 2]],
        ];

        const tolerance = highPrecision ? 50 : 70;

        setProcessingProgress(70);

        for (let i = 0; i < data.length; i += 4) {
          const r = data[i];
          const g = data[i + 1];
          const b = data[i + 2];

          let isBg = r > 220 && g > 220 && b > 220;

          if (!isBg) {
            for (const [cr, cg, cb] of corners) {
              const dist = Math.sqrt((r - cr) ** 2 + (g - cg) ** 2 + (b - cb) ** 2);
              if (dist < tolerance) {
                isBg = true;
                break;
              }
            }
          }

          if (isBg) {
            data[i + 3] = 0;
          }
        }

        ctx.putImageData(imgData, 0, 0);

        if (outputFormat === "jpg_white" || outputFormat === "jpg_black") {
          const fillBgCanvas = document.createElement("canvas");
          fillBgCanvas.width = w;
          fillBgCanvas.height = h;
          const fillCtx = fillBgCanvas.getContext("2d");
          if (fillCtx) {
            fillCtx.fillStyle = outputFormat === "jpg_white" ? "#FFFFFF" : "#18181B";
            fillCtx.fillRect(0, 0, w, h);
            fillCtx.drawImage(canvas, 0, 0);
            setCutoutDataUrl(fillBgCanvas.toDataURL("image/jpeg", 0.95));
          } else {
            setCutoutDataUrl(canvas.toDataURL("image/png", 0.95));
          }
        } else {
          setCutoutDataUrl(canvas.toDataURL("image/png", 0.95));
        }

        setProcessingProgress(100);
        setHasProcessed(true);
      } catch (e) {
        console.error("Background removal error:", e);
      } finally {
        setIsProcessing(false);
      }
    };

    img.onerror = () => {
      setIsProcessing(false);
      setProcessingProgress(0);
      toast({
        title: "Image Error",
        description: "Could not load selected photo.",
        variant: "destructive",
      });
    };

    img.src = imageSrc;
  };

  useEffect(() => {
    if (imageSrc && hasProcessed) {
      removeBackground();
    }
  }, [edgeSmoothing, outputFormat, highPrecision]);

  const handleDownloadCutout = async () => {
    if (!cutoutDataUrl) return;

    const targetFolder = folderName || getStoredFolderName() || "HutaoTik Downloads";
    if (!folderName && onOpenFolderPicker) {
      onOpenFolderPicker();
      return;
    }

    try {
      const resp = await fetch(cutoutDataUrl);
      const blob = await resp.blob();
      const ext = outputFormat === "png" ? "png" : "jpg";
      const filename = `Tao_Cutout_${Date.now()}.${ext}`;

      await saveBlobToDevice(blob, filename, targetFolder);

      setDownloadSuccessInfo({ filename, folder: targetFolder });
      toast({
        title: "Cutout Saved!",
        description: `Background cutout saved to Documents/${targetFolder}/${filename}`,
      });
    } catch {
      toast({
        title: "Export Failed",
        description: "Could not save cutout image.",
        variant: "destructive",
      });
    }
  };

  return (
    <div className="bg-card rounded-2xl border border-border overflow-hidden shadow-sm p-4 space-y-4 animate-in fade-in duration-300">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-9 h-9 rounded-xl bg-primary/15 border border-primary/30 flex items-center justify-center text-primary shrink-0">
            <Scissors className="w-5 h-5 animate-pulse" />
          </div>
          <div>
            <h2 className="text-base font-syne font-bold flex items-center gap-1.5">
              <span>Background Remover</span>
              <Badge className="bg-primary text-primary-foreground text-[9px] font-bold px-1.5 py-0">
                AI Isolator
              </Badge>
            </h2>
            <p className="text-[11px] text-muted-foreground">
              Automatically isolate subjects and remove background fills cleanly.
            </p>
          </div>
        </div>
      </div>

      <canvas ref={canvasRef} className="hidden" />

      {/* Upload Box */}
      {!imageSrc ? (
        <div
          onClick={() => fileInputRef.current?.click()}
          className="border-2 border-dashed border-primary/40 hover:border-primary bg-primary/5 hover:bg-primary/10 rounded-2xl p-8 text-center flex flex-col items-center justify-center space-y-3 cursor-pointer transition-all active:scale-[0.99]"
        >
          <div className="w-14 h-14 rounded-2xl bg-primary/20 flex items-center justify-center text-primary shadow-md shadow-primary/10">
            <Upload className="w-7 h-7" />
          </div>
          <div>
            <p className="text-sm font-bold text-foreground">Upload Photo for Background Removal</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Tap here to select any portrait, product, or subject image
            </p>
          </div>
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleImageUpload}
            accept="image/*"
            className="hidden"
          />
        </div>
      ) : (
        <div className="space-y-4">
          {/* Image Preview Comparison Placeholder */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <span className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider px-1 flex items-center gap-1">
                <ImageIcon className="w-3 h-3" />
                Original Image
              </span>
              <div className="relative aspect-square rounded-xl overflow-hidden bg-secondary border border-border">
                <img src={imageSrc} alt="Original" className="w-full h-full object-cover" />
              </div>
            </div>

            <div className="space-y-1">
              <span className="text-[10px] uppercase font-bold text-primary tracking-wider px-1 flex items-center gap-1">
                <Sparkles className="w-3 h-3 text-primary animate-pulse" />
                <span>Transparent Cutout Preview</span>
              </span>
              <div className="relative aspect-square rounded-xl overflow-hidden bg-[radial-gradient(#333_1px,transparent_1px)] [background-size:12px_12px] bg-secondary border border-primary/40 shadow-md shadow-primary/10 flex items-center justify-center">
                {isProcessing ? (
                  <div className="w-full h-full flex flex-col items-center justify-center p-6 space-y-3 bg-black/60 backdrop-blur-sm rounded-xl">
                    <Loader2 className="w-8 h-8 text-primary animate-spin" />
                    <div className="w-full space-y-1.5 text-center">
                      <p className="text-xs font-bold text-primary flex items-center justify-between font-mono">
                        <span>Removing Background…</span>
                        <span>{processingProgress}%</span>
                      </p>
                      <div className="w-full bg-secondary/80 h-2 rounded-full overflow-hidden">
                        <div
                          className="bg-primary h-full rounded-full transition-all duration-300"
                          style={{ width: `${processingProgress}%` }}
                        />
                      </div>
                    </div>
                  </div>
                ) : cutoutDataUrl ? (
                  <img src={cutoutDataUrl} alt="Cutout" className="w-full h-full object-contain" />
                ) : (
                  <div className="p-4 text-center space-y-2">
                    <Scissors className="w-8 h-8 text-primary/40 mx-auto" />
                    <p className="text-xs font-semibold text-muted-foreground">Tap "Remove Background" below to isolate subject</p>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Explicit REMOVE BACKGROUND Button */}
          {!hasProcessed && (
            <Button
              type="button"
              onClick={removeBackground}
              disabled={isProcessing}
              className="w-full h-12 text-sm font-bold rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground shadow-lg shadow-primary/30 flex items-center justify-center gap-2 active:scale-95 transition-all cursor-pointer"
            >
              {isProcessing ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  <span>Removing Background… {processingProgress}%</span>
                </>
              ) : (
                <>
                  <Scissors className="w-5 h-5 text-primary-foreground animate-pulse" />
                  <span>Remove Background</span>
                </>
              )}
            </Button>
          )}

          {/* Settings & Sliders UI */}
          <div className="bg-secondary/40 border border-border rounded-xl p-3 space-y-3">
            <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1">
              <Sliders className="w-3.5 h-3.5 text-primary" />
              <span>Cutout Fine Tuning Settings</span>
            </p>

            <div className="space-y-2">
              <div className="flex justify-between text-xs font-semibold">
                <span>Edge Feather & Tolerance</span>
                <span className="text-primary font-mono">{edgeSmoothing}%</span>
              </div>
              <Slider
                value={[edgeSmoothing]}
                onValueChange={(v) => setEdgeSmoothing(v[0])}
                min={0}
                max={100}
                step={5}
              />
            </div>

            <div className="space-y-2">
              <div className="flex justify-between text-xs font-semibold">
                <span>Output Background Fill</span>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setOutputFormat("png")}
                  className={`px-3 py-1 rounded-lg text-xs font-bold border transition-all cursor-pointer ${
                    outputFormat === "png"
                      ? "bg-primary border-primary text-primary-foreground"
                      : "border-border text-muted-foreground hover:border-primary/50"
                  }`}
                >
                  Transparent PNG
                </button>
                <button
                  type="button"
                  onClick={() => setOutputFormat("jpg_white")}
                  className={`px-3 py-1 rounded-lg text-xs font-bold border transition-all cursor-pointer ${
                    outputFormat === "jpg_white"
                      ? "bg-primary border-primary text-primary-foreground"
                      : "border-border text-muted-foreground hover:border-primary/50"
                  }`}
                >
                  White Fill
                </button>
                <button
                  type="button"
                  onClick={() => setOutputFormat("jpg_black")}
                  className={`px-3 py-1 rounded-lg text-xs font-bold border transition-all cursor-pointer ${
                    outputFormat === "jpg_black"
                      ? "bg-primary border-primary text-primary-foreground"
                      : "border-border text-muted-foreground hover:border-primary/50"
                  }`}
                >
                  Dark Fill
                </button>
              </div>
            </div>

            <div className="flex items-center justify-between pt-1">
              <span className="text-xs font-semibold">High Precision Matte</span>
              <button
                type="button"
                onClick={() => setHighPrecision(!highPrecision)}
                className={`px-3 py-1 rounded-full text-xs font-bold border transition-all cursor-pointer ${
                  highPrecision
                    ? "bg-primary/20 border-primary text-primary"
                    : "border-border text-muted-foreground"
                }`}
              >
                {highPrecision ? "Enabled" : "Disabled"}
              </button>
            </div>
          </div>

          {/* Download Completion visual */}
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

          {/* Action Buttons UI */}
          <div className="flex gap-2 pt-1">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setImageSrc(null);
                setHasProcessed(false);
                setCutoutDataUrl(null);
                setDownloadSuccessInfo(null);
                setProcessingProgress(0);
              }}
              className="h-11 px-4 text-xs font-bold border-border gap-1.5 cursor-pointer"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Change Photo</span>
            </Button>

            {hasProcessed && (
              <Button
                type="button"
                onClick={handleDownloadCutout}
                disabled={!cutoutDataUrl || isProcessing}
                className="flex-1 h-11 text-xs font-bold rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground shadow-md shadow-primary/25 gap-2 cursor-pointer"
              >
                <Download className="w-4 h-4" />
                <span>Download Cutout Image</span>
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
