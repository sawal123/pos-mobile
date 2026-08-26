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

export async function bootstrapApp({
  appFactory = createApp,
  piniaFactory = createPinia,
  routerFactory = createAppRouter,
  initialize = initializePersistence,
  initializeSync = initializeSyncFoundation,
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
  }
}

if (!import.meta.env.VITEST) {
  void bootstrapApp()
}
