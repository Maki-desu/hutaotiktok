import { apiUrl } from "@/lib/api-url";
import { clampPercent, type DownloadProgressState } from "@/lib/download-progress";

export interface NotificationPreferences {
  downloads: boolean;
  updates: boolean;
  announcements: boolean;
}

export interface NativeNotificationStatus extends NotificationPreferences {
  supported: boolean;
  granted: boolean;
  sdkInt: number;
}

interface NativeNotificationBridge {
  getNotificationStatus?(): string;
  configureNotifications?(
    downloads: boolean,
    updates: boolean,
    announcements: boolean,
    apiBaseUrl: string,
  ): void;
  requestNotificationPermission?(): string;
  openNotificationSettings?(): void;
  sendTestNotification?(): boolean;
  checkNotificationsNow?(): void;
  notifyUpdateAvailable?(
    versionCode: number,
    versionName: string,
    title: string,
    changelog: string,
  ): void;
  notifyAnnouncement?(announcementId: number, colorType: string, content: string): void;
  notifyCustomPush?(
    pushId: number,
    title: string,
    body: string,
    accentType: string,
    targetRoute: string,
  ): void;
  getPendingNotificationRoute?(): string;
  startLiveDownloadNotification?(taskId: string, title: string, folderName: string): void;
  updateLiveDownloadNotification?(
    taskId: string,
    percent: number,
    loadedBytes: number,
    totalBytes: number,
    status: string,
  ): void;
  finishLiveDownloadNotification?(
    taskId: string,
    success: boolean,
    filename: string,
    folderName: string,
    errorMessage: string,
  ): void;
}

declare global {
  interface Window {
    onNotificationPermissionResult?: (granted: boolean) => void;
  }
}

const PREFS_STORAGE_KEY = "hutaotik_notif_prefs_v1";
const PROMPTED_STORAGE_KEY = "hutaotik_notif_prompted_v1";
const LAST_CUSTOM_PUSH_STORAGE_KEY = "hutaotik_last_custom_push_id_v1";

const DEFAULT_PREFS: NotificationPreferences = {
  downloads: true,
  updates: true,
  announcements: true,
};

function getBridge(): NativeNotificationBridge | undefined {
  if (typeof window === "undefined") return undefined;
  return (window as Window & { AndroidStorageBridge?: NativeNotificationBridge })
    .AndroidStorageBridge;
}

export function resolveApiOriginBase(): string {
  const raw = apiUrl("/").trim();
  if (/^https?:\/\//i.test(raw)) {
    return raw.replace(/\/+$/, "");
  }
  return "https://hutaotiktok-mja6.onrender.com";
}

