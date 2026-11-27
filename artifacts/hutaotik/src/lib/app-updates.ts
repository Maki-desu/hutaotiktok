import { Capacitor } from "@capacitor/core";
import { apiUrl } from "@/lib/api-url";
import { clampPercent, type DownloadProgressState } from "@/lib/download-progress";

export interface AvailableRelease {
  id: number;
  versionCode: number;
  versionName: string;
  title: string;
  changelog: string;
  downloadUrl: string;
  fileSize: number | null;
  sha256: string | null;
  isMandatory: boolean;
  minSupportedVersionCode: number | null;
  downloadCount: number;
  createdAt: string;
}

export interface AppUpdateProgressEvent {
  status: "downloading" | "verifying" | "installing" | "completed" | "failed" | "permission_required";
  percent: number;
  loadedBytes?: number;
  totalBytes?: number;
  message?: string;
}

interface NativeUpdateBridge {
  installAppUpdate?(url: string, sha256: string): string;
  getDeviceInfo?(): string;
}

declare global {
  interface Window {
    onAppUpdateProgress?: (payload: string) => void;
  }
}

const INSTALL_ID_KEY = "hutaotik_install_id";
const LAST_CHECKIN_KEY = "hutaotik_last_checkin";
const CHECKIN_INTERVAL_MS = 6 * 60 * 60 * 1000;

const progressListeners = new Set<(event: AppUpdateProgressEvent) => void>();

export function getInstalledAppVersion(): { versionCode: number; versionName: string } {
  const parsedCode = Number.parseInt(import.meta.env.VITE_APP_VERSION_CODE ?? "36", 10);
  const versionCode = Number.isSafeInteger(parsedCode) && parsedCode > 0 ? parsedCode : 36;
  const versionName = (import.meta.env.VITE_APP_VERSION_NAME ?? "1.2.20").trim() || "1.2.20";
  return { versionCode, versionName };
}

export function isUpdateNewer(releaseVersionCode: number, installedVersionCode: number): boolean {
  return (
    Number.isSafeInteger(releaseVersionCode) &&
    Number.isSafeInteger(installedVersionCode) &&
    releaseVersionCode > installedVersionCode
  );
}

export function isAvailableRelease(value: unknown): value is AvailableRelease {
  if (typeof value !== "object" || value === null) return false;
  const release = value as Record<string, unknown>;
  return (
    typeof release.versionCode === "number" &&
    Number.isSafeInteger(release.versionCode) &&
    typeof release.versionName === "string" &&
    typeof release.changelog === "string" &&
    typeof release.downloadUrl === "string" &&
    (release.sha256 === null ||
      release.sha256 === undefined ||
      (typeof release.sha256 === "string" && /^[0-9a-f]{64}$/i.test(release.sha256)))
  );
}

export function normalizeAvailableRelease(raw: Record<string, unknown>): AvailableRelease {
  return {
    id: typeof raw.id === "number" && Number.isSafeInteger(raw.id) ? raw.id : 0,
    versionCode: Number(raw.versionCode),
    versionName: String(raw.versionName),
    title: typeof raw.title === "string" ? raw.title : "",
    changelog: String(raw.changelog),
    downloadUrl: String(raw.downloadUrl),
    fileSize: typeof raw.fileSize === "number" ? raw.fileSize : null,
    sha256: typeof raw.sha256 === "string" ? raw.sha256 : null,
    isMandatory: raw.isMandatory === true,
    minSupportedVersionCode:
      typeof raw.minSupportedVersionCode === "number" ? raw.minSupportedVersionCode : null,
    downloadCount: typeof raw.downloadCount === "number" ? raw.downloadCount : 0,
    createdAt: typeof raw.createdAt === "string" ? raw.createdAt : new Date().toISOString(),
  };
}

export function resolveReleaseDownloadUrl(downloadUrl: string, baseOverride?: string): URL {
  const serviceBase = baseOverride ?? apiUrl("/");
  const originBase =
    serviceBase && /^https?:\/\//i.test(serviceBase)
      ? serviceBase
      : typeof window !== "undefined"
        ? window.location.origin + "/"
        : "https://hutaotiktok-mja6.onrender.com/";
  return new URL(downloadUrl, originBase);
}

