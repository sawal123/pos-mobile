/**
 * INT-02 — POS Mobile cashier sync capabilities.
 *
 * Covers the INT-02 requirements against the INT-01 backend contract
 * (`docs/sync/INT01_CASHIER_SYNC_V1.md` in `pos_dashboard`):
 *
 *  1.  Role + capabilities are resolved per business.
 *  2.  Business/outlet switching re-derives the capability context.
 *  3.  Cashier devices come from owner pre-registration (`device_context`).
 *  4.  A cashier never calls `POST /api/mobile/devices`.
 *  5.  A mixed outbox never becomes a mixed payload.
 *  6.  Role-restricted entries stay durable and are never acknowledged.
 *  7.  member -> cashier with an old token is enforced on the next request.
 *  8.  cashier -> member after a context refresh regains the full contract.
 *  9.  A 403 rejection never loses data and never loops on the same envelope.
 *  10. Restart with an existing in-flight envelope is safe.
 *  11. Owner/member backward compatibility is preserved.
 *  12. Free offline mode is unaffected.
 *  13. Sale-linked cash and stock are allowed; manual cash/stock are not.
 *  14. Negative (legitimately oversold) stock is preserved.
 *  15. Laundry lifecycle snapshots still map.
 *  16. SQLite / memory adapter parity.
 *  17. Bootstrap and crash-restart recovery.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

import { createMemoryAdapter } from '../services/database/memoryAdapter'
import { createSQLiteAdapter } from '../services/database/sqliteAdapter'
import { createPersistenceService } from '../services/database/persistenceService'
import { createSyncQueueService } from '../services/sync/syncQueueService'
import { createSyncIdentityRegistry, generateUuid } from '../services/sync/syncIdentityRegistry'
import { createSyncPushService } from '../services/sync/syncPushService'
import { createSyncOrchestratorService } from '../services/sync/syncOrchestratorService'
import {
  CASHIER_SYNC_CONTRACT_VERSION,
  RESTRICTION_CATEGORY_DEPENDENCY,
  RESTRICTION_CATEGORY_ROLE,
  SYNC_PUSH_MODE_CASHIER_SAFE,
  SYNC_PUSH_MODE_FULL,
  SYNC_PUSH_MODE_NONE,
  classifyOutboxEntryForPolicy,
  resolveSyncPushPolicy,
} from '../services/sync/syncCapabilityPolicy'
import {
  SYNC_UI_RESTRICTED,
  createSyncStatusService,
  deriveSyncUiStatus,
} from '../services/sync/syncStatusService'
import { SYNC_ENTITY_TYPES, SYNC_OPERATIONS } from '../services/sync/syncConstants'
import { createSyncAutoSyncService } from '../services/sync/syncAutoSyncService'
import { useCloudSessionStore } from '../stores/cloudSessionStore'
import { _resetTokenStore, saveToken, getToken } from '../services/cloud/tokenRepository'
import { apiRequest } from '../services/cloud/apiClient'
import { mount, flushPromises } from '@vue/test-utils'
import CloudLoginView from '../views/settings/CloudLoginView.vue'

// ── SQLite functional test double (queue + app_meta only) ────────────────────

const { fakeDb } = vi.hoisted(() => {
  const state = {
    version: 4,
    meta: new Map(),
    queue: [],
    reset() {
      this.version = 4
      this.meta.clear()
      this.queue = []
    },
  }

  function writeMeta(key, value) {
    state.meta.set(key, value === undefined ? null : JSON.stringify(value))
  }

  const fakeDb = {
    state,
    writeMeta,
    beginTransaction: vi.fn(async () => {}),
    commitTransaction: vi.fn(async () => {}),
    rollbackTransaction: vi.fn(async () => {}),
    execute: vi.fn(async (sql) => {
      const match = /PRAGMA user_version\s*=\s*(\d+)/.exec(sql)
      if (match) state.version = Number(match[1])
    }),
    run: vi.fn(async (sql, values = []) => {
      const normalized = String(sql).replace(/\s+/g, ' ').trim()

      if (normalized.startsWith('INSERT OR REPLACE INTO app_meta')) {
        state.meta.set(values[0], values[1] === undefined ? null : values[1])
        return { changes: { changes: 1 } }
      }

      if (normalized.startsWith('DELETE FROM app_meta')) {
        state.meta.delete(values[0])
        return { changes: { changes: 1 } }
      }

      if (normalized.startsWith('INSERT INTO sync_queue')) {
        const [id, entityType, entityId, operation, payload, createdAt, updatedAt] = values
        const index = state.queue.findIndex(
          (row) => row.entity_type === entityType && row.entity_id === entityId,
        )
        const row = {
          id,
          entity_type: entityType,
          entity_id: entityId,
          operation,
          payload,
          created_at: createdAt,
          updated_at: updatedAt,
          attempt_count: 0,
          last_error: null,
        }
        if (index === -1) state.queue.push(row)
        else
          state.queue[index] = {
            ...row,
            id: state.queue[index].id,
            created_at: state.queue[index].created_at,
          }
        return { changes: { changes: 1 } }
      }

      if (normalized.startsWith('DELETE FROM sync_queue')) {
        if (normalized.includes('AND updated_at = ?')) {
          const [id, updatedAt, operation, payloadStr] = values
          const before = state.queue.length
          state.queue = state.queue.filter(
            (row) =>
              !(
                row.id === id &&
                row.updated_at === updatedAt &&
                row.operation === operation &&
                (row.payload ?? null) === (payloadStr ?? null)
              ),
          )
          return { changes: { changes: before - state.queue.length } }
        }
        state.queue = state.queue.filter((row) => row.id !== values[0])
        return { changes: { changes: 1 } }
      }

      if (normalized.startsWith('UPDATE sync_queue')) {
        const [error, id, updatedAt, operation, payloadStr] = values
        let changed = 0
        for (const row of state.queue) {
          if (
            row.id === id &&
            row.updated_at === updatedAt &&
            row.operation === operation &&
            (row.payload ?? null) === (payloadStr ?? null)
          ) {
            row.attempt_count += 1
            row.last_error = error
            changed += 1
          }
        }
        return { changes: { changes: changed } }
      }

      return { changes: { changes: 1 } }
    }),
    query: vi.fn(async (sql, values = []) => {
      const normalized = String(sql).replace(/\s+/g, ' ').trim()

      if (normalized.includes('PRAGMA user_version')) {
        return { values: [{ user_version: state.version }] }
      }

      if (normalized.includes('FROM app_meta')) {
        return { values: state.meta.has(values[0]) ? [{ value: state.meta.get(values[0]) }] : [] }
      }

      if (normalized.includes('COUNT(*) AS total FROM sync_queue')) {
        return { values: [{ total: state.queue.length }] }
      }

      if (normalized.includes('FROM sync_queue')) {
        const limit = Number(values[0])
        const rows = state.queue
          .slice()
          .sort((a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0))
          .slice(0, Number.isFinite(limit) ? limit : state.queue.length)
        return { values: rows.map((row) => ({ ...row })) }
      }

      return { values: [] }
    }),
    isDBOpen: async () => ({ result: true }),
    open: async () => {},
    close: async () => {},
    isTransactionActive: async () => ({ result: false }),
  }

  return { fakeDb }
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

vi.mock('../services/cloud/apiClient', () => ({
  apiRequest: vi.fn(),
}))

// ── Fixtures ────────────────────────────────────────────────────────────────

const DEVICE_IDENTIFIER = '123e4567-e89b-12d3-a456-426614174000'
const NOW = '2026-09-28T10:00:00.000Z'

function makeCapabilities(pushMode = SYNC_PUSH_MODE_CASHIER_SAFE) {
  return {
    pull: true,
    push: pushMode !== SYNC_PUSH_MODE_NONE,
    push_mode: pushMode,
    allowed_entities: {
      customers: ['upsert'],
      shifts: ['upsert'],
      sales: ['upsert'],
      sale_items: ['upsert'],
      cash_ledger: ['sale_payment'],
      stock_movements: ['sale'],
    },
    denied_entities: ['categories', 'products', 'expenses', 'deletions'],
    contract_version: CASHIER_SYNC_CONTRACT_VERSION,
  }
}

function baseContext(overrides = {}) {
  return {
    user: { id: 1, name: 'Kasir', email: 'kasir@example.com' },
    selectedBusiness: { id: 10, name: 'Toko Kopi' },
    selectedOutlet: { id: 101, name: 'Outlet Pusat' },
    cloudAccess: true,
    deviceIdentifier: DEVICE_IDENTIFIER,
    registeredDeviceId: 55,
    ...overrides,
  }
}

function cashierContext(overrides = {}) {
  return baseContext({
    role: 'cashier',
    syncCapabilities: makeCapabilities(SYNC_PUSH_MODE_CASHIER_SAFE),
    ...overrides,
  })
}

function ownerContext(overrides = {}) {
  return baseContext({
    role: 'owner',
    syncCapabilities: makeCapabilities(SYNC_PUSH_MODE_FULL),
    ...overrides,
  })
}

// ── Harness ─────────────────────────────────────────────────────────────────

async function createPushHarness({
  context = ownerContext(),
  transportImpl = null,
  adapter = null,
} = {}) {
  const pinia = createPinia()
  setActivePinia(pinia)

  const activeAdapter = adapter ?? createMemoryAdapter()
  await activeAdapter.initialize()
  await activeAdapter.saveSyncPushBinding({ businessId: 10, boundAt: NOW })

  const scheduler = createPersistenceService({ adapter: activeAdapter, pinia })
  await scheduler.initialize()

  const queueService = createSyncQueueService({ adapter: activeAdapter, scheduler })
  const registry = createSyncIdentityRegistry({ adapter: activeAdapter, scheduler })

  const requests = []
  const transport = vi.fn(async (args) => {
    requests.push(args)
    if (transportImpl) return transportImpl(args, requests.length)
    return {
      ok: true,
      status: 200,
      data: { data: { request_id: args.body.request_id, duplicate: false } },
      error: null,
    }
  })

  const pushService = createSyncPushService({
    adapter: activeAdapter,
    scheduler,
    queueService,
    registry,
    tokenFetcher: async () => 'test-token',
    transport,
  })

  return {
    pinia,
    adapter: activeAdapter,
    scheduler,
    queueService,
    registry,
    pushService,
    transport,
    requests,
    push: (opts = {}) => pushService.pushNow({ context, ...opts }),
  }
}

async function bindKnownProduct(registry, adapter, localId) {
  const uuid = generateUuid()
  await registry.ensureLoaded()
  await registry.bindSyncId(SYNC_ENTITY_TYPES.PRODUCT, localId, uuid)
  const versions = (await adapter.loadSyncServerVersions()) || {}
  versions[`products:${uuid}`] = { syncVersion: 1, syncSequence: 1 }
  await adapter.saveSyncServerVersions(versions)
  return uuid
}

function transactionPayload(overrides = {}) {
  return {
    id: 'trx-1',
    invoiceNumber: 'INV-1',
    items: [{ id: 'known-product', name: 'Kopi', price: 10000, qty: 2 }],
    subtotal: 20000,
    tax: 0,
    total: 20000,
    paymentMethod: 'cash',
    paymentStatus: 'paid',
    createdAt: NOW,
    ...overrides,
  }
}

function cashSalePaymentPayload(overrides = {}) {
  return {
    id: 'cash-1',
    type: 'in',
    amount: 20000,
    category: 'Penjualan Cash',
    note: 'INV-1',
    referenceId: 'sale-trx-1',
    transactionId: 'trx-1',
    createdAt: NOW,
    ...overrides,
  }
}

function saleStockMovementPayload(overrides = {}) {
  return {
    id: 'mov-1',
    productId: 'known-product',
    productName: 'Kopi',
    type: 'sale',
    movementType: 'sale',
    quantityChange: -2,
    stockBefore: 10,
    stockAfter: 8,
    referenceId: 'sale-trx-1',
    transactionId: 'trx-1',
    category: 'Penjualan',
    note: 'Penjualan Kopi',
    createdAt: NOW,
    ...overrides,
  }
}

async function enqueueCashierMixedOutbox(queueService) {
  const results = {}
  results.category = await queueService.enqueueUpsert(SYNC_ENTITY_TYPES.CATEGORY, 'Minuman', {
    name: 'Minuman',
  })
  results.product = await queueService.enqueueUpsert(SYNC_ENTITY_TYPES.PRODUCT, 'local-product', {
    id: 'local-product',
    name: 'Produk Baru',
    category: 'Minuman',
    price: 5000,
    isActive: true,
  })
  results.expense = await queueService.enqueueUpsert(SYNC_ENTITY_TYPES.EXPENSE, 'exp-1', {
    id: 'exp-1',
    title: 'Beli Gula',
    amount: 20000,
    category: 'Bahan',
    createdAt: NOW,
  })
  results.customer = await queueService.enqueueUpsert(SYNC_ENTITY_TYPES.CUSTOMER, 'cust-1', {
    id: 'cust-1',
    name: 'Budi',
    phone: '0812',
    email: null,
  })
  results.shift = await queueService.enqueueUpsert(SYNC_ENTITY_TYPES.SHIFT, 'shift-1', {
    id: 'shift-1',
    shiftNumber: 'SH-1',
    status: 'open',
    openedAt: NOW,
    openingCash: 100000,
  })
  results.transaction = await queueService.enqueueUpsert(
    SYNC_ENTITY_TYPES.TRANSACTION,
    'trx-1',
    transactionPayload(),
  )
  results.cash = await queueService.enqueueUpsert(
    SYNC_ENTITY_TYPES.CASH_ENTRY,
    'cash-1',
    cashSalePaymentPayload(),
  )
  results.movement = await queueService.enqueueUpsert(
    SYNC_ENTITY_TYPES.STOCK_MOVEMENT,
    'mov-1',
    saleStockMovementPayload(),
  )
  return results
}

// ════════════════════════════════════════════════════════════════════════════
// 1. Role + capabilities resolution
// ════════════════════════════════════════════════════════════════════════════

describe('INT-02 — capability resolution', () => {
  it('resolves owner/member to full push', () => {
    expect(resolveSyncPushPolicy({ role: 'owner' }).pushMode).toBe(SYNC_PUSH_MODE_FULL)
    expect(resolveSyncPushPolicy({ role: 'member' }).pushMode).toBe(SYNC_PUSH_MODE_FULL)
  })

  it('resolves cashier capabilities to cashier_safe', () => {
    const policy = resolveSyncPushPolicy({
      role: 'cashier',
      syncCapabilities: makeCapabilities(),
    })

    expect(policy.pushMode).toBe(SYNC_PUSH_MODE_CASHIER_SAFE)
    expect(policy.source).toBe('capabilities')
    expect(policy.contractVersion).toBe(CASHIER_SYNC_CONTRACT_VERSION)
    expect(policy.failClosed).toBe(false)
  })

  it('denies an unknown role by default', () => {
    const policy = resolveSyncPushPolicy({ role: 'auditor' })
    expect(policy.pushMode).toBe(SYNC_PUSH_MODE_NONE)
    expect(policy.failClosed).toBe(true)
  })

  it('fails closed on an unrecognised capability contract', () => {
    const policy = resolveSyncPushPolicy({
      role: 'cashier',
      syncCapabilities: { push_mode: 'cashier_safe', contract_version: 'cashier_sync_v99' },
    })

    expect(policy.pushMode).toBe(SYNC_PUSH_MODE_NONE)
    expect(policy.failClosed).toBe(true)
    expect(policy.reason).toBe('UNKNOWN_CONTRACT_VERSION')
  })

  it('fails closed on an invalid push_mode', () => {
    const policy = resolveSyncPushPolicy({
      role: 'cashier',
      syncCapabilities: { push_mode: 'superuser' },
    })

    expect(policy.pushMode).toBe(SYNC_PUSH_MODE_NONE)
    expect(policy.failClosed).toBe(true)
  })

  it('keeps legacy owner/member contexts working (no role, no capabilities)', () => {
    expect(resolveSyncPushPolicy({}).pushMode).toBe(SYNC_PUSH_MODE_FULL)
    expect(resolveSyncPushPolicy({}).source).toBe('legacy')
  })

  it('classifies restricted entities and operations for cashier_safe', () => {
    const policy = resolveSyncPushPolicy({ role: 'cashier', syncCapabilities: makeCapabilities() })

    expect(
      classifyOutboxEntryForPolicy(
        { entityType: SYNC_ENTITY_TYPES.PRODUCT, operation: SYNC_OPERATIONS.UPSERT, payload: {} },
        policy,
      ).action,
    ).toBe('restrict')

    expect(
      classifyOutboxEntryForPolicy(
        {
          entityType: SYNC_ENTITY_TYPES.CUSTOMER,
          operation: SYNC_OPERATIONS.DELETE,
          payload: null,
        },
        policy,
      ).category,
    ).toBe(RESTRICTION_CATEGORY_ROLE)

    expect(
      classifyOutboxEntryForPolicy(
        { entityType: SYNC_ENTITY_TYPES.CUSTOMER, operation: SYNC_OPERATIONS.UPSERT, payload: {} },
        policy,
      ).action,
    ).toBe('allow')
  })
})

// ════════════════════════════════════════════════════════════════════════════
// 2 + 5 + 6 + 13 + 14. Capability-safe outbox
// ════════════════════════════════════════════════════════════════════════════

describe('INT-02 — capability-safe outbox', () => {
  it('never turns a mixed outbox into a mixed payload', async () => {
    const harness = await createPushHarness({ context: cashierContext() })
    await bindKnownProduct(harness.registry, harness.adapter, 'known-product')
    await enqueueCashierMixedOutbox(harness.queueService)

    const result = await harness.push()

    expect(harness.transport).toHaveBeenCalledTimes(1)
    const body = harness.requests[0].body

    // Denied master data / accounting / tombstones never enter the envelope.
    expect(body.changes.categories).toEqual([])
    expect(body.changes.products).toEqual([])
    expect(body.changes.expenses).toEqual([])
    expect(body.changes.deletions).toEqual([])

    // Allowed entities do travel.
    expect(body.changes.customers).toHaveLength(1)
    expect(body.changes.shifts).toHaveLength(1)
    expect(body.changes.sales).toHaveLength(1)
    expect(body.changes.sale_items.length).toBeGreaterThan(0)
    expect(body.changes.cash_ledger).toHaveLength(1)
    expect(body.changes.stock_movements).toHaveLength(1)

    // The restricted rows are reported, never acknowledged.
    const restrictedCodes = result.restricted.map((item) => item.entityType)
    expect(restrictedCodes).toContain(SYNC_ENTITY_TYPES.PRODUCT)
    expect(restrictedCodes).toContain(SYNC_ENTITY_TYPES.CATEGORY)
    expect(restrictedCodes).toContain(SYNC_ENTITY_TYPES.EXPENSE)

    const restrictedQueueIds = result.restricted.map((item) => item.queueId)
    expect(result.removedQueueIds).not.toEqual(expect.arrayContaining(restrictedQueueIds))
  })

  it('keeps restricted entries durable after a successful partial push', async () => {
    const harness = await createPushHarness({ context: cashierContext() })
    await bindKnownProduct(harness.registry, harness.adapter, 'known-product')
    const queued = await enqueueCashierMixedOutbox(harness.queueService)

    await harness.push()

    const pending = await harness.queueService.listPending({ limit: 100 })
    const pendingIds = pending.map((item) => item.id)

    expect(pendingIds).toContain(queued.product.entry.id)
    expect(pendingIds).toContain(queued.category.entry.id)
    expect(pendingIds).toContain(queued.expense.entry.id)

    // Restricted rows must not be marked as failed-and-sent either: they are
    // simply excluded from the envelope.
    expect(pending).toHaveLength(3)
  })

  it('treats manual cash and manual stock as role-restricted', async () => {
    const harness = await createPushHarness({ context: cashierContext() })

    await harness.queueService.enqueueUpsert(SYNC_ENTITY_TYPES.CASH_ENTRY, 'manual-cash', {
      id: 'manual-cash',
      type: 'in',
      amount: 50000,
      category: 'Kas Masuk',
      note: 'Titipan',
      createdAt: NOW,
    })
    await harness.queueService.enqueueUpsert(SYNC_ENTITY_TYPES.STOCK_MOVEMENT, 'manual-stock', {
      id: 'manual-stock',
      productId: 'known-product',
      type: 'adjustment',
      movementType: 'adjustment',
      quantityChange: 10,
      stockBefore: 1,
      stockAfter: 11,
      category: 'Restock',
      note: 'Restock',
      createdAt: NOW,
    })

    const result = await harness.push()

    expect(harness.transport).not.toHaveBeenCalled()
    const codes = result.restricted.map((item) => item.code)
    expect(codes).toContain('CASHIER_MANUAL_CASH_DENIED')
    expect(codes).toContain('CASHIER_MANUAL_STOCK_DENIED')
    expect(await harness.queueService.countPending()).toBe(2)
  })

  it('allows a sale-linked cash payment and sale stock movement', async () => {
    const harness = await createPushHarness({ context: cashierContext() })
    await bindKnownProduct(harness.registry, harness.adapter, 'known-product')

    await harness.queueService.enqueueUpsert(
      SYNC_ENTITY_TYPES.TRANSACTION,
      'trx-1',
      transactionPayload(),
    )
    await harness.queueService.enqueueUpsert(
      SYNC_ENTITY_TYPES.CASH_ENTRY,
      'cash-1',
      cashSalePaymentPayload(),
    )
    await harness.queueService.enqueueUpsert(
      SYNC_ENTITY_TYPES.STOCK_MOVEMENT,
      'mov-1',
      saleStockMovementPayload(),
    )

    const result = await harness.push()

    expect(result.ok).toBe(true)
    const body = harness.requests[0].body
    expect(body.changes.cash_ledger[0].sale_sync_id).toBeTruthy()
    expect(body.changes.stock_movements[0].sale_sync_id).toBeTruthy()
    expect(body.changes.stock_movements[0].quantity_change).toBe(-2)
    expect(result.restricted).toEqual([])
    expect(result.deferred).toEqual([])
  })

  it('preserves a legitimate negative stock oversell', async () => {
    const harness = await createPushHarness({ context: cashierContext() })
    await bindKnownProduct(harness.registry, harness.adapter, 'known-product')

    await harness.queueService.enqueueUpsert(
      SYNC_ENTITY_TYPES.TRANSACTION,
      'trx-1',
      transactionPayload({
        items: [{ id: 'known-product', name: 'Kopi', price: 10000, qty: 5 }],
        subtotal: 50000,
        total: 50000,
      }),
    )
    await harness.queueService.enqueueUpsert(
      SYNC_ENTITY_TYPES.STOCK_MOVEMENT,
      'mov-neg',
      saleStockMovementPayload({
        id: 'mov-neg',
        quantityChange: -5,
        stockBefore: 2,
        stockAfter: -3,
      }),
    )

    const result = await harness.push()

    expect(result.ok).toBe(true)
    expect(harness.requests[0].body.changes.stock_movements[0].quantity_change).toBe(-5)
  })
})

// ════════════════════════════════════════════════════════════════════════════
// 2 + 6. Transaction dependencies
// ════════════════════════════════════════════════════════════════════════════

describe('INT-02 — transaction dependencies', () => {
  it('defers a sale whose product is not available on the server', async () => {
    const harness = await createPushHarness({ context: cashierContext() })

    await harness.queueService.enqueueUpsert(
      SYNC_ENTITY_TYPES.TRANSACTION,
      'trx-1',
      transactionPayload({
        items: [{ id: 'unknown-product', name: 'Produk Lokal', price: 10000, qty: 1 }],
        subtotal: 10000,
        total: 10000,
      }),
    )

    const result = await harness.push()

    expect(harness.transport).not.toHaveBeenCalled()
    expect(result.deferred).toHaveLength(1)
    expect(result.deferred[0].category).toBe(RESTRICTION_CATEGORY_DEPENDENCY)
    expect(result.deferred[0].code).toBe('SALE_PRODUCT_NOT_AVAILABLE_ON_SERVER')
    expect(await harness.queueService.countPending()).toBe(1)
  })

  it('defers a cash payment whose linked sale is not a settled cash sale', async () => {
    const harness = await createPushHarness({ context: cashierContext() })
    await bindKnownProduct(harness.registry, harness.adapter, 'known-product')

    await harness.queueService.enqueueUpsert(
      SYNC_ENTITY_TYPES.TRANSACTION,
      'trx-1',
      transactionPayload({ paymentMethod: 'qris', paymentStatus: 'unpaid' }),
    )
    await harness.queueService.enqueueUpsert(
      SYNC_ENTITY_TYPES.CASH_ENTRY,
      'cash-1',
      cashSalePaymentPayload(),
    )

    const result = await harness.push()

    const codes = result.deferred.map((item) => item.code)
    expect(codes).toContain('CASH_PAYMENT_REQUIRES_SETTLED_CASH_SALE')
    expect(harness.requests[0].body.changes.cash_ledger).toEqual([])
    // The sale itself is valid and travels; only the cash payment is deferred.
    expect(await harness.queueService.countPending()).toBe(1)
  })

  it('defers a stock movement whose product is unknown on the server', async () => {
    const harness = await createPushHarness({ context: cashierContext() })
    await bindKnownProduct(harness.registry, harness.adapter, 'known-product')

    await harness.queueService.enqueueUpsert(
      SYNC_ENTITY_TYPES.TRANSACTION,
      'trx-1',
      transactionPayload(),
    )
    await harness.queueService.enqueueUpsert(
      SYNC_ENTITY_TYPES.STOCK_MOVEMENT,
      'mov-1',
      saleStockMovementPayload({ productId: 'unknown-product' }),
    )

    const result = await harness.push()

    const codes = result.deferred.map((item) => item.code)
    expect(codes).toContain('STOCK_MOVEMENT_PRODUCT_NOT_AVAILABLE_ON_SERVER')
    expect(harness.requests[0].body.changes.stock_movements).toEqual([])
  })
})

// ════════════════════════════════════════════════════════════════════════════
// 9 + 10. Rejection handling and recovery
// ════════════════════════════════════════════════════════════════════════════

describe('INT-02 — 403 rejection handling', () => {
  const forbidden = () => ({
    ok: false,
    status: 403,
    data: {
      message: 'Sync operation is not allowed for this role.',
      code: 'SYNC_OPERATION_NOT_ALLOWED',
      violations: [
        { entity: 'products', operation: 'upsert', reason: 'cashier_entity_not_allowed' },
      ],
    },
    error: null,
  })

  it('preserves all data on 403 SYNC_OPERATION_NOT_ALLOWED', async () => {
    const harness = await createPushHarness({
      context: cashierContext(),
      transportImpl: () => forbidden(),
    })
    await harness.queueService.enqueueUpsert(SYNC_ENTITY_TYPES.PRODUCT, 'local-product', {
      id: 'local-product',
      name: 'Produk Baru',
      category: 'Minuman',
      price: 5000,
      isActive: true,
    })
    await harness.queueService.enqueueUpsert(SYNC_ENTITY_TYPES.CUSTOMER, 'cust-1', {
      id: 'cust-1',
      name: 'Budi',
      phone: '0812',
      email: null,
    })

    const result = await harness.push()

    expect(result.ok).toBe(false)
    expect(result.code).toBe('SYNC_OPERATION_NOT_ALLOWED')
    expect(result.roleMismatch).toBe(true)
    expect(result.requiresContextRefresh).toBe(true)
    expect(result.removedQueueIds).toEqual([])
    // Both the restricted product row and the rejected customer row are kept.
    expect(await harness.queueService.countPending()).toBe(2)
  })

  it('does not loop on the identical rejected envelope', async () => {
    const harness = await createPushHarness({
      context: cashierContext(),
      transportImpl: () => forbidden(),
    })
    await harness.queueService.enqueueUpsert(SYNC_ENTITY_TYPES.CUSTOMER, 'cust-1', {
      id: 'cust-1',
      name: 'Budi',
      phone: '0812',
      email: null,
    })

    const first = await harness.push()
    expect(first.code).toBe('SYNC_OPERATION_NOT_ALLOWED')

    const second = await harness.push()

    expect(second.code).toBe('SYNC_ENVELOPE_REJECTED_PENDING_CONTEXT_CHANGE')
    expect(harness.transport).toHaveBeenCalledTimes(1)
    expect(await harness.queueService.countPending()).toBe(1)
  })

  it('re-plans safely once the role changes (cashier -> member)', async () => {
    let mode = 'deny'
    const harness = await createPushHarness({
      context: cashierContext(),
      transportImpl: (args) =>
        mode === 'deny'
          ? forbidden()
          : {
              ok: true,
              status: 200,
              data: { data: { request_id: args.body.request_id, duplicate: false } },
              error: null,
            },
    })

    await harness.queueService.enqueueUpsert(SYNC_ENTITY_TYPES.CUSTOMER, 'cust-1', {
      id: 'cust-1',
      name: 'Budi',
      phone: '0812',
      email: null,
    })

    const denied = await harness.push()
    expect(denied.code).toBe('SYNC_OPERATION_NOT_ALLOWED')

    // The membership is upgraded to member and the context refreshed.
    mode = 'allow'
    harness.transport.mockClear()
    const result = await harness.pushService.pushNow({
      context: ownerContext(),
    })

    expect(harness.transport).toHaveBeenCalledTimes(1)
    expect(result.ok).toBe(true)
    expect(await harness.queueService.countPending()).toBe(0)
    expect(harness.requests[0].body.changes.customers).toHaveLength(1)
  })

  it('surfaces DEVICE_INACTIVE without deleting data', async () => {
    const harness = await createPushHarness({
      context: cashierContext(),
      transportImpl: () => ({
        ok: false,
        status: 403,
        data: { message: 'Perangkat dinonaktifkan.', code: 'DEVICE_INACTIVE' },
        error: null,
      }),
    })

    await harness.queueService.enqueueUpsert(SYNC_ENTITY_TYPES.CUSTOMER, 'cust-1', {
      id: 'cust-1',
      name: 'Budi',
      phone: '0812',
      email: null,
    })

    const result = await harness.push()

    expect(result.ok).toBe(false)
    expect(result.code).toBe('DEVICE_INACTIVE')
    expect(result.deviceBlocked).toBe(true)
    expect(await harness.queueService.countPending()).toBe(1)
  })

  it('surfaces CLOUD_SUBSCRIPTION_REQUIRED without deleting data', async () => {
    const harness = await createPushHarness({
      context: cashierContext(),
      transportImpl: () => ({
        ok: false,
        status: 403,
        data: { message: 'Langganan cloud tidak aktif.', code: 'CLOUD_SUBSCRIPTION_REQUIRED' },
        error: null,
      }),
    })

    await harness.queueService.enqueueUpsert(SYNC_ENTITY_TYPES.CUSTOMER, 'cust-1', {
      id: 'cust-1',
      name: 'Budi',
      phone: '0812',
      email: null,
    })

    const result = await harness.push()

    expect(result.code).toBe('CLOUD_SUBSCRIPTION_REQUIRED')
    expect(result.requiresContextRefresh).toBe(true)
    expect(await harness.queueService.countPending()).toBe(1)
  })
})

describe('INT-02 — restart with an existing in-flight envelope', () => {
  it('retries the same request id after a restart and cleans up on success', async () => {
    const adapter = createMemoryAdapter()
    await adapter.initialize()

    const first = await createPushHarness({
      adapter,
      context: cashierContext(),
      transportImpl: () => ({ ok: false, status: 0, data: null, error: { code: 'NETWORK_ERROR' } }),
    })
    await first.queueService.enqueueUpsert(SYNC_ENTITY_TYPES.CUSTOMER, 'cust-1', {
      id: 'cust-1',
      name: 'Budi',
      phone: '0812',
      email: null,
    })
    await first.push()

    const inflight = await adapter.loadSyncPushInflight()
    expect(inflight).toBeTruthy()
    const requestId = inflight.requestId

    // Restart: new Pinia/service instances over the same durable adapter.
    const second = await createPushHarness({
      adapter,
      context: cashierContext(),
      transportImpl: (args) => ({
        ok: true,
        status: 200,
        data: { data: { request_id: args.body.request_id, duplicate: false } },
        error: null,
      }),
    })

    const result = await second.push()

    expect(result.ok).toBe(true)
    expect(second.requests[0].body.request_id).toBe(requestId)
    expect(await second.queueService.countPending()).toBe(0)
    expect(await adapter.loadSyncPushInflight()).toBeNull()
  })
})

// ════════════════════════════════════════════════════════════════════════════
// 11 + 12 + 15. Backward compatibility and untouched flows
// ════════════════════════════════════════════════════════════════════════════

describe('INT-02 — owner/member backward compatibility', () => {
  it('sends every entity type for owner/member contexts', async () => {
    const harness = await createPushHarness({ context: ownerContext() })
    await bindKnownProduct(harness.registry, harness.adapter, 'known-product')
    await enqueueCashierMixedOutbox(harness.queueService)

    const result = await harness.push()

    expect(result.ok).toBe(true)
    const body = harness.requests[0].body
    expect(body.changes.categories).toHaveLength(1)
    expect(body.changes.products).toHaveLength(1)
    expect(body.changes.expenses).toHaveLength(1)
    expect(result.restricted).toEqual([])
  })

  it('keeps a role-less legacy context on the full contract', async () => {
    const harness = await createPushHarness({ context: baseContext() })
    await harness.queueService.enqueueUpsert(SYNC_ENTITY_TYPES.PRODUCT, 'p-1', {
      id: 'p-1',
      name: 'Kopi',
      category: 'Minuman',
      price: 15000,
      isActive: true,
    })

    const result = await harness.push()

    expect(result.ok).toBe(true)
    expect(harness.requests[0].body.changes.products).toHaveLength(1)
  })

  it('maps the laundry lifecycle snapshot for a cashier', async () => {
    const harness = await createPushHarness({ context: cashierContext() })
    await bindKnownProduct(harness.registry, harness.adapter, 'known-product')

    await harness.queueService.enqueueUpsert(
      SYNC_ENTITY_TYPES.TRANSACTION,
      'trx-laundry',
      transactionPayload({
        id: 'trx-laundry',
        items: [
          {
            id: 'known-product',
            name: 'Cuci Kering',
            price: 7000,
            qty: 2.5,
            kind: 'service',
            unit: 'kg',
          },
        ],
        subtotal: 17500,
        total: 17500,
        orderStatus: 'in_progress',
        estimatedCompletedAt: '2026-09-29T10:00:00.000Z',
      }),
    )

    const result = await harness.push()

    expect(result.ok).toBe(true)
    const sale = harness.requests[0].body.changes.sales[0]
    expect(sale.order_status).toBe('in_progress')
    expect(sale.estimated_completed_at).toBe('2026-09-29T10:00:00.000Z')
    expect(harness.requests[0].body.changes.sale_items[0].quantity).toBe(2.5)
  })

  it('keeps Free offline mode unaffected (no cloud context, no network)', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const adapter = createMemoryAdapter()
    await adapter.initialize()

    const store = useCloudSessionStore(pinia)
    store.setPersistenceAdapter(adapter)

    const hydration = await store.hydrateFromStorage(adapter)

    expect(hydration.ok).toBe(true)
    expect(hydration.authenticated).toBe(false)
    expect(store.capabilityState).toBe('unknown')
    expect(store.syncCapabilitySummary.canPush).toBe(false)
    // No cloud mutation is attempted in Free mode.
    expect(store.pushPolicy.pushMode).toBe(SYNC_PUSH_MODE_FULL)
  })
})

// ════════════════════════════════════════════════════════════════════════════
// 7 + 8 + 3 + 4. Cloud session store
// ════════════════════════════════════════════════════════════════════════════

describe('INT-02 — cloud session context', () => {
  beforeEach(() => {
    _resetTokenStore()
    vi.clearAllMocks()
  })

  function contextResponse(business) {
    return {
      ok: true,
      status: 200,
      data: { data: { user: { id: 1, name: 'U', email: 'u@x.com' }, businesses: [business] } },
      error: null,
    }
  }

  it('stores role and capabilities for the selected business', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const adapter = createMemoryAdapter()
    await adapter.initialize()

    apiRequest
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        data: { data: { token: 'tok', user: { id: 1, name: 'U', email: 'u@x.com' } } },
        error: null,
      })
      .mockResolvedValueOnce(
        contextResponse({
          id: 10,
          name: 'Toko',
          role: 'cashier',
          sync_capabilities: makeCapabilities(),
          cloud_access: true,
          outlets: [{ id: 101, name: 'Pusat', status: 'active' }],
          device_context: { id: 555, outlet_id: 101, status: 'active' },
        }),
      )
      // INT-02: choosing an outlet triggers an authoritative context refresh.
      .mockResolvedValueOnce(
        contextResponse({
          id: 10,
          name: 'Toko',
          role: 'cashier',
          sync_capabilities: makeCapabilities(),
          cloud_access: true,
          outlets: [{ id: 101, name: 'Pusat', status: 'active' }],
          device_context: { id: 555, outlet_id: 101, status: 'active' },
        }),
      )

    const store = useCloudSessionStore(pinia)
    store.setPersistenceAdapter(adapter)
    store.deviceIdentifier = DEVICE_IDENTIFIER

    const login = await store.login('u@x.com', 'pw')
    expect(login.ok).toBe(true)
    expect(store.capabilityState).toBe('verified')

    const selected = await store.selectBusiness(10)
    expect(selected.ok).toBe(true)
    expect(store.role).toBe('cashier')
    expect(store.pushPolicy.pushMode).toBe(SYNC_PUSH_MODE_CASHIER_SAFE)
    expect(store.isCashierContext).toBe(true)
    expect(store.canPerformCloudPush).toBe(true)

    // Cashier device is resolved from the owner pre-registration.
    const outlet = await store.selectOutlet(101)
    expect(outlet.ok).toBe(true)
    expect(outlet.device).toMatchObject({ ok: true, deviceId: 555 })
    expect(store.registeredDeviceId).toBe(555)

    // Every context request must carry this device's stable identifier, and no
    // device registration may ever be attempted for a cashier.
    const contextCalls = apiRequest.mock.calls.filter((call) =>
      String(call[0]).startsWith('/api/mobile/context'),
    )
    expect(contextCalls.length).toBeGreaterThanOrEqual(2)
    expect(
      contextCalls.every((call) => call[0].includes(`device_identifier=${DEVICE_IDENTIFIER}`)),
    ).toBe(true)
    expect(
      apiRequest.mock.calls.filter((call) => String(call[0]).includes('/api/mobile/devices')),
    ).toHaveLength(0)
  })

  it('never calls device registration for a cashier', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const adapter = createMemoryAdapter()
    await adapter.initialize()

    apiRequest
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        data: { data: { token: 'tok', user: { id: 1, name: 'U', email: 'u@x.com' } } },
        error: null,
      })
      .mockResolvedValueOnce(
        contextResponse({
          id: 10,
          name: 'Toko',
          role: 'cashier',
          sync_capabilities: makeCapabilities(),
          cloud_access: true,
          outlets: [{ id: 101, name: 'Pusat', status: 'active' }],
          device_context: null,
        }),
      )

    const store = useCloudSessionStore(pinia)
    store.setPersistenceAdapter(adapter)
    store.deviceIdentifier = DEVICE_IDENTIFIER

    await store.login('u@x.com', 'pw')
    await store.selectBusiness(10)
    await store.selectOutlet(101)

    const before = apiRequest.mock.calls.length
    const registration = await store.doRegisterDevice({ platform: 'android' })

    expect(registration.ok).toBe(false)
    expect(registration.error.code).toBe('CASHIER_DEVICE_REGISTRATION_FORBIDDEN')
    expect(apiRequest.mock.calls.length).toBe(before)
  })

  it('reports an unregistered cashier device with owner instructions', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const adapter = createMemoryAdapter()
    await adapter.initialize()

    apiRequest
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        data: { data: { token: 'tok', user: { id: 1, name: 'U', email: 'u@x.com' } } },
        error: null,
      })
      .mockResolvedValueOnce(
        contextResponse({
          id: 10,
          name: 'Toko',
          role: 'cashier',
          sync_capabilities: makeCapabilities(),
          cloud_access: true,
          outlets: [{ id: 101, name: 'Pusat', status: 'active' }],
          device_context: null,
        }),
      )
      .mockResolvedValueOnce(
        contextResponse({
          id: 10,
          name: 'Toko',
          role: 'cashier',
          sync_capabilities: makeCapabilities(),
          cloud_access: true,
          outlets: [{ id: 101, name: 'Pusat', status: 'active' }],
          device_context: null,
        }),
      )

    const store = useCloudSessionStore(pinia)
    store.setPersistenceAdapter(adapter)
    store.deviceIdentifier = DEVICE_IDENTIFIER

    await store.login('u@x.com', 'pw')
    await store.selectBusiness(10)
    const outlet = await store.selectOutlet(101)

    expect(outlet.device.code).toBe('DEVICE_NOT_REGISTERED')
    expect(outlet.device.message).toContain('Dashboard')
    expect(store.registeredDeviceId).toBeNull()
  })

  it('stops cloud sync when the pre-registered device is inactive', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const adapter = createMemoryAdapter()
    await adapter.initialize()

    apiRequest
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        data: { data: { token: 'tok', user: { id: 1, name: 'U', email: 'u@x.com' } } },
        error: null,
      })
      .mockResolvedValueOnce(
        contextResponse({
          id: 10,
          name: 'Toko',
          role: 'cashier',
          sync_capabilities: makeCapabilities(),
          cloud_access: true,
          outlets: [{ id: 101, name: 'Pusat', status: 'active' }],
          device_context: { id: 555, outlet_id: 101, status: 'inactive' },
        }),
      )
      .mockResolvedValueOnce(
        contextResponse({
          id: 10,
          name: 'Toko',
          role: 'cashier',
          sync_capabilities: makeCapabilities(),
          cloud_access: true,
          outlets: [{ id: 101, name: 'Pusat', status: 'active' }],
          device_context: { id: 555, outlet_id: 101, status: 'inactive' },
        }),
      )

    const store = useCloudSessionStore(pinia)
    store.setPersistenceAdapter(adapter)
    store.deviceIdentifier = DEVICE_IDENTIFIER

    await store.login('u@x.com', 'pw')
    await store.selectBusiness(10)
    const outlet = await store.selectOutlet(101)

    expect(outlet.device.code).toBe('DEVICE_INACTIVE')
    expect(store.registeredDeviceId).toBeNull()
  })

  it('stops cloud sync on an outlet mismatch', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const adapter = createMemoryAdapter()
    await adapter.initialize()

    apiRequest
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        data: { data: { token: 'tok', user: { id: 1, name: 'U', email: 'u@x.com' } } },
        error: null,
      })
      .mockResolvedValueOnce(
        contextResponse({
          id: 10,
          name: 'Toko',
          role: 'cashier',
          sync_capabilities: makeCapabilities(),
          cloud_access: true,
          outlets: [{ id: 101, name: 'Pusat', status: 'active' }],
          device_context: { id: 555, outlet_id: 999, status: 'active' },
        }),
      )
      .mockResolvedValueOnce(
        contextResponse({
          id: 10,
          name: 'Toko',
          role: 'cashier',
          sync_capabilities: makeCapabilities(),
          cloud_access: true,
          outlets: [{ id: 101, name: 'Pusat', status: 'active' }],
          device_context: { id: 555, outlet_id: 999, status: 'active' },
        }),
      )

    const store = useCloudSessionStore(pinia)
    store.setPersistenceAdapter(adapter)
    store.deviceIdentifier = DEVICE_IDENTIFIER

    await store.login('u@x.com', 'pw')
    await store.selectBusiness(10)
    const outlet = await store.selectOutlet(101)

    expect(outlet.device.code).toBe('DEVICE_OUTLET_MISMATCH')
    expect(store.registeredDeviceId).toBeNull()
  })

  it('enforces the new role on the next request when a member becomes cashier', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const adapter = createMemoryAdapter()
    await adapter.initialize()

    apiRequest
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        data: { data: { token: 'tok', user: { id: 1, name: 'U', email: 'u@x.com' } } },
        error: null,
      })
      .mockResolvedValueOnce(
        contextResponse({
          id: 10,
          name: 'Toko',
          role: 'member',
          sync_capabilities: makeCapabilities(SYNC_PUSH_MODE_FULL),
          cloud_access: true,
          outlets: [{ id: 101, name: 'Pusat', status: 'active' }],
          device_context: { id: 555, outlet_id: 101, status: 'active' },
        }),
      )

    const store = useCloudSessionStore(pinia)
    store.setPersistenceAdapter(adapter)
    store.deviceIdentifier = DEVICE_IDENTIFIER

    await store.login('u@x.com', 'pw')
    await store.selectBusiness(10)
    await store.selectOutlet(101)
    expect(store.pushPolicy.pushMode).toBe(SYNC_PUSH_MODE_FULL)

    // The same token now maps to a cashier membership.
    apiRequest.mockResolvedValueOnce(
      contextResponse({
        id: 10,
        name: 'Toko',
        role: 'cashier',
        sync_capabilities: makeCapabilities(),
        cloud_access: true,
        outlets: [{ id: 101, name: 'Pusat', status: 'active' }],
        device_context: { id: 555, outlet_id: 101, status: 'active' },
      }),
    )

    const refreshed = await store.refreshContext()

    expect(refreshed.ok).toBe(true)
    expect(store.role).toBe('cashier')
    expect(store.pushPolicy.pushMode).toBe(SYNC_PUSH_MODE_CASHIER_SAFE)
    expect(store.role).not.toBe('member')
  })

  it('regains the full contract when a cashier becomes an owner after refresh', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const adapter = createMemoryAdapter()
    await adapter.initialize()

    apiRequest
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        data: { data: { token: 'tok', user: { id: 1, name: 'U', email: 'u@x.com' } } },
        error: null,
      })
      .mockResolvedValueOnce(
        contextResponse({
          id: 10,
          name: 'Toko',
          role: 'cashier',
          sync_capabilities: makeCapabilities(),
          cloud_access: true,
          outlets: [{ id: 101, name: 'Pusat', status: 'active' }],
          device_context: { id: 555, outlet_id: 101, status: 'active' },
        }),
      )

    const store = useCloudSessionStore(pinia)
    store.setPersistenceAdapter(adapter)
    store.deviceIdentifier = DEVICE_IDENTIFIER

    await store.login('u@x.com', 'pw')
    await store.selectBusiness(10)
    await store.selectOutlet(101)
    expect(store.pushPolicy.pushMode).toBe(SYNC_PUSH_MODE_CASHIER_SAFE)

    apiRequest.mockResolvedValueOnce(
      contextResponse({
        id: 10,
        name: 'Toko',
        role: 'owner',
        sync_capabilities: makeCapabilities(SYNC_PUSH_MODE_FULL),
        cloud_access: true,
        outlets: [{ id: 101, name: 'Pusat', status: 'active' }],
        device_context: { id: 555, outlet_id: 101, status: 'active' },
      }),
    )

    const refreshed = await store.refreshContext()

    expect(refreshed.ok).toBe(true)
    expect(store.pushPolicy.pushMode).toBe(SYNC_PUSH_MODE_FULL)
    expect(store.isCashierContext).toBe(false)
  })

  it('derives capabilities per business when switching business', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const adapter = createMemoryAdapter()
    await adapter.initialize()

    apiRequest
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        data: { data: { token: 'tok', user: { id: 1, name: 'U', email: 'u@x.com' } } },
        error: null,
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        data: {
          data: {
            user: { id: 1, name: 'U', email: 'u@x.com' },
            businesses: [
              {
                id: 10,
                name: 'Milik Sendiri',
                role: 'owner',
                sync_capabilities: makeCapabilities(SYNC_PUSH_MODE_FULL),
                cloud_access: true,
                outlets: [{ id: 101, name: 'Pusat', status: 'active' }],
                device_context: null,
              },
              {
                id: 11,
                name: 'Toko Lain',
                role: 'cashier',
                sync_capabilities: makeCapabilities(),
                cloud_access: true,
                outlets: [{ id: 102, name: 'Cabang', status: 'active' }],
                device_context: { id: 777, outlet_id: 102, status: 'active' },
              },
            ],
          },
        },
        error: null,
      })
      // INT-02: the cashier outlet selection refreshes the context with the
      // stable device identifier before resolving device_context.
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        data: {
          data: {
            user: { id: 1, name: 'U', email: 'u@x.com' },
            businesses: [
              {
                id: 10,
                name: 'Milik Sendiri',
                role: 'owner',
                sync_capabilities: makeCapabilities(SYNC_PUSH_MODE_FULL),
                cloud_access: true,
                outlets: [{ id: 101, name: 'Pusat', status: 'active' }],
                device_context: null,
              },
              {
                id: 11,
                name: 'Toko Lain',
                role: 'cashier',
                sync_capabilities: makeCapabilities(),
                cloud_access: true,
                outlets: [{ id: 102, name: 'Cabang', status: 'active' }],
                device_context: { id: 777, outlet_id: 102, status: 'active' },
              },
            ],
          },
        },
        error: null,
      })

    const store = useCloudSessionStore(pinia)
    store.setPersistenceAdapter(adapter)
    store.deviceIdentifier = DEVICE_IDENTIFIER

    await store.login('u@x.com', 'pw')

    await store.selectBusiness(10)
    expect(store.pushPolicy.pushMode).toBe(SYNC_PUSH_MODE_FULL)

    await store.selectBusiness(11)
    expect(store.pushPolicy.pushMode).toBe(SYNC_PUSH_MODE_CASHIER_SAFE)
    expect(store.role).toBe('cashier')

    const outlet = await store.selectOutlet(102)
    expect(outlet.device).toMatchObject({ ok: true, deviceId: 777 })

    // Switching business must never leak the other tenant's device.
    await store.selectBusiness(10)
    expect(store.registeredDeviceId).toBeNull()
    expect(store.deviceContext).toBeNull()
  })

  it('does not treat a persisted cache as verified authorization', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const adapter = createMemoryAdapter()
    await adapter.initialize()
    await saveToken('persisted-token')
    await adapter.saveCloudContext({
      user: { id: 1, name: 'U', email: 'u@x.com' },
      selectedBusiness: { id: 10, name: 'Toko' },
      selectedOutlet: { id: 101, name: 'Pusat' },
      cloudAccess: true,
      registeredDeviceId: 55,
      hasResolvedZeroBusiness: false,
      role: 'cashier',
      syncCapabilities: makeCapabilities(),
      capabilityState: 'verified',
    })

    const store = useCloudSessionStore(pinia)
    const hydration = await store.hydrateFromStorage(adapter)

    expect(hydration.authenticated).toBe(true)
    // Restored context is retained, but never marked as re-verified.
    expect(store.role).toBe('cashier')
    expect(store.capabilityState).toBe('unverified')
    expect(store.canPerformCloudPush).toBe(false)
    expect(store.syncCapabilitySummary.verified).toBe(false)
  })

  it('marks a pre-INT-02 cache as legacy without deleting data', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const adapter = createMemoryAdapter()
    await adapter.initialize()
    await saveToken('persisted-token')
    await adapter.saveCloudContext({
      user: { id: 1, name: 'U', email: 'u@x.com' },
      selectedBusiness: { id: 10, name: 'Toko' },
      selectedOutlet: { id: 101, name: 'Pusat' },
      cloudAccess: true,
      registeredDeviceId: 55,
      hasResolvedZeroBusiness: false,
    })

    const store = useCloudSessionStore(pinia)
    await store.hydrateFromStorage(adapter)

    expect(store.capabilityState).toBe('legacy')
    expect(store.role).toBeNull()
    // The cached context is preserved for offline continuity.
    expect(store.selectedBusiness).toMatchObject({ id: 10 })
    expect(store.registeredDeviceId).toBe(55)
  })
})

// ════════════════════════════════════════════════════════════════════════════
// 8. Sync status UX
// ════════════════════════════════════════════════════════════════════════════

describe('INT-02 — sync status', () => {
  it('reports the restricted count for a cashier-safe policy', async () => {
    const adapter = createMemoryAdapter()
    await adapter.initialize()
    const queueService = createSyncQueueService({ adapter })

    await queueService.enqueueUpsert(SYNC_ENTITY_TYPES.PRODUCT, 'p-1', {
      id: 'p-1',
      name: 'Produk Lokal',
      category: 'Minuman',
      price: 1000,
      isActive: true,
    })
    await queueService.enqueueUpsert(SYNC_ENTITY_TYPES.CUSTOMER, 'c-1', {
      id: 'c-1',
      name: 'Budi',
      phone: '0812',
      email: null,
    })

    const conflictService = { countOpenConflicts: async () => 0 }
    const statusService = createSyncStatusService({
      queueService,
      conflictService,
      adapter,
      capabilityProvider: () =>
        resolveSyncPushPolicy({ role: 'cashier', syncCapabilities: makeCapabilities() }),
    })

    const res = await statusService.readLocalStatus()

    expect(res.ok).toBe(true)
    expect(res.pendingCount).toBe(2)
    expect(res.restrictedCount).toBe(1)
  })

  it('renders a distinct UI status instead of implying a clean sync', () => {
    const restricted = deriveSyncUiStatus({
      cloudAvailable: true,
      online: true,
      pendingCount: 3,
      restrictedCount: 2,
    })

    expect(restricted.status).toBe(SYNC_UI_RESTRICTED)
    expect(restricted.restrictedCount).toBe(2)

    // Without restricted rows the existing behaviour is unchanged.
    const pending = deriveSyncUiStatus({ cloudAvailable: true, online: true, pendingCount: 3 })
    expect(pending.status).toBe('SYNC_UI_PENDING')
  })
})

// ════════════════════════════════════════════════════════════════════════════
// 8. Orchestrator — pull despite restricted rows
// ════════════════════════════════════════════════════════════════════════════

describe('INT-02 — orchestrator with restricted outbox', () => {
  it('still pulls while restricted rows are durable, and flags a partial sync', async () => {
    const pullNow = vi.fn(async () => ({ ok: true }))
    const pushNow = vi.fn(async () => ({
      ok: true,
      blocked: [],
      restricted: [{ queueId: 'q1', code: 'CASHIER_ENTITY_DENIED' }],
      deferred: [],
      remaining: 1,
    }))

    const orchestrator = createSyncOrchestratorService({
      pushService: { pushNow },
      pullService: { pullNow },
      conflictService: { countOpenConflicts: async () => 0 },
    })

    const result = await orchestrator.syncAll()

    expect(pullNow).toHaveBeenCalledTimes(1)
    expect(result.ok).toBe(true)
    expect(result.code).toBe('SYNC_ALL_COMPLETED_WITH_RESTRICTED')
    expect(result.partial).toBe(true)
    expect(result.restricted).toHaveLength(1)
  })

  it('still stops before pull on a hard blocked push', async () => {
    const pullNow = vi.fn(async () => ({ ok: true }))
    const pushNow = vi.fn(async () => ({
      ok: true,
      blocked: [{ queueId: 'q1', code: 'NO_MAPPED_SERVER_CHANGE' }],
      restricted: [],
      deferred: [],
      remaining: 1,
    }))

    const orchestrator = createSyncOrchestratorService({
      pushService: { pushNow },
      pullService: { pullNow },
      conflictService: { countOpenConflicts: async () => 0 },
    })

    const result = await orchestrator.syncAll()

    expect(pullNow).not.toHaveBeenCalled()
    expect(result.code).toBe('SYNC_PUSH_BLOCKED_PENDING')
  })
})

// ════════════════════════════════════════════════════════════════════════════
// 16. SQLite / memory parity
// ════════════════════════════════════════════════════════════════════════════

describe('INT-02 — SQLite / memory parity', () => {
  beforeEach(() => {
    fakeDb.state.reset()
  })

  async function runScenario(adapter) {
    const pinia = createPinia()
    setActivePinia(pinia)
    await adapter.initialize()
    await adapter.saveSyncPushBinding({ businessId: 10, boundAt: NOW })

    const queueService = createSyncQueueService({ adapter })
    const registry = createSyncIdentityRegistry({ adapter })

    const requests = []
    const pushService = createSyncPushService({
      adapter,
      queueService,
      registry,
      tokenFetcher: async () => 'test-token',
      transport: async (args) => {
        requests.push(args)
        return {
          ok: true,
          status: 200,
          data: { data: { request_id: args.body.request_id, duplicate: false } },
          error: null,
        }
      },
    })

    await queueService.enqueueUpsert(SYNC_ENTITY_TYPES.PRODUCT, 'local-product', {
      id: 'local-product',
      name: 'Produk Baru',
      category: 'Minuman',
      price: 5000,
      isActive: true,
    })
    await queueService.enqueueUpsert(SYNC_ENTITY_TYPES.CUSTOMER, 'cust-1', {
      id: 'cust-1',
      name: 'Budi',
      phone: '0812',
      email: null,
    })

    const result = await pushService.pushNow({ context: cashierContext() })

    return {
      result,
      requests,
      pending: (await queueService.listPending({ limit: 100 }))
        .map((item) => item.entityType)
        .sort(),
    }
  }

  it('produces an identical restricted/allow split on both adapters', async () => {
    const memory = await runScenario(createMemoryAdapter())
    const sqlite = await runScenario(createSQLiteAdapter())

    expect(sqlite.requests).toHaveLength(memory.requests.length)
    expect(sqlite.requests[0].body.changes.products).toEqual(
      memory.requests[0].body.changes.products,
    )
    expect(sqlite.requests[0].body.changes.customers).toHaveLength(1)
    expect(memory.requests[0].body.changes.customers).toHaveLength(1)
    expect(sqlite.result.restricted.map((i) => i.code)).toEqual(
      memory.result.restricted.map((i) => i.code),
    )
    expect(sqlite.pending).toEqual(memory.pending)
    expect(sqlite.pending).toEqual([SYNC_ENTITY_TYPES.PRODUCT])
  })
})

// ════════════════════════════════════════════════════════════════════════════
// 17. Bootstrap
// ════════════════════════════════════════════════════════════════════════════

describe('INT-02 — bootstrap preconditions', () => {
  it('requires a bootstrap or binding before the first cloud push', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const adapter = createMemoryAdapter()
    await adapter.initialize()

    const queueService = createSyncQueueService({ adapter })
    const registry = createSyncIdentityRegistry({ adapter })

    const pushService = createSyncPushService({
      adapter,
      queueService,
      registry,
      tokenFetcher: async () => 'test-token',
      transport: async () => ({
        ok: true,
        status: 200,
        data: { data: { request_id: null } },
        error: null,
      }),
    })

    await queueService.enqueueUpsert(SYNC_ENTITY_TYPES.CUSTOMER, 'cust-1', {
      id: 'cust-1',
      name: 'Budi',
      phone: '0812',
      email: null,
    })

    const result = await pushService.pushNow({ context: cashierContext() })

    expect(result.ok).toBe(false)
    expect(result.code).toBe('SYNC_BOOTSTRAP_REQUIRED')
    expect(await queueService.countPending()).toBe(1)
  })
})

// ════════════════════════════════════════════════════════════════════════════
// INT-02 review hardening — helpers
// ════════════════════════════════════════════════════════════════════════════

/**
 * A context shaped exactly like the one the orchestrator / auto-sync callers
 * build: it carries the cloud coordinates but deliberately omits
 * role / syncCapabilities / capabilityState. Authorization must therefore come
 * from the verified store snapshot, never from this object.
 */
