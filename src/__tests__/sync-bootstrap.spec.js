/**
 * Mobile P14 — Free -> Cloud Initial Bootstrap Test Suite
 *
 * Covers:
 * 1. Cloud preconditions enforcement (BOOTSTRAP_PRECONDITION_FAILED on missing token/context/registration)
 * 2. Initial state verification (BOOTSTRAP_SYNC_ALREADY_STARTED, BOOTSTRAP_PUSH_INFLIGHT, BOOTSTRAP_ALREADY_STAGED)
 * 3. Server empty check (GET /api/sync/pull limit=1, BOOTSTRAP_SERVER_NOT_EMPTY, network failure fail-closed)
 * 4. Local snapshot creation (categories excluding 'Semua', products, customers, expenses, transactions)
 * 5. Preflight validation & atomicity via P11 contract mapper (fail-closed, no partial staging on legacy invalid items)
 * 6. Atomic staging to P9 sync_queue and coalescing semantics
 * 7. Pending delete conflict protection (BOOTSTRAP_PENDING_DELETE_CONFLICT)
 * 8. Unsupported business outbox warning handling (UNSUPPORTED_BUSINESS_OUTBOX_PRESENT)
 * 9. Durable bootstrap state persistence & retry idempotency
 * 10. No automatic push or pull execution
 * 11. Shared identity registry wiring in initializeSyncFoundation
 * 12. UI integration in CloudLoginView
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

import { createMemoryAdapter } from '../services/database/memoryAdapter'
import { createSyncQueueService } from '../services/sync/syncQueueService'
import { createSyncIdentityRegistry, isUuid } from '../services/sync/syncIdentityRegistry'
import { createSyncBootstrapService } from '../services/sync/syncBootstrapService'
import { createSyncPushService } from '../services/sync/syncPushService'
import { initializeSyncFoundation } from '../services/sync/index'
import { SYNC_ENTITY_TYPES, SYNC_OPERATIONS, SYNC_RESERVED_CATEGORY } from '../services/sync/syncConstants'
import { useProductStore } from '../stores/productStore'
import { useCustomerStore } from '../stores/customerStore'
import { useExpenseStore } from '../stores/expenseStore'
import { useTransactionStore } from '../stores/transactionStore'
import { useCloudSessionStore } from '../stores/cloudSessionStore'
import { useSyncPushStore } from '../stores/syncPushStore'
import { useSyncPullStore } from '../stores/syncPullStore'
import { useSyncBootstrapStore } from '../stores/syncBootstrapStore'
import CloudLoginView from '../views/settings/CloudLoginView.vue'

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

function mockEmptyServerTransport() {
  return vi.fn().mockResolvedValue({
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
}

describe('P14: Cloud Preconditions & State Verification', () => {
  let pinia
  let adapter
  let queueService
  let registry
  let productStore
  let customerStore
  let expenseStore
  let transactionStore

  beforeEach(async () => {
    pinia = createPinia()
    setActivePinia(pinia)
    adapter = createMemoryAdapter()
    await adapter.initialize()
    queueService = createSyncQueueService({ adapter })
    registry = createSyncIdentityRegistry({ adapter })

    productStore = useProductStore(pinia)
    customerStore = useCustomerStore(pinia)
    expenseStore = useExpenseStore(pinia)
    transactionStore = useTransactionStore(pinia)

    productStore.products = []
    productStore.categories = []
    customerStore.customers = []
    expenseStore.expenses = []
    transactionStore.items = []
  })

  it('fails with BOOTSTRAP_PRECONDITION_FAILED when token or cloud context is missing', async () => {
    const transport = mockEmptyServerTransport()
    const bootstrapService = createSyncBootstrapService({
      adapter,
      queueService,
      registry,
      pinia,
      tokenFetcher: async () => null, // missing token
      transport,
    })

    const res1 = await bootstrapService.bootstrapNow({
      context: makeValidCloudContext(),
    })
    expect(res1.ok).toBe(false)
    expect(res1.code).toBe('BOOTSTRAP_PRECONDITION_FAILED')
    expect(transport).not.toHaveBeenCalled()
    expect(await queueService.countPending()).toBe(0)

    // Missing selectedBusiness
    const bootstrapService2 = createSyncBootstrapService({
      adapter,
      queueService,
      registry,
      pinia,
      tokenFetcher: async () => 'test-token',
      transport,
    })

    const res2 = await bootstrapService2.bootstrapNow({
      context: makeValidCloudContext({ selectedBusiness: null }),
    })
    expect(res2.ok).toBe(false)
    expect(res2.code).toBe('BOOTSTRAP_PRECONDITION_FAILED')

    // cloudAccess === false
    const res3 = await bootstrapService2.bootstrapNow({
      context: makeValidCloudContext({ cloudAccess: false }),
    })
    expect(res3.ok).toBe(false)
    expect(res3.code).toBe('BOOTSTRAP_PRECONDITION_FAILED')

    // Missing registeredDeviceId
    const res4 = await bootstrapService2.bootstrapNow({
      context: makeValidCloudContext({ registeredDeviceId: null }),
    })
    expect(res4.ok).toBe(false)
    expect(res4.code).toBe('BOOTSTRAP_PRECONDITION_FAILED')
  })

  it('fails with BOOTSTRAP_SYNC_ALREADY_STARTED if sync push or pull binding already exists', async () => {
    const transport = mockEmptyServerTransport()

    // 1. Existing push binding
    await adapter.saveSyncPushBinding({
      businessId: 10,
      deviceIdentifier: '123e4567-e89b-12d3-a456-426614174000',
      registeredDeviceId: 55,
      boundAt: new Date().toISOString(),
    })

    const service = createSyncBootstrapService({
      adapter,
      queueService,
      registry,
      pinia,
      tokenFetcher: async () => 'test-token',
      transport,
    })

    const res1 = await service.bootstrapNow({ context: makeValidCloudContext() })
    expect(res1.ok).toBe(false)
    expect(res1.code).toBe('BOOTSTRAP_SYNC_ALREADY_STARTED')

    // 2. Existing pull binding
    const adapter2 = createMemoryAdapter()
    await adapter2.initialize()
    await adapter2.saveSyncPullBinding({
      businessId: 10,
      outletId: 101,
      deviceIdentifier: '123e4567-e89b-12d3-a456-426614174000',
      boundAt: new Date().toISOString(),
    })

    const service2 = createSyncBootstrapService({
      adapter: adapter2,
      queueService: createSyncQueueService({ adapter: adapter2 }),
      registry: createSyncIdentityRegistry({ adapter: adapter2 }),
      pinia,
      tokenFetcher: async () => 'test-token',
      transport,
    })

    const res2 = await service2.bootstrapNow({ context: makeValidCloudContext() })
    expect(res2.ok).toBe(false)
    expect(res2.code).toBe('BOOTSTRAP_SYNC_ALREADY_STARTED')
  })

  it('fails with BOOTSTRAP_PUSH_INFLIGHT if a push envelope is currently active', async () => {
    await adapter.saveSyncPushInflight({
      requestId: 'req-123',
      businessId: 10,
      items: [],
      sentAt: new Date().toISOString(),
    })

    const service = createSyncBootstrapService({
      adapter,
      queueService,
      registry,
      pinia,
      tokenFetcher: async () => 'test-token',
      transport: mockEmptyServerTransport(),
    })

    const res = await service.bootstrapNow({ context: makeValidCloudContext() })
    expect(res.ok).toBe(false)
    expect(res.code).toBe('BOOTSTRAP_PUSH_INFLIGHT')
  })

  it('fails with BOOTSTRAP_ALREADY_STAGED if bootstrap state is already staged', async () => {
    await adapter.saveSyncBootstrapState({
      version: 1,
      businessId: 10,
      outletId: 101,
      deviceIdentifier: '123e4567-e89b-12d3-a456-426614174000',
      registeredDeviceId: 55,
      status: 'staged',
      stagedAt: new Date().toISOString(),
      counts: { categories: 1, products: 1, customers: 0, expenses: 0, transactions: 0 },
    })

    const service = createSyncBootstrapService({
      adapter,
      queueService,
      registry,
      pinia,
      tokenFetcher: async () => 'test-token',
      transport: mockEmptyServerTransport(),
    })

    const res = await service.bootstrapNow({ context: makeValidCloudContext() })
    expect(res.ok).toBe(false)
    expect(res.code).toBe('BOOTSTRAP_ALREADY_STAGED')
  })
})

describe('P14: Server Empty Check', () => {
  let pinia
  let adapter
  let queueService
  let registry
  let productStore
  let customerStore
  let expenseStore
  let transactionStore

  beforeEach(async () => {
    pinia = createPinia()
    setActivePinia(pinia)
    adapter = createMemoryAdapter()
    await adapter.initialize()
    queueService = createSyncQueueService({ adapter })
    registry = createSyncIdentityRegistry({ adapter })

    productStore = useProductStore(pinia)
    customerStore = useCustomerStore(pinia)
    expenseStore = useExpenseStore(pinia)
    transactionStore = useTransactionStore(pinia)

    productStore.products = []
    productStore.categories = []
    customerStore.customers = []
    expenseStore.expenses = []
    transactionStore.items = []
  })

  it('proceeds when server returns empty records and sequence 0', async () => {
    const transport = mockEmptyServerTransport()
    const service = createSyncBootstrapService({
      adapter,
      queueService,
      registry,
      pinia,
      tokenFetcher: async () => 'test-token',
      transport,
    })

    const res = await service.bootstrapNow({ context: makeValidCloudContext() })
    expect(res.ok).toBe(true)
    expect(transport).toHaveBeenCalledWith(
      expect.objectContaining({
        businessId: 10,
        deviceIdentifier: '123e4567-e89b-12d3-a456-426614174000',
        after: 0,
        limit: 1,
      }),
    )
  })

  it('fails with BOOTSTRAP_SERVER_NOT_EMPTY when server contains existing records or non-zero sequence', async () => {
    // 1. Server returns records
    const transport1 = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        data: {
          records: [{ entity: 'products', sync_sequence: 1, data: { sync_id: 'uuid-1', sync_version: 1 } }],
          next_cursor: 1,
          server_sequence: 1,
          has_more: false,
        },
      },
    })

    const service1 = createSyncBootstrapService({
      adapter,
      queueService,
      registry,
      pinia,
      tokenFetcher: async () => 'test-token',
      transport: transport1,
    })

    const res1 = await service1.bootstrapNow({ context: makeValidCloudContext() })
    expect(res1.ok).toBe(false)
    expect(res1.code).toBe('BOOTSTRAP_SERVER_NOT_EMPTY')
    expect(await queueService.countPending()).toBe(0)

    // 2. Server returns server_sequence > 0 even with empty records
    const transport2 = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        data: {
          records: [],
          next_cursor: 5,
          server_sequence: 5,
          has_more: false,
        },
      },
    })

    const service2 = createSyncBootstrapService({
      adapter,
      queueService,
      registry,
      pinia,
      tokenFetcher: async () => 'test-token',
      transport: transport2,
    })

    const res2 = await service2.bootstrapNow({ context: makeValidCloudContext() })
    expect(res2.ok).toBe(false)
    expect(res2.code).toBe('BOOTSTRAP_SERVER_NOT_EMPTY')
  })

  it('fails closed when server check encounters HTTP or network error', async () => {
    const transport = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      error: { code: 'SERVER_ERROR', message: 'Internal Server Error' },
    })

    const service = createSyncBootstrapService({
      adapter,
      queueService,
      registry,
      pinia,
      tokenFetcher: async () => 'test-token',
      transport,
    })

    const res = await service.bootstrapNow({ context: makeValidCloudContext() })
    expect(res.ok).toBe(false)
    expect(res.code).toBe('SERVER_ERROR')
    expect(await queueService.countPending()).toBe(0)
    expect(await adapter.loadSyncBootstrapState()).toBeNull()
  })
})

describe('P14: Local Snapshot & Preflight Atomicity', () => {
  let pinia
  let adapter
  let queueService
  let registry
  let productStore
  let customerStore
  let expenseStore
  let transactionStore

  beforeEach(async () => {
    pinia = createPinia()
    setActivePinia(pinia)
    adapter = createMemoryAdapter()
    await adapter.initialize()
    queueService = createSyncQueueService({ adapter })
    registry = createSyncIdentityRegistry({ adapter })

    productStore = useProductStore(pinia)
    customerStore = useCustomerStore(pinia)
    expenseStore = useExpenseStore(pinia)
    transactionStore = useTransactionStore(pinia)

    productStore.products = []
    productStore.categories = []
    customerStore.customers = []
    expenseStore.expenses = []
    transactionStore.items = []
  })

  it('stages full supported local snapshot and ignores reserved category "Semua"', async () => {
    productStore.categories = ['Semua', 'Makanan', 'Minuman']
    productStore.products = [
      { id: 'p-1', name: 'Kopi Hitam', price: 10000, category: 'Minuman', stock: 10, isActive: true },
      { id: 'p-2', name: 'Roti Bakar', price: 15000, category: 'Makanan', stock: 5, isActive: true },
    ]
    customerStore.customers = [
      { id: 'c-1', name: 'Budi Santoso', phone: '08123456789', email: 'budi@example.com' },
    ]
    expenseStore.expenses = [
      { id: 'e-1', amount: 50000, description: 'Token PLN', occurred_at: '2026-08-26T00:00:00.000Z' },
    ]
    transactionStore.items = [
      {
        id: 't-1',
        subtotal: 10000,
        tax: 0,
        total: 10000,
        createdAt: '2026-08-26T08:00:00.000Z',
        items: [{ id: 'p-1', name: 'Kopi Hitam', price: 10000, qty: 1, subtotal: 10000 }],
      },
    ]

    const service = createSyncBootstrapService({
      adapter,
      queueService,
      registry,
      pinia,
      tokenFetcher: async () => 'test-token',
      transport: mockEmptyServerTransport(),
    })

    const res = await service.bootstrapNow({ context: makeValidCloudContext() })
    expect(res.ok).toBe(true)
    expect(res.staged).toBe(7) // 2 categories (excluding 'Semua') + 2 products + 1 customer + 1 expense + 1 transaction
    expect(res.counts).toEqual({
      categories: 2,
      products: 2,
      customers: 1,
      expenses: 1,
      transactions: 1,
    })

    const pending = await queueService.listPending({ limit: 100 })
    expect(pending.length).toBe(7)

    // Ensure 'Semua' was not staged
    const catEntries = pending.filter((item) => item.entityType === SYNC_ENTITY_TYPES.CATEGORY)
    expect(catEntries.map((c) => c.entityId)).toEqual(['Makanan', 'Minuman'])
    expect(catEntries.some((c) => c.entityId.toLowerCase() === 'semua')).toBe(false)

    // Ensure bootstrap state is saved
    const state = await adapter.loadSyncBootstrapState()
    expect(state).toBeDefined()
    expect(state.status).toBe('staged')
    expect(state.businessId).toBe(10)
    expect(state.outletId).toBe(101)
  })

  it('fails with BOOTSTRAP_PREFLIGHT_FAILED and stages NOTHING if a legacy transaction has invalid items', async () => {
    productStore.categories = ['Minuman']
    productStore.products = [
      { id: 'p-1', name: 'Kopi Hitam', price: 10000, category: 'Minuman', stock: 10, isActive: true },
    ]
    customerStore.customers = [
      { id: 'c-1', name: 'Budi Santoso', phone: '08123456789' },
    ]
    // Legacy invalid transaction with non-array items
    transactionStore.items = [
      {
        id: 't-invalid',
        total: 10000,
        createdAt: '2026-08-26T08:00:00.000Z',
        items: 'invalid-non-array-items',
      },
    ]

    const service = createSyncBootstrapService({
      adapter,
      queueService,
      registry,
      pinia,
      tokenFetcher: async () => 'test-token',
      transport: mockEmptyServerTransport(),
    })

    const res = await service.bootstrapNow({ context: makeValidCloudContext() })
    expect(res.ok).toBe(false)
    expect(res.code).toBe('BOOTSTRAP_PREFLIGHT_FAILED')
    expect(res.blockedCount).toBeGreaterThan(0)

    // Strict atomicity: no entities (not even valid product/customer) should be staged
    expect(await queueService.countPending()).toBe(0)
    expect(await adapter.loadSyncBootstrapState()).toBeNull()
  })

  it('fails with BOOTSTRAP_PREFLIGHT_FAILED when customer has invalid email', async () => {
    customerStore.customers = [
      { id: 'c-bad-email', name: 'Invalid Email User', email: 'not-an-email' },
    ]

    const service = createSyncBootstrapService({
      adapter,
      queueService,
      registry,
      pinia,
      tokenFetcher: async () => 'test-token',
      transport: mockEmptyServerTransport(),
    })

    const res = await service.bootstrapNow({ context: makeValidCloudContext() })
    expect(res.ok).toBe(false)
    expect(res.code).toBe('BOOTSTRAP_PREFLIGHT_FAILED')
    expect(await queueService.countPending()).toBe(0)
  })

  it('fails with BOOTSTRAP_DEPENDENCY_MISSING when historical transaction references a deleted product', async () => {
    productStore.categories = ['Minuman']
    productStore.products = [
      { id: 'p-1', name: 'Kopi Hitam', price: 10000, category: 'Minuman', stock: 10, isActive: true },
    ]
    // Transaction references 'p-deleted' which is not in ProductStore
    transactionStore.items = [
      {
        id: 't-1',
        subtotal: 10000,
        tax: 0,
        total: 10000,
        createdAt: '2026-08-26T08:00:00.000Z',
        items: [{ id: 'p-deleted', name: 'Deleted Product', price: 10000, qty: 1, subtotal: 10000 }],
      },
    ]

    const service = createSyncBootstrapService({
      adapter,
      queueService,
      registry,
      pinia,
      tokenFetcher: async () => 'test-token',
      transport: mockEmptyServerTransport(),
    })

    const res = await service.bootstrapNow({ context: makeValidCloudContext() })
    expect(res.ok).toBe(false)
    expect(res.code).toBe('BOOTSTRAP_DEPENDENCY_MISSING')
    expect(res.dependencies).toBeDefined()
    expect(res.dependencies.some((d) => d.entity === 'sale_items' && d.dependencyEntity === 'products')).toBe(true)

    // Verify atomic failure: nothing staged
    expect(await queueService.countPending()).toBe(0)
    expect(await adapter.loadSyncBootstrapState()).toBeNull()
  })

  it('fails with BOOTSTRAP_DEPENDENCY_MISSING when transaction references a deleted customer', async () => {
    productStore.categories = ['Minuman']
    productStore.products = [
      { id: 'p-1', name: 'Kopi Hitam', price: 10000, category: 'Minuman', stock: 10, isActive: true },
    ]
    customerStore.customers = [] // Customer is missing from CustomerStore

    transactionStore.items = [
      {
        id: 't-1',
        customerId: 'c-deleted',
        subtotal: 10000,
        tax: 0,
        total: 10000,
        createdAt: '2026-08-26T08:00:00.000Z',
        items: [{ id: 'p-1', name: 'Kopi Hitam', price: 10000, qty: 1, subtotal: 10000 }],
      },
    ]

    const service = createSyncBootstrapService({
      adapter,
      queueService,
      registry,
      pinia,
      tokenFetcher: async () => 'test-token',
      transport: mockEmptyServerTransport(),
    })

    const res = await service.bootstrapNow({ context: makeValidCloudContext() })
    expect(res.ok).toBe(false)
    expect(res.code).toBe('BOOTSTRAP_DEPENDENCY_MISSING')
    expect(res.dependencies.some((d) => d.entity === 'sales' && d.dependencyEntity === 'customers')).toBe(true)

    expect(await queueService.countPending()).toBe(0)
    expect(await adapter.loadSyncBootstrapState()).toBeNull()
  })

  it('fails with BOOTSTRAP_DEPENDENCY_MISSING when product references a missing category', async () => {
    productStore.categories = ['Makanan'] // 'Minuman' is missing
    productStore.products = [
      { id: 'p-1', name: 'Kopi Hitam', price: 10000, category: 'Minuman', stock: 10, isActive: true },
    ]

    const service = createSyncBootstrapService({
      adapter,
      queueService,
      registry,
      pinia,
      tokenFetcher: async () => 'test-token',
      transport: mockEmptyServerTransport(),
    })

    const res = await service.bootstrapNow({ context: makeValidCloudContext() })
    expect(res.ok).toBe(false)
    expect(res.code).toBe('BOOTSTRAP_DEPENDENCY_MISSING')
    expect(res.dependencies.some((d) => d.entity === 'products' && d.dependencyEntity === 'categories')).toBe(true)

    expect(await queueService.countPending()).toBe(0)
    expect(await adapter.loadSyncBootstrapState()).toBeNull()
  })
})

describe('P14: Queue Semantics, Conflicts, & Idempotent Retry', () => {
  let pinia
  let adapter
  let queueService
  let registry
  let productStore
  let customerStore
  let expenseStore
  let transactionStore

  beforeEach(async () => {
    pinia = createPinia()
    setActivePinia(pinia)
    adapter = createMemoryAdapter()
    await adapter.initialize()
    queueService = createSyncQueueService({ adapter })
    registry = createSyncIdentityRegistry({ adapter })

    productStore = useProductStore(pinia)
    customerStore = useCustomerStore(pinia)
    expenseStore = useExpenseStore(pinia)
    transactionStore = useTransactionStore(pinia)

    productStore.products = []
    productStore.categories = []
    customerStore.customers = []
    expenseStore.expenses = []
    transactionStore.items = []
  })

  it('fails with BOOTSTRAP_PENDING_DELETE_CONFLICT when an existing outbox item is a delete operation', async () => {
    // Existing pending delete outbox
    await queueService.enqueueDelete(SYNC_ENTITY_TYPES.PRODUCT, 'p-old')
    expect(await queueService.countPending()).toBe(1)

    productStore.products = [
      { id: 'p-1', name: 'Kopi Hitam', price: 10000, category: 'Minuman' },
    ]

    const service = createSyncBootstrapService({
      adapter,
      queueService,
      registry,
      pinia,
      tokenFetcher: async () => 'test-token',
      transport: mockEmptyServerTransport(),
    })

    const res = await service.bootstrapNow({ context: makeValidCloudContext() })
    expect(res.ok).toBe(false)
    expect(res.code).toBe('BOOTSTRAP_PENDING_DELETE_CONFLICT')

    // Outbox must remain unchanged (only 1 delete)
    expect(await queueService.countPending()).toBe(1)
  })

  it('coalesces existing pending upsert without creating duplicate queue rows', async () => {
    productStore.categories = ['Minuman']
    productStore.products = [
      { id: 'p-1', name: 'Kopi Hitam Updated', price: 12000, category: 'Minuman' },
    ]

    // Existing pending upsert for p-1 with older data
    await queueService.enqueueUpsert(SYNC_ENTITY_TYPES.PRODUCT, 'p-1', {
      id: 'p-1',
      name: 'Kopi Hitam Old',
      price: 10000,
    })

    const initialPending = await queueService.listPending()
    expect(initialPending.length).toBe(1)
    const originalQueueId = initialPending[0].id

    const service = createSyncBootstrapService({
      adapter,
      queueService,
      registry,
      pinia,
      tokenFetcher: async () => 'test-token',
      transport: mockEmptyServerTransport(),
    })

    const res = await service.bootstrapNow({ context: makeValidCloudContext() })
    expect(res.ok).toBe(true)

    const pending = await queueService.listPending({ limit: 100 })
    // 1 category ('Minuman') + 1 product ('p-1') = 2 items
    expect(pending.length).toBe(2)

    const prodEntry = pending.find((p) => p.entityType === SYNC_ENTITY_TYPES.PRODUCT)
    expect(prodEntry.id).toBe(originalQueueId) // ID preserved
    expect(prodEntry.payload.price).toBe(12000) // Updated to latest snapshot
  })

  it('handles bootstrap state persistence failure and allows safe idempotent retry', async () => {
    productStore.categories = ['Kopi']
    productStore.products = [
      { id: 'p-1', name: 'Americano', price: 15000, category: 'Kopi' },
    ]

    // Simulate adapter failure on saveSyncBootstrapState
    const originalSaveState = adapter.saveSyncBootstrapState.bind(adapter)
    let failedOnce = false
    adapter.saveSyncBootstrapState = vi.fn().mockImplementation(async (state) => {
      if (!failedOnce) {
        failedOnce = true
        throw new Error('SQLite disk full')
      }
      return originalSaveState(state)
    })

    const service = createSyncBootstrapService({
      adapter,
      queueService,
      registry,
      pinia,
      tokenFetcher: async () => 'test-token',
      transport: mockEmptyServerTransport(),
    })

    // Attempt 1: Fails at state persist
    const res1 = await service.bootstrapNow({ context: makeValidCloudContext() })
    expect(res1.ok).toBe(false)
    expect(res1.code).toBe('BOOTSTRAP_STATE_PERSIST_FAILED')

    // Staged items are in queue
    expect(await queueService.countPending()).toBe(2)

    // Attempt 2: User retries
    const res2 = await service.bootstrapNow({ context: makeValidCloudContext() })
    expect(res2.ok).toBe(true)

    // No duplicate rows created in queue
    expect(await queueService.countPending()).toBe(2)
    expect(await adapter.loadSyncBootstrapState()).toBeDefined()
  })

  it('includes UNSUPPORTED_BUSINESS_OUTBOX_PRESENT warning when business outbox exists without corrupting bootstrap', async () => {
    // Existing unsupported business outbox entry
    await adapter.upsertSyncQueueItem({
      id: 'biz-queue-1',
      entityType: SYNC_ENTITY_TYPES.BUSINESS,
      entityId: 'biz-1',
      operation: SYNC_OPERATIONS.UPSERT,
      payload: { name: 'My Business' },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })

    productStore.categories = ['Makanan']

    const service = createSyncBootstrapService({
      adapter,
      queueService,
      registry,
      pinia,
      tokenFetcher: async () => 'test-token',
      transport: mockEmptyServerTransport(),
    })

    const res = await service.bootstrapNow({ context: makeValidCloudContext() })
    expect(res.ok).toBe(true)
    expect(res.warnings).toContain('UNSUPPORTED_BUSINESS_OUTBOX_PRESENT')
  })

  it('fails with ATOMIC_BULK_QUEUE_UNSUPPORTED when adapter lacks atomic bulk API', async () => {
    // Adapter without upsertSyncQueueItems
    const nonAtomicAdapter = {
      listSyncQueueItems: vi.fn().mockResolvedValue([]),
      countSyncQueueItems: vi.fn().mockResolvedValue(0),
    }

    const customQueueService = createSyncQueueService({ adapter: nonAtomicAdapter })
    const res = await customQueueService.enqueueManyUpserts([
      { entityType: SYNC_ENTITY_TYPES.PRODUCT, entityId: 'p-1', payload: { name: 'Test' } },
    ])

    expect(res.ok).toBe(false)
    expect(res.code).toBe('ATOMIC_BULK_QUEUE_UNSUPPORTED')
  })

  it('rolls back whole batch atomically when bulk staging fails on a single row', async () => {
    productStore.categories = ['Minuman']
    productStore.products = [
      { id: 'p-1', name: 'Kopi', price: 10000, category: 'Minuman' },
      { id: 'p-2', name: 'Teh', price: 5000, category: 'Minuman' },
    ]

    // Mock upsertSyncQueueItems to simulate SQLite transaction rollback
    adapter.upsertSyncQueueItems = vi.fn().mockImplementation(async () => {
      throw new Error('SQLite statement constraint failed on row 2')
    })

    const service = createSyncBootstrapService({
      adapter,
      queueService,
      registry,
      pinia,
      tokenFetcher: async () => 'test-token',
      transport: mockEmptyServerTransport(),
    })

    const res = await service.bootstrapNow({ context: makeValidCloudContext() })
    expect(res.ok).toBe(false)
    expect(res.code).toBe('BOOTSTRAP_STAGE_FAILED')

    // Atomicity: nothing saved in queue
    expect(await queueService.countPending()).toBe(0)
    expect(await adapter.loadSyncBootstrapState()).toBeNull()
  })

  it('allows P14 bootstrap after an empty P12 push because no push binding was created', async () => {
    // 1. User clicks Sync Sekarang before bootstrap with empty queue
    const pushService = createSyncPushService({
      adapter,
      queueService,
      registry,
      tokenFetcher: async () => 'test-token',
      transport: vi.fn(),
    })

    const pushResult = await pushService.pushNow({ context: makeValidCloudContext() })
    expect(pushResult.ok).toBe(true)
    expect(await adapter.loadSyncPushBinding()).toBeNull()

    // 2. Now user runs P14 bootstrap
    productStore.categories = ['Makanan']
    productStore.products = [
      { id: 'p-1', name: 'Roti Bakar', price: 15000, category: 'Makanan' },
    ]

    const bootstrapService = createSyncBootstrapService({
      adapter,
      queueService,
      registry,
      pinia,
      tokenFetcher: async () => 'test-token',
      transport: mockEmptyServerTransport(),
    })

    const bootstrapResult = await bootstrapService.bootstrapNow({ context: makeValidCloudContext() })
    expect(bootstrapResult.ok).toBe(true)
    expect(bootstrapResult.staged).toBe(2)
    expect(await adapter.loadSyncBootstrapState()).toBeDefined()
  })
})

describe('P14: Shared Registry & Production Wiring', () => {
  it('wires a single shared sync identity registry across bootstrapService, pushService, and pullService', async () => {
    const pinia = createPinia()
    const adapter = createMemoryAdapter()
    await adapter.initialize()

    const syncFoundation = initializeSyncFoundation({
      pinia,
      adapter,
    })

    expect(syncFoundation.bootstrapService).toBeDefined()
    expect(syncFoundation.bootstrapService.registry).toBe(syncFoundation.registry)
    expect(syncFoundation.bootstrapService.registry).toBe(syncFoundation.pushService.registry)
    expect(syncFoundation.bootstrapService.registry).toBe(syncFoundation.pullService.registry)
  })

  it('survives restart and hydrates bootstrap state with isStaged = true when initialized with bootstrapService and adapter', async () => {
    const pinia = createPinia()
    const adapter = createMemoryAdapter()
    await adapter.initialize()

    // 1. Pre-save durable bootstrap state
    await adapter.saveSyncBootstrapState({
      version: 1,
      businessId: 10,
      outletId: 101,
      deviceIdentifier: '123e4567-e89b-12d3-a456-426614174000',
      registeredDeviceId: 55,
      status: 'staged',
      stagedAt: new Date().toISOString(),
      counts: { categories: 1, products: 2, customers: 0, expenses: 0, transactions: 0 },
    })

    // 2. Simulate fresh app restart with new store
    const syncBootstrapStore = useSyncBootstrapStore(pinia)
    const mockService = { bootstrapNow: vi.fn() }

    syncBootstrapStore.init({
      bootstrapService: mockService,
      adapter,
    })

    await syncBootstrapStore.loadBootstrapState()

    expect(syncBootstrapStore.bootstrapState).toBeDefined()
    expect(syncBootstrapStore.bootstrapState.status).toBe('staged')
    expect(syncBootstrapStore.isStaged).toBe(true)
  })
})

describe('P14: UI Integration in CloudLoginView', () => {
  let pinia
  let adapter

  beforeEach(async () => {
    pinia = createPinia()
    setActivePinia(pinia)
    adapter = createMemoryAdapter()
    await adapter.initialize()
  })

  it('renders "Siapkan Data Lokal ke Cloud" and triggers bootstrapNow on click', async () => {
    const cloudStore = useCloudSessionStore(pinia)
    cloudStore.user = { id: 1, name: 'Owner User', email: 'owner@example.com' }
    cloudStore.selectedBusiness = { id: 10, name: 'Kedai Kopi Utama' }
    cloudStore.selectedOutlet = { id: 101, name: 'Outlet Pusat' }
    cloudStore.cloudAccess = true
    cloudStore.deviceIdentifier = '123e4567-e89b-12d3-a456-426614174000'
    cloudStore.registeredDeviceId = 55
    cloudStore.businesses = [
      {
        id: 10,
        name: 'Kedai Kopi Utama',
        cloud_access: true,
        outlets: [{ id: 101, name: 'Outlet Pusat', status: 'active' }],
      },
    ]

    const productStore = useProductStore(pinia)
    productStore.categories = ['Minuman', 'Makanan']
    productStore.products = [{ id: 'p-1', name: 'Kopi', price: 10000, category: 'Minuman' }]

    const syncBootstrapStore = useSyncBootstrapStore(pinia)
    const mockBootstrapService = {
      bootstrapNow: vi.fn().mockResolvedValue({
        ok: true,
        staged: 3,
        counts: { categories: 2, products: 1, customers: 0, expenses: 0, transactions: 0 },
        state: {
          status: 'staged',
          businessId: 10,
          outletId: 101,
          deviceIdentifier: '123e4567-e89b-12d3-a456-426614174000',
          registeredDeviceId: 55,
        },
      }),
    }
    syncBootstrapStore.init({ bootstrapService: mockBootstrapService })

    const wrapper = mount(CloudLoginView, {
      global: {
        plugins: [pinia],
        stubs: {
          BaseCard: { template: '<div><slot /></div>' },
          BaseButton: {
            props: ['loading', 'variant', 'size'],
            template: '<button :disabled="loading" @click="$emit(\'click\')"><slot /></button>',
          },
          BaseInput: true,
        },
      },
    })

    await flushPromises()

    const bootstrapSection = wrapper.find('#cloud-bootstrap-section')
    expect(bootstrapSection.exists()).toBe(true)

    const previewProds = wrapper.find('#preview-products')
    expect(previewProds.text()).toContain('Produk: 1')

    const bootstrapBtn = wrapper.find('#bootstrap-btn')
    expect(bootstrapBtn.exists()).toBe(true)

    await bootstrapBtn.trigger('click')
    await flushPromises()

    expect(mockBootstrapService.bootstrapNow).toHaveBeenCalled()
    expect(wrapper.text()).toContain('Data lokal siap disinkronkan. Gunakan Sync Sekarang.')
  })

  it('displays warning notice and disables Sync button when bootstrap state has context mismatch with current cloud session', async () => {
    const cloudStore = useCloudSessionStore(pinia)
    cloudStore.user = { id: 1, name: 'Owner User', email: 'owner@example.com' }
    cloudStore.selectedBusiness = { id: 20, name: 'Kedai Kopi Cabang 2' } // Current business 20
    cloudStore.selectedOutlet = { id: 202, name: 'Outlet Cabang' }
    cloudStore.cloudAccess = true
    cloudStore.deviceIdentifier = '123e4567-e89b-12d3-a456-426614174000'
    cloudStore.registeredDeviceId = 55
    cloudStore.businesses = [
      {
        id: 20,
        name: 'Kedai Kopi Cabang 2',
        cloud_access: true,
        outlets: [{ id: 202, name: 'Outlet Cabang', status: 'active' }],
      },
    ]

    // Pre-saved bootstrap state was for business 10
    await adapter.saveSyncBootstrapState({
      version: 1,
      businessId: 10,
      outletId: 101,
      deviceIdentifier: '123e4567-e89b-12d3-a456-426614174000',
      registeredDeviceId: 55,
      status: 'staged',
      stagedAt: new Date().toISOString(),
      counts: { categories: 1, products: 1, customers: 0, expenses: 0, transactions: 0 },
    })

    const syncBootstrapStore = useSyncBootstrapStore(pinia)
    syncBootstrapStore.init({
      bootstrapService: { bootstrapNow: vi.fn() },
      adapter,
    })

    await syncBootstrapStore.loadBootstrapState()
    expect(syncBootstrapStore.isStaged).toBe(true)
    expect(syncBootstrapStore.isStagedForCurrentContext).toBe(false)
    expect(syncBootstrapStore.hasContextMismatch).toBe(true)

    const wrapper = mount(CloudLoginView, {
      global: {
        plugins: [pinia],
        stubs: {
          BaseCard: { template: '<div><slot /></div>' },
          BaseButton: {
            props: ['loading', 'disabled', 'variant', 'size'],
            template: '<button :disabled="disabled || loading" @click="$emit(\'click\')"><slot /></button>',
          },
          BaseInput: true,
        },
      },
    })

    await flushPromises()

    const mismatchNotice = wrapper.find('#cloud-bootstrap-mismatch-notice')
    expect(mismatchNotice.exists()).toBe(true)
    expect(mismatchNotice.text()).toContain('Data lokal sudah disiapkan untuk Business/Outlet lain.')

    const syncBtn = wrapper.find('#sync-now-btn')
    expect(syncBtn.attributes('disabled')).toBeDefined()
  })
})
