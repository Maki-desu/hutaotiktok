import { useState, useRef, useEffect, ChangeEvent } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Slider } from "@/components/ui/slider";
import {
  Wand2,
  Upload,
  Download,
  Sparkles,
  CheckCircle2,
  FolderCheck,
  RefreshCw,
  Sliders,
  Zap,
  Loader2,
  ImageIcon,
  Package,
  Layers,
} from "lucide-react";
import { saveBlobToDevice, getStoredFolderName } from "@/lib/download-folder";
import { type DownloadProgressState } from "@/lib/download-progress";
import { DownloadProgressCard } from "@/components/download-progress-card";
import { useToast } from "@/hooks/use-toast";

interface ImageItem {
  id: string;
  src: string;
  enhancedUrl: string | null;
}

export function TaoenhanceSection({
  folderName,
  onOpenFolderPicker,
}: {
  folderName?: string | null;
  onOpenFolderPicker?: () => void;
}) {
  const [imageList, setImageList] = useState<ImageItem[]>([]);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [hasEnhanced, setHasEnhanced] = useState(false);
  const [sharpen, setSharpen] = useState(60);
  const [contrast, setContrast] = useState(20);
  const [vibrance, setVibrance] = useState(25);
  const [upscale, setUpscale] = useState<1 | 2 | 4>(2);
  const [preset, setPreset] = useState<"auto" | "anime" | "crisp">("auto");
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingStatus, setProcessingStatus] = useState("Processing...");
  const [processingProgress, setProcessingProgress] = useState(0);
  const [isExporting, setIsExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState<DownloadProgressState>({ percent: 0 });
  const [downloadSuccessInfo, setDownloadSuccessInfo] = useState<{ filename: string; folder: string } | null>(null);

  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const handleImageUpload = (e: ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    // Limit to max 5 photos
    const selectedFiles = Array.from(files).slice(0, 5);
    const newItems: ImageItem[] = [];

    let loadedCount = 0;
    selectedFiles.forEach((file, index) => {
      const reader = new FileReader();
      reader.onload = (evt) => {
        if (evt.target?.result) {
          newItems.push({
            id: `${Date.now()}_${index}`,
            src: evt.target.result as string,
            enhancedUrl: null,
          });
        }
        loadedCount++;
        if (loadedCount === selectedFiles.length) {
          setImageList(newItems);
          setSelectedIdx(0);
          setHasEnhanced(false);
          setDownloadSuccessInfo(null);
          setProcessingProgress(0);

          if (selectedFiles.length > 1) {
            toast({
              title: `Batch Mode: ${selectedFiles.length} Photos Loaded`,
              description: "Tap 'Enhance All Photos' to batch process your images.",
            });
          }
        }
      };
      reader.readAsDataURL(file);
    });
  };

  const applyPreset = (p: "auto" | "anime" | "crisp") => {
    setPreset(p);
    if (p === "auto") {
      setSharpen(60);
      setContrast(20);
      setVibrance(25);
      setUpscale(2);
    } else if (p === "anime") {
      setSharpen(80);
      setContrast(30);
      setVibrance(40);
      setUpscale(2);
    } else if (p === "crisp") {
      setSharpen(100);
      setContrast(40);
      setVibrance(15);
      setUpscale(4);
    }
  };

  const processSingleImage = (srcUrl: string): Promise<string> => {
    return new Promise((resolve, reject) => {
      const img = new Image();
      if (!srcUrl.startsWith("data:")) {
        img.crossOrigin = "anonymous";
      }

      img.onload = () => {
        try {
          const scale = upscale;
          const maxDim = 4096;
          let w = img.width * scale;
          let h = img.height * scale;
          if (w > maxDim || h > maxDim) {
            const ratio = Math.min(maxDim / w, maxDim / h);
            w = Math.round(w * ratio);
            h = Math.round(h * ratio);
          }

          const canvas = canvasRef.current || document.createElement("canvas");
          canvas.width = w;
          canvas.height = h;

          const ctx = canvas.getContext("2d", { willReadFrequently: true });
          if (!ctx) {
            reject(new Error("Canvas context failed"));
            return;
          }

          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = "high";

          const cVal = 100 + contrast;
          const sVal = 100 + vibrance;
          const bVal = 100 + Math.round(sharpen * 0.1);

          ctx.filter = `brightness(${bVal}%) contrast(${cVal}%) saturate(${sVal}%)`;
          ctx.drawImage(img, 0, 0, w, h);

          if (sharpen > 20) {
            ctx.save();
            ctx.globalCompositeOperation = "overlay";
            ctx.globalAlpha = Math.min(0.6, (sharpen / 100) * 0.5);
            ctx.filter = `contrast(150%) brightness(110%) blur(1px)`;
            ctx.drawImage(canvas, 0, 0);
            ctx.restore();
          }

          const outputDataUrl = canvas.toDataURL("image/png", 0.95);
          resolve(outputDataUrl);
        } catch (e) {
          reject(e);
        }
      };

      img.onerror = reject;
      img.src = srcUrl;
    });
  };

  const processAllImages = async () => {
    if (imageList.length === 0) return;
    setIsProcessing(true);
    setProcessingProgress(5);

    const total = imageList.length;
    const updated = [...imageList];

    for (let i = 0; i < total; i++) {
      setProcessingStatus(`Enhancing photo ${i + 1} of ${total}…`);
      try {
        const resultUrl = await processSingleImage(imageList[i].src);
        updated[i].enhancedUrl = resultUrl;
      } catch (e) {
        console.error("Batch processing error on item", i, e);
      }
      const pct = Math.round(((i + 1) / total) * 100);
      setProcessingProgress(pct);
    }

    setImageList(updated);
    setIsProcessing(false);
    setHasEnhanced(true);
  };

  useEffect(() => {
    if (imageList.length > 0 && hasEnhanced) {
      processAllImages();
    }
  }, [sharpen, contrast, vibrance, upscale]);

  const handleDownloadAll = async () => {
    const targetFolder = folderName || getStoredFolderName() || "HutaoTik Downloads";
    if (!folderName && onOpenFolderPicker) {
      onOpenFolderPicker();
      return;
    }

    const enhancedItems = imageList.filter((item) => item.enhancedUrl);
    if (enhancedItems.length === 0) return;

    setIsExporting(true);
    setExportProgress({ percent: 0, status: "Preparing export…" });
    try {
      if (enhancedItems.length === 1) {
        // Single photo export
        const resp = await fetch(enhancedItems[0].enhancedUrl!);
        const blob = await resp.blob();
        const filename = `Taoenhance_${Date.now()}.png`;

        await saveBlobToDevice(blob, filename, targetFolder, setExportProgress, {
          startPercent: 15,
          endPercent: 100,
        });
        setDownloadSuccessInfo({ filename, folder: targetFolder });
      } else {
        // Batch ZIP export
        const JSZip = (await import("jszip")).default;
        const zip = new JSZip();
        const folder = zip.folder("enhanced_photos")!;

        for (let i = 0; i < enhancedItems.length; i++) {
          const resp = await fetch(enhancedItems[i].enhancedUrl!);
          const blob = await resp.blob();
          folder.file(`taoenhance-photo-${i + 1}.png`, blob);
          setExportProgress({
            percent: Math.round(((i + 1) / enhancedItems.length) * 55),
            status: `Adding photo ${i + 1} of ${enhancedItems.length}…`,
          });
        }

        const zipBlob = await zip.generateAsync({ type: "blob" }, (metadata) => {
          setExportProgress({
            percent: 55 + Math.round((metadata.percent / 100) * 30),
            status: "Packaging ZIP archive…",
          });
        });
        const filename = `Taoenhance_Batch_${enhancedItems.length}_Photos.zip`;

        await saveBlobToDevice(zipBlob, filename, targetFolder, setExportProgress, {
          startPercent: 85,
          endPercent: 100,
        });
        setDownloadSuccessInfo({ filename, folder: targetFolder });
      }

      toast({
        title: "Taoenhance Export Complete!",
        description: `Saved to Documents/${targetFolder}`,
      });
    } catch {
      toast({
        title: "Export Failed",
        description: "Could not save enhanced images.",
        variant: "destructive",
      });
    } finally {
      setIsExporting(false);
      setExportProgress({ percent: 0 });
    }
  };

  const activeItem = imageList[selectedIdx] || imageList[0];

  return (
    <div className="bg-card rounded-2xl border border-border overflow-hidden shadow-sm p-4 space-y-4 animate-in fade-in duration-300">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-9 h-9 rounded-xl bg-primary/15 border border-primary/30 flex items-center justify-center text-primary shrink-0">
            <Wand2 className="w-5 h-5 animate-pulse" />
          </div>
          <div>
            <h2 className="text-base font-syne font-bold flex items-center gap-1.5">
              <span>Taoenhance</span>
              <Badge className="bg-primary text-primary-foreground text-[9px] font-bold px-1.5 py-0">
                AI Batch Enhancer
              </Badge>
            </h2>
            <p className="text-[11px] text-muted-foreground">
              Upscale, sharpen, and batch enhance up to 5 photos at once.
            </p>
          </div>
        </div>
      </div>

      <canvas ref={canvasRef} className="hidden" />

      {/* Upload Box */}
      {imageList.length === 0 ? (
        <div
          onClick={() => fileInputRef.current?.click()}
          className="border-2 border-dashed border-primary/40 hover:border-primary bg-primary/5 hover:bg-primary/10 rounded-2xl p-8 text-center flex flex-col items-center justify-center space-y-3 cursor-pointer transition-all active:scale-[0.99]"
        >
          <div className="w-14 h-14 rounded-2xl bg-primary/20 flex items-center justify-center text-primary shadow-md shadow-primary/10">
            <Upload className="w-7 h-7" />
          </div>
          <div>
            <p className="text-sm font-bold text-foreground">Upload Photos to Enhance (Up to 5)</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Select 1 single photo or multi-select up to 5 photos from your gallery
            </p>
          </div>
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleImageUpload}
            accept="image/*"
            multiple
            className="hidden"
          />
        </div>
      ) : (
        <div className="space-y-4">
          {/* Multi-photo Thumbnail Grid Selector */}
          {imageList.length > 1 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between px-1">
                <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1">
                  <Layers className="w-3.5 h-3.5 text-primary" />
                  <span>Batch Photos ({imageList.length}/5 Loaded)</span>
                </span>
                <span className="text-[10px] text-primary font-bold">
                  Tap thumbnail to preview
                </span>
              </div>
              <div className="flex gap-2 overflow-x-auto no-scrollbar pb-1">
                {imageList.map((item, idx) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setSelectedIdx(idx)}
                    className={`relative w-16 h-16 rounded-xl overflow-hidden border-2 transition-all cursor-pointer shrink-0 ${
                      selectedIdx === idx
                        ? "border-primary ring-2 ring-primary/30 scale-105"
                        : "border-border opacity-70 hover:opacity-100"
                    }`}
                  >
                    <img
                      src={item.enhancedUrl || item.src}
                      alt={`thumb-${idx}`}
                      className="w-full h-full object-cover"
                    />
                    <Badge className="absolute bottom-1 right-1 text-[8px] px-1 py-0 bg-black/70 text-white border-none font-mono">
                      #{idx + 1}
                    </Badge>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Active Photo Preview Comparison */}
          {activeItem && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <span className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider px-1 flex items-center gap-1">
                  <ImageIcon className="w-3 h-3" />
                  <span>Original Photo #{selectedIdx + 1}</span>
                </span>
                <div className="relative aspect-square rounded-xl overflow-hidden bg-secondary border border-border">
                  <img src={activeItem.src} alt="Original" className="w-full h-full object-cover" />
                </div>
              </div>

              <div className="space-y-1">
                <span className="text-[10px] uppercase font-bold text-primary tracking-wider px-1 flex items-center gap-1">
                  <Sparkles className="w-3 h-3 text-primary animate-spin" />
                  <span>Taoenhance Preview ({upscale}x Upscaled)</span>
                </span>
                <div className="relative aspect-square rounded-xl overflow-hidden bg-secondary border border-primary/40 shadow-md shadow-primary/10 flex items-center justify-center">
                  {isProcessing ? (
                    <div className="w-full h-full flex flex-col items-center justify-center p-6 space-y-3 bg-black/60 backdrop-blur-sm rounded-xl">
                      <Loader2 className="w-8 h-8 text-primary animate-spin" />
                      <div className="w-full space-y-1.5 text-center">
                        <p className="text-xs font-bold text-primary flex items-center justify-between font-mono">
                          <span>{processingStatus}</span>
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
                  ) : activeItem.enhancedUrl ? (
                    <img src={activeItem.enhancedUrl} alt="Taoenhanced" className="w-full h-full object-cover" />
                  ) : (
                    <div className="p-4 text-center space-y-2">
                      <Wand2 className="w-8 h-8 text-primary/40 mx-auto" />
                      <p className="text-xs font-semibold text-muted-foreground">
                        Tap "{imageList.length > 1 ? "Enhance All Photos" : "Enhance Image"}" below to start
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Explicit ENHANCE ALL PHOTOS Button */}
          {!hasEnhanced && (
            <Button
              type="button"
              onClick={processAllImages}
              disabled={isProcessing}
              className="w-full h-12 text-sm font-bold rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground shadow-lg shadow-primary/30 flex items-center justify-center gap-2 active:scale-95 transition-all cursor-pointer"
            >
              {isProcessing ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  <span>{processingStatus} {processingProgress}%</span>
                </>
              ) : (
                <>
                  <Wand2 className="w-5 h-5 text-primary-foreground animate-pulse" />
                  <span>
                    {imageList.length > 1 ? `Enhance All ${imageList.length} Photos` : "Enhance Image"}
                  </span>
                </>
              )}
            </Button>
          )}

          {/* Preset Buttons */}
          <div className="space-y-2 pt-1">
            <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1">
              <Zap className="w-3.5 h-3.5 text-primary" />
              <span>Enhancement Presets</span>
            </p>
            <div className="flex gap-2 flex-wrap">
              <button
                type="button"
                onClick={() => applyPreset("auto")}
                className={`px-3 py-1.5 rounded-full text-xs font-bold border transition-all cursor-pointer ${
                  preset === "auto"
                    ? "bg-primary border-primary text-primary-foreground shadow-sm shadow-primary/30"
                    : "border-border text-muted-foreground hover:border-primary/50"
                }`}
              >
                🌟 Auto AI Magic
              </button>
              <button
                type="button"
                onClick={() => applyPreset("anime")}
                className={`px-3 py-1.5 rounded-full text-xs font-bold border transition-all cursor-pointer ${
                  preset === "anime"
                    ? "bg-primary border-primary text-primary-foreground shadow-sm shadow-primary/30"
                    : "border-border text-muted-foreground hover:border-primary/50"
                }`}
              >
                🎨 Anime & Lineart
              </button>
              <button
                type="button"
                onClick={() => applyPreset("crisp")}
                className={`px-3 py-1.5 rounded-full text-xs font-bold border transition-all cursor-pointer ${
                  preset === "crisp"
                    ? "bg-primary border-primary text-primary-foreground shadow-sm shadow-primary/30"
                    : "border-border text-muted-foreground hover:border-primary/50"
                }`}
              >
                🔍 Ultra 4K Sharpen
              </button>
            </div>
          </div>

          {/* Fine Tuning Sliders */}
          <div className="bg-secondary/40 border border-border rounded-xl p-3 space-y-3">
            <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1">
              <Sliders className="w-3.5 h-3.5 text-primary" />
              <span>Fine Tuning Controls</span>
            </p>

            <div className="space-y-2">
              <div className="flex justify-between text-xs font-semibold">
                <span>Sharpen Details</span>
                <span className="text-primary font-mono">{sharpen}%</span>
              </div>
              <Slider
                value={[sharpen]}
                onValueChange={(v) => setSharpen(v[0])}
                min={0}
                max={100}
                step={5}
              />
            </div>

            <div className="space-y-2">
              <div className="flex justify-between text-xs font-semibold">
                <span>Contrast & Clarity</span>
                <span className="text-primary font-mono">{contrast}%</span>
              </div>
              <Slider
                value={[contrast]}
                onValueChange={(v) => setContrast(v[0])}
                min={0}
                max={80}
                step={5}
              />
            </div>

            <div className="space-y-2">
              <div className="flex justify-between text-xs font-semibold">
                <span>Vibrance & Color Boost</span>
                <span className="text-primary font-mono">{vibrance}%</span>
              </div>
              <Slider
                value={[vibrance]}
                onValueChange={(v) => setVibrance(v[0])}
                min={0}
                max={80}
                step={5}
              />
            </div>

            <div className="space-y-2">
              <div className="flex justify-between text-xs font-semibold">
                <span>Canvas Upscale Factor</span>
                <span className="text-primary font-mono">{upscale}x</span>
              </div>
              <div className="flex gap-2">
                {([1, 2, 4] as const).map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setUpscale(s)}
                    className={`px-3 py-1 rounded-lg text-xs font-bold border transition-all cursor-pointer ${
                      upscale === s
                        ? "bg-primary border-primary text-primary-foreground"
                        : "border-border text-muted-foreground hover:border-primary/50"
                    }`}
                  >
                    {s}x Resolution
                  </button>
                ))}
              </div>
            </div>
          </div>

          {isExporting && (
            <DownloadProgressCard
              title={`Saving to ${folderName || getStoredFolderName() || "HutaoTik Downloads"}…`}
              progress={exportProgress}
              className=""
            />
          )}

          {/* Download Completion visual */}
          {downloadSuccessInfo && !isExporting && (
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
                setImageList([]);
                setSelectedIdx(0);
                setHasEnhanced(false);
                setDownloadSuccessInfo(null);
                setProcessingProgress(0);
              }}
              className="h-11 px-4 text-xs font-bold border-border gap-1.5 cursor-pointer"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Change Photos</span>
            </Button>

            {hasEnhanced && (
              <Button
                type="button"
                onClick={handleDownloadAll}
                disabled={isProcessing || isExporting}
                className="flex-1 min-w-0 max-w-full overflow-hidden h-11 text-xs font-bold rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground shadow-md shadow-primary/25 gap-2 cursor-pointer"
              >
                {isExporting ? (
                  <>
                    <Loader2 className="w-4 h-4 shrink-0 animate-spin" />
                    <span className="min-w-0 truncate">Saving… {exportProgress.percent}%</span>
                  </>
                ) : imageList.length > 1 ? (
                  <>
                    <Package className="w-4 h-4 shrink-0" />
                    <span className="min-w-0 truncate">Download All {imageList.length} Enhanced (ZIP)</span>
                  </>
                ) : (
                  <>
                    <Download className="w-4 h-4 shrink-0" />
                    <span className="min-w-0 truncate">Download Enhanced Image</span>
                  </>
                )}
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
