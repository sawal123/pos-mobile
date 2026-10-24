# AUTH-M01 â€” Cloud Login UI & API Contract Audit

**Repository:** `sawal123/pos-mobile`
**Base Branch:** `main` (commit `85a6db5`)
**Working Branch:** `docs/auth-m01-cloud-login-contract`
**Audit Date:** 2026-10-24
**Classification Guide:**
- `[EXISTING]`: Verified in current mobile codebase (`pos-mobile`).
- `[PROPOSED]`: Target design for upcoming implementation tasks (`AUTH-M02` â€“ `AUTH-M09`).
- `[PENDING BACKEND]`: Dependent on pos_dashboard backend contract (`AUTH-D01` / `/api/v2/auth`). Not yet available in active backend endpoints.
- `[SECURITY FINDING]`: Identified vulnerability, gap, or architectural risk that must be mitigated.

---

## 1. Executive Summary

### 1.1 Context & Purpose
POS Mobile (`sawal123/pos-mobile`) is an offline-first point-of-sale client built on Vue 3, Pinia, Vite, and Capacitor 8 targeting Android and Web. Currently, the application supports manual email/password login and registration against Laravel Sanctum endpoints provided by `pos_dashboard`.

The purpose of **AUTH-M01** is to perform a comprehensive audit of the mobile authentication architecture, evaluate security boundaries, assess compatibility with the backend `AUTH-D01` contract, and define an integration contract for two target authentication flows:
1. **Manual Email/Password Registration with 6-Digit Email OTP Verification.**
2. **Native Android Google Sign-In (OpenID Connect ID Token exchange).**

AUTH-M01 is an **audit and specification contract only**. In accordance with strict constraints, **no application source code or dependencies are modified** in this task. This document serves as the single source of truth for downstream execution (`AUTH-M02` through `AUTH-M09`).

### 1.2 Key Audit Findings Summary
1. **[EXISTING] Solid Local Storage Isolation:** Bearer tokens are kept in secure storage (`@aparajita/capacitor-secure-storage` backed by Android Keystore / iOS Keychain) and are never stored in `localStorage`, SQLite, or Pinia state (`src/services/cloud/tokenRepository.js:1-93`). Local POS operational data is strictly decoupled from cloud sessions.
2. **[SECURITY FINDING] Auto-Verified Token Assumption:** The current mobile registration (`src/services/cloud/authService.js:31-69`) assumes the server immediately returns a Sanctum bearer token and provisions default business records upon `POST /api/auth/register`. The proposed backend contract (`AUTH-D01`) converts registration into a pending state (`202 Accepted`) requiring OTP verification. The existing client would fail with `MISSING_TOKEN` if connected to an OTP-gated backend without updates.
3. **[SECURITY FINDING] 2FA Deadlock on Mobile:** Mobile currently maps backend `TWO_FACTOR_REQUIRED` to a passive error: *"Akun Cloud memerlukan verifikasi dua faktor. Selesaikan melalui Dashboard"* (`src/services/cloud/cloudLoginErrors.js:22,50-52`). There is no challenge state, TOTP input, or recovery code completion in the mobile app.
4. **[EXISTING] Robust Multi-Tenant Workspace Alignment:** The store architecture (`src/stores/cloudSessionStore.js:258-298, 955-1181`) enforces strict separation between cloud entitlement (`cloudAccess`) and active workspace alignment (`isWorkspaceAligned`, `isOperationalCloudAccess`). Switching between businesses requires explicit user confirmation and zero local data deletion.
5. **[PENDING BACKEND] Backend Endpoints Not Yet Available:** Endpoints under `/api/v2/auth/*` (`register`, `otp/verify`, `otp/resend`, `google`, `2fa/verify`) defined in `AUTH-D01` are not yet implemented in `pos_dashboard`. Mobile implementation must strictly gate v2 integration behind backend readiness.
6. **[PROPOSED] Monolithic View Refactoring:** `CloudLoginView.vue` has grown to 2,989 lines, combining authentication, business linking, outlet selection, sync status, activity logs, conflict resolution, and workspace switching. The introduction of OTP and Google Sign-In necessitates modular component architecture (`AUTH-M02`).

---

## 2. Existing Mobile Authentication Architecture

```
+-----------------------------------------------------------------------------+
|                             Presentation Layer                              |
|   +------------------------------------+   +----------------------------+   |
|   |  WelcomeView.vue (/setup/welcome)  |   | SettingsView.vue           |   |
|   |  - Belum punya akun -> Offline     |   | - Cloud Account Status     |   |
|   |  - Sudah punya akun -> Cloud       |   +----------------------------+   |
|   +-----------------+------------------+                                    |
|                     |                                                       |
|                     v                                                       |
|   +---------------------------------------------------------------------+   |
|   |  CloudLoginView.vue (/setup/cloud & /settings/cloud)                |   |
|   |  - Form: Login / Register tabs                                      |   |
|   |  - Step Machine: login -> select-business -> confirm-link -> ...    |   |
|   +---------------------------------+-----------------------------------+   |
+-------------------------------------|---------------------------------------+
                                      |
                                      v
+-----------------------------------------------------------------------------+
|                          State & Policy Management                          |
|   +---------------------------------------------------------------------+   |
|   |  cloudSessionStore.js (Pinia: non-sensitive context)                |   |
|   |  - user: { id, name, email }                                        |   |
|   |  - selectedBusiness, selectedOutlet, cloudAccess                    |   |
|   |  - role, syncCapabilities, capabilityState ('verified'|'unverified') |   |
|   |  - operationalContext, activeWorkspaceId, pendingSwitch             |   |
|   |  * NEVER stores bearer token in Pinia state!                        |   |
|   +---------------------------------+-----------------------------------+   |
|                                     |                                       |
|                                     v                                       |
|   +---------------------------------+-----------------------------------+   |
|   |  cloudLoginErrors.js (Pure error classification & Indonesian copy)  |   |
|   +---------------------------------------------------------------------+   |
+-------------------------------------|---------------------------------------+
                                      |
                                      v
+-----------------------------------------------------------------------------+
|                               Service Layer                                 |
|   +-----------------------------+   +-----------------------------------+   |
|   |  authService.js             |   |  tokenRepository.js               |   |
|   |  - cloudLogin()             |   |  - saveToken()                    |   |
|   |  - cloudRegister()          |   |  - getToken()                     |   |
|   |  - fetchMobileContext()     |   |  - removeToken()                  |   |
|   |  - registerDevice()         |   |  - Native: Keystore / Keychain    |   |
|   |  - cloudLogout()            |   |  - Web/Test: in-memory fallback   |   |
|   +--------------+--------------+   +-----------------------------------+   |
|                  |                                                          |
|                  v                                                          |
|   +---------------------------------------------------------------------+   |
|   |  apiClient.js (Fetch wrapper with Bearer token, JSON parse, no retry)|   |
|   +---------------------------------+-----------------------------------+   |
+-------------------------------------|---------------------------------------+
                                      | HTTPS (JSON)
                                      v
+-----------------------------------------------------------------------------+
|                       Backend (pos_dashboard Sanctum)                       |
+-----------------------------------------------------------------------------+
```

