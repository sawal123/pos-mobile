import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { bootstrapApp } from '@/main'
import { resolvePersistenceAdapter } from '@/services/database'
import { createMemoryAdapter } from '@/services/database/memoryAdapter'
import { createPersistenceService } from '@/services/database/persistenceService'
import { createSQLiteAdapter, deserializeTransactionRows } from '@/services/database/sqliteAdapter'
import { DB_VERSION } from '@/services/database/schema'
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

function createRuntime(adapter = createMemoryAdapter()) {
  const pinia = createPinia()
  setActivePinia(pinia)

  const runtime = {
    adapter,
    pinia,
    service: createPersistenceService({ adapter, pinia }),
    businessStore: useBusinessStore(),
    cartStore: useCartStore(),
    cashierStore: useCashierStore(),
    customerStore: useCustomerStore(),
    expenseStore: useExpenseStore(),
    productStore: useProductStore(),
    shiftStore: useShiftStore(),
    transactionStore: useTransactionStore(),
  }

  return runtime
}

async function initializeRuntime(adapter) {
  const runtime = createRuntime(adapter)
  runtime.result = await runtime.service.initialize()
  return runtime
}

async function restartRuntime(adapter) {
  return initializeRuntime(adapter)
}

function makeBusinessPayload(overrides = {}) {
  return {
    name: 'Toko ABC',
    type: 'Cafe',
    owner: 'Admin',
    phone: '08123456789',
    outlet: 'Outlet Utama',
    mode: 'free',
    ...overrides,
  }
}

beforeEach(() => {
  vi.restoreAllMocks()
})