function rolelessPushContext() {
  return {
    user: { id: 1 },
    selectedBusiness: { id: 10 },
    selectedOutlet: { id: 101 },
    cloudAccess: true,
    deviceIdentifier: DEVICE_IDENTIFIER,
    registeredDeviceId: 55,
  }
}

function patchCashierCapabilityState(cloudStore, capabilityState) {
  cloudStore.$patch({
    user: { id: 1, name: 'Kasir', email: 'kasir@example.com' },
    selectedBusiness: { id: 10, name: 'Toko Kopi' },
    selectedOutlet: { id: 101, name: 'Outlet Pusat' },
    cloudAccess: true,
    deviceIdentifier: DEVICE_IDENTIFIER,
    registeredDeviceId: 55,
    role: 'cashier',
    syncCapabilities: makeCapabilities(),
    capabilityState,
  })
}

function contextBusiness(overrides = {}) {
  return {
    id: 10,
    name: 'Toko Kopi',
    role: 'cashier',
    sync_capabilities: makeCapabilities(),
    cloud_access: true,
    outlets: [{ id: 101, name: 'Outlet Pusat', status: 'active' }],
    device_context: { id: 55, identifier: DEVICE_IDENTIFIER, outlet_id: 101, status: 'active' },
    ...overrides,
  }
}

