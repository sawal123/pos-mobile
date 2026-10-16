/**
 * Native SQLite transaction concurrency — root cause + regression.
 *
 * The harness below is a faithful emulation of the
 * `@capacitor-community/sqlite` connection semantics that produced the Android
 * error `Run: Failed in beginTransactionAlready in transaction`:
 *
 *  - `beginTransaction()` throws when a transaction is already active,
 *  - `commitTransaction()` throws when no transaction is active,
 *  - `run()/query()/execute()` take a `transaction` parameter (default `true`)
 *    and open their own BEGIN/COMMIT when it is true,
 *  - an implicit BEGIN while an explicit transaction is open throws the exact
 *    plugin message, and the failed statement's rollback clears the active flag
 *    (which is why the following COMMIT reports "no current transaction").
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

import { createSQLiteAdapter } from '@/services/database/sqliteAdapter'
import { createPersistenceService } from '@/services/database/persistenceService'
import { createLocalOperationService } from '@/services/database/localOperationService'
import { DB_VERSION } from '@/services/database/schema'
import {
  LOCAL_WORKSPACE_ID,
  cloudWorkspaceId,
  switchOperationalWorkspace,
} from '@/services/cloud/businessWorkspaceService'
import { useCashStore } from '@/stores/cashStore'
import { useProductStore } from '@/stores/productStore'
import { useTransactionStore } from '@/stores/transactionStore'

const BEGIN_ALREADY = 'Run: Failed in beginTransactionAlready in transaction'
const COMMIT_NONE =
  'CommitTransaction: Cannot perform this operation because there is no current transaction'

const { fakeDb, nativeState } = vi.hoisted(() => {
  const state = {
    version: 0,
    transactionActive: false,
    // Instrumentation: every low-level call with its `transaction` argument.
    calls: [],
    business: null,
    categories: [],
    products: [],
    customers: [],
    expenses: [],
    transactions: [],
    syncQueue: [],
    meta: new Map(),
    appState: new Map(),
    reset() {
      this.version = 0
      this.transactionActive = false
      this.calls = []
      this.business = null
      this.categories = []
      this.products = []
      this.customers = []
      this.expenses = []
      this.transactions = []
      this.syncQueue = []
      this.meta.clear()
      this.appState.clear()
    },
  }

  function applyStatement(sql, values = []) {
    const normalized = sql.replace(/\s+/g, ' ').trim()

    if (normalized.startsWith('DELETE FROM business')) state.business = null
    else if (normalized.startsWith('DELETE FROM categories')) state.categories = []
    else if (normalized.startsWith('DELETE FROM products')) state.products = []
    else if (normalized.startsWith('DELETE FROM customers')) state.customers = []
    else if (normalized.startsWith('DELETE FROM expenses')) state.expenses = []
    else if (normalized.startsWith('DELETE FROM transactions')) state.transactions = []
    else if (normalized.startsWith('DELETE FROM sync_queue')) state.syncQueue = []
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
        min_quantity: values[11], estimated_duration: values[12],
        image_data: values[13], is_active: values[14],
      })
    } else if (normalized.startsWith('INSERT INTO transactions')) {
      state.transactions.push({ id: values[0], payload: values[1], created_at: values[2] })
    } else if (normalized.startsWith('INSERT INTO customers')) {
      state.customers.push({ id: values[0], name: values[1], phone: values[2], email: values[3] })
    } else if (normalized.startsWith('INSERT INTO expenses')) {
      state.expenses.push({ id: values[0], title: values[1] })
    } else if (normalized.startsWith('INSERT INTO sync_queue')) {
      state.syncQueue.push({ id: values[0], entity_type: values[1], entity_id: values[2] })
    } else if (normalized.startsWith('INSERT OR REPLACE INTO app_meta')) {
      state.meta.set(values[0], values[1])
    } else if (normalized.startsWith('INSERT OR REPLACE INTO app_state')) {
      state.appState.set(values[0], values[1])
    } else if (normalized.startsWith('DELETE FROM app_meta')) {
      const key = values.length > 0 ? values[0] : /key = '([^']+)'/.exec(normalized)?.[1]
      if (key) state.meta.delete(key)
    } else if (normalized.startsWith('DELETE FROM sync_queue')) {
      state.syncQueue = []
    }
  }

  function readStatement(sql, values = []) {
    const normalized = sql.replace(/\s+/g, ' ').trim()

    if (normalized.includes('PRAGMA user_version')) return { values: [{ user_version: state.version }] }
    if (normalized.includes('COUNT(*) AS total FROM sync_queue')) {
      return { values: [{ total: state.syncQueue.length }] }
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
    if (normalized.includes('FROM sync_queue')) return { values: [...state.syncQueue] }
    return { values: [] }
  }

  const record = (kind, transaction) => state.calls.push({ kind, transaction })

  const fakeDb = {
    beginTransaction: vi.fn(async () => {
      if (state.transactionActive) throw new Error(`Failed in beginTransactionAlready in transaction`)
      state.transactionActive = true
    }),
    commitTransaction: vi.fn(async () => {
      if (!state.transactionActive) throw new Error(COMMIT_NONE)
      state.transactionActive = false
    }),
    rollbackTransaction: vi.fn(async () => {
      state.transactionActive = false
    }),
    run: vi.fn(async (sql, values = [], transaction = true) => {
      record('run', transaction)

      if (transaction) {
        if (state.transactionActive) {
          // The plugin fails the statement and clears the active flag, which is
          // what later makes the owner's COMMIT report "no current transaction".
          state.transactionActive = false
          throw new Error(BEGIN_ALREADY)
        }
        state.transactionActive = true
      }

      applyStatement(sql, values)

      if (transaction) {
        state.transactionActive = false
      }

      return { changes: { changes: 1 } }
    }),
    query: vi.fn(async (sql, values = [], transaction = true) => {
      record('query', transaction)

      if (transaction) {
        if (state.transactionActive) {
          state.transactionActive = false
          throw new Error(BEGIN_ALREADY.replace('Run:', 'Query:'))
        }
        state.transactionActive = true
      }

      const result = readStatement(sql, values)

      if (transaction) {
        state.transactionActive = false
      }

      return result
    }),
    execute: vi.fn(async (sql, transaction = true) => {
      record('execute', transaction)

      if (transaction) {
        if (state.transactionActive) {
          state.transactionActive = false
          throw new Error(BEGIN_ALREADY.replace('Run:', 'Execute:'))
        }
        state.transactionActive = true
      }

      const match = /PRAGMA user_version\s*=\s*(\d+)/.exec(sql)
      if (match) state.version = Number(match[1])

      if (transaction) {
        state.transactionActive = false
      }
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
  return { CapacitorSQLite: {}, SQLiteConnection }
})

async function openAdapter() {
  const adapter = createSQLiteAdapter()
  await adapter.initialize()
  return adapter
}

beforeEach(() => {
  nativeState.reset()
  fakeDb.run.mockClear()
  fakeDb.query.mockClear()
  fakeDb.execute.mockClear()
  fakeDb.beginTransaction.mockClear()
  fakeDb.commitTransaction.mockClear()
  fakeDb.rollbackTransaction.mockClear()
})

// ════════════════════════════════════════════════════════════════════════════
// Harness sanity — proves the emulator reproduces the native failure mode
// ════════════════════════════════════════════════════════════════════════════

describe('plugin emulator faithfully reproduces the native failure mode', () => {
  it('an implicit transaction during an explicit transaction throws the plugin error', async () => {
    const adapter = createSQLiteAdapter()
    const db = await adapter.initialize().then(() => null) // ensureConnection side effect
    void db

    // Drive the low-level fake directly, exactly like the plugin would.
    await fakeDb.beginTransaction()
    await expect(fakeDb.run('INSERT OR REPLACE INTO app_meta (key, value) VALUES (?, ?)', ['k', 'v']))
      .rejects.toThrow(BEGIN_ALREADY)
    // The failed statement cleared the active flag -> the owner's commit fails.
    await expect(fakeDb.commitTransaction()).rejects.toThrow(COMMIT_NONE)
  })
})

// ════════════════════════════════════════════════════════════════════════════
// 1. Root cause invariant: no implicit transactions on the shared connection
// ════════════════════════════════════════════════════════════════════════════

describe('1. adapter never lets the plugin manage an implicit transaction', () => {
  it('passes transaction=false on every low-level run/query/execute', async () => {
    const adapter = await openAdapter()

    // Exercise a read, a write, a bulk write, an explicit transaction and a
    // clear operation.
    await adapter.loadBusiness()
    await adapter.saveDeviceIdentifier('dev-1')
    await adapter.saveTransactions([{ id: 't1', total: 1000, createdAt: new Date().toISOString() }])
    await adapter.upsertSyncQueueItem({
      id: 'q1',
      entityType: 'product',
      entityId: 'p1',
      operation: 'upsert',
      payload: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })
    await adapter.saveLocalOperationJournal({ version: 1, entries: [] })
    await adapter.clearLocalOperationJournal?.()

    expect(nativeState.calls.length).toBeGreaterThan(0)
    const implicit = nativeState.calls.filter((call) => call.transaction !== false)
    expect(implicit).toEqual([])
  })

  it('still runs every read inside an open explicit transaction', async () => {
    const adapter = await openAdapter()

    // saveProducts opens an explicit transaction and performs a read
    // (stockMovements) inside it.
    await adapter.saveProducts(
      [{ id: 'p1', name: 'Kopi', category: 'Minuman', price: 1000, stock: 1, isActive: true }],
      ['Minuman'],
      [],
    )

    expect(nativeState.transactionActive).toBe(false)
    const { products } = await adapter.loadProducts()
    expect(products.map((p) => p.id)).toEqual(['p1'])
  })
})

// ════════════════════════════════════════════════════════════════════════════
// 2. Concurrent writes are serialized (no nested begin)
// ════════════════════════════════════════════════════════════════════════════

describe('2. concurrent writes never nest transactions', () => {
  it('serializes an explicit transaction and a standalone meta write', async () => {
    const adapter = await openAdapter()

    const results = await Promise.all([
      adapter.saveTransactions([{ id: 't1', total: 1000, createdAt: new Date().toISOString() }]),
      adapter.saveLocalOperationJournal({ version: 1, entries: [{ operationId: 'op-1', status: 'pending' }] }),
      adapter.saveCustomers([{ id: 'c1', name: 'Budi', phone: '', email: '' }]),
      adapter.saveDeviceIdentifier('dev-2'),
    ])

    expect(results).toHaveLength(4)
    expect(nativeState.transactionActive).toBe(false)
    expect(nativeState.transactions).toHaveLength(1)
    expect(nativeState.customers).toHaveLength(1)
  })

  it('serializes three overlapping explicit transactions', async () => {
    const adapter = await openAdapter()

    await Promise.all([
      adapter.saveProducts([{ id: 'p1', name: 'A', category: 'C', price: 1, stock: 1, isActive: true }], ['C']),
      adapter.saveProducts([{ id: 'p2', name: 'B', category: 'C', price: 2, stock: 2, isActive: true }], ['C']),
      adapter.saveTransactions([{ id: 't2', total: 3, createdAt: new Date().toISOString() }]),
    ])

    expect(nativeState.transactionActive).toBe(false)
    // The last writer wins for the products table, and no begin ever nested.
    expect(fakeDb.beginTransaction.mock.calls.length).toBeGreaterThan(0)
  })
})

// ════════════════════════════════════════════════════════════════════════════
// 3-5. Failure isolation and recovery
// ════════════════════════════════════════════════════════════════════════════

describe('3. a failing operation never rolls back another operation', () => {
  it('rolls back only its own transaction when a write inside it fails', async () => {
    const adapter = await openAdapter()
    await adapter.saveTransactions([{ id: 'keep', total: 1, createdAt: new Date().toISOString() }])

    const failing = Object.assign({}, adapter, {})
    // Force a failure inside the transaction by making one insert throw.
    const originalRun = fakeDb.run.getMockImplementation()
    let calls = 0
    fakeDb.run.mockImplementation(async (sql, values = [], transaction = true) => {
      calls += 1
      if (String(sql).includes('INSERT INTO customers') && calls > 1) {
        throw new Error('insert failed')
      }
      return originalRun(sql, values, transaction)
    })

    await expect(
      failing.saveCustomers([
        { id: 'c1', name: 'A', phone: '', email: '' },
        { id: 'c2', name: 'B', phone: '', email: '' },
      ]),
    ).rejects.toThrow()

    fakeDb.run.mockImplementation(originalRun)

    // The previously committed transaction is intact.
    expect(nativeState.transactions.map((t) => t.id)).toEqual(['keep'])
    expect(nativeState.transactionActive).toBe(false)
  })
})

describe('4 + 5. a rollback leaves the connection usable', () => {
  it('a later transaction succeeds after a rolled back one', async () => {
    const adapter = await openAdapter()
    const originalRun = fakeDb.run.getMockImplementation()

    fakeDb.run.mockImplementationOnce(async () => {
      throw new Error('boom')
    })

    await expect(adapter.saveCustomers([{ id: 'c1', name: 'A', phone: '', email: '' }])).rejects.toThrow()

    fakeDb.run.mockImplementation(originalRun)

    expect(nativeState.transactionActive).toBe(false)

    await adapter.saveCustomers([{ id: 'c2', name: 'B', phone: '', email: '' }])
    expect(nativeState.customers.map((c) => c.id)).toEqual(['c2'])
  })
})

// ════════════════════════════════════════════════════════════════════════════
// 6-8. Sale durability (cash / qris / card), stock and cash ledger
// ════════════════════════════════════════════════════════════════════════════

describe('6 + 7 + 8. sale commit is durable and consistent', () => {
  it('commits a cash sale exactly once', async () => {
    const adapter = await openAdapter()
    await adapter.saveBusiness({
      name: 'Demo', type: 'Cafe', owner: '', phone: '', outlet: 'Outlet Utama', mode: 'free',
    })

    await adapter.saveLocalOperationJournal({
      version: 1,
      entries: [{ operationId: 'op-1', operationType: 'retail_sale', status: 'pending', phase: 'journal_saved' }],
    })
    await adapter.saveTransactions([{ id: 'op-1', total: 24000, createdAt: new Date().toISOString() }])
    await adapter.replaceSyncQueueItems([{ id: 'q1', entityType: 'transaction', entityId: 'op-1', operation: 'upsert' }])
    await adapter.saveLocalOperationJournal({ version: 1, entries: [] })

    expect(nativeState.transactions.map((t) => t.id)).toEqual(['op-1'])
    expect(nativeState.meta.get('local_operation_journal_v1')).toBe('{"version":1,"entries":[]}')
    expect(await adapter.loadLocalOperationJournal()).toEqual({ version: 1, entries: [] })
    expect(nativeState.transactionActive).toBe(false)
  })

  it('keeps non-cash sales out of the cash ledger and the schema version stable', async () => {
    const adapter = await openAdapter()
    expect(await adapter.getSchemaVersion()).toBe(DB_VERSION)

    await adapter.saveTransactions([
      { id: 'qris-1', total: 15000, paymentMethod: 'qris', createdAt: new Date().toISOString() },
      { id: 'card-1', total: 25000, paymentMethod: 'card', createdAt: new Date().toISOString() },
    ])

    expect(nativeState.transactions).toHaveLength(2)
    expect(nativeState.appState.has('cash_state')).toBe(false)
    expect(await adapter.getSchemaVersion()).toBe(DB_VERSION)
  })
})

// ════════════════════════════════════════════════════════════════════════════
// End-to-end: the real P38 sale commit over the real SQLite adapter
// ════════════════════════════════════════════════════════════════════════════

describe('end-to-end sale commit over the SQLite adapter', () => {
  async function makeRuntime() {
    const pinia = createPinia()
    setActivePinia(pinia)

    const adapter = createSQLiteAdapter()
    const scheduler = createPersistenceService({ adapter, pinia })
    await scheduler.initialize()

    const productStore = useProductStore(pinia)
    productStore.createCategory('Minuman')
    const created = productStore.createProduct({
      name: 'Es Kopi Susu',
      category: 'Minuman',
      price: 22000,
      stock: 10,
      isActive: true,
    })

    const localOperations = createLocalOperationService({ adapter, scheduler, pinia })

    return {
      pinia,
      adapter,
      scheduler,
      productStore,
      product: created.product,
      localOperations,
      transactionStore: useTransactionStore(pinia),
      cashStore: useCashStore(pinia),
    }
  }

  function makeCheckout(product, { paymentMethod = 'cash' } = {}) {
    const isCash = paymentMethod === 'cash'
    return {
      items: [{ ...product, qty: 1 }],
      subtotal: 22000,
      tax: 0,
      taxEnabled: false,
      taxRate: 0,
      total: 22000,
      businessSnapshot: { name: 'Demo', outlet: 'Outlet Utama', phone: '' },
      customer: 'Walk-in Customer',
      customerId: null,
      customerSnapshot: null,
      paymentMethod,
      cashReceived: isCash ? 22000 : null,
      changeAmount: isCash ? 0 : null,
      orderStatus: null,
    }
  }

  it('commits a cash sale durably with no transaction collision', async () => {
    const runtime = await makeRuntime()
    const before = runtime.transactionStore.items.length

    const sale = await runtime.localOperations.commitRetailSale({
      checkout: makeCheckout(runtime.product),
    })
    await runtime.scheduler.flush()

    expect(runtime.transactionStore.items).toHaveLength(before + 1)
    expect(runtime.transactionStore.items.filter((t) => t.id === sale.id)).toHaveLength(1)
    expect(runtime.productStore.getProductById(runtime.product.id).stock).toBe(9)
    expect(runtime.cashStore.entries).toHaveLength(1)
    // Journal resolved (no pending entry) only after every durable write.
    expect((await runtime.adapter.loadLocalOperationJournal())?.entries ?? []).toEqual([])
    // The connection is left with no dangling transaction.
    expect(nativeState.transactionActive).toBe(false)

    await runtime.scheduler.close()
  })

  it('resumes an interrupted sale instead of creating a second transaction', async () => {
    const runtime = await makeRuntime()
    await runtime.scheduler.flush()

    // Simulate an attempt that was interrupted after the journal was written
    // (and, as in the field failure, after the transaction row was created).
    const operationId = 'op-interrupted'
    const checkout = makeCheckout(runtime.product)
    await runtime.adapter.saveLocalOperationJournal({
      version: 1,
      entries: [
        {
          operationId,
          operationType: 'retail_sale',
          phase: 'transaction_applied',
          status: 'pending',
          contextKey: 'local',
          payload: { checkout },
          artifacts: { transactionId: operationId },
          attempts: 0,
        },
      ],
    })
    await runtime.scheduler.flush()

    const before = runtime.transactionStore.items.length

    // A retry with a brand-new identity must resume the pending operation.
    const sale = await runtime.localOperations.commitRetailSale({ checkout })

    expect(sale.id).toBe(operationId)
    expect(runtime.transactionStore.items).toHaveLength(before + 1)
    expect(runtime.transactionStore.items.filter((t) => t.id === operationId)).toHaveLength(1)
    // Exactly one stock deduction and one cash entry for that single sale.
    expect(
      runtime.productStore.stockMovements.filter((m) => m.type === 'sale'),
    ).toHaveLength(1)
    expect(runtime.cashStore.entries).toHaveLength(1)
    expect((await runtime.adapter.loadLocalOperationJournal())?.entries ?? []).toEqual([])
    expect(nativeState.transactionActive).toBe(false)

    await runtime.scheduler.close()
  })

  it('a failed journal write aborts before any transaction is created', async () => {
    const runtime = await makeRuntime()
    await runtime.scheduler.flush()
    const before = runtime.transactionStore.items.length

    const originalRun = fakeDb.run.getMockImplementation()
    fakeDb.run.mockImplementationOnce(async () => {
      throw new Error('storage hiccup')
    })

    await expect(
      runtime.localOperations.commitRetailSale({ checkout: makeCheckout(runtime.product) }),
    ).rejects.toThrow()

    fakeDb.run.mockImplementation(originalRun)

    // Nothing durable and nothing half-applied was left behind.
    expect(runtime.transactionStore.items).toHaveLength(before)
    expect((await runtime.adapter.loadLocalOperationJournal())?.entries ?? []).toEqual([])

    // The next attempt still works.
    const sale = await runtime.localOperations.commitRetailSale({
      checkout: makeCheckout(runtime.product),
    })
    await runtime.scheduler.flush()

    expect(runtime.transactionStore.items.filter((t) => t.id === sale.id)).toHaveLength(1)
    expect(nativeState.transactionActive).toBe(false)

    await runtime.scheduler.close()
  })

  it('records a QRIS sale without touching the cash ledger', async () => {
    const runtime = await makeRuntime()

    const sale = await runtime.localOperations.commitRetailSale({
      checkout: makeCheckout(runtime.product, { paymentMethod: 'qris' }),
    })
    await runtime.scheduler.flush()

    expect(sale.paymentMethod).toBe('qris')
    expect(runtime.cashStore.entries).toHaveLength(0)
    expect(runtime.transactionStore.items.filter((t) => t.id === sale.id)).toHaveLength(1)
    expect(nativeState.transactionActive).toBe(false)

    await runtime.scheduler.close()
  })
})

// ════════════════════════════════════════════════════════════════════════════
// Restart durability, P38 restart recovery, workspace switching, sync queue
// ════════════════════════════════════════════════════════════════════════════

describe('9. a restart preserves durable transactions', () => {
  it('re-opens the database and still finds the committed sale', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const adapter = createSQLiteAdapter()
    const scheduler = createPersistenceService({ adapter, pinia })
    await scheduler.initialize()

    const productStore = useProductStore(pinia)
    productStore.createCategory('Minuman')
    const created = productStore.createProduct({
      name: 'Americano', category: 'Minuman', price: 18000, stock: 5, isActive: true,
    })
    const localOperations = createLocalOperationService({ adapter, scheduler, pinia })

    const sale = await localOperations.commitRetailSale({
      checkout: {
        items: [{ ...created.product, qty: 1 }],
        subtotal: 18000, tax: 0, taxEnabled: false, taxRate: 0, total: 18000,
        businessSnapshot: null, customer: 'Walk-in Customer', customerId: null,
        customerSnapshot: null, paymentMethod: 'cash', cashReceived: 18000, changeAmount: 0,
        orderStatus: null,
      },
    })
    await scheduler.flush()
    await scheduler.close()

    // "Restart": a fresh adapter over the same persisted database.
    const reopened = createSQLiteAdapter()
    await reopened.initialize()

    const persisted = await reopened.loadTransactions()
    expect(persisted.filter((t) => t.id === sale.id)).toHaveLength(1)
    expect((await reopened.loadLocalOperationJournal())?.entries ?? []).toEqual([])
    expect(await reopened.getSchemaVersion()).toBe(DB_VERSION)

    await reopened.close()
  })
})

describe('10. a pending P38 journal is recovered after restart without duplication', () => {
  it('recovers twice idempotently and leaves no pending entry', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const adapter = createSQLiteAdapter()
    const scheduler = createPersistenceService({ adapter, pinia })
    await scheduler.initialize()

    const productStore = useProductStore(pinia)
    productStore.createCategory('Minuman')
    const created = productStore.createProduct({
      name: 'Latte', category: 'Minuman', price: 25000, stock: 8, isActive: true,
    })
    await scheduler.flush()

    const operationId = 'op-crash'
    await adapter.saveLocalOperationJournal({
      version: 1,
      entries: [
        {
          operationId,
          operationType: 'retail_sale',
          phase: 'journal_saved',
          status: 'pending',
          contextKey: 'local',
          payload: {
            checkout: {
              items: [{ ...created.product, qty: 2 }],
              subtotal: 50000, tax: 0, taxEnabled: false, taxRate: 0, total: 50000,
              businessSnapshot: null, customer: 'Walk-in Customer', customerId: null,
              customerSnapshot: null, paymentMethod: 'cash', cashReceived: 50000,
              changeAmount: 0, orderStatus: null,
            },
          },
          artifacts: {},
          attempts: 0,
        },
      ],
    })
    await scheduler.flush()
    await scheduler.close()

    // "Restart" with a fresh runtime over the same database.
    const pinia2 = createPinia()
    setActivePinia(pinia2)
    const adapter2 = createSQLiteAdapter()
    const scheduler2 = createPersistenceService({ adapter: adapter2, pinia: pinia2 })
    await scheduler2.initialize()
    const ops2 = createLocalOperationService({ adapter: adapter2, scheduler: scheduler2, pinia: pinia2 })

    await ops2.recoverPendingOperations()
    await ops2.recoverPendingOperations()
    await scheduler2.flush()

    const transactionStore = useTransactionStore(pinia2)
    expect(transactionStore.items.filter((t) => t.id === operationId)).toHaveLength(1)

    const productStore2 = useProductStore(pinia2)
    const saleMovements = productStore2.stockMovements.filter(
      (m) => m.type === 'sale' && m.transactionId === operationId,
    )
    expect(saleMovements).toHaveLength(1)
    expect(productStore2.getProductById(created.product.id).stock).toBe(6)
    expect((await adapter2.loadLocalOperationJournal())?.entries ?? []).toEqual([])

    await scheduler2.close()
  })
})

describe('11. workspace switching stays safe on the shared connection', () => {
  it('switches and switches back without a transaction collision', async () => {
    const adapter = createSQLiteAdapter()
    await adapter.initialize()
    await adapter.saveBusiness({
      name: 'Temuan', type: 'Laundry', owner: '', phone: '', outlet: 'Outlet Utama', mode: 'free',
    })
    await adapter.saveProducts(
      [{ id: 'p-local', name: 'Cuci Kiloan', category: 'Kiloan', price: 7000, stock: 2, isActive: true }],
      ['Kiloan'],
    )

    const scheduler = { flush: async () => {}, rehydrate: async () => {} }
    const target = cloudWorkspaceId(72, 8)

    const first = await switchOperationalWorkspace({ adapter, scheduler, targetWorkspaceId: target })
    expect(first.ok).toBe(true)

    const back = await switchOperationalWorkspace({ adapter, scheduler, targetWorkspaceId: LOCAL_WORKSPACE_ID })
    expect(back.ok).toBe(true)

    expect((await adapter.loadBusiness()).name).toBe('Temuan')
    expect((await adapter.loadProducts()).products.map((p) => p.id)).toEqual(['p-local'])
    expect(nativeState.transactionActive).toBe(false)
    expect(await adapter.loadWorkspaceSwitchJournal()).toBeNull()
  })
})

describe('12. the sync queue stays durable', () => {
  it('survives a restart with every queued item intact', async () => {
    const adapter = createSQLiteAdapter()
    await adapter.initialize()

    const now = new Date().toISOString()
    await adapter.upsertSyncQueueItem({
      id: 'q1', entityType: 'product', entityId: 'p1', operation: 'upsert',
      payload: { id: 'p1' }, createdAt: now, updatedAt: now,
    })
    await adapter.upsertSyncQueueItems([
      { id: 'q2', entityType: 'customer', entityId: 'c1', operation: 'upsert', payload: { id: 'c1' }, createdAt: now, updatedAt: now },
      { id: 'q3', entityType: 'transaction', entityId: 't1', operation: 'upsert', payload: { id: 't1' }, createdAt: now, updatedAt: now },
    ])

    expect(await adapter.countSyncQueueItems()).toBe(3)

    await adapter.close()
    const reopened = createSQLiteAdapter()
    await reopened.initialize()

    expect(await reopened.countSyncQueueItems()).toBe(3)
    const items = await reopened.listSyncQueueItems({ limit: 10 })
    expect(items.map((item) => item.id).sort()).toEqual(['q1', 'q2', 'q3'])
    expect(nativeState.transactionActive).toBe(false)

    await reopened.close()
  })
})
