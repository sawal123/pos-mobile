# AUTH-M07 — Password Recovery & Verified Email Change

## 1. UI Flow and Routes

AUTH-M07 integrates Password Recovery and Verified Email Change directly into the operational Cloud authentication surfaces (`/cloud` and `/setup/cloud` via `src/views/settings/CloudLoginView.vue`, plus direct navigation from `/settings` via `src/views/settings/SettingsView.vue`):

- **Password Recovery Flow** (`CloudLoginView.vue` → `CloudAuthCard.vue` → `CloudForgotPasswordForm.vue` → `CloudResetPasswordForm.vue`):
  ```text
  Cloud Login
      ↓ (Lupa Password?)
  CloudForgotPasswordForm (input email)
      ↓ (POST /api/v2/auth/password/forgot → HTTP 202)
  Generic Anti-Enumeration Confirmation + Official Link/Token Instructions
      ↓ (Buka tautan reset web atau pilih "Saya Sudah Punya Token Reset")
  CloudResetPasswordForm (email + token + password + password_confirmation)
      ↓ (POST /api/v2/auth/password/reset → HTTP 200)
  Reset Success (no auto-login; active same-account session invalidated locally)
      ↓
  Kembali ke Login Cloud
  ```
- **Verified Email Change Flow** (`SettingsView.vue` → `CloudLoginView.vue` → `CloudEmailChangeCard.vue`):
  ```text
  Akun Cloud Terautentikasi
      ↓ (Ganti Email)
  Input Email Baru + Bukti Kepemilikan (Password Saat Ini / Fresh Google Proof + Conditional TOTP)
      ↓ (POST /api/v2/auth/email/change/request → HTTP 202 pending_verification)
  Form Verifikasi OTP 6 Digit (email akun belum berubah pada tahap ini)
      ↓ (POST /api/v2/auth/email/change/verify → HTTP 200 verified, reauthentication_required=true)
  Sesi Sanctum Dicabut di Server & Dibersihkan secara Ownership-Aware di Mobile
      ↓
  Login Ulang dengan Email Baru
  ```

Users can return to offline POS (`Gunakan POS Offline`) at any point without completing Cloud authentication.

## 2. Password Recovery API

- **Forgot Password**: `POST /api/v2/auth/password/forgot` (`cloudForgotPassword(email)` in `src/services/cloud/authService.js`)
  - Unauthenticated JSON request `{ "email": "user@example.com" }`.
  - Requires HTTP `202` with no bearer token. Any non-`202` status or unexpected `token` field fails closed (`INVALID_FORGOT_PASSWORD_RESPONSE`).
  - Displays the curated anti-enumeration message:
    `"Jika akun memenuhi syarat, instruksi pemulihan akan dikirim ke alamat email tersebut. Periksa kotak masuk dan folder spam."`
  - Never reveals whether an email is registered, unverified, pending, broker-throttled, or Google-only.
- **Reset Password**: `POST /api/v2/auth/password/reset` (`cloudResetPassword({ email, token, password, password_confirmation })`)
  - Unauthenticated JSON request.
  - Requires HTTP `200` and never accepts or persists a bearer token.
  - Maps `PASSWORD_RESET_INVALID` (`422`), `PASSWORD_RESET_EXPIRED` (`410`), validation errors (`422`), rate limits (`429`), and network errors (`0`) via `describeResetPasswordError()` in `src/services/cloud/cloudLoginErrors.js` without echoing server strings or secrets.

## 3. Reset-Link Destination Limitations

Backend reset links are generated from server-configured `AUTH_PASSWORD_RESET_URL` (or fallback `APP_URL`) and target the web Dashboard Fortify reset route. Mobile does **not** fabricate custom Android App Links or unverified deep-link schemes. Instead:

1. Users may complete the password reset directly in the official web Dashboard opened from the email link, **or**
2. Enter the official single-use broker reset token explicitly in `CloudResetPasswordForm.vue`.
3. Android App Links / universal link verification requires dedicated server `.well-known/assetlinks.json` and native intent-filter configuration, which is documented as separate work and not claimed in AUTH-M07.

## 4. Reset Token Security

