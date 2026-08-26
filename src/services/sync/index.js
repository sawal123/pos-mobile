import { createSyncChangeTracker } from './syncTracker'
import { createSyncQueueService } from './syncQueueService'
import { createSyncIdentityRegistry } from './syncIdentityRegistry'
import { createSyncPushService } from './syncPushService'
import { createSyncPullService } from './syncPullService'
import { createSyncBootstrapService } from './syncBootstrapService'

export { SYNC_ENTITY_TYPES, SYNC_OPERATIONS, SYNC_RESERVED_CATEGORY } from './syncConstants'
export { createSyncChangeTracker } from './syncTracker'
export { createSyncQueueService } from './syncQueueService'
export { createSyncIdentityRegistry, buildProductSyncSku, isUuid, generateUuid } from './syncIdentityRegistry'
export { createContractMapper, mapOutboxEntries } from './contractMapper'
export { pushSyncRequest } from './syncPushTransport'
export { createSyncPushService } from './syncPushService'
export { pullSyncChanges } from './syncPullTransport'
export { createSyncPullService } from './syncPullService'
export { createSyncBootstrapService } from './syncBootstrapService'

/**
 * Initializes the P9-P14 sync foundation after SQLite persistence is ready.
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
  const registry = createSyncIdentityRegistry({ adapter, scheduler })
  const tracker = createSyncChangeTracker({ pinia, queueService })
  const pushService = createSyncPushService({ adapter, scheduler, queueService, registry })
  const pullService = createSyncPullService({ adapter, scheduler, queueService, registry, pinia })
  const bootstrapService = createSyncBootstrapService({
    adapter,
    scheduler,
    queueService,
    registry,
    pinia,
  })

  return {
    queueService,
    registry,
    tracker,
    pushService,
    pullService,
    bootstrapService,
  }
}
