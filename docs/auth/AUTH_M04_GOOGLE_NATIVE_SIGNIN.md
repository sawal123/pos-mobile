# AUTH-M04 — Native Android Google Sign-In

## Scope

AUTH-M04 adds Android-native Google credential acquisition, a single backend
token exchange, and reuse of the existing Cloud Session flow. Manual
email/password login and AUTH-M03 registration/OTP remain unchanged.

The implementation does not add Firebase Authentication, an embedded WebView,
a second auth transport, or any automatic sign-in on app startup/resume.

## Native provider decision

The evaluated candidate was `@capgo/capacitor-social-login` `8.7.0`. Its
official documentation confirms Capacitor 8 compatibility, active v8
maintenance, and Android Credential Manager usage. It was not retained in the
application because its Android online provider persists the Google ID token in
native `SharedPreferences`, while AUTH-M04 requires the assertion to remain in
memory only. Its offline mode returns `serverAuthCode`, which is not the
`id_token` required by `/api/v2/auth/google`.

The selected implementation is the repository-local `GoogleNativeAuthPlugin`
registered beside the existing `BluetoothPrinterPlugin`. It uses Android
Credential Manager directly and returns one fresh Google ID token to the
JavaScript adapter without writing it to app storage.

Native dependencies:

- `androidx.credentials:credentials:1.5.0`
- `androidx.credentials:credentials-play-services-auth:1.5.0`
- `com.google.android.libraries.identity.googleid:googleid:1.1.1`

The Android application identity remains `com.posoffline.app`.

## Configuration

Set the public Web OAuth Client ID at build time:

```text
VITE_GOOGLE_WEB_CLIENT_ID=<Web application OAuth client ID>
```

The value must be the Web application client ID ending in
`.apps.googleusercontent.com`. Do not use an Android client ID in this value.
No client secret, refresh token, Google ID token, Sanctum token, keystore, or
keystore password belongs in the repository or environment exposed to Vite.

The API base must be the HTTPS deployment URL for a real Android build. The
existing `VITE_API_BASE_URL` remains the single API transport configuration.

## Google Cloud Console setup

Create OAuth clients in the same Google Cloud project as the backend:

1. Web application client — its ID is `VITE_GOOGLE_WEB_CLIENT_ID` and is the
   server audience requested by Credential Manager.
2. Android client for the debug certificate.
3. Android client for the release certificate.
4. Android client for the Google Play App Signing certificate when distributing
   through Play Store.

For each Android client, register package name `com.posoffline.app` and the
SHA-1 belonging to the certificate that signs the APK installed for that test.
The backend accepts the Web client ID and configured Android client IDs through
its own `GOOGLE_CLIENT_ID` and `GOOGLE_ANDROID_CLIENT_IDS` configuration.

Check signing certificates with:

```powershell
cd android
.\gradlew.bat signingReport
```

Record debug and release SHA-1 separately. For a signed APK, an additional
check is:

```powershell
keytool -printcert -jarfile android/app/release/app-release.apk
```

Play App Signing SHA-1 must be taken from Play Console → App integrity → App
signing key certificate; the upload key SHA-1 is not a substitute.

## Build and sync commands

```powershell
npm install
npm run build
npx cap sync android
cd android
.\gradlew.bat assembleDebug
```

`MainActivity.java` continues to register the Bluetooth printer plugin and also
registers `GoogleNativeAuthPlugin` before the Capacitor bridge is created.

## Native adapter and lifecycle

`src/services/cloud/googleNativeAuthService.js`:

- accepts Android only; Web/dev preview returns `unsupported_platform`;
- validates the public Web Client ID before native invocation;
- initializes the native provider idempotently;
- allows one active provider operation at a time;
- checks the operation identity after every initialization wait and before each
  native picker launch, including the activity-recovery reinitialization path;
- cancels the active Android Credential Manager request with a keyed
  `CancellationSignal`, so an old page cannot cancel a newer picker;
- maps cancel, unavailable credential/provider, configuration, and provider
  failures to typed states;
- invalidates callbacks when the login view is destroyed or the activity is
  recreated;
- never stores, logs, serializes, or places the ID token in a URL;
- never calls Google automatically during startup or resume.

The native provider uses `GetSignInWithGoogleOption` and a cryptographically
random nonce. The ID token is returned in memory only, then passed to the
existing `apiClient.js` request and released by the UI handoff after the
exchange completes.

