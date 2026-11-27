package com.hutaotik.app;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ServiceInfo;
import android.net.Uri;
import android.os.Build;
import android.os.IBinder;
import android.util.Log;

import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.ContextCompat;

import org.json.JSONException;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Iterator;
import java.util.Locale;
import java.util.UUID;
import java.util.concurrent.CancellationException;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;

public class AdminUploadForegroundService extends Service {
    private static final String TAG = "HutaotikAdminUpload";

    public static final String ACTION_SYNC = "com.hutaotik.admin.ACTION_SYNC_UPLOAD";
    public static final String ACTION_CANCEL = "com.hutaotik.admin.ACTION_CANCEL_UPLOAD";
    public static final String EXTRA_TASK_ID = "task_id";

    public static final String CHANNEL_UPLOAD_PROGRESS = "hutaotik_admin_upload_progress";
    public static final String CHANNEL_UPLOAD_COMPLETE = "hutaotik_admin_upload_complete";
    public static final String PREFS_NAME = "hutaotik_admin_upload_prefs";
    public static final String KEY_PENDING_RESULT = "pending_upload_result";

    private static final int FOREGROUND_NOTIF_ID = 5100;
    private static final int COMPLETE_NOTIF_ID = 5200;
    private static final int COLOR_EMBER = 0xFFF97316;
    private static final int COLOR_EMERALD = 0xFF10B981;
    private static final int COLOR_ROSE = 0xFFF43F5E;

    private static final ExecutorService UPLOAD_POOL = Executors.newSingleThreadExecutor();
    private static final ConcurrentHashMap<String, UploadTask> ACTIVE_UPLOADS = new ConcurrentHashMap<>();
    private static volatile AdminUploadForegroundService runningService;
    private static volatile UploadRelay uploadRelay;

    public interface UploadRelay {
        void onProgress(String requestId, int percent, long loadedBytes, long totalBytes, long etaSeconds, String stage);
        void onFinished(String requestId, int statusCode, String responseJson, String errorMessage);
    }

    private static final class UploadTask {
        final String requestId;
        final String versionLabel;
        final String filename;
        final AtomicBoolean cancelled = new AtomicBoolean(false);
        volatile Thread workerThread;
        volatile HttpURLConnection activeConnection;
        volatile int percent = 0;
        volatile long loadedBytes = 0L;
        volatile long totalBytes = 0L;
        volatile long etaSeconds = -1L;
        volatile String stage = "Preparing APK upload…";
        volatile long lastNotifAt = 0L;
        volatile int lastNotifPercent = -1;

        UploadTask(String requestId, String versionLabel, String filename) {
            this.requestId = requestId;
            this.versionLabel = versionLabel;
            this.filename = filename;
        }
    }

    public static void setUploadRelay(UploadRelay relay) {
        uploadRelay = relay;
    }

    public static void ensureChannels(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        if (manager == null) return;

        NotificationChannel progress = new NotificationChannel(
            CHANNEL_UPLOAD_PROGRESS,
            "APK Upload Progress",
            NotificationManager.IMPORTANCE_LOW
        );
        progress.setDescription("Live background upload progress while publishing a new APK release");
        progress.setShowBadge(false);
        progress.setSound(null, null);
        progress.enableVibration(false);
        manager.createNotificationChannel(progress);

        NotificationChannel complete = new NotificationChannel(
            CHANNEL_UPLOAD_COMPLETE,
            "APK Publish Alerts",
            NotificationManager.IMPORTANCE_HIGH
        );
        complete.setDescription("Alerts when your APK release finishes uploading or fails");
        manager.createNotificationChannel(complete);
    }

