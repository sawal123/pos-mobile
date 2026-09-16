import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { bootstrapApp } from '@/main'
import { initializePersistence, resolvePersistenceAdapter } from '@/services/database'
import { createMemoryAdapter } from '@/services/database/memoryAdapter'
import { createPersistenceService } from '@/services/database/persistenceService'
import { createSQLiteAdapter, deserializeTransactionRows } from '@/services/database/sqliteAdapter'
import { DB_VERSION } from '@/services/database/schema'
import { useBusinessStore } from '@/stores/businessStore'
import { useCartStore } from '@/stores/cartStore'
import { useCashStore } from '@/stores/cashStore'
import { useCashierStore } from '@/stores/cashierStore'
import { useCustomerStore } from '@/stores/customerStore'
import { useExpenseStore } from '@/stores/expenseStore'
import { useProductStore } from '@/stores/productStore'
import { useShiftStore } from '@/stores/shiftStore'
import { useTransactionStore } from '@/stores/transactionStore'

const { fakeDb, nativeState } = vi.hoisted(() => {
  const state = {
    version: 0,
    business: null,
    categories: [],
    products: [],
    customers: [],
    expenses: [],
    transactions: [],
    meta: new Map(),
    appState: new Map(),
    reset() {
      this.version = 0
      this.business = null
      this.categories = []
      this.products = []
      this.customers = []
      this.expenses = []
      this.transactions = []
      this.meta.clear()
      this.appState.clear()
    },
  }

  const fakeDb = {
    beginTransaction: vi.fn(async () => {}),
    commitTransaction: vi.fn(async () => {}),
    rollbackTransaction: vi.fn(async () => {}),
    run: vi.fn(async (sql, values = []) => {
      const normalized = sql.replace(/\s+/g, ' ').trim()

      if (normalized.startsWith('DELETE FROM business')) state.business = null
      else if (normalized.startsWith('DELETE FROM categories')) state.categories = []
      else if (normalized.startsWith('DELETE FROM products')) state.products = []
      else if (normalized.startsWith('DELETE FROM customers')) state.customers = []
      else if (normalized.startsWith('DELETE FROM expenses')) state.expenses = []
      else if (normalized.startsWith('DELETE FROM transactions')) state.transactions = []
      else if (normalized.startsWith('INSERT INTO business')) {
        state.business = {
          name: values[1], type: values[2], owner: values[3], phone: values[4],
          outlet: values[5], mode: values[6],
        }
      } else if (normalized.startsWith('INSERT INTO categories')) {
        state.categories.push({ name: values[0] })
      } else if (normalized.startsWith('INSERT INTO products')) {
        state.products.push({
          id: values[0], name: values[1], category: values[2], sku: values[3],
          cost: values[4], price: values[5], stock: values[6], unit: values[7],
          min_stock: values[8], kind: values[9], pricing_unit: values[10],
          min_quantity: values[11], estimated_duration: values[12], image_data: values[13],
          is_active: values[14],
        })
      } else if (normalized.startsWith('INSERT INTO customers')) {
        state.customers.push({ id: values[0], name: values[1], phone: values[2], email: values[3] })
      } else if (normalized.startsWith('INSERT INTO expenses')) {
        state.expenses.push({
          id: values[0], title: values[1], category: values[2], amount: values[3],
          note: values[4], created_at: values[5],
        })
      } else if (normalized.startsWith('INSERT INTO transactions')) {
        state.transactions.push({ id: values[0], payload: values[1], created_at: values[2] })
      } else if (normalized.startsWith('INSERT OR REPLACE INTO app_meta')) {
        state.meta.set(values[0], values[1])
      } else if (normalized.startsWith('INSERT OR REPLACE INTO app_state')) {
        state.appState.set(values[0], values[1])
      }

      return { changes: { changes: 1 } }
    }),
    query: vi.fn(async (sql, values = []) => {
      const normalized = sql.replace(/\s+/g, ' ').trim()

      if (normalized.includes('PRAGMA user_version')) {
        return { values: [{ user_version: state.version }] }
      }
      if (normalized.includes('FROM app_meta')) {
        return { values: state.meta.has(values[0]) ? [{ value: state.meta.get(values[0]) }] : [] }
      }
      if (normalized.includes('FROM app_state')) {
        return { values: state.appState.has(values[0]) ? [{ value: state.appState.get(values[0]) }] : [] }
      }
      if (normalized.includes('FROM business')) return { values: state.business ? [state.business] : [] }
      if (normalized.includes('FROM categories')) return { values: [...state.categories] }
      if (normalized.includes('FROM products')) return { values: [...state.products] }
      if (normalized.includes('FROM customers')) return { values: [...state.customers] }
      if (normalized.includes('FROM expenses')) return { values: [...state.expenses] }
      if (normalized.includes('FROM transactions')) return { values: [...state.transactions] }
      return { values: [] }
    }),
    execute: vi.fn(async (sql) => {
      const match = /PRAGMA user_version\s*=\s*(\d+)/.exec(sql)
      if (match) state.version = Number(match[1])
    }),
    isDBOpen: async () => ({ result: true }),
    open: async () => {},
    close: async () => {},
  }

  return { fakeDb, nativeState: state }
})

