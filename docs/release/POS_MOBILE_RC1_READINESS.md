# POS MOBILE RC1 Readiness

Repository: `sawal123/pos-mobile`
Base: `origin/main` (`6570e9e`)
Branch: `release/rc1-catalog-sync-qa`
Version: `1.0.0` (`versionCode: 10000`)

## Xiaomi Google login investigation - 2026-10-30

- **Cloud Login E2E: PASS for Google authentication, user-confirmed on Xiaomi.** The user confirmed that mobile login succeeded after adding the Android client ID to `GOOGLE_ANDROID_CLIENT_IDS` on the backend. Business/outlet selection and subsequent Cloud operations were not confirmed in this investigation.
- The installed APK was pulled read-only from Xiaomi `475d91cd`. Its SHA-256 is `67F506D1A987E1DBA16A740730DA0F1467FFA8076AB77BAC890BF767EAD6BC0A`; APK v2 signature verification passes. Its signing certificate SHA-1 matches the registered release certificate. The embedded Web Client ID matches the new production ID; the old ID and a live-reload URL are absent.
- **Native Google credential acquisition: PASS** for the observed 16:31 device-time attempt. Google Play services reports `Activity finished successfully`; the framework reports `GetCredentialResponse returned from framework`. This does not prove API login success.
- **Confirmed configuration blocker:** the backend Android presenter allowlist was missing the Android client ID. `GoogleOidcVerifier.php` checks the token's `azp` against its configured audience/presenter allowlist; Android IDs are loaded from `GOOGLE_ANDROID_CLIENT_IDS` in `config/services.php`. A Google-issued Android token with a Web audience can still be rejected when its Android presenter is missing. The user confirmed successful login after configuring that value. The exact deployed audit rejection reason was not collected.
- Backend verifier regression checks: **5 tests / 15 assertions PASS** (`php artisan test --compact --filter=test_real_verifier_`), using the test SQLite in-memory configuration and mocked Google keys.
- Required release configuration: keep `GOOGLE_CLIENT_ID` set to the Web client ID and `GOOGLE_ANDROID_CLIENT_IDS` set to the full registered Android client ID; rebuild Laravel's configuration cache after changing them. This server action is now **completed by the user**. The mobile `VITE_GOOGLE_WEB_CLIENT_ID` remains the Web client ID. No new APK was needed for this server configuration fix.
- Adding a test user did not establish the root cause. No production backend configuration was changed by the agent; no APK reinstallation or database reset was performed during this investigation.
- **Release Decision: NO-GO** until a fresh mobile login completes business/outlet selection and the remaining Cloud smoke tests pass.

## Validation update - 2026-10-30

The remaining Google login failure was traced to the Android live-reload path, not to the Android SHA-1 or the rotated backend secret. `android:live` was loading the local `.env`, whose Google Web Client ID differed from the Web Client ID configured on the backend. The resulting Google ID token therefore had the wrong `aud` value and was rejected by `/api/v2/auth/google`.

The local `.env` and committed production configuration are now aligned to the backend Web Client ID. The Android client ID remains native Credential Manager configuration and is not used as `VITE_GOOGLE_WEB_CLIENT_ID`. A production asset build was verified to load from `https://localhost` (Capacitor local asset scheme) with no live-reload URL. No app data, SQLite database, workspace registry, transactions, or sync queue was reset or deleted.

Current verification:

- `npm run build`: **PASS**.
- `npx cap sync android`: **PASS**.
- `android\\gradlew.bat assembleDebug`: **PASS**; APK installed with `adb install -r` without uninstalling the existing app.
- Google native/account-linking tests: **48/48 PASS**.
- Full Vitest: **BASELINE FAILURES**; 1,947 passed, 12 failed, 4 skipped across the existing suite. No Google test failed.
- Android Google E2E: **NOT RUN** after the production install because the connected device was locked behind the system notification shade and no QA account confirmation was available. Do not mark Cloud login production PASS until the user selects the QA account and verifies the post-login business/outlet flow.

Security note: the earlier live-reload debug session exposed an ID token in the device log stream. The application source/native plugin does not intentionally log the token, but release validation must use a production asset build and `adb logcat -c` before testing. Never paste or retain that token; rotate it if it was exported outside the device log.

## Executive result

Cloud catalog visibility is fixed in code and covered by automated tests. No database reset, transaction deletion, or sync-queue deletion was used. The signed release APK builds successfully and the local/offline Android smoke path passed. Google mobile authentication is now user-confirmed on Xiaomi after correcting the backend Android presenter allowlist. Business/outlet selection, production pull/push, and Cloud logout still need their dedicated QA smoke; therefore this is **NO-GO for production release** until that final Cloud smoke pass is completed. Earlier dated validation sections below describe the evidence available at those times.

## Cloud menu investigation

Status: **PASS (automated and code-path verification)**. Production-backend Android smoke: **NOT RUN**.