    public static boolean hasNotificationPermission(Context context) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            if (ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS)
                != PackageManager.PERMISSION_GRANTED) {
                return false;
            }
        }
        return NotificationManagerCompat.from(context).areNotificationsEnabled();
    }

    public static String consumePendingResult(Context context) {
        String raw = context.getApplicationContext()
            .getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .getString(KEY_PENDING_RESULT, "");
        if (raw != null && !raw.isEmpty()) {
            context.getApplicationContext()
                .getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                .edit()
                .remove(KEY_PENDING_RESULT)
                .apply();
            return raw;
        }
        return "";
    }

    public static void cancelUpload(Context context, String requestId) {
        if (requestId == null || requestId.isEmpty()) return;
        UploadTask task = ACTIVE_UPLOADS.get(requestId);
        if (task == null) return;
        task.cancelled.set(true);
        HttpURLConnection conn = task.activeConnection;
        if (conn != null) {
            try {
                conn.disconnect();
            } catch (Exception ignored) {
            }
        }
        Thread worker = task.workerThread;
        if (worker != null) {
            worker.interrupt();
        }
    }

    public static void startApkUpload(
        Context context,
        String endpointUrl,
        String headersJson,
        String fieldsJson,
        Uri sourceApkUri,
        String apkFilename,
        String requestId
    ) {
        Context appCtx = context.getApplicationContext();
        ensureChannels(appCtx);

        String versionLabel = "Update";
        try {
            JSONObject fields = new JSONObject(fieldsJson != null ? fieldsJson : "{}");
            String vName = fields.optString("versionName", "").trim();
            if (!vName.isEmpty()) versionLabel = "v" + vName;
        } catch (Exception ignored) {
        }

        String safeFilename = (apkFilename != null && !apkFilename.trim().isEmpty())
            ? apkFilename.trim()
            : "hutaotik.apk";

        UploadTask task = new UploadTask(requestId, versionLabel, safeFilename);
        ACTIVE_UPLOADS.put(requestId, task);
        requestForegroundSync(appCtx);

        UPLOAD_POOL.execute(() -> {
            task.workerThread = Thread.currentThread();
            File stagedApk = null;
            HttpURLConnection conn = null;
            try {
                if (endpointUrl == null || !endpointUrl.startsWith("https://")) {
                    throw new IllegalArgumentException("Release upload endpoint must use HTTPS.");
                }
                if (sourceApkUri == null) {
                    throw new IllegalArgumentException("No APK file selected.");
                }

                // Step 1: Stage picked URI into cache so upload survives even if Admin Activity is closed
                emitProgress(appCtx, task, 1, 0, 0, -1, "Staging APK for background upload…", true);
                File uploadDir = new File(appCtx.getCacheDir(), "admin-uploads");
                if (!uploadDir.exists() && !uploadDir.mkdirs()) {
                    throw new IllegalStateException("Could not create temporary upload folder.");
                }
                stagedApk = new File(uploadDir, "stage_" + UUID.randomUUID() + ".apk");
                try (InputStream in = appCtx.getContentResolver().openInputStream(sourceApkUri);
                     FileOutputStream out = new FileOutputStream(stagedApk)) {
                    if (in == null) {
                        throw new IllegalStateException("Could not read the selected APK file. Pick it again and retry.");
                    }
                    byte[] copyBuf = new byte[64 * 1024];
                    int read;
                    while ((read = in.read(copyBuf)) != -1) {
                        checkCancelled(task);
                        out.write(copyBuf, 0, read);
                    }
                }

                long apkLength = stagedApk.length();
                if (apkLength < 4) {
                    throw new IllegalStateException("Selected APK file is empty.");
                }
                byte[] magic = new byte[4];
                try (FileInputStream magicIn = new FileInputStream(stagedApk)) {
                    int n = magicIn.read(magic);
                    if (n < 4 || magic[0] != 0x50 || magic[1] != 0x4b || magic[2] != 0x03 || magic[3] != 0x04) {
                        throw new IllegalStateException("Selected file is not a valid Android .apk package.");
                    }
                }

                // Step 2: Build exact multipart prefix + trailer so we can stream with fixed Content-Length (< 1 MB RAM)
                String boundary = "----HutaotikAdminBoundary" + UUID.randomUUID().toString().replace("-", "");
                ByteArrayOutputStream prefixOut = new ByteArrayOutputStream();
                JSONObject fields = new JSONObject(fieldsJson != null ? fieldsJson : "{}");
                Iterator<String> fieldKeys = fields.keys();
                while (fieldKeys.hasNext()) {
                    String key = fieldKeys.next();
                    if (fields.isNull(key)) continue;
                    String val = fields.optString(key, "");
                    writeUtf8(prefixOut, "--" + boundary + "\r\n");
                    writeUtf8(prefixOut, "Content-Disposition: form-data; name=\"" + sanitizeHeaderToken(key) + "\"\r\n\r\n");
                    writeUtf8(prefixOut, val + "\r\n");
                }
                writeUtf8(prefixOut, "--" + boundary + "\r\n");
                writeUtf8(
                    prefixOut,
                    "Content-Disposition: form-data; name=\"apk\"; filename=\"" + sanitizeHeaderToken(safeFilename) + "\"\r\n"
                );
                writeUtf8(prefixOut, "Content-Type: application/vnd.android.package-archive\r\n\r\n");

                byte[] prefixBytes = prefixOut.toByteArray();
                byte[] trailerBytes = ("\r\n--" + boundary + "--\r\n").getBytes(StandardCharsets.UTF_8);
                long totalMultipartBytes = prefixBytes.length + apkLength + trailerBytes.length;

                checkCancelled(task);
                emitProgress(appCtx, task, 2, 0, apkLength, -1, "Connecting to Hutaotik server…", true);

                URL url = new URL(endpointUrl);
                conn = (HttpURLConnection) url.openConnection();
                task.activeConnection = conn;
                conn.setDoOutput(true);
                conn.setDoInput(true);
                conn.setUseCaches(false);
                conn.setRequestMethod("POST");
                conn.setConnectTimeout(30_000);
                conn.setReadTimeout(10 * 60 * 1000);
                conn.setFixedLengthStreamingMode(totalMultipartBytes);
                conn.setRequestProperty("Content-Type", "multipart/form-data; boundary=" + boundary);
                conn.setRequestProperty("Accept", "application/json");
                conn.setRequestProperty("Connection", "close");

                JSONObject headers = new JSONObject(headersJson != null ? headersJson : "{}");
                Iterator<String> headerKeys = headers.keys();
                while (headerKeys.hasNext()) {
                    String key = headerKeys.next();
                    String val = headers.optString(key, "");
                    if (!key.equalsIgnoreCase("content-type") && !val.isEmpty()) {
                        conn.setRequestProperty(key, val);
                    }
                }

                // Step 3: Stream APK bytes directly to server while updating live progress notification
                long startedAt = System.currentTimeMillis();
                long uploadedBytes = 0L;
                try (OutputStream out = conn.getOutputStream();
                     FileInputStream apkIn = new FileInputStream(stagedApk)) {
                    out.write(prefixBytes);
                    byte[] buffer = new byte[64 * 1024];
                    int read;
                    while ((read = apkIn.read(buffer)) != -1) {
                        checkCancelled(task);
                        out.write(buffer, 0, read);
                        uploadedBytes += read;

                        int pct = 2 + (int) Math.min(94, Math.round((uploadedBytes * 94.0) / apkLength));
                        long etaSec = -1L;
                        long elapsedMs = Math.max(1L, System.currentTimeMillis() - startedAt);
                        if (uploadedBytes > 128 * 1024 && elapsedMs > 600) {
                            double bps = (uploadedBytes * 1000.0) / elapsedMs;
                            if (bps > 100) {
                                etaSec = Math.max(1L, Math.round((apkLength - uploadedBytes) / bps));
                            }
                        }
                        emitProgress(
                            appCtx,
                            task,
                            pct,
                            uploadedBytes,
                            apkLength,
                            etaSec,
                            "Uploading APK…",
                            false
                        );
                    }
                    out.write(trailerBytes);
                    out.flush();
                }

                checkCancelled(task);
                emitProgress(
                    appCtx,
                    task,
                    98,
                    apkLength,
                    apkLength,
                    -1,
                    "Finalizing release & SHA-256 on server…",
                    true
                );

                int statusCode = conn.getResponseCode();
                InputStream respStream = (statusCode >= 200 && statusCode < 400)
                    ? conn.getInputStream()
                    : conn.getErrorStream();
                String responseBody = readStream(respStream);

                ACTIVE_UPLOADS.remove(requestId);
                refreshForegroundNotification(appCtx);

                if (statusCode >= 200 && statusCode < 300) {
                    showCompletedNotification(
                        appCtx,
                        true,
                        "Published HutaoTik " + task.versionLabel + "!",
                        safeFilename + " (" + formatBytes(apkLength) + ") is now live for users."
                    );
                    deliverResult(appCtx, requestId, statusCode, responseBody, "");
                } else {
                    String errMsg = extractErrorMessage(responseBody, statusCode);
                    showCompletedNotification(appCtx, false, "APK Upload Failed", errMsg);
                    deliverResult(appCtx, requestId, statusCode, responseBody, errMsg);
                }
            } catch (CancellationException cancelled) {
                ACTIVE_UPLOADS.remove(requestId);
                refreshForegroundNotification(appCtx);
                deliverResult(appCtx, requestId, 0, "{}", "APK upload cancelled.");
            } catch (Throwable e) {
                Log.e(TAG, "Admin APK upload failed", e);
                ACTIVE_UPLOADS.remove(requestId);
                refreshForegroundNotification(appCtx);
                String errMsg = e.getMessage() != null && !e.getMessage().isEmpty()
                    ? e.getMessage()
                    : "Network error while uploading APK.";
                if (!task.cancelled.get()) {
                    showCompletedNotification(appCtx, false, "APK Upload Failed", errMsg);
                }
                deliverResult(appCtx, requestId, 0, "{}", errMsg);
            } finally {
                task.activeConnection = null;
                task.workerThread = null;
                if (conn != null) conn.disconnect();
                if (stagedApk != null && stagedApk.exists()) stagedApk.delete();
                if (ACTIVE_UPLOADS.remove(requestId) != null) {
                    refreshForegroundNotification(appCtx);
                }
            }
        });
    }

    private static void deliverResult(
        Context appCtx,
        String requestId,
        int statusCode,
        String responseBody,
        String errorMessage
    ) {
        UploadRelay relay = uploadRelay;
        if (relay != null) {
            relay.onFinished(requestId, statusCode, responseBody, errorMessage);
            return;
        }
        // Admin UI was closed/swiped away — persist result so next app launch displays it cleanly
        try {
            JSONObject stored = new JSONObject();
            stored.put("requestId", requestId);
            stored.put("status", statusCode);
            stored.put("body", responseBody);
            stored.put("error", errorMessage);
            stored.put("at", System.currentTimeMillis());
            appCtx.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                .edit()
                .putString(KEY_PENDING_RESULT, stored.toString())
                .apply();
        } catch (JSONException ignored) {
        }
    }

    private static void emitProgress(
        Context appCtx,
        UploadTask task,
        int percent,
        long loadedBytes,
        long totalBytes,
        long etaSeconds,
        String stage,
        boolean force
    ) {
        if (task.cancelled.get()) return;
        int clamped = Math.max(0, Math.min(100, percent));
        task.percent = clamped;
        if (loadedBytes > 0) task.loadedBytes = loadedBytes;
        if (totalBytes > 0) task.totalBytes = totalBytes;
        task.etaSeconds = etaSeconds;
        if (stage != null && !stage.isEmpty()) task.stage = stage;

        long now = System.currentTimeMillis();
        if (force || now - task.lastNotifAt >= 280 || Math.abs(clamped - task.lastNotifPercent) >= 3) {
            task.lastNotifAt = now;
            task.lastNotifPercent = clamped;

            UploadRelay relay = uploadRelay;
            if (relay != null) {
                relay.onProgress(task.requestId, clamped, task.loadedBytes, task.totalBytes, etaSeconds, task.stage);
            }
            refreshForegroundNotification(appCtx);
        }
    }

    private static void requestForegroundSync(Context appCtx) {
        Intent intent = new Intent(appCtx, AdminUploadForegroundService.class);
        intent.setAction(ACTION_SYNC);
        try {
            ContextCompat.startForegroundService(appCtx, intent);
        } catch (Exception e) {
            Log.w(TAG, "Could not start admin foreground service", e);
        }
    }

    private static void refreshForegroundNotification(Context appCtx) {
        AdminUploadForegroundService service = runningService;
        if (service != null) {
            service.updateNotificationOrStop();
        }
    }

    private static Notification buildProgressNotification(Context ctx, UploadTask task) {
        ensureChannels(ctx);
        int pct = task != null ? Math.max(0, Math.min(100, task.percent)) : 0;
        boolean indeterminate = task == null || (pct <= 1 && task.loadedBytes <= 0);

        String title = task != null
            ? "Uploading HutaoTik " + task.versionLabel
            : "Preparing APK upload…";

        StringBuilder body = new StringBuilder();
        if (task != null) {
            body.append(task.stage);
            if (task.loadedBytes > 0 && task.totalBytes > 0) {
                body.append(" · ").append(formatBytes(task.loadedBytes)).append(" / ").append(formatBytes(task.totalBytes));
            }
            if (task.etaSeconds > 0) {
                body.append(" · ").append(formatEta(task.etaSeconds));
            }
            if (!indeterminate) {
                body.append(" (").append(pct).append("%)");
            }
        } else {
            body.append("Starting background upload…");
        }

        Intent openIntent = new Intent(ctx.getApplicationContext(), MainActivity.class);
        openIntent.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_NEW_TASK);
        PendingIntent openPending = PendingIntent.getActivity(
            ctx.getApplicationContext(),
            5101,
            openIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        NotificationCompat.Builder builder = new NotificationCompat.Builder(ctx, CHANNEL_UPLOAD_PROGRESS)
            .setSmallIcon(R.drawable.ic_stat_upload)
            .setColor(COLOR_EMBER)
            .setContentTitle(title)
            .setContentText(body.toString())
            .setSubText("Uploading in background · Safe to leave app")
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setSilent(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setCategory(NotificationCompat.CATEGORY_PROGRESS)
            .setProgress(100, pct, indeterminate)
            .setContentIntent(openPending);

        if (task != null && !task.requestId.isEmpty()) {
            Intent cancelIntent = new Intent(ctx.getApplicationContext(), AdminUploadForegroundService.class);
            cancelIntent.setAction(ACTION_CANCEL);
            cancelIntent.putExtra(EXTRA_TASK_ID, task.requestId);
            PendingIntent cancelPending = PendingIntent.getService(
                ctx.getApplicationContext(),
                5102,
                cancelIntent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
            );
            builder.addAction(0, "Cancel", cancelPending);
        }

        return builder.build();
    }

    private static void showCompletedNotification(Context ctx, boolean success, String title, String message) {
        if (!hasNotificationPermission(ctx)) return;
        ensureChannels(ctx);

        Intent openIntent = new Intent(ctx.getApplicationContext(), MainActivity.class);
        openIntent.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_NEW_TASK);
        PendingIntent openPending = PendingIntent.getActivity(
            ctx.getApplicationContext(),
            5201,
            openIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        NotificationCompat.Builder builder = new NotificationCompat.Builder(ctx, CHANNEL_UPLOAD_COMPLETE)
            .setSmallIcon(R.drawable.ic_stat_upload)
            .setColor(success ? COLOR_EMERALD : COLOR_ROSE)
            .setContentTitle(title)
            .setContentText(message)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(message))
            .setAutoCancel(true)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setContentIntent(openPending);

        try {
            NotificationManagerCompat.from(ctx).notify(COMPLETE_NOTIF_ID, builder.build());
        } catch (SecurityException ignored) {
        }
    }

    private static void checkCancelled(UploadTask task) {
        if (task.cancelled.get() || Thread.currentThread().isInterrupted()) {
            throw new CancellationException("Cancelled");
        }
    }

    private static void writeUtf8(OutputStream out, String text) throws Exception {
        out.write(text.getBytes(StandardCharsets.UTF_8));
    }

    private static String sanitizeHeaderToken(String raw) {
        if (raw == null) return "file";
        return raw.replace("\"", "").replace("\r", "").replace("\n", "");
    }

    private static String readStream(InputStream stream) {
        if (stream == null) return "";
        StringBuilder sb = new StringBuilder();
        try (BufferedReader reader = new BufferedReader(new InputStreamReader(stream, StandardCharsets.UTF_8))) {
            String line;
            while ((line = reader.readLine()) != null) {
                sb.append(line);
            }
        } catch (Exception ignored) {
        }
        return sb.toString();
    }

    private static String extractErrorMessage(String body, int statusCode) {
        if (statusCode == 413) return "APK file is too large for the server limit (max 250 MB).";
        if (statusCode == 401) return "The Render API rejected this admin app's built-in key (HTTP 401).";
        if (statusCode == 502 || statusCode == 503) {
            return "The Hutaotik API is waking up or unavailable (HTTP " + statusCode + "). Try again shortly.";
        }
        try {
            JSONObject obj = new JSONObject(body);
            String err = obj.optString("error", "");
            if (!err.isEmpty()) return err;
        } catch (Exception ignored) {
        }
        return "Upload failed with HTTP " + statusCode + ".";
    }

    private static String formatBytes(long bytes) {
        if (bytes <= 0) return "0 B";
        final String[] units = { "B", "KB", "MB", "GB" };
        double val = bytes;
        int idx = 0;
        while (val >= 1024 && idx < units.length - 1) {
            val /= 1024.0;
            idx += 1;
        }
        return idx == 0
            ? String.format(Locale.US, "%d B", bytes)
            : String.format(Locale.US, val >= 100 ? "%.0f %s" : "%.1f %s", val, units[idx]);
    }

    private static String formatEta(long seconds) {
        if (seconds < 60) return seconds + "s left";
        return (seconds / 60) + "m " + (seconds % 60) + "s left";
    }

    @Override
    public void onCreate() {
        super.onCreate();
        runningService = this;
        ensureChannels(this);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        runningService = this;
        String action = intent != null ? intent.getAction() : ACTION_SYNC;

        if (ACTION_CANCEL.equals(action) && intent != null) {
            String taskId = intent.getStringExtra(EXTRA_TASK_ID);
            if (taskId != null) {
                cancelUpload(this, taskId);
            }
        }

        UploadTask active = firstActiveTask();
        boolean promoted = false;
        try {
            Notification fgNotif = buildProgressNotification(this, active);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                startForeground(FOREGROUND_NOTIF_ID, fgNotif, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC);
            } else {
                startForeground(FOREGROUND_NOTIF_ID, fgNotif);
            }
            promoted = true;
        } catch (Throwable t) {
            Log.w(TAG, "Admin upload FGS promotion blocked on this device; continuing safely.", t);
        }

        if (!promoted || ACTIVE_UPLOADS.isEmpty()) {
            stopForegroundCompat();
            stopSelf();
        }
        return START_NOT_STICKY;
    }

    private void updateNotificationOrStop() {
        UploadTask active = firstActiveTask();
        if (active == null) {
            stopForegroundCompat();
            stopSelf();
            return;
        }
        try {
            NotificationManagerCompat.from(this).notify(
                FOREGROUND_NOTIF_ID,
                buildProgressNotification(this, active)
            );
        } catch (Throwable ignored) {
        }
    }

    private UploadTask firstActiveTask() {
        Iterator<UploadTask> it = ACTIVE_UPLOADS.values().iterator();
        return it.hasNext() ? it.next() : null;
    }

    private void stopForegroundCompat() {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
                stopForeground(STOP_FOREGROUND_REMOVE);
            } else {
                stopForeground(true);
            }
        } catch (Throwable ignored) {
        }
    }

    @Override
    public void onTimeout(int startId) {
        Log.w(TAG, "AdminUploadForegroundService reached system timeout; stopping cleanly.");
        stopForegroundCompat();
        stopSelf(startId);
    }

    @Override
    public void onTimeout(int startId, int fgsType) {
        Log.w(TAG, "AdminUploadForegroundService reached FGS timeout (" + fgsType + "); stopping cleanly.");
        stopForegroundCompat();
        stopSelf(startId);
    }

    @Override
    public void onDestroy() {
        if (runningService == this) runningService = null;
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
