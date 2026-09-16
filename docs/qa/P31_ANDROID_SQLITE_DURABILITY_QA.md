# P31 — Android SQLite Persistence, App Lifecycle & Recovery QA

- Date: 2026-09-16
- Base/main SHA: `caaea82a9e8acf8ee37fd7765e19c16e62759879` (PR #30 merge commit)
- Implementation SHA: `6a86e2167f171653e74fb04885b13e72796d0193`
- Branch: `qa/android-sqlite-durability`
- Android package: `com.posoffline.app`
- Database: `pos_mobile`, `DB_VERSION = 4`

## Automated results

| Check | Result | Detail |
|---|---|---|
| P31 targeted tests | PASS | 3 files, 113/113 tests: SQLite persistence/reopen, lifecycle flush, migration/fallback |
| Full `npm run test:unit -- --run` | FAIL | 31/32 files and 986/987 tests PASS; repeated twice. Existing out-of-scope `business-template.spec.js` test `fresh Laundry setup menerapkan template tanpa katalog Cafe` fails because `input[aria-label="Nama Toko"]` is absent. |
| `npm run build` | PASS | Vite production build completed. |
| `npx cap sync android` | PASS | SQLite, App, Network, and Secure Storage plugins detected and synced. |
| `android/gradlew.bat assembleDebug` | PASS | `BUILD SUCCESSFUL`; APK generated at `android/app/build/outputs/apk/debug/app-debug.apk`. |
| Changed-file ESLint | PASS | `src/main.js` and three relevant test files. |

Automated persistence cases covered:

- Native lifecycle `app-state/pause` flushes queued writes exactly once; resume/network do not flush; rejected flush and runtime start failure do not crash bootstrap; bootstrap without persistence remains safe.
- Stateful mocked-native SQLite save → close → new adapter initialize → load for complete product/service fields, including `imageData`.
- Retail CASH transaction survives reopen with `paidAt`, payment method, customer/business snapshots, HPP snapshot, gross profit, stock 10→8, stock movement, and cash entry.
- Complete Laundry unpaid order (kg decimal + pcs) survives reopen; CASH settlement survives another reopen with stable `paidAt`, payment fields, one `sale-${order.id}` cash reference, and idempotent retry.
- Opening balance/manual cash entries and calculated balance survive reopen.
- Migration coverage includes fresh v0→v1→v2→v3→v4 and existing v1/v2/v3→v4; v4 remains additive `image_data TEXT NOT NULL DEFAULT ''`; migration SQL contains no DROP/DELETE for existing business data or app state.
- Native plugin available selects SQLite. SQLite initialization failure retains existing memory fallback and emits an explicit `console.error`; memory initialization failure is not hidden.

## Physical Android QA

`adb devices` returned no connected devices.

| Case | Status | Notes |
|---|---|---|
| A. Data edit/add → Home → reopen | MANUAL REQUIRED | No ADB device connected. |
| B. Laundry Pay Later → background/reopen remains unpaid | MANUAL REQUIRED | No ADB device connected. |
| C. Settle Laundry CASH → background/reopen remains paid, no duplicate cash | MANUAL REQUIRED | No ADB device connected. |
| D. Order status Masuk → Diproses → background/reopen | MANUAL REQUIRED | No ADB device connected. |

## Logcat

MANUAL REQUIRED. `adb logcat` was not run because no Android device was connected; no claim is made for runtime SQLite migration errors, missing columns, database locks, JSON crashes, unhandled rejections, or fatal exceptions on a physical device.

## Blockers and verdict

- `ANDROID_DEVICE_NOT_CONNECTED`: physical persistence/recovery cases and logcat remain MANUAL REQUIRED.
- `FULL_UNIT_SUITE_PREEXISTING_UI_FAILURE`: full suite is 986/987 after two runs; the only failure is outside P31 scope in `business-template.spec.js`.
- `NATIVE_MEMORY_FALLBACK_EPHEMERAL`: existing fallback after SQLite init failure is explicit in `console.error` and covered by test, but data written during that run is memory-only; no UI was added under P31 scope.
- Real Android SQLite engine behavior is not proven by mocked-native unit tests; Gradle build and plugin packaging pass, but device QA is still required.

**Final status: BELUM SELESAI** — automated P31 durability checks and Android build pass, but full-suite baseline failure and physical-device QA remain unresolved/manual.