---

## 3. Existing Files & Responsibilities

| File Path | Status | Responsibilities & Observed Implementation |
|---|---|---|
| `src/views/settings/CloudLoginView.vue` | `[EXISTING]` | Monolithic view (2,989 lines). Handles tab switching (login vs in-app register), form inputs, step management (`login` -> `select-business` -> `confirm-link` -> `select-outlet` -> `done`), sync activity logs, conflict resolution, auto-sync toggle, and business workspace switch modals. |
| `src/services/cloud/authService.js` | `[EXISTING]` | HTTP adapter for cloud auth. Calls `/api/auth/login`, `/api/auth/register`, `/api/auth/me`, `/api/auth/logout`, `/api/mobile/context`, and `/api/mobile/devices`. Does not implement OTP, 2FA, or Google OIDC. |
| `src/services/cloud/cloudLoginErrors.js` | `[EXISTING]` | Pure error classifier mapping `apiClient` errors (`status`, `code`) into friendly Indonesian messages. Catches `OFFLINE`, `INVALID_CREDENTIALS`, `UNVERIFIED`, `TWO_FACTOR`, `SERVER`, and `UNKNOWN`. Never echoes raw server messages. |
| `src/stores/cloudSessionStore.js` | `[EXISTING]` | Pinia store managing authenticated user, selected business/outlet, device identifier, server device ID, role capabilities, operational context alignment, and workspace switching. Enforces that bearer tokens are never kept in Pinia. |
| `src/services/cloud/apiClient.js` | `[EXISTING]` | Thin `fetch` wrapper. Injects `Accept: application/json` and `Authorization: Bearer <token>`. Resolves base URL from `VITE_API_BASE_URL` (fallback `https://pos.eradig.my.id`). Never retries automatically; never logs bearer tokens. |
| `src/services/cloud/tokenRepository.js` | `[EXISTING]` | Secure token storage. Uses `@aparajita/capacitor-secure-storage` (Android Keystore / iOS Keychain) on native platforms. Uses in-memory variable for web/Vitest. Never uses `localStorage`, `sessionStorage`, or SQLite. |
| `src/services/cloud/deviceIdentifier.js` | `[EXISTING]` | Generates and durably persists a stable UUID per installation in SQLite `app_meta`. Guarantees stable hardware identification for `/api/mobile/context` and cashier device pre-registration. |
| `src/services/cloud/businessContextActivation.js` | `[EXISTING]` | Read-only inspection of local workspace (checking if tables are empty, protected, or occupied) and builds confirmation copy for safe workspace switching. |
| `src/services/cloud/businessWorkspaceService.js` | `[EXISTING]` | Manages multi-workspace registry in SQLite, transactional workspace switching, snapshots, and crash-recovery rollbacks. |
| `src/views/onboarding/WelcomeView.vue` | `[EXISTING]` | Initial screen for first-time launch. Presents "Belum punya akun" (routes to `/setup/business` for offline POS) and "Sudah punya akun" (routes to `/setup/cloud` for cloud login). |
| `src/router/index.js` | `[EXISTING]` | Application routes and navigation guards. Routes `/setup/cloud` (named `cloud-onboarding`) to `CloudLoginView.vue`. Allows public access during onboarding without active business. |
| `src/__tests__/prem-m03-cloud-login.spec.js` | `[EXISTING]` | 19 unit tests covering login error classification, offline failure, explicit linking, link persistence across restart, 401 token invalidation, revoked membership, and disconnect. |
| `src/__tests__/cloud-login-context.spec.js` | `[EXISTING]` | 18 unit tests covering secure storage isolation, lifecycle hydration, zero-business handling, device identifier durability, and strict sync isolation (asserting no sync push/pull during auth). |
| `src/__tests__/onboarding-account-choice.spec.js` | `[EXISTING]` | 9 unit tests verifying welcome view navigation, route guards, and onboarding mode presentation in `CloudLoginView.vue`. |

---

## 4. Current Login & Registration Flow

### 4.1 Existing Email/Password Login Flow `[EXISTING]`
1. **Input:** User enters email and password into `CloudLoginView.vue` (`authMode === 'login'`).
2. **Call:** `cloudStore.login(email, password)` calls `cloudLogin(email, password)` (`authService.js:79`).
3. **Request:** `POST /api/auth/login` with `{ email, password }`.
4. **Validation/Response:**
   - On `200 OK`: Server returns `{ data: { token_type: "Bearer", token: "...", user: { id, name, email } } }`.
   - On `401`: `INVALID_CREDENTIALS` -> UI shows `"Email atau password salah."`.
   - On `403 EMAIL_NOT_VERIFIED`: UI shows `"Email akun Cloud belum diverifikasi. Verifikasi melalui Dashboard sebelum masuk."`.
   - On `403 TWO_FACTOR_REQUIRED`: UI shows `"Akun Cloud memerlukan verifikasi dua faktor. Selesaikan melalui Dashboard."`.
   - On `0 / NETWORK_ERROR`: UI shows `"Koneksi internet diperlukan untuk masuk ke Cloud."`.
5. **Token Storage:** On success, token is saved to secure storage via `saveToken(token)` (`tokenRepository.js`).
6. **Context Retrieval:** Immediately calls `fetchMobileContext(token, { deviceIdentifier })` (`GET /api/mobile/context?device_identifier=...`).
7. **Business Evaluation:**
   - If `businesses.length === 0`: UI advances to `done` and displays `#cloud-no-business` banner.
   - If `businesses.length === 1`: Sets `pendingBusiness` and transitions to `confirm-link` step.
   - If `businesses.length > 1`: Transitions to `select-business` step.
8. **Explicit Link Confirmation:** User confirms link via `handleConfirmLink()`. POS local business is bound to the cloud business without altering local transactions.
9. **Outlet Selection & Device Registration:**
   - Active outlets are filtered. If single outlet -> auto-selected; if multiple -> `select-outlet` step.
   - If role is `cashier`: resolves pre-registered device from `device_context` (never calls device registration).
   - If role is `owner` / `member`: calls `registerDevice(token, { business_id, outlet_id, device_identifier, name, platform })`.
