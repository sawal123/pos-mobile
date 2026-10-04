# PREM-M06B3 — Cloud Restore Integration

Status: **IMPLEMENTED**

Date: 2026-10-04
Mobile main SHA at start: `215535a23bdb13ce254c27ada5439bf8a2379564`

## 0. Prerequisites

| Dependency                           | Status                     |
| ------------------------------------ | -------------------------- |
| PREM-M06A (Cloud Backup)             | MERGED (PR #52)            |
| PREM-M06B1 (portable sync identity)  | MERGED (PR #53)            |
| PREM-M06B2 (restore safety engine)   | MERGED (PR #54, `215535a`) |
| PREM-D03 (backend download endpoint) | Present on backend `main`  |

This task connects the PREM-M06A Cloud Backup download with the PREM-M06B2
`restoreSafetyEngine`. It does **not** add a second destructive restore path.

## 1. Authoritative Restore Path

The only destructive path is:

```
verified Cloud payload → restoreSafetyEngine.restore({ confirmed: true })
```

Cloud Restore never calls `restoreBackupPayload()` directly, never `$patch`es a
store, never writes SQLite from a component, and never implements a second
rollback. `restoreBackupPayload` remains the legacy **local file** restore path
used by `SettingsView`.

## 2. Backend Download Contract

`GET /api/mobile/backups/{uuid}/download?business_id={linkedBusiness}`

- Sanctum mobile token context.
- Tenant membership + mobile role authorization.
- Active Cloud entitlement via the `cloud_restore` capability/permission.
- The backup is resolved strictly inside the authorized business; a
  cross-business or missing backup returns `404 BACKUP_NOT_FOUND`.
- A missing private file returns `404 BACKUP_FILE_MISSING`.
- The private snapshot is streamed (never a public URL) as
  `application/octet-stream` with:
  - `X-Checksum-Sha256`
  - `X-Backup-Schema-Version`
- Laravel `streamDownload` does not send `Content-Length`, so the client always
  measures the real body length itself.

## 3. Raw Download Semantics

The JSON-only `apiClient` gained a minimal `apiRawRequest(path, { token,
maxBytes })` that returns status, response headers, exact body bytes and the
UTF-8 decode of those bytes. It never parses JSON and never re-serializes.
Existing JSON requests (`apiRequest`) are untouched.

`downloadCloudBackup()` (in `cloudBackupService.js`) builds the path from the
**caller-resolved linked business id** — an arbitrary `business_id` can never be
supplied by a UI/backup object. Payload handling is byte-exact:

```
HTTP raw body → exact bytes → size → SHA-256 → verify → JSON.parse
```

No `JSON.parse` before the checksum, no newline normalization, no trim, no
re-`stringify`.

## 4. Size Protection

- Hard limit: `25 * 1024 * 1024` bytes (shared `MAX_CLOUD_BACKUP_BYTES`).
- If `Content-Length` is present and already over the limit, the body is never
  read (`RAW_BODY_TOO_LARGE`).
- After the body is received, the actual UTF-8 byte length is measured and
  enforced. Over-limit maps to `RESTORE_DOWNLOAD_TOO_LARGE` with no mutation.

## 5. Checksum Chain

Three sources must agree:

1. metadata `checksumSha256` (list/detail),
2. `X-Checksum-Sha256` header,
3. SHA-256 computed over the exact received bytes.

Fail closed, never reaching the engine:

- missing header → `RESTORE_CHECKSUM_HEADER_MISSING`
- malformed (not 64 hex) → `RESTORE_CHECKSUM_INVALID`
- metadata/header or calculated/header disagreement →
  `RESTORE_CHECKSUM_MISMATCH`

## 6. Schema Chain

Three sources must agree:

1. metadata `schemaVersion`,
2. `X-Backup-Schema-Version` header,
3. parsed `payload.version`.

- any disagreement → `RESTORE_SCHEMA_MISMATCH`
- version outside `SUPPORTED_BACKUP_VERSIONS` → `RESTORE_SCHEMA_UNSUPPORTED`
- never silently upgrades.

Malformed JSON after the checksum passes → `RESTORE_PAYLOAD_INVALID`; a
structurally invalid payload (`validateBackupPayload`) → `RESTORE_PAYLOAD_INVALID`.

## 7. Same-Device vs Cross-Device

`metadata.device.identifier` is compared with the current
`device_identifier` (from the Cloud session store).

- equal → `same-device`
- different, or origin unknown → `cross-device`

The origin device identifier is never written back to this device; a backup
payload does not contain device/session identity, so nothing to restore.

## 8. Cross-Device Classifier

For cross-device restores, `classifyCrossDeviceRestoreSafety(payload)` is run
both in the verification service and again by the engine. If it is not `SAFE`,
the flow is blocked with `RESTORE_BLOCKED_CROSS_DEVICE_UNSAFE` and the
machine-readable classifier reason is retained. Legacy v1/v2 backups cannot be
restored cross-device; only portable v3 (with sync identity/version metadata)
qualifies. Same-device legacy v1/v2 follows the engine's support policy.

## 9. Eligibility Preflight

Before confirmation, the store runs the engine's non-destructive
`checkRestoreEligibility({ payload, mode })`. It never downloads again when the
payload is already in memory. Blocked reasons surfaced in the UI include:

- pending sync queue → `RESTORE_BLOCKED_PENDING_SYNC`
- sync push in flight → `RESTORE_BLOCKED_SYNC_IN_FLIGHT`
- unresolved P38 journal → `RESTORE_BLOCKED_P38_JOURNAL_UNRESOLVED`
- unresolved restore journal → `RESTORE_BLOCKED_RESTORE_JOURNAL_UNRESOLVED`
- persistence unavailable → `RESTORE_BLOCKED_PERSISTENCE_UNAVAILABLE`
- open shift → `RESTORE_BLOCKED_SHIFT_OPEN`

## 10. Confirmation UX

`CloudBackupPanel` lists each backup with `[ Restore ]`. Flow:

1. select backup, 2. load metadata, 3. download, 4. verifying, 5. validating,
2. eligibility, 7. confirmation, 8. user confirms, 9. restoring,
3. success / rollback / recovery-required.

No mutation occurs before step 8. The confirmation shows:

> "Restore akan mengganti data POS lokal pada perangkat ini dengan data dari backup Cloud yang dipilih."

plus backup date, origin device, size, schema version, and for cross-device:
"Backup ini dibuat dari perangkat lain."

Cancel releases the in-memory payload and does not mutate, create a restore
journal, create a safety snapshot, or touch the sync queue.

## 11. Entitlement / Session / Device Errors

Client gate mirrors PREM-M06A (Cloud session valid, linked business, verified
capability, active Premium). The backend stays authoritative.

- `CLOUD_SUBSCRIPTION_REQUIRED` → abort, refresh Cloud context, no mutation;
  local backup/restore stays available.
- `401` follows PREM-M03: invalidate the Cloud session only — never clears the
  POS DB, products, transactions, or logs the local user out.
- `DEVICE_NOT_FOUND` / `DEVICE_INACTIVE` → fail closed; never auto-registers.
- `BACKUP_NOT_FOUND` / `BACKUP_FILE_MISSING` → fail closed; never restores
  metadata-only.
- Offline → Cloud Restore is unavailable; no download, no mutation. Local
  Restore stays available.

## 12. Store State

A focused `cloudRestoreStore` owns the restore presentation: `selectedBackup`,
`restorePhase`, `restoreError`, `restoreErrorCode`, `restoreReason`,
`downloadedMetadata`, `restoreMode`, `eligibility`. Phases: `idle`,
`downloading`, `verifying`, `validating`, `blocked`, `awaiting-confirmation`,
`restoring`, `rolling-back`, `success`, `recovery-required`, `error`.

The durable restore journal/safety snapshot is never duplicated in Pinia — it
stays the engine's truth. The verified payload is memory-only (never
localStorage, sessionStorage, or plaintext `app_meta`) and is released on
cancel/finish.

Double-tap is guarded synchronously: one flow per download, one destructive
engine invocation per confirm.

## 13. Restore Safety Engine Integration

`confirmRestore()` calls `restoreSafetyEngine.restore({ payload, mode,
confirmed: true })` exactly once. Semantics:

- `success === true` (engine committed) → phase `success` only then.
- rollback-completed codes (`RESTORE_APPLY_FAILED_ROLLED_BACK`,
  `RESTORE_VERIFY_FAILED_ROLLED_BACK`) → phase `rolling-back`, shown as failed
  with local data restored — never as success.
- `RESTORE_RECOVERY_REQUIRED` → phase `recovery-required`, UI fails closed;
  durable engine recovery continues.

Business relink or Cloud disconnect clears only uncommitted UI state; an
engine restore already `applying` follows durable engine recovery and its
journal/safety snapshot are never deleted by the UI.

## 14. Negative Stock

Cloud backups with `stock: -3`, `stockBefore: 2`, `stockAfter: -3`,
`quantityChange: -5` download → verify → validate → restore without any clamp.
No `min: 0` rule exists anywhere in the pipeline.

## 15. Sync Non-Duplication

A cross-device v3 restore installs portable sync metadata through the engine:
restored rows keep their `sync_id` in `sync_identity_map`, base
`sync_server_versions` are preserved, restore generates no sync queue items and
no in-flight envelope, and the Cloud session is preserved. Later edits to
restored rows target the same backend identity.

## 16. Limitations

- Snapshot size is capped at 25 MB client and server side.
- Cross-device restore requires a portable v3 backup; v1/v2 are same-device only.
- Cloud Restore requires network; offline restores cannot start.
- Rollback/recovery relies entirely on the PREM-M06B2 engine's durable journal.
- The app fetches through the WebView (no `CapacitorHttp`), so the backend must
  expose `X-Checksum-Sha256` and `X-Backup-Schema-Version` via CORS
  `Access-Control-Expose-Headers`. Without it the headers are unreadable and the
  client correctly fails closed with `RESTORE_CHECKSUM_HEADER_MISSING`.
