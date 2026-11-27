import { describe, expect, it } from "vitest";
import { parseFxTwitterResponse } from "./twitter-fx";

describe("parseFxTwitterResponse", () => {
  it("detects and extracts X GIFs with direct tweet_video URLs and missing codec fields", () => {
    const info = parseFxTwitterResponse(
      {
        code: 200,
        tweet: {
          id: "1234567890",
          text: "Funny reaction gif",
          author: { name: "Hutao", screen_name: "hutaotik" },
          media: {
            videos: [
              {
                type: "gif",
                url: "https://video.twimg.com/tweet_video/GAbCdEf.mp4",
                thumbnail_url: "https://pbs.twimg.com/tweet_video_thumb/GAbCdEf.jpg",
                width: 498,
                height: 360,
                duration: 3.2,
              },
            ],
          },
        },
      },
      "1234567890",
    );

    expect(info.isGif).toBe(true);
    expect(info.formats).toHaveLength(1);
    expect(info.formats[0].height).toBe(360);
    expect(info.formats[0].downloadUrl).toBe("https://video.twimg.com/tweet_video/GAbCdEf.mp4");
  });

  it("extracts regular multi-resolution X videos with isGif = false", () => {
    const info = parseFxTwitterResponse(
      {
        code: 200,
        tweet: {
          id: "987654321",
          text: "Regular video",
          author: { name: "Creator" },
          media: {
            videos: [
              {
                type: "video",
                duration: 18,
                formats: [
                  {
                    container: "mp4",
                    codec: "h264",
                    bitrate: 832000,
                    url: "https://video.twimg.com/ext_tw_video/1/pu/vid/avc1/640x360/clip.mp4",
                  },
                  {
                    container: "mp4",
                    codec: "h264",
                    bitrate: 2176000,
                    url: "https://video.twimg.com/ext_tw_video/1/pu/vid/avc1/1280x720/clip.mp4",
                  },
                ],
              },
            ],
          },
        },
      },
      "987654321",
    );

    expect(info.isGif).toBe(false);
    expect(info.formats.map((f) => f.height)).toEqual([720, 360]);
  });
});
