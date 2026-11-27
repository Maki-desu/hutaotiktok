import { useCallback, useEffect, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { PushNotifications } from "@capacitor/push-notifications";
import { ArrowUpCircle, ExternalLink, Loader2, ShieldAlert } from "lucide-react";
import { apiUrl } from "@/lib/api-url";
import {
  fetchLatestRelease,
  getInstalledAppVersion,
  isDirectApkInstallUrl,
  isUpdateNewer,
  openReleaseDownloadInBrowser,
  registerAppUpdateProgressListener,
  sendDeviceCheckIn,
  startAppUpdateInstall,
  toDownloadProgressState,
  type AppUpdateProgressEvent,
  type AvailableRelease,
} from "@/lib/app-updates";
import {
  consumePendingNotificationRoute,
  promptNotificationPermissionOnce,
  syncNotificationsToNative,
  triggerUpdateNotification,
} from "@/lib/notifications";
import { DownloadProgressCard } from "@/components/download-progress-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export function AppUpdateChecker() {
  const [release, setRelease] = useState<AvailableRelease | null>(null);
  const [installError, setInstallError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [progressEvent, setProgressEvent] = useState<AppUpdateProgressEvent | null>(null);

  const checkForUpdate = useCallback(async () => {
    try {
      const { versionCode } = getInstalledAppVersion();
      const latest = await fetchLatestRelease();
      if (!latest || !isUpdateNewer(latest.versionCode, versionCode)) {
        return;
      }
      setRelease(latest);
      if (document.visibilityState !== "visible") {
        triggerUpdateNotification(latest);
      }
    } catch (error) {
      console.error("Could not check for Hutaotik updates.", error);
    }
  }, []);

  useEffect(() => {
    syncNotificationsToNative();
    const pendingRoute = consumePendingNotificationRoute();
    if (pendingRoute) {
      window.location.hash = `#${pendingRoute.startsWith("/") ? pendingRoute : `/${pendingRoute}`}`;
    }

    const promptTimer = window.setTimeout(() => {
      promptNotificationPermissionOnce();
    }, 2700);

    void sendDeviceCheckIn().catch(() => {});
    void checkForUpdate();

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") void checkForUpdate();
    };
    const onManualCheck = () => void checkForUpdate();

    window.addEventListener("focus", onManualCheck);
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("hutaotik:check-update", onManualCheck);

    return () => {
      window.clearTimeout(promptTimer);
      window.removeEventListener("focus", onManualCheck);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("hutaotik:check-update", onManualCheck);
    };
  }, [checkForUpdate]);

  useEffect(() => {
    return registerAppUpdateProgressListener((event) => {
      setProgressEvent(event);
      if (event.status === "failed") {
        setDownloading(false);
        setInstallError(
          event.message || "Update download failed. You can retry or open the link in your browser.",
        );
      } else if (event.status === "permission_required") {
        setDownloading(false);
        setInstallError(
          "Allow HutaoTik to install unknown apps in Android settings, then tap Update again.",
        );
      } else if (event.status === "installing" || event.status === "completed") {
        setDownloading(false);
      }
    });
  }, []);

  useEffect(() => {
    if (
      import.meta.env.VITE_FIREBASE_PUSH_ENABLED !== "true" ||
      import.meta.env.VITE_APP_MODE === "admin" ||
      !Capacitor.isNativePlatform()
    ) {
      return;
    }

    let active = true;
    let registrationListener: { remove: () => Promise<void> } | undefined;
    let errorListener: { remove: () => Promise<void> } | undefined;
    let actionListener: { remove: () => Promise<void> } | undefined;

    const registerForPush = async () => {
      await PushNotifications.createChannel({
        id: "hutaotik_updates",
        name: "App Updates",
        description: "App release notifications",
        importance: 5,
      });
      await PushNotifications.createChannel({
        id: "hutaotik_announcements",
        name: "Announcements",
        description: "Important HutaoTik lobby announcements",
        importance: 5,
      });

      registrationListener = await PushNotifications.addListener("registration", ({ value }) => {
        void fetch(apiUrl("/api/app-updates/register-device"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token: value }),
        })
          .then((response) => {
            if (!response.ok) throw new Error(`Device registration failed with HTTP ${response.status}.`);
          })
          .catch((error: unknown) => {
            console.error("Could not register this device for update alerts.", error);
          });
      });
      errorListener = await PushNotifications.addListener("registrationError", (error) => {
        console.error("Could not register for Hutaotik update alerts.", error);
      });
      actionListener = await PushNotifications.addListener("pushNotificationActionPerformed", () => {
        window.dispatchEvent(new Event("hutaotik:check-update"));
      });

      const permission = await PushNotifications.checkPermissions();
      if (permission.receive !== "granted") {
        const requested = await PushNotifications.requestPermissions();
        if (requested.receive !== "granted") return;
      }
      if (active) await PushNotifications.register();
    };

    void registerForPush().catch((error: unknown) => {
      console.error("Could not initialize Hutaotik push notifications.", error);
    });

    return () => {
      active = false;
      void registrationListener?.remove();
      void errorListener?.remove();
      void actionListener?.remove();
    };
  }, []);

  const startInstall = () => {
    if (!release) return;
    setInstallError(null);
    try {
      const outcome = startAppUpdateInstall(release);
      if (outcome === "started") {
        setDownloading(true);
        setProgressEvent({ status: "downloading", percent: 2, message: "Starting APK download…" });
        return;
      }
      if (outcome === "permission_required") {
        setInstallError("Allow HutaoTik to install unknown apps in Android settings, then tap Update again.");
        return;
      }
      if (outcome === "failed") {
        setInstallError("The APK download could not be started. Try opening the link in your browser.");
      }
    } catch (cause) {
      setInstallError(
        cause instanceof Error
          ? cause.message
          : "The APK download could not be started. Try opening the link in your browser.",
      );
    }
  };

  const openInBrowser = () => {
    if (!release) return;
    openReleaseDownloadInBrowser(release.downloadUrl);
  };

  const isMandatory = release?.isMandatory === true;
  const isDirectApk = release ? isDirectApkInstallUrl(release.downloadUrl) : false;

  return (
    <Dialog
      open={release !== null}
      onOpenChange={(open) => {
        if (!open && !isMandatory && !downloading) {
          setRelease(null);
          setInstallError(null);
          setProgressEvent(null);
        }
      }}
    >
      <DialogContent
        className="max-w-md rounded-2xl border-border bg-card"
        onInteractOutside={(event) => {
          if (isMandatory || downloading) event.preventDefault();
        }}
        onEscapeKeyDown={(event) => {
          if (isMandatory || downloading) event.preventDefault();
        }}
      >
        <DialogHeader className="space-y-2 text-left">
          <div className="flex items-center gap-2">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/15 text-primary">
              {isMandatory ? <ShieldAlert className="h-5 w-5" /> : <ArrowUpCircle className="h-5 w-5" />}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-1.5">
                <DialogTitle className="text-base font-bold">
                  HutaoTik {release?.versionName} is available
                </DialogTitle>
                {isMandatory && (
                  <Badge variant="destructive" className="text-[10px]">
                    Required
                  </Badge>
                )}
              </div>
              {release?.title && (
                <p className="text-xs font-semibold text-primary mt-0.5">{release.title}</p>
              )}
            </div>
          </div>
          <DialogDescription className="whitespace-pre-wrap pt-1 text-xs leading-relaxed text-muted-foreground">
            {release?.changelog || "Install the latest version to get the newest improvements."}
          </DialogDescription>
        </DialogHeader>

        {downloading && progressEvent && (
          <DownloadProgressCard
            title={`Downloading HutaoTik v${release?.versionName}…`}
            progress={toDownloadProgressState(progressEvent)}
            className=""
          />
        )}

        {installError && (
          <div className="space-y-2 rounded-xl border border-destructive/30 bg-destructive/10 p-3">
            <p role="alert" className="text-xs text-destructive">
              {installError}
            </p>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={openInBrowser}
              className="h-8 w-full gap-1.5 text-xs"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              Open download link in browser
            </Button>
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-2">
          {!isMandatory && (
            <Button
              type="button"
              variant="outline"
              disabled={downloading}
              onClick={() => {
                setRelease(null);
                setInstallError(null);
                setProgressEvent(null);
              }}
            >
              Later
            </Button>
          )}
          <Button
            type="button"
            disabled={downloading}
            onClick={startInstall}
            className="gap-2 font-bold"
          >
            {downloading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Downloading… {progressEvent?.percent ?? 0}%
              </>
            ) : isDirectApk ? (
              "Download and update"
            ) : (
              "Open update link"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
