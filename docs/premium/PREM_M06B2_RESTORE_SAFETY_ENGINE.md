# PREM-M06B2 - Restore Safety Engine

## Status

HARD GATE PASS.

PREM-M06B1 is merged into `main` at `5e6388c35f4c8ebe81cb7636e2e1b8721c7387bf`, so backup v3 already carries portable `syncMetadata`.

This task does not download Cloud backups, does not add network restore, and does not enable a Cloud Restore button.

## Existing Restore Audit

Before B2, local restore used `restoreBackupPayload(payload, stores)` in `backupService.js`. That path validated the JSON and then patched Pinia stores sequentially:

- tax
- business
- products/categories/stock movements
- cash ledger
- customers
- expenses
- transactions
- cart clear

That was replace-not-merge, but it was not crash safe. A failure after one `$patch` could leave partial domain state in Pinia and then persistence watchers could durably persist that partial state. It also had no durable safety snapshot, no restore journal, no rollback, and no startup recovery.

SQLite already had table-level write transactions inside individual save methods, but there was no transaction spanning the whole restore. `local_operation_journal_v1` is reserved for P38 sale/laundry local operation recovery and is not reused for restore.

## Eligibility Policy

The centralized checker is `createRestoreSafetyEngine().checkRestoreEligibility()`.

Destructive restore is blocked with machine-readable codes when:

- persistence restore primitives are unavailable: `RESTORE_BLOCKED_PERSISTENCE_UNAVAILABLE`
- snapshot is invalid: `RESTORE_BLOCKED_INVALID_SNAPSHOT`
- backup version is unsupported: `RESTORE_BLOCKED_UNSUPPORTED_BACKUP_VERSION`
- cross-device backup is not v3 with valid portable sync metadata: `RESTORE_BLOCKED_CROSS_DEVICE_UNSAFE`
- `sync_queue` has pending rows: `RESTORE_BLOCKED_PENDING_SYNC`
- `sync_push_inflight_v1` exists: `RESTORE_BLOCKED_SYNC_IN_FLIGHT`
- `local_operation_journal_v1` has unresolved P38 entries: `RESTORE_BLOCKED_P38_JOURNAL_UNRESOLVED`
- `restore_journal_v1` has unresolved phase: `RESTORE_BLOCKED_RESTORE_JOURNAL_UNRESOLVED`
- shift is open: `RESTORE_BLOCKED_SHIFT_OPEN`

Pending sync queue is conservative in v1 of the engine. It blocks replace restore because queued mutations cannot be deterministically reconciled after local IDs and sync identities are replaced. The queue is never silently cleared or remapped.

## Cross-Device Safety

Cross-device mode reuses `classifyCrossDeviceRestoreSafety()`.

- v3 with valid portable `syncMetadata` can pass.
- v1/v2 are not considered cross-device safe.
- malformed/dangling identity map or server version metadata fails closed.

Same-device local restore continues to support v1/v2 for backward compatibility, but the destructive safety gates still apply.

## Safety Snapshot

Before any destructive mutation, the engine creates a persistence-backed safety snapshot with `createBackupPayloadFromPersistence()`. This reads durable adapter state after scheduler flush, not only live Pinia.

The safety snapshot includes:

- domain backup contract data
- portable sync identity metadata
- sync server versions

The restore journal stores the safety payload and checksum durably before apply begins. If safety snapshot creation or persistence fails, restore aborts without mutation.

## Restore Journal

Restore uses a dedicated `restore_journal_v1` in adapter private metadata. It is independent from P38.

Phases:

- `prepared`
- `applying`
- `verifying`
- `committed`
- `rollback_required`
- `rolling_back`
- `rolled_back`
- `recovery_required`

The journal stores operation id, phase, timestamps, mode, safety payload, safety checksum, target checksum, target backup version, and phase history.

## Atomic Apply

The adapter owns the durable commit boundary.

SQLite implements `applyRestoreSnapshotAtomic()` with one SQLite transaction that writes:

- business
- tax state
- products
- categories
- stock movements
- cash ledger
- customers
- expenses
- transactions
- v3 `sync_identity_map`
- v3 `sync_server_versions_v1`

Memory adapter mirrors that behavior with clone-and-swap rollback for tests.

The engine does not call sequential store `$patch` as the commit source. Pinia is rehydrated only after durable apply and verification succeed.

## Replace Semantics

Restore remains replace-not-merge for the backup domain contract.

Restore does not replace:

- `device_identifier`
- secure Cloud token
- Cloud context/session metadata
- pending subscription payment
- sync queue
- `sync_push_inflight_v1`
- sync request ids
- ACK/retry state
- P38 journal
- sync activity log
- runtime network state

## Portable Sync Metadata Apply

For v3, restore applies:

- `sync_identity_map`
- `sync_server_versions_v1`

It does not restore:

- `sync_queue`
- in-flight envelope
- request ids
- ACK state
- retry state
- P38 journal
- sync activity log
- Cloud state

For v1/v2 same-device local restore, portable metadata is not required and existing metadata is preserved.

## Verification

After durable apply, the engine reads persistence back and verifies:

- backup payload shape still validates
- persisted domain sections match the normalized target snapshot
- persisted business mode remains present
- v3 portable sync metadata validates and matches target metadata
- record IDs and negative stock values survive exactly through the domain comparison

## Rollback

If failure happens after destructive apply begins, the engine rolls back by applying the durable safety snapshot through the same adapter atomic primitive.

Rollback restores:

- domain state
- `sync_identity_map`
- `sync_server_versions_v1`

Device/session/transport state stays preserved because neither target apply nor rollback touches it.

If rollback fails, the journal is left in `recovery_required` and the result code is `RESTORE_RECOVERY_REQUIRED`.

## Crash Recovery

Startup calls `recoverPendingRestore()` after persistence initialization and before sync foundation/auto-sync setup.

Recovery behavior:

- `prepared`: no destructive mutation started, so cleanup aborts the restore.
- `applying`, `verifying`, `rollback_required`, `rolling_back`: restore safety snapshot and clear the journal only after rollback succeeds.
- `committed`: successful restore is not rolled back; cleanup is finalized idempotently.
- checksum mismatch or rollback failure: journal moves to `recovery_required`.

If recovery fails, bootstrap renders a fail-closed screen and does not mount the normal POS app.

## Pinia Boundary

Persistence is authoritative. Pinia is not the commit source.

Sequence:

1. validate target snapshot
2. eligibility gate
3. create durable safety snapshot
4. write journal `prepared`
5. write journal `applying`
6. adapter atomic apply
7. write journal `verifying`
8. verify persisted state
9. write journal `committed`
10. rehydrate Pinia from persistence
11. clear restore journal

If Pinia rehydrate fails after DB commit, the engine returns `RESTORE_REHYDRATE_FAILED`; it does not roll back a verified committed database.

## Local Restore Integration

`SettingsView.vue` local restore now calls the active restore safety engine with `confirmed: true` after the existing user confirmation dialog. The old synchronous `restoreBackupPayload()` remains for legacy unit tests and pure Pinia compatibility tests, but the UI no longer uses it for destructive local restore.

## Limitations

- Cloud restore download remains unimplemented.
- There is no Cloud Restore button.
- Same-device v1/v2 restore is still supported for backward compatibility, but it cannot import portable sync metadata because those backups do not contain it.
- Pending queue reconciliation is intentionally not attempted in B2.
