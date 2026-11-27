import { execFile } from "child_process";
import { createWriteStream, existsSync, unlink } from "fs";
import { promisify } from "util";
import { tmpdir } from "os";
import { join, resolve } from "path";
import { Readable } from "stream";
import { pipeline } from "stream/promises";
import { logger } from "./logger";
import { cobaltFetch } from "./cobalt";

const execFileAsync = promisify(execFile);
const unlinkAsync = promisify(unlink);

const DESKTOP_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36";
const IG_APP_ID = "936619743392459";
const IG_GRAPHQL_DOC_IDS = ["8845758582119845", "10015901848480474"];
const SOCIAL_INFO_CACHE_TTL_MS = 300_000;
const socialInfoCache = new Map<string, { expiresAt: number; info: SocialVideoInfo }>();
const socialInfoInFlight = new Map<string, Promise<SocialVideoInfo | null>>();
let preferredSocialYtDlpCommand: { cmd: string; args: string[] } | null = null;

const VIDEO_HOSTS = {
  pinterest: new Set(["pinterest.com", "pin.it", "pinimg.com"]),
  instagram: new Set(["instagram.com", "instagr.am"]),
} as const;
type SocialVideoPlatform = keyof typeof VIDEO_HOSTS;

interface YtDlpFormat {
  height?: number;
  vcodec?: string;
  acodec?: string;
  url?: string;
}

interface YtDlpOutput {
  id?: string;
  title?: string;
  thumbnail?: string;
  uploader?: string;
  channel?: string;
  duration?: number;
  height?: number;
  url?: string;
  formats?: YtDlpFormat[];
}

export interface SocialVideoInfo {
  id: string;
  title: string;
  thumbnail: string | null;
  channelName: string;
  duration: number;
  height: number | null;
  mediaType?: "video" | "image";
}

export interface SocialDownloadFile {
  tmpPath: string;
  contentType: string;
  extension: string;
}

interface DirectSocialMedia {
  info: SocialVideoInfo;
  directUrl: string | null;
  hlsUrl: string | null;
  canonicalUrl: string;
  isVideoPost: boolean;
}

function isSocialVideoUrl(input: string, platform: SocialVideoPlatform): boolean {
  try {
    const url = new URL(input);
    const hostname = url.hostname.toLowerCase();
    if (url.protocol !== "https:" && url.protocol !== "http:") return false;
    if (platform === "pinterest") {
      const isPinterestLocale =
        /(^|\.)pinterest\.[a-z]{2,}(?:\.[a-z]{2,3})?$/i.test(hostname);
      const isPinterestMedia = hostname === "pinimg.com" || hostname.endsWith(".pinimg.com");
      if (
        isPinterestLocale ||
        isPinterestMedia ||
        hostname === "pin.it" ||
        hostname.endsWith(".pin.it")
      ) {
        return true;
      }
    }
    return [...VIDEO_HOSTS[platform]].some(
      (host) => hostname === host || hostname.endsWith(`.${host}`),
    );
  } catch {
    return false;
  }
}

export const isPinterestUrl = (input: string) => isSocialVideoUrl(input, "pinterest");
export const isInstagramUrl = (input: string) => isSocialVideoUrl(input, "instagram");

function isAllowedMediaUrl(platform: SocialVideoPlatform, rawUrl: string | null | undefined): rawUrl is string {
  if (!rawUrl) return false;
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443")) {
      return false;
    }
    const host = url.hostname.toLowerCase();
    if (platform === "pinterest") {
      return host === "pinimg.com" || host.endsWith(".pinimg.com");
    }
    return (
      host === "cdninstagram.com" ||
      host.endsWith(".cdninstagram.com") ||
      host === "fbcdn.net" ||
      host.endsWith(".fbcdn.net")
    );
  } catch {
    return false;
  }
}

