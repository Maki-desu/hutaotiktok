package com.hutaotik.app;

import android.Manifest;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Intent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.ContentValues;
import android.content.IntentFilter;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.app.DownloadManager;
import android.media.MediaScannerConnection;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.os.Bundle;
import android.provider.Settings;
import android.provider.MediaStore;
import android.widget.Toast;
import android.util.Log;
import android.webkit.JavascriptInterface;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebSettings;
import android.webkit.WebView;

import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import androidx.documentfile.provider.DocumentFile;
import androidx.core.content.FileProvider;
import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.WebViewListener;
import com.yausername.ffmpeg.FFmpeg;
import com.yausername.youtubedl_android.YoutubeDL;
import com.yausername.youtubedl_android.YoutubeDLException;
import com.yausername.youtubedl_android.YoutubeDLRequest;
import com.yausername.youtubedl_android.mapper.VideoInfo;
import kotlin.Unit;
import kotlin.jvm.functions.Function3;

import org.json.JSONException;
import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.TreeMap;
import java.util.UUID;
import java.util.concurrent.CompletionService;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorCompletionService;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicLong;
import java.util.concurrent.atomic.AtomicReference;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

public class MainActivity extends BridgeActivity {
    private static final String TAG = "HutaoTik";
    private static final int REQUEST_CODE_PICK_FOLDER = 9999;
    private static final int REQUEST_CODE_NOTIFICATIONS = 9998;
    private static final String FACEBOOK_FOLDER_PREF = "facebook_download_folder_uri";
    private static final AtomicReference<String> pendingSharedText = new AtomicReference<>();
    private static final AtomicReference<String> pendingNotificationRoute = new AtomicReference<>();
    private static final AtomicReference<String> PENDING_BACKGROUND_FETCH = new AtomicReference<>();
    private static volatile String pendingBackgroundFetchRequestId;
    private static final ExecutorService NATIVE_TOOLS_INIT_EXECUTOR = Executors.newSingleThreadExecutor();
    private static final AtomicBoolean NATIVE_TOOLS_INIT_STARTED = new AtomicBoolean(false);
    private static final CountDownLatch YTDLP_INIT_LATCH = new CountDownLatch(1);
    private static final CountDownLatch FFMPEG_INIT_LATCH = new CountDownLatch(1);
    private static final AtomicLong LAST_RENDER_RECOVERY_AT = new AtomicLong(0L);
    private static final AtomicInteger RENDER_RECOVERY_COUNT = new AtomicInteger(0);
    private static final long NATIVE_INFO_CACHE_TTL_MS = 5L * 60L * 1000L;
    private static final int NATIVE_INFO_CACHE_MAX = 60;
    private static final long YTDLP_UPDATE_INTERVAL_MS = 24L * 60L * 60L * 1000L;
    private static final ExecutorService YTDLP_UPDATE_EXECUTOR = Executors.newSingleThreadExecutor();
    private static final ConcurrentHashMap<String, CachedInfoEntry> NATIVE_INFO_CACHE = new ConcurrentHashMap<>();
    private static volatile String sharedYoutubeInitError;
    private static volatile String sharedFfmpegInitError;
    private static volatile MainActivity activeInstance;

    private static final class CachedInfoEntry {
        final long expiresAt;
        final String json;

        CachedInfoEntry(long expiresAt, String json) {
            this.expiresAt = expiresAt;
            this.json = json;
        }
    }

    private static JSONObject getCachedNativeInfo(String key) {
        if (key == null || key.isEmpty()) return null;
        CachedInfoEntry entry = NATIVE_INFO_CACHE.get(key);
        if (entry == null) return null;
        if (entry.expiresAt <= System.currentTimeMillis()) {
            NATIVE_INFO_CACHE.remove(key);
            return null;
        }
        try {
            return new JSONObject(entry.json);
        } catch (JSONException ignored) {
            NATIVE_INFO_CACHE.remove(key);
            return null;
        }
    }

    private static void putCachedNativeInfo(String key, JSONObject data) {
        if (key == null || key.isEmpty() || data == null) return;
        if (NATIVE_INFO_CACHE.size() >= NATIVE_INFO_CACHE_MAX) {
            NATIVE_INFO_CACHE.clear();
        }
        NATIVE_INFO_CACHE.put(
            key,
            new CachedInfoEntry(System.currentTimeMillis() + NATIVE_INFO_CACHE_TTL_MS, data.toString())
        );
    }

    private static void recordPendingBackgroundFetch(
        String requestId,
        String platform,
        String url,
        JSONObject data
    ) {
        if (platform == null || url == null || data == null) return;
        try {
            JSONObject wrapper = new JSONObject();
            wrapper.put("requestId", requestId != null ? requestId : "");
            wrapper.put("platform", platform);
            wrapper.put("url", url.trim());
            wrapper.put("data", data);
            wrapper.put("completedAt", System.currentTimeMillis());
            pendingBackgroundFetchRequestId = requestId;
            PENDING_BACKGROUND_FETCH.set(wrapper.toString());
        } catch (JSONException ignored) {
        }
    }
    private final Map<String, File> pendingBlobFiles = new ConcurrentHashMap<>();
    private final Map<String, File> compressedVideoFiles = new ConcurrentHashMap<>();
    private final ExecutorService facebookExecutor = Executors.newSingleThreadExecutor();
    private final ExecutorService youtubeExecutor = Executors.newSingleThreadExecutor();
    private final ExecutorService socialExecutor = Executors.newFixedThreadPool(2);
    private final ExecutorService storageExecutor = Executors.newSingleThreadExecutor();
    private final ExecutorService mediaExecutor = Executors.newSingleThreadExecutor();
    private final ExecutorService updateExecutor = Executors.newSingleThreadExecutor();
    private final Object ytDlpUpdateLock = new Object();
    private volatile BroadcastReceiver activeUpdateReceiver;
    private volatile AtomicBoolean activeUpdatePollCancelled;
    private volatile boolean youtubeUpdateChecked;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        activeInstance = this;
        try {
            HutaoNotificationHelper.ensureChannels(this);
        } catch (Throwable t) {
            Log.w(TAG, "Notification channel initialization failed safely.", t);
        }
        try {
            NotificationSyncJobService.schedule(this);
        } catch (Throwable t) {
            Log.w(TAG, "Background notification job scheduling failed safely.", t);
        }
        DownloadForegroundService.setProgressRelay((taskId, percent, loaded, total, eta, status) -> {
            MainActivity act = activeInstance;
            if (act != null) {
                act.emitWebViewDownloadProgress(taskId, percent, loaded, total, eta, status);
            }
        });

        Bridge capBridge = getBridge();
        WebView webView = capBridge != null ? capBridge.getWebView() : null;
        if (webView != null) {
            try {
                WebSettings settings = webView.getSettings();
                if (settings != null) {
                    settings.setTextZoom(100);
                }
            } catch (Throwable ignored) {
            }
            try {
                webView.addJavascriptInterface(new WebAppInterface(), "AndroidStorageBridge");
            } catch (Throwable t) {
                Log.e(TAG, "Failed to attach AndroidStorageBridge.", t);
            }
        }

