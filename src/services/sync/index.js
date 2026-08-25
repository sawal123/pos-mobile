import { createSyncChangeTracker } from './syncTracker'
import { createSyncQueueService } from './syncQueueService'

export { SYNC_ENTITY_TYPES, SYNC_OPERATIONS, SYNC_RESERVED_CATEGORY } from './syncConstants'
export { createSyncChangeTracker } from './syncTracker'
export { createSyncQueueService } from './syncQueueService'
export { createSyncIdentityRegistry, buildProductSyncSku, isUuid, generateUuid } from './syncIdentityRegistry'
export { createContractMapper, mapOutboxEntries } from './contractMapper'
export { pushSyncRequest } from './syncPushTransport'
export { createSyncPushService } from './syncPushService'
export { pullSyncChanges } from './syncPullTransport'
export { createSyncPullService } from './syncPullService'

/**
 * Initializes the P9-P13 sync foundation after SQLite persistence is ready.
 * The change tracker is attached only after hydration completes, so startup
 * hydration / first-run seeding never produce cloud outbox operations.
 *
 * @param {object} options
 * @param {object} options.pinia Active Pinia instance.
 * @param {object} options.adapter The resolved persistence adapter.
 * @param {object} options.scheduler The PersistenceService (serialized writer).
 */
export function initializeSyncFoundation({ pinia, adapter, scheduler }) {
  const queueService = createSyncQueueService({ adapter, scheduler })
  const tracker = createSyncChangeTracker({ pinia, queueService })
  const pushService = createSyncPushService({ adapter, scheduler, queueService })
  const pullService = createSyncPullService({ adapter, scheduler, queueService, pinia })

  return {
    queueService,
    tracker,
    pushService,
    pullService,
  }
}
