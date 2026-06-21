import { Router, type IRouter } from "express";
import { FetchTiktokVideoBody } from "@workspace/api-zod";

const router: IRouter = Router();

const TIKWM_API = "https://www.tikwm.com/api/";

const rateLimitMap = new Map<string, number>();
const RATE_LIMIT_MS = 3000;

interface TikwmFullData {
  id?: string;
  title?: string;
  play?: string;
  hdplay?: string;
  wmplay?: string;
  music?: string;
  music_info?: {
    id?: string;
    title?: string;
    play?: string;
    cover?: string;
    author?: string;
    original?: boolean;
    duration?: number;
    album?: string;
  };
  author?: {
    id?: string;
    unique_id?: string;
    nickname?: string;
    avatar?: string;
    signature?: string;
    verified?: boolean;
    followers?: number;
    following?: number;
    likes?: number;
    video_count?: number;
  };
  cover?: string;
  origin_cover?: string;
  duration?: number;
  images?: string[];
  play_count?: number;
  digg_count?: number;
  comment_count?: number;
  share_count?: number;
  download_count?: number;
  create_time?: number;
  size?: number;
  hd_size?: number;
  wm_size?: number;
  ratio?: string;
  region?: string;
  format?: string;
  width?: number;
  height?: number;
}

router.post("/tiktok/analyze", async (req, res): Promise<void> => {
  const parsed = FetchTiktokVideoBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request body" });
    return;
  }

  const { url } = parsed.data;

  if (!url || !url.includes("tiktok.com")) {
    res.status(400).json({ error: "Invalid TikTok URL. Please paste a valid TikTok link." });
    return;
  }

  const ip = (req.headers["x-forwarded-for"] as string) || req.socket.remoteAddress || "unknown";
  const lastRequest = rateLimitMap.get(ip) || 0;
  const now = Date.now();
  if (now - lastRequest < RATE_LIMIT_MS) {
    res.status(429).json({ error: `Please wait ${Math.ceil((RATE_LIMIT_MS - (now - lastRequest)) / 1000)} seconds.` });
    return;
  }
  rateLimitMap.set(ip, now);

  try {
    const response = await fetch(TIKWM_API, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ url, hd: "1" }),
    });

    if (!response.ok) {
      res.status(500).json({ error: "Failed to fetch video info. Please try again." });
      return;
    }

    const data = await response.json() as { code: number; msg: string; data?: TikwmFullData };

    if (data.code !== 0 || !data.data) {
      res.status(400).json({ error: data.msg || "Could not fetch video. The link may be invalid or private." });
      return;
    }

    const d = data.data;
    const isPhoto = !!(d.images && d.images.length > 0);

    res.json({
      id: d.id ?? "",
      caption: d.title ?? "Untitled",
      createTime: d.create_time ?? null,
      duration: d.duration ?? null,
      region: d.region ?? null,
      thumbnail: d.cover ?? d.origin_cover ?? null,
      isPhoto,
      photos: d.images ?? [],
      stats: {
        views: d.play_count ?? null,
        likes: d.digg_count ?? null,
        comments: d.comment_count ?? null,
        shares: d.share_count ?? null,
        downloads: d.download_count ?? null,
      },
      videoMeta: {
        ratio: d.ratio ?? null,
        hdSize: d.hd_size ?? null,
        normalSize: d.size ?? null,
        format: d.format ?? null,
        width: d.width ?? null,
        height: d.height ?? null,
      },
      author: {
        username: d.author?.unique_id ?? "unknown",
        displayName: d.author?.nickname ?? d.author?.unique_id ?? "Unknown",
        avatar: d.author?.avatar ?? null,
        bio: d.author?.signature ?? null,
        verified: d.author?.verified ?? false,
        followers: d.author?.followers ?? null,
        following: d.author?.following ?? null,
        likes: d.author?.likes ?? null,
        videoCount: d.author?.video_count ?? null,
      },
      music: {
        title: d.music_info?.title ?? "Unknown",
        author: d.music_info?.author ?? "Unknown",
        url: d.music_info?.play ?? null,
        cover: d.music_info?.cover ?? null,
        duration: d.music_info?.duration ?? null,
        album: d.music_info?.album ?? null,
        original: d.music_info?.original ?? null,
      },
      downloadUrls: {
        hd: d.hdplay ?? d.play ?? null,
        normal: d.play ?? null,
        low: d.wmplay ?? d.play ?? null,
        audio: d.music ?? null,
      },
    });
  } catch (err) {
    req.log.error({ err }, "TikTok analyze error");
    res.status(500).json({ error: "Failed to connect to TikTok service. Please try again." });
  }
});

router.post("/tiktok/fetch", async (req, res): Promise<void> => {
  const parsed = FetchTiktokVideoBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request body" });
    return;
  }

  const { url } = parsed.data;

  if (!url || !url.includes("tiktok.com")) {
    res.status(400).json({ error: "Invalid TikTok URL. Please paste a valid TikTok link." });
    return;
  }

  const ip = (req.headers["x-forwarded-for"] as string) || req.socket.remoteAddress || "unknown";
  const lastRequest = rateLimitMap.get(ip) || 0;
  const now = Date.now();
  if (now - lastRequest < RATE_LIMIT_MS) {
    res.status(429).json({ error: `Please wait ${Math.ceil((RATE_LIMIT_MS - (now - lastRequest)) / 1000)} seconds before fetching again.` });
    return;
  }
  rateLimitMap.set(ip, now);

  try {
    const response = await fetch(TIKWM_API, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ url, hd: "1" }),
    });

    if (!response.ok) {
      res.status(500).json({ error: "Failed to fetch video info. Please try again." });
      return;
    }

    const data = await response.json() as {
      code: number;
      msg: string;
      data?: {
        id: string;
        title: string;
        play: string;
        hdplay?: string;
        wmplay?: string;
        music: string;
        music_info: { title: string; author: string; play: string };
        author: { nickname: string; unique_id: string; avatar: string };
        cover: string;
        duration: number;
        images?: string[];
      };
    };

    if (data.code !== 0 || !data.data) {
      res.status(400).json({ error: data.msg || "Could not fetch video. The link may be invalid or private." });
      return;
    }

    const d = data.data;
    const isPhoto = !!(d.images && d.images.length > 0);

    res.json({
      id: d.id,
      title: d.title || "Untitled",
      author: d.author.nickname || d.author.unique_id,
      authorUsername: d.author.unique_id,
      authorAvatar: d.author.avatar || null,
      thumbnail: d.cover || null,
      duration: d.duration || null,
      downloadUrls: {
        hd: d.hdplay || d.play || null,
        normal: d.play || null,
        low: d.wmplay || d.play || null,
        audio: d.music || null,
      },
      isPhoto,
      photos: d.images || [],
      music: {
        title: d.music_info?.title || "Unknown",
        author: d.music_info?.author || "Unknown",
        url: d.music_info?.play || null,
      },
    });
  } catch (err) {
    req.log.error({ err }, "TikTok fetch error");
    res.status(500).json({ error: "Failed to connect to TikTok service. Please try again." });
  }
});

export default router;
