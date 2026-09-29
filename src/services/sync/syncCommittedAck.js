import { SYNC_ENTITY_TYPES } from './syncConstants'

/**
 * Applies the existing push acknowledgment for an envelope the server has
 * definitively accepted — either inline from `pushNow` or after INT-04
 * reconciliation confirmed `status = committed`.
 *
 * Guarantees:
 * - Only queue rows still byte-identical to the original snapshot are removed
 *   (compare-and-swap); rows mutated locally while the request was in-flight
 *   are preserved.
 * - Superseded snapshots (which never travelled but share an entity row) are
 *   removed by id.
 * - The in-flight envelope is cleared only when every cleanup succeeded, so a
 *   storage failure keeps it for a safe retry with the same request_id.
 * - Fresh server versions are learned for every travelled row so a follow-up
 *   mutation of the same entity carries the correct base_sync_version.
 *
 * Never sends a request and never re-applies a committed mutation.
 *
 * @param {object} params
 * @param {object} params.adapter
 * @param {object} params.queueService
 * @param {object} params.registry
 * @param {object} params.envelope
 * @returns {Promise<{removedQueueIds: string[], preservedQueueIds: string[], cleanupFailedQueueIds: string[], hasStorageError: boolean}>}
 */
export async function applyCommittedAcknowledgment({ adapter, queueService, registry, envelope }) {
  const removedQueueIds = []
  const preservedQueueIds = []
  const cleanupFailedQueueIds = []

  const supersededSnapshots = Array.isArray(envelope?.supersededSnapshots)
    ? envelope.supersededSnapshots
    : []
  const queueSnapshots = Array.isArray(envelope?.queueSnapshots) ? envelope.queueSnapshots : []

  for (const snapshot of [...supersededSnapshots, ...queueSnapshots]) {
    const isSuperseded =
      Boolean(snapshot?.id) && supersededSnapshots.some((s) => s.id === snapshot.id)

    const casResult = isSuperseded
      ? await queueService.remove(snapshot.id)
      : await queueService.removeIfUnchanged(snapshot)

    if (casResult.ok) {
      if (casResult.removed ?? true) {
        removedQueueIds.push(snapshot.id)
      } else {
        // CAS mismatch: entity mutated locally while the request was in-flight.
        preservedQueueIds.push(snapshot.id)
      }
    } else {
      // Storage/SQLite error: not a CAS mismatch, local cleanup genuinely failed.
      cleanupFailedQueueIds.push(snapshot.id)
    }
  }

  const hasStorageError = cleanupFailedQueueIds.length > 0

  if (!hasStorageError && adapter && typeof adapter.clearSyncPushInflight === 'function') {
    await adapter.clearSyncPushInflight()
  }

  if (
    !hasStorageError &&
    adapter &&
    typeof adapter.loadSyncServerVersions === 'function' &&
    typeof adapter.saveSyncServerVersions === 'function'
  ) {
    try {
      const existingVersions = (await adapter.loadSyncServerVersions()) || {}
      const nextVersions = { ...existingVersions }

      const queueSyncId = async (entityType, entityId) => {
        try {
          return await registry.peekSyncId(entityType, entityId)
        } catch {
          return null
        }
      }

      for (const snapshot of queueSnapshots) {
        const syncId = await queueSyncId(snapshot.entityType, snapshot.entityId)
        if (!syncId) continue

        const lower = `${syncId}`.toLowerCase()
        const serverKey =
          snapshot.entityType === SYNC_ENTITY_TYPES.CATEGORY
            ? `categories:${lower}`
            : snapshot.entityType === SYNC_ENTITY_TYPES.PRODUCT
              ? `products:${lower}`
              : snapshot.entityType === SYNC_ENTITY_TYPES.CUSTOMER
                ? `customers:${lower}`
                : snapshot.entityType === SYNC_ENTITY_TYPES.EXPENSE
                  ? `expenses:${lower}`
                  : snapshot.entityType === SYNC_ENTITY_TYPES.SHIFT
                    ? `shifts:${lower}`
                    : snapshot.entityType === SYNC_ENTITY_TYPES.TRANSACTION
                      ? `sales:${lower}`
                      : snapshot.entityType === SYNC_ENTITY_TYPES.CASH_ENTRY
                        ? `cash_ledger:${lower}`
                        : snapshot.entityType === SYNC_ENTITY_TYPES.STOCK_MOVEMENT
                          ? `stock_movements:${lower}`
                          : null

        if (serverKey && nextVersions[serverKey] === undefined) {
          nextVersions[serverKey] = { syncVersion: 1, syncSequence: 0 }
        }

        // Sale-item rows are derived deterministically from the parent
        // transaction row: learn their versions too.
        if (snapshot.entityType === SYNC_ENTITY_TYPES.TRANSACTION) {
          const payloadItems = Array.isArray(snapshot.payload?.items) ? snapshot.payload.items : []
          for (let i = 0; i < payloadItems.length; i++) {
            const item = payloadItems[i]
            const prodLocalId = item?.id ?? item?.productId ?? item?.product_id ?? item?.name
            try {
              const itemSyncId = await registry.peekSyncId(
                'sale_item',
                `${snapshot.entityId}:${i}:${prodLocalId}`,
              )
              if (itemSyncId) {
                const itemKey = `sale_items:${`${itemSyncId}`.toLowerCase()}`
                if (nextVersions[itemKey] === undefined) {
                  nextVersions[itemKey] = { syncVersion: 1, syncSequence: 0 }
                }
              }
            } catch {
              // best-effort only
            }
          }
        }
      }

      await adapter.saveSyncServerVersions(nextVersions)
    } catch {
      // Version learning is best-effort: the next push still works.
    }
  }

  return { removedQueueIds, preservedQueueIds, cleanupFailedQueueIds, hasStorageError }
}
