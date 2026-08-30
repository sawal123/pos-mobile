// src/__tests__/sync-offline-online-e2e.spec.js

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createOfflineOnlineScenario } from './helpers/syncScenarioHarness'
import { useProductStore } from '@/stores/productStore'
import { useCustomerStore } from '@/stores/customerStore'
import { useExpenseStore } from '@/stores/expenseStore'
import { useTransactionStore } from '@/stores/transactionStore'
import { useCloudSessionStore } from '@/stores/cloudSessionStore'
import { useSyncPushStore } from '@/stores/syncPushStore'
import { useSyncPullStore } from '@/stores/syncPullStore'
import { useSyncBootstrapStore } from '@/stores/syncBootstrapStore'
import { useSyncConflictStore } from '@/stores/syncConflictStore'
import { useSyncOrchestratorStore } from '@/stores/syncOrchestratorStore'
import { useSyncHealthStore } from '@/stores/syncHealthStore'
import { useSyncAutoSyncStore } from '@/stores/syncAutoSyncStore'
import { useSyncStatusStore } from '@/stores/syncStatusStore'
import { useSyncActivityLogStore } from '@/stores/syncActivityLogStore'
import { useSyncContextGuardStore } from '@/stores/syncContextGuardStore'
import { saveToken, _resetTokenStore } from '@/services/cloud/tokenRepository'
import { SYNC_ENTITY_TYPES } from '@/services/sync/syncConstants'

const { mockServerHandler } = vi.hoisted(() => {
  return {
    mockServerHandler: {
      handle: null,
    },
  }
})

vi.mock('@/services/cloud/apiClient', () => {
  return {
    apiRequest: async (path, options) => {
      if (mockServerHandler.handle) {
        return mockServerHandler.handle(path, options)
      }
      return { ok: false, status: 500, error: 'Server not initialized' }
    },
  }
})

