import './assets/css/main.css'

import { createApp } from 'vue'
import { createPinia } from 'pinia'

import App from './App.vue'
import { createAppRouter } from './router'
import { initializePersistence } from './services/database'
import { initializeSyncFoundation } from './services/sync'

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
