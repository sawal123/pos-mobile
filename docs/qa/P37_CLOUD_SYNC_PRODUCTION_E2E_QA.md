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
| transaction.paymentMethod | sales.payment_method | yes | yes (fill-in) | no | lowercase trim | PASS |
| transaction.paymentStatus/status | sales.payment_status | yes | yes (fill-in) | no (`paid`/`unpaid`) | enum passthrough | PASS |
| transaction.paidAt | sales.paid_at | yes | yes (fill-in) | no | ISO string | PASS |
| transaction.cashReceived | sales.cash_received | yes | yes (fill-in) | no | int ≥ 0 | PASS |
| transaction.changeAmount | sales.change_amount | yes | yes (fill-in) | no | int ≥ 0 | PASS |
| transaction items qty | sale_items.quantity | yes | yes | yes | **float** (2.5 kg preserved) | PASS |
| item hppSnapshot | — (snapshot stays local) | no | no | — | historical cost never recomputed from current product cost | PASS |
| cash entry (type/amount/category/note/referenceId/createdAt) | cash_ledger (same) | yes | versions only | yes | `reference_id` is the retry identity | PASS |
| stock movement (productId/type/qtyChange/before/after/referenceId) | stock_movements (same) | yes | versions only | yes | `product_sync_id` resolved; reference is the retry identity | PASS |
| transaction.customerSnapshot/businessSnapshot | — | no | no | — | local-only blobs, warning only | PASS |

Pull conflict/lifecycle rules unchanged: pending-outbox records block remote
overwrite (`LOCAL_PENDING_SYNC_CONFLICT`), category renames rebind, sale items
resolve against pulled sales, cursor advances last.

## Supported entities

`categories`, `products` (+semantics), `customers`, `shifts` (versions only),
`sales` (+payment snapshot), `sale_items` (decimal qty), `expenses`,
**`cash_ledger`**, **`stock_movements`**. Business/profile rows stay local-only
(`UNSUPPORTED_SERVER_ENTITY_BUSINESS`); deletes stay blocked
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

## Real HTTP E2E

Against a real `php artisan serve` instance (dedicated `p37e2e.sqlite`;
recipe: create a dedicated env file — shell `DB_*` overrides do **not** reach
`serve` reliably — then `migrate`, `serve --env=<file>`):

1. seeded owner/business/outlet/cloud subscription; 2. login → Bearer token;
3. registered device A; 4. pushed 9-entity payload (Laundry service semantics,
cash sale, decimal 2.5 kg item, cash entry, stock movement); 5. verified
server-side via pull shape; 6. clean device B pull restored 9/9; 7. offline
mutation (price 10000→12000 + new cash-out) pushed; 8. device-B pull converged
(update + new entry visible); 9. stale `base_sync_version: 1` push rejected
with `409 SYNC_CONFLICT`.

Result: **31/31 E2E checks passed**, reproduced twice after a full reset
(reset seeder wiped devices/tokens/sync rows; E2E env/seeders/sqlite deleted
afterwards, none committed). Mock unit tests did not replace this gate.

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

Full unit suite: **39 files, 1104 tests, 0 failed** (baseline 1088 + 16 new
in `src/__tests__/sync-parity-p37.spec.js`). Also updated
`sync-contract-mapper.spec.js` (product semantics replace the old
`UNSUPPORTED_PRODUCT_STOCK_FIELD` warning; payment snapshots replace the old
transaction-field warning). Changed-file ESLint: clean. Changed-file oxlint:
clean after removing the now-unused `isPositiveInteger` helper
(`syncPushService.js` findings are pre-existing debt, out of scope).

## Build gates

`npm run test:unit -- --run` PASS · `npm run build` PASS ·
`npx cap sync android` PASS (4 plugins) · `git diff --check` clean.

## Known manual requirements

`UPGRADE_DEVICE_MANUAL_REQUIRED` · `RELEASE_FIRST_INSTALL_MANUAL_REQUIRED` ·
`PRINT_HARDWARE_MANUAL_REQUIRED` · `PRODUCTION_API_URL_REQUIRED`. Cash/stock
pull is intentionally versions-only on the client (server history never
rewrites local ledger/stock levels); product `imageData` is device-local for
P37 (no object storage architecture exists).

## Verdict

Client-side P37 complete: parity mapping, idempotent cash/stock tracking,
safe bootstrap, new-device restore, real HTTP E2E 31/31, 1104/1104 green.
**READY_FOR_P38** pending backend merge first (contract dependency).
