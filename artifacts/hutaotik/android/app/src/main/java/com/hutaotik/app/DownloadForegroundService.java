package com.hutaotik.app;

import android.app.Notification;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.net.Uri;
import android.os.Build;
import android.os.IBinder;
import android.util.Log;

import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.ContextCompat;

import com.yausername.youtubedl_android.YoutubeDL;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.Iterator;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CancellationException;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;

public class DownloadForegroundService extends Service {
    private static final String TAG = "HutaoBgDownload";

    public static final String ACTION_SYNC_FOREGROUND = "com.hutaotik.app.ACTION_SYNC_FOREGROUND";
    public static final String ACTION_CANCEL = "com.hutaotik.app.ACTION_CANCEL_DOWNLOAD";
    public static final String EXTRA_TASK_ID = "task_id";

    private static final int FOREGROUND_NOTIF_ID = 4100;
    private static final AtomicInteger NEXT_NOTIF_ID = new AtomicInteger(4200);
    private static final ExecutorService WORKER_POOL = Executors.newFixedThreadPool(5);
    private static final ConcurrentHashMap<String, TaskContext> ACTIVE_TASKS = new ConcurrentHashMap<>();
    private static volatile DownloadForegroundService runningService;
    private static volatile ProgressRelay progressRelay;

    public interface ProgressRelay {
        void onProgress(
            String taskId,
            int percent,
            long loadedBytes,
            long totalBytes,
            long etaSeconds,
            String status
        );
    }

    public interface BackgroundWork {
        void run(TaskContext task) throws Exception;
    }

    public static final class SavedDownloadResult {
        public final String filename;
        public final Uri savedUri;
        public final String mimeType;

        public SavedDownloadResult(String filename, Uri savedUri, String mimeType) {
            this.filename = filename;
            this.savedUri = savedUri;
            this.mimeType = mimeType;
        }
    }

    public static final class TaskContext {
        public final Context appContext;
        public final String taskId;
        public final int notificationId;
        public final String title;
        public final String folderName;
        public final boolean cancellable;
        public final boolean isFetch;
        public final AtomicBoolean cancelled = new AtomicBoolean(false);
        private final AtomicBoolean finalized = new AtomicBoolean(false);

        volatile Thread workerThread;
        volatile int lastPercent = 0;
        volatile long lastLoadedBytes = 0;
        volatile long lastTotalBytes = 0;
        volatile long lastEtaSeconds = -1;
        volatile String lastStatus = "Starting download…";
        private volatile long lastNotifPushAt = 0L;
        private volatile int lastNotifPercent = -1;

        TaskContext(Context appContext, String taskId, String title, String folderName, boolean cancellable) {
            this(appContext, taskId, title, folderName, cancellable, false);
        }

        TaskContext(
            Context appContext,
            String taskId,
            String title,
            String folderName,
            boolean cancellable,
            boolean isFetch
        ) {
            this.appContext = appContext;
            this.taskId = taskId;
            this.notificationId = NEXT_NOTIF_ID.getAndIncrement();
            this.title = title;
            this.folderName = folderName;
            this.cancellable = cancellable;
            this.isFetch = isFetch;
            if (isFetch) {
                this.lastStatus = "Fetching video info…";
            }
        }

        public boolean isCancelled() {
            return cancelled.get();
        }

        public void checkCancelled() {
            if (cancelled.get() || Thread.currentThread().isInterrupted()) {
                throw new CancellationException("Download cancelled");
            }
        }

        public void updateProgress(int percent, long loadedBytes, long totalBytes, long etaSeconds, String status) {
            if (finalized.get() || cancelled.get()) return;
            int clamped = Math.max(0, Math.min(100, percent));
            lastPercent = clamped;
            if (loadedBytes > 0) lastLoadedBytes = loadedBytes;
            if (totalBytes > 0) lastTotalBytes = totalBytes;
            lastEtaSeconds = etaSeconds;
            if (status != null && !status.isEmpty()) lastStatus = status;

            ProgressRelay relay = progressRelay;
            if (relay != null) {
                relay.onProgress(taskId, clamped, lastLoadedBytes, lastTotalBytes, etaSeconds, lastStatus);
            }

            long now = System.currentTimeMillis();
            if (now - lastNotifPushAt >= 320 || clamped == 100 || Math.abs(clamped - lastNotifPercent) >= 4) {
                lastNotifPushAt = now;
                lastNotifPercent = clamped;
                refreshNotifications(appContext);
            }
        }

