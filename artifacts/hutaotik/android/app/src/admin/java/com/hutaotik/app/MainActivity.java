package com.hutaotik.app;

import android.Manifest;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.OpenableColumns;
import android.provider.Settings;
import android.util.Log;
import android.webkit.JavascriptInterface;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebSettings;
import android.webkit.WebView;

import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.WebViewListener;

import org.json.JSONException;
import org.json.JSONObject;

import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

public class MainActivity extends BridgeActivity {
    private static final String TAG = "HutaotikAdmin";
    private static final int REQUEST_CODE_PICK_APK = 9401;
    private static final int REQUEST_CODE_NOTIFICATIONS = 9402;

    private static volatile MainActivity activeInstance;
    private static final Map<String, PickedApkInfo> PICKED_APKS = new ConcurrentHashMap<>();

    private static final class PickedApkInfo {
        final Uri uri;
        final String name;
        final long size;

        PickedApkInfo(Uri uri, String name, long size) {
            this.uri = uri;
            this.name = name;
            this.size = size;
        }
    }

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        activeInstance = this;
        AdminUploadForegroundService.ensureChannels(this);

        AdminUploadForegroundService.setUploadRelay(new AdminUploadForegroundService.UploadRelay() {
            @Override
            public void onProgress(
                String requestId,
                int percent,
                long loadedBytes,
                long totalBytes,
                long etaSeconds,
                String stage
            ) {
                MainActivity act = activeInstance;
                if (act != null) {
                    act.emitUploadProgress(requestId, percent, loadedBytes, totalBytes, etaSeconds, stage);
                }
            }

            @Override
            public void onFinished(String requestId, int statusCode, String responseJson, String errorMessage) {
                MainActivity act = activeInstance;
                if (act != null) {
                    act.emitUploadFinished(requestId, statusCode, responseJson, errorMessage);
                }
            }
        });

