import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createMemoryAdapter } from '@/services/database/memoryAdapter'
import { createPersistenceService } from '@/services/database/persistenceService'
import { createSQLiteAdapter } from '@/services/database/sqliteAdapter'
import { SYNC_ENTITY_TYPES, SYNC_OPERATIONS } from '@/services/sync/syncConstants'
import { createSyncQueueService } from '@/services/sync/syncQueueService'
import { createSyncChangeTracker } from '@/services/sync/syncTracker'
import { useBusinessStore } from '@/stores/businessStore'
import { useCartStore } from '@/stores/cartStore'
import { useCashierStore } from '@/stores/cashierStore'
import { useCustomerStore } from '@/stores/customerStore'
import { useExpenseStore } from '@/stores/expenseStore'
import { useProductStore } from '@/stores/productStore'
import { useShiftStore } from '@/stores/shiftStore'
import { useTransactionStore } from '@/stores/transactionStore'

const { fakeDb } = vi.hoisted(() => {
  const fakeDb = {
    beginTransaction: vi.fn(async () => {}),
    commitTransaction: vi.fn(async () => {}),
    rollbackTransaction: vi.fn(async () => {}),
    run: vi.fn(async () => {}),
    query: vi.fn(async () => ({ values: [] })),
    execute: vi.fn(async () => {}),
    isDBOpen: async () => ({ result: true }),
    open: async () => {},
    close: async () => {},
  }

  return { fakeDb }
})

vi.mock('@capacitor-community/sqlite', () => {
  class SQLiteConnection {
    async checkConnectionsConsistency() {
      return { result: true }
    }

    async isConnection() {
      return { result: false }
    }

    async createConnection() {
      return fakeDb
    }

    async retrieveConnection() {
      return fakeDb
    }

    async closeConnection() {}
  }

  return {
    CapacitorSQLite: {},
    SQLiteConnection,
  }
})

function createSimpleScheduler() {
  let queue = Promise.resolve()

  return {
    runSerialized(task) {
      const run = queue.catch(() => {}).then(task)
      queue = run.catch(() => {})
      return run
    },
    async flush() {
      await queue
    },
  }
}

function makeBusiness(overrides = {}) {
  return {
    name: 'Toko ABC',
    type: 'Cafe',
    owner: 'Admin',
    phone: '08123456789',
    outlet: 'Outlet Utama',
    mode: 'cloud',
    ...overrides,
  }
}

async function createSyncRuntime({ mode = 'cloud', adapter: injectedAdapter } = {}) {
  const pinia = createPinia()
  setActivePinia(pinia)

  const adapter = injectedAdapter ?? createMemoryAdapter()
  const persistence = createPersistenceService({ adapter, pinia })

  await persistence.initialize()

  const queueService = createSyncQueueService({ adapter, scheduler: persistence })
  const businessStore = useBusinessStore()
  const productStore = useProductStore()
  const customerStore = useCustomerStore()
  const expenseStore = useExpenseStore()
  const transactionStore = useTransactionStore()
  const cartStore = useCartStore()
  const cashierStore = useCashierStore()
  const shiftStore = useShiftStore()

  // Configure mode BEFORE attaching the tracker so initial setup is not treated
  // as a user mutation.
  businessStore.setBusiness(makeBusiness({ mode }))

  const tracker = createSyncChangeTracker({ pinia, queueService })

  return {
    pinia,
    adapter,
    persistence,
    queueService,
    tracker,
    businessStore,
    productStore,
    customerStore,
    expenseStore,
    transactionStore,
    cartStore,
    cashierStore,
    shiftStore,
  }
}

async function flush(runtime) {
  await runtime.persistence.flush()
}

