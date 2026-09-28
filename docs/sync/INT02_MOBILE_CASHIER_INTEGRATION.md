# INT-02 — Mobile Cashier Sync Capabilities

Integration of the INT-01 backend contract (`cashier_sync_v1`) into POS Mobile.

| Item             | Value                                                    |
| ---------------- | -------------------------------------------------------- |
| Task             | INT-02 — POS Mobile Cashier Sync Capabilities            |
| Repository       | `pos-mobile`                                             |
| Backend contract | `pos_dashboard` → `docs/sync/INT01_CASHIER_SYNC_V1.md`   |
| Commit           | `feat(sync): integrate cashier-safe mobile capabilities` |
| Scope            | POS Mobile only. No backend, no deploy, no auto-merge.   |

---

## 1. What changed and why

Before INT-02 the mobile outbox blindly mirrored every local mutation into a
single `/api/sync/push` envelope. For an `owner`/`member` membership that is
correct. For a `cashier` membership the backend now accepts **only** a narrow
allowlist and rejects the _entire_ envelope if any operation is forbidden
(`403 SYNC_OPERATION_NOT_ALLOWED`, all-or-nothing preflight).

A cashier device therefore had two failure modes:

1. a single locally-created product/category/expense would poison the whole
   envelope, so _nothing_ synced; and
2. retrying the same rejected envelope forever would never converge.

INT-02 makes the mobile client **capability aware**: it consumes the per-business
`role` + `sync_capabilities` from `GET /api/mobile/context`, partitions the
durable outbox into _sendable_ and _restricted_ rows, keeps restricted rows
durable and visible, and recovers safely from a server rejection.

---

## 2. Capability matrix

`sync_capabilities.push_mode` (from the backend) maps to client behaviour:

| Role                  | `push_mode`    | Client behaviour                               |
| --------------------- | -------------- | ---------------------------------------------- |
| `owner`               | `full`         | Existing full contract. Nothing is filtered.   |
| `member`              | `full`         | Existing full contract. Nothing is filtered.   |
| `cashier`             | `cashier_safe` | Allowlist filtering + dependency gate.         |
| unknown / unsupported | `none`         | **Deny by default.** No cloud mutation at all. |
| absent + no `role`    | _(legacy)_     | Treated as owner/member (see §8).              |

Per-entity behaviour under `cashier_safe` (local outbox entity → server entity):

| Local outbox entity                   | Server entity          | Cashier                      |
| ------------------------------------- | ---------------------- | ---------------------------- |
| `customer` (upsert)                   | `customers`            | ✅ allowed                   |
| `customer` (delete)                   | `deletions`            | ⛔ role-restricted           |
| `shift` (upsert)                      | `shifts`               | ✅ allowed                   |
| `transaction` (upsert)                | `sales` + `sale_items` | ✅ allowed, dependency-gated |
| `cash_entry` (sale-linked)            | `cash_ledger`          | ✅ allowed, dependency-gated |
| `cash_entry` (manual in/out)          | `cash_ledger`          | ⛔ role-restricted           |
| `stock_movement` (type `sale`)        | `stock_movements`      | ✅ allowed, dependency-gated |
| `stock_movement` (adjustment/restock) | `stock_movements`      | ⛔ role-restricted           |
| `category`                            | `categories`           | ⛔ role-restricted           |
| `product`                             | `products`             | ⛔ role-restricted           |
| `expense`                             | `expenses`             | ⛔ role-restricted           |
| `business`                            | —                      | ⛔ role-restricted           |

The local classification lives in `src/services/sync/syncCapabilityPolicy.js`
and is fully pure (no I/O), so it is directly unit-testable.

---

## 3. Cloud context & capability lifecycle

`GET /api/mobile/context` is now called with
`?device_identifier=<stable uuid>` and its per-business `role` /
`sync_capabilities` are stored on `cloudSessionStore` **for the business that is
actually selected** — never globally.

New `cloudSessionStore` state / computeds:

| Member                  | Meaning                                                           |
| ----------------------- | ----------------------------------------------------------------- |
| `role`                  | Membership role of the selected business.                         |
| `syncCapabilities`      | Raw INT-01 capability contract of the selected business.          |
| `deviceContext`         | `device_context` reported for the selected outlet.                |
| `capabilityState`       | `verified` \| `unverified` \| `legacy` \| `unknown`.              |
| `pushPolicy`            | Resolved policy (`pushMode`, `allowedEntities`, `failClosed`, …). |
| `canPerformCloudPush`   | `capabilityState === 'verified'` **and** push enabled.            |
| `syncCapabilitySummary` | Compact summary for the Sync Status UI.                           |

Refresh triggers (`refreshContext()`):

- immediately after login;
- before an authorization-sensitive push when the cache is `unverified`;
- after the server rejects access (403) — driven by
  `result.requiresContextRefresh`;
- during session recovery.

**A cached capability is never permanent authorization.** On app restart it is
restored for offline continuity but marked `unverified` (or `legacy` when the
cache predates INT-01), and `canPerformCloudPush` stays `false` until it is
re-confirmed online. The bearer token remains exclusively in secure storage
(`tokenRepository`); `role`, `sync_capabilities` and `device_context` are the
only non-sensitive fields added to the persisted cloud context, so **no bearer
token is ever written to SQLite**.

**Every push path is authorized by the same verified snapshot.**
`cloudSessionStore.ensureVerifiedContext()` refreshes `legacy`/`unverified`/
`revoked` contexts online and then returns the freshly verified
`{ role, syncCapabilities, capabilityState }`. The push service consumes that
snapshot when the caller omits role/capabilities — which is exactly what the
orchestrator ("Sinkronkan Semua") and auto-sync callers do — so a cashier can
never fall back to the legacy owner/member contract and send restricted
entities. A failed refresh fails closed (`SYNC_CAPABILITIES_UNVERIFIED`) and
**never deletes the outbox**; only a successful online verification of a
`legacy` backend keeps owner/member on the full contract.

---

## 4. Cashier device registration flow

Cashiers cannot call `POST /api/mobile/devices` (owner/member only).

```
Owner (Dashboard)                     Cashier device (POS Mobile)
────────────────                      ───────────────────────────
1. Register device for outlet
2. Backend binds identifier
                                     3. login → GET /api/mobile/context
                                        ?device_identifier=<uuid>
                                     4. device_context returned per business
                                     5. resolveDeviceFromContext():
                                          id present?        → registeredDeviceId
                                          status inactive?   → STOP cloud sync
                                          outlet mismatch?   → STOP cloud sync
                                          absent?            → instruct owner
                                                               to register in the
                                                               Dashboard
                                     6. bootstrap / push may now proceed
```

Implementation notes:

- The identifier is the existing stable per-installation UUID
  (`deviceIdentifier` service, `app_meta`), never a user/business/outlet id.
- Resolution **accepts several field spellings** (`id`/`device_id`/`deviceId`,
  `identifier`/`device_identifier`/`deviceIdentifier`,
  `outlet_id`/`outletId`, `status`/`active`/`is_active`) to stay tolerant of the
  backend serializer.
- Resolution validates **status**, **identifier** and **outlet** before binding
  `registeredDeviceId`. A `device_context` whose `identifier` belongs to another
  installation is rejected (`DEVICE_IDENTIFIER_MISMATCH`), so a device returned
  for a different stable identifier can never be bound to this session.
- `doRegisterDevice()` returns
  `CASHIER_DEVICE_REGISTRATION_FORBIDDEN` for a cashier and performs **no**
  network call. No auto-registration, no QR pairing, no new device secret.
- Owner/member keep the existing registration flow unchanged.

Result codes surfaced to the UI: `DEVICE_NOT_REGISTERED`, `DEVICE_INACTIVE`,
`DEVICE_IDENTIFIER_MISMATCH`, `DEVICE_OUTLET_MISMATCH`.

`CloudLoginView` drives the real onboarding flow: a cashier login refreshes
`GET /api/mobile/context?device_identifier=…` and resolves the returned
`device_context` instead of calling `POST /api/mobile/devices`.