function contextEnvelope(businesses) {
  return {
    ok: true,
    status: 200,
    data: { data: { user: { id: 1, name: 'Kasir', email: 'kasir@example.com' }, businesses } },
    error: null,
  }
}

/** Push service wired with a real cloud store verifier (no live backend). */
async function createVerifyingHarness({ transportImpl = null } = {}) {
  const pinia = createPinia()
  setActivePinia(pinia)
  const adapter = createMemoryAdapter()
  await adapter.initialize()
  await adapter.saveSyncPushBinding({ businessId: 10, boundAt: NOW })

  const scheduler = createPersistenceService({ adapter, pinia })
  await scheduler.initialize()
  const queueService = createSyncQueueService({ adapter, scheduler })
  const registry = createSyncIdentityRegistry({ adapter, scheduler })
  const cloudStore = useCloudSessionStore(pinia)
  cloudStore.setPersistenceAdapter(adapter)

  const requests = []
  const transport = vi.fn(async (args) => {
    requests.push(args)
    if (transportImpl) return transportImpl(args)
    return {
      ok: true,
      status: 200,
      data: { data: { request_id: args.body.request_id, duplicate: false } },
      error: null,
    }
  })

  const pushService = createSyncPushService({
    adapter,
    scheduler,
    queueService,
    registry,
    tokenFetcher: async () => 'test-token',
    transport,
    capabilityVerifier: () => cloudStore.ensureVerifiedContext(),
  })

  return {
    pinia,
    adapter,
    scheduler,
    queueService,
    registry,
    cloudStore,
    pushService,
    transport,
    requests,
  }
}