        public void markCompleted(String filename, Uri savedUri, String mimeType) {
            if (!finalized.compareAndSet(false, true)) return;
            ACTIVE_TASKS.remove(taskId);
            cancelSecondaryNotification(appContext, notificationId);
            HutaoNotificationHelper.showDownloadCompleteNotification(
                appContext,
                notificationId,
                title,
                filename,
                folderName,
                savedUri,
                mimeType
            );
            refreshNotifications(appContext);
        }

        public void markFailed(String reason) {
            if (!finalized.compareAndSet(false, true)) return;
            ACTIVE_TASKS.remove(taskId);
            cancelSecondaryNotification(appContext, notificationId);
            if (!cancelled.get()) {
                HutaoNotificationHelper.showDownloadFailedNotification(
                    appContext,
                    notificationId,
                    title,
                    reason
                );
            }
            refreshNotifications(appContext);
        }

        public void markFetchCompleted(String platformLabel, String videoTitle) {
            if (!finalized.compareAndSet(false, true)) return;
            ACTIVE_TASKS.remove(taskId);
            cancelSecondaryNotification(appContext, notificationId);
            HutaoNotificationHelper.showFetchCompleteNotification(
                appContext,
                notificationId,
                platformLabel,
                videoTitle
            );
            refreshNotifications(appContext);
        }

        public void markFetchFailed(String platformLabel, String reason) {
            if (!finalized.compareAndSet(false, true)) return;
            ACTIVE_TASKS.remove(taskId);
            cancelSecondaryNotification(appContext, notificationId);
            if (!cancelled.get()) {
                HutaoNotificationHelper.showFetchFailedNotification(
                    appContext,
                    notificationId,
                    platformLabel,
                    reason
                );
            }
            refreshNotifications(appContext);
        }

        public void markCancelledSilently() {
            if (!finalized.compareAndSet(false, true)) return;
            cancelled.set(true);
            ACTIVE_TASKS.remove(taskId);
            cancelSecondaryNotification(appContext, notificationId);
            refreshNotifications(appContext);
        }
    }

    public static void setProgressRelay(ProgressRelay relay) {
        progressRelay = relay;
    }

    public static TaskContext registerExternalTask(
        Context context,
        String taskId,
        String title,
        String folderName
    ) {
        Context appContext = context.getApplicationContext();
        HutaoNotificationHelper.ensureChannels(appContext);
        TaskContext task = new TaskContext(appContext, taskId, title, folderName, false);
        ACTIVE_TASKS.put(taskId, task);
        requestForegroundSync(appContext);
        return task;
    }

    public static TaskContext getActiveTask(String taskId) {
        return taskId != null ? ACTIVE_TASKS.get(taskId) : null;
    }

    public static void runBackgroundFetchTask(
        Context context,
        String taskId,
        String title,
        String platformLabel,
        boolean cancellable,
        BackgroundWork work,
        Runnable onErrorFallback
    ) {
        Context appContext = context.getApplicationContext();
        HutaoNotificationHelper.ensureChannels(appContext);
        TaskContext task = new TaskContext(appContext, taskId, title, "", cancellable, true);
        ACTIVE_TASKS.put(taskId, task);
        requestForegroundSync(appContext);

        WORKER_POOL.execute(() -> {
            task.workerThread = Thread.currentThread();
            try {
                work.run(task);
            } catch (CancellationException ignored) {
                task.markCancelledSilently();
            } catch (Throwable e) {
                Log.e(TAG, "Background fetch task failed: " + taskId, e);
                task.markFetchFailed(
                    platformLabel,
                    e.getMessage() != null ? e.getMessage() : "Could not fetch video information."
                );
                if (onErrorFallback != null) {
                    try {
                        onErrorFallback.run();
                    } catch (Throwable ignored) {
                    }
                }
            } finally {
                task.workerThread = null;
                if (ACTIVE_TASKS.remove(taskId) != null) {
                    refreshNotifications(appContext);
                }
            }
        });
    }

