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
export async function backfillUnsyncedTransactions({ pinia, queueService } = {}) {
  if (!queueService || typeof queueService.enqueueUpsert !== 'function') {
    return 0
  }

  const businessStore = useBusinessStore(pinia)
  const cloudStore = useCloudSessionStore(pinia)
  const transactionStore = useTransactionStore(pinia)

  // Only backfill if the device is connected to Cloud or in cloud mode
  const isCloud =
    businessStore.mode === 'cloud' || (cloudStore.isLinked && cloudStore.hasCloudAccess)
  if (!isCloud) {
    return 0
  }

  if (businessStore.mode !== 'cloud') {
    businessStore.mode = 'cloud'
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

  let count = 0
  for (const trx of transactionStore.items) {
    if (!trx?.id) continue
    const idStr = String(trx.id)
    // Skip static sample mockup data if any
    if (idStr === 'TRX-1001' || idStr === 'TRX-1002') continue

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
