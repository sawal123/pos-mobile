# P36 — Android Signed Release QA

- Date: 2026-09-16
- Base/main SHA: `8248758278c8a3c8cf2eecbe6f2f89a5c5e3dd4b`
- Branch: `release/android-1.0.0-signed` (PR to `main`, not merged)
- Release: **1.0.0** — versionCode **10000**
- applicationId: `com.posoffline.app`
- Capacitor appId: `com.posoffline.app`
- DB_VERSION: **4**
- minSdk / compileSdk / targetSdk: `24` / `36` / `36`
- Environment: Node `v22.18.0`, npm `10.9.3`, Gradle `8.14.3`, JVM `24.0.2`, Android SDK build-tools `36.0.0`, Windows

## Signing identity

| Item | Value |
|---|---|
| Signing source type | **PROPERTIES** (`android/keystore.properties`, git-ignored) — no `POS_RELEASE_*` variables are set on this machine |
| Keystore existence | **YES** — `android/signing/pos-mobile-release.jks` (git-ignored) |
| Properties completeness | all 4 keys non-empty (verified as booleans only) |
| Alias | `pos-mobile-release` |
| Entry type | `PrivateKeyEntry` |
| Certificate owner / issuer | `CN=POS Mobile, OU=IT, O=Software Developer, L=Medan, ST=Sumatera Utara, C=ID` (self-signed) |
| Certificate SHA-256 | `E9:FA:CB:C0:01:3A:F5:A5:13:B3:C5:6D:EE:32:A9:A6:B2:35:BA:17:49:3B:48:33:48:BC:53:B2:35:4F:04:E0` |
| Certificate validity | 2026-09-16 → 2054-02-01 (10,000 days; not expired, long-term for app updates) |
| Key algorithm / size | `SHA384withRSA` / 4096-bit RSA |
| Serial number | `5ce9b45a27ba2242` |
| Key backup | **ACKNOWLEDGED** (owner statement; no backup location recorded) |

No password, private key material, or raw keystore content is recorded anywhere in this report. `keytool -list -v` was invoked with `-storepass:env` so the value never appeared on a command line; the password was never echoed, printed, or written to a file.

## Test and build gates

| Gate | Result | Evidence |
|---|---|---|
| `npm run test:unit -- --run` | PASS | **38/38 files, 1088/1088 tests, 0 failed** |
| `npm run build` | PASS | Vite production build completed |
| `npx cap sync android` | PASS | 4 npm plugins detected (secure-storage `8.0.0`, sqlite `8.1.1`, app `8.1.1`, network `8.0.1`) |
| BluetoothPrinter registration | PASS | `MainActivity.java:11` → `registerPlugin(BluetoothPrinterPlugin.class)`; printer implementation untouched |
| `gradlew.bat clean assembleRelease bundleRelease` | PASS | `BUILD SUCCESSFUL in 50s` with the complete properties signing source active |
| Unsigned-artifact check | PASS | only `app-release.apk` and `app-release.aab` exist; **no `app-release-unsigned.apk`** |

## Signed artifacts

| Artifact | Path | Bytes | SHA-256 |
|---|---|---|---|
| Release APK | `android/app/build/outputs/apk/release/app-release.apk` | 12,107,942 | `5EDA9B70DE706B2377E5379B90DE24124946253A499F73FB57F8DDF0D029C097` |
| Release AAB | `android/app/build/outputs/bundle/release/app-release.aab` | 8,128,190 | `962718AFCF9B3F678AE634B611AADBD837CD063D23B5D4C3003473E469A660BE` |

Binaries are not committed; `build/`, `*.apk`, `*.aar` and `*.aab` are ignored by `android/.gitignore`.

## APK signature verification

`apksigner verify --verbose --print-certs` on `app-release.apk`:

| Field | Observed |
|---|---|
| Result | **Verifies** |
| Number of signers | 1 |
| Verified using v1 scheme (JAR signing) | `false` |
| Verified using v2 scheme (APK Signature Scheme v2) | **`true`** |
| Verified using v3 scheme | `false` |
| Verified using v3.1 scheme | `false` |
| Verified using v4 scheme | `false` |
| Signer #1 certificate DN | `CN=POS Mobile, OU=IT, O=Software Developer, L=Medan, ST=Sumatera Utara, C=ID` |
| Signer #1 certificate SHA-256 digest | `e9facbc0013af5a513b3c56dee32a9a6b235ba17493b483348bc53b2354f04e0` |

