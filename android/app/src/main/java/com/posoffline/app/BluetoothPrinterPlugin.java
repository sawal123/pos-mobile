package com.posoffline.app;

import android.Manifest;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothManager;
import android.bluetooth.BluetoothSocket;
import android.content.Context;
import android.os.Build;
import android.util.Base64;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.io.IOException;
import java.io.OutputStream;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.regex.Pattern;

/**
 * P33: Bluetooth Classic (SPP/RFCOMM) ESC/POS printing for already paired thermal
 * printers. No BLE scanning, no discovery, no network/USB printing, and no socket is
 * kept alive between prints: every print is connect -> write -> flush -> close.
 */
@CapacitorPlugin(
    name = "BluetoothPrinter",
    permissions = {
        @Permission(
            alias = BluetoothPrinterPlugin.BLUETOOTH_CONNECT_ALIAS,
            strings = { Manifest.permission.BLUETOOTH_CONNECT }
        )
    }
)
public class BluetoothPrinterPlugin extends Plugin {

    static final String BLUETOOTH_CONNECT_ALIAS = "bluetoothConnect";

    static final String ERROR_UNSUPPORTED = "BLUETOOTH_UNSUPPORTED";
    static final String ERROR_DISABLED = "BLUETOOTH_DISABLED";
    static final String ERROR_PERMISSION_DENIED = "BLUETOOTH_PERMISSION_DENIED";
    static final String ERROR_NOT_PAIRED = "PRINTER_NOT_PAIRED";
    static final String ERROR_INVALID_ADDRESS = "INVALID_PRINTER_ADDRESS";
    static final String ERROR_CONNECT_TIMEOUT = "PRINTER_CONNECT_TIMEOUT";
    static final String ERROR_CONNECT_FAILED = "PRINTER_CONNECT_FAILED";
    static final String ERROR_WRITE_FAILED = "PRINTER_WRITE_FAILED";

    private static final UUID SPP_UUID = UUID.fromString("00001101-0000-1000-8000-00805F9B34FB");
    private static final long DEFAULT_TIMEOUT_MS = 10000L;
    private static final long MAX_TIMEOUT_MS = 60000L;
    private static final Pattern MAC_ADDRESS = Pattern.compile("^([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}$");

    private final ExecutorService printExecutor = Executors.newSingleThreadExecutor();

    /** Plain value holder so device mapping/sorting can be unit tested without hardware. */
    static final class PairedDevice {
        final String name;
        final String address;

        PairedDevice(String name, String address) {
            this.name = name == null ? "" : name;
            this.address = address == null ? "" : address;
        }
    }

    /** Stable ordering: name first, then address. */
    static List<PairedDevice> normalizeDevices(List<PairedDevice> devices) {
        List<PairedDevice> normalized = new ArrayList<>();

        if (devices != null) {
            for (PairedDevice device : devices) {
                if (device != null && device.address != null && !device.address.isEmpty()) {
                    normalized.add(device);
                }
            }
        }

        Collections.sort(normalized, new Comparator<PairedDevice>() {
            @Override
            public int compare(PairedDevice left, PairedDevice right) {
                int byName = left.name.compareToIgnoreCase(right.name);
                return byName != 0 ? byName : left.address.compareToIgnoreCase(right.address);
            }
        });

        return normalized;
    }

    static boolean isValidAddress(String address) {
        return address != null && MAC_ADDRESS.matcher(address).matches();
    }

    static long normalizeTimeout(Long timeoutMs) {
        if (timeoutMs == null || timeoutMs <= 0) {
            return DEFAULT_TIMEOUT_MS;
        }

        return Math.min(timeoutMs, MAX_TIMEOUT_MS);
    }

    /**
     * Capacitor parses the JSON payload with org.json, which turns an integral JS
     * number into Integer (or Long when it does not fit). PluginCall.getLong() only
     * accepts a Long, so reading the raw value and coercing any Number is required
     * for the JS timeout contract to be honored.
     */
    static long resolveTimeoutMs(Object rawTimeout) {
        if (rawTimeout instanceof Number) {
            return normalizeTimeout(((Number) rawTimeout).longValue());
        }

        return normalizeTimeout(null);
    }

    /** Maps a lower level failure to the plugin error contract. */
    static String mapErrorCode(Throwable error, boolean connected) {
        if (error instanceof TimeoutException) {
            return ERROR_CONNECT_TIMEOUT;
        }

        if (error instanceof SecurityException) {
            return ERROR_PERMISSION_DENIED;
        }

        return connected ? ERROR_WRITE_FAILED : ERROR_CONNECT_FAILED;
    }

