package com.hutaotik.app;

import java.io.BufferedInputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URI;
import java.net.URL;
import java.net.URLDecoder;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.CompletionService;
import java.util.concurrent.ExecutorCompletionService;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Pure-Java URL normalizer, direct HTML/JSON extractor, and media downloader for
 * Pinterest and Instagram. Runs on-device in Android (using the user's residential/mobile IP)
 * and has zero Android SDK dependencies so it can be unit-tested directly on the JVM.
 */
public final class SocialMediaExtractor {
    private static final String DESKTOP_USER_AGENT =
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36";
    private static final String IG_APP_ID = "936619743392459";
    private static final String[] IG_GRAPHQL_DOC_IDS = {
        "8845758582119845",
        "10015901848480474",
    };

    private static final Pattern PINTEREST_LOCALE_HOST = Pattern.compile(
        "(^|\\.)pinterest\\.[a-z]{2,}(?:\\.[a-z]{2,3})?$",
        Pattern.CASE_INSENSITIVE
    );
    private static final Pattern PINTEREST_PIN_ID = Pattern.compile(
        "/pin/(?:[^/?#]*--)?(\\d+)(?:/|\\?|$)",
        Pattern.CASE_INSENSITIVE
    );
    private static final Pattern PINTEREST_DIRECT_VIDEO = Pattern.compile(
        "https?(?:\\\\u003a|:)(?:\\\\/|/){2}v[0-9a-z-]*\\.pinimg\\.com(?:\\\\/|/)videos(?:\\\\/|/)[^\\s\"'<>\\\\]+\\.(?:mp4|m3u8)(?:\\?[^\\s\"'<>\\\\]*)?",
        Pattern.CASE_INSENSITIVE
    );
    private static final Pattern PINTEREST_DIRECT_IMAGE = Pattern.compile(
        "https?(?:\\\\u003a|:)(?:\\\\/|/){2}i\\.pinimg\\.com(?:\\\\/|/)originals(?:\\\\/|/)[^\\s\"'<>\\\\]+\\.(?:jpg|jpeg|png|webp|gif)",
        Pattern.CASE_INSENSITIVE
    );
    private static final Pattern INSTAGRAM_SHORTCODE = Pattern.compile(
        "/(reel|reels|p|tv)/([A-Za-z0-9_-]{5,})(?:/|\\?|$)",
        Pattern.CASE_INSENSITIVE
    );
    private static final Pattern SCRIPT_PWS_DATA = Pattern.compile(
        "<script[^>]+id=[\"']__PWS_DATA__[\"'][^>]*>(.*?)</script>",
        Pattern.CASE_INSENSITIVE | Pattern.DOTALL
    );
    private static final Pattern SCRIPT_JSON_GENERIC = Pattern.compile(
        "<script[^>]+(?:type=[\"']application/(?:ld\\+)?json[\"']|data-relay-(?:completed-)?response=[\"']true[\"'])[^>]*>(.*?)</script>",
        Pattern.CASE_INSENSITIVE | Pattern.DOTALL
    );
    private static final Pattern IG_ADDITIONAL_DATA = Pattern.compile(
        "window\\.__additionalDataLoaded\\(\\s*['\"][^'\"]+['\"]\\s*,\\s*(\\{.*?\\})\\s*\\)\\s*;",
        Pattern.DOTALL
    );
    private static final Pattern IG_GQL_DATA = Pattern.compile(
        "\"gql_data\"\\s*:\\s*(\\{)",
        Pattern.CASE_INSENSITIVE
    );
    private static final Pattern IG_LSD_TOKEN = Pattern.compile(
        "\"LSD\"\\s*,\\s*\\[\\]\\s*,\\s*\\{\\s*\"token\"\\s*:\\s*\"([^\"]+)\"",
        Pattern.CASE_INSENSITIVE
    );
    private static final Pattern IG_VIDEO_URL_FIELD = Pattern.compile(
        "\"video_url\"\\s*:\\s*\"((?:\\\\.|[^\"\\\\])+)\"",
        Pattern.CASE_INSENSITIVE
    );
    private static final Pattern IG_DISPLAY_URL_FIELD = Pattern.compile(
        "\"display_url\"\\s*:\\s*\"((?:\\\\.|[^\"\\\\])+)\"",
        Pattern.CASE_INSENSITIVE
    );
    private static final Pattern IG_USERNAME_FIELD = Pattern.compile(
        "\"username\"\\s*:\\s*\"([A-Za-z0-9._]{1,64})\""
    );
    private static final Pattern HTML_VIDEO_SRC = Pattern.compile(
        "<video[^>]+src=[\"']([^\"']+)[\"']",
        Pattern.CASE_INSENSITIVE
    );
    private static final Pattern HTML_EMBED_IMG = Pattern.compile(
        "<img[^>]+class=[\"'][^\"']*EmbeddedMediaImage[^\"']*[\"'][^>]+src=[\"']([^\"']+)[\"']",
        Pattern.CASE_INSENSITIVE
    );
    private static final Pattern HTML_META_TAG = Pattern.compile(
        "<meta\\s+[^>]*?(?:property|name)=[\"']([^\"']+)[\"'][^>]*?content=[\"']([^\"']*)[\"'][^>]*?>",
        Pattern.CASE_INSENSITIVE
    );
    private static final Pattern HTML_META_TAG_REV = Pattern.compile(
        "<meta\\s+[^>]*?content=[\"']([^\"']*)[\"'][^>]*?(?:property|name)=[\"']([^\"']+)[\"'][^>]*?>",
        Pattern.CASE_INSENSITIVE
    );

    private SocialMediaExtractor() {}

    public static final class ExtractedMedia {
        public final String id;
        public final String title;
        public final String thumbnail;
        public final String channelName;
        public final int duration;
        public final Integer height;
        public final String mediaType; // "video" or "image"
        public final String directUrl; // direct MP4 or image URL
        public final String hlsUrl;    // HLS .m3u8 URL if present
        public final String canonicalUrl;
        public final boolean isVideoPost;

        public ExtractedMedia(
            String id,
            String title,
            String thumbnail,
            String channelName,
            int duration,
            Integer height,
            String mediaType,
            String directUrl,
            String hlsUrl,
            String canonicalUrl,
            boolean isVideoPost
        ) {
            this.id = id != null ? id : "";
            this.title = title != null && !title.trim().isEmpty() ? title.trim() : "Video";
            this.thumbnail = thumbnail;
            this.channelName = channelName != null && !channelName.trim().isEmpty() ? channelName.trim() : "";
            this.duration = Math.max(0, duration);
            this.height = height != null && height > 0 ? height : null;
            this.mediaType = "image".equals(mediaType) ? "image" : "video";
            this.directUrl = directUrl;
            this.hlsUrl = hlsUrl;
            this.canonicalUrl = canonicalUrl;
            this.isVideoPost = isVideoPost;
        }

        public boolean hasDownloadableVideo() {
            return "video".equals(mediaType) && (directUrl != null || hlsUrl != null);
        }

        public boolean hasDownloadableImage() {
            return "image".equals(mediaType) && directUrl != null;
        }
    }

    public static boolean isPinterestUrl(String rawUrl) {
        URI uri = parseHttpUri(rawUrl);
        if (uri == null) return false;
        String host = normalizeHost(uri);
        return isPinterestHost(host);
    }

    public static boolean isInstagramUrl(String rawUrl) {
        URI uri = parseHttpUri(rawUrl);
        if (uri == null) return false;
        String host = normalizeHost(uri);
        return isInstagramHost(host);
    }

    public static boolean isSocialUrl(String platform, String rawUrl) {
        if ("pinterest".equals(platform)) return isPinterestUrl(rawUrl);
        if ("instagram".equals(platform)) return isInstagramUrl(rawUrl);
        return false;
    }

    public static boolean isAllowedMediaUrl(String platform, String rawUrl) {
        if (rawUrl == null || rawUrl.trim().isEmpty()) return false;
        URI uri = parseHttpUri(rawUrl);
        if (uri == null) return false;
        if (!"https".equalsIgnoreCase(uri.getScheme())) return false;
        if (uri.getRawUserInfo() != null) return false;
        int port = uri.getPort();
        if (port != -1 && port != 443) return false;
        String host = normalizeHost(uri);
        if ("pinterest".equals(platform)) {
            return host.equals("pinimg.com") || host.endsWith(".pinimg.com");
        }
        if ("instagram".equals(platform)) {
            return host.equals("cdninstagram.com") ||
                host.endsWith(".cdninstagram.com") ||
                host.equals("fbcdn.net") ||
                host.endsWith(".fbcdn.net");
        }
        return false;
    }

    public static boolean isDirectPinterestMediaUrl(String rawUrl) {
        if (!isAllowedMediaUrl("pinterest", rawUrl)) return false;
        URI uri = parseHttpUri(rawUrl);
        if (uri == null) return false;
        String path = uri.getPath() != null ? uri.getPath().toLowerCase(Locale.ROOT) : "";
        return path.endsWith(".mp4") || path.endsWith(".m3u8") ||
            path.endsWith(".jpg") || path.endsWith(".jpeg") ||
            path.endsWith(".png") || path.endsWith(".webp") || path.endsWith(".gif");
    }

    public static String extractPinterestPinId(String rawUrl) {
        if (rawUrl == null) return null;
        Matcher matcher = PINTEREST_PIN_ID.matcher(rawUrl);
        return matcher.find() ? matcher.group(1) : null;
    }

    public static String[] extractInstagramTypeAndShortcode(String rawUrl) {
        if (rawUrl == null) return null;
        URI uri = parseHttpUri(rawUrl);
        String path = uri != null && uri.getPath() != null ? uri.getPath() : rawUrl;
        Matcher matcher = INSTAGRAM_SHORTCODE.matcher(path);
        if (matcher.find()) {
            String type = matcher.group(1).toLowerCase(Locale.ROOT);
            if ("reels".equals(type)) type = "reel";
            return new String[] { type, matcher.group(2) };
        }
        if (uri != null && uri.getRawQuery() != null) {
            String nextParam = extractQueryParam(uri.getRawQuery(), "next");
            if (nextParam != null) {
                Matcher nextMatcher = INSTAGRAM_SHORTCODE.matcher(nextParam);
                if (nextMatcher.find()) {
                    String type = nextMatcher.group(1).toLowerCase(Locale.ROOT);
                    if ("reels".equals(type)) type = "reel";
                    return new String[] { type, nextMatcher.group(2) };
                }
            }
        }
        return null;
    }

    public static String canonicalizeUrlWithoutNetwork(String platform, String rawUrl) {
        if (rawUrl == null) return null;
        String trimmed = rawUrl.trim();
        if ("pinterest".equals(platform)) {
            if (isDirectPinterestMediaUrl(trimmed)) return trimmed;
            String pinId = extractPinterestPinId(trimmed);
            if (pinId != null) {
                return "https://www.pinterest.com/pin/" + pinId + "/";
            }
            return trimmed;
        }
        if ("instagram".equals(platform)) {
            String[] typeAndCode = extractInstagramTypeAndShortcode(trimmed);
            if (typeAndCode != null) {
                return "https://www.instagram.com/" + typeAndCode[0] + "/" + typeAndCode[1] + "/";
            }
            return trimmed;
        }
        return trimmed;
    }

    public static String resolveCanonicalUrl(String platform, String rawUrl) {
        if (!isSocialUrl(platform, rawUrl)) {
            throw new IllegalArgumentException(
                "instagram".equals(platform)
                    ? "Enter a valid Instagram post or Reel URL."
                    : "Enter a valid Pinterest Pin or pin.it URL."
            );
        }

        String preCanonical = canonicalizeUrlWithoutNetwork(platform, rawUrl);
        if ("pinterest".equals(platform)) {
            if (isDirectPinterestMediaUrl(preCanonical) || extractPinterestPinId(preCanonical) != null) {
                return preCanonical;
            }
        } else if ("instagram".equals(platform)) {
            if (extractInstagramTypeAndShortcode(preCanonical) != null) {
                return preCanonical;
            }
        }

        // Follow redirects manually (e.g. pin.it/*, instagram.com/share/reel/*, instagr.am/*)
        String current = rawUrl.trim();
        for (int hop = 0; hop < 8; hop++) {
            HttpURLConnection conn = null;
            try {
                conn = openConnection(current, "GET", null);
                conn.setInstanceFollowRedirects(false);
                conn.setConnectTimeout(6_000);
                conn.setReadTimeout(7_000);
                int status = conn.getResponseCode();
                if (status >= 300 && status < 400) {
                    String location = conn.getHeaderField("Location");
                    if (location == null || location.trim().isEmpty()) break;
                    URI nextUri = URI.create(current).resolve(location.trim());
                    String nextUrl = nextUri.toString();

                    // Inspect target BEFORE stopping or following login redirects
                    String canonical = canonicalizeUrlWithoutNetwork(platform, nextUrl);
                    if ("pinterest".equals(platform) &&
                        (extractPinterestPinId(canonical) != null || isDirectPinterestMediaUrl(canonical))) {
                        return canonical;
                    }
                    if ("instagram".equals(platform) && extractInstagramTypeAndShortcode(canonical) != null) {
                        return canonical;
                    }
                    if ("instagram".equals(platform) && nextUrl.toLowerCase(Locale.ROOT).contains("/accounts/login")) {
                        break;
                    }
                    if (!isSocialUrl(platform, nextUrl)) {
                        break;
                    }
                    current = nextUrl;
                } else {
                    break;
                }
            } catch (Exception ignored) {
                break;
            } finally {
                if (conn != null) conn.disconnect();
            }
        }

        return canonicalizeUrlWithoutNetwork(platform, current);
    }

    public static ExtractedMedia extractPinterest(String rawUrl) {
        String canonicalUrl = resolveCanonicalUrl("pinterest", rawUrl);
        if (isDirectPinterestMediaUrl(canonicalUrl)) {
            String lower = canonicalUrl.toLowerCase(Locale.ROOT);
            boolean isHls = lower.contains(".m3u8");
            boolean isVideo = isHls || lower.contains(".mp4");
            return new ExtractedMedia(
                "",
                isVideo ? "Pinterest Video" : "Pinterest Image",
                isVideo ? null : canonicalUrl,
                "Pinterest",
                0,
                inferHeightFromUrl(canonicalUrl),
                isVideo ? "video" : "image",
                isHls ? null : canonicalUrl,
                isHls ? canonicalUrl : null,
                canonicalUrl,
                isVideo
            );
        }

        String pinId = extractPinterestPinId(canonicalUrl);
        String html = fetchText(canonicalUrl, buildBrowserHeaders("https://www.pinterest.com/"));
        if (html == null || html.isEmpty()) return null;
        return parsePinterestHtml(pinId, canonicalUrl, html);
    }

    public static ExtractedMedia parsePinterestHtml(String pinId, String canonicalUrl, String html) {
        if (html == null || html.isEmpty()) return null;

        List<MediaCandidate> videoCandidates = new ArrayList<>();
        String title = null;
        String channelName = null;
        String thumbnail = null;
        String originalImage = null;
        int durationSec = 0;

        // 1. Parse __PWS_DATA__ and any JSON-LD / Relay JSON scripts
        List<String> jsonBlobs = new ArrayList<>();
        Matcher pwsMatcher = SCRIPT_PWS_DATA.matcher(html);
        if (pwsMatcher.find()) {
            jsonBlobs.add(pwsMatcher.group(1));
        }
        Matcher genericMatcher = SCRIPT_JSON_GENERIC.matcher(html);
        while (genericMatcher.find()) {
            jsonBlobs.add(genericMatcher.group(1));
        }

        PinterestMeta meta = new PinterestMeta();
        for (String blob : jsonBlobs) {
            if (blob == null || blob.trim().isEmpty()) continue;
            Object parsed = SimpleJson.parse(blob);
            if (parsed != null) {
                collectPinterestFromJson(parsed, videoCandidates, meta);
            }
        }

        title = meta.title;
        channelName = meta.channelName;
        thumbnail = meta.thumbnail;
        originalImage = meta.originalImage;
        durationSec = meta.durationSec;

        // 2. Parse Open Graph meta tags
        Map<String, String> ogTags = extractMetaTags(html);
        if (title == null) title = firstNonBlank(ogTags.get("og:title"), ogTags.get("twitter:title"));
        if (thumbnail == null) thumbnail = firstNonBlank(ogTags.get("og:image"), ogTags.get("twitter:image"));
        if (originalImage == null) originalImage = thumbnail;

        String ogVideo = firstNonBlank(ogTags.get("og:video:secure_url"), ogTags.get("og:video"));
        if (ogVideo != null) {
            String cleanOgVideo = unescapeMediaUrl(ogVideo);
            if (isAllowedMediaUrl("pinterest", cleanOgVideo)) {
                videoCandidates.add(new MediaCandidate(
                    cleanOgVideo,
                    inferHeightFromUrl(cleanOgVideo),
                    cleanOgVideo.toLowerCase(Locale.ROOT).contains(".m3u8")
                ));
            }
        }

        // 3. Regex scan raw HTML for v*.pinimg.com video URLs
        Matcher directVideoMatcher = PINTEREST_DIRECT_VIDEO.matcher(html);
        while (directVideoMatcher.find()) {
            String candidate = unescapeMediaUrl(directVideoMatcher.group(0));
            if (isAllowedMediaUrl("pinterest", candidate)) {
                videoCandidates.add(new MediaCandidate(
                    candidate,
                    inferHeightFromUrl(candidate),
                    candidate.toLowerCase(Locale.ROOT).contains(".m3u8")
                ));
            }
        }

        if (originalImage == null) {
            Matcher imgMatcher = PINTEREST_DIRECT_IMAGE.matcher(html);
            if (imgMatcher.find()) {
                String candidate = unescapeMediaUrl(imgMatcher.group(0));
                if (isAllowedMediaUrl("pinterest", candidate)) {
                    originalImage = candidate;
                }
            }
        }

        // Deduplicate and pick best MP4 + best HLS
        MediaCandidate bestMp4 = pickBestCandidate(videoCandidates, false);
        MediaCandidate bestHls = pickBestCandidate(videoCandidates, true);

        if (bestMp4 != null || bestHls != null) {
            Integer bestHeight = maxHeight(
                bestMp4 != null ? bestMp4.height : null,
                bestHls != null ? bestHls.height : null
            );
            return new ExtractedMedia(
                pinId != null ? pinId : "",
                cleanPinterestTitle(title),
                normalizeAllowedThumbnail("pinterest", thumbnail),
                channelName != null ? channelName : "Pinterest",
                durationSec,
                bestHeight,
                "video",
                bestMp4 != null ? bestMp4.url : null,
                bestHls != null ? bestHls.url : null,
                canonicalUrl,
                true
            );
        }

        String safeImage = normalizeAllowedThumbnail("pinterest", originalImage);
        if (safeImage != null) {
            return new ExtractedMedia(
                pinId != null ? pinId : "",
                cleanPinterestTitle(title),
                safeImage,
                channelName != null ? channelName : "Pinterest",
                0,
                null,
                "image",
                safeImage,
                null,
                canonicalUrl,
                false
            );
        }

        return null;
    }

    public static ExtractedMedia extractInstagram(String rawUrl) {
        String canonicalUrl = resolveCanonicalUrl("instagram", rawUrl);
        String[] typeAndCode = extractInstagramTypeAndShortcode(canonicalUrl);
        if (typeAndCode == null) return null;

        String mediaKind = typeAndCode[0];
        String shortcode = typeAndCode[1];
        boolean urlIndicatesVideo = "reel".equals(mediaKind) || "tv".equals(mediaKind);

        ExtractedMedia imageFallback = null;

        // Tier A: /p/<shortcode>/embed/captioned/ (and /reel/<shortcode>/embed/captioned/)
        String[] embedUrls = "reel".equals(mediaKind)
            ? new String[] {
                "https://www.instagram.com/reel/" + shortcode + "/embed/captioned/",
                "https://www.instagram.com/p/" + shortcode + "/embed/captioned/",
            }
            : new String[] {
                "https://www.instagram.com/p/" + shortcode + "/embed/captioned/",
                "https://www.instagram.com/reel/" + shortcode + "/embed/captioned/",
            };

        // Fast parallel probe: race primary embed endpoint vs primary GraphQL query simultaneously
        String primaryEmbedUrl = embedUrls[0];
        String primaryDocId = IG_GRAPHQL_DOC_IDS[0];
        ExecutorService probePool = Executors.newFixedThreadPool(2);
        try {
            CompletionService<ExtractedMedia> completion = new ExecutorCompletionService<>(probePool);
            Future<ExtractedMedia> embedFuture = completion.submit(() -> {
                Map<String, String> headers = buildBrowserHeaders("https://www.instagram.com/");
                headers.put("Sec-Fetch-Dest", "iframe");
                headers.put("Sec-Fetch-Mode", "navigate");
                String html = fetchText(primaryEmbedUrl, headers);
                if (html == null || html.isEmpty()) return null;
                return parseInstagramEmbedHtml(shortcode, canonicalUrl, urlIndicatesVideo, html);
            });
            Future<ExtractedMedia> gqlFuture = completion.submit(() -> {
                String json = fetchInstagramGraphQl(shortcode, canonicalUrl, primaryDocId, null);
                if (json == null || json.isEmpty()) return null;
                return parseInstagramGraphQlJson(shortcode, canonicalUrl, urlIndicatesVideo, json);
            });

            for (int completed = 0; completed < 2; completed++) {
                try {
                    ExtractedMedia candidate = completion.take().get();
                    if (candidate != null) {
                        if (candidate.hasDownloadableVideo()) {
                            embedFuture.cancel(true);
                            gqlFuture.cancel(true);
                            return candidate;
                        }
                        if (imageFallback == null && candidate.hasDownloadableImage() && !candidate.isVideoPost) {
                            imageFallback = candidate;
                        }
                    }
                } catch (Exception ignored) {
                }
            }
        } finally {
            probePool.shutdownNow();
        }

        // Secondary embed fallback if primary missed
        if (embedUrls.length > 1) {
            Map<String, String> headers = buildBrowserHeaders("https://www.instagram.com/");
            headers.put("Sec-Fetch-Dest", "iframe");
            headers.put("Sec-Fetch-Mode", "navigate");
            String html = fetchText(embedUrls[1], headers);
            if (html != null && !html.isEmpty()) {
                ExtractedMedia parsed = parseInstagramEmbedHtml(shortcode, canonicalUrl, urlIndicatesVideo, html);
                if (parsed != null) {
                    if (parsed.hasDownloadableVideo()) return parsed;
                    if (imageFallback == null && parsed.hasDownloadableImage() && !parsed.isVideoPost) {
                        imageFallback = parsed;
                    }
                }
            }
        }

        // Tier B: Public web page HTML (also harvests LSD token for GraphQL fallback)
        String lsdToken = null;
        String pageHtml = fetchText(canonicalUrl, buildBrowserHeaders("https://www.instagram.com/"));
        if (pageHtml != null && !pageHtml.isEmpty()) {
            Matcher lsdMatcher = IG_LSD_TOKEN.matcher(pageHtml);
            if (lsdMatcher.find()) {
                lsdToken = lsdMatcher.group(1);
            }
            ExtractedMedia fromPage = parseInstagramEmbedHtml(shortcode, canonicalUrl, urlIndicatesVideo, pageHtml);
            if (fromPage != null) {
                if (fromPage.hasDownloadableVideo()) return fromPage;
                if (imageFallback == null && fromPage.hasDownloadableImage() && !fromPage.isVideoPost) {
                    imageFallback = fromPage;
                }
            }
        }

        // Tier C: Secondary GraphQL query (with harvested LSD token if available)
        for (int i = 0; i < IG_GRAPHQL_DOC_IDS.length; i++) {
            if (i == 0 && lsdToken == null) continue;
            String json = fetchInstagramGraphQl(shortcode, canonicalUrl, IG_GRAPHQL_DOC_IDS[i], lsdToken);
            if (json == null || json.isEmpty()) continue;
            ExtractedMedia fromGql = parseInstagramGraphQlJson(shortcode, canonicalUrl, urlIndicatesVideo, json);
            if (fromGql != null) {
                if (fromGql.hasDownloadableVideo()) return fromGql;
                if (imageFallback == null && fromGql.hasDownloadableImage() && !fromGql.isVideoPost) {
                    imageFallback = fromGql;
                }
            }
        }

        return imageFallback;
    }

    public static ExtractedMedia parseInstagramEmbedHtml(
        String shortcode,
        String canonicalUrl,
        boolean urlIndicatesVideo,
        String html
    ) {
        if (html == null || html.isEmpty()) return null;

        // 1. Try window.__additionalDataLoaded('extra', {...})
        Matcher additionalMatcher = IG_ADDITIONAL_DATA.matcher(html);
        if (additionalMatcher.find()) {
            Object parsed = SimpleJson.parse(additionalMatcher.group(1));
            ExtractedMedia fromJson = extractInstagramFromParsedObject(
                shortcode, canonicalUrl, urlIndicatesVideo, parsed
            );
            if (fromJson != null && (fromJson.hasDownloadableVideo() || fromJson.hasDownloadableImage())) {
                return fromJson;
            }
        }

        // 2. Try "gql_data": { ... } embedded JSON inside Polaris embed scripts
        Matcher gqlMatcher = IG_GQL_DATA.matcher(html);
        if (gqlMatcher.find()) {
            String slice = extractBalancedJsonObject(html, gqlMatcher.start(1));
            if (slice != null) {
                Object parsed = SimpleJson.parse(slice);
                ExtractedMedia fromJson = extractInstagramFromParsedObject(
                    shortcode, canonicalUrl, urlIndicatesVideo, parsed
                );
                if (fromJson != null && (fromJson.hasDownloadableVideo() || fromGqlNeedsFallback(fromJson))) {
                    return fromJson;
                }
            }
        }

        // 3. Direct field & HTML extraction fallback
        Map<String, String> ogTags = extractMetaTags(html);
        String videoUrl = null;
        Matcher videoFieldMatcher = IG_VIDEO_URL_FIELD.matcher(html);
        while (videoFieldMatcher.find()) {
            String candidate = unescapeMediaUrl(videoFieldMatcher.group(1));
            if (isAllowedMediaUrl("instagram", candidate)) {
                videoUrl = candidate;
                break;
            }
        }
        if (videoUrl == null) {
            String ogVideo = firstNonBlank(ogTags.get("og:video:secure_url"), ogTags.get("og:video"));
            if (ogVideo != null) {
                String candidate = unescapeMediaUrl(ogVideo);
                if (isAllowedMediaUrl("instagram", candidate)) {
                    videoUrl = candidate;
                }
            }
        }
        if (videoUrl == null) {
            Matcher tagMatcher = HTML_VIDEO_SRC.matcher(html);
            if (tagMatcher.find()) {
                String candidate = unescapeMediaUrl(tagMatcher.group(1));
                if (isAllowedMediaUrl("instagram", candidate)) {
                    videoUrl = candidate;
                }
            }
        }

        String displayUrl = null;
        Matcher displayMatcher = IG_DISPLAY_URL_FIELD.matcher(html);
        if (displayMatcher.find()) {
            String candidate = unescapeMediaUrl(displayMatcher.group(1));
            if (isAllowedMediaUrl("instagram", candidate)) {
                displayUrl = candidate;
            }
        }
        if (displayUrl == null) {
            Matcher imgMatcher = HTML_EMBED_IMG.matcher(html);
            if (imgMatcher.find()) {
                String candidate = unescapeMediaUrl(imgMatcher.group(1));
                if (isAllowedMediaUrl("instagram", candidate)) {
                    displayUrl = candidate;
                }
            }
        }
        if (displayUrl == null) {
            String ogImage = firstNonBlank(ogTags.get("og:image"), ogTags.get("twitter:image"));
            if (ogImage != null) {
                String candidate = unescapeMediaUrl(ogImage);
                if (isAllowedMediaUrl("instagram", candidate)) {
                    displayUrl = candidate;
                }
            }
        }

        String username = null;
        Matcher userMatcher = IG_USERNAME_FIELD.matcher(html);
        if (userMatcher.find()) {
            username = userMatcher.group(1);
        }

        String title = firstNonBlank(ogTags.get("og:title"), ogTags.get("og:description"));
        boolean htmlIndicatesVideo = urlIndicatesVideo ||
            html.contains("\"is_video\":true") ||
            html.contains("\"is_video\": true") ||
            html.contains("WatchOnInstagram") ||
            html.contains("video_url");

        if (videoUrl != null) {
            return new ExtractedMedia(
                shortcode,
                cleanInstagramTitle(title, true),
                displayUrl,
                username != null ? username : "Instagram",
                0,
                null,
                "video",
                videoUrl,
                null,
                canonicalUrl,
                true
            );
        }

        if (displayUrl != null && !htmlIndicatesVideo) {
            return new ExtractedMedia(
                shortcode,
                cleanInstagramTitle(title, false),
                displayUrl,
                username != null ? username : "Instagram",
                0,
                null,
                "image",
                displayUrl,
                null,
                canonicalUrl,
                false
            );
        }

        return null;
    }

    private static boolean fromGqlNeedsFallback(ExtractedMedia media) {
        return media.hasDownloadableImage() && !media.isVideoPost;
    }

    public static ExtractedMedia parseInstagramGraphQlJson(
        String shortcode,
        String canonicalUrl,
        boolean urlIndicatesVideo,
        String json
    ) {
        Object parsed = SimpleJson.parse(json);
        if (parsed == null) return null;
        return extractInstagramFromParsedObject(shortcode, canonicalUrl, urlIndicatesVideo, parsed);
    }

    public interface ProgressListener {
        void onProgress(int percent, long loadedBytes, long totalBytes);
    }

    public static void downloadUrlToFile(
        String platform,
        String mediaUrl,
        File destination,
        boolean expectImage
    ) throws IOException {
        downloadUrlToFile(platform, mediaUrl, destination, expectImage, null);
    }

    public static void downloadUrlToFile(
        String platform,
        String mediaUrl,
        File destination,
        boolean expectImage,
        ProgressListener listener
    ) throws IOException {
        if (!isAllowedMediaUrl(platform, mediaUrl)) {
            throw new IllegalArgumentException("Media URL host is not allowed for " + platform + ".");
        }

        String referer = "instagram".equals(platform)
            ? "https://www.instagram.com/"
            : "https://www.pinterest.com/";
        String current = mediaUrl;

        for (int hop = 0; hop < 6; hop++) {
            if (!isAllowedMediaUrl(platform, current)) {
                throw new IOException("Media redirect went to a disallowed host.");
            }
            HttpURLConnection conn = openConnection(current, "GET", buildBrowserHeaders(referer));
            conn.setInstanceFollowRedirects(false);
            conn.setConnectTimeout(20_000);
            conn.setReadTimeout(90_000);
            try {
                int status = conn.getResponseCode();
                if (status >= 300 && status < 400) {
                    String location = conn.getHeaderField("Location");
                    if (location == null || location.trim().isEmpty()) {
                        throw new IOException("Redirect missing Location header.");
                    }
                    current = URI.create(current).resolve(location.trim()).toString();
                    continue;
                }
                if (status < 200 || status >= 300) {
                    throw new IOException("Media CDN returned HTTP " + status);
                }

                String contentType = conn.getContentType();
                String lowerType = contentType != null ? contentType.toLowerCase(Locale.ROOT) : "";
                if (lowerType.contains("text/html") || lowerType.contains("application/json")) {
                    throw new IOException("Media CDN returned " + lowerType + " instead of media.");
                }
                if (expectImage && !lowerType.isEmpty() &&
                    !lowerType.startsWith("image/") && !lowerType.startsWith("application/octet-stream")) {
                    throw new IOException("Unexpected image content type: " + lowerType);
                }

                long contentLength = conn.getContentLengthLong();
                long totalBytes = 0;
                long lastEmitAt = 0;
                int lastPercent = -1;
                byte[] headerProbe = new byte[16];
                int headerProbeLen = 0;

                if (listener != null) {
                    listener.onProgress(4, 0, contentLength > 0 ? contentLength : 0);
                }

                try (InputStream input = new BufferedInputStream(conn.getInputStream());
                     OutputStream output = new FileOutputStream(destination)) {
                    byte[] buffer = new byte[64 * 1024];
                    int read;
                    while ((read = input.read(buffer)) != -1) {
                        if (headerProbeLen < headerProbe.length) {
                            int copy = Math.min(read, headerProbe.length - headerProbeLen);
                            System.arraycopy(buffer, 0, headerProbe, headerProbeLen, copy);
                            headerProbeLen += copy;
                        }
                        output.write(buffer, 0, read);
                        totalBytes += read;
                        if (listener != null) {
                            int percent;
                            if (contentLength > 0) {
                                percent = 4 + (int) Math.min(88, Math.round((totalBytes * 88.0) / contentLength));
                            } else {
                                double curve = 1.0 - Math.exp(-totalBytes / (3.0 * 1024.0 * 1024.0));
                                percent = 4 + (int) Math.min(84, Math.round(curve * 84.0));
                            }
                            long now = System.currentTimeMillis();
                            if (percent != lastPercent || now - lastEmitAt >= 120) {
                                lastPercent = percent;
                                lastEmitAt = now;
                                listener.onProgress(percent, totalBytes, contentLength > 0 ? contentLength : 0);
                            }
                        }
                    }
                }

                if (totalBytes <= 0) {
                    destination.delete();
                    throw new IOException("Downloaded media file was empty.");
                }
                if (looksLikeHtmlOrJson(headerProbe, headerProbeLen)) {
                    destination.delete();
                    throw new IOException("Downloaded response was text/HTML instead of media.");
                }
                if (listener != null) {
                    listener.onProgress(92, totalBytes, contentLength > 0 ? contentLength : totalBytes);
                }
                return;
            } finally {
                conn.disconnect();
            }
        }
        throw new IOException("Too many media redirects.");
    }

    public static String inferImageExtensionAndMime(String url, String fallbackExt) {
        if (url != null) {
            String lower = url.toLowerCase(Locale.ROOT);
            int q = lower.indexOf('?');
            if (q >= 0) lower = lower.substring(0, q);
            if (lower.endsWith(".png")) return "png|image/png";
            if (lower.endsWith(".webp")) return "webp|image/webp";
            if (lower.endsWith(".gif")) return "gif|image/gif";
            if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "jpg|image/jpeg";
        }
        if ("png".equals(fallbackExt)) return "png|image/png";
        if ("webp".equals(fallbackExt)) return "webp|image/webp";
        return "jpg|image/jpeg";
    }

    private static String fetchInstagramGraphQl(
        String shortcode,
        String canonicalUrl,
        String docId,
        String lsdToken
    ) {
        HttpURLConnection conn = null;
        try {
            Map<String, String> headers = buildBrowserHeaders(canonicalUrl);
            headers.put("Content-Type", "application/x-www-form-urlencoded");
            headers.put("Accept", "*/*");
            headers.put("Origin", "https://www.instagram.com");
            headers.put("X-IG-App-ID", IG_APP_ID);
            headers.put("X-ASBD-ID", "129477");
            headers.put("X-FB-Friendly-Name", "PolarisPostActionLoadPostQueryQuery");
            headers.put("Sec-Fetch-Site", "same-origin");
            headers.put("Sec-Fetch-Mode", "cors");
            headers.put("Sec-Fetch-Dest", "empty");
            if (lsdToken != null && !lsdToken.isEmpty()) {
                headers.put("X-FB-LSD", lsdToken);
            }

            String variables = "{\"shortcode\":\"" + shortcode +
                "\",\"fetch_tagged_user_count\":null,\"hoisted_comment_id\":null,\"hoisted_reply_id\":null}";
            StringBuilder body = new StringBuilder();
            if (lsdToken != null && !lsdToken.isEmpty()) {
                body.append("lsd=").append(URLEncoder.encode(lsdToken, "UTF-8")).append('&');
            }
            body.append("variables=").append(URLEncoder.encode(variables, "UTF-8"));
            body.append("&doc_id=").append(URLEncoder.encode(docId, "UTF-8"));

            byte[] payload = body.toString().getBytes(StandardCharsets.UTF_8);
            conn = openConnection("https://www.instagram.com/graphql/query", "POST", headers);
            conn.setDoOutput(true);
            conn.setConnectTimeout(6_000);
            conn.setReadTimeout(9_000);
            try (OutputStream out = conn.getOutputStream()) {
                out.write(payload);
            }
            int status = conn.getResponseCode();
            if (status < 200 || status >= 300) return null;
            return readTextStream(conn.getInputStream(), 2 * 1024 * 1024);
        } catch (Exception ignored) {
            return null;
        } finally {
            if (conn != null) conn.disconnect();
        }
    }

    @SuppressWarnings("unchecked")
    private static ExtractedMedia extractInstagramFromParsedObject(
        String shortcode,
        String canonicalUrl,
        boolean urlIndicatesVideo,
        Object root
    ) {
        if (!(root instanceof Map)) return null;
        Map<String, Object> media = findInstagramMediaMap((Map<String, Object>) root);
        if (media == null) return null;

        boolean isVideo = urlIndicatesVideo ||
            Boolean.TRUE.equals(media.get("is_video")) ||
            "clips".equalsIgnoreCase(asString(media.get("product_type")));

        String videoUrl = extractInstagramVideoUrlFromNode(media);
        String thumbnail = firstAllowedUrl(
            "instagram",
            asString(media.get("thumbnail_src")),
            asString(media.get("display_url"))
        );
        Integer height = extractInstagramHeight(media);
        int duration = (int) Math.round(asDouble(media.get("video_duration")));

        // Check carousel slides (edge_sidecar_to_children) if main node has no video_url
        if (videoUrl == null) {
            Map<String, Object> sidecar = asMap(media.get("edge_sidecar_to_children"));
            List<Object> edges = sidecar != null ? asList(sidecar.get("edges")) : null;
            if (edges != null) {
                for (Object edgeObj : edges) {
                    Map<String, Object> edge = asMap(edgeObj);
                    Map<String, Object> node = edge != null ? asMap(edge.get("node")) : null;
                    if (node == null) continue;
                    String childVideo = extractInstagramVideoUrlFromNode(node);
                    if (childVideo != null) {
                        videoUrl = childVideo;
                        isVideo = true;
                        if (thumbnail == null) {
                            thumbnail = firstAllowedUrl("instagram", asString(node.get("display_url")));
                        }
                        if (height == null) height = extractInstagramHeight(node);
                        if (duration <= 0) duration = (int) Math.round(asDouble(node.get("video_duration")));
                        break;
                    }
                }
            }
        }

        String channelName = null;
        Map<String, Object> owner = asMap(media.get("owner"));
        if (owner != null) {
            channelName = firstNonBlank(asString(owner.get("username")), asString(owner.get("full_name")));
        }

        String caption = extractInstagramCaption(media);
        if (videoUrl != null) {
            return new ExtractedMedia(
                firstNonBlank(asString(media.get("shortcode")), shortcode),
                cleanInstagramTitle(caption, true),
                thumbnail,
                channelName != null ? channelName : "Instagram",
                duration,
                height,
                "video",
                videoUrl,
                null,
                canonicalUrl,
                true
            );
        }

        if (!isVideo && thumbnail != null) {
            return new ExtractedMedia(
                firstNonBlank(asString(media.get("shortcode")), shortcode),
                cleanInstagramTitle(caption, false),
                thumbnail,
                channelName != null ? channelName : "Instagram",
                0,
                height,
                "image",
                thumbnail,
                null,
                canonicalUrl,
                false
            );
        }

        return null;
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> findInstagramMediaMap(Map<String, Object> root) {
        Map<String, Object> data = asMap(root.get("data"));
        if (data != null) {
            Map<String, Object> xdt = asMap(data.get("xdt_shortcode_media"));
            if (xdt != null) return xdt;
            Map<String, Object> sm = asMap(data.get("shortcode_media"));
            if (sm != null) return sm;
        }
        Map<String, Object> direct = asMap(root.get("shortcode_media"));
        if (direct != null) return direct;
        Map<String, Object> xdtRoot = asMap(root.get("xdt_shortcode_media"));
        if (xdtRoot != null) return xdtRoot;
        Map<String, Object> graphql = asMap(root.get("graphql"));
        if (graphql != null) {
            Map<String, Object> sm = asMap(graphql.get("shortcode_media"));
            if (sm != null) return sm;
        }
        if (root.containsKey("video_url") || root.containsKey("display_url") || root.containsKey("video_versions")) {
            return root;
        }
        return null;
    }

    private static String extractInstagramVideoUrlFromNode(Map<String, Object> node) {
        String direct = asString(node.get("video_url"));
        if (direct != null) {
            String clean = unescapeMediaUrl(direct);
            if (isAllowedMediaUrl("instagram", clean)) return clean;
        }
        List<Object> versions = asList(node.get("video_versions"));
        if (versions != null) {
            String bestUrl = null;
            int bestScore = -1;
            for (Object item : versions) {
                Map<String, Object> v = asMap(item);
                if (v == null) continue;
                String candidate = asString(v.get("url"));
                if (candidate == null) continue;
                String clean = unescapeMediaUrl(candidate);
                if (!isAllowedMediaUrl("instagram", clean)) continue;
                int h = asInt(v.get("height"));
                int w = asInt(v.get("width"));
                int score = h * 10000 + w;
                if (score > bestScore) {
                    bestScore = score;
                    bestUrl = clean;
                }
            }
            if (bestUrl != null) return bestUrl;
        }
        return null;
    }

    private static Integer extractInstagramHeight(Map<String, Object> node) {
        Map<String, Object> dims = asMap(node.get("dimensions"));
        if (dims != null) {
            int h = asInt(dims.get("height"));
            if (h > 0) return h;
        }
        int originalH = asInt(node.get("original_height"));
        if (originalH > 0) return originalH;
        List<Object> versions = asList(node.get("video_versions"));
        if (versions != null) {
            int maxH = 0;
            for (Object item : versions) {
                Map<String, Object> v = asMap(item);
                if (v != null) maxH = Math.max(maxH, asInt(v.get("height")));
            }
            if (maxH > 0) return maxH;
        }
        return null;
    }

    private static String extractInstagramCaption(Map<String, Object> node) {
        Map<String, Object> captionEdge = asMap(node.get("edge_media_to_caption"));
        if (captionEdge != null) {
            List<Object> edges = asList(captionEdge.get("edges"));
            if (edges != null && !edges.isEmpty()) {
                Map<String, Object> firstEdge = asMap(edges.get(0));
                Map<String, Object> firstNode = firstEdge != null ? asMap(firstEdge.get("node")) : null;
                if (firstNode != null) {
                    String text = asString(firstNode.get("text"));
                    if (text != null && !text.trim().isEmpty()) return text.trim();
                }
            }
        }
        Map<String, Object> captionObj = asMap(node.get("caption"));
        if (captionObj != null) {
            String text = asString(captionObj.get("text"));
            if (text != null && !text.trim().isEmpty()) return text.trim();
        }
        return asString(node.get("title"));
    }

    private static final class PinterestMeta {
        String title;
        String channelName;
        String thumbnail;
        String originalImage;
        int durationSec;
    }

    @SuppressWarnings("unchecked")
    private static void collectPinterestFromJson(
        Object node,
        List<MediaCandidate> videoCandidates,
        PinterestMeta meta
    ) {
        if (node instanceof List) {
            for (Object item : (List<Object>) node) {
                collectPinterestFromJson(item, videoCandidates, meta);
            }
            return;
        }
        if (!(node instanceof Map)) return;

        Map<String, Object> map = (Map<String, Object>) node;

        // JSON-LD VideoObject
        String ldType = asString(map.get("@type"));
        if ("VideoObject".equalsIgnoreCase(ldType)) {
            String contentUrl = asString(map.get("contentUrl"));
            if (contentUrl != null) {
                String clean = unescapeMediaUrl(contentUrl);
                if (isAllowedMediaUrl("pinterest", clean)) {
                    videoCandidates.add(new MediaCandidate(
                        clean,
                        inferHeightFromUrl(clean),
                        clean.toLowerCase(Locale.ROOT).contains(".m3u8")
                    ));
                }
            }
            if (meta.title == null) meta.title = asString(map.get("name"));
            if (meta.thumbnail == null) meta.thumbnail = asString(map.get("thumbnailUrl"));
        }

        // Pinterest video_list object: { "V_720P": { "url": "...", "width": 720, "height": 1280, "duration": 15000 } }
        Map<String, Object> videoList = asMap(map.get("video_list"));
        if (videoList != null) {
            for (Map.Entry<String, Object> entry : videoList.entrySet()) {
                Map<String, Object> variant = asMap(entry.getValue());
                if (variant == null) continue;
                String rawUrl = asString(variant.get("url"));
                if (rawUrl == null) continue;
                String clean = unescapeMediaUrl(rawUrl);
                if (!isAllowedMediaUrl("pinterest", clean)) continue;
                int h = asInt(variant.get("height"));
                if (h <= 0) {
                    Integer inferred = inferHeightFromUrl(clean);
                    if (inferred != null) h = inferred;
                }
                int dur = asInt(variant.get("duration"));
                if (dur > 0 && meta.durationSec <= 0) {
                    meta.durationSec = dur > 1000 ? Math.round(dur / 1000f) : dur;
                }
                if (meta.thumbnail == null) {
                    String thumb = asString(variant.get("thumbnail"));
                    if (thumb != null) meta.thumbnail = unescapeMediaUrl(thumb);
                }
                boolean isHls = clean.toLowerCase(Locale.ROOT).contains(".m3u8") ||
                    entry.getKey().toUpperCase(Locale.ROOT).contains("HLS");
                videoCandidates.add(new MediaCandidate(clean, h > 0 ? h : null, isHls));
            }
        }

        // Metadata fields commonly present on Pin entities
        if (meta.title == null) {
            meta.title = firstNonBlank(
                asString(map.get("grid_title")),
                asString(map.get("title")),
                asString(map.get("seo_title")),
                asString(map.get("closeup_unified_description"))
            );
        }
        if (meta.channelName == null) {
            Map<String, Object> pinner = firstNonNullMap(
                asMap(map.get("native_creator")),
                asMap(map.get("pinner")),
                asMap(map.get("origin_pinner")),
                asMap(map.get("creator"))
            );
            if (pinner != null) {
                meta.channelName = firstNonBlank(
                    asString(pinner.get("full_name")),
                    asString(pinner.get("username")),
                    asString(pinner.get("name"))
                );
            }
        }
        Map<String, Object> images = asMap(map.get("images"));
        if (images != null) {
            Map<String, Object> orig = asMap(images.get("orig"));
            Map<String, Object> img736 = asMap(images.get("736x"));
            String origUrl = orig != null ? asString(orig.get("url")) : null;
            String img736Url = img736 != null ? asString(img736.get("url")) : null;
            if (meta.originalImage == null && origUrl != null) {
                meta.originalImage = unescapeMediaUrl(origUrl);
            }
            if (meta.thumbnail == null) {
                meta.thumbnail = firstNonBlank(
                    img736Url != null ? unescapeMediaUrl(img736Url) : null,
                    origUrl != null ? unescapeMediaUrl(origUrl) : null
                );
            }
        }

        for (Object value : map.values()) {
            if (value instanceof Map || value instanceof List) {
                collectPinterestFromJson(value, videoCandidates, meta);
            }
        }
    }

    private static final class MediaCandidate {
        final String url;
        final Integer height;
        final boolean isHls;

        MediaCandidate(String url, Integer height, boolean isHls) {
            this.url = url;
            this.height = height;
            this.isHls = isHls;
        }
    }

    private static MediaCandidate pickBestCandidate(List<MediaCandidate> candidates, boolean wantHls) {
        List<MediaCandidate> filtered = new ArrayList<>();
        for (MediaCandidate candidate : candidates) {
            if (candidate.isHls == wantHls) {
                filtered.add(candidate);
            }
        }
        if (filtered.isEmpty()) return null;
        Collections.sort(filtered, new Comparator<MediaCandidate>() {
            @Override
            public int compare(MediaCandidate a, MediaCandidate b) {
                int ha = a.height != null ? a.height : 0;
                int hb = b.height != null ? b.height : 0;
                if (hb != ha) return Integer.compare(hb, ha);
                // Prefer non-mobile HLS or higher-quality path hints
                int sa = urlQualityHint(a.url);
                int sb = urlQualityHint(b.url);
                return Integer.compare(sb, sa);
            }
        });
        return filtered.get(0);
    }

    private static int urlQualityHint(String url) {
        String lower = url.toLowerCase(Locale.ROOT);
        if (lower.contains("1080p") || lower.contains("exp7")) return 1080;
        if (lower.contains("720p") || lower.contains("exp6")) return 720;
        if (lower.contains("540p") || lower.contains("exp5")) return 540;
        if (lower.contains("480p") || lower.contains("exp4")) return 480;
        if (lower.contains("hlsv4") || lower.contains("hlsv3_web")) return 700;
        return 0;
    }

    private static Integer inferHeightFromUrl(String url) {
        if (url == null) return null;
        Matcher m = Pattern.compile("(?:/|_)(\\d{3,4})p(?:/|_|\\.)", Pattern.CASE_INSENSITIVE).matcher(url);
        if (m.find()) {
            try {
                int h = Integer.parseInt(m.group(1));
                if (h >= 144 && h <= 4320) return h;
            } catch (NumberFormatException ignored) {
                return null;
            }
        }
        Matcher dim = Pattern.compile("/(\\d{3,4})x(\\d{3,4})/").matcher(url);
        if (dim.find()) {
            try {
                int a = Integer.parseInt(dim.group(1));
                int b = Integer.parseInt(dim.group(2));
                int minDim = Math.min(a, b);
                if (minDim >= 144 && minDim <= 4320) return minDim;
            } catch (NumberFormatException ignored) {
                return null;
            }
        }
        return null;
    }

    private static Integer maxHeight(Integer a, Integer b) {
        if (a == null) return b;
        if (b == null) return a;
        return Math.max(a, b);
    }

    private static String normalizeAllowedThumbnail(String platform, String rawUrl) {
        if (rawUrl == null || rawUrl.trim().isEmpty()) return null;
        String clean = unescapeMediaUrl(rawUrl);
        return isAllowedMediaUrl(platform, clean) ? clean : null;
    }

    private static String firstAllowedUrl(String platform, String... urls) {
        for (String url : urls) {
            String normalized = normalizeAllowedThumbnail(platform, url);
            if (normalized != null) return normalized;
        }
        return null;
    }

    private static String cleanPinterestTitle(String raw) {
        if (raw == null || raw.trim().isEmpty()) return "Pinterest Video";
        String cleaned = decodeHtmlEntities(raw).replaceAll("\\s+", " ").trim();
        cleaned = cleaned.replaceFirst("\\s*\\|\\s*Pinterest.*$", "").trim();
        return cleaned.isEmpty() ? "Pinterest Video" : cleaned;
    }

    private static String cleanInstagramTitle(String raw, boolean isVideo) {
        String fallback = isVideo ? "Instagram Video" : "Instagram Photo";
        if (raw == null || raw.trim().isEmpty()) return fallback;
        String cleaned = decodeHtmlEntities(raw).replaceAll("\\s+", " ").trim();
        return cleaned.isEmpty() ? fallback : cleaned;
    }

    public static String unescapeMediaUrl(String value) {
        if (value == null) return "";
        String decoded = value.trim()
            .replace("\\/", "/")
            .replace("\\u0026", "&")
            .replace("\\u002F", "/")
            .replace("\\u002f", "/")
            .replace("\\u003A", ":")
            .replace("\\u003a", ":")
            .replace("\\u003D", "=")
            .replace("\\u003d", "=")
            .replace("\\u003F", "?")
            .replace("\\u003f", "?")
            .replace("\\u0025", "%");
        return decodeHtmlEntities(decoded);
    }

    private static String decodeHtmlEntities(String input) {
        if (input == null || input.isEmpty()) return "";
        String out = input
            .replace("&amp;", "&")
            .replace("&quot;", "\"")
            .replace("&#39;", "'")
            .replace("&apos;", "'")
            .replace("&lt;", "<")
            .replace("&gt;", ">");
        Matcher numEntity = Pattern.compile("&#(x?[0-9a-fA-F]+);").matcher(out);
        StringBuffer sb = new StringBuffer();
        while (numEntity.find()) {
            String code = numEntity.group(1);
            try {
                int cp = code.startsWith("x") || code.startsWith("X")
                    ? Integer.parseInt(code.substring(1), 16)
                    : Integer.parseInt(code, 10);
                numEntity.appendReplacement(sb, Matcher.quoteReplacement(new String(Character.toChars(cp))));
            } catch (Exception ignored) {
                numEntity.appendReplacement(sb, Matcher.quoteReplacement(numEntity.group(0)));
            }
        }
        numEntity.appendTail(sb);
        return sb.toString();
    }

    private static Map<String, String> extractMetaTags(String html) {
        Map<String, String> tags = new LinkedHashMap<>();
        Matcher m1 = HTML_META_TAG.matcher(html);
        while (m1.find()) {
            tags.putIfAbsent(m1.group(1).toLowerCase(Locale.ROOT), decodeHtmlEntities(m1.group(2)));
        }
        Matcher m2 = HTML_META_TAG_REV.matcher(html);
        while (m2.find()) {
            tags.putIfAbsent(m2.group(2).toLowerCase(Locale.ROOT), decodeHtmlEntities(m2.group(1)));
        }
        return tags;
    }

    private static String extractBalancedJsonObject(String text, int startIndex) {
        if (startIndex < 0 || startIndex >= text.length() || text.charAt(startIndex) != '{') {
            return null;
        }
        int depth = 0;
        boolean inString = false;
        boolean escaped = false;
        int maxEnd = Math.min(text.length(), startIndex + 512 * 1024);
        for (int i = startIndex; i < maxEnd; i++) {
            char ch = text.charAt(i);
            if (inString) {
                if (escaped) {
                    escaped = false;
                } else if (ch == '\\') {
                    escaped = true;
                } else if (ch == '"') {
                    inString = false;
                }
            } else {
                if (ch == '"') {
                    inString = true;
                } else if (ch == '{') {
                    depth++;
                } else if (ch == '}') {
                    depth--;
                    if (depth == 0) {
                        return text.substring(startIndex, i + 1);
                    }
                }
            }
        }
        return null;
    }

    private static boolean looksLikeHtmlOrJson(byte[] bytes, int len) {
        int idx = 0;
        while (idx < len && (bytes[idx] == ' ' || bytes[idx] == '\t' || bytes[idx] == '\r' || bytes[idx] == '\n')) {
            idx++;
        }
        if (idx >= len) return false;
        char first = (char) (bytes[idx] & 0xFF);
        return first == '<' || first == '{';
    }

    private static Map<String, String> buildBrowserHeaders(String referer) {
        Map<String, String> headers = new LinkedHashMap<>();
        headers.put("User-Agent", DESKTOP_USER_AGENT);
        headers.put("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8");
        headers.put("Accept-Language", "en-US,en;q=0.9");
        if (referer != null) {
            headers.put("Referer", referer);
        }
        return headers;
    }

    private static HttpURLConnection openConnection(
        String rawUrl,
        String method,
        Map<String, String> headers
    ) throws IOException {
        HttpURLConnection conn = (HttpURLConnection) new URL(rawUrl).openConnection();
        conn.setRequestMethod(method);
        conn.setRequestProperty("User-Agent", DESKTOP_USER_AGENT);
        if (headers != null) {
            for (Map.Entry<String, String> entry : headers.entrySet()) {
                conn.setRequestProperty(entry.getKey(), entry.getValue());
            }
        }
        return conn;
    }

    private static String fetchText(String rawUrl, Map<String, String> headers) {
        HttpURLConnection conn = null;
        try {
            conn = openConnection(rawUrl, "GET", headers);
            conn.setInstanceFollowRedirects(true);
            conn.setConnectTimeout(6_000);
            conn.setReadTimeout(9_000);
            int status = conn.getResponseCode();
            if (status < 200 || status >= 300) return null;
            return readTextStream(conn.getInputStream(), 4 * 1024 * 1024);
        } catch (Exception ignored) {
            return null;
        } finally {
            if (conn != null) conn.disconnect();
        }
    }

    private static String readTextStream(InputStream input, int maxBytes) throws IOException {
        try (InputStream in = new BufferedInputStream(input);
             ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            byte[] buf = new byte[16 * 1024];
            int total = 0;
            int read;
            while ((read = in.read(buf)) != -1) {
                int toWrite = Math.min(read, maxBytes - total);
                if (toWrite > 0) {
                    out.write(buf, 0, toWrite);
                    total += toWrite;
                }
                if (total >= maxBytes) break;
            }
            return new String(out.toByteArray(), StandardCharsets.UTF_8);
        }
    }

    private static URI parseHttpUri(String rawUrl) {
        if (rawUrl == null) return null;
        String trimmed = rawUrl.trim();
        if (trimmed.isEmpty()) return null;
        try {
            URI uri = URI.create(trimmed);
            String scheme = uri.getScheme();
            if (!"http".equalsIgnoreCase(scheme) && !"https".equalsIgnoreCase(scheme)) {
                return null;
            }
            if (uri.getHost() == null || uri.getHost().isEmpty()) {
                return null;
            }
            return uri;
        } catch (Exception ignored) {
            return null;
        }
    }

    private static String normalizeHost(URI uri) {
        String host = uri.getHost();
        return host != null ? host.toLowerCase(Locale.ROOT) : "";
    }

    private static boolean isPinterestHost(String host) {
        if (host.isEmpty()) return false;
        return PINTEREST_LOCALE_HOST.matcher(host).find() ||
            host.equals("pin.it") ||
            host.endsWith(".pin.it") ||
            host.equals("pinimg.com") ||
            host.endsWith(".pinimg.com");
    }

    private static boolean isInstagramHost(String host) {
        if (host.isEmpty()) return false;
        return host.equals("instagram.com") ||
            host.endsWith(".instagram.com") ||
            host.equals("instagr.am") ||
            host.endsWith(".instagr.am");
    }

    private static String extractQueryParam(String rawQuery, String key) {
        if (rawQuery == null || rawQuery.isEmpty()) return null;
        String[] pairs = rawQuery.split("&");
        for (String pair : pairs) {
            int eq = pair.indexOf('=');
            String k = eq >= 0 ? pair.substring(0, eq) : pair;
            if (key.equals(k) && eq >= 0) {
                try {
                    return URLDecoder.decode(pair.substring(eq + 1), "UTF-8");
                } catch (Exception ignored) {
                    return pair.substring(eq + 1);
                }
            }
        }
        return null;
    }

    private static String firstNonBlank(String... values) {
        for (String v : values) {
            if (v != null && !v.trim().isEmpty()) return v.trim();
        }
        return null;
    }

    @SafeVarargs
    private static Map<String, Object> firstNonNullMap(Map<String, Object>... maps) {
        for (Map<String, Object> m : maps) {
            if (m != null) return m;
        }
        return null;
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> asMap(Object value) {
        return value instanceof Map ? (Map<String, Object>) value : null;
    }

    @SuppressWarnings("unchecked")
    private static List<Object> asList(Object value) {
        return value instanceof List ? (List<Object>) value : null;
    }

    private static String asString(Object value) {
        return value instanceof String ? (String) value : null;
    }

    private static int asInt(Object value) {
        if (value instanceof Number) return ((Number) value).intValue();
        if (value instanceof String) {
            try {
                return (int) Math.round(Double.parseDouble((String) value));
            } catch (NumberFormatException ignored) {
                return 0;
            }
        }
        return 0;
    }

    private static double asDouble(Object value) {
        if (value instanceof Number) return ((Number) value).doubleValue();
        if (value instanceof String) {
            try {
                return Double.parseDouble((String) value);
            } catch (NumberFormatException ignored) {
                return 0d;
            }
        }
        return 0d;
    }

    /**
     * Minimal dependency-free recursive-descent JSON parser so SocialMediaExtractor works identically
     * on Android and in plain JVM JUnit tests without Android's stubbed org.json.
     */
    static final class SimpleJson {
        private final String src;
        private int pos;

        private SimpleJson(String src) {
            this.src = src;
        }

        static Object parse(String text) {
            if (text == null) return null;
            SimpleJson parser = new SimpleJson(text);
            try {
                parser.skipWs();
                if (parser.pos >= parser.src.length()) return null;
                return parser.parseValue();
            } catch (Exception ignored) {
                return null;
            }
        }

        private void skipWs() {
            while (pos < src.length()) {
                char c = src.charAt(pos);
                if (c == ' ' || c == '\t' || c == '\r' || c == '\n') pos++;
                else break;
            }
        }

        private Object parseValue() {
            skipWs();
            if (pos >= src.length()) return null;
            char c = src.charAt(pos);
            if (c == '{') return parseObject();
            if (c == '[') return parseArray();
            if (c == '"') return parseString();
            if (c == 't' && src.startsWith("true", pos)) {
                pos += 4;
                return Boolean.TRUE;
            }
            if (c == 'f' && src.startsWith("false", pos)) {
                pos += 5;
                return Boolean.FALSE;
            }
            if (c == 'n' && src.startsWith("null", pos)) {
                pos += 4;
                return null;
            }
            if (c == '-' || (c >= '0' && c <= '9')) return parseNumber();
            throw new IllegalArgumentException("Unexpected char at " + pos);
        }

        private Map<String, Object> parseObject() {
            Map<String, Object> map = new LinkedHashMap<>();
            pos++; // '{'
            skipWs();
            if (pos < src.length() && src.charAt(pos) == '}') {
                pos++;
                return map;
            }
            while (pos < src.length()) {
                skipWs();
                String key = parseString();
                skipWs();
                if (pos >= src.length() || src.charAt(pos) != ':') {
                    throw new IllegalArgumentException("Expected ':' at " + pos);
                }
                pos++;
                Object value = parseValue();
                map.put(key, value);
                skipWs();
                if (pos < src.length() && src.charAt(pos) == ',') {
                    pos++;
                } else if (pos < src.length() && src.charAt(pos) == '}') {
                    pos++;
                    return map;
                } else {
                    throw new IllegalArgumentException("Expected ',' or '}' at " + pos);
                }
            }
            return map;
        }

        private List<Object> parseArray() {
            List<Object> list = new ArrayList<>();
            pos++; // '['
            skipWs();
            if (pos < src.length() && src.charAt(pos) == ']') {
                pos++;
                return list;
            }
            while (pos < src.length()) {
                list.add(parseValue());
                skipWs();
                if (pos < src.length() && src.charAt(pos) == ',') {
                    pos++;
                } else if (pos < src.length() && src.charAt(pos) == ']') {
                    pos++;
                    return list;
                } else {
                    throw new IllegalArgumentException("Expected ',' or ']' at " + pos);
                }
            }
            return list;
        }

        private String parseString() {
            if (pos >= src.length() || src.charAt(pos) != '"') {
                throw new IllegalArgumentException("Expected '\"' at " + pos);
            }
            pos++;
            StringBuilder sb = new StringBuilder();
            while (pos < src.length()) {
                char c = src.charAt(pos++);
                if (c == '"') return sb.toString();
                if (c == '\\' && pos < src.length()) {
                    char esc = src.charAt(pos++);
                    switch (esc) {
                        case '"': sb.append('"'); break;
                        case '\\': sb.append('\\'); break;
                        case '/': sb.append('/'); break;
                        case 'b': sb.append('\b'); break;
                        case 'f': sb.append('\f'); break;
                        case 'n': sb.append('\n'); break;
                        case 'r': sb.append('\r'); break;
                        case 't': sb.append('\t'); break;
                        case 'u':
                            if (pos + 4 <= src.length()) {
                                String hex = src.substring(pos, pos + 4);
                                pos += 4;
                                sb.append((char) Integer.parseInt(hex, 16));
                            }
                            break;
                        default:
                            sb.append(esc);
                            break;
                    }
                } else {
                    sb.append(c);
                }
            }
            throw new IllegalArgumentException("Unterminated string");
        }

        private Number parseNumber() {
            int start = pos;
            if (pos < src.length() && src.charAt(pos) == '-') pos++;
            while (pos < src.length() && Character.isDigit(src.charAt(pos))) pos++;
            boolean isFloat = false;
            if (pos < src.length() && src.charAt(pos) == '.') {
                isFloat = true;
                pos++;
                while (pos < src.length() && Character.isDigit(src.charAt(pos))) pos++;
            }
            if (pos < src.length() && (src.charAt(pos) == 'e' || src.charAt(pos) == 'E')) {
                isFloat = true;
                pos++;
                if (pos < src.length() && (src.charAt(pos) == '+' || src.charAt(pos) == '-')) pos++;
                while (pos < src.length() && Character.isDigit(src.charAt(pos))) pos++;
            }
            String num = src.substring(start, pos);
            if (isFloat) return Double.parseDouble(num);
            try {
                return Long.parseLong(num);
            } catch (NumberFormatException e) {
                return Double.parseDouble(num);
            }
        }
    }
}