The digest equals the keystore certificate fingerprint (`E9:FA:CB:…:04:E0`) — **identity match, no `SIGNER_IDENTITY_MISMATCH`**. v2-only signing is sufficient for `minSdk 24`; the missing v1/v3/v4 schemes are recorded as-is and are not treated as failures.

## AAB signature verification

`jarsigner -verify -certs` on `app-release.aab`:

- Result: **`jar verified.`**
- Signer certificate extracted from the bundle (`META-INF/POS-MOBI.RSA`) and inspected with `keytool -printcert`
- AAB signer certificate SHA-256: `E9:FA:CB:C0:01:3A:F5:A5:13:B3:C5:6D:EE:32:A9:A6:B2:35:BA:17:49:3B:48:33:48:BC:53:B2:35:4F:04:E0` — **identical** to the keystore and APK signer certificate
- Reported warnings are expected for a self-signed upload certificate and do not affect validity: untrusted/self-signed chain, no signature timestamp, POSIX attributes not protected

## Zip alignment and metadata

| Check | Tool | Result |
|---|---|---|
| Zip alignment | `zipalign -c -v 4 app-release.apk` | **Verification successful** |
| package | `aapt dump badging` | `com.posoffline.app` |
| versionName | `aapt dump badging` | `1.0.0` |
| versionCode | `aapt dump badging` | `10000` |
| minSdk | `aapt dump badging` | `24` |
| targetSdk | `aapt dump badging` | `36` |
| application label | `aapt dump badging` | `POS Mobile` |
| debuggable | `apkanalyzer manifest print` | no `debuggable` attribute on the merged release manifest |

## Secret hygiene audit

| Check | Result |
|---|---|
| `git ls-files` for `*.jks`, `*.keystore`, `keystore.properties`, `*.apk`, `*.aab` | only `android/keystore.properties.example` (placeholders) — no real key, credential, or binary |
| `git check-ignore -v android/signing/pos-mobile-release.jks` | ignored by `android/.gitignore:59` (`signing/`) |
| `git check-ignore -v android/keystore.properties` | ignored by `android/.gitignore:58` (`keystore.properties`) |
| `storePassword=` / `keyPassword=` in tracked or changed files | allowed values only (`CHANGE_ME` in the example file); no real secret |
| `git diff --check` | clean |

Neither the keystore nor `keystore.properties` was added to Git at any point.

## Manual device and hardware status

| Item | Status | Note |
|---|---|---|
| `adb devices` | no device attached | — |
| Debug upgrade test | `UPGRADE_DEVICE_MANUAL_REQUIRED` | not claimed as PASS |
| Release first install | `RELEASE_FIRST_INSTALL_MANUAL_REQUIRED` | requires a clean device or emulator; a signed release APK must never be installed over the debug-signed app, and existing data must not be wiped to satisfy this check |
| SQLite release persistence | `RELEASE_SQLITE_PERSISTENCE_MANUAL_REQUIRED` | depends on the clean first-install run; `DB_VERSION` stays 4 and no schema/migration code changed |
| Bluetooth physical printer | `PRINT_HARDWARE_MANUAL_REQUIRED` | no paired thermal printer; does not block cryptographic release verification |

None of these manual items is a build, test, or signing failure.

## Distribution notes

- Selected mode: **Google Play upload key**. The signed AAB is the upload artifact and Play App Signing is recommended, so the local certificate documented here is the **upload identity**; Play's app-signing certificate fingerprint must be recorded separately once assigned.
- Nothing was uploaded, published, or released. No GitHub Release was created.
- If APKs are distributed directly instead, the certificate above becomes the permanent update identity: future updates must keep `applicationId com.posoffline.app`, use a higher `versionCode`, and be signed with the same compatible key.

## Scope

Changed files for P36: `docs/release/ANDROID_RELEASE_1.0.0.md` and this report. No business logic, transaction, stock, cash, customer, Laundry flow, printer implementation, SQLite schema, `DB_VERSION`, UI, `applicationId`, `versionCode`, `versionName`, or signing policy was modified.

## Verdict

**READY_TO_DISTRIBUTE** — with a documented caveat: the production upload key exists and is backed up (acknowledged), the signed APK and signed AAB both exist and verify, the APK signer digest and AAB signer certificate match the keystore certificate, metadata is correct, the test suite and build are green, and no secret is tracked. Distribution itself has not been performed, and the device, first-install, SQLite-persistence, and printer checks remain manual.
