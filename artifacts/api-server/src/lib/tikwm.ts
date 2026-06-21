import { logger } from "./logger";

const TIKWM_BASE = "https://www.tikwm.com/api";

export interface TikwmUserInfo {
  videoCount: number;
  avatarUrl: string | null;
  nickname: string | null;
  bio: string | null;
}

export interface TikwmVideoData {
  videoId: string;
  title: string;
  authorUsername: string;
  authorDisplayName: string | null;
  authorAvatar: string | null;
  thumbnail: string | null;
  playUrl: string;
  tiktokUrl: string;
}

interface TikwmUserInfoResponse {
  code: number;
  msg?: string;
  data?: {
    user?: {
      uniqueId?: string;
      nickname?: string;
      signature?: string;
      avatarThumb?: string;
      avatarMedium?: string;
      avatarLarger?: string;
      videoCount?: number;
    };
    stats?: {
      videoCount?: number;
    };
  };
}

interface TikwmUserPostsResponse {
  code: number;
  msg?: string;
  data?: {
    videos?: Array<{
      video_id?: string;
      id?: string;
      title?: string;
      cover?: string;
      origin_cover?: string;
      author?: {
        unique_id?: string;
        nickname?: string;
        avatar?: string;
      };
    }>;
  };
}

interface TikwmVideoResponse {
  code: number;
  msg?: string;
  data?: {
    id?: string;
    title?: string;
    play?: string;
    hdplay?: string;
    cover?: string;
    origin_cover?: string;
    author?: {
      unique_id?: string;
      nickname?: string;
      avatar?: string;
    };
  };
}

export async function fetchTikwmUserInfo(username: string): Promise<TikwmUserInfo | null> {
  const clean = username.replace(/^@/, "");
  const url = `${TIKWM_BASE}/user/info?unique_id=${encodeURIComponent("@" + clean)}`;

  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; HutaoTik/1.0)" },
      signal: AbortSignal.timeout(15_000),
    });

    if (!res.ok) {
      logger.warn({ status: res.status, username: clean }, "tikwm: user/info non-ok");
      return null;
    }

    const data = (await res.json()) as TikwmUserInfoResponse;

    if (data.code !== 0 || !data.data) {
      logger.warn({ code: data.code, msg: data.msg, username: clean }, "tikwm: user/info bad code");
      return null;
    }

    const user = data.data.user;
    const stats = data.data.stats;

    const videoCount = stats?.videoCount ?? user?.videoCount ?? null;

    if (videoCount === null) {
      logger.warn({ username: clean }, "tikwm: videoCount missing in response");
      return null;
    }

    const avatarUrl = user?.avatarLarger ?? user?.avatarMedium ?? user?.avatarThumb ?? null;
    const nickname = user?.nickname ?? null;
    const bio = user?.signature ?? null;

    return { videoCount, avatarUrl, nickname, bio };
  } catch (err) {
    logger.error({ err, username: clean }, "tikwm: fetchUserInfo error");
    return null;
  }
}

export async function fetchLatestUserVideoUrl(username: string): Promise<string | null> {
  const clean = username.replace(/^@/, "");
  const url = `${TIKWM_BASE}/user/posts?unique_id=${encodeURIComponent("@" + clean)}&count=1&cursor=0`;

  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; HutaoTik/1.0)" },
      signal: AbortSignal.timeout(15_000),
    });

    if (!res.ok) {
      logger.warn({ status: res.status, username: clean }, "tikwm: user/posts non-ok");
      return null;
    }

    const data = (await res.json()) as TikwmUserPostsResponse;

    if (data.code !== 0 || !data.data?.videos?.length) {
      logger.warn({ code: data.code, username: clean }, "tikwm: user/posts no videos");
      return null;
    }

    const latest = data.data.videos[0];
    const videoId = latest.video_id ?? latest.id ?? null;
    if (!videoId) return null;

    return `https://www.tiktok.com/@${clean}/video/${videoId}`;
  } catch (err) {
    logger.error({ err, username: clean }, "tikwm: fetchLatestUserVideoUrl error");
    return null;
  }
}

export async function fetchTikwmVideo(tiktokUrl: string): Promise<TikwmVideoData | null> {
  try {
    const res = await fetch(`${TIKWM_BASE}/`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ url: tiktokUrl, hd: "1" }),
      signal: AbortSignal.timeout(15_000),
    });

    if (!res.ok) return null;

    const data = (await res.json()) as TikwmVideoResponse;

    if (data.code !== 0 || !data.data) {
      logger.warn({ code: data.code, msg: data.msg, url: tiktokUrl }, "tikwm: video fetch bad code");
      return null;
    }

    const d = data.data;
    const videoId = d.id ?? null;
    const playUrl = d.hdplay ?? d.play ?? null;

    if (!videoId || !playUrl) return null;

    return {
      videoId,
      title: d.title || "Untitled",
      authorUsername: d.author?.unique_id ?? "unknown",
      authorDisplayName: d.author?.nickname ?? null,
      authorAvatar: d.author?.avatar ?? null,
      thumbnail: d.cover ?? d.origin_cover ?? null,
      playUrl,
      tiktokUrl,
    };
  } catch (err) {
    logger.error({ err, url: tiktokUrl }, "tikwm: fetchVideo error");
    return null;
  }
}
