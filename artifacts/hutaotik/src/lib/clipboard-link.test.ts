import { describe, expect, it } from "vitest";
import { detectSupportedClipboardLink } from "./clipboard-link";

describe("detectSupportedClipboardLink", () => {
  it("identifies links from all 6 supported platforms", () => {
    expect(detectSupportedClipboardLink("Check this https://vm.tiktok.com/ZMr12345/"))?.toEqual({
      url: "https://vm.tiktok.com/ZMr12345/",
      platform: "tiktok",
      label: "TikTok",
    });
    expect(detectSupportedClipboardLink("https://youtu.be/dQw4w9WgXcQ"))?.toEqual({
      url: "https://youtu.be/dQw4w9WgXcQ",
      platform: "youtube",
      label: "YouTube",
    });
    expect(detectSupportedClipboardLink("https://x.com/user/status/123456789"))?.toEqual({
      url: "https://x.com/user/status/123456789",
      platform: "twitter",
      label: "X / Twitter",
    });
    expect(detectSupportedClipboardLink("https://www.instagram.com/reel/ABC123/"))?.toEqual({
      url: "https://www.instagram.com/reel/ABC123/",
      platform: "instagram",
      label: "Instagram",
    });
    expect(detectSupportedClipboardLink("https://fb.watch/abc123/"))?.toEqual({
      url: "https://fb.watch/abc123/",
      platform: "facebook",
      label: "Facebook",
    });
    expect(detectSupportedClipboardLink("https://pin.it/5AbCdEf"))?.toEqual({
      url: "https://pin.it/5AbCdEf",
      platform: "pinterest",
      label: "Pinterest",
    });
  });

  it("returns null for unsupported URLs or plain text", () => {
    expect(detectSupportedClipboardLink("hello world")).toBeNull();
    expect(detectSupportedClipboardLink("https://example.com/article")).toBeNull();
  });
});
