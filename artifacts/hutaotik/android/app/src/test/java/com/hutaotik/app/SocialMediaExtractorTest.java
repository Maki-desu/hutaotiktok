package com.hutaotik.app;

import static org.junit.Assert.*;

import org.junit.Test;

public class SocialMediaExtractorTest {

    @Test
    public void validatesPinterestAndInstagramUrls() {
        assertTrue(SocialMediaExtractor.isPinterestUrl("https://www.pinterest.com/pin/123456789/"));
        assertTrue(SocialMediaExtractor.isPinterestUrl("https://pin.it/abc123XYZ"));
        assertTrue(SocialMediaExtractor.isPinterestUrl("https://ph.pinterest.com/pin/987654321/sent/?invite_code=abc"));
        assertTrue(SocialMediaExtractor.isPinterestUrl("https://www.pinterest.co.uk/pin/123456789/"));
        assertTrue(SocialMediaExtractor.isPinterestUrl("https://v1.pinimg.com/videos/mc/720p/aa/bb/cc/test.mp4"));

        assertFalse(SocialMediaExtractor.isPinterestUrl("https://pinterest.com.evil.example/pin/123/"));
        assertFalse(SocialMediaExtractor.isPinterestUrl("ftp://pinterest.com/pin/123/"));
        assertFalse(SocialMediaExtractor.isPinterestUrl("not a url"));

        assertTrue(SocialMediaExtractor.isInstagramUrl("https://www.instagram.com/reel/DAO49r3SsBR/?igsh=xyz"));
        assertTrue(SocialMediaExtractor.isInstagramUrl("https://www.instagram.com/share/reel/BAc123xyz"));
        assertTrue(SocialMediaExtractor.isInstagramUrl("https://instagr.am/p/ABC123xyz/"));

        assertFalse(SocialMediaExtractor.isInstagramUrl("https://instagram.com.evil.example/reel/ABC123/"));
        assertFalse(SocialMediaExtractor.isInstagramUrl("javascript:alert(1)"));
    }

    @Test
    public void canonicalizesPinterestAndInstagramUrlsWithoutNetwork() {
        assertEquals(
            "https://www.pinterest.com/pin/123456789/",
            SocialMediaExtractor.canonicalizeUrlWithoutNetwork(
                "pinterest",
                "https://ph.pinterest.com/pin/123456789/sent/?invite_code=xyz&sfo=1"
            )
        );
        assertEquals(
            "https://www.pinterest.com/pin/987654321/",
            SocialMediaExtractor.canonicalizeUrlWithoutNetwork(
                "pinterest",
                "https://www.pinterest.co.uk/pin/cool-slug--987654321/"
            )
        );
        assertEquals(
            "https://www.instagram.com/reel/DAO49r3SsBR/",
            SocialMediaExtractor.canonicalizeUrlWithoutNetwork(
                "instagram",
                "https://www.instagram.com/reels/DAO49r3SsBR/?igsh=MzRlODBiNWFlZA=="
            )
        );
        assertEquals(
            "https://www.instagram.com/reel/DAO49r3SsBR/",
            SocialMediaExtractor.canonicalizeUrlWithoutNetwork(
                "instagram",
                "https://www.instagram.com/accounts/login/?next=%2Freel%2FDAO49r3SsBR%2F"
            )
        );
        assertEquals(
            "https://www.instagram.com/p/C9abcDEF123/",
            SocialMediaExtractor.canonicalizeUrlWithoutNetwork(
                "instagram",
                "https://www.instagram.com/someuser/p/C9abcDEF123/"
            )
        );
    }

    @Test
    public void enforcesAllowedMediaCdnHosts() {
        assertTrue(SocialMediaExtractor.isAllowedMediaUrl(
            "pinterest",
            "https://v1.pinimg.com/videos/mc/720p/12/34/56/sample.mp4"
        ));
        assertFalse(SocialMediaExtractor.isAllowedMediaUrl(
            "pinterest",
            "https://evil.com/sample.mp4"
        ));
        assertFalse(SocialMediaExtractor.isAllowedMediaUrl(
            "pinterest",
            "http://v1.pinimg.com/videos/sample.mp4"
        ));
        assertTrue(SocialMediaExtractor.isAllowedMediaUrl(
            "instagram",
            "https://scontent-sin6-2.cdninstagram.com/v/t50.2886-16/video.mp4"
        ));
        assertTrue(SocialMediaExtractor.isAllowedMediaUrl(
            "instagram",
            "https://video.fsgn5-1.fna.fbcdn.net/v/video.mp4"
        ));
        assertFalse(SocialMediaExtractor.isAllowedMediaUrl(
            "instagram",
            "https://user:pass@scontent.cdninstagram.com/video.mp4"
        ));
    }