describe('P8 sqlite persistence foundation', () => {
  it('database schema version = 1', async () => {
    const runtime = await initializeRuntime()

    expect(runtime.result.schemaVersion).toBe(DB_VERSION)
  })

  it('first run terdeteksi dan menyimpan current Pinia state', async () => {
    const adapter = createMemoryAdapter()
    const runtime = await initializeRuntime(adapter)
    const hydrated = await restartRuntime(adapter)

    expect(runtime.result.firstRun).toBe(true)
    expect(hydrated.result.firstRun).toBe(false)
    expect(hydrated.productStore.products).toEqual(runtime.productStore.products)
    expect(hydrated.transactionStore.items).toEqual(runtime.transactionStore.items)
  })

  it('second initialization hydrate database', async () => {
    const adapter = createMemoryAdapter()
    const runtime = await initializeRuntime(adapter)

    runtime.businessStore.setBusiness(makeBusinessPayload({ mode: 'cloud' }))
    await runtime.service.flush()

    const hydrated = await restartRuntime(adapter)

    expect(hydrated.businessStore.name).toBe('Toko ABC')
    expect(hydrated.businessStore.mode).toBe('cloud')
  })

  it('business tersimpan dan mode tetap ada setelah restart', async () => {
    const adapter = createMemoryAdapter()
    const runtime = await initializeRuntime(adapter)

    runtime.businessStore.setBusiness(makeBusinessPayload({ name: 'Toko Persist', mode: 'cloud' }))
    await runtime.service.flush()

    const hydrated = await restartRuntime(adapter)

    expect(hydrated.businessStore.name).toBe('Toko Persist')
    expect(hydrated.businessStore.mode).toBe('cloud')
  })

  it('product create, update, delete, dan categories persist', async () => {
    const adapter = createMemoryAdapter()
    const runtime = await initializeRuntime(adapter)

    runtime.productStore.createCategory('Seasonal')
    const created = runtime.productStore.createProduct({
      name: 'Kopi Latte',
      category: 'Seasonal',
      price: 25000,
      stock: 10,
      isActive: true,
    })

    runtime.productStore.updateProduct(created.product.id, {
      name: 'Kopi Latte',
      category: 'Seasonal',
      price: 30000,
      stock: 8,
      isActive: true,
    })

    await runtime.service.flush()

    let hydrated = await restartRuntime(adapter)
    expect(hydrated.productStore.getProductById(created.product.id)?.price).toBe(30000)
    expect(hydrated.productStore.categories).toContain('Seasonal')

    hydrated.productStore.deleteProduct(created.product.id)
    hydrated.productStore.updateCategory('Seasonal', 'Promo')
    await hydrated.service.flush()

    hydrated = await restartRuntime(adapter)
    expect(hydrated.productStore.getProductById(created.product.id)).toBeNull()
    expect(hydrated.productStore.categories).toContain('Promo')
    expect(hydrated.productStore.categories).not.toContain('Semua')
  })

  it('customer create, update, delete persist', async () => {
    const adapter = createMemoryAdapter()
    const runtime = await initializeRuntime(adapter)
    const created = runtime.customerStore.createCustomer({
      name: 'Budi',
      phone: '08111111111',
      email: 'budi@example.com',
    })

    runtime.customerStore.updateCustomer(created.customer.id, {
      name: 'Budi Santoso',
      phone: '08111111111',
      email: 'budi@example.com',
    })
    await runtime.service.flush()

    let hydrated = await restartRuntime(adapter)
    expect(hydrated.customerStore.getCustomerById(created.customer.id)?.name).toBe('Budi Santoso')

    hydrated.customerStore.deleteCustomer(created.customer.id)
    await hydrated.service.flush()

    hydrated = await restartRuntime(adapter)
    expect(hydrated.customerStore.getCustomerById(created.customer.id)).toBeNull()
  })

  it('expense create, update, delete persist', async () => {
    const adapter = createMemoryAdapter()
    const runtime = await initializeRuntime(adapter)
    const created = runtime.expenseStore.createExpense({
      title: 'Listrik',
      category: 'Operasional',
      amount: 150000,
      note: 'Tagihan bulanan',
    })

    runtime.expenseStore.updateExpense(created.expense.id, {
      title: 'Listrik Kantor',
      category: 'Operasional',
      amount: 175000,
      note: 'Tagihan revisi',
    })
    await runtime.service.flush()

    let hydrated = await restartRuntime(adapter)
    expect(hydrated.expenseStore.getExpenseById(created.expense.id)).toMatchObject({
      title: 'Listrik Kantor',
      amount: 175000,
    })

    hydrated.expenseStore.deleteExpense(created.expense.id)
    await hydrated.service.flush()

    hydrated = await restartRuntime(adapter)
    expect(hydrated.expenseStore.getExpenseById(created.expense.id)).toBeNull()
  })

  it('transaction, customerSnapshot, businessSnapshot, dan legacy items number tetap utuh', async () => {
    const adapter = createMemoryAdapter()
    const runtime = await initializeRuntime(adapter)

    runtime.transactionStore.createTransaction({
      customer: 'Budi',
      customerId: 'cust-1',
      customerSnapshot: {
        id: 'cust-1',
        name: 'Budi',
        phone: '08123456789',
        email: 'budi@example.com',
      },
      businessSnapshot: {
        name: 'Toko ABC',
        outlet: 'Outlet Utama',
      },
      items: [{ id: 'prod-1', name: 'Kopi', price: 20000, qty: 2 }],
      subtotal: 40000,
      tax: 4400,
      total: 44400,
      paymentMethod: 'Cash',
      cashReceived: 50000,
      changeAmount: 5600,
    })

    runtime.transactionStore.$patch({
      items: [
        ...runtime.transactionStore.items,
        {
          id: 'TRX-LEGACY',
          customer: 'Walk-in Customer',
          items: 3,
          total: 69000,
          status: 'paid',
          paymentMethod: 'QRIS',
          createdAt: '2026-08-21T09:15:00+07:00',
        },
      ],
    })
    await runtime.service.flush()

    const hydrated = await restartRuntime(adapter)
    const paidTransaction = hydrated.transactionStore.items.find(
      (item) => item.customerId === 'cust-1',
    )
    const legacyTransaction = hydrated.transactionStore.items.find(
      (item) => item.id === 'TRX-LEGACY',
    )

    expect(paidTransaction.customerSnapshot).toEqual({
      id: 'cust-1',
      name: 'Budi',
      phone: '08123456789',
      email: 'budi@example.com',
    })
    expect(paidTransaction.businessSnapshot).toEqual({
      name: 'Toko ABC',
      outlet: 'Outlet Utama',
    })
    expect(legacyTransaction.items).toBe(3)
  })

  it('cashier dan shift persist', async () => {
    const adapter = createMemoryAdapter()
    const runtime = await initializeRuntime(adapter)

    runtime.cashierStore.setPinConfigured(true)
    runtime.shiftStore.$patch({
      isOpen: true,
      openingBalance: 100000,
      openedAt: '2026-08-21T08:00:00.000Z',
    })
    await runtime.service.flush()

    const hydrated = await restartRuntime(adapter)

    expect(hydrated.cashierStore.activeCashier.pinConfigured).toBe(true)
    expect(hydrated.shiftStore.isOpen).toBe(true)
    expect(hydrated.shiftStore.openingBalance).toBe(100000)
    expect(hydrated.shiftStore.openedAt).toBe('2026-08-21T08:00:00.000Z')
  })

  it('cart, selectedCategory, searchQuery, dan lastTransaction tidak dipersist', async () => {
    const adapter = createMemoryAdapter()
    const runtime = await initializeRuntime(adapter)

    runtime.cartStore.addItem({
      id: 'prod-1',
      name: 'Kopi',
      price: 20000,
      qty: 1,
    })
    runtime.productStore.$patch({
      selectedCategory: 'Minuman',
      searchQuery: 'kopi',
    })
    runtime.transactionStore.$patch({
      lastTransaction: {
        id: 'last-transaction',
      },
    })
    await runtime.service.flush()

    const hydrated = await restartRuntime(adapter)

    expect(hydrated.cartStore.items).toEqual([])
    expect(hydrated.productStore.selectedCategory).toBe('Semua')
    expect(hydrated.productStore.searchQuery).toBe('')
    expect(hydrated.transactionStore.lastTransaction).toBeNull()
  })

  it('memory adapter tidak memanggil native SQLite dan service bisa memakai injected adapter', async () => {
    const createSQLite = vi.fn(async () => {
      throw new Error('native should not be called')
    })
    const adapter = await resolvePersistenceAdapter({
      isNativePlatform: false,
      isPluginAvailable: false,
      createSQLite,
    })

    const runtime = await initializeRuntime(adapter)

    expect(createSQLite).not.toHaveBeenCalled()
    expect(runtime.service.adapter).toBe(adapter)
  })

  it('rapid mutation disimpan sesuai urutan dan latest mutation menang', async () => {
    const adapter = createMemoryAdapter()
    const runtime = await initializeRuntime(adapter)
    const productId = runtime.productStore.products[0].id

    runtime.productStore.updateProduct(productId, {
      ...runtime.productStore.getProductById(productId),
      price: 21000,
    })
    runtime.productStore.updateProduct(productId, {
      ...runtime.productStore.getProductById(productId),
      price: 22000,
    })
    runtime.productStore.updateProduct(productId, {
      ...runtime.productStore.getProductById(productId),
      price: 23000,
    })
    await runtime.service.flush()

    const hydrated = await restartRuntime(adapter)

    expect(hydrated.productStore.getProductById(productId)?.price).toBe(23000)
  })

  it('invalid DB JSON transaction tidak membuat app crash', () => {
    const transactions = deserializeTransactionRows([
      {
        id: 'broken-row',
        payload: '{"broken":',
      },
      {
        id: 'valid-row',
        payload: '{"id":"valid-row","items":3,"total":69000}',
      },
    ])

    expect(transactions).toEqual([
      {
        id: 'valid-row',
        items: 3,
        total: 69000,
      },
    ])
  })

  it('mutation restore ala P7 dapat dipersist dan mode tetap compatible', async () => {
    const adapter = createMemoryAdapter()
    const runtime = await initializeRuntime(adapter)

    runtime.businessStore.setBusiness(makeBusinessPayload({ mode: 'cloud' }))
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
      customers: [
        {
          id: 'restored-customer',
          name: 'Sari',
          phone: '08120000000',
          email: 'sari@example.com',
        },
      ],
    })
    runtime.expenseStore.$patch({
      expenses: [
        {
          id: 'restored-expense',
          title: 'Internet',
          category: 'Operasional',
          amount: 250000,
          note: 'Restore',
          createdAt: '2026-08-21T10:00:00.000Z',
        },
      ],
    })
    runtime.transactionStore.$patch({
      items: [
        {
          id: 'restored-transaction',
          items: 2,
          total: 50000,
          createdAt: '2026-08-21T11:00:00.000Z',
        },
      ],
    })
    runtime.businessStore.$patch({
      name: 'Toko Restore',
      type: 'Cafe',
      owner: 'Owner Restore',
      phone: '08125555555',
      outlet: 'Cabang',
    })
    await runtime.service.flush()

    const hydrated = await restartRuntime(adapter)

    expect(hydrated.businessStore.mode).toBe('cloud')
    expect(hydrated.productStore.products).toHaveLength(1)
    expect(hydrated.customerStore.customers).toHaveLength(1)
    expect(hydrated.expenseStore.expenses).toHaveLength(1)
    expect(hydrated.transactionStore.items).toHaveLength(1)
  })

  it('router bootstrap dilakukan setelah hydration', async () => {
    const order = []
    const fakeApp = {
      use(plugin) {
        order.push(plugin === 'pinia-plugin' ? 'pinia:installed' : 'router:installed')
        return this
      },
      mount(target) {
        order.push(`mount:${target}`)
      },
    }

    await bootstrapApp({
      appFactory() {
        order.push('app:created')
        return fakeApp
      },
      piniaFactory() {
        order.push('pinia:created')
        return 'pinia-plugin'
      },
      async initialize(pinia) {
        order.push(`hydrate:start:${pinia}`)
        await Promise.resolve()
        order.push('hydrate:end')
        return {}
      },
      async initializeSync({ pinia }) {
        order.push(`sync:init:${pinia}`)
        return { queueService: {}, tracker: {} }
      },
      routerFactory() {
        order.push('router:created')
        return 'router-plugin'
      },
      rootComponent: {},
    })

    expect(order).toEqual([
      'app:created',
      'pinia:created',
      'pinia:installed',
      'hydrate:start:pinia-plugin',
      'hydrate:end',
      'sync:init:pinia-plugin',
      'router:created',
      'router:installed',
      'mount:#app',
    ])
  })
})