- The reset token is held only in transient component memory in `CloudResetPasswordForm.vue` (`autocomplete="off"`).
- Cleared immediately when `successMessage` is set or when the component unmounts.
- Never written to `localStorage`, `sessionStorage`, SQLite, Pinia persisted state, query logs, or error banners.
- After HTTP `200`, if the currently authenticated local Cloud session belongs to the same normalized email address, `cloudSessionStore.resetPassword()` invalidates that local session in an ownership-aware manner while leaving any other account's session untouched.

## 5. Password Eligibility Ambiguity

Backend tracks `users.password_login_enabled` (`true` for manual accounts, `false` for Google-only accounts, `NULL` for legacy pre-marker accounts), but `GET /api/v2/auth/me` currently returns only `authentication_methods` (`['manual']`, `['google']`, or `['manual', 'google']`), `email_verified`, and `two_factor_enabled`.

Mobile never fabricates or infers `password_login_enabled`:
- It inspects `authentication_methods` from `/api/v2/auth/me` to offer appropriate UI defaults (`google` proof mode when only `'google'` is reported, `password` proof mode otherwise).
- It allows explicit switching between Password proof and fresh Google proof when needed and delegates authoritative proof validation to the backend.

## 6. Manual Versus Google-Only Email-Change Proof

`POST /api/v2/auth/email/change/request` (`cloudRequestEmailChange()`):
- **Manual & Manual + Google-linked accounts**: Backend requires `current_password` (and `totp_code` when confirmed 2FA is enabled). Even if a Google identity is linked, Google ID tokens do not substitute for `current_password`.
- **Google-only accounts (`password_login_enabled === false`)**: Backend requires a fresh `id_token` from `signInWithGoogle()` and `client_platform: "android"` whose verified `sub` belongs to the authenticated user (plus `totp_code` when confirmed 2FA is enabled).
- **Explicit 401 distinction**: When the backend rejects a wrong password with HTTP `401 INVALID_CREDENTIALS`, `cloudSessionStore.requestEmailChange()` treats it strictly as a proof failure and **never** calls `handleInvalidToken()`. Only an unauthenticated/revoked session `401` (where `code !== 'INVALID_CREDENTIALS'`) invalidates the local session.

## 7. OTP Flow

On HTTP `202` from `/api/v2/auth/email/change/request`:
- Contract validation requires `change_id`, `state === "pending_verification"`, and valid ISO-8601 timestamps for `otp_expires_at` and `resend_available_at`.
- `cloudStore.user.email` remains the original server email until HTTP `200` from `/api/v2/auth/email/change/verify`.
- `CloudEmailChangeCard.vue` displays a live countdown derived from `otp_expires_at` and requires an explicit 6-digit numeric OTP submission (no auto-submit).
- `POST /api/v2/auth/email/change/verify` must be called using the exact same Sanctum token and user session that initiated `change_id`.

## 8. Absence of Email-Change Resend Endpoint

Although the `202` payload includes `resend_available_at` from the shared OTP challenge infrastructure, the backend does **not** expose a resend endpoint for `email_change`. Mobile does not render a fake resend button or call registration's `/api/v2/auth/otp/resend`. Instead, `CloudEmailChangeCard.vue` informs the user that if the code expires, they should cancel and submit a new email-change request once the server cooldown permits.

## 9. Session Revocation After Success

