// src/__tests__/sync-offline-online-e2e.spec.js

import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  createOfflineOnlineScenario,
  createOfflineDataset,
  setupBoundCloudState,
  makeValidCloudContext,
} from './helpers/syncScenarioHarness'
import { useProductStore } from '@/stores/productStore'
import { useCustomerStore } from '@/stores/customerStore'
import { useTransactionStore } from '@/stores/transactionStore'
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
import { deriveSyncUiStatus, SYNC_UI_PENDING, SYNC_UI_CLEAR, SYNC_UI_LOCAL } from '@/services/sync/syncStatusService'

const { mockServerHandler } = vi.hoisted(() => ({ mockServerHandler: { handle: null } }))

vi.mock('@/services/cloud/apiClient', () => ({
  apiRequest: async (path, options) => {
    if (mockServerHandler.handle) return mockServerHandler.handle(path, options)
    return { ok: false, status: 500, error: 'Server not initialized' }
  },
}))

// Helper to derive P21 UI status given cloudStore + raw status result
function deriveUiStatus(cloudStore, rawStatus, online = true) {
  if (!rawStatus.ok) return null
  const cloudAvailable = cloudStore.cloudAccess === true &&
    cloudStore.user != null &&
    cloudStore.selectedBusiness != null
  return deriveSyncUiStatus({
    cloudAvailable,
    online,
    syncing: false,
    pendingCount: rawStatus.pendingCount,
    openConflictCount: rawStatus.openConflictCount,
    hasInflight: rawStatus.hasInflight,
  })
}

