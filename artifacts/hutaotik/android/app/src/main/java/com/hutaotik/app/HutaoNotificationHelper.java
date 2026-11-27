package com.hutaotik.app;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;

import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.ContextCompat;

import org.json.JSONException;
import org.json.JSONObject;

import java.util.Locale;

public final class HutaoNotificationHelper {
    public static final String PREFS_NAME = "hutaotik_notif_prefs";
    public static final String KEY_DOWNLOADS_ENABLED = "notif_downloads_enabled";
    public static final String KEY_UPDATES_ENABLED = "notif_updates_enabled";
    public static final String KEY_ANNOUNCEMENTS_ENABLED = "notif_announcements_enabled";
    public static final String KEY_API_BASE_URL = "api_base_url";
    public static final String KEY_LAST_UPDATE_CODE = "last_notified_update_code";
    public static final String KEY_LAST_ANNOUNCEMENT_ID = "last_notified_announcement_id";
    public static final String DEFAULT_API_BASE_URL = "https://hutaotiktok-mja6.onrender.com";

    public static final String CHANNEL_DOWNLOAD_PROGRESS = "hutaotik_downloads_progress";
    public static final String CHANNEL_DOWNLOAD_COMPLETE = "hutaotik_downloads_complete";
    public static final String CHANNEL_UPDATES = "hutaotik_updates";
    public static final String CHANNEL_ANNOUNCEMENTS = "hutaotik_announcements";

    public static final String EXTRA_ROUTE = "hutaotik_route";

    private static final int COLOR_EMBER = 0xFFF97316;
    private static final int COLOR_EMERALD = 0xFF10B981;
    private static final int COLOR_ROSE = 0xFFF43F5E;
    private static final int COLOR_BLUE = 0xFF3B82F6;

    private HutaoNotificationHelper() {}

    public static void ensureChannels(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        try {
            NotificationManager manager = context.getSystemService(NotificationManager.class);
            if (manager == null) return;

            NotificationChannel progressChannel = new NotificationChannel(
                CHANNEL_DOWNLOAD_PROGRESS,
                "Live Downloads",
                NotificationManager.IMPORTANCE_LOW
            );
            progressChannel.setDescription("Live download progress while videos download in the background");
            progressChannel.setShowBadge(false);
            progressChannel.setSound(null, null);
            progressChannel.enableVibration(false);
            manager.createNotificationChannel(progressChannel);

            NotificationChannel completeChannel = new NotificationChannel(
                CHANNEL_DOWNLOAD_COMPLETE,
                "Completed Downloads",
                NotificationManager.IMPORTANCE_HIGH
            );
            completeChannel.setDescription("Alerts when a video, GIF, or audio download finishes or fails");
            manager.createNotificationChannel(completeChannel);

            NotificationChannel updatesChannel = new NotificationChannel(
                CHANNEL_UPDATES,
                "App Updates",
                NotificationManager.IMPORTANCE_HIGH
            );
            updatesChannel.setDescription("Alerts when a new HutaoTik update is released");
            manager.createNotificationChannel(updatesChannel);

            NotificationChannel announcementsChannel = new NotificationChannel(
                CHANNEL_ANNOUNCEMENTS,
                "Announcements",
                NotificationManager.IMPORTANCE_HIGH
            );
            announcementsChannel.setDescription("Important announcements and news from HutaoTik");
            manager.createNotificationChannel(announcementsChannel);
        } catch (Throwable ignored) {
        }
    }