describe('P8 sqlite adapter transaction flag', () => {
  beforeEach(() => {
    fakeDb.run.mockClear()
    fakeDb.beginTransaction.mockClear()
    fakeDb.commitTransaction.mockClear()
  })

  it('saveBusiness menjalankan db.run dengan transaction flag false', async () => {
    const adapter = createSQLiteAdapter()

    await adapter.saveBusiness({
      name: 'Toko ABC',
      type: 'Cafe',
      owner: 'Admin',
      phone: '08123456789',
      outlet: 'Outlet Utama',
      mode: 'free',
    })

    expect(fakeDb.beginTransaction).toHaveBeenCalledTimes(1)
    expect(fakeDb.commitTransaction).toHaveBeenCalledTimes(1)
    expect(fakeDb.run.mock.calls.length).toBeGreaterThan(0)
    for (const args of fakeDb.run.mock.calls) {
      expect(args[2]).toBe(false)
    }
  })

  it('saveProducts menjalankan semua db.run dengan transaction flag false', async () => {
    const adapter = createSQLiteAdapter()

    await adapter.saveProducts(
      [
        {
          id: 'p1',
          name: 'Kopi',
          category: 'Minuman',
          price: 20000,
          stock: 5,
          isActive: true,
        },
      ],
      ['Minuman'],
    )

    expect(fakeDb.beginTransaction).toHaveBeenCalledTimes(1)
    expect(fakeDb.commitTransaction).toHaveBeenCalledTimes(1)
    expect(fakeDb.run.mock.calls.length).toBeGreaterThan(0)
    for (const args of fakeDb.run.mock.calls) {
      expect(args[2]).toBe(false)
    }
  })

  it('saveCustomers menjalankan db.run dengan transaction flag false', async () => {
    const adapter = createSQLiteAdapter()

    await adapter.saveCustomers([
      { id: 'c1', name: 'Budi', phone: '08111111111', email: 'budi@example.com' },
    ])

    expect(fakeDb.beginTransaction).toHaveBeenCalledTimes(1)
    expect(fakeDb.commitTransaction).toHaveBeenCalledTimes(1)
    expect(fakeDb.run.mock.calls.length).toBeGreaterThan(0)
    for (const args of fakeDb.run.mock.calls) {
      expect(args[2]).toBe(false)
    }
  })

  it('saveExpenses menjalankan db.run dengan transaction flag false', async () => {
    const adapter = createSQLiteAdapter()

    await adapter.saveExpenses([
      {
        id: 'e1',
        title: 'Listrik',
        category: 'Operasional',
        amount: 150000,
        note: '',
        createdAt: '2026-08-21T00:00:00.000Z',
      },
    ])

    expect(fakeDb.beginTransaction).toHaveBeenCalledTimes(1)
    expect(fakeDb.commitTransaction).toHaveBeenCalledTimes(1)
    expect(fakeDb.run.mock.calls.length).toBeGreaterThan(0)
    for (const args of fakeDb.run.mock.calls) {
      expect(args[2]).toBe(false)
    }
  })

  it('saveTransactions menjalankan db.run dengan transaction flag false', async () => {
    const adapter = createSQLiteAdapter()

    await adapter.saveTransactions([
      { id: 't1', items: 2, total: 50000, createdAt: '2026-08-21T00:00:00.000Z' },
    ])

    expect(fakeDb.beginTransaction).toHaveBeenCalledTimes(1)
    expect(fakeDb.commitTransaction).toHaveBeenCalledTimes(1)
    expect(fakeDb.run.mock.calls.length).toBeGreaterThan(0)
    for (const args of fakeDb.run.mock.calls) {
      expect(args[2]).toBe(false)
    }
  })
})