Root causes found:

1. The deployed catalog payload uses `is_active: 1`, while product mapping only read `status`. Products were persisted with `isActive: false`, so `productStore.filteredProducts` hid them from POS.
2. POS/Home and related catalog views used the presence of the local template catalog as proof that Cloud catalog loading was complete. After linking a Cloud business, the initial pull could therefore be skipped.

Fixes:

- `syncPullService.js` now normalizes `status`, `is_active`, `isActive`, and boolean/number/string variants. Active server products remain visible and inactive products remain inactive.
- `syncPullStore.js` now checks push and pull bindings before deciding whether a pull is initial. A local template no longer suppresses the first Cloud pull; a push-only workspace performs a normal pull.
- POS, Home, Products, Categories, Stock, and Laundry create views invoke the catalog guard when Cloud operational context is active. A completed binding remains idempotent.
- Existing protections remain: tenant/outlet context is required, deleted rows are not confused with inactive rows, and no clear-cache path deletes transactions or queued sync work.

Targeted verification: 4 test files, 84 tests passed, including Cloud-first completion, local cache, pull apply, and push-only initial pull. Repeated pull/idempotency and workspace-safety assertions pass.

## Data and transaction safety

- SQLite persistence: **PASS** in automated restart/concurrency coverage. The Android restart smoke also retained the business, active shift, today's revenue (`Rp 24.420`), and transaction count.
- Offline cash transaction: **PASS** on Android emulator. A local product was sold for `Rp 24.420`; payment confirmation and receipt data were displayed.
- Transaction history: **PASS** on Android emulator; the new invoice remained in history after payment.
- Stock adjustment: Android UI scenario **NOT RUN**. Existing automated stock/sync coverage was used; no data-loss regression was observed.
- Data-loss risk from the fixed Cloud path: no known P0 risk. The code does not reset the database or remove transactions/`sync_queue` during a Cloud catalog pull.

## Android production smoke test

Device: ADB emulator `emulator-5554`, APK `android/app/build/outputs/apk/debug/app-debug.apk`.

| Scenario | Status | Evidence |
|---|---|---|
| Fresh install and onboarding | PASS | App uninstalled, APK installed, onboarding completed |
| Create Free local business | PASS | `TOKO_QA_RC1`, Cafe / UMKM, Free mode |
| Create category and product | NOT RUN | No separate UI creation executed in this session |
| Cash transaction offline | PASS | Payment completed and receipt shown |
| Stock change and transaction history | PARTIAL | History PASS; stock adjustment NOT RUN |
| Restart and SQLite persistence | PASS | Force-stop/relaunch retained business, shift, revenue, and history |
| Cloud login and business/outlet selection | NOT RUN | Requires QA credentials |
| Cloud category/product pull | NOT RUN on production backend | Automated catalog tests PASS |
| Transaction with network unavailable | PASS for local offline path | Local transaction completed without Cloud session |
| Sync after network returns | NOT RUN on production backend | Requires QA account and server verification |
| Logout without losing offline data | NOT RUN for Cloud session | Offline data lifecycle is covered by automated tests |

Run the remaining QA scenarios with:

```powershell
emulator -avd POS_API_34
adb devices
npm run build
npx cap sync android
Set-Location android
.\gradlew.bat assembleRelease
adb install -r app\build\outputs\apk\release\app-release.apk
```

Use a dedicated QA Cloud account and a test business/outlet. Do not use production customer data.

## Release configuration audit

| Area | Status | Result / remaining action |
|---|---|---|
| Production API | PASS | `.env.production` points to the deployed HTTPS API; no localhost value is used by the production build. |
| API/backend compatibility | PENDING QA | Validate the deployed backend with the dedicated Cloud QA account, especially catalog `is_active` payloads and push contract. |
| Android secure storage | PASS | Native token storage uses `@aparajita/capacitor-secure-storage`; no token is stored in localStorage, sessionStorage, SQLite, or Pinia. |
| Permissions/network | PASS with P2 hardening | INTERNET and Bluetooth printer permissions are declared. `usesCleartextTraffic=true` and `allowBackup=true` remain P2 hardening items. |
| Capacitor sync/build | PASS | `npx cap sync android` and signed release APK build pass; five native plugins synced. |
| Token/credential logging | PASS | No token or credential logging found in the application path; tokens are sent in Authorization headers. |
| Developer endpoint | PASS | `/dev/cloud-auth-preview` is DEV-only. |
| Release signing | PASS for local RC validation | `assembleRelease` and `apksigner` verification pass. Keystore/password material remains local and ignored by Git. |

The localhost value in `.env.example` is a development example only. No environment secret or token is included in this report.

## RC1 final release validation

Validation date: 2026-10-29. The requested post-merge base was not available: PR #70 is still `OPEN`, and `origin/main` remains at `6570e9e`. The candidate branch validated here is `release/rc1-catalog-sync-qa` at `13bd88e`.