describe('P24: End-to-End Offline to Online Sync Scenarios', () => {
  beforeEach(() => {
    mockServerHandler.handle = null
    _resetTokenStore()
  })

  it('1. TRUE Free offline: local data durable, queue=0, network=0', async () => {
    const scenario = await createOfflineOnlineScenario({ businessMode: 'free' })
    mockServerHandler.handle = scenario.fakeServer.handleRequest
    const { prodResult, custResult, expResult } = await createOfflineDataset(scenario)
    expect(prodResult.success).toBe(true)
    expect(custResult.success).toBe(true)
    expect(expResult.success).toBe(true)
    const productStore = useProductStore(scenario.pinia)
    const customerStore = useCustomerStore(scenario.pinia)
    expect(productStore.products).toHaveLength(1)
    expect(customerStore.customers).toHaveLength(1)
    // Free mode: tracker does NOT enqueue
    expect(await scenario.adapter.countSyncQueueItems()).toBe(0)
    expect(scenario.fakeServer.getPushRequestCount()).toBe(0)
    expect(scenario.fakeServer.getPullRequestCount()).toBe(0)
    await scenario.cleanup()
  })

  it('2. Free -> Cloud upgrade: guard reports UNBOUND', async () => {
    const scenario = await createOfflineOnlineScenario({ businessMode: 'free' })
    mockServerHandler.handle = scenario.fakeServer.handleRequest
    await createOfflineDataset(scenario)
    const ctx = makeValidCloudContext()
    scenario.cloudStore.$patch(ctx)
    await saveToken('mock-bearer-token-123')
    scenario.businessStore.setBusiness({ name: 'Kedai Kopi Utama', type: 'Cafe', mode: 'cloud' })
    scenario.runtimeSignal.setOnline(true)
    const guardStore = useSyncContextGuardStore(scenario.pinia)
    const guardResult = await guardStore.check()
    expect(guardResult.ok).toBe(true)
    expect(guardResult.code).toBe('SYNC_CONTEXT_UNBOUND')
    const productStore = useProductStore(scenario.pinia)
    expect(productStore.products).toHaveLength(1)
    // Free mode data: no queue
    expect(await scenario.adapter.countSyncQueueItems()).toBe(0)
    await scenario.cleanup()
  })

  it('3. Bootstrap stages full dataset: status=staged, counts verified', async () => {
    const scenario = await createOfflineOnlineScenario({ businessMode: 'free' })
    mockServerHandler.handle = scenario.fakeServer.handleRequest
    await createOfflineDataset(scenario)
    scenario.cloudStore.$patch(makeValidCloudContext())
    await saveToken('mock-bearer-token-123')
    scenario.businessStore.setBusiness({ name: 'Kedai Kopi Utama', type: 'Cafe', mode: 'cloud' })
    scenario.runtimeSignal.setOnline(true)
    const bootstrapStore = useSyncBootstrapStore(scenario.pinia)
    expect((await bootstrapStore.bootstrapNow()).ok).toBe(true)
    const bootstrapState = await scenario.adapter.loadSyncBootstrapState()
    expect(bootstrapState).not.toBeNull()
    expect(bootstrapState.status).toBe('staged')
    expect(await scenario.adapter.countSyncQueueItems()).toBeGreaterThan(0)
    const queueItems = await scenario.adapter.listSyncQueueItems()
    const types = queueItems.map((x) => x.entityType)
    expect(types).toContain(SYNC_ENTITY_TYPES.CATEGORY)
    expect(types).toContain(SYNC_ENTITY_TYPES.PRODUCT)
    expect(types).toContain(SYNC_ENTITY_TYPES.CUSTOMER)
    expect(types).toContain(SYNC_ENTITY_TYPES.EXPENSE)
    expect(types).toContain(SYNC_ENTITY_TYPES.TRANSACTION)
    expect(bootstrapState.counts.products).toBeGreaterThanOrEqual(1)
    expect(bootstrapState.counts.customers).toBeGreaterThanOrEqual(1)
    await scenario.cleanup()
  })

  it('4. Push sends full dataset: queue=0, inflight=null, server verified', async () => {
    const scenario = await createOfflineOnlineScenario({ businessMode: 'free' })
    mockServerHandler.handle = scenario.fakeServer.handleRequest
    await createOfflineDataset(scenario)
    scenario.cloudStore.$patch(makeValidCloudContext())
    await saveToken('mock-bearer-token-123')
    scenario.businessStore.setBusiness({ name: 'Kedai Kopi Utama', type: 'Cafe', mode: 'cloud' })
    scenario.runtimeSignal.setOnline(true)
    expect((await useSyncBootstrapStore(scenario.pinia).bootstrapNow()).ok).toBe(true)
    const pushStore = useSyncPushStore(scenario.pinia)
    expect((await pushStore.pushNow()).ok).toBe(true)
    expect(await scenario.adapter.countSyncQueueItems()).toBe(0)
    expect(await scenario.adapter.loadSyncPushInflight()).toBeNull()
    const pushBinding = await scenario.adapter.loadSyncPushBinding()
    expect(pushBinding).not.toBeNull()
    expect(pushBinding.businessId).toBe(10)
    expect(scenario.fakeServer.db.products).toHaveLength(1)
    expect(scenario.fakeServer.db.products[0].name).toBe('Roti Bakar')
    expect(scenario.fakeServer.db.categories.length).toBeGreaterThan(0)
    expect(scenario.fakeServer.db.customers).toHaveLength(1)
    expect(scenario.fakeServer.db.expenses).toHaveLength(1)
    await scenario.cleanup()
  })

  it('5. Sale + SaleItem relation survives Bootstrap -> Push cycle', async () => {
    const scenario = await createOfflineOnlineScenario({ businessMode: 'free' })
    mockServerHandler.handle = scenario.fakeServer.handleRequest
    const productStore = useProductStore(scenario.pinia)
    await productStore.createCategory('Minuman')
    const prod = await productStore.createProduct({ name: 'Kopi Latte', category: 'Minuman', price: 20000, stock: 5 })
    expect(prod.success).toBe(true)
    const transactionStore = useTransactionStore(scenario.pinia)
    await transactionStore.createTransaction({ items: [{ id: prod.product.id, name: 'Kopi Latte', price: 20000, qty: 2 }], subtotal: 40000, tax: 0, total: 40000, paymentMethod: 'cash' })
    await scenario.scheduler.flush()
    scenario.cloudStore.$patch(makeValidCloudContext())
    await saveToken('mock-bearer-token-123')
    scenario.businessStore.setBusiness({ name: 'Kedai Kopi Utama', type: 'Cafe', mode: 'cloud' })
    scenario.runtimeSignal.setOnline(true)
    await useSyncBootstrapStore(scenario.pinia).bootstrapNow()
    expect((await useSyncPushStore(scenario.pinia).pushNow()).ok).toBe(true)

    // Assert server state after push
    expect(scenario.fakeServer.db.sales).toHaveLength(1)
    expect(scenario.fakeServer.db.sale_items).toHaveLength(1)
    const serverSale = scenario.fakeServer.db.sales[0]
    const serverItem = scenario.fakeServer.db.sale_items[0]
    expect(serverItem.sale_sync_id).toBe(serverSale.sync_id)
    expect(serverItem.product_name).toBe('Kopi Latte')
    expect(serverItem.quantity).toBe(2)
    expect(serverItem.line_total).toBe(40000)

    // Execute real P13 Pull cycle to test round-trip convergence
    const pullStore = useSyncPullStore(scenario.pinia)
    const pullRes1 = await pullStore.pullNow()
    expect(pullRes1.ok).toBe(true)

    // Expected final: no duplicate transaction, items preserved, queue 0
    expect(transactionStore.items).toHaveLength(1)
    expect(transactionStore.items[0].items).toHaveLength(1)
    expect(transactionStore.items[0].items[0].name).toBe('Kopi Latte')
    expect(transactionStore.items[0].items[0].qty).toBe(2)
    expect(scenario.fakeServer.db.sales).toHaveLength(1)
    expect(scenario.fakeServer.db.sale_items).toHaveLength(1)
    expect(await scenario.adapter.countSyncQueueItems()).toBe(0)

    // Verify second pull produces no duplicate or echo
    const pullRes2 = await pullStore.pullNow()
    expect(pullRes2.ok).toBe(true)
    expect(pullRes2.fetched).toBe(0)
    expect(await scenario.adapter.countSyncQueueItems()).toBe(0)
    expect(transactionStore.items).toHaveLength(1)

    await scenario.cleanup()
  })

  it('6. First Pull: no duplicate, cursor advanced, pull binding, queue=0', async () => {
    const scenario = await createOfflineOnlineScenario({ businessMode: 'cloud' })
    mockServerHandler.handle = scenario.fakeServer.handleRequest
    scenario.cloudStore.$patch(makeValidCloudContext())
    await saveToken('mock-bearer-token-123')
    scenario.runtimeSignal.setOnline(true)
    await scenario.adapter.saveSyncPushBinding({ businessId: 10, boundAt: new Date().toISOString() })
    const catSyncId = 'd754f9a0-97db-4e1a-826c-389f417f73db'
    const prodSyncId = 'f921f6bc-e2b2-4d2b-9279-3fb7661b17a1'
    scenario.fakeServer.db.categories.push({ sync_id: catSyncId, name: 'Minuman', business_id: 10, sync_version: 1, sync_sequence: 1 })
    scenario.fakeServer.db.products.push({ sync_id: prodSyncId, category_sync_id: catSyncId, name: 'Kopi Espresso', sku: 'ESP-1', price: 15000, business_id: 10, sync_version: 1, sync_sequence: 2 })
    scenario.fakeServer.setServerSequence(2)
    const pullStore = useSyncPullStore(scenario.pinia)
    const pullResult1 = await pullStore.pullNow()
    expect(pullResult1.ok).toBe(true)
    expect(pullResult1.fetched).toBe(2)
    const pullBinding = await scenario.adapter.loadSyncPullBinding()
    expect(pullBinding).not.toBeNull()
    expect(pullBinding.businessId).toBe(10)
    const pullState = await scenario.adapter.loadSyncPullState()
    expect(pullState.cursor).toBeGreaterThan(0)
    expect(await scenario.adapter.countSyncQueueItems()).toBe(0)
    const productStore = useProductStore(scenario.pinia)
    expect(productStore.products).toHaveLength(1)
    expect(productStore.categories).toHaveLength(1)
    await scenario.cleanup()
  })

  it('7. No pull echo: second pull fetches 0, queue stays 0', async () => {
    const scenario = await createOfflineOnlineScenario({ businessMode: 'cloud' })
    mockServerHandler.handle = scenario.fakeServer.handleRequest
    scenario.cloudStore.$patch(makeValidCloudContext())
    await saveToken('mock-bearer-token-123')
    scenario.runtimeSignal.setOnline(true)
    await scenario.adapter.saveSyncPushBinding({ businessId: 10, boundAt: new Date().toISOString() })
    scenario.fakeServer.db.categories.push({ sync_id: 'a8d9fa0e-1234-4567-89ab-1234567890ab', name: 'Makanan', business_id: 10, sync_version: 1, sync_sequence: 1 })
    scenario.fakeServer.setServerSequence(1)
    const pullStore = useSyncPullStore(scenario.pinia)
    await pullStore.pullNow()
    expect(await scenario.adapter.countSyncQueueItems()).toBe(0)
    const r2 = await pullStore.pullNow()
    expect(r2.ok).toBe(true)
    expect(r2.fetched).toBe(0)
    expect(await scenario.adapter.countSyncQueueItems()).toBe(0)
    await scenario.cleanup()
  })

  it('8. Cloud-mode offline mutations generate durable outbox', async () => {
    const scenario = await createOfflineOnlineScenario({ businessMode: 'cloud' })
    mockServerHandler.handle = scenario.fakeServer.handleRequest
    scenario.cloudStore.$patch(makeValidCloudContext())
    const productStore = useProductStore(scenario.pinia)
    await productStore.createCategory('Makanan')
    await productStore.createProduct({ name: 'Roti Bakar', category: 'Makanan', price: 12000, stock: 10 })
    await scenario.scheduler.flush()
    const pendingCount = await scenario.adapter.countSyncQueueItems()
    expect(pendingCount).toBeGreaterThan(0)
    const types = (await scenario.adapter.listSyncQueueItems()).map((x) => x.entityType)
    expect(types).toContain(SYNC_ENTITY_TYPES.CATEGORY)
    expect(types).toContain(SYNC_ENTITY_TYPES.PRODUCT)
    expect(scenario.fakeServer.getPushRequestCount()).toBe(0)
    await scenario.cleanup()
  })

  it('9. Offline local + remote independent edits converge through syncAll', async () => {
    const scenario = await createOfflineOnlineScenario({ businessMode: 'cloud' })
    mockServerHandler.handle = scenario.fakeServer.handleRequest
    scenario.cloudStore.$patch(makeValidCloudContext())
    await saveToken('mock-bearer-token-123')
    const productStore = useProductStore(scenario.pinia)
    await productStore.createCategory('Minuman')
    const prod = await productStore.createProduct({ name: 'Es Teh', category: 'Minuman', price: 5000, stock: 5 })
    expect(prod.success).toBe(true)
    const registry = scenario.foundation.registry
    await registry.ensureLoaded()
    const prodSyncId = await registry.resolveSyncId(SYNC_ENTITY_TYPES.PRODUCT, prod.product.id)
    const catSyncId = await registry.resolveSyncId(SYNC_ENTITY_TYPES.CATEGORY, 'Minuman')
    await scenario.adapter.saveSyncPushBinding({ businessId: 10, boundAt: new Date().toISOString() })
    await scenario.adapter.saveSyncPullBinding({ businessId: 10, outletId: 101, deviceIdentifier: '123e4567-e89b-12d3-a456-426614174000', registeredDeviceId: 55, boundAt: new Date().toISOString() })
    await scenario.adapter.saveSyncPullState({ version: 1, cursor: 0, serverSequence: 0 })
    scenario.fakeServer.db.products.push({ sync_id: prodSyncId, name: 'Es Teh', category_sync_id: catSyncId, price: 5000, business_id: 10, sync_version: 1, sync_sequence: 1 })
    scenario.fakeServer.setServerSequence(1)
    await scenario.adapter.saveSyncServerVersions({ [`products:${prodSyncId}`]: 1 })
    scenario.runtimeSignal.setOnline(false)
    await productStore.updateProduct(prod.product.id, { name: 'Es Teh Manis', category: 'Minuman', price: 6000, stock: 5 })
    await scenario.scheduler.flush()
    scenario.fakeServer.db.customers.push({ sync_id: '33333333-3333-4333-8333-333333333333', name: 'Rudi', phone: '081222', business_id: 10, sync_version: 1, sync_sequence: 2 })
    scenario.fakeServer.setServerSequence(2)
    scenario.runtimeSignal.setOnline(true)
    const syncRes = await useSyncOrchestratorStore(scenario.pinia).syncAll()
    expect(syncRes.ok).toBe(true)
    const serverProd = scenario.fakeServer.db.products.find((p) => p.sync_id === prodSyncId)
    expect(serverProd.name).toBe('Es Teh Manis')
    expect(serverProd.price).toBe(6000)
    const customerStore = useCustomerStore(scenario.pinia)
    expect(customerStore.customers).toHaveLength(1)
    expect(customerStore.customers[0].name).toBe('Rudi')
    expect(await scenario.adapter.countSyncQueueItems()).toBe(0)
    expect(await scenario.adapter.loadSyncPushInflight()).toBeNull()
    await scenario.cleanup()
  })

  it('10. Real synced state: second syncAll is idempotent', async () => {
    const scenario = await createOfflineOnlineScenario({ businessMode: 'cloud' })
    mockServerHandler.handle = scenario.fakeServer.handleRequest
    scenario.cloudStore.$patch(makeValidCloudContext())
    await saveToken('mock-bearer-token-123')
    scenario.runtimeSignal.setOnline(true)
    const productStore = useProductStore(scenario.pinia)
    await productStore.createCategory('Minuman')
    await productStore.createProduct({ name: 'Kopi Hitam', category: 'Minuman', price: 10000, stock: 5 })
    await scenario.scheduler.flush()
    await scenario.adapter.saveSyncPushBinding({ businessId: 10, boundAt: new Date().toISOString() })
    await scenario.adapter.saveSyncPullBinding({ businessId: 10, outletId: 101, deviceIdentifier: '123e4567-e89b-12d3-a456-426614174000', registeredDeviceId: 55, boundAt: new Date().toISOString() })
    await scenario.adapter.saveSyncPullState({ version: 1, cursor: 0, serverSequence: 0 })
    const orchestratorStore = useSyncOrchestratorStore(scenario.pinia)
    expect((await orchestratorStore.syncAll()).ok).toBe(true)
    const serverCount1 = scenario.fakeServer.db.products.length
    const localCount1 = productStore.products.length
    expect((await orchestratorStore.syncAll()).ok).toBe(true)
    expect(scenario.fakeServer.db.products).toHaveLength(serverCount1)
    expect(productStore.products).toHaveLength(localCount1)
    expect(await scenario.adapter.countSyncQueueItems()).toBe(0)
    const conflictStore = useSyncConflictStore(scenario.pinia)
    await conflictStore.loadConflicts()
    expect(conflictStore.conflicts).toHaveLength(0)
    await scenario.cleanup()
  })

  it('11. Conflict via syncAll: stops P16 before Pull, conflict persisted', async () => {
    const scenario = await createOfflineOnlineScenario({ businessMode: 'cloud' })
    mockServerHandler.handle = scenario.fakeServer.handleRequest
    scenario.cloudStore.$patch(makeValidCloudContext())
    await saveToken('mock-bearer-token-123')
    const productStore = useProductStore(scenario.pinia)
    await productStore.createCategory('Minuman')
    const prod = await productStore.createProduct({ name: 'Kopi Hitam', category: 'Minuman', price: 10000, stock: 5 })
    expect(prod.success).toBe(true)
    await scenario.adapter.saveSyncPushBinding({ businessId: 10, boundAt: new Date().toISOString() })
    await scenario.adapter.saveSyncPullBinding({ businessId: 10, outletId: 101, deviceIdentifier: '123e4567-e89b-12d3-a456-426614174000', registeredDeviceId: 55, boundAt: new Date().toISOString() })
    await scenario.adapter.saveSyncPullState({ version: 1, cursor: 0, serverSequence: 0 })
    const registry = scenario.foundation.registry
    await registry.ensureLoaded()
    const prodSyncId = await registry.resolveSyncId(SYNC_ENTITY_TYPES.PRODUCT, prod.product.id)
    const catSyncId = await registry.resolveSyncId(SYNC_ENTITY_TYPES.CATEGORY, 'Minuman')
    scenario.fakeServer.db.products.push({ sync_id: prodSyncId, name: 'Kopi Hitam', category_sync_id: catSyncId, price: 10000, business_id: 10, sync_version: 1, sync_sequence: 1 })
    scenario.fakeServer.setServerSequence(1)
    await scenario.adapter.saveSyncServerVersions({ [`products:${prodSyncId}`]: 1 })
    await productStore.updateProduct(prod.product.id, { name: 'Kopi Hitam', category: 'Minuman', price: 12000, stock: 5 })
    await scenario.scheduler.flush()
    scenario.fakeServer.db.products[0].name = 'Kopi Hitam Super'
    scenario.fakeServer.db.products[0].sync_version = 2
    scenario.fakeServer.db.products[0].sync_sequence = 2
    scenario.fakeServer.setServerSequence(2)
    const pullCountBefore = scenario.fakeServer.getPullRequestCount()
    scenario.runtimeSignal.setOnline(true)
    const syncRes = await useSyncOrchestratorStore(scenario.pinia).syncAll()
    expect(syncRes.ok).toBe(false)
    expect(scenario.fakeServer.getPullRequestCount()).toBe(pullCountBefore)
    const conflictStore = useSyncConflictStore(scenario.pinia)
    await conflictStore.loadConflicts()
    expect(conflictStore.conflicts.length).toBe(1)
    expect(conflictStore.conflicts[0].syncId).toBe(prodSyncId)
    await scenario.cleanup()
  })

  it('12. keepLocal -> retry -> local wins: server updated, queue=0, conflicts=0', async () => {
    const scenario = await createOfflineOnlineScenario({ businessMode: 'cloud' })
    mockServerHandler.handle = scenario.fakeServer.handleRequest
    scenario.cloudStore.$patch(makeValidCloudContext())
    await saveToken('mock-bearer-token-123')
    scenario.runtimeSignal.setOnline(true)
    const productStore = useProductStore(scenario.pinia)
    await productStore.createCategory('Minuman')
    const prod = await productStore.createProduct({ name: 'Kopi Hitam', category: 'Minuman', price: 10000, stock: 5 })
    expect(prod.success).toBe(true)
    await scenario.scheduler.flush()

    await scenario.adapter.saveSyncPushBinding({ businessId: 10, boundAt: new Date().toISOString() })
    await scenario.adapter.saveSyncPullBinding({ businessId: 10, outletId: 101, deviceIdentifier: '123e4567-e89b-12d3-a456-426614174000', registeredDeviceId: 55, boundAt: new Date().toISOString() })
    await scenario.adapter.saveSyncPullState({ version: 1, cursor: 0, serverSequence: 0 })

    const pushStore = useSyncPushStore(scenario.pinia)
    expect((await pushStore.pushNow()).ok).toBe(true)
    expect(await scenario.adapter.countSyncQueueItems()).toBe(0)

    const registry = scenario.foundation.registry
    await registry.ensureLoaded()
    const prodSyncId = await registry.resolveSyncId(SYNC_ENTITY_TYPES.PRODUCT, prod.product.id)
    await scenario.adapter.saveSyncServerVersions({ [`products:${prodSyncId}`]: 1 })

    scenario.fakeServer.db.products[0].name = 'Kopi Hitam Super'
    scenario.fakeServer.db.products[0].sync_version = 2
    scenario.fakeServer.db.products[0].sync_sequence = 2
    scenario.fakeServer.setServerSequence(2)

    await productStore.updateProduct(prod.product.id, { name: 'Kopi Hitam', category: 'Minuman', price: 12000, stock: 5 })
    await scenario.scheduler.flush()
    expect(await scenario.adapter.countSyncQueueItems()).toBe(1)

    const conflictPushRes = await pushStore.pushNow()
    expect(conflictPushRes.ok).toBe(false)
    expect(conflictPushRes.code).toBe('SYNC_CONFLICT')

    const conflictStore = useSyncConflictStore(scenario.pinia)
    await conflictStore.loadConflicts()
    expect(conflictStore.openConflicts).toHaveLength(1)
    expect((await conflictStore.keepLocal(conflictStore.conflicts[0].id)).ok).toBe(true)
    expect((await pushStore.pushNow()).ok).toBe(true)
    expect(scenario.fakeServer.db.products[0].price).toBe(12000)
    expect(await scenario.adapter.countSyncQueueItems()).toBe(0)
    await conflictStore.loadConflicts()
    expect(conflictStore.openConflicts).toHaveLength(0)
    expect(conflictStore.conflicts[0].status).toBe('resolved')
    expect(await scenario.adapter.loadSyncPushInflight()).toBeNull()
    await scenario.cleanup()
  })

  it('13. useServer -> Pull -> server wins: local=server, queue=0, conflicts=0', async () => {
    const scenario = await createOfflineOnlineScenario({ businessMode: 'cloud' })
    mockServerHandler.handle = scenario.fakeServer.handleRequest
    scenario.cloudStore.$patch(makeValidCloudContext())
    await saveToken('mock-bearer-token-123')
    scenario.runtimeSignal.setOnline(true)
    const productStore = useProductStore(scenario.pinia)
    await productStore.createCategory('Minuman')
    const prod = await productStore.createProduct({ name: 'Kopi Hitam', category: 'Minuman', price: 10000, stock: 5 })
    expect(prod.success).toBe(true)
    await scenario.scheduler.flush()

    await scenario.adapter.saveSyncPushBinding({ businessId: 10, boundAt: new Date().toISOString() })
    await scenario.adapter.saveSyncPullBinding({ businessId: 10, outletId: 101, deviceIdentifier: '123e4567-e89b-12d3-a456-426614174000', registeredDeviceId: 55, boundAt: new Date().toISOString() })
    await scenario.adapter.saveSyncPullState({ version: 1, cursor: 0, serverSequence: 0 })

    const pushStore = useSyncPushStore(scenario.pinia)
    expect((await pushStore.pushNow()).ok).toBe(true)
    expect(await scenario.adapter.countSyncQueueItems()).toBe(0)

    const registry = scenario.foundation.registry
    await registry.ensureLoaded()
    const prodSyncId = await registry.resolveSyncId(SYNC_ENTITY_TYPES.PRODUCT, prod.product.id)
    await scenario.adapter.saveSyncServerVersions({ [`products:${prodSyncId}`]: 1 })

    scenario.fakeServer.db.products[0].name = 'Kopi Hitam Super'
    scenario.fakeServer.db.products[0].price = 14000
    scenario.fakeServer.db.products[0].sync_version = 2
    scenario.fakeServer.db.products[0].sync_sequence = 2
    scenario.fakeServer.setServerSequence(2)

    await productStore.updateProduct(prod.product.id, { name: 'Kopi Hitam', category: 'Minuman', price: 12000, stock: 5 })
    await scenario.scheduler.flush()
    expect(await scenario.adapter.countSyncQueueItems()).toBe(1)

    const conflictPushRes = await pushStore.pushNow()
    expect(conflictPushRes.ok).toBe(false)
    expect(conflictPushRes.code).toBe('SYNC_CONFLICT')

    const conflictStore = useSyncConflictStore(scenario.pinia)
    await conflictStore.loadConflicts()
    expect(conflictStore.openConflicts).toHaveLength(1)
    expect((await conflictStore.useServer(conflictStore.conflicts[0].id)).ok).toBe(true)
    expect(await scenario.adapter.countSyncQueueItems()).toBe(0)

    const pullStore = useSyncPullStore(scenario.pinia)
    expect((await pullStore.pullNow()).ok).toBe(true)
    const localProd = productStore.getProductById(prod.product.id)
    expect(localProd.name).toBe('Kopi Hitam Super')
    expect(localProd.price).toBe(14000)
    expect(await scenario.adapter.countSyncQueueItems()).toBe(0)
    expect(productStore.products).toHaveLength(1)
    await conflictStore.loadConflicts()
    expect(conflictStore.openConflicts).toHaveLength(0)
    expect(conflictStore.conflicts[0].status).toBe('resolved')
    await scenario.cleanup()
  })

  it('14. Business mismatch: guard blocked, no push HTTP, queue preserved', async () => {
    const scenario = await createOfflineOnlineScenario({ businessMode: 'cloud' })
    mockServerHandler.handle = scenario.fakeServer.handleRequest
    scenario.cloudStore.$patch(makeValidCloudContext())
    await saveToken('mock-bearer-token-123')
    const productStore = useProductStore(scenario.pinia)
    await productStore.createCategory('Minuman')
    await productStore.createProduct({ name: 'Kopi Susu', category: 'Minuman', price: 15000, stock: 5 })
    await scenario.scheduler.flush()
    await scenario.adapter.saveSyncPushBinding({ businessId: 10, boundAt: new Date().toISOString() })
    scenario.cloudStore.selectedBusiness = { id: 999, name: 'Wrong Business' }
    const guardStore = useSyncContextGuardStore(scenario.pinia)
    const checkRes = await guardStore.check()
    expect(checkRes.ok).toBe(false)
    expect(checkRes.status).toBe('blocked')
    const pushRes = await useSyncPushStore(scenario.pinia).pushNow()
    expect(pushRes.ok).toBe(false)
    expect(pushRes.code).toBe('SYNC_CONTEXT_GUARD_BLOCKED')
    expect(await scenario.adapter.countSyncQueueItems()).toBeGreaterThan(0)
    expect(scenario.fakeServer.getPushRequestCount()).toBe(0)
    expect(scenario.fakeServer.getRecordsForBusiness(999).products).toHaveLength(0)
    await scenario.cleanup()
  })

  it('15. Outlet mismatch: guard blocked, no push HTTP, queue preserved', async () => {
    const scenario = await createOfflineOnlineScenario({ businessMode: 'cloud' })
    mockServerHandler.handle = scenario.fakeServer.handleRequest
    scenario.cloudStore.$patch(makeValidCloudContext())
    await saveToken('mock-bearer-token-123')
    const productStore = useProductStore(scenario.pinia)
    await productStore.createCategory('Minuman')
    await productStore.createProduct({ name: 'Teh Botol', category: 'Minuman', price: 5000, stock: 20 })
    await scenario.scheduler.flush()
    await scenario.adapter.saveSyncPushBinding({ businessId: 10, boundAt: new Date().toISOString() })
    await scenario.adapter.saveSyncPullBinding({ businessId: 10, outletId: 101, deviceIdentifier: '123e4567-e89b-12d3-a456-426614174000', registeredDeviceId: 55, boundAt: new Date().toISOString() })
    scenario.cloudStore.selectedOutlet = { id: 999, name: 'Wrong Outlet' }
    const guardStore = useSyncContextGuardStore(scenario.pinia)
    expect((await guardStore.check()).ok).toBe(false)
    expect((await useSyncPushStore(scenario.pinia).pushNow()).ok).toBe(false)
    expect(scenario.fakeServer.getPushRequestCount()).toBe(0)
    expect(await scenario.adapter.countSyncQueueItems()).toBeGreaterThan(0)
    await scenario.cleanup()
  })

  it('16. Return canonical tenant: sync succeeds, Business B has 0 data', async () => {
    const scenario = await createOfflineOnlineScenario({ businessMode: 'cloud' })
    mockServerHandler.handle = scenario.fakeServer.handleRequest
    scenario.cloudStore.$patch(makeValidCloudContext())
    await saveToken('mock-bearer-token-123')
    scenario.runtimeSignal.setOnline(true)
    const productStore = useProductStore(scenario.pinia)
    await productStore.createCategory('Minuman')
    await productStore.createProduct({ name: 'Kopi Susu', category: 'Minuman', price: 15000, stock: 5 })
    await scenario.scheduler.flush()
    await scenario.adapter.saveSyncPushBinding({ businessId: 10, boundAt: new Date().toISOString() })
    scenario.cloudStore.selectedBusiness = { id: 999, name: 'Wrong Business' }
    expect((await useSyncPushStore(scenario.pinia).pushNow()).ok).toBe(false)
    scenario.cloudStore.selectedBusiness = { id: 10, name: 'Kedai Kopi Utama' }
    expect((await useSyncPushStore(scenario.pinia).pushNow()).ok).toBe(true)
    const biz999 = scenario.fakeServer.getRecordsForBusiness(999)
    expect(biz999.products).toHaveLength(0)
    expect(biz999.categories).toHaveLength(0)
    const biz10 = scenario.fakeServer.getRecordsForBusiness(10)
    expect(biz10.products).toHaveLength(1)
    await scenario.cleanup()
  })

  it('17. Foreground offline->online Auto Sync: event-driven via runtimeSignal.setOnlineAsync', async () => {
    const scenario = await createOfflineOnlineScenario({ businessMode: 'cloud', initialOnline: false, initialForeground: true })
    mockServerHandler.handle = scenario.fakeServer.handleRequest

    // Full cloud context and bootstrap state
    await setupBoundCloudState(scenario)
    scenario.runtimeSignal.setOnline(false)

    // Enable Auto Sync using the current cloud context (stored in cloudStore)
    const autoSyncStore = useSyncAutoSyncStore(scenario.pinia)
    const setRes = await autoSyncStore.setEnabled(true)
    expect(setRes.ok).toBe(true)

    // Create pending item while offline (cloud mode => queue)
    const productStore = useProductStore(scenario.pinia)
    await productStore.createCategory('Minuman')
    await productStore.createProduct({ name: 'Kopi Susu', category: 'Minuman', price: 15000, stock: 5 })
    await scenario.scheduler.flush()
    expect(scenario.fakeServer.getPushRequestCount()).toBe(0)

    // Attach listeners on offline runtime
    autoSyncStore.startListeners()

    // Transition online via runtime event and await completion deterministically
    await scenario.runtimeSignal.setOnlineAsync(true)

    // Queue cleared and push happened
    expect(await scenario.adapter.countSyncQueueItems()).toBe(0)
    expect(scenario.fakeServer.getPushRequestCount()).toBe(1)
    expect(scenario.fakeServer.getPullRequestCount()).toBe(1)

    const logStore = useSyncActivityLogStore(scenario.pinia)
    await logStore.refresh()
    expect(logStore.entries.length).toBe(1)
    expect(logStore.entries[0].action).toBe('AUTO_SYNC')

    await scenario.cleanup()
  })

  it('18. Startup online does NOT trigger Auto Sync', async () => {
    const scenario = await createOfflineOnlineScenario({ businessMode: 'cloud', initialOnline: true, initialForeground: true })
    mockServerHandler.handle = scenario.fakeServer.handleRequest
    await setupBoundCloudState(scenario)
    scenario.runtimeSignal.setOnline(true)
    const productStore = useProductStore(scenario.pinia)
    await productStore.createCategory('Minuman')
    await productStore.createProduct({ name: 'Teh Panas', category: 'Minuman', price: 5000, stock: 10 })
    await scenario.scheduler.flush()
    const pendingBefore = await scenario.adapter.countSyncQueueItems()
    expect(pendingBefore).toBeGreaterThan(0)
    const autoSyncStore = useSyncAutoSyncStore(scenario.pinia)
    await autoSyncStore.setEnabled(true)
    // Attach listener — runtime already ONLINE, no "online" transition will fire
    autoSyncStore.startListeners()
    // Drain microtask queue
    await Promise.resolve()
    await Promise.resolve()
    // No push happened — startup does not trigger Auto Sync
    expect(scenario.fakeServer.getPushRequestCount()).toBe(0)
    expect(await scenario.adapter.countSyncQueueItems()).toBe(pendingBefore)
    await scenario.cleanup()
  })

  it('19. Network failure preserves queue + inflight; retry reuses request_id', async () => {
    const scenario = await createOfflineOnlineScenario({ businessMode: 'cloud' })
    mockServerHandler.handle = scenario.fakeServer.handleRequest
    scenario.cloudStore.$patch(makeValidCloudContext())
    await saveToken('mock-bearer-token-123')
    scenario.runtimeSignal.setOnline(true)
    await scenario.adapter.saveSyncPushBinding({ businessId: 10, boundAt: new Date().toISOString() })
    const productStore = useProductStore(scenario.pinia)
    await productStore.createCategory('Minuman')
    await productStore.createProduct({ name: 'Kopi Susu', category: 'Minuman', price: 15000, stock: 5 })
    await scenario.scheduler.flush()
    expect(await scenario.adapter.countSyncQueueItems()).toBe(2)
    scenario.fakeServer.setSimulateNetworkError(true)
    const pushStore = useSyncPushStore(scenario.pinia)
    expect((await pushStore.pushNow()).ok).toBe(false)
    expect(await scenario.adapter.countSyncQueueItems()).toBeGreaterThan(0)
    const inflight1 = await scenario.adapter.loadSyncPushInflight()
    expect(inflight1).not.toBeNull()
    expect(typeof inflight1.requestId).toBe('string')
    expect(inflight1.requestId.trim().length).toBeGreaterThan(0)
    expect(productStore.products).toHaveLength(1)
    scenario.fakeServer.setSimulateNetworkError(false)
    expect((await pushStore.pushNow()).ok).toBe(true)
    expect(await scenario.adapter.countSyncQueueItems()).toBe(0)
    expect(await scenario.adapter.loadSyncPushInflight()).toBeNull()
    const pushRequests = scenario.fakeServer.getPushRequests()
    expect(pushRequests.length).toBeGreaterThanOrEqual(2)
    const firstId = pushRequests[0].request_id
    expect(pushRequests.every((r) => r.request_id === firstId)).toBe(true)
    expect(scenario.fakeServer.db.products).toHaveLength(1)
    await scenario.cleanup()
  })

  it('20. P17 health transitions and P21 status pending -> clear', async () => {
    const scenario = await createOfflineOnlineScenario({ businessMode: 'cloud', initialOnline: true })
    mockServerHandler.handle = scenario.fakeServer.handleRequest
    scenario.cloudStore.$patch(makeValidCloudContext())
    await saveToken('mock-bearer-token-123')
    scenario.runtimeSignal.setOnline(true)
    await scenario.adapter.saveSyncPushBinding({ businessId: 10, boundAt: new Date().toISOString() })
    await scenario.adapter.saveSyncPullState({ version: 1, cursor: 0, serverSequence: 0 })
    await scenario.adapter.saveSyncBootstrapState({ version: 1, businessId: 10, outletId: 101, deviceIdentifier: '123e4567-e89b-12d3-a456-426614174000', registeredDeviceId: 55, status: 'completed', stagedAt: new Date().toISOString(), counts: { categories: 0, products: 0, customers: 0, expenses: 0, transactions: 0 } })
    const statusStore = useSyncStatusStore(scenario.pinia)
    // P21: LOCAL when cloudAccess=false
    const noCloudCtx = { ...makeValidCloudContext(), cloudAccess: false }
    scenario.cloudStore.$patch(noCloudCtx)
    const rawLocal = await statusStore.refresh()
    const localStatus = deriveUiStatus(scenario.cloudStore, rawLocal)
    expect(localStatus.status).toBe(SYNC_UI_LOCAL)
    // Restore cloud context
    scenario.cloudStore.$patch(makeValidCloudContext())
    // P21: PENDING when queue > 0
    const productStore = useProductStore(scenario.pinia)
    await productStore.createCategory('Makanan')
    await productStore.createProduct({ name: 'Roti', category: 'Makanan', price: 8000, stock: 5 })
    await scenario.scheduler.flush()
    const rawPending = await statusStore.refresh()
    const pendingStatus = deriveUiStatus(scenario.cloudStore, rawPending)
    expect(pendingStatus.status).toBe(SYNC_UI_PENDING)
    // P17: attention when pending > 0
    const healthStore = useSyncHealthStore(scenario.pinia)
    const healthRes1 = await healthStore.checkHealth()
    expect(healthRes1.ok).toBe(true)
    expect(healthRes1.status).toBe('attention')
    expect(healthRes1.code).toBe('SYNC_HEALTH_ATTENTION')
    expect(healthRes1.issues).toHaveLength(1)
    expect(healthRes1.issues[0].code).toBe('SYNC_PENDING_QUEUE')
    // Push to clear queue
    expect((await useSyncPushStore(scenario.pinia).pushNow()).ok).toBe(true)
    expect(await scenario.adapter.countSyncQueueItems()).toBe(0)
    // P21: CLEAR after successful sync
    const rawClear = await statusStore.refresh()
    const clearStatus = deriveUiStatus(scenario.cloudStore, rawClear)
    expect(clearStatus.status).toBe(SYNC_UI_CLEAR)
    // P17: ready when queue=0, no conflicts, no inflight
    const healthRes2 = await healthStore.checkHealth()
    expect(healthRes2.ok).toBe(true)
    expect(healthRes2.status).toBe('ready')
    expect(healthRes2.code).toBe('SYNC_HEALTH_READY')
    expect(healthRes2.issues).toHaveLength(0)
    await scenario.cleanup()
  })

  it('21. Tenant collision regression: Business A pushing sync_id X does not overwrite Business B record with same sync_id', async () => {
    const scenario = await createOfflineOnlineScenario({ businessMode: 'cloud' })
    mockServerHandler.handle = scenario.fakeServer.handleRequest
    scenario.cloudStore.$patch(makeValidCloudContext())
    await saveToken('mock-bearer-token-123')
    scenario.runtimeSignal.setOnline(true)

    // Pre-populate server with a product belonging to Business B (id: 20) with sync_id X
    const collisionSyncId = '11111111-2222-4333-8444-555555555555'
    scenario.fakeServer.db.products.push({
      sync_id: collisionSyncId,
      name: 'Product Tenant B',
      price: 99000,
      business_id: 20,
      sync_version: 1,
      sync_sequence: 1,
    })
    scenario.fakeServer.setServerSequence(1)

    // Business A (id: 10) creates category and a product using the collision sync_id
    const productStore = useProductStore(scenario.pinia)
    await productStore.createCategory('Makanan')
    const productData = {
      id: collisionSyncId,
      name: 'Product Tenant A',
      category: 'Makanan',
      price: 15000,
      stock: 10,
      isActive: true,
    }
    productStore.products.push(productData)
    await scenario.foundation.queueService.enqueueUpsert(
      SYNC_ENTITY_TYPES.PRODUCT,
      collisionSyncId,
      productData,
    )
    await scenario.scheduler.flush()

    // Business A pushes its product
    await scenario.adapter.saveSyncPushBinding({ businessId: 10, boundAt: new Date().toISOString() })
    const pushRes = await useSyncPushStore(scenario.pinia).pushNow()
    expect(pushRes.ok).toBe(true)

    // Assert Business B's record is completely intact
    const bizB = scenario.fakeServer.getRecordsForBusiness(20)
    expect(bizB.products).toHaveLength(1)
    expect(bizB.products[0].sync_id).toBe(collisionSyncId)
    expect(bizB.products[0].name).toBe('Product Tenant B')
    expect(bizB.products[0].price).toBe(99000)
    expect(bizB.products[0].business_id).toBe(20)

    // Assert Business A's record was created separately under business_id 10
    const bizA = scenario.fakeServer.getRecordsForBusiness(10)
    expect(bizA.products).toHaveLength(1)
    expect(bizA.products[0].sync_id).toBe(collisionSyncId)
    expect(bizA.products[0].name).toBe('Product Tenant A')
    expect(bizA.products[0].price).toBe(15000)
    expect(bizA.products[0].business_id).toBe(10)

    // Total products on server is 2 (no overwriting across tenants)
    expect(scenario.fakeServer.db.products).toHaveLength(2)
    await scenario.cleanup()
  })
})
