import { extractFirstHttpUrl, isPinterestUrl } from "@/lib/pinterest-url";
import { isInstagramUrl } from "@/lib/instagram-url";
import { isTwitterUrl } from "@/lib/twitter-url";
import { isYouTubeUrl } from "@/lib/youtube-url";

export type DetectedPlatform =
  | "tiktok"
  | "youtube"
  | "twitter"
  | "instagram"
  | "facebook"
  | "pinterest";

export interface DetectedClipboardLink {
  url: string;
  platform: DetectedPlatform;
  label: string;
}

interface NativeClipboardBridge {
  readClipboardText?(): string;
}

function isTikTokUrl(input: string): boolean {
  try {
    const parsed = new URL(input);
    const host = parsed.hostname.toLowerCase();
    return host === "tiktok.com" || host.endsWith(".tiktok.com");
  } catch {
    return false;
  }
}

function isFacebookUrl(input: string): boolean {
  try {
    const parsed = new URL(input);
    const host = parsed.hostname.toLowerCase();
    return (
      host === "fb.watch" ||
      host === "fb.com" ||
      host === "facebook.com" ||
      host.endsWith(".facebook.com")
    );
  } catch {
    return false;
  }
}

export function detectSupportedClipboardLink(rawText: string): DetectedClipboardLink | null {
  const url = extractFirstHttpUrl(rawText);
  if (!url) return null;

  if (isTikTokUrl(url)) return { url, platform: "tiktok", label: "TikTok" };
  if (isYouTubeUrl(url)) return { url, platform: "youtube", label: "YouTube" };
  if (isTwitterUrl(url)) return { url, platform: "twitter", label: "X / Twitter" };
  if (isInstagramUrl(url)) return { url, platform: "instagram", label: "Instagram" };
  if (isFacebookUrl(url)) return { url, platform: "facebook", label: "Facebook" };
  if (isPinterestUrl(url)) return { url, platform: "pinterest", label: "Pinterest" };
  return null;
}

export async function readClipboardLinkQuietly(): Promise<DetectedClipboardLink | null> {
  if (typeof window === "undefined") return null;

  const bridge = (window as Window & { AndroidStorageBridge?: NativeClipboardBridge }).AndroidStorageBridge;
  if (bridge?.readClipboardText) {
    try {
      const nativeText = bridge.readClipboardText();
      if (nativeText) {
        return detectSupportedClipboardLink(nativeText);
      }
      return null;
    } catch {
      /* fallback */
    }
  }

  // On web browsers, only read silently if permission is already granted so we never annoy with prompts
  try {
    if (navigator.permissions?.query) {
      const perm = await navigator.permissions.query({
        name: "clipboard-read" as PermissionName,
      });
      if (perm.state !== "granted") return null;
    }
    if (navigator.clipboard?.readText) {
      const text = await navigator.clipboard.readText();
      return detectSupportedClipboardLink(text);
    }
  } catch {
    /* ignore permission errors */
  }
  return null;
}
