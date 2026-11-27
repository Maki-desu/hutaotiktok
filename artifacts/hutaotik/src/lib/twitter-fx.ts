export interface FxTwitterFormat {
  height: number;
  qualityLabel: string;
  downloadUrl: string;
}

export interface FxTwitterVideoInfo {
  id: string;
  title: string;
  thumbnail: string | null;
  channelName: string;
  duration: number;
  isGif: boolean;
  formats: FxTwitterFormat[];
}

interface FxTwitterVideoEntry {
  type?: string;
  url?: string;
  thumbnail_url?: string;
  duration?: number;
  width?: number;
  height?: number;
  formats?: Array<{
    url?: string;
    bitrate?: number;
    container?: string;
    codec?: string;
  }>;
}

interface FxTwitterApiResponse {
  code?: number;
  tweet?: {
    id?: string;
    text?: string;
    author?: {
      name?: string;
      screen_name?: string;
    };
    media?: {
      videos?: FxTwitterVideoEntry[];
      all?: FxTwitterVideoEntry[];
    };
  };
}

function isVideoUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "video.twimg.com";
  } catch {
    return false;
  }
}

function isMp4Url(value: string): boolean {
  try {
    return new URL(value).pathname.toLowerCase().endsWith(".mp4");
  } catch {
    return false;
  }
}

export function parseFxTwitterResponse(
  result: FxTwitterApiResponse,
  statusId: string,
): FxTwitterVideoInfo {
  if (result.code !== 200 || !result.tweet) {
    throw new Error("The X video provider could not find this post.");
  }

  const sourceVideos =
    result.tweet.media?.videos && result.tweet.media.videos.length > 0
      ? result.tweet.media.videos
      : (result.tweet.media?.all ?? []).filter(
          (item) => item.type === "video" || item.type === "gif",
        );

  const selectedVideo = sourceVideos
    .map((video) => {
      const mp4Formats = (video.formats ?? []).filter(
        (format): format is typeof format & { url: string } =>
          typeof format.url === "string" &&
          isVideoUrl(format.url) &&
          (format.container === "mp4" || isMp4Url(format.url)),
      );
      const h264Formats = mp4Formats.filter((format) => format.codec === "h264");
      const preferred = h264Formats.length > 0 ? h264Formats : mp4Formats;

      const formats = preferred
        .map((format) => {
          const dimensions = new URL(format.url).pathname.match(/\/(\d{2,4})x(\d{2,4})\//);
          const height = dimensions
            ? Number(dimensions[2])
            : (video.height && video.height > 0 ? video.height : 480);
          return {
            height,
            bitrate: format.bitrate ?? 0,
            downloadUrl: format.url,
          };
        })
        .filter((format) => format.height > 0)
        .sort((a, b) => b.height - a.height || b.bitrate - a.bitrate);

      // Twitter GIFs often provide the direct /tweet_video/*.mp4 on `video.url` without `formats`
      if (
        formats.length === 0 &&
        typeof video.url === "string" &&
        isVideoUrl(video.url) &&
        isMp4Url(video.url)
      ) {
        formats.push({
          height: video.height && video.height > 0 ? video.height : 480,
          bitrate: 0,
          downloadUrl: video.url,
        });
      }

      const isGif =
        video.type?.toLowerCase() === "gif" ||
        (typeof video.url === "string" && video.url.includes("/tweet_video/")) ||
        formats.some((format) => format.downloadUrl.includes("/tweet_video/"));

      return { video, formats, isGif };
    })
    .find(({ formats }) => formats.length > 0);

  if (!selectedVideo) {
    throw new Error("No downloadable video or GIF was found in this X post.");
  }

  const formatsByHeight = new Map<number, FxTwitterFormat>();
  for (const format of selectedVideo.formats) {
    if (!formatsByHeight.has(format.height)) {
      formatsByHeight.set(format.height, {
        height: format.height,
        qualityLabel: `${format.height}p`,
        downloadUrl: format.downloadUrl,
      });
    }
  }

  return {
    id: result.tweet.id ?? statusId,
    title: result.tweet.text?.trim() || (selectedVideo.isGif ? "X GIF" : "X Video"),
    thumbnail: selectedVideo.video.thumbnail_url ?? null,
    channelName: result.tweet.author?.name ??
      result.tweet.author?.screen_name ??
      "X Creator",
    duration: selectedVideo.video.duration ?? 0,
    isGif: selectedVideo.isGif,
    formats: [...formatsByHeight.values()].sort((a, b) => b.height - a.height),
  };
}

export async function fetchTwitterFromFx(
  statusUrl: string,
  signal?: AbortSignal,
): Promise<FxTwitterVideoInfo> {
  const parsedUrl = new URL(statusUrl);
  const statusId = parsedUrl.pathname.match(/\/status(?:es)?\/(\d+)/i)?.[1];
  if (!statusId) throw new Error("The X post URL does not contain a valid post ID.");

  const response = await fetch(`https://api.fxtwitter.com/i/status/${statusId}`, {
    headers: { Accept: "application/json" },
    signal,
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`The X video provider returned HTTP ${response.status}.`);
  }

  const result = await response.json() as FxTwitterApiResponse;
  return parseFxTwitterResponse(result, statusId);
}
