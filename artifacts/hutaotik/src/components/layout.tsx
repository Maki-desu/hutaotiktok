import { ReactNode, useState, useCallback, useEffect, useRef, type MouseEvent } from "react";
import {
  useGetPublicSettings,
  getGetPublicSettingsQueryKey,
} from "@workspace/api-client-react";
import {
  Check,
  ChevronDown,
  Coffee,
  Copy,
  ExternalLink,
  History as HistoryIcon,
  Home as HomeIcon,
  Lightbulb,
  Menu,
  Settings as SettingsIcon,
  Sparkles,
  Wand2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
    <div className="relative shrink-0 w-9 h-9">
      {/* Orbit layer — overflows this box intentionally */}
      <div
        className="absolute pointer-events-none w-20 h-20"
        style={{ top: "50%", left: "50%", transform: "translate(-50%,-50%)" }}
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
  const [showLobbyHint, setShowLobbyHint] = useState(false);
  const initialHintDoneRef = useRef(false);
  const { toast } = useToast();

  useEffect(() => {
    const syncHash = () => {
      setLocation((window.location.hash.replace("#", "") || "/").split("?")[0]);
    };
    window.addEventListener("hashchange", syncHash);
    syncHash();
    return () => window.removeEventListener("hashchange", syncHash);
  }, []);

  // Top-left Lobby hint: shows for 3 seconds, disappears for 10 seconds, then reappears in a clean cycle
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;

    const showCycle = () => {
      if (cancelled) return;
      setShowLobbyHint(true);
      timer = setTimeout(() => {
        if (cancelled) return;
        setShowLobbyHint(false);
        timer = setTimeout(showCycle, 10_000);
      }, 3_000);
    };

    const initialDelay = !initialHintDoneRef.current ? 2_550 : 120;
    initialHintDoneRef.current = true;
    timer = setTimeout(showCycle, initialDelay);

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [location]);

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

  const navItems = [
    {
      path: "/",
      label: "Home",
      description: "Download videos, audio & photos",
      icon: HomeIcon,
      testId: "nav-home",
    },
    {
      path: "/history",
      label: "History",
      description: "Past downloads & re-download",
      icon: HistoryIcon,
      testId: "nav-history",
    },
    {
      path: "/taotools",
      label: "Taotools",
      description: "Compress, enhance & remove BG",
      icon: Wand2,
      testId: "nav-taotools",
    },
    {
      path: "/updates",
      label: "Updates",
      description: "New releases & changelog",
      icon: Sparkles,
      testId: "nav-updates",
    },
    {
      path: "/suggestions",
      label: "Suggestions",
      description: "Send & upvote ideas",
      icon: Lightbulb,
      testId: "nav-suggestions",
    },
  ] as const;

  const settingsNavItem = {
    path: "/settings",
    label: "Settings",
    description: "Display size, fonts, theme & cache",
    icon: SettingsIcon,
    testId: "nav-settings",
  } as const;

  const activeSubItem =
    location === "/settings"
      ? settingsNavItem
      : navItems.find((item) => item.path !== "/" && item.path === location);
  const ActiveTriggerIcon = activeSubItem ? activeSubItem.icon : Menu;

  return (
    <div className="app-shell relative min-h-[100dvh] flex flex-col bg-background text-foreground">
      <div aria-hidden="true" className="liquid-glass-backdrop pointer-events-none" />

      {/* ── Hero / Banner ──────────────────────────────── */}
      <div className="relative w-full min-h-[13.75rem]" style={{ overflow: "visible" }}>
        <div className="absolute inset-0 overflow-hidden">
          <img src={bannerSrc} alt="banner" className="w-full h-full object-cover object-center" />
          <div aria-hidden="true" className="hero-banner-depth absolute inset-0" />
          <div aria-hidden="true" className="hero-banner-scrim absolute inset-0" />
        </div>

        {/* Header row */}
        <header className="relative z-10 flex items-center justify-between px-4 pt-4 pb-2 gap-2.5">
          <div className="relative shrink-0">
            <button
              type="button"
              onClick={() => navigateTo("/")}
              className="flex items-center gap-3 group bg-transparent border-none cursor-pointer text-left shrink-0"
            >
              <GhostOrbit logoSrc={logoSrc} />
              <span className="hero-text-shadow text-white font-bold text-lg font-syne tracking-tight leading-none transition-colors duration-200 group-hover:text-primary">
                {publicSettings?.siteTitle || "HutaoTik"}
              </span>
            </button>

            <button
              type="button"
              data-testid="lobby-hint-pill"
              onClick={() => navigateTo("/")}
              aria-hidden={!showLobbyHint}
              tabIndex={showLobbyHint ? 0 : -1}
              className={`absolute left-0 top-full mt-2 z-20 inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border border-white/25 bg-black/75 px-2.5 py-1 text-[0.65rem] font-semibold text-white/95 shadow-[0_6px_16px_rgba(0,0,0,0.62)] backdrop-blur-md transition-all duration-300 ease-[var(--spring-bounce)] cursor-pointer ${
                showLobbyHint
                  ? "opacity-100 translate-y-0 scale-100"
                  : "opacity-0 -translate-y-1.5 scale-90 pointer-events-none"
              }`}
            >
              <span
                aria-hidden="true"
                className="absolute -top-1 left-3.5 h-2 w-2 rotate-45 border-l border-t border-white/25 bg-black/80"
              />
              <HomeIcon className="h-3 w-3 shrink-0 text-primary" />
              <span>Tap logo for Lobby</span>
            </button>
          </div>

          <nav className="nav-pill-group flex items-center justify-end">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  data-testid="nav-menu-trigger"
                  aria-label="Open navigation menu"
                  className={`nav-pill-btn group relative flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold cursor-pointer border backdrop-blur-md outline-none focus-visible:ring-2 focus-visible:ring-primary/70 ${
                    activeSubItem
                      ? "nav-pill-active text-white border-primary/80 bg-primary/35 shadow-[0_4px_16px_rgba(0,0,0,0.58),0_0_14px_hsl(var(--primary)/0.45)]"
                      : "text-white border-white/25 bg-black/55 hover:bg-black/70 shadow-[0_4px_14px_rgba(0,0,0,0.55),0_1px_3px_rgba(0,0,0,0.65)]"
                  }`}
                >
                  <ActiveTriggerIcon className="w-4 h-4 text-primary shrink-0 drop-shadow-[0_1px_2px_rgba(0,0,0,0.65)]" />
                  <span className="nav-pill-label">
                    {activeSubItem ? activeSubItem.label : "Menu"}
                  </span>
                  <ChevronDown className="w-3.5 h-3.5 text-white/85 shrink-0 transition-transform duration-200 group-data-[state=open]:rotate-180" />
                </button>
              </DropdownMenuTrigger>

              <DropdownMenuContent
                align="end"
                sideOffset={8}
                className="w-60 rounded-2xl border border-border/80 bg-popover/95 p-1.5 shadow-[0_18px_42px_-8px_rgba(0,0,0,0.72)] backdrop-blur-xl"
              >
                <DropdownMenuLabel className="px-2.5 py-1.5 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                  Navigation
                </DropdownMenuLabel>

                {navItems.map((item) => {
                  const Icon = item.icon;
                  const isActive = location === item.path;
                  return (
                    <DropdownMenuItem
                      key={item.path}
                      data-testid={item.testId}
                      onSelect={() => navigateTo(item.path)}
                      className={`cursor-pointer rounded-xl px-2.5 py-2 gap-2.5 transition-colors ${
                        isActive
                          ? "bg-primary/15 text-foreground focus:bg-primary/20"
                          : "focus:bg-accent/80"
                      }`}
                    >
                      <span
                        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border ${
                          isActive
                            ? "border-primary/45 bg-primary/20 text-primary"
                            : "border-border/70 bg-background/70 text-primary"
                        }`}
                      >
                        <Icon className="h-4 w-4" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-xs font-bold leading-tight text-foreground">
                          {item.label}
                        </span>
                        <span className="mt-0.5 block truncate text-[10px] leading-tight text-muted-foreground">
                          {item.description}
                        </span>
                      </span>
                      {isActive && (
                        <Check className="h-3.5 w-3.5 shrink-0 text-primary" />
                      )}
                    </DropdownMenuItem>
                  );
                })}

                <DropdownMenuSeparator className="my-1.5 bg-border/70" />

                <DropdownMenuItem
                  data-testid={settingsNavItem.testId}
                  onSelect={() => navigateTo(settingsNavItem.path)}
                  className={`cursor-pointer rounded-xl px-2.5 py-2 gap-2.5 transition-colors ${
                    location === settingsNavItem.path
                      ? "bg-primary/15 text-foreground focus:bg-primary/20"
                      : "focus:bg-accent/80"
                  }`}
                >
                  <span
                    className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border ${
                      location === settingsNavItem.path
                        ? "border-primary/45 bg-primary/20 text-primary"
                        : "border-border/70 bg-background/70 text-primary"
                    }`}
                  >
                    <SettingsIcon className="h-4 w-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-xs font-bold leading-tight text-foreground">
                      {settingsNavItem.label}
                    </span>
                    <span className="mt-0.5 block truncate text-[10px] leading-tight text-muted-foreground">
                      {settingsNavItem.description}
                    </span>
                  </span>
                  {location === settingsNavItem.path && (
                    <Check className="h-3.5 w-3.5 shrink-0 text-primary" />
                  )}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </nav>
        </header>
      </div>

      {/* Admin TikTok profile card */}
      {profileUrl && publicSettings?.tiktokAvatarUrl && (
        <div className="w-full max-w-2xl mx-auto px-4 pt-4" style={{ animation: "slide-up-fade-in 0.45s 0.1s ease backwards" }}>
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
            className="coffee-fab animate-bounce-pop fixed left-4 z-40 inline-flex max-w-[calc(100vw-2rem)] items-center gap-2 rounded-full border border-primary/40 bg-card/95 px-4 py-3 text-sm font-semibold text-foreground shadow-lg shadow-primary/15 backdrop-blur-md hover:border-primary hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
