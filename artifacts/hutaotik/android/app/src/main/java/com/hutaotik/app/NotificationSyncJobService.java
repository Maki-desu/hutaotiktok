package com.hutaotik.app;

import android.app.job.JobInfo;
import android.app.job.JobParameters;
import android.app.job.JobScheduler;
import android.app.job.JobService;
import android.content.ComponentName;
import android.content.Context;
import android.content.SharedPreferences;
import android.content.pm.PackageInfo;
import android.os.Build;
import android.util.Log;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class NotificationSyncJobService extends JobService {
    private static final String TAG = "HutaoNotifSync";
    private static final int JOB_ID = 7401;
    private static final long POLL_INTERVAL_MS = 15L * 60L * 1000L; // 15 min Android minimum
    private static final ExecutorService SYNC_EXECUTOR = Executors.newSingleThreadExecutor();

    public static void schedule(Context context) {
        try {
            Context appContext = context.getApplicationContext();
            JobScheduler scheduler = (JobScheduler) appContext.getSystemService(Context.JOB_SCHEDULER_SERVICE);
            if (scheduler == null) return;

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N && scheduler.getPendingJob(JOB_ID) != null) {
                return;
            }

            ComponentName component = new ComponentName(appContext, NotificationSyncJobService.class);
            JobInfo jobInfo = new JobInfo.Builder(JOB_ID, component)
                .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY)
                .setPeriodic(POLL_INTERVAL_MS)
                .build();

            scheduler.schedule(jobInfo);
        } catch (Throwable e) {
            Log.w(TAG, "Could not schedule background update/announcement sync job.", e);
        }
    }

    public static void checkNowAsync(Context context, boolean allowAnnouncementPopup) {
        try {
            Context appContext = context.getApplicationContext();
            SYNC_EXECUTOR.execute(() -> {
                try {
                    runSync(appContext, allowAnnouncementPopup);
                } catch (Throwable t) {
                    Log.w(TAG, "Background notification check failed safely.", t);
                }
            });
        } catch (Throwable ignored) {
        }
    }

    @Override
    public boolean onStartJob(JobParameters params) {
        Context appContext = getApplicationContext();
        try {
            SYNC_EXECUTOR.execute(() -> {
                try {
                    runSync(appContext, true);
                } catch (Throwable t) {
                    Log.w(TAG, "Scheduled notification sync failed safely.", t);
                } finally {
                    try {
                        jobFinished(params, false);
                    } catch (Throwable ignored) {
                    }
                }
            });
            return true;
        } catch (Throwable t) {
            return false;
        }
    }

    @Override
    public boolean onStopJob(JobParameters params) {
        return true;
    }

    private static void runSync(Context appContext, boolean allowAnnouncementPopup) {
        if (!HutaoNotificationHelper.hasNotificationPermission(appContext)) return;
        String baseUrl = HutaoNotificationHelper.getApiBaseUrl(appContext);

        if (HutaoNotificationHelper.isUpdatesEnabled(appContext)) {
            checkAppUpdates(appContext, baseUrl);
        }
        if (HutaoNotificationHelper.isAnnouncementsEnabled(appContext)) {
            checkAnnouncements(appContext, baseUrl, allowAnnouncementPopup);
        }
    }

    private static void checkAppUpdates(Context appContext, String baseUrl) {
        try {
            int installedVersionCode = getInstalledVersionCode(appContext);
            String body = httpGetString(baseUrl + "/api/app-updates/latest?currentVersionCode=" + installedVersionCode);
            if (body == null || body.isEmpty()) return;

            JSONObject release = new JSONObject(body);
            int latestCode = release.optInt("versionCode", 0);
            String versionName = release.optString("versionName", "");
            String title = release.optString("title", "");
            String changelog = release.optString("changelog", "");

            SharedPreferences prefs = HutaoNotificationHelper.prefs(appContext);
            int lastNotifiedCode = prefs.getInt(HutaoNotificationHelper.KEY_LAST_UPDATE_CODE, 0);

            if (latestCode > installedVersionCode && latestCode > lastNotifiedCode && !versionName.isEmpty()) {
                HutaoNotificationHelper.showUpdateAvailableNotification(
                    appContext,
                    latestCode,
                    versionName,
                    title,
                    changelog
                );
            }
        } catch (Exception e) {
            Log.d(TAG, "Background update check skipped: " + e.getMessage());
        }
    }

    private static void checkAnnouncements(Context appContext, String baseUrl, boolean allowPopup) {
        try {
            String body = httpGetString(baseUrl + "/api/announcements");
            if (body == null || body.isEmpty()) return;

            JSONArray list = new JSONArray(body);
            SharedPreferences prefs = HutaoNotificationHelper.prefs(appContext);
            int lastSeenId = prefs.getInt(HutaoNotificationHelper.KEY_LAST_ANNOUNCEMENT_ID, -1);

            int maxId = lastSeenId;
            JSONObject newestUnseen = null;
            for (int i = 0; i < list.length(); i++) {
                JSONObject item = list.optJSONObject(i);
                if (item == null) continue;
                int id = item.optInt("id", 0);
                if (id > maxId) {
                    maxId = id;
                    newestUnseen = item;
                }
            }

            if (lastSeenId == -1) {
                // First sync on a fresh install: record existing announcements without spamming old ones
                prefs.edit().putInt(HutaoNotificationHelper.KEY_LAST_ANNOUNCEMENT_ID, Math.max(0, maxId)).apply();
                return;
            }

            if (newestUnseen != null && maxId > lastSeenId) {
                prefs.edit().putInt(HutaoNotificationHelper.KEY_LAST_ANNOUNCEMENT_ID, maxId).apply();
                if (allowPopup) {
                    HutaoNotificationHelper.showAnnouncementNotification(
                        appContext,
                        maxId,
                        newestUnseen.optString("colorType", "info"),
                        newestUnseen.optString("content", "")
                    );
                }
            }
        } catch (Exception e) {
            Log.d(TAG, "Background announcement check skipped: " + e.getMessage());
        }
    }

    private static int getInstalledVersionCode(Context context) {
        try {
            PackageInfo info = context.getPackageManager().getPackageInfo(context.getPackageName(), 0);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                return (int) info.getLongVersionCode();
            }
            return info.versionCode;
        } catch (Exception ignored) {
            return 1;
        }
    }

    private static String httpGetString(String urlString) throws Exception {
        HttpURLConnection conn = null;
        try {
            URL url = new URL(urlString);
            if (!"https".equalsIgnoreCase(url.getProtocol())) return null;
            conn = (HttpURLConnection) url.openConnection();
            conn.setConnectTimeout(10_000);
            conn.setReadTimeout(12_000);
            conn.setRequestProperty("Accept", "application/json");
            int code = conn.getResponseCode();
            if (code < 200 || code >= 300) return null;
            StringBuilder sb = new StringBuilder();
            try (BufferedReader reader = new BufferedReader(
                new InputStreamReader(conn.getInputStream(), StandardCharsets.UTF_8)
            )) {
                String line;
                while ((line = reader.readLine()) != null) {
                    sb.append(line);
                }
            }
            return sb.toString();
        } finally {
            if (conn != null) conn.disconnect();
        }
    }
}