// ════════════════════════════════════════════════════════════════════════════
// Finding 2 — fail-closed push authorization context
// ════════════════════════════════════════════════════════════════════════════

describe('INT-02 — fail-closed push authorization context', () => {
  beforeEach(() => {
    _resetTokenStore()
    vi.clearAllMocks()
  })

  it('applies the verified cashier policy when the caller omits role/capabilities (orchestrator/auto-sync)', async () => {
    const harness = await createVerifyingHarness()
    patchCashierCapabilityState(harness.cloudStore, 'verified')
    await bindKnownProduct(harness.registry, harness.adapter, 'known-product')
    await enqueueCashierMixedOutbox(harness.queueService)

    const result = await harness.pushService.pushNow({ context: rolelessPushContext() })

    expect(result.ok).toBe(true)
    expect(result.policy.pushMode).toBe(SYNC_PUSH_MODE_CASHIER_SAFE)
    const body = harness.requests[0].body
    expect(body.changes.products).toEqual([])
    expect(body.changes.categories).toEqual([])
    expect(body.changes.expenses).toEqual([])
    expect(result.restricted.map((item) => item.entityType)).toContain(SYNC_ENTITY_TYPES.PRODUCT)
  })

  it('refreshes the capability online before pushing an unverified cache', async () => {
    const harness = await createVerifyingHarness()
    patchCashierCapabilityState(harness.cloudStore, 'unverified')
    await bindKnownProduct(harness.registry, harness.adapter, 'known-product')
    await enqueueCashierMixedOutbox(harness.queueService)
    await saveToken('test-token')

    apiRequest.mockResolvedValueOnce(contextEnvelope([contextBusiness()]))

    const result = await harness.pushService.pushNow({ context: rolelessPushContext() })

    const contextCalls = apiRequest.mock.calls.filter((call) =>
      String(call[0]).startsWith('/api/mobile/context'),
    )
    expect(contextCalls).toHaveLength(1)
    expect(contextCalls[0][0]).toContain(`device_identifier=${DEVICE_IDENTIFIER}`)
    expect(result.ok).toBe(true)
    expect(harness.requests[0].body.changes.products).toEqual([])
  })

  it('fails closed and preserves the outbox when the online refresh fails', async () => {
    const harness = await createVerifyingHarness()
    patchCashierCapabilityState(harness.cloudStore, 'unverified')
    await enqueueCashierMixedOutbox(harness.queueService)
    await saveToken('test-token')
    const pendingBefore = await harness.queueService.countPending()

    apiRequest.mockResolvedValueOnce({
      ok: false,
      status: 0,
      data: null,
      error: { code: 'NETWORK_ERROR', message: 'offline' },
    })

    const result = await harness.pushService.pushNow({ context: rolelessPushContext() })

    expect(result.ok).toBe(false)
    expect(result.code).toBe('SYNC_CAPABILITIES_UNVERIFIED')
    expect(harness.transport).not.toHaveBeenCalled()
    expect(await harness.queueService.countPending()).toBe(pendingBefore)
  })

  it('stays fail-closed and preserves the outbox across an offline restart', async () => {
    const harness = await createVerifyingHarness()
    await saveToken('restart-token')
    await harness.adapter.saveDeviceIdentifier(DEVICE_IDENTIFIER)
    await harness.adapter.saveCloudContext({
      user: { id: 1, name: 'Kasir', email: 'kasir@example.com' },
      selectedBusiness: { id: 10, name: 'Toko Kopi' },
      selectedOutlet: { id: 101, name: 'Outlet Pusat' },
      cloudAccess: true,
      registeredDeviceId: 55,
      role: 'cashier',
      syncCapabilities: makeCapabilities(),
      capabilityState: 'verified',
    })

    // "Restart": hydrate a fresh session from the persisted cache.
    await harness.cloudStore.hydrateFromStorage(harness.adapter)
    expect(harness.cloudStore.capabilityState).toBe('unverified')

    await enqueueCashierMixedOutbox(harness.queueService)
    const pendingBefore = await harness.queueService.countPending()

    apiRequest.mockResolvedValueOnce({
      ok: false,
      status: 0,
      data: null,
      error: { code: 'NETWORK_ERROR', message: 'offline' },
    })

    const result = await harness.pushService.pushNow({ context: rolelessPushContext() })

    expect(result.ok).toBe(false)
    expect(result.code).toBe('SYNC_CAPABILITIES_UNVERIFIED')
    expect(harness.transport).not.toHaveBeenCalled()
    expect(await harness.queueService.countPending()).toBe(pendingBefore)
  })

  it('keeps the owner/member contract after a successful online verification of a legacy backend', async () => {
    const harness = await createVerifyingHarness()
    harness.cloudStore.$patch({
      user: { id: 1, name: 'Pemilik', email: 'owner@example.com' },
      selectedBusiness: { id: 10, name: 'Toko Kopi' },
      selectedOutlet: { id: 101, name: 'Outlet Pusat' },
      cloudAccess: true,
      deviceIdentifier: DEVICE_IDENTIFIER,
      registeredDeviceId: 55,
      role: null,
      syncCapabilities: null,
      capabilityState: 'legacy',
    })
    await enqueueCashierMixedOutbox(harness.queueService)
    await saveToken('test-token')

    // A legacy backend returns no role and no capabilities.
    apiRequest.mockResolvedValueOnce(
      contextEnvelope([
        {
          id: 10,
          name: 'Toko Kopi',
          cloud_access: true,
          outlets: [{ id: 101, name: 'Outlet Pusat', status: 'active' }],
          device_context: {
            id: 55,
            identifier: DEVICE_IDENTIFIER,
            outlet_id: 101,
            status: 'active',
          },
        },
      ]),
    )

    const result = await harness.pushService.pushNow({ context: rolelessPushContext() })

    expect(result.ok).toBe(true)
    expect(result.policy.pushMode).toBe(SYNC_PUSH_MODE_FULL)
    expect(harness.requests[0].body.changes.products).toHaveLength(1)
  })

  it('lets auto-sync run with the verified cashier policy (no restricted entity on the wire)', async () => {
    const harness = await createVerifyingHarness()
    patchCashierCapabilityState(harness.cloudStore, 'verified')
    await bindKnownProduct(harness.registry, harness.adapter, 'known-product')
    await enqueueCashierMixedOutbox(harness.queueService)

    const orchestrator = createSyncOrchestratorService({
      pushService: harness.pushService,
      pullService: { pullNow: async () => ({ ok: true, applied: 0 }) },
      conflictService: { countOpenConflicts: async () => 0 },
    })

    const autoSync = createSyncAutoSyncService({
      adapter: harness.adapter,
      healthService: {
        checkHealth: async () => ({
          ok: true,
          status: 'ready',
          code: 'SYNC_HEALTH_READY',
          issues: [],
        }),
      },
      orchestratorService: orchestrator,
      activityLogService: { record: async () => {} },
    })

    const context = {
      user: { id: 1 },
      businessId: 10,
      outletId: 101,
      deviceIdentifier: DEVICE_IDENTIFIER,
      registeredDeviceId: 55,
      cloudAccess: true,
    }
    await autoSync.setEnabled({ context, enabled: true })

    const result = await autoSync.runOnce({
      context,
      trigger: 'online',
      online: true,
      isForeground: true,
    })

    expect(result.ok).toBe(true)
    expect(harness.requests[0].body.changes.products).toEqual([])
    expect(harness.requests[0].body.changes.customers).toHaveLength(1)
  })

  it('enforces the downgraded cashier role for an old token on the next push', async () => {
    const harness = await createVerifyingHarness()
    // Stale member cache with the old token still installed.
    harness.cloudStore.$patch({
      user: { id: 1, name: 'Anggota', email: 'member@example.com' },
      selectedBusiness: { id: 10, name: 'Toko Kopi' },
      selectedOutlet: { id: 101, name: 'Outlet Pusat' },
      cloudAccess: true,
      deviceIdentifier: DEVICE_IDENTIFIER,
      registeredDeviceId: 55,
      role: 'member',
      syncCapabilities: makeCapabilities(SYNC_PUSH_MODE_FULL),
      capabilityState: 'unverified',
    })
    await bindKnownProduct(harness.registry, harness.adapter, 'known-product')
    await enqueueCashierMixedOutbox(harness.queueService)
    await saveToken('old-member-token')

    // The same token now maps to a cashier membership.
    apiRequest.mockResolvedValueOnce(contextEnvelope([contextBusiness()]))

    const result = await harness.pushService.pushNow({ context: rolelessPushContext() })

    expect(result.ok).toBe(true)
    expect(result.policy.pushMode).toBe(SYNC_PUSH_MODE_CASHIER_SAFE)
    expect(harness.requests[0].body.changes.products).toEqual([])
    expect(result.restricted.map((item) => item.entityType)).toContain(SYNC_ENTITY_TYPES.PRODUCT)
  })
})

