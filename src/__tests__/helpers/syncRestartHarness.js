import { createPinia, setActivePinia } from 'pinia'
import { createMemoryAdapter } from '@/services/database/memoryAdapter'
import { initializePersistence } from '@/services/database'
import { initializeSyncFoundation } from '@/services/sync'
import { resolveDeviceIdentifier } from '@/services/cloud/deviceIdentifier'
import { useCloudSessionStore } from '@/stores/cloudSessionStore'
import { useBusinessStore } from '@/stores/businessStore'
import { useProductStore } from '@/stores/productStore'
import { useCustomerStore } from '@/stores/customerStore'
import { useExpenseStore } from '@/stores/expenseStore'
import { useTransactionStore } from '@/stores/transactionStore'
import { useSyncPushStore } from '@/stores/syncPushStore'
import { useSyncPullStore } from '@/stores/syncPullStore'
import { useSyncBootstrapStore } from '@/stores/syncBootstrapStore'
import { useSyncConflictStore } from '@/stores/syncConflictStore'
import { useSyncOrchestratorStore } from '@/stores/syncOrchestratorStore'
import { useSyncHealthStore } from '@/stores/syncHealthStore'
import { useSyncRecoveryStore } from '@/stores/syncRecoveryStore'
import { useSyncActivityLogStore } from '@/stores/syncActivityLogStore'
import { useSyncAutoSyncStore } from '@/stores/syncAutoSyncStore'
import { useSyncStatusStore } from '@/stores/syncStatusStore'
import { useSyncContextGuardStore } from '@/stores/syncContextGuardStore'
import {
  createFakeRuntimeSignalService,
  makeValidCloudContext,
} from './syncScenarioHarness'
import { saveToken, getToken, removeToken } from '@/services/cloud/tokenRepository'
import { createFakeServer } from './syncScenarioServer'

export { makeValidCloudContext, saveToken, getToken, removeToken }

export async function setupBoundCloudState(scenario, overrides = {}) {
  const devId = overrides.deviceIdentifier || (await scenario.adapter.loadDeviceIdentifier()) || '123e4567-e89b-12d3-a456-426614174000'
  const ctx = makeValidCloudContext({ deviceIdentifier: devId, ...overrides })

  await saveToken('mock-bearer-token-123')
  await scenario.adapter.saveDeviceIdentifier(ctx.deviceIdentifier)
  await scenario.adapter.saveCloudContext(ctx)
  scenario.cloudStore.$patch(ctx)

  scenario.businessStore.setBusiness({
    name: 'Kedai Kopi Utama',
    type: 'Cafe',
    mode: 'cloud',
  })

  await scenario.adapter.saveSyncPushBinding({
    businessId: ctx.selectedBusiness.id,
    boundAt: new Date().toISOString(),
  })
  await scenario.adapter.saveSyncPullBinding({
    businessId: ctx.selectedBusiness.id,
    outletId: ctx.selectedOutlet.id,
    deviceIdentifier: ctx.deviceIdentifier,
    registeredDeviceId: ctx.registeredDeviceId,
    boundAt: new Date().toISOString(),
  })
  await scenario.adapter.saveSyncPullState({
    version: 1,
    cursor: 0,
    serverSequence: 0,
  })
  await scenario.adapter.saveSyncBootstrapState({
    version: 1,
    businessId: ctx.selectedBusiness.id,
    outletId: ctx.selectedOutlet.id,
    deviceIdentifier: ctx.deviceIdentifier,
    registeredDeviceId: ctx.registeredDeviceId,
    status: 'completed',
    stagedAt: new Date().toISOString(),
    counts: { categories: 0, products: 0, customers: 0, expenses: 0, transactions: 0 },
  })

  // Remove any unsupported business queue item tracked during setup
  const qItems = await scenario.adapter.listSyncQueueItems()
  for (const q of qItems) {
    if (q.entityType === 'business') {
      await scenario.adapter.deleteSyncQueueItem(q.id)
    }
  }
}

/**
 * Creates a fresh scenario environment (App Graph #1).
 * Uses real Pinia, real persistence, real sync foundation, and in-memory adapter as durable surrogate.
 */
