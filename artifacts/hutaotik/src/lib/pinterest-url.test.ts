// Runtime validation coverage for Pinterest and Instagram downloader URL routing.
import { describe, expect, it } from "vitest";
import { extractFirstHttpUrl, isPinterestUrl } from "./pinterest-url";
import { isInstagramUrl } from "./instagram-url";

describe("isPinterestUrl", () => {
  it("accepts Pinterest Pin, regional, media, and short-link hosts", () => {
    expect(isPinterestUrl("https://www.pinterest.com/pin/123456789/")).toBe(true);
    expect(isPinterestUrl("https://pin.it/abc123")).toBe(true);
    expect(isPinterestUrl("https://br.pinterest.com/pin/123456789/")).toBe(true);
    expect(isPinterestUrl("https://ph.pinterest.com/pin/123456789/sent/?invite_code=xyz")).toBe(true);
    expect(isPinterestUrl("https://www.pinterest.co.uk/pin/123456789/")).toBe(true);
    expect(isPinterestUrl("https://www.pinterest.com.au/pin/123456789/")).toBe(true);
    expect(isPinterestUrl("https://i.pinimg.com/videos/mc/720x1280/123.mp4")).toBe(true);
    expect(isPinterestUrl("Check this pin out! https://pin.it/abc123")).toBe(true);
  });

  it("extracts the first HTTP(S) URL from shared text", () => {
    expect(extractFirstHttpUrl("Check this out! https://pin.it/abc123.")).toBe("https://pin.it/abc123");
    expect(extractFirstHttpUrl("Watch https://www.instagram.com/share/reel/BAc123xyz!")).toBe(
      "https://www.instagram.com/share/reel/BAc123xyz",
    );
  });

  describe("isInstagramUrl", () => {
    it("accepts Instagram posts, reels, share links, and alternate short-link hosts", () => {
      expect(isInstagramUrl("https://www.instagram.com/reel/ABC123/")).toBe(true);
      expect(isInstagramUrl("https://www.instagram.com/reels/ABC123/?igsh=xyz")).toBe(true);
      expect(isInstagramUrl("https://www.instagram.com/share/reel/BAc123xyz")).toBe(true);
      expect(isInstagramUrl("https://instagram.com/p/ABC123/")).toBe(true);
      expect(isInstagramUrl("https://instagr.am/p/ABC123/")).toBe(true);
      expect(isInstagramUrl("Reel link: https://www.instagram.com/reel/ABC123/")).toBe(true);
    });

    it("rejects unrelated and lookalike URLs", () => {
      expect(isInstagramUrl("https://example.com/reel/ABC123/")).toBe(false);
      expect(isInstagramUrl("https://instagram.com.example.net/reel/ABC123/")).toBe(false);
      expect(isInstagramUrl("ftp://instagram.com/reel/ABC123/")).toBe(false);
      expect(isInstagramUrl("not a URL")).toBe(false);
    });
  });

  it("rejects unrelated and lookalike URLs", () => {
    expect(isPinterestUrl("https://example.com/pin/123456789/")).toBe(false);
    expect(isPinterestUrl("https://pinterest.com.example.net/pin/123456789/")).toBe(false);
    expect(isPinterestUrl("ftp://pinterest.com/pin/123456789/")).toBe(false);
    expect(isPinterestUrl("not a URL")).toBe(false);
  });
});
