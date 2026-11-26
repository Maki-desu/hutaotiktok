package com.hutaotik.app;

import android.content.Intent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.ContentValues;
import android.content.IntentFilter;
import android.database.Cursor;
import android.app.DownloadManager;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.os.Bundle;
import android.provider.Settings;
import android.provider.MediaStore;
import android.widget.Toast;
import android.util.Log;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;

import androidx.documentfile.provider.DocumentFile;
import androidx.core.content.FileProvider;
import com.getcapacitor.BridgeActivity;
import com.yausername.ffmpeg.FFmpeg;
import com.yausername.youtubedl_android.YoutubeDL;
import com.yausername.youtubedl_android.YoutubeDLException;
import com.yausername.youtubedl_android.YoutubeDLRequest;
import com.yausername.youtubedl_android.mapper.VideoInfo;

import org.json.JSONException;
import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.io.FileInputStream;
import java.io.OutputStream;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.Locale;
import java.util.Map;
import java.util.TreeMap;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicReference;

public class MainActivity extends BridgeActivity {
    private static final String TAG = "HutaoTik";
    private static final int REQUEST_CODE_PICK_FOLDER = 9999;
    private static final String FACEBOOK_FOLDER_PREF = "facebook_download_folder_uri";
    private static final AtomicReference<String> pendingSharedText = new AtomicReference<>();
    private final ExecutorService facebookExecutor = Executors.newSingleThreadExecutor();
    private final ExecutorService youtubeExecutor = Executors.newSingleThreadExecutor();
    private final ExecutorService socialExecutor = Executors.newFixedThreadPool(2);
    private final ExecutorService updateExecutor = Executors.newSingleThreadExecutor();
    private final Object ytDlpUpdateLock = new Object();
    private volatile String facebookInitError;
    private volatile String facebookFfmpegInitError;
    private volatile String youtubeInitError;
    private volatile boolean youtubeUpdateChecked;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getBridge().getWebView().addJavascriptInterface(new WebAppInterface(), "AndroidStorageBridge");
        try {
            YoutubeDL.getInstance().init(getApplicationContext());
        } catch (Exception e) {
            youtubeInitError = e.getMessage();
            facebookInitError = e.getMessage();
        }
        try {
            FFmpeg.getInstance().init(getApplicationContext());
        } catch (Exception e) {
            facebookFfmpegInitError = e.getMessage();
        }
        handleSendIntent(getIntent());
    }

    public class WebAppInterface {
        @JavascriptInterface
        public String installAppUpdate(String rawUrl, String expectedSha256) {
            if (rawUrl == null || !rawUrl.startsWith("https://") ||
                expectedSha256 == null ||
                (!expectedSha256.isEmpty() && !expectedSha256.matches("(?i)[0-9a-f]{64}"))) {
                return "failed";
            }

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O &&
                !getPackageManager().canRequestPackageInstalls()) {
                runOnUiThread(() -> {
                    Intent settingsIntent = new Intent(
                        Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                        Uri.parse("package:" + getPackageName())
                    );
                    startActivity(settingsIntent);
                });
                return "permission_required";
            }

            File downloadDirectory = getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS);
            if (downloadDirectory == null) return "failed";
            File apkFile = new File(downloadDirectory, "hutaotik-update.apk");
            if (apkFile.exists() && !apkFile.delete()) return "failed";

            DownloadManager manager = (DownloadManager) getSystemService(Context.DOWNLOAD_SERVICE);
            if (manager == null) return "failed";

            try {
                DownloadManager.Request request = new DownloadManager.Request(Uri.parse(rawUrl));
                request.setTitle("Hutaotik update");
                request.setDescription("Downloading the latest Hutaotik release");
                request.setMimeType("application/vnd.android.package-archive");
                request.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
                request.setDestinationInExternalFilesDir(
                    MainActivity.this,
                    Environment.DIRECTORY_DOWNLOADS,
                    apkFile.getName()
                );
                long downloadId = manager.enqueue(request);
                BroadcastReceiver receiver = new BroadcastReceiver() {
                    @Override
                    public void onReceive(Context context, Intent intent) {
                        if (!DownloadManager.ACTION_DOWNLOAD_COMPLETE.equals(intent.getAction()) ||
                            intent.getLongExtra(DownloadManager.EXTRA_DOWNLOAD_ID, -1) != downloadId) {
                            return;
                        }

                        unregisterReceiver(this);
                        updateExecutor.execute(() -> {
                            try (Cursor cursor = manager.query(new DownloadManager.Query().setFilterById(downloadId))) {
                                if (cursor == null || !cursor.moveToFirst() ||
                                    cursor.getInt(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS)) !=
                                        DownloadManager.STATUS_SUCCESSFUL) {
                                    showUpdateToast("Hutaotik update download failed.");
                                    return;
                                }
                                if (!expectedSha256.isEmpty() &&
                                    !expectedSha256.equalsIgnoreCase(calculateSha256(apkFile))) {
                                    apkFile.delete();
                                    showUpdateToast("The downloaded update failed its integrity check.");
                                    return;
                                }

                                Uri apkUri = FileProvider.getUriForFile(
                                    MainActivity.this,
                                    getPackageName() + ".fileprovider",
                                    apkFile
                                );
                                Intent installIntent = new Intent(Intent.ACTION_VIEW);
                                installIntent.setDataAndType(apkUri, "application/vnd.android.package-archive");
                                installIntent.addFlags(
                                    Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK
                                );
                                runOnUiThread(() -> startActivity(installIntent));
                            } catch (Exception e) {
                                showUpdateToast("Could not open the Hutaotik installer: " + e.getMessage());
                            }
                        });
                    }
                };
                IntentFilter filter = new IntentFilter(DownloadManager.ACTION_DOWNLOAD_COMPLETE);
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                    registerReceiver(receiver, filter, Context.RECEIVER_NOT_EXPORTED);
                } else {
                    registerReceiver(receiver, filter);
                }
                return "started";
            } catch (RuntimeException e) {
                return "failed";
            }
        }

        private String calculateSha256(File file) throws Exception {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] buffer = new byte[32768];
            try (FileInputStream input = new FileInputStream(file)) {
                int count;
                while ((count = input.read(buffer)) != -1) {
                    digest.update(buffer, 0, count);
                }
            }
            StringBuilder result = new StringBuilder(64);
            for (byte value : digest.digest()) {
                int unsigned = value & 0xff;
                result.append(Character.forDigit(unsigned >>> 4, 16));
                result.append(Character.forDigit(unsigned & 0x0f, 16));
            }
            return result.toString();
        }

        private void showUpdateToast(String message) {
            runOnUiThread(() -> Toast.makeText(MainActivity.this, message, Toast.LENGTH_LONG).show());
        }

        @JavascriptInterface
        public void getFacebookInfo(String url, String requestId) {
            facebookExecutor.execute(() -> {
                try {
                    ensureFacebookUrl(url);
                    ensureFacebookDownloader();
                    VideoInfo info = YoutubeDL.getInstance().getInfo(createFacebookRequest(url));
                    JSONObject data = new JSONObject();
                    data.put("title", info.getTitle() != null ? info.getTitle() : "Facebook Video");
                    data.put("thumbnail", info.getThumbnail());
                    data.put("hdUrl", JSONObject.NULL);
                    data.put("sdUrl", JSONObject.NULL);
                    data.put("nativeDownload", true);
                    sendFacebookResult(requestId, data);
                } catch (Exception e) {
                    sendFacebookError(requestId, e);
                }
            });
        }

        @JavascriptInterface
        public void downloadFacebook(String url, String quality, String filename, String folderName, String requestId) {
            facebookExecutor.execute(() -> {
                try {
                    ensureFacebookUrl(url);
                    ensureFacebookDownloader();
                    File output = downloadFacebookFile(url, quality, filename);
                    saveFacebookFile(output, filename, folderName);
                    sendFacebookResult(requestId, new JSONObject());
                } catch (Exception e) {
                    sendFacebookError(requestId, e);
                }
            });
        }

        @JavascriptInterface
        public void getYouTubeInfo(String url, String requestId) {
            youtubeExecutor.execute(() -> {
                try {
                    ensureYouTubeUrl(url);
                    ensureYouTubeDownloader();
                    VideoInfo info = YoutubeDL.getInstance().getInfo(createYouTubeRequest(url));
                    String audioId = null;
                    for (com.yausername.youtubedl_android.mapper.VideoFormat format : info.getFormats()) {
                        String audioCodec = format.getAcodec();
                        String formatId = format.getFormatId();
                        if ("none".equals(format.getVcodec()) &&
                            audioCodec != null && audioCodec.startsWith("mp4a") &&
                            "m4a".equals(format.getExt()) &&
                            formatId != null && formatId.matches("\\d+")) {
                            audioId = formatId;
                        }
                    }

                    TreeMap<Integer, String> availableFormats = new TreeMap<>((a, b) -> b.compareTo(a));
                    for (com.yausername.youtubedl_android.mapper.VideoFormat format : info.getFormats()) {
                        String videoCodec = format.getVcodec();
                        String audioCodec = format.getAcodec();
                        String formatId = format.getFormatId();
                        String ext = format.getExt();
                        if (videoCodec == null || "none".equals(videoCodec) || audioCodec == null ||
                            (!"mp4".equals(ext) && !"webm".equals(ext)) ||
                            formatId == null || !formatId.matches("\\d+") ||
                            format.getHeight() <= 0) {
                            continue;
                        }

                        boolean needsMux = "none".equals(audioCodec);
                        if (needsMux && audioId == null) continue;
                        availableFormats.put(
                            format.getHeight(),
                            needsMux ? formatId + "+" + audioId : formatId
                        );
                    }

                    JSONArray formats = new JSONArray();
                    for (Map.Entry<Integer, String> entry : availableFormats.entrySet()) {
                        JSONObject format = new JSONObject();
                        format.put("formatStr", entry.getValue());
                        format.put("qualityLabel", entry.getKey() + "p");
                        format.put("needsMux", entry.getValue().contains("+"));
                        formats.put(format);
                    }

                    JSONObject data = new JSONObject();
                    data.put("id", info.getId() != null ? info.getId() : "");
                    data.put("title", info.getTitle() != null ? info.getTitle() : "YouTube Video");
                    data.put("thumbnail", info.getThumbnail() != null ? info.getThumbnail() : JSONObject.NULL);
                    data.put("channelName", info.getUploader() != null ? info.getUploader() : "Unknown");
                    data.put("duration", info.getDuration());
                    data.put("formats", formats);
                    sendYouTubeResult(requestId, data);
                } catch (Exception e) {
                    sendYouTubeError(requestId, e);
                }
            });
        }

        @JavascriptInterface
        public void downloadYouTube(String url, String formatStr, String filename, String folderName, String requestId) {
            youtubeExecutor.execute(() -> {
                File outputDir = null;
                try {
                    ensureYouTubeUrl(url);
                    ensureYouTubeDownloader();
                    outputDir = downloadYouTubeFile(url, formatStr);
                    File output = findYouTubeOutput(outputDir, "audio".equals(formatStr));
                    saveYouTubeFile(output, filename, folderName);
                    sendYouTubeResult(requestId, new JSONObject());
                } catch (Exception e) {
                    sendYouTubeError(requestId, e);
                } finally {
                    if (outputDir != null) deleteYouTubeTempDirectory(outputDir);
                }
            });
        }

        @JavascriptInterface
        public void getSocialVideoInfo(String platform, String url, String requestId) {
            socialExecutor.execute(() -> {
                try {
                    String normalizedPlatform = normalizeSocialPlatform(platform);
                    JSONObject data = fetchSocialVideoInfoNative(normalizedPlatform, url);
                    sendSocialVideoResult(requestId, data);
                } catch (Exception e) {
                    sendSocialVideoError(requestId, e);
                }
            });
        }

        @JavascriptInterface
        public void downloadSocialVideo(
            String platform,
            String url,
            String directUrl,
            String mediaType,
            String filename,
            String folderName,
            String requestId
        ) {
            socialExecutor.execute(() -> {
                File outputDir = null;
                try {
                    String normalizedPlatform = normalizeSocialPlatform(platform);
                    outputDir = new File(new File(getCacheDir(), "social-downloads"), UUID.randomUUID().toString());
                    if (!outputDir.mkdirs()) {
                        throw new IllegalStateException("Could not create temporary download directory.");
                    }
                    SocialDownloadResult result = downloadSocialMediaToTemp(
                        normalizedPlatform,
                        url,
                        directUrl,
                        mediaType,
                        outputDir
                    );
                    String finalFilename = ensureFilenameExtension(filename, result.extension);
                    saveFileToUserFolder(result.file, finalFilename, folderName, result.mimeType);
                    JSONObject response = new JSONObject();
                    response.put("filename", finalFilename);
                    response.put("mediaType", result.mediaType);
                    sendSocialVideoResult(requestId, response);
                } catch (Exception e) {
                    sendSocialVideoError(requestId, e);
                } finally {
                    if (outputDir != null) deleteYouTubeTempDirectory(outputDir);
                }
            });
        }

        @JavascriptInterface
        public void openDeviceFolderPicker() {
            try {
                Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
                intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION |
                                Intent.FLAG_GRANT_WRITE_URI_PERMISSION |
                                Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
                startActivityForResult(intent, REQUEST_CODE_PICK_FOLDER);
            } catch (Exception e) {
                e.printStackTrace();
            }
        }

        @JavascriptInterface
        public String getPendingSharedText() {
            String text = pendingSharedText.getAndSet(null);
            return text != null ? text : "";
        }
    }

    private YoutubeDLRequest createFacebookRequest(String url) {
        return new YoutubeDLRequest(url)
            .addOption("--no-playlist")
            .addOption("--no-warnings")
            .addOption("--socket-timeout", "25")
            .addOption("--add-header", "Referer:https://www.facebook.com/");
    }

    private YoutubeDLRequest createYouTubeRequest(String url) {
        return new YoutubeDLRequest(url)
            .addOption("--no-playlist")
            .addOption("--no-warnings")
            .addOption("--socket-timeout", "25");
    }

    private File downloadYouTubeFile(String url, String formatStr) throws Exception {
        boolean audio = "audio".equals(formatStr);
        if (!audio && (formatStr == null || !formatStr.matches("\\d+(?:\\+\\d+)?"))) {
            throw new IllegalArgumentException("Select a valid YouTube video quality.");
        }

        File outputDir = new File(new File(getCacheDir(), "youtube-downloads"), UUID.randomUUID().toString());
        if (!outputDir.mkdirs()) {
            throw new IllegalStateException("Could not create a temporary YouTube download directory.");
        }

        File outputTemplate = new File(outputDir, "youtube.%(ext)s");
        YoutubeDLRequest request = createYouTubeRequest(url)
            .addOption("-f", audio ? "bestaudio[ext=m4a]" : formatStr)
            .addOption("-o", outputTemplate.getAbsolutePath());
        if (!audio) {
            request.addOption("--merge-output-format", "mp4")
                .addOption("--remux-video", "mp4");
        }
        try {
            YoutubeDL.getInstance().execute(request);
        } catch (Exception e) {
            deleteYouTubeTempDirectory(outputDir);
            throw e;
        }
        return outputDir;
    }

    private File findYouTubeOutput(File outputDir, boolean audio) {
        File[] files = outputDir.listFiles();
        if (files != null) {
            for (File file : files) {
                String name = file.getName().toLowerCase(Locale.ROOT);
                boolean expectedExtension = audio ? name.endsWith(".m4a") : name.endsWith(".mp4");
                if (file.isFile() && file.length() > 0 && expectedExtension) return file;
            }
        }
        throw new IllegalStateException(
            audio
                ? "No compatible M4A audio stream was available for this YouTube video."
                : "No video stream could be muxed into an MP4 download for this video."
        );
    }

    private void deleteYouTubeTempDirectory(File directory) {
        File[] children = directory.listFiles();
        if (children != null) {
            for (File child : children) {
                if (child.isDirectory()) deleteYouTubeTempDirectory(child);
                else child.delete();
            }
        }
        directory.delete();
    }

    private void saveYouTubeFile(File source, String filename, String folderName) throws Exception {
        String safeFilename = filename.replaceAll("[<>:\"/\\\\|?*\\x00-\\x1f]", " ").trim();
        if (safeFilename.isEmpty() || safeFilename.equals(".") || safeFilename.equals("..")) {
            throw new IllegalArgumentException("Invalid YouTube download filename.");
        }
        String safeFolder = (folderName != null ? folderName : "")
            .replaceAll("[<>:\"/\\\\|?*\\x00-\\x1f]", " ").trim();
        if (safeFolder.isEmpty() || safeFolder.equals(".") || safeFolder.equals("..")) {
            safeFolder = "HutaoTik Downloads";
        }
        boolean audio = safeFilename.toLowerCase(Locale.ROOT).endsWith(".m4a");
        String mimeType = audio ? "audio/mp4" : "video/mp4";
        String folderUri = getSharedPreferences("hutaotik", MODE_PRIVATE)
            .getString(FACEBOOK_FOLDER_PREF, null);

        if (folderUri != null) {
            DocumentFile directory = DocumentFile.fromTreeUri(this, Uri.parse(folderUri));
            if (directory == null || !directory.canWrite()) {
                throw new IllegalStateException("The selected download folder is no longer writable. Please select it again.");
            }
            DocumentFile oldFile = directory.findFile(safeFilename);
            if (oldFile != null && !oldFile.delete()) {
                throw new IllegalStateException("Could not replace the existing download.");
            }
            DocumentFile destination = directory.createFile(mimeType, safeFilename);
            if (destination == null) throw new IllegalStateException("Could not create the downloaded file.");
            try {
                try (OutputStream stream = getContentResolver().openOutputStream(destination.getUri())) {
                    if (stream == null) throw new IllegalStateException("Could not open the destination file.");
                    copyYouTubeFile(source, stream);
                }
            } catch (Exception e) {
                destination.delete();
                throw e;
            }
            return;
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            ContentValues values = new ContentValues();
            values.put(MediaStore.MediaColumns.DISPLAY_NAME, safeFilename);
            values.put(MediaStore.MediaColumns.MIME_TYPE, mimeType);
            values.put(
                MediaStore.MediaColumns.RELATIVE_PATH,
                Environment.DIRECTORY_DOCUMENTS + "/" + safeFolder
            );
            values.put(MediaStore.MediaColumns.IS_PENDING, 1);
            Uri destination = getContentResolver().insert(
                MediaStore.Files.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY),
                values
            );
            if (destination == null) throw new IllegalStateException("Could not create the downloaded file.");
            try {
                try (OutputStream stream = getContentResolver().openOutputStream(destination)) {
                    if (stream == null) throw new IllegalStateException("Could not open the destination file.");
                    copyYouTubeFile(source, stream);
                }
                ContentValues completed = new ContentValues();
                completed.put(MediaStore.MediaColumns.IS_PENDING, 0);
                getContentResolver().update(destination, completed, null, null);
            } catch (Exception e) {
                getContentResolver().delete(destination, null, null);
                throw e;
            }
            return;
        }

        File documents = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOCUMENTS);
        File directory = new File(documents, safeFolder);
        if (!directory.exists() && !directory.mkdirs()) {
            throw new IllegalStateException("Could not create the Documents download folder.");
        }
        try (OutputStream stream = new java.io.FileOutputStream(new File(directory, safeFilename))) {
            copyYouTubeFile(source, stream);
        }
    }

    private void copyYouTubeFile(File source, OutputStream destination) throws Exception {
        try (FileInputStream input = new FileInputStream(source)) {
            byte[] buffer = new byte[64 * 1024];
            int count;
            while ((count = input.read(buffer)) != -1) destination.write(buffer, 0, count);
        }
    }

    private void ensureYouTubeUrl(String value) {
        Uri uri = Uri.parse(value);
        String host = uri.getHost();
        String normalizedHost = host != null ? host.toLowerCase(Locale.ROOT) : "";
        if (!"https".equalsIgnoreCase(uri.getScheme()) && !"http".equalsIgnoreCase(uri.getScheme())) {
            throw new IllegalArgumentException("Enter a valid YouTube video URL.");
        }
        if (!(normalizedHost.equals("youtube.com") || normalizedHost.endsWith(".youtube.com") ||
            normalizedHost.equals("youtube-nocookie.com") || normalizedHost.endsWith(".youtube-nocookie.com") ||
            normalizedHost.equals("youtu.be"))) {
            throw new IllegalArgumentException("Enter a valid YouTube video URL.");
        }
    }

    private void ensureYouTubeDownloader() {
        if (youtubeInitError != null) {
            throw new IllegalStateException("The on-device downloader could not start: " + youtubeInitError);
        }
        synchronized (ytDlpUpdateLock) {
            if (!youtubeUpdateChecked) {
                youtubeUpdateChecked = true;
                try {
                    YoutubeDL.UpdateStatus status = YoutubeDL.getInstance().updateYoutubeDL(
                        getApplicationContext(),
                        YoutubeDL.UpdateChannel._NIGHTLY
                    );
                    Log.i(TAG, "yt-dlp update check completed: " + status);
                } catch (YoutubeDLException | RuntimeException e) {
                    Log.w(TAG, "Could not update yt-dlp; continuing with the bundled version.", e);
                }
            }
        }
    }

    private static final class SocialDownloadResult {
        final File file;
        final String mimeType;
        final String extension;
        final String mediaType;

        SocialDownloadResult(File file, String mimeType, String extension, String mediaType) {
            this.file = file;
            this.mimeType = mimeType;
            this.extension = extension;
            this.mediaType = mediaType;
        }
    }

    private String normalizeSocialPlatform(String platform) {
        if ("pinterest".equalsIgnoreCase(platform)) return "pinterest";
        if ("instagram".equalsIgnoreCase(platform)) return "instagram";
        throw new IllegalArgumentException("Unsupported social platform.");
    }

    private YoutubeDLRequest createSocialVideoRequest(String platform, String url) {
        YoutubeDLRequest request = new YoutubeDLRequest(url)
            .addOption("--no-playlist")
            .addOption("--playlist-items", "1")
            .addOption("--no-warnings")
            .addOption("--no-check-certificates")
            .addOption("--socket-timeout", "25");
        if ("pinterest".equals(platform)) {
            request.addOption("--add-header", "Referer:https://www.pinterest.com/");
        }
        return request;
    }

    private JSONObject fetchSocialVideoInfoNative(String platform, String rawUrl) throws Exception {
        String providerName = "instagram".equals(platform) ? "Instagram" : "Pinterest";
        if (!SocialMediaExtractor.isSocialUrl(platform, rawUrl)) {
            throw new IllegalArgumentException(
                "instagram".equals(platform)
                    ? "Enter a valid Instagram post or Reel URL."
                    : "Enter a valid Pinterest Pin or pin.it URL."
            );
        }

        String canonicalUrl = SocialMediaExtractor.resolveCanonicalUrl(platform, rawUrl);

        // Tier 1: Fast direct HTML / Embed / GraphQL extraction on the user's residential IP
        SocialMediaExtractor.ExtractedMedia direct = "instagram".equals(platform)
            ? SocialMediaExtractor.extractInstagram(canonicalUrl)
            : SocialMediaExtractor.extractPinterest(canonicalUrl);

        if (direct != null && direct.hasDownloadableVideo()) {
            return buildSocialInfoJson(direct, providerName);
        }

        // Tier 2: On-device yt-dlp extraction (auto-updated nightly + bundled FFmpeg)
        Exception ytDlpError = null;
        if (youtubeInitError == null) {
            try {
                ensureYouTubeDownloader();
                VideoInfo info = YoutubeDL.getInstance().getInfo(createSocialVideoRequest(platform, canonicalUrl));
                int maxHeight = 0;
                boolean hasVideo = info.getUrl() != null && !info.getUrl().isEmpty();
                java.util.ArrayList<com.yausername.youtubedl_android.mapper.VideoFormat> formats = info.getFormats();
                if (formats != null) {
                    for (com.yausername.youtubedl_android.mapper.VideoFormat format : formats) {
                        if (format == null) continue;
                        String vcodec = format.getVcodec();
                        boolean isVideoFormat = vcodec == null || !"none".equalsIgnoreCase(vcodec);
                        if (isVideoFormat) {
                            if (format.getUrl() != null && !format.getUrl().isEmpty()) {
                                hasVideo = true;
                            }
                            if (format.getHeight() > maxHeight) {
                                maxHeight = format.getHeight();
                            }
                        }
                    }
                }
                if (maxHeight <= 0 && info.getHeight() > 0) {
                    maxHeight = info.getHeight();
                }

                if (hasVideo) {
                    JSONObject data = new JSONObject();
                    data.put("id", info.getId() != null ? info.getId() : "");
                    data.put("title", info.getTitle() != null && !info.getTitle().trim().isEmpty()
                        ? info.getTitle().trim()
                        : providerName + " Video");
                    data.put("thumbnail", info.getThumbnail() != null ? info.getThumbnail() : JSONObject.NULL);
                    data.put("channelName", info.getUploader() != null && !info.getUploader().trim().isEmpty()
                        ? info.getUploader().trim()
                        : providerName);
                    data.put("duration", Math.max(0, info.getDuration()));
                    data.put("height", maxHeight > 0 ? maxHeight : JSONObject.NULL);
                    data.put("mediaType", "video");
                    data.put("directUrl", JSONObject.NULL);
                    data.put("canonicalUrl", canonicalUrl);
                    data.put("nativeDownload", true);
                    return data;
                }
            } catch (Exception e) {
                ytDlpError = e;
                Log.w(TAG, "On-device yt-dlp info failed for " + platform + ": " + e.getMessage());
            }
        }

        // Tier 3: If this Pin / post is a verified image (not a video), allow downloading the image
        if (direct != null && direct.hasDownloadableImage() && !direct.isVideoPost) {
            return buildSocialInfoJson(direct, providerName);
        }

        String detail = ytDlpError != null && ytDlpError.getMessage() != null
            ? ytDlpError.getMessage()
            : ("instagram".equals(platform)
                ? "Could not fetch this Instagram media. It may be private, unavailable, or require login."
                : "Could not fetch this Pinterest Pin. It may be private or unavailable.");
        throw new IllegalStateException(detail);
    }

    private JSONObject buildSocialInfoJson(SocialMediaExtractor.ExtractedMedia media, String providerName)
        throws JSONException {
        JSONObject data = new JSONObject();
        data.put("id", media.id);
        data.put("title", media.title != null && !media.title.isEmpty()
            ? media.title
            : ("image".equals(media.mediaType) ? providerName + " Image" : providerName + " Video"));
        data.put("thumbnail", media.thumbnail != null ? media.thumbnail : JSONObject.NULL);
        data.put("channelName", media.channelName != null && !media.channelName.isEmpty()
            ? media.channelName
            : providerName);
        data.put("duration", media.duration);
        data.put("height", media.height != null ? media.height : JSONObject.NULL);
        data.put("mediaType", media.mediaType);
        String preferredDirect = media.directUrl != null ? media.directUrl : media.hlsUrl;
        data.put("directUrl", preferredDirect != null ? preferredDirect : JSONObject.NULL);
        data.put("canonicalUrl", media.canonicalUrl != null ? media.canonicalUrl : JSONObject.NULL);
        data.put("nativeDownload", true);
        return data;
    }

    private SocialDownloadResult downloadSocialMediaToTemp(
        String platform,
        String rawUrl,
        String directUrl,
        String mediaType,
        File outputDir
    ) throws Exception {
        String canonicalUrl = SocialMediaExtractor.resolveCanonicalUrl(platform, rawUrl);

        if ("image".equalsIgnoreCase(mediaType)) {
            String imageUrl = SocialMediaExtractor.isAllowedMediaUrl(platform, directUrl) ? directUrl : null;
            if (imageUrl == null) {
                SocialMediaExtractor.ExtractedMedia fresh = "instagram".equals(platform)
                    ? SocialMediaExtractor.extractInstagram(canonicalUrl)
                    : SocialMediaExtractor.extractPinterest(canonicalUrl);
                if (fresh != null && fresh.directUrl != null) {
                    imageUrl = fresh.directUrl;
                }
            }
            if (imageUrl == null) {
                throw new IllegalStateException("Could not resolve a downloadable image URL.");
            }
            String[] extMime = SocialMediaExtractor.inferImageExtensionAndMime(imageUrl, "jpg").split("\\|");
            File tempImage = new File(outputDir, "social_image." + extMime[0]);
            SocialMediaExtractor.downloadUrlToFile(platform, imageUrl, tempImage, true);
            return new SocialDownloadResult(tempImage, extMime[1], extMime[0], "image");
        }

        boolean directIsHls = directUrl != null && directUrl.toLowerCase(Locale.ROOT).contains(".m3u8");
        boolean directIsAllowed = SocialMediaExtractor.isAllowedMediaUrl(platform, directUrl);

        // Fast path: direct MP4 download (non-HLS) from validated platform CDN
        if (directIsAllowed && !directIsHls) {
            File directFile = new File(outputDir, "social_direct.mp4");
            try {
                SocialMediaExtractor.downloadUrlToFile(platform, directUrl, directFile, false);
                return new SocialDownloadResult(directFile, "video/mp4", "mp4", "video");
            } catch (Exception e) {
                directFile.delete();
                Log.w(TAG, "Direct media download failed for " + platform + ", falling back to yt-dlp", e);
            }
        }

        // Primary muxing/HLS/DASH path: on-device yt-dlp + bundled FFmpeg
        Exception ytDlpError = null;
        if (youtubeInitError == null) {
            try {
                ensureYouTubeDownloader();
                File downloaded = downloadSocialWithYtDlp(platform, canonicalUrl, outputDir);
                return new SocialDownloadResult(downloaded, "video/mp4", "mp4", "video");
            } catch (Exception e) {
                ytDlpError = e;
                Log.w(TAG, "On-device yt-dlp download failed on canonical URL for " + platform, e);
            }

            if (directIsAllowed && directIsHls) {
                try {
                    File downloaded = downloadSocialWithYtDlp(platform, directUrl, outputDir);
                    return new SocialDownloadResult(downloaded, "video/mp4", "mp4", "video");
                } catch (Exception e) {
                    ytDlpError = e;
                    Log.w(TAG, "On-device yt-dlp HLS download failed for " + platform, e);
                }
            }
        }

        // Final on-device rescue: re-extract fresh URL (handles expired Instagram CDN tokens or pin.it changes)
        SocialMediaExtractor.ExtractedMedia fresh = "instagram".equals(platform)
            ? SocialMediaExtractor.extractInstagram(canonicalUrl)
            : SocialMediaExtractor.extractPinterest(canonicalUrl);
        if (fresh != null && fresh.hasDownloadableVideo()) {
            if (fresh.directUrl != null && !fresh.directUrl.equals(directUrl) &&
                SocialMediaExtractor.isAllowedMediaUrl(platform, fresh.directUrl)) {
                File freshFile = new File(outputDir, "social_fresh.mp4");
                SocialMediaExtractor.downloadUrlToFile(platform, fresh.directUrl, freshFile, false);
                return new SocialDownloadResult(freshFile, "video/mp4", "mp4", "video");
            }
            if (fresh.hlsUrl != null && youtubeInitError == null &&
                SocialMediaExtractor.isAllowedMediaUrl(platform, fresh.hlsUrl)) {
                File freshHls = downloadSocialWithYtDlp(platform, fresh.hlsUrl, outputDir);
                return new SocialDownloadResult(freshHls, "video/mp4", "mp4", "video");
            }
        }

        if (ytDlpError != null) throw ytDlpError;
        throw new IllegalStateException("Could not download this " + platform + " video on device.");
    }

    private File downloadSocialWithYtDlp(String platform, String targetUrl, File outputDir) throws Exception {
        File runDir = new File(outputDir, "ytdlp_" + UUID.randomUUID().toString());
        if (!runDir.mkdirs()) {
            throw new IllegalStateException("Could not prepare yt-dlp download directory.");
        }
        File outputTemplate = new File(runDir, "social.%(ext)s");
        boolean hasFfmpeg = facebookFfmpegInitError == null;

        YoutubeDLRequest request = createSocialVideoRequest(platform, targetUrl)
            .addOption("-o", outputTemplate.getAbsolutePath());

        if (hasFfmpeg) {
            request.addOption("-f", "bestvideo[ext=mp4]+bestaudio[ext=m4a]/bestvideo+bestaudio/best[ext=mp4]/best")
                .addOption("--merge-output-format", "mp4")
                .addOption("--remux-video", "mp4");
        } else {
            request.addOption("-f", "best[ext=mp4]/best");
        }

        try {
            YoutubeDL.getInstance().execute(request);
        } catch (Exception firstError) {
            if (!hasFfmpeg) throw firstError;
            // Retry with progressive MP4 fallback if remuxing/merging hits a codec snag
            clearDirectoryFiles(runDir);
            YoutubeDLRequest fallbackRequest = createSocialVideoRequest(platform, targetUrl)
                .addOption("-f", "best[ext=mp4]/best")
                .addOption("-o", outputTemplate.getAbsolutePath());
            YoutubeDL.getInstance().execute(fallbackRequest);
        }

        File[] files = runDir.listFiles();
        File fallbackCandidate = null;
        if (files != null) {
            for (File file : files) {
                if (!file.isFile() || file.length() <= 0) continue;
                String name = file.getName().toLowerCase(Locale.ROOT);
                if (name.endsWith(".part") || name.endsWith(".ytdl")) continue;
                if (name.endsWith(".mp4")) return file;
                if (fallbackCandidate == null) fallbackCandidate = file;
            }
        }
        if (fallbackCandidate != null) return fallbackCandidate;
        throw new IllegalStateException("yt-dlp did not create a video file.");
    }

    private void clearDirectoryFiles(File dir) {
        File[] files = dir.listFiles();
        if (files == null) return;
        for (File file : files) {
            if (file.isDirectory()) deleteYouTubeTempDirectory(file);
            else file.delete();
        }
    }

    private String ensureFilenameExtension(String filename, String extension) {
        String base = (filename != null ? filename : "video")
            .replaceAll("[<>:\"/\\\\|?*\\x00-\\x1f]", " ")
            .trim();
        if (base.isEmpty() || base.equals(".") || base.equals("..")) {
            base = "download";
        }
        String suffix = "." + extension;
        if (base.toLowerCase(Locale.ROOT).endsWith(suffix.toLowerCase(Locale.ROOT))) {
            return base;
        }
        int dot = base.lastIndexOf('.');
        if (dot > 0 && dot >= base.length() - 5) {
            base = base.substring(0, dot);
        }
        return base + suffix;
    }

    private void saveFileToUserFolder(File source, String filename, String folderName, String mimeType) throws Exception {
        String safeFilename = filename.replaceAll("[<>:\"/\\\\|?*\\x00-\\x1f]", " ").trim();
        if (safeFilename.isEmpty() || safeFilename.equals(".") || safeFilename.equals("..")) {
            throw new IllegalArgumentException("Invalid download filename.");
        }
        String safeFolder = (folderName != null ? folderName : "")
            .replaceAll("[<>:\"/\\\\|?*\\x00-\\x1f]", " ").trim();
        if (safeFolder.isEmpty() || safeFolder.equals(".") || safeFolder.equals("..")) {
            safeFolder = "HutaoTik Downloads";
        }
        String folderUri = getSharedPreferences("hutaotik", MODE_PRIVATE)
            .getString(FACEBOOK_FOLDER_PREF, null);

        if (folderUri != null) {
            DocumentFile directory = DocumentFile.fromTreeUri(this, Uri.parse(folderUri));
            if (directory == null || !directory.canWrite()) {
                throw new IllegalStateException("The selected download folder is no longer writable. Please select it again.");
            }
            DocumentFile oldFile = directory.findFile(safeFilename);
            if (oldFile != null && !oldFile.delete()) {
                throw new IllegalStateException("Could not replace the existing download.");
            }
            DocumentFile destination = directory.createFile(mimeType, safeFilename);
            if (destination == null) throw new IllegalStateException("Could not create the downloaded file.");
            try {
                try (OutputStream stream = getContentResolver().openOutputStream(destination.getUri())) {
                    if (stream == null) throw new IllegalStateException("Could not open the destination file.");
                    copyYouTubeFile(source, stream);
                }
            } catch (Exception e) {
                destination.delete();
                throw e;
            }
            return;
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            ContentValues values = new ContentValues();
            values.put(MediaStore.MediaColumns.DISPLAY_NAME, safeFilename);
            values.put(MediaStore.MediaColumns.MIME_TYPE, mimeType);
            values.put(
                MediaStore.MediaColumns.RELATIVE_PATH,
                Environment.DIRECTORY_DOCUMENTS + "/" + safeFolder
            );
            values.put(MediaStore.MediaColumns.IS_PENDING, 1);
            Uri destination = getContentResolver().insert(
                MediaStore.Files.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY),
                values
            );
            if (destination == null) throw new IllegalStateException("Could not create the downloaded file.");
            try {
                try (OutputStream stream = getContentResolver().openOutputStream(destination)) {
                    if (stream == null) throw new IllegalStateException("Could not open the destination file.");
                    copyYouTubeFile(source, stream);
                }
                ContentValues completed = new ContentValues();
                completed.put(MediaStore.MediaColumns.IS_PENDING, 0);
                getContentResolver().update(destination, completed, null, null);
            } catch (Exception e) {
                getContentResolver().delete(destination, null, null);
                throw e;
            }
            return;
        }

        File documents = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOCUMENTS);
        File directory = new File(documents, safeFolder);
        if (!directory.exists() && !directory.mkdirs()) {
            throw new IllegalStateException("Could not create the Documents download folder.");
        }
        try (OutputStream stream = new java.io.FileOutputStream(new File(directory, safeFilename))) {
            copyYouTubeFile(source, stream);
        }
    }

    private void sendSocialVideoError(String requestId, Exception error) {
        JSONObject result = new JSONObject();
        try {
            result.put("error", error.getMessage() != null ? error.getMessage() : "Download failed.");
        } catch (JSONException e) {
            throw new IllegalStateException(e);
        }
        sendSocialVideoResult(requestId, result);
    }

    private void sendSocialVideoResult(String requestId, JSONObject result) {
        WebView webView = getBridge().getWebView();
        String script = "window.onNativeSocialVideoResult && window.onNativeSocialVideoResult(" +
            JSONObject.quote(requestId) + "," + JSONObject.quote(result.toString()) + ");";
        webView.post(() -> webView.evaluateJavascript(script, null));
    }

    private void sendYouTubeError(String requestId, Exception error) {
        JSONObject result = new JSONObject();
        try {
            result.put("error", error.getMessage() != null ? error.getMessage() : "YouTube download failed.");
        } catch (JSONException e) {
            throw new IllegalStateException(e);
        }
        sendYouTubeResult(requestId, result);
    }

    private void sendYouTubeResult(String requestId, JSONObject result) {
        WebView webView = getBridge().getWebView();
        String script = "window.onNativeYouTubeResult && window.onNativeYouTubeResult(" +
            JSONObject.quote(requestId) + "," + JSONObject.quote(result.toString()) + ");";
        webView.post(() -> webView.evaluateJavascript(script, null));
    }

    private File downloadFacebookFile(String url, String quality, String filename) throws Exception {
        boolean audio = filename.toLowerCase(Locale.ROOT).endsWith(".mp3");
        if (audio) ensureFacebookAudioTools();

        File outputDir = new File(getCacheDir(), "facebook-downloads");
        if (!outputDir.exists() && !outputDir.mkdirs()) {
            throw new IllegalStateException("Could not create temporary download directory.");
        }
        File[] existing = outputDir.listFiles();
        if (existing != null) {
            for (File file : existing) {
                if (!file.delete()) {
                    throw new IllegalStateException("Could not clear a previous temporary download.");
                }
            }
        }

        File outputTemplate = new File(outputDir, "facebook.%(ext)s");
        YoutubeDLRequest request = createFacebookRequest(url)
            .addOption("-o", outputTemplate.getAbsolutePath());
        if (audio) {
            request.addOption("-x")
                .addOption("--audio-format", "mp3")
                .addOption("--audio-quality", "0");
        } else {
            String format = "sd".equals(quality)
                ? "best[ext=mp4][height<=480]/best[ext=mp4]/best"
                : "best[ext=mp4]/best";
            request.addOption("-f", format)
                .addOption("--merge-output-format", "mp4");
        }

        YoutubeDL.getInstance().execute(request);
        File[] downloads = outputDir.listFiles();
        if (downloads != null) {
            for (File file : downloads) {
                if (file.isFile() && file.length() > 0) return file;
            }
        }
        throw new IllegalStateException("yt-dlp did not create a Facebook download.");
    }

    private void saveFacebookFile(File source, String filename, String folderName) throws Exception {
        String safeFilename = filename.replaceAll("[<>:\"/\\\\|?*\\x00-\\x1f]", " ").trim();
        if (safeFilename.isEmpty() || safeFilename.equals(".") || safeFilename.equals("..")) {
            throw new IllegalArgumentException("Invalid Facebook download filename.");
        }
        String safeFolder = (folderName != null ? folderName : "")
            .replaceAll("[<>:\"/\\\\|?*\\x00-\\x1f]", " ").trim();
        if (safeFolder.isEmpty() || safeFolder.equals(".") || safeFolder.equals("..")) {
            safeFolder = "HutaoTik Downloads";
        }

        String mimeType = safeFilename.toLowerCase(Locale.ROOT).endsWith(".mp3") ? "audio/mpeg" : "video/mp4";
        String folderUri = getSharedPreferences("hutaotik", MODE_PRIVATE)
            .getString(FACEBOOK_FOLDER_PREF, null);

        if (folderUri != null) {
            DocumentFile directory = DocumentFile.fromTreeUri(this, Uri.parse(folderUri));
            if (directory == null || !directory.canWrite()) {
                throw new IllegalStateException("The selected download folder is no longer writable. Please select it again.");
            }
            DocumentFile oldFile = directory.findFile(safeFilename);
            if (oldFile != null && !oldFile.delete()) {
                throw new IllegalStateException("Could not replace the existing download.");
            }
            DocumentFile destination = directory.createFile(mimeType, safeFilename);
            if (destination == null) throw new IllegalStateException("Could not create the downloaded file.");
            try {
                try (OutputStream stream = getContentResolver().openOutputStream(destination.getUri())) {
                    if (stream == null) throw new IllegalStateException("Could not open the destination file.");
                    copyFacebookFile(source, stream);
                }
            } catch (Exception e) {
                destination.delete();
                throw e;
            }
            return;
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            ContentValues values = new ContentValues();
            values.put(MediaStore.MediaColumns.DISPLAY_NAME, safeFilename);
            values.put(MediaStore.MediaColumns.MIME_TYPE, mimeType);
            values.put(
                MediaStore.MediaColumns.RELATIVE_PATH,
                Environment.DIRECTORY_DOCUMENTS + "/" + safeFolder
            );
            values.put(MediaStore.MediaColumns.IS_PENDING, 1);
            Uri collection = MediaStore.Files.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY);
            Uri destination = getContentResolver().insert(collection, values);
            if (destination == null) throw new IllegalStateException("Could not create the downloaded file.");
            try {
                try (OutputStream stream = getContentResolver().openOutputStream(destination)) {
                    if (stream == null) throw new IllegalStateException("Could not open the destination file.");
                    copyFacebookFile(source, stream);
                }
                ContentValues completed = new ContentValues();
                completed.put(MediaStore.MediaColumns.IS_PENDING, 0);
                getContentResolver().update(destination, completed, null, null);
            } catch (Exception e) {
                getContentResolver().delete(destination, null, null);
                throw e;
            }
            return;
        }

        File documents = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOCUMENTS);
        File directory = new File(documents, safeFolder);
        if (!directory.exists() && !directory.mkdirs()) {
            throw new IllegalStateException("Could not create the Documents download folder.");
        }
        File destination = new File(directory, safeFilename);
        try (OutputStream stream = new java.io.FileOutputStream(destination)) {
            copyFacebookFile(source, stream);
        }
    }

    private void copyFacebookFile(File source, OutputStream destination) throws Exception {
        try (FileInputStream input = new FileInputStream(source)) {
            byte[] buffer = new byte[64 * 1024];
            int count;
            while ((count = input.read(buffer)) != -1) destination.write(buffer, 0, count);
        }
    }

    private void ensureFacebookUrl(String value) {
        Uri uri = Uri.parse(value);
        String host = uri.getHost();
        if (!"https".equalsIgnoreCase(uri.getScheme()) || host == null ||
            !(host.equalsIgnoreCase("fb.watch") || host.toLowerCase().endsWith(".facebook.com") ||
                host.equalsIgnoreCase("facebook.com"))) {
            throw new IllegalArgumentException("Enter a valid Facebook video or reel URL.");
        }
    }

    private void ensureFacebookDownloader() {
        if (facebookInitError != null) {
            throw new IllegalStateException("The on-device Facebook downloader could not start: " + facebookInitError);
        }
    }

    private void ensureFacebookAudioTools() {
        if (facebookFfmpegInitError != null) {
            throw new IllegalStateException("Facebook MP3 downloads are unavailable: " + facebookFfmpegInitError);
        }
    }

    private void sendFacebookError(String requestId, Exception error) {
        JSONObject result = new JSONObject();
        try {
            result.put("error", error.getMessage() != null ? error.getMessage() : "Facebook download failed.");
        } catch (JSONException e) {
            throw new IllegalStateException(e);
        }
        sendFacebookResult(requestId, result);
    }

    private void sendFacebookResult(String requestId, JSONObject result) {
        WebView webView = getBridge().getWebView();
        String script = "window.onNativeFacebookResult && window.onNativeFacebookResult(" +
            JSONObject.quote(requestId) + "," + JSONObject.quote(result.toString()) + ");";
        webView.post(() -> webView.evaluateJavascript(script, null));
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == REQUEST_CODE_PICK_FOLDER && resultCode == RESULT_OK && data != null) {
            Uri treeUri = data.getData();
            if (treeUri != null) {
                try {
                    getContentResolver().takePersistableUriPermission(
                        treeUri,
                        Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION
                    );
                } catch (Exception e) {
                    e.printStackTrace();
                }
                getSharedPreferences("hutaotik", MODE_PRIVATE).edit()
                    .putString(FACEBOOK_FOLDER_PREF, treeUri.toString())
                    .apply();
                DocumentFile pickedDir = DocumentFile.fromTreeUri(this, treeUri);
                final String folderName = (pickedDir != null && pickedDir.getName() != null) ? pickedDir.getName() : "HutaoTik Downloads";

                getBridge().getWebView().post(new Runnable() {
                    @Override
                    public void run() {
                        String escaped = folderName.replace("'", "\\'");
                        getBridge().getWebView().loadUrl("javascript:(function() { if (window.onAndroidFolderPicked) window.onAndroidFolderPicked('" + escaped + "'); })();");
                    }
                });
            }
        }
    }

    @Override
    public void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleSendIntent(intent);
    }

    private void handleSendIntent(Intent intent) {
        if (intent != null && Intent.ACTION_SEND.equals(intent.getAction())) {
            CharSequence sharedText = intent.getCharSequenceExtra(Intent.EXTRA_TEXT);
            if ((sharedText == null || sharedText.length() == 0) && intent.getClipData() != null &&
                intent.getClipData().getItemCount() > 0) {
                sharedText = intent.getClipData().getItemAt(0).coerceToText(this);
            }
            if (sharedText != null && sharedText.length() > 0) {
                pendingSharedText.set(sharedText.toString().trim());
                WebView webView = getBridge().getWebView();
                webView.post(() -> {
                    if (webView.getUrl() != null && !"about:blank".equals(webView.getUrl())) {
                        webView.evaluateJavascript("window.location.hash = '#/';", null);
                    }
                });
            }
        }
    }
}
