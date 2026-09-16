# P35 — Android Release Readiness QA

- Date: 2026-09-16
- Base/main SHA: `ce066aa7c0b49cbdcfecc63253b6208177f18f26`
- Branch: `release/android-1.0.0-readiness` (PR to `main`, not merged)
- Environment: Node `v22.18.0`, npm `10.9.3`, Gradle `8.14.3`, JVM `24.0.2` (JDK `C:\Program Files\Java\jdk-24`), Android SDK build-tools `36.0.0`, Windows

## Versions and identity

| Item | Value |
|---|---|
| versionName | `1.0.0` |
| versionCode | `10000` (policy `major * 10000 + minor * 100 + patch`) |
| applicationId | `com.posoffline.app` (unchanged) |
| Capacitor appId | `com.posoffline.app` (unchanged) |
| package.json version | `1.0.0` |
| package-lock.json version (top level and `packages[""]`) | `1.0.0` |
| DB_VERSION | `4` (unchanged, no schema/migration change) |
| minSdk / compileSdk / targetSdk | `24` / `36` / `36` (unchanged) |
| Release build type | `minifyEnabled false` retained — no R8/minification in this phase |

## Signing configuration

Credential sources, in priority order: environment variables (`POS_RELEASE_STORE_FILE`, `POS_RELEASE_STORE_PASSWORD`, `POS_RELEASE_KEY_ALIAS`, `POS_RELEASE_KEY_PASSWORD`), then `android/keystore.properties`. `storeFile` is resolved with `rootProject.file(...)` against the Android root.

| Rule | Implemented behavior |
|---|---|
| No credentials at all | release compiles **unsigned** for QA; not distributable |
| Partial credentials | release configuration **fails** with `Incomplete Android release signing configuration. Missing: …` — no silent fallback to unsigned |
| Complete credentials | keystore existence is validated, then `signingConfigs.release` is applied to `buildTypes.release` |

Machine inspection at run time: **no** `POS_RELEASE_*` environment variables, **no** `android/keystore.properties`, **no** `*.jks`/`*.keystore` anywhere in the project. No keystore was generated and no password was invented.

**Signing status: `RELEASE_SIGNING_KEY_REQUIRED`** — the production key must be created and provided explicitly by the owner. See `docs/release/ANDROID_RELEASE_1.0.0.md`.

## Gate results

| Gate | Result | Evidence |
|---|---|---|
| `npm run test:unit -- --run` | PASS | **38/38 files, 1085/1085 tests, 0 failed** |
| New release-config guard spec | PASS | `src/__tests__/release-config.spec.js`, 7/7 |
| `npm run build` | PASS | Vite production build completed |
| `npx cap sync android` | PASS | 4 npm plugins detected (secure-storage `8.0.0`, sqlite `8.1.1`, app `8.1.1`, network `8.0.1`) |
| `gradlew.bat clean assembleDebug` | PASS | `BUILD SUCCESSFUL` (26s) |
| `gradlew.bat assembleRelease` | PASS | `BUILD SUCCESSFUL` (1m18s) |
| `gradlew.bat bundleRelease` | PASS | `BUILD SUCCESSFUL` (10s) |
| Final clean chain (`clean assembleDebug assembleRelease bundleRelease`) | PASS | `BUILD SUCCESSFUL` in 2m44s; produced the artifacts hashed below |
| `git diff --check` | PASS | No whitespace errors |
| BluetoothPrinter registration | PASS | `MainActivity.java:11` → `registerPlugin(BluetoothPrinterPlugin.class)`; plugin implementation untouched |

## Artifacts

| Artifact | Size (bytes) | SHA-256 | Signed |
|---|---|---|---|
| `android/app/build/outputs/apk/debug/app-debug.apk` | 13,370,188 | `82D3CF95A9A750432EC8CF25811E0E234B76416B43D0E133ADC6858A295905A5` | debug key |
| `android/app/build/outputs/apk/release/app-release-unsigned.apk` | 12,099,750 | `8EFC9DA3E09B9391D7BC84743C150DAE417825E2B26371631181A4BEE9A24EA8` | **UNSIGNED — NOT FOR DISTRIBUTION** |
| `android/app/build/outputs/bundle/release/app-release.aab` | 8,097,542 | `13DB37F773FE674545394B06DAA76E267020E1B30395AC80633DC747407BB164` | **UNSIGNED — NOT FOR DISTRIBUTION** |