    public static void runBackgroundTask(
        Context context,
        String taskId,
        String title,
        String folderName,
        boolean cancellable,
        BackgroundWork work,
        Runnable onErrorFallback
    ) {
        Context appContext = context.getApplicationContext();
        HutaoNotificationHelper.ensureChannels(appContext);
        TaskContext task = new TaskContext(appContext, taskId, title, folderName, cancellable);
        ACTIVE_TASKS.put(taskId, task);
        requestForegroundSync(appContext);

        WORKER_POOL.execute(() -> {
            task.workerThread = Thread.currentThread();
            try {
                work.run(task);
            } catch (CancellationException ignored) {
                task.markCancelledSilently();
            } catch (Throwable e) {
                Log.e(TAG, "Background task failed: " + taskId, e);
                task.markFailed(e.getMessage() != null ? e.getMessage() : "Download failed on device.");
                if (onErrorFallback != null) {
                    try {
                        onErrorFallback.run();
                    } catch (Throwable ignored) {
                    }
                }
            } finally {
                task.workerThread = null;
                if (ACTIVE_TASKS.remove(taskId) != null) {
                    refreshNotifications(appContext);
                }
            }
        });
    }

    public static SavedDownloadResult downloadDirectUrlToFolder(
        Context appContext,
        TaskContext task,
        String rawUrl,
        String filename,
        String folderName,
        String mimeType
    ) throws Exception {
        if (rawUrl == null || !rawUrl.startsWith("https://")) {
            throw new IllegalArgumentException("Only HTTPS download URLs are supported.");
        }

        File bgDir = new File(appContext.getCacheDir(), "social-downloads");
        if (!bgDir.exists() && !bgDir.mkdirs()) {
            throw new IllegalStateException("Could not create temporary download folder.");
        }
        String ext = "bin";
        int dot = filename != null ? filename.lastIndexOf('.') : -1;
        if (dot > 0 && dot < filename.length() - 1) {
            String candidate = filename.substring(dot + 1).replaceAll("[^a-zA-Z0-9]", "");
            if (!candidate.isEmpty()) ext = candidate;
        }
        File tempFile = new File(bgDir, "bg_" + UUID.randomUUID() + "." + ext);

        HttpURLConnection conn = null;
        try {
            task.updateProgress(2, 0, 0, -1, "Connecting…");
            String currentUrl = rawUrl;
            int redirects = 0;
            while (redirects < 6) {
                task.checkCancelled();
                URL parsed = new URL(currentUrl);
                if (!"https".equalsIgnoreCase(parsed.getProtocol())) {
                    throw new IllegalArgumentException("Insecure redirect blocked.");
                }
                conn = (HttpURLConnection) parsed.openConnection();
                conn.setInstanceFollowRedirects(false);
                conn.setConnectTimeout(30_000);
                conn.setReadTimeout(60_000);
                conn.setRequestProperty(
                    "User-Agent",
                    "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36"
                );
                conn.setRequestProperty("Accept", "*/*");
                int code = conn.getResponseCode();
                if (code == HttpURLConnection.HTTP_MOVED_PERM ||
                    code == HttpURLConnection.HTTP_MOVED_TEMP ||
                    code == HttpURLConnection.HTTP_SEE_OTHER ||
                    code == 307 || code == 308) {
                    String nextLocation = conn.getHeaderField("Location");
                    conn.disconnect();
                    if (nextLocation == null || nextLocation.trim().isEmpty()) {
                        throw new IllegalStateException("Download server sent an empty redirect.");
                    }
                    currentUrl = new URL(parsed, nextLocation).toString();
                    redirects += 1;
                    continue;
                }
                if (code < 200 || code >= 300) {
                    throw new IllegalStateException("Download failed (HTTP " + code + ").");
                }
                break;
            }
            if (conn == null) throw new IllegalStateException("Could not open download connection.");

            String responseContentType = conn.getContentType() != null ? conn.getContentType().toLowerCase() : "";
            if (responseContentType.contains("text/html") || responseContentType.contains("application/json")) {
                throw new IllegalStateException("Server returned an error page instead of media.");
            }

            long totalBytes = Build.VERSION.SDK_INT >= Build.VERSION_CODES.N
                ? conn.getContentLengthLong()
                : conn.getContentLength();
            long loadedBytes = 0L;
            long startedAt = System.currentTimeMillis();

            try (InputStream in = conn.getInputStream();
                 FileOutputStream out = new FileOutputStream(tempFile)) {
                byte[] buffer = new byte[32 * 1024];
                int read;
                while ((read = in.read(buffer)) != -1) {
                    task.checkCancelled();
                    out.write(buffer, 0, read);
                    loadedBytes += read;
                    int percent;
                    long etaSec = -1;
                    if (totalBytes > 0) {
                        percent = 2 + (int) Math.min(88, Math.round((loadedBytes * 88.0) / totalBytes));
                        long elapsedMs = Math.max(1L, System.currentTimeMillis() - startedAt);
                        if (loadedBytes > 64 * 1024 && elapsedMs > 500) {
                            double bytesPerSec = (loadedBytes * 1000.0) / elapsedMs;
                            if (bytesPerSec > 100) {
                                etaSec = Math.max(1L, Math.round((totalBytes - loadedBytes) / bytesPerSec));
                            }
                        }
                    } else {
                        double pseudo = 1.0 - Math.exp(-loadedBytes / (4.0 * 1024.0 * 1024.0));
                        percent = 2 + (int) Math.min(85, Math.round(pseudo * 85.0));
                    }
                    task.updateProgress(percent, loadedBytes, totalBytes > 0 ? totalBytes : 0, etaSec, "Downloading…");
                }
            }

            task.checkCancelled();
            if (!tempFile.exists() || tempFile.length() <= 0) {
                throw new IllegalStateException("Downloaded file was empty.");
            }

            task.updateProgress(93, loadedBytes, totalBytes > 0 ? totalBytes : loadedBytes, -1, "Saving to device folder…");
            String resolvedMime = (mimeType != null && !mimeType.trim().isEmpty())
                ? mimeType.trim()
                : MediaFolderSaver.inferMimeType(filename);
            Uri savedUri = MediaFolderSaver.saveFileToUserFolder(appContext, tempFile, filename, folderName, resolvedMime);
            task.updateProgress(100, tempFile.length(), tempFile.length(), -1, "Saved to device folder");
            return new SavedDownloadResult(filename, savedUri, resolvedMime);
        } finally {
            if (conn != null) conn.disconnect();
            if (tempFile.exists()) tempFile.delete();
        }
    }

