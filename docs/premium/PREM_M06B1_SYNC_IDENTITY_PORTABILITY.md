# PREM-M06B1 - Restore Sync Identity Portability

Status: **HARD GATE PASS**

Mobile main SHA audited: `f60564b6e3dc64da791a72b9ddef2f23be5639a1`

PREM-M06B failed because Cloud backup snapshots carried domain data without the
sync identity metadata required for cross-device restore. Device B could restore
Device A's products, customers, sales, stock movements and cash entries, then
generate fresh `sync_id` values on later edits. That could duplicate backend
entities.

This task does not implement destructive Cloud Restore. It makes the snapshot
format carry portable sync identity and server version metadata so a future safe
restore engine can keep mapping restored local rows to their existing backend
rows.

## Identity Map Semantics

Durable source: `app_meta/sync_identity_map`.

Format:

`<localEntityType>:<localId>` -> `<server sync_id uuid>`

Portable entity identity:

- `category:<name>` -> `categories.sync_id`
- `product:<local product id>` -> `products.sync_id`
- `customer:<local customer id>` -> `customers.sync_id`
- `expense:<local expense id>` -> `expenses.sync_id`
- `transaction:<local transaction id>` -> `sales.sync_id`
- `sale_item:<transaction id>:<item index>:<product local id>` -> `sale_items.sync_id`
- `cash_entry:<local cash entry id>` -> `cash_ledger.sync_id`
- `stock_movement:<local movement id>` -> `stock_movements.sync_id`

Creation sources:

- Push mapper resolves or creates IDs before upload.
- Pull mapper binds server IDs to local rows.
- Conflict resolution can retain mappings while updating base versions.

Update sources:

- Category rename uses `rebindSyncId`.
- Pull applies remote identity binds/rebinds.

Deletion semantics:

- Tombstone-capable master entities keep identity knowledge in durable sync
  metadata, but a backup snapshot only exports mappings that still reference
  rows present in that snapshot.
- Dangling mappings are rejected by validation if they appear in a payload.

Portable decision:

The identity map is portable only when each mapping references a domain row in
the snapshot. Device-local identifiers, auth/session state, queues, request IDs
and journals are not part of this map.

## Server Version Semantics

Durable source: `app_meta/sync_server_versions_v1`.

Portable flat format:

`<server entity>:<sync_id>` -> `{ syncVersion, syncSequence }`

Portable server entities:

- `categories`
- `products`
- `customers`
- `expenses`
- `sales`
- `sale_items`
- `cash_ledger`
- `stock_movements`

The mapper uses `syncVersion` as `base_sync_version` for CAS/conflict detection
on future pushes. Pull also records `syncSequence` for evidence/order tracking.
These values describe backend entity versions, not a device transport attempt,
so they are portable when the matching identity mapping is present.

Non-exported server versions:

- `shifts` because shift state is not part of the backup domain contract.
- Any key without a matching exported identity mapping.

## Portable State

Portable:

- Entity identity mappings listed above.
- Matching entity-global server versions.

Non-portable:

- `device_identifier`
- registered device id or credentials
- Cloud auth token
- `cloud_context`
- subscription/payment state
- pending checkout
- `sync_queue`
- `sync_push_inflight_v1`
- request ids / retry counters / ACK transport state
- `sync_push_binding_v1`
- `sync_pull_binding_v1`
- `sync_pull_state_v1`
- `sync_bootstrap_state_v1`
- `sync_conflicts_v1`
- `sync_activity_log_v1`
- `sync_auto_settings_v1`
- `local_operation_journal_v1`
- future cloud restore journal

## Backup Schema Evolution

Current backup version is now `3`.

Top-level shape:

```json
{
  "schema": "pos-mobile-backup",
  "version": 3,
  "exportedAt": "...",
  "data": {},
  "syncMetadata": {
    "version": 1,
    "identityMap": {},
    "serverVersions": {}
  }
}
```

`data` remains the existing local backup domain contract. `syncMetadata` is
separate, portable metadata only.

Backward compatibility:

- v1 and v2 remain valid for local restore.
- v1/v2 classify as unsafe for cross-device Cloud restore with
  `UNSUPPORTED_BACKUP_VERSION`.
- v3 without valid portable metadata fails closed for cross-device restore.

## Validation And Classifier

Added primitives:

- `validatePortableSyncMetadata(payload)`
- `classifyCrossDeviceRestoreSafety(payload)`

Safety reasons include:

- `SAFE`
- `SYNC_IDENTITY_MISSING`
- `SYNC_IDENTITY_MALFORMED`
- `SYNC_VERSION_MALFORMED`
- `SYNC_IDENTITY_DANGLING`
- `SYNC_VERSION_DANGLING`
- `UNSUPPORTED_BACKUP_VERSION`
- `INVALID_BACKUP_PAYLOAD`

Validation rejects:

- dangling mappings
- duplicate contradictory mappings
- malformed UUIDs
- unsupported identity entity types
- server-version keys without matching identity mappings
- malformed server version values

## Snapshot Consistency

Cloud backup now uses `createBackupPayloadFromPersistence()` through
`premiumCloudBackupStore`.

Flow:

1. Flush persistence scheduler.
2. Read durable domain state and durable portable sync metadata from the same
   adapter.
3. Build one `createBackupPayload()` snapshot.
4. Serialize once, hash exact UTF-8 bytes and upload unchanged.

This keeps M06A checksum/idempotency semantics intact while avoiding a loose
Pinia-live-state plus app-meta mix for Cloud backup.

Local backup still uses the same serializer. When no adapter metadata is
provided, v3 includes an empty `syncMetadata` section and remains valid for
local restore.

## Mapper Proof

Regression coverage simulates Device B importing:

- `product:p-portable -> 11111111-1111-4111-8111-111111111111`
- `products:<same sync_id> -> syncVersion 9`

The next product edit maps to that same server `sync_id` and sends
`base_sync_version: 9`. It does not generate a new product identity.

## Transaction Identity

Transaction identity is portable as `transaction:<local id> -> sales.sync_id`.
Sale item identity is derived deterministically as:

`sale_item:<transaction id>:<item index>:<product local id>`

These identities are not request ids and do not depend on a device-local push
envelope. Future M06B must still block restore when pending queues, in-flight
envelopes or P38 journals are unresolved.

## Tombstones

The current local backup domain contract does not store deleted rows. Therefore
deleted/tombstoned identity metadata is not exported unless the row still exists
in the snapshot. Future backend reconciliation may add richer tombstone handling,
but M06B1 does not invent one.

## Negative Stock

Backup v3 keeps negative stock valid:

- `stock = -3`
- `stockBefore = 2`
- `stockAfter = -3`
- `quantityChange = -5`

No `min: 0` clamp was added to backup validation.

## Remaining M06B Prerequisites

M06B still needs a destructive restore engine with:

- sync idle/in-flight/P38 gates,
- durable safety snapshot,
- restore journal,
- atomic apply strategy,
- rollback and crash recovery,
- installation/session/device identity preservation,
- explicit user confirmation.

M06B can now use v3 `syncMetadata` to distinguish snapshots that are safe
candidates for cross-device restore from legacy v1/v2 snapshots.
