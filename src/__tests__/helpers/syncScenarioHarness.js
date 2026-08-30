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
import { saveToken } from '@/services/cloud/tokenRepository'
import { createFakeServer } from './syncScenarioServer'

/**
 * Creates a fake runtime signal service for tests.
 *
 * @param {object} [opts]
 * @param {boolean} [opts.online=false]    Initial online state.
 * @param {boolean} [opts.foreground=true] Initial foreground state.
 */
export function createFakeRuntimeSignalService({ online = false, foreground = true } = {}) {
  const subscribers = new Set()
  let snapshot = {
    initialized: true,
    native: false,
    online,
    foreground,
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
    // Synchronous helpers (no await on subscriber results)
    setOnline(isOnline) {
      const prevOnline = snapshot.online
      snapshot.online = isOnline
      if (prevOnline !== isOnline) {
        const transition = isOnline ? 'online' : 'offline'
        for (const cb of subscribers) {
          cb({ type: 'network', transition, snapshot: { ...snapshot } })
        }
      }
    },
    setForeground(isForeground) {
      const prevForeground = snapshot.foreground
      snapshot.foreground = isForeground
      if (prevForeground !== isForeground) {
        const transition = isForeground ? 'resume' : 'pause'
        for (const cb of subscribers) {
          cb({ type: 'app-state', transition, snapshot: { ...snapshot } })
        }
      }
    },
    /**
     * Async version: updates snapshot, calls all subscribers, awaits
     * Promise.allSettled on any promises they return. This allows the
     * caller to deterministically observe all side-effects (e.g. Auto Sync).
     * No fixed timers needed.
     */
    async setOnlineAsync(isOnline) {
      const prevOnline = snapshot.online
      snapshot.online = isOnline
      if (prevOnline !== isOnline) {
        const transition = isOnline ? 'online' : 'offline'
        const promises = []
        for (const cb of subscribers) {
          const result = cb({ type: 'network', transition, snapshot: { ...snapshot } })
          if (result && typeof result.then === 'function') {
            promises.push(result)
          }
        }
        if (promises.length > 0) {
          await Promise.allSettled(promises)
        }
      }
    },
    async setForegroundAsync(isForeground) {
      const prevForeground = snapshot.foreground
      snapshot.foreground = isForeground
      if (prevForeground !== isForeground) {
        const transition = isForeground ? 'resume' : 'pause'
        const promises = []
        for (const cb of subscribers) {
          const result = cb({ type: 'app-state', transition, snapshot: { ...snapshot } })
          if (result && typeof result.then === 'function') {
            promises.push(result)
          }
        }
        if (promises.length > 0) {
          await Promise.allSettled(promises)
        }
      }
    },
  }
}

/**
 * Canonical cloud context used across tests.
 */
export function makeValidCloudContext(overrides = {}) {
  return {
    user: { id: 1, name: 'Owner User', email: 'owner@example.com' },
    selectedBusiness: { id: 10, name: 'Kedai Kopi Utama' },
    selectedOutlet: { id: 101, name: 'Outlet Pusat' },
    cloudAccess: true,
    deviceIdentifier: '123e4567-e89b-12d3-a456-426614174000',
    registeredDeviceId: 55,
    ...overrides,
  }
}

/**
 * Creates a scenario with isolated Pinia + memory adapter + fake server.
 *
 * @param {object} [opts]
 * @param {'free'|'cloud'} [opts.businessMode='free'] Starting business mode.
 * @param {boolean} [opts.initialOnline=false]
 * @param {boolean} [opts.initialForeground=true]
 */