10. **Workspace Activation:** Calls `activateOperationalContext()`. If the local SQLite database holds a different business, triggers `BUSINESS_SWITCH_CONFIRMATION_REQUIRED` modal. Once activated, sets `businessStore.mode = 'cloud'`, initiates background auto-pull, and completes setup.

### 4.2 Existing In-App Registration Flow `[EXISTING]`
1. **Input:** User enters `name`, `email`, `password`, `password_confirmation`, and optional `business_name` in `CloudLoginView.vue` (`authMode === 'register'`).
2. **Call:** `cloudStore.register(payload)` calls `cloudRegister(payload)` (`authService.js:31`).
3. **Request:** `POST /api/auth/register`.
4. **Backend Action (v1 legacy):** In one transaction, backend creates User, auto-sets `email_verified_at = now()`, creates default business, creates `OUT-1` outlet, creates Free subscription, and returns a Sanctum bearer token (`AUTH_D01 Section 2.7`).
5. **Client Response:** Mobile receives `token` and `user`, saves token, fetches mobile context, and proceeds into the business/outlet linking steps.

### 4.3 Existing Deficiencies Identified `[SECURITY FINDING]`
- **No Email Ownership Verification:** Registration bypasses mailbox verification entirely.
- **Breaking Contract Delta:** If backend adopts `AUTH-D01` (`/api/v2/auth/register` returning `202 PENDING_EMAIL`), the mobile app immediately crashes or displays `MISSING_TOKEN`.
- **No Google Sign-In Entry Point:** Only manual credentials exist; users cannot authenticate with Google on Android.
- **No 2FA Challenge Support:** Users with 2FA enabled on the web dashboard are permanently locked out of the mobile app.

---

## 5. Backend API Contract Dependencies

### 5.1 Endpoint Inventory & Versioning Strategy
The backend specification `AUTH-D01` establishes a dedicated `/api/v2/auth` namespace. The mobile application must preserve compatibility with `/api/auth/*` for legacy environments while transitioning to `/api/v2/auth/*` for OTP and Google OIDC.

| Endpoint | Version | Auth Required | Status | Mobile Contract Responsibility |
|---|---|---|---|---|
| `POST /api/auth/login` | v1 | Public | `[EXISTING]` | Legacy email/password login. Returns token on success. |
| `POST /api/auth/register` | v1 | Public | `[EXISTING]` | Legacy registration. Auto-verifies and returns token immediately. |
| `GET /api/auth/me` | v1 | Sanctum Bearer | `[EXISTING]` | Fetch account info (`id`, `name`, `email`). |
| `DELETE /api/auth/logout` | v1 | Sanctum Bearer | `[EXISTING]` | Revokes current Sanctum personal access token. |
| `GET /api/mobile/context` | v1 | Sanctum Bearer + `mobile` | `[EXISTING]` | Authoritative tenant context (memberships, role, outlets, device context). |
| `POST /api/mobile/devices` | v1 | Sanctum Bearer + `mobile` | `[EXISTING]` | Device registration (restricted to `owner` and `member`). |
| `POST /api/v2/auth/register` | v2 | Public (throttled) | `[PENDING BACKEND]` | Registers pending user, generates 6-digit OTP, sends email. Returns `202 PENDING_EMAIL`. **No bearer token**. |
| `POST /api/v2/auth/otp/resend` | v2 | Public (throttled) | `[PENDING BACKEND]` | Resends OTP after cooldown (min 60s). Returns `202 Accepted`. |
| `POST /api/v2/auth/otp/verify` | v2 | Public (throttled) | `[PENDING BACKEND]` | Atomically verifies OTP, marks email verified, idempotently provisions business/outlet. Returns `200 VERIFIED`. **No bearer token**. |
| `POST /api/v2/auth/login` | v2 | Public (throttled) | `[PENDING BACKEND]` | Password login. Returns `200` with Sanctum token, or `202` with 2FA challenge. |
| `POST /api/v2/auth/2fa/verify` | v2 | Public + Challenge | `[PENDING BACKEND]` | Completes TOTP or recovery code challenge. Returns `200` with Sanctum token. |
| `POST /api/v2/auth/google` | v2 | Public (throttled) | `[PENDING BACKEND]` | Validates Google ID Token, verifies signature/claims, resolves account, returns `200` with Sanctum token or `202` 2FA challenge. |
| `POST /api/v2/auth/reauthenticate` | v2 | Sanctum Bearer + `mobile` | `[PENDING BACKEND]` | Reauthenticates password/2FA for sensitive operations (account linking). |
| `POST /api/v2/auth/google/link` | v2 | Sanctum Bearer + Reauth | `[PENDING BACKEND]` | Attaches verified Google identity (`sub`) to authenticated account. |
| `DELETE /api/v2/auth/google` | v2 | Sanctum Bearer + Reauth | `[PENDING BACKEND]` | Unlinks Google identity if alternative login exists. |

---

## 6. Proposed Email OTP UI Flow `[PROPOSED]`

### 6.1 User Experience & Interaction Architecture
The manual registration flow is split into a multi-step sequence that maintains local POS data safety:

```
[Form: Input Register Data]
           |
           v (Submit POST /api/v2/auth/register)
[State: REGISTER_PENDING_OTP]
           |
           +---> [Screen: 6-Digit OTP Input & Countdown]
           |         |
           |         +---> [Action: Resend OTP (Cooldown 60s)]
           |         |
           |         +---> [Action: Change Email / Back]
           |         |
           |         v (Submit POST /api/v2/auth/otp/verify)
           +---> [Verify Success (200 VERIFIED)]
                     |
                     v (Auto-Login or Direct Password Submit)
           +---> [POST /api/v2/auth/login]
                     |
                     v
           [State: AUTHENTICATED -> Context & Linking Flow]
```

### 6.2 Step-by-Step UI Specifications
1. **Registration Form:**
   - Inputs: `Nama Lengkap`, `Nama Usaha (Opsional)`, `Email`, `Password` (min 8 char), `Konfirmasi Password`.
   - On submit: button enters loading state. Client validates matching passwords before dispatch.
   - Endpoint: `POST /api/v2/auth/register`.
   - Payload: `{ name, email, password, password_confirmation, business_name }`.
   - Response `202 PENDING_EMAIL`: Client transitions to `REGISTER_PENDING_OTP`.
   - Transient Memory: Client preserves `{ email, registration_id }` in component state. **Never writes plaintext password to disk**.

