# Android Release 1.0.0 — Checklist

- Release: **1.0.0**
- versionCode: **10000** (policy: `major * 10000 + minor * 100 + patch`, valid while minor/patch ≤ 99)
- applicationId: **com.posoffline.app** (must never change — changing it makes Android treat the build as a different app and breaks local data continuity)
- Capacitor appId: **com.posoffline.app**
- minSdk: **24**
- compileSdk / targetSdk: **36**
- DB_VERSION: **4**
- Capacitor plugins: Secure Storage `8.0.0`, SQLite `8.1.1`, App `8.1.1`, Network `8.0.1` + in-repo `BluetoothPrinter` (registered in `MainActivity`)

## Release checklist

| Status | Item | Note |
|---|---|---|
| [x] | unit tests green | 38/38 files, 1085/1085 tests |
| [x] | npm build | Vite production build completed |
| [x] | cap sync | 4 npm plugins detected; `BluetoothPrinter` still registered |
| [x] | debug APK | `android/app/build/outputs/apk/debug/app-debug.apk` |
| [x] | release APK | builds, but **unsigned QA artifact** — not for distribution |
| [x] | release AAB | builds, but **unsigned** — not for distribution |
| [x] | signing configured | Gradle wiring, credential sources and ignore rules in place; **production key not yet provided** |
| [ ] | APK signature verified | blocked: no production key (`RELEASE_SIGNING_KEY_REQUIRED`) |
| [ ] | AAB signature verified | blocked: no production key |
| [x] | zipalign verified | `zipalign -c 4` → verification successful (checked on the unsigned release APK; alignment is independent of signing) |
| [x] | metadata verified | `com.posoffline.app`, versionName `1.0.0`, versionCode `10000`, minSdk 24, targetSdk 36, not debuggable |
| [x] | SHA256 generated | see the P35 QA report |
| [ ] | debug upgrade test | `UPGRADE_DEVICE_MANUAL_REQUIRED` — no device attached |
| [ ] | data persistence after upgrade | blocked on the debug upgrade test |
| [ ] | release first-install QA | `RELEASE_FIRST_INSTALL_MANUAL_REQUIRED` — needs a clean test device/emulator; the existing device holds debug-signed data and must not be wiped |
| [ ] | Bluetooth physical printer QA | `PRINT_HARDWARE_MANUAL_REQUIRED` — no paired thermal printer |

## How to produce a signed release

1. Create the production keystore once, outside the repository, and never regenerate it:

   ```sh
   keytool -genkeypair -v -keystore pos-mobile-release.jks -alias <alias> \
     -keyalg RSA -keysize 4096 -validity 10000
   ```

2. Put it at `android/signing/pos-mobile-release.jks` (or any path outside Git — both are covered by `android/.gitignore`).

3. Copy `android/keystore.properties.example` to `android/keystore.properties` and fill in the real values. Environment variables take priority when both are present.

4. Build and verify:

   ```sh
   cd android
   gradlew.bat assembleRelease bundleRelease
   cd ..
   "…/build-tools/36.0.0/apksigner.bat" verify --print-certs android/app/build/outputs/apk/release/app-release.apk
   "…/jdk/bin/jarsigner.exe" -verify -certs android/app/build/outputs/bundle/release/app-release.aab
   ```

Behavior of the release signing configuration:

- **no credentials** → release compiles unsigned (QA artifact only, never claim it distributable)
- **partial credentials** → the build fails with `Incomplete Android release signing configuration`; there is no silent fallback to an unsigned artifact
- **complete credentials** → the keystore file is checked for existence, then `signingConfigs.release` is applied to `buildTypes.release`

`storeFile` is resolved with `rootProject.file(...)`, so it is always relative to the Android root, never to the ambient working directory.

## SIGNING KEY BACKUP

Without secrets:

- Back the keystore up to at least **two** secure, independent locations (for example an encrypted offline drive plus an encrypted cloud vault).
- Back up the alias and passwords **separately** from the keystore, in a password manager.
- Never store the keystore or its passwords in Git — `android/.gitignore` already blocks `*.jks`, `*.keystore`, `keystore.properties` and `signing/`.
- Never send the keystore or passwords over chat or plaintext email.
- Record the certificate SHA-256 fingerprint in the release documentation. The fingerprint is not a secret.
- If distributing through Google Play, enable **Play App Signing** so the upload key can be reset without losing the ability to update installed apps.

## Signature continuity rule

Once 1.0.0 is distributed:

- `applicationId` stays `com.posoffline.app`
- every subsequent release must use a **higher `versionCode`**
- every subsequent release must be signed with a **compatible key**

If the signing key is lost and distribution happens outside Play App Signing, updating existing installations can become impossible. Do not change the signing identity after a release without an explicit migration strategy.
