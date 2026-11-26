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
  formats: FxTwitterFormat[];
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
      videos?: Array<{
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
      }>;
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
  if (result.code !== 200 || !result.tweet) {
    throw new Error("The X video provider could not find this post.");
  }

  const sourceVideos = result.tweet.media?.videos ?? [];
  const selectedVideo = sourceVideos
    .map((video) => {
      const formats = (video.formats ?? [])
        .filter((format): format is typeof format & { url: string } =>
          format.container === "mp4" &&
          format.codec === "h264" &&
          typeof format.url === "string" &&
          isVideoUrl(format.url)
        )
        .map((format) => {
          const dimensions = new URL(format.url).pathname.match(/\/(\d{2,4})x(\d{2,4})\//);
          const height = dimensions ? Number(dimensions[2]) : video.height ?? 0;
          return {
            height,
            bitrate: format.bitrate ?? 0,
            downloadUrl: format.url,
          };
        })
        .filter((format) => format.height > 0)
        .sort((a, b) => b.height - a.height || b.bitrate - a.bitrate);
      return { video, formats };
    })
    .find(({ formats }) => formats.length > 0);

  if (!selectedVideo) {
    throw new Error("No downloadable H.264 MP4 video was found in this X post.");
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
    title: result.tweet.text?.trim() || "X Video",
    thumbnail: selectedVideo.video.thumbnail_url ?? null,
    channelName: result.tweet.author?.name ??
      result.tweet.author?.screen_name ??
      "X Creator",
    duration: selectedVideo.video.duration ?? 0,
    formats: [...formatsByHeight.values()].sort((a, b) => b.height - a.height),
  };
}
