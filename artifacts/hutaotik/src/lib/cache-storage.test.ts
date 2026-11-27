import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearTemporaryCache, inspectCacheStorage } from "./cache-storage";
import { getLocalHistory, saveLocalHistoryRecord } from "./local-history";

describe("cache storage & history cleanup", () => {
  const storage = new Map<string, string>();
  const target = new EventTarget();

  beforeEach(() => {
    storage.clear();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => {
        storage.set(key, value);
      },
      removeItem: (key: string) => {
        storage.delete(key);
      },
    });
    vi.stubGlobal("window", {
      addEventListener: target.addEventListener.bind(target),
      removeEventListener: target.removeEventListener.bind(target),
      dispatchEvent: target.dispatchEvent.bind(target),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reports download history count and clears history when clearing temporary cache", async () => {
    saveLocalHistoryRecord({
      title: "Sample Clip",
      author: "Creator",
      authorUsername: "creator",
      thumbnail: null,
      quality: "hd",
      sourceUrl: "https://www.tiktok.com/@creator/video/123456",
      downloadUrl: null,
      platform: "tiktok",
    });

    const before = await inspectCacheStorage();
    expect(before.historyCount).toBe(1);
    expect(before.breakdown.historyBytes).toBeGreaterThan(0);

    const cleared = await clearTemporaryCache();
    expect(cleared.clearedHistoryCount).toBe(1);
    expect(cleared.freedBytes).toBeGreaterThan(0);
    expect(getLocalHistory()).toEqual([]);

    const after = await inspectCacheStorage();
    expect(after.historyCount).toBe(0);
    expect(after.breakdown.historyBytes).toBe(0);
  });
});