    @Test
    public void parsesPinterestPwsDataVideoAndImageFallback() {
        String videoHtml = "<html><head><meta property=\"og:title\" content=\"Cool Edit | Pinterest\"></head>" +
            "<body><script id=\"__PWS_DATA__\" type=\"application/json\">" +
            "{\"props\":{\"initialReduxState\":{\"pins\":{\"12345\":{" +
            "\"grid_title\":\"Anime Edit\"," +
            "\"pinner\":{\"full_name\":\"Hu Tao\"}," +
            "\"images\":{\"orig\":{\"url\":\"https://i.pinimg.com/originals/ab/cd/ef/cover.jpg\"}}," +
            "\"videos\":{\"video_list\":{" +
            "\"V_480P\":{\"url\":\"https://v1.pinimg.com/videos/mc/480p/ab/cd/ef/v480.mp4\",\"height\":480,\"duration\":12000}," +
            "\"V_720P\":{\"url\":\"https://v1.pinimg.com/videos/mc/720p/ab/cd/ef/v720.mp4\",\"height\":720,\"duration\":12000}," +
            "\"V_HLSV4\":{\"url\":\"https://v1.pinimg.com/videos/iht/hls/ab/cd/ef/playlist.m3u8\",\"height\":1080}" +
            "}}}}}}}</script></body></html>";

        SocialMediaExtractor.ExtractedMedia video = SocialMediaExtractor.parsePinterestHtml(
            "12345",
            "https://www.pinterest.com/pin/12345/",
            videoHtml
        );
        assertNotNull(video);
        assertTrue(video.hasDownloadableVideo());
        assertEquals("video", video.mediaType);
        assertEquals("Anime Edit", video.title);
        assertEquals("Hu Tao", video.channelName);
        assertEquals("https://v1.pinimg.com/videos/mc/720p/ab/cd/ef/v720.mp4", video.directUrl);
        assertEquals("https://v1.pinimg.com/videos/iht/hls/ab/cd/ef/playlist.m3u8", video.hlsUrl);
        assertEquals(Integer.valueOf(1080), video.height);
        assertEquals(12, video.duration);

        String imageOnlyHtml = "<html><head>" +
            "<meta property=\"og:title\" content=\"Wallpaper | Pinterest\">" +
            "<meta property=\"og:image\" content=\"https://i.pinimg.com/originals/11/22/33/wall.png\">" +
            "</head><body></body></html>";
        SocialMediaExtractor.ExtractedMedia image = SocialMediaExtractor.parsePinterestHtml(
            "99999",
            "https://www.pinterest.com/pin/99999/",
            imageOnlyHtml
        );
        assertNotNull(image);
        assertTrue(image.hasDownloadableImage());
        assertEquals("image", image.mediaType);
        assertEquals("Wallpaper", image.title);
        assertEquals("https://i.pinimg.com/originals/11/22/33/wall.png", image.directUrl);
    }

    @Test
    public void parsesInstagramEmbedAndGraphQlPayloads() {
        String embedHtml = "<script>window.__additionalDataLoaded('extra', {" +
            "\"shortcode_media\":{" +
            "\"shortcode\":\"DAO49r3SsBR\"," +
            "\"is_video\":true," +
            "\"video_url\":\"https:\\/\\/scontent.cdninstagram.com\\/v\\/reel.mp4?a=1\\u0026b=2\"," +
            "\"display_url\":\"https:\\/\\/scontent.cdninstagram.com\\/v\\/thumb.jpg\"," +
            "\"video_duration\":18.4," +
            "\"dimensions\":{\"height\":1920,\"width\":1080}," +
            "\"owner\":{\"username\":\"creator_demo\"}," +
            "\"edge_media_to_caption\":{\"edges\":[{\"node\":{\"text\":\"Amazing reel!\"}}]}" +
            "}});</script>";

        SocialMediaExtractor.ExtractedMedia fromEmbed = SocialMediaExtractor.parseInstagramEmbedHtml(
            "DAO49r3SsBR",
            "https://www.instagram.com/reel/DAO49r3SsBR/",
            true,
            embedHtml
        );
        assertNotNull(fromEmbed);
        assertTrue(fromEmbed.hasDownloadableVideo());
        assertEquals("https://scontent.cdninstagram.com/v/reel.mp4?a=1&b=2", fromEmbed.directUrl);
        assertEquals("Amazing reel!", fromEmbed.title);
        assertEquals("creator_demo", fromEmbed.channelName);
        assertEquals(Integer.valueOf(1920), fromEmbed.height);
        assertEquals(18, fromEmbed.duration);

        String gqlJson = "{\"data\":{\"xdt_shortcode_media\":{" +
            "\"shortcode\":\"XYZ12345\"," +
            "\"is_video\":true," +
            "\"video_versions\":[" +
            "{\"height\":720,\"width\":405,\"url\":\"https://scontent.cdninstagram.com/v/720.mp4\"}," +
            "{\"height\":1280,\"width\":720,\"url\":\"https://scontent.cdninstagram.com/v/1280.mp4\"}" +
            "]," +
            "\"display_url\":\"https://scontent.cdninstagram.com/v/poster.jpg\"," +
            "\"owner\":{\"username\":\"ig_user\"}" +
            "}}}";
        SocialMediaExtractor.ExtractedMedia fromGql = SocialMediaExtractor.parseInstagramGraphQlJson(
            "XYZ12345",
            "https://www.instagram.com/reel/XYZ12345/",
            true,
            gqlJson
        );
        assertNotNull(fromGql);
        assertTrue(fromGql.hasDownloadableVideo());
        assertEquals("https://scontent.cdninstagram.com/v/1280.mp4", fromGql.directUrl);
        assertEquals("ig_user", fromGql.channelName);
        assertEquals(Integer.valueOf(1280), fromGql.height);
    }

    @Test
    public void doesNotMistakeReelEmbedPosterForPhotoDownload() {
        String reelPosterOnlyHtml = "<html><head>" +
            "<meta property=\"og:image\" content=\"https://scontent.cdninstagram.com/v/poster.jpg\">" +
            "</head><body><div class=\"WatchOnInstagram\">Watch on Instagram</div></body></html>";

        SocialMediaExtractor.ExtractedMedia result = SocialMediaExtractor.parseInstagramEmbedHtml(
            "REEL12345",
            "https://www.instagram.com/reel/REEL12345/",
            true,
            reelPosterOnlyHtml
        );
        assertNull(result);
    }
}
