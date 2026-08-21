import { Capacitor } from '@capacitor/core'

import { createMemoryAdapter } from './memoryAdapter'
import { createPersistenceService } from './persistenceService'

export async function resolvePersistenceAdapter({
  isNativePlatform = Capacitor.isNativePlatform(),
  isPluginAvailable = Capacitor.isPluginAvailable('CapacitorSQLite'),
  createMemory = createMemoryAdapter,
  createSQLite,
} = {}) {
  if (!isNativePlatform || !isPluginAvailable) {
    return createMemory()
  }

  const createNativeAdapter =
    createSQLite ??
    (async () => {
      const { createSQLiteAdapter } = await import('./sqliteAdapter')
      return createSQLiteAdapter()
    })

  return createNativeAdapter()
}

export async function initializePersistence(pinia, { adapter } = {}) {
  const resolvedAdapter = adapter ?? (await resolvePersistenceAdapter())
  let service = createPersistenceService({
    adapter: resolvedAdapter,
    pinia,
  })

  try {
    await service.initialize()
    return service
  } catch (error) {
    console.error('Failed to initialize persistence adapter. Falling back to memory adapter.', error)

    if (resolvedAdapter.name === 'memory') {
      throw error
    }

    service = createPersistenceService({
      adapter: createMemoryAdapter(),
      pinia,
    })

    await service.initialize()
    return service
  }
}
