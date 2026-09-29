# INT-04 — Mobile Sync Request Reconciliation

Client-side reconciliation of a sync push envelope whose server acceptance is
**unknown**, against the INT-03 request-status endpoint.

| Item             | Value                                                                 |
| ---------------- | --------------------------------------------------------------------- |
| Task             | INT-04 — Mobile Sync Request Reconciliation                           |
| Repository       | `pos-mobile` (this repo only)                                         |
| Backend contract | `pos_dashboard` → `GET /api/sync/requests/{request_id}/status` (INT-03) |
| Depends on       | INT-02 (cashier capability-safe outbox) — already merged              |
| Scope            | POS Mobile only. No backend, no deploy, no auto-merge.                |
| Branch           | `codex/int04-mobile-request-reconciliation`                           |

---

## 1. Problem

INT-02 already retains an in-flight envelope whose acceptance is uncertain and
never re-plans or resends it (`SYNC_RECONCILIATION_REQUIRED`). Two situations
leave the outcome genuinely unknown:

1. the response to a request was lost (transport error / malformed `2xx` / `5xx`);
2. the request may already have been committed, but a later idempotent retry is
   rejected with `403` because the backend authorizes **before** it dedupes
   (e.g. a member → cashier downgrade, an inactive device, a revoked membership
   or an expired subscription).

In both cases the client cannot tell "committed, then 403" apart from "never
committed". INT-04 closes that gap by asking the server for the authoritative
outcome and recovering the durable outbox safely.

---

## 2. API contract used (INT-03)

```
GET /api/sync/requests/{request_id}/status
Query:  business_id        (required)
        device_identifier  (required)
Auth:   Sanctum mobile token (Authorization: Bearer …), same as other sync calls
```

Response (Laravel API Resource — wrapped in `data`):

| Status            | Body                                                          | Meaning                                  |
| ----------------- | ------------------------------------------------------------- | ---------------------------------------- |
| `200 committed`   | `{ request_id, status: 'committed', processed_at: ISO }`      | the request was applied server-side      |
| `200 not_found`   | `{ request_id, status: 'not_found', processed_at: null }`     | no committed record for this request     |
| `401/403`         | error body                                                    | access denied (token/device/membership)  |
| `5xx` / timeout   | —                                                             | outcome still undetermined               |

The client only treats a body as `committed` when the echoed `request_id`
equals `envelope.requestId`; a missing or mismatched id is rejected and no
local cleanup is performed (see §3.7).

The client never stores the bearer token: it is read from the existing secure
token repository (`tokenRepository`) per call, attached as an `Authorization`
header by the shared `apiClient`, and never written to SQLite, the envelope, the
activity log or any other durable state. No second auth system is introduced.

---

## 3. What changed

### 3.1 Status transport — `src/services/sync/syncRequestStatusTransport.js` (new)

`fetchSyncRequestStatus({ token, requestId, businessId, deviceIdentifier })`
issues a single `GET` through the existing `apiRequest` client. No retry, no
polling, no background request. Exports `SYNC_REQUEST_STATUS_COMMITTED` and
`SYNC_REQUEST_STATUS_NOT_FOUND`.

### 3.2 Shared acknowledgment — `src/services/sync/syncCommittedAck.js` (new)

`applyCommittedAcknowledgment({ adapter, queueService, registry, envelope })`
extracts the **existing** push-success acknowledgment so it is reused by both
`pushNow` and reconciliation:

- CAS-removes only queue rows still byte-identical to the original snapshot
  (`removeIfUnchanged`); rows mutated while the request was in-flight are
  preserved (`preservedQueueIds`);
- removes superseded snapshots by id;
- restores/learns fresh **sync version metadata** for every travelled row
  (`sync_server_versions_v1`), including derived sale-item rows;
- clears the envelope **only** when every cleanup succeeded, so a SQLite failure
  keeps it for an idempotent retry;
- never sends a request and never re-applies a committed mutation.

`syncPushService.pushNow`'s success path now calls this helper (behaviour
unchanged; identical result fields).

### 3.3 Reconciliation service — `src/services/sync/syncReconciliationService.js` (new)

`createSyncReconciliationService({ adapter, scheduler, queueService, registry, tokenFetcher, statusTransport, contextGuardService })`
exposes `reconcile({ context })`:

- **single-shot, guarded** — an in-flight `isReconciling` flag returns
  `SYNC_RECONCILIATION_IN_PROGRESS` for a concurrent call; there is no timer, no
  loop and no retry storm;
