# P26 — Native Production Build & Real Device QA Report

## 1. Base commit

`938a1b4f9b09f6df59a7342ae51ae04664491775` (merge PR #25 into `main`)

## 2. Branch

`qa/native-production-device-p26`

## 3. Date

2026-08-31

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

**NONE CONNECTED.**

`adb devices -l` after `adb kill-server` / `adb start-server` returned an empty
device list. A physical Android device is required for P26 runtime QA; the
emulator is explicitly NOT a substitute for the final P26 verdict.

| Item | Value |
|------|-------|
| Manufacturer / model | NOT AVAILABLE |
| Android version | NOT AVAILABLE |
| API level | NOT AVAILABLE |

Blocker: `REAL_ANDROID_DEVICE_REQUIRED`

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

## 9. Android QA matrix A1–A21

Status legend: PASS / FAIL / NOT_RUN. All runtime scenarios are NOT_RUN
because no physical Android device is connected.

| ID | Scenario | Status | Notes |
|----|----------|--------|-------|
| A1 | Fresh install / cold launch | NOT_RUN | no device |
| A2 | Free mode offline POS | NOT_RUN | no device |
| A3 | SQLite native persistence after force-stop | NOT_RUN | no device |
| A4 | Second force-stop relaunch | NOT_RUN | no device |
| A5 | App reinstall update (`install -r`) | NOT_RUN | no device |
| A6 | Network native signal toggle | NOT_RUN | no device |
| A7 | Background / resume | NOT_RUN | no device |
| A8 | Force-stop while pending | NOT_RUN | no device |
| A9 | Startup online safety | NOT_RUN | no device |
| A10 | Cloud login | NOT_RUN | no device |
| A11 | Secure token native | NOT_RUN | no device |
| A12 | Free → Subscriber bootstrap | NOT_RUN | no device |
| A13 | Manual sync | NOT_RUN | no device |
| A14 | Restart after successful sync | NOT_RUN | no device |
| A15 | Subscriber offline edit | NOT_RUN | no device |
| A16 | Connectivity returns | NOT_RUN | no device |
| A17 | Auto Sync | NOT_RUN | no device |
| A18 | Background online transition | NOT_RUN | no device |
| A19 | Tenant safety | NOT_RUN | no device |
| A20 | Logout | NOT_RUN | no device |
| A21 | Device reboot | NOT_RUN | no device |

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

None in this phase. Build-time validation (web regression + Android Gradle
builds) passed; no production bug was identified because no real-device
runtime QA could be performed.

## 14. Fixes performed

None required. (Web regression 860/860 PASS on the merged P25 baseline.)

## 15. Remaining blockers

| Blocker | Description |
|---------|-------------|
| `REAL_ANDROID_DEVICE_REQUIRED` | No physical Android device connected via adb. Emulator exists but is not a substitute for P26 final verdict. |
| `MACOS_XCODE_IPHONE_REQUIRED` | Environment is Windows; iOS cannot be built or tested without macOS/Xcode/physical iPhone. |

## 16. Final P26 verdict

**BELUM SELESAI**

- Android build: PASS (assembleDebug / assembleRelease / bundleRelease)
- Android real-device QA: NOT_RUN
- iOS build: NOT_RUN
- iOS real-device QA: NOT_RUN

P26 can only be marked SELESAI when a physical Android device has passed the
A1–A21 matrix AND a physical iPhone has passed I1–I16 on a macOS/Xcode
environment.

## Appendices

### Web regression (Phase 1)

| Check | Result |
|-------|--------|
| `npm ci` | OK (with `NODE_ENV=development`; see note in §4) |
| `npm run test:unit -- --run` | 26 files, 860/860 PASS |
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