---

## 5. Capability-safe outbox

The push service builds each envelope from the durable `sync_queue`, then:

1. drops candidates with an open conflict (unchanged);
2. **classifies** each remaining candidate (`classifyOutboxEntryForPolicy`);
3. puts **role-restricted** rows into `result.restricted` and skips them;
4. maps the allowed rows (unchanged contract mapper);
5. applies the **cashier dependency gate** (see §6) and puts deferred rows into
   `result.deferred`;
6. accumulates only allowed, satisfied changes into the envelope.

Guarantees:

- Restricted and deferred rows are **never placed in the envelope**, therefore
  they can never appear in a mixed payload.
- They are **never deleted, never removed and never marked as acknowledged**.
  They stay in `sync_queue` and are reported in Sync Status.
- A restricted row created _before_ a role change (member → cashier) is **not
  discarded**; it is simply not sendable under the new role.
- Owner/member behaviour is byte-for-byte unchanged: for `push_mode === 'full'`
  the classifier returns `allow` for everything, and no reordering or gating is
  applied.

---

## 6. Transaction dependencies

Dependencies are evaluated **only** for `cashier_safe`, and only from canonical
relations — never by parsing a human-readable reference string.

| Chain                             | Rule                                                                                                                                                |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sale → customer`                 | Deferred while a referenced customer is pending in the outbox but not selected for this batch.                                                      |
| `sale_item → sale + product`      | Every item's product must already exist server-side (known via `sync_server_versions_v1`, populated by push **and** pull).                          |
| `cash payment → sale`             | Canonical `transactionId` required; the sale must be a settled **cash/tunai + paid** sale and either in the same envelope or already on the server. |
| `stock movement → sale + product` | `movement_type = sale`, canonical `transactionId`, negative `quantity_change`, product known on the server, sale in the envelope or on the server.  |

If a cashier created a product locally, that product is role-restricted and can
never be pushed, so every sale that depends on it is reported as
**dependency-blocked** rather than sent with a broken server relation.

The original data is always preserved. A legitimate offline oversell (negative
stock) and historical HPP snapshots are untouched — the gate only checks the
_relation_, never the quantity.

Candidate ordering also changes for `cashier_safe` only: cash and stock rows are
processed _after_ the transactions in the same envelope so that
"is the sale in this envelope?" can be answered deterministically.

---

## 7. In-flight, 403 recovery and re-plan safety

On `403`:

1. the outbox is **not** cleared and the push is **not** treated as successful;
2. the in-flight envelope is **kept** and annotated with
   `rejectionCode` / `rejectionAt` / `rejectionFingerprint`;
3. the affected rows only have `attempt_count` incremented (data preserved);
4. the result carries `roleMismatch`, `requiresContextRefresh` and
   `deviceBlocked` so the store can react;
5. `syncPushStore` refreshes `role` + `sync_capabilities` when online and
   re-verifies before the next attempt.

Repeated retries of the _same_ envelope are prevented by the fingerprint:
`pushMode | source | role | contractVersion` plus the outbox
`id:updatedAt:operation` list. While the fingerprint is unchanged the push
short-circuits with `SYNC_ENVELOPE_REJECTED_PENDING_CONTEXT_CHANGE` and performs
**no HTTP request**.

Once a condition changes (role/capabilities refreshed, or the outbox changed),
the rejected envelope is discarded and rebuilt from the durable outbox. This is
safe because a `403` preflight is all-or-nothing — the rejected envelope was
never applied server-side, so nothing acknowledged can be lost. The new envelope
is persisted **before** the HTTP request, so a crash between discard and send
simply re-plans on the next run.

Preserved error semantics (unchanged): `409 SYNC_CONFLICT`,
`409 SYNC_RETRYABLE_CONFLICT`, `409 SYNC_DATA_CONFLICT`,
`403 DEVICE_INACTIVE`, `403 CLOUD_SUBSCRIPTION_REQUIRED`,
`403 BUSINESS_ACCESS_DENIED`, `422` validation.

---

## 8. UX and backward compatibility

Sync Status now distinguishes:

| State                            | UI status                                                |
| -------------------------------- | -------------------------------------------------------- |
| Synced / nothing pending         | `SYNC_UI_CLEAR`                                          |
| Waiting to be sent               | `SYNC_UI_PENDING`                                        |
| **Not allowed by role**          | `SYNC_UI_RESTRICTED` (new)                               |
| **Dependency not yet available** | reported via `deferred` in the push/orchestration result |
| Conflict                         | `SYNC_UI_CONFLICT`                                       |
| Device inactive                  | `403 DEVICE_INACTIVE` result + `deviceBlocked`           |
| Offline                          | `SYNC_UI_OFFLINE`                                        |

`readLocalStatus()` gained an **additive** `restrictedCount` (default `0`, and
`0` for owner/member), so the badge never implies a fully clean sync while
restricted rows are pending.

**Full Sync semantics are not silently changed.** The orchestrator still pushes
then pulls, and still stops before pulling on a hard block. But when the only
remaining rows are role-restricted or dependency-deferred, it now proceeds to
pull (a pull can supply a missing dependency) and returns the distinct code
`SYNC_ALL_COMPLETED_WITH_RESTRICTED` with `partial: true` plus the `restricted`
and `deferred` arrays.

Backward compatibility:

- **Owner/member** keep the exact existing full contract.
- **Legacy cache without `sync_capabilities`**: the capability contract is
  treated as _unverified_ (the UI says so and auto-verification is required
  online). The cached context — including the registered device — is preserved;
  no data is deleted. Because cashier cloud sync did not exist before INT-01, a
  pre-INT-01 cache can only ever have belonged to an owner/member membership, so
  it remains on the full contract rather than being needlessly blocked.
- **Present-but-unknown contract** (`contract_version` not recognised, invalid
  `push_mode`) or an **unrecognised role** fails **closed** for cloud mutation
  while preserving all local data.
- **Revoked membership**: when a refresh succeeds but the previously selected
  business is gone, the cloud context for that business is cancelled
  (`capabilityState = revoked`), `registeredDeviceId` is revoked from the active
  session, permissions are **not** marked verified, every piece of local POS
  data and the still-valid token are preserved, and the UI instructs the user to
  choose another business or contact the owner (`BUSINESS_ACCESS_REVOKED`).
- **Free offline mode is unaffected**: with no token, hydration returns
  `authenticated: false`, no sync call is made, and the POS keeps working.

---

## 9. Files changed

| File                                              | Change                                                                                                                                                                                                                                              |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/services/sync/syncCapabilityPolicy.js`       | **new** — pure role/capability resolution, outbox classification, dependency gate.                                                                                                                                                                  |
| `src/services/sync/syncPushService.js`            | capability-aware partitioning, cashier candidate ordering, dependency gate, 403 handling, rejected-envelope fingerprint + safe re-plan, `restricted`/`deferred`/`policy` in results; policy resolved from the verified snapshot when the caller omits role/capabilities (orchestrator/auto-sync).                                                                |
| `src/services/sync/syncOrchestratorService.js`    | pull despite restricted/deferred rows; `SYNC_ALL_COMPLETED_WITH_RESTRICTED` + `partial`.                                                                                                                                                            |
| `src/services/sync/syncStatusService.js`          | `SYNC_UI_RESTRICTED`, additive `restrictedCount`, optional `capabilityProvider`.                                                                                                                                                                    |
| `src/services/sync/index.js`                      | exports for the policy module and the new UI status; wires `capabilityProvider`.                                                                                                                                                                    |
| `src/stores/cloudSessionStore.js`                 | per-business `role`/`syncCapabilities`/`deviceContext`, `capabilityState`, `pushPolicy`, `canPerformCloudPush`, `refreshContext()`, `resolveDeviceFromContext()`, identifier/status/outlet device validation, cashier device-registration guard, capability persistence + unverified hydration, verified-snapshot `ensureVerifiedContext()`. |
| `src/stores/syncPushStore.js`                     | passes capability context; pre-push re-verification; wires the capability verifier into its fallback push service; post-403 context refresh.                                                                                                                                                    |
| `src/stores/syncStatusStore.js`                   | exposes `restrictedCount`.                                                                                                                                                                                                                          |
| `src/services/cloud/authService.js`               | `fetchMobileContext(token, { deviceIdentifier })`.                                                                                                                                                                                                  |
| `src/__tests__/sync-cashier-capabilities.spec.js` | **new** — 54 regression tests (incl. fail-closed context, revoked membership, cashier onboarding UI, restricted product dependency).                                                                                                                                                                                                                      |
| `docs/sync/INT02_MOBILE_CASHIER_INTEGRATION.md`   | **new** — this document.                                                                                                                                                                                                                            |

