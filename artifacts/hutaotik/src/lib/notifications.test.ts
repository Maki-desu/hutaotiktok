import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  loadNotificationPreferences,
  saveNotificationPreferences,
  getNotificationStatus,
  checkCustomPushNotifications,
  shouldRequireNotificationGate,
} from "./notifications";

describe("notification preferences & bridge sync", () => {
  const storage = new Map<string, string>();

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
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("defaults all notification channels to enabled", () => {
    expect(loadNotificationPreferences()).toEqual({
      downloads: true,
      updates: true,
      announcements: true,
    });
  });

  it("persists individual channel toggles cleanly", () => {
    saveNotificationPreferences({
      downloads: true,
      updates: false,
      announcements: true,
    });
    expect(loadNotificationPreferences()).toEqual({
      downloads: true,
      updates: false,
      announcements: true,
    });
  });

  it("reads native status cleanly when AndroidStorageBridge is absent", () => {
    const status = getNotificationStatus();
    expect(status.downloads).toBe(true);
    expect(status.updates).toBe(true);
    expect(status.announcements).toBe(true);
  });

  it("forwards a fresh custom push notification to AndroidStorageBridge and deduplicates repeats", async () => {
    const notifyCustomPush = vi.fn();
    vi.stubGlobal("window", {
      AndroidStorageBridge: { notifyCustomPush },
    });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        notification: {
          id: 42,
          title: "Maintenance Window",
          body: "Server upgrade starts in 15 minutes.",
          accentType: "warning",
          targetRoute: "/updates",
          createdAt: new Date().toISOString(),
        },
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const first = await checkCustomPushNotifications();
    expect(first?.id).toBe(42);
    expect(notifyCustomPush).toHaveBeenCalledTimes(1);
    expect(notifyCustomPush).toHaveBeenCalledWith(
      42,
      "Maintenance Window",
      "Server upgrade starts in 15 minutes.",
      "warning",
      "/updates",
    );

    const second = await checkCustomPushNotifications();
    expect(second).toBeNull();
    expect(notifyCustomPush).toHaveBeenCalledTimes(1);
  });

  it("silently records stale custom pushes (>6h old) on first launch without firing", async () => {
    const notifyCustomPush = vi.fn();
    vi.stubGlobal("window", {
      AndroidStorageBridge: { notifyCustomPush },
    });
    const staleDate = new Date(Date.now() - 8 * 60 * 60 * 1000).toISOString();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          notification: {
            id: 9,
            title: "Old Promo",
            body: "Sent 8 hours ago",
            accentType: "promo",
            targetRoute: "/",
            createdAt: staleDate,
          },
        }),
      }),
    );

    const result = await checkCustomPushNotifications();
    expect(result).toBeNull();
    expect(notifyCustomPush).not.toHaveBeenCalled();
    expect(storage.get("hutaotik_last_custom_push_id_v1")).toBe("9");
  });

  it("does not mark a custom push as seen when native notification permission is not yet granted", async () => {
    const notifyCustomPush = vi.fn();
    vi.stubGlobal("window", {
      AndroidStorageBridge: {
        notifyCustomPush,
        getNotificationStatus: () =>
          JSON.stringify({ granted: false, downloads: true, updates: true, announcements: true, sdkInt: 34 }),
      },
    });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await checkCustomPushNotifications();
    expect(result).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(notifyCustomPush).not.toHaveBeenCalled();
    expect(storage.get("hutaotik_last_custom_push_id_v1")).toBeUndefined();
  });

  it("requires the notification gate whenever notifications are supported and not granted", () => {
    expect(shouldRequireNotificationGate({ supported: true, granted: false })).toBe(true);
    expect(shouldRequireNotificationGate({ supported: true, granted: true })).toBe(false);
    expect(shouldRequireNotificationGate({ supported: false, granted: false })).toBe(false);
  });
});