- **only acts on a retained envelope that needs review** (`reconciliationRequired`
  or `reconciliationOutcome === 'cleanup_failed'`); otherwise
  `SYNC_RECONCILIATION_NOT_REQUIRED`;
- **context isolation** — refuses to resolve an envelope for a different
  business / outlet / device / registered-device (`SYNC_RECONCILIATION_CONTEXT_MISMATCH`)
  and reuses the shared context guard (`SYNC_RECONCILIATION_GUARD_BLOCKED`);

Result codes:

| Code                                | When                                        | Envelope / outbox |
| ----------------------------------- | ------------------------------------------- | ----------------- |
| `SYNC_RECONCILIATION_COMMITTED`     | `committed` + cleanup safe                  | cleared / drained |
| `SYNC_RECONCILIATION_CLEANUP_FAILED`| `committed` + local cleanup failed          | kept / kept       |
| `SYNC_RECONCILIATION_NOT_FOUND`     | `not_found`                                 | kept / kept       |
| `SYNC_RECONCILIATION_ACCESS_DENIED` | `401/403` (device/membership/subscription)  | kept / kept       |
| `SYNC_RECONCILIATION_UNREACHABLE`   | network / `5xx` / no token / malformed body | kept / kept       |
| `SYNC_RECONCILIATION_NOT_REQUIRED`  | nothing to reconcile                        | n/a               |
| `SYNC_RECONCILIATION_IN_PROGRESS`   | concurrent call                             | n/a               |
| `SYNC_RECONCILIATION_CONTEXT_MISMATCH` / `_GUARD_BLOCKED` / `_PRECONDITION_FAILED` / `_READ_FAILED` | guards | kept / kept |

**Committed recovery** reuses §3.2: cleanup and version-metadata restore happen
first, the envelope is removed only after a safe cleanup, and no proven-accepted
transaction is ever resent.

**not_found recovery is deliberately inconclusive.** The client does **not**
assume the request failed, does **not** delete the envelope, does **not**
generate a new `request_id`, and keeps the whole durable outbox. It marks the
envelope `reconciliationRequired` with `reconciliationOutcome: 'not_found'`,
surfaces "waiting reconciliation", offers a controlled re-check, and flags
`interventionRequired` so the owner/support is asked instead of a risky re-plan.

### 3.4 Durable markers written by the push service

| Situation                                  | Persisted on the envelope                                                     |
| ------------------------------------------ | ----------------------------------------------------------------------------- |
| Transport loss / malformed `2xx` / `5xx`   | `acceptanceUnknown: true`, `acceptance: 'unknown'`, `reconciliationOutcome: 'unreachable'` (directly reconcilable — see §3.7) |
| `403` on a retry whose acceptance is unknown | `acceptanceUnknown: true`, `acceptance: 'unknown'`, `reconciliationRequired: true`, `reconciliationCode: 'SYNC_RECONCILIATION_REQUIRED'`, `reconciliationOutcome: 'unknown'` |
| Server accepted but local cleanup failed   | `acceptance: 'accepted'`, `reconciliationOutcome: 'cleanup_failed'`, `reconciliationCode: 'LOCAL_SYNC_CLEANUP_FAILED'` |

The retry-blocking `reconciliationRequired` flag is set **only** where a plain
retry is unsafe (the `403`-on-unknown case). A cleanup failure keeps its existing
safe idempotent retry (same `request_id`, server dedupe) while also surfacing the
distinct state and being reconcilable through the status endpoint. A transport
loss keeps the existing "retry the same request_id" reconciliation and is
presented as "acceptance not yet certain".

### 3.5 Sync Status integration

`readLocalStatus()` now returns additive `acceptance`, `reconciliationRequired`
and `reconciliationOutcome` (read-only; never mutates storage), exposed by
`syncStatusStore`. `deriveSyncUiStatus()` gained the matching inputs and the
distinct statuses (priority after conflict, before offline):

| Status                                | Indonesian label        | Condition                       |
| ------------------------------------- | ----------------------- | ------------------------------- |
| `SYNC_UI_RECONCILIATION_COMMITTED`    | Diterima server         | envelope accepted, cleanup pending |
| `SYNC_UI_RECONCILIATION_REQUIRED`     | Rekonsiliasi diperlukan | acceptance unknown             |
| `SYNC_UI_RECONCILIATION_WAITING`      | Menunggu koneksi        | unknown and offline            |
| `SYNC_UI_ACCESS_DENIED`               | Akses cloud ditolak     | 403 outcome                     |
| `SYNC_UI_CLEANUP_FAILED`              | Pembersihan lokal gagal | accepted + cleanup failed       |

