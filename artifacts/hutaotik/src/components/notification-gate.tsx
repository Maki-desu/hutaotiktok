import { ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { BellRing, CheckCircle2, ExternalLink, Loader2, Lock, Settings as SettingsIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  getNotificationStatus,
  hasNativeNotificationBridge,
  openDeviceNotificationSettings,
  requestAppNotificationPermission,
  shouldRequireNotificationGate,
  syncNotificationsToNative,
  type NativeNotificationStatus,
} from "@/lib/notifications";

export function NotificationGate({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<NativeNotificationStatus>(() => getNotificationStatus());
  const [requesting, setRequesting] = useState(false);
  const [deniedOnce, setDeniedOnce] = useState(false);
  const [recheckNotice, setRecheckNotice] = useState<string | null>(null);
  const autoPromptedRef = useRef(false);

  const isNative = hasNativeNotificationBridge();
  const isLocked = shouldRequireNotificationGate(status);

  const refreshStatus = useCallback(() => {
    const next = getNotificationStatus();
    setStatus((prev) =>
      prev.supported === next.supported &&
      prev.granted === next.granted &&
      prev.downloads === next.downloads &&
      prev.updates === next.updates &&
      prev.announcements === next.announcements &&
      prev.sdkInt === next.sdkInt
        ? prev
        : next,
    );
    if (next.granted) {
      setRecheckNotice(null);
      syncNotificationsToNative();
    }
    return next;
  }, []);

  useEffect(() => {
    const sync = () => {
      refreshStatus();
    };

    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        sync();
      }
    };

    window.addEventListener("focus", sync);
    document.addEventListener("visibilitychange", handleVisibility);

    // Poll every 1.2s while locked (and every 4s while unlocked on Android) so returning from Android Settings unlocks immediately
    const pollMs = isLocked ? 1_200 : isNative ? 4_000 : 0;
    const interval = pollMs > 0 ? window.setInterval(sync, pollMs) : null;

    const handles: Array<{ remove?: () => Promise<void> }> = [];
    if (typeof window !== "undefined" && (window as any).Capacitor?.Plugins?.App) {
      Promise.resolve(
        (window as any).Capacitor.Plugins.App.addListener(
          "appStateChange",
          (state: { isActive: boolean }) => {
            if (state?.isActive) sync();
          },
        ),
      )
        .then((handle) => {
          if (handle) handles.push(handle);
        })
        .catch(() => {});
    }

    return () => {
      window.removeEventListener("focus", sync);
      document.removeEventListener("visibilitychange", handleVisibility);
      if (interval !== null) window.clearInterval(interval);
      handles.forEach((h) => void h.remove?.());
    };
  }, [isLocked, isNative, refreshStatus]);

  // Auto-trigger Android's native permission dialog once right after SplashIntro fades out
  useEffect(() => {
    if (!isLocked || !isNative || autoPromptedRef.current) return;
    autoPromptedRef.current = true;
    const timer = window.setTimeout(() => {
      const current = getNotificationStatus();
      if (current.granted) {
        setStatus(current);
        return;
      }
      void requestAppNotificationPermission().then((outcome) => {
        const refreshed = refreshStatus();
        if (!refreshed.granted && outcome === "denied") {
          setDeniedOnce(true);
        }
      });
    }, 2_550);
    return () => window.clearTimeout(timer);
  }, [isLocked, isNative, refreshStatus]);

  const handleRequestPermission = async () => {
    setRequesting(true);
    setRecheckNotice(null);
    try {
      const result = await requestAppNotificationPermission();
      const refreshed = refreshStatus();
      if (!refreshed.granted) {
        setDeniedOnce(true);
        if (result === "denied") {
          setRecheckNotice(
            isNative
              ? "Android blocked the popup. Tap 'Open Notification Settings' below and switch Allow Notifications ON."
              : "Your browser blocked notifications. Enable notifications in your browser's site settings, then tap Continue.",
          );
        }
      }
    } finally {
      setRequesting(false);
    }
  };

  const handleManualRecheck = () => {
    const refreshed = refreshStatus();
    if (!refreshed.granted) {
      setRecheckNotice(
        isNative
          ? "Notifications are still OFF. Please open Android Notification Settings and turn them ON to enter HutaoTik."
          : "Notifications are still blocked. Please allow notifications in your browser settings first.",
      );
    }
  };

  if (!isLocked) {
    return <>{children}</>;
  }

  return (
    <div
      data-testid="notification-gate"
      className="min-h-[100dvh] w-full flex items-center justify-center bg-background text-foreground px-5 py-10 relative overflow-hidden"
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,hsl(var(--primary)/0.22),transparent_55%)]"
      />
      <div className="relative z-10 w-full max-w-sm rounded-3xl border border-primary/35 bg-card/95 p-6 shadow-[0_24px_60px_-14px_rgba(0,0,0,0.8)] backdrop-blur-xl space-y-5 text-center">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl border border-primary/40 bg-primary/15 text-primary shadow-[0_0_28px_hsl(var(--primary)/0.35)]">
          <BellRing className="h-8 w-8 animate-bounce" />
        </div>

        <div className="space-y-2">
          <div className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/35 bg-amber-500/15 px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-amber-300">
            <Lock className="h-3 w-3" />
            Required to Continue
          </div>
          <h1 className="font-syne text-2xl font-extrabold tracking-tight text-foreground">
            Turn On Notifications
          </h1>
          <p className="text-xs leading-relaxed text-muted-foreground">
            HutaoTik requires notifications to keep fetching &amp; downloading videos even when you exit the app, and to alert you the moment your video is ready.
          </p>
        </div>

        <div className="rounded-2xl border border-border/80 bg-background/70 p-3.5 text-left space-y-2 text-[11px] text-muted-foreground">
          <p className="flex items-start gap-2">
            <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400 mt-0.5" />
            <span>Exit the app freely — video fetching &amp; downloads keep running in the background.</span>
          </p>
          <p className="flex items-start gap-2">
            <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400 mt-0.5" />
            <span>Get live progress bars and an instant alert when your video is ready to download.</span>
          </p>
        </div>

        {recheckNotice && (
          <p
            role="alert"
            className="rounded-xl border border-amber-500/35 bg-amber-500/10 px-3 py-2 text-xs leading-snug text-amber-300"
          >
            {recheckNotice}
          </p>
        )}

        <div className="space-y-2.5 pt-1">
          {(!deniedOnce || !isNative) && (
            <Button
              type="button"
              data-testid="gate-allow-notifications"
              disabled={requesting}
              onClick={() => void handleRequestPermission()}
              className="h-11 w-full rounded-xl font-bold text-sm gap-2 shadow-lg shadow-primary/30"
            >
              {requesting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Waiting for Permission…
                </>
              ) : (
                <>
                  <BellRing className="h-4 w-4" />
                  Allow Notifications
                </>
              )}
            </Button>
          )}

          {isNative && (
            <Button
              type="button"
              data-testid="gate-open-settings"
              variant={deniedOnce ? "default" : "outline"}
              onClick={openDeviceNotificationSettings}
              className="h-11 w-full rounded-xl font-bold text-xs sm:text-sm gap-2"
            >
              <SettingsIcon className="h-4 w-4" />
              Open Android Notification Settings
              <ExternalLink className="h-3.5 w-3.5 opacity-80" />
            </Button>
          )}

          <Button
            type="button"
            variant="ghost"
            onClick={handleManualRecheck}
            className="h-9 w-full rounded-xl text-xs font-semibold text-muted-foreground hover:text-foreground"
          >
            I&apos;ve Enabled Notifications — Continue
          </Button>
        </div>
      </div>
    </div>
  );
}
