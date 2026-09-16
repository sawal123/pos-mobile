/**
 * P37 — Cloud Sync Contract Parity Test Suite (mobile side).
 *
 * Verifies the extended local contract against the real Laravel P37 payload
 * shape sent over HTTP in the E2E run:
 * 1. Product semantic fields (kind/cost/stock/unit/min_stock/pricing_unit/
 *    min_quantity/estimated_duration) map into the push payload.
 * 2. Sale payment snapshot fields (payment_method/payment_status/paid_at/
 *    cash_received/change_amount) map into the sale payload.
 * 3. Decimal sale-item quantities (Laundry kg) map and validate.
 * 4. Cash entries map with reference identity; duplicates via referenceId are
 *    never re-queued by the tracker.
 * 5. Stock movements map with product resolution and stable movement identity.
 * 6. Pull applies product semantics (without clobbering local stock),
 *    payment snapshots (fill-in only), and records cash/stock version cursors.
 * 7. Production API safety guard rejects localhost/empty base URLs.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

import { createMemoryAdapter } from '../services/database/memoryAdapter'
import {
  createSyncIdentityRegistry,
  isUuid,
} from '../services/sync/syncIdentityRegistry'
import { mapOutboxEntries } from '../services/sync/contractMapper'
import { createSyncPullService, isProductionApiConfigured } from '../services/sync/syncPullService'
import { createSyncChangeTracker } from '../services/sync/syncTracker'
import { createSyncQueueService } from '../services/sync/syncQueueService'
import { SYNC_ENTITY_TYPES, SYNC_OPERATIONS } from '../services/sync/syncConstants'
import { useBusinessStore } from '../stores/businessStore'
import { useProductStore } from '../stores/productStore'
import { useCashStore } from '../stores/cashStore'
import { useTransactionStore } from '../stores/transactionStore'

const PROD_UUID = '11111111-1111-4111-8111-111111111111'
const CAT_UUID = '22222222-2222-4222-8222-222222222222'

function makeContext() {
  return {
    user: { id: 1, name: 'Owner', email: 'owner@example.com' },
    selectedBusiness: { id: 10, name: 'Kedai' },
    selectedOutlet: { id: 101, name: 'Outlet' },
    cloudAccess: true,
    deviceIdentifier: '33333333-3333-4333-8333-333333333333',
    registeredDeviceId: 55,
  }
}

describe('P37: product semantic push mapping', () => {
  let adapter
  let registry

  beforeEach(async () => {
    adapter = createMemoryAdapter()
    await adapter.initialize()
    registry = createSyncIdentityRegistry({ adapter })
  })

  it('maps Laundry service semantics into the product payload', async () => {
    const result = await mapOutboxEntries(
      [
        {
          id: 'q-p37-prod',
          entityType: SYNC_ENTITY_TYPES.PRODUCT,
          entityId: 'svc-1',
          operation: SYNC_OPERATIONS.UPSERT,
          payload: {
            id: 'svc-1',
            name: 'Cuci Kering',
            category: 'Laundry',
            price: 10000,
            kind: 'service',
            cost: 4000,
            stock: 0,
            unit: 'kg',
            minStock: 0,
            pricingUnit: 'kg',
            minQuantity: 1,
            estimatedDuration: '2 hari',
            isActive: true,
          },
        },
      ],
      { registry },
    )

    expect(result.blocked).toHaveLength(0)
    expect(result.changes.products).toHaveLength(1)

    const p = result.changes.products[0]
    expect(p.kind).toBe('service')
    expect(p.cost).toBe(4000)
    expect(p.stock).toBe(0)
    expect(p.unit).toBe('kg')
    expect(p.min_stock).toBe(0)
    expect(p.pricing_unit).toBe('kg')
    expect(p.min_quantity).toBe(1)
    expect(p.estimated_duration).toBe('2 hari')
    expect(isUuid(p.sync_id)).toBe(true)
  })

  it('omits semantic fields that are absent so server update preserves them', async () => {
    const result = await mapOutboxEntries(
      [
        {
          id: 'q-p37-prod-min',
          entityType: SYNC_ENTITY_TYPES.PRODUCT,
          entityId: 'prod-1',
          operation: SYNC_OPERATIONS.UPSERT,
          payload: { id: 'prod-1', name: 'Kopi', category: 'Minuman', price: 15000, isActive: true },
        },
      ],
      { registry },
    )

    expect(result.blocked).toHaveLength(0)
    const p = result.changes.products[0]
    expect(p.cost).toBeUndefined()
    expect(p.stock).toBeUndefined()
    expect(p.unit).toBeUndefined()
    expect(p.min_stock).toBeUndefined()
  })

  it('does not treat imageData as a cloud field', async () => {
    const result = await mapOutboxEntries(
      [
        {
          id: 'q-p37-prod-img',
          entityType: SYNC_ENTITY_TYPES.PRODUCT,
          entityId: 'prod-img',
          operation: SYNC_OPERATIONS.UPSERT,
          payload: {
            id: 'prod-img',
            name: 'Teh',
            category: 'Minuman',
            price: 5000,
            imageData: 'data:image/png;base64,iVBORw0KGgo=',
            isActive: true,
          },
        },
      ],
      { registry },
    )

    expect(result.blocked).toHaveLength(0)
    const p = result.changes.products[0]
    expect(p.image_data).toBeUndefined()
    expect(p.imageData).toBeUndefined()
  })
})

describe('P37: sale payment snapshot and decimal qty mapping', () => {
  let adapter
  let registry

  beforeEach(async () => {
    adapter = createMemoryAdapter()
    await adapter.initialize()
    registry = createSyncIdentityRegistry({ adapter })
  })

  it('maps payment snapshots and fractional Laundry quantities', async () => {
    const result = await mapOutboxEntries(
      [
        {
          id: 'q-p37-trx',
          entityType: SYNC_ENTITY_TYPES.TRANSACTION,
          entityId: 'trx-p37',
          operation: SYNC_OPERATIONS.UPSERT,
          payload: {
            id: 'trx-p37',
            invoiceNumber: 'LDR-20260916-0001',
            status: 'unpaid',
            paymentStatus: 'unpaid',
            paymentMethod: '',
            subtotal: 25000,
            tax: 0,
            total: 25000,
            paidAt: null,
            createdAt: '2026-09-16T10:00:00.000Z',
            items: [{ id: 'svc-1', name: 'Cuci Kering', price: 10000, qty: 2.5 }],
          },
        },
      ],
      { registry },
    )

    expect(result.blocked).toHaveLength(0)
    expect(result.changes.sales).toHaveLength(1)
    expect(result.changes.sale_items).toHaveLength(1)

    const sale = result.changes.sales[0]
    expect(sale.transaction_number).toBe('LDR-20260916-0001')
    expect(sale.payment_status).toBe('unpaid')
    expect(sale.payment_method).toBeUndefined()
    expect(sale.paid_at).toBeUndefined()

    const item = result.changes.sale_items[0]
    expect(item.quantity).toBe(2.5)
    expect(item.line_total).toBe(25000)
  })

  it('keeps integer quantities exact for retail items', async () => {
    const result = await mapOutboxEntries(
      [
        {
          id: 'q-p37-trx-int',
          entityType: SYNC_ENTITY_TYPES.TRANSACTION,
          entityId: 'trx-int',
          operation: SYNC_OPERATIONS.UPSERT,
          payload: {
            id: 'trx-int',
            invoiceNumber: 'INV-1',
            status: 'paid',
            paymentStatus: 'paid',
            paymentMethod: 'cash',
            cashReceived: 50000,
            changeAmount: 10000,
            subtotal: 40000,
            tax: 0,
            total: 40000,
            paidAt: '2026-09-16T10:00:00.000Z',
            createdAt: '2026-09-16T10:00:00.000Z',
            items: [{ id: 'p1', name: 'Burger', price: 20000, qty: 2 }],
          },
        },
      ],
      { registry },
    )

    expect(result.blocked).toHaveLength(0)
    const sale = result.changes.sales[0]
    expect(sale.payment_method).toBe('cash')
    expect(sale.payment_status).toBe('paid')
    expect(sale.paid_at).toBe('2026-09-16T10:00:00.000Z')
    expect(sale.cash_received).toBe(50000)
    expect(sale.change_amount).toBe(10000)
    expect(result.changes.sale_items[0].quantity).toBe(2)
  })

  it('rejects zero and negative quantities', async () => {
    const result = await mapOutboxEntries(
      [
        {
          id: 'q-p37-trx-bad',
          entityType: SYNC_ENTITY_TYPES.TRANSACTION,
          entityId: 'trx-bad',
          operation: SYNC_OPERATIONS.UPSERT,
          payload: {
            id: 'trx-bad',
            invoiceNumber: 'INV-BAD',
            subtotal: 0,
            total: 0,
            createdAt: '2026-09-16T10:00:00.000Z',
            items: [{ id: 'p1', name: 'X', price: 1000, qty: 0 }],
          },
        },
      ],
      { registry },
    )

    expect(result.changes.sales).toHaveLength(0)
    expect(result.blocked[0].code).toBe('INVALID_TRANSACTION_ITEM')
  })
})

describe('P37: cash entry and stock movement mapping', () => {
  let adapter
  let registry

  beforeEach(async () => {
    adapter = createMemoryAdapter()
    await adapter.initialize()
    registry = createSyncIdentityRegistry({ adapter })
  })

  it('maps a cash sale entry with reference identity', async () => {
    const result = await mapOutboxEntries(
      [
        {
          id: 'q-p37-cash',
          entityType: SYNC_ENTITY_TYPES.CASH_ENTRY,
          entityId: 'cash-1',
          operation: SYNC_OPERATIONS.UPSERT,
          payload: {
            id: 'cash-1',
            type: 'in',
            amount: 50000,
            category: 'Penjualan Cash',
            note: 'INV-1',
            referenceId: 'sale-local-1',
            createdAt: '2026-09-16T10:00:00.000Z',
          },
        },
      ],
      { registry },
    )

    expect(result.blocked).toHaveLength(0)
    expect(result.changes.cash_ledger).toHaveLength(1)
    const entry = result.changes.cash_ledger[0]
    expect(entry.type).toBe('in')
    expect(entry.amount).toBe(50000)
    expect(entry.reference_id).toBe('sale-local-1')
    expect(isUuid(entry.sync_id)).toBe(true)
  })

  it('maps a stock movement with product resolution', async () => {
    const result = await mapOutboxEntries(
      [
        {
          id: 'q-p37-move',
          entityType: SYNC_ENTITY_TYPES.STOCK_MOVEMENT,
          entityId: 'move-1',
          operation: SYNC_OPERATIONS.UPSERT,
          payload: {
            id: 'move-1',
            productId: 'prod-1',
            productName: 'Beras',
            movementType: 'sale',
            quantityChange: -2,
            stockBefore: 50,
            stockAfter: 48,
            referenceId: 'sale-local-2',
            category: 'Penjualan',
            note: 'Penjualan Beras',
            createdAt: '2026-09-16T10:00:00.000Z',
          },
        },
      ],
      { registry },
    )

    expect(result.blocked).toHaveLength(0)
    expect(result.changes.stock_movements).toHaveLength(1)
    const movement = result.changes.stock_movements[0]
    expect(movement.movement_type).toBe('sale')
    expect(movement.quantity_change).toBe(-2)
    expect(movement.reference_id).toBe('sale-local-2')
    expect(isUuid(movement.product_sync_id)).toBe(true)
  })

  it('blocks invalid cash and movement payloads fail-closed', async () => {
    const result = await mapOutboxEntries(
      [
        {
          id: 'q-p37-cash-bad',
          entityType: SYNC_ENTITY_TYPES.CASH_ENTRY,
          entityId: 'cash-bad',
          operation: SYNC_OPERATIONS.UPSERT,
          payload: { id: 'cash-bad', type: 'in', amount: 0, createdAt: '2026-09-16T10:00:00.000Z' },
        },
        {
          id: 'q-p37-move-bad',
          entityType: SYNC_ENTITY_TYPES.STOCK_MOVEMENT,
          entityId: 'move-bad',
          operation: SYNC_OPERATIONS.UPSERT,
          payload: { id: 'move-bad', movementType: 'sale', quantityChange: 0, createdAt: '2026-09-16T10:00:00.000Z' },
        },
      ],
      { registry },
    )

    expect(result.changes.cash_ledger).toHaveLength(0)
    expect(result.changes.stock_movements).toHaveLength(0)
    expect(result.blocked.map((b) => b.code)).toContain('INVALID_CASH_ENTRY_AMOUNT')
    expect(result.blocked.map((b) => b.code)).toContain('INVALID_STOCK_MOVEMENT_PRODUCT')
  })
})

describe('P37: tracker queues cash and stock without duplicates', () => {
  let pinia
  let adapter
  let queueService

  beforeEach(async () => {
    pinia = createPinia()
    setActivePinia(pinia)
    adapter = createMemoryAdapter()
    await adapter.initialize()
    queueService = createSyncQueueService({ adapter })
    const businessStore = useBusinessStore(pinia)
    businessStore.mode = 'cloud'
  })

  it('queues one cash outbox row per physical entry and skips duplicated retries', async () => {
    const cashStore = useCashStore(pinia)
    createSyncChangeTracker({ pinia, queueService })

    const first = cashStore.recordEntry({
      type: 'in',
      amount: 50000,
      category: 'Penjualan Cash',
      note: 'INV-1',
      referenceId: 'sale-e2e-1',
    })
    expect(first.success).toBe(true)

    const retry = cashStore.recordEntry({
      type: 'in',
      amount: 50000,
      category: 'Penjualan Cash',
      note: 'INV-1',
      referenceId: 'sale-e2e-1',
    })
    expect(retry.duplicated).toBe(true)

    const pending = await queueService.listPending({ limit: 100 })
    const cashRows = pending.filter((row) => row.entityType === SYNC_ENTITY_TYPES.CASH_ENTRY)
    expect(cashRows).toHaveLength(1)
  })

  it('queues one movement outbox row per adjustStock call', async () => {
    const productStore = useProductStore(pinia)
    productStore.products = [
      {
        id: 'prod-stock-1',
        name: 'Beras',
        category: 'Produk',
        price: 12000,
        stock: 50,
        isActive: true,
      },
    ]
    createSyncChangeTracker({ pinia, queueService })

    const res = productStore.adjustStock('prod-stock-1', {
      quantityChange: -2,
      type: 'sale',
      referenceId: 'sale-e2e-2',
      category: 'Penjualan',
    })
    expect(res.success).toBe(true)

    const pending = await queueService.listPending({ limit: 100 })
    const movementRows = pending.filter((row) => row.entityType === SYNC_ENTITY_TYPES.STOCK_MOVEMENT)
    expect(movementRows).toHaveLength(1)
    expect(movementRows[0].payload.referenceId).toBe('sale-e2e-2')
  })

  it('queues nothing for cash or stock in free mode', async () => {
    const businessStore = useBusinessStore(pinia)
    businessStore.mode = 'free'
    const cashStore = useCashStore(pinia)
    createSyncChangeTracker({ pinia, queueService })

    cashStore.recordEntry({ type: 'in', amount: 10000, referenceId: 'free-1' })
    expect(await queueService.countPending()).toBe(0)
  })
})

describe('P37: pull applies extended records', () => {
  let pinia
  let adapter
  let queueService
  let registry
  let productStore
  let transactionStore

  beforeEach(async () => {
    pinia = createPinia()
    setActivePinia(pinia)
    adapter = createMemoryAdapter()
    await adapter.initialize()
    await adapter.saveSyncPushBinding({
      businessId: 10,
      deviceIdentifier: '33333333-3333-4333-8333-333333333333',
      registeredDeviceId: 55,
      boundAt: new Date().toISOString(),
    })
    queueService = createSyncQueueService({ adapter })
    registry = createSyncIdentityRegistry({ adapter })
    productStore = useProductStore(pinia)
    transactionStore = useTransactionStore(pinia)
    const businessStore = useBusinessStore(pinia)
    businessStore.mode = 'cloud'
  })

  it('applies product semantics on new products and preserves local stock on existing ones', async () => {
    await registry.bindSyncId('category', 'Laundry', CAT_UUID)
    productStore.categories = ['Semua', 'Laundry']
    productStore.products = [
      { id: PROD_UUID, name: 'Cuci', category: 'Laundry', price: 8000, stock: 42, isActive: true },
    ]

    const transport = async () => ({
      ok: true,
      status: 200,
      data: {
        data: {
          records: [
            {
              entity: 'products',
              sync_sequence: 1,
              data: {
                sync_id: PROD_UUID,
                sync_version: 2,
                category_sync_id: CAT_UUID,
                name: 'Cuci Update',
                price: 9000,
                kind: 'service',
                cost: 4000,
                stock: 7,
                unit: 'kg',
                min_stock: 1,
                pricing_unit: 'kg',
                min_quantity: 2,
                estimated_duration: '1 hari',
                status: 'active',
              },
            },
          ],
          next_cursor: 10,
          server_sequence: 10,
          has_more: false,
        },
      },
    })

    const pullService = createSyncPullService({
      adapter,
      queueService,
      registry,
      pinia,
      tokenFetcher: async () => 'test-token',
      transport,
    })

    const res = await pullService.pullNow({ context: makeContext() })
    expect(res.ok).toBe(true)

    const updated = productStore.products.find((p) => p.id === PROD_UUID)
    expect(updated.name).toBe('Cuci Update')
    expect(updated.cost).toBe(4000)
    expect(updated.unit).toBe('kg')
    expect(updated.pricingUnit).toBe('kg')
    expect(updated.minQuantity).toBe(2)
    // Local authoritative stock is never clobbered by a remote copy.
    expect(updated.stock).toBe(42)
  })

  it('fills payment snapshots on new remote transactions', async () => {
    await registry.bindSyncId('category', 'Produk', CAT_UUID)
    productStore.categories = ['Semua', 'Produk']

    const saleUuid = '44444444-4444-4444-8444-444444444444'
    const itemUuid = '55555555-5555-4555-8555-555555555555'
    const prodUuid = '66666666-6666-4666-8666-666666666666'

    const transport = async () => ({
      ok: true,
      status: 200,
      data: {
        data: {
          records: [
            {
              entity: 'products',
              sync_sequence: 1,
              data: {
                sync_id: prodUuid,
                sync_version: 1,
                category_sync_id: CAT_UUID,
                name: 'Teh',
                price: 5000,
                status: 'active',
              },
            },
            {
              entity: 'sales',
              sync_sequence: 2,
              data: {
                sync_id: saleUuid,
                sync_version: 1,
                transaction_number: 'TRX-PAY-2',
                status: 'paid',
                subtotal: 10000,
                total_amount: 10000,
                payment_method: 'cash',
                payment_status: 'paid',
                paid_at: '2026-09-16T10:00:00',
                cash_received: 20000,
                change_amount: 10000,
                sold_at: '2026-09-16T10:00:00',
              },
            },
            {
              entity: 'sale_items',
              sync_sequence: 3,
              data: {
                sync_id: itemUuid,
                sync_version: 1,
                sale_sync_id: saleUuid,
                product_sync_id: prodUuid,
                product_name: 'Teh',
                unit_price: 5000,
                quantity: 2,
                line_total: 10000,
              },
            },
          ],
          next_cursor: 10,
          server_sequence: 10,
          has_more: false,
        },
      },
    })

    const pullService = createSyncPullService({
      adapter,
      queueService,
      registry,
      pinia,
      tokenFetcher: async () => 'test-token',
      transport,
    })

    const res = await pullService.pullNow({ context: makeContext() })
    expect(res.ok).toBe(true)

    const trx = transactionStore.items.find((t) => t.id === saleUuid)
    expect(trx).toBeDefined()
    expect(trx.paymentMethod).toBe('cash')
    expect(trx.paymentStatus).toBe('paid')
    expect(trx.paidAt).toBe('2026-09-16T10:00:00')
    expect(trx.cashReceived).toBe(20000)
    expect(trx.changeAmount).toBe(10000)
  })

  it('applies cash_ledger records into cashStore and saves their cursors', async () => {
    const cashStore = (await import('../stores/cashStore')).useCashStore(pinia)

    const transport = async () => ({
      ok: true,
      status: 200,
      data: {
        data: {
          records: [
            {
              entity: 'cash_ledger',
              sync_sequence: 1,
              data: {
                sync_id: CAT_UUID,
                sync_version: 1,
                type: 'in',
                amount: 50000,
                category: 'Penjualan Cash',
                note: 'INV-1',
                reference_id: 'sale-remote-1',
                occurred_at: '2026-09-16T10:00:00.000Z',
              },
            },
          ],
          next_cursor: 10,
          server_sequence: 10,
          has_more: false,
        },
      },
    })

    const pullService = createSyncPullService({
      adapter,
      queueService,
      registry,
      pinia,
      tokenFetcher: async () => 'test-token',
      transport,
    })

    const res = await pullService.pullNow({ context: makeContext() })
    expect(res.ok).toBe(true)
    expect(res.warnings).not.toContain('UNSUPPORTED_LOCAL_CASH_LEDGER_APPLY')

    expect(cashStore.entries).toHaveLength(1)
    expect(cashStore.entries[0].amount).toBe(50000)
    expect(cashStore.entries[0].referenceId).toBe('sale-remote-1')
    expect(cashStore.balance).toBe(50000)

    const versions = await adapter.loadSyncServerVersions()
    expect(versions[`cash_ledger:${CAT_UUID.toLowerCase()}`]).toBeDefined()
  })

  it('repeats cash pull idempotently without duplicating entries', async () => {
    const cashStore = (await import('../stores/cashStore')).useCashStore(pinia)

    const transport = async () => ({
      ok: true,
      status: 200,
      data: {
        data: {
          records: [
            {
              entity: 'cash_ledger',
              sync_sequence: 1,
              data: {
                sync_id: CAT_UUID,
                sync_version: 1,
                type: 'in',
                amount: 50000,
                category: 'Penjualan Cash',
                note: 'INV-1',
                reference_id: 'sale-remote-1',
                occurred_at: '2026-09-16T10:00:00.000Z',
              },
            },
          ],
          next_cursor: 10,
          server_sequence: 10,
          has_more: false,
        },
      },
    })

    const pullOnce = createSyncPullService({
      adapter,
      queueService,
      registry,
      pinia,
      tokenFetcher: async () => 'test-token',
      transport,
    })
    expect((await pullOnce.pullNow({ context: makeContext() })).ok).toBe(true)

    // A second pull of the same cursor re-applies the same record: the
    // cash entry resolves by sync_id/reference and is never duplicated.
    const pullTwice = createSyncPullService({
      adapter,
      queueService,
      registry,
      pinia,
      tokenFetcher: async () => 'test-token',
      transport,
    })
    expect((await pullTwice.pullNow({ context: makeContext() })).ok).toBe(true)

    expect(cashStore.entries).toHaveLength(1)
    expect(cashStore.balance).toBe(50000)
  })

  it('applies stock_movements into history and converges product stock', async () => {
    productStore.products = [
      { id: PROD_UUID, name: 'Beras', category: 'Produk', price: 12000, stock: 50, isActive: true },
    ]
    productStore.stockMovements = []

    const transport = async () => ({
      ok: true,
      status: 200,
      data: {
        data: {
          records: [
            {
              entity: 'stock_movements',
              sync_sequence: 1,
              data: {
                sync_id: 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',
                sync_version: 1,
                product_sync_id: PROD_UUID,
                movement_type: 'sale',
                quantity_change: -2,
                stock_before: 50,
                stock_after: 48,
                reference_id: 'sale-remote-2',
                category: 'Penjualan',
                note: 'Penjualan Beras',
                occurred_at: '2026-09-16T10:00:00.000Z',
              },
            },
          ],
          next_cursor: 10,
          server_sequence: 10,
          has_more: false,
        },
      },
    })

    const pullService = createSyncPullService({
      adapter,
      queueService,
      registry,
      pinia,
      tokenFetcher: async () => 'test-token',
      transport,
    })

    const res = await pullService.pullNow({ context: makeContext() })
    expect(res.ok).toBe(true)
    expect(res.warnings).not.toContain('UNSUPPORTED_LOCAL_STOCK_MOVEMENT_APPLY')

    expect(productStore.stockMovements).toHaveLength(1)
    expect(productStore.stockMovements[0].referenceId).toBe('sale-remote-2')
    expect(productStore.products.find((p) => p.id === PROD_UUID).stock).toBe(48)

    const versions = await adapter.loadSyncServerVersions()
    expect(versions['stock_movements:aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa']).toBeDefined()
  })
})

describe('P37: production API configuration guard', () => {
  it('rejects localhost and empty base URLs as production API config', () => {
    expect(isProductionApiConfigured()).toBe(false)
  })
})

describe('P37 patch: HPP snapshots, lifecycle, tombstones and convergence', () => {
  let pinia
  let adapter
  let queueService
  let registry

  beforeEach(async () => {
    pinia = createPinia()
    setActivePinia(pinia)
    adapter = createMemoryAdapter()
    await adapter.initialize()
    await adapter.saveSyncPushBinding({
      businessId: 10,
      deviceIdentifier: '33333333-3333-4333-8333-333333333333',
      registeredDeviceId: 55,
      boundAt: new Date().toISOString(),
    })
    queueService = createSyncQueueService({ adapter })
    registry = createSyncIdentityRegistry({ adapter })
    const businessStore = useBusinessStore(pinia)
    businessStore.mode = 'cloud'
  })

  it('maps HPP snapshots and gross profit into sale payloads', async () => {
    const result = await mapOutboxEntries(
      [
        {
          id: 'q-patch-hpp',
          entityType: SYNC_ENTITY_TYPES.TRANSACTION,
          entityId: 'trx-hpp',
          operation: SYNC_OPERATIONS.UPSERT,
          payload: {
            id: 'trx-hpp',
            invoiceNumber: 'INV-HPP',
            status: 'paid',
            paymentStatus: 'paid',
            subtotal: 36000,
            total: 36000,
            grossProfit: 18000,
            createdAt: '2026-09-16T10:00:00.000Z',
            items: [
              {
                id: 'p1',
                name: 'Kopi',
                price: 18000,
                qty: 2,
                hppSnapshot: 9000,
                unit: 'pcs',
                kind: 'product',
                pricingUnit: 'pcs',
                lineCost: 18000,
              },
            ],
          },
        },
      ],
      { registry },
    )

    expect(result.blocked).toHaveLength(0)
    expect(result.changes.sales[0].gross_profit).toBe(18000)
    const item = result.changes.sale_items[0]
    expect(item.cost_snapshot).toBe(9000)
    expect(item.unit).toBe('pcs')
    expect(item.kind).toBe('product')
    expect(item.pricing_unit).toBe('pcs')
    expect(item.line_cost).toBe(18000)
  })

  it('maps Laundry lifecycle fields and customer/business snapshots', async () => {
    const result = await mapOutboxEntries(
      [
        {
          id: 'q-patch-ldr',
          entityType: SYNC_ENTITY_TYPES.TRANSACTION,
          entityId: 'trx-ldr',
          operation: SYNC_OPERATIONS.UPSERT,
          payload: {
            id: 'trx-ldr',
            invoiceNumber: 'LDR-20260916-0001',
            status: 'unpaid',
            paymentStatus: 'unpaid',
            subtotal: 25000,
            total: 25000,
            orderStatus: 'Masuk',
            estimatedCompletedAt: '2026-09-18T17:00:00.000Z',
            note: 'Jangan pakai pewangi',
            customerSnapshot: { id: 'c1', name: 'Andi', phone: '0811', email: '' },
            businessSnapshot: { name: 'Berkah', outlet: 'Outlet 1', phone: '0800' },
            createdAt: '2026-09-16T10:00:00.000Z',
            items: [{ id: 'svc-1', name: 'Cuci', price: 10000, qty: 2.5 }],
          },
        },
      ],
      { registry },
    )

    expect(result.blocked).toHaveLength(0)
    const sale = result.changes.sales[0]
    expect(sale.order_status).toBe('Masuk')
    expect(sale.estimated_completed_at).toBe('2026-09-18T17:00:00.000Z')
    expect(sale.note).toBe('Jangan pakai pewangi')
    expect(sale.customer_snapshot.name).toBe('Andi')
    expect(sale.business_snapshot.name).toBe('Berkah')
  })

  it('maps shift upserts and expense categories', async () => {
    const result = await mapOutboxEntries(
      [
        {
          id: 'q-patch-shift',
          entityType: SYNC_ENTITY_TYPES.SHIFT,
          entityId: 'shift-1',
          operation: SYNC_OPERATIONS.UPSERT,
          payload: {
            id: 'shift-1',
            shiftNumber: 'SHIFT-001',
            status: 'open',
            openingCash: 100000,
            openedAt: '2026-09-16T08:00:00.000Z',
            notes: 'Pagi',
          },
        },
        {
          id: 'q-patch-exp',
          entityType: SYNC_ENTITY_TYPES.EXPENSE,
          entityId: 'exp-1',
          operation: SYNC_OPERATIONS.UPSERT,
          payload: {
            id: 'exp-1',
            title: 'Deterjen',
            category: 'Belanja Stok',
            amount: 75000,
            createdAt: '2026-09-16T10:00:00.000Z',
          },
        },
      ],
      { registry },
    )

    expect(result.blocked).toHaveLength(0)
    expect(result.changes.shifts).toHaveLength(1)
    expect(result.changes.shifts[0].shift_number).toBe('SHIFT-001')
    expect(result.changes.expenses[0].category).toBe('Belanja Stok')
  })

  it('maps tombstone deletions for masters and rejects history deletes', async () => {
    const result = await mapOutboxEntries(
      [
        { id: 'q-del-p', entityType: SYNC_ENTITY_TYPES.PRODUCT, entityId: 'p1', operation: SYNC_OPERATIONS.DELETE },
        { id: 'q-del-t', entityType: SYNC_ENTITY_TYPES.TRANSACTION, entityId: 't1', operation: SYNC_OPERATIONS.DELETE },
      ],
      { registry },
    )

    expect(result.changes.deletions).toHaveLength(1)
    expect(result.changes.deletions[0].entity).toBe('products')
    expect(result.mappedQueueIds).toEqual(['q-del-p'])
    expect(result.blocked).toHaveLength(1)
    expect(result.blocked[0].code).toBe('DELETE_NOT_SUPPORTED_BY_SERVER_V1')
  })

  it('converges unpaid -> paid from an accepted remote record', async () => {
    const productStore = useProductStore(pinia)
    const transactionStore = useTransactionStore(pinia)
    await registry.bindSyncId('category', 'Produk', '22222222-2222-4222-8222-222222222222')
    productStore.categories = ['Semua', 'Produk']
    const saleUuid = '77777777-7777-4777-8777-777777777777'

    transactionStore.items = [
      {
        id: saleUuid,
        invoiceNumber: 'LDR-1',
        status: 'unpaid',
        paymentStatus: 'unpaid',
        paymentMethod: null,
        paidAt: null,
        cashReceived: null,
        changeAmount: null,
        items: [],
        subtotal: 25000,
        total: 25000,
        createdAt: '2026-09-16T10:00:00.000Z',
      },
    ]

    const transport = async () => ({
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
                sync_version: 2,
                transaction_number: 'LDR-1',
                status: 'paid',
                subtotal: 25000,
                total_amount: 25000,
                payment_method: 'cash',
                payment_status: 'paid',
                paid_at: '2026-09-16T12:00:00.000Z',
                cash_received: 50000,
                change_amount: 25000,
                sold_at: '2026-09-16T10:00:00.000Z',
              },
            },
          ],
          next_cursor: 10,
          server_sequence: 10,
          has_more: false,
        },
      },
    })

    const pullService = createSyncPullService({
      adapter,
      queueService,
      registry,
      pinia,
      tokenFetcher: async () => 'test-token',
      transport,
    })

    const res = await pullService.pullNow({ context: makeContext() })
    expect(res.ok).toBe(true)

    const trx = transactionStore.items.find((t) => t.id === saleUuid)
    expect(trx.paymentStatus).toBe('paid')
    expect(trx.paymentMethod).toBe('cash')
    expect(trx.paidAt).toBe('2026-09-16T12:00:00.000Z')
    expect(trx.cashReceived).toBe(50000)
    expect(trx.changeAmount).toBe(25000)
  })

  it('keeps the historical customer snapshot after the master is renamed', async () => {
    const customerStore = (await import('../stores/customerStore')).useCustomerStore(pinia)
    const productStore = useProductStore(pinia)
    const transactionStore = useTransactionStore(pinia)
    await registry.bindSyncId('category', 'Produk', '22222222-2222-4222-8222-222222222222')
    productStore.categories = ['Semua', 'Produk']
    const custSyncId = '99999999-9999-4999-8999-999999999999'
    await registry.bindSyncId('customer', 'cust-old', custSyncId)
    customerStore.customers = [
      { id: 'cust-old', name: 'Andi Baru', phone: '0811', email: '' },
    ]
    transactionStore.items = []

    const saleUuid = '88888888-8888-4888-8888-888888888888'
    const prodUuid = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa'
    const transport = async () => ({
      ok: true,
      status: 200,
      data: {
        data: {
          records: [
            {
              entity: 'products',
              sync_sequence: 1,
              data: {
                sync_id: prodUuid,
                sync_version: 1,
                category_sync_id: '22222222-2222-4222-8222-222222222222',
                name: 'Kopi',
                price: 10000,
                status: 'active',
              },
            },
            {
              entity: 'customers',
              sync_sequence: 2,
              data: { sync_id: custSyncId, sync_version: 2, name: 'Andi Baru', phone: '0811', email: '' },
            },
            {
              entity: 'sales',
              sync_sequence: 3,
              data: {
                sync_id: saleUuid,
                sync_version: 1,
                transaction_number: 'INV-ANDI',
                status: 'paid',
                subtotal: 10000,
                total_amount: 10000,
                sold_at: '2026-09-16T10:00:00.000Z',
                customer_sync_id: custSyncId,
                customer_snapshot: { id: 'cust-old', name: 'Andi', phone: '0811', email: '' },
              },
            },
            {
              entity: 'sale_items',
              sync_sequence: 4,
              data: {
                sync_id: 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb',
                sync_version: 1,
                sale_sync_id: saleUuid,
                product_sync_id: prodUuid,
                product_name: 'Kopi',
                unit_price: 10000,
                quantity: 1,
                line_total: 10000,
              },
            },
          ],
          next_cursor: 10,
          server_sequence: 10,
          has_more: false,
        },
      },
    })

    const pullService = createSyncPullService({
      adapter,
      queueService,
      registry,
      pinia,
      tokenFetcher: async () => 'test-token',
      transport,
    })

    const res = await pullService.pullNow({ context: makeContext() })
    expect(res.ok).toBe(true)

    const trx = transactionStore.items.find((t) => t.id === saleUuid)
    expect(trx).toBeDefined()
    expect(trx.customerSnapshot.name).toBe('Andi')
    expect(customerStore.customers.find((c) => c.id === 'cust-old').name).toBe('Andi Baru')
  })

  it('removes tombstoned expenses from the local master without touching history', async () => {
    const expenseStore = (await import('../stores/expenseStore')).useExpenseStore(pinia)
    const transactionStore = useTransactionStore(pinia)
    const expSyncId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
    await registry.bindSyncId('expense', 'exp-local', expSyncId)
    expenseStore.expenses = [
      { id: 'exp-local', title: 'Deterjen', category: 'Belanja Stok', amount: 75000, note: '', createdAt: '2026-09-16T10:00:00.000Z' },
    ]
    transactionStore.items = [
      { id: 'trx-hist', invoiceNumber: 'INV-HIST', status: 'paid', items: [], subtotal: 10000, total: 10000, createdAt: '2026-09-16T10:00:00.000Z' },
    ]

    const transport = async () => ({
      ok: true,
      status: 200,
      data: {
        data: {
          records: [
            {
              entity: 'expenses',
              sync_sequence: 1,
              data: { sync_id: expSyncId, sync_version: 2, description: 'Deterjen', amount: 75000, occurred_at: '2026-09-16T10:00:00.000Z', status: 'void' },
            },
          ],
          next_cursor: 10,
          server_sequence: 10,
          has_more: false,
        },
      },
    })

    const pullService = createSyncPullService({
      adapter,
      queueService,
      registry,
      pinia,
      tokenFetcher: async () => 'test-token',
      transport,
    })

    const res = await pullService.pullNow({ context: makeContext() })
    expect(res.ok).toBe(true)
    expect(expenseStore.expenses.find((e) => e.id === 'exp-local')).toBeUndefined()
    expect(transactionStore.items).toHaveLength(1)
  })

  it('applies deleted-product tombstones without requiring a live category', async () => {
    const productStore = useProductStore(pinia)
    const prodSyncId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
    await registry.bindSyncId('product', 'p-gone', prodSyncId)
    productStore.categories = []
    productStore.products = [
      { id: 'p-gone', name: 'Kopi Lama', category: 'KategoriHilang', price: 10000, stock: 5, isActive: true },
    ]

    const transport = async () => ({
      ok: true,
      status: 200,
      data: {
        data: {
          records: [
            {
              entity: 'products',
              sync_sequence: 1,
              data: { sync_id: prodSyncId, sync_version: 2, name: 'Kopi Lama', price: 10000, status: 'deleted' },
            },
          ],
          next_cursor: 10,
          server_sequence: 10,
          has_more: false,
        },
      },
    })

    const pullService = createSyncPullService({
      adapter,
      queueService,
      registry,
      pinia,
      tokenFetcher: async () => 'test-token',
      transport,
    })

    const res = await pullService.pullNow({ context: makeContext() })
    expect(res.ok).toBe(true)
    expect(productStore.products.find((p) => p.id === 'p-gone')).toBeUndefined()
  })

  it('tracker enqueues one upsert for orderStatus and settle mutations without double-counting wrappers', async () => {
    const productStore = useProductStore(pinia)
    const transactionStore = useTransactionStore(pinia)
    const cashStore = (await import('../stores/cashStore')).useCashStore(pinia)
    productStore.categories = ['LaundryMaster']
    productStore.products = [
      { id: 'svc-1', name: 'Cuci', category: 'LaundryMaster', price: 10000, kind: 'service', isActive: true },
    ]
    transactionStore.items = []
    cashStore.entries = []

    const tracker = createSyncChangeTracker({ pinia, queueService })
    const order = transactionStore.createLaundryOrder({
      items: [{ id: 'svc-1', name: 'Cuci', price: 10000, qty: 2 }],
      customer: 'Andi',
      paymentMethod: '',
    })
    expect(await queueService.countPending()).toBe(1)

    transactionStore.advanceOrderStatus(order.id)
    expect(await queueService.countPending()).toBe(1)
    const afterAdvance = await queueService.listPending({ limit: 10 })
    expect(afterAdvance.filter((q) => q.entityType === SYNC_ENTITY_TYPES.TRANSACTION)).toHaveLength(1)

    const settle = transactionStore.settleLaundryOrderPayment({
      orderId: order.id,
      paymentMethod: 'cash',
      cashReceived: 25000,
      changeAmount: 5000,
      cashStore,
    })
    expect(settle.success).toBe(true)
    const trxRows = (await queueService.listPending({ limit: 10 }))
      .filter((q) => q.entityType === SYNC_ENTITY_TYPES.TRANSACTION)
    const cashRows = (await queueService.listPending({ limit: 10 }))
      .filter((q) => q.entityType === SYNC_ENTITY_TYPES.CASH_ENTRY)
    expect(trxRows).toHaveLength(1)
    expect(cashRows).toHaveLength(1)
    tracker.dispose()
  })

  it('opening a shift after close mints a fresh identity', async () => {
    const shiftStore = (await import('../stores/shiftStore')).useShiftStore(pinia)
    shiftStore.$patch({ isOpen: false, id: null, shiftNumber: null, status: null, openingBalance: 0, openedAt: null, closingBalance: null, closedAt: null, notes: '' })

    const tracker = createSyncChangeTracker({ pinia, queueService })
    const firstId = shiftStore.openShift(100000)
    shiftStore.closeShift()
    expect(shiftStore.isOpen).toBe(false)
    const secondId = shiftStore.openShift(100000)
    expect(shiftStore.isOpen).toBe(true)
    expect(firstId).toBeTruthy()
    expect(secondId).toBeTruthy()
    expect(secondId).not.toBe(firstId)
    expect(shiftStore.openShift(100000)).toBe(false)
    tracker.dispose()
  })

  it('blocks pull over pending cash and shift mutations', async () => {
    const cashStore = (await import('../stores/cashStore')).useCashStore(pinia)
    cashStore.entries = [
      { id: 'cash-local', type: 'in', amount: 1000, category: 'Kas', note: '', referenceId: null, createdAt: '2026-09-16T10:00:00.000Z' },
    ]
    await queueService.enqueueUpsert(SYNC_ENTITY_TYPES.CASH_ENTRY, 'cash-local', cashStore.entries[0])
    await registry.resolveSyncId(SYNC_ENTITY_TYPES.CASH_ENTRY, 'cash-local')

    const transport = async () => ({
      ok: true,
      status: 200,
      data: {
        data: {
          records: [
            {
              entity: 'cash_ledger',
              sync_sequence: 1,
              data: { sync_id: await registry.resolveSyncId(SYNC_ENTITY_TYPES.CASH_ENTRY, 'cash-local'), sync_version: 2, type: 'in', amount: 2000, occurred_at: '2026-09-16T10:00:00.000Z' },
            },
          ],
          next_cursor: 10,
          server_sequence: 10,
          has_more: false,
        },
      },
    })

    const pullService = createSyncPullService({
      adapter,
      queueService,
      registry,
      pinia,
      tokenFetcher: async () => 'test-token',
      transport,
    })

    const res = await pullService.pullNow({ context: makeContext() })
    expect(res.ok).toBe(false)
    expect(res.code).toBe('LOCAL_PENDING_SYNC_CONFLICT')
  })
})
