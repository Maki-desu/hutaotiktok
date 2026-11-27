import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  loadNotificationPreferences,
  saveNotificationPreferences,
  getNotificationStatus,
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
});