function makeValidCloudContext(overrides = {}) {
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

describe('P24: End-to-End Offline to Online Sync Scenarios', () => {
  beforeEach(() => {
    mockServerHandler.handle = null
    _resetTokenStore()
  })

  it('1. Free offline mutations create durable outbox without network', async () => {
    const scenario = await createOfflineOnlineScenario()
    mockServerHandler.handle = scenario.fakeServer.handleRequest

    const productStore = useProductStore(scenario.pinia)
    const customerStore = useCustomerStore(scenario.pinia)
    const expenseStore = useExpenseStore(scenario.pinia)
    const transactionStore = useTransactionStore(scenario.pinia)

    // 1. Mutate category
    await productStore.createCategory('Makanan')

    // 2. Mutate product
    const prodResult = await productStore.createProduct({
      name: 'Roti Bakar',
      category: 'Makanan',
      price: 12000,
      stock: 10,
    })
    expect(prodResult.success).toBe(true)

    // 3. Mutate customer
    const custResult = await customerStore.createCustomer({
      name: 'Andi',
      phone: '0811111',
    })
    expect(custResult.success).toBe(true)

    // 4. Mutate expense
    const expResult = await expenseStore.createExpense({
      title: 'Beli Sabun',
      category: 'Operasional',
      amount: 15000,
    })
    expect(expResult.success).toBe(true)

    // 5. Mutate transaction
    const txResult = await transactionStore.createTransaction({
      items: [{ id: prodResult.product.id, name: 'Roti Bakar', price: 12000, qty: 1 }],
      subtotal: 12000,
      tax: 0,
      total: 12000,
      customerId: custResult.customer.id,
      paymentMethod: 'cash',
    })
    expect(txResult).toBeDefined()

    await scenario.scheduler.flush()

    // Assert local data is correct
    expect(productStore.categories).toContain('Makanan')
    expect(productStore.products).toHaveLength(1)
    expect(customerStore.customers).toHaveLength(1)
    expect(expenseStore.expenses).toHaveLength(1)
    expect(transactionStore.items).toHaveLength(1)

    // Verify outbox queue
    const pending = await scenario.adapter.listSyncQueueItems()
    expect(pending.length).toBeGreaterThan(0)

    const types = pending.map((x) => x.entityType)
    expect(types).toContain(SYNC_ENTITY_TYPES.CATEGORY)
    expect(types).toContain(SYNC_ENTITY_TYPES.PRODUCT)
    expect(types).toContain(SYNC_ENTITY_TYPES.CUSTOMER)
    expect(types).toContain(SYNC_ENTITY_TYPES.EXPENSE)
    expect(types).toContain(SYNC_ENTITY_TYPES.TRANSACTION)

    // Zero network requests
    expect(scenario.fakeServer.getPushRequestCount()).toBe(0)
    expect(scenario.fakeServer.getPullRequestCount()).toBe(0)

    await scenario.cleanup()
  })

  it('2. Free → Subscriber guard is UNBOUND and bootstrap succeeds', async () => {
    const scenario = await createOfflineOnlineScenario()
    mockServerHandler.handle = scenario.fakeServer.handleRequest

    const productStore = useProductStore(scenario.pinia)
    await productStore.createCategory('Makanan')
    await productStore.createProduct({ name: 'Roti Bakar', category: 'Makanan', price: 12000, stock: 10 })

    await scenario.scheduler.flush()

    // Go online & Subscribe
    const ctx = makeValidCloudContext()
    scenario.cloudStore.$patch(ctx)
    await saveToken('mock-bearer-token-123')
    scenario.runtimeSignal.setOnline(true)

    // Verify guard UNBOUND
    const guardStore = useSyncContextGuardStore(scenario.pinia)
    const guardResult = await guardStore.check()
    expect(guardResult.ok).toBe(true)
    expect(guardResult.code).toBe('SYNC_CONTEXT_UNBOUND')

    // Run Bootstrap
    const bootstrapStore = useSyncBootstrapStore(scenario.pinia)
    const bootResult = await bootstrapStore.bootstrapNow()
    expect(bootResult.ok).toBe(true)

    // Verify bootstrap state persisted
    const bootstrapState = await scenario.adapter.loadSyncBootstrapState()
    expect(bootstrapState).not.toBeNull()
    expect(bootstrapState.status).toBe('staged')

    await scenario.cleanup()
  })

  it('3. Bootstrap → Push uploads local dataset and clears acknowledged queue', async () => {
    const scenario = await createOfflineOnlineScenario()
    mockServerHandler.handle = scenario.fakeServer.handleRequest

    const productStore = useProductStore(scenario.pinia)
    await productStore.createCategory('Makanan')
    await productStore.createProduct({ name: 'Roti Bakar', category: 'Makanan', price: 12000, stock: 10 })

    await scenario.scheduler.flush()

    // Set cloud credentials
    scenario.cloudStore.$patch(makeValidCloudContext())
    await saveToken('mock-bearer-token-123')
    scenario.runtimeSignal.setOnline(true)

    const bootstrapStore = useSyncBootstrapStore(scenario.pinia)
    const bRes = await bootstrapStore.bootstrapNow()
    expect(bRes.ok).toBe(true)

    // Push local data
    const pushStore = useSyncPushStore(scenario.pinia)
    const pushResult = await pushStore.pushNow()
    expect(pushResult.ok).toBe(true)

    // Outbox should be empty
    const pendingCount = await scenario.adapter.countSyncQueueItems()
    expect(pendingCount).toBe(0)

    // Verify server has the records
    expect(scenario.fakeServer.db.products).toHaveLength(1)
    expect(scenario.fakeServer.db.products[0].name).toBe('Roti Bakar')

    await scenario.cleanup()
  })

  it('4. First Pull does not duplicate or echo to outbox', async () => {
    const scenario = await createOfflineOnlineScenario()
    mockServerHandler.handle = scenario.fakeServer.handleRequest

    // Setup cloud session
    scenario.cloudStore.$patch(makeValidCloudContext())
    await saveToken('mock-bearer-token-123')
    scenario.runtimeSignal.setOnline(true)

    // Seed push binding to allow pulling
    await scenario.adapter.saveSyncPushBinding({
      businessId: 10,
      boundAt: new Date().toISOString(),
    })

    // Seed server state with category and product P1 using valid UUIDs
    const catSyncId = 'd754f9a0-97db-4e1a-826c-389f417f73db'
    const prodSyncId = 'f921f6bc-e2b2-4d2b-9279-3fb7661b17a1'

    scenario.fakeServer.db.categories.push({
      sync_id: catSyncId,
      name: 'Minuman',
      business_id: 10,
      sync_version: 1,
      sync_sequence: 1,
    })
    scenario.fakeServer.db.products.push({
      sync_id: prodSyncId,
      category_sync_id: catSyncId,
      name: 'Kopi Espresso',
      sku: 'ESP-1',
      price: 15000,
      business_id: 10,
      sync_version: 1,
      sync_sequence: 2,
    })
    scenario.fakeServer.setServerSequence(2)

    // Pull from server
    const pullStore = useSyncPullStore(scenario.pinia)
    const pullResult = await pullStore.pullNow()
    expect(pullResult.ok).toBe(true)
    expect(pullResult.fetched).toBe(2)

    // Pull again to ensure idempotency & no outbox echo
    const pullResult2 = await pullStore.pullNow()
    expect(pullResult2.ok).toBe(true)
    expect(pullResult2.fetched).toBe(0)

    const pendingCount = await scenario.adapter.countSyncQueueItems()
    expect(pendingCount).toBe(0)

    await scenario.cleanup()
  })

  it('5. Offline local + remote independent edits converge through syncAll', async () => {
    const scenario = await createOfflineOnlineScenario()
    mockServerHandler.handle = scenario.fakeServer.handleRequest

    scenario.cloudStore.$patch(makeValidCloudContext())
    await saveToken('mock-bearer-token-123')

    // Initial state: synced database
    const productStore = useProductStore(scenario.pinia)
    const prod = await productStore.createProduct({ name: 'Es Teh', category: 'Minuman', price: 5000, stock: 5 })

    const registry = scenario.foundation.registry
    await registry.ensureLoaded()
    const prodSyncId = await registry.resolveSyncId(SYNC_ENTITY_TYPES.PRODUCT, prod.product.id)
    const catSyncId = await registry.resolveSyncId(SYNC_ENTITY_TYPES.CATEGORY, 'Minuman')

    // Simulate push & pull bindings safely
    await scenario.adapter.saveSyncPushBinding({ businessId: 10, boundAt: new Date().toISOString() })
    await scenario.adapter.saveSyncPullBinding({
      businessId: 10,
      outletId: 101,
      deviceIdentifier: '123e4567-e89b-12d3-a456-426614174000',
      registeredDeviceId: 55,
      boundAt: new Date().toISOString(),
    })
    await scenario.adapter.saveSyncPullState({ cursor: 0, serverSequence: 0 })

    // Seed server with identical version 1
    scenario.fakeServer.db.products.push({
      sync_id: prodSyncId,
      name: 'Es Teh',
      category_sync_id: catSyncId,
      price: 5000,
      business_id: 10,
      sync_version: 1,
      sync_sequence: 1,
    })
    scenario.fakeServer.setServerSequence(1)

    // Store server version locally
    await scenario.adapter.saveSyncServerVersions({
      [`products:${prodSyncId}`]: 1,
    })

    // GO OFFLINE and make local edit
    scenario.runtimeSignal.setOnline(false)
    await productStore.updateProduct(prod.product.id, { name: 'Es Teh Manis', category: 'Minuman', price: 6000, stock: 5 })
    await scenario.scheduler.flush()

    // Server makes independent change (e.g. modify customer)
    scenario.fakeServer.db.customers.push({
      sync_id: '33333333-3333-4333-8333-333333333333',
      name: 'Rudi',
      phone: '081222',
      business_id: 10,
      sync_version: 1,
      sync_sequence: 2,
    })
    scenario.fakeServer.setServerSequence(2)

    // GO ONLINE and run full syncAll
    scenario.runtimeSignal.setOnline(true)
    const orchestratorStore = useSyncOrchestratorStore(scenario.pinia)
    const syncRes = await orchestratorStore.syncAll()
    expect(syncRes.ok).toBe(true)

    // Verify local product edit is on the fake server
    const serverProd = scenario.fakeServer.db.products.find((p) => p.sync_id === prodSyncId)
    expect(serverProd.name).toBe('Es Teh Manis')
    expect(serverProd.price).toBe(6000)

    // Verify remote customer change is locally applied
    const customerStore = useCustomerStore(scenario.pinia)
    expect(customerStore.customers).toHaveLength(1)
    expect(customerStore.customers[0].name).toBe('Rudi')

    await scenario.cleanup()
  })

  it('6. Second syncAll is idempotent', async () => {
    const scenario = await createOfflineOnlineScenario()
    mockServerHandler.handle = scenario.fakeServer.handleRequest

    scenario.cloudStore.$patch(makeValidCloudContext())
    await saveToken('mock-bearer-token-123')
    scenario.runtimeSignal.setOnline(true)

    await scenario.adapter.saveSyncPushBinding({ businessId: 10, boundAt: new Date().toISOString() })
    await scenario.adapter.saveSyncPullBinding({
      businessId: 10,
      outletId: 101,
      deviceIdentifier: '123e4567-e89b-12d3-a456-426614174000',
      registeredDeviceId: 55,
      boundAt: new Date().toISOString(),
    })
    await scenario.adapter.saveSyncPullState({ cursor: 0, serverSequence: 0 })

    const orchestratorStore = useSyncOrchestratorStore(scenario.pinia)
    const syncRes1 = await orchestratorStore.syncAll()
    expect(syncRes1.ok).toBe(true)

    const syncRes2 = await orchestratorStore.syncAll()
    expect(syncRes2.ok).toBe(true)

    // Verify outbox remains empty
    const pendingCount = await scenario.adapter.countSyncQueueItems()
    expect(pendingCount).toBe(0)

    await scenario.cleanup()
  })

  it('7. Offline same-entity change produces durable conflict', async () => {
    const scenario = await createOfflineOnlineScenario()
    mockServerHandler.handle = scenario.fakeServer.handleRequest

    scenario.cloudStore.$patch(makeValidCloudContext())
    await saveToken('mock-bearer-token-123')

    const productStore = useProductStore(scenario.pinia)
    const prod = await productStore.createProduct({ name: 'Kopi Hitam', category: 'Minuman', price: 10000, stock: 5 })

    await scenario.adapter.saveSyncPushBinding({ businessId: 10, boundAt: new Date().toISOString() })
    await scenario.adapter.saveSyncPullBinding({
      businessId: 10,
      outletId: 101,
      deviceIdentifier: '123e4567-e89b-12d3-a456-426614174000',
      registeredDeviceId: 55,
      boundAt: new Date().toISOString(),
    })
    await scenario.adapter.saveSyncPullState({ cursor: 0, serverSequence: 0 })

    const registry = scenario.foundation.registry
    await registry.ensureLoaded()
    const prodSyncId = await registry.resolveSyncId(SYNC_ENTITY_TYPES.PRODUCT, prod.product.id)
    const catSyncId = await registry.resolveSyncId(SYNC_ENTITY_TYPES.CATEGORY, 'Minuman')

    // Seed server
    scenario.fakeServer.db.products.push({
      sync_id: prodSyncId,
      name: 'Kopi Hitam',
      category_sync_id: catSyncId,
      price: 10000,
      business_id: 10,
      sync_version: 1,
      sync_sequence: 1,
    })
    scenario.fakeServer.setServerSequence(1)

    // Store server version locally
    await scenario.adapter.saveSyncServerVersions({
      [`products:${prodSyncId}`]: 1,
    })

    // Offline - modify locally
    scenario.runtimeSignal.setOnline(false)
    await productStore.updateProduct(prod.product.id, { name: 'Kopi Hitam', category: 'Minuman', price: 12000, stock: 5 })

    // Add unrelated mutation (e.g. customer)
    const customerStore = useCustomerStore(scenario.pinia)
    await customerStore.createCustomer({ name: 'Andi', phone: '0812' })

    await scenario.scheduler.flush()

    // Offline - modify remotely (forcing conflict)
    scenario.fakeServer.db.products[0].name = 'Kopi Hitam Super'
    scenario.fakeServer.db.products[0].sync_version = 2
    scenario.fakeServer.db.products[0].sync_sequence = 2
    scenario.fakeServer.setServerSequence(2)

    // Online - push
    scenario.runtimeSignal.setOnline(true)
    const pushStore = useSyncPushStore(scenario.pinia)
    const pushRes = await pushStore.pushNow()
    expect(pushRes.ok).toBe(false)
    expect(pushRes.code).toBe('SYNC_CONFLICT')

    // Conflict should be registered
    const conflictStore = useSyncConflictStore(scenario.pinia)
    await conflictStore.loadConflicts()
    expect(conflictStore.conflicts.length).toBe(1)
    expect(conflictStore.conflicts[0].syncId).toBe(prodSyncId)

    // Unrelated outbox item is preserved
    const pending = await scenario.adapter.listSyncQueueItems()
    expect(pending.length).toBeGreaterThan(0)
    const types = pending.map((x) => x.entityType)
    expect(types).toContain(SYNC_ENTITY_TYPES.CUSTOMER)

    await scenario.cleanup()
  })

  it('8. keepLocal → retry → local wins safely', async () => {
    const scenario = await createOfflineOnlineScenario()
    mockServerHandler.handle = scenario.fakeServer.handleRequest

    scenario.cloudStore.$patch(makeValidCloudContext())
    await saveToken('mock-bearer-token-123')

    const productStore = useProductStore(scenario.pinia)
    const prod = await productStore.createProduct({ name: 'Kopi Hitam', category: 'Minuman', price: 10000, stock: 5 })

    await scenario.adapter.saveSyncPushBinding({ businessId: 10, boundAt: new Date().toISOString() })
    await scenario.adapter.saveSyncPullBinding({
      businessId: 10,
      outletId: 101,
      deviceIdentifier: '123e4567-e89b-12d3-a456-426614174000',
      registeredDeviceId: 55,
      boundAt: new Date().toISOString(),
    })
    await scenario.adapter.saveSyncPullState({ cursor: 0, serverSequence: 0 })

    const registry = scenario.foundation.registry
    await registry.ensureLoaded()
    const prodSyncId = await registry.resolveSyncId(SYNC_ENTITY_TYPES.PRODUCT, prod.product.id)
    const catSyncId = await registry.resolveSyncId(SYNC_ENTITY_TYPES.CATEGORY, 'Minuman')

    // Seed server
    scenario.fakeServer.db.products.push({
      sync_id: prodSyncId,
      name: 'Kopi Hitam',
      category_sync_id: catSyncId,
      price: 10000,
      business_id: 10,
      sync_version: 1,
      sync_sequence: 1,
    })
    scenario.fakeServer.setServerSequence(1)
    await scenario.adapter.saveSyncServerVersions({ [`products:${prodSyncId}`]: 1 })

    // Locally modify & trigger conflict
    await productStore.updateProduct(prod.product.id, { name: 'Kopi Hitam', category: 'Minuman', price: 12000, stock: 5 })
    await scenario.scheduler.flush()

    scenario.fakeServer.db.products[0].name = 'Kopi Hitam Super'
    scenario.fakeServer.db.products[0].sync_version = 2
    scenario.fakeServer.db.products[0].sync_sequence = 2
    scenario.fakeServer.setServerSequence(2)

    scenario.runtimeSignal.setOnline(true)
    const pushStore = useSyncPushStore(scenario.pinia)
    await pushStore.pushNow()

    // Resolve keepLocal
    const conflictStore = useSyncConflictStore(scenario.pinia)
    await conflictStore.loadConflicts()
    const conflict = conflictStore.conflicts[0]

    const resolveRes = await conflictStore.keepLocal(conflict.id)
    expect(resolveRes.ok).toBe(true)

    // Retry Push
    const pushRes = await pushStore.pushNow()
    expect(pushRes.ok).toBe(true)

    // Verify server has local value
    expect(scenario.fakeServer.db.products[0].price).toBe(12000)

    await scenario.cleanup()
  })

  it('9. useServer → pull → server wins safely', async () => {
    const scenario = await createOfflineOnlineScenario()
    mockServerHandler.handle = scenario.fakeServer.handleRequest

    scenario.cloudStore.$patch(makeValidCloudContext())
    await saveToken('mock-bearer-token-123')

    const productStore = useProductStore(scenario.pinia)
    const prod = await productStore.createProduct({ name: 'Kopi Hitam', category: 'Minuman', price: 10000, stock: 5 })

    await scenario.adapter.saveSyncPushBinding({ businessId: 10, boundAt: new Date().toISOString() })
    await scenario.adapter.saveSyncPullBinding({
      businessId: 10,
      outletId: 101,
      deviceIdentifier: '123e4567-e89b-12d3-a456-426614174000',
      registeredDeviceId: 55,
      boundAt: new Date().toISOString(),
    })
    await scenario.adapter.saveSyncPullState({ cursor: 0, serverSequence: 0 })

    const registry = scenario.foundation.registry
    await registry.ensureLoaded()
    const prodSyncId = await registry.resolveSyncId(SYNC_ENTITY_TYPES.PRODUCT, prod.product.id)
    const catSyncId = await registry.resolveSyncId(SYNC_ENTITY_TYPES.CATEGORY, 'Minuman')

    // Seed server
    scenario.fakeServer.db.products.push({
      sync_id: prodSyncId,
      name: 'Kopi Hitam',
      category_sync_id: catSyncId,
      price: 10000,
      business_id: 10,
      sync_version: 1,
      sync_sequence: 1,
    })
    scenario.fakeServer.setServerSequence(1)
    await scenario.adapter.saveSyncServerVersions({ [`products:${prodSyncId}`]: 1 })

    // Locally modify & trigger conflict
    await productStore.updateProduct(prod.product.id, { name: 'Kopi Hitam', category: 'Minuman', price: 12000, stock: 5 })
    await scenario.scheduler.flush()

    scenario.fakeServer.db.products[0].name = 'Kopi Hitam Super'
    scenario.fakeServer.db.products[0].price = 14000
    scenario.fakeServer.db.products[0].sync_version = 2
    scenario.fakeServer.db.products[0].sync_sequence = 2
    scenario.fakeServer.setServerSequence(2)

    scenario.runtimeSignal.setOnline(true)
    const pushStore = useSyncPushStore(scenario.pinia)
    await pushStore.pushNow()

    // Resolve useServer
    const conflictStore = useSyncConflictStore(scenario.pinia)
    await conflictStore.loadConflicts()
    const conflict = conflictStore.conflicts[0]

    const resolveRes = await conflictStore.useServer(conflict.id)
    expect(resolveRes.ok).toBe(true)

    // Pull to apply server value
    const pullStore = useSyncPullStore(scenario.pinia)
    const pullResult = await pullStore.pullNow()
    expect(pullResult.ok).toBe(true)

    // Local product should have server name and price
    const localProd = productStore.getProductById(prod.product.id)
    expect(localProd.name).toBe('Kopi Hitam Super')
    expect(localProd.price).toBe(14000)

    await scenario.cleanup()
  })

  it('10. Business/Outlet mismatch blocks all transport and preserves local queue', async () => {
    const scenario = await createOfflineOnlineScenario()
    mockServerHandler.handle = scenario.fakeServer.handleRequest

    scenario.cloudStore.$patch(makeValidCloudContext())
    await saveToken('mock-bearer-token-123')

    const productStore = useProductStore(scenario.pinia)
    await productStore.createProduct({ name: 'Kopi Susu', category: 'Minuman', price: 15000, stock: 5 })
    await scenario.scheduler.flush()

    await scenario.adapter.saveSyncPushBinding({ businessId: 10, boundAt: new Date().toISOString() })

    // Mismatch business id to 999
    scenario.cloudStore.selectedBusiness = { id: 999, name: 'Wrong Business' }

    const guardStore = useSyncContextGuardStore(scenario.pinia)
    const checkRes = await guardStore.check()
    expect(checkRes.ok).toBe(false)
    expect(checkRes.status).toBe('blocked')

    const pushStore = useSyncPushStore(scenario.pinia)
    const pushRes = await pushStore.pushNow()
    expect(pushRes.ok).toBe(false)
    expect(pushRes.code).toBe('SYNC_CONTEXT_GUARD_BLOCKED')

    // Local queue is preserved
    const pendingCount = await scenario.adapter.countSyncQueueItems()
    expect(pendingCount).toBeGreaterThan(0)

    // Fake server must have received 0 data
    expect(scenario.fakeServer.getPushRequestCount()).toBe(0)

    await scenario.cleanup()
  })

  it('11. Returning to canonical tenant allows sync again', async () => {
    const scenario = await createOfflineOnlineScenario()
    mockServerHandler.handle = scenario.fakeServer.handleRequest

    scenario.cloudStore.$patch(makeValidCloudContext())
    await saveToken('mock-bearer-token-123')
    scenario.runtimeSignal.setOnline(true)

    const productStore = useProductStore(scenario.pinia)
    await productStore.createProduct({ name: 'Kopi Susu', category: 'Minuman', price: 15000, stock: 5 })
    await scenario.scheduler.flush()

    await scenario.adapter.saveSyncPushBinding({ businessId: 10, boundAt: new Date().toISOString() })

    // Simulate mismatch first
    scenario.cloudStore.selectedBusiness = { id: 999, name: 'Wrong Business' }
    const pushRes1 = await useSyncPushStore(scenario.pinia).pushNow()
    expect(pushRes1.ok).toBe(false)

    // Restore canonical context
    scenario.cloudStore.selectedBusiness = { id: 10, name: 'Kedai Kopi Utama' }
    
    // Sync runs and succeeds
    const pushRes2 = await useSyncPushStore(scenario.pinia).pushNow()
    expect(pushRes2.ok).toBe(true)

    // Verify fake server business 999 (Business B) has 0 data
    const wrongBizData = scenario.fakeServer.db.products.filter((p) => p.business_id === 999)
    expect(wrongBizData).toHaveLength(0)

    await scenario.cleanup()
  })

  it('12. Foreground offline→online Auto Sync completes through P20→P16', async () => {
    const scenario = await createOfflineOnlineScenario()
    mockServerHandler.handle = scenario.fakeServer.handleRequest

    scenario.cloudStore.$patch(makeValidCloudContext())
    await saveToken('mock-bearer-token-123')

    await scenario.adapter.saveSyncPushBinding({ businessId: 10, boundAt: new Date().toISOString() })
    await scenario.adapter.saveSyncPullBinding({
      businessId: 10,
      outletId: 101,
      deviceIdentifier: '123e4567-e89b-12d3-a456-426614174000',
      registeredDeviceId: 55,
      boundAt: new Date().toISOString(),
    })
    await scenario.adapter.saveSyncPullState({ version: 1, cursor: 0, serverSequence: 0 })

    // Simulate that bootstrap was already completed so push doesn't fail with SYNC_BOOTSTRAP_REQUIRED
    await scenario.adapter.saveSyncBootstrapState({
      version: 1,
      businessId: 10,
      outletId: 101,
      deviceIdentifier: '123e4567-e89b-12d3-a456-426614174000',
      registeredDeviceId: 55,
      status: 'completed',
      stagedAt: new Date().toISOString(),
      counts: { categories: 0, products: 0, customers: 0, expenses: 0, transactions: 0 },
    })

    const registry = scenario.foundation.registry
    await registry.ensureLoaded()
    await registry.resolveSyncId(SYNC_ENTITY_TYPES.CATEGORY, 'Minuman')

    const autoSyncStore = useSyncAutoSyncStore(scenario.pinia)
    await autoSyncStore.setEnabled(true)
    autoSyncStore.startListeners()

    // Device starts offline
    scenario.runtimeSignal.setOnline(false)
    scenario.runtimeSignal.setForeground(true)

    const productStore = useProductStore(scenario.pinia)
    await productStore.createProduct({ name: 'Kopi Susu', category: 'Minuman', price: 15000, stock: 5 })
    await scenario.scheduler.flush()

    // No auto sync should have happened yet
    expect(scenario.fakeServer.getPushRequestCount()).toBe(0)

    // Transition online
    scenario.runtimeSignal.setOnline(true)

    // Wait for auto sync microtasks to run
    await new Promise((resolve) => setTimeout(resolve, 50))

    // Queue is cleared and push happened on server
    const pendingCount = await scenario.adapter.countSyncQueueItems()
    expect(pendingCount).toBe(0)
    expect(scenario.fakeServer.getPushRequestCount()).toBe(1)

    // Activity log entry should exist
    const logStore = useSyncActivityLogStore(scenario.pinia)
    await logStore.refresh()
    expect(logStore.entries.length).toBeGreaterThan(0)
    expect(logStore.entries[0].action).toBe('AUTO_SYNC')

    await scenario.cleanup()
  })

  it('13. Startup online does not Auto Sync', async () => {
    const scenario = await createOfflineOnlineScenario()
    mockServerHandler.handle = scenario.fakeServer.handleRequest

    scenario.cloudStore.$patch(makeValidCloudContext())
    await saveToken('mock-bearer-token-123')

    // Initial state is online & foreground
    scenario.runtimeSignal.setOnline(true)
    scenario.runtimeSignal.setForeground(true)

    const autoSyncStore = useSyncAutoSyncStore(scenario.pinia)
    await autoSyncStore.setEnabled(true)
    autoSyncStore.startListeners()

    // Verify no sync called during startup
    expect(scenario.fakeServer.getPushRequestCount()).toBe(0)

    await scenario.cleanup()
  })

  it('14. Network failure preserves durable work', async () => {
    const scenario = await createOfflineOnlineScenario()
    mockServerHandler.handle = scenario.fakeServer.handleRequest

    scenario.cloudStore.$patch(makeValidCloudContext())
    await saveToken('mock-bearer-token-123')
    scenario.runtimeSignal.setOnline(true)

    await scenario.adapter.saveSyncPushBinding({ businessId: 10, boundAt: new Date().toISOString() })

    const productStore = useProductStore(scenario.pinia)
    await productStore.createProduct({ name: 'Kopi Susu', category: 'Minuman', price: 15000, stock: 5 })
    await scenario.scheduler.flush()

    // Simulate network failure
    scenario.fakeServer.setSimulateNetworkError(true)

    const pushStore = useSyncPushStore(scenario.pinia)
    const pushRes = await pushStore.pushNow()
    expect(pushRes.ok).toBe(false)

    // Verify queue count is still preserved
    const pendingCount = await scenario.adapter.countSyncQueueItems()
    expect(pendingCount).toBe(1)

    await scenario.cleanup()
  })

  it('15. At least one Sale + SaleItem relation survives full cycle', async () => {
    const scenario = await createOfflineOnlineScenario()
    mockServerHandler.handle = scenario.fakeServer.handleRequest

    scenario.cloudStore.$patch(makeValidCloudContext())
    await saveToken('mock-bearer-token-123')
    scenario.runtimeSignal.setOnline(true)

    const productStore = useProductStore(scenario.pinia)
    const prod = await productStore.createProduct({ name: 'Kopi Latte', category: 'Minuman', price: 20000, stock: 5 })

    const transactionStore = useTransactionStore(scenario.pinia)
    await transactionStore.createTransaction({
      items: [{ id: prod.product.id, name: 'Kopi Latte', price: 20000, qty: 2 }],
      subtotal: 40000,
      tax: 0,
      total: 40000,
      paymentMethod: 'cash',
    })
    await scenario.scheduler.flush()

    await scenario.adapter.saveSyncPushBinding({ businessId: 10, boundAt: new Date().toISOString() })

    // Push to server
    const pushStore = useSyncPushStore(scenario.pinia)
    const pushRes = await pushStore.pushNow()
    expect(pushRes.ok).toBe(true)

    // Server should have sale and sale items
    expect(scenario.fakeServer.db.sales).toHaveLength(1)
    expect(scenario.fakeServer.db.sale_items).toHaveLength(1)

    const serverSale = scenario.fakeServer.db.sales[0]
    const serverItem = scenario.fakeServer.db.sale_items[0]

    expect(serverItem.sale_sync_id).toBe(serverSale.sync_id)
    expect(serverItem.product_name).toBe('Kopi Latte')
    expect(serverItem.quantity).toBe(2)
    expect(serverItem.line_total).toBe(40000)

    await scenario.cleanup()
  })
})
