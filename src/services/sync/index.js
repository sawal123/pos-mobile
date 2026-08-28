import { createSyncChangeTracker } from './syncTracker'
import { createSyncQueueService } from './syncQueueService'
import { createSyncIdentityRegistry } from './syncIdentityRegistry'
import { createSyncPushService } from './syncPushService'
import { createSyncPullService } from './syncPullService'
import { createSyncBootstrapService } from './syncBootstrapService'
import { createSyncConflictService } from './syncConflictService'
import { createSyncOrchestratorService } from './syncOrchestratorService'
import { createSyncHealthService } from './syncHealthService'
import { createSyncRecoveryService, RECOVERY_ACTIONS } from './syncRecoveryService'
import {
  createSyncActivityLogService,
  SYNC_ACTIVITY_TYPES,
  SYNC_ACTIVITY_STATUSES,
  SYNC_ACTIVITY_ACTIONS,
} from './syncActivityLogService'

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
export { createSyncConflictService } from './syncConflictService'
export { createSyncOrchestratorService } from './syncOrchestratorService'
export { createSyncHealthService } from './syncHealthService'
export { createSyncRecoveryService, RECOVERY_ACTIONS } from './syncRecoveryService'
export {
  createSyncActivityLogService,
  SYNC_ACTIVITY_TYPES,
  SYNC_ACTIVITY_STATUSES,
  SYNC_ACTIVITY_ACTIONS,
} from './syncActivityLogService'

/**
 * Initializes the P9-P19 sync foundation after SQLite persistence is ready.
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
  const conflictService = createSyncConflictService({
    adapter,
    scheduler,
    queueService,
    registry,
  })
  const orchestratorService = createSyncOrchestratorService({
    pushService,
    pullService,
    conflictService,
  })
  const healthService = createSyncHealthService({
    adapter,
    queueService,
    conflictService,
  })
  const recoveryService = createSyncRecoveryService({
    healthService,
    pushService,
    bootstrapService,
    orchestratorService,
    conflictService,
  })
  const activityLogService = createSyncActivityLogService({
    adapter,
    scheduler,
  })

  return {
    queueService,
    registry,
    tracker,
    pushService,
    pullService,
    bootstrapService,
    conflictService,
    orchestratorService,
    healthService,
    recoveryService,
    activityLogService,
  }
}