2. **OTP Verification Screen:**
   - **Header:** *"Verifikasi Email Anda"*.
   - **Instruction:** Shows destination email (e.g. *"Masukkan 6 digit kode yang dikirimkan ke **user@domain.com**"*).
   - **Input Control:** 6 separate single-digit numeric boxes or a formatted numeric input (`inputmode="numeric"`, `pattern="[0-9]*"`, `maxlength="6"`), auto-focusing next digit and supporting paste of 6-digit text.
   - **Countdown Timer:** Backend contract TTL is 10 minutes; resend cooldown is 60 seconds (`AUTH-D01 Section 6.1`). Display active countdown: *"Kirim ulang kode dalam 00:59"*.
   - **Resend Action:** Button *"Kirim Ulang Kode"* is disabled until countdown reaches 0. Clicking sends `POST /api/v2/auth/otp/resend` with `{ email, registration_id }`. Resets cooldown to 60s.
   - **Edit Email Action:** Link *"Salah alamat email? Ubah email"* allows user to cancel pending registration and return to form.

3. **Verification Submission:**
   - Automatically triggers when 6th digit is entered, or via *"Verifikasi"* button.
   - Endpoint: `POST /api/v2/auth/otp/verify`.
   - Payload: `{ email, registration_id, otp: "123456" }`.
   - **Success (`200 OK`):** Backend has marked email verified and idempotently provisioned default business. Client automatically executes `cloudStore.login(email, password)` to obtain the Sanctum bearer token and advance to business selection.

4. **Error Handling & Edge Cases:**
   - **Invalid Code (`422 / 400 OTP_INVALID`):** Display error *"Kode OTP salah. Sisa percobaan: X"*. Clear OTP input and auto-focus first box.
   - **Expired Code (`410 / 400 OTP_EXPIRED`):** Display error *"Kode OTP telah kedaluwarsa. Silakan kirim ulang kode baru."*.
   - **Too Many Attempts (`429 OTP_MAX_ATTEMPTS`):** Challenge is invalidated. UI transitions to `OTP_VERIFICATION_FAILED` and prompts user to request a fresh challenge.
   - **Network Failure:** Display non-blocking banner *"Koneksi terputus. Kode OTP Anda tidak hilang, coba tekan verifikasi lagi saat online."*.
   - **Offline Mode Safety:** The user can back out to POS Free mode at any time. Local catalog and transactions are completely unaffected.

---

## 7. Proposed Google Sign-In Android Flow `[PROPOSED]`

### 7.1 Android Native Integration Strategy
To achieve a secure, seamless Google Sign-In experience in Capacitor on Android, two approaches were audited:
- **Approach A: Android Credential Manager API via custom Capacitor plugin:** The modern Android 14+ standard (backward compatible to Android 4.4 via Jetpack `androidx.credentials`). Provides bottom-sheet Passkey and Google ID token selection.
- **Approach B: Established Capacitor Plugin (`@codetrix-studio/capacitor-google-auth`):** Mature plugin utilizing Google Play Services Auth (`GoogleSignInClient`).

**Contract Recommendation:** Standardize on official Google Play Services OpenID Connect ID token retrieval. The client-side plugin must request `serverClientId` (the Web application client ID), causing Google Play Services to return a cryptographically signed OIDC ID Token (`id_token`).

```
+-----------------------------------------------------------------------------+
|                     Android Device (Native Layer)                           |
|   1. User taps "Masuk dengan Google" in CloudLoginView                     |
|   2. Capacitor Bridge triggers GoogleAuth.signIn()                          |
|   3. Google Play Services displays native Google account picker             |
|   4. User selects account -> Google returns Google ID Token (JWT)           |
+-----------------------------------------------------------------------------+
                                      |
                                      | 5. Native returns id_token to JS
                                      v
+-----------------------------------------------------------------------------+
|                     Mobile Application (Web Layer)                          |
|   6. CloudLoginView receives id_token                                       |
|   7. Dispatches POST /api/v2/auth/google with { id_token, platform: 'android' }
|   * CRITICAL: Google ID token is NEVER stored in tokenRepository!          |
+-----------------------------------------------------------------------------+
                                      |
                                      | 8. HTTPS API Request
                                      v
+-----------------------------------------------------------------------------+
|                     Backend (pos_dashboard Sanctum)                         |
|   9. Validates JWT signature via Google JWKS discovery                      |
|  10. Asserts iss, aud == WEB_CLIENT_ID, exp, email_verified === true        |
|  11. Resolves/provisions user from Google sub (never trusts client email)  |
|  12. Issues standard POS Sanctum Bearer Token ('mobile' ability)            |
+-----------------------------------------------------------------------------+
                                      |
                                      | 13. Returns Sanctum token
                                      v
+-----------------------------------------------------------------------------+
|                     Mobile Application Session                              |
|  14. Stores Sanctum token in tokenRepository (Keystore)                     |
|  15. Calls GET /api/mobile/context -> Enters standard business link flow   |
+-----------------------------------------------------------------------------+
```

### 7.2 Google Cloud Console & Keystore Configuration Requirements
- **Package Name:** `com.posoffline.app` (defined in `android/app/build.gradle:92`).
- **OAuth 2.0 Client IDs Required:**
  1. **Android Client ID:** Registered with `com.posoffline.app` and SHA-1 fingerprint of signing keys.
  2. **Web Application Client ID (`serverClientId`):** Used as the backend verification audience (`aud`). This Client ID is passed to Google Sign-In on mobile so that the resulting ID token's audience matches what the backend validates.
- **Signing Keystores:**
  - **Debug Keystore:** `~/.android/debug.keystore` SHA-1 for development.
  - **Release Keystore:** SHA-1 of `POS_RELEASE_STORE_FILE` / `keystore.properties` (`android/app/build.gradle:25-44`) for production APK/AAB.
- **No Client Secrets on Mobile:** Client secrets must **never** be included in Android build files or JavaScript bundles.

### 7.3 Google Sign-In Edge Cases & Mitigations
| Scenario | Backend Contract Response | Mobile UI / Store Behavior |
|---|---|---|
| User cancels account picker | Google SDK throws `SIGN_IN_CANCELLED` / code `12501` | Reset button loading state silently. No error banner displayed. |
| Google Play Services missing / outdated | Google SDK throws `SERVICE_MISSING` / code `1` | Show banner: *"Layanan Google Play diperlukan untuk masuk dengan Google. Perbarui Google Play Services atau gunakan email & password."*. |
| Valid Google Token, New Account | `200 OK` + Sanctum Token | Save Sanctum token -> fetch context -> proceed to business setup. |
| Valid Google Token, Existing Linked Account | `200 OK` + Sanctum Token | Save Sanctum token -> fetch context -> proceed to business setup. |
| Account Collision (Manual account exists with same email, but `sub` not linked) | `409 Conflict ACCOUNT_LINK_REQUIRED` | Do NOT log in. Transition UI to `ACCOUNT_LINK_REQUIRED` state. Prompt user: *"Akun dengan email ini sudah terdaftar manual. Silakan masuk dengan password Anda terlebih dahulu, lalu tautkan akun Google di menu Pengaturan."*. |
| Google Account has 2FA enabled on POS | `202 Accepted TWO_FACTOR_REQUIRED` + Challenge | Transition UI to `TWO_FACTOR_REQUIRED` state. User must enter TOTP/recovery code before receiving Sanctum token. **Google login is never a 2FA bypass**. |
| Google ID Token as Session Token | Prohibited | **Strict rule:** Google ID Token is ephemeral and discarded immediately after exchange. Only the POS Sanctum token is passed to `tokenRepository.saveToken()`. |

