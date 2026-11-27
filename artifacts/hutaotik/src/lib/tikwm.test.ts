import { afterEach, describe, expect, it, vi } from "vitest";
import { normalizeTikwmMediaUrl, toTikwmVideoInfo } from "./tikwm";
import { fetchTikTokInfoOnDevice, hasValidTikTokMedia } from "./background-fetch";

describe("tikwm normalization", () => {
  it("normalizes absolute, protocol-relative, and root-relative TikWM URLs", () => {
    expect(normalizeTikwmMediaUrl("https://cdn.example.com/v.mp4")).toBe("https://cdn.example.com/v.mp4");
    expect(normalizeTikwmMediaUrl("//cdn.example.com/v.mp4")).toBe("https://cdn.example.com/v.mp4");
    expect(normalizeTikwmMediaUrl("/video/media/hdplay/123.mp4")).toBe(
      "https://www.tikwm.com/video/media/hdplay/123.mp4",
    );
    expect(normalizeTikwmMediaUrl("null")).toBeNull();
    expect(normalizeTikwmMediaUrl("   ")).toBeNull();
  });

  it("extracts video metadata with aweme_id and relative media URLs", () => {
    const info = toTikwmVideoInfo(
      {
        aweme_id: "7106594312292453675",
        title: "Test clip",
        play: "/video/media/play/123.mp4",
        hdplay: "/video/media/hdplay/123.mp4",
        cover: "//p16.tiktokcdn.com/cover.jpg",
        duration: 19,
        author: { unique_id: "hutaotik", nickname: "HuTao", avatar: "/avatar.jpg" },
        music_info: { title: "Sound", author: "Artist", play: "/music/123.mp3" },
      },
      "https://www.tiktok.com/@hutaotik/video/7106594312292453675",
    );

    expect(info.id).toBe("7106594312292453675");
    expect(info.downloadUrls.hd).toBe("https://www.tikwm.com/video/media/hdplay/123.mp4");
    expect(info.downloadUrls.normal).toBe("https://www.tikwm.com/video/media/play/123.mp4");
    expect(info.downloadUrls.audio).toBe("https://www.tikwm.com/music/123.mp3");
    expect(info.thumbnail).toBe("https://p16.tiktokcdn.com/cover.jpg");
    expect(info.isPhoto).toBe(false);
  });

  it("synthesizes a fallback ID from the TikTok URL for photo carousels without id", () => {
    const info = toTikwmVideoInfo(
      {
        title: "Photo dump",
        images: ["/img/1.jpg", "https://p16.tiktokcdn.com/2.jpg"],
      },
      "https://www.tiktok.com/@creator/photo/7300112233445566778",
    );

    expect(info.id).toBe("7300112233445566778");
    expect(info.isPhoto).toBe(true);
    expect(info.photos).toEqual([
      "https://www.tikwm.com/img/1.jpg",
      "https://p16.tiktokcdn.com/2.jpg",
    ]);
  });
});

describe("native TikTok background fetch safety", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("validates TikTok media payloads by downloadable streams or photos", () => {
    expect(hasValidTikTokMedia({ downloadUrls: { hd: "https://cdn.example/a.mp4" } })).toBe(true);
    expect(hasValidTikTokMedia({ photos: ["https://cdn.example/1.jpg"] })).toBe(true);
    expect(hasValidTikTokMedia({ id: "123", downloadUrls: {}, photos: [] })).toBe(false);
  });

  it("resolves native TikTok results and synthesizes missing IDs", async () => {
    const win: Record<string, unknown> = {};
    win.AndroidStorageBridge = {
      getTikTokInfo: (_url: string, requestId: string) => {
        setTimeout(() => {
          const cb = win.onNativeTikTokResult as ((id: string, payload: string) => void) | undefined;
          cb?.(
            requestId,
            JSON.stringify({
              id: "",
              title: "Bridge Video",
              author: "Creator",
              authorUsername: "creator",
              authorAvatar: null,
              thumbnail: null,
              duration: 12,
              downloadUrls: { hd: "https://cdn.example/video.mp4", normal: null, low: null, audio: null },
              isPhoto: false,
              photos: [],
              music: { title: "Unknown", author: "Unknown", url: null },
            }),
          );
        }, 5);
      },
      clearPendingBackgroundFetch: vi.fn(),
    };
    vi.stubGlobal("window", win);

    const result = await fetchTikTokInfoOnDevice("https://vt.tiktok.com/ZTest/", undefined, 500);
    expect(result.title).toBe("Bridge Video");
    expect(result.id.length).toBeGreaterThan(0);
    expect(result.downloadUrls.hd).toBe("https://cdn.example/video.mp4");
  });

  it("rejects cleanly after timeout if the native bridge never responds", async () => {
    const win: Record<string, unknown> = {
      AndroidStorageBridge: {
        getTikTokInfo: vi.fn(),
      },
    };
    vi.stubGlobal("window", win);

    await expect(
      fetchTikTokInfoOnDevice("https://vt.tiktok.com/ZStall/", undefined, 30),
    ).rejects.toThrow(/timed out/i);
  });
});
