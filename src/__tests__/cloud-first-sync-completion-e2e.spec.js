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
import { createSyncContextGuardService } from '@/services/sync/syncContextGuardService'
import { resolveCloudFirstPushReadiness } from '@/services/sync/syncPushService'

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

  it('allows initial Cloud pull with valid Auto Sync enabled/disabled preference and blocks mismatched or corrupt preferences', async () => {
    // 1. Valid Auto Sync enabled -> pull succeeds
    const scenarioEnabled = await createOfflineOnlineScenario({ businessMode: 'cloud', initialOnline: true })
    mockServerHandler.handle = scenarioEnabled.fakeServer.handleRequest

    const cloudContext = makeValidCloudContext({
      role: 'owner',
      syncCapabilities: { push_mode: 'full' },
      capabilityState: 'verified',
    })
    useCloudSessionStore(scenarioEnabled.pinia).$patch(cloudContext)
    await scenarioEnabled.adapter.saveCloudContext(cloudContext)
    await scenarioEnabled.adapter.saveDeviceIdentifier(cloudContext.deviceIdentifier)
    await saveToken('mock-bearer-token-123')

    const categorySyncId = '77777777-7777-4777-8777-777777777777'
    scenarioEnabled.fakeServer.db.categories.push({
      sync_id: categorySyncId,
      name: 'Makanan',
      business_id: 10,
      sync_version: 1,
      sync_sequence: 1,
      is_active: 1,
    })
    scenarioEnabled.fakeServer.db.products.push({
      sync_id: '88888888-8888-4888-8888-888888888888',
      category_sync_id: categorySyncId,
      name: 'Nasi Goreng Spesial',
      price: 25000,
      stock: 15,
      business_id: 10,
      sync_version: 1,
      sync_sequence: 2,
      is_active: 1,
    })

    await scenarioEnabled.adapter.saveSyncAutoSettings({
      version: 1,
      enabled: true,
      context: {
        businessId: 10,
        outletId: 101,
        registeredDeviceId: 55,
        deviceIdentifier: cloudContext.deviceIdentifier,
      },
      updatedAt: new Date().toISOString(),
    })

    const pullStoreEnabled = useSyncPullStore(scenarioEnabled.pinia)
    const pullEnabled = await pullStoreEnabled.pullNow({ initialCloudRead: true })
    expect(pullEnabled.ok).toBe(true)

    const productStore = useProductStore(scenarioEnabled.pinia)
    expect(productStore.products.some((p) => p.name === 'Nasi Goreng Spesial')).toBe(true)

    // Verify autoSettings was preserved and not deleted
    const preservedSettings = await scenarioEnabled.adapter.loadSyncAutoSettings()
    expect(preservedSettings).toMatchObject({
      version: 1,
      enabled: true,
      context: {
        businessId: 10,
        outletId: 101,
      },
    })

    // Restart preserves preferences and pull binding
    const restarted = await restartAppScenario(scenarioEnabled)
    const restartedSettings = await restarted.adapter.loadSyncAutoSettings()
    expect(restartedSettings.enabled).toBe(true)
    const restartedPullBinding = await restarted.adapter.loadSyncPullBinding()
    expect(restartedPullBinding.mode).toBe('cloud_first_read')

    // 2. Foreign business Auto Sync preference -> blocked
    const scenarioForeign = await createOfflineOnlineScenario({ businessMode: 'cloud', initialOnline: true })
    mockServerHandler.handle = scenarioForeign.fakeServer.handleRequest
    useCloudSessionStore(scenarioForeign.pinia).$patch(cloudContext)
    await scenarioForeign.adapter.saveCloudContext(cloudContext)
    await scenarioForeign.adapter.saveDeviceIdentifier(cloudContext.deviceIdentifier)
    await saveToken('mock-bearer-token-123')

    await scenarioForeign.adapter.saveSyncAutoSettings({
      version: 1,
      enabled: true,
      context: {
        businessId: 999,
        outletId: 101,
        registeredDeviceId: 55,
        deviceIdentifier: cloudContext.deviceIdentifier,
      },
      updatedAt: new Date().toISOString(),
    })

    const reportForeign = await inspectCloudFirstWorkspace({
      adapter: scenarioForeign.adapter,
      context: cloudContext,
    })
    expect(reportForeign.ok).toBe(true)
    expect(reportForeign.safeToInitialize).toBe(false)
    expect(reportForeign.reasons).toContain('auto_sync_context_mismatch')

    const pullStoreForeign = useSyncPullStore(scenarioForeign.pinia)
    const pullForeign = await pullStoreForeign.pullNow({ initialCloudRead: true })
    expect(pullForeign.ok).toBe(false)
    expect(['SYNC_CONTEXT_GUARD_BLOCKED', 'CLOUD_INITIALIZATION_WORKSPACE_NOT_EMPTY']).toContain(
      pullForeign.code,
    )

    // 3. Corrupt Auto Sync preference -> fail-closed
    const scenarioCorrupt = await createOfflineOnlineScenario({ businessMode: 'cloud', initialOnline: true })
    mockServerHandler.handle = scenarioCorrupt.fakeServer.handleRequest
    useCloudSessionStore(scenarioCorrupt.pinia).$patch(cloudContext)
    await scenarioCorrupt.adapter.saveCloudContext(cloudContext)
    await scenarioCorrupt.adapter.saveDeviceIdentifier(cloudContext.deviceIdentifier)
    await saveToken('mock-bearer-token-123')

    await scenarioCorrupt.adapter.saveSyncAutoSettings({
      version: 2,
      enabled: 'not-a-bool',
    })

    const reportCorrupt = await inspectCloudFirstWorkspace({
      adapter: scenarioCorrupt.adapter,
      context: cloudContext,
    })
    expect(reportCorrupt.ok).toBe(true)
    expect(reportCorrupt.safeToInitialize).toBe(false)
    expect(reportCorrupt.reasons).toContain('auto_sync_settings_invalid')

    const pullStoreCorrupt = useSyncPullStore(scenarioCorrupt.pinia)
    const pullCorrupt = await pullStoreCorrupt.pullNow({ initialCloudRead: true })
    expect(pullCorrupt.ok).toBe(false)
    expect(['SYNC_CONTEXT_GUARD_BLOCKED', 'CLOUD_INITIALIZATION_WORKSPACE_NOT_EMPTY']).toContain(
      pullCorrupt.code,
    )
  })

  // ══════════════════════════════════════════════════════════════════════════
  // P1 Cloud Initialization Data Integrity (PR #60 Two-Finding Fix)
  // ══════════════════════════════════════════════════════════════════════════

  it('1. Initial pull fails on network offline and leaves binding incomplete with no cursor advance', async () => {
    const scenario = await createOfflineOnlineScenario({ businessMode: 'cloud', initialOnline: true })
    mockServerHandler.handle = async () => ({
      ok: false,
      status: 503,
      error: { code: 'NETWORK_OFFLINE', message: 'Failed to reach cloud endpoint' },
    })

    const cloudContext = makeValidCloudContext({ role: 'owner', syncCapabilities: { push_mode: 'full' } })
    useCloudSessionStore(scenario.pinia).$patch(cloudContext)
    await scenario.adapter.saveCloudContext(cloudContext)
    await scenario.adapter.saveDeviceIdentifier(cloudContext.deviceIdentifier)

    const pullStore = useSyncPullStore(scenario.pinia)
    const result = await pullStore.pullNow({ initialCloudRead: true })

    expect(result.ok).toBe(false)
    expect(result.code).toBe('NETWORK_OFFLINE')

    const pullBinding = await scenario.adapter.loadSyncPullBinding()
    expect(pullBinding?.status).toBe('initializing')
    expect(pullBinding?.status).not.toBe('completed')
    expect(await scenario.adapter.loadSyncPullState()).toBeNull()
  })

  it('2. Initial pull fails on malformed response without marking binding completed', async () => {
    const scenario = await createOfflineOnlineScenario({ businessMode: 'cloud', initialOnline: true })
    mockServerHandler.handle = async () => ({
      ok: true,
      status: 200,
      data: {
        data: {
          records: 'invalid-not-array',
          next_cursor: 1,
          server_sequence: 1,
          has_more: false,
        },
      },
    })

    const cloudContext = makeValidCloudContext({ role: 'owner', syncCapabilities: { push_mode: 'full' } })
    useCloudSessionStore(scenario.pinia).$patch(cloudContext)
    await scenario.adapter.saveCloudContext(cloudContext)
    await scenario.adapter.saveDeviceIdentifier(cloudContext.deviceIdentifier)

    const pullStore = useSyncPullStore(scenario.pinia)
    const result = await pullStore.pullNow({ initialCloudRead: true })

    expect(result.ok).toBe(false)
    expect(result.code).toBe('INVALID_PULL_RESPONSE')

    const pullBinding = await scenario.adapter.loadSyncPullBinding()
    expect(pullBinding?.status).toBe('initializing')
    expect(await scenario.adapter.loadSyncPullState()).toBeNull()
  })

  it('3. Crash after preflight before download leaves unfinished binding and blocks push', async () => {
    const scenario = await createOfflineOnlineScenario({ businessMode: 'cloud', initialOnline: true })
    const cloudContext = makeValidCloudContext({ role: 'owner', syncCapabilities: { push_mode: 'full' } })
    useCloudSessionStore(scenario.pinia).$patch(cloudContext)
    await scenario.adapter.saveCloudContext(cloudContext)
    await scenario.adapter.saveDeviceIdentifier(cloudContext.deviceIdentifier)

    // Simulate crash after saving preflight journal and initializing binding
    await scenario.adapter.saveCloudInitializationJournal({
      version: 1,
      phase: 'initializing',
      businessId: 10,
      outletId: 101,
      deviceIdentifier: cloudContext.deviceIdentifier,
      registeredDeviceId: 55,
      startedAt: new Date().toISOString(),
      completedAt: null,
      updatedAt: new Date().toISOString(),
    })
    await scenario.adapter.saveSyncPullBinding({
      businessId: 10,
      outletId: 101,
      deviceIdentifier: cloudContext.deviceIdentifier,
      registeredDeviceId: 55,
      boundAt: new Date().toISOString(),
      mode: 'cloud_first_read',
      status: 'initializing',
    })

    const guardService = createSyncContextGuardService({ adapter: scenario.adapter })
    const guardReport = await guardService.inspect({ context: cloudContext })
    expect(guardReport.status).toBe('unbound')
    expect(guardReport.status).not.toBe('safe')

    const pushReadiness = await resolveCloudFirstPushReadiness({
      adapter: scenario.adapter,
      context: {
        businessId: 10,
        outletId: 101,
        deviceIdentifier: cloudContext.deviceIdentifier,
        registeredDeviceId: 55,
      },
    })
    expect(pushReadiness.ok).toBe(false)
    expect(pushReadiness.code).toBe('CLOUD_FIRST_INITIALIZATION_INCOMPLETE')
  })

  it('4. Crash after partial data applied leaves unfinished binding that is not safe', async () => {
    const scenario = await createOfflineOnlineScenario({ businessMode: 'cloud', initialOnline: true })
    const cloudContext = makeValidCloudContext({ role: 'owner', syncCapabilities: { push_mode: 'full' } })
    useCloudSessionStore(scenario.pinia).$patch(cloudContext)
    await scenario.adapter.saveCloudContext(cloudContext)
    await scenario.adapter.saveDeviceIdentifier(cloudContext.deviceIdentifier)

    // Simulate partial products applied before crash
    const prodUuid = '22222222-2222-4222-8222-222222222222'
    await scenario.adapter.saveProducts(
      [{ id: prodUuid, name: 'Espresso', price: 18000, category: 'Minuman' }],
      ['Minuman'],
    )
    await scenario.adapter.saveCloudInitializationJournal({
      version: 1,
      phase: 'initializing',
      businessId: 10,
      outletId: 101,
      deviceIdentifier: cloudContext.deviceIdentifier,
      registeredDeviceId: 55,
      startedAt: new Date().toISOString(),
      completedAt: null,
      updatedAt: new Date().toISOString(),
    })
    await scenario.adapter.saveSyncPullBinding({
      businessId: 10,
      outletId: 101,
      deviceIdentifier: cloudContext.deviceIdentifier,
      registeredDeviceId: 55,
      boundAt: new Date().toISOString(),
      mode: 'cloud_first_read',
      status: 'initializing',
    })

    const guardService = createSyncContextGuardService({ adapter: scenario.adapter })
    const guardReport = await guardService.inspect({ context: cloudContext })
    expect(guardReport.status).toBe('unbound')
    expect(guardReport.status).not.toBe('safe')
  })

  it('5 & 6. Restart with initialization journal pending does not treat unfinished binding as safe', async () => {
    const scenario = await createOfflineOnlineScenario({ businessMode: 'cloud', initialOnline: true })
    const cloudContext = makeValidCloudContext({ role: 'owner', syncCapabilities: { push_mode: 'full' } })
    useCloudSessionStore(scenario.pinia).$patch(cloudContext)
    await scenario.adapter.saveCloudContext(cloudContext)
    await scenario.adapter.saveDeviceIdentifier(cloudContext.deviceIdentifier)

    await scenario.adapter.saveCloudInitializationJournal({
      version: 1,
      phase: 'initializing',
      businessId: 10,
      outletId: 101,
      deviceIdentifier: cloudContext.deviceIdentifier,
      registeredDeviceId: 55,
      startedAt: new Date().toISOString(),
      completedAt: null,
      updatedAt: new Date().toISOString(),
    })
    await scenario.adapter.saveSyncPullBinding({
      businessId: 10,
      outletId: 101,
      deviceIdentifier: cloudContext.deviceIdentifier,
      registeredDeviceId: 55,
      boundAt: new Date().toISOString(),
      mode: 'cloud_first_read',
      status: 'initializing',
    })

    // Restart app
    const restarted = await restartAppScenario(scenario)
    const journalAfterRestart = await restarted.adapter.loadCloudInitializationJournal()
    expect(journalAfterRestart).toMatchObject({
      version: 1,
      phase: 'initializing',
      businessId: 10,
    })

    const guardService = createSyncContextGuardService({ adapter: restarted.adapter })
    const guardReport = await guardService.inspect({ context: cloudContext })
    expect(guardReport.status).not.toBe('safe')
    expect(guardReport.status).toBe('unbound')
  })

  it('7. Initial pull retry succeeds after interruption without duplicating products', async () => {
    const scenario = await createOfflineOnlineScenario({ businessMode: 'cloud', initialOnline: true })
    mockServerHandler.handle = scenario.fakeServer.handleRequest

    const cloudContext = makeValidCloudContext({ role: 'owner', syncCapabilities: { push_mode: 'full' } })
    useCloudSessionStore(scenario.pinia).$patch(cloudContext)
    await scenario.adapter.saveCloudContext(cloudContext)
    await scenario.adapter.saveDeviceIdentifier(cloudContext.deviceIdentifier)

    const catUuid = '33333333-3333-4333-8333-333333333333'
    const prodUuid = '44444444-4444-4444-8444-444444444444'
    scenario.fakeServer.db.categories.push({
      sync_id: catUuid,
      name: 'Makanan',
      business_id: 10,
      sync_version: 1,
      sync_sequence: 1,
      is_active: 1,
    })
    scenario.fakeServer.db.products.push({
      sync_id: prodUuid,
      category_sync_id: catUuid,
      name: 'Nasi Goreng',
      price: 20000,
      stock: 10,
      business_id: 10,
      sync_version: 1,
      sync_sequence: 2,
      is_active: 1,
    })

    // Pre-populate partial product from an interrupted attempt
    await scenario.adapter.saveProducts(
      [{ id: prodUuid, name: 'Nasi Goreng', price: 20000, category: 'Makanan' }],
      ['Makanan'],
    )
    await scenario.adapter.saveCloudInitializationJournal({
      version: 1,
      phase: 'initializing',
      businessId: 10,
      outletId: 101,
      deviceIdentifier: cloudContext.deviceIdentifier,
      registeredDeviceId: 55,
      startedAt: new Date().toISOString(),
      completedAt: null,
      updatedAt: new Date().toISOString(),
    })
    await scenario.adapter.saveSyncPullBinding({
      businessId: 10,
      outletId: 101,
      deviceIdentifier: cloudContext.deviceIdentifier,
      registeredDeviceId: 55,
      boundAt: new Date().toISOString(),
      mode: 'cloud_first_read',
      status: 'initializing',
    })

    // Retry initial pull
    const pullStore = useSyncPullStore(scenario.pinia)
    const retryResult = await pullStore.pullNow({ initialCloudRead: true })
    expect(retryResult.ok).toBe(true)

    const productStore = useProductStore(scenario.pinia)
    const matchingProducts = productStore.products.filter((p) => p.name === 'Nasi Goreng')
    expect(matchingProducts).toHaveLength(1)

    const pullBinding = await scenario.adapter.loadSyncPullBinding()
    expect(pullBinding.status).toBe('completed')

    const journal = await scenario.adapter.loadCloudInitializationJournal()
    expect(journal.phase).toBe('completed')
  })

  it('8. New local operational data blocks initial pull recovery and prevents silent mixing', async () => {
    const scenario = await createOfflineOnlineScenario({ businessMode: 'cloud', initialOnline: true })
    mockServerHandler.handle = scenario.fakeServer.handleRequest

    const cloudContext = makeValidCloudContext({ role: 'owner', syncCapabilities: { push_mode: 'full' } })
    useCloudSessionStore(scenario.pinia).$patch(cloudContext)
    await scenario.adapter.saveCloudContext(cloudContext)
    await scenario.adapter.saveDeviceIdentifier(cloudContext.deviceIdentifier)

    // Simulate interrupted state
    await scenario.adapter.saveCloudInitializationJournal({
      version: 1,
      phase: 'initializing',
      businessId: 10,
      outletId: 101,
      deviceIdentifier: cloudContext.deviceIdentifier,
      registeredDeviceId: 55,
      startedAt: new Date().toISOString(),
      completedAt: null,
      updatedAt: new Date().toISOString(),
    })
    await scenario.adapter.saveSyncPullBinding({
      businessId: 10,
      outletId: 101,
      deviceIdentifier: cloudContext.deviceIdentifier,
      registeredDeviceId: 55,
      boundAt: new Date().toISOString(),
      mode: 'cloud_first_read',
      status: 'initializing',
    })

    // User created local transaction before retry
    const transactionStore = useTransactionStore(scenario.pinia)
    transactionStore.items = [
      { id: 'local-trx-999', total: 75000, items: [] },
    ]
    await scenario.adapter.saveTransactions([
      { id: 'local-trx-999', total: 75000, items: [] },
    ])

    const pullStore = useSyncPullStore(scenario.pinia)
    const retryResult = await pullStore.pullNow({ initialCloudRead: true })

    expect(retryResult.ok).toBe(false)
    expect(retryResult.code).toBe('CLOUD_INITIALIZATION_WORKSPACE_NOT_EMPTY')

    // Local transaction remains completely intact
    const remainingTrx = await scenario.adapter.loadTransactions()
    expect(remainingTrx).toHaveLength(1)
    expect(remainingTrx[0].id).toBe('local-trx-999')
  })

  it('9. Empty pull fails if saveSyncServerVersions throws and cursor does not advance', async () => {
    const scenario = await createOfflineOnlineScenario({ businessMode: 'cloud', initialOnline: true })
    mockServerHandler.handle = async () => ({
      ok: true,
      status: 200,
      data: {
        data: {
          records: [],
          next_cursor: 0,
          server_sequence: 0,
          has_more: false,
        },
      },
    })

    const cloudContext = makeValidCloudContext({ role: 'owner', syncCapabilities: { push_mode: 'full' } })
    useCloudSessionStore(scenario.pinia).$patch(cloudContext)
    await scenario.adapter.saveCloudContext(cloudContext)
    await scenario.adapter.saveDeviceIdentifier(cloudContext.deviceIdentifier)

    // Inject saveSyncServerVersions failure
    scenario.adapter.saveSyncServerVersions = async () => {
      throw new Error('SQLite disk I/O write error on server versions')
    }

    const pullStore = useSyncPullStore(scenario.pinia)
    const result = await pullStore.pullNow({ initialCloudRead: true })

    expect(result.ok).toBe(false)
    expect(result.code).toBe('SYNC_SERVER_VERSIONS_PERSIST_FAILED')

    expect(await scenario.adapter.loadSyncPullState()).toBeNull()
    const pullBinding = await scenario.adapter.loadSyncPullBinding()
    expect(pullBinding?.status).not.toBe('completed')
  })

  it('10. Empty pull with positive server sequence stores valid version map before completed state', async () => {
    const scenario = await createOfflineOnlineScenario({ businessMode: 'cloud', initialOnline: true })
    mockServerHandler.handle = async () => ({
      ok: true,
      status: 200,
      data: {
        data: {
          records: [],
          next_cursor: 12,
          server_sequence: 12,
          has_more: false,
        },
      },
    })

    const cloudContext = makeValidCloudContext({ role: 'owner', syncCapabilities: { push_mode: 'full' } })
    useCloudSessionStore(scenario.pinia).$patch(cloudContext)
    await scenario.adapter.saveCloudContext(cloudContext)
    await scenario.adapter.saveDeviceIdentifier(cloudContext.deviceIdentifier)

    const pullStore = useSyncPullStore(scenario.pinia)
    const result = await pullStore.pullNow({ initialCloudRead: true })

    expect(result.ok).toBe(true)
    const versions = await scenario.adapter.loadSyncServerVersions()
    expect(versions).toEqual({})

    const pullState = await scenario.adapter.loadSyncPullState()
    expect(pullState.serverSequence).toBe(12)
    expect(pullState.cursor).toBe(12)

    const pullBinding = await scenario.adapter.loadSyncPullBinding()
    expect(pullBinding.status).toBe('completed')

    const readiness = await resolveCloudFirstPushReadiness({
      adapter: scenario.adapter,
      context: {
        businessId: 10,
        outletId: 101,
        deviceIdentifier: cloudContext.deviceIdentifier,
        registeredDeviceId: 55,
      },
    })
    expect(readiness.ok).toBe(true)
    expect(readiness.cloudFirst).toBe(true)
  })

  it('11. Non-empty pull fails and does not advance cursor if server versions persistence fails', async () => {
    const scenario = await createOfflineOnlineScenario({ businessMode: 'cloud', initialOnline: true })
    const catUuid = '55555555-5555-4555-8555-555555555555'
    scenario.fakeServer.db.categories.push({
      sync_id: catUuid,
      name: 'Camilan',
      business_id: 10,
      sync_version: 1,
      sync_sequence: 1,
      is_active: 1,
    })
    mockServerHandler.handle = scenario.fakeServer.handleRequest

    const cloudContext = makeValidCloudContext({ role: 'owner', syncCapabilities: { push_mode: 'full' } })
    useCloudSessionStore(scenario.pinia).$patch(cloudContext)
    await scenario.adapter.saveCloudContext(cloudContext)
    await scenario.adapter.saveDeviceIdentifier(cloudContext.deviceIdentifier)

    scenario.adapter.saveSyncServerVersions = async () => {
      throw new Error('SQLite write fault')
    }

    const pullStore = useSyncPullStore(scenario.pinia)
    const result = await pullStore.pullNow({ initialCloudRead: true })

    expect(result.ok).toBe(false)
    expect(result.code).toBe('SYNC_SERVER_VERSIONS_PERSIST_FAILED')
    expect(await scenario.adapter.loadSyncPullState()).toBeNull()
  })

  it('12 & 13. Push is blocked before initialization completed and succeeds after completion', async () => {
    const scenario = await createOfflineOnlineScenario({ businessMode: 'cloud', initialOnline: true })
    mockServerHandler.handle = scenario.fakeServer.handleRequest

    const cloudContext = makeValidCloudContext({ role: 'owner', syncCapabilities: { push_mode: 'full' } })
    useCloudSessionStore(scenario.pinia).$patch(cloudContext)
    await scenario.adapter.saveCloudContext(cloudContext)
    await scenario.adapter.saveDeviceIdentifier(cloudContext.deviceIdentifier)

    // Unfinished binding
    await scenario.adapter.saveSyncPullBinding({
      businessId: 10,
      outletId: 101,
      deviceIdentifier: cloudContext.deviceIdentifier,
      registeredDeviceId: 55,
      boundAt: new Date().toISOString(),
      mode: 'cloud_first_read',
      status: 'initializing',
    })
    await scenario.foundation.queueService.enqueueUpsert(SYNC_ENTITY_TYPES.CUSTOMER, 'c-test-1', {
      id: 'c-test-1',
      name: 'Budi',
    })

    const pushStore = useSyncPushStore(scenario.pinia)
    const pushBlocked = await pushStore.pushNow()
    expect(pushBlocked.ok).toBe(false)
    expect(pushBlocked.code).toBe('SYNC_CLOUD_FIRST_NOT_READY')
    expect(await scenario.adapter.listSyncQueueItems()).toHaveLength(1)

    // Complete initial pull
    const catUuid = '66666666-6666-4666-8666-666666666666'
    scenario.fakeServer.db.categories.push({
      sync_id: catUuid,
      name: 'Minuman',
      business_id: 10,
      sync_version: 1,
      sync_sequence: 1,
      is_active: 1,
    })

    // Clear outbox queue temporarily to allow clean pull
    await scenario.adapter.replaceSyncQueueItems([])
    const pullStore = useSyncPullStore(scenario.pinia)
    const pullResult = await pullStore.pullNow({ initialCloudRead: true })
    expect(pullResult.ok).toBe(true)

    // Re-queue customer and push
    await scenario.foundation.queueService.enqueueUpsert(SYNC_ENTITY_TYPES.CUSTOMER, 'c-test-1', {
      id: 'c-test-1',
      name: 'Budi',
    })
    const pushSuccess = await pushStore.pushNow()
    expect(pushSuccess.ok).toBe(true)
    expect(await scenario.adapter.listSyncQueueItems()).toHaveLength(0)
  })

  it('14. Initial pull fails if saveCloudInitializationJournal completion throws and leaves binding incomplete', async () => {
    const scenario = await createOfflineOnlineScenario({ businessMode: 'cloud', initialOnline: true })
    const catUuid = '11111111-2222-4333-8444-555555555555'
    const prodUuid = '99999999-9999-4999-8999-999999999999'
    scenario.fakeServer.db.categories.push({
      sync_id: catUuid,
      name: 'Minuman',
      business_id: 10,
      sync_version: 1,
      sync_sequence: 1,
      is_active: 1,
    })
    scenario.fakeServer.db.products.push({
      sync_id: prodUuid,
      category_sync_id: catUuid,
      name: 'Kopi Tubruk',
      price: 10000,
      business_id: 10,
      sync_version: 1,
      sync_sequence: 2,
      is_active: 1,
    })
    mockServerHandler.handle = scenario.fakeServer.handleRequest

    const cloudContext = makeValidCloudContext({ role: 'owner', syncCapabilities: { push_mode: 'full' } })
    useCloudSessionStore(scenario.pinia).$patch(cloudContext)
    await scenario.adapter.saveCloudContext(cloudContext)
    await scenario.adapter.saveDeviceIdentifier(cloudContext.deviceIdentifier)

    const originalSaveJournal = scenario.adapter.saveCloudInitializationJournal.bind(scenario.adapter)
    scenario.adapter.saveCloudInitializationJournal = async (journal) => {
      if (journal.phase === 'completed') {
        throw new Error('SQLite disk I/O error on journal completion')
      }
      return originalSaveJournal(journal)
    }

    const pullStore = useSyncPullStore(scenario.pinia)
    const result = await pullStore.pullNow({ initialCloudRead: true })

    expect(result.ok).toBe(false)
    expect(result.code).toBe('CLOUD_INITIALIZATION_JOURNAL_PERSIST_FAILED')

    // Binding must NOT be marked completed
    const pullBinding = await scenario.adapter.loadSyncPullBinding()
    expect(pullBinding?.status).toBe('initializing')

    // Context guard stays unbound
    const guardService = createSyncContextGuardService({ adapter: scenario.adapter })
    const guardReport = await guardService.inspect({ context: cloudContext })
    expect(guardReport.status).toBe('unbound')

    // Restore normal journal save and retry
    scenario.adapter.saveCloudInitializationJournal = originalSaveJournal
    const retryResult = await pullStore.pullNow({ initialCloudRead: true })
    expect(retryResult.ok).toBe(true)

    const finalBinding = await scenario.adapter.loadSyncPullBinding()
    expect(finalBinding?.status).toBe('completed')

    const productStore = useProductStore(scenario.pinia)
    const matching = productStore.products.filter((p) => p.name === 'Kopi Tubruk')
    expect(matching).toHaveLength(1)
  })

  it('15. Interrupted initial pull containing sales/transactions safely recovers and completes without being blocked by already-pulled remote transactions', async () => {
    const scenario = await createOfflineOnlineScenario({ businessMode: 'cloud', initialOnline: true })
    const catUuid = '550e8400-e29b-41d4-a716-446655440001'
    const prodUuid = '550e8400-e29b-41d4-a716-446655440002'
    const saleUuid = '550e8400-e29b-41d4-a716-446655440003'
    const itemUuid = '550e8400-e29b-41d4-a716-446655440004'

    const cloudPayload = {
      records: [
        {
          entity: 'categories',
          sync_sequence: 1,
          data: {
            sync_id: catUuid,
            name: 'Minuman Cloud',
            sync_version: 1,
          },
        },
        {
          entity: 'products',
          sync_sequence: 2,
          data: {
            sync_id: prodUuid,
            name: 'Kopi Susu Cloud',
            category_sync_id: catUuid,
            price: 18000,
            cost: 8000,
            stock: 10,
            status: 'active',
            sync_version: 1,
          },
        },
        {
          entity: 'sales',
          sync_sequence: 3,
          data: {
            sync_id: saleUuid,
            sync_version: 1,
            transaction_number: 'INV-20261018-001',
            status: 'paid',
            payment_status: 'paid',
            subtotal: 18000,
            tax_amount: 0,
            total_amount: 18000,
            sold_at: '2026-10-18T10:00:00Z',
          },
        },
        {
          entity: 'sale_items',
          sync_sequence: 4,
          data: {
            sync_id: itemUuid,
            sync_version: 1,
            sale_sync_id: saleUuid,
            product_sync_id: prodUuid,
            product_name: 'Kopi Susu Cloud',
            unit_price: 18000,
            quantity: 1,
            cost_snapshot: 8000,
            line_cost: 8000,
          },
        },
      ],
      next_cursor: 4,
      server_sequence: 4,
      has_more: false,
    }

    mockServerHandler.handle = async () => ({
      ok: true,
      status: 200,
      data: { data: cloudPayload },
    })

    const cloudContext = makeValidCloudContext({ role: 'owner', syncCapabilities: { push_mode: 'full' } })
    useCloudSessionStore(scenario.pinia).$patch(cloudContext)
    await scenario.adapter.saveCloudContext(cloudContext)

    // Simulate failure during metadata persistence AFTER scheduler.flush() has already persisted transactions
    const originalSaveVersions = scenario.adapter.saveSyncServerVersions.bind(scenario.adapter)
    let shouldFailVersions = true
    scenario.adapter.saveSyncServerVersions = async (versions) => {
      if (shouldFailVersions) {
        throw new Error('Simulated write failure while persisting server versions')
      }
      return originalSaveVersions(versions)
    }

    const pullStore = useSyncPullStore(scenario.pinia)
    const firstResult = await pullStore.pullNow({ initialCloudRead: true })

    expect(firstResult.ok).toBe(false)
    expect(firstResult.code).toBe('SYNC_SERVER_VERSIONS_PERSIST_FAILED')

    // Transactions were flushed and are durable in SQLite
    const storedTrx = await scenario.adapter.loadTransactions()
    expect(storedTrx).toHaveLength(1)
    expect(storedTrx[0].id).toBe(saleUuid)

    // Binding remains in initializing phase
    const pullBinding = await scenario.adapter.loadSyncPullBinding()
    expect(pullBinding?.status).toBe('initializing')

    // Context guard reports device unbound
    const guardService = createSyncContextGuardService({ adapter: scenario.adapter })
    const guardReport = await guardService.inspect({ context: cloudContext })
    expect(guardReport.status).toBe('unbound')

    // Inspect reports workspace safe to initialize (recovery allowed)
    const inspectReport = await inspectCloudFirstWorkspace({ adapter: scenario.adapter, context: cloudContext })
    expect(inspectReport.ok).toBe(true)
    expect(inspectReport.safeToInitialize).toBe(true)
    expect(inspectReport.reasons).toEqual([])

    // Now fix metadata persistence and retry pull
    shouldFailVersions = false
    const retryResult = await pullStore.pullNow({ initialCloudRead: true })
    expect(retryResult.ok).toBe(true)

    // Binding is now marked completed
    const completedBinding = await scenario.adapter.loadSyncPullBinding()
    expect(completedBinding?.status).toBe('completed')

    // Journal is completed
    const completedJournal = await scenario.adapter.loadCloudInitializationJournal()
    expect(completedJournal?.phase).toBe('completed')

    // Exactly one transaction exists (idempotent, no duplication)
    const finalTrx = await scenario.adapter.loadTransactions()
    expect(finalTrx).toHaveLength(1)
    expect(finalTrx[0].id).toBe(saleUuid)
    expect(finalTrx[0].invoiceNumber).toBe('INV-20261018-001')

    // Products also intact without duplication
    const finalProducts = await scenario.adapter.loadProducts()
    expect(finalProducts.products).toHaveLength(1)
    expect(finalProducts.products[0].name).toBe('Kopi Susu Cloud')

    // Context guard now recognizes device as safe (bound and matching context)
    const finalGuard = await guardService.inspect({ context: cloudContext })
    expect(finalGuard.status).toBe('safe')
  })

  it('16. Interrupted initial pull with sales recovers after full restart without being blocked', async () => {
    const scenario = await createOfflineOnlineScenario({ businessMode: 'cloud', initialOnline: true })
    const saleUuid = '660e8400-e29b-41d4-a716-446655440003'
    const itemUuid = '660e8400-e29b-41d4-a716-446655440004'
    const prodUuid = '660e8400-e29b-41d4-a716-446655440005'

    const cloudContext = makeValidCloudContext({ role: 'owner', syncCapabilities: { push_mode: 'full' } })
    useCloudSessionStore(scenario.pinia).$patch(cloudContext)
    await scenario.adapter.saveCloudContext(cloudContext)

    // Simulate interrupted state after crash with previously pulled sales
    await scenario.adapter.saveCloudInitializationJournal({
      version: 1,
      phase: 'initializing',
      businessId: 10,
      outletId: 101,
      deviceIdentifier: cloudContext.deviceIdentifier,
      registeredDeviceId: 55,
      startedAt: new Date().toISOString(),
      completedAt: null,
      updatedAt: new Date().toISOString(),
    })
    await scenario.adapter.saveSyncPullBinding({
      businessId: 10,
      outletId: 101,
      deviceIdentifier: cloudContext.deviceIdentifier,
      registeredDeviceId: 55,
      boundAt: new Date().toISOString(),
      mode: 'cloud_first_read',
      status: 'initializing',
    })
    await scenario.adapter.saveTransactions([
      {
        id: saleUuid,
        invoiceNumber: 'INV-20261018-002',
        status: 'paid',
        paymentStatus: 'paid',
        total: 25000,
        items: [],
      },
    ])

    // Inspect check on restarted adapter
    const report = await inspectCloudFirstWorkspace({ adapter: scenario.adapter, context: cloudContext })
    expect(report.ok).toBe(true)
    expect(report.safeToInitialize).toBe(true)
    expect(report.reasons).toEqual([])

    // Cloud returns the sale and sale_item again
    mockServerHandler.handle = async () => ({
      ok: true,
      status: 200,
      data: {
        data: {
          records: [
            {
              entity: 'sales',
              sync_sequence: 1,
              data: {
                sync_id: saleUuid,
                sync_version: 1,
                transaction_number: 'INV-20261018-002',
                status: 'paid',
                payment_status: 'paid',
                subtotal: 25000,
                tax_amount: 0,
                total_amount: 25000,
                sold_at: '2026-10-18T11:00:00Z',
              },
            },
            {
              entity: 'sale_items',
              sync_sequence: 2,
              data: {
                sync_id: itemUuid,
                sync_version: 1,
                sale_sync_id: saleUuid,
                product_sync_id: prodUuid,
                product_name: 'Item Cloud',
                unit_price: 25000,
                quantity: 1,
                cost_snapshot: 10000,
                line_cost: 10000,
              },
            },
          ],
          next_cursor: 2,
          server_sequence: 2,
          has_more: false,
        },
      },
    })

    const pullStore = useSyncPullStore(scenario.pinia)
    const result = await pullStore.pullNow({ initialCloudRead: true })
    expect(result.ok).toBe(true)

    const binding = await scenario.adapter.loadSyncPullBinding()
    expect(binding?.status).toBe('completed')

    const trx = await scenario.adapter.loadTransactions()
    expect(trx).toHaveLength(1)
    expect(trx[0].id).toBe(saleUuid)
  })

  it('17. Local transaction with valid UUID and no pending outbox appearing after interrupted pull is NOT assumed remote and fails closed on retry', async () => {
    const scenario = await createOfflineOnlineScenario({ businessMode: 'cloud', initialOnline: true })
    const localSaleUuid = '770e8400-e29b-41d4-a716-446655440099'

    const cloudContext = makeValidCloudContext({ role: 'owner', syncCapabilities: { push_mode: 'full' } })
    useCloudSessionStore(scenario.pinia).$patch(cloudContext)
    await scenario.adapter.saveCloudContext(cloudContext)

    // Interrupted pull state
    await scenario.adapter.saveCloudInitializationJournal({
      version: 1,
      phase: 'initializing',
      businessId: 10,
      outletId: 101,
      deviceIdentifier: cloudContext.deviceIdentifier,
      registeredDeviceId: 55,
      startedAt: new Date().toISOString(),
      completedAt: null,
      updatedAt: new Date().toISOString(),
    })
    await scenario.adapter.saveSyncPullBinding({
      businessId: 10,
      outletId: 101,
      deviceIdentifier: cloudContext.deviceIdentifier,
      registeredDeviceId: 55,
      boundAt: new Date().toISOString(),
      mode: 'cloud_first_read',
      status: 'initializing',
    })

    // Local transaction with valid UUID created offline / after interrupted pull without pending outbox
    const localTransactions = [
      {
        id: localSaleUuid,
        invoiceNumber: 'INV-LOCAL-001',
        status: 'paid',
        paymentStatus: 'paid',
        total: 15000,
        items: [],
      },
    ]
    await scenario.adapter.saveTransactions(localTransactions)
    useTransactionStore(scenario.pinia).$patch({ items: localTransactions })

    // Cloud returns empty records or unrelated records that DO NOT include the local transaction
    mockServerHandler.handle = async () => ({
      ok: true,
      status: 200,
      data: {
        data: {
          records: [],
          next_cursor: 0,
          server_sequence: 0,
          has_more: false,
        },
      },
    })

    const pullStore = useSyncPullStore(scenario.pinia)
    const result = await pullStore.pullNow({ initialCloudRead: true })

    // MUST fail closed because provenance cannot be proven
    expect(result.ok).toBe(false)
    expect(result.code).toBe('CLOUD_INITIALIZATION_WORKSPACE_NOT_EMPTY')
    expect(result.error?.reasons).toContain('transactions')

    // Local transaction MUST NOT be deleted or overwritten
    const storedTrx = await scenario.adapter.loadTransactions()
    expect(storedTrx).toHaveLength(1)
    expect(storedTrx[0].id).toBe(localSaleUuid)

    // Pull binding must NOT be marked completed
    const binding = await scenario.adapter.loadSyncPullBinding()
    expect(binding?.status).toBe('initializing')
  })

  it('18. Distinguishes provably remote transaction from unverified local transaction when durable bindings exist', async () => {
    const scenario = await createOfflineOnlineScenario({ businessMode: 'cloud', initialOnline: true })
    const remoteSaleUuid = '660e8400-e29b-41d4-a716-446655440003'
    const localSaleUuid = '770e8400-e29b-41d4-a716-446655440099'

    const cloudContext = makeValidCloudContext({ role: 'owner', syncCapabilities: { push_mode: 'full' } })
    useCloudSessionStore(scenario.pinia).$patch(cloudContext)
    await scenario.adapter.saveCloudContext(cloudContext)

    await scenario.adapter.saveCloudInitializationJournal({
      version: 1,
      phase: 'initializing',
      businessId: 10,
      outletId: 101,
      deviceIdentifier: cloudContext.deviceIdentifier,
      registeredDeviceId: 55,
      startedAt: new Date().toISOString(),
      completedAt: null,
      updatedAt: new Date().toISOString(),
    })
    await scenario.adapter.saveSyncPullBinding({
      businessId: 10,
      outletId: 101,
      deviceIdentifier: cloudContext.deviceIdentifier,
      registeredDeviceId: 55,
      boundAt: new Date().toISOString(),
      mode: 'cloud_first_read',
      status: 'initializing',
    })

    // Durable proof exists for the remote sale
    await scenario.adapter.saveSyncIdentityMap({
      [`transaction:${remoteSaleUuid}`]: remoteSaleUuid,
    })
    await scenario.adapter.saveSyncServerVersions({
      [`sales:${remoteSaleUuid}`]: { syncVersion: 1, syncSequence: 1 },
    })

    // Both the proven remote transaction and unverified local transaction exist in SQLite
    const transactions = [
      {
        id: remoteSaleUuid,
        invoiceNumber: 'INV-REMOTE-001',
        status: 'paid',
        paymentStatus: 'paid',
        total: 25000,
        items: [],
      },
      {
        id: localSaleUuid,
        invoiceNumber: 'INV-LOCAL-001',
        status: 'paid',
        paymentStatus: 'paid',
        total: 15000,
        items: [],
      },
    ]
    await scenario.adapter.saveTransactions(transactions)
    useTransactionStore(scenario.pinia).$patch({ items: transactions })

    // Preflight inspect MUST detect unmapped local transaction and fail closed
    const inspectReport = await inspectCloudFirstWorkspace({ adapter: scenario.adapter, context: cloudContext })
    expect(inspectReport.safeToInitialize).toBe(false)
    expect(inspectReport.reasons).toContain('transactions')

    // Cloud returns only the remote sale
    mockServerHandler.handle = async () => ({
      ok: true,
      status: 200,
      data: {
        data: {
          records: [
            {
              entity: 'sales',
              sync_sequence: 1,
              data: {
                sync_id: remoteSaleUuid,
                sync_version: 1,
                transaction_number: 'INV-REMOTE-001',
                status: 'paid',
                payment_status: 'paid',
                subtotal: 25000,
                tax_amount: 0,
                total_amount: 25000,
                sold_at: '2026-10-18T11:00:00Z',
              },
            },
          ],
          next_cursor: 1,
          server_sequence: 1,
          has_more: false,
        },
      },
    })

    const pullStore = useSyncPullStore(scenario.pinia)
    const result = await pullStore.pullNow({ initialCloudRead: true })

    // MUST fail closed because unverified local sale cannot be merged
    expect(result.ok).toBe(false)
    expect(result.code).toBe('CLOUD_INITIALIZATION_WORKSPACE_NOT_EMPTY')
    expect(result.error?.reasons).toContain('transactions')

    // Neither transaction is deleted
    const storedTrx = await scenario.adapter.loadTransactions()
    expect(storedTrx).toHaveLength(2)
  })

  it('19. Local cash entry with valid UUID and no pending outbox fails closed and is NOT assumed remote', async () => {
    const scenario = await createOfflineOnlineScenario({ businessMode: 'cloud', initialOnline: true })
    const localCashUuid = '880e8400-e29b-41d4-a716-446655440088'

    const cloudContext = makeValidCloudContext({ role: 'owner', syncCapabilities: { push_mode: 'full' } })
    useCloudSessionStore(scenario.pinia).$patch(cloudContext)
    await scenario.adapter.saveCloudContext(cloudContext)

    await scenario.adapter.saveCloudInitializationJournal({
      version: 1,
      phase: 'initializing',
      businessId: 10,
      outletId: 101,
      deviceIdentifier: cloudContext.deviceIdentifier,
      registeredDeviceId: 55,
      startedAt: new Date().toISOString(),
      completedAt: null,
      updatedAt: new Date().toISOString(),
    })
    await scenario.adapter.saveSyncPullBinding({
      businessId: 10,
      outletId: 101,
      deviceIdentifier: cloudContext.deviceIdentifier,
      registeredDeviceId: 55,
      boundAt: new Date().toISOString(),
      mode: 'cloud_first_read',
      status: 'initializing',
    })

    await scenario.adapter.saveCashState({
      entries: [
        {
          id: localCashUuid,
          type: 'in',
          amount: 50000,
          category: 'Modal Awal',
          note: 'Kas lokal',
          createdAt: new Date().toISOString(),
        },
      ],
    })

    // Cloud returns empty records
    mockServerHandler.handle = async () => ({
      ok: true,
      status: 200,
      data: {
        data: {
          records: [],
          next_cursor: 0,
          server_sequence: 0,
          has_more: false,
        },
      },
    })

    const pullStore = useSyncPullStore(scenario.pinia)
    const result = await pullStore.pullNow({ initialCloudRead: true })

    expect(result.ok).toBe(false)
    expect(result.code).toBe('CLOUD_INITIALIZATION_WORKSPACE_NOT_EMPTY')
    expect(result.error?.reasons).toContain('cash')

    // Local cash entry remains intact
    const storedCash = await scenario.adapter.loadCashState()
    expect(storedCash.entries).toHaveLength(1)
    expect(storedCash.entries[0].id).toBe(localCashUuid)
  })

  it('20. Local shift with valid UUID and no pending outbox fails closed and is NOT assumed remote', async () => {
    const scenario = await createOfflineOnlineScenario({ businessMode: 'cloud', initialOnline: true })
    const localShiftUuid = '990e8400-e29b-41d4-a716-446655440077'

    const cloudContext = makeValidCloudContext({ role: 'owner', syncCapabilities: { push_mode: 'full' } })
    useCloudSessionStore(scenario.pinia).$patch(cloudContext)
    await scenario.adapter.saveCloudContext(cloudContext)

    await scenario.adapter.saveCloudInitializationJournal({
      version: 1,
      phase: 'initializing',
      businessId: 10,
      outletId: 101,
      deviceIdentifier: cloudContext.deviceIdentifier,
      registeredDeviceId: 55,
      startedAt: new Date().toISOString(),
      completedAt: null,
      updatedAt: new Date().toISOString(),
    })
    await scenario.adapter.saveSyncPullBinding({
      businessId: 10,
      outletId: 101,
      deviceIdentifier: cloudContext.deviceIdentifier,
      registeredDeviceId: 55,
      boundAt: new Date().toISOString(),
      mode: 'cloud_first_read',
      status: 'initializing',
    })

    await scenario.adapter.saveShiftState({
      id: localShiftUuid,
      shiftNumber: 'SHIFT-LOCAL-001',
      status: 'open',
      openingBalance: 100000,
      openedAt: new Date().toISOString(),
    })

    // Cloud returns records that do NOT contain this shift
    mockServerHandler.handle = async () => ({
      ok: true,
      status: 200,
      data: {
        data: {
          records: [],
          next_cursor: 0,
          server_sequence: 0,
          has_more: false,
        },
      },
    })

    const pullStore = useSyncPullStore(scenario.pinia)
    const result = await pullStore.pullNow({ initialCloudRead: true })

    expect(result.ok).toBe(false)
    expect(result.code).toBe('CLOUD_INITIALIZATION_WORKSPACE_NOT_EMPTY')
    expect(result.error?.reasons).toContain('shift')

    // Local shift remains intact
    const storedShift = await scenario.adapter.loadShiftState()
    expect(storedShift.id).toBe(localShiftUuid)
  })
})

function scenarioHelperAdapter() {
  return createMemoryAdapter()
}
