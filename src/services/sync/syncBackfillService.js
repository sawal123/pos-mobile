import { SYNC_ENTITY_TYPES } from './syncConstants'
import { useBusinessStore } from '@/stores/businessStore'
import { useTransactionStore } from '@/stores/transactionStore'
import { useCloudSessionStore } from '@/stores/cloudSessionStore'

/**
 * Ensures any local transaction created while offline or before Cloud mode was
 * activated is backfilled into the durable sync queue so no sale is lost.
 *
 * @param {object} options
 * @param {import('pinia').Pinia} options.pinia
 * @param {object} options.queueService
 * @returns {Promise<number>} Count of newly enqueued transactions.
 */
export async function backfillUnsyncedTransactions({ pinia, queueService, adapter = null } = {}) {
  if (!queueService || typeof queueService.enqueueUpsert !== 'function') {
    return 0
  }

  const businessStore = useBusinessStore(pinia)
  const cloudStore = useCloudSessionStore(pinia)
  const transactionStore = useTransactionStore(pinia)

  // Only backfill if the device is connected to Cloud or in cloud mode
  const isCloud =
    businessStore.mode === 'cloud' ||
    (cloudStore.isLinked && cloudStore.hasCloudAccess) ||
    cloudStore.cloudAccess === true
  if (!isCloud) {
    return 0
  }

  if (businessStore.mode !== 'cloud') {
    businessStore.mode = 'cloud'
  }

  let serverVersions = {}
  try {
    if (adapter && typeof adapter.loadSyncServerVersions === 'function') {
      serverVersions = (await adapter.loadSyncServerVersions()) || {}
    }
  } catch {
    serverVersions = {}
  }

  let identityMap = {}
  try {
    if (adapter && typeof adapter.loadSyncIdentityMap === 'function') {
      identityMap = (await adapter.loadSyncIdentityMap()) || {}
    }
  } catch {
    identityMap = {}
  }

  let existingQueue = []
  try {
    if (typeof queueService.listPending === 'function') {
      existingQueue = await queueService.listPending()
    } else if (typeof queueService.listSyncQueueItems === 'function') {
      existingQueue = await queueService.listSyncQueueItems()
    }
  } catch {
    existingQueue = []
  }

  const queuedTrxIds = new Set(
    existingQueue
      .filter((item) => item.entityType === SYNC_ENTITY_TYPES.TRANSACTION)
      .map((item) => String(item.entityId)),
  )

  let allItems = Array.isArray(transactionStore.items) && transactionStore.items.length > 0
    ? [...transactionStore.items]
    : []

  if (adapter && typeof adapter.loadTransactions === 'function') {
    try {
      const dbItems = await adapter.loadTransactions()
      if (Array.isArray(dbItems) && dbItems.length > 0) {
        const seen = new Set(allItems.map((t) => String(t.id)))
        for (const dbItem of dbItems) {
          if (dbItem?.id && !seen.has(String(dbItem.id))) {
            allItems.push(dbItem)
            seen.add(String(dbItem.id))
          }
        }
      }
    } catch {
      // non-blocking fallback
    }
  }

  let count = 0
  for (const trx of allItems) {
    if (!trx?.id) continue
    const idStr = String(trx.id)
    // Skip static sample mockup data if any
    if (idStr === 'TRX-1001' || idStr === 'TRX-1002') continue

    // Remote synced sales must never be backfilled into outbox
    if (trx.synced === true || trx.isSynced === true) continue
    if (serverVersions[`sales:${idStr.toLowerCase()}`] || serverVersions[`sales:${idStr}`]) continue

    const mappedSyncId = identityMap[`transaction:${idStr}`] || identityMap[`sale:${idStr}`]
    if (mappedSyncId) {
      const lowerMapped = String(mappedSyncId).toLowerCase()
      if (serverVersions[`sales:${lowerMapped}`] || serverVersions[`sales:${mappedSyncId}`]) {
        continue
      }
    }

    if (!queuedTrxIds.has(idStr)) {
      try {
        await queueService.enqueueUpsert(SYNC_ENTITY_TYPES.TRANSACTION, trx.id, trx)
        queuedTrxIds.add(idStr)
        count++
      } catch (err) {
        console.error(`Failed to backfill transaction ${trx.id}`, err)
      }
    }
  }

  return count
}
