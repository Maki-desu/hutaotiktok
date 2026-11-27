import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  isAvailableRelease,
  isDirectApkInstallUrl,
  isUpdateNewer,
  registerAppUpdateProgressListener,
  type AppUpdateProgressEvent,
} from "./app-updates";

describe("app-updates client utilities", () => {
  beforeEach(() => {
    vi.stubGlobal("window", {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("compares installed and remote version codes accurately", () => {
    expect(isUpdateNewer(31, 30)).toBe(true);
    expect(isUpdateNewer(30, 30)).toBe(false);
    expect(isUpdateNewer(29, 30)).toBe(false);
  });

  it("identifies direct APK URLs vs external share links", () => {
    const apiBase = "https://hutaotiktok-mja6.onrender.com/";
    expect(
      isDirectApkInstallUrl(
        "https://github.com/user/repo/releases/download/v1.2.15/hutaotik.apk",
        apiBase,
      ),
    ).toBe(true);
    expect(isDirectApkInstallUrl("/api/app-updates/12/download", apiBase)).toBe(true);
    expect(
      isDirectApkInstallUrl("https://drive.google.com/file/d/123456/view?usp=sharing", apiBase),
    ).toBe(false);
    expect(
      isDirectApkInstallUrl("https://www.mediafire.com/file/abc123/hutaotik.apk/file", apiBase),
    ).toBe(false);
    expect(isDirectApkInstallUrl("http://insecure.example.com/app.apk", apiBase)).toBe(false);
  });

  it("validates release payloads and dispatches native progress updates", () => {
    expect(
      isAvailableRelease({
        id: 5,
        versionCode: 31,
        versionName: "1.2.15",
        changelog: "New update center",
        downloadUrl: "https://github.com/org/repo/releases/download/v1.2.15/hutaotik.apk",
        sha256: null,
      }),
    ).toBe(true);
    expect(isAvailableRelease({ versionCode: "31" })).toBe(false);

    const events: AppUpdateProgressEvent[] = [];
    const unsubscribe = registerAppUpdateProgressListener((event) => events.push(event));
    window.onAppUpdateProgress?.(
      JSON.stringify({
        status: "downloading",
        percent: 42.6,
        loadedBytes: 42_000_000,
        totalBytes: 100_000_000,
      }),
    );
    unsubscribe();
    window.onAppUpdateProgress?.(JSON.stringify({ status: "installing", percent: 100 }));

    expect(events).toEqual([
      {
        status: "downloading",
        percent: 43,
        loadedBytes: 42_000_000,
        totalBytes: 100_000_000,
        message: undefined,
      },
    ]);
  });
});