No database schema migration was required: the cloud context and the in-flight
envelope are stored as opaque JSON, and the envelope validators tolerate
additional fields.

---

## 10. Test results

```
npx vitest run
  Test Files  46 passed | 2 skipped (48)
  Tests      1243 passed | 3 skipped (1246)

npm run build
  ✓ built in ~1s   (155 modules; chunk-size warning is informational)
```

`src/__tests__/sync-cashier-capabilities.spec.js` (41 tests) covers:

1. role + capabilities per business;
2. business/outlet switching;
3. device from owner pre-registration;
4. cashier never calls device registration;
5. mixed outbox never becomes a mixed payload;
6. restricted entries remain durable;
7. member → cashier with an old token (enforced on the next request);
8. cashier → member after a context refresh;
9. 403 rejection without data loss;
10. restart with an existing in-flight envelope;
11. owner/member backward compatibility;
12. Free offline mode unaffected;
13. sale-linked cash and stock;
14. negative stock oversell preserved;
15. laundry lifecycle mapping;
16. SQLite / memory adapter parity;
17. bootstrap preconditions and crash-restart recovery;
18. fail-closed push authorization context for role-less callers
    (orchestrator + auto-sync), online refresh of legacy/unverified caches, and
    outbox preservation when the refresh fails (incl. an offline restart);
