# P26 — Native Production Build & Real Device QA Report

## 1. Base commit

`938a1b4f9b09f6df59a7342ae51ae04664491775` (merge PR #25 into `main`)

## 2. Branch

`qa/native-production-device-p26`

## 3. Date

2026-09-01 (report updated with latest physical-device retest results; original
QA build/test performed 2026-08-31)

## 4. Environment — Node / npm

| Tool | Version |
|------|---------|
| OS | Windows 11 (build 26200) — x64 |
| Node | v22.18.0 |
| npm | 10.9.3 |

> Note: `npm ci` skipped devDependencies because the shell environment has
> `NODE_ENV=production`. Dev dependencies must be installed with
> `NODE_ENV=development` (e.g. `set NODE_ENV=development&& npm install`).
> This is an environment quirk, not a repository defect.

## 5. Capacitor

| Component | Version |
|-----------|---------|
| @capacitor/cli | 8.5.0 |
| @capacitor/core | 8.5.0 |
| @capacitor/android | 8.5.0 |
| @capacitor/ios | not declared in package.json (transitive only, project has no `ios/` platform) |
| @capacitor-community/sqlite | 8.1.1 |
| @aparajita/capacitor-secure-storage | 8.0.0 |
| @capacitor/app | 8.1.1 |
| @capacitor/network | 8.0.1 |

`npx cap doctor` → `[success] Android looking great!`

## 6. Android Gradle / JDK

| Component | Version |
|-----------|---------|
| Gradle | 8.14.3 |
| JDK | 24.0.2 (Oracle, `C:\Program Files\Java\jdk-24`) |
| minSdk | 24 |
| compileSdk | 36 |
| targetSdk | 36 |
| applicationId | com.posoffline.app |

## 7. Android device

**Xiaomi Redmi 15 Pro+ 5G** — Android 16, connected via adb.

| Item | Value |
|------|-------|
| Manufacturer / model | Xiaomi / Redmi 15 Pro+ 5G |
| Android version | Android 16 |
| API level | 36 |

Status: `REAL_ANDROID_DEVICE_AVAILABLE`. A1–A5 and A7 PASSED, A6 PARTIAL /
PENDING CLOUD VERIFICATION on this device (see §9). BUG-P26-01 was reproduced
on the P26 build, fixed in code, and re-verified on the physical device: cold
start lands on POS, no Splash, no native crash.

## 8. Android build

All Gradle builds executed on Windows via `gradlew.bat` from `android/`:

| Task | Result | Artifact |
|------|--------|----------|
| `gradlew.bat clean` | BUILD SUCCESSFUL (20s) | — |
| `gradlew.bat assembleDebug` | BUILD SUCCESSFUL (29s) | `android/app/build/outputs/apk/debug/app-debug.apk` (13,313,168 B) |
| `gradlew.bat assembleRelease` | BUILD SUCCESSFUL (1m13s) | `android/app/build/outputs/apk/release/app-release-unsigned.apk` (12,066,870 B) |
| `gradlew.bat bundleRelease` | BUILD SUCCESSFUL (5s) | `android/app/build/outputs/bundle/release/app-release.aab` (8,062,903 B) |

Release signing: **not configured** — `assembleRelease` produced an unsigned
APK. Per P26 policy, no dummy keystore/password is created or committed.
Status: "Release variant builds successfully; production signing not
validated." Production signing/store upload is deferred to P27.

`npx cap sync android` → OK. Detected plugins:
- @aparajita/capacitor-secure-storage@8.0.0
- @capacitor-community/sqlite@8.1.1
- @capacitor/app@8.1.1
- @capacitor/network@8.0.1

`npx cap sync android` produced **no tracked-file changes** (web assets are
copied into `android/app/src/main/assets/public`, which is gitignored).

Post-fix rebuild (BUG-P26-01):

| Task | Result | Artifact |
|------|--------|----------|
| `npm run test:unit -- --run` | PASS | 27 files, 870/870 (860 baseline + 10 new startup-routing) |
| `npm run build` | PASS | `✓ built in 816ms` |
| `npx cap sync android` | PASS | web assets copied to `android/app/src/main/assets/public` |
| `.\gradlew.bat assembleDebug` | BUILD SUCCESSFUL (16s) | `android/app/build/outputs/apk/debug/app-debug.apk` |

## 9. Android QA matrix A1–A21

Status legend: PASS / FAIL / NOT_RUN / PARTIAL. A1–A5 and A7 ran and PASSED on
the connected physical device (Xiaomi Redmi 15 Pro+ 5G, Android 16). A6 is
PARTIAL / PENDING CLOUD VERIFICATION (offline/local behavior verified; native
cloud connectivity transition not yet verified). A8–A21 remain NOT_RUN.

| ID | Scenario | Status | Notes |
|----|----------|--------|-------|
| A1 | Fresh install / cold launch | PASS | Xiaomi Redmi 15 Pro+ 5G, Android 16 |
| A2 | Free mode offline POS | PASS | Xiaomi Redmi 15 Pro+ 5G, Android 16 |
| A3 | SQLite native persistence after force-stop | PASS | Xiaomi Redmi 15 Pro+ 5G, Android 16 |
| A4 | Second force-stop relaunch | PASS | Xiaomi Redmi 15 Pro+ 5G, Android 16 |
| A5 | App reinstall update (`install -r`) | PASS | Xiaomi Redmi 15 Pro+ 5G, Android 16 |
| A6 | Network native signal toggle | PARTIAL / PENDING CLOUD VERIFICATION | Free/Local mode works with internet OFF; internet OFF → ON causes no crash/freeze; offline/online visual status not shown because SYNC_UI_LOCAL hides the badge; native cloud connectivity transition not yet verified |
| A7 | Background / resume | PASS | Resume 1 PASS; Resume 2 PASS; no return to Splash; no data loss/duplicates; no crash |
| A8 | Force-stop while pending | NOT_RUN — pending scenario execution |
| A9 | Startup online safety | NOT_RUN — pending scenario execution |
| A10 | Cloud login | NOT_RUN — pending scenario execution |
| A11 | Secure token native | NOT_RUN — pending scenario execution |
| A12 | Free → Subscriber bootstrap | NOT_RUN — pending scenario execution |
| A13 | Manual sync | NOT_RUN — pending scenario execution |
| A14 | Restart after successful sync | NOT_RUN — pending scenario execution |
| A15 | Subscriber offline edit | NOT_RUN — pending scenario execution |
| A16 | Connectivity returns | NOT_RUN — pending scenario execution |
| A17 | Auto Sync | NOT_RUN — pending scenario execution |
| A18 | Background online transition | NOT_RUN — pending scenario execution |
| A19 | Tenant safety | NOT_RUN — pending scenario execution |
| A20 | Logout | NOT_RUN — pending scenario execution |
| A21 | Device reboot | NOT_RUN — pending scenario execution |

## 10. iOS environment

**NOT AVAILABLE.** Current environment is Windows 11. P26 policy requires
macOS + Xcode + xcodebuild + CocoaPods/SPM + physical iPhone for any iOS
claim.

Blocker: `MACOS_XCODE_IPHONE_REQUIRED`

The repository has no `ios/` folder and `@capacitor/ios` is not declared in
package.json. No iOS project was generated from this environment, and no iOS
build/QA result is claimed.

## 11. iPhone model / iOS version

NOT AVAILABLE.

## 12. iOS QA matrix

All scenarios I1–I16: **NOT_RUN** (no macOS/Xcode/iPhone environment).

## 13. Bugs found

| ID | Scenario | Status | Notes |
|----|----------|--------|-------|
| BUG-P26-01 | Existing user always lands on SplashView at cold start | FIXED_AND_DEVICE_VERIFIED | Reproduced on physical Android (Xiaomi Redmi 15 Pro+ 5G, Android 16), fixed in code, then re-verified on the same device: cold start 1 → POS, cold start 2 → POS, Splash did not reappear, no native crash. Root cause: the `/` route had a static `redirect: '/splash'` and never consulted hydrated business/cashier/shift state. |

## 14. Fixes performed

- **BUG-P26-01 (FIXED_AND_DEVICE_VERIFIED):**
  - Removed the static `/ → /splash` route redirect.
  - Added `resolveStartupRoute()` in `src/router/index.js` that decides the
    startup destination from the hydrated Pinia stores:
    - fresh / business not set up → `/splash`
    - business set up but PIN not configured → `/setup/pin`
    - business + PIN set up, shift closed → `/shift/open`
    - business + PIN set up, shift open → `/pos`
  - The root route now resolves inside `router.beforeEach` (startup router),
    which runs after persistence hydration in the existing bootstrap order
    (`initializePersistence` → `initializeSyncFoundation` → `createAppRouter`).
  - SplashView is preserved; new-user onboarding UX is unchanged; no shift is
    auto-opened; existing route guards are untouched and still run.
  - Added regression tests in `src/__tests__/startup-routing.spec.js`
    covering all startup states plus direct protected-route guards.

## 15. Remaining blockers

| Blocker | Description |
|---------|-------------|
| `ANDROID_REAL_DEVICE_QA_INCOMPLETE` | Physical Android device is available and was used. QA is incomplete because A6 is still PARTIAL / PENDING CLOUD VERIFICATION and A8–A21 have not been executed yet. |
| `MACOS_XCODE_IPHONE_REQUIRED` | Environment is Windows; iOS cannot be built or tested without macOS/Xcode/physical iPhone. |

## 16. Final P26 verdict

**BELUM SELESAI**

- Android build: PASS (assembleDebug / assembleRelease / bundleRelease; post-fix assembleDebug rebuilt)
- Android real-device QA: PARTIAL — A1–A5 PASS, A6 PARTIAL / PENDING CLOUD VERIFICATION, A7 PASS, A8–A21 NOT_RUN on Xiaomi Redmi 15 Pro+ 5G (Android 16); native crash not found
- BUG-P26-01: FIXED_AND_DEVICE_VERIFIED (cold start 1 → POS, cold start 2 → POS, no Splash, no native crash)
- iOS build: NOT_RUN
- iOS real-device QA: NOT_RUN (macOS/Xcode/physical iPhone required)

P26 can only be marked SELESAI when the full A1–A21 matrix passes on a
physical Android device (A6 cloud connectivity transition still pending) AND
a physical iPhone has passed I1–I16 on a macOS/Xcode environment.

## Appendices

### Web regression (Phase 1)

| Check | Result |
|-------|--------|
| `npm ci` | OK (with `NODE_ENV=development`; see note in §4) |
| `npm run test:unit -- --run` | 27 files, 870/870 PASS (includes 10 new startup-routing regression tests) |
| `npm run build` | PASS (`✓ built`) |

### Capacitor config validation

`capacitor.config.json` unchanged:

```json
{
  "appId": "com.posoffline.app",
  "appName": "POS Mobile",
  "webDir": "dist"
}
```

### Emulator note (informational only)

An AVD (`Medium_Phone_API_36.0`) exists on this machine. A headless boot was
attempted as an additional runtime smoke check, but adb reported the emulator
as `unauthorized` (RSA prompt cannot be approved in headless mode), so no
emulator runtime result is claimed. The emulator is not a substitute for the
physical-device requirement anyway.