export function isDirectApkInstallUrl(downloadUrl: string, baseOverride?: string): boolean {
  try {
    const releaseUrl = resolveReleaseDownloadUrl(downloadUrl, baseOverride);
    if (releaseUrl.protocol !== "https:" || releaseUrl.username || releaseUrl.password) {
      return false;
    }
    const serviceBase = baseOverride ?? apiUrl("/");
    const hasHttpsServiceBase = /^https:\/\//i.test(serviceBase);
    const isServiceDownload =
      hasHttpsServiceBase &&
      releaseUrl.origin === new URL(serviceBase).origin &&
      /^\/api\/app-updates\/\d+\/download$/.test(releaseUrl.pathname);
    const isDirectApk = releaseUrl.pathname.toLowerCase().endsWith(".apk");
    return isServiceDownload || isDirectApk;
  } catch {
    return false;
  }
}

export function getOrCreateInstallId(): string {
  try {
    const existing = localStorage.getItem(INSTALL_ID_KEY);
    if (existing && /^[A-Za-z0-9_-]{8,80}$/.test(existing)) {
      return existing;
    }
    const bytes = new Uint8Array(12);
    if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
      crypto.getRandomValues(bytes);
    } else {
      for (let i = 0; i < bytes.length; i += 1) {
        bytes[i] = Math.floor(Math.random() * 256);
      }
    }
    const generated =
      "ht_" +
      Array.from(bytes)
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
    localStorage.setItem(INSTALL_ID_KEY, generated);
    return generated;
  } catch {
    return `ht_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  }
}

function getNativeUpdateBridge(): NativeUpdateBridge | undefined {
  if (typeof window === "undefined") return undefined;
  return (window as Window & { AndroidStorageBridge?: NativeUpdateBridge }).AndroidStorageBridge;
}

export async function sendDeviceCheckIn(): Promise<void> {
  if (import.meta.env.VITE_APP_MODE === "admin") return;
  const { versionCode, versionName } = getInstalledAppVersion();
  const cacheStamp = `${versionCode}:${versionName}`;
  try {
    const rawLast = localStorage.getItem(LAST_CHECKIN_KEY);
    if (rawLast) {
      const parsed = JSON.parse(rawLast) as { stamp?: string; at?: number };
      if (parsed.stamp === cacheStamp && typeof parsed.at === "number" && Date.now() - parsed.at < CHECKIN_INTERVAL_MS) {
        return;
      }
    }
  } catch {
    /* proceed with check-in */
  }

  let deviceModel: string | null = null;
  let androidVersion: string | null = null;
  try {
    const rawInfo = getNativeUpdateBridge()?.getDeviceInfo?.();
    if (rawInfo) {
      const parsed = JSON.parse(rawInfo) as { model?: string; androidVersion?: string };
      deviceModel = typeof parsed.model === "string" ? parsed.model : null;
      androidVersion = typeof parsed.androidVersion === "string" ? parsed.androidVersion : null;
    }
  } catch {
    /* optional metadata */
  }

  const installId = getOrCreateInstallId();
  const platform = Capacitor.isNativePlatform() ? Capacitor.getPlatform() : "web";

  const response = await fetch(apiUrl("/api/app-updates/check-in"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      installId,
      versionCode,
      versionName,
      platform,
      deviceModel,
      androidVersion,
    }),
  });
  if (response.ok) {
    try {
      localStorage.setItem(LAST_CHECKIN_KEY, JSON.stringify({ stamp: cacheStamp, at: Date.now() }));
    } catch {
      /* ignore storage errors */
    }
  }
}

export async function fetchLatestRelease(): Promise<AvailableRelease | null> {
  const { versionCode } = getInstalledAppVersion();
  const response = await fetch(
    apiUrl(`/api/app-updates/latest?currentVersionCode=${encodeURIComponent(String(versionCode))}`),
    { cache: "no-store" },
  );
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(`Update check failed with HTTP ${response.status}.`);
  }
  const payload: unknown = await response.json();
  if (!isAvailableRelease(payload)) {
    throw new Error("The update service returned invalid release metadata.");
  }
  const normalized = normalizeAvailableRelease(payload as unknown as Record<string, unknown>);
  const releaseUrl = resolveReleaseDownloadUrl(normalized.downloadUrl);
  if (releaseUrl.protocol !== "https:" || releaseUrl.username || releaseUrl.password) {
    throw new Error("The update service returned an unsafe APK download URL.");
  }
  return normalized;
}

export async function fetchReleaseHistory(): Promise<AvailableRelease[]> {
  const response = await fetch(apiUrl("/api/app-updates/history"), { cache: "no-store" });
  if (response.status === 404) return [];
  if (!response.ok) {
    throw new Error(`Could not load release history (HTTP ${response.status}).`);
  }
  const payload = (await response.json()) as { releases?: unknown[] };
  if (!Array.isArray(payload.releases)) return [];
  return payload.releases
    .filter(isAvailableRelease)
    .map((item) => normalizeAvailableRelease(item as unknown as Record<string, unknown>));
}

export function trackReleaseDownload(releaseId: number): void {
  if (!Number.isSafeInteger(releaseId) || releaseId < 1) return;
  void fetch(apiUrl(`/api/app-updates/${releaseId}/track-download`), {
    method: "POST",
    keepalive: true,
  }).catch(() => {});
}

export function registerAppUpdateProgressListener(
  listener: (event: AppUpdateProgressEvent) => void,
): () => void {
  if (typeof window === "undefined") return () => {};
  window.onAppUpdateProgress ??= (rawPayload: string) => {
    try {
      const parsed = JSON.parse(rawPayload) as Partial<AppUpdateProgressEvent>;
      const validStatuses = new Set([
        "downloading",
        "verifying",
        "installing",
        "completed",
        "failed",
        "permission_required",
      ]);
      const status =
        typeof parsed.status === "string" && validStatuses.has(parsed.status)
          ? (parsed.status as AppUpdateProgressEvent["status"])
          : "downloading";
      const event: AppUpdateProgressEvent = {
        status,
        percent: clampPercent(typeof parsed.percent === "number" ? parsed.percent : 0),
        loadedBytes:
          typeof parsed.loadedBytes === "number" && parsed.loadedBytes > 0
            ? parsed.loadedBytes
            : undefined,
        totalBytes:
          typeof parsed.totalBytes === "number" && parsed.totalBytes > 0
            ? parsed.totalBytes
            : undefined,
        message: typeof parsed.message === "string" && parsed.message.trim() ? parsed.message.trim() : undefined,
      };
      progressListeners.forEach((cb) => cb(event));
    } catch {
      /* ignore malformed progress payload */
    }
  };

  progressListeners.add(listener);
  return () => {
    progressListeners.delete(listener);
  };
}

export function toDownloadProgressState(event: AppUpdateProgressEvent): DownloadProgressState {
  const statusText =
    event.message ||
    (event.status === "verifying"
      ? "Verifying APK integrity…"
      : event.status === "installing"
        ? "Opening Android installer…"
        : event.status === "completed"
          ? "Ready to install"
          : "Downloading update APK…");
  return {
    percent: event.percent,
    loadedBytes: event.loadedBytes,
    totalBytes: event.totalBytes,
    status: statusText,
  };
}

export function startAppUpdateInstall(
  release: AvailableRelease,
): "started" | "opened_browser" | "permission_required" | "failed" {
  const downloadUrl = resolveReleaseDownloadUrl(release.downloadUrl).toString();
  trackReleaseDownload(release.id);

  const nativeInstall = getNativeUpdateBridge()?.installAppUpdate;
  if (Capacitor.isNativePlatform() && nativeInstall && isDirectApkInstallUrl(downloadUrl)) {
    const result = nativeInstall(downloadUrl, release.sha256 ?? "");
    if (result === "started" || result === "permission_required") {
      return result;
    }
    return "failed";
  }

  window.open(downloadUrl, "_blank", "noopener,noreferrer");
  return "opened_browser";
}
