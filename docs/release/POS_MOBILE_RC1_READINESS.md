# POS MOBILE RC1 Readiness

Repository: `sawal123/pos-mobile`
Base: `origin/main` (`6570e9e`)
Branch: `release/rc1-catalog-sync-qa`
Version: `1.0.0` (`versionCode: 10000`)

## Executive result

Cloud catalog visibility is fixed in code and covered by automated tests. No database reset, transaction deletion, or sync-queue deletion was used. The debug APK builds successfully and the local/offline Android smoke path passed. Production Cloud login, pull, push, and logout require a real QA account and were not run; therefore this is **NO-GO for production release** until that final Cloud smoke pass is completed.

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
.\gradlew.bat assembleDebug
adb install -r app\build\outputs\apk\debug\app-debug.apk
```

Use a dedicated QA Cloud account and a test business/outlet. Do not use production customer data.

## Release configuration audit

| Area | Status | Result / remaining action |
|---|---|---|
| Production API | PASS | `.env.production` points to the deployed HTTPS API; no localhost value is used by the production build. |
| API/backend compatibility | PENDING QA | Validate the deployed backend with the dedicated Cloud QA account, especially catalog `is_active` payloads and push contract. |
| Android secure storage | PASS | Native token storage uses `@aparajita/capacitor-secure-storage`; no token is stored in localStorage, sessionStorage, SQLite, or Pinia. |
| Permissions/network | PASS with P2 hardening | INTERNET and Bluetooth printer permissions are declared. `usesCleartextTraffic=true` and `allowBackup=true` remain P2 hardening items. |
| Capacitor sync/build | PASS | `npx cap sync android` and debug APK build pass; five native plugins synced. |
| Token/credential logging | PASS | No token or credential logging found in the application path; tokens are sent in Authorization headers. |
| Developer endpoint | PASS | `/dev/cloud-auth-preview` is DEV-only. |
| Release signing | PENDING | Debug APK was built. A signed release artifact still requires the project keystore/signing values in the release environment. |

The localhost value in `.env.example` is a development example only. No environment secret or token is included in this report.

## Verification

- `npm run build`: **PASS**. Vite build completed; only existing bundle-size/dynamic-import warnings remain.
- `npx vitest run`: **BASELINE FAILURES, NO RELEVANT NEW REGRESSION**. 92 files: 79 passed, 10 failed, 3 skipped; 1,947 passed, 12 failed, 4 skipped. The 12 named baseline failures are unchanged and are not catalog visibility/data-loss failures.
- `npx cap sync android`: **PASS**.
- `android\\gradlew.bat assembleDebug`: **PASS**. `app-debug.apk` produced.
- Non-mutating lint: `npx oxlint` on changed files **PASS**; targeted ESLint on core changed files **PASS**. Full changed-file ESLint still reports three pre-existing unused imports in Products, Stock, and Laundry views. `npm run lint` was not run because its scripts enable global `--fix`.
- `git diff --check`: only the pre-existing report EOF whitespace was present before this update; no source whitespace error remains.

## Remaining issues by priority

P0 blockers: **None found in the fixed catalog/data-safety scope.**

P1 blockers: **No confirmed code blocker after targeted verification.** Production Cloud E2E validation is still required before a production release decision.

P2 / deferred:

1. Complete Cloud QA smoke with deployed backend and dedicated credentials.
2. Produce and verify a signed release artifact; the current Android artifact is debug.
3. Consider disabling cleartext traffic and Android backup for hardened Play production configuration.
4. Resolve the 12 pre-existing baseline test failures and reduce the main JS bundle in a separate change.
5. Execute the separate category/product creation and stock-adjustment UI scenarios.

## Final report

**POS MOBILE RC1 - Readiness Result**

- Branch: `release/rc1-catalog-sync-qa`
- Commit: `4345680` plus the RC1 catalog-sync changes in this branch
- PR: To be created toward `main`; no auto-merge or deployment
- Cloud Menu Root Cause: server sends `is_active: 1`, but product mapping read only `status`; initial Cloud pull was also skipped when the local template catalog already existed
- Cloud Menu Status: **PASS** automated/code verification; production Cloud smoke **NOT RUN**
- Offline Transactions: **PASS** on Android emulator
- SQLite Persistence: **PASS** automated and Android restart smoke
- Sync Push/Pull: **PASS** targeted automated tests; deployed-backend E2E **NOT RUN**
- Workspace Safety: **PASS**; no reset, transaction deletion, or sync-queue deletion
- Android APK Build: **PASS** debug APK
- Android Smoke Test: **PARTIAL PASS**; local/offline scenarios pass, Cloud-account scenarios not run
- Production API Configuration: **PASS** for HTTPS/non-localhost; backend compatibility and signed release artifact remain pending
- P0 Blockers: None confirmed in scope
- P1 Blockers: None confirmed in scope; production Cloud E2E remains a release gate
- Deferred P2: Manifest hardening, baseline test cleanup, bundle size, remaining UI smoke cases
- Release Decision: **NO-GO** for production release until Cloud QA E2E, signed release build, and remaining smoke cases are completed
