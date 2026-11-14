package app.shike.diet.fixed;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.ContentValues;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Log;
import android.view.Gravity;
import android.view.ViewGroup;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

import java.io.IOException;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

/** Dependency-free native shell with visible startup diagnostics. */
public final class MainActivity extends Activity {
    private static final String START_URL = "file:///android_asset/index.html";
    private static final int REQUEST_CAMERA = 5101;
    private static final int REQUEST_GALLERY = 5102;
    private static final int FOREST = Color.rgb(23, 63, 53);

    private WebView webView;
    private ValueCallback<Uri[]> fileCallback;
    private Uri cameraOutputUri;
    private String startupStage = "创建活动";
    private boolean diagnosticShown;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        if (savedInstanceState != null) {
            String pending = savedInstanceState.getString("cameraOutputUri");
            cameraOutputUri = pending == null ? null : Uri.parse(pending);
        }
        try {
            startupStage = "配置系统窗口";
            configureWindow();

            startupStage = "创建 Android WebView";
            webView = new WebView(this);
            webView.setLayoutParams(new ViewGroup.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT,
                    ViewGroup.LayoutParams.MATCH_PARENT));
            webView.setBackgroundColor(Color.rgb(244, 246, 241));
            setContentView(webView);

            startupStage = "配置 WebView";
            WebSettings settings = webView.getSettings();
            settings.setJavaScriptEnabled(true);
            settings.setDomStorageEnabled(true);
            settings.setDatabaseEnabled(true);
            settings.setAllowContentAccess(true);
            settings.setAllowFileAccess(true);
            settings.setAllowFileAccessFromFileURLs(false);
            settings.setAllowUniversalAccessFromFileURLs(false);
            settings.setLoadsImagesAutomatically(true);
            settings.setMediaPlaybackRequiresUserGesture(true);
            settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
            settings.setBuiltInZoomControls(false);
            settings.setDisplayZoomControls(false);
            settings.setSupportZoom(false);
            settings.setDefaultTextEncodingName("UTF-8");
            settings.setUseWideViewPort(true);
            settings.setLoadWithOverviewMode(true);
            settings.setSupportMultipleWindows(false);
            settings.setJavaScriptCanOpenWindowsAutomatically(false);
            settings.setCacheMode(WebSettings.LOAD_DEFAULT);

            WebView.setWebContentsDebuggingEnabled(false);
            webView.addJavascriptInterface(new ExportBridge(), "ShikeAndroid");
            webView.setWebViewClient(new AppWebViewClient());
            webView.setWebChromeClient(new PhotoChromeClient());

