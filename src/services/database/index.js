import { Capacitor } from '@capacitor/core'

import { createMemoryAdapter } from './memoryAdapter'
import { createPersistenceService } from './persistenceService'

export const NATIVE_PERSISTENCE_ERROR_CODES = {
  unavailable: 'NATIVE_PERSISTENCE_UNAVAILABLE',
  initFailed: 'NATIVE_PERSISTENCE_INIT_FAILED',
}

export class NativePersistenceError extends Error {
  constructor(code, message, options = {}) {
    super(message, options)
    this.name = 'NativePersistenceError'
    this.code = code
  }
}

export function isNativePersistenceError(error) {
  return Object.values(NATIVE_PERSISTENCE_ERROR_CODES).includes(error?.code)
}

export async function resolvePersistenceAdapter({
  isNativePlatform = Capacitor.isNativePlatform(),
  isPluginAvailable = Capacitor.isPluginAvailable('CapacitorSQLite'),
  createMemory = createMemoryAdapter,
  createSQLite,
} = {}) {
  if (!isNativePlatform) {
    return createMemory()
  }

  if (!isPluginAvailable) {
    throw new NativePersistenceError(
      NATIVE_PERSISTENCE_ERROR_CODES.unavailable,
      'CapacitorSQLite is unavailable on native platform.',
    )
  }

  const createNativeAdapter =
    createSQLite ??
    (async () => {
      const { createSQLiteAdapter } = await import('./sqliteAdapter')
      return createSQLiteAdapter()
    })

  try {
    return await createNativeAdapter()
  } catch (error) {
    throw new NativePersistenceError(
      NATIVE_PERSISTENCE_ERROR_CODES.unavailable,
      'Failed to create native SQLite persistence adapter.',
      { cause: error },
    )
  }
}

export async function initializePersistence(
  pinia,
  { adapter, isNativePlatform = Capacitor.isNativePlatform() } = {},
) {
  const resolvedAdapter = adapter ?? (await resolvePersistenceAdapter({ isNativePlatform }))

  if (isNativePlatform && resolvedAdapter.name !== 'sqlite') {
    throw new NativePersistenceError(
      NATIVE_PERSISTENCE_ERROR_CODES.unavailable,
      'Native platform requires SQLite persistence.',
    )
  }

  const service = createPersistenceService({
    adapter: resolvedAdapter,
    pinia,
  })

  try {
    await service.initialize()
    return service
  } catch (error) {
    if (!isNativePlatform || resolvedAdapter.name === 'memory') {
      throw error
    }

    throw new NativePersistenceError(
      NATIVE_PERSISTENCE_ERROR_CODES.initFailed,
      'Failed to initialize native SQLite persistence.',
      { cause: error },
    )
  }
}