    private static void requestForegroundSync(Context appContext) {
        Intent intent = new Intent(appContext, DownloadForegroundService.class);
        intent.setAction(ACTION_SYNC_FOREGROUND);
        try {
            ContextCompat.startForegroundService(appContext, intent);
        } catch (Throwable e) {
            Log.w(TAG, "Could not promote foreground service; falling back to standard notification.", e);
            refreshNotifications(appContext);
        }
    }

    private static void cancelSecondaryNotification(Context appContext, int notifId) {
        if (notifId != FOREGROUND_NOTIF_ID) {
            try {
                NotificationManagerCompat.from(appContext).cancel(notifId);
            } catch (Throwable ignored) {
            }
        }
    }

    private static void refreshNotifications(Context appContext) {
        DownloadForegroundService service = runningService;
        if (service != null) {
            service.updateForegroundNotificationState();
            return;
        }
        // Fallback if service isn't bound/started yet
        if (ACTIVE_TASKS.isEmpty()) return;
        if (!HutaoNotificationHelper.isDownloadsEnabled(appContext) ||
            !HutaoNotificationHelper.hasNotificationPermission(appContext)) {
            return;
        }
        try {
            TaskContext primary = ACTIVE_TASKS.values().iterator().next();
            Notification notif = HutaoNotificationHelper.buildDownloadProgressNotification(
                appContext,
                primary.taskId,
                primary.title,
                primary.lastPercent,
                primary.lastLoadedBytes,
                primary.lastTotalBytes,
                primary.lastEtaSeconds,
                primary.lastStatus,
                ACTIVE_TASKS.size(),
                primary.cancellable,
                primary.isFetch
            );
            NotificationManagerCompat.from(appContext).notify(FOREGROUND_NOTIF_ID, notif);
        } catch (Throwable ignored) {
        }
    }