vi.mock('@capacitor-community/sqlite', () => {
  class SQLiteConnection {
    async addUpgradeStatement() {}

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
    cashStore: useCashStore(),
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

async function initializeNativeRuntime() {
  return initializeRuntime(createSQLiteAdapter())
}

async function reopenNativeRuntime(runtime) {
  await runtime.service.close()
  return initializeNativeRuntime()
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
  nativeState.reset()
  fakeDb.run.mockClear()
  fakeDb.query.mockClear()
  fakeDb.execute.mockClear()
  fakeDb.beginTransaction.mockClear()
  fakeDb.commitTransaction.mockClear()
  fakeDb.rollbackTransaction.mockClear()
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

  it('cash ledger persist', async () => {
    const adapter = createMemoryAdapter()
    const runtime = await initializeRuntime(adapter)

    runtime.cashStore.recordEntry({
      type: 'in',
      amount: 100000,
      category: 'Modal',
      note: 'Modal awal',
    })
    runtime.cashStore.recordEntry({
      type: 'out',
      amount: 25000,
      category: 'Listrik',
      note: 'Token listrik',
    })
    await runtime.service.flush()

    const hydrated = await restartRuntime(adapter)

    expect(hydrated.cashStore.entries).toHaveLength(2)
    expect(hydrated.cashStore.balance).toBe(75000)
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

  it('native SQLite preserves complete product fields and imageData after reopen', async () => {
    let runtime = await initializeNativeRuntime()
    runtime.productStore.$patch({ products: [], categories: [], stockMovements: [] })
    runtime.productStore.createCategory('Laundry')
    const created = runtime.productStore.createProduct({
      name: 'Cuci Premium',
      category: 'Laundry',
      sku: 'LDR-001',
      cost: 4500,
      price: 12000,
      stock: 0,
      unit: 'kg',
      minStock: 0,
      kind: 'service',
      pricingUnit: 'kg',
      minQuantity: 1.5,
      estimatedDuration: '2 hari',
      imageData: 'data:image/webp;base64,cHJvZHVjdC1pbWFnZQ==',
      isActive: false,
    })
    expect(created.success).toBe(true)

    await runtime.service.flush()
    runtime = await reopenNativeRuntime(runtime)

    expect(runtime.productStore.getProductById(created.product.id)).toMatchObject({
      name: 'Cuci Premium',
      category: 'Laundry',
      sku: 'LDR-001',
      cost: 4500,
      price: 12000,
      stock: 0,
      unit: 'kg',
      minStock: 0,
      kind: 'service',
      pricingUnit: 'kg',
      minQuantity: 1.5,
      estimatedDuration: '2 hari',
      imageData: 'data:image/webp;base64,cHJvZHVjdC1pbWFnZQ==',
      isActive: false,
    })
  })

  it('native SQLite preserves retail transaction, stock movement, cash, and HPP after reopen', async () => {
    let runtime = await initializeNativeRuntime()
    runtime.productStore.$patch({
      products: [{
        id: 'retail-1', name: 'Beras', category: 'Grosir', sku: 'BRS-01', cost: 7000,
        price: 10000, stock: 10, unit: 'pcs', minStock: 2, kind: 'product',
        pricingUnit: 'pcs', minQuantity: 0, estimatedDuration: '', imageData: '', isActive: true,
      }],
      categories: ['Grosir'],
      stockMovements: [],
    })
    runtime.transactionStore.$patch({ items: [], lastTransaction: null })
    runtime.cashStore.$patch({ entries: [] })

    const paidAt = '2026-09-16T10:30:00.000Z'
    const transaction = runtime.transactionStore.createTransaction({
      customer: 'Budi',
      customerId: 'customer-1',
      customerSnapshot: { id: 'customer-1', name: 'Budi', phone: '08123', email: 'budi@example.com' },
      businessSnapshot: { name: 'Grosir QA', outlet: 'Utama', type: 'Grosir' },
      items: [{ id: 'retail-1', name: 'Beras', qty: 2, price: 10000, hppSnapshot: 7000 }],
      subtotal: 20000,
      tax: 0,
      total: 20000,
      paymentStatus: 'paid',
      paymentMethod: 'CASH',
      cashReceived: 25000,
      changeAmount: 5000,
      paidAt,
      createdAt: '2026-09-16T10:29:00.000Z',
    })
    runtime.productStore.recordSaleStock(transaction.items, transaction.id)
    runtime.cashStore.recordSalePayment(transaction)
    await runtime.service.flush()

    runtime = await reopenNativeRuntime(runtime)
    const hydrated = runtime.transactionStore.items.find(({ id }) => id === transaction.id)

    expect(runtime.productStore.getProductById('retail-1').stock).toBe(8)
    expect(runtime.productStore.stockMovements).toEqual([
      expect.objectContaining({
        productId: 'retail-1', quantityChange: -2, stockBefore: 10, stockAfter: 8,
        type: 'sale', referenceId: transaction.id,
      }),
    ])
    expect(hydrated).toMatchObject({
      paidAt,
      paymentMethod: 'CASH',
      grossProfit: 6000,
      customerSnapshot: { id: 'customer-1', name: 'Budi' },
      businessSnapshot: { name: 'Grosir QA', outlet: 'Utama' },
      total: 20000,
    })
    expect(hydrated.items[0]).toMatchObject({ hppSnapshot: 7000, costSnapshot: 7000 })
    expect(runtime.cashStore.entries).toEqual([
      expect.objectContaining({ referenceId: `sale-${transaction.id}`, amount: 20000 }),
    ])
  })

  it('native SQLite preserves Laundry unpaid order, settlement, and cash idempotency across reopen', async () => {
    let runtime = await initializeNativeRuntime()
    runtime.transactionStore.$patch({ items: [], lastTransaction: null })
    runtime.cashStore.$patch({ entries: [] })

    const createdAt = '2026-09-16T08:00:00.000Z'
    const order = runtime.transactionStore.createLaundryOrder({
      id: 'laundry-order-1',
      orderNumber: 'LDR-20260916-0001',
      customerId: 'customer-laundry-1',
      customerSnapshot: { id: 'customer-laundry-1', name: 'Sari', phone: '08124', email: '' },
      businessSnapshot: { name: 'Laundry QA', outlet: 'Utama', type: 'Laundry' },
      items: [
        { serviceId: 'service-kg', serviceName: 'Cuci Kering', qty: 2.5, unitPrice: 10000, hppSnapshot: 4000, pricingUnit: 'kg', kind: 'service' },
        { serviceId: 'service-pcs', serviceName: 'Bed Cover', qty: 2, unitPrice: 15000, hppSnapshot: 6000, pricingUnit: 'pcs', kind: 'service' },
      ],
      paymentStatus: 'unpaid',
      paidAt: null,
      orderStatus: 'Masuk',
      estimatedCompletedAt: '2026-09-18T08:00:00.000Z',
      note: 'Gunakan pewangi lembut',
      createdAt,
    })
    await runtime.service.flush()

    runtime = await reopenNativeRuntime(runtime)
    let hydrated = runtime.transactionStore.items.find(({ id }) => id === order.id)
    expect(hydrated).toMatchObject({
      orderNumber: 'LDR-20260916-0001',
      paymentStatus: 'unpaid',
      paidAt: null,
      orderStatus: 'Masuk',
      estimatedCompletedAt: '2026-09-18T08:00:00.000Z',
      note: 'Gunakan pewangi lembut',
      createdAt,
      customerSnapshot: { id: 'customer-laundry-1', name: 'Sari' },
      businessSnapshot: { name: 'Laundry QA', type: 'Laundry' },
      grossProfit: 33000,
    })
    expect(hydrated.items.map(({ qty, pricingUnit, hppSnapshot }) => ({ qty, pricingUnit, hppSnapshot }))).toEqual([
      { qty: 2.5, pricingUnit: 'kg', hppSnapshot: 4000 },
      { qty: 2, pricingUnit: 'pcs', hppSnapshot: 6000 },
    ])

    const settlement = runtime.transactionStore.settleLaundryOrderPayment({
      orderId: order.id,
      paymentMethod: 'cash',
      cashReceived: 60000,
      changeAmount: 5000,
      cashStore: runtime.cashStore,
    })
    expect(settlement.success).toBe(true)
    const paidAt = settlement.order.paidAt
    await runtime.service.flush()

    runtime = await reopenNativeRuntime(runtime)
    hydrated = runtime.transactionStore.items.find(({ id }) => id === order.id)
    expect(hydrated).toMatchObject({
      paymentStatus: 'paid', paymentMethod: 'cash', paidAt, cashReceived: 60000, changeAmount: 5000,
    })
    expect(runtime.cashStore.entries.filter(({ referenceId }) => referenceId === `sale-${order.id}`)).toEqual([
      expect.objectContaining({ amount: 55000 }),
    ])

    const retry = runtime.transactionStore.settleLaundryOrderPayment({
      orderId: order.id,
      paymentMethod: 'cash',
      cashReceived: 60000,
      cashStore: runtime.cashStore,
    })
    expect(retry).toMatchObject({ success: true, duplicated: true })
    expect(retry.order.paidAt).toBe(paidAt)
    expect(runtime.cashStore.entries.filter(({ referenceId }) => referenceId === `sale-${order.id}`)).toHaveLength(1)
  })

  it('native SQLite preserves opening balance, manual entry, and calculated cash balance', async () => {
    let runtime = await initializeNativeRuntime()
    runtime.cashStore.$patch({ entries: [] })
    runtime.cashStore.recordOpeningBalance(100000, 'shift-1')
    runtime.cashStore.recordEntry({ type: 'out', amount: 25000, category: 'Operasional', referenceId: 'manual-1' })
    await runtime.service.flush()

    runtime = await reopenNativeRuntime(runtime)

    expect(runtime.cashStore.entries).toHaveLength(2)
    expect(runtime.cashStore.entries.map(({ referenceId }) => referenceId)).toEqual(
      expect.arrayContaining(['opening-shift-1', 'manual-1']),
    )
    expect(runtime.cashStore.balance).toBe(75000)
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

  it('saveProducts menyimpan imageData ke SQLite', async () => {
    const adapter = createSQLiteAdapter()

    await adapter.saveProducts(
      [
        {
          id: 'p1',
          name: 'Kopi',
          category: 'Minuman',
          price: 20000,
          stock: 5,
          imageData: 'data:image/webp;base64,abc',
          isActive: true,
        },
      ],
      ['Minuman'],
    )

    const insertProductCall = fakeDb.run.mock.calls.find(([sql]) => sql.includes('INSERT INTO products'))

    expect(insertProductCall[0]).toContain('image_data')
    expect(insertProductCall[1]).toContain('data:image/webp;base64,abc')
  })

  it('loadProducts membaca imageData dari SQLite', async () => {
    fakeDb.query
      .mockImplementationOnce(async () => ({ values: [{ name: 'Minuman' }] }))
      .mockImplementationOnce(async () => ({
        values: [
          {
            id: 'p1',
            name: 'Kopi',
            category: 'Minuman',
            sku: '',
            cost: 0,
            price: 20000,
            stock: 5,
            unit: 'pcs',
            min_stock: 0,
            kind: 'product',
            pricing_unit: 'pcs',
            min_quantity: 0,
            estimated_duration: '',
            image_data: 'data:image/webp;base64,abc',
            is_active: 1,
          },
        ],
      }))
      .mockImplementationOnce(async () => ({ values: [] }))

    const adapter = createSQLiteAdapter()
    const loaded = await adapter.loadProducts()

    expect(loaded.products[0].imageData).toBe('data:image/webp;base64,abc')
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

  it('native SQLite initialization failure falls back to memory with explicit error', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const sqliteError = new Error('SQLite open failed')
    const sqliteAdapter = {
      name: 'sqlite',
      initialize: vi.fn().mockRejectedValue(sqliteError),
    }
    const pinia = createPinia()

    const service = await initializePersistence(pinia, { adapter: sqliteAdapter })

    expect(service.adapter.name).toBe('memory')
    expect(consoleError).toHaveBeenCalledWith(
      'Failed to initialize persistence adapter. Falling back to memory adapter.',
      sqliteError,
    )
  })

  it('memory initialization failure is not hidden behind another fallback', async () => {
    const memoryError = new Error('Memory initialization failed')
    const memoryAdapter = {
      name: 'memory',
      initialize: vi.fn().mockRejectedValue(memoryError),
    }
    vi.spyOn(console, 'error').mockImplementation(() => {})

    await expect(
      initializePersistence(createPinia(), { adapter: memoryAdapter }),
    ).rejects.toThrow(memoryError)
  })
})