    @Override
    public void handleOnDestroy() {
        printExecutor.shutdownNow();
        super.handleOnDestroy();
    }

    @PluginMethod
    public void getBluetoothState(PluginCall call) {
        JSObject result = new JSObject();
        result.put("supported", getBluetoothAdapter() != null);
        result.put("enabled", isBluetoothEnabled());
        result.put("permission", hasBluetoothPermission() ? "granted" : "denied");
        call.resolve(result);
    }

    @PluginMethod
    public void listPairedDevices(PluginCall call) {
        if (getBluetoothAdapter() == null) {
            reject(call, ERROR_UNSUPPORTED);
            return;
        }

        if (!hasBluetoothPermission()) {
            call.getData().put("pendingAction", "list");
            requestPermissionForAlias(BLUETOOTH_CONNECT_ALIAS, call, "bluetoothPermissionCallback");
            return;
        }

        resolvePairedDevices(call);
    }

    @PluginMethod
    public void printRaw(PluginCall call) {
        if (getBluetoothAdapter() == null) {
            reject(call, ERROR_UNSUPPORTED);
            return;
        }

        if (!hasBluetoothPermission()) {
            call.getData().put("pendingAction", "print");
            requestPermissionForAlias(BLUETOOTH_CONNECT_ALIAS, call, "bluetoothPermissionCallback");
            return;
        }

        startPrint(call);
    }

    @PermissionCallback
    private void bluetoothPermissionCallback(PluginCall call) {
        if (!hasBluetoothPermission()) {
            reject(call, ERROR_PERMISSION_DENIED);
            return;
        }

        String action = call.getString("pendingAction", "print");

        if ("list".equals(action)) {
            resolvePairedDevices(call);
            return;
        }

        startPrint(call);
    }

    private void resolvePairedDevices(PluginCall call) {
        if (!isBluetoothEnabled()) {
            reject(call, ERROR_DISABLED);
            return;
        }

        try {
            JSArray devices = new JSArray();

            for (PairedDevice device : normalizeDevices(readBondedDevices())) {
                JSObject entry = new JSObject();
                entry.put("name", device.name);
                entry.put("address", device.address);
                devices.put(entry);
            }

            JSObject result = new JSObject();
            result.put("devices", devices);
            call.resolve(result);
        } catch (SecurityException error) {
            reject(call, ERROR_PERMISSION_DENIED);
        }
    }

    private void startPrint(PluginCall call) {
        if (!isBluetoothEnabled()) {
            reject(call, ERROR_DISABLED);
            return;
        }

        String address = call.getString("address", "");

        if (!isValidAddress(address)) {
            reject(call, ERROR_INVALID_ADDRESS);
            return;
        }

        byte[] payload;

        try {
            payload = Base64.decode(call.getString("dataBase64", ""), Base64.DEFAULT);
        } catch (IllegalArgumentException error) {
            reject(call, ERROR_WRITE_FAILED);
            return;
        }

        if (payload.length == 0) {
            reject(call, ERROR_WRITE_FAILED);
            return;
        }

        final long timeoutMs = resolveTimeoutMs(call.getData().opt("timeoutMs"));
        // One-shot async call: Capacitor releases the call after the single
        // resolve/reject, so no keep-alive, listener, or manual release is used.
        final AtomicBoolean settled = new AtomicBoolean(false);

        printExecutor.execute(() -> {
            BluetoothSocket socket = null;
            boolean connected = false;

            try {
                BluetoothDevice device = findBondedDevice(address);

                if (device == null) {
                    settleReject(call, settled, ERROR_NOT_PAIRED);
                    return;
                }

                socket = openSocket(device, timeoutMs);
                connected = true;

                OutputStream output = socket.getOutputStream();
                output.write(payload);
                output.flush();

                settleResolve(call, settled);
            } catch (Exception error) {
                settleReject(call, settled, mapErrorCode(error, connected));
            } finally {
                closeQuietly(socket);
            }
        });
    }

