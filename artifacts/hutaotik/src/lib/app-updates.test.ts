import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  isAvailableRelease,
  isDirectApkInstallUrl,
  isReleaseAlreadyInstalled,
  isUpdateNewer,
  registerAppUpdateProgressListener,
  startAppUpdateInstall,
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

  it("treats a release as installed when the build is not newer or the APK SHA-256 matches", () => {
    const sha = "b".repeat(64);
    expect(isReleaseAlreadyInstalled({ versionCode: 45, sha256: null }, { versionCode: 45 })).toBe(true);
    expect(isReleaseAlreadyInstalled({ versionCode: 44, sha256: null }, { versionCode: 45 })).toBe(true);
    expect(isReleaseAlreadyInstalled({ versionCode: 46, sha256: null }, { versionCode: 45 })).toBe(false);
    // Admin typed Build 46 but the uploaded APK is the one already installed (same bytes)
    expect(
      isReleaseAlreadyInstalled({ versionCode: 46, sha256: sha.toUpperCase() }, { versionCode: 45, apkSha256: sha }),
    ).toBe(true);
    expect(
      isReleaseAlreadyInstalled({ versionCode: 46, sha256: "c".repeat(64) }, { versionCode: 45, apkSha256: sha }),
    ).toBe(false);
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

  it("invokes AndroidStorageBridge.installAppUpdate bound to its receiver (no Illegal invocation)", () => {
    const calls: Array<{ url: string; sha256: string }> = [];
    const bridge = {
      installAppUpdate(this: unknown, url: string, sha256: string) {
        if (this !== bridge) {
          throw new TypeError("Illegal invocation");
        }
        calls.push({ url, sha256 });
        return "started";
      },
    };
    vi.stubGlobal("window", {
      AndroidStorageBridge: bridge,
      location: { origin: "https://hutaotiktok-mja6.onrender.com" },
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));

    const outcome = startAppUpdateInstall({
      id: 12,
      versionCode: 38,
      versionName: "1.2.22",
      title: "Update",
      changelog: "Fixes",
      downloadUrl: "https://hutaotiktok-mja6.onrender.com/api/app-updates/12/download",
      fileSize: 98_000_000,
      sha256: "a".repeat(64),
      isMandatory: false,
      minSupportedVersionCode: null,
      downloadCount: 0,
      createdAt: new Date().toISOString(),
    });

    expect(outcome).toBe("started");
    expect(calls).toEqual([
      {
        url: "https://hutaotiktok-mja6.onrender.com/api/app-updates/12/download",
        sha256: "a".repeat(64),
      },
    ]);
  });
});
