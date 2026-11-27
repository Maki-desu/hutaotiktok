export interface PickedNativeApk {
  pickId: string;
  name: string;
  size: number;
}

export interface NativeUploadProgress {
  percent: number;
  loadedBytes?: number;
  totalBytes?: number;
  etaSeconds?: number;
  stage?: string;
}

export interface NativeUploadResult {
  status: number;
  data: Record<string, unknown>;
  error?: string;
}

interface AndroidAdminBridge {
  pickApkFile?(): void;
  uploadApkReleaseInBackground?(
    endpointUrl: string,
    headersJson: string,
    fieldsJson: string,
    pickId: string,
    requestId: string,
  ): void;
  cancelApkUpload?(requestId: string): void;
  discardPickedApk?(pickId: string): void;
  consumePendingUploadResult?(): string;
  openExternalUrl?(url: string): boolean;
  hasNotificationPermission?(): boolean;
  requestNotificationPermission?(): string;
  openNotificationSettings?(): void;
}

declare global {
  interface Window {
    onAdminApkPicked?: (rawPayload: string) => void;
    onAdminUploadProgress?: (requestId: string, rawPayload: string) => void;
    onAdminUploadResult?: (requestId: string, rawPayload: string) => void;
    onAdminNotificationPermission?: (granted: boolean) => void;
  }
}

const ADMIN_NOTIF_PROMPTED_KEY = "hutaotik_admin_notif_prompted_v1";

const progressListeners = new Map<string, (info: NativeUploadProgress) => void>();
const resultResolvers = new Map<string, (result: NativeUploadResult) => void>();

function getAdminBridge(): AndroidAdminBridge | undefined {
  if (typeof window === "undefined") return undefined;
  return (window as Window & { AndroidAdminBridge?: AndroidAdminBridge }).AndroidAdminBridge;
}

function parseBodyRecord(rawBody: string): Record<string, unknown> {
  if (!rawBody) return {};
  try {
    const parsed: unknown = JSON.parse(rawBody);
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    /* ignore non-JSON body */
  }
  return {};
}

export function isNativeAdminUploadAvailable(): boolean {
  const bridge = getAdminBridge();
  return Boolean(bridge?.pickApkFile && bridge?.uploadApkReleaseInBackground);
}

export function pickApkFileNative(): Promise<PickedNativeApk | null> {
  const bridge = getAdminBridge();
  if (!bridge?.pickApkFile) {
    return Promise.reject(new Error("Native Android APK picker is unavailable."));
  }
  return new Promise((resolve, reject) => {
    window.onAdminApkPicked = (rawPayload: string) => {
      try {
        const parsed = JSON.parse(rawPayload) as {
          pickId?: string;
          name?: string;
          size?: number;
          cancelled?: boolean;
          error?: string;
        };
        if (parsed.error) {
          reject(new Error(parsed.error));
          return;
        }
        if (parsed.cancelled || !parsed.pickId) {
          resolve(null);
          return;
        }
        resolve({
          pickId: parsed.pickId,
          name: parsed.name || "hutaotik.apk",
          size: typeof parsed.size === "number" && parsed.size > 0 ? parsed.size : 0,
        });
      } catch {
        reject(new Error("Could not read selected APK information."));
      }
    };
    bridge.pickApkFile!();
  });
}

