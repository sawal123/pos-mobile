# P37 — Cloud Sync Production E2E QA (Mobile)

- Date: 2026-09-16
- Base/main SHA: `ec9b626cc4226221d941952eedc66c126e1e5100`
- Branch: `feat/p37-cloud-sync-production-e2e` (PR to `main`, not merged)
- Depends on: backend `feat/p37-cloud-sync-contract-parity` must merge first —
  the mobile client pushes `cash_ledger`, `stock_movements`, product semantic
  fields and sale payment fields that only the P37 backend validates/stores.
- Environment: Node `v22.18.0`, Vitest `4.1.11`, Vue `3.5.41`, Windows

## Contract matrix (LOCAL FIELD → SERVER FIELD)

| Local field | Server field | Push | Pull | Required | Transform | Status |
|---|---|---|---|---|---|---|
| product.kind | products.kind | yes | yes | no (default `product`) | `service` passthrough, else `product` | PASS |
| product.cost | products.cost | yes | yes (new devices) | no | number ≥ 0 | PASS |
| product.stock | products.stock | yes | new devices only; never clobbers local stock | no | number ≥ 0 | PASS |
| product.unit | products.unit | yes | yes | no | trim | PASS |
| product.minStock | products.min_stock | yes | yes | no | number ≥ 0 | PASS |
| product.pricingUnit | products.pricing_unit | yes | yes | no | trim | PASS |
| product.minQuantity | products.min_quantity | yes | yes | no | number ≥ 0 | PASS |
| product.estimatedDuration | products.estimated_duration | yes | yes | no | trim | PASS |
| product.imageData | — (device-local) | **no** | **no** | — | never serialized; no `image_data` key emitted | PASS (limitation documented) |
| transaction.paymentMethod | sales.payment_method | yes | yes (authoritative converge) | no | lowercase trim | PASS |
| transaction.paymentStatus/status | sales.payment_status | yes | yes (authoritative converge) | no (`paid`/`unpaid`) | enum passthrough | PASS |
| transaction.paidAt | sales.paid_at | yes | yes (authoritative converge, incl. explicit null) | no | ISO string | PASS |
| transaction.cashReceived | sales.cash_received | yes | yes (authoritative converge) | no | int ≥ 0 | PASS |
| transaction.changeAmount | sales.change_amount | yes | yes (authoritative converge) | no | int ≥ 0 | PASS |
| transaction.grossProfit | sales.gross_profit | yes | yes | no | number | PASS |
| transaction.orderStatus | sales.order_status | yes | yes | no | Laundry lifecycle enum | PASS |
| transaction.estimatedCompletedAt | sales.estimated_completed_at | yes | yes | no | ISO string | PASS |
| transaction.note | sales.note | yes | yes | no | trim | PASS |
| transaction.customerSnapshot | sales.customer_snapshot | yes | yes (authoritative history; master keeps own name) | no | id/name/phone/email | PASS |
| transaction.businessSnapshot | sales.business_snapshot | yes | yes | no | name/outlet/phone | PASS |
| transaction items qty | sale_items.quantity | yes | yes | yes | **float** (2.5 kg preserved) | PASS |
| item hppSnapshot/costSnapshot | sale_items.cost_snapshot | yes | yes | no | **historical HPP, never recomputed** | PASS |
| item unit/pricingUnit | sale_items.unit/pricing_unit | yes | yes | no | trim | PASS |
| item kind | sale_items.kind | yes | yes | no | product/service | PASS |
| item lineCost | sale_items.line_cost | yes | yes | no | number ≥ 0 | PASS |
| cash entry (type/amount/category/note/referenceId/transactionId/createdAt) | cash_ledger (same + sale_sync_id) | yes | yes (applies; sale_sync_id → transactionId) | yes | stable movement/entry `sync_id`; canonical `transactionId` wins, never parse reference | PASS |
| stock movement (productId/type/qtyChange/before/after/referenceId/transactionId) | stock_movements (same + sale_sync_id) | yes | yes (applies; sale_sync_id → transactionId) | yes | `product_sync_id` resolved; same reference across products allowed | PASS |
| expense category | expenses.category | yes | yes | no | trim | PASS |
| tombstone deletes | changes.deletions[] | yes | yes (master removed locally; history untouched) | — | categories/products/customers/expenses only | PASS |

