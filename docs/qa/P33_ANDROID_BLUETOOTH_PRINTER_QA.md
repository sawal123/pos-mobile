# P33 — Android Native Bluetooth Thermal Printer (ESC/POS) QA

- Date: 2026-09-16
- Base/main SHA: `c09a3854d72c7bf03a8342d1e6ed5610b480bde3` (PR #32 merge commit)
- Feature SHA: `2b0263b5ac3923f33ff7cd9c6227b6ef1d1d5b3d`
- Lifecycle fix SHA: see the follow-up commit on the same PR (#33)
- Branch: `feat/android-bluetooth-thermal-print`
- Android package: `com.posoffline.app`
- Database: `pos_mobile`, `DB_VERSION = 4` (unchanged, no new migration)

## Implementation summary

- Custom Capacitor plugin `BluetoothPrinter` in `com.posoffline.app` (Bluetooth Classic SPP/RFCOMM, `00001101-0000-1000-8000-00805F9B34FB`).
- **PluginCall one-shot lifecycle**: `printRaw` resolves/rejects exactly once and then lets Capacitor release the call. `setKeepAlive(true)` was removed — there is no listener, no retained `PluginCall`, and no manual `release()`. The single-settlement guarantee is enforced per call by an `AtomicBoolean` guard (`settled.compareAndSet(false, true)`), every rejection goes through one central `reject(call, code)` helper, and the worker never settles the call directly.
- **Exit paths verified**: not-paired → `PRINTER_NOT_PAIRED`; connect success → resolve; connect timeout → `PRINTER_CONNECT_TIMEOUT`; connect `IOException` → `PRINTER_CONNECT_FAILED`; permission revoked mid-worker (`SecurityException` from bonded lookup / `getOutputStream` / `write`) → `BLUETOOTH_PERMISSION_DENIED`; write failure after connect → `PRINTER_WRITE_FAILED`; success → resolve. The socket is closed in `finally` on every path, and all I/O stays on the background executor.
- **Timeout parsing fix**: `PluginCall.getLong()` only returns a value when the underlying JSON number is a `Long`, but Capacitor parses the call payload with org.json (`new JSObject(jsonStr)`), which turns integral JS numbers into `Integer`. `timeoutMs: 5000` was therefore silently ignored and fell back to the 10000 default. The plugin now reads the raw value and coerces any `Number` (`resolveTimeoutMs(call.getData().opt("timeoutMs"))`), so 5000 → 5000, 10000 → 10000, 999999 → capped 60000, and ≤ 0 / missing → default 10000. The JS contract was not changed.
- `listPairedDevices()` returns only bonded devices, sorted by name then address. No discovery, no `BLUETOOTH_SCAN`.
- `printRaw({ address, dataBase64, timeoutMs })` does connect → write → flush → close, with the socket closed in `finally`. No socket is kept between prints.
- I/O runs on a background executor; `BluetoothSocket.connect()` is bounded by a timeout (default 10s, capped 60s) via a watchdog future. `resolve`/`reject` is guarded by an `AtomicBoolean` so a call settles exactly once.
- Secure SPP socket first, with a single documented fallback to `createInsecureRfcommSocketToServiceRecord`. No reflection/channel-1 hack.
- JS layer maps native codes to Indonesian messages; raw Java exceptions are never surfaced.
- Web keeps the existing `window.print()` path; native never silently falls back to browser printing.
- Printer selection is device-local state stored in `app_state` (`printer_state`), excluded from business backup, cloud sync, and the sync queue.

## Automated results

| Check | Result | Detail |
|---|---|---|
| `npm run test:unit -- --run` | BASELINE FAILURE | 36/37 files, 1077/1078 tests PASS. Only `business-template.spec.js` fails. |
| P33 targeted suites | PASS | 101/101 across ESC/POS builder, printer service, native plugin source contract, settings/store/persistence, receipt view printing, and SQLite persistence. |
| Plugin lifecycle static regression | PASS | `bluetooth-printer-plugin-source.spec.js` (7 tests) reads the Java source and fails if `setKeepAlive`/`.release(`/listener usage returns, if the worker settles the call directly, if the socket is not closed in `finally`, if I/O leaves the background executor, or if the timeout falls back to `getLong`. |
| `npm run build` | PASS | Vite production build completed. |
| `npx cap sync android` | PASS | SQLite, App, Network, Secure Storage plugins detected. |
| `android/gradlew.bat assembleDebug` | PASS | `BUILD SUCCESSFUL` for the lifecycle-fix revision as well; APK at `android/app/build/outputs/apk/debug/app-debug.apk`. |
| Java compilation | PASS | `compileDebugJavaWithJavac` succeeded (including after the timeout-parsing and keepAlive changes; earlier compile fixes were holder iteration type and checked-exception narrowing). |
| `git diff --check` | PASS | No whitespace errors. |
| Changed-file ESLint | PASS | No lint errors. |

ESC/POS builder coverage (semantic assertions, not binary snapshots):

- every 58mm line ≤ 32 chars, every 80mm line ≤ 48 chars
- bracketed header (business name, outlet, phone) centered; left alignment restored for the body
- retail: Invoice, Tanggal, Customer, Metode Pembayaran, item name, `qty x price`, line subtotal, Subtotal/Pajak/TOTAL
- retail HPP is never printed
- Laundry: No. Order, Tanggal Masuk, Customer, Nomor HP, Status Order, Status Pembayaran, Estimasi Selesai
- Laundry kg decimals (`2.5 kg x Rp 10.000` → `Rp 25.000`) and pcs integers (`2 pcs x Rp 15.000` → `Rp 30.000`)
- cash receipts print Uang Diterima/Kembalian; QRIS prints neither
- unpaid Laundry prints `Status Pembayaran: BELUM DIBAYAR` and no payment method line
- long product names wrap without being cut off; unsupported Unicode becomes `?` and never crashes
- separator width follows paper width; bytes start with `ESC @`; no cut command is sent; footer feed is 2–4 lines

Service coverage: web calls `window.print()` once and never the plugin; native calls `printRaw` and never `window.print()`; missing printer, permission denied, Bluetooth disabled, connect timeout, write failure, and not-paired are normalized; unknown errors never leak Java text; a double tap cannot start two overlapping prints; paired device list is normalized/sorted.

Persistence coverage: selecting `POS-58 / AA:BB:CC:DD:EE:FF` with 80mm survives `flush` → adapter reopen on both the memory adapter and the native SQLite adapter (mocked native harness); connection/socket state is not persisted.

## Physical device

| Item | Value |
|---|---|
| Device | `475d91cd` (2510ERA8BG) |
| Android | 16 (SDK 36) |
| Install (feature revision) | `adb install -r` (non-destructive; no uninstall, no `pm clear`, no DB wipe) |
| Install (lifecycle fix revision) | NOT RUN — `adb devices` reported no attached device when the follow-up patch was built, so the updated APK was not installed. |

| Check | Status | Notes |
|---|---|---|
| Plugin registration | PASS | Logcat shows `Registering plugin instance: BluetoothPrinter` together with CapacitorCookies, WebView, CapacitorHttp, SystemBars, SecureStorage, CapacitorSQLite, App, Network. |
| App startup | PASS | `App started` with no fatal exception. |
| Permission not requested at startup | PASS | `dumpsys package com.posoffline.app` shows `android.permission.BLUETOOTH_CONNECT: granted=false`; no permission prompt or Bluetooth log at launch. Request happens only from Pilih Printer / Print. |
| Paired printer available | NOT AVAILABLE | `dumpsys bluetooth_manager` reports an empty `Bonded devices:` list on this device. |
| A. Settings → Pilih Printer shows printer | MANUAL REQUIRED | No paired Bluetooth printer on the device. |
| B. Selecting a printer persists | MANUAL REQUIRED | Requires device UI interaction + paired printer. |
| C. Test print outputs a receipt | MANUAL REQUIRED | No physical printer. |
| D. Retail print content | MANUAL REQUIRED | No physical printer (builder output verified by unit tests). |
| E. Laundry print content | MANUAL REQUIRED | No physical printer (builder output verified by unit tests). |
| F. Force close/reopen keeps printer selected | MANUAL REQUIRED | Requires UI selection first. |
| G. Repeated connect-print-close | MANUAL REQUIRED | No physical printer. |

## Logcat findings

Filtered `AndroidRuntime`, `Capacitor`, `BluetoothPrinter`, `BluetoothSocket`, `chromium` after install/launch of the feature revision: no FATAL EXCEPTION, no Bluetooth `SecurityException`, no socket-leak or "socket might closed" noise, no ANR, and no main-thread blocking report. The only Chromium entry observed in earlier sessions was an unrelated sync DNS error from a browser process, not from the app.

The lifecycle-fix revision has no on-device logcat evidence (no device attached at build time); its one-shot call behavior is covered by the static source regression test, the JS/native contract tests, and a successful Java compilation.

## Blockers and verdict

- `PRINT_HARDWARE_MANUAL_REQUIRED`: no paired Bluetooth thermal printer on the connected device, so no hardware print claim is made.
- `FULL_UNIT_SUITE_PREEXISTING_UI_FAILURE`: only `business-template.spec.js` fails, and it fails identically on `main` (`c09a385`) and on this branch with the same error (`Cannot call setValue on an empty DOMWrapper` at `input[aria-label="Nama Toko"]`) → PRE-EXISTING BASELINE, not fixed in P33.
- Android 12+ runtime permission was intentionally left ungranted at startup; granting it and printing must be validated manually on a device with a paired printer.

**Final status: BELUM SELESAI** — plugin, builder, service, persistence, JS/native contract tests, and the Android build pass; physical printer verification remains MANUAL REQUIRED.