            startupStage = "加载内置 index.html";
            webView.loadUrl(START_URL);
        } catch (Throwable error) {
            Log.e("Shike", "Startup failed at " + startupStage, error);
            showNativeError(startupStage, error);
        }
    }

    /** Use the platform default content-area behavior; avoid edge-to-edge startup APIs. */
    private void configureWindow() {
        getWindow().setStatusBarColor(FOREST);
        getWindow().setNavigationBarColor(Color.WHITE);
        if (Build.VERSION.SDK_INT >= 26) {
            getWindow().getDecorView().setSystemUiVisibility(
                    getWindow().getDecorView().getSystemUiVisibility()
                            | android.view.View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR);
        }
    }

    private final class AppWebViewClient extends WebViewClient {
        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            Uri uri = request.getUrl();
            String scheme = uri.getScheme();
            if ("file".equalsIgnoreCase(scheme)) return false;
            if ("http".equalsIgnoreCase(scheme) || "https".equalsIgnoreCase(scheme)) {
                openExternal(uri);
                return true;
            }
            return true;
        }

        @Override
        public void onReceivedError(WebView view, WebResourceRequest request,
                                    WebResourceError error) {
            if (request.isForMainFrame() && !diagnosticShown) {
                String detail = "错误码 " + error.getErrorCode() + "\n"
                        + error.getDescription() + "\n" + request.getUrl();
                showWebError("内置页面加载失败", detail);
            }
        }

        @Override
        public void onReceivedHttpError(WebView view, WebResourceRequest request,
                                        WebResourceResponse response) {
            if (request.isForMainFrame() && !diagnosticShown) {
                showWebError("内置页面返回 HTTP 错误",
                        response.getStatusCode() + " " + response.getReasonPhrase()
                                + "\n" + request.getUrl());
            }
        }

        @Override
        public void onPageFinished(WebView view, String url) {
            if (diagnosticShown || !START_URL.equals(url)) return;
            view.postDelayed(() -> verifyPageBoot(view), 1400);
        }
    }

    private void verifyPageBoot(WebView view) {
        if (diagnosticShown || view != webView) return;
        String probe = "(function(){try{if(window.__shikeBootOK===true&&document.querySelector('#screen-today'))return 'ready';"
                + "return JSON.stringify({ready:false,title:document.title,"
                + "screen:!!document.querySelector('#screen-today'),errors:window.__shikeErrors||[],"
                + "text:(document.body?document.body.innerText:'').slice(0,300)});"
                + "}catch(e){return 'probe-error:'+String(e&&e.stack||e);}})()";
        try {
            view.evaluateJavascript(probe, result -> {
                if (!diagnosticShown && !"\"ready\"".equals(result)) {
                    showWebError("页面脚本未完成初始化", String.valueOf(result));
                }
            });
        } catch (Throwable error) {
            showWebError("无法读取页面启动状态", Log.getStackTraceString(error));
        }
    }

    private void openExternal(Uri uri) {
        try {
            Intent intent = new Intent(Intent.ACTION_VIEW, uri);
            intent.addCategory(Intent.CATEGORY_BROWSABLE);
            startActivity(intent);
        } catch (ActivityNotFoundException unavailable) {
            Toast.makeText(this, "没有可打开此链接的应用", Toast.LENGTH_SHORT).show();
        }
    }

    private final class PhotoChromeClient extends WebChromeClient {
        @Override
        public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback,
                                         FileChooserParams params) {
            if (fileCallback != null) fileCallback.onReceiveValue(null);
            fileCallback = callback;
            boolean wantsCamera = params != null && params.isCaptureEnabled();
            try {
                if (wantsCamera) launchCamera();
                else launchGallery();
                return true;
            } catch (Exception error) {
                cancelFileCallback();
                Toast.makeText(MainActivity.this,
                        wantsCamera ? "无法打开相机：" + error : "无法打开相册：" + error,
                        Toast.LENGTH_LONG).show();
                return true;
            }
        }

        @Override
        public void onPermissionRequest(android.webkit.PermissionRequest request) {
            request.deny();
        }
    }

    private void launchCamera() throws IOException {
        String name = "SHIKE_" + new SimpleDateFormat("yyyyMMdd_HHmmss", Locale.US)
                .format(new Date()) + ".jpg";
        ContentValues values = new ContentValues();
        values.put(MediaStore.Images.Media.DISPLAY_NAME, name);
        values.put(MediaStore.Images.Media.MIME_TYPE, "image/jpeg");
        values.put(MediaStore.Images.Media.RELATIVE_PATH,
                Environment.DIRECTORY_PICTURES + "/食刻");
        cameraOutputUri = getContentResolver().insert(
                MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values);
        if (cameraOutputUri == null) throw new IOException("无法创建照片输出地址");

        Intent intent = new Intent(MediaStore.ACTION_IMAGE_CAPTURE);
        intent.putExtra(MediaStore.EXTRA_OUTPUT, cameraOutputUri);
        intent.setClipData(ClipData.newRawUri("食刻照片", cameraOutputUri));
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION
                | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
        try {
            startActivityForResult(intent, REQUEST_CAMERA);
        } catch (Exception error) {
            discardCameraOutput();
            throw error;
        }
    }

    private void launchGallery() {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("image/*");
        startActivityForResult(intent, REQUEST_GALLERY);
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode != REQUEST_CAMERA && requestCode != REQUEST_GALLERY) return;
        ValueCallback<Uri[]> callback = fileCallback;
        fileCallback = null;
        if (callback == null) {
            if (requestCode == REQUEST_CAMERA && resultCode != RESULT_OK) discardCameraOutput();
            return;
        }
        if (requestCode == REQUEST_GALLERY) {
            callback.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(resultCode, data));
            return;
        }
        Uri output = cameraOutputUri;
        cameraOutputUri = null;
        if (resultCode == RESULT_OK && output != null) {
            callback.onReceiveValue(new Uri[]{output});
        } else {
            if (output != null) getContentResolver().delete(output, null, null);
            callback.onReceiveValue(null);
        }
    }

    private void discardCameraOutput() {
        if (cameraOutputUri != null) {
            getContentResolver().delete(cameraOutputUri, null, null);
            cameraOutputUri = null;
        }
    }

    private void cancelFileCallback() {
        if (fileCallback != null) {
            fileCallback.onReceiveValue(null);
            fileCallback = null;
        }
        discardCameraOutput();
    }

    private final class ExportBridge {
        @JavascriptInterface
        public boolean saveTextFile(String fileName, String mime, String content) {
            if (fileName == null || mime == null || content == null) return false;
            boolean csv = fileName.endsWith(".csv") && mime.startsWith("text/csv");
            boolean json = fileName.endsWith(".json") && mime.startsWith("application/json");
            if (!csv && !json) return false;
            byte[] bytes = content.getBytes(StandardCharsets.UTF_8);
            if (bytes.length > 20 * 1024 * 1024) return false;

            String clean = fileName.replaceAll("[\\\\/:*?\"<>|]", "_");
            int dot = clean.lastIndexOf('.');
            String base = dot > 0 ? clean.substring(0, dot) : "食刻导出";
            String extension = csv ? ".csv" : ".json";
            String stamp = new SimpleDateFormat("HHmmss", Locale.US).format(new Date());
            String displayName = base + "_" + stamp + extension;

            ContentValues values = new ContentValues();
            values.put(MediaStore.Downloads.DISPLAY_NAME, displayName);
            values.put(MediaStore.Downloads.MIME_TYPE, csv ? "text/csv" : "application/json");
            values.put(MediaStore.Downloads.RELATIVE_PATH,
                    Environment.DIRECTORY_DOWNLOADS + "/食刻");
            values.put(MediaStore.Downloads.IS_PENDING, 1);
            Uri output = getContentResolver().insert(
                    MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
            if (output == null) return false;
            try {
                try (OutputStream stream = getContentResolver().openOutputStream(output, "w")) {
                    if (stream == null) throw new IOException("无法打开导出文件");
                    stream.write(bytes);
                }
                ContentValues done = new ContentValues();
                done.put(MediaStore.Downloads.IS_PENDING, 0);
                getContentResolver().update(output, done, null, null);
                return true;
            } catch (IOException error) {
                getContentResolver().delete(output, null, null);
                return false;
            }
        }
    }

    private String diagnostics(String detail) {
        String webViewVersion = "未知";
        try {
            PackageInfo info = WebView.getCurrentWebViewPackage();
            if (info != null) webViewVersion = info.packageName + " " + info.versionName;
        } catch (Throwable error) {
            webViewVersion = "读取失败：" + error;
        }
        return "食刻 2.0.0\n"
                + "包名：app.shike.diet.fixed\n"
                + "启动地址：" + START_URL + "\n"
                + "启动阶段：" + startupStage + "\n"
                + "Android：" + Build.VERSION.RELEASE + " (API " + Build.VERSION.SDK_INT + ")\n"
                + "设备：" + Build.MANUFACTURER + " " + Build.MODEL + "\n"
                + "WebView：" + webViewVersion + "\n\n"
                + String.valueOf(detail);
    }

    private void showWebError(String title, String detail) {
        diagnosticShown = true;
        String report = diagnostics(title + "\n" + detail);
        String html = "<!doctype html><html lang='zh-CN'><head><meta charset='utf-8'>"
                + "<meta name='viewport' content='width=device-width,initial-scale=1'>"
                + "<title>食刻启动诊断</title></head><body style='font-family:sans-serif;"
                + "background:#f4f6f1;color:#173f35;padding:24px;line-height:1.65'>"
                + "<h2>食刻未能正常打开</h2><p>请复制以下诊断信息并反馈。应用没有继续加载空白页面。</p>"
                + "<pre style='white-space:pre-wrap;word-break:break-word;background:white;"
                + "padding:16px;border-radius:12px;font-size:12px'>" + htmlEscape(report) + "</pre>"
                + "</body></html>";
        try {
            if (webView != null) {
                webView.loadDataWithBaseURL("file:///android_asset/diagnostic.html", html,
                        "text/html", "UTF-8", null);
            } else {
                showNativeError(title, new RuntimeException(detail));
            }
        } catch (Throwable error) {
            showNativeError(title, error);
        }
        Log.e("Shike", report);
    }

    private static String htmlEscape(String value) {
        return value.replace("&", "&amp;").replace("<", "&lt;")
                .replace(">", "&gt;").replace("\"", "&quot;");
    }

    private void showNativeError(String stage, Throwable error) {
        diagnosticShown = true;
        String report = diagnostics(stage + "\n" + Log.getStackTraceString(error));
        try {
            int pad = Math.round(20 * getResources().getDisplayMetrics().density);
            LinearLayout content = new LinearLayout(this);
            content.setOrientation(LinearLayout.VERTICAL);
            content.setPadding(pad, pad, pad, pad);
            content.setBackgroundColor(Color.rgb(244, 246, 241));

            TextView title = new TextView(this);
            title.setText("食刻未能启动");
            title.setTextColor(FOREST);
            title.setTextSize(24);
            title.setGravity(Gravity.START);
            content.addView(title);

            TextView hint = new TextView(this);
            hint.setText("请复制下面的诊断信息并反馈；这次不会只显示空白页。 ");
            hint.setTextColor(FOREST);
            hint.setTextSize(15);
            hint.setPadding(0, pad / 2, 0, pad / 2);
            content.addView(hint);

            TextView details = new TextView(this);
            details.setText(report);
            details.setTextIsSelectable(true);
            details.setTextSize(12);
            details.setTextColor(Color.DKGRAY);
            details.setBackgroundColor(Color.WHITE);
            details.setPadding(pad, pad, pad, pad);
            content.addView(details, new LinearLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

            Button copy = new Button(this);
            copy.setText("复制诊断信息");
            copy.setOnClickListener(v -> {
                ClipboardManager manager = (ClipboardManager) getSystemService(CLIPBOARD_SERVICE);
                manager.setPrimaryClip(ClipData.newPlainText("食刻启动诊断", report));
                Toast.makeText(this, "诊断信息已复制", Toast.LENGTH_SHORT).show();
            });
            content.addView(copy);

            Button retry = new Button(this);
            retry.setText("重试启动");
            retry.setOnClickListener(v -> recreate());
            content.addView(retry);

            ScrollView scroll = new ScrollView(this);
            scroll.addView(content);
            setContentView(scroll);
        } catch (Throwable fatal) {
            Log.e("Shike", "Could not display native diagnostic", fatal);
        }
    }

    @SuppressWarnings("deprecation")
    @Override
    public void onBackPressed() {
        if (diagnosticShown || webView == null) {
            finish();
            return;
        }
        webView.evaluateJavascript(
                "(function(){var d=document.querySelector('dialog[open]');"
                        + "if(d){d.close();return 'handled';}"
                        + "if(typeof state!=='undefined'&&state.screen!=='today'"
                        + "&&typeof goScreen==='function'){goScreen('today');return 'handled';}"
                        + "return 'exit';})()",
                result -> {
                    if ("\"exit\"".equals(result) || result == null) finish();
                });
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        if (cameraOutputUri != null) outState.putString("cameraOutputUri", cameraOutputUri.toString());
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (webView != null) webView.onResume();
    }

    @Override
    protected void onPause() {
        if (webView != null) webView.onPause();
        super.onPause();
    }

    @Override
    protected void onDestroy() {
        cancelFileCallback();
        if (webView != null) {
            webView.removeJavascriptInterface("ShikeAndroid");
            webView.stopLoading();
            webView.setWebChromeClient(null);
            webView.setWebViewClient(null);
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }
}