    @Override
    public void onCreate() {
        super.onCreate();
        runningService = this;
        HutaoNotificationHelper.ensureChannels(this);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        runningService = this;
        String action = intent != null ? intent.getAction() : ACTION_SYNC_FOREGROUND;

        if (ACTION_CANCEL.equals(action) && intent != null) {
            String taskId = intent.getStringExtra(EXTRA_TASK_ID);
            if (taskId != null) {
                cancelTaskById(taskId);
            }
        }

        // Android 12+ requires calling startForeground before stopping when started via startForegroundService
        TaskContext primary = firstActiveTask();
        Notification fgNotification = primary != null
            ? HutaoNotificationHelper.buildDownloadProgressNotification(
                this,
                primary.taskId,
                primary.title,
                primary.lastPercent,
                primary.lastLoadedBytes,
                primary.lastTotalBytes,
                primary.lastEtaSeconds,
                primary.lastStatus,
                ACTIVE_TASKS.size(),
                primary.cancellable,
                primary.isFetch
            )
            : HutaoNotificationHelper.buildDownloadProgressNotification(
                this,
                "",
                "Preparing HutaoTik task…",
                0,
                0,
                0,
                -1,
                "Starting…",
                0,
                false,
                false
            );

        boolean promoted = startForegroundCompat(FOREGROUND_NOTIF_ID, fgNotification);

        if (!promoted || ACTIVE_TASKS.isEmpty()) {
            stopForegroundCompat();
            stopSelf();
        } else {
            notifySecondaryTasks(primary);
        }

        return START_NOT_STICKY;
    }

    private void cancelTaskById(String taskId) {
        TaskContext task = ACTIVE_TASKS.get(taskId);
        if (task == null) return;
        task.cancelled.set(true);
        Thread worker = task.workerThread;
        if (worker != null) {
            worker.interrupt();
        }
        try {
            YoutubeDL.getInstance().destroyProcessById(taskId);
        } catch (Throwable ignored) {
        }
        task.markCancelledSilently();
    }

    private void updateForegroundNotificationState() {
        TaskContext primary = firstActiveTask();
        if (primary == null) {
            stopForegroundCompat();
            stopSelf();
            return;
        }
        try {
            Notification fgNotification = HutaoNotificationHelper.buildDownloadProgressNotification(
                this,
                primary.taskId,
                primary.title,
                primary.lastPercent,
                primary.lastLoadedBytes,
                primary.lastTotalBytes,
                primary.lastEtaSeconds,
                primary.lastStatus,
                ACTIVE_TASKS.size(),
                primary.cancellable,
                primary.isFetch
            );
            NotificationManagerCompat.from(this).notify(FOREGROUND_NOTIF_ID, fgNotification);
        } catch (Throwable ignored) {
        }
        notifySecondaryTasks(primary);
    }

    private void notifySecondaryTasks(TaskContext primary) {
        if (!HutaoNotificationHelper.isDownloadsEnabled(this) ||
            !HutaoNotificationHelper.hasNotificationPermission(this)) {
            return;
        }
        int count = ACTIVE_TASKS.size();
        for (Map.Entry<String, TaskContext> entry : ACTIVE_TASKS.entrySet()) {
            TaskContext task = entry.getValue();
            if (task == primary) continue;
            try {
                Notification notif = HutaoNotificationHelper.buildDownloadProgressNotification(
                    this,
                    task.taskId,
                    task.title,
                    task.lastPercent,
                    task.lastLoadedBytes,
                    task.lastTotalBytes,
                    task.lastEtaSeconds,
                    task.lastStatus,
                    count,
                    task.cancellable,
                    task.isFetch
                );
                NotificationManagerCompat.from(this).notify(task.notificationId, notif);
            } catch (Throwable ignored) {
            }
        }
    }

    private TaskContext firstActiveTask() {
        Iterator<TaskContext> it = ACTIVE_TASKS.values().iterator();
        return it.hasNext() ? it.next() : null;
    }

    private boolean startForegroundCompat(int id, Notification notification) {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                startForeground(id, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC);
            } else {
                startForeground(id, notification);
            }
            return true;
        } catch (Throwable t) {
            Log.w(TAG, "Foreground service promotion blocked on this device; continuing safely.", t);
            return false;
        }
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
        Log.w(TAG, "DownloadForegroundService reached system timeout; stopping cleanly.");
        stopForegroundCompat();
        stopSelf(startId);
    }

    @Override
    public void onTimeout(int startId, int fgsType) {
        Log.w(TAG, "DownloadForegroundService reached FGS timeout (" + fgsType + "); stopping cleanly.");
        stopForegroundCompat();
        stopSelf(startId);
    }

    @Override
    public void onDestroy() {
        if (runningService == this) {
            runningService = null;
        }
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
