import { useEffect, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { PushNotifications } from "@capacitor/push-notifications";
import { apiUrl } from "@/lib/api-url";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type AvailableRelease = {
  versionCode: number;
  versionName: string;
  changelog: string;
  downloadUrl: string;
  sha256: string | null;
};

function isAvailableRelease(value: unknown): value is AvailableRelease {
  if (typeof value !== "object" || value === null) return false;
  const release = value as Record<string, unknown>;
  return (
    typeof release.versionCode === "number" &&
    Number.isSafeInteger(release.versionCode) &&
    typeof release.versionName === "string" &&
    typeof release.changelog === "string" &&
    typeof release.downloadUrl === "string" &&
    (release.sha256 === null ||
      (typeof release.sha256 === "string" && /^[0-9a-f]{64}$/i.test(release.sha256)))
  );
}

const currentVersionCode = Number.parseInt(import.meta.env.VITE_APP_VERSION_CODE ?? "16", 10);

export function AppUpdateChecker() {
  const [release, setRelease] = useState<AvailableRelease | null>(null);
  const [installError, setInstallError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    const checkForUpdate = async () => {
      try {
        const response = await fetch(apiUrl("/api/app-updates/latest"), { cache: "no-store" });
        if (response.status === 404) return;
        if (!response.ok) throw new Error(`Update check failed with HTTP ${response.status}.`);
        const payload: unknown = await response.json();
        if (!isAvailableRelease(payload)) {
          throw new Error("The update service returned invalid release metadata.");
        }
        const latest = payload;
        const serviceUrl = new URL(apiUrl("/"));
        const releaseUrl = new URL(latest.downloadUrl, serviceUrl);
        if (releaseUrl.protocol !== "https:" || releaseUrl.username || releaseUrl.password) {
          throw new Error("The update service returned an unsafe APK download URL.");
        }
        if (!active || latest.versionCode <= currentVersionCode) return;
        setRelease(latest);
      } catch (error) {
        console.error("Could not check for Hutaotik updates.", error);
      }
    };

    void checkForUpdate();
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") void checkForUpdate();
    };
    const onPushOpen = () => void checkForUpdate();
    window.addEventListener("focus", checkForUpdate);
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("hutaotik:check-update", onPushOpen);

    return () => {
      active = false;
      window.removeEventListener("focus", checkForUpdate);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("hutaotik:check-update", onPushOpen);
    };
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
        name: "Hutaotik updates",
        description: "App release notifications",
        importance: 5,
      });

      registrationListener = await PushNotifications.addListener("registration", ({ value }) => {
        void fetch(apiUrl("/api/app-updates/register-device"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token: value }),
        }).then((response) => {
          if (!response.ok) throw new Error(`Device registration failed with HTTP ${response.status}.`);
        }).catch((error: unknown) => {
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
    const downloadUrl = new URL(release.downloadUrl, apiUrl("/")).toString();
    const nativeInstall = window.AndroidStorageBridge?.installAppUpdate;
    const releaseUrl = new URL(downloadUrl);
    const isServiceDownload =
      releaseUrl.origin === new URL(apiUrl("/")).origin &&
      /^\/api\/app-updates\/\d+\/download$/.test(releaseUrl.pathname);
    const isDirectApk = releaseUrl.pathname.toLowerCase().endsWith(".apk");

    if (Capacitor.isNativePlatform() && nativeInstall && (isServiceDownload || isDirectApk)) {
      const result = nativeInstall(downloadUrl, release.sha256 ?? "");
      if (result === "permission_required") {
        setInstallError("Allow Hutaotik to install unknown apps in Android settings, then tap Update again.");
      } else if (result !== "started") {
        setInstallError("The APK download could not be started. Check your connection and try again.");
      }
      return;
    }

    window.open(downloadUrl, "_blank", "noopener,noreferrer");
  };

  const releaseUrl = release ? new URL(release.downloadUrl, apiUrl("/")) : null;
  const serviceUrl = releaseUrl ? new URL(apiUrl("/")) : null;
  const isServiceDownload =
    releaseUrl !== null &&
    serviceUrl !== null &&
    releaseUrl.origin === serviceUrl.origin &&
    /^\/api\/app-updates\/\d+\/download$/.test(releaseUrl.pathname);
  const isDirectApk = releaseUrl?.pathname.toLowerCase().endsWith(".apk") ?? false;

  return (
    <Dialog open={release !== null} onOpenChange={(open) => {
      if (!open) {
        setRelease(null);
        setInstallError(null);
      }
    }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Hutaotik {release?.versionName} is available</DialogTitle>
          <DialogDescription>
            {release?.changelog || "Install the latest version to get the newest improvements."}
          </DialogDescription>
        </DialogHeader>
        {installError && <p role="alert" className="text-sm text-destructive">{installError}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={() => setRelease(null)}>Later</Button>
          <Button onClick={startInstall}>
            {isServiceDownload || isDirectApk
              ? "Download and update"
              : "Open update link"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
