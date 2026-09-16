package com.posoffline.app;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Custom plugins must be registered before the bridge is created in super.onCreate().
        registerPlugin(BluetoothPrinterPlugin.class);

        super.onCreate(savedInstanceState);
    }
}
