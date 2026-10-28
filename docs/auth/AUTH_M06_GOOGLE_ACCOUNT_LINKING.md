# AUTH-M06 — Secure Google Account Linking

## Scope

AUTH-M06 links a fresh Google identity to an already authenticated manual Cloud
account. It does not create a session, business, outlet, subscription, device
registration, workspace, or sync operation.

## Flow

1. Google login may return `409 ACCOUNT_LINK_REQUIRED`. The mobile UI keeps the
   failed collision as non-sensitive in-memory intent only; it does not retain
   the rejected Google ID token.
2. The user signs in through the existing manual v2 login flow.
3. The authenticated account shows the current server authentication methods.
4. The user explicitly confirms **Hubungkan Akun Google**.
5. The user submits the current password and, when the server requires it, a
   six-digit Fortify TOTP code through `POST /api/v2/auth/reauthenticate`.
6. The opaque `google_link` grant is retained only in the Cloud session-store
   closure for its five-minute server expiry. It is never persisted, logged,
   shown in the UI, or used as a Bearer token.
7. The user explicitly opens the native Credential Manager picker. A fresh
   Google ID token is sent once to `POST /api/v2/auth/google/link` together
   with the existing Sanctum token.
8. The existing token and Cloud/business/workspace state remain unchanged.
9. `GET /api/v2/auth/me` verifies the current user and `google` method after a
   successful link.

## UI lifecycle and identity guards

`CloudGoogleLinkCard` is mounted for the lifetime of the authenticated Cloud
session. It is not removed merely because the parent store is loading: its own
method refresh, reauthentication modal, and native picker therefore retain
their state while their requests are in flight. Local control flags provide
the disabled/loading presentation; logout and real route/session teardown
still perform the normal cancellation cleanup.

The component captures the authenticated user ID and a generation number for
each request. When the ID changes, old methods, grants, modal state, and
pending assertions are cleared, the linking operation is cancelled, and the
new account's methods are fetched again. A response from the previous account
cannot update the new account's UI.

## Backend contracts

- Reauthentication: `POST /api/v2/auth/reauthenticate` with password and
  optional `totp_code`; success requires HTTP 200, a non-empty grant, positive
  `expires_in`, and `purpose=google_link`.
- Linking: `POST /api/v2/auth/google/link` with the grant, fresh `id_token`,
  and `client_platform=android`; success requires HTTP 200, provider `google`,
  and boolean `linked`.
- `linked:false` is an idempotent success when the same identity is already
  owned by the current user.
- Authentication methods: `GET /api/v2/auth/me`; this v2 method is separate
  from the legacy `fetchMe()` response.

## Safe cancellation, expiry, and concurrency

Native cancellation, modal close, route unmount, logout, and session changes
clear the in-memory grant and assertion reference without logging out or
changing local POS data. The operation captures the current user ID and
Sanctum token ownership and checks ownership after reauthentication, native
picker, link request, and methods refresh. A stale result cannot update a new
session.

An expired or already-used grant is discarded and never retried. Network
uncertainty does not replay the grant or Google assertion; the client performs
one status verification through `/api/v2/auth/me` and reports an unverified
outcome when the server state cannot be established.

If the link response reports `REAUTHENTICATION_EXPIRED`,
`REAUTHENTICATION_ALREADY_USED`, or `REAUTHENTICATION_REQUIRED`, the picker is
closed and the UI returns to the explicit **Hubungkan Google** restart point.
The user must choose the confirmation and reauthentication steps again before
another native Google picker can open. The current Sanctum token, Cloud
session, active business/outlet, workspace, and local operational data are not
cleared or replaced. A new Google assertion is requested only after the new
reauthentication grant succeeds.

When the link endpoint succeeds but the follow-up methods read is unavailable,
the cached methods list is invalidated instead of being interpreted as
`manual`/not-linked. The UI keeps the link acknowledgement while showing the
read-only **Periksa metode login** action. An uncertain link request followed by
an unsuccessful status read closes the picker and reports that the status is
unverified; it does not claim success or failure, and it never replays the
Google assertion or grant. A later authoritative refresh can show **Google
Terhubung** or return to the explicit **Hubungkan Google** flow when Google is
absent.

## Error handling

Backend error codes are mapped to safe Indonesian messages. Password errors,
TOTP requirements, identity conflicts, expired grants, provider failures, rate
limits, and uncertain network outcomes are distinguished. Raw backend
exceptions, password, TOTP, grant, Google JWT, and Google email claims are not
shown or logged.

Google identity ownership is determined by the backend provider subject. The
client never links by email equality and never calls `loginWithGoogle()` for
the linking operation.

The current backend `authentication_methods` response does not expose an
authoritative `password_login_enabled` capability and may include `manual` as
part of its legacy method list. The mobile UI therefore does not claim that a
Google-linked account supports password login; it uses neutral copy and does
not invent a frontend password capability. A backend contract refinement may
be handled separately without changing this mobile linking flow.

## Offline and account integrity

Linking does not call sync, bootstrap, cache clearing, workspace switching,
device registration, or subscription APIs. Products, categories, customers,
transactions, payments, expenses, stock, cash ledger, shifts, SQLite,
workspace registry, active workspace, recovery state, and sync queues remain
unchanged on cancel, error, expiry, conflict, timeout, and success.

## 2FA dependency

Interactive login 2FA remains AUTH-M08. AUTH-M06 only submits a TOTP code when
the reauthentication endpoint explicitly requires it; it does not bypass or
complete the separate login challenge.

## Verification

Automated coverage is in
`src/__tests__/auth-m06-google-account-linking.spec.js`, including collision
handling, contract validation, explicit confirmation, password/TOTP proof,
fresh native selection, idempotent success, cancellation, uncertain status,
session ownership, bearer preservation, and offline data preservation.

Live Android OAuth QA is **NOT RUN** unless a configured device and real Web
Client ID are supplied. Mocked Vitest does not claim live OAuth success.

AUTH-M07 owns password reset and email changes. AUTH-M08 owns interactive login
2FA completion. Google unlink, account merge, data merge, and workspace
migration are out of scope.