---

## 8. Authentication UI State Machine `[PROPOSED]`

```
                       +-------------------------+
                       |     UNAUTHENTICATED     |<----------------------------+
                       +------------+------------+                             |
                                    |                                          |
         +--------------------------+--------------------------+               |
         | Manual Register          | Manual Login             | Google Tap    |
         v                          v                          v               |
+-------------------+      +-------------------+      +--------------------+   | Cancel /
| REGISTER_PENDING_ |      |   AUTHENTICATED   |      | GOOGLE_AUTH_       |   | Network
|       OTP         |      | (Sanctum Issued)  |      |     PENDING        |   | Error
+---------+---------+      +---------+---------+      +---------+----------+   |
          |                          ^                          |              |
          | OTP Verify OK            | Google OK (No 2FA)       | Exchange     |
          | + Auto-Login             +--------------------------+              |
          |                                                     |              |
          | OTP Expired / Max Attempts                          | 409 Link     |
          v                                                     v Req          |
+-------------------+                                 +--------------------+   |
| OTP_VERIFICATION_ |                                 | ACCOUNT_LINK_      |---+
|      FAILED       |                                 |      REQUIRED      |
+---------+---------+                                 +--------------------+   |
          |                                                                    |
          | Restart                                                            |
          +--------------------------------------------------------------------+
                                     |
                                     | 403 / 202 2FA Required
                                     v
                          +--------------------+
                          | TWO_FACTOR_        |
                          |     REQUIRED       |
                          +----------+---------+
                                     |
                                     | TOTP / Recovery Code Valid
                                     v
                          +--------------------+
                          |   AUTHENTICATED    |
                          +----------+---------+
                                     |
                                     | GET /api/mobile/context
                                     v
                          +--------------------+
                          |  SELECT_BUSINESS   |
                          +----------+---------+
                                     |
                                     | Outlet Selected + Workspace Aligned
                                     v
                          +--------------------+
                          |    CLOUD_READY     |
                          +--------------------+
```

### 8.1 State Definitions & Invariants

1. **`UNAUTHENTICATED` `[EXISTING]`:**
   - Active state when no valid token exists in `tokenRepository`.
   - UI shows Login and Register tabs, email/password fields, and Google Sign-In button.
   - POS Free mode operates normally offline.

2. **`REGISTER_PENDING_OTP` `[PROPOSED]`:**
   - Entered when `POST /api/v2/auth/register` returns `202 PENDING_EMAIL`.
   - UI displays 6-digit OTP input boxes, 60s resend cooldown countdown, and change email option.
   - No Sanctum token exists. Cloud sync and Cloud business endpoints remain unreachable.

3. **`OTP_VERIFICATION_FAILED` `[PROPOSED]`:**
   - Entered when OTP attempts exceed limit (5 attempts) or TTL (10 minutes) expires.
   - UI informs user the challenge has expired and offers a one-click action to request a fresh OTP challenge.

4. **`GOOGLE_AUTH_PENDING` `[PROPOSED]`:**
   - Entered when user clicks "Masuk dengan Google". Native Google account picker is active.
   - UI shows button loading indicator. Cancel returns cleanly to `UNAUTHENTICATED`.

5. **`ACCOUNT_LINK_REQUIRED` `[PROPOSED]`:**
   - Entered when Google Sign-In returns `409 ACCOUNT_LINK_REQUIRED`.
   - UI displays modal/card explaining that an account with this email exists with a manual password. Directs user to log in with password and link Google under Settings.

6. **`TWO_FACTOR_REQUIRED` `[PROPOSED]`:**
   - Entered when password login or Google login returns `202 TWO_FACTOR_REQUIRED` with a temporary challenge token.
   - UI renders 6-digit TOTP code input with a toggle to switch to 8-character single-use recovery code.
   - No operational bearer token is stored until `POST /api/v2/auth/2fa/verify` succeeds.

7. **`AUTHENTICATED` `[EXISTING]`:**
   - Sanctum token successfully validated and stored in `tokenRepository`.
   - User identity `{ id, name, email }` hydrated into `cloudSessionStore`.
   - Triggers `fetchMobileContext()`.

8. **`SELECT_BUSINESS` `[EXISTING]`:**
   - User reviews list of authorized cloud businesses.
   - If single business -> prompts `confirm-link`. If multiple -> picker list displayed.
   - Outlets filtered for `status === 'active'`.

9. **`CLOUD_READY` `[EXISTING]`:**
   - Cloud business and outlet confirmed.
   - Device registered or resolved (`resolveCashierDevice` for cashier; `doRegisterDevice` for owner/member).
   - Operational context active (`isOperationalCloudAccess === true`).
   - Sync engine unlocked; initial cloud data pull may proceed if workspace is aligned.

---

## 9. Cloud Session Integration

### 9.1 Store State Properties & Actions Mapping

| Property / Action | Current Behavior `[EXISTING]` | Target Behavior `[PROPOSED]` |
|---|---|---|
| `isAuthenticated` | `computed(() => user.value !== null)` | Remains unchanged. Evaluates to true only after valid Sanctum token is issued. |
| `isLinked` | `computed(() => isAuthenticated && selectedBusiness !== null)` | Remains unchanged. Requires explicit confirmation of business link. |
| `isOperationalCloudAccess` | `computed(() => cloudAccess && isWorkspaceAligned && !workspaceRecoveryRequired)` | Remains unchanged. Strict boundary protecting local POS operations. |
| `login(email, password)` | Calls v1 `/api/auth/login`. On 2FA, halts with error. | Update in `AUTH-M03`: Support v2 challenge response; if `202 TWO_FACTOR_REQUIRED`, transition to 2FA challenge state without storing invalid token. |
| `register(payload)` | Calls v1 `/api/auth/register`, expects instant token. | Update in `AUTH-M03`: Call `/api/v2/auth/register`, handle `202 PENDING_EMAIL`, manage OTP challenge lifecycle. |
| `loginWithGoogle(idToken)` | Non-existent. | New Action in `AUTH-M04`: Calls `POST /api/v2/auth/google`, receives Sanctum token or 2FA challenge, transitions cleanly. |
| `verifyOtp(payload)` | Non-existent. | New Action in `AUTH-M03`: Calls `POST /api/v2/auth/otp/verify`, then automates Sanctum login. |
| `resendOtp(payload)` | Non-existent. | New Action in `AUTH-M03`: Calls `POST /api/v2/auth/otp/resend` with 60s cooldown enforcement. |
| `verify2Fa(payload)` | Non-existent. | New Action in `AUTH-M05`: Calls `POST /api/v2/auth/2fa/verify` to exchange challenge token for Sanctum bearer token. |

