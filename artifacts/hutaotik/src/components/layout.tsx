import { ReactNode, useState, useCallback, useEffect, type MouseEvent } from "react";
import {
  useGetPublicSettings,
  getGetPublicSettingsQueryKey,
} from "@workspace/api-client-react";
import { Coffee, Copy, ExternalLink, Settings as SettingsIcon, Sparkles, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { apiUrl } from "@/lib/api-url";
import { loadBrandingImages, onBrandingChanged } from "@/lib/app-branding";
import logoFallback from "@assets/b52ef5e5af44af36517e4b1568bff58a_1780063742037.jpg";
import bannerFallback from "@assets/4fb7478f6043ee9849d2fbb866bc6489_1780063761840.jpg";

function normalizeUrl(url: string | null | undefined): string | undefined {
  if (!url) return undefined;
  if (/^https?:\/\//i.test(url)) return url;
  return `https://${url}`;
}

const GHOST_FALLBACK_SVG =
  `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 20 26'%3E` +
  `%3Cpath d='M10 1C5.58 1 2 4.58 2 9v12l2.5-2.5 2.5 2.5 2.5-2.5 2.5 2.5 2.5-2.5 2.5 2.5V9C18 4.58 14.42 1 10 1z' fill='white'/%3E` +
  `%3Ccircle cx='7.5' cy='9.5' r='1.5' fill='%23111'/%3E` +
  `%3Ccircle cx='12.5' cy='9.5' r='1.5' fill='%23111'/%3E` +
  `%3C/svg%3E`;

const GHOST_CONFIGS = [
  { anim: "ghost-orbit-0", dur: 8,  delay: 0,  size: 13, opacity: 0.62, bob: 2.0 },
  { anim: "ghost-orbit-1", dur: 13, delay: -5, size: 11, opacity: 0.46, bob: 2.6 },
  { anim: "ghost-orbit-2", dur: 10, delay: -3, size: 14, opacity: 0.55, bob: 1.8 },
  { anim: "ghost-orbit-3", dur: 16, delay: -9, size: 10, opacity: 0.38, bob: 3.1 },
];

function GhostOrbit({ logoSrc }: { logoSrc: string }) {
  const [ghostSrc, setGhostSrc] = useState("/ghost.png");
  const onError = useCallback(() => setGhostSrc(GHOST_FALLBACK_SVG), []);

  return (
    <div className="relative shrink-0" style={{ width: 36, height: 36 }}>
      {/* Orbit layer — overflows this box intentionally */}
      <div
        className="absolute pointer-events-none"
        style={{ width: 80, height: 80, top: "50%", left: "50%", transform: "translate(-50%,-50%)" }}
      >
        {GHOST_CONFIGS.map(({ anim, dur, delay, size, opacity, bob }, i) => (
          <div
            key={i}
            className="absolute"
            style={{
              top: "50%", left: "50%",
              marginTop: `-${size / 2}px`,
              marginLeft: `-${size / 2}px`,
              animation: `${anim} ${dur}s linear infinite`,
              animationDelay: `${delay}s`,
            }}
          >
            <img
              src={ghostSrc}
              onError={onError}
              alt=""
              width={size}
              height={size}
              style={{
                opacity,
                animation: `ghost-bob ${bob}s ease-in-out infinite alternate`,
                animationDelay: `${i * 0.45}s`,
                filter: "drop-shadow(0 0 4px rgba(255,255,255,0.55))",
              }}
            />
          </div>
        ))}
      </div>
      {/* Actual logo above ghost layer */}
      <img
        src={logoSrc}
        alt="logo"
        className="relative z-10 w-9 h-9 rounded-lg object-cover border border-white/20 shadow transition-transform duration-300 ease-[var(--spring-bounce)] group-hover:scale-110 group-active:scale-95"
      />
    </div>
  );
}

function CoffeeSupportDialogContent({ onCopy }: { onCopy: () => Promise<void> }) {
  return (
    <DialogContent className="max-w-sm rounded-2xl border-border bg-card p-5 sm:p-6">
      <DialogHeader className="items-center text-center">
        <span className="mb-1 flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary">
          <Coffee className="h-6 w-6" />
        </span>
        <DialogTitle className="break-words">Thank you for your support!</DialogTitle>
        <DialogDescription className="break-words">
          Send a little support through GCash. Open GCash and choose Send Money.
        </DialogDescription>
      </DialogHeader>
      <div className="min-w-0 rounded-xl border border-primary/25 bg-primary/5 px-3 py-3 text-center sm:px-4">
        <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
          GCash number
        </p>
        <p className="mt-1 select-all break-words font-mono text-base font-bold tracking-wide text-primary sm:text-lg">
          +63 951 842 0452
        </p>
      </div>
      <Button type="button" variant="outline" onClick={onCopy} className="w-full max-w-full overflow-hidden">
        <Copy className="h-4 w-4 shrink-0" />
        <span className="min-w-0 truncate">Copy number</span>
      </Button>
    </DialogContent>
  );
}

export function Layout({ children }: { children: ReactNode }) {
  const [location, setLocation] = useState(
    () => (window.location.hash.replace("#", "") || "/").split("?")[0],
  );
  const { toast } = useToast();

  useEffect(() => {
    const syncHash = () => {
      setLocation((window.location.hash.replace("#", "") || "/").split("?")[0]);
    };
    window.addEventListener("hashchange", syncHash);
    syncHash();
    return () => window.removeEventListener("hashchange", syncHash);
  }, []);

  const { data: publicSettings } = useGetPublicSettings({
    query: { queryKey: getGetPublicSettingsQueryKey(), refetchInterval: 30_000 },
  });

  const [brandingImages, setBrandingImages] = useState<{ logo: string | null; banner: string | null }>({
    logo: null,
    banner: null,
  });
  useEffect(() => {
    let mounted = true;
    const refreshBranding = () => {
      void loadBrandingImages()
        .then((images) => {
          if (mounted) setBrandingImages({ logo: images.logo, banner: images.banner });
        })
        .catch((error: unknown) => {
          console.error("Could not load saved app branding images.", error);
        });
    };
    refreshBranding();
    const unsubscribe = onBrandingChanged(refreshBranding);
    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);

  const logoSrc = brandingImages.logo || publicSettings?.logoUrl || logoFallback;
  const bannerSrc = brandingImages.banner || publicSettings?.bannerUrl || bannerFallback;

  const profileUrl = normalizeUrl(publicSettings?.tiktokProfileUrl);

  const profileRedirectUrl = profileUrl
    ? apiUrl(`/api/redirect?url=${encodeURIComponent(profileUrl)}`)
    : undefined;

  const handleProfileClick = (e: MouseEvent<HTMLAnchorElement>) => {
    e.preventDefault();
    if (!profileRedirectUrl) return;
    const w = window.open(profileRedirectUrl, "_blank", "noopener,noreferrer");
    if (!w) window.location.href = profileRedirectUrl;
  };

  const navigateTo = (path: string) => {
    window.location.hash = path;
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  };

  const handleCopyGcashNumber = async () => {
    const numberToCopy = "+639518420452";
    let copied = false;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(numberToCopy);
        copied = true;
      }
    } catch {
      copied = false;
    }

    if (!copied) {
      try {
        const textarea = document.createElement("textarea");
        textarea.value = numberToCopy;
        textarea.setAttribute("readonly", "");
        textarea.style.position = "fixed";
        textarea.style.opacity = "0";
        textarea.style.pointerEvents = "none";
        document.body.appendChild(textarea);
        textarea.select();
        copied = document.execCommand("copy");
        document.body.removeChild(textarea);
      } catch {
        copied = false;
      }
    }

    if (copied) {
      toast({
        title: "GCash number copied",
        description: "Open GCash and send your support to +63 951 842 0452.",
      });
    } else {
      toast({
        title: "Could not copy the number",
        description: "Please copy +63 951 842 0452 manually.",
        variant: "destructive",
      });
    }
  };

  return (
    <div className="app-shell min-h-[100dvh] flex flex-col bg-background text-foreground">

      {/* ── Hero / Banner ──────────────────────────────── */}
      <div className="relative w-full" style={{ minHeight: "220px", overflow: "visible" }}>
        <div className="absolute inset-0 overflow-hidden">
          <img src={bannerSrc} alt="banner" className="w-full h-full object-cover object-center" />
          <div aria-hidden="true" className="hero-banner-depth absolute inset-0" />
          <div aria-hidden="true" className="hero-banner-scrim absolute inset-0" />
        </div>

        {/* Header row */}
        <header className="relative z-10 flex items-center justify-between px-4 pt-4 pb-2 gap-2">
          <button
            type="button"
            onClick={() => navigateTo("/")}
            className="flex items-center gap-3 group bg-transparent border-none cursor-pointer text-left shrink-0"
          >
            <GhostOrbit logoSrc={logoSrc} />
            <span className="text-white font-bold text-lg font-syne tracking-tight leading-none transition-colors duration-200 group-hover:text-primary">
              {publicSettings?.siteTitle || "HutaoTik"}
            </span>
          </button>

          <nav className="flex items-center gap-1.5 flex-wrap justify-end">
            {/* Taotools */}
            <button
              type="button"
              onClick={() => navigateTo("/taotools")}
              className={`relative flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold cursor-pointer bg-white/10 hover:bg-white/20 border shadow-sm ${
                location === "/taotools"
                  ? "text-primary border-primary bg-primary/20 drop-shadow-[0_0_8px_rgba(249,115,22,0.55)]"
                  : "text-white border-white/20"
              }`}
              data-testid="nav-taotools"
              title="Tao Tools Suite"
              aria-current={location === "/taotools" ? "page" : undefined}
            >
              <Wand2 className="w-3.5 h-3.5 text-primary shrink-0" />
              <span>Taotools</span>
            </button>

            {/* Updates */}
            <button
              type="button"
              onClick={() => navigateTo("/updates")}
              className={`relative flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold cursor-pointer bg-white/10 hover:bg-white/20 border shadow-sm ${
                location === "/updates"
                  ? "text-primary border-primary bg-primary/20 drop-shadow-[0_0_8px_rgba(249,115,22,0.55)]"
                  : "text-white border-white/20"
              }`}
              data-testid="nav-updates"
              title="App Version Updates & Changelog"
              aria-current={location === "/updates" ? "page" : undefined}
            >
              <Sparkles className="w-3.5 h-3.5 text-primary shrink-0" />
              <span>Updates</span>
            </button>

            {/* Settings */}
            <button
              type="button"
              onClick={() => navigateTo("/settings")}
              className={`relative flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold cursor-pointer bg-white/10 hover:bg-white/20 border shadow-sm ${
                location === "/settings"
                  ? "text-primary border-primary bg-primary/20 drop-shadow-[0_0_8px_rgba(249,115,22,0.55)]"
                  : "text-white border-white/20"
              }`}
              data-testid="nav-settings"
              title="App Settings"
              aria-current={location === "/settings" ? "page" : undefined}
            >
              <SettingsIcon className="w-3.5 h-3.5 text-primary shrink-0" />
              <span>Settings</span>
            </button>
          </nav>
        </header>

        {/* Hero text */}
        <div className="relative z-10 px-4 pt-4 pb-8 animate-bounce-pop" style={{ animationDelay: "80ms" }}>
          <h1 className="text-3xl font-syne font-extrabold text-white leading-tight">
            Download <span className="text-primary">anything.</span>
          </h1>
          <p className="mt-1.5 text-sm text-white/60 font-medium tracking-wide">
            TikTok
          </p>
        </div>
      </div>

      {/* Admin TikTok profile card */}
      {profileUrl && publicSettings?.tiktokAvatarUrl && (
        <div className="w-full max-w-2xl mx-auto px-4 pt-4" style={{ animation: "slide-up-fade-in 0.45s 0.1s ease both" }}>
          <a
            href={profileRedirectUrl}
            onClick={handleProfileClick}
            target="_blank"
            rel="noopener noreferrer"
            data-testid="link-admin-profile"
            className="inline-flex items-center gap-3 bg-card border border-border hover:border-primary/50 px-4 py-2.5 rounded-2xl transition-all duration-200 group shadow-sm hover:shadow-lg hover:shadow-primary/10 hover:-translate-y-0.5 active:translate-y-0"
          >
            <img
              src={publicSettings.tiktokAvatarUrl}
              alt="admin"
              className="w-9 h-9 rounded-full border border-primary/40 object-cover shrink-0 transition-transform duration-200 group-hover:scale-105"
            />
            <div>
              <p className="text-xs text-muted-foreground leading-none mb-0.5">TikTok</p>
              <p className="text-sm font-semibold text-foreground group-hover:text-primary transition-colors duration-200 leading-none">
                {publicSettings?.adminName || "Follow Us"}
              </p>
            </div>
            <ExternalLink className="w-3.5 h-3.5 text-muted-foreground group-hover:text-primary transition-colors duration-200 ml-auto" />
          </a>
        </div>
      )}

      {/* ── Main Content ──────────────────────────────── */}
      <main className="flex-1 w-full max-w-2xl mx-auto px-4 pt-6 pb-24 space-y-4">
        {children}
      </main>

      <Dialog>
        <DialogTrigger asChild>
          <button
            type="button"
            className="animate-bounce-pop fixed left-4 z-40 inline-flex max-w-[calc(100vw-2rem)] items-center gap-2 rounded-full border border-primary/40 bg-card/95 px-4 py-3 text-sm font-semibold text-foreground shadow-lg shadow-primary/15 backdrop-blur-md hover:border-primary hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            style={{ bottom: "max(1rem, env(safe-area-inset-bottom))", animationDelay: "220ms" }}
          >
            <Coffee className="h-4 w-4 shrink-0 text-primary animate-float-gentle" />
            <span className="truncate">Buy me a coffee</span>
          </button>
        </DialogTrigger>
        <CoffeeSupportDialogContent onCopy={handleCopyGcashNumber} />
      </Dialog>

      {/* ── Footer ───────────────────────────────────── */}
      <footer className="py-6 border-t border-border space-y-5">
        <div className="max-w-2xl mx-auto px-4 text-center">
          <Dialog>
            <DialogTrigger asChild>
              <button
                type="button"
                className="inline-flex items-center gap-1.5 rounded-full px-3 py-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-primary/10 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Coffee className="h-4 w-4 text-primary" />
                <span>Buy me a coffee :)</span>
              </button>
            </DialogTrigger>
            <CoffeeSupportDialogContent onCopy={handleCopyGcashNumber} />
          </Dialog>
        </div>
        <div className="max-w-2xl mx-auto px-4 text-center">
          <p className="text-xs text-muted-foreground">
            {publicSettings?.footerText || "Powered by Makisensei"}
          </p>
        </div>
      </footer>
    </div>
  );
}