When `POST /api/v2/auth/email/change/verify` returns HTTP `200` with `state === "verified"` and `reauthentication_required === true`:
1. The backend revokes all Sanctum tokens for the user.
2. Mobile clears in-memory email-change metadata and secrets.
3. Mobile removes the current bearer token from `tokenRepository` via `removeTokenIfMatchesDetailed(currentToken)` without calling `DELETE /api/auth/logout`.
4. Mobile clears persisted `cloud_context` from the adapter, immediately rechecks `isCurrentSessionOperation(operation)` and expected user identity after `await _adapter.clearCloudContext()` (re-persisting any newer session's context if replaced mid-cleanup), and only then resets `cloudSessionStore` state, marks `sessionInvalid = true`, switches `businessStore.mode` back to `'free'`, and prompts the user with `"Email berhasil diperbarui. Silakan masuk kembali."`.

## 10. Ownership and Race Handling

- Every `requestEmailChange()` and `verifyEmailChange()` call is guarded by `emailChangeSequence`, `emailChangeUserId`, `emailChangeToken`, and `activeSessionOperation`.
- `resetPassword()` captures session ownership context (`initialUserId`, `initialSessionEmail`, `initialOperationSeq`, and `initialToken`) before sending the unauthenticated reset request:
  - A reset started while unauthenticated (or under another account) never acquires authority to invalidate a session created while the request is in flight.
  - A newer login (including for the same email with a fresh token) is never invalidated by an earlier reset operation.
  - Secure storage read/removal failures fail closed for the owned in-memory session without calling unconditional `removeToken()` and report `sessionInvalidated: false`, `sessionCleanupState: 'storage_failure'`, `storageFailure: true` distinct from the HTTP `200` password-reset success.
- If the user logs out or switches from Account A to Account B while an email-change request, OTP verification, or async adapter context cleanup (`_adapter.clearCloudContext()`) is pending:
  - Pending state for Account A is immediately cleared.
  - Account A's `change_id` / OTP cannot be verified with Account B's token.
  - Account A's session revocation or delayed context cleanup cannot remove Account B's token, clear Account B's in-memory session/business/outlet, reset `businessStore.mode`, or destroy Account B's persisted `cloud_context`.
- If `POST /api/v2/auth/email/change/verify` fails with a network timeout (`status === 0` / `NETWORK_ERROR`), mobile performs a read-only `/api/v2/auth/me` check:
  - If `/api/v2/auth/me` returns `401`, mobile revokes the local session safely, emits `session-revoked` with `{ outcome: 'uncertain' }`, and displays `"Sesi Cloud telah berakhir, tetapi perubahan email belum dapat dipastikan. Periksa email akun atau masuk kembali."` without claiming authoritative success or auto-filling the new email.

## 11. Offline-First Guarantees

Throughout all Password Recovery and Verified Email Change flows (including errors, timeouts, expiries, and session revocations), the following local data remains untouched:
- SQLite database, products, categories, transactions, payments, stock movements, customers, expenses, cash ledger, shifts, and local business settings.
- Workspace registry, active workspace, workspace switch journal, and pending recovery state.
- Sync queue, in-flight envelopes, sync cursors, sync bindings, sync identity map, and local backups.
- None of `clearLocalData()`, `resetDatabase()`, `deleteWorkspace()`, `switchOperationalWorkspace()`, `syncPull()`, `syncPush()`, `registerDevice()`, or `checkoutSubscription()` is ever invoked.

## 12. Tests and Baseline Comparison

- Added `src/__tests__/auth-m07-password-recovery-email-change.spec.js` (27 tests covering service contracts, error classifiers, store ownership/revocation, async context cleanup ownership, password-reset session races, uncertain verification outcome UI, keystore failure handling, isolated form validation, and full `CloudLoginView` integration flows).
- All existing AUTH-M04, AUTH-M05, and AUTH-M06 regression suites pass without modification.

## 13. Android / Live-Mail QA Checklist

- [ ] Request password recovery from `/cloud` on Android device; verify email arrives with official reset link.
- [ ] Complete password reset and sign in on mobile with the new password; verify existing offline transactions and sync queue remain intact.
- [ ] On an authenticated manual Cloud account, open `/cloud` → `Ganti Email`, submit current password (+ TOTP if 2FA enabled), receive OTP at the new email address, and verify.
- [ ] On an authenticated Google-only Cloud account on Android, open `Ganti Email`, complete native Credential Manager Google proof, and verify OTP.
- [ ] Confirm old Sanctum token is rejected after verification and re-login with the updated email succeeds.

## 14. AUTH-M08 Dependency

Full interactive login 2FA challenge completion (`POST /api/v2/auth/2fa/verify` during login) remains scheduled for **AUTH-M08**. Conditional TOTP input for authenticated email-change ownership proof (`totp_code` on `POST /api/v2/auth/email/change/request`) is supported in AUTH-M07.

## 15. Backend Handoff for Authoritative `password_login_enabled`

To eliminate client-side ambiguity between manual + Google-linked accounts and Google-only accounts prior to submitting proof, backend `GET /api/v2/auth/me` should include an authoritative boolean/nullable field `password_login_enabled` in a future backend update. Until then, mobile safely offers both proof paths and relies on backend enforcement.
