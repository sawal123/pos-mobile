package com.netkasir.app;

import android.content.SharedPreferences;
import android.content.pm.PackageInfo;
import android.os.Bundle;
import android.webkit.WebView;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Custom plugins must be registered before the bridge is created in super.onCreate().
        registerPlugin(BluetoothPrinterPlugin.class);
        registerPlugin(GoogleNativeAuthPlugin.class);

        super.onCreate(savedInstanceState);

        // Invalidate WebView cache when updating APK so new JS/CSS is immediately loaded without uninstalling
        try {
            PackageInfo pInfo = getPackageManager().getPackageInfo(getPackageName(), 0);
            int currentVersionCode = pInfo.versionCode;
            SharedPreferences prefs = getSharedPreferences("app_version_cache", MODE_PRIVATE);
            int lastVersionCode = prefs.getInt("last_version_code", -1);
            if (lastVersionCode != currentVersionCode) {
                WebView webView = getBridge() != null ? getBridge().getWebView() : null;
                if (webView != null) {
                    webView.clearCache(true);
                }
                prefs.edit().putInt("last_version_code", currentVersionCode).apply();
            }
        } catch (Exception ignored) {
        }
    }
}