// ════════════════════════════════════════════════════════════════════════════
// Finding 3 — revoked membership
// ════════════════════════════════════════════════════════════════════════════

describe('INT-02 — revoked membership', () => {
  beforeEach(() => {
    _resetTokenStore()
    vi.clearAllMocks()
  })

  it('cancels the cloud context and revokes the device when the selected business disappears', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const adapter = createMemoryAdapter()
    await adapter.initialize()
    await adapter.saveDeviceIdentifier(DEVICE_IDENTIFIER)
    await saveToken('persisted-old-token')
    await adapter.saveCloudContext({
      user: { id: 1, name: 'Kasir', email: 'kasir@example.com' },
      selectedBusiness: { id: 10, name: 'Toko Kopi' },
      selectedOutlet: { id: 101, name: 'Outlet Pusat' },
      cloudAccess: true,
      registeredDeviceId: 55,
      role: 'cashier',
      syncCapabilities: makeCapabilities(),
      capabilityState: 'verified',
    })
    await adapter.saveProducts(
      [{ id: 'p1', name: 'Kopi', category: 'Minuman', price: 10000, stock: 5, isActive: true }],
      ['Minuman'],
    )
    await adapter.upsertSyncQueueItem({
      id: 'sq1',
      entityType: 'customer',
      entityId: 'c1',
      operation: 'upsert',
      payload: { id: 'c1', name: 'Budi' },
      createdAt: NOW,
      updatedAt: NOW,
      attemptCount: 0,
      lastError: null,
    })

    const store = useCloudSessionStore(pinia)
    await store.hydrateFromStorage(adapter)
    expect(store.capabilityState).toBe('unverified')

    apiRequest.mockResolvedValueOnce(
      contextEnvelope([
        {
          id: 11,
          name: 'Toko Lain',
          role: 'cashier',
          sync_capabilities: makeCapabilities(),
          cloud_access: true,
          outlets: [{ id: 102, name: 'Cabang', status: 'active' }],
          device_context: null,
        },
      ]),
    )

    const refreshed = await store.refreshContext()

    expect(refreshed.ok).toBe(false)
    expect(refreshed.code).toBe('BUSINESS_ACCESS_REVOKED')
    expect(store.capabilityState).toBe('revoked')
    expect(store.selectedBusiness).toBeNull()
    expect(store.selectedOutlet).toBeNull()
    expect(store.registeredDeviceId).toBeNull()
    expect(store.role).toBeNull()
    expect(store.syncCapabilities).toBeNull()
    expect(store.deviceContext).toBeNull()
    expect(store.cloudAccess).toBe(false)
    expect(store.canPerformCloudPush).toBe(false)
    expect(store.error).toContain('Pilih bisnis lain')

    // The old (still valid) token and all local POS data are preserved.
    expect(await getToken()).toBe('persisted-old-token')
    const products = await adapter.loadProducts()
    expect(products.products).toHaveLength(1)
    expect(await adapter.countSyncQueueItems()).toBe(1)
  })

  it('fails closed for push on a revoked membership without deleting the outbox', async () => {
    const harness = await createVerifyingHarness()
    patchCashierCapabilityState(harness.cloudStore, 'unverified')
    await enqueueCashierMixedOutbox(harness.queueService)
    await saveToken('old-token')
    const pendingBefore = await harness.queueService.countPending()

    // Refresh succeeds but the previously selected business (10) is gone.
    apiRequest.mockResolvedValueOnce(
      contextEnvelope([
        {
          id: 11,
          name: 'Toko Lain',
          role: 'cashier',
          sync_capabilities: makeCapabilities(),
          cloud_access: true,
          outlets: [{ id: 102, name: 'Cabang', status: 'active' }],
          device_context: null,
        },
      ]),
    )

    const result = await harness.pushService.pushNow({ context: rolelessPushContext() })

    expect(result.ok).toBe(false)
    expect(result.code).toBe('SYNC_CAPABILITIES_UNVERIFIED')
    expect(result.authorizationCode).toBe('BUSINESS_ACCESS_REVOKED')
    expect(harness.cloudStore.capabilityState).toBe('revoked')
    expect(harness.cloudStore.registeredDeviceId).toBeNull()
    expect(harness.transport).not.toHaveBeenCalled()
    expect(await harness.queueService.countPending()).toBe(pendingBefore)
  })
})