export function uploadApkReleaseNative(params: {
  endpointUrl: string;
  headers: Record<string, string>;
  fields: Record<string, string>;
  pickId: string;
  onProgress: (info: NativeUploadProgress) => void;
}): { requestId: string; promise: Promise<NativeUploadResult> } {
  const bridge = getAdminBridge();
  if (!bridge?.uploadApkReleaseInBackground) {
    return {
      requestId: "",
      promise: Promise.reject(new Error("Native background uploader is unavailable.")),
    };
  }

  window.onAdminUploadProgress ??= (requestId: string, rawPayload: string) => {
    const cb = progressListeners.get(requestId);
    if (!cb) return;
    try {
      const parsed = JSON.parse(rawPayload) as Partial<NativeUploadProgress>;
      cb({
        percent: typeof parsed.percent === "number" ? parsed.percent : 0,
        loadedBytes: typeof parsed.loadedBytes === "number" ? parsed.loadedBytes : undefined,
        totalBytes: typeof parsed.totalBytes === "number" ? parsed.totalBytes : undefined,
        etaSeconds: typeof parsed.etaSeconds === "number" ? parsed.etaSeconds : undefined,
        stage: typeof parsed.stage === "string" ? parsed.stage : undefined,
      });
    } catch {
      /* ignore malformed progress payload */
    }
  };

  window.onAdminUploadResult ??= (requestId: string, rawPayload: string) => {
    const resolver = resultResolvers.get(requestId);
    if (!resolver) return;
    resultResolvers.delete(requestId);
    progressListeners.delete(requestId);
    try {
      const parsed = JSON.parse(rawPayload) as {
        status?: number;
        body?: string;
        error?: string;
      };
      resolver({
        status: typeof parsed.status === "number" ? parsed.status : 0,
        data: parseBodyRecord(typeof parsed.body === "string" ? parsed.body : ""),
        error: typeof parsed.error === "string" && parsed.error ? parsed.error : undefined,
      });
    } catch {
      resolver({
        status: 0,
        data: {},
        error: "Could not parse upload response.",
      });
    }
  };

  const requestId = `admin-up-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  progressListeners.set(requestId, params.onProgress);

  const promise = new Promise<NativeUploadResult>((resolve) => {
    resultResolvers.set(requestId, resolve);
    bridge.uploadApkReleaseInBackground!(
      params.endpointUrl,
      JSON.stringify(params.headers),
      JSON.stringify(params.fields),
      params.pickId,
      requestId,
    );
  });

  return { requestId, promise };
}

export function cancelNativeApkUpload(requestId: string): void {
  if (!requestId) return;
  try {
    getAdminBridge()?.cancelApkUpload?.(requestId);
  } catch {
    /* ignore */
  }
}

export function discardNativePickedApk(pickId: string | null | undefined): void {
  if (!pickId) return;
  try {
    getAdminBridge()?.discardPickedApk?.(pickId);
  } catch {
    /* ignore */
  }
}

export function consumePendingAdminUploadResult(): NativeUploadResult | null {
  try {
    const raw = getAdminBridge()?.consumePendingUploadResult?.();
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { status?: number; body?: string; error?: string };
    return {
      status: typeof parsed.status === "number" ? parsed.status : 0,
      data: parseBodyRecord(typeof parsed.body === "string" ? parsed.body : ""),
      error: typeof parsed.error === "string" && parsed.error ? parsed.error : undefined,
    };
  } catch {
    return null;
  }
}

export function openAdminExternalUrl(url: string): void {
  const bridge = getAdminBridge();
  if (bridge?.openExternalUrl) {
    try {
      if (bridge.openExternalUrl(url)) return;
    } catch {
      /* fallback */
    }
  }
  const win = window.open(url, "_blank", "noopener,noreferrer");
  if (!win) {
    window.location.href = url;
  }
}

export function hasAdminNotificationPermission(): boolean {
  const bridge = getAdminBridge();
  if (bridge?.hasNotificationPermission) {
    try {
      return Boolean(bridge.hasNotificationPermission());
    } catch {
      return true;
    }
  }
  return true;
}

export function requestAdminNotificationPermission(): Promise<boolean> {
  const bridge = getAdminBridge();
  if (!bridge?.requestNotificationPermission) {
    return Promise.resolve(true);
  }
  const result = bridge.requestNotificationPermission();
  if (result === "granted") return Promise.resolve(true);
  if (result === "denied") return Promise.resolve(false);
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => resolve(hasAdminNotificationPermission()), 12_000);
    window.onAdminNotificationPermission = (granted: boolean) => {
      window.clearTimeout(timer);
      resolve(granted);
    };
  });
}

export function promptAdminNotificationsOnce(): void {
  const bridge = getAdminBridge();
  if (!bridge?.requestNotificationPermission) return;
  try {
    if (localStorage.getItem(ADMIN_NOTIF_PROMPTED_KEY) === "1") return;
    if (hasAdminNotificationPermission()) {
      localStorage.setItem(ADMIN_NOTIF_PROMPTED_KEY, "1");
      return;
    }
    localStorage.setItem(ADMIN_NOTIF_PROMPTED_KEY, "1");
    bridge.requestNotificationPermission();
  } catch {
    /* ignore */
  }
}

export function openAdminNotificationSettings(): void {
  try {
    getAdminBridge()?.openNotificationSettings?.();
  } catch {
    /* ignore */
  }
}
