import { useState, useEffect } from "react";
import { Loader2 } from "lucide-react";
import { SiDiscord } from "react-icons/si";
import logoFallback from "@assets/b52ef5e5af44af36517e4b1568bff58a_1780063742037.jpg";
import { loadBrandingImages, onBrandingChanged } from "@/lib/app-branding";

const APP_VERSION = import.meta.env.VITE_APP_VERSION_NAME ?? "1.2.20";
const DISCORD_INVITE_URL = "https://discord.gg/wu6ndP3Qgf";

export function SplashIntro({ onFinish }: { onFinish?: () => void }) {
  const [isVisible, setIsVisible] = useState(true);
  const [isFading, setIsFading] = useState(false);
  const [customLogo, setCustomLogo] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    const refreshLogo = () => {
      void loadBrandingImages()
        .then(({ logo }) => {
          if (mounted) setCustomLogo(logo);
        })
        .catch((error: unknown) => {
          console.error("Could not load the saved app logo.", error);
        });
    };
    refreshLogo();
    const unsubscribe = onBrandingChanged(refreshLogo);
    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    let finishTimer: ReturnType<typeof setTimeout> | null = null;
    const timer = setTimeout(() => {
      setIsFading(true);
      finishTimer = setTimeout(() => {
        setIsVisible(false);
        if (onFinish) onFinish();
      }, 520);
    }, 2000);

    return () => {
      clearTimeout(timer);
      if (finishTimer) clearTimeout(finishTimer);
    };
  }, [onFinish]);

  if (!isVisible) return null;

  return (
    <div
      className={`fixed inset-0 z-[9999] flex flex-col items-center justify-center bg-background text-foreground transition-all duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] select-none ${
        isFading ? "opacity-0 scale-105 pointer-events-none" : "opacity-100 scale-100"
      }`}
    >
      <div className="flex flex-col items-center space-y-4">

        {/* Animated Icon Container with Bouncy Drop & Glowing Outline */}
        <div className="relative group animate-splash-logo">
          {/* Pulsing Glowing Aura */}
          <div className="absolute -inset-2 rounded-3xl bg-gradient-to-r from-primary via-orange-600 to-red-700 opacity-60 blur-md animate-pulse" />

          {/* Main Icon Frame with Flashing Red-Brown Border */}
          <div className="relative w-24 h-24 rounded-2xl overflow-hidden border-2 border-primary/90 shadow-[0_0_25px_rgba(249,115,22,0.45)] bg-black/80 flex items-center justify-center ring-2 ring-red-900/60">
            <img
              src={customLogo || logoFallback}
              alt="HutaoTik Logo"
              className="w-full h-full object-cover scale-105"
            />
          </div>
        </div>

        {/* HutaoTik Text */}
        <div className="text-center pt-2 animate-bounce-pop" style={{ animationDelay: "180ms" }}>
          <h1 className="text-3xl font-extrabold font-syne tracking-tight text-white drop-shadow-[0_2px_10px_rgba(0,0,0,0.8)]">
            Hutao<span className="text-primary">Tik</span>
          </h1>
          <p className="text-[11px] font-medium tracking-widest text-white/50 uppercase mt-0.5">
            Video & Audio Downloader
          </p>
          <div
            className="mt-2 inline-flex items-center gap-1.5 px-3 py-0.5 rounded-full bg-primary/20 border border-primary/40 text-[10px] font-bold text-primary font-mono shadow-md shadow-primary/10 animate-bounce-pop"
            style={{ animationDelay: "300ms" }}
          >
            <span>Version {APP_VERSION}</span>
          </div>
        </div>

        {/* Loading Circle below text */}
        <div className="pt-2 flex flex-col items-center space-y-2 animate-bounce-pop" style={{ animationDelay: "380ms" }}>
          <Loader2 className="w-7 h-7 text-primary animate-spin drop-shadow-[0_0_8px_rgba(249,115,22,0.6)]" />
        </div>

        <a
          href={DISCORD_INVITE_URL}
          target="_blank"
          rel="noopener noreferrer"
          style={{ animationDelay: "460ms" }}
          className="animate-bounce-pop interactive-element mt-2 inline-flex items-center gap-2 rounded-xl border border-indigo-400/40 bg-indigo-500/15 px-4 py-2.5 text-xs font-bold text-white shadow-lg shadow-indigo-950/30 transition-colors hover:bg-indigo-500/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300"
        >
          <SiDiscord className="h-4 w-4" />
          Join our Discord for Hutao updates
        </a>
      </div>
    </div>
  );
}