        Bridge capBridge = getBridge();
        WebView webView = capBridge != null ? capBridge.getWebView() : null;
        if (webView != null) {
            try {
                WebSettings settings = webView.getSettings();
                if (settings != null) settings.setTextZoom(100);
            } catch (Throwable ignored) {
            }
            try {
                webView.addJavascriptInterface(new AdminBridge(), "AndroidAdminBridge");
            } catch (Throwable t) {
                Log.e(TAG, "Failed to attach AndroidAdminBridge.", t);
            }
        }
        if (capBridge != null) {
            capBridge.addWebViewListener(new WebViewListener() {
                @Override
                public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
                    Log.e(TAG, "Admin WebView render process gone; attempting safe recreate.");
                    runOnUiThread(() -> {
                        if (!isFinishing() && !isDestroyed()) {
                            try {
                                recreate();
                            } catch (Throwable ignored) {
                            }
                        }
                    });
                    return true;
                }
            });
        }
    }

    @Override
    public void onDestroy() {
        if (activeInstance == this) {
            activeInstance = null;
        }
        super.onDestroy();
    }

    private WebView getSafeWebView() {
        MainActivity act = activeInstance != null ? activeInstance : this;
        try {
            return act.getBridge() != null ? act.getBridge().getWebView() : null;
        } catch (Exception ignored) {
            return null;
        }
    }

    private void emitUploadProgress(
        String requestId,
        int percent,
        long loadedBytes,
        long totalBytes,
        long etaSeconds,
        String stage
    ) {
        WebView webView = getSafeWebView();
        if (webView == null) return;
        JSONObject payload = new JSONObject();
        try {
            payload.put("percent", percent);
            if (loadedBytes > 0) payload.put("loadedBytes", loadedBytes);
            if (totalBytes > 0) payload.put("totalBytes", totalBytes);
            if (etaSeconds > 0) payload.put("etaSeconds", etaSeconds);
            if (stage != null) payload.put("stage", stage);
        } catch (JSONException ignored) {
            return;
        }
        String script = "window.onAdminUploadProgress && window.onAdminUploadProgress(" +
            JSONObject.quote(requestId) + "," + JSONObject.quote(payload.toString()) + ");";
        webView.post(() -> webView.evaluateJavascript(script, null));
    }

    private void emitUploadFinished(String requestId, int statusCode, String responseBody, String errorMessage) {
        WebView webView = getSafeWebView();
        if (webView == null) return;
        JSONObject payload = new JSONObject();
        try {
            payload.put("status", statusCode);
            payload.put("body", responseBody != null ? responseBody : "");
            payload.put("error", errorMessage != null ? errorMessage : "");
        } catch (JSONException ignored) {
            return;
        }
        String script = "window.onAdminUploadResult && window.onAdminUploadResult(" +
            JSONObject.quote(requestId) + "," + JSONObject.quote(payload.toString()) + ");";
        webView.post(() -> webView.evaluateJavascript(script, null));
    }

    public class AdminBridge {
        @JavascriptInterface
        public void pickApkFile() {
            runOnUiThread(() -> {
                try {
                    Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
                    intent.addCategory(Intent.CATEGORY_OPENABLE);
                    intent.setType("*/*");
                    intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                    startActivityForResult(intent, REQUEST_CODE_PICK_APK);
                } catch (Exception e) {
                    Log.e(TAG, "Could not launch APK file picker", e);
                    sendPickedApkError("Could not open Android file picker.");
                }
            });
        }

        @JavascriptInterface
        public void uploadApkReleaseInBackground(
            String endpointUrl,
            String headersJson,
            String fieldsJson,
            String pickId,
            String requestId
        ) {
            PickedApkInfo info = pickId != null ? PICKED_APKS.get(pickId) : null;
            if (info == null) {
                emitUploadFinished(requestId, 0, "{}", "Selected APK file is no longer available. Please pick it again.");
                return;
            }
            AdminUploadForegroundService.startApkUpload(
                getApplicationContext(),
                endpointUrl,
                headersJson,
                fieldsJson,
                info.uri,
                info.name,
                requestId
            );
        }

        @JavascriptInterface
        public void cancelApkUpload(String requestId) {
            AdminUploadForegroundService.cancelUpload(getApplicationContext(), requestId);
        }

        @JavascriptInterface
        public void discardPickedApk(String pickId) {
            if (pickId != null) PICKED_APKS.remove(pickId);
        }

        @JavascriptInterface
        public String consumePendingUploadResult() {
            return AdminUploadForegroundService.consumePendingResult(getApplicationContext());
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
                        Log.e(TAG, "Could not launch external URL activity", err);
                    }
                });
                return true;
            } catch (Throwable e) {
                Log.e(TAG, "Could not open external URL", e);
                return false;
            }
        }

        @JavascriptInterface
        public boolean hasNotificationPermission() {
            return AdminUploadForegroundService.hasNotificationPermission(MainActivity.this);
        }

        @JavascriptInterface
        public String requestNotificationPermission() {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                if (ContextCompat.checkSelfPermission(MainActivity.this, Manifest.permission.POST_NOTIFICATIONS)
                    == PackageManager.PERMISSION_GRANTED) {
                    return "granted";
                }
                runOnUiThread(() -> ActivityCompat.requestPermissions(
                    MainActivity.this,
                    new String[] { Manifest.permission.POST_NOTIFICATIONS },
                    REQUEST_CODE_NOTIFICATIONS
                ));
                return "prompted";
            }
            return AdminUploadForegroundService.hasNotificationPermission(MainActivity.this) ? "granted" : "denied";
        }

        @JavascriptInterface
        public void openNotificationSettings() {
            runOnUiThread(() -> {
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
                } catch (Exception ignored) {
                }
            });
        }
    }

    private void sendPickedApkError(String message) {
        WebView webView = getSafeWebView();
        if (webView == null) return;
        JSONObject payload = new JSONObject();
        try {
            payload.put("error", message);
        } catch (JSONException ignored) {
            return;
        }
        String script = "window.onAdminApkPicked && window.onAdminApkPicked(" +
            JSONObject.quote(payload.toString()) + ");";
        webView.post(() -> webView.evaluateJavascript(script, null));
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == REQUEST_CODE_PICK_APK) {
            WebView webView = getSafeWebView();
            if (webView == null) return;
            JSONObject payload = new JSONObject();
            try {
                if (resultCode == RESULT_OK && data != null && data.getData() != null) {
                    Uri uri = data.getData();
                    String name = "hutaotik.apk";
                    long size = 0L;
                    try (Cursor cursor = getContentResolver().query(uri, null, null, null, null)) {
                        if (cursor != null && cursor.moveToFirst()) {
                            int nameIdx = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                            int sizeIdx = cursor.getColumnIndex(OpenableColumns.SIZE);
                            if (nameIdx >= 0) {
                                String n = cursor.getString(nameIdx);
                                if (n != null && !n.trim().isEmpty()) name = n.trim();
                            }
                            if (sizeIdx >= 0 && !cursor.isNull(sizeIdx)) {
                                size = cursor.getLong(sizeIdx);
                            }
                        }
                    } catch (Exception ignored) {
                    }

                    if (!name.toLowerCase().endsWith(".apk")) {
                        payload.put("error", "Please pick an Android .apk file (selected: " + name + ").");
                    } else {
                        String pickId = "apk-" + UUID.randomUUID();
                        PICKED_APKS.clear();
                        PICKED_APKS.put(pickId, new PickedApkInfo(uri, name, size));
                        payload.put("pickId", pickId);
                        payload.put("name", name);
                        payload.put("size", size);
                    }
                } else {
                    payload.put("cancelled", true);
                }
            } catch (JSONException ignored) {
                return;
            }
            String script = "window.onAdminApkPicked && window.onAdminApkPicked(" +
                JSONObject.quote(payload.toString()) + ");";
            webView.post(() -> webView.evaluateJavascript(script, null));
        }
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == REQUEST_CODE_NOTIFICATIONS) {
            boolean granted = grantResults != null &&
                grantResults.length > 0 &&
                grantResults[0] == PackageManager.PERMISSION_GRANTED;
            WebView webView = getSafeWebView();
            if (webView != null) {
                String script = "window.onAdminNotificationPermission && window.onAdminNotificationPermission(" +
                    (granted ? "true" : "false") + ");";
                webView.post(() -> webView.evaluateJavascript(script, null));
            }
        }
    }
}
