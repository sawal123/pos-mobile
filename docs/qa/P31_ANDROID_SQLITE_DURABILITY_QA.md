# P31 — Android SQLite Persistence, App Lifecycle & Recovery QA

- Date: 2026-09-16
- Base/main SHA: `caaea82a9e8acf8ee37fd7765e19c16e62759879` (PR #30 merge commit)
- Branch: `qa/android-sqlite-durability`, PR #31
- Native fail-closed SHA: `04eca18a1deb945daa79724606b7dee45c24bf23`
- Android package: `com.posoffline.app`
- Database: `pos_mobile`, `DB_VERSION = 4`

## Automated results

| Check | Result | Detail |
|---|---|---|
| P31 fail-closed/lifecycle targeted | PASS | 86/86 tests: web memory allowed; native missing plugin/create/init/injected-memory rejected; normal SQLite mounts; fatal storage UI prevents mount; retry reloads; pause flush behavior retained. |
| P31 durability/migration targeted | PASS | Stateful SQLite reopen and v0/v1/v2/v3→v4 regression tests remain green. |
| Full `npm run test:unit -- --run` | BASELINE FAILURE | 31/32 files, 991/992 tests PASS. Only `business-template.spec.js` fails. |
| `npm run build` | PASS | Vite production build completed from final source. |
| `npx cap sync android` | PASS | SQLite, App, Network, and Secure Storage plugins detected and synced. |
| `android/gradlew.bat assembleDebug` | PASS | `BUILD SUCCESSFUL`; `android/app/build/outputs/apk/debug/app-debug.apk`. |
| Changed-file ESLint / diagnostics | PASS | No lint or IDE diagnostics. |

## Native persistence policy

- Web/non-native retains the existing memory adapter behavior.
- Android/iOS native requires an adapter named `sqlite`; injected memory is rejected before initialization.
- Missing `CapacitorSQLite` or SQLite adapter creation failure rejects with `NATIVE_PERSISTENCE_UNAVAILABLE`.
- SQLite open/initialize/migration failure rejects with `NATIVE_PERSISTENCE_INIT_FAILED`.
- Native failures do not create or initialize a memory adapter, do not reset/drop/delete the database, and stop bootstrap before router/runtime/POS mount.
- Fatal native persistence renders `Penyimpanan Lokal Bermasalah`, warns against uninstall/clearing data, and provides `Coba Lagi` via `window.location.reload()`.
- Lifecycle behavior remains: pause = one asynchronous `persistence.flush()`; resume/network = zero flush; rejected flush is caught.

## Baseline comparison

Targeted `src/__tests__/business-template.spec.js` was run on both refs:

| Ref | Result | Error |
|---|---|---|
| main `caaea82` | 8/9, FAIL | `fresh Laundry setup menerapkan template tanpa katalog Cafe`: `Cannot call setValue on an empty DOMWrapper` at `input[aria-label="Nama Toko"]`. |
| PR #31 branch | 8/9, FAIL | Identical test, selector, stack location, and error. |

Classification: `PRE-EXISTING BASELINE`; not fixed in P31.

## Physical Android QA

`adb devices` found exactly one device: `475d91cd` (`device`). Final APK was installed with `adb install -r`; no uninstall, app-data clear, or database wipe was performed.

| Case | Status | Notes |
|---|---|---|
| Existing app update and native launch | PASS | Package launched; `CapacitorSQLite` registered; `pos_mobile` opened at v4 and hydration queries ran. |
| Home pause → relaunch/resume | PASS | Logcat recorded App paused/stopped/restarted/resumed without focused errors. |
| A. Data edit/add → Home → reopen | MANUAL REQUIRED | No automated UI data mutation/visual verification performed. |
| B. Laundry Pay Later → background/reopen remains unpaid | MANUAL REQUIRED | Requires UI verification. |
| C. Settle Laundry CASH → background/reopen remains paid, no duplicate cash | MANUAL REQUIRED | Requires UI verification. |
| D. Order status Masuk → Diproses → background/reopen | MANUAL REQUIRED | Requires UI verification. |
| Fatal-screen behavior on actual SQLite failure | MANUAL REQUIRED | Unit-tested; no destructive/device database failure injection performed. |

## Logcat

Focused `AndroidRuntime`, `Capacitor`, `CapacitorSQLite`, and `chromium` logs were captured after final `install -r` and launch. SQLite plugin registration, `pos_mobile` connection/open, `PRAGMA user_version`, and hydration queries were observed. No SQLite migration error, `no such column`, database lock, JSON parse crash, unhandled promise rejection, or Android fatal exception was found for the app process. One unrelated Chromium sync DNS error from another process was present.

## Blockers and verdict

- `PHYSICAL_BUSINESS_DURABILITY_MANUAL_REQUIRED`: A–D require direct UI/data verification; no PASS claimed.
- `NATIVE_FATAL_SCREEN_DEVICE_INJECTION_MANUAL_REQUIRED`: fail-closed UI is automated-tested but not triggered by corrupting/removing SQLite on-device because destructive injection was prohibited.
- `FULL_UNIT_SUITE_PREEXISTING_UI_FAILURE`: 991/992; identical failure proven on `caaea82` and PR branch.

**Final status: BELUM SELESAI** — native persistence now fails closed with no memory fallback, build/device SQLite startup smoke passes, but business durability scenarios and physical fatal-failure screen remain MANUAL REQUIRED.