export function loadNotificationPreferences(): NotificationPreferences {
  try {
    const raw = localStorage.getItem(PREFS_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_PREFS };
    const parsed = JSON.parse(raw) as Partial<NotificationPreferences>;
    return {
      downloads: parsed.downloads !== false,
      updates: parsed.updates !== false,
      announcements: parsed.announcements !== false,
    };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

export function saveNotificationPreferences(
  next: NotificationPreferences,
): NotificationPreferences {
  const normalized: NotificationPreferences = {
    downloads: Boolean(next.downloads),
    updates: Boolean(next.updates),
    announcements: Boolean(next.announcements),
  };
  try {
    localStorage.setItem(PREFS_STORAGE_KEY, JSON.stringify(normalized));
  } catch {
    /* ignore storage write errors */
  }
  try {
    getBridge()?.configureNotifications?.(
      normalized.downloads,
      normalized.updates,
      normalized.announcements,
      resolveApiOriginBase(),
    );
  } catch {
    /* ignore bridge errors */
  }
  return normalized;
}

export function syncNotificationsToNative(): void {
  const prefs = loadNotificationPreferences();
  try {
    getBridge()?.configureNotifications?.(
      prefs.downloads,
      prefs.updates,
      prefs.announcements,
      resolveApiOriginBase(),
    );
  } catch {
    /* ignore */
  }
}

export function hasNativeNotificationBridge(): boolean {
  return Boolean(getBridge()?.getNotificationStatus);
}

export function shouldRequireNotificationGate(
  status: Pick<NativeNotificationStatus, "supported" | "granted">,
): boolean {
  return status.supported && !status.granted;
}

export function notifyWebFetchComplete(platformLabel: string, videoTitle: string): void {
  if (hasNativeNotificationBridge()) return;
  if (
    typeof window !== "undefined" &&
    "Notification" in window &&
    Notification.permission === "granted" &&
    typeof document !== "undefined" &&
    document.visibilityState !== "visible"
  ) {
    try {
      new Notification(`${platformLabel} Video Ready!`, {
        body: `${videoTitle || "Your video"} is ready to download in HutaoTik.`,
      });
    } catch {
      /* ignore browser notification errors */
    }
  }
}

export function getNotificationStatus(): NativeNotificationStatus {
  const prefs = loadNotificationPreferences();
  const bridge = getBridge();
  if (bridge?.getNotificationStatus) {
    try {
      const parsed = JSON.parse(bridge.getNotificationStatus()) as Partial<{
        granted: boolean;
        downloads: boolean;
        updates: boolean;
        announcements: boolean;
        sdkInt: number;
      }>;
      return {
        supported: true,
        granted: parsed.granted === true,
        downloads: typeof parsed.downloads === "boolean" ? parsed.downloads : prefs.downloads,
        updates: typeof parsed.updates === "boolean" ? parsed.updates : prefs.updates,
        announcements:
          typeof parsed.announcements === "boolean" ? parsed.announcements : prefs.announcements,
        sdkInt: typeof parsed.sdkInt === "number" ? parsed.sdkInt : 0,
      };
    } catch {
      /* fallback */
    }
  }

  const webSupported = typeof window !== "undefined" && "Notification" in window;
  const webGranted = webSupported && Notification.permission === "granted";
  return {
    supported: webSupported,
    granted: webGranted,
    ...prefs,
    sdkInt: 0,
  };
}

export async function requestAppNotificationPermission(): Promise<
  "granted" | "denied" | "unsupported"
> {
  const bridge = getBridge();
  if (bridge?.requestNotificationPermission) {
    try {
      const result = bridge.requestNotificationPermission();
      if (result === "granted") return "granted";
      if (result === "denied") return "denied";
      if (result === "prompted") {
        return await new Promise<"granted" | "denied">((resolve) => {
          const timeout = window.setTimeout(() => {
            const status = getNotificationStatus();
            resolve(status.granted ? "granted" : "denied");
          }, 15_000);
          window.onNotificationPermissionResult = (granted: boolean) => {
            window.clearTimeout(timeout);
            resolve(granted ? "granted" : "denied");
          };
        });
      }
    } catch {
      return "denied";
    }
  }

  if (typeof window !== "undefined" && "Notification" in window) {
    try {
      const perm = await Notification.requestPermission();
      return perm === "granted" ? "granted" : "denied";
    } catch {
      return "denied";
    }
  }

  return "unsupported";
}

export function promptNotificationPermissionOnce(): void {
  const bridge = getBridge();
  if (!bridge?.requestNotificationPermission) return;
  try {
    if (localStorage.getItem(PROMPTED_STORAGE_KEY) === "1") return;
    const status = getNotificationStatus();
    if (status.granted) {
      localStorage.setItem(PROMPTED_STORAGE_KEY, "1");
      return;
    }
    localStorage.setItem(PROMPTED_STORAGE_KEY, "1");
    bridge.requestNotificationPermission();
  } catch {
    /* ignore */
  }
}

export function openDeviceNotificationSettings(): void {
  try {
    getBridge()?.openNotificationSettings?.();
  } catch {
    /* ignore */
  }
}

export function sendTestNotification(): boolean {
  const bridge = getBridge();
  if (bridge?.sendTestNotification) {
    try {
      return Boolean(bridge.sendTestNotification());
    } catch {
      return false;
    }
  }

  if (typeof window !== "undefined" && "Notification" in window && Notification.permission === "granted") {
    try {
      new Notification("HutaoTik Notifications Ready!", {
        body: "You'll get download alerts, update notices, and announcements here.",
      });
      return true;
    } catch {
      return false;
    }
  }
  return false;
}

export function triggerUpdateNotification(release: {
  versionCode: number;
  versionName: string;
  title?: string;
  changelog?: string;
}): void {
  const prefs = loadNotificationPreferences();
  if (!prefs.updates) return;
  try {
    getBridge()?.notifyUpdateAvailable?.(
      release.versionCode,
      release.versionName,
      release.title ?? "",
      release.changelog ?? "",
    );
  } catch {
    /* ignore */
  }
}

export function consumePendingNotificationRoute(): string | null {
  try {
    const raw = getBridge()?.getPendingNotificationRoute?.()?.trim() ?? "";
    return raw ? raw : null;
  } catch {
    return null;
  }
}

export interface CustomPushPayload {
  id: number;
  title: string;
  body: string;
  accentType: string;
  targetRoute: string;
  createdAt: string;
}

export async function checkCustomPushNotifications(): Promise<CustomPushPayload | null> {
  const prefs = loadNotificationPreferences();
  if (!prefs.announcements) return null;

  // Never mark a push as seen before the device has actually granted notification permission.
  const status = getNotificationStatus();
  if (status.supported && !status.granted) return null;

  try {
    const response = await fetch(apiUrl("/api/push-notifications/latest"), { cache: "no-store" });
    if (!response.ok) return null;
    const data = (await response.json()) as { notification?: CustomPushPayload | null };
    const notif = data?.notification;
    if (!notif || typeof notif.id !== "number" || notif.id < 1 || !notif.body) return null;

    let lastSeenId = -1;
    try {
      const stored = localStorage.getItem(LAST_CUSTOM_PUSH_STORAGE_KEY);
      if (stored !== null) {
        const parsed = Number.parseInt(stored, 10);
        if (Number.isSafeInteger(parsed)) lastSeenId = parsed;
      }
    } catch {
      /* ignore */
    }

    if (notif.id <= lastSeenId) return null;

    if (lastSeenId === -1 && notif.createdAt) {
      const ageMs = Date.now() - new Date(notif.createdAt).getTime();
      if (Number.isFinite(ageMs) && ageMs > 6 * 60 * 60 * 1000) {
        try {
          localStorage.setItem(LAST_CUSTOM_PUSH_STORAGE_KEY, String(notif.id));
        } catch {
          /* ignore */
        }
        return null;
      }
    }

    try {
      localStorage.setItem(LAST_CUSTOM_PUSH_STORAGE_KEY, String(notif.id));
    } catch {
      /* ignore */
    }

    const bridge = getBridge();
    if (bridge?.notifyCustomPush) {
      try {
        bridge.notifyCustomPush(
          notif.id,
          notif.title || "HutaoTik Alert",
          notif.body,
          notif.accentType || "info",
          notif.targetRoute || "/",
        );
      } catch {
        /* ignore bridge errors */
      }
      return notif;
    }

    if (typeof window !== "undefined" && "Notification" in window && Notification.permission === "granted") {
      try {
        new Notification(notif.title || "HutaoTik Alert", { body: notif.body });
      } catch {
        /* ignore */
      }
    }
    return notif;
  } catch {
    return null;
  }
}

export function startLiveDownloadNotif(
  taskId: string,
  title: string,
  folderName: string,
): void {
  if (!loadNotificationPreferences().downloads) return;
  try {
    getBridge()?.startLiveDownloadNotification?.(taskId, title, folderName);
  } catch {
    /* ignore */
  }
}

export function updateLiveDownloadNotif(
  taskId: string,
  progress: DownloadProgressState,
): void {
  if (!loadNotificationPreferences().downloads) return;
  try {
    getBridge()?.updateLiveDownloadNotification?.(
      taskId,
      clampPercent(progress.percent),
      progress.loadedBytes ?? 0,
      progress.totalBytes ?? 0,
      progress.status ?? "Downloading…",
    );
  } catch {
    /* ignore */
  }
}

export function finishLiveDownloadNotif(
  taskId: string,
  success: boolean,
  filename: string,
  folderName: string,
  errorMessage = "",
): void {
  try {
    getBridge()?.finishLiveDownloadNotification?.(
      taskId,
      success,
      filename,
      folderName,
      errorMessage,
    );
  } catch {
    /* ignore */
  }
}