19. revoked membership: business cancellation, device revocation, preserved
    local data and a fail-closed push;
20. cashier onboarding through the real `CloudLoginView` UI (device resolved
    from `device_context`, never `POST /api/mobile/devices`) plus identifier
    mismatch rejection;
21. restricted product dependency: a server-known product lets the sale through
    while the product mutation is never sent, an unknown product stays
    dependency-blocked.

`oxlint` reports no new findings; the three remaining `no-unused-vars` items in
`syncPushService.js` and the unused re-export imports in `sync/index.js` are
pre-existing on `main`.

---

## 11. Known limitations (require direct backend testing)

These cannot be fully verified from the mobile repository and need a live
`pos_dashboard` instance:

1. **Exact `device_context` shape.** The resolver accepts several field
   spellings; the authoritative serializer should be confirmed against
   `GET /api/mobile/context?device_identifier=…` on a real backend.
2. **Envelope-level atomicity assertion.** That a mixed payload really returns
   `403 SYNC_OPERATION_NOT_ALLOWED` with a populated `violations[]` is asserted
   here only against a mocked transport.
3. **Stock-movement cumulative deduction.** The client defers on a missing
   relation but does not re-implement the server's
   `committed + incoming ≤ sold quantity` rule or its `SELECT … FOR UPDATE`
   concurrency behaviour.
4. **Sale/sale-item/shift immutability.** The client sends only forward
   transitions; the 422/409 responses for an attempted rewrite are not exercised
   end-to-end.
5. **`409 SYNC_CONFLICT` for cashier rows.** Conflict resolution flows are
   shared with owner/member and were not separately re-verified against a
   cashier membership.
6. **Real native SQLite.** Parity here runs against a faithful SQLite shim
   (`sync_queue` + `app_meta`); on-device verification of the same scenario is
   still recommended.
7. **Subscription / device deactivation timing.** That the backend rejects a
   push after a mid-session deactivation is assumed from the contract, not
   reproduced live.