| Required validation | Status | Evidence / blocker |
|---|---|---|
| Cloud Login E2E | **NOT RUN** | No separate QA account or credentials are available. |
| Initial Catalog Pull | **NOT RUN** against deployed backend | Automated catalog pull tests pass; production Cloud E2E needs QA credentials. |
| Template-to-Cloud Workspace Transition | **NOT RUN** end-to-end | Code path and automated tests cover the local-template-to-initial-pull guard; no database reset was used. |
| Offline Sale | **PASS** on prior Android smoke | Cash sale completed offline on the debug candidate; release APK install/launch was separately verified. |
| Sync Push | **NOT RUN** against deployed backend | Automated push contract tests pass; QA account/server verification is pending. |
| Server Data Verification | **NOT RUN** | No QA business/outlet or server-side verification access was supplied. |
| Logout & Restart Safety | **PARTIAL PASS** | Restart and SQLite persistence passed on Android; Cloud logout was not run without a QA session. |
| Signed APK/AAB | **PASS APK / NOT RUN AAB** | `assembleRelease` passed; `apksigner` verified one v2 signer. No AAB was requested or built. |
| Android Installation | **PASS** | Signed `app-release.apk` installed and launched on fresh `emulator-5556`; onboarding screen rendered. |
| Active/inactive products and categories | **NOT RUN** against server | Mapping regression tests cover `is_active: 1` and inactive behavior; deployed payload was not available. |
| Duplicate products/transactions | **NOT RUN** against server | Local automated idempotency tests pass; no production Cloud dataset was touched. |
| Tenant/outlet isolation | **NOT RUN** against server | Requires two QA contexts or server-side QA verification. |

Release signing details were not printed. The local keystore and properties are ignored by Git and were not added or changed. No signing password or QA credential was stored in the repository or report.

## Verification

- `npm run build`: **PASS**. Vite build completed; only existing bundle-size/dynamic-import warnings remain.
- `npx vitest run`: **BASELINE FAILURES, NO RELEVANT NEW REGRESSION**. 92 files: 79 passed, 10 failed, 3 skipped; 1,947 passed, 12 failed, 4 skipped. The 12 named baseline failures are unchanged and are not catalog visibility/data-loss failures.
- `npx cap sync android`: **PASS**.
- `android\\gradlew.bat assembleRelease`: **PASS**. Signed `app-release.apk` produced and verified with `apksigner` v2.
- Non-mutating lint: `npx oxlint` on changed files **PASS**; targeted ESLint on core changed files **PASS**. Full changed-file ESLint still reports three pre-existing unused imports in Products, Stock, and Laundry views. `npm run lint` was not run because its scripts enable global `--fix`.
- `git diff --check`: only the pre-existing report EOF whitespace was present before this update; no source whitespace error remains.

## Remaining issues by priority

P0 blockers: **None found in the fixed catalog/data-safety scope.**

P1 blockers: **No confirmed code blocker after targeted verification.** Production Cloud E2E validation is still required before a production release decision.

P2 / deferred:

1. Complete Cloud QA smoke with deployed backend and dedicated credentials.
2. Consider disabling cleartext traffic and Android backup for hardened Play production configuration.
3. Resolve the 12 pre-existing baseline test failures and reduce the main JS bundle in a separate change.
4. Execute the separate category/product creation and stock-adjustment UI scenarios.

## Final report

**POS MOBILE RC1 - Readiness Result**

- Branch: `release/rc1-catalog-sync-qa`
- Commit: `13bd88e`
- PR: [#70](https://github.com/sawal123/pos-mobile/pull/70) open toward `main`; no auto-merge or deployment
- Cloud Menu Root Cause: server sends `is_active: 1`, but product mapping read only `status`; initial Cloud pull was also skipped when the local template catalog already existed
- Cloud Menu Status: **PASS** automated/code verification; production Cloud smoke **NOT RUN**
- Offline Transactions: **PASS** on Android emulator
- SQLite Persistence: **PASS** automated and Android restart smoke
- Sync Push/Pull: **PASS** targeted automated tests; deployed-backend E2E **NOT RUN**
- Workspace Safety: **PASS**; no reset, transaction deletion, or sync-queue deletion
- Android APK Build: **PASS** signed release APK
- Android Smoke Test: **PARTIAL PASS**; local/offline scenarios pass, Cloud-account scenarios not run
- Production API Configuration: **PASS** for HTTPS/non-localhost; backend compatibility and post-merge validation remain pending
- P0 Blockers: None confirmed in scope
- P1 Blockers: None confirmed in scope; production Cloud E2E remains a release gate
- Deferred P2: Manifest hardening, baseline test cleanup, bundle size, remaining UI smoke cases
- Release Decision: **NO-GO** for production release until PR #70 is merged, Cloud QA E2E/server verification is completed, and the remaining smoke cases pass
