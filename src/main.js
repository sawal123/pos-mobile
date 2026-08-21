import './assets/css/main.css'

import { createApp } from 'vue'
import { createPinia } from 'pinia'

import App from './App.vue'
import { createAppRouter } from './router'
import { initializePersistence } from './services/database'

export async function bootstrapApp({
  appFactory = createApp,
  piniaFactory = createPinia,
  routerFactory = createAppRouter,
  initialize = initializePersistence,
  rootComponent = App,
  mountTarget = '#app',
} = {}) {
  const app = appFactory(rootComponent)
  const pinia = piniaFactory()

  app.use(pinia)
  await initialize(pinia)

  const router = routerFactory()

  app.use(router)
  app.mount(mountTarget)

  return {
    app,
    pinia,
    router,
  }
}

if (!import.meta.env.VITEST) {
  void bootstrapApp()
}