    private BluetoothSocket openSocket(BluetoothDevice device, long timeoutMs)
        throws IOException, TimeoutException {
        // Primary attempt: secure SPP socket.
        IOException secureError = null;
        BluetoothSocket secureSocket = null;

        try {
            secureSocket = device.createRfcommSocketToServiceRecord(SPP_UUID);
            connectSocket(secureSocket, timeoutMs);
            return secureSocket;
        } catch (TimeoutException error) {
            closeQuietly(secureSocket);
            throw error;
        } catch (IOException error) {
            secureError = error;
            closeQuietly(secureSocket);
        }

        // Single documented fallback: insecure SPP socket.
        BluetoothSocket insecureSocket = null;

        try {
            insecureSocket = device.createInsecureRfcommSocketToServiceRecord(SPP_UUID);
            connectSocket(insecureSocket, timeoutMs);
            return insecureSocket;
        } catch (TimeoutException error) {
            closeQuietly(insecureSocket);
            throw error;
        } catch (IOException error) {
            closeQuietly(insecureSocket);
            throw secureError != null ? secureError : error;
        }
    }

    /** connect() is blocking, so it runs on its own thread and is bounded by a timeout. */
    private void connectSocket(BluetoothSocket socket, long timeoutMs) throws IOException, TimeoutException {
        ExecutorService connector = Executors.newSingleThreadExecutor();
        Future<?> future = connector.submit(() -> {
            try {
                socket.connect();
            } catch (IOException error) {
                throw new RuntimeException(error);
            }
        });

        try {
            future.get(timeoutMs, TimeUnit.MILLISECONDS);
        } catch (TimeoutException error) {
            future.cancel(true);
            closeQuietly(socket);
            throw error;
        } catch (ExecutionException error) {
            Throwable cause = error.getCause();

            if (cause instanceof RuntimeException && cause.getCause() instanceof IOException) {
                throw (IOException) cause.getCause();
            }

            throw new IOException(cause);
        } catch (InterruptedException error) {
            Thread.currentThread().interrupt();
            closeQuietly(socket);
            throw new IOException(error);
        } finally {
            connector.shutdownNow();
        }
    }

    private BluetoothDevice findBondedDevice(String address) {
        BluetoothAdapter adapter = getBluetoothAdapter();

        if (adapter == null) {
            return null;
        }

        Set<BluetoothDevice> bonded = adapter.getBondedDevices();

        if (bonded == null) {
            return null;
        }

        for (BluetoothDevice device : bonded) {
            if (device.getAddress().equalsIgnoreCase(address)) {
                return device;
            }
        }

        return null;
    }

    private List<PairedDevice> readBondedDevices() {
        List<PairedDevice> devices = new ArrayList<>();
        BluetoothAdapter adapter = getBluetoothAdapter();

        if (adapter == null) {
            return devices;
        }

        Set<BluetoothDevice> bonded = adapter.getBondedDevices();

        if (bonded == null) {
            return devices;
        }

        for (BluetoothDevice device : bonded) {
            devices.add(new PairedDevice(device.getName(), device.getAddress()));
        }

        return devices;
    }

    private BluetoothAdapter getBluetoothAdapter() {
        Context context = getContext();

        if (context == null) {
            return null;
        }

        BluetoothManager manager = (BluetoothManager) context.getSystemService(Context.BLUETOOTH_SERVICE);

        return manager == null ? null : manager.getAdapter();
    }

    private boolean isBluetoothEnabled() {
        BluetoothAdapter adapter = getBluetoothAdapter();

        if (adapter == null) {
            return false;
        }

        try {
            return adapter.isEnabled();
        } catch (SecurityException error) {
            return false;
        }
    }

    private boolean hasBluetoothPermission() {
        // BLUETOOTH_CONNECT only exists from Android 12; older releases use install-time
        // BLUETOOTH/BLUETOOTH_ADMIN permissions.
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) {
            return true;
        }

        return getPermissionState(BLUETOOTH_CONNECT_ALIAS) == PermissionState.GRANTED;
    }

    private void settleResolve(PluginCall call, AtomicBoolean settled) {
        if (settled.compareAndSet(false, true)) {
            call.resolve(new JSObject());
        }
    }

    private void settleReject(PluginCall call, AtomicBoolean settled, String code) {
        if (settled.compareAndSet(false, true)) {
            reject(call, code);
        }
    }

    private void reject(PluginCall call, String code) {
        // The code doubles as the message so JS never shows a raw Java exception.
        call.reject(code, code);
    }

    private void closeQuietly(BluetoothSocket socket) {
        if (socket == null) {
            return;
        }

        try {
            socket.close();
        } catch (IOException ignored) {
            // Nothing else to do: the socket is already unusable.
        }
    }
}
