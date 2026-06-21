import { ReactNode, useState, useCallback, type MouseEvent } from "react";
import { Link, useLocation } from "wouter";
import {
  useGetPublicSettings,
  getGetPublicSettingsQueryKey,
  useGetUnreadNotificationCount,
  getGetUnreadNotificationCountQueryKey,
} from "@workspace/api-client-react";
import { Settings, Bell, Clock, Clapperboard, LockKeyhole, ExternalLink } from "lucide-react";
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
        className="relative z-10 w-9 h-9 rounded-lg object-cover border border-white/20 shadow transition-transform duration-200 group-hover:scale-110"
      />
    </div>
  );
}

export function Layout({ children }: { children: ReactNode }) {
  const [location] = useLocation();

  const { data: publicSettings } = useGetPublicSettings({
    query: { queryKey: getGetPublicSettingsQueryKey(), refetchInterval: 30_000 },
  });

  const { data: unreadCountData } = useGetUnreadNotificationCount({
    query: { queryKey: getGetUnreadNotificationCountQueryKey(), refetchInterval: 10_000 },
  });

  const unreadCount = unreadCountData?.count || 0;
  const logoSrc = publicSettings?.logoUrl || logoFallback;
  const bannerSrc = publicSettings?.bannerUrl || bannerFallback;

  const downloadsEnabled = publicSettings?.downloadsEnabled !== false;
  const alertsEnabled    = publicSettings?.alertsEnabled    !== false;
  const historyEnabled   = publicSettings?.historyEnabled   !== false;
  const showcaseEnabled  = publicSettings?.showcaseEnabled  !== false;

  const profileUrl = normalizeUrl(publicSettings?.tiktokProfileUrl);

  // Route through our redirect endpoint so same-origin navigation bypasses
  // iframe sandbox pop-up restrictions and works in all deployment contexts
  const profileRedirectUrl = profileUrl
    ? `/api/redirect?url=${encodeURIComponent(profileUrl)}`
    : undefined;

  const handleProfileClick = (e: MouseEvent<HTMLAnchorElement>) => {
    e.preventDefault();
    if (!profileRedirectUrl) return;
    const w = window.open(profileRedirectUrl, "_blank", "noopener,noreferrer");
    // If popup was blocked, fall back to same-tab navigation
    if (!w) window.location.href = profileRedirectUrl;
  };

  return (
    <div className="min-h-[100dvh] flex flex-col bg-background text-foreground">

      {/* ── Hero / Banner ──────────────────────────────── */}
      <div className="relative w-full" style={{ minHeight: "220px", overflow: "visible" }}>
        <div className="absolute inset-0 overflow-hidden">
          <img src={bannerSrc} alt="banner" className="w-full h-full object-cover object-center" />
          <div className="absolute inset-0 bg-gradient-to-b from-black/70 via-black/50 to-black/80" />
        </div>

        {/* Header row */}
        <header className="relative z-10 flex items-center justify-between px-4 pt-4 pb-2">
          <Link href="/" className="flex items-center gap-3 group">
            <GhostOrbit logoSrc={logoSrc} />
            <span className="text-white font-bold text-lg font-syne tracking-tight leading-none transition-colors duration-200 group-hover:text-primary">
              {publicSettings?.siteTitle || "HutaoTik"}
            </span>
          </Link>

          <nav className="flex items-center gap-1">

            {/* Showcase */}
            <Link
              href="/showcase"
              className={`relative flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all duration-200 hover:scale-105 active:scale-95 ${
                !showcaseEnabled ? "opacity-40" : ""
              } ${
                location === "/showcase"
                  ? "text-primary drop-shadow-[0_0_8px_rgba(249,115,22,0.55)]"
                  : "text-white/70 hover:text-white hover:bg-white/8"
              }`}
              data-testid="nav-showcase"
            >
              <Clapperboard className="w-4 h-4" />
              <span className="hidden sm:inline">Showcase</span>
              {!showcaseEnabled && (
                <span className="absolute -top-0.5 -right-0.5 w-3.5 h-3.5 rounded-full bg-zinc-700 border border-black/40 flex items-center justify-center">
                  <LockKeyhole className="w-2 h-2 text-zinc-300" />
                </span>
              )}
            </Link>

            {/* History */}
            <Link
              href="/history"
              className={`relative flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all duration-200 hover:scale-105 active:scale-95 ${
                !historyEnabled ? "opacity-40" : ""
              } ${
                location === "/history"
                  ? "text-primary drop-shadow-[0_0_8px_rgba(249,115,22,0.55)]"
                  : "text-white/70 hover:text-white hover:bg-white/8"
              }`}
              data-testid="nav-history"
            >
              <Clock className="w-4 h-4" />
              <span className="hidden sm:inline">History</span>
              {!historyEnabled && (
                <span className="absolute -top-0.5 -right-0.5 w-3.5 h-3.5 rounded-full bg-zinc-700 border border-black/40 flex items-center justify-center">
                  <LockKeyhole className="w-2 h-2 text-zinc-300" />
                </span>
              )}
            </Link>

            {/* Alerts */}
            <Link
              href="/notifications"
              className={`relative flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all duration-200 hover:scale-105 active:scale-95 ${
                !alertsEnabled ? "opacity-40" : ""
              } ${
                location === "/notifications"
                  ? "text-primary drop-shadow-[0_0_8px_rgba(249,115,22,0.55)]"
                  : "text-white/70 hover:text-white hover:bg-white/8"
              }`}
              data-testid="nav-notifications"
            >
              <Bell className="w-4 h-4" />
              <span className="hidden sm:inline">Alerts</span>
              {alertsEnabled && unreadCount > 0 && (
                <span className="absolute -top-0.5 -right-0.5 bg-primary text-[9px] font-bold text-black px-1 py-px rounded-full min-w-[16px] text-center leading-none animate-bounce">
                  {unreadCount > 9 ? "9+" : unreadCount}
                </span>
              )}
              {!alertsEnabled && (
                <span className="absolute -top-0.5 -right-0.5 w-3.5 h-3.5 rounded-full bg-zinc-700 border border-black/40 flex items-center justify-center">
                  <LockKeyhole className="w-2 h-2 text-zinc-300" />
                </span>
              )}
            </Link>

            {/* Admin gear — rotates 90° on hover */}
            <Link
              href="/admin"
              className="flex items-center justify-center w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 border border-white/20 transition-all duration-300 hover:scale-105 hover:rotate-90 active:scale-95 ml-1"
              data-testid="nav-admin"
              title="Admin Dashboard"
            >
              <Settings className="w-4 h-4 text-white/80" />
            </Link>
          </nav>
        </header>

        {/* Hero text */}
        <div className="relative z-10 px-4 pt-4 pb-8" style={{ animation: "slide-up-fade-in 0.5s ease both" }}>
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

      {/* ── Footer ───────────────────────────────────── */}
      <footer className="py-6 border-t border-border">
        <div className="max-w-2xl mx-auto px-4 text-center">
          <p className="text-xs text-muted-foreground">
            {publicSettings?.footerText || "Powered by HutaoTik"}
          </p>
        </div>
      </footer>
    </div>
  );
}