        if (capBridge != null) {
            capBridge.addWebViewListener(new WebViewListener() {
                @Override
                public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
                    boolean didCrash = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && detail != null && detail.didCrash();
                    Log.e(TAG, "WebView render process gone (didCrash=" + didCrash + "); attempting safe recovery.");
                    long now = System.currentTimeMillis();
                    if (now - LAST_RENDER_RECOVERY_AT.get() > 15_000L) {
                        RENDER_RECOVERY_COUNT.set(0);
                    }
                    if (RENDER_RECOVERY_COUNT.incrementAndGet() <= 2) {
                        LAST_RENDER_RECOVERY_AT.set(now);
                        runOnUiThread(() -> {
                            if (!isFinishing() && !isDestroyed()) {
                                try {
                                    recreate();
                                } catch (Throwable recreateErr) {
                                    Log.e(TAG, "Could not recreate MainActivity after WebView crash.", recreateErr);
                                }
                            }
                        });
                        return true;
                    }
                    return false;
                }
            });
        }

        // Unpack yt-dlp / FFmpeg binaries off the UI thread so startup never ANRs or crashes on slower/incompatible devices
        startNativeToolsInitAsync(getApplicationContext());
        handleSendIntent(getIntent());
        handleNotificationRouteIntent(getIntent());
    }

    private static void startNativeToolsInitAsync(Context appContext) {
        if (!NATIVE_TOOLS_INIT_STARTED.compareAndSet(false, true)) return;
        NATIVE_TOOLS_INIT_EXECUTOR.execute(() -> {
            try {
                YoutubeDL.getInstance().init(appContext);
            } catch (Throwable t) {
                Log.e(TAG, "YoutubeDL init failed safely.", t);
                sharedYoutubeInitError = t.getMessage() != null ? t.getMessage() : t.getClass().getSimpleName();
            } finally {
                YTDLP_INIT_LATCH.countDown();
            }
            try {
                FFmpeg.getInstance().init(appContext);
            } catch (Throwable t) {
                Log.e(TAG, "FFmpeg init failed safely.", t);
                sharedFfmpegInitError = t.getMessage() != null ? t.getMessage() : t.getClass().getSimpleName();
            } finally {
                FFMPEG_INIT_LATCH.countDown();
            }
        });
    }

    private void awaitYoutubeDlInit() {
        startNativeToolsInitAsync(getApplicationContext());
        try {
            if (!YTDLP_INIT_LATCH.await(30, TimeUnit.SECONDS)) {
                throw new IllegalStateException("On-device downloader is still preparing. Please try again in a moment.");
            }
        } catch (InterruptedException ie) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException("Downloader setup was interrupted.");
        }
    }

    private void awaitFfmpegInit() {
        startNativeToolsInitAsync(getApplicationContext());
        try {
            if (!FFMPEG_INIT_LATCH.await(30, TimeUnit.SECONDS)) {
                throw new IllegalStateException("On-device FFmpeg is still preparing. Please try again in a moment.");
            }
        } catch (InterruptedException ie) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException("FFmpeg setup was interrupted.");
        }
    }

    private void evalJsSafely(String script) {
        MainActivity act = activeInstance != null ? activeInstance : this;
        if (act == null || act.isFinishing() || act.isDestroyed()) return;
        WebView webView = getSafeWebView();
        if (webView == null) return;
        webView.post(() -> {
            if (act.isFinishing() || act.isDestroyed()) return;
            try {
                webView.evaluateJavascript(script, null);
            } catch (Throwable ignored) {
            }
        });
    }

    @Override
    public void onDestroy() {
        if (activeInstance == this) {
            activeInstance = null;
        }
        unregisterActiveUpdateReceiver();
        for (File file : compressedVideoFiles.values()) {
            if (file != null) file.delete();
        }
        compressedVideoFiles.clear();
        super.onDestroy();
    }

    private void unregisterActiveUpdateReceiver() {
        AtomicBoolean cancelled = activeUpdatePollCancelled;
        if (cancelled != null) cancelled.set(true);
        BroadcastReceiver receiver = activeUpdateReceiver;
        activeUpdateReceiver = null;
        if (receiver != null) {
            try {
                unregisterReceiver(receiver);
            } catch (IllegalArgumentException ignored) {
                // Already unregistered
            }
        }
    }

    private void sendAppUpdateProgress(String status, int percent, long loadedBytes, long totalBytes, String message) {
        JSONObject payload = new JSONObject();
        try {
            payload.put("status", status);
            payload.put("percent", Math.max(0, Math.min(100, percent)));
            if (loadedBytes > 0) payload.put("loadedBytes", loadedBytes);
            if (totalBytes > 0) payload.put("totalBytes", totalBytes);
            if (message != null && !message.isEmpty()) payload.put("message", message);
        } catch (JSONException e) {
            return;
        }
        String script = "window.onAppUpdateProgress && window.onAppUpdateProgress(" +
            JSONObject.quote(payload.toString()) + ");";
        evalJsSafely(script);
    }

    public class WebAppInterface {
        @JavascriptInterface
        public String getDeviceInfo() {
            JSONObject info = new JSONObject();
            try {
                info.put("model", Build.MODEL != null ? Build.MODEL : "Android");
                info.put("androidVersion", Build.VERSION.RELEASE != null ? Build.VERSION.RELEASE : "");
            } catch (JSONException ignored) {
            }
            return info.toString();
        }

        @JavascriptInterface
        public String getInstalledAppInfo() {
            return InstalledApkInfo.toJson(MainActivity.this);
        }

        @JavascriptInterface
        public void cancelUpdateNotifications() {
            HutaoNotificationHelper.cancelUpdateNotifications(MainActivity.this);
        }

        @JavascriptInterface
        public boolean openExternalUrl(String rawUrl) {
            if (rawUrl == null || (!rawUrl.startsWith("https://") && !rawUrl.startsWith("http://"))) {
                return false;
            }
            try {
                Intent viewIntent = new Intent(Intent.ACTION_VIEW, Uri.parse(rawUrl.trim()));
                viewIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                runOnUiThread(() -> {
                    if (isFinishing() || isDestroyed()) return;
                    try {
                        startActivity(viewIntent);
                    } catch (Throwable err) {
                        Log.e(TAG, "Could not launch external URL activity: " + rawUrl, err);
                    }
                });
                return true;
            } catch (Throwable e) {
                Log.e(TAG, "Could not open external URL: " + rawUrl, e);
                return false;
            }
        }

        @JavascriptInterface
        public String installAppUpdate(String rawUrl, String expectedSha256) {
            if (rawUrl == null || !rawUrl.startsWith("https://") ||
                expectedSha256 == null ||
                (!expectedSha256.isEmpty() && !expectedSha256.matches("(?i)[0-9a-f]{64}"))) {
                sendAppUpdateProgress("failed", 0, 0, 0, "Invalid update download URL.");
                return "failed";
            }

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O &&
                !getPackageManager().canRequestPackageInstalls()) {
                runOnUiThread(() -> {
                    if (isFinishing() || isDestroyed()) return;
                    try {
                        Intent settingsIntent = new Intent(
                            Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                            Uri.parse("package:" + getPackageName())
                        );
                        startActivity(settingsIntent);
                    } catch (Throwable err) {
                        Log.e(TAG, "Could not open unknown app sources settings.", err);
                    }
                });
                sendAppUpdateProgress("permission_required", 0, 0, 0, "Allow installing unknown apps in Android settings.");
                return "permission_required";
            }

            Context appCtx = getApplicationContext();
            File downloadDirectory = appCtx.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS);
            if (downloadDirectory == null) {
                sendAppUpdateProgress("failed", 0, 0, 0, "Could not access device storage for the update APK.");
                return "failed";
            }
            if (!downloadDirectory.exists()) {
                downloadDirectory.mkdirs();
            }
            File apkFile = new File(downloadDirectory, "hutaotik-update.apk");
            if (apkFile.exists() && !apkFile.delete()) {
                sendAppUpdateProgress("failed", 0, 0, 0, "Could not clear previous update APK.");
                return "failed";
            }

            String taskId = "app-update-" + System.currentTimeMillis();
            sendAppUpdateProgress("downloading", 2, 0, 0, "Starting APK download…");

            DownloadForegroundService.runBackgroundTask(
                appCtx,
                taskId,
                "Downloading HutaoTik Update",
                "App Update",
                true,
                (task) -> {
                    HttpURLConnection conn = null;
                    try {
                        task.updateProgress(2, 0, 0, -1, "Connecting to update server…");
                        sendAppUpdateProgress("downloading", 2, 0, 0, "Connecting to update server…");

                        String currentUrl = rawUrl.trim();
                        int redirects = 0;
                        while (redirects < 6) {
                            task.checkCancelled();
                            URL parsed = new URL(currentUrl);
                            if (!"https".equalsIgnoreCase(parsed.getProtocol())) {
                                throw new IllegalStateException("Insecure update redirect blocked.");
                            }
                            conn = (HttpURLConnection) parsed.openConnection();
                            conn.setInstanceFollowRedirects(false);
                            conn.setConnectTimeout(30_000);
                            conn.setReadTimeout(90_000);
                            conn.setRequestProperty("User-Agent", "HutaoTik-Updater/Android");
                            conn.setRequestProperty("Accept", "application/vnd.android.package-archive,*/*");
                            int code = conn.getResponseCode();
                            if (code == HttpURLConnection.HTTP_MOVED_PERM ||
                                code == HttpURLConnection.HTTP_MOVED_TEMP ||
                                code == HttpURLConnection.HTTP_SEE_OTHER ||
                                code == 307 || code == 308) {
                                String nextLocation = conn.getHeaderField("Location");
                                conn.disconnect();
                                if (nextLocation == null || nextLocation.trim().isEmpty()) {
                                    throw new IllegalStateException("Update server returned an empty redirect.");
                                }
                                currentUrl = new URL(parsed, nextLocation).toString();
                                redirects += 1;
                                continue;
                            }
                            if (code < 200 || code >= 300) {
                                String serverError = readConnectionError(conn);
                                throw new IllegalStateException(
                                    serverError != null && !serverError.isEmpty()
                                        ? serverError
                                        : "Update download failed (HTTP " + code + ")."
                                );
                            }
                            break;
                        }
                        if (conn == null) {
                            throw new IllegalStateException("Could not connect to update server.");
                        }

                        long totalBytes = Build.VERSION.SDK_INT >= Build.VERSION_CODES.N
                            ? conn.getContentLengthLong()
                            : conn.getContentLength();
                        long loadedBytes = 0L;
                        long startedAt = System.currentTimeMillis();
                        long lastUiEmit = 0L;

                        try (InputStream in = conn.getInputStream();
                             FileOutputStream out = new FileOutputStream(apkFile)) {
                            byte[] buffer = new byte[32 * 1024];
                            int read;
                            while ((read = in.read(buffer)) != -1) {
                                task.checkCancelled();
                                out.write(buffer, 0, read);
                                loadedBytes += read;

                                int percent;
                                long etaSec = -1;
                                if (totalBytes > 0) {
                                    percent = 2 + (int) Math.min(92, Math.round((loadedBytes * 92.0) / totalBytes));
                                    long elapsedMs = Math.max(1L, System.currentTimeMillis() - startedAt);
                                    if (loadedBytes > 64 * 1024 && elapsedMs > 500) {
                                        double bps = (loadedBytes * 1000.0) / elapsedMs;
                                        if (bps > 100) {
                                            etaSec = Math.max(1L, Math.round((totalBytes - loadedBytes) / bps));
                                        }
                                    }
                                } else {
                                    double pseudo = 1.0 - Math.exp(-loadedBytes / (15.0 * 1024.0 * 1024.0));
                                    percent = 2 + (int) Math.min(90, Math.round(pseudo * 90.0));
                                }

                                task.updateProgress(percent, loadedBytes, totalBytes > 0 ? totalBytes : 0, etaSec, "Downloading update APK…");
                                long now = System.currentTimeMillis();
                                if (now - lastUiEmit >= 200) {
                                    lastUiEmit = now;
                                    sendAppUpdateProgress("downloading", percent, loadedBytes, totalBytes > 0 ? totalBytes : 0, "Downloading update APK…");
                                }
                            }
                        }

                        task.checkCancelled();
                        if (!apkFile.exists() || apkFile.length() < 4) {
                            throw new IllegalStateException("Downloaded update APK was empty.");
                        }

                        // Verify APK ZIP magic bytes (PK\x03\x04)
                        byte[] header = new byte[4];
                        try (FileInputStream checkIn = new FileInputStream(apkFile)) {
                            int n = checkIn.read(header);
                            if (n < 4 || header[0] != 0x50 || header[1] != 0x4b || header[2] != 0x03 || header[3] != 0x04) {
                                apkFile.delete();
                                throw new IllegalStateException("The update link did not return a valid Android APK file.");
                            }
                        }

                        if (!expectedSha256.isEmpty()) {
                            task.updateProgress(96, apkFile.length(), apkFile.length(), -1, "Verifying APK checksum…");
                            sendAppUpdateProgress("verifying", 96, apkFile.length(), apkFile.length(), "Verifying APK checksum…");
                            if (!expectedSha256.equalsIgnoreCase(calculateSha256(apkFile))) {
                                apkFile.delete();
                                throw new IllegalStateException("The downloaded APK failed its SHA-256 integrity check.");
                            }
                        }

                        Uri apkUri = FileProvider.getUriForFile(
                            appCtx,
                            appCtx.getPackageName() + ".fileprovider",
                            apkFile
                        );

                        task.markCancelledSilently(); // Remove ongoing progress bar cleanly
                        HutaoNotificationHelper.showUpdateReadyToInstallNotification(appCtx, apkUri);
                        sendAppUpdateProgress("installing", 100, apkFile.length(), apkFile.length(), "Opening Android package installer…");

                        Intent installIntent = new Intent(Intent.ACTION_VIEW);
                        installIntent.setDataAndType(apkUri, "application/vnd.android.package-archive");
                        installIntent.addFlags(
                            Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK
                        );
                        MainActivity act = activeInstance;
                        if (act != null && !act.isFinishing() && !act.isDestroyed()) {
                            act.runOnUiThread(() -> {
                                if (act.isFinishing() || act.isDestroyed()) return;
                                try {
                                    act.startActivity(installIntent);
                                } catch (Throwable launchErr) {
                                    sendAppUpdateProgress("failed", 0, 0, 0, "Could not launch installer: " + launchErr.getMessage());
                                }
                            });
                        } else {
                            try {
                                appCtx.startActivity(installIntent);
                            } catch (Throwable ignored) {
                                // User can tap the "HutaoTik Update Ready" notification to install
                            }
                        }
                    } catch (java.util.concurrent.CancellationException cancelled) {
                        if (apkFile.exists()) apkFile.delete();
                        task.markCancelledSilently();
                        sendAppUpdateProgress("failed", 0, 0, 0, "Update download was cancelled.");
                    } catch (Throwable e) {
                        if (apkFile.exists()) apkFile.delete();
                        String msg = e.getMessage() != null ? e.getMessage() : "Update APK download failed.";
                        task.markFailed(msg);
                        sendAppUpdateProgress("failed", 0, 0, 0, msg);
                        showUpdateToast(msg);
                    } finally {
                        if (conn != null) conn.disconnect();
                    }
                },
                null
            );

            return "started";
        }

        private String readConnectionError(HttpURLConnection conn) {
            try (InputStream err = conn.getErrorStream()) {
                if (err == null) return null;
                StringBuilder sb = new StringBuilder();
                try (BufferedReader br = new BufferedReader(new InputStreamReader(err))) {
                    String line;
                    while ((line = br.readLine()) != null && sb.length() < 1024) {
                        sb.append(line);
                    }
                }
                String raw = sb.toString().trim();
                if (raw.startsWith("{")) {
                    JSONObject obj = new JSONObject(raw);
                    String msg = obj.optString("error", "");
                    if (!msg.isEmpty()) return msg;
                }
            } catch (Exception ignored) {
            }
            return null;
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
            runOnUiThread(() -> {
                if (isFinishing() || isDestroyed()) return;
                try {
                    Toast.makeText(getApplicationContext(), message, Toast.LENGTH_LONG).show();
                } catch (Throwable ignored) {
                }
            });
        }

        @JavascriptInterface
        public String getPendingBackgroundFetch() {
            String raw = PENDING_BACKGROUND_FETCH.getAndSet(null);
            pendingBackgroundFetchRequestId = null;
            if (raw == null || raw.isEmpty()) return "";
            try {
                JSONObject obj = new JSONObject(raw);
                long completedAt = obj.optLong("completedAt", 0L);
                if (completedAt > 0L && System.currentTimeMillis() - completedAt > 15L * 60L * 1000L) {
                    return "";
                }
                return raw;
            } catch (JSONException ignored) {
                return "";
            }
        }

        @JavascriptInterface
        public void clearPendingBackgroundFetch(String requestId) {
            if (requestId != null && requestId.equals(pendingBackgroundFetchRequestId)) {
                PENDING_BACKGROUND_FETCH.set(null);
                pendingBackgroundFetchRequestId = null;
            }
        }

        @JavascriptInterface
        public void getTikTokInfo(String url, String requestId) {
            Context appCtx = getApplicationContext();
            String safeUrl = url != null ? url.trim() : "";
            String cacheKey = "tt:" + safeUrl;
            JSONObject cached = getCachedNativeInfo(cacheKey);
            if (cached != null) {
                sendTikTokResult(requestId, cached);
                return;
            }
            DownloadForegroundService.runBackgroundFetchTask(
                appCtx,
                requestId,
                "Fetching TikTok video…",
                "TikTok",
                true,
                (task) -> {
                    try {
                        task.updateProgress(15, 0, 0, -1, "Connecting to TikTok…");
                        task.checkCancelled();
                        JSONObject data = fetchTikTokInfoNative(appCtx, safeUrl, task);
                        task.checkCancelled();
                        task.updateProgress(95, 0, 0, -1, "Preparing TikTok video…");
                        putCachedNativeInfo(cacheKey, data);
                        recordPendingBackgroundFetch(requestId, "tiktok", safeUrl, data);
                        String videoTitle = data.optString("title", "TikTok Video");
                        task.updateProgress(100, 0, 0, -1, "Ready to download");
                        task.markFetchCompleted("TikTok", videoTitle);
                        sendTikTokResult(requestId, data);
                    } catch (java.util.concurrent.CancellationException cancelled) {
                        task.markCancelledSilently();
                        sendTikTokError(requestId, new Exception("Fetch cancelled."));
                    } catch (Throwable e) {
                        task.markFetchFailed("TikTok", e.getMessage());
                        sendTikTokError(requestId, e);
                    }
                },
                null
            );
        }

        @JavascriptInterface
        public void getTwitterInfo(String url, String requestId) {
            Context appCtx = getApplicationContext();
            String safeUrl = url != null ? url.trim() : "";
            String cacheKey = "tw:" + safeUrl;
            JSONObject cached = getCachedNativeInfo(cacheKey);
            if (cached != null) {
                sendTwitterResult(requestId, cached);
                return;
            }
            DownloadForegroundService.runBackgroundFetchTask(
                appCtx,
                requestId,
                "Fetching X video…",
                "X",
                true,
                (task) -> {
                    try {
                        task.updateProgress(15, 0, 0, -1, "Connecting to X…");
                        task.checkCancelled();
                        JSONObject data = fetchTwitterInfoNative(appCtx, safeUrl, task);
                        task.checkCancelled();
                        task.updateProgress(95, 0, 0, -1, "Preparing X qualities…");
                        putCachedNativeInfo(cacheKey, data);
                        recordPendingBackgroundFetch(requestId, "twitter", safeUrl, data);
                        String videoTitle = data.optString("title", "X Video");
                        task.updateProgress(100, 0, 0, -1, "Ready to download");
                        task.markFetchCompleted("X", videoTitle);
                        sendTwitterResult(requestId, data);
                    } catch (java.util.concurrent.CancellationException cancelled) {
                        task.markCancelledSilently();
                        sendTwitterError(requestId, new Exception("Fetch cancelled."));
                    } catch (Throwable e) {
                        task.markFetchFailed("X", e.getMessage());
                        sendTwitterError(requestId, e);
                    }
                },
                null
            );
        }

        @JavascriptInterface
        public void getFacebookInfo(String url, String requestId) {
            Context appCtx = getApplicationContext();
            String safeUrl = url != null ? url.trim() : "";
            String cacheKey = "fb:" + safeUrl;
            JSONObject cached = getCachedNativeInfo(cacheKey);
            if (cached != null) {
                sendFacebookResult(requestId, cached);
                return;
            }
            DownloadForegroundService.runBackgroundFetchTask(
                appCtx,
                requestId,
                "Fetching Facebook video…",
                "Facebook",
                true,
                (task) -> {
                    try {
                        ensureFacebookUrl(safeUrl);
                        task.updateProgress(15, 0, 0, -1, "Connecting to Facebook…");
                        task.checkCancelled();
                        ensureFacebookDownloader();
                        task.updateProgress(45, 0, 0, -1, "Reading Facebook video info…");
                        task.checkCancelled();
                        VideoInfo info = YoutubeDL.getInstance().getInfo(createFacebookRequest(safeUrl));
                        task.checkCancelled();
                        task.updateProgress(92, 0, 0, -1, "Preparing download options…");
                        JSONObject data = new JSONObject();
                        String title = info.getTitle() != null && !info.getTitle().trim().isEmpty()
                            ? info.getTitle().trim()
                            : "Facebook Video";
                        data.put("title", title);
                        data.put("thumbnail", info.getThumbnail());
                        data.put("hdUrl", JSONObject.NULL);
                        data.put("sdUrl", JSONObject.NULL);
                        data.put("nativeDownload", true);
                        putCachedNativeInfo(cacheKey, data);
                        recordPendingBackgroundFetch(requestId, "facebook", safeUrl, data);
                        task.updateProgress(100, 0, 0, -1, "Ready to download");
                        task.markFetchCompleted("Facebook", title);
                        sendFacebookResult(requestId, data);
                    } catch (java.util.concurrent.CancellationException cancelled) {
                        task.markCancelledSilently();
                        sendFacebookError(requestId, new Exception("Fetch cancelled."));
                    } catch (Throwable e) {
                        task.markFetchFailed("Facebook", e.getMessage());
                        sendFacebookError(requestId, e);
                    }
                },
                null
            );
        }

        @JavascriptInterface
        public void downloadFacebook(String url, String quality, String filename, String folderName, String requestId) {
            Context appCtx = getApplicationContext();
            String displayTitle = "Facebook · " + (filename != null && !filename.trim().isEmpty() ? filename.trim() : "Video");
            DownloadForegroundService.runBackgroundTask(
                appCtx,
                requestId,
                displayTitle,
                folderName,
                true,
                (task) -> {
                    try {
                        task.updateProgress(2, 0, 0, -1, "Starting Facebook download…");
                        ensureFacebookUrl(url);
                        ensureFacebookDownloader();
                        task.checkCancelled();
                        File output = downloadFacebookFile(url, quality, filename, requestId);
                        task.checkCancelled();
                        task.updateProgress(95, 0, 0, -1, "Saving to device folder…");
                        String safeName = filename != null ? filename.trim() : "facebook_video.mp4";
                        String mime = safeName.toLowerCase(Locale.ROOT).endsWith(".mp3") ? "audio/mpeg" : "video/mp4";
                        Uri savedUri = MediaFolderSaver.saveFileToUserFolder(appCtx, output, safeName, folderName, mime);
                        task.updateProgress(100, output.length(), output.length(), -1, "Saved to device folder");
                        task.markCompleted(safeName, savedUri, mime);
                        sendFacebookResult(requestId, new JSONObject());
                    } catch (java.util.concurrent.CancellationException cancelled) {
                        task.markCancelledSilently();
                        sendFacebookError(requestId, new Exception("Download cancelled."));
                    } catch (Throwable e) {
                        task.markFailed(e.getMessage());
                        sendFacebookError(requestId, e);
                    }
                },
                null
            );
        }

        @JavascriptInterface
        public void getYouTubeInfo(String url, String requestId) {
            Context appCtx = getApplicationContext();
            String safeUrl = url != null ? url.trim() : "";
            String cacheKey = "yt:" + safeUrl;
            JSONObject cached = getCachedNativeInfo(cacheKey);
            if (cached != null) {
                sendYouTubeResult(requestId, cached);
                return;
            }
            DownloadForegroundService.runBackgroundFetchTask(
                appCtx,
                requestId,
                "Fetching YouTube video…",
                "YouTube",
                true,
                (task) -> {
                    try {
                        ensureYouTubeUrl(safeUrl);
                        task.updateProgress(15, 0, 0, -1, "Connecting to YouTube…");
                        task.checkCancelled();
                        ensureYouTubeDownloader();
                        task.updateProgress(45, 0, 0, -1, "Reading YouTube video formats…");
                        task.checkCancelled();
                        VideoInfo info = YoutubeDL.getInstance().getInfo(createYouTubeRequest(safeUrl));
                        task.checkCancelled();
                        task.updateProgress(90, 0, 0, -1, "Preparing download qualities…");
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

                        String title = info.getTitle() != null && !info.getTitle().trim().isEmpty()
                            ? info.getTitle().trim()
                            : "YouTube Video";
                        JSONObject data = new JSONObject();
                        data.put("id", info.getId() != null ? info.getId() : "");
                        data.put("title", title);
                        data.put("thumbnail", info.getThumbnail() != null ? info.getThumbnail() : JSONObject.NULL);
                        data.put("channelName", info.getUploader() != null ? info.getUploader() : "Unknown");
                        data.put("duration", info.getDuration());
                        data.put("formats", formats);
                        putCachedNativeInfo(cacheKey, data);
                        recordPendingBackgroundFetch(requestId, "youtube", safeUrl, data);
                        task.updateProgress(100, 0, 0, -1, "Ready to download");
                        task.markFetchCompleted("YouTube", title);
                        sendYouTubeResult(requestId, data);
                    } catch (java.util.concurrent.CancellationException cancelled) {
                        task.markCancelledSilently();
                        sendYouTubeError(requestId, new Exception("Fetch cancelled."));
                    } catch (Throwable e) {
                        task.markFetchFailed("YouTube", e.getMessage());
                        sendYouTubeError(requestId, e);
                    }
                },
                null
            );
        }

        @JavascriptInterface
        public void downloadYouTube(String url, String formatStr, String filename, String folderName, String requestId) {
            Context appCtx = getApplicationContext();
            String displayTitle = "YouTube · " + (filename != null && !filename.trim().isEmpty() ? filename.trim() : "Video");
            DownloadForegroundService.runBackgroundTask(
                appCtx,
                requestId,
                displayTitle,
                folderName,
                true,
                (task) -> {
                    File outputDir = null;
                    try {
                        task.updateProgress(2, 0, 0, -1, "Starting YouTube download…");
                        ensureYouTubeUrl(url);
                        ensureYouTubeDownloader();
                        task.checkCancelled();
                        outputDir = downloadYouTubeFile(url, formatStr, requestId);
                        task.checkCancelled();
                        File output = findYouTubeOutput(outputDir, "audio".equals(formatStr));
                        task.updateProgress(95, 0, 0, -1, "Saving to device folder…");
                        String safeName = filename != null ? filename.trim() : "youtube_video.mp4";
                        boolean isAudio = safeName.toLowerCase(Locale.ROOT).endsWith(".m4a");
                        String mime = isAudio ? "audio/mp4" : "video/mp4";
                        Uri savedUri = MediaFolderSaver.saveFileToUserFolder(appCtx, output, safeName, folderName, mime);
                        task.updateProgress(100, output.length(), output.length(), -1, "Saved to device folder");
                        task.markCompleted(safeName, savedUri, mime);
                        sendYouTubeResult(requestId, new JSONObject());
                    } catch (java.util.concurrent.CancellationException cancelled) {
                        task.markCancelledSilently();
                        sendYouTubeError(requestId, new Exception("Download cancelled."));
                    } catch (Throwable e) {
                        task.markFailed(e.getMessage());
                        sendYouTubeError(requestId, e);
                    } finally {
                        if (outputDir != null) deleteYouTubeTempDirectory(outputDir);
                    }
                },
                null
            );
        }

        @JavascriptInterface
        public void getSocialVideoInfo(String platform, String url, String requestId) {
            Context appCtx = getApplicationContext();
            String normalizedPlatform;
            try {
                normalizedPlatform = normalizeSocialPlatform(platform);
            } catch (Throwable e) {
                sendSocialVideoError(requestId, e);
                return;
            }
            String providerName = "instagram".equals(normalizedPlatform) ? "Instagram" : "Pinterest";
            String safeUrl = url != null ? url.trim() : "";
            String cacheKey = normalizedPlatform + ":" + safeUrl;
            JSONObject cached = getCachedNativeInfo(cacheKey);
            if (cached != null) {
                sendSocialVideoResult(requestId, cached);
                return;
            }
            DownloadForegroundService.runBackgroundFetchTask(
                appCtx,
                requestId,
                "Fetching " + providerName + " media…",
                providerName,
                true,
                (task) -> {
                    try {
                        task.updateProgress(15, 0, 0, -1, "Resolving " + providerName + " link…");
                        task.checkCancelled();
                        JSONObject data = fetchSocialVideoInfoNative(normalizedPlatform, safeUrl);
                        task.checkCancelled();
                        task.updateProgress(95, 0, 0, -1, "Preparing " + providerName + " media…");
                        putCachedNativeInfo(cacheKey, data);
                        recordPendingBackgroundFetch(requestId, normalizedPlatform, safeUrl, data);
                        String mediaTitle = data.optString("title", providerName + " Media");
                        task.updateProgress(100, 0, 0, -1, "Ready to download");
                        task.markFetchCompleted(providerName, mediaTitle);
                        sendSocialVideoResult(requestId, data);
                    } catch (java.util.concurrent.CancellationException cancelled) {
                        task.markCancelledSilently();
                        sendSocialVideoError(requestId, new Exception("Fetch cancelled."));
                    } catch (Throwable e) {
                        task.markFetchFailed(providerName, e.getMessage());
                        sendSocialVideoError(requestId, e);
                    }
                },
                null
            );
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
            Context appCtx = getApplicationContext();
            String label = "instagram".equalsIgnoreCase(platform) ? "Instagram" : "Pinterest";
            String displayTitle = label + " · " + (filename != null && !filename.trim().isEmpty() ? filename.trim() : "Media");
            DownloadForegroundService.runBackgroundTask(
                appCtx,
                requestId,
                displayTitle,
                folderName,
                true,
                (task) -> {
                    File outputDir = null;
                    try {
                        String normalizedPlatform = normalizeSocialPlatform(platform);
                        outputDir = new File(new File(appCtx.getCacheDir(), "social-downloads"), UUID.randomUUID().toString());
                        if (!outputDir.mkdirs()) {
                            throw new IllegalStateException("Could not create temporary download directory.");
                        }
                        task.updateProgress(2, 0, 0, -1, "Starting " + label + " download…");
                        task.checkCancelled();
                        SocialDownloadResult result = downloadSocialMediaToTemp(
                            normalizedPlatform,
                            url,
                            directUrl,
                            mediaType,
                            outputDir,
                            requestId
                        );
                        task.checkCancelled();
                        String finalFilename = ensureFilenameExtension(filename, result.extension);
                        task.updateProgress(95, 0, 0, -1, "Saving to device folder…");
                        Uri savedUri = MediaFolderSaver.saveFileToUserFolder(appCtx, result.file, finalFilename, folderName, result.mimeType);
                        task.updateProgress(100, result.file.length(), result.file.length(), -1, "Saved to device folder");
                        task.markCompleted(finalFilename, savedUri, result.mimeType);
                        JSONObject response = new JSONObject();
                        response.put("filename", finalFilename);
                        response.put("mediaType", result.mediaType);
                        sendSocialVideoResult(requestId, response);
                    } catch (java.util.concurrent.CancellationException cancelled) {
                        task.markCancelledSilently();
                        sendSocialVideoError(requestId, new Exception("Download cancelled."));
                    } catch (Throwable e) {
                        task.markFailed(e.getMessage());
                        sendSocialVideoError(requestId, e);
                    } finally {
                        if (outputDir != null) deleteYouTubeTempDirectory(outputDir);
                    }
                },
                null
            );
        }

        @JavascriptInterface
        public String beginTempSave(String extension) {
            try {
                File dir = new File(getCacheDir(), "blob-saves");
                if (!dir.exists() && !dir.mkdirs()) return "";
                String safeExt = (extension != null ? extension : "bin")
                    .replaceAll("[^a-zA-Z0-9]", "");
                if (safeExt.isEmpty()) safeExt = "bin";
                String saveId = UUID.randomUUID().toString();
                File tempFile = new File(dir, saveId + "." + safeExt);
                if (tempFile.exists() && !tempFile.delete()) return "";
                pendingBlobFiles.put(saveId, tempFile);
                return saveId;
            } catch (Exception e) {
                return "";
            }
        }

        @JavascriptInterface
        public boolean appendTempSaveChunk(String saveId, String base64Chunk) {
            if (saveId == null || base64Chunk == null) return false;
            File tempFile = pendingBlobFiles.get(saveId);
            if (tempFile == null) return false;
            try {
                byte[] decoded = android.util.Base64.decode(base64Chunk, android.util.Base64.DEFAULT);
                try (FileOutputStream out = new FileOutputStream(tempFile, true)) {
                    out.write(decoded);
                }
                return true;
            } catch (Exception e) {
                pendingBlobFiles.remove(saveId);
                tempFile.delete();
                return false;
            }
        }

        @JavascriptInterface
        public void abortTempSave(String saveId) {
            if (saveId == null) return;
            File tempFile = pendingBlobFiles.remove(saveId);
            if (tempFile != null) tempFile.delete();
        }

        @JavascriptInterface
        public void finishTempSave(
            String saveId,
            String filename,
            String folderName,
            String mimeType,
            String requestId
        ) {
            storageExecutor.execute(() -> {
                File tempFile = saveId != null ? pendingBlobFiles.remove(saveId) : null;
                try {
                    if (tempFile == null || !tempFile.exists() || tempFile.length() <= 0) {
                        throw new IllegalStateException("Temporary download file was empty or missing.");
                    }
                    String resolvedMime = (mimeType != null && !mimeType.trim().isEmpty())
                        ? mimeType.trim()
                        : inferMimeTypeFromFilename(filename);
                    saveFileToUserFolder(tempFile, filename, folderName, resolvedMime);
                    sendStorageSaveResult(requestId, new JSONObject());
                } catch (Throwable e) {
                    sendStorageSaveError(requestId, e);
                } finally {
                    if (tempFile != null) tempFile.delete();
                }
            });
        }

        @JavascriptInterface
        public void convertTempVideoToGif(
            String saveId,
            String filename,
            String folderName,
            int maxSeconds,
            String requestId
        ) {
            Context appCtx = getApplicationContext();
            String displayTitle = "X GIF · " + (filename != null && !filename.trim().isEmpty() ? filename.trim() : "Animated GIF");
            DownloadForegroundService.runBackgroundTask(
                appCtx,
                requestId,
                displayTitle,
                folderName,
                true,
                (task) -> {
                    File inputFile = saveId != null ? pendingBlobFiles.remove(saveId) : null;
                    File outputDir = null;
                    try {
                        if (inputFile == null || !inputFile.exists() || inputFile.length() <= 0) {
                            throw new IllegalStateException("Source video for GIF conversion was missing.");
                        }
                        ensureBundledFfmpeg();
                        outputDir = new File(new File(appCtx.getCacheDir(), "gif-exports"), UUID.randomUUID().toString());
                        if (!outputDir.mkdirs()) {
                            throw new IllegalStateException("Could not create temporary GIF directory.");
                        }
                        File outputGif = new File(outputDir, "output.gif");
                        int clampedMaxSec = Math.max(1, Math.min(30, maxSeconds > 0 ? maxSeconds : 15));

                        task.updateProgress(5, 0, 0, -1, "Converting to animated GIF…");
                        List<String> args = new ArrayList<>();
                        args.add("-y");
                        args.add("-i");
                        args.add(inputFile.getAbsolutePath());
                        args.add("-t");
                        args.add(String.valueOf(clampedMaxSec));
                        args.add("-vf");
                        args.add(
                            "fps=15,scale='min(480,iw)':-2:flags=lanczos," +
                            "split[s0][s1];" +
                            "[s0]palettegen=max_colors=256:stats_mode=diff[p];" +
                            "[s1][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle"
                        );
                        args.add("-loop");
                        args.add("0");
                        args.add(outputGif.getAbsolutePath());

                        runBundledFfmpeg(args, clampedMaxSec, requestId, 5, 92, "Converting to animated GIF…");
                        task.checkCancelled();
                        if (!outputGif.exists() || outputGif.length() <= 0) {
                            throw new IllegalStateException("FFmpeg produced an empty GIF file.");
                        }

                        String finalFilename = ensureFilenameExtension(filename, "gif");
                        task.updateProgress(95, outputGif.length(), outputGif.length(), -1, "Saving GIF to device…");
                        Uri savedUri = MediaFolderSaver.saveFileToUserFolder(appCtx, outputGif, finalFilename, folderName, "image/gif");
                        task.updateProgress(100, outputGif.length(), outputGif.length(), -1, "Saved GIF to device");
                        task.markCompleted(finalFilename, savedUri, "image/gif");

                        JSONObject response = new JSONObject();
                        response.put("filename", finalFilename);
                        sendMediaResult(requestId, response);
                    } catch (java.util.concurrent.CancellationException cancelled) {
                        task.markCancelledSilently();
                        sendMediaError(requestId, new Exception("GIF conversion cancelled."));
                    } catch (Throwable e) {
                        task.markFailed(e.getMessage());
                        sendMediaError(requestId, e);
                    } finally {
                        if (inputFile != null) inputFile.delete();
                        if (outputDir != null) deleteYouTubeTempDirectory(outputDir);
                    }
                },
                null
            );
        }

        @JavascriptInterface
        public void compressTempVideo(
            String saveId,
            int crf,
            int maxHeight,
            String requestId
        ) {
            Context appCtx = getApplicationContext();
            DownloadForegroundService.runBackgroundTask(
                appCtx,
                requestId,
                "TaoCompress · Compressing MP4",
                "TaoCompress",
                false,
                (task) -> {
                    File inputFile = saveId != null ? pendingBlobFiles.remove(saveId) : null;
                    File outputFile = null;
                    try {
                        if (inputFile == null || !inputFile.exists() || inputFile.length() <= 0) {
                            throw new IllegalStateException("Source video file was missing.");
                        }
                        ensureBundledFfmpeg();
                        File cacheDir = new File(appCtx.getCacheDir(), "taocompress");
                        if (!cacheDir.exists() && !cacheDir.mkdirs()) {
                            throw new IllegalStateException("Could not create compression cache folder.");
                        }
                        String compressedId = UUID.randomUUID().toString();
                        outputFile = new File(cacheDir, "Taocompress_" + compressedId + ".mp4");

                        int clampedCrf = Math.max(18, Math.min(35, crf > 0 ? crf : 24));
                        String scaleFilter = (maxHeight > 0)
                            ? "scale='if(gt(ih," + maxHeight + "),-2,trunc(iw/2)*2)':'if(gt(ih," + maxHeight + ")," + maxHeight + ",trunc(ih/2)*2)'"
                            : "scale=trunc(iw/2)*2:trunc(ih/2)*2";

                        task.updateProgress(4, 0, 0, -1, "Compressing to compatible H.264 MP4…");

                        List<String> args = buildMessengerCompatibleMp4Args(
                            inputFile.getAbsolutePath(),
                            outputFile.getAbsolutePath(),
                            clampedCrf,
                            scaleFilter,
                            true
                        );
                        try {
                            runBundledFfmpeg(args, 0, requestId, 4, 96, "Compressing to compatible H.264 MP4…");
                        } catch (Exception firstError) {
                            if (outputFile.exists()) outputFile.delete();
                            Log.w(TAG, "FFmpeg compression with audio failed; retrying video-only", firstError);
                            List<String> videoOnlyArgs = buildMessengerCompatibleMp4Args(
                                inputFile.getAbsolutePath(),
                                outputFile.getAbsolutePath(),
                                clampedCrf,
                                scaleFilter,
                                false
                            );
                            runBundledFfmpeg(videoOnlyArgs, 0, requestId, 4, 96, "Compressing video track to H.264 MP4…");
                        }

                        if (!outputFile.exists() || outputFile.length() <= 0) {
                            throw new IllegalStateException("FFmpeg produced an empty MP4 file.");
                        }

                        compressedVideoFiles.put(compressedId, outputFile);
                        task.updateProgress(100, outputFile.length(), outputFile.length(), -1, "Compression complete");
                        task.markCompleted("Compressed MP4 (" + HutaoNotificationHelper.formatBytes(outputFile.length()) + ")", null, "video/mp4");

                        JSONObject response = new JSONObject();
                        response.put("compressedId", compressedId);
                        response.put("size", outputFile.length());
                        response.put("filePath", outputFile.getAbsolutePath());
                        response.put("mimeType", "video/mp4");
                        sendMediaResult(requestId, response);
                    } catch (Throwable e) {
                        if (outputFile != null) outputFile.delete();
                        task.markFailed(e.getMessage());
                        sendMediaError(requestId, e);
                    } finally {
                        if (inputFile != null) inputFile.delete();
                    }
                },
                null
            );
        }

        @JavascriptInterface
        public void saveCompressedVideo(
            String compressedId,
            String filename,
            String folderName,
            String requestId
        ) {
            storageExecutor.execute(() -> {
                try {
                    File file = compressedId != null ? compressedVideoFiles.get(compressedId) : null;
                    if (file == null || !file.exists() || file.length() <= 0) {
                        throw new IllegalStateException("Compressed video is no longer available. Please compress again.");
                    }
                    String finalFilename = ensureFilenameExtension(filename, "mp4");
                    saveFileToUserFolder(file, finalFilename, folderName, "video/mp4");
                    JSONObject response = new JSONObject();
                    response.put("filename", finalFilename);
                    sendMediaResult(requestId, response);
                } catch (Throwable e) {
                    sendMediaError(requestId, e);
                }
            });
        }

        @JavascriptInterface
        public boolean shareCompressedVideo(String compressedId, String filename) {
            try {
                File file = compressedId != null ? compressedVideoFiles.get(compressedId) : null;
                if (file == null || !file.exists() || file.length() <= 0) return false;
                Uri contentUri = FileProvider.getUriForFile(
                    MainActivity.this,
                    getPackageName() + ".fileprovider",
                    file
                );
                Intent shareIntent = new Intent(Intent.ACTION_SEND);
                shareIntent.setType("video/mp4");
                shareIntent.putExtra(Intent.EXTRA_STREAM, contentUri);
                if (filename != null && !filename.trim().isEmpty()) {
                    shareIntent.putExtra(Intent.EXTRA_TITLE, filename.trim());
                }
                shareIntent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                Intent chooser = Intent.createChooser(shareIntent, "Share compressed video");
                chooser.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                runOnUiThread(() -> {
                    if (isFinishing() || isDestroyed()) return;
                    try {
                        startActivity(chooser);
                    } catch (Throwable err) {
                        Log.e(TAG, "Could not launch video share chooser", err);
                    }
                });
                return true;
            } catch (Throwable e) {
                Log.e(TAG, "Could not share compressed video", e);
                return false;
            }
        }

        @JavascriptInterface
        public void discardCompressedVideo(String compressedId) {
            if (compressedId == null) return;
            File file = compressedVideoFiles.remove(compressedId);
            if (file != null) file.delete();
        }

        @JavascriptInterface
        public void openDeviceFolderPicker() {
            runOnUiThread(() -> {
                if (isFinishing() || isDestroyed()) return;
                try {
                    Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
                    intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION |
                                    Intent.FLAG_GRANT_WRITE_URI_PERMISSION |
                                    Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
                    startActivityForResult(intent, REQUEST_CODE_PICK_FOLDER);
                } catch (Throwable e) {
                    Log.e(TAG, "Could not launch folder picker", e);
                }
            });
        }

        @JavascriptInterface
        public String getPendingSharedText() {
            String text = pendingSharedText.getAndSet(null);
            return text != null ? text : "";
        }

        @JavascriptInterface
        public String readClipboardText() {
            try {
                ClipboardManager clipboard = (ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
                if (clipboard == null || !clipboard.hasPrimaryClip()) return "";
                ClipData clip = clipboard.getPrimaryClip();
                if (clip == null || clip.getItemCount() == 0) return "";
                CharSequence coerced = clip.getItemAt(0).coerceToText(MainActivity.this);
                return coerced != null ? coerced.toString().trim() : "";
            } catch (Exception ignored) {
                return "";
            }
        }

        @JavascriptInterface
        public String getCacheStorageInfo() {
            long compressedBytes = 0;
            long tempDownloadBytes = 0;
            long updateApkBytes = 0;
            int[] fileCount = { 0 };

            File cacheDir = getCacheDir();
            compressedBytes += measureDirBytes(new File(cacheDir, "taocompress"), fileCount);

            String[] tempDirs = {
                "blob-saves",
                "gif-exports",
                "youtube-downloads",
                "facebook-downloads",
                "social-downloads"
            };
            for (String dirName : tempDirs) {
                tempDownloadBytes += measureDirBytes(new File(cacheDir, dirName), fileCount);
            }

            File downloadDir = getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS);
            if (downloadDir != null) {
                File updateApk = new File(downloadDir, "hutaotik-update.apk");
                if (updateApk.isFile()) {
                    updateApkBytes += updateApk.length();
                    fileCount[0] += 1;
                }
            }

            long total = compressedBytes + tempDownloadBytes + updateApkBytes;
            JSONObject payload = new JSONObject();
            try {
                payload.put("totalBytes", total);
                payload.put("fileCount", fileCount[0]);
                JSONObject breakdown = new JSONObject();
                breakdown.put("compressedVideos", compressedBytes);
                breakdown.put("tempDownloads", tempDownloadBytes);
                breakdown.put("updateApks", updateApkBytes);
                payload.put("breakdown", breakdown);
            } catch (JSONException ignored) {
            }
            return payload.toString();
        }

        @JavascriptInterface
        public String clearAppCache() {
            long beforeBytes = 0;
            int[] counter = { 0 };
            File cacheDir = getCacheDir();
            String[] dirs = {
                "taocompress",
                "blob-saves",
                "gif-exports",
                "youtube-downloads",
                "facebook-downloads",
                "social-downloads"
            };
            for (String dirName : dirs) {
                File dir = new File(cacheDir, dirName);
                beforeBytes += measureDirBytes(dir, counter);
                deleteYouTubeTempDirectory(dir);
            }

            pendingBlobFiles.clear();
            compressedVideoFiles.clear();

            File downloadDir = getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS);
            if (downloadDir != null) {
                File updateApk = new File(downloadDir, "hutaotik-update.apk");
                if (updateApk.isFile()) {
                    beforeBytes += updateApk.length();
                    updateApk.delete();
                }
            }

            WebView webView = getBridge() != null ? getBridge().getWebView() : null;
            if (webView != null) {
                webView.post(() -> webView.clearCache(true));
            }

            JSONObject payload = new JSONObject();
            try {
                payload.put("freedBytes", beforeBytes);
            } catch (JSONException ignored) {
            }
            return payload.toString();
        }

        @JavascriptInterface
        public String getNotificationStatus() {
            return HutaoNotificationHelper.getStatusJson(MainActivity.this);
        }

        @JavascriptInterface
        public void configureNotifications(
            boolean downloads,
            boolean updates,
            boolean announcements,
            String apiBaseUrl
        ) {
            HutaoNotificationHelper.savePreferences(
                MainActivity.this,
                downloads,
                updates,
                announcements,
                apiBaseUrl
            );
            NotificationSyncJobService.schedule(MainActivity.this);
            NotificationSyncJobService.checkNowAsync(MainActivity.this, false);
        }

        @JavascriptInterface
        public String requestNotificationPermission() {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                if (ContextCompat.checkSelfPermission(MainActivity.this, Manifest.permission.POST_NOTIFICATIONS)
                    == PackageManager.PERMISSION_GRANTED) {
                    return "granted";
                }
                runOnUiThread(() -> {
                    if (isFinishing() || isDestroyed()) return;
                    try {
                        ActivityCompat.requestPermissions(
                            MainActivity.this,
                            new String[] { Manifest.permission.POST_NOTIFICATIONS },
                            REQUEST_CODE_NOTIFICATIONS
                        );
                    } catch (Throwable err) {
                        Log.w(TAG, "Could not request notification permission.", err);
                    }
                });
                return "prompted";
            }
            return HutaoNotificationHelper.hasNotificationPermission(MainActivity.this) ? "granted" : "denied";
        }

        @JavascriptInterface
        public void openNotificationSettings() {
            runOnUiThread(() -> {
                if (isFinishing() || isDestroyed()) return;
                try {
                    Intent intent = new Intent();
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                        intent.setAction(Settings.ACTION_APP_NOTIFICATION_SETTINGS);
                        intent.putExtra(Settings.EXTRA_APP_PACKAGE, getPackageName());
                    } else {
                        intent.setAction(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
                        intent.setData(Uri.parse("package:" + getPackageName()));
                    }
                    intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    startActivity(intent);
                } catch (Throwable e) {
                    Log.e(TAG, "Could not open Android notification settings", e);
                }
            });
        }

        @JavascriptInterface
        public boolean sendTestNotification() {
            return HutaoNotificationHelper.showTestNotification(MainActivity.this);
        }

        @JavascriptInterface
        public void checkNotificationsNow() {
            NotificationSyncJobService.checkNowAsync(MainActivity.this, true);
        }

        @JavascriptInterface
        public void notifyUpdateAvailable(int versionCode, String versionName, String title, String changelog) {
            HutaoNotificationHelper.showUpdateAvailableNotification(
                MainActivity.this,
                versionCode,
                versionName,
                title,
                changelog
            );
        }

        @JavascriptInterface
        public void notifyAnnouncement(int announcementId, String colorType, String content) {
            HutaoNotificationHelper.showAnnouncementNotification(
                MainActivity.this,
                announcementId,
                colorType,
                content
            );
        }

        @JavascriptInterface
        public void notifyCustomPush(
            int pushId,
            String title,
            String body,
            String accentType,
            String targetRoute
        ) {
            HutaoNotificationHelper.showCustomPushNotification(
                MainActivity.this,
                pushId,
                title,
                body,
                accentType,
                targetRoute
            );
        }

        @JavascriptInterface
        public String getPendingNotificationRoute() {
            String route = pendingNotificationRoute.getAndSet(null);
            return route != null ? route : "";
        }

        @JavascriptInterface
        public void downloadUrlInBackground(
            String url,
            String filename,
            String folderName,
            String title,
            String mimeType,
            String requestId
        ) {
            Context appCtx = getApplicationContext();
            String displayTitle = (title != null && !title.trim().isEmpty())
                ? title.trim()
                : (filename != null ? filename : "Downloading video");
            DownloadForegroundService.runBackgroundTask(
                appCtx,
                requestId,
                displayTitle,
                folderName,
                true,
                (task) -> {
                    try {
                        DownloadForegroundService.SavedDownloadResult saved =
                            DownloadForegroundService.downloadDirectUrlToFolder(
                                appCtx,
                                task,
                                url,
                                filename,
                                folderName,
                                mimeType
                            );
                        task.markCompleted(saved.filename, saved.savedUri, saved.mimeType);
                        JSONObject response = new JSONObject();
                        response.put("filename", saved.filename);
                        sendDirectDownloadResult(requestId, response);
                    } catch (java.util.concurrent.CancellationException cancelled) {
                        task.markCancelledSilently();
                        sendDirectDownloadError(requestId, new Exception("Download cancelled."));
                    } catch (Throwable e) {
                        task.markFailed(e.getMessage());
                        sendDirectDownloadError(requestId, e);
                    }
                },
                null
            );
        }

        @JavascriptInterface
        public void startLiveDownloadNotification(String taskId, String title, String folderName) {
            if (taskId == null || taskId.isEmpty()) return;
            DownloadForegroundService.registerExternalTask(MainActivity.this, taskId, title, folderName);
        }

        @JavascriptInterface
        public void updateLiveDownloadNotification(
            String taskId,
            int percent,
            long loadedBytes,
            long totalBytes,
            String status
        ) {
            DownloadForegroundService.TaskContext task = DownloadForegroundService.getActiveTask(taskId);
            if (task != null) {
                task.updateProgress(percent, loadedBytes, totalBytes, -1, status);
            }
        }

        @JavascriptInterface
        public void finishLiveDownloadNotification(
            String taskId,
            boolean success,
            String filename,
            String folderName,
            String errorMessage
        ) {
            DownloadForegroundService.TaskContext task = DownloadForegroundService.getActiveTask(taskId);
            if (task == null) return;
            if (success) {
                task.markCompleted(filename, null, MediaFolderSaver.inferMimeType(filename));
            } else {
                task.markFailed(errorMessage);
            }
        }
    }

    private long measureDirBytes(File dir, int[] fileCount) {
        if (dir == null || !dir.exists()) return 0L;
        if (dir.isFile()) {
            fileCount[0] += 1;
            return dir.length();
        }
        long sum = 0L;
        File[] children = dir.listFiles();
        if (children != null) {
            for (File child : children) {
                sum += measureDirBytes(child, fileCount);
            }
        }
        return sum;
    }

    private YoutubeDLRequest createFacebookRequest(String url) {
        return new YoutubeDLRequest(url)
            .addOption("--no-playlist")
            .addOption("--no-warnings")
            .addOption("--no-check-certificates")
            .addOption("--socket-timeout", "12")
            .addOption("--add-header", "Referer:https://www.facebook.com/");
    }

    private YoutubeDLRequest createYouTubeRequest(String url) {
        return new YoutubeDLRequest(url)
            .addOption("--no-playlist")
            .addOption("--no-warnings")
            .addOption("--no-check-certificates")
            .addOption("--extractor-args", "youtube:skip=translated_subs")
            .addOption("--socket-timeout", "12");
    }

    private File downloadYouTubeFile(String url, String formatStr, String requestId) throws Exception {
        boolean audio = "audio".equals(formatStr);
        if (!audio && (formatStr == null || !formatStr.matches("\\d+(?:\\+\\d+)?"))) {
            throw new IllegalArgumentException("Select a valid YouTube video quality.");
        }
        boolean multiStream = !audio && formatStr.contains("+");

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
            YoutubeDL.getInstance().execute(
                request,
                requestId,
                createYtDlpProgressCallback(
                    requestId,
                    multiStream,
                    audio ? "Downloading YouTube audio…" : "Downloading YouTube video…"
                )
            );
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
        String safeFilename = filename != null ? filename.trim() : "";
        boolean audio = safeFilename.toLowerCase(Locale.ROOT).endsWith(".m4a");
        saveFileToUserFolder(source, filename, folderName, audio ? "audio/mp4" : "video/mp4");
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
        awaitYoutubeDlInit();
        if (sharedYoutubeInitError != null) {
            throw new IllegalStateException("The on-device downloader could not start: " + sharedYoutubeInitError);
        }
        // Keep yt-dlp fresh in the background (at most once every 24h) without ever blocking the user's fetch
        scheduleBackgroundYtDlpUpdateIfDue(getApplicationContext());
    }

    private void scheduleBackgroundYtDlpUpdateIfDue(Context appContext) {
        synchronized (ytDlpUpdateLock) {
            if (youtubeUpdateChecked) return;
            youtubeUpdateChecked = true;
        }
        YTDLP_UPDATE_EXECUTOR.execute(() -> {
            try {
                android.content.SharedPreferences prefs =
                    appContext.getSharedPreferences("hutaotik_ytdlp", MODE_PRIVATE);
                long now = System.currentTimeMillis();
                long lastChecked = prefs.getLong("last_update_check_ms", 0L);
                if (now - lastChecked < YTDLP_UPDATE_INTERVAL_MS) return;
                prefs.edit().putLong("last_update_check_ms", now).apply();
                YoutubeDL.UpdateStatus status = YoutubeDL.getInstance().updateYoutubeDL(
                    appContext,
                    YoutubeDL.UpdateChannel._NIGHTLY
                );
                Log.i(TAG, "Background yt-dlp update check completed: " + status);
            } catch (Throwable e) {
                Log.w(TAG, "Background yt-dlp update skipped safely.", e);
            }
        });
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
            .addOption("--socket-timeout", "12");
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
        Throwable ytDlpError = null;
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
        } catch (Throwable e) {
            ytDlpError = e;
            Log.w(TAG, "On-device yt-dlp info failed for " + platform + ": " + e.getMessage());
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
        File outputDir,
        String requestId
    ) throws Exception {
        String providerName = "instagram".equals(platform) ? "Instagram" : "Pinterest";
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
            SocialMediaExtractor.downloadUrlToFile(
                platform,
                imageUrl,
                tempImage,
                true,
                (percent, loaded, total) ->
                    sendDownloadProgress(requestId, percent, loaded, total, -1, "Downloading " + providerName + " image…")
            );
            return new SocialDownloadResult(tempImage, extMime[1], extMime[0], "image");
        }

        boolean directIsHls = directUrl != null && directUrl.toLowerCase(Locale.ROOT).contains(".m3u8");
        boolean directIsAllowed = SocialMediaExtractor.isAllowedMediaUrl(platform, directUrl);

        // Fast path: direct MP4 download (non-HLS) from validated platform CDN
        if (directIsAllowed && !directIsHls) {
            File directFile = new File(outputDir, "social_direct.mp4");
            try {
                SocialMediaExtractor.downloadUrlToFile(
                    platform,
                    directUrl,
                    directFile,
                    false,
                    (percent, loaded, total) ->
                        sendDownloadProgress(requestId, percent, loaded, total, -1, "Downloading " + providerName + " video…")
                );
                return new SocialDownloadResult(directFile, "video/mp4", "mp4", "video");
            } catch (Exception e) {
                directFile.delete();
                Log.w(TAG, "Direct media download failed for " + platform + ", falling back to yt-dlp", e);
            }
        }

        // Primary muxing/HLS/DASH path: on-device yt-dlp + bundled FFmpeg
        Throwable ytDlpError = null;
        try {
            ensureYouTubeDownloader();
            File downloaded = downloadSocialWithYtDlp(platform, canonicalUrl, outputDir, requestId);
            return new SocialDownloadResult(downloaded, "video/mp4", "mp4", "video");
        } catch (Throwable e) {
            ytDlpError = e;
            Log.w(TAG, "On-device yt-dlp download failed on canonical URL for " + platform, e);
        }

        if (directIsAllowed && directIsHls && sharedYoutubeInitError == null) {
            try {
                File downloaded = downloadSocialWithYtDlp(platform, directUrl, outputDir, requestId);
                return new SocialDownloadResult(downloaded, "video/mp4", "mp4", "video");
            } catch (Throwable e) {
                ytDlpError = e;
                Log.w(TAG, "On-device yt-dlp HLS download failed for " + platform, e);
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
                SocialMediaExtractor.downloadUrlToFile(
                    platform,
                    fresh.directUrl,
                    freshFile,
                    false,
                    (percent, loaded, total) ->
                        sendDownloadProgress(requestId, percent, loaded, total, -1, "Downloading " + providerName + " video…")
                );
                return new SocialDownloadResult(freshFile, "video/mp4", "mp4", "video");
            }
            if (fresh.hlsUrl != null && sharedYoutubeInitError == null &&
                SocialMediaExtractor.isAllowedMediaUrl(platform, fresh.hlsUrl)) {
                File freshHls = downloadSocialWithYtDlp(platform, fresh.hlsUrl, outputDir, requestId);
                return new SocialDownloadResult(freshHls, "video/mp4", "mp4", "video");
            }
        }

        if (ytDlpError instanceof Exception) throw (Exception) ytDlpError;
        if (ytDlpError != null) throw new IllegalStateException(ytDlpError.getMessage() != null ? ytDlpError.getMessage() : "Could not download this " + platform + " video on device.");
        throw new IllegalStateException("Could not download this " + platform + " video on device.");
    }

    private File downloadSocialWithYtDlp(
        String platform,
        String targetUrl,
        File outputDir,
        String requestId
    ) throws Exception {
        String providerName = "instagram".equals(platform) ? "Instagram" : "Pinterest";
        File runDir = new File(outputDir, "ytdlp_" + UUID.randomUUID().toString());
        if (!runDir.mkdirs()) {
            throw new IllegalStateException("Could not prepare yt-dlp download directory.");
        }
        File outputTemplate = new File(runDir, "social.%(ext)s");
        try {
            awaitFfmpegInit();
        } catch (Throwable ignored) {
        }
        boolean hasFfmpeg = sharedFfmpegInitError == null;

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
            YoutubeDL.getInstance().execute(
                request,
                requestId,
                createYtDlpProgressCallback(requestId, false, "Downloading " + providerName + " video…")
            );
        } catch (Exception firstError) {
            if (!hasFfmpeg) throw firstError;
            // Retry with progressive MP4 fallback if remuxing/merging hits a codec snag
            clearDirectoryFiles(runDir);
            YoutubeDLRequest fallbackRequest = createSocialVideoRequest(platform, targetUrl)
                .addOption("-f", "best[ext=mp4]/best")
                .addOption("-o", outputTemplate.getAbsolutePath());
            YoutubeDL.getInstance().execute(
                fallbackRequest,
                requestId,
                createYtDlpProgressCallback(requestId, false, "Downloading " + providerName + " video…")
            );
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
        MediaFolderSaver.saveFileToUserFolder(getApplicationContext(), source, filename, folderName, mimeType);
    }

    private void ensureBundledFfmpeg() {
        awaitFfmpegInit();
        if (sharedFfmpegInitError != null) {
            throw new IllegalStateException("On-device FFmpeg failed to initialize: " + sharedFfmpegInitError);
        }
        File ffmpegBin = new File(getApplicationInfo().nativeLibraryDir, "libffmpeg.so");
        if (!ffmpegBin.exists()) {
            throw new IllegalStateException("Bundled FFmpeg binary was not found on this device.");
        }
    }

    private List<String> buildMessengerCompatibleMp4Args(
        String inputPath,
        String outputPath,
        int crf,
        String scaleFilter,
        boolean includeAudio
    ) {
        List<String> args = new ArrayList<>();
        args.add("-y");
        args.add("-i");
        args.add(inputPath);
        args.add("-map");
        args.add("0:v:0");
        if (includeAudio) {
            args.add("-map");
            args.add("0:a:0?");
        } else {
            args.add("-an");
        }
        args.add("-c:v");
        args.add("libx264");
        args.add("-profile:v");
        args.add("main");
        args.add("-level");
        args.add("4.0");
        args.add("-preset");
        args.add("veryfast");
        args.add("-crf");
        args.add(String.valueOf(crf));
        args.add("-pix_fmt");
        args.add("yuv420p");
        args.add("-vf");
        args.add(scaleFilter);
        if (includeAudio) {
            args.add("-c:a");
            args.add("aac");
            args.add("-b:a");
            args.add("96k");
            args.add("-ac");
            args.add("2");
            args.add("-ar");
            args.add("44100");
        }
        args.add("-movflags");
        args.add("+faststart");
        args.add("-max_muxing_queue_size");
        args.add("1024");
        args.add(outputPath);
        return args;
    }

    private void runBundledFfmpeg(
        List<String> args,
        double maxDurationSeconds,
        String requestId,
        int startPercent,
        int endPercent,
        String statusLabel
    ) throws Exception {
        File ffmpegBin = new File(getApplicationInfo().nativeLibraryDir, "libffmpeg.so");
        File packagesRoot = new File(new File(getNoBackupFilesDir(), "youtubedl-android"), "packages");
        String ldLibraryPath =
            new File(packagesRoot, "python/usr/lib").getAbsolutePath() + ":" +
            new File(packagesRoot, "ffmpeg/usr/lib").getAbsolutePath() + ":" +
            new File(packagesRoot, "aria2c/usr/lib").getAbsolutePath();

        List<String> command = new ArrayList<>(args.size() + 1);
        command.add(ffmpegBin.getAbsolutePath());
        command.addAll(args);

        ProcessBuilder pb = new ProcessBuilder(command);
        Map<String, String> env = pb.environment();
        env.put("LD_LIBRARY_PATH", ldLibraryPath);
        env.put("TMPDIR", getCacheDir().getAbsolutePath());
        pb.redirectErrorStream(true);

        Process process = pb.start();
        Pattern durationPattern = Pattern.compile("Duration:\\s*(\\d+):(\\d+):(\\d+(?:\\.\\d+)?)");
        Pattern timePattern = Pattern.compile("time=(\\d+):(\\d+):(\\d+(?:\\.\\d+)?)");
        double totalSeconds = maxDurationSeconds > 0 ? maxDurationSeconds : 0.0;
        int lastPercent = startPercent;
        StringBuilder tailLog = new StringBuilder();

        try (BufferedReader reader = new BufferedReader(new InputStreamReader(process.getInputStream()))) {
            String line;
            while ((line = reader.readLine()) != null) {
                if (tailLog.length() > 1500) {
                    tailLog.delete(0, tailLog.length() - 800);
                }
                tailLog.append(line).append('\n');

                if (totalSeconds <= 0.0) {
                    Matcher dm = durationPattern.matcher(line);
                    if (dm.find()) {
                        double parsed = parseFfmpegTimestamp(dm.group(1), dm.group(2), dm.group(3));
                        if (parsed > 0.0) {
                            totalSeconds = maxDurationSeconds > 0
                                ? Math.min(parsed, maxDurationSeconds)
                                : parsed;
                        }
                    }
                }
                if (totalSeconds > 0.0) {
                    Matcher tm = timePattern.matcher(line);
                    if (tm.find()) {
                        double current = parseFfmpegTimestamp(tm.group(1), tm.group(2), tm.group(3));
                        double ratio = Math.max(0.0, Math.min(1.0, current / totalSeconds));
                        int mapped = startPercent + (int) Math.round(ratio * (endPercent - startPercent));
                        if (mapped > lastPercent) {
                            lastPercent = mapped;
                            sendDownloadProgress(requestId, mapped, 0, 0, -1, statusLabel);
                        }
                    }
                }
            }
        }

        int exitCode = process.waitFor();
        if (exitCode != 0) {
            Log.e(TAG, "Bundled FFmpeg failed (exit " + exitCode + "):\n" + tailLog);
            throw new IllegalStateException("FFmpeg processing failed (exit code " + exitCode + ").");
        }
    }

    private double parseFfmpegTimestamp(String hours, String minutes, String seconds) {
        try {
            return Double.parseDouble(hours) * 3600.0
                + Double.parseDouble(minutes) * 60.0
                + Double.parseDouble(seconds);
        } catch (Exception ignored) {
            return 0.0;
        }
    }

    private void sendMediaError(String requestId, Throwable error) {
        JSONObject result = new JSONObject();
        try {
            result.put("error", error != null && error.getMessage() != null ? error.getMessage() : "Media processing failed.");
        } catch (JSONException e) {
            return;
        }
        sendMediaResult(requestId, result);
    }

    private void sendMediaResult(String requestId, JSONObject result) {
        String script = "window.onNativeMediaResult && window.onNativeMediaResult(" +
            JSONObject.quote(requestId) + "," + JSONObject.quote(result.toString()) + ");";
        evalJsSafely(script);
    }

    private String inferMimeTypeFromFilename(String filename) {
        String lower = filename != null ? filename.toLowerCase(Locale.ROOT) : "";
        if (lower.endsWith(".mp4")) return "video/mp4";
        if (lower.endsWith(".webm")) return "video/webm";
        if (lower.endsWith(".mp3")) return "audio/mpeg";
        if (lower.endsWith(".m4a")) return "audio/mp4";
        if (lower.endsWith(".zip")) return "application/zip";
        if (lower.endsWith(".png")) return "image/png";
        if (lower.endsWith(".webp")) return "image/webp";
        if (lower.endsWith(".gif")) return "image/gif";
        if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
        return "application/octet-stream";
    }

    private Function3<Float, Long, String, Unit> createYtDlpProgressCallback(
        String requestId,
        boolean multiStream,
        String defaultStatus
    ) {
        final long[] lastEmitAt = { 0L };
        final int[] lastPercent = { -1 };
        final String[] lastStatus = { "" };
        final float[] prevRawProgress = { -1f };
        final int[] streamIndex = { 0 };

        return (progress, etaInSeconds, line) -> {
            String safeLine = line != null ? line : "";
            float raw = progress != null ? progress : -1f;
            long eta = etaInSeconds != null ? etaInSeconds : -1L;

            if (safeLine.contains("[Merger]") || safeLine.contains("[VideoRemuxer]")) {
                if (!"Merging video & audio…".equals(lastStatus[0])) {
                    lastStatus[0] = "Merging video & audio…";
                    lastPercent[0] = 90;
                    sendDownloadProgress(requestId, 90, 0, 0, -1, "Merging video & audio…");
                }
                return Unit.INSTANCE;
            }
            if (safeLine.contains("[ExtractAudio]")) {
                if (!"Converting audio…".equals(lastStatus[0])) {
                    lastStatus[0] = "Converting audio…";
                    lastPercent[0] = 90;
                    sendDownloadProgress(requestId, 90, 0, 0, -1, "Converting audio…");
                }
                return Unit.INSTANCE;
            }

            if (raw >= 0f) {
                if (multiStream && streamIndex[0] == 0 && prevRawProgress[0] >= 80f && raw < 15f) {
                    streamIndex[0] = 1;
                }
                prevRawProgress[0] = raw;

                int mappedPercent;
                String status;
                if (multiStream) {
                    if (streamIndex[0] == 0) {
                        mappedPercent = 4 + Math.round((Math.min(100f, raw) / 100f) * 62f);
                        status = "Downloading video stream…";
                    } else {
                        mappedPercent = 66 + Math.round((Math.min(100f, raw) / 100f) * 20f);
                        status = "Downloading audio stream…";
                    }
                } else {
                    mappedPercent = 4 + Math.round((Math.min(100f, raw) / 100f) * 86f);
                    status = defaultStatus;
                }

                long now = System.currentTimeMillis();
                if (mappedPercent != lastPercent[0] || !status.equals(lastStatus[0]) || now - lastEmitAt[0] >= 150) {
                    if (mappedPercent >= lastPercent[0] || !status.equals(lastStatus[0])) {
                        lastPercent[0] = Math.max(lastPercent[0], mappedPercent);
                        lastStatus[0] = status;
                        lastEmitAt[0] = now;
                        sendDownloadProgress(requestId, lastPercent[0], 0, 0, eta, status);
                    }
                }
            }
            return Unit.INSTANCE;
        };
    }

    private void sendDownloadProgress(
        String requestId,
        int percent,
        long loadedBytes,
        long totalBytes,
        long etaSeconds,
        String status
    ) {
        if (requestId == null || requestId.isEmpty()) return;
        DownloadForegroundService.TaskContext activeTask = DownloadForegroundService.getActiveTask(requestId);
        if (activeTask != null) {
            activeTask.updateProgress(percent, loadedBytes, totalBytes, etaSeconds, status);
        } else {
            emitWebViewDownloadProgress(requestId, percent, loadedBytes, totalBytes, etaSeconds, status);
        }
    }

    private void emitWebViewDownloadProgress(
        String requestId,
        int percent,
        long loadedBytes,
        long totalBytes,
        long etaSeconds,
        String status
    ) {
        if (requestId == null || requestId.isEmpty()) return;
        JSONObject payload = new JSONObject();
        try {
            payload.put("percent", Math.max(0, Math.min(100, percent)));
            if (loadedBytes > 0) payload.put("loadedBytes", loadedBytes);
            if (totalBytes > 0) payload.put("totalBytes", totalBytes);
            if (etaSeconds > 0) payload.put("etaSeconds", etaSeconds);
            if (status != null && !status.isEmpty()) payload.put("status", status);
        } catch (JSONException e) {
            return;
        }
        String script = "window.onNativeDownloadProgress && window.onNativeDownloadProgress(" +
            JSONObject.quote(requestId) + "," + JSONObject.quote(payload.toString()) + ");";
        evalJsSafely(script);
    }

    private WebView getSafeWebView() {
        MainActivity act = activeInstance != null ? activeInstance : this;
        try {
            return act != null && act.getBridge() != null ? act.getBridge().getWebView() : null;
        } catch (Throwable ignored) {
            return null;
        }
    }

    private void sendDirectDownloadError(String requestId, Throwable error) {
        JSONObject result = new JSONObject();
        try {
            result.put("error", error != null && error.getMessage() != null ? error.getMessage() : "Download failed.");
        } catch (JSONException e) {
            return;
        }
        sendDirectDownloadResult(requestId, result);
    }

    private void sendDirectDownloadResult(String requestId, JSONObject result) {
        String script = "window.onNativeDirectDownloadResult && window.onNativeDirectDownloadResult(" +
            JSONObject.quote(requestId) + "," + JSONObject.quote(result.toString()) + ");";
        evalJsSafely(script);
    }

    private void sendStorageSaveError(String requestId, Throwable error) {
        JSONObject result = new JSONObject();
        try {
            result.put("error", error != null && error.getMessage() != null ? error.getMessage() : "Could not save downloaded file.");
        } catch (JSONException e) {
            return;
        }
        sendStorageSaveResult(requestId, result);
    }

    private void sendStorageSaveResult(String requestId, JSONObject result) {
        String script = "window.onNativeStorageSaveResult && window.onNativeStorageSaveResult(" +
            JSONObject.quote(requestId) + "," + JSONObject.quote(result.toString()) + ");";
        evalJsSafely(script);
    }

    private void sendSocialVideoError(String requestId, Throwable error) {
        JSONObject result = new JSONObject();
        try {
            result.put("error", error != null && error.getMessage() != null ? error.getMessage() : "Download failed.");
        } catch (JSONException e) {
            return;
        }
        sendSocialVideoResult(requestId, result);
    }

    private void sendSocialVideoResult(String requestId, JSONObject result) {
        String script = "window.onNativeSocialVideoResult && window.onNativeSocialVideoResult(" +
            JSONObject.quote(requestId) + "," + JSONObject.quote(result.toString()) + ");";
        evalJsSafely(script);
    }

    private void sendYouTubeError(String requestId, Throwable error) {
        JSONObject result = new JSONObject();
        try {
            result.put("error", error != null && error.getMessage() != null ? error.getMessage() : "YouTube download failed.");
        } catch (JSONException e) {
            return;
        }
        sendYouTubeResult(requestId, result);
    }

    private void sendYouTubeResult(String requestId, JSONObject result) {
        String script = "window.onNativeYouTubeResult && window.onNativeYouTubeResult(" +
            JSONObject.quote(requestId) + "," + JSONObject.quote(result.toString()) + ");";
        evalJsSafely(script);
    }

    private void sendTikTokError(String requestId, Throwable error) {
        JSONObject result = new JSONObject();
        try {
            result.put("error", error != null && error.getMessage() != null ? error.getMessage() : "Could not fetch TikTok video.");
        } catch (JSONException e) {
            return;
        }
        sendTikTokResult(requestId, result);
    }

    private void sendTikTokResult(String requestId, JSONObject result) {
        String script = "window.onNativeTikTokResult && window.onNativeTikTokResult(" +
            JSONObject.quote(requestId) + "," + JSONObject.quote(result.toString()) + ");";
        evalJsSafely(script);
    }

    private void sendTwitterError(String requestId, Throwable error) {
        JSONObject result = new JSONObject();
        try {
            result.put("error", error != null && error.getMessage() != null ? error.getMessage() : "Could not fetch X video or GIF.");
        } catch (JSONException e) {
            return;
        }
        sendTwitterResult(requestId, result);
    }

    private void sendTwitterResult(String requestId, JSONObject result) {
        String script = "window.onNativeTwitterResult && window.onNativeTwitterResult(" +
            JSONObject.quote(requestId) + "," + JSONObject.quote(result.toString()) + ");";
        evalJsSafely(script);
    }

    private JSONObject fetchTikTokInfoNative(
        Context appContext,
        String targetUrl,
        DownloadForegroundService.TaskContext task
    ) throws Exception {
        if (targetUrl == null || targetUrl.isEmpty()) {
            throw new IllegalArgumentException("Enter a valid TikTok URL.");
        }
        Uri parsedUri = Uri.parse(targetUrl);
        String scheme = parsedUri.getScheme();
        String host = parsedUri.getHost() != null ? parsedUri.getHost().toLowerCase(Locale.ROOT) : "";
        if ((!"https".equalsIgnoreCase(scheme) && !"http".equalsIgnoreCase(scheme)) ||
            (!host.equals("tiktok.com") && !host.endsWith(".tiktok.com"))) {
            throw new IllegalArgumentException("Invalid TikTok URL. Please paste a valid TikTok link.");
        }

        String apiBase = HutaoNotificationHelper.getApiBaseUrl(appContext);
        task.updateProgress(30, 0, 0, -1, "Fetching TikTok HD streams…");

        Exception lastError = null;
        ExecutorService racePool = Executors.newFixedThreadPool(2);
        try {
            CompletionService<JSONObject> completion = new ExecutorCompletionService<>(racePool);
            Future<JSONObject> tikwmFuture = completion.submit(() -> fetchTikTokFromTikwmJava(targetUrl));
            Future<JSONObject> apiFuture = completion.submit(() -> fetchTikTokFromApiJava(apiBase, targetUrl));

            for (int i = 0; i < 2; i++) {
                task.checkCancelled();
                try {
                    JSONObject result = completion.take().get();
                    if (isValidTikTokInfoJson(result)) {
                        ensureTikTokInfoId(result, targetUrl);
                        tikwmFuture.cancel(true);
                        apiFuture.cancel(true);
                        return result;
                    }
                } catch (Exception e) {
                    Throwable cause = e.getCause() != null ? e.getCause() : e;
                    Log.w(TAG, "TikTok Tier-1 provider failed: " + cause.getMessage());
                    lastError = cause instanceof Exception ? (Exception) cause : new Exception(cause.getMessage());
                }
            }
        } finally {
            racePool.shutdownNow();
        }

        // Tier 2: On-device bundled yt-dlp fallback using the user's own IP (no datacenter blocks)
        task.checkCancelled();
        try {
            task.updateProgress(68, 0, 0, -1, "Trying on-device TikTok extractor…");
            JSONObject ytDlpResult = fetchTikTokWithYtDlpNative(targetUrl);
            if (isValidTikTokInfoJson(ytDlpResult)) {
                ensureTikTokInfoId(ytDlpResult, targetUrl);
                return ytDlpResult;
            }
        } catch (java.util.concurrent.CancellationException cancelled) {
            throw cancelled;
        } catch (Throwable e) {
            Log.w(TAG, "TikTok on-device yt-dlp fallback failed: " + e.getMessage());
            if (lastError == null) {
                lastError = e instanceof Exception ? (Exception) e : new Exception(e.getMessage());
            }
        }

        if (lastError != null) throw lastError;
        throw new IllegalStateException("Could not fetch this TikTok video. Please check the link and try again.");
    }

    private static boolean isValidTikTokInfoJson(JSONObject obj) {
        if (obj == null) return false;
        JSONArray photos = obj.optJSONArray("photos");
        if (photos != null && photos.length() > 0) return true;
        JSONObject dl = obj.optJSONObject("downloadUrls");
        if (dl != null) {
            if (nonEmptyOrNull(dl.optString("hd", "")) != null ||
                nonEmptyOrNull(dl.optString("normal", "")) != null ||
                nonEmptyOrNull(dl.optString("low", "")) != null ||
                nonEmptyOrNull(dl.optString("audio", "")) != null) {
                return true;
            }
        }
        return false;
    }

    private static void ensureTikTokInfoId(JSONObject obj, String fallbackUrl) throws JSONException {
        String existing = nonEmptyOrNull(obj.optString("id", ""));
        if (existing != null && !"null".equalsIgnoreCase(existing)) return;
        Matcher m = Pattern.compile("/(?:video|photo)/(\\d+)").matcher(fallbackUrl != null ? fallbackUrl : "");
        if (m.find()) {
            obj.put("id", m.group(1));
        } else {
            obj.put("id", "tt-" + Math.abs((fallbackUrl != null ? fallbackUrl : "").hashCode()));
        }
    }

    private static String normalizeTikwmMediaUrl(String raw) {
        String clean = nonEmptyOrNull(raw);
        if (clean == null || "null".equalsIgnoreCase(clean)) return null;
        if (clean.startsWith("//")) return "https:" + clean;
        if (clean.startsWith("/")) return "https://www.tikwm.com" + clean;
        return clean;
    }

    private JSONObject fetchTikTokFromTikwmJava(String targetUrl) throws Exception {
        String[] endpoints = { "https://www.tikwm.com/api/", "https://tikwm.com/api/" };
        Exception lastErr = null;
        for (int attempt = 0; attempt < endpoints.length; attempt++) {
            String endpoint = endpoints[attempt];
            HttpURLConnection conn = null;
            try {
                String formBody = "url=" + URLEncoder.encode(targetUrl, "UTF-8") + "&hd=1";
                byte[] payload = formBody.getBytes(StandardCharsets.UTF_8);
                String currentUrl = endpoint;
                int code = -1;

                for (int redirect = 0; redirect < 4; redirect++) {
                    URL parsed = new URL(currentUrl);
                    String origin = parsed.getProtocol() + "://" + parsed.getHost();
                    conn = (HttpURLConnection) parsed.openConnection();
                    conn.setInstanceFollowRedirects(false);
                    conn.setRequestMethod("POST");
                    conn.setDoOutput(true);
                    conn.setConnectTimeout(10_000);
                    conn.setReadTimeout(28_000);
                    conn.setFixedLengthStreamingMode(payload.length);
                    conn.setRequestProperty("Content-Type", "application/x-www-form-urlencoded");
                    conn.setRequestProperty("Accept", "application/json, text/plain, */*");
                    conn.setRequestProperty("Origin", origin);
                    conn.setRequestProperty("Referer", origin + "/");
                    conn.setRequestProperty(
                        "User-Agent",
                        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
                    );
                    try (OutputStream out = conn.getOutputStream()) {
                        out.write(payload);
                    }
                    code = conn.getResponseCode();
                    if (code == HttpURLConnection.HTTP_MOVED_PERM ||
                        code == HttpURLConnection.HTTP_MOVED_TEMP ||
                        code == 307 || code == 308) {
                        String location = conn.getHeaderField("Location");
                        conn.disconnect();
                        conn = null;
                        if (location == null || location.trim().isEmpty()) {
                            break;
                        }
                        currentUrl = new URL(parsed, location).toString();
                        continue;
                    }
                    break;
                }

                if (conn == null || code < 200 || code >= 300) {
                    lastErr = new IllegalStateException("TikWM returned HTTP " + code);
                    continue;
                }
                String raw = readHttpBody(conn.getInputStream());
                JSONObject json = new JSONObject(raw);
                if (json.optInt("code", -1) != 0) {
                    String msg = json.optString("msg", "Could not fetch TikTok video.");
                    lastErr = new IllegalStateException(msg);
                    if (attempt == 0 && msg.toLowerCase(Locale.ROOT).contains("limit")) {
                        try {
                            Thread.sleep(950);
                        } catch (InterruptedException ie) {
                            Thread.currentThread().interrupt();
                            throw ie;
                        }
                    }
                    continue;
                }
                JSONObject d = json.optJSONObject("data");
                if (d == null) continue;
                return normalizeTikwmDataToJson(d, targetUrl);
            } catch (InterruptedException ie) {
                Thread.currentThread().interrupt();
                throw ie;
            } catch (Exception e) {
                lastErr = e;
            } finally {
                if (conn != null) conn.disconnect();
            }
        }
        if (lastErr != null) throw lastErr;
        throw new IllegalStateException("TikWM did not return video data.");
    }

    private JSONObject normalizeTikwmDataToJson(JSONObject d, String fallbackUrl) throws JSONException {
        JSONObject author = d.optJSONObject("author");
        JSONObject musicInfo = d.optJSONObject("music_info");
        String authorUsername = author != null && !author.optString("unique_id", "").isEmpty()
            ? author.optString("unique_id")
            : "unknown";
        String authorName = author != null && !author.optString("nickname", "").isEmpty()
            ? author.optString("nickname")
            : authorUsername;

        JSONArray images = d.optJSONArray("images");
        JSONArray photos = new JSONArray();
        if (images != null) {
            for (int i = 0; i < images.length(); i++) {
                String img = normalizeTikwmMediaUrl(images.optString(i, ""));
                if (img != null) photos.put(img);
            }
        }

        String play = normalizeTikwmMediaUrl(d.optString("play", ""));
        String hdplay = normalizeTikwmMediaUrl(d.optString("hdplay", ""));
        String wmplay = normalizeTikwmMediaUrl(d.optString("wmplay", ""));
        String music = normalizeTikwmMediaUrl(d.optString("music", ""));
        String musicInfoPlay = musicInfo != null ? normalizeTikwmMediaUrl(musicInfo.optString("play", "")) : null;

        JSONObject downloadUrls = new JSONObject();
        downloadUrls.put("hd", hdplay != null ? hdplay : (play != null ? play : JSONObject.NULL));
        downloadUrls.put("normal", play != null ? play : JSONObject.NULL);
        downloadUrls.put("low", wmplay != null ? wmplay : (play != null ? play : JSONObject.NULL));
        downloadUrls.put("audio", music != null ? music : (musicInfoPlay != null ? musicInfoPlay : JSONObject.NULL));

        JSONObject musicObj = new JSONObject();
        musicObj.put("title", musicInfo != null && !musicInfo.optString("title", "").isEmpty() ? musicInfo.optString("title") : "Unknown");
        musicObj.put("author", musicInfo != null && !musicInfo.optString("author", "").isEmpty() ? musicInfo.optString("author") : "Unknown");
        musicObj.put("url", musicInfoPlay != null ? musicInfoPlay : (music != null ? music : JSONObject.NULL));

        Object rawId = d.opt("id");
        if (rawId == null || rawId == JSONObject.NULL) {
            rawId = d.opt("aweme_id");
        }
        String resolvedId = (rawId != null && rawId != JSONObject.NULL) ? String.valueOf(rawId).trim() : "";

        JSONObject out = new JSONObject();
        out.put("id", resolvedId);
        out.put("title", !d.optString("title", "").isEmpty() ? d.optString("title") : "TikTok video");
        out.put("author", authorName);
        out.put("authorUsername", authorUsername);
        String avatar = author != null ? normalizeTikwmMediaUrl(author.optString("avatar", "")) : null;
        out.put("authorAvatar", avatar != null ? avatar : JSONObject.NULL);
        String cover = normalizeTikwmMediaUrl(d.optString("cover", ""));
        if (cover == null) cover = normalizeTikwmMediaUrl(d.optString("origin_cover", ""));
        out.put("thumbnail", cover != null ? cover : JSONObject.NULL);
        int duration = d.optInt("duration", -1);
        out.put("duration", duration >= 0 ? duration : JSONObject.NULL);
        out.put("downloadUrls", downloadUrls);
        out.put("isPhoto", photos.length() > 0);
        out.put("photos", photos);
        out.put("music", musicObj);
        ensureTikTokInfoId(out, fallbackUrl);
        return out;
    }

    private JSONObject fetchTikTokWithYtDlpNative(String targetUrl) throws Exception {
        ensureYouTubeDownloader();
        YoutubeDLRequest request = new YoutubeDLRequest(targetUrl)
            .addOption("--no-playlist")
            .addOption("--no-warnings")
            .addOption("--no-check-certificates")
            .addOption("--socket-timeout", "15");
        VideoInfo info = YoutubeDL.getInstance().getInfo(request);
        if (info == null) {
            throw new IllegalStateException("On-device TikTok extractor returned empty metadata.");
        }

        String hdUrl = null;
        String normalUrl = null;
        String lowUrl = null;
        String audioUrl = null;
        int bestHdHeight = -1;
        int bestNormalHeight = -1;
        int lowestHeight = Integer.MAX_VALUE;

        java.util.ArrayList<com.yausername.youtubedl_android.mapper.VideoFormat> formats = info.getFormats();
        if (formats != null) {
            for (com.yausername.youtubedl_android.mapper.VideoFormat fmt : formats) {
                if (fmt == null) continue;
                String fUrl = nonEmptyOrNull(fmt.getUrl());
                if (fUrl == null || (!fUrl.startsWith("https://") && !fUrl.startsWith("http://"))) continue;
                String vcodec = fmt.getVcodec();
                String acodec = fmt.getAcodec();
                boolean hasVideo = vcodec != null && !"none".equalsIgnoreCase(vcodec);
                boolean hasAudio = acodec != null && !"none".equalsIgnoreCase(acodec);
                int height = fmt.getHeight();

                if (!hasVideo && hasAudio && audioUrl == null) {
                    audioUrl = fUrl;
                    continue;
                }
                if (hasVideo) {
                    if (height > bestHdHeight) {
                        bestHdHeight = height;
                        hdUrl = fUrl;
                    }
                    if (hasAudio && height >= bestNormalHeight) {
                        bestNormalHeight = height;
                        normalUrl = fUrl;
                    }
                    if (hasAudio && height > 0 && height < lowestHeight) {
                        lowestHeight = height;
                        lowUrl = fUrl;
                    }
                }
            }
        }

        String directFallback = nonEmptyOrNull(info.getUrl());
        if (hdUrl == null) hdUrl = directFallback;
        if (normalUrl == null) normalUrl = hdUrl;
        if (lowUrl == null) lowUrl = normalUrl;
        if (hdUrl == null && audioUrl == null) {
            throw new IllegalStateException("No downloadable TikTok stream was found.");
        }

        String authorName = nonEmptyOrNull(info.getUploader());
        if (authorName == null) authorName = nonEmptyOrNull(info.getUploaderId());
        if (authorName == null) authorName = "Unknown";
        String authorUsername = nonEmptyOrNull(info.getUploaderId());
        if (authorUsername == null) authorUsername = "unknown";

        JSONObject downloadUrls = new JSONObject();
        downloadUrls.put("hd", hdUrl != null ? hdUrl : JSONObject.NULL);
        downloadUrls.put("normal", normalUrl != null ? normalUrl : JSONObject.NULL);
        downloadUrls.put("low", lowUrl != null ? lowUrl : JSONObject.NULL);
        downloadUrls.put("audio", audioUrl != null ? audioUrl : JSONObject.NULL);

        JSONObject musicObj = new JSONObject();
        musicObj.put("title", "Original Sound");
        musicObj.put("author", authorName);
        musicObj.put("url", audioUrl != null ? audioUrl : JSONObject.NULL);

        String title = nonEmptyOrNull(info.getTitle());
        if (title == null) title = nonEmptyOrNull(info.getDescription());
        if (title == null) title = "TikTok video";

        JSONObject out = new JSONObject();
        out.put("id", nonEmptyOrNull(info.getId()) != null ? info.getId().trim() : "");
        out.put("title", title);
        out.put("author", authorName);
        out.put("authorUsername", authorUsername);
        out.put("authorAvatar", JSONObject.NULL);
        String thumb = nonEmptyOrNull(info.getThumbnail());
        out.put("thumbnail", thumb != null ? thumb : JSONObject.NULL);
        int duration = info.getDuration();
        out.put("duration", duration > 0 ? duration : JSONObject.NULL);
        out.put("downloadUrls", downloadUrls);
        out.put("isPhoto", false);
        out.put("photos", new JSONArray());
        out.put("music", musicObj);
        ensureTikTokInfoId(out, targetUrl);
        return out;
    }

    private JSONObject fetchTikTokFromApiJava(String apiBase, String targetUrl) throws Exception {
        HttpURLConnection conn = null;
        try {
            JSONObject reqBody = new JSONObject();
            reqBody.put("url", targetUrl);
            byte[] payload = reqBody.toString().getBytes(StandardCharsets.UTF_8);
            conn = (HttpURLConnection) new URL(apiBase + "/api/tiktok/fetch").openConnection();
            conn.setRequestMethod("POST");
            conn.setDoOutput(true);
            conn.setConnectTimeout(10_000);
            conn.setReadTimeout(30_000);
            conn.setRequestProperty("Content-Type", "application/json");
            conn.setRequestProperty("Accept", "application/json");
            try (OutputStream out = conn.getOutputStream()) {
                out.write(payload);
            }
            int code = conn.getResponseCode();
            if (code < 200 || code >= 300) {
                String errMsg = readHttpErrorMessage(conn);
                throw new IllegalStateException(errMsg != null ? errMsg : ("TikTok fetch failed (HTTP " + code + ")."));
            }
            return new JSONObject(readHttpBody(conn.getInputStream()));
        } finally {
            if (conn != null) conn.disconnect();
        }
    }

    private JSONObject fetchTwitterInfoNative(
        Context appContext,
        String targetUrl,
        DownloadForegroundService.TaskContext task
    ) throws Exception {
        if (targetUrl == null || targetUrl.isEmpty()) {
            throw new IllegalArgumentException("Enter a valid X / Twitter URL.");
        }
        String apiBase = HutaoNotificationHelper.getApiBaseUrl(appContext);
        task.updateProgress(35, 0, 0, -1, "Fetching X video metadata…");

        ExecutorService racePool = Executors.newFixedThreadPool(2);
        try {
            CompletionService<JSONObject> completion = new ExecutorCompletionService<>(racePool);
            Future<JSONObject> fxFuture = completion.submit(() -> fetchTwitterFromFxJava(targetUrl));
            Future<JSONObject> apiFuture = completion.submit(() -> fetchTwitterFromApiJava(apiBase, targetUrl));

            Exception lastError = null;
            for (int i = 0; i < 2; i++) {
                task.checkCancelled();
                try {
                    JSONObject result = completion.take().get();
                    if (result != null && result.optJSONArray("formats") != null &&
                        result.optJSONArray("formats").length() > 0) {
                        fxFuture.cancel(true);
                        apiFuture.cancel(true);
                        return result;
                    }
                } catch (Exception e) {
                    Throwable cause = e.getCause() != null ? e.getCause() : e;
                    lastError = cause instanceof Exception ? (Exception) cause : new Exception(cause.getMessage());
                }
            }
            if (lastError != null) throw lastError;
            throw new IllegalStateException("No downloadable video or GIF was found in this X post.");
        } finally {
            racePool.shutdownNow();
        }
    }

    private JSONObject fetchTwitterFromFxJava(String targetUrl) throws Exception {
        Matcher idMatcher = Pattern.compile("/status(?:es)?/(\\d+)", Pattern.CASE_INSENSITIVE).matcher(targetUrl);
        if (!idMatcher.find()) {
            throw new IllegalArgumentException("The X post URL does not contain a valid post ID.");
        }
        String statusId = idMatcher.group(1);
        HttpURLConnection conn = null;
        try {
            conn = (HttpURLConnection) new URL("https://api.fxtwitter.com/i/status/" + statusId).openConnection();
            conn.setRequestMethod("GET");
            conn.setConnectTimeout(6_000);
            conn.setReadTimeout(9_000);
            conn.setRequestProperty("Accept", "application/json");
            int code = conn.getResponseCode();
            if (code < 200 || code >= 300) {
                throw new IllegalStateException("X video provider returned HTTP " + code);
            }
            JSONObject root = new JSONObject(readHttpBody(conn.getInputStream()));
            if (root.optInt("code", 0) != 200) {
                throw new IllegalStateException("Could not find this X post.");
            }
            JSONObject tweet = root.optJSONObject("tweet");
            if (tweet == null) throw new IllegalStateException("Could not find this X post.");
            JSONObject media = tweet.optJSONObject("media");
            JSONArray rawMedia = media != null ? media.optJSONArray("videos") : null;
            if (rawMedia == null || rawMedia.length() == 0) {
                JSONArray all = media != null ? media.optJSONArray("all") : null;
                rawMedia = new JSONArray();
                if (all != null) {
                    for (int i = 0; i < all.length(); i++) {
                        JSONObject item = all.optJSONObject(i);
                        if (item == null) continue;
                        String type = item.optString("type", "").toLowerCase(Locale.ROOT);
                        if ("video".equals(type) || "gif".equals(type)) {
                            rawMedia.put(item);
                        }
                    }
                }
            }
            if (rawMedia.length() == 0) {
                throw new IllegalStateException("No downloadable video or GIF was found in this X post.");
            }

            JSONObject primaryVideo = rawMedia.getJSONObject(0);
            JSONArray rawFormats = primaryVideo.optJSONArray("formats");
            TreeMap<Integer, String> bestByHeight = new TreeMap<>((a, b) -> b.compareTo(a));
            Map<Integer, Integer> bestBitrateByHeight = new LinkedHashMap<>();
            Pattern dimPattern = Pattern.compile("/(\\d{2,4})x(\\d{2,4})/");

            if (rawFormats != null) {
                for (int i = 0; i < rawFormats.length(); i++) {
                    JSONObject fmt = rawFormats.optJSONObject(i);
                    if (fmt == null) continue;
                    String fUrl = fmt.optString("url", "");
                    if (!fUrl.startsWith("https://video.twimg.com/")) continue;
                    String container = fmt.optString("container", "");
                    if (!"mp4".equalsIgnoreCase(container) && !fUrl.toLowerCase(Locale.ROOT).contains(".mp4")) continue;
                    Matcher dm = dimPattern.matcher(fUrl);
                    int height = dm.find()
                        ? Integer.parseInt(dm.group(2))
                        : (primaryVideo.optInt("height", 0) > 0 ? primaryVideo.optInt("height") : 480);
                    int bitrate = fmt.optInt("bitrate", 0);
                    boolean isH264 = "h264".equalsIgnoreCase(fmt.optString("codec", ""));
                    int score = bitrate + (isH264 ? 1_000_000_000 : 0);
                    Integer existingScore = bestBitrateByHeight.get(height);
                    if (existingScore == null || score > existingScore) {
                        bestBitrateByHeight.put(height, score);
                        bestByHeight.put(height, fUrl);
                    }
                }
            }

            String directVideoUrl = primaryVideo.optString("url", "");
            if (bestByHeight.isEmpty() && directVideoUrl.startsWith("https://video.twimg.com/") &&
                directVideoUrl.toLowerCase(Locale.ROOT).contains(".mp4")) {
                int h = primaryVideo.optInt("height", 0) > 0 ? primaryVideo.optInt("height") : 480;
                bestByHeight.put(h, directVideoUrl);
            }
            if (bestByHeight.isEmpty()) {
                throw new IllegalStateException("No downloadable video or GIF was found in this X post.");
            }

            boolean isGif = "gif".equalsIgnoreCase(primaryVideo.optString("type", "")) ||
                directVideoUrl.contains("/tweet_video/");
            JSONArray formatsOut = new JSONArray();
            for (Map.Entry<Integer, String> entry : bestByHeight.entrySet()) {
                if (entry.getValue().contains("/tweet_video/")) isGif = true;
                JSONObject fmtObj = new JSONObject();
                fmtObj.put("height", entry.getKey());
                fmtObj.put("qualityLabel", entry.getKey() + "p");
                fmtObj.put("downloadUrl", entry.getValue());
                formatsOut.put(fmtObj);
            }

            JSONObject author = tweet.optJSONObject("author");
            String channelName = author != null && !author.optString("name", "").isEmpty()
                ? author.optString("name")
                : (author != null && !author.optString("screen_name", "").isEmpty()
                    ? author.optString("screen_name")
                    : "X Creator");
            String text = tweet.optString("text", "").trim();
            String thumb = nonEmptyOrNull(primaryVideo.optString("thumbnail_url", ""));

            JSONObject out = new JSONObject();
            out.put("id", !tweet.optString("id", "").isEmpty() ? tweet.optString("id") : statusId);
            out.put("title", !text.isEmpty() ? text : (isGif ? "X GIF" : "X Video"));
            out.put("thumbnail", thumb != null ? thumb : JSONObject.NULL);
            out.put("channelName", channelName);
            out.put("duration", (int) Math.round(primaryVideo.optDouble("duration", 0)));
            out.put("isGif", isGif);
            out.put("formats", formatsOut);
            return out;
        } finally {
            if (conn != null) conn.disconnect();
        }
    }

    private JSONObject fetchTwitterFromApiJava(String apiBase, String targetUrl) throws Exception {
        HttpURLConnection conn = null;
        try {
            String endpoint = apiBase + "/api/twitter/info?url=" + URLEncoder.encode(targetUrl, "UTF-8");
            conn = (HttpURLConnection) new URL(endpoint).openConnection();
            conn.setRequestMethod("GET");
            conn.setConnectTimeout(10_000);
            conn.setReadTimeout(25_000);
            conn.setRequestProperty("Accept", "application/json");
            int code = conn.getResponseCode();
            if (code < 200 || code >= 300) {
                String errMsg = readHttpErrorMessage(conn);
                throw new IllegalStateException(errMsg != null ? errMsg : ("X fetch failed (HTTP " + code + ")."));
            }
            return new JSONObject(readHttpBody(conn.getInputStream()));
        } finally {
            if (conn != null) conn.disconnect();
        }
    }

    private static String readHttpBody(InputStream in) throws Exception {
        StringBuilder sb = new StringBuilder();
        try (BufferedReader reader = new BufferedReader(new InputStreamReader(in, StandardCharsets.UTF_8))) {
            String line;
            while ((line = reader.readLine()) != null) {
                sb.append(line);
            }
        }
        return sb.toString();
    }

    private static String readHttpErrorMessage(HttpURLConnection conn) {
        try (InputStream err = conn.getErrorStream()) {
            if (err == null) return null;
            String raw = readHttpBody(err).trim();
            if (raw.startsWith("{")) {
                JSONObject obj = new JSONObject(raw);
                String msg = obj.optString("error", "");
                if (!msg.isEmpty()) return msg;
            }
        } catch (Throwable ignored) {
        }
        return null;
    }

    private static String nonEmptyOrNull(String value) {
        if (value == null) return null;
        String trimmed = value.trim();
        return trimmed.isEmpty() ? null : trimmed;
    }

    private File downloadFacebookFile(String url, String quality, String filename, String requestId) throws Exception {
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

        YoutubeDL.getInstance().execute(
            request,
            requestId,
            createYtDlpProgressCallback(
                requestId,
                false,
                audio ? "Downloading Facebook audio…" : "Downloading Facebook video…"
            )
        );
        File[] downloads = outputDir.listFiles();
        if (downloads != null) {
            for (File file : downloads) {
                if (file.isFile() && file.length() > 0) return file;
            }
        }
        throw new IllegalStateException("yt-dlp did not create a Facebook download.");
    }

    private void saveFacebookFile(File source, String filename, String folderName) throws Exception {
        String safeFilename = filename != null ? filename.trim() : "";
        String mimeType = safeFilename.toLowerCase(Locale.ROOT).endsWith(".mp3") ? "audio/mpeg" : "video/mp4";
        saveFileToUserFolder(source, filename, folderName, mimeType);
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
        awaitYoutubeDlInit();
        if (sharedYoutubeInitError != null) {
            throw new IllegalStateException("The on-device Facebook downloader could not start: " + sharedYoutubeInitError);
        }
    }

    private void ensureFacebookAudioTools() {
        awaitFfmpegInit();
        if (sharedFfmpegInitError != null) {
            throw new IllegalStateException("Facebook MP3 downloads are unavailable: " + sharedFfmpegInitError);
        }
    }

    private void sendFacebookError(String requestId, Throwable error) {
        JSONObject result = new JSONObject();
        try {
            result.put("error", error != null && error.getMessage() != null ? error.getMessage() : "Facebook download failed.");
        } catch (JSONException e) {
            return;
        }
        sendFacebookResult(requestId, result);
    }

    private void sendFacebookResult(String requestId, JSONObject result) {
        String script = "window.onNativeFacebookResult && window.onNativeFacebookResult(" +
            JSONObject.quote(requestId) + "," + JSONObject.quote(result.toString()) + ");";
        evalJsSafely(script);
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == REQUEST_CODE_NOTIFICATIONS) {
            boolean granted = grantResults != null &&
                grantResults.length > 0 &&
                grantResults[0] == PackageManager.PERMISSION_GRANTED;
            if (granted) {
                NotificationSyncJobService.schedule(this);
                NotificationSyncJobService.checkNowAsync(this, false);
            }
            String script = "window.onNotificationPermissionResult && window.onNotificationPermissionResult(" +
                (granted ? "true" : "false") + ");";
            evalJsSafely(script);
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == REQUEST_CODE_PICK_FOLDER) {
            String pickedName = "";
            if (resultCode == RESULT_OK && data != null) {
                Uri treeUri = data.getData();
                if (treeUri != null) {
                    try {
                        getContentResolver().takePersistableUriPermission(
                            treeUri,
                            Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION
                        );
                    } catch (Throwable e) {
                        Log.w(TAG, "Could not persist folder URI permission.", e);
                    }
                    getSharedPreferences("hutaotik", MODE_PRIVATE).edit()
                        .putString(FACEBOOK_FOLDER_PREF, treeUri.toString())
                        .apply();
                    try {
                        DocumentFile pickedDir = DocumentFile.fromTreeUri(this, treeUri);
                        pickedName = (pickedDir != null && pickedDir.getName() != null)
                            ? pickedDir.getName()
                            : "HutaoTik Downloads";
                    } catch (Throwable ignored) {
                        pickedName = "HutaoTik Downloads";
                    }
                }
            }
            String script = "window.onAndroidFolderPicked && window.onAndroidFolderPicked(" +
                JSONObject.quote(pickedName) + ");";
            evalJsSafely(script);
        }
    }

    @Override
    public void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleSendIntent(intent);
        handleNotificationRouteIntent(intent);
    }

    private void handleNotificationRouteIntent(Intent intent) {
        try {
            if (intent == null) return;
            String route = intent.getStringExtra(HutaoNotificationHelper.EXTRA_ROUTE);
            if (route == null || route.trim().isEmpty()) return;
            String cleanRoute = route.trim();
            if (!cleanRoute.startsWith("/")) cleanRoute = "/" + cleanRoute;
            pendingNotificationRoute.set(cleanRoute);
            final String hashTarget = "#" + cleanRoute;
            WebView webView = getSafeWebView();
            if (webView != null) {
                webView.post(() -> {
                    if (isFinishing() || isDestroyed()) return;
                    try {
                        if (webView.getUrl() != null && !"about:blank".equals(webView.getUrl())) {
                            webView.evaluateJavascript(
                                "window.location.hash = " + JSONObject.quote(hashTarget) + ";" +
                                (hashTarget.equals("#/updates") ? "window.dispatchEvent(new Event('hutaotik:check-update'));" : ""),
                                null
                            );
                        }
                    } catch (Throwable ignored) {
                    }
                });
            }
        } catch (Throwable t) {
            Log.w(TAG, "Ignored malformed notification route intent.", t);
        }
    }

    private void handleSendIntent(Intent intent) {
        try {
            if (intent != null && Intent.ACTION_SEND.equals(intent.getAction())) {
                CharSequence sharedText = intent.getCharSequenceExtra(Intent.EXTRA_TEXT);
                if ((sharedText == null || sharedText.length() == 0) && intent.getClipData() != null &&
                    intent.getClipData().getItemCount() > 0) {
                    sharedText = intent.getClipData().getItemAt(0).coerceToText(this);
                }
                if (sharedText != null && sharedText.length() > 0) {
                    pendingSharedText.set(sharedText.toString().trim());
                    WebView webView = getSafeWebView();
                    if (webView != null) {
                        webView.post(() -> {
                            if (isFinishing() || isDestroyed()) return;
                            try {
                                if (webView.getUrl() != null && !"about:blank".equals(webView.getUrl())) {
                                    webView.evaluateJavascript("window.location.hash = '#/';", null);
                                }
                            } catch (Throwable ignored) {
                            }
                        });
                    }
                }
            }
        } catch (Throwable t) {
            Log.w(TAG, "Ignored malformed share intent.", t);
        }
    }
}