---

## 10. Business & Outlet Selection Compatibility `[EXISTING]`

The existing business and outlet selection logic is well-engineered and must be **strictly preserved** during the UI refactor:

1. **No Auto-Link:** Single business accounts must always display the `confirm-link` card (`CloudLoginView.vue:2635-2686`) showing:
   - Local business name (`localBusinessName`)
   - Cloud account email (`cloudAccountEmail`)
   - Cloud business name (`pendingBusiness.name`)
2. **Multi-Business Picker:** Multiple businesses must render the selection list (`CloudLoginView.vue:2564-2591`). Arbitrary business IDs injected from outside the membership list are rejected (`prem-m03-cloud-login.spec.js:301-322`).
3. **Active Outlet Enforcement:** Outlets with `status !== 'active'` are filtered out. If an outlet becomes inactive on the server, `refreshContext()` invalidates the outlet selection (`cloudSessionStore.js:1676-1680`).
4. **Role-Based Device Binding (INT-02):**
   - **`cashier`:** Strictly forbidden from calling `POST /api/mobile/devices`. Resolves pre-registered device from `device_context` matching this installation's stable `deviceIdentifier`.
   - **`owner` / `member`:** Executes `doRegisterDevice({ platform })`.
5. **Workspace Alignment (`isWorkspaceAligned`):**
   - If the active local SQLite database belongs to a different business identity, activation halts with `BUSINESS_SWITCH_CONFIRMATION_REQUIRED`.
   - User must explicitly confirm in the switch modal before `switchOperationalWorkspace()` executes.
   - **Local data is never overwritten or deleted**; a full snapshot of the previous workspace is archived before activating the new workspace.

---

## 11. Secure Storage Policy `[EXISTING]`

| Storage Mechanism | Permitted Data | Strictly Prohibited Data |
|---|---|---|
| **Android Keystore / iOS Keychain** (`@aparajita/capacitor-secure-storage`) | Sanctum Bearer Token (`cloud_bearer_token`). | Passwords, OTP codes, Google ID tokens, local POS transaction data. |
| **SQLite `app_meta` & `cloud_context`** (Database persistence adapter) | Non-sensitive cloud context (`user.id`, `user.name`, `user.email`, `selectedBusiness`, `selectedOutlet`, `registeredDeviceId`, `role`, `syncCapabilities`, `deviceIdentifier`). | Bearer tokens, passwords, OTP codes, Google credentials. |
| **Pinia Stores** (`cloudSessionStore`) | In-memory reactive state of non-sensitive context, loading flags, error strings. | Bearer tokens, passwords, OTP codes. |
| **`localStorage` / `sessionStorage`** | **STRICTLY ZERO DATA.** Unencrypted web storage is completely prohibited. | Any auth tokens, credentials, or context. |
| **Vue Component State (`ref`)** | Transient OTP input string (during verification only), password input during form editing. | Permanent storage. Discarded as soon as form unmounts or completes. |

---

## 12. Authentication Error Mapping

### 12.1 Error Code Classifier Matrix
Updating `cloudLoginErrors.js` to support new v2 error states:

| HTTP Status | Error Code (`error.code`) | Error Kind (`kind`) | User-Facing Indonesian Message (`message`) |
|---|---|---|---|
| `0` | `NETWORK_ERROR` | `offline` | `"Koneksi internet diperlukan untuk menghubungkan ke Cloud."` |
| `401` | `INVALID_CREDENTIALS` | `invalid-credentials` | `"Email atau password salah."` |
| `401` | `TOKEN_INVALID` | `token-invalid` | `"Sesi Cloud telah berakhir. Silakan masuk kembali."` |
| `403` | `EMAIL_NOT_VERIFIED` | `unverified` | `"Email belum diverifikasi. Silakan masukkan kode OTP yang telah dikirimkan."` |
| `403` / `202` | `TWO_FACTOR_REQUIRED` | `two-factor` | `"Verifikasi dua faktor diperlukan. Masukkan kode autentikasi Anda."` |
| `409` | `ACCOUNT_LINK_REQUIRED` | `account-link-required` | `"Email ini sudah terdaftar dengan password. Silakan login manual dan tautkan akun Google di Pengaturan."` |
| `422` | `VALIDATION_ERROR` | `validation` | Dynamic: reads `errors.email[0]` / `errors.password[0]`, or `"Data yang dimasukkan tidak valid."` |
| `422` | `OTP_INVALID` | `otp-invalid` | `"Kode OTP salah. Silakan periksa kembali email Anda."` |
| `410` | `OTP_EXPIRED` | `otp-expired` | `"Kode OTP telah kedaluwarsa. Silakan tekan Kirim Ulang Kode."` |
| `429` | `OTP_COOLDOWN` | `otp-cooldown` | `"Mohon tunggu beberapa saat sebelum meminta kode baru."` |
| `429` | `OTP_MAX_ATTEMPTS` | `otp-max-attempts` | `"Terlalu banyak percobaan salah. Silakan minta kode OTP baru."` |
| `409` | `IDENTITY_CONFLICT` | `identity-conflict` | `"Akun Google ini terikat pada identitas lain. Hubungi pemilik bisnis."` |
| `500+` | `SERVER_ERROR` | `server` | `"Server Cloud sedang bermasalah. Coba lagi nanti."` |
| Any | `GOOGLE_CANCELLED` | `cancelled` | Empty / null (silent reset, no error banner displayed). |

---

## 13. Offline Mode Compatibility `[EXISTING]`