    public static boolean hasNotificationPermission(Context context) {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                int granted = ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS);
                if (granted != PackageManager.PERMISSION_GRANTED) return false;
            }
            return NotificationManagerCompat.from(context).areNotificationsEnabled();
        } catch (Throwable ignored) {
            return false;
        }
    }

    public static SharedPreferences prefs(Context context) {
        return context.getApplicationContext().getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
    }

    public static boolean isDownloadsEnabled(Context context) {
        return prefs(context).getBoolean(KEY_DOWNLOADS_ENABLED, true);
    }

    public static boolean isUpdatesEnabled(Context context) {
        return prefs(context).getBoolean(KEY_UPDATES_ENABLED, true);
    }

    public static boolean isAnnouncementsEnabled(Context context) {
        return prefs(context).getBoolean(KEY_ANNOUNCEMENTS_ENABLED, true);
    }

    public static String getApiBaseUrl(Context context) {
        String stored = prefs(context).getString(KEY_API_BASE_URL, DEFAULT_API_BASE_URL);
        if (stored == null || stored.trim().isEmpty() || !stored.startsWith("https://")) {
            return DEFAULT_API_BASE_URL;
        }
        String trimmed = stored.trim();
        return trimmed.endsWith("/") ? trimmed.substring(0, trimmed.length() - 1) : trimmed;
    }

    public static void savePreferences(
        Context context,
        boolean downloads,
        boolean updates,
        boolean announcements,
        String apiBaseUrl
    ) {
        SharedPreferences.Editor editor = prefs(context).edit()
            .putBoolean(KEY_DOWNLOADS_ENABLED, downloads)
            .putBoolean(KEY_UPDATES_ENABLED, updates)
            .putBoolean(KEY_ANNOUNCEMENTS_ENABLED, announcements);
        if (apiBaseUrl != null && apiBaseUrl.trim().startsWith("https://")) {
            String trimmed = apiBaseUrl.trim();
            editor.putString(
                KEY_API_BASE_URL,
                trimmed.endsWith("/") ? trimmed.substring(0, trimmed.length() - 1) : trimmed
            );
        }
        editor.apply();
    }

    public static String getStatusJson(Context context) {
        JSONObject obj = new JSONObject();
        try {
            obj.put("granted", hasNotificationPermission(context));
            obj.put("downloads", isDownloadsEnabled(context));
            obj.put("updates", isUpdatesEnabled(context));
            obj.put("announcements", isAnnouncementsEnabled(context));
            obj.put("sdkInt", Build.VERSION.SDK_INT);
        } catch (JSONException ignored) {
        }
        return obj.toString();
    }

    public static PendingIntent buildAppPendingIntent(Context context, String route, int requestCode) {
        Intent intent = new Intent(context.getApplicationContext(), MainActivity.class);
        intent.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_NEW_TASK);
        if (route != null && !route.isEmpty()) {
            intent.putExtra(EXTRA_ROUTE, route);
        }
        return PendingIntent.getActivity(
            context.getApplicationContext(),
            requestCode,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
    }

    public static Notification buildDownloadProgressNotification(
        Context context,
        String taskId,
        String title,
        int percent,
        long loadedBytes,
        long totalBytes,
        long etaSeconds,
        String status,
        int activeCount,
        boolean cancellable
    ) {
        ensureChannels(context);
        int clampedPercent = Math.max(0, Math.min(100, percent));
        boolean indeterminate = clampedPercent <= 1 && loadedBytes <= 0;

        StringBuilder body = new StringBuilder();
        if (status != null && !status.trim().isEmpty()) {
            body.append(status.trim());
        } else {
            body.append("Downloading…");
        }
        if (loadedBytes > 0 && totalBytes > 0) {
            body.append(" · ").append(formatBytes(loadedBytes)).append(" / ").append(formatBytes(totalBytes));
        } else if (loadedBytes > 0) {
            body.append(" · ").append(formatBytes(loadedBytes));
        }
        if (etaSeconds > 0) {
            body.append(" · ").append(formatEta(etaSeconds));
        }
        if (!indeterminate) {
            body.append(" (").append(clampedPercent).append("%)");
        }

        String subText = activeCount > 1
            ? activeCount + " active downloads · Safe to leave app"
            : "Running in background · Safe to leave app";

        NotificationCompat.Builder builder = new NotificationCompat.Builder(context, CHANNEL_DOWNLOAD_PROGRESS)
            .setSmallIcon(R.drawable.ic_stat_download)
            .setColor(COLOR_EMBER)
            .setContentTitle(title != null && !title.trim().isEmpty() ? title.trim() : "Downloading media…")
            .setContentText(body.toString())
            .setSubText(subText)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setSilent(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setCategory(NotificationCompat.CATEGORY_PROGRESS)
            .setProgress(100, clampedPercent, indeterminate)
            .setContentIntent(buildAppPendingIntent(context, "/", 3001));

        if (cancellable && taskId != null && !taskId.isEmpty()) {
            Intent cancelIntent = new Intent(context.getApplicationContext(), DownloadForegroundService.class);
            cancelIntent.setAction(DownloadForegroundService.ACTION_CANCEL);
            cancelIntent.putExtra(DownloadForegroundService.EXTRA_TASK_ID, taskId);
            PendingIntent cancelPending = PendingIntent.getService(
                context.getApplicationContext(),
                Math.abs(taskId.hashCode()) % 50000 + 10000,
                cancelIntent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
            );
            builder.addAction(0, "Cancel", cancelPending);
        }

        return builder.build();
    }

    public static void showDownloadCompleteNotification(
        Context context,
        int notificationId,
        String title,
        String filename,
        String folderName,
        Uri savedUri,
        String mimeType
    ) {
        if (!isDownloadsEnabled(context) || !hasNotificationPermission(context)) return;
        ensureChannels(context);

        String safeName = (filename != null && !filename.trim().isEmpty()) ? filename.trim() : title;
        String safeFolder = (folderName != null && !folderName.trim().isEmpty()) ? folderName.trim() : "HutaoTik Downloads";

        NotificationCompat.Builder builder = new NotificationCompat.Builder(context, CHANNEL_DOWNLOAD_COMPLETE)
            .setSmallIcon(R.drawable.ic_stat_download)
            .setColor(COLOR_EMERALD)
            .setContentTitle("Download Complete")
            .setContentText(safeName + " saved to " + safeFolder)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(safeName + "\nSaved to " + safeFolder))
            .setAutoCancel(true)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_STATUS)
            .setContentIntent(buildAppPendingIntent(context, "/history", notificationId));

        if (savedUri != null && mimeType != null && !mimeType.isEmpty()) {
            Intent viewIntent = new Intent(Intent.ACTION_VIEW);
            viewIntent.setDataAndType(savedUri, mimeType);
            viewIntent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
            PendingIntent openPending = PendingIntent.getActivity(
                context.getApplicationContext(),
                notificationId + 20000,
                viewIntent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
            );
            builder.addAction(0, "Open", openPending);
        }

        try {
            NotificationManagerCompat.from(context).notify(notificationId, builder.build());
        } catch (Throwable ignored) {
        }
    }

    public static void showDownloadFailedNotification(
        Context context,
        int notificationId,
        String title,
        String reason
    ) {
        if (!isDownloadsEnabled(context) || !hasNotificationPermission(context)) return;
        ensureChannels(context);

        String body = (reason != null && !reason.trim().isEmpty())
            ? reason.trim()
            : "Could not complete this download. Tap to retry in HutaoTik.";

        NotificationCompat.Builder builder = new NotificationCompat.Builder(context, CHANNEL_DOWNLOAD_COMPLETE)
            .setSmallIcon(R.drawable.ic_stat_download)
            .setColor(COLOR_ROSE)
            .setContentTitle("Download Failed: " + (title != null ? title : "Media"))
            .setContentText(body)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
            .setAutoCancel(true)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setContentIntent(buildAppPendingIntent(context, "/", notificationId));

        try {
            NotificationManagerCompat.from(context).notify(notificationId, builder.build());
        } catch (Throwable ignored) {
        }
    }

    public static void showUpdateAvailableNotification(
        Context context,
        int versionCode,
        String versionName,
        String title,
        String changelog
    ) {
        if (!isUpdatesEnabled(context) || !hasNotificationPermission(context)) return;
        ensureChannels(context);

        String heading = (title != null && !title.trim().isEmpty())
            ? "HutaoTik v" + versionName + " — " + title.trim()
            : "HutaoTik v" + versionName + " is available!";
        String body = (changelog != null && !changelog.trim().isEmpty())
            ? changelog.trim()
            : "Tap to download and install the newest HutaoTik release.";

        NotificationCompat.Builder builder = new NotificationCompat.Builder(context, CHANNEL_UPDATES)
            .setSmallIcon(R.drawable.ic_stat_update)
            .setColor(COLOR_EMBER)
            .setContentTitle(heading)
            .setContentText(body)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
            .setAutoCancel(true)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_RECOMMENDATION)
            .setContentIntent(buildAppPendingIntent(context, "/updates", 8100 + (versionCode % 500)));

        try {
            NotificationManagerCompat.from(context).notify(8100, builder.build());
            prefs(context).edit().putInt(KEY_LAST_UPDATE_CODE, versionCode).apply();
        } catch (Throwable ignored) {
        }
    }

    public static void showUpdateReadyToInstallNotification(
        Context context,
        Uri apkUri
    ) {
        if (!hasNotificationPermission(context) || apkUri == null) return;
        ensureChannels(context);

        Intent installIntent = new Intent(Intent.ACTION_VIEW);
        installIntent.setDataAndType(apkUri, "application/vnd.android.package-archive");
        installIntent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);

        PendingIntent installPending = PendingIntent.getActivity(
            context.getApplicationContext(),
            8150,
            installIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        NotificationCompat.Builder builder = new NotificationCompat.Builder(context, CHANNEL_UPDATES)
            .setSmallIcon(R.drawable.ic_stat_update)
            .setColor(COLOR_EMERALD)
            .setContentTitle("HutaoTik Update Ready")
            .setContentText("Tap here to install the downloaded HutaoTik APK.")
            .setAutoCancel(true)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setContentIntent(installPending);

        try {
            NotificationManagerCompat.from(context).notify(8150, builder.build());
        } catch (Throwable ignored) {
        }
    }

    public static void showAnnouncementNotification(
        Context context,
        int announcementId,
        String colorType,
        String content
    ) {
        if (!isAnnouncementsEnabled(context) || !hasNotificationPermission(context)) return;
        ensureChannels(context);

        int accentColor = COLOR_EMBER;
        String heading = "HutaoTik Announcement";
        if ("warning".equalsIgnoreCase(colorType)) {
            accentColor = COLOR_ROSE;
            heading = "HutaoTik Notice";
        } else if ("update".equalsIgnoreCase(colorType)) {
            accentColor = COLOR_BLUE;
            heading = "HutaoTik Update News";
        }
        String body = content != null ? content.trim() : "";
        if (body.isEmpty()) return;

        NotificationCompat.Builder builder = new NotificationCompat.Builder(context, CHANNEL_ANNOUNCEMENTS)
            .setSmallIcon(R.drawable.ic_stat_announcement)
            .setColor(accentColor)
            .setContentTitle(heading)
            .setContentText(body)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
            .setAutoCancel(true)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_SOCIAL)
            .setContentIntent(buildAppPendingIntent(context, "/", 8200 + (announcementId % 500)));

        try {
            NotificationManagerCompat.from(context).notify(8200 + (announcementId % 500), builder.build());
        } catch (Throwable ignored) {
        }
    }

    public static boolean showTestNotification(Context context) {
        if (!hasNotificationPermission(context)) return false;
        ensureChannels(context);
        NotificationCompat.Builder builder = new NotificationCompat.Builder(context, CHANNEL_ANNOUNCEMENTS)
            .setSmallIcon(R.drawable.ic_stat_announcement)
            .setColor(COLOR_EMBER)
            .setContentTitle("HutaoTik Notifications Ready!")
            .setContentText("You'll get live download progress, update alerts, and announcements here.")
            .setAutoCancel(true)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setContentIntent(buildAppPendingIntent(context, "/settings", 8999));

        try {
            NotificationManagerCompat.from(context).notify(8999, builder.build());
            return true;
        } catch (Throwable ignored) {
            return false;
        }
    }

    public static String formatBytes(long bytes) {
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
        long mins = seconds / 60;
        long secs = seconds % 60;
        return mins + "m " + secs + "s left";
    }
}