The overall indicator never reads as fully synced while an envelope or queue row
is outstanding (`hasInflight`/`pendingCount` always outrank `SYNC_UI_CLEAR`).

### 3.6 UI

`SyncStatusBadge` maps the new statuses to existing design tokens.
`CloudLoginView` gains a **"Rekonsiliasi Pengiriman"** card
(`#cloud-reconciliation-section`, `#reconciliation-recheck-btn`,
`#reconciliation-message`, `#reconciliation-result-message`) that shows the
distinct state and offers a single controlled re-check. When an envelope
requires reconciliation the misleading "Coba Ulang Push" recovery button is
suppressed (`recoveryActions`), so the user is not offered a no-op resend.
Activity-log type `reconciliation` / action `RECONCILE_REQUEST` was added.

### 3.7 Final reconciliation hardening

| # | Finding | Fix |
| - | ------- | --- |
| 1 | A network-error envelope only carried `acceptanceUnknown` and was therefore **not** reconcilable (`SYNC_RECONCILIATION_NOT_REQUIRED`) — the user had to resend before they could check the status. | `needsReconciliation` now also accepts `acceptanceUnknown === true`, so the INT-03 status lookup is offered **immediately**, without resending. The safe idempotent retry (same `request_id`, server dedupe) is untouched and still available. |
| 2 | A `committed` body was trusted without checking `request_id`. | The client now requires `response.request_id === envelope.requestId`. A missing or mismatched id is rejected as `UNREACHABLE` (`REQUEST_ID_MISSING` / `REQUEST_ID_MISMATCH`) and **no CAS cleanup / envelope clear** happens. All INT-03 mocks were updated to the real Laravel contract (Resource body echoing `request_id`). |
| 3 | `applyCommittedAcknowledgment` cleared the envelope **before** saving `sync_server_versions_v1` and swallowed a version-save failure — the recovery information could be lost. | Server versions are now persisted **before** any destructive cleanup; if that write fails, nothing is removed and the envelope is kept (`CLEANUP_FAILED`). The return value exposes `versionMetadataPersisted`. A regression asserts a failing `saveSyncServerVersions()` keeps the envelope + outbox, and that versions are still learned when a row was mutated in-flight (CAS preserved). |
| 4 | A pending envelope was hidden behind `SYNC_UI_LOCAL` when membership/subscription was revoked, so the UI looked fully synced. | `deriveSyncUiStatus` never masks a retained envelope: with `cloudAvailable === false` and `hasInflight === true` it reports `SYNC_UI_ACCESS_DENIED`. The reconciliation card in `CloudLoginView` is now shown regardless of `canSync`, uses a dedicated "access revoked" message, and status is re-read on context change. `SYNC_UI_CLEAR` is still impossible while an envelope/queue row is outstanding. |

---

## 4. Files changed

| File                                                | Change                                                                                                                       |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `src/services/sync/syncRequestStatusTransport.js`   | **new** — INT-03 status transport.                                                                                            |
| `src/services/sync/syncCommittedAck.js`             | **new** — shared committed acknowledgment (CAS cleanup + version restore).                                                    |
| `src/services/sync/syncReconciliationService.js`    | **new** — reconciliation service.                                                                                             |
| `src/stores/syncReconciliationStore.js`             | **new** — Pinia store.                                                                                                        |
| `src/services/sync/syncPushService.js`              | uses the shared ack helper; persists acceptance/reconciliation markers; preserves acceptance on the reconciliation short-circuit. |
| `src/services/sync/syncStatusService.js`            | granular acceptance states + additive `readLocalStatus` fields.                                                               |
| `src/stores/syncStatusStore.js`                     | exposes acceptance/reconciliation state.                                                                                     |
| `src/components/sync/SyncStatusBadge.vue`           | maps the new statuses.                                                                                                        |
| `src/views/settings/CloudLoginView.vue`             | reconciliation card + handler + no-op resend suppression.                                                                    |
| `src/services/sync/syncActivityLogService.js`       | additive `reconciliation` type / `RECONCILE_REQUEST` action.                                                                   |
| `src/services/sync/index.js`                        | exports + foundation wiring.                                                                                                  |
| `src/main.js`                                       | store initialization.                                                                                                         |
| `src/__tests__/sync-reconciliation.spec.js`         | **new** — 37 regression tests (incl. the §3.7 hardening regressions).                                                          |
| `docs/sync/INT04_REQUEST_RECONCILIATION.md`         | **new** — this document.                                                                                                       |