## Backend exchange

The service sends exactly one public request for a fresh assertion:

```http
POST /api/v2/auth/google
Accept: application/json
Content-Type: application/json
```

```json
{
  "id_token": "<fresh Google ID token>",
  "client_platform": "android"
}
```

No existing bearer token is attached and the request is not automatically
retried. HTTP 200 is accepted only when `token_type` is `Bearer`, the Sanctum
token is non-empty, and `user.id`, `user.name`, and `user.email` are valid.

The returned Sanctum token is saved only through the existing secure
`tokenRepository` and then `/api/mobile/context` is fetched through the existing
Cloud Session store. Business confirmation, outlet selection, device policy,
entitlement, workspace alignment, and sync guards remain unchanged.

The complete Google flow carries a page-operation guard through native token
acquisition, the v2 exchange, context loading, and finalization. If the page is
unmounted or the operation becomes stale, no new session is activated. If a
token was already saved, the store removes only that same token and clears only
Cloud session/context state; local POS data is not touched.

## Response handling

- Native cancel: loading closes; the user remains on the login screen.
- Provider unavailable: show that Google Sign-In is unavailable on the device.
- `401`: request a fresh Google credential; do not replay the assertion.
- `403 GOOGLE_EMAIL_UNVERIFIED` / `EMAIL_NOT_VERIFIED`: show curated Indonesian
  verification guidance.
- `403 AUTH_PROVISIONING_PENDING`: show provisioning-pending guidance.
- `409 ACCOUNT_LINK_REQUIRED`: show the required manual-login message and switch
  to the manual login path. No account is merged by email and no token is saved.
- `409 IDENTITY_CONFLICT`: show a separate safe conflict message; no linking is
  attempted.
- `202 TWO_FACTOR_REQUIRED`: validate `challenge_id`, `expires_at`, and
  non-empty `methods`; keep the session unauthenticated, show the message on
  whichever auth tab started Google Sign-In, and hand off to AUTH-M08 without
  exposing internal task identifiers in the user-facing copy.
- `429`: show safe cooldown guidance; no assertion replay.
- `503`: show provider/provisioning unavailable guidance.
- Network timeout: do not claim success or silently retry; the user may start a
  new explicit flow with a fresh assertion.

## Google-only account behavior

The backend provisions a Google-only user and default Cloud business/outlet.
The mobile client does not create a local business after exchange; it uses the
server context and keeps the existing explicit business/workspace confirmation.
Switching Google accounts cannot silently replace an active Cloud session.

Full Google account linking/reauthentication is AUTH-M06. Interactive 2FA
completion is AUTH-M08.

## Offline protection

Google cancel, provider failure, account collision, malformed exchange, and
2FA-required responses do not clear or mutate POS SQLite data, cashier PIN,
shift, products, stock, customers, sales/payments, expenses, workspace
registry, pending workspace switch, sync queue, or request journal.

Google provider success is not treated as Cloud authentication until the
backend returns HTTP 200. Cloud authentication is not treated as entitlement or
workspace alignment.

## Verification

Targeted AUTH-M04 plus AUTH-M02/AUTH-M03/API/Cloud Session tests:

```text
98 passed
```

Full branch run:

```text
1,871 passed
11 failed
4 skipped
```

The 11 failures are the existing unrelated baseline failures. A fresh detached
`origin/main` worktree with the same lockfile/runtime produced:

```text
1,849 passed
11 failed
4 skipped
```

The branch adds 22 AUTH-M04 tests and introduces no additional failure.

Build results:

- Vite production build: PASS.
- Android debug APK (`assembleDebug`): PASS.
- Live emulator Google test: NOT RUN — no configured OAuth client/device.
- Physical Android device test: NOT RUN — no device/test account supplied.
- Signed release APK / Play App Signing test: NOT RUN — release credentials are
  not available in this workspace.

Changed-file ESLint/Oxlint and `git diff --check` pass. Global lint retains
pre-existing unrelated repository findings; those are tracked separately from
AUTH-M04.

## Handoff

- AUTH-M05: broader Cloud Session lifecycle consolidation.
- AUTH-M06: explicit Google account linking and reauthentication UI.
- AUTH-M08: interactive TOTP/recovery-code challenge completion.

