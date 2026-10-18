// src/__tests__/cloud-first-sync-completion-e2e.spec.js
//
// P0 Data Sync Reliability — Real End-to-End Cloud-First Sync Tests (Task 4)

import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  createOfflineOnlineScenario,
  makeValidCloudContext,
} from './helpers/syncScenarioHarness'
import { restartAppScenario } from './helpers/syncRestartHarness'
import { createMemoryAdapter } from '@/services/database/memoryAdapter'
import { useProductStore } from '@/stores/productStore'
import { useTransactionStore } from '@/stores/transactionStore'
import { useSyncPushStore } from '@/stores/syncPushStore'
import { useSyncPullStore } from '@/stores/syncPullStore'
import { useSyncContextGuardStore } from '@/stores/syncContextGuardStore'
import { useCloudSessionStore } from '@/stores/cloudSessionStore'
import { saveToken, _resetTokenStore } from '@/services/cloud/tokenRepository'
import { SYNC_ENTITY_TYPES } from '@/services/sync/syncConstants'
import { inspectCloudFirstWorkspace } from '@/services/cloud/businessContextActivation'

const { mockServerHandler } = vi.hoisted(() => ({ mockServerHandler: { handle: null } }))

vi.mock('@/services/cloud/apiClient', () => ({
  apiRequest: async (path, options) => {
    if (mockServerHandler.handle) return mockServerHandler.handle(path, options)
    return { ok: false, status: 500, error: 'Server not initialized' }
  },
}))