POS Mobile is built from the ground up as an offline-first system:
1. **Unconstrained Cashier Operations:** A cashier can execute sales, print receipts, open/close shifts, and record cash expenses completely offline without logging into Cloud.
2. **Zero Cloud Gating on Local POS:** The absence of a cloud session (`UNAUTHENTICATED`) or a pending OTP verification (`REGISTER_PENDING_OTP`) must **never** prevent opening POS routes (`/pos`, `/cart`, `/transactions`, `/shift`).
3. **Clean Disconnect ("Putuskan Cloud"):** When a user explicitly disconnects or logs out, local SQLite operational data is kept completely safe. Only cloud sync bindings and stored bearer tokens are revoked (`prem-m03-cloud-login.spec.js:498-524`).
4. **Network Drop Tolerance:** If internet connectivity drops while entering OTP or waiting for Google OIDC callback, the UI presents an offline banner without destroying user form inputs or resetting local state.

---

## 14. Security Risks & Mitigations `[SECURITY FINDING]`

| ID | Severity | Identified Risk | Mobile Evidence | Architectural Mitigation |
|---|---|---|---|---|
| **SEC-M01** | High | Reliance on Auto-Verified Token on Registration. | `authService.js:53-56` expects immediate `result.data.data.token` on registration. | Update in `AUTH-M03`: Refactor `cloudRegister` to anticipate `202 PENDING_EMAIL` and hand off to OTP challenge machine. |
| **SEC-M02** | High | Permanent Lockout for 2FA-Enabled Accounts. | `cloudLoginErrors.js:22` advises user to go to web dashboard; no mobile challenge interface exists. | Implement `TwoFactorChallengeModal.vue` (`AUTH-M05`) accepting 6-digit TOTP and recovery codes. |
| **SEC-M03** | High | Accidental Persistence of Google ID Token. | No current Google implementation; developers might mistake Google `id_token` for POS session token. | Explicit architectural rule: Google `id_token` is ephemeral in memory; only backend-issued Sanctum bearer token is sent to `saveToken()`. |
| **SEC-M04** | Medium | Plaintext OTP Residue in Memory or Storage. | Risk of developers caching OTP code in Pinia or SQLite. | OTP string is strictly confined to transient Vue component ref; never persisted in SQLite or Pinia. |
| **SEC-M05** | Medium | Premature Cloud Sync Pull/Push. | `CloudLoginView.vue:1393` invokes `autoPullAfterActivation()`. | Strict state invariant: `canSync` requires `isAuthenticated && isOperationalCloudAccess && isDeviceRegistered`. Sync cannot run during OTP or Google pending states. |
| **SEC-M06** | Medium | Account Takeover via Automatic Google Email Linking. | Risk of frontend attempting to auto-link Google account by matching email string. | Client adheres to `AUTH-D01 Section 8`: Backend rejects unlinked email match with `409 ACCOUNT_LINK_REQUIRED`. Linking requires authenticated reauth with password proof. |
| **SEC-M07** | Medium | Cross-Tenant Data Contamination on Workspace Switch. | Changing Cloud business could contaminate local SQLite database. | Enforce `businessWorkspaceService` durable transactional switch protocol with rollback journal and pre-switch snapshots. |
| **SEC-M08** | Low | OAuth Client Secret Exposure. | Risk of placing Google Client Secret in Android `build.gradle` or `.env`. | Android Native Google Sign-In only uses Public Client ID (`serverClientId`); secrets are strictly backend-only. |

---

## 15. Proposed Component Architecture `[PROPOSED]`

`CloudLoginView.vue` is currently an unmaintainable 2,989-line monolithic SFC. For `AUTH-M02`, it must be refactored into a clear, modular component tree under `src/views/settings/cloud/` or `src/components/cloud/`:

```
src/views/settings/CloudLoginView.vue (Orchestrator Container, ~350 lines)
â”œâ”€â”€ components/
â”‚   â”œâ”€â”€ CloudAuthCard.vue (Tab switcher: Masuk vs Daftar)
â”‚   â”‚   â”œâ”€â”€ CloudLoginForm.vue (Email, password, show/hide toggle)
â”‚   â”‚   â”œâ”€â”€ CloudRegisterForm.vue (Name, business name, email, passwords)
â”‚   â”‚   â””â”€â”€ CloudGoogleButton.vue (Native Google Sign-In trigger & loading state)
â”‚   â”‚
â”‚   â”œâ”€â”€ CloudOtpModal.vue (6-digit OTP input, 60s cooldown timer, resend button)
â”‚   â”œâ”€â”€ CloudTwoFactorModal.vue (TOTP 6-digit challenge & recovery code toggle)
â”‚   â”œâ”€â”€ CloudAccountLinkModal.vue (Explains 409 collision, guides to manual login)
â”‚   â”‚
â”‚   â”œâ”€â”€ CloudSelectBusiness.vue (Business picker list)
â”‚   â”œâ”€â”€ CloudConfirmLink.vue (Single business link confirmation)
â”‚   â”œâ”€â”€ CloudSelectOutlet.vue (Active outlet picker list)
â”‚   â”‚
â”‚   â”œâ”€â”€ CloudConnectedDashboard.vue (Active session dashboard, account info)
â”‚   â”‚   â”œâ”€â”€ CloudSyncControls.vue (Manual sync, initial cloud pull, bootstrap)
â”‚   â”‚   â”œâ”€â”€ CloudAutoSyncCard.vue (Safe foreground auto-sync toggle)
â”‚   â”‚   â””â”€â”€ CloudActivityLog.vue (10 latest sync audit records)
â”‚   â”‚
â”‚   â””â”€â”€ CloudBusinessSwitchModal.vue (Durable workspace switch confirmation)
```

---

## 16. Regression Test Plan `[EXISTING] & [PROPOSED]`

### 16.1 Existing Baseline Suites (Must Remain 100% Green)
- **`src/__tests__/prem-m03-cloud-login.spec.js` (19 tests):**
  - Confirms offline login failure classification and friendly copy.
  - Confirms explicit linking for single and multiple businesses.
  - Confirms link persistence across restart.
  - Confirms 401 token invalidation clears cloud session without touching local data.
  - Confirms revoked membership invalidates link cleanly.
  - Confirms disconnect ("Putuskan Cloud") preserves all local products, customers, and transactions.
- **`src/__tests__/cloud-login-context.spec.js` (18 tests):**
  - Confirms native secure token storage isolation.
  - Confirms zero-business UI handling.
  - Confirms stable device identifier durability across restart.
  - Confirms strict sync boundary (zero calls to `/api/sync/push` or `/api/sync/pull` during auth).
- **`src/__tests__/onboarding-account-choice.spec.js` (9 tests):**
  - Confirms onboarding choice routing (`/setup/welcome` -> `/setup/cloud`).
  - Confirms back navigation and route accessibility without active business.