beforeEach(() => {
  vi.restoreAllMocks()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('P9 sync queue service', () => {
  it('enqueue upsert menghasilkan row', async () => {
    const adapter = createMemoryAdapter()
    const scheduler = createSimpleScheduler()
    const queueService = createSyncQueueService({ adapter, scheduler })

    const result = await queueService.enqueueUpsert('product', 'p-1', { name: 'Kopi' })

    expect(result.ok).toBe(true)
    expect(await queueService.countPending()).toBe(1)
  })

  it('enqueue delete menghasilkan row', async () => {
    const adapter = createMemoryAdapter()
    const queueService = createSyncQueueService({ adapter, scheduler: createSimpleScheduler() })

    await queueService.enqueueDelete('product', 'p-1')

    expect(await queueService.countPending()).toBe(1)
  })

  it('payload upsert JSON tetap utuh', async () => {
    const adapter = createMemoryAdapter()
    const queueService = createSyncQueueService({ adapter, scheduler: createSimpleScheduler() })
    const payload = { id: 'p-1', name: 'Kopi', price: 20000, isActive: true }

    await queueService.enqueueUpsert('product', 'p-1', payload)

    const pending = await queueService.listPending()
    expect(pending[0].payload).toEqual(payload)
  })

  it('delete payload null', async () => {
    const adapter = createMemoryAdapter()
    const queueService = createSyncQueueService({ adapter, scheduler: createSimpleScheduler() })

    await queueService.enqueueDelete('product', 'p-1')

    const pending = await queueService.listPending()
    expect(pending[0].operation).toBe(SYNC_OPERATIONS.DELETE)
    expect(pending[0].payload).toBeNull()
  })

  it('countPending benar', async () => {
    const adapter = createMemoryAdapter()
    const queueService = createSyncQueueService({ adapter, scheduler: createSimpleScheduler() })

    await queueService.enqueueUpsert('product', 'p-1', { name: 'a' })
    await queueService.enqueueUpsert('customer', 'c-1', { name: 'Budi' })
    await queueService.enqueueDelete('expense', 'e-1')

    expect(await queueService.countPending()).toBe(3)
  })

  it('listPending urut createdAt', async () => {
    const adapter = createMemoryAdapter()
    const queueService = createSyncQueueService({ adapter, scheduler: createSimpleScheduler() })

    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-21T08:00:00.000Z'))
    await queueService.enqueueUpsert('product', 'p-1', { name: 'a' })

    vi.setSystemTime(new Date('2026-08-21T08:00:01.000Z'))
    await queueService.enqueueUpsert('product', 'p-2', { name: 'b' })

    vi.setSystemTime(new Date('2026-08-21T08:00:02.000Z'))
    await queueService.enqueueUpsert('product', 'p-3', { name: 'c' })

    const pending = await queueService.listPending()

    expect(pending.map((item) => item.entityId)).toEqual(['p-1', 'p-2', 'p-3'])
    vi.useRealTimers()
  })

  it('remove menghapus row', async () => {
    const adapter = createMemoryAdapter()
    const queueService = createSyncQueueService({ adapter, scheduler: createSimpleScheduler() })

    const { entry } = await queueService.enqueueUpsert('product', 'p-1', { name: 'a' })
    await queueService.remove(entry.id)

    expect(await queueService.countPending()).toBe(0)
  })

  it('markFailed increment attemptCount', async () => {
    const adapter = createMemoryAdapter()
    const queueService = createSyncQueueService({ adapter, scheduler: createSimpleScheduler() })

    const { entry } = await queueService.enqueueUpsert('product', 'p-1', { name: 'a' })
    await queueService.markFailed(entry.id, 'timeout')
    await queueService.markFailed(entry.id, 'network')

    const pending = await queueService.listPending()
    expect(pending[0].attemptCount).toBe(2)
  })

  it('markFailed menyimpan lastError', async () => {
    const adapter = createMemoryAdapter()
    const queueService = createSyncQueueService({ adapter, scheduler: createSimpleScheduler() })

    const { entry } = await queueService.enqueueUpsert('product', 'p-1', { name: 'a' })
    await queueService.markFailed(entry.id, 'timeout')

    const pending = await queueService.listPending()
    expect(pending[0].lastError).toBe('timeout')
  })

  it('mutation baru reset attemptCount', async () => {
    const adapter = createMemoryAdapter()
    const queueService = createSyncQueueService({ adapter, scheduler: createSimpleScheduler() })

    const { entry } = await queueService.enqueueUpsert('product', 'p-1', { price: 100 })
    await queueService.markFailed(entry.id, 'timeout')
    await queueService.enqueueUpsert('product', 'p-1', { price: 200 })

    const pending = await queueService.listPending()
    expect(pending[0].attemptCount).toBe(0)
  })

  it('mutation baru reset lastError', async () => {
    const adapter = createMemoryAdapter()
    const queueService = createSyncQueueService({ adapter, scheduler: createSimpleScheduler() })

    const { entry } = await queueService.enqueueUpsert('product', 'p-1', { price: 100 })
    await queueService.markFailed(entry.id, 'timeout')
    await queueService.enqueueUpsert('product', 'p-1', { price: 200 })

    const pending = await queueService.listPending()
    expect(pending[0].lastError).toBeNull()
  })
})

describe('P9 sync queue coalescing', () => {
  it('3 update product sama -> 1 row', async () => {
    const adapter = createMemoryAdapter()
    const queueService = createSyncQueueService({ adapter, scheduler: createSimpleScheduler() })

    await queueService.enqueueUpsert('product', 'p-1', { price: 20000 })
    await queueService.enqueueUpsert('product', 'p-1', { price: 22000 })
    await queueService.enqueueUpsert('product', 'p-1', { price: 25000 })

    expect(await queueService.countPending()).toBe(1)
  })

  it('latest payload menang', async () => {
    const adapter = createMemoryAdapter()
    const queueService = createSyncQueueService({ adapter, scheduler: createSimpleScheduler() })

    await queueService.enqueueUpsert('product', 'p-1', { price: 20000 })
    await queueService.enqueueUpsert('product', 'p-1', { price: 22000 })
    await queueService.enqueueUpsert('product', 'p-1', { price: 25000 })

    const pending = await queueService.listPending()
    expect(pending[0].payload.price).toBe(25000)
  })

  it('upsert -> delete menjadi delete', async () => {
    const adapter = createMemoryAdapter()
    const queueService = createSyncQueueService({ adapter, scheduler: createSimpleScheduler() })

    await queueService.enqueueUpsert('product', 'p-1', { name: 'Kopi' })
    await queueService.enqueueDelete('product', 'p-1')

    const pending = await queueService.listPending()
    expect(pending).toHaveLength(1)
    expect(pending[0].operation).toBe(SYNC_OPERATIONS.DELETE)
    expect(pending[0].payload).toBeNull()
  })

  it('delete -> upsert menjadi upsert', async () => {
    const adapter = createMemoryAdapter()
    const queueService = createSyncQueueService({ adapter, scheduler: createSimpleScheduler() })

    await queueService.enqueueDelete('product', 'p-1')
    await queueService.enqueueUpsert('product', 'p-1', { name: 'Kopi Baru' })

    const pending = await queueService.listPending()
    expect(pending).toHaveLength(1)
    expect(pending[0].operation).toBe(SYNC_OPERATIONS.UPSERT)
    expect(pending[0].payload).toEqual({ name: 'Kopi Baru' })
  })

  it('entity berbeda tetap row berbeda', async () => {
    const adapter = createMemoryAdapter()
    const queueService = createSyncQueueService({ adapter, scheduler: createSimpleScheduler() })

    await queueService.enqueueUpsert('product', 'p-1', { name: 'a' })
    await queueService.enqueueUpsert('product', 'p-2', { name: 'b' })

    expect(await queueService.countPending()).toBe(2)
  })

  it('entity_type berbeda dengan entity_id sama tetap berbeda', async () => {
    const adapter = createMemoryAdapter()
    const queueService = createSyncQueueService({ adapter, scheduler: createSimpleScheduler() })

    await queueService.enqueueUpsert('product', 'x-1', { name: 'Produk' })
    await queueService.enqueueUpsert('customer', 'x-1', { name: 'Budi' })

    expect(await queueService.countPending()).toBe(2)
  })
})

describe('P9 free vs cloud mode', () => {
  it('mode free product create -> 0 queue', async () => {
    const runtime = await createSyncRuntime({ mode: 'free' })

    runtime.productStore.createProduct({
      name: 'Kopi',
      category: 'Minuman',
      price: 10000,
      stock: 5,
    })
    await flush(runtime)

    expect(await runtime.queueService.countPending()).toBe(0)
  })

  it('mode free customer create -> 0 queue', async () => {
    const runtime = await createSyncRuntime({ mode: 'free' })

    runtime.customerStore.createCustomer({ name: 'Budi', phone: '081', email: '' })
    await flush(runtime)

    expect(await runtime.queueService.countPending()).toBe(0)
  })

  it('mode free transaction -> 0 queue', async () => {
    const runtime = await createSyncRuntime({ mode: 'free' })

    runtime.transactionStore.createTransaction({
      items: [{ id: 'p', name: 'Kopi', price: 10000, qty: 1 }],
      subtotal: 10000,
      tax: 1100,
      total: 11100,
      paymentMethod: 'cash',
    })
    await flush(runtime)

    expect(await runtime.queueService.countPending()).toBe(0)
  })

  it('mode cloud product create -> queue', async () => {
    const runtime = await createSyncRuntime({ mode: 'cloud' })

    const created = runtime.productStore.createProduct({
      name: 'Kopi',
      category: 'Minuman',
      price: 10000,
      stock: 5,
    })
    await flush(runtime)

    const pending = await runtime.queueService.listPending()
    expect(pending).toHaveLength(1)
    expect(pending[0].entityType).toBe(SYNC_ENTITY_TYPES.PRODUCT)
    expect(pending[0].entityId).toBe(created.product.id)
    expect(pending[0].operation).toBe(SYNC_OPERATIONS.UPSERT)
    expect(pending[0].payload).toEqual(created.product)
  })

  it('mode cloud customer create -> queue', async () => {
    const runtime = await createSyncRuntime({ mode: 'cloud' })

    const created = runtime.customerStore.createCustomer({
      name: 'Budi',
      phone: '08123456789',
      email: 'budi@example.com',
    })
    await flush(runtime)

    const pending = await runtime.queueService.listPending()
    expect(pending).toHaveLength(1)
    expect(pending[0].entityType).toBe(SYNC_ENTITY_TYPES.CUSTOMER)
    expect(pending[0].payload).toEqual(created.customer)
  })

  it('mode cloud expense create -> queue', async () => {
    const runtime = await createSyncRuntime({ mode: 'cloud' })

    runtime.expenseStore.createExpense({
      title: 'Listrik',
      category: 'Operasional',
      amount: 150000,
      note: 'Tagihan',
    })
    await flush(runtime)

    const pending = await runtime.queueService.listPending()
    expect(pending).toHaveLength(1)
    expect(pending[0].entityType).toBe(SYNC_ENTITY_TYPES.EXPENSE)
  })

  it('mode cloud transaction -> queue', async () => {
    const runtime = await createSyncRuntime({ mode: 'cloud' })

    runtime.transactionStore.createTransaction({
      items: [{ id: 'p', name: 'Kopi', price: 10000, qty: 1 }],
      subtotal: 10000,
      tax: 1100,
      total: 11100,
      paymentMethod: 'cash',
    })
    await flush(runtime)

    const pending = await runtime.queueService.listPending()
    expect(pending).toHaveLength(1)
    expect(pending[0].entityType).toBe(SYNC_ENTITY_TYPES.TRANSACTION)
  })

  it('perubahan mode saja tidak queue business', async () => {
    const runtime = await createSyncRuntime({ mode: 'cloud' })

    runtime.businessStore.setBusiness(makeBusiness({ mode: 'free' }))
    await flush(runtime)

    const pending = await runtime.queueService.listPending()
    expect(pending.filter((item) => item.entityType === SYNC_ENTITY_TYPES.BUSINESS)).toHaveLength(0)
  })

  it('business payload tidak memiliki mode', async () => {
    const runtime = await createSyncRuntime({ mode: 'cloud' })

    runtime.businessStore.setBusiness(makeBusiness({ name: 'Toko Baru' }))
    await flush(runtime)

    const pending = await runtime.queueService.listPending()
    const business = pending.find((item) => item.entityType === SYNC_ENTITY_TYPES.BUSINESS)

    expect(business).toBeTruthy()
    expect(business.payload).toEqual({
      name: 'Toko Baru',
      type: 'Cafe',
      owner: 'Admin',
      phone: '08123456789',
      outlet: 'Outlet Utama',
    })
    expect(business.payload.mode).toBeUndefined()
  })
})

describe('P9 product sync tracking', () => {
  it('createProduct success -> upsert', async () => {
    const runtime = await createSyncRuntime()

    const created = runtime.productStore.createProduct({
      name: 'Kopi',
      category: 'Minuman',
      price: 10000,
      stock: 5,
    })
    await flush(runtime)

    const pending = await runtime.queueService.listPending()
    expect(pending).toHaveLength(1)
    expect(pending[0].entityType).toBe(SYNC_ENTITY_TYPES.PRODUCT)
    expect(pending[0].operation).toBe(SYNC_OPERATIONS.UPSERT)
    expect(pending[0].entityId).toBe(created.product.id)
  })

  it('createProduct validation failure -> no queue', async () => {
    const runtime = await createSyncRuntime()

    const result = runtime.productStore.createProduct({
      name: '',
      category: 'Minuman',
      price: 10000,
      stock: 5,
    })
    await flush(runtime)

    expect(result.success).toBe(false)
    expect(await runtime.queueService.countPending()).toBe(0)
  })

  it('updateProduct -> latest upsert', async () => {
    const runtime = await createSyncRuntime()

    const created = runtime.productStore.createProduct({
      name: 'Kopi',
      category: 'Minuman',
      price: 10000,
      stock: 5,
    })
    runtime.productStore.updateProduct(created.product.id, {
      name: 'Kopi Susu',
      category: 'Minuman',
      price: 15000,
      stock: 3,
      isActive: true,
    })
    await flush(runtime)

    const pending = await runtime.queueService.listPending()
    expect(pending).toHaveLength(1)
    expect(pending[0].payload.price).toBe(15000)
    expect(pending[0].payload.name).toBe('Kopi Susu')
  })

  it('toggleProductActive -> upsert latest state', async () => {
    const runtime = await createSyncRuntime()

    const created = runtime.productStore.createProduct({
      name: 'Kopi',
      category: 'Minuman',
      price: 10000,
      stock: 5,
    })
    runtime.productStore.toggleProductActive(created.product.id)
    await flush(runtime)

    const pending = await runtime.queueService.listPending()
    expect(pending).toHaveLength(1)
    expect(pending[0].operation).toBe(SYNC_OPERATIONS.UPSERT)
    expect(pending[0].payload.isActive).toBe(false)
  })

  it('deleteProduct success -> delete', async () => {
    const runtime = await createSyncRuntime()

    const created = runtime.productStore.createProduct({
      name: 'Kopi',
      category: 'Minuman',
      price: 10000,
      stock: 5,
    })
    runtime.productStore.deleteProduct(created.product.id)
    await flush(runtime)

    const pending = await runtime.queueService.listPending()
    expect(pending).toHaveLength(1)
    expect(pending[0].entityType).toBe(SYNC_ENTITY_TYPES.PRODUCT)
    expect(pending[0].entityId).toBe(created.product.id)
    expect(pending[0].operation).toBe(SYNC_OPERATIONS.DELETE)
    expect(pending[0].payload).toBeNull()
  })

  it('delete product nonexistent -> no queue', async () => {
    const runtime = await createSyncRuntime()

    const result = runtime.productStore.deleteProduct('does-not-exist')
    await flush(runtime)

    expect(result).toBe(false)
    expect(await runtime.queueService.countPending()).toBe(0)
  })
})

describe('P9 category sync tracking', () => {
  it('createCategory -> upsert', async () => {
    const runtime = await createSyncRuntime()

    runtime.productStore.createCategory('Seasonal')
    await flush(runtime)

    const pending = await runtime.queueService.listPending()
    expect(pending).toHaveLength(1)
    expect(pending[0].entityType).toBe(SYNC_ENTITY_TYPES.CATEGORY)
    expect(pending[0].entityId).toBe('Seasonal')
    expect(pending[0].payload).toEqual({ name: 'Seasonal' })
  })

  it('reserved Semua tidak pernah queue', async () => {
    const runtime = await createSyncRuntime()

    const result = runtime.productStore.createCategory('Semua')
    await flush(runtime)

    expect(result.success).toBe(false)
    expect(await runtime.queueService.countPending()).toBe(0)
  })

  it('category validation failure -> no queue', async () => {
    const runtime = await createSyncRuntime()

    const result = runtime.productStore.createCategory('')
    await flush(runtime)

    expect(result.success).toBe(false)
    expect(await runtime.queueService.countPending()).toBe(0)
  })

  it('rename category -> delete old', async () => {
    const runtime = await createSyncRuntime()

    runtime.productStore.createCategory('Seasonal')
    await flush(runtime)

    runtime.productStore.updateCategory('Seasonal', 'Promo')
    await flush(runtime)

    const pending = await runtime.queueService.listPending()
    const oldCategory = pending.find(
      (item) => item.entityType === SYNC_ENTITY_TYPES.CATEGORY && item.entityId === 'Seasonal',
    )
    expect(oldCategory.operation).toBe(SYNC_OPERATIONS.DELETE)
  })

  it('rename category -> upsert new', async () => {
    const runtime = await createSyncRuntime()

    runtime.productStore.createCategory('Seasonal')
    await flush(runtime)

    runtime.productStore.updateCategory('Seasonal', 'Promo')
    await flush(runtime)

    const pending = await runtime.queueService.listPending()
    const newCategory = pending.find(
      (item) => item.entityType === SYNC_ENTITY_TYPES.CATEGORY && item.entityId === 'Promo',
    )
    expect(newCategory.operation).toBe(SYNC_OPERATIONS.UPSERT)
    expect(newCategory.payload).toEqual({ name: 'Promo' })
  })

  it('rename category -> affected products upsert', async () => {
    const runtime = await createSyncRuntime()

    runtime.productStore.createCategory('Seasonal')
    const created = runtime.productStore.createProduct({
      name: 'Kopi',
      category: 'Seasonal',
      price: 10000,
      stock: 5,
    })
    await flush(runtime)

    runtime.productStore.updateCategory('Seasonal', 'Promo')
    await flush(runtime)

    const pending = await runtime.queueService.listPending()
    const product = pending.find(
      (item) => item.entityType === SYNC_ENTITY_TYPES.PRODUCT && item.entityId === created.product.id,
    )
    expect(product.operation).toBe(SYNC_OPERATIONS.UPSERT)
    expect(product.payload.category).toBe('Promo')
  })

  it('failed delete used category -> no queue', async () => {
    const runtime = await createSyncRuntime()

    runtime.productStore.createCategory('Seasonal')
    runtime.productStore.createProduct({
      name: 'Kopi',
      category: 'Seasonal',
      price: 10000,
      stock: 5,
    })
    await flush(runtime)

    const before = await runtime.queueService.countPending()
    const result = runtime.productStore.deleteCategory('Seasonal')
    await flush(runtime)

    expect(result.success).toBe(false)
    expect(await runtime.queueService.countPending()).toBe(before)
  })

  it('successful delete category -> delete', async () => {
    const runtime = await createSyncRuntime()

    runtime.productStore.createCategory('Seasonal')
    await flush(runtime)

    runtime.productStore.deleteCategory('Seasonal')
    await flush(runtime)

    const pending = await runtime.queueService.listPending()
    expect(pending).toHaveLength(1)
    expect(pending[0].entityType).toBe(SYNC_ENTITY_TYPES.CATEGORY)
    expect(pending[0].entityId).toBe('Seasonal')
    expect(pending[0].operation).toBe(SYNC_OPERATIONS.DELETE)
  })
})

describe('P9 customer sync tracking', () => {
  it('create customer -> upsert', async () => {
    const runtime = await createSyncRuntime()

    const created = runtime.customerStore.createCustomer({
      name: 'Budi',
      phone: '08123456789',
      email: 'budi@example.com',
    })
    await flush(runtime)

    const pending = await runtime.queueService.listPending()
    expect(pending).toHaveLength(1)
    expect(pending[0].operation).toBe(SYNC_OPERATIONS.UPSERT)
    expect(pending[0].payload).toEqual(created.customer)
  })

  it('update customer -> upsert', async () => {
    const runtime = await createSyncRuntime()

    const created = runtime.customerStore.createCustomer({
      name: 'Budi',
      phone: '081',
      email: '',
    })
    runtime.customerStore.updateCustomer(created.customer.id, {
      name: 'Budi Santoso',
      phone: '08123456789',
      email: 'budi@example.com',
    })
    await flush(runtime)

    const pending = await runtime.queueService.listPending()
    expect(pending).toHaveLength(1)
    expect(pending[0].payload.name).toBe('Budi Santoso')
    expect(pending[0].payload.phone).toBe('08123456789')
  })

  it('delete customer -> delete', async () => {
    const runtime = await createSyncRuntime()

    const created = runtime.customerStore.createCustomer({ name: 'Budi', phone: '081', email: '' })
    runtime.customerStore.deleteCustomer(created.customer.id)
    await flush(runtime)

    const pending = await runtime.queueService.listPending()
    expect(pending).toHaveLength(1)
    expect(pending[0].operation).toBe(SYNC_OPERATIONS.DELETE)
    expect(pending[0].entityId).toBe(created.customer.id)
    expect(pending[0].payload).toBeNull()
  })

  it('failed customer update -> no queue', async () => {
    const runtime = await createSyncRuntime()

    const result = runtime.customerStore.updateCustomer('missing', {
      name: 'Siapa',
      phone: '',
      email: '',
    })
    await flush(runtime)

    expect(result.success).toBe(false)
    expect(await runtime.queueService.countPending()).toBe(0)
  })
})

describe('P9 expense sync tracking', () => {
  it('create expense -> upsert', async () => {
    const runtime = await createSyncRuntime()

    const created = runtime.expenseStore.createExpense({
      title: 'Listrik',
      category: 'Operasional',
      amount: 150000,
      note: 'Tagihan',
    })
    await flush(runtime)

    const pending = await runtime.queueService.listPending()
    expect(pending).toHaveLength(1)
    expect(pending[0].operation).toBe(SYNC_OPERATIONS.UPSERT)
    expect(pending[0].payload).toEqual(created.expense)
  })

  it('update expense -> upsert', async () => {
    const runtime = await createSyncRuntime()

    const created = runtime.expenseStore.createExpense({
      title: 'Listrik',
      category: 'Operasional',
      amount: 150000,
      note: 'Tagihan',
    })
    runtime.expenseStore.updateExpense(created.expense.id, {
      title: 'Internet',
      category: 'Operasional',
      amount: 250000,
      note: 'Revisi',
    })
    await flush(runtime)

    const pending = await runtime.queueService.listPending()
    expect(pending).toHaveLength(1)
    expect(pending[0].payload.title).toBe('Internet')
    expect(pending[0].payload.amount).toBe(250000)
  })

  it('delete expense -> delete', async () => {
    const runtime = await createSyncRuntime()

    const created = runtime.expenseStore.createExpense({
      title: 'Listrik',
      category: 'Operasional',
      amount: 150000,
      note: '',
    })
    runtime.expenseStore.deleteExpense(created.expense.id)
    await flush(runtime)

    const pending = await runtime.queueService.listPending()
    expect(pending).toHaveLength(1)
    expect(pending[0].operation).toBe(SYNC_OPERATIONS.DELETE)
    expect(pending[0].entityId).toBe(created.expense.id)
  })

  it('failed expense mutation -> no queue', async () => {
    const runtime = await createSyncRuntime()

    const result = runtime.expenseStore.createExpense({
      title: '',
      category: 'Operasional',
      amount: 150000,
      note: '',
    })
    await flush(runtime)

    expect(result.success).toBe(false)
    expect(await runtime.queueService.countPending()).toBe(0)
  })
})

describe('P9 transaction sync tracking', () => {
  function makeTransactionPayload(overrides = {}) {
    return {
      customer: 'Budi',
      customerId: 'c-1',
      customerSnapshot: {
        id: 'c-1',
        name: 'Budi',
        phone: '08123456789',
        email: 'budi@example.com',
      },
      businessSnapshot: {
        name: 'Toko ABC',
        outlet: 'Outlet Utama',
      },
      items: [{ id: 'p-1', name: 'Kopi', price: 20000, qty: 2 }],
      subtotal: 40000,
      tax: 4400,
      total: 44400,
      paymentMethod: 'cash',
      cashReceived: 50000,
      changeAmount: 5600,
      ...overrides,
    }
  }

  it('createTransaction menghasilkan hanya 1 transaction queue row', async () => {
    const runtime = await createSyncRuntime()

    runtime.transactionStore.createTransaction(makeTransactionPayload())
    await flush(runtime)

    const pending = await runtime.queueService.listPending()
    expect(pending).toHaveLength(1)
    expect(pending[0].entityType).toBe(SYNC_ENTITY_TYPES.TRANSACTION)
  })

  it('addTransaction exact payload preserved', async () => {
    const runtime = await createSyncRuntime()

    const transaction = {
      id: 'TRX-1001',
      customer: 'Walk-in Customer',
      items: 3,
      total: 69000,
      status: 'paid',
      paymentMethod: 'QRIS',
      createdAt: '2026-08-21T09:15:00+07:00',
    }
    runtime.transactionStore.addTransaction(transaction)
    await flush(runtime)

    const pending = await runtime.queueService.listPending()
    expect(pending[0].payload).toEqual(transaction)
  })

  it('customerSnapshot preserved', async () => {
    const runtime = await createSyncRuntime()

    runtime.transactionStore.createTransaction(makeTransactionPayload())
    await flush(runtime)

    const pending = await runtime.queueService.listPending()
    expect(pending[0].payload.customerSnapshot).toEqual({
      id: 'c-1',
      name: 'Budi',
      phone: '08123456789',
      email: 'budi@example.com',
    })
  })

  it('businessSnapshot preserved', async () => {
    const runtime = await createSyncRuntime()

    runtime.transactionStore.createTransaction(makeTransactionPayload())
    await flush(runtime)

    const pending = await runtime.queueService.listPending()
    expect(pending[0].payload.businessSnapshot).toEqual({
      name: 'Toko ABC',
      outlet: 'Outlet Utama',
    })
  })

  it('cashReceived/changeAmount preserved', async () => {
    const runtime = await createSyncRuntime()

    runtime.transactionStore.createTransaction(makeTransactionPayload())
    await flush(runtime)

    const pending = await runtime.queueService.listPending()
    expect(pending[0].payload.cashReceived).toBe(50000)
    expect(pending[0].payload.changeAmount).toBe(5600)
  })

  it('legacy items:number preserved', async () => {
    const runtime = await createSyncRuntime()

    runtime.transactionStore.addTransaction({
      id: 'TRX-1001',
      items: 3,
      total: 69000,
      paymentMethod: 'QRIS',
      createdAt: '2026-08-21T09:15:00+07:00',
    })
    await flush(runtime)

    const pending = await runtime.queueService.listPending()
    expect(pending[0].payload.items).toBe(3)
  })

  it('tidak ada duplicate createTransaction/addTransaction', async () => {
    const runtime = await createSyncRuntime()

    runtime.transactionStore.createTransaction(makeTransactionPayload())
    await flush(runtime)

    const pending = await runtime.queueService.listPending()
    const transactionRows = pending.filter(
      (item) => item.entityType === SYNC_ENTITY_TYPES.TRANSACTION,
    )
    expect(transactionRows).toHaveLength(1)
  })
})

describe('P9 sync safety', () => {
  it('selectedCategory tidak queue', async () => {
    const runtime = await createSyncRuntime()

    runtime.productStore.selectCategory('Minuman')
    await flush(runtime)

    expect(await runtime.queueService.countPending()).toBe(0)
  })

  it('searchQuery tidak queue', async () => {
    const runtime = await createSyncRuntime()

    runtime.productStore.setSearchQuery('kopi')
    await flush(runtime)

    expect(await runtime.queueService.countPending()).toBe(0)
  })

  it('clearLastTransaction tidak queue', async () => {
    const runtime = await createSyncRuntime()

    runtime.transactionStore.clearLastTransaction()
    await flush(runtime)

    expect(await runtime.queueService.countPending()).toBe(0)
  })

  it('cashier mutation tidak queue', async () => {
    const runtime = await createSyncRuntime()

    runtime.cashierStore.setPinConfigured(true)
    await flush(runtime)

    expect(await runtime.queueService.countPending()).toBe(0)
  })

  it('shift mutation tidak queue', async () => {
    const runtime = await createSyncRuntime()

    runtime.shiftStore.openShift(100000)
    await flush(runtime)

    expect(await runtime.queueService.countPending()).toBe(0)
  })

  it('cart mutation tidak queue', async () => {
    const runtime = await createSyncRuntime()

    runtime.cartStore.addItem({ id: 'p-1', name: 'Kopi', price: 20000, qty: 1 })
    await flush(runtime)

    expect(await runtime.queueService.countPending()).toBe(0)
  })

  it('hydration tidak menghasilkan queue', async () => {
    const adapter = createMemoryAdapter()
    const first = await createSyncRuntime({ adapter })

    first.productStore.createProduct({
      name: 'Kopi',
      category: 'Minuman',
      price: 10000,
      stock: 5,
    })
    await flush(first)

    const second = await createSyncRuntime({ adapter })
    await flush(second)

    // Only the explicit product mutation should be queued — hydration adds none.
    expect(await second.queueService.countPending()).toBe(1)
  })

  it('first-run P8 seed tidak menghasilkan queue', async () => {
    const adapter = createMemoryAdapter()
    const runtime = await createSyncRuntime({ adapter })

    await flush(runtime)

    expect(await runtime.queueService.countPending()).toBe(0)
  })

  it('P7 restore-style $patch tidak menghasilkan queue', async () => {
    const runtime = await createSyncRuntime()

    runtime.productStore.$patch({
      products: [
        {
          id: 'restored-product',
          name: 'Produk Restore',
          category: 'Minuman',
          price: 18000,
          stock: 4,
          isActive: true,
        },
      ],
      categories: ['Minuman'],
    })
    runtime.customerStore.$patch({
      customers: [{ id: 'restored-customer', name: 'Sari', phone: '081', email: '' }],
    })
    runtime.transactionStore.$patch({
      items: [{ id: 'restored-transaction', items: 2, total: 50000 }],
    })
    await flush(runtime)

    expect(await runtime.queueService.countPending()).toBe(0)
  })

  it('invalid action tidak queue', async () => {
    const runtime = await createSyncRuntime()

    runtime.productStore.createProduct({ name: '', category: '', price: -1, stock: -1 })
    runtime.productStore.deleteProduct('missing')
    runtime.customerStore.updateCustomer('missing', { name: 'X', phone: '', email: '' })
    runtime.expenseStore.updateExpense('missing', {
      title: 'X',
      category: 'Operasional',
      amount: 100,
      note: '',
    })
    await flush(runtime)

    expect(await runtime.queueService.countPending()).toBe(0)
  })

  it('queue write menggunakan serialized P8 scheduler', async () => {
    const runtime = await createSyncRuntime()
    const spy = vi.spyOn(runtime.persistence, 'runSerialized')

    runtime.productStore.createProduct({
      name: 'Kopi',
      category: 'Minuman',
      price: 10000,
      stock: 5,
    })
    await flush(runtime)

    expect(spy).toHaveBeenCalled()
    expect(spy.mock.calls.some(([, label]) => label.startsWith('sync:'))).toBe(true)
  })

  it('sync queue tidak membuat independent concurrent DB transaction', async () => {
    const adapter = createSQLiteAdapter()
    const scheduler = createSimpleScheduler()
    const queueService = createSyncQueueService({ adapter, scheduler })

    await queueService.enqueueUpsert('product', 'p-1', { name: 'Kopi' })

    expect(fakeDb.beginTransaction).not.toHaveBeenCalled()
    expect(fakeDb.commitTransaction).not.toHaveBeenCalled()
    expect(
      fakeDb.run.mock.calls.some(([sql]) => sql.includes('INSERT INTO sync_queue')),
    ).toBe(true)
  })
})

describe('P9 sync queue restart persistence', () => {
  it('sync queue bertahan setelah simulated restart memory adapter', async () => {
    const adapter = createMemoryAdapter()
    const first = await createSyncRuntime({ adapter })

    first.productStore.createProduct({
      name: 'Kopi',
      category: 'Minuman',
      price: 10000,
      stock: 5,
    })
    await flush(first)

    const second = await createSyncRuntime({ adapter })

    expect(await second.queueService.countPending()).toBe(1)
  })

  it('pending operation latest tetap sama setelah restart', async () => {
    const adapter = createMemoryAdapter()
    const first = await createSyncRuntime({ adapter })

    const created = first.productStore.createProduct({
      name: 'Kopi',
      category: 'Minuman',
      price: 10000,
      stock: 5,
    })
    first.productStore.updateProduct(created.product.id, {
      name: 'Kopi',
      category: 'Minuman',
      price: 15000,
      stock: 5,
      isActive: true,
    })
    await flush(first)

    const second = await createSyncRuntime({ adapter })
    const pending = await second.queueService.listPending()

    expect(pending).toHaveLength(1)
    expect(pending[0].payload.price).toBe(15000)
  })

  it('failed attempt metadata bertahan setelah restart', async () => {
    const adapter = createMemoryAdapter()
    const first = await createSyncRuntime({ adapter })

    first.productStore.createProduct({
      name: 'Kopi',
      category: 'Minuman',
      price: 10000,
      stock: 5,
    })
    await flush(first)

    const pending = await first.queueService.listPending()
    await first.queueService.markFailed(pending[0].id, 'timeout')

    const second = await createSyncRuntime({ adapter })
    const after = await second.queueService.listPending()

    expect(after[0].attemptCount).toBe(1)
    expect(after[0].lastError).toBe('timeout')
  })
})