// ════════════════════════════════════════════════════════════════════════════
// Finding 1 — cashier device onboarding
// ════════════════════════════════════════════════════════════════════════════

describe('INT-02 — cashier device onboarding', () => {
  beforeEach(() => {
    _resetTokenStore()
    vi.clearAllMocks()
  })

  it('does not bind a device_context whose identifier belongs to another device', () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const store = useCloudSessionStore(pinia)
    store.deviceIdentifier = DEVICE_IDENTIFIER
    store.businesses = [
      {
        id: 10,
        name: 'Toko Kopi',
        device_context: {
          id: 55,
          identifier: 'other-installation-identifier',
          outlet_id: 101,
          status: 'active',
        },
      },
    ]
    store.selectedBusiness = { id: 10, name: 'Toko Kopi' }
    store.selectedOutlet = { id: 101, name: 'Outlet Pusat' }

    const res = store.resolveDeviceFromContext()

    expect(res.ok).toBe(false)
    expect(res.code).toBe('DEVICE_IDENTIFIER_MISMATCH')
    expect(store.registeredDeviceId).toBeNull()
  })

  it('drives the real cashier login UI through resolution without registering a device', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const adapter = createMemoryAdapter()
    await adapter.initialize()

    const store = useCloudSessionStore(pinia)
    store.setPersistenceAdapter(adapter)
    store.deviceIdentifier = DEVICE_IDENTIFIER

    const ok = (data) => ({ ok: true, status: 200, data: { data }, error: null })

    apiRequest
      // 1. login
      .mockResolvedValueOnce(
        ok({
          token_type: 'Bearer',
          token: 'tok',
          user: { id: 1, name: 'Kasir', email: 'kasir@example.com' },
        }),
      )
      // 2. login context: cashier, single active outlet, device not resolved yet
      .mockResolvedValueOnce(
        ok({
          user: { id: 1, name: 'Kasir', email: 'kasir@example.com' },
          businesses: [
            {
              id: 10,
              name: 'Toko Kopi',
              role: 'cashier',
              sync_capabilities: makeCapabilities(),
              cloud_access: true,
              outlets: [{ id: 101, name: 'Outlet Pusat', status: 'active' }],
              device_context: null,
            },
          ],
        }),
      )
      // 3. outlet selection refreshes the context with the stable identifier
      .mockResolvedValueOnce(
        ok({
          user: { id: 1, name: 'Kasir', email: 'kasir@example.com' },
          businesses: [contextBusiness()],
        }),
      )

    const wrapper = mount(CloudLoginView, { global: { plugins: [pinia] } })

    await wrapper.find('#cloud-email input').setValue('kasir@example.com')
    await wrapper.find('#cloud-password input').setValue('secret')
    await wrapper.find('#cloud-login-btn').trigger('click')
    await flushPromises()
    await flushPromises()
    await flushPromises()

    expect(store.registeredDeviceId).toBe(55)
    expect(store.deviceContext).toMatchObject({ id: 55, outlet_id: 101, status: 'active' })

    const loggedIn = wrapper.find('#cloud-logged-in')
    expect(loggedIn.exists()).toBe(true)
    expect(loggedIn.text()).toContain('Terdaftar')

    const contextCalls = apiRequest.mock.calls.filter((call) =>
      String(call[0]).startsWith('/api/mobile/context'),
    )
    expect(contextCalls.length).toBeGreaterThanOrEqual(2)
    expect(
      contextCalls.every((call) => call[0].includes(`device_identifier=${DEVICE_IDENTIFIER}`)),
    ).toBe(true)
    expect(
      apiRequest.mock.calls.filter((call) => String(call[0]).includes('/api/mobile/devices')),
    ).toHaveLength(0)

    wrapper.unmount()
  })
})