export async function createRestartableScenario({
  businessMode = 'free',
  initialOnline = true,
  initialForeground = true,
  adapter = null,
  fakeServer = null,
} = {}) {
  const pinia = createPinia()
  setActivePinia(pinia)

  const activeAdapter = adapter || createMemoryAdapter()

  // Instantiate domain stores and clear built-in seed data BEFORE persistence
  // initialize so first-run seeding writes an empty baseline (same as the P24
  // harness). Without this, seed products/categories/transactions pollute the
  // durable baseline and break bootstrap preflight + exact outbox counts.
  const productStore = useProductStore(pinia)
  const customerStore = useCustomerStore(pinia)
  const expenseStore = useExpenseStore(pinia)
  const transactionStore = useTransactionStore(pinia)
  productStore.products = []
  productStore.categories = []
  customerStore.customers = []
  expenseStore.expenses = []
  transactionStore.items = []

  const scheduler = await initializePersistence(pinia, { adapter: activeAdapter })

  const businessStore = useBusinessStore(pinia)
  businessStore.setBusiness({
    name: 'Kedai Kopi Utama',
    type: 'Cafe',
    mode: businessMode,
  })
  await scheduler.flush()

  const foundation = initializeSyncFoundation({
    pinia,
    adapter: activeAdapter,
    scheduler,
  })

  const devId = await resolveDeviceIdentifier(activeAdapter)
  const cloudStore = useCloudSessionStore(pinia)
  cloudStore.deviceIdentifier = devId

  if (foundation.contextGuardService) {
    useSyncContextGuardStore(pinia).init({ contextGuardService: foundation.contextGuardService })
  }
  if (foundation.pushService) {
    useSyncPushStore(pinia).init({ pushService: foundation.pushService })
  }
  if (foundation.pullService) {
    useSyncPullStore(pinia).init({ pullService: foundation.pullService })
  }
  if (foundation.bootstrapService) {
    const syncBootstrapStore = useSyncBootstrapStore(pinia)
    syncBootstrapStore.init({ bootstrapService: foundation.bootstrapService, adapter: activeAdapter })
    await syncBootstrapStore.loadBootstrapState()
  }
  if (foundation.conflictService) {
    const syncConflictStore = useSyncConflictStore(pinia)
    syncConflictStore.init({ conflictService: foundation.conflictService, adapter: activeAdapter })
    await syncConflictStore.loadConflicts()
  }
  if (foundation.orchestratorService) {
    useSyncOrchestratorStore(pinia).init({ orchestratorService: foundation.orchestratorService })
  }
  if (foundation.healthService) {
    useSyncHealthStore(pinia).init({ healthService: foundation.healthService })
  }
  if (foundation.recoveryService) {
    useSyncRecoveryStore(pinia).init({ recoveryService: foundation.recoveryService })
  }
  if (foundation.activityLogService) {
    useSyncActivityLogStore(pinia).init({ activityLogService: foundation.activityLogService, adapter: activeAdapter })
  }

  const runtimeSignal = createFakeRuntimeSignalService({
    online: initialOnline,
    foreground: initialForeground,
  })

  if (foundation.autoSyncService) {
    const autoSyncStore = useSyncAutoSyncStore(pinia)
    autoSyncStore.init({
      autoSyncService: foundation.autoSyncService,
      runtimeSignalService: runtimeSignal,
    })

    const originalRunOnce = foundation.autoSyncService.runOnce
    let activeRunOncePromise = null

    foundation.autoSyncService.runOnce = function (...args) {
      const p = originalRunOnce.apply(this, args)
      activeRunOncePromise = p
      return p.finally(() => {
        if (activeRunOncePromise === p) {
          activeRunOncePromise = null
        }
      })
    }

    runtimeSignal.registerAsyncWaitHook(() => activeRunOncePromise)
  }

  if (foundation.statusService) {
    const syncStatusStore = useSyncStatusStore(pinia)
    syncStatusStore.init({
      statusService: foundation.statusService,
      runtimeSignalService: runtimeSignal,
    })
    syncStatusStore.startListeners()
  }

  const activeFakeServer = fakeServer || createFakeServer()

  async function cleanup() {
    if (foundation.tracker && typeof foundation.tracker.dispose === 'function') {
      foundation.tracker.dispose()
    }
    useSyncAutoSyncStore(pinia).stopListeners()
    useSyncStatusStore(pinia).stopListeners()
    await scheduler.close()
  }

  return {
    pinia,
    adapter: activeAdapter,
    scheduler,
    foundation,
    cloudStore,
    businessStore,
    runtimeSignal,
    fakeServer: activeFakeServer,
    cleanup,
  }
}

/**
 * Simulates a clean, logical process crash and restart.
 * Disposes old app graph, creates fresh Pinia and fresh sync services,
 * hydrates domain stores from durable storage surrogate (adapter), and attaches tracker after hydration.
 *
 * @param {object} prevScenario Previous scenario instance
 * @param {object} [options]
 * @param {boolean} [options.online] Override runtime online state after restart
 * @param {boolean} [options.foreground] Override runtime foreground state after restart
 * @returns {Promise<object>} Fresh scenario instance
 */
