# P38 — Multi-Device Data Integrity, Conflict & Recovery Hardening (Mobile)

Branch: `feat/p38-sync-integrity-recovery` · base: `main` (P37 merged commit `5db14ca558e0d68b39b40b4a4588a8084a4ccafe`)

Scope: offline-first POS integrity for two or more devices — durable conflict
handling, deterministic cursor replay, business/outlet context isolation, and
local crash recovery. No UI redesign, no printer/signing/package-id changes,
no `DB_VERSION` bump, Backup v2 compatibility retained.

---

## 1. Stock delta authority on pull

`src/services/sync/syncPullService.js`

The stock-movement apply branch used to write the remote `stock_after` straight
into the local product (authoritative chronology). It now applies the
`quantity_change` **delta**:

```js
const movementDelta = Number(quantity_change)
if (targetProduct && Number.isFinite(movementDelta)) {
  targetProduct.stock = Number(targetProduct.stock ?? 0) + movementDelta
}
```

The remote `stock_before` / `stock_after` remain historical evidence on the
movement record. The write is idempotent because this branch only runs for a
movement the device has not seen yet (deduped by `sync_id` / registry identity).
This is what stops a concurrent peer's stale snapshot from corrupting the local
stock.

## 2. Operation journal design

`src/services/database/operationJournalService.js`
`src/services/database/localOperationService.js`

* Durable record: `app_meta/local_operation_journal_v1` on SQLite, mirrored by
  the memory adapter. No schema change — **`DB_VERSION` is unchanged**.
* Entry shape: `operationId, operationType, phase, status, contextKey,
  businessId, outletId, createdAt, updatedAt, payload, artifacts, attempts`.
* Operation types: `retail_sale` (covers cash **and** non-cash) and
  `laundry_settlement`.
* Writing order is fixed:
  1. `journal.begin()` — durable, **before the first irreversible mutation**
  2. transaction (`operationId` is the transaction id)
  3. stock movements
  4. cash ledger
  5. `journal.commit()` — only after every domain store and the outbox are
     durable
* Recovery runs on start in `src/main.js`, **after hydration and after the sync
  tracker is attached**, so recovered mutations are persisted and re-enqueued
  exactly once.
* Retail stock application is idempotent by construction
  (`applySaleStockIdempotently`): expected quantities come from the transaction,
  already-recorded movements are keyed by the sale reference, and only the
  missing remainder is applied. Cash is idempotent by `referenceId`
  (`sale-<transactionId>`). Laundry settlement is idempotent by
  `paymentStatus === 'paid'`.

Integration points (no UI redesign):
`PaymentView.completePayment()` → `localOperations.commitRetailSale()`;
`LaundryOrderDetailView` / `LaundryOrderCreateView` →
`localOperations.settleLaundryOrder()`.

## 3. Failure injection matrix

Injection lives **only** in the test harness
(`src/__tests__/p38-operation-journal.spec.js`): a proxy over the durable adapter
that delegates the write and then simulates a process death
(`SIMULATED_PROCESS_DEATH`) before/after the Nth journal write. No artificial
crash switch exists in production code or the UI.

| # | Interrupted at | Expected final state | Result |
| --- | --- | --- | --- |
| 1 | journal saved, before transaction | journal pending, no partial domain state | PASS |
| 2 | after transaction, before stock | 1 transaction, 1 movement, stock 8 | PASS |
| 3 | after stock, before movement durable | 1 transaction, 1 movement, stock 8 | PASS |
| 4 | after movement, before cash | 1 transaction, 1 movement, 1 cash | PASS |
| 5 | after cash, before journal clear | 1 transaction, 1 movement, 1 cash | PASS |
| 6 | queue durable, before journal clear | outbox has no duplicate `(type,id)` rows | PASS |
| 7 | pull applied, cursor save failed | records replay, cursor finally advances | PASS |
| 8 | identity registry save failed | covered by the existing P11 fail-closed spec | PASS |

Every phase produces **exactly one logical operation** after restart + recover —
verified for retail cash, retail non-cash (0 physical cash) and laundry
settlement (paid exactly once, one cash row).

## 4. Retail cash / non-cash / laundry recovery

* `test('recovers a retail cash sale interrupted at every phase …')` — normal
  commit and all crash points converge to: transaction 1, stock 8 (from 10,
  qty 2), movement 1, cash 1.
* `test('recovers a retail non-cash sale …')` — transaction 1, stock deducted,
  movement 1, cash **0**.
* `test('recovers a laundry settlement …')` — `paymentStatus = paid` once,
  exactly one cash entry keyed `sale-<orderId>`.

## 5. Free mode

`test('keeps local crash durability in Free mode without any cloud session')` —
the journal works with no login, no network and no cloud queue: the interrupted
sale still recovers to exactly one transaction / movement / cash entry, and the
outbox stays empty (no transaction rows).

## 6. Free data + existing cloud (P37 fail-closed retained)