// ════════════════════════════════════════════════════════════════════════════
// Finding 4 — restricted product dependency
// ════════════════════════════════════════════════════════════════════════════

describe('INT-02 — restricted product dependency', () => {
  it('allows a sale whose restricted product already exists on the server', async () => {
    const harness = await createPushHarness({ context: cashierContext() })
    await bindKnownProduct(harness.registry, harness.adapter, 'known-product')

    // A product outbox row that is role-restricted for the cashier, but the
    // product itself already exists on the server.
    await harness.queueService.enqueueUpsert(SYNC_ENTITY_TYPES.PRODUCT, 'known-product', {
      id: 'known-product',
      name: 'Kopi',
      category: 'Minuman',
      price: 10000,
      isActive: true,
    })
    await harness.queueService.enqueueUpsert(
      SYNC_ENTITY_TYPES.TRANSACTION,
      'trx-1',
      transactionPayload(),
    )

    const result = await harness.push()

    expect(result.ok).toBe(true)
    const body = harness.requests[0].body
    // The product mutation is never sent, but its sale is allowed.
    expect(body.changes.products).toEqual([])
    expect(body.changes.sales).toHaveLength(1)
    expect(body.changes.sale_items.length).toBeGreaterThan(0)
    expect(result.deferred).toEqual([])

    // The restricted product row stays durable.
    const pending = await harness.queueService.listPending({ limit: 100 })
    expect(pending.map((item) => item.entityType)).toContain(SYNC_ENTITY_TYPES.PRODUCT)
  })

  it('dependency-blocks a sale when the product only exists as a restricted local row', async () => {
    const harness = await createPushHarness({ context: cashierContext() })

    await harness.queueService.enqueueUpsert(SYNC_ENTITY_TYPES.PRODUCT, 'local-only', {
      id: 'local-only',
      name: 'Produk Lokal',
      category: 'Minuman',
      price: 1000,
      isActive: true,
    })
    await harness.queueService.enqueueUpsert(
      SYNC_ENTITY_TYPES.TRANSACTION,
      'trx-1',
      transactionPayload({
        items: [{ id: 'local-only', name: 'Produk Lokal', price: 1000, qty: 1 }],
        subtotal: 1000,
        total: 1000,
      }),
    )

    const result = await harness.push()

    expect(harness.transport).not.toHaveBeenCalled()
    expect(result.deferred.map((item) => item.code)).toContain(
      'SALE_PRODUCT_NOT_AVAILABLE_ON_SERVER',
    )

    const pending = await harness.queueService.listPending({ limit: 100 })
    const pendingTypes = pending.map((item) => item.entityType).sort()
    expect(pendingTypes).toEqual([SYNC_ENTITY_TYPES.PRODUCT, SYNC_ENTITY_TYPES.TRANSACTION])
  })
})
