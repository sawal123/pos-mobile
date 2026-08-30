// src/__tests__/helpers/syncScenarioHarness.js

import { createPinia, setActivePinia } from 'pinia'
import { createMemoryAdapter } from '@/services/database/memoryAdapter'
import { createPersistenceService } from '@/services/database/persistenceService'
import { initializeSyncFoundation } from '@/services/sync'
import { useCloudSessionStore } from '@/stores/cloudSessionStore'
import { useSyncContextGuardStore } from '@/stores/syncContextGuardStore'
import { useBusinessStore } from '@/stores/businessStore'
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
import { useProductStore } from '@/stores/productStore'
import { useCustomerStore } from '@/stores/customerStore'
import { useExpenseStore } from '@/stores/expenseStore'
import { useTransactionStore } from '@/stores/transactionStore'
import { resolveDeviceIdentifier } from '@/services/cloud/deviceIdentifier'
import { createFakeServer } from './syncScenarioServer'

export function createFakeRuntimeSignalService() {
  const subscribers = new Set()
  let snapshot = {
    initialized: true,
    native: false,
    online: false,
    foreground: true,
    connectionType: 'unknown',
    source: 'web',
  }

  return {
    async start() {
      return { ok: true }
    },
    async stop() {
      return { ok: true }
    },
    getSnapshot() {
      return { ...snapshot }
    },
    subscribe(callback) {
      subscribers.add(callback)
      return () => {
        subscribers.delete(callback)
      }
    },
    getIsStarted() {
      return true
    },
    // Test helpers to trigger events
    setOnline(isOnline) {
      const prevOnline = snapshot.online
      snapshot.online = isOnline
      const transition = isOnline ? 'online' : 'offline'
      if (prevOnline !== isOnline) {
        for (const cb of subscribers) {
          cb({
            type: 'network',
            transition,
            snapshot: { ...snapshot }
          })
        }
      }
    },
    setForeground(isForeground) {
      const prevForeground = snapshot.foreground
      snapshot.foreground = isForeground
      const transition = isForeground ? 'resume' : 'pause'
      if (prevForeground !== isForeground) {
        for (const cb of subscribers) {
          cb({
            type: 'app-state',
            transition,
            snapshot: { ...snapshot }
          })
        }
      }
    }
  }
}

export async function createOfflineOnlineScenario() {
  const pinia = createPinia()
  setActivePinia(pinia)

  const adapter = createMemoryAdapter()
  const scheduler = createPersistenceService({ adapter, pinia })
  await scheduler.initialize()

  const devId = await resolveDeviceIdentifier(adapter)
  const cloudStore = useCloudSessionStore(pinia)
  cloudStore.deviceIdentifier = devId

  // Initialize and bind all Pinia stores
  const businessStore = useBusinessStore(pinia)
  const productStore = useProductStore(pinia)
  const customerStore = useCustomerStore(pinia)
  const expenseStore = useExpenseStore(pinia)
  const transactionStore = useTransactionStore(pinia)

  businessStore.setBusiness({ name: 'Kedai Kopi Utama', type: 'Cafe', mode: 'cloud' })

  productStore.products = []
  productStore.categories = ['Minuman']
  customerStore.customers = []
  expenseStore.expenses = []
  transactionStore.items = []

  const foundation = initializeSyncFoundation({ pinia, adapter, scheduler })

  if (foundation.contextGuardService) {
    const syncContextGuardStore = useSyncContextGuardStore(pinia)
    syncContextGuardStore.init({ contextGuardService: foundation.contextGuardService })
  }
  if (foundation.pushService) {
    const syncPushStore = useSyncPushStore(pinia)
    syncPushStore.init({ pushService: foundation.pushService })
  }
  if (foundation.pullService) {
    const syncPullStore = useSyncPullStore(pinia)
    syncPullStore.init({ pullService: foundation.pullService })
  }
  if (foundation.bootstrapService) {
    const syncBootstrapStore = useSyncBootstrapStore(pinia)
    syncBootstrapStore.init({ bootstrapService: foundation.bootstrapService, adapter })
    await syncBootstrapStore.loadBootstrapState()
  }
  if (foundation.conflictService) {
    const syncConflictStore = useSyncConflictStore(pinia)
    syncConflictStore.init({ conflictService: foundation.conflictService, adapter })
    await syncConflictStore.loadConflicts()
  }
  if (foundation.orchestratorService) {
    const syncOrchestratorStore = useSyncOrchestratorStore(pinia)
    syncOrchestratorStore.init({ orchestratorService: foundation.orchestratorService })
  }
  if (foundation.healthService) {
    const syncHealthStore = useSyncHealthStore(pinia)
    syncHealthStore.init({ healthService: foundation.healthService })
  }
  if (foundation.recoveryService) {
    const syncRecoveryStore = useSyncRecoveryStore(pinia)
    syncRecoveryStore.init({ recoveryService: foundation.recoveryService })
  }
  if (foundation.activityLogService) {
    const syncActivityLogStore = useSyncActivityLogStore(pinia)
    syncActivityLogStore.init({ activityLogService: foundation.activityLogService, adapter })
  }

  const runtimeSignal = createFakeRuntimeSignalService()

  if (foundation.autoSyncService) {
    const syncAutoSyncStore = useSyncAutoSyncStore(pinia)
    syncAutoSyncStore.init({
      autoSyncService: foundation.autoSyncService,
      runtimeSignalService: runtimeSignal,
    })
    syncAutoSyncStore.startListeners()
  }
  if (foundation.statusService) {
    const syncStatusStore = useSyncStatusStore(pinia)
    syncStatusStore.init({
      statusService: foundation.statusService,
      runtimeSignalService: runtimeSignal,
    })
    syncStatusStore.startListeners()
  }

  const fakeServer = createFakeServer()

  async function cleanup() {
    if (foundation.tracker && typeof foundation.tracker.dispose === 'function') {
      foundation.tracker.dispose()
    }
    const syncAutoSyncStore = useSyncAutoSyncStore(pinia)
    syncAutoSyncStore.stopListeners()

    const syncStatusStore = useSyncStatusStore(pinia)
    syncStatusStore.stopListeners()

    await scheduler.close()
  }

  return {
    pinia,
    adapter,
    scheduler,
    foundation,
    cloudStore,
    runtimeSignal,
    fakeServer,
    cleanup,
  }
}
