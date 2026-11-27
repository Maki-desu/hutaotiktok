package com.hutaotik.app;

import android.content.ContentValues;
import android.content.Context;
import android.media.MediaScannerConnection;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;

import androidx.documentfile.provider.DocumentFile;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.OutputStream;
import java.util.Locale;

public final class MediaFolderSaver {
    public static final String FOLDER_URI_PREF = "facebook_download_folder_uri";

    private MediaFolderSaver() {}

    public static Uri saveFileToUserFolder(
        Context context,
        File source,
        String filename,
        String folderName,
        String mimeType
    ) throws Exception {
        Context appContext = context.getApplicationContext();
        String safeFilename = (filename != null ? filename : "download")
            .replaceAll("[<>:\"/\\\\|?*\\x00-\\x1f]", " ")
            .trim();
        if (safeFilename.isEmpty() || safeFilename.equals(".") || safeFilename.equals("..")) {
            throw new IllegalArgumentException("Invalid download filename.");
        }
        String safeFolder = (folderName != null ? folderName : "")
            .replaceAll("[<>:\"/\\\\|?*\\x00-\\x1f]", " ")
            .trim();
        if (safeFolder.isEmpty() || safeFolder.equals(".") || safeFolder.equals("..")) {
            safeFolder = "HutaoTik Downloads";
        }
        String resolvedMime = (mimeType != null && !mimeType.trim().isEmpty())
            ? mimeType.trim()
            : inferMimeType(safeFilename);

        String folderUri = appContext.getSharedPreferences("hutaotik", Context.MODE_PRIVATE)
            .getString(FOLDER_URI_PREF, null);

        if (folderUri != null) {
            DocumentFile directory = DocumentFile.fromTreeUri(appContext, Uri.parse(folderUri));
            if (directory != null && directory.exists() && directory.canWrite()) {
                DocumentFile oldFile = directory.findFile(safeFilename);
                if (oldFile != null && !oldFile.delete()) {
                    throw new IllegalStateException("Could not replace the existing download.");
                }
                DocumentFile destination = directory.createFile(resolvedMime, safeFilename);
                if (destination != null) {
                    try {
                        try (OutputStream stream = appContext.getContentResolver().openOutputStream(destination.getUri())) {
                            if (stream == null) throw new IllegalStateException("Could not open the destination file.");
                            copyFile(source, stream);
                        }
                        return destination.getUri();
                    } catch (Exception e) {
                        destination.delete();
                        throw e;
                    }
                }
            } else {
                appContext.getSharedPreferences("hutaotik", Context.MODE_PRIVATE).edit()
                    .remove(FOLDER_URI_PREF)
                    .apply();
            }
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            boolean isVideo = resolvedMime.toLowerCase(Locale.ROOT).startsWith("video/");
            boolean isImage = resolvedMime.toLowerCase(Locale.ROOT).startsWith("image/");
            Uri collection;
            String relativeDir;
            if (isVideo) {
                collection = MediaStore.Video.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY);
                relativeDir = Environment.DIRECTORY_MOVIES + "/" + safeFolder;
            } else if (isImage) {
                collection = MediaStore.Images.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY);
                relativeDir = Environment.DIRECTORY_PICTURES + "/" + safeFolder;
            } else {
                collection = MediaStore.Files.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY);
                relativeDir = Environment.DIRECTORY_DOCUMENTS + "/" + safeFolder;
            }

            ContentValues values = new ContentValues();
            values.put(MediaStore.MediaColumns.DISPLAY_NAME, safeFilename);
            values.put(MediaStore.MediaColumns.MIME_TYPE, resolvedMime);
            values.put(MediaStore.MediaColumns.RELATIVE_PATH, relativeDir);
            values.put(MediaStore.MediaColumns.IS_PENDING, 1);
            Uri destination = appContext.getContentResolver().insert(collection, values);
            if (destination == null) throw new IllegalStateException("Could not create the downloaded file.");
            try {
                try (OutputStream stream = appContext.getContentResolver().openOutputStream(destination)) {
                    if (stream == null) throw new IllegalStateException("Could not open the destination file.");
                    copyFile(source, stream);
                }
                ContentValues completed = new ContentValues();
                completed.put(MediaStore.MediaColumns.IS_PENDING, 0);
                appContext.getContentResolver().update(destination, completed, null, null);
                return destination;
            } catch (Exception e) {
                appContext.getContentResolver().delete(destination, null, null);
                throw e;
            }
        }

        boolean isVideo = resolvedMime.toLowerCase(Locale.ROOT).startsWith("video/");
        boolean isImage = resolvedMime.toLowerCase(Locale.ROOT).startsWith("image/");
        String publicDirType = isVideo
            ? Environment.DIRECTORY_MOVIES
            : (isImage ? Environment.DIRECTORY_PICTURES : Environment.DIRECTORY_DOCUMENTS);
        File baseDir = Environment.getExternalStoragePublicDirectory(publicDirType);
        File directory = new File(baseDir, safeFolder);
        if (!directory.exists() && !directory.mkdirs()) {
            throw new IllegalStateException("Could not create the download folder.");
        }
        File outFile = new File(directory, safeFilename);
        try (OutputStream stream = new FileOutputStream(outFile)) {
            copyFile(source, stream);
        }
        MediaScannerConnection.scanFile(
            appContext,
            new String[] { outFile.getAbsolutePath() },
            new String[] { resolvedMime },
            null
        );
        return null;
    }

    public static String inferMimeType(String filename) {
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

    public static void copyFile(File source, OutputStream destination) throws Exception {
        try (FileInputStream input = new FileInputStream(source)) {
            byte[] buffer = new byte[64 * 1024];
            int count;
            while ((count = input.read(buffer)) != -1) {
                destination.write(buffer, 0, count);
            }
        }
    }
}