### 16.2 New Test Suites Required in AUTH-M02 to M09
1. **`auth-email-otp-flow.spec.js`:**
   - Test registration dispatch -> `202 PENDING_EMAIL` transition.
   - Test OTP input masking, 6-digit auto-submit, and countdown timer.
   - Test resend cooldown lock (disabled for 60s).
   - Test invalid code (422) attempt counter decrement.
   - Test expired code (410) and max attempt lockout (429).
   - Test automatic login execution upon successful OTP verification.
2. **`auth-google-signin.spec.js`:**
   - Test Google button trigger and SDK invocation.
   - Test silent recovery on user cancel (`SIGN_IN_CANCELLED`).
   - Test successful token exchange: Google ID token -> `POST /api/v2/auth/google` -> Sanctum token stored in Keystore.
   - Test collision response: `409 ACCOUNT_LINK_REQUIRED` modal display.
   - Test that Google ID token is never stored in `tokenRepository`.
3. **`auth-2fa-challenge.spec.js`:**
   - Test 2FA challenge response (`202 TWO_FACTOR_REQUIRED`) from both password and Google login.
   - Test TOTP code submission and recovery code fallback submission.
   - Test Sanctum token storage only after 2FA verification completes.

---

## 17. Implementation Dependencies

### 17.1 Backend Dependencies (pos_dashboard)
- **Task Reference:** `AUTH-D01` through `AUTH-D06` in `pos_dashboard`.
- **Preconditions:**
  - Deployment of `/api/v2/auth/register`, `/api/v2/auth/otp/resend`, and `/api/v2/auth/otp/verify`.
  - Deployment of `/api/v2/auth/google` with server-side JWKS validation.
  - Configuration of Google Web OAuth Client ID on the Laravel server (`GOOGLE_CLIENT_ID`).

### 17.2 Android Native Dependencies (pos-mobile)
- **Google Play Services Auth:** Plugin or native bridge dependency in `android/app/build.gradle`.
- **Keystore Fingerprints:**
  - SHA-1 fingerprint for Debug Keystore added to Google Cloud Console.
  - SHA-1 fingerprint for Release Keystore (`POS_RELEASE_STORE_FILE`) added to Google Cloud Console.
- **Environment Variables:**
  - `VITE_GOOGLE_WEB_CLIENT_ID`: Public Web Client ID passed to GoogleAuth plugin for ID token audience targeting.

---

## 18. Open Decisions

1. **OTP Verification Completion Path:**
   - *Option A (Recommended):* `/api/v2/auth/otp/verify` returns `200 VERIFIED`, and mobile client uses the cached form credentials in memory to immediately execute `cloudStore.login(email, password)` seamlessly without user friction.
   - *Option B:* After OTP verification, client transitions back to Login tab and asks user to manually re-enter password.
   - *Decision:* Option A provides the best UX while respecting security boundaries (credentials held only in transient memory during registration).
2. **Capacitor Google Auth Plugin Choice:**
   - *Option A (Recommended):* Standardize on `@codetrix-studio/capacitor-google-auth` for broad community support and proven Capacitor 8 compatibility.
   - *Option B:* Implement custom native Capacitor plugin directly wrapping Android `androidx.credentials.CredentialManager`.
   - *Decision:* Finalize in `AUTH-M04` spike.
3. **Post-Google Linking Flow:**
   - Whether account linking (`POST /api/v2/auth/google/link`) should be offered immediately when `409 ACCOUNT_LINK_REQUIRED` occurs (by asking for password inline), or exclusively managed inside `SettingsView.vue` after manual login.
   - *Recommendation:* Prompt user to log in manually first to prevent complex multi-factor state transitions in the login view.

---

## 19. Acceptance Criteria Checklist

- [x] Existing Cloud Login architecture audited and documented (`authService.js`, `cloudLoginErrors.js`, `cloudSessionStore.js`, `tokenRepository.js`, `CloudLoginView.vue`).
- [x] Manual registration and 6-digit email OTP UI flow specified with countdown, resend cooldown, and error handling.
- [x] Google Sign-In Android native flow specified (OAuth client IDs, debug/release signing, ID token exchange, cancellation, account collision).
- [x] Dashboard API contract dependencies mapped against `AUTH-D01` with clear `[PENDING BACKEND]` indicators.
- [x] Complete Authentication UI State Machine designed (`UNAUTHENTICATED` to `CLOUD_READY`).
- [x] Token security invariants preserved: Google ID token never stored as session token; bearer token stored strictly in Keystore/Keychain; no tokens in `localStorage` or SQLite.
- [x] Local POS operational data safety maintained: zero data loss, zero auto-switch without user confirmation.
- [x] Modular component architecture designed to refactor monolithic `CloudLoginView.vue`.
- [x] Zero application source code files modified in `src/` or `android/`.
- [x] Zero npm dependencies added or modified.
- [x] Exactly one documentation file created: `docs/auth/AUTH_M01_CLOUD_LOGIN_UI_CONTRACT.md`.

---

## 20. Next Tasks: AUTH-M02 â€“ M09 Roadmap

- **AUTH-M02: Cloud Login UI Component Refactoring**
  - Break down 2,989-line `CloudLoginView.vue` into focused components (`CloudAuthCard`, `CloudLoginForm`, `CloudRegisterForm`, `CloudSelectBusiness`, `CloudConfirmLink`, `CloudSelectOutlet`).
  - Preserve 100% test pass on existing 46 unit tests.
- **AUTH-M03: Email OTP Registration UI Implementation**
  - Implement 6-digit OTP input component, 60s cooldown timer, and resend action.
  - Implement `/api/v2/auth/register`, `/api/v2/auth/otp/verify`, and `/api/v2/auth/otp/resend` client integration.
- **AUTH-M04: Google Sign-In Android Native Integration**
  - Integrate Capacitor Google Auth plugin. Configure Android Web Client ID and signing fingerprints.
  - Implement Google ID token exchange to `/api/v2/auth/google`.
- **AUTH-M05: Mobile Two-Factor Authentication (2FA) Challenge UI**
  - Implement `CloudTwoFactorModal` for TOTP and recovery code submission against `/api/v2/auth/2fa/verify`.
- **AUTH-M06: Account Linking & Collision Handling UI**
  - Handle `409 ACCOUNT_LINK_REQUIRED` gracefully.
  - Add Google Account linking / unlinking actions under `SettingsView.vue`.
- **AUTH-M07: Error Handling & Offline Experience Hardening**
  - Integrate updated `cloudLoginErrors.js` error matrix. Hardening network drop recovery.
- **AUTH-M08: End-to-End Unit & Integration Test Suite**
  - Implement new test suites covering OTP, Google Sign-In, 2FA challenge, and state machine transitions.
- **AUTH-M09: Android Production Device QA & Release Sign-Off**
  - Physical Android device validation with Google Play Services, debug/release APK signing, and security audit.