export async function restartAppScenario(prevScenario, options = {}) {
  // 1. Dispose old tracker & listeners
  if (prevScenario.foundation?.tracker && typeof prevScenario.foundation.tracker.dispose === 'function') {
    prevScenario.foundation.tracker.dispose()
  }
  try {
    useSyncAutoSyncStore(prevScenario.pinia).stopListeners()
  } catch {
    // ignore
  }
  try {
    useSyncStatusStore(prevScenario.pinia).stopListeners()
  } catch {
    // ignore
  }

  // 2. Close previous scheduler without wiping underlying adapter storage
  await prevScenario.scheduler.close()

  const durableAdapter = prevScenario.adapter
  const persistentFakeServer = prevScenario.fakeServer

  // 3. Create fresh Pinia instance
  const pinia = createPinia()
  setActivePinia(pinia)

  // 4. Create fresh PersistenceService & hydrate domain stores from durable storage
  const scheduler = await initializePersistence(pinia, { adapter: durableAdapter })

  // 5. Initialize fresh Sync Foundation (tracker attached after hydration!)
  const foundation = initializeSyncFoundation({
    pinia,
    adapter: durableAdapter,
    scheduler,
  })

  // 6. Hydrate Cloud Context & Device Identifier from durable storage
  const devId = await resolveDeviceIdentifier(durableAdapter)
  const cloudStore = useCloudSessionStore(pinia)
  cloudStore.deviceIdentifier = devId
  await cloudStore.hydrateFromStorage(durableAdapter)

  const businessStore = useBusinessStore(pinia)

  // 7. Initialize all fresh sync stores
  if (foundation.contextGuardService) {
    useSyncContextGuardStore(pinia).init({ contextGuardService: foundation.contextGuardService })
  }
  if (foundation.pushService) {
    useSyncPushStore(pinia).init({ pushService: foundation.pushService })
  }
  if (foundation.pullService) {
    useSyncPullStore(pinia).init({ pullService: foundation.pullService })
  }
  if (foundation.bootstrapService) {
    const syncBootstrapStore = useSyncBootstrapStore(pinia)
    syncBootstrapStore.init({ bootstrapService: foundation.bootstrapService, adapter: durableAdapter })
    await syncBootstrapStore.loadBootstrapState()
  }
  if (foundation.conflictService) {
    const syncConflictStore = useSyncConflictStore(pinia)
    syncConflictStore.init({ conflictService: foundation.conflictService, adapter: durableAdapter })
    await syncConflictStore.loadConflicts()
  }
  if (foundation.orchestratorService) {
    useSyncOrchestratorStore(pinia).init({ orchestratorService: foundation.orchestratorService })
  }
  if (foundation.healthService) {
    useSyncHealthStore(pinia).init({ healthService: foundation.healthService })
  }
  if (foundation.recoveryService) {
    useSyncRecoveryStore(pinia).init({ recoveryService: foundation.recoveryService })
  }
  if (foundation.activityLogService) {
    useSyncActivityLogStore(pinia).init({ activityLogService: foundation.activityLogService, adapter: durableAdapter })
  }

  // 8. Runtime signal service for fresh app
  const prevRuntimeSnap = prevScenario.runtimeSignal.getSnapshot()
  const runtimeSignal = createFakeRuntimeSignalService({
    online: options.online !== undefined ? options.online : prevRuntimeSnap.online,
    foreground: options.foreground !== undefined ? options.foreground : prevRuntimeSnap.foreground,
  })

  if (foundation.autoSyncService) {
    const autoSyncStore = useSyncAutoSyncStore(pinia)
    autoSyncStore.init({
      autoSyncService: foundation.autoSyncService,
      runtimeSignalService: runtimeSignal,
    })

    const originalRunOnce = foundation.autoSyncService.runOnce
    let activeRunOncePromise = null

    foundation.autoSyncService.runOnce = function (...args) {
      const p = originalRunOnce.apply(this, args)
      activeRunOncePromise = p
      return p.finally(() => {
        if (activeRunOncePromise === p) {
          activeRunOncePromise = null
        }
      })
    }

    runtimeSignal.registerAsyncWaitHook(() => activeRunOncePromise)
  }

  if (foundation.statusService) {
    const syncStatusStore = useSyncStatusStore(pinia)
    syncStatusStore.init({
      statusService: foundation.statusService,
      runtimeSignalService: runtimeSignal,
    })
    syncStatusStore.startListeners()
  }

  async function cleanup() {
    if (foundation.tracker && typeof foundation.tracker.dispose === 'function') {
      foundation.tracker.dispose()
    }
    useSyncAutoSyncStore(pinia).stopListeners()
    useSyncStatusStore(pinia).stopListeners()
    await scheduler.close()
  }

  return {
    pinia,
    adapter: durableAdapter,
    scheduler,
    foundation,
    cloudStore,
    businessStore,
    runtimeSignal,
    fakeServer: persistentFakeServer,
    cleanup,
  }
}