No database schema migration was required: the envelope and cloud context are
stored as opaque JSON, and the inflight validator tolerates additional fields.

---

## 5. Tests

`src/__tests__/sync-reconciliation.spec.js` (37 tests) covers the required
regression list:

- response lost after the server committed → reconciled `committed`, drained, no resend;
- member → cashier → `SYNC_RECONCILIATION_REQUIRED` instead of re-plan;
- confirmed `committed` → CAS cleanup, version metadata restored, envelope cleared;
- `not_found` → no data deleted, same request id, outbox preserved, re-check available;
- device / business mismatch → refused with no HTTP call;
- restart while reconciliation is pending → fresh app graph over the durable adapter;
- database failure during cleanup → `CLEANUP_FAILED`, envelope + outbox kept;
- new local mutation while the request was in-flight → CAS preserves it;
- owner/member backward compatibility (plain push acknowledgment unchanged);
- cashier capability-safe outbox (restricted entity never sent);
- Free offline mode / missing token → waiting for connection, data preserved;
- SQLite / memory parity for committed and not_found outcomes;
- status transport contract (path, query, bearer token, URL-encoding);
- no retry storm (in-progress guard, single status call per attempt);
- granular sync-status derivation and "never CLEAR while outstanding".

§3.7 hardening regressions:

- network error → status `committed` / `not_found` / restart → reconcile, without resending, while the idempotent retry path stays available;
- committed body with missing / mismatched `request_id` → rejected with no local cleanup;
- failing `saveSyncServerVersions()` keeps the envelope + outbox; versions are still learned when a row was mutated in-flight (CAS preserved);
- a pending envelope stays visible (`SYNC_UI_ACCESS_DENIED`, never `LOCAL`/`CLEAR`) while membership/subscription is revoked.

These are **mock-based unit tests only** — they do not prove the real backend
integration.

---

## 6. Validation gates

```
npx vitest run        # full suite (see §8 for the recorded runs)
npm run build         # 159 modules transformed, built successfully
git diff --check      # clean (no whitespace/conflict markers)
```

Lint (non-mutating, changed files only): the new/changed files are clean. The
only lint error surfaced on the touched files is a `no-useless-assignment`
(`hasInflight = false`) in `syncStatusService.js`, which is **pre-existing on
`main`** (identical at `HEAD`) and was intentionally left untouched. The
`no-unused-vars` findings in `syncPushService.js` (`isReusedEnvelope`, two unused
`catch` params) and the unused re-exports in `sync/index.js` are likewise
**pre-existing on `main`** (already reported in the INT-02 document).

---

## 7. Known limitations / backend verification

1. **Mock-only.** All outcomes are asserted against injected transports that
   follow the INT-03 contract. `LIVE E2E: NOT EXECUTED` — real Laravel testing
   must be run after the INT-03 backend PR is merged.
2. **Backend ordering.** The contract requires the status lookup to run before
   any role/capability preflight so a downgraded role cannot hide an
   already-processed request. This is assumed from the contract and cannot be
   proven client-side.
3. **Exact response shape.** The client reads `{ status, processed_at }` from
   `data.data ?? data`; the authoritative serializer should be confirmed against
   a live endpoint.
4. **Concurrency.** Idempotent cleanup under true concurrent devices needs a
   real MySQL/MariaDB test database; SQLite parity here only proves identical
   client behaviour, not row-lock semantics.
5. **Owner/support escalation.** `not_found` surfaces `interventionRequired`; the
   human escalation process itself is out of client scope.

---

## 8. Test run log

(Recorded during this branch's validation, including the §3.7 hardening.)

- Targeted — `npx vitest run src/__tests__/sync-reconciliation.spec.js`
  - run #1: 37 passed
  - run #2: 37 passed
- Full — `npx vitest run`
  - run #1: 1288 passed | 3 skipped (pre-existing skips) — exit 0
  - run #2: 1288 passed | 3 skipped
- Build — `npm run build`: 159 modules transformed, built successfully.
- Hygiene — `git diff --check`: clean.

The 37 reconciliation tests include the §3.7 hardening regressions (acceptance
unknown → committed/not_found/restart, `request_id` validation, version-metadata
failure, revoked-access UI visibility).