function unescapeMediaUrl(value: string): string {
  return value
    .trim()
    .replace(/\\\//g, "/")
    .replace(/\\u0026/gi, "&")
    .replace(/\\u002f/gi, "/")
    .replace(/\\u003a/gi, ":")
    .replace(/\\u003d/gi, "=")
    .replace(/\\u003f/gi, "?")
    .replace(/\\u0025/gi, "%")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'");
}

function extractPinterestPinId(rawUrl: string): string | null {
  return rawUrl.match(/\/pin\/(?:[^/?#]*--)?(\d+)(?:\/|\?|$)/i)?.[1] ?? null;
}

function extractInstagramTypeAndShortcode(rawUrl: string): { type: string; shortcode: string } | null {
  try {
    const parsed = new URL(rawUrl);
    const direct = parsed.pathname.match(/\/(reel|reels|p|tv)\/([A-Za-z0-9_-]{5,})(?:\/|$)/i);
    if (direct) {
      const type = direct[1].toLowerCase() === "reels" ? "reel" : direct[1].toLowerCase();
      return { type, shortcode: direct[2] };
    }
    const nextParam = parsed.searchParams.get("next");
    if (nextParam) {
      const fromNext = nextParam.match(/\/(reel|reels|p|tv)\/([A-Za-z0-9_-]{5,})(?:\/|\?|$)/i);
      if (fromNext) {
        const type = fromNext[1].toLowerCase() === "reels" ? "reel" : fromNext[1].toLowerCase();
        return { type, shortcode: fromNext[2] };
      }
    }
  } catch {
    return null;
  }
  return null;
}

function canonicalizeWithoutNetwork(platform: SocialVideoPlatform, rawUrl: string): string {
  const trimmed = rawUrl.trim();
  if (platform === "pinterest") {
    if (isAllowedMediaUrl("pinterest", trimmed)) return trimmed;
    const pinId = extractPinterestPinId(trimmed);
    return pinId ? `https://www.pinterest.com/pin/${pinId}/` : trimmed;
  }
  const ig = extractInstagramTypeAndShortcode(trimmed);
  return ig ? `https://www.instagram.com/${ig.type}/${ig.shortcode}/` : trimmed;
}

async function resolveCanonicalUrl(platform: SocialVideoPlatform, rawUrl: string): Promise<string> {
  const pre = canonicalizeWithoutNetwork(platform, rawUrl);
  if (platform === "pinterest" && (extractPinterestPinId(pre) || isAllowedMediaUrl("pinterest", pre))) {
    return pre;
  }
  if (platform === "instagram" && extractInstagramTypeAndShortcode(pre)) {
    return pre;
  }

  let current = rawUrl.trim();
  for (let hop = 0; hop < 8; hop++) {
    try {
      const res = await fetch(current, {
        method: "GET",
        redirect: "manual",
        headers: { "User-Agent": DESKTOP_USER_AGENT, "Accept-Language": "en-US,en;q=0.9" },
        signal: AbortSignal.timeout(7_000),
      });
      await res.body?.cancel();
      if (res.status < 300 || res.status >= 400) break;
      const location = res.headers.get("location");
      if (!location) break;
      const nextUrl = new URL(location, current).toString();
      const canonical = canonicalizeWithoutNetwork(platform, nextUrl);
      if (platform === "pinterest" && (extractPinterestPinId(canonical) || isAllowedMediaUrl("pinterest", canonical))) {
        return canonical;
      }
      if (platform === "instagram" && extractInstagramTypeAndShortcode(canonical)) {
        return canonical;
      }
      if (platform === "instagram" && nextUrl.toLowerCase().includes("/accounts/login")) {
        break;
      }
      if (!isSocialVideoUrl(nextUrl, platform)) break;
      current = nextUrl;
    } catch {
      break;
    }
  }
  return canonicalizeWithoutNetwork(platform, current);
}

function inferHeightFromUrl(url: string): number | null {
  const p = url.match(/(?:\/|_)(\d{3,4})p(?:\/|_|\.)/i);
  if (p) {
    const h = Number(p[1]);
    if (h >= 144 && h <= 4320) return h;
  }
  const dim = url.match(/\/(\d{3,4})x(\d{3,4})\//);
  if (dim) {
    const h = Math.min(Number(dim[1]), Number(dim[2]));
    if (h >= 144 && h <= 4320) return h;
  }
  return null;
}

function collectPinterestFromJson(
  node: unknown,
  videos: Array<{ url: string; height: number | null; isHls: boolean }>,
  meta: { title?: string; channelName?: string; thumbnail?: string; originalImage?: string; duration: number },
): void {
  if (Array.isArray(node)) {
    for (const item of node) collectPinterestFromJson(item, videos, meta);
    return;
  }
  if (!node || typeof node !== "object") return;
  const obj = node as Record<string, unknown>;

  if (obj["@type"] === "VideoObject" && typeof obj.contentUrl === "string") {
    const clean = unescapeMediaUrl(obj.contentUrl);
    if (isAllowedMediaUrl("pinterest", clean)) {
      videos.push({ url: clean, height: inferHeightFromUrl(clean), isHls: clean.toLowerCase().includes(".m3u8") });
    }
    if (!meta.title && typeof obj.name === "string") meta.title = obj.name;
    if (!meta.thumbnail && typeof obj.thumbnailUrl === "string") meta.thumbnail = obj.thumbnailUrl;
  }

  if (obj.video_list && typeof obj.video_list === "object" && !Array.isArray(obj.video_list)) {
    for (const [key, val] of Object.entries(obj.video_list as Record<string, unknown>)) {
      if (!val || typeof val !== "object") continue;
      const v = val as Record<string, unknown>;
      if (typeof v.url !== "string") continue;
      const clean = unescapeMediaUrl(v.url);
      if (!isAllowedMediaUrl("pinterest", clean)) continue;
      const height = typeof v.height === "number" && v.height > 0 ? v.height : inferHeightFromUrl(clean);
      if (typeof v.duration === "number" && v.duration > 0 && meta.duration <= 0) {
        meta.duration = v.duration > 1000 ? Math.round(v.duration / 1000) : Math.round(v.duration);
      }
      if (!meta.thumbnail && typeof v.thumbnail === "string") {
        meta.thumbnail = unescapeMediaUrl(v.thumbnail);
      }
      videos.push({
        url: clean,
        height,
        isHls: clean.toLowerCase().includes(".m3u8") || key.toUpperCase().includes("HLS"),
      });
    }
  }

  if (!meta.title) {
    const candidate = obj.grid_title ?? obj.title ?? obj.seo_title ?? obj.closeup_unified_description;
    if (typeof candidate === "string" && candidate.trim()) meta.title = candidate.trim();
  }
  if (!meta.channelName) {
    const pinner = (obj.native_creator ?? obj.pinner ?? obj.origin_pinner ?? obj.creator) as
      | Record<string, unknown>
      | undefined;
    if (pinner && typeof pinner === "object") {
      const name = pinner.full_name ?? pinner.username ?? pinner.name;
      if (typeof name === "string" && name.trim()) meta.channelName = name.trim();
    }
  }
  if (obj.images && typeof obj.images === "object") {
    const images = obj.images as Record<string, Record<string, unknown> | undefined>;
    const origUrl = typeof images.orig?.url === "string" ? unescapeMediaUrl(images.orig.url) : undefined;
    const x736Url = typeof images["736x"]?.url === "string" ? unescapeMediaUrl(images["736x"].url) : undefined;
    if (!meta.originalImage && origUrl) meta.originalImage = origUrl;
    if (!meta.thumbnail && (x736Url || origUrl)) meta.thumbnail = x736Url || origUrl;
  }

  for (const value of Object.values(obj)) {
    if (value && typeof value === "object") collectPinterestFromJson(value, videos, meta);
  }
}

async function extractPinterestDirect(canonicalUrl: string): Promise<DirectSocialMedia | null> {
  if (isAllowedMediaUrl("pinterest", canonicalUrl)) {
    const lower = canonicalUrl.toLowerCase();
    const isHls = lower.includes(".m3u8");
    const isVideo = isHls || lower.includes(".mp4");
    return {
      info: {
        id: "",
        title: isVideo ? "Pinterest Video" : "Pinterest Image",
        thumbnail: isVideo ? null : canonicalUrl,
        channelName: "Pinterest",
        duration: 0,
        height: inferHeightFromUrl(canonicalUrl),
        mediaType: isVideo ? "video" : "image",
      },
      directUrl: isHls ? null : canonicalUrl,
      hlsUrl: isHls ? canonicalUrl : null,
      canonicalUrl,
      isVideoPost: isVideo,
    };
  }

  try {
    const res = await fetch(canonicalUrl, {
      headers: {
        "User-Agent": DESKTOP_USER_AGENT,
        "Accept-Language": "en-US,en;q=0.9",
        Referer: "https://www.pinterest.com/",
      },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    const html = await res.text();

    const videos: Array<{ url: string; height: number | null; isHls: boolean }> = [];
    const meta: { title?: string; channelName?: string; thumbnail?: string; originalImage?: string; duration: number } = {
      duration: 0,
    };

    const scriptRegex =
      /<script[^>]+(?:id=["']__PWS_DATA__["']|type=["']application\/(?:ld\+)?json["']|data-relay-(?:completed-)?response=["']true["'])[^>]*>([\s\S]*?)<\/script>/gi;
    for (const match of html.matchAll(scriptRegex)) {
      try {
        collectPinterestFromJson(JSON.parse(match[1]), videos, meta);
      } catch {
        // skip non-JSON script
      }
    }

    const ogTitle = html.match(/<meta[^>]+(?:property|name)=["']og:title["'][^>]+content=["']([^"']*)["']/i)?.[1];
    const ogImage = html.match(/<meta[^>]+(?:property|name)=["']og:image["'][^>]+content=["']([^"']*)["']/i)?.[1];
    const ogVideo = html.match(/<meta[^>]+(?:property|name)=["']og:video(?::secure_url)?["'][^>]+content=["']([^"']*)["']/i)?.[1];
    if (!meta.title && ogTitle) meta.title = unescapeMediaUrl(ogTitle).replace(/\s*\|\s*Pinterest.*$/i, "").trim();
    if (!meta.thumbnail && ogImage) meta.thumbnail = unescapeMediaUrl(ogImage);
    if (!meta.originalImage && meta.thumbnail) meta.originalImage = meta.thumbnail;
    if (ogVideo) {
      const clean = unescapeMediaUrl(ogVideo);
      if (isAllowedMediaUrl("pinterest", clean)) {
        videos.push({ url: clean, height: inferHeightFromUrl(clean), isHls: clean.toLowerCase().includes(".m3u8") });
      }
    }

    const directRegex =
      /https?(?:\\u003a|:)(?:\\\/|\/){2}v[0-9a-z-]*\.pinimg\.com(?:\\\/|\/)videos(?:\\\/|\/)[^\s"'<>\\]+\.(?:mp4|m3u8)(?:\?[^\s"'<>\\]*)?/gi;
    for (const match of html.matchAll(directRegex)) {
      const clean = unescapeMediaUrl(match[0]);
      if (isAllowedMediaUrl("pinterest", clean)) {
        videos.push({ url: clean, height: inferHeightFromUrl(clean), isHls: clean.toLowerCase().includes(".m3u8") });
      }
    }

    const bestMp4 = videos
      .filter((v) => !v.isHls)
      .sort((a, b) => (b.height ?? 0) - (a.height ?? 0))[0];
    const bestHls = videos
      .filter((v) => v.isHls)
      .sort((a, b) => (b.height ?? 0) - (a.height ?? 0))[0];

    const pinId = extractPinterestPinId(canonicalUrl) ?? "";
    const safeThumb = isAllowedMediaUrl("pinterest", meta.thumbnail) ? meta.thumbnail : null;
    if (bestMp4 || bestHls) {
      const heights = [bestMp4?.height, bestHls?.height].filter((h): h is number => typeof h === "number" && h > 0);
      return {
        info: {
          id: pinId,
          title: meta.title || "Pinterest Video",
          thumbnail: safeThumb,
          channelName: meta.channelName || "Pinterest",
          duration: meta.duration,
          height: heights.length > 0 ? Math.max(...heights) : null,
          mediaType: "video",
        },
        directUrl: bestMp4?.url ?? null,
        hlsUrl: bestHls?.url ?? null,
        canonicalUrl,
        isVideoPost: true,
      };
    }

    const safeImage = isAllowedMediaUrl("pinterest", meta.originalImage) ? meta.originalImage : null;
    if (safeImage) {
      return {
        info: {
          id: pinId,
          title: meta.title || "Pinterest Image",
          thumbnail: safeImage,
          channelName: meta.channelName || "Pinterest",
          duration: 0,
          height: null,
          mediaType: "image",
        },
        directUrl: safeImage,
        hlsUrl: null,
        canonicalUrl,
        isVideoPost: false,
      };
    }
    return null;
  } catch (err) {
    logger.debug({ err, canonicalUrl }, "pinterest: direct extraction failed");
    return null;
  }
}

function parseInstagramMediaNode(
  node: Record<string, unknown>,
  shortcode: string,
  canonicalUrl: string,
  urlIndicatesVideo: boolean,
): DirectSocialMedia | null {
  const media =
    ((node.data as Record<string, unknown> | undefined)?.xdt_shortcode_media as Record<string, unknown> | undefined) ??
    ((node.data as Record<string, unknown> | undefined)?.shortcode_media as Record<string, unknown> | undefined) ??
    (node.shortcode_media as Record<string, unknown> | undefined) ??
    (node.xdt_shortcode_media as Record<string, unknown> | undefined) ??
    ((node.graphql as Record<string, unknown> | undefined)?.shortcode_media as Record<string, unknown> | undefined) ??
    node;

  const extractVideo = (item: Record<string, unknown>): string | null => {
    if (typeof item.video_url === "string") {
      const clean = unescapeMediaUrl(item.video_url);
      if (isAllowedMediaUrl("instagram", clean)) return clean;
    }
    if (Array.isArray(item.video_versions)) {
      const sorted = [...(item.video_versions as Array<Record<string, unknown>>)]
        .filter((v) => typeof v?.url === "string")
        .sort((a, b) => Number(b.height ?? 0) - Number(a.height ?? 0));
      for (const v of sorted) {
        const clean = unescapeMediaUrl(v.url as string);
        if (isAllowedMediaUrl("instagram", clean)) return clean;
      }
    }
    return null;
  };

  let videoUrl = extractVideo(media);
  let isVideo = urlIndicatesVideo || media.is_video === true || media.product_type === "clips";
  const rawThumb =
    typeof media.thumbnail_src === "string"
      ? unescapeMediaUrl(media.thumbnail_src)
      : typeof media.display_url === "string"
        ? unescapeMediaUrl(media.display_url)
        : null;
  let thumbnail = isAllowedMediaUrl("instagram", rawThumb) ? rawThumb : null;
  const dims = media.dimensions as Record<string, unknown> | undefined;
  let height = typeof dims?.height === "number" && dims.height > 0
    ? dims.height
    : typeof media.original_height === "number" && media.original_height > 0
      ? media.original_height
      : null;
  let duration = typeof media.video_duration === "number" ? Math.round(media.video_duration) : 0;

  if (!videoUrl && media.edge_sidecar_to_children && typeof media.edge_sidecar_to_children === "object") {
    const edges = (media.edge_sidecar_to_children as { edges?: Array<{ node?: Record<string, unknown> }> }).edges ?? [];
    for (const edge of edges) {
      if (!edge?.node) continue;
      const childVideo = extractVideo(edge.node);
      if (childVideo) {
        videoUrl = childVideo;
        isVideo = true;
        if (!thumbnail && typeof edge.node.display_url === "string") {
          const clean = unescapeMediaUrl(edge.node.display_url);
          if (isAllowedMediaUrl("instagram", clean)) thumbnail = clean;
        }
        break;
      }
    }
  }

  const owner = media.owner as Record<string, unknown> | undefined;
  const channelName =
    (typeof owner?.username === "string" && owner.username) ||
    (typeof owner?.full_name === "string" && owner.full_name) ||
    "Instagram";
  const captionEdges = (media.edge_media_to_caption as { edges?: Array<{ node?: { text?: string } }> } | undefined)?.edges;
  const caption =
    captionEdges?.[0]?.node?.text?.trim() ||
    ((media.caption as { text?: string } | undefined)?.text?.trim()) ||
    "";

  if (videoUrl) {
    return {
      info: {
        id: typeof media.shortcode === "string" ? media.shortcode : shortcode,
        title: caption || "Instagram Video",
        thumbnail,
        channelName,
        duration,
        height,
        mediaType: "video",
      },
      directUrl: videoUrl,
      hlsUrl: null,
      canonicalUrl,
      isVideoPost: true,
    };
  }
  if (!isVideo && thumbnail) {
    return {
      info: {
        id: typeof media.shortcode === "string" ? media.shortcode : shortcode,
        title: caption || "Instagram Photo",
        thumbnail,
        channelName,
        duration: 0,
        height,
        mediaType: "image",
      },
      directUrl: thumbnail,
      hlsUrl: null,
      canonicalUrl,
      isVideoPost: false,
    };
  }
  return null;
}

async function extractInstagramDirect(canonicalUrl: string): Promise<DirectSocialMedia | null> {
  const parsed = extractInstagramTypeAndShortcode(canonicalUrl);
  if (!parsed) return null;
  const { type, shortcode } = parsed;
  const urlIndicatesVideo = type === "reel" || type === "tv";
  let imageFallback: DirectSocialMedia | null = null;

  // 1. Try /embed/captioned/
  const embedUrls = type === "reel"
    ? [
        `https://www.instagram.com/reel/${shortcode}/embed/captioned/`,
        `https://www.instagram.com/p/${shortcode}/embed/captioned/`,
      ]
    : [
        `https://www.instagram.com/p/${shortcode}/embed/captioned/`,
        `https://www.instagram.com/reel/${shortcode}/embed/captioned/`,
      ];

  const fetchEmbed = async (embedUrl: string): Promise<DirectSocialMedia | null> => {
    try {
      const res = await fetch(embedUrl, {
        headers: {
          "User-Agent": DESKTOP_USER_AGENT,
          "Accept-Language": "en-US,en;q=0.9",
          Referer: "https://www.instagram.com/",
        },
        signal: AbortSignal.timeout(8_000),
      });
      if (!res.ok) return null;
      const html = await res.text();

      const additional = html.match(/window\.__additionalDataLoaded\(\s*['"][^'"]+['"]\s*,\s*(\{[\s\S]*?\})\s*\)\s*;/);
      if (additional) {
        try {
          const result = parseInstagramMediaNode(
            JSON.parse(additional[1]) as Record<string, unknown>,
            shortcode,
            canonicalUrl,
            urlIndicatesVideo,
          );
          if (result) return result;
        } catch {
          // continue to regex fallback
        }
      }

      const rawVideo = html.match(/"video_url"\s*:\s*"((?:\\.|[^"\\])+)"/i)?.[1];
      const videoUrl = rawVideo ? unescapeMediaUrl(rawVideo) : null;
      const rawDisplay = html.match(/"display_url"\s*:\s*"((?:\\.|[^"\\])+)"/i)?.[1];
      const displayUrl = rawDisplay ? unescapeMediaUrl(rawDisplay) : null;
      const username = html.match(/"username"\s*:\s*"([A-Za-z0-9._]{1,64})"/)?.[1] ?? "Instagram";

      if (isAllowedMediaUrl("instagram", videoUrl)) {
        return {
          info: {
            id: shortcode,
            title: "Instagram Video",
            thumbnail: isAllowedMediaUrl("instagram", displayUrl) ? displayUrl : null,
            channelName: username,
            duration: 0,
            height: null,
            mediaType: "video",
          },
          directUrl: videoUrl,
          hlsUrl: null,
          canonicalUrl,
          isVideoPost: true,
        };
      }
      return null;
    } catch {
      return null;
    }
  };

  const fetchGraphQl = async (docId: string): Promise<DirectSocialMedia | null> => {
    try {
      const variables = JSON.stringify({
        shortcode,
        fetch_tagged_user_count: null,
        hoisted_comment_id: null,
        hoisted_reply_id: null,
      });
      const res = await fetch("https://www.instagram.com/graphql/query", {
        method: "POST",
        headers: {
          "User-Agent": DESKTOP_USER_AGENT,
          "Content-Type": "application/x-www-form-urlencoded",
          Origin: "https://www.instagram.com",
          Referer: canonicalUrl,
          "X-IG-App-ID": IG_APP_ID,
          "X-ASBD-ID": "129477",
          "X-FB-Friendly-Name": "PolarisPostActionLoadPostQueryQuery",
        },
        body: new URLSearchParams({ variables, doc_id: docId }).toString(),
        signal: AbortSignal.timeout(8_000),
      });
      if (!res.ok) return null;
      const data = (await res.json()) as Record<string, unknown>;
      return parseInstagramMediaNode(data, shortcode, canonicalUrl, urlIndicatesVideo);
    } catch {
      return null;
    }
  };

  // Fast parallel probe: race primary embed endpoint vs primary GraphQL query
  const primaryResults = await Promise.all([
    fetchEmbed(embedUrls[0]),
    fetchGraphQl(IG_GRAPHQL_DOC_IDS[0]),
  ]);
  for (const res of primaryResults) {
    if (res?.info.mediaType === "video") return res;
    if (res && !res.isVideoPost && !imageFallback) imageFallback = res;
  }

  // Secondary parallel fallback if both primary probes missed video
  const secondaryResults = await Promise.all([
    embedUrls[1] ? fetchEmbed(embedUrls[1]) : Promise.resolve(null),
    IG_GRAPHQL_DOC_IDS[1] ? fetchGraphQl(IG_GRAPHQL_DOC_IDS[1]) : Promise.resolve(null),
  ]);
  for (const res of secondaryResults) {
    if (res?.info.mediaType === "video") return res;
    if (res && !res.isVideoPost && !imageFallback) imageFallback = res;
  }

  return imageFallback;
}

function getYtDlpCommands(): Array<{ cmd: string; args: string[] }> {
  const binaryName = process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp";
  const localPaths = [
    resolve(process.cwd(), binaryName),
    resolve(process.cwd(), "../../", binaryName),
  ].filter((candidate) => existsSync(candidate));

  const commands: Array<{ cmd: string; args: string[] }> = [
    ...(preferredSocialYtDlpCommand ? [preferredSocialYtDlpCommand] : []),
    ...(process.env.YT_DLP_PATH ? [{ cmd: process.env.YT_DLP_PATH, args: [] }] : []),
    ...localPaths.map((cmd) => ({ cmd, args: [] })),
    { cmd: "yt-dlp", args: [] },
    { cmd: "python3", args: ["-m", "yt_dlp"] },
    { cmd: "python", args: ["-m", "yt_dlp"] },
  ];

  return commands.filter(
    (command, index) =>
      commands.findIndex(
        (candidate) =>
          candidate.cmd === command.cmd &&
          candidate.args.join("\0") === command.args.join("\0"),
      ) === index,
  );
}

async function fetchViaCobalt(url: string, platform: SocialVideoPlatform): Promise<SocialVideoInfo | null> {
  const result = await cobaltFetch(url, {
    downloadMode: "auto",
    videoQuality: "max",
    timeoutMs: 30_000,
    apiUrl: process.env.COBALT_API_URL,
    apiKey: process.env.COBALT_API_KEY,
  });
  if (!result?.url) return null;

  const providerName = platform === "instagram" ? "Instagram" : "Pinterest";
  const isImage = /\.(?:jpe?g|png|webp|gif)(?:\?|$)/i.test(result.filename ?? result.url);
  return {
    id: "",
    title: `${providerName} ${isImage ? "Image" : "Video"}`,
    thumbnail: null,
    channelName: providerName,
    duration: 0,
    height: null,
    mediaType: isImage ? "image" : "video",
  };
}

async function fetchSocialVideoInfoUncached(
  url: string,
  platform: SocialVideoPlatform,
): Promise<SocialVideoInfo | null> {
  if (!isSocialVideoUrl(url, platform)) return null;
  const providerName = platform === "instagram" ? "Instagram" : "Pinterest";
  const canonicalUrl = await resolveCanonicalUrl(platform, url);

  // Tier 1: Direct extraction (fast, avoids yt-dlp cold start)
  const direct = platform === "instagram"
    ? await extractInstagramDirect(canonicalUrl)
    : await extractPinterestDirect(canonicalUrl);
  if (direct && direct.info.mediaType === "video" && (direct.directUrl || direct.hlsUrl)) {
    return direct.info;
  }

  // Tier 2: yt-dlp extraction
  for (const command of getYtDlpCommands()) {
    const { cmd, args } = command;
    try {
      const { stdout } = await execFileAsync(
        cmd,
        [
          ...args,
          "--dump-single-json",
          "--no-playlist",
          "--playlist-items", "1",
          "--no-warnings",
          "--no-check-certificates",
          "--socket-timeout", "12",
          canonicalUrl,
        ],
        { timeout: 30_000, maxBuffer: 10 * 1024 * 1024 },
      );
      preferredSocialYtDlpCommand = command;
      const data = JSON.parse(stdout) as YtDlpOutput;
      const heights = (data.formats ?? [])
        .filter((format) =>
          format.vcodec !== "none" &&
          (format.url || data.url) &&
          Number.isFinite(format.height),
        )
        .map((format) => format.height!)
        .filter((height) => height > 0);
      if (typeof data.height === "number" && data.height > 0) {
        heights.push(data.height);
      }
      const hasDirectVideo =
        Boolean(data.url) ||
        (data.formats ?? []).some((format) =>
          Boolean(format.url) && format.vcodec !== "none",
        );

      if (!hasDirectVideo) {
        logger.warn({ url: canonicalUrl, platform, cmd }, "social video: no downloadable video formats found");
        continue;
      }

      return {
        id: data.id ?? "",
        title: data.title ?? `${providerName} Video`,
        thumbnail: data.thumbnail ?? null,
        channelName: data.channel ?? data.uploader ?? providerName,
        duration: data.duration ?? 0,
        height: heights.length > 0 ? Math.max(...heights) : null,
        mediaType: "video",
      };
    } catch (err) {
      logger.debug({ err, url: canonicalUrl, platform, cmd }, "social video: yt-dlp info attempt failed");
    }
  }

  // Tier 3: Verified image fallback if not a video post
  if (direct && direct.info.mediaType === "image" && !direct.isVideoPost) {
    return direct.info;
  }

  // Tier 4: Self-hosted Cobalt fallback
  logger.warn({ url: canonicalUrl, platform }, "social video: direct and yt-dlp failed, trying Cobalt fallback");
  return fetchViaCobalt(canonicalUrl, platform);
}

async function fetchSocialVideoInfo(
  url: string,
  platform: SocialVideoPlatform,
): Promise<SocialVideoInfo | null> {
  if (!isSocialVideoUrl(url, platform)) return null;
  const cacheKey = `${platform}:${url.trim()}`;
  const cached = socialInfoCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.info;

  const existing = socialInfoInFlight.get(cacheKey);
  if (existing) return existing;

  const task = fetchSocialVideoInfoUncached(url, platform).then((info) => {
    if (info) {
      if (socialInfoCache.size >= 250) {
        const oldest = socialInfoCache.keys().next().value;
        if (oldest) socialInfoCache.delete(oldest);
      }
      socialInfoCache.set(cacheKey, { expiresAt: Date.now() + SOCIAL_INFO_CACHE_TTL_MS, info });
    }
    return info;
  });

  socialInfoInFlight.set(cacheKey, task);
  try {
    return await task;
  } finally {
    socialInfoInFlight.delete(cacheKey);
  }
}

export function fetchPinterestInfo(url: string): Promise<SocialVideoInfo | null> {
  return fetchSocialVideoInfo(url, "pinterest");
}

export function fetchInstagramInfo(url: string): Promise<SocialVideoInfo | null> {
  return fetchSocialVideoInfo(url, "instagram");
}

function inferMimeAndExt(contentType: string | null, url: string, defaultIsImage: boolean): { contentType: string; extension: string } {
  const lowerType = (contentType ?? "").toLowerCase();
  const cleanUrl = url.split("?")[0].toLowerCase();
  if (lowerType.includes("image/png") || cleanUrl.endsWith(".png")) {
    return { contentType: "image/png", extension: "png" };
  }
  if (lowerType.includes("image/webp") || cleanUrl.endsWith(".webp")) {
    return { contentType: "image/webp", extension: "webp" };
  }
  if (lowerType.includes("image/gif") || cleanUrl.endsWith(".gif")) {
    return { contentType: "image/gif", extension: "gif" };
  }
  if (lowerType.includes("image/jpeg") || lowerType.includes("image/jpg") || cleanUrl.endsWith(".jpg") || cleanUrl.endsWith(".jpeg") || defaultIsImage) {
    return { contentType: "image/jpeg", extension: "jpg" };
  }
  return { contentType: "video/mp4", extension: "mp4" };
}

async function downloadDirectMediaToTemp(
  platform: SocialVideoPlatform,
  mediaUrl: string,
  isImage: boolean,
): Promise<SocialDownloadFile> {
  if (!isAllowedMediaUrl(platform, mediaUrl)) {
    throw new Error(`Disallowed media URL for ${platform}.`);
  }
  const upstream = await fetch(mediaUrl, {
    headers: {
      "User-Agent": DESKTOP_USER_AGENT,
      Referer: platform === "instagram" ? "https://www.instagram.com/" : "https://www.pinterest.com/",
    },
    signal: AbortSignal.timeout(90_000),
  });
  if (!upstream.ok || !upstream.body) {
    await upstream.body?.cancel();
    throw new Error(`Direct ${platform} media fetch failed (HTTP ${upstream.status}).`);
  }
  const ct = upstream.headers.get("content-type") ?? "";
  if (ct.includes("text/html") || ct.includes("application/json")) {
    await upstream.body.cancel();
    throw new Error(`Direct ${platform} CDN returned ${ct}.`);
  }
  const { contentType, extension } = inferMimeAndExt(ct, mediaUrl, isImage);
  const tmpPath = join(
    tmpdir(),
    `${platform}_${Date.now()}_${Math.random().toString(36).slice(2)}.${extension}`,
  );
  try {
    await pipeline(
      Readable.fromWeb(upstream.body as Parameters<typeof Readable.fromWeb>[0]),
      createWriteStream(tmpPath),
    );
    return { tmpPath, contentType, extension };
  } catch (err) {
    await unlinkAsync(tmpPath).catch(() => {});
    throw err;
  }
}

async function downloadSocialVideo(url: string, platform: SocialVideoPlatform): Promise<SocialDownloadFile> {
  if (!isSocialVideoUrl(url, platform)) {
    throw new Error(`Only ${platform} URLs are supported.`);
  }

  const canonicalUrl = await resolveCanonicalUrl(platform, url);

  // Tier 1: Direct MP4 (fast, requires no ffmpeg)
  const direct = platform === "instagram"
    ? await extractInstagramDirect(canonicalUrl)
    : await extractPinterestDirect(canonicalUrl);
  if (direct?.directUrl && direct.info.mediaType === "video") {
    try {
      return await downloadDirectMediaToTemp(platform, direct.directUrl, false);
    } catch (err) {
      logger.warn({ err, url: canonicalUrl, platform }, "social video: direct MP4 download failed, trying yt-dlp");
    }
  }

  // Tier 2: yt-dlp download (supports HLS/DASH + progressive fallback if ffmpeg unavailable)
  const tmpPath = join(
    tmpdir(),
    `${platform}_${Date.now()}_${Math.random().toString(36).slice(2)}.mp4`,
  );

  for (const { cmd, args } of getYtDlpCommands()) {
    const formatAttempts = [
      [
        "-f", "bestvideo[ext=mp4]+bestaudio[ext=m4a]/bestvideo+bestaudio/best[ext=mp4]/best",
        "--merge-output-format", "mp4",
        "--remux-video", "mp4",
      ],
      ["-f", "best[ext=mp4]/best"],
    ];
    for (const fmtArgs of formatAttempts) {
      try {
        await execFileAsync(
          cmd,
          [
            ...args,
            ...fmtArgs,
            "--no-playlist",
            "--playlist-items", "1",
            "--no-warnings",
            "--no-check-certificates",
            "--socket-timeout", "30",
            "-o", tmpPath,
            canonicalUrl,
          ],
          { timeout: 600_000, maxBuffer: 10 * 1024 * 1024 },
        );
        return { tmpPath, contentType: "video/mp4", extension: "mp4" };
      } catch (err) {
        await unlinkAsync(tmpPath).catch(() => {});
        logger.debug({ err, url: canonicalUrl, platform, cmd }, "social video: yt-dlp download attempt failed");
      }
    }
  }

  // Tier 3: Direct verified image fallback (e.g., Pinterest image pin)
  if (direct?.directUrl && direct.info.mediaType === "image" && !direct.isVideoPost) {
    return downloadDirectMediaToTemp(platform, direct.directUrl, true);
  }

  // Tier 4: Self-hosted Cobalt fallback
  logger.warn({ url: canonicalUrl, platform }, "social video: yt-dlp download failed, trying Cobalt fallback");
  try {
    const result = await cobaltFetch(canonicalUrl, {
      downloadMode: "auto",
      videoQuality: "max",
      timeoutMs: 30_000,
      apiUrl: process.env.COBALT_API_URL,
      apiKey: process.env.COBALT_API_KEY,
    });
    if (!result?.url) throw new Error("Cobalt did not return a downloadable media URL.");

    const upstream = await fetch(result.url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; HutaoTik/1.0)" },
      signal: AbortSignal.timeout(90_000),
    });
    if (!upstream.ok || !upstream.body) {
      throw new Error(`Cobalt media download failed (HTTP ${upstream.status}).`);
    }

    const { contentType, extension } = inferMimeAndExt(
      upstream.headers.get("content-type"),
      result.filename ?? result.url,
      false,
    );
    const cobaltTmpPath = join(
      tmpdir(),
      `${platform}_${Date.now()}_${Math.random().toString(36).slice(2)}.${extension}`,
    );

    try {
      await pipeline(
        Readable.fromWeb(upstream.body as Parameters<typeof Readable.fromWeb>[0]),
        createWriteStream(cobaltTmpPath),
      );
      return { tmpPath: cobaltTmpPath, contentType, extension };
    } catch (err) {
      await unlinkAsync(cobaltTmpPath).catch(() => {});
      throw err;
    }
  } catch (err) {
    await unlinkAsync(tmpPath).catch(() => {});
    logger.error({ err, url: canonicalUrl, platform }, "social video: download error");
    throw err;
  }
}

export function downloadPinterestVideo(url: string): Promise<SocialDownloadFile> {
  return downloadSocialVideo(url, "pinterest");
}

export function downloadInstagramVideo(url: string): Promise<SocialDownloadFile> {
  return downloadSocialVideo(url, "instagram");
}
