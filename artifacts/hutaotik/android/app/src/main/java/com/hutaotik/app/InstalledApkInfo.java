package com.hutaotik.app;

import android.content.Context;
import android.content.SharedPreferences;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageInfo;
import android.os.Build;
import android.util.Log;

import org.json.JSONException;
import org.json.JSONObject;

import java.io.File;
import java.io.FileInputStream;
import java.io.InputStream;
import java.security.MessageDigest;
import java.util.Locale;

/**
 * Reports the real identity of the APK that is currently installed on this device
 * (PackageManager versionCode/versionName + SHA-256 of base.apk). The SHA-256 lets the
 * update checker recognise "this exact release is already installed" even when the
 * Build number entered in the Admin publisher does not match the APK's own versionCode.
 */
public final class InstalledApkInfo {
    private static final String TAG = "InstalledApkInfo";
    private static final String PREFS_NAME = "hutaotik_installed_apk";
    private static final String KEY_HASH_STAMP = "apk_hash_stamp";
    private static final String KEY_HASH_VALUE = "apk_hash_value";

    private InstalledApkInfo() {}

    public static int getVersionCode(Context context) {
        try {
            PackageInfo info = context.getPackageManager().getPackageInfo(context.getPackageName(), 0);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                return (int) info.getLongVersionCode();
            }
            return info.versionCode;
        } catch (Exception ignored) {
            return 0;
        }
    }

    public static String getVersionName(Context context) {
        try {
            PackageInfo info = context.getPackageManager().getPackageInfo(context.getPackageName(), 0);
            return info.versionName != null ? info.versionName : "";
        } catch (Exception ignored) {
            return "";
        }
    }

    public static long getLastUpdateTime(Context context) {
        try {
            PackageInfo info = context.getPackageManager().getPackageInfo(context.getPackageName(), 0);
            return info.lastUpdateTime;
        } catch (Exception ignored) {
            return 0L;
        }
    }

    /** SHA-256 (lowercase hex) of the installed base.apk, cached until the app is updated again. */
    public static synchronized String getApkSha256(Context context) {
        try {
            ApplicationInfo appInfo = context.getApplicationInfo();
            if (appInfo == null || appInfo.sourceDir == null) return "";
            File apk = new File(appInfo.sourceDir);
            if (!apk.isFile()) return "";

            String stamp = getLastUpdateTime(context) + ":" + getVersionCode(context) + ":" + apk.length();
            SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
            String cachedStamp = prefs.getString(KEY_HASH_STAMP, "");
            String cachedValue = prefs.getString(KEY_HASH_VALUE, "");
            if (stamp.equals(cachedStamp) && cachedValue != null && cachedValue.length() == 64) {
                return cachedValue;
            }

            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] buffer = new byte[256 * 1024];
            try (InputStream in = new FileInputStream(apk)) {
                int read;
                while ((read = in.read(buffer)) != -1) {
                    digest.update(buffer, 0, read);
                }
            }
            StringBuilder hex = new StringBuilder(64);
            for (byte b : digest.digest()) {
                hex.append(String.format(Locale.US, "%02x", b));
            }
            String value = hex.toString();
            prefs.edit().putString(KEY_HASH_STAMP, stamp).putString(KEY_HASH_VALUE, value).apply();
            return value;
        } catch (Throwable e) {
            Log.w(TAG, "Could not hash installed APK", e);
            return "";
        }
    }

    public static String toJson(Context context) {
        JSONObject info = new JSONObject();
        try {
            info.put("versionCode", getVersionCode(context));
            info.put("versionName", getVersionName(context));
            info.put("lastUpdateTime", getLastUpdateTime(context));
            info.put("apkSha256", getApkSha256(context));
        } catch (JSONException ignored) {
        }
        return info.toString();
    }
}