No APK/AAB is committed; all build output is covered by `android/.gitignore` (`build/`, `*.apk`, `*.aar`, `*.aab`).

## APK metadata verification

Verified with `aapt dump badging` and `apkanalyzer manifest print` (build-tools `36.0.0` / cmdline-tools `latest`):

| Field | Expected | Observed |
|---|---|---|
| package | `com.posoffline.app` | `com.posoffline.app` |
| versionName | `1.0.0` | `1.0.0` |
| versionCode | `10000` | `10000` |
| minSdk | `24` | `sdkVersion:'24'` |
| targetSdk | `36` | `targetSdkVersion:'36'` |
| debuggable | absent | no `debuggable` attribute in the merged release manifest |
| application label | `POS Mobile` | `POS Mobile` |

## Signature, alignment and bundle verification

| Check | Tool | Result |
|---|---|---|
| Release APK signature | `apksigner verify --print-certs` | `DOES NOT VERIFY` / `ERROR: Missing META-INF/MANIFEST.MF` → unsigned, as expected without a key |
| Certificate SHA-256 fingerprint | `apksigner` | none — no certificate exists until a real key is supplied |
| Release APK alignment | `zipalign -c 4` | exit 0, verification successful (alignment is independent of signing) |
| Release AAB signature | `jarsigner -verify -certs` | `no manifest.` / `jar is unsigned.` → unsigned, non-distributable |

No artifact was manually resigned, and the unsigned APK was not renamed to look production-signed.

## Secret leak audit

| Check | Result |
|---|---|
| `git status --short` | only intended files: `package.json`, `package-lock.json`, `android/app/build.gradle`, `android/.gitignore`, new `android/keystore.properties.example`, new docs, new guard spec |
| `git ls-files` for `*.jks`, `*.keystore`, `keystore.properties`, `*.apk`, `*.aab` | **no matches** |
| Search of the diff for `storePassword` / `keyPassword` | only variable lookups and comments — **no literal secret** |
| `git check-ignore` | `keystore.properties` ignored; `keystore.properties.example` explicitly un-ignored and tracked on purpose |
| `android/keystore.properties.example` | placeholders only (`CHANGE_ME`), enforced by the guard spec |

No password was printed to the console or written into any file, report, or commit.

## Device, upgrade and hardware status

| Item | Status | Note |
|---|---|---|
| `adb devices` | no device attached | — |
| Debug upgrade test (`adb install -r`) | `UPGRADE_DEVICE_MANUAL_REQUIRED` | not claimed as PASS |
| Database snapshot before/after upgrade | not available | needs `run-as` on an installed debug build |
| SQLite/local data continuity | not verified on device | `DB_VERSION` remains 4 and no schema/migration code was touched, so no data migration is expected |
| Release first-install QA | `RELEASE_FIRST_INSTALL_MANUAL_REQUIRED` | must run on a clean device/emulator — never by replacing debug-signed data on the existing device |
| Bluetooth physical printer | `PRINT_HARDWARE_MANUAL_REQUIRED` | no paired thermal printer; carried over from P33/P34 |

Neither manual item is a unit-test or build failure.

## Scope and debt

Changed files: `package.json`, `package-lock.json`, `android/app/build.gradle`, `android/.gitignore`, `android/keystore.properties.example`, `docs/release/ANDROID_RELEASE_1.0.0.md`, `docs/qa/P35_ANDROID_RELEASE_READINESS_QA.md`, plus the test-only guard `src/__tests__/release-config.spec.js`.

No business logic, transaction, stock, cash, customer, Laundry, printer, SQLite schema, sync logic, UI, applicationId, Capacitor appId, or Android permission was modified.

Global `eslint`/`oxlint` debt from P34 is untouched and remains out of scope; only the newly added spec was linted (0 problems / 0 warnings, non-mutating).

## Verdict

**READY_FOR_SIGNING** — every code, version, build and packaging gate passes and both release artifacts compile reproducibly, but no production signing key is available, so the APK and AAB are unsigned and must not be distributed. Once the owner supplies the keystore (or `POS_RELEASE_*` credentials), re-run `assembleRelease`/`bundleRelease` and verify with `apksigner`/`jarsigner` to reach `READY_TO_DISTRIBUTE`.