Pull conflict/lifecycle rules unchanged: pending-outbox records block remote
overwrite (`LOCAL_PENDING_SYNC_CONFLICT`), category renames rebind, sale items
resolve against pulled sales, cursor advances last.

## Supported entities

`categories`, `products` (+semantics), `customers`, `shifts`,
`sales` (+payment snapshot, lifecycle, gross profit, snapshots), `sale_items`
(HPP snapshots, decimal qty), `expenses` (+category),
**`cash_ledger`** (applies + converges balance), **`stock_movements`** (apply +
converge product stock), **`changes.deletions[]`** tombstones (master removed
locally, history untouched). Business/profile rows stay local-only
(`UNSUPPORTED_SERVER_ENTITY_BUSINESS`); history deletes stay blocked
(`DELETE_NOT_SUPPORTED_BY_SERVER_V1`) — no destructive replication.

## Free behavior

Free mode works fully offline: products, customers, transactions, cash,
stock, Laundry, restart persistence — no login, no API, no token, no network
loops (tracker no-ops when `businessStore.mode !== 'cloud'`; auto-sync needs
an explicit opt-in preference plus foreground + cooldown). Covered by
`cloud-sync-foundation`, `offline-business-core`, and the new free-mode
tracker test (`countPending() === 0` after a free cash entry).

## Subscriber behavior

Subscriber operations are identical locally; every mutation enters the durable
outbox (SQLite `sync_queue`, unique `(entity_type, entity_id)`), is mapped by
`contractMapper`, batched dependency-ordered (categories → … → transactions →
cash → stock), sent with a stable `request_id` inflight envelope, and cleaned
up with CAS. Retry of the same request returns `duplicate:true` server-side.

## Free → subscriber

The safe bootstrap stages local Free data into the outbox only after
preconditions, context-guard inspection, an empty-server check (`records=[],
server_sequence=0, next_cursor=0, has_more=false`), and a fail-closed mapper
preflight; pending deletes block staging. Eligible rows get stable sync
identities via the durable registry, the server receives them exactly once,
and subsequent pulls converge. Non-empty servers are never overwritten
(`BOOTSTRAP_SERVER_NOT_EMPTY`); version conflicts surface as `SYNC_CONFLICT`
for manual resolution, never silent server-wins.

## New-device bootstrap

A clean second device (login → business/outlet → device registration → pull)
restores all supported entities: the E2E run restored **9/9 records** on
device B (categories, products, customers, shifts, sales, sale_items,
expenses, cash_ledger, stock_movements) with semantics, payment snapshots and
decimal quantities intact. No default seed contaminates the restored catalog
(bootstrap is pull-driven; template seeding only happens pre-cloud).

## Tracker / shift semantics (P37 fixes)

- `transactionStore.updateOrderStatus` and `settleLaundryOrderPayment` are
  tracked (one transaction upsert each); `advanceOrderStatus`/`payLaundryOrder`
  wrappers are intentionally untracked so one mutation = one upsert. Cash
  settlement = one transaction upsert + one cash_entry upsert.
- `shiftStore.openShift` is a no-op (`false`) while a shift is open; after
  `closeShift`, the next `openShift` mints a fresh identity (`shift1.id !==
  shift2.id`), persisted as two logical server rows.
- Deleted-product tombstones apply without requiring a live category; deleted
  expenses are removed from the local master without touching history.

## Real HTTP E2E

Backend TEST server on dedicated `p37e2e.sqlite` (started with
`DB_CONNECTION=sqlite DB_DATABASE=.../p37e2e.sqlite php artisan serve
--host=127.0.0.1 --port=18010` — the TEST env must be set on the server
process; no production/dev DB touched; TEST sqlite is git-ignored):

- Device A builds category, 2 retail products + 1 Laundry service, customer
  Andi, shift #1, expense (Belanja Stok), cash sale, 2-product retail sale,
  Laundry unpaid 2.5 kg with HPP/customer snapshots; pushes via the actual
  push service; server verified (products, stock, 2 stock movements, cash,
  shift, expense, sales, items, HPP, gross profit, lifecycle, snapshots).