export async function createOfflineOnlineScenario({
  businessMode = 'free',
  initialOnline = false,
  initialForeground = true,
} = {}) {
  const pinia = createPinia()
  setActivePinia(pinia)

  const adapter = createMemoryAdapter()
  const scheduler = createPersistenceService({ adapter, pinia })
  await scheduler.initialize()

  const devId = await resolveDeviceIdentifier(adapter)
  const cloudStore = useCloudSessionStore(pinia)
  cloudStore.deviceIdentifier = devId

  // Set business mode as specified (default: free)
  const businessStore = useBusinessStore(pinia)
  businessStore.setBusiness({ name: 'Kedai Kopi Utama', type: 'Cafe', mode: businessMode })

  // Clear all domain store data
  const productStore = useProductStore(pinia)
  const customerStore = useCustomerStore(pinia)
  const expenseStore = useExpenseStore(pinia)
  const transactionStore = useTransactionStore(pinia)
  productStore.products = []
  productStore.categories = []
  customerStore.customers = []
  expenseStore.expenses = []
  transactionStore.items = []

  const foundation = initializeSyncFoundation({ pinia, adapter, scheduler })

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
    syncBootstrapStore.init({ bootstrapService: foundation.bootstrapService, adapter })
    await syncBootstrapStore.loadBootstrapState()
  }
  if (foundation.conflictService) {
    const syncConflictStore = useSyncConflictStore(pinia)
    syncConflictStore.init({ conflictService: foundation.conflictService, adapter })
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
    useSyncActivityLogStore(pinia).init({ activityLogService: foundation.activityLogService, adapter })
  }

  // Create runtime with the INITIAL state pre-set in snapshot.
  // Listeners are NOT started here â€” each test that needs Auto Sync calls
  // autoSyncStore.startListeners() after the runtime is fully configured.
  const runtimeSignal = createFakeRuntimeSignalService({
    online: initialOnline,
    foreground: initialForeground,
  })

  if (foundation.autoSyncService) {
    useSyncAutoSyncStore(pinia).init({
      autoSyncService: foundation.autoSyncService,
      runtimeSignalService: runtimeSignal,
    })
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
    useSyncAutoSyncStore(pinia).stopListeners()
    useSyncStatusStore(pinia).stopListeners()
    await scheduler.close()
  }

  return {
    pinia,
    adapter,
    scheduler,
    foundation,
    cloudStore,
    businessStore,
    runtimeSignal,
    fakeServer,
    cleanup,
  }
}

/**
 * Creates the canonical shared offline dataset inside a scenario.
 * Does NOT require cloud mode â€” works in Free mode too.
 *
 * Creates: Category Makanan, Product Roti Bakar, Customer Andi,
 * Expense Operasional, and one transaction. Flushes the scheduler.
 *
 * @param {object} scenario  Return value of createOfflineOnlineScenario.
 * @returns {Promise<{prodResult, custResult, expResult, txResult}>}
 */
export async function createOfflineDataset(scenario) {
  const productStore = useProductStore(scenario.pinia)
  const customerStore = useCustomerStore(scenario.pinia)
  const expenseStore = useExpenseStore(scenario.pinia)
  const transactionStore = useTransactionStore(scenario.pinia)

  await productStore.createCategory('Makanan')

  const prodResult = await productStore.createProduct({
    name: 'Roti Bakar',
    category: 'Makanan',
    price: 12000,
    stock: 10,
  })

  const custResult = await customerStore.createCustomer({
    name: 'Andi',
    phone: '0811111',
  })

  const expResult = await expenseStore.createExpense({
    title: 'Listrik',
    category: 'Operasional',
    amount: 15000,
  })

  const txResult = await transactionStore.createTransaction({
    items: [{ id: prodResult.product.id, name: 'Roti Bakar', price: 12000, qty: 1 }],
    subtotal: 12000,
    tax: 0,
    total: 12000,
    customerId: custResult.customer.id,
    paymentMethod: 'cash',
  })

  await scenario.scheduler.flush()

  return { prodResult, custResult, expResult, txResult }
}

/**
 * Applies valid cloud context + saves all sync bindings for Push/Pull/Health.
 * Sets businessMode to 'cloud'.
 *
 * @param {object} scenario  Return value of createOfflineOnlineScenario.
 * @param {object} [overrides] makeValidCloudContext overrides.
 */
export async function setupBoundCloudState(scenario, overrides = {}) {
  const ctx = makeValidCloudContext(overrides)

  scenario.cloudStore.$patch(ctx)
  await saveToken('mock-bearer-token-123')

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
}