describe('Cloud-First Sync Completion E2E (PR #60 Task 4)', () => {
  beforeEach(async () => {
    mockServerHandler.handle = null
    _resetTokenStore()
    await saveToken('mock-bearer-token-123')
  })

  it('Main Scenario: Device A Cloud Business -> Device B POS Mobile Initial Pull -> POS Cash Sale -> Push -> Restart -> Pull Back', async () => {
    // ── 1. Device A: Server has existing Cloud business, category, and product ──
    const scenario = await createOfflineOnlineScenario({
      businessMode: 'cloud',
      initialOnline: true,
    })
    mockServerHandler.handle = scenario.fakeServer.handleRequest

    const businessId = 10
    const outletId = 101
    const deviceId = 55
    const devIdentifier = '123e4567-e89b-12d3-a456-426614174000'

    // Populate Device A cloud data on fake server
    const categorySyncId = '11111111-1111-4111-8111-111111111111'
    const productSyncId = '22222222-2222-4222-8222-222222222222'

    scenario.fakeServer.db.categories.push({
      sync_id: categorySyncId,
      name: 'Minuman Kopi',
      business_id: businessId,
      sync_version: 1,
      sync_sequence: 1,
      is_active: 1,
    })
    scenario.fakeServer.db.products.push({
      sync_id: productSyncId,
      category_sync_id: categorySyncId,
      name: 'Kopi Susu Aren Gula Batu',
      category: 'Minuman Kopi',
      price: 22000,
      cost_price: 10000,
      stock: 45,
      unit: 'cup',
      business_id: businessId,
      sync_version: 1,
      sync_sequence: 2,
      is_active: 1,
    })

    // ── 2. Device B: Fresh login, selects business 10, outlet 101 ──
    const cloudContext = makeValidCloudContext({
      selectedBusiness: { id: businessId, name: 'Kedai Kopi Utama' },
      selectedOutlet: { id: outletId, name: 'Outlet Pusat' },
      registeredDeviceId: deviceId,
      deviceIdentifier: devIdentifier,
      role: 'owner',
      syncCapabilities: { push_mode: 'full' },
      capabilityState: 'verified',
    })

    const cloudStore = useCloudSessionStore(scenario.pinia)
    cloudStore.$patch(cloudContext)
    await scenario.adapter.saveCloudContext(cloudContext)
    await scenario.adapter.saveDeviceIdentifier(cloudContext.deviceIdentifier)
    await saveToken('mock-bearer-token-123')

    // Ensure clean sync queue before initial pull
    const qItems = await scenario.adapter.listSyncQueueItems()
    for (const q of qItems) {
      await scenario.adapter.deleteSyncQueueItem(q.id)
    }

    const guardStore = useSyncContextGuardStore(scenario.pinia)
    const initialGuard = await guardStore.check()
    expect(initialGuard.ok).toBe(true)
    expect(initialGuard.status).toBe('unbound')

    const pullStore = useSyncPullStore(scenario.pinia)
    const productStore = useProductStore(scenario.pinia)
    const transactionStore = useTransactionStore(scenario.pinia)
    const pushStore = useSyncPushStore(scenario.pinia)

    expect(productStore.products).toHaveLength(0)
    expect(await scenario.adapter.loadSyncPushBinding()).toBeNull()
    expect(await scenario.adapter.loadSyncPullBinding()).toBeNull()

    // ── 3. Press "Muat Data Cloud" (initialCloudRead = true) ──
    const initialPullResult = await pullStore.pullNow({ initialCloudRead: true })
    expect(initialPullResult.ok).toBe(true)
    expect(initialPullResult.applied).toBe(2)

    // Verify products appear in POS
    expect(productStore.products.some((p) => p.name === 'Kopi Susu Aren Gula Batu')).toBe(true)
    const posProduct = productStore.products.find((p) => p.name === 'Kopi Susu Aren Gula Batu')
    expect(posProduct.stock).toBe(45)

    // Context guard must refresh to 'safe'
    const refreshedGuard = await guardStore.check()
    expect(refreshedGuard.ok).toBe(true)
    expect(refreshedGuard.status).toBe('safe')

    // Pull binding must be durable with mode: 'cloud_first_read'
    const pullBinding = await scenario.adapter.loadSyncPullBinding()
    expect(pullBinding).toMatchObject({
      businessId,
      outletId,
      deviceIdentifier: devIdentifier,
      registeredDeviceId: deviceId,
      mode: 'cloud_first_read',
    })

    // Push binding is NOT yet created (no push has happened yet)
    expect(await scenario.adapter.loadSyncPushBinding()).toBeNull()

    // ── 4. Cashier makes an offline Cash transaction ──
    const saleTransaction = {
      id: 'trx-main-1',
      subtotal: 44000,
      tax: 0,
      total: 44000,
      paymentMethod: 'cash',
      amountPaid: 50000,
      change: 6000,
      customerName: 'Pelanggan Walk-in',
      createdAt: new Date().toISOString(),
      items: [
        {
          id: posProduct.id,
          productId: posProduct.id,
          name: posProduct.name,
          quantity: 2,
          qty: 2,
          price: posProduct.price,
          subtotal: 44000,
        },
      ],
    }
    await transactionStore.addTransaction(saleTransaction)
    await scenario.scheduler.flush()

    // Verify offline transaction saved & queue enqueued
    expect(transactionStore.items.length).toBeGreaterThanOrEqual(1)
    const queueItems = await scenario.adapter.listSyncQueueItems()
    expect(queueItems.length).toBeGreaterThanOrEqual(1)

    // ── 5. Push: "Sync Sekarang" ──
    const pushResult = await pushStore.pushNow()
    expect(pushResult.ok).toBe(true)
    expect(pushResult.sentQueueIds.length).toBeGreaterThan(0)
    expect(await scenario.adapter.listSyncQueueItems()).toHaveLength(0)

    // Verify push binding created with source: 'cloud_first_read'
    const pushBinding = await scenario.adapter.loadSyncPushBinding()
    expect(pushBinding).toMatchObject({
      businessId,
      outletId,
      deviceIdentifier: devIdentifier,
      registeredDeviceId: deviceId,
      source: 'cloud_first_read',
    })

    // Verify transaction reached server for the right business
    expect(scenario.fakeServer.db.sales.some((s) => Number(s.business_id) === businessId)).toBe(true)

    // ── 6. Restart application ──
    const restartedScenario = await restartAppScenario(scenario)
    mockServerHandler.handle = restartedScenario.fakeServer.handleRequest

    const restartedProductStore = useProductStore(restartedScenario.pinia)
    const restartedTransactionStore = useTransactionStore(restartedScenario.pinia)
    const restartedGuardStore = useSyncContextGuardStore(restartedScenario.pinia)
    const restartedPullStore = useSyncPullStore(restartedScenario.pinia)

    // Data, cursor, bindings, and transactions survive restart
    expect(restartedProductStore.products.some((p) => p.name === 'Kopi Susu Aren Gula Batu')).toBe(true)
    expect(restartedTransactionStore.items.length).toBeGreaterThanOrEqual(1)

    const restartedGuard = await restartedGuardStore.check()
    expect(restartedGuard.ok).toBe(true)
    expect(restartedGuard.status).toBe('safe')

    const pullState = await restartedScenario.adapter.loadSyncPullState()
    expect(pullState.cursor).toBeGreaterThan(0)

    // ── 7. Pull back changes from server without duplication ──
    const subsequentPull = await restartedPullStore.pullNow()
    expect(subsequentPull.ok).toBe(true)
    expect(restartedProductStore.products.filter((p) => p.name === 'Kopi Susu Aren Gula Batu')).toHaveLength(1)
  })

  it('Enforces role/capability: Cashier in cashier_safe mode can push transactions but restricted mutations are blocked', async () => {
    const scenario = await createOfflineOnlineScenario({
      businessMode: 'cloud',
      initialOnline: true,
    })
    mockServerHandler.handle = scenario.fakeServer.handleRequest

    const cloudContext = makeValidCloudContext({
      role: 'cashier',
      syncCapabilities: { push_mode: 'cashier_safe' },
      capabilityState: 'verified',
    })
    const cloudStore = useCloudSessionStore(scenario.pinia)
    cloudStore.$patch(cloudContext)
    await scenario.adapter.saveCloudContext(cloudContext)

    // Seed server product and initial pull
    const categorySyncId = '22222222-2222-4222-8222-222222222222'
    const productSyncId = '33333333-3333-4333-8333-333333333333'
    scenario.fakeServer.db.categories.push({
      sync_id: categorySyncId,
      name: 'Makanan',
      business_id: 10,
      sync_version: 1,
      sync_sequence: 1,
      is_active: 1,
    })
    scenario.fakeServer.db.products.push({
      sync_id: productSyncId,
      category_sync_id: categorySyncId,
      name: 'Roti Bakar Coklat',
      price: 15000,
      stock: 20,
      business_id: 10,
      sync_version: 1,
      sync_sequence: 2,
      is_active: 1,
    })

    // Clean sync queue
    const qItems = await scenario.adapter.listSyncQueueItems()
    for (const q of qItems) {
      await scenario.adapter.deleteSyncQueueItem(q.id)
    }

    const pullStore = useSyncPullStore(scenario.pinia)
    const pull = await pullStore.pullNow({ initialCloudRead: true })
    if (!pull.ok) {
      console.log('TEST 2 PULL FAILED:', JSON.stringify(pull, null, 2))
    }
    expect(pull.ok).toBe(true)

    // Cashier makes a valid sale for known server product
    const productStore = useProductStore(scenario.pinia)
    const posProduct = productStore.products.find((p) => p.name === 'Roti Bakar Coklat')
    expect(posProduct).toBeDefined()

    const transactionStore = useTransactionStore(scenario.pinia)
    await transactionStore.addTransaction({
      id: 'trx-cashier-1',
      subtotal: 15000,
      tax: 0,
      total: 15000,
      paymentMethod: 'cash',
      amountPaid: 20000,
      change: 5000,
      createdAt: new Date().toISOString(),
      items: [
        {
          id: posProduct.id,
          productId: posProduct.id,
          name: posProduct.name,
          quantity: 1,
          qty: 1,
          price: 15000,
          subtotal: 15000,
        },
      ],
    })
    await scenario.scheduler.flush()

    const pushStore = useSyncPushStore(scenario.pinia)
    const pushResult = await pushStore.pushNow()
    expect(pushResult.ok).toBe(true)
    expect(pushResult.sentQueueIds.length).toBeGreaterThan(0)

    // If cashier attempts to push a catalog modification directly in cashier_safe mode:
    const queueService = scenario.foundation.queueService
    await queueService.enqueueUpsert(SYNC_ENTITY_TYPES.PRODUCT, 'new-offline-prod', {
      id: 'new-offline-prod',
      name: 'Produk Kasir Ilegal',
      price: 5000,
    })

    const catalogPushResult = await pushStore.pushNow()
    expect(catalogPushResult.ok).toBe(true)
    // The unauthorized product mutation is restricted/deferred, not sent
    expect(catalogPushResult.restricted.length + catalogPushResult.blocked.length).toBeGreaterThan(0)
    expect(scenario.fakeServer.db.products.some((p) => p.name === 'Produk Kasir Ilegal')).toBe(false)
  })

  it('Blocks push for read-only or unpermitted roles with SYNC_PUSH_ROLE_DENIED', async () => {
    const scenario = await createOfflineOnlineScenario({
      businessMode: 'cloud',
      initialOnline: true,
    })
    mockServerHandler.handle = scenario.fakeServer.handleRequest

    const cloudContext = makeValidCloudContext({
      role: 'viewer',
      syncCapabilities: { push_mode: 'none' },
      capabilityState: 'verified',
    })
    const cloudStore = useCloudSessionStore(scenario.pinia)
    cloudStore.$patch(cloudContext)
    await scenario.adapter.saveCloudContext(cloudContext)

    await scenario.adapter.saveSyncPullBinding({
      businessId: 10,
      outletId: 101,
      deviceIdentifier: '123e4567-e89b-12d3-a456-426614174000',
      registeredDeviceId: 55,
      mode: 'cloud_first_read',
      boundAt: new Date().toISOString(),
    })
    await scenario.adapter.saveSyncPullState({
      version: 1,
      cursor: 1,
      serverSequence: 1,
      updatedAt: new Date().toISOString(),
    })
    await scenario.adapter.saveSyncServerVersions({})

    const queueService = scenario.foundation.queueService
    await queueService.enqueueUpsert(SYNC_ENTITY_TYPES.EXPENSE, 'exp-1', {
      id: 'exp-1',
      description: 'Beli ATK',
      amount: 15000,
    })

    const pushStore = useSyncPushStore(scenario.pinia)
    const result = await pushStore.pushNow()
    expect(result.ok).toBe(false)
    expect(result.code).toBe('SYNC_PUSH_ROLE_DENIED')
    expect(await scenario.adapter.loadSyncPushBinding()).toBeNull()
  })

  it('Blocks tenant mismatch between active context and pull/push bindings', async () => {
    const scenario = await createOfflineOnlineScenario({ businessMode: 'cloud', initialOnline: true })
    mockServerHandler.handle = scenario.fakeServer.handleRequest

    const cloudContext = makeValidCloudContext({
      selectedBusiness: { id: 10, name: 'Kedai Utama' },
      selectedOutlet: { id: 101, name: 'Outlet 101' },
      deviceIdentifier: '123e4567-e89b-12d3-a456-426614174000',
      registeredDeviceId: 55,
      role: 'owner',
      syncCapabilities: { push_mode: 'full' },
      capabilityState: 'verified',
    })
    const cloudStore = useCloudSessionStore(scenario.pinia)
    cloudStore.$patch(cloudContext)
    await scenario.adapter.saveCloudContext(cloudContext)

    // Binding bound to business 10, outlet 101
    await scenario.adapter.saveSyncPullBinding({
      businessId: 10,
      outletId: 101,
      deviceIdentifier: '123e4567-e89b-12d3-a456-426614174000',
      registeredDeviceId: 55,
      mode: 'cloud_first_read',
      boundAt: new Date().toISOString(),
    })
    await scenario.adapter.saveSyncPullState({
      version: 1,
      cursor: 1,
      serverSequence: 1,
      updatedAt: new Date().toISOString(),
    })
    await scenario.adapter.saveSyncServerVersions({})

    // Context changes to business 20 (tenant switch attempt)
    cloudStore.selectedBusiness = { id: 20, name: 'Cabang Baru' }

    const pushStore = useSyncPushStore(scenario.pinia)
    const push = await pushStore.pushNow()
    expect(push.ok).toBe(false)
    expect(push.code).toBe('SYNC_CONTEXT_GUARD_BLOCKED')
  })

  it('Retries failed push idempotently after network error without duplicating data', async () => {
    const scenario = await createOfflineOnlineScenario({ businessMode: 'cloud', initialOnline: true })
    mockServerHandler.handle = scenario.fakeServer.handleRequest

    const cloudContext = makeValidCloudContext({
      role: 'owner',
      syncCapabilities: { push_mode: 'full' },
      capabilityState: 'verified',
    })
    useCloudSessionStore(scenario.pinia).$patch(cloudContext)
    await scenario.adapter.saveCloudContext(cloudContext)

    await scenario.adapter.saveSyncPullBinding({
      businessId: 10,
      outletId: 101,
      deviceIdentifier: '123e4567-e89b-12d3-a456-426614174000',
      registeredDeviceId: 55,
      mode: 'cloud_first_read',
      boundAt: new Date().toISOString(),
    })
    await scenario.adapter.saveSyncPullState({
      version: 1,
      cursor: 1,
      serverSequence: 1,
      updatedAt: new Date().toISOString(),
    })
    await scenario.adapter.saveSyncServerVersions({})

    const queueService = scenario.foundation.queueService
    await queueService.enqueueUpsert(SYNC_ENTITY_TYPES.EXPENSE, 'exp-retry-1', {
      id: 'exp-retry-1',
      description: 'Beli Gas LPG',
      amount: 22000,
      occurred_at: new Date().toISOString(),
    })

    // Simulate transient failure during HTTP transmission
    let pushAttempts = 0
    mockServerHandler.handle = (path, options) => {
      if (path === '/api/sync/push') {
        pushAttempts++
        if (pushAttempts === 1) {
          return { ok: false, status: 500, error: { code: 'NETWORK_ERROR', message: 'Offline' } }
        }
        return { ok: true, status: 200, data: { data: { request_id: options.body.request_id, duplicate: false } } }
      }
      return { ok: false, status: 404 }
    }

    const pushStore = useSyncPushStore(scenario.pinia)
    const firstPush = await pushStore.pushNow()
    if (firstPush.ok) {
      console.log('TEST 5 FIRST PUSH UNEXPECTEDLY OK:', JSON.stringify(firstPush, null, 2))
    }
    expect(firstPush.ok).toBe(false)
    expect(await scenario.adapter.loadSyncPushInflight()).not.toBeNull()

    // Retry push succeeds idempotently
    const retryPush = await pushStore.pushNow()
    expect(retryPush.ok).toBe(true)
    expect(await scenario.adapter.loadSyncPushInflight()).toBeNull()
    expect(await scenario.adapter.listSyncQueueItems()).toHaveLength(0)
  })

  it('Blocks initial Cloud read when recovery journals (P38, restore, switch) are pending', async () => {
    const adapter = scenarioHelperAdapter()
    await adapter.initialize()

    // 1. Pending P38 local operation journal
    await adapter.saveLocalOperationJournal({
      version: 1,
      entries: [{ operationId: 'sale-1', status: 'pending' }],
    })
    let report = await inspectCloudFirstWorkspace({ adapter })
    expect(report.ok).toBe(true)
    expect(report.safeToInitialize).toBe(false)
    expect(report.reasons).toContain('local_operation_pending')

    // 2. Pending restore journal
    await adapter.saveLocalOperationJournal({ version: 1, entries: [] })
    await adapter.saveRestoreJournal({ version: 1, phase: 'applying' })
    report = await inspectCloudFirstWorkspace({ adapter })
    expect(report.safeToInitialize).toBe(false)
    expect(report.reasons).toContain('restore_journal_pending')

    // 3. Pending workspace switch journal
    await adapter.saveRestoreJournal({ version: 1, phase: 'committed' })
    await adapter.saveWorkspaceSwitchJournal({ version: 1, phase: 'applying' })
    report = await inspectCloudFirstWorkspace({ adapter })
    expect(report.safeToInitialize).toBe(false)
    expect(report.reasons).toContain('workspace_switch_pending')
  })

  it('Fails closed if saving push binding throws before HTTP transmission', async () => {
    const scenario = await createOfflineOnlineScenario({ businessMode: 'cloud', initialOnline: true })
    const cloudContext = makeValidCloudContext({
      role: 'owner',
      syncCapabilities: { push_mode: 'full' },
      capabilityState: 'verified',
    })
    useCloudSessionStore(scenario.pinia).$patch(cloudContext)
    await scenario.adapter.saveCloudContext(cloudContext)

    await scenario.adapter.saveSyncPullBinding({
      businessId: 10,
      outletId: 101,
      deviceIdentifier: '123e4567-e89b-12d3-a456-426614174000',
      registeredDeviceId: 55,
      mode: 'cloud_first_read',
      boundAt: new Date().toISOString(),
    })
    await scenario.adapter.saveSyncPullState({
      version: 1,
      cursor: 1,
      serverSequence: 1,
      updatedAt: new Date().toISOString(),
    })
    await scenario.adapter.saveSyncServerVersions({})

    await scenario.foundation.queueService.enqueueUpsert(SYNC_ENTITY_TYPES.CUSTOMER, 'cust-1', {
      id: 'cust-1',
      name: 'Budi',
    })

    const transport = vi.fn()
    scenario.adapter.saveSyncPushBinding = vi.fn().mockRejectedValue(new Error('SQLite locked'))

    const pushService = scenario.foundation.pushService
    const result = await pushService.pushNow({
      context: cloudContext,
      transport,
    })

    expect(result.ok).toBe(false)
    expect(result.code).toBe('SYNC_BINDING_PERSIST_FAILED')
    expect(transport).not.toHaveBeenCalled()
  })

  it('Allows push on first transaction even after restart between initial pull and first push', async () => {
    const scenario = await createOfflineOnlineScenario({ businessMode: 'cloud', initialOnline: true })
    mockServerHandler.handle = scenario.fakeServer.handleRequest

    const cloudContext = makeValidCloudContext({
      role: 'owner',
      syncCapabilities: { push_mode: 'full' },
      capabilityState: 'verified',
    })
    useCloudSessionStore(scenario.pinia).$patch(cloudContext)
    await scenario.adapter.saveCloudContext(cloudContext)
    await scenario.adapter.saveDeviceIdentifier(cloudContext.deviceIdentifier)
    await saveToken('mock-bearer-token-123')

    // Populate server catalog
    const categorySyncId = '55555555-5555-4555-8555-555555555555'
    scenario.fakeServer.db.categories.push({
      sync_id: categorySyncId,
      name: 'Minuman',
      business_id: 10,
      sync_version: 1,
      sync_sequence: 1,
      is_active: 1,
    })
    scenario.fakeServer.db.products.push({
      sync_id: '44444444-4444-4444-8444-444444444444',
      category_sync_id: categorySyncId,
      name: 'Teh Tarik',
      price: 12000,
      stock: 10,
      business_id: 10,
      sync_version: 1,
      sync_sequence: 2,
      is_active: 1,
    })

    // Clean sync queue
    const qItems = await scenario.adapter.listSyncQueueItems()
    for (const q of qItems) {
      await scenario.adapter.deleteSyncQueueItem(q.id)
    }

    // Initial pull
    const pullStore = useSyncPullStore(scenario.pinia)
    const pull = await pullStore.pullNow({ initialCloudRead: true })
    expect(pull.ok).toBe(true)
    expect(await scenario.adapter.loadSyncPushBinding()).toBeNull()

    // Restart app BEFORE first transaction
    const restarted = await restartAppScenario(scenario)
    mockServerHandler.handle = restarted.fakeServer.handleRequest

    const productStore = useProductStore(restarted.pinia)
    const transactionStore = useTransactionStore(restarted.pinia)
    const pushStore = useSyncPushStore(restarted.pinia)

    const product = productStore.products.find((p) => p.name === 'Teh Tarik')
    expect(product).toBeDefined()

    // Make transaction in restarted app
    await transactionStore.addTransaction({
      id: 'trx-restarted-1',
      subtotal: 12000,
      tax: 0,
      total: 12000,
      paymentMethod: 'cash',
      amountPaid: 15000,
      change: 3000,
      createdAt: new Date().toISOString(),
      items: [
        {
          id: product.id,
          productId: product.id,
          name: product.name,
          quantity: 1,
          qty: 1,
          price: 12000,
          subtotal: 12000,
        },
      ],
    })
    await restarted.scheduler.flush()

    // Push first transaction
    const push = await pushStore.pushNow()
    expect(push.ok).toBe(true)

    // Push binding was safely created
    const pushBinding = await restarted.adapter.loadSyncPushBinding()
    expect(pushBinding).toMatchObject({
      businessId: 10,
      outletId: 101,
      source: 'cloud_first_read',
    })
    expect(await restarted.adapter.listSyncQueueItems()).toHaveLength(0)
  })
})

function scenarioHelperAdapter() {
  return createMemoryAdapter()
}
