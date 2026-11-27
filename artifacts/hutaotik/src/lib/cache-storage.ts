import { clearLocalHistory, getLocalHistory, getLocalHistoryBytes } from "@/lib/local-history";

export interface CacheStorageInfo {
  totalBytes: number;
  fileCount: number;
  historyCount: number;
  isNative: boolean;
  breakdown: {
    compressedVideos: number;
    tempDownloads: number;
    updateApks: number;
    historyBytes: number;
  };
}

interface NativeCacheBridge {
  getCacheStorageInfo?(): string;
  clearAppCache?(): string;
}

function getCacheBridge(): NativeCacheBridge | undefined {
  if (typeof window === "undefined") return undefined;
  return (window as Window & { AndroidStorageBridge?: NativeCacheBridge }).AndroidStorageBridge;
}

export function formatStorageBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let idx = 0;
  while (value >= 1024 && idx < units.length - 1) {
    value /= 1024;
    idx += 1;
  }
  const decimals = idx === 0 ? 0 : value >= 100 ? 0 : 1;
  return `${value.toFixed(decimals)} ${units[idx]}`;
}

export async function inspectCacheStorage(): Promise<CacheStorageInfo> {
  const historyCount = getLocalHistory().length;
  const historyBytes = getLocalHistoryBytes();

  const bridge = getCacheBridge();
  if (bridge?.getCacheStorageInfo) {
    try {
      const raw = bridge.getCacheStorageInfo();
      const parsed = JSON.parse(raw) as Partial<CacheStorageInfo>;
      const nativeBytes = typeof parsed.totalBytes === "number" ? parsed.totalBytes : 0;
      return {
        totalBytes: nativeBytes + historyBytes,
        fileCount: typeof parsed.fileCount === "number" ? parsed.fileCount : 0,
        historyCount,
        isNative: true,
        breakdown: {
          compressedVideos: parsed.breakdown?.compressedVideos ?? 0,
          tempDownloads: parsed.breakdown?.tempDownloads ?? 0,
          updateApks: parsed.breakdown?.updateApks ?? 0,
          historyBytes,
        },
      };
    } catch {
      /* fallback */
    }
  }

  let webBytes = 0;
  try {
    if (navigator.storage?.estimate) {
      const estimate = await navigator.storage.estimate();
      webBytes = estimate.usage ?? 0;
    }
  } catch {
    /* ignore */
  }

  return {
    totalBytes: webBytes + historyBytes,
    fileCount: 0,
    historyCount,
    isNative: false,
    breakdown: {
      compressedVideos: 0,
      tempDownloads: webBytes,
      updateApks: 0,
      historyBytes,
    },
  };
}

export async function clearTemporaryCache(): Promise<{
  freedBytes: number;
  clearedHistoryCount: number;
}> {
  let freedBytes = 0;
  const clearedHistoryCount = getLocalHistory().length;
  const historyBytes = getLocalHistoryBytes();

  // Clearing cache also clears saved download history records
  clearLocalHistory();
  freedBytes += historyBytes;

  const bridge = getCacheBridge();
  if (bridge?.clearAppCache) {
    try {
      const raw = bridge.clearAppCache();
      const parsed = JSON.parse(raw) as { freedBytes?: number };
      freedBytes += typeof parsed.freedBytes === "number" ? parsed.freedBytes : 0;
    } catch {
      /* ignore */
    }
  }

  // Clear browser Cache Storage entries if any exist (never deletes user preferences or saved downloads)
  try {
    if (typeof caches !== "undefined") {
      const keys = await caches.keys();
      await Promise.all(keys.map((key) => caches.delete(key)));
    }
  } catch {
    /* ignore */
  }

  return { freedBytes, clearedHistoryCount };
}