- Device B (fresh) pulls via the actual pull service and reconstructs Pinia
  (products, movements, stock, cash entries/balance, shift, expense, qty 2.5,
  HPP, gross profit, orderStatus, customerSnapshot).
- Lifecycle: A advances Masuk→Diproses, pushes; B sees Diproses. A settles
  cash, pushes; B sees paid/cash/paidAt + exactly one extra cash entry with
  exact balance; second B pull adds no duplicates.
- History: customer renamed Andi→Andi Baru pushes/pulls with master renamed
  while `customerSnapshot.name` stays Andi.
- Deletes: product/customer/expense tombstones push/pull with masters
  removed locally, queue back to 0, history intact, no
  `DELETE_NOT_SUPPORTED_BY_SERVER_V1`.
- Shifts: A opens #1, closes #1, opens #2 with fresh identity; server holds
  two rows; B converges on #2.
- Gate: E2E suite SKIPs (= FAIL) without `P37_E2E_BASE_URL`.

Result: **RUN #1 PASS (1/1), full TEST DB reset, RUN #2 PASS (1/1)** using the
actual `createSyncPushService`, `createSyncPullService`, `syncTracker`,
`contractMapper`, registry, queue, Pinia stores and real Laravel HTTP.

## Local-first failure behavior

Network failure preserves queue and POS operation; expired tokens require
re-login while local POS stays usable; sync state stays non-fatal
(`deriveSyncUiStatus`: Offline / Local only / Pending / Syncing / Synced /
Conflict / Recovery required). Free users see no alarming sync errors — cloud
preconditions fail closed and silent when `cloudAccess !== true`.

## Backup compatibility

Backup v2 unchanged (`BACKUP_VERSION = 2`, no bump): business data sections
round-trip exactly as before; cloud metadata (token, device id, cloud
context, queue, identity map, bindings, cursors, versions, conflicts,
activity log) stays excluded, which the P11 backup-isolation tests still
assert. `DB_VERSION` stays **4** — no local schema change was needed.

## API configuration

`VITE_API_BASE_URL` remains the single build-time source. Development uses
`http://localhost:8000` via `.env.example`. New static guard
`isProductionApiConfigured()` in `syncPullService.js` returns false for empty
or localhost URLs (covered by a unit test); since the actual production API
hostname is unavailable, **`PRODUCTION_API_URL_REQUIRED`** — the production
build must supply a real `VITE_API_BASE_URL` and must not silently use
localhost.

## Tests

Full unit suite: **39 passed + 1 skipped files, 1122 passed + 1 skipped tests
(1123 total)** — includes
`sync-parity-p37.spec.js` (29 tests: HPP/lifecycle/tombstone/convergence +
tracker-dedup, shift-identity, expense-tombstone, deleted-product-category
tests), `sync-pull-apply`, `sync-push-outbox`, `sync-bootstrap`, and the real
`p37-app-service-e2e.spec.js` (RUN #1 PASS, reset, RUN #2 PASS). `DB_VERSION`
stays unchanged — no local schema bump for the extra JSON/state fields.

## Build gates

`npm run test:unit -- --run` PASS · `npm run build` PASS ·
`npx cap sync android` PASS (4 plugins) · `git diff --check` clean.

## Known manual requirements

`UPGRADE_DEVICE_MANUAL_REQUIRED` · `RELEASE_FIRST_INSTALL_MANUAL_REQUIRED` ·
`PRINT_HARDWARE_MANUAL_REQUIRED` · `PRODUCTION_API_URL_REQUIRED` (P39 gate,
not P37 — P37 uses the localhost Laravel TEST server).

## Verdict

Client P37 complete: mutation tracking, shift identity, tombstone pulls,
canonical sale relations, real app-service HTTP E2E RUN #1 + RUN #2 PASS,
1122 passed + 1 skipped unit, build + cap sync PASS. **READY_FOR_P38** pending backend
PR #13 merge first (contract dependency).