Untouched by P38: the existing `FREE_TO_EXISTING_CLOUD_MERGE_REQUIRED`
fail-closed state remains non-destructive (local data intact, cloud not
overwritten, SQLite not cleared, queue retained, no automatic server-wins /
local-wins). P38 adds no fuzzy product/customer merge.

## 7. Conflict durability and safe auto-resolution

* `409 SYNC_CONFLICT` → durable conflict record persisted atomically with the
  in-flight envelope clear (`persistSyncConflictsAndClearInflightAtomic`); the
  local payload is never dropped and the POS stays usable.
* `409 STOCK_RECONCILIATION_REQUIRED` / `409 SYNC_RETRYABLE_CONFLICT` arrive as
  generic failures: the queue is retained unchanged and the same in-flight
  `request_id` is retried, so nothing is silently resolved.
* Auto-resolution only for semantically equivalent mutations (server already
  holds the exact state) — all-or-nothing mapping, otherwise
  `SYNC_CONFLICT_MAPPING_FAILED` with the queue untouched.

## 8. Cursor recovery and deterministic replay

`src/__tests__/p38-cursor-and-context.spec.js`

* Remote records are applied first, the cursor is persisted **last**. With a
  simulated `saveSyncPullState` failure the pull reports
  `SYNC_PULL_CURSOR_PERSIST_FAILED`, the durable cursor stays at 0, and a replay
  re-applies the same records **without duplication** before the cursor finally
  advances to 10.
* A batch whose entity still has a pending local outbox mutation is refused with
  `LOCAL_PENDING_SYNC_CONFLICT`: the remote change is not applied over the
  pending local mutation and the cursor does not advance past it.

## 9. Context isolation

* Journal: an entry whose `contextKey` (`business:<id>`) differs from the
  current business is never applied — it stays durable and is reported as
  `context_mismatch` (test 8 in §3's spec).
* Push: a business-A outbox cannot be pushed as business B
  (`SYNC_BUSINESS_BINDING_MISMATCH`, zero transport calls, queue preserved).
* Pull: a business-A cursor/binding cannot be used for business B
  (`SYNC_BUSINESS_BINDING_MISMATCH`).
* Outlet scope: existing P37 outlet isolation in push/pull remains intact.

## 10. Auth / device failure

Unchanged from P37 and re-verified by the full suite: 401 expired token, 403
lost cloud access, inactive/revoked device and network loss keep the local POS
running, keep SQLite and the queue intact, produce no busy retry loop, surface
action-required/relogin state, and a re-login in the same context resumes the
pending queue.

---

## 11. Real two-device E2E (actual services + actual server)

`src/__tests__/p38-two-device-e2e.spec.js` — real `createSyncPushService`,
`createSyncPullService`, `syncTracker`, outbox queue, identity registry, Pinia
domain stores and the durable operation journal, over real HTTP against
`php artisan serve` on the dedicated TEST database `pos_p38_e2e_test`
(MariaDB, never dev/prod), seeded by `database/seeders/P38E2ESeeder.php`.

| Scenario | Expected | Result |
| --- | --- | --- |
| A and B fresh-pull stock 10; A offline cash sale qty 3, B offline non-cash sale qty 4; near-concurrent reconnect push; both pull to converge | server stock **3**, 2 logical sales, 2 stock movements, 1 cash entry, no duplicates, no duplicate outbox rows | **PASS** |
| A advances `Masuk → Diproses`; stale B pushes `Masuk` with `base_sync_version 1` | `409 SYNC_CONFLICT`, server still `Diproses`, B's local row intact | **PASS** |

Command:
`P38_E2E_BASE_URL=http://127.0.0.1:18020 npx vitest run src/__tests__/p38-two-device-e2e.spec.js`

## 12. Test counts

| Gate | Result |
| --- | --- |
| `npm run test:unit -- --run` (full) | **1135 passed, 3 skipped** (43 files) |
| `p38-operation-journal.spec.js` | 9 passed |
| `p38-cursor-and-context.spec.js` | 4 passed |
| `p38-two-device-e2e.spec.js` (real server) | 2 passed |
| Affected P37/P8/P3 regressions (pos-flow, cash-payment, laundry-order-flow, receipt-print, sqlite-persistence, customer-management, sync-parity-p37) | 176 passed |
| `npm run build` | PASS |
| `npx cap sync android` | PASS (4 plugins, assets copied) |
| `git diff --check` | clean |

The E2E suites skip without their `*_E2E_BASE_URL` env var, which is why the
default full run reports 3 skipped; both were executed explicitly against the
real backend and are recorded above as PASS.

## 13. Blockers

* `PRODUCTION_API_URL_REQUIRED` — still a **P39** blocker, not P38.
* No P38 blockers. This PR surfaces the backend P38 codes
  (`STOCK_RECONCILIATION_REQUIRED`, `SYNC_RETRYABLE_CONFLICT`) as retryable /
  action-required failures, so the backend PR should land first or together.
