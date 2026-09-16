import './assets/css/main.css'

import { createApp } from 'vue'
import { createPinia } from 'pinia'

import App from './App.vue'
import { createAppRouter } from './router'
import { initializePersistence } from './services/database'
import { initializeSyncFoundation } from './services/sync'
import { resolveDeviceIdentifier } from './services/cloud/deviceIdentifier'
import { useCloudSessionStore } from './stores/cloudSessionStore'
import { useSyncPushStore } from './stores/syncPushStore'
import { useSyncPullStore } from './stores/syncPullStore'
import { useSyncBootstrapStore } from './stores/syncBootstrapStore'
import { useSyncConflictStore } from './stores/syncConflictStore'
import { useSyncOrchestratorStore } from './stores/syncOrchestratorStore'
import { useSyncHealthStore } from './stores/syncHealthStore'
import { useSyncRecoveryStore } from './stores/syncRecoveryStore'
import { useSyncActivityLogStore } from './stores/syncActivityLogStore'
import { useSyncAutoSyncStore } from './stores/syncAutoSyncStore'
import { useSyncStatusStore } from './stores/syncStatusStore'
import { useSyncContextGuardStore } from './stores/syncContextGuardStore'
import { createRuntimeSignalService } from './services/runtime/runtimeSignalService'

export async function bootstrapApp({
  appFactory = createApp,
  piniaFactory = createPinia,
  routerFactory = createAppRouter,
  initialize = initializePersistence,
  initializeSync = initializeSyncFoundation,
  runtimeSignalFactory = createRuntimeSignalService,
  rootComponent = App,
  mountTarget = '#app',
} = {}) {
  const app = appFactory(rootComponent)
  const pinia = piniaFactory()

  app.use(pinia)

  const persistence = await initialize(pinia)
  const syncFoundation = persistence
    ? await initializeSync({
        pinia,
        adapter: persistence.adapter,
        scheduler: persistence,
      })
    : null

  const router = routerFactory()

  app.use(router)

  let runtimeSignalService = null

  // P10: hydrate cloud session and device identifier after persistence is ready.
  // Non-blocking – POS continues offline if cloud storage fails.
  if (persistence) {
    try {
      const adapter = persistence.adapter
      // Ensure device identifier is generated once and persisted
      const devId = await resolveDeviceIdentifier(adapter)
      const cloudStore = useCloudSessionStore(pinia)
      cloudStore.deviceIdentifier = devId
      // Restore token + non-sensitive cloud context (no push/pull)
      await cloudStore.hydrateFromStorage(adapter)

      if (syncFoundation?.contextGuardService) {
        const syncContextGuardStore = useSyncContextGuardStore(pinia)
        syncContextGuardStore.init({
          contextGuardService: syncFoundation.contextGuardService,
        })
      }
      if (syncFoundation?.pushService) {
        const syncPushStore = useSyncPushStore(pinia)
        syncPushStore.init({ pushService: syncFoundation.pushService })
      }
      if (syncFoundation?.pullService) {
        const syncPullStore = useSyncPullStore(pinia)
        syncPullStore.init({ pullService: syncFoundation.pullService })
      }
      if (syncFoundation?.bootstrapService) {
        const syncBootstrapStore = useSyncBootstrapStore(pinia)
        syncBootstrapStore.init({ bootstrapService: syncFoundation.bootstrapService, adapter })
        await syncBootstrapStore.loadBootstrapState()
      }
      if (syncFoundation?.conflictService) {
        const syncConflictStore = useSyncConflictStore(pinia)
        syncConflictStore.init({ conflictService: syncFoundation.conflictService, adapter })
        await syncConflictStore.loadConflicts()
      }
      if (syncFoundation?.orchestratorService) {
        const syncOrchestratorStore = useSyncOrchestratorStore(pinia)
        syncOrchestratorStore.init({ orchestratorService: syncFoundation.orchestratorService })
      }
      if (syncFoundation?.healthService) {
        const syncHealthStore = useSyncHealthStore(pinia)
        syncHealthStore.init({ healthService: syncFoundation.healthService })
      }
      if (syncFoundation?.recoveryService) {
        const syncRecoveryStore = useSyncRecoveryStore(pinia)
        syncRecoveryStore.init({ recoveryService: syncFoundation.recoveryService })
      }
      if (syncFoundation?.activityLogService) {
        const syncActivityLogStore = useSyncActivityLogStore(pinia)
        syncActivityLogStore.init({ activityLogService: syncFoundation.activityLogService, adapter })
      }

      // P22: Single shared runtime signal bridge for native & browser events
      runtimeSignalService = runtimeSignalFactory()
      runtimeSignalService.subscribe((event) => {
        if (event.type !== 'app-state' || event.transition !== 'pause') {
          return
        }

        void Promise.resolve()
          .then(() => persistence.flush())
          .catch((error) => {
            console.error('Failed to flush persistence when app entered background.', error)
          })
      })
      try {
        await runtimeSignalService.start()
      } catch {
        // Startup failure does not block POS startup (fail-closed)
      }

      if (syncFoundation?.autoSyncService) {
        const syncAutoSyncStore = useSyncAutoSyncStore(pinia)
        syncAutoSyncStore.init({
          autoSyncService: syncFoundation.autoSyncService,
          runtimeSignalService,
        })
        syncAutoSyncStore.startListeners()
      }
      if (syncFoundation?.statusService) {
        const syncStatusStore = useSyncStatusStore(pinia)
        syncStatusStore.init({
          statusService: syncFoundation.statusService,
          runtimeSignalService,
        })
        syncStatusStore.startListeners()
        void syncStatusStore.refresh()
      }
    } catch {
      // Never block POS startup on cloud errors
    }
  }

  app.mount(mountTarget)

  return {
    app,
    pinia,
    router,
    persistence,
    syncFoundation,
    runtimeSignalService,
  }
}

if (!import.meta.env.VITEST) {
  void bootstrapApp()
}