describe('P8 native sqlite plugin fallback', () => {
  it('web/test tanpa native memakai memory adapter tanpa console.error', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const createSQLite = vi.fn(async () => ({ name: 'sqlite' }))

    const adapter = await resolvePersistenceAdapter({
      isNativePlatform: false,
      isPluginAvailable: false,
      createMemory: createMemoryAdapter,
      createSQLite,
    })

    expect(adapter.name).toBe('memory')
    expect(createSQLite).not.toHaveBeenCalled()
    expect(consoleError).not.toHaveBeenCalled()
  })

  it('native tanpa plugin sqlite memakai memory adapter dan console.error sekali', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const createSQLite = vi.fn(async () => ({ name: 'sqlite' }))

    const adapter = await resolvePersistenceAdapter({
      isNativePlatform: true,
      isPluginAvailable: false,
      createMemory: createMemoryAdapter,
      createSQLite,
    })

    expect(adapter.name).toBe('memory')
    expect(createSQLite).not.toHaveBeenCalled()
    expect(consoleError).toHaveBeenCalledTimes(1)
    expect(consoleError.mock.calls[0][0]).toContain(
      'CapacitorSQLite is unavailable on native platform',
    )
  })

  it('native dengan plugin sqlite memakai adapter sqlite tanpa console.error', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const sqliteAdapter = { name: 'sqlite' }
    const createSQLite = vi.fn(async () => sqliteAdapter)

    const adapter = await resolvePersistenceAdapter({
      isNativePlatform: true,
      isPluginAvailable: true,
      createMemory: createMemoryAdapter,
      createSQLite,
    })

    expect(createSQLite).toHaveBeenCalledTimes(1)
    expect(adapter).toBe(sqliteAdapter)
    expect(consoleError).not.toHaveBeenCalled()
  })
})
