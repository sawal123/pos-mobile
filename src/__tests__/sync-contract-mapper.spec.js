/**
 * P11 — Sync Contract Mapper & Sync Identity Registry Test Suite
 *
 * Covers:
 * 1. Sync Identity Registry (durability, UUID handling, stability across restart, isolation)
 * 2. Category Mapping (normal, rename, reserved 'Semua', delete blocking)
 * 3. Product Mapping (fields, SKU construction, category link, stock omission warning, status)
 * 4. Customer Mapping (fields, email validation, nullables)
 * 5. Expense Mapping (fields, title->description, date normalization, category warning)
 * 6. Transaction Mapping (Sale + Sale Items expansion, atomic failure, snapshot warnings)
 * 7. Legacy Transaction Safety (non-array items, incomplete snapshots fail-closed)
 * 8. Business & Delete Operations Blocking (fail-closed, explicit error codes)
 * 9. Mixed Batch Processing (deterministic ordering, partial batch resilience)
 * 10. Strict Isolation & Boundary Checks (no network calls, P7 backup isolation, cloud logout safety)
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createMemoryAdapter } from '../services/database/memoryAdapter'
import {
  createSyncIdentityRegistry,
  buildProductSyncSku,
  isUuid,
  generateUuid,
} from '../services/sync/syncIdentityRegistry'
import { mapOutboxEntries, createContractMapper } from '../services/sync/contractMapper'
import { SYNC_ENTITY_TYPES, SYNC_OPERATIONS } from '../services/sync/syncConstants'
import { createBackupPayload, validateBackupPayload } from '../services/backupService'

describe('P11: Sync Identity Registry', () => {
  let adapter

  beforeEach(async () => {
    adapter = createMemoryAdapter()
    await adapter.initialize()
  })

  it('uses native UUID local ID directly without creating new map entry', async () => {
    const registry = createSyncIdentityRegistry({ adapter })
    const validUuid = '123e4567-e89b-12d3-a456-426614174000'

    const syncId = await registry.resolveSyncId('product', validUuid)
    expect(syncId).toBe(validUuid.toLowerCase())

    const map = registry.getMap()
    expect(Object.keys(map)).toHaveLength(0)
  })

  it('generates a stable UUID for non-UUID local IDs and persists it', async () => {
    const registry = createSyncIdentityRegistry({ adapter })

    const syncId1 = await registry.resolveSyncId('category', 'Minuman Dingin')
    expect(isUuid(syncId1)).toBe(true)

    const syncId2 = await registry.resolveSyncId('category', 'Minuman Dingin')
    expect(syncId1).toBe(syncId2)

    const persisted = await adapter.loadSyncIdentityMap()
    expect(persisted['category:Minuman Dingin']).toBe(syncId1)
  })

  it('restores previous identity mappings across simulated app restart', async () => {
    const registry1 = createSyncIdentityRegistry({ adapter })
    const prodSyncId = await registry1.resolveSyncId('product', 'legacy-sku-001')
    const catSyncId = await registry1.resolveSyncId('category', 'Makanan')

    // Simulate restart with new registry instance referencing same adapter
    const registry2 = createSyncIdentityRegistry({ adapter })
    const restoredProdSyncId = await registry2.resolveSyncId('product', 'legacy-sku-001')
    const restoredCatSyncId = await registry2.resolveSyncId('category', 'Makanan')

    expect(restoredProdSyncId).toBe(prodSyncId)
    expect(restoredCatSyncId).toBe(catSyncId)
  })

  it('prevents collision when different entity types use the same local key', async () => {
    const registry = createSyncIdentityRegistry({ adapter })

    const catSyncId = await registry.resolveSyncId('category', '101')
    const prodSyncId = await registry.resolveSyncId('product', '101')
    const custSyncId = await registry.resolveSyncId('customer', '101')

    expect(isUuid(catSyncId)).toBe(true)
    expect(isUuid(prodSyncId)).toBe(true)
    expect(isUuid(custSyncId)).toBe(true)

    expect(catSyncId).not.toBe(prodSyncId)
    expect(prodSyncId).not.toBe(custSyncId)
    expect(catSyncId).not.toBe(custSyncId)
  })

  it('buildProductSyncSku generates deterministic, non-empty SKU from syncId', () => {
    const uuid = '550e8400-e29b-41d4-a716-446655440000'
    const sku = buildProductSyncSku(uuid)
    expect(sku).toBe(`MOBILE-${uuid}`)
    expect(buildProductSyncSku('')).toBe('')
    expect(buildProductSyncSku(null)).toBe('')
  })

  it('survives cloud session logout and clearCloudContext without losing identity map', async () => {
    const registry = createSyncIdentityRegistry({ adapter })
    const syncId = await registry.resolveSyncId('category', 'Snack')

    await adapter.clearCloudContext()

    const identityMap = await adapter.loadSyncIdentityMap()
    expect(identityMap['category:Snack']).toBe(syncId)
  })
})

describe('P11: Category Mapping', () => {
  let adapter
  let registry

  beforeEach(async () => {
    adapter = createMemoryAdapter()
    await adapter.initialize()
    registry = createSyncIdentityRegistry({ adapter })
  })

  it('maps valid category upsert to Laravel v1 format', async () => {
    const entries = [
      {
        id: 'q-cat-1',
        entityType: SYNC_ENTITY_TYPES.CATEGORY,
        entityId: 'Minuman',
        operation: SYNC_OPERATIONS.UPSERT,
        payload: { name: 'Minuman' },
      },
    ]

    const result = await mapOutboxEntries(entries, { registry })

    expect(result.changes.categories).toHaveLength(1)
    expect(result.changes.categories[0]).toMatchObject({
      name: 'Minuman',
    })
    expect(isUuid(result.changes.categories[0].sync_id)).toBe(true)
    expect(result.mappedQueueIds).toEqual(['q-cat-1'])
    expect(result.blocked).toHaveLength(0)
  })

  it('strictly ignores reserved category "Semua"', async () => {
    const entries = [
      {
        id: 'q-cat-reserved',
        entityType: SYNC_ENTITY_TYPES.CATEGORY,
        entityId: 'Semua',
        operation: SYNC_OPERATIONS.UPSERT,
        payload: { name: 'Semua' },
      },
    ]

    const result = await mapOutboxEntries(entries, { registry })

    expect(result.changes.categories).toHaveLength(0)
    expect(result.mappedQueueIds).toHaveLength(0)
    expect(result.blocked).toHaveLength(0)
  })

  it('blocks category delete with DELETE_NOT_SUPPORTED_BY_SERVER_V1', async () => {
    const entries = [
      {
        id: 'q-cat-del',
        entityType: SYNC_ENTITY_TYPES.CATEGORY,
        entityId: 'Old Category',
        operation: SYNC_OPERATIONS.DELETE,
        payload: { name: 'Old Category' },
      },
    ]

    const result = await mapOutboxEntries(entries, { registry })

    expect(result.changes.categories).toHaveLength(0)
    expect(result.mappedQueueIds).toHaveLength(0)
    expect(result.blocked).toHaveLength(1)
    expect(result.blocked[0]).toMatchObject({
      queueId: 'q-cat-del',
      code: 'DELETE_NOT_SUPPORTED_BY_SERVER_V1',
    })
  })
})

describe('P11: Product Mapping', () => {
  let adapter
  let registry

  beforeEach(async () => {
    adapter = createMemoryAdapter()
    await adapter.initialize()
    registry = createSyncIdentityRegistry({ adapter })
  })

  it('maps valid product with category link, active status, and deterministic SKU', async () => {
    const entries = [
      {
        id: 'q-prod-1',
        entityType: SYNC_ENTITY_TYPES.PRODUCT,
        entityId: 'prod-uuid-111',
        operation: SYNC_OPERATIONS.UPSERT,
        payload: {
          id: 'prod-uuid-111',
          name: 'Kopi Susu Gula Aren',
          category: 'Kopi',
          price: 18000,
          stock: 25,
          isActive: true,
        },
      },
    ]

    const result = await mapOutboxEntries(entries, { registry })

    expect(result.changes.products).toHaveLength(1)
    const p = result.changes.products[0]

    expect(p.name).toBe('Kopi Susu Gula Aren')
    expect(p.price).toBe(18000)
    expect(p.status).toBe('active')
    expect(p.barcode).toBeNull()
    expect(p.sku).toBe(`MOBILE-${p.sync_id}`)
    expect(isUuid(p.sync_id)).toBe(true)
    expect(isUuid(p.category_sync_id)).toBe(true)
    expect(p.stock).toBeUndefined()

    // Warnings should capture unsupported local stock field
    expect(result.warnings).toHaveLength(1)
    expect(result.warnings[0].code).toBe('UNSUPPORTED_PRODUCT_STOCK_FIELD')

    expect(result.mappedQueueIds).toEqual(['q-prod-1'])
  })

  it('maps inactive product with inactive status and null category if category is Semua or missing', async () => {
    const entries = [
      {
        id: 'q-prod-2',
        entityType: SYNC_ENTITY_TYPES.PRODUCT,
        entityId: 'p2',
        operation: SYNC_OPERATIONS.UPSERT,
        payload: {
          id: 'p2',
          name: 'Teh Hangat',
          category: 'Semua',
          price: 5000,
          isActive: false,
        },
      },
    ]

    const result = await mapOutboxEntries(entries, { registry })
    expect(result.changes.products[0].status).toBe('inactive')
    expect(result.changes.products[0].category_sync_id).toBeNull()
  })

  it('blocks product with invalid price or missing name', async () => {
    const entries = [
      {
        id: 'q-p-bad1',
        entityType: SYNC_ENTITY_TYPES.PRODUCT,
        entityId: 'p-bad1',
        operation: SYNC_OPERATIONS.UPSERT,
        payload: { name: '', price: 10000, isActive: true },
      },
      {
        id: 'q-p-bad2',
        entityType: SYNC_ENTITY_TYPES.PRODUCT,
        entityId: 'p-bad2',
        operation: SYNC_OPERATIONS.UPSERT,
        payload: { name: 'Valid Name', price: -500, isActive: true },
      },
    ]

    const result = await mapOutboxEntries(entries, { registry })
    expect(result.changes.products).toHaveLength(0)
    expect(result.blocked).toHaveLength(2)
    expect(result.blocked[0].code).toBe('INVALID_PRODUCT_NAME')
    expect(result.blocked[1].code).toBe('INVALID_PRODUCT_PRICE')
  })
})

describe('P11: Customer Mapping', () => {
  let adapter
  let registry

  beforeEach(async () => {
    adapter = createMemoryAdapter()
    await adapter.initialize()
    registry = createSyncIdentityRegistry({ adapter })
  })

  it('maps valid customer with phone and email, omitting internal fields', async () => {
    const entries = [
      {
        id: 'q-cust-1',
        entityType: SYNC_ENTITY_TYPES.CUSTOMER,
        entityId: 'c1',
        operation: SYNC_OPERATIONS.UPSERT,
        payload: {
          id: 'c1',
          name: 'Budi Santoso',
          phone: '08123456789',
          email: 'budi@example.com',
        },
      },
    ]

    const result = await mapOutboxEntries(entries, { registry })
    expect(result.changes.customers).toHaveLength(1)
    expect(result.changes.customers[0]).toMatchObject({
      name: 'Budi Santoso',
      phone: '08123456789',
      email: 'budi@example.com',
      address: null,
      notes: null,
    })
    expect(isUuid(result.changes.customers[0].sync_id)).toBe(true)
    expect(result.mappedQueueIds).toEqual(['q-cust-1'])
  })

  it('blocks customer with invalid email format', async () => {
    const entries = [
      {
        id: 'q-cust-bad',
        entityType: SYNC_ENTITY_TYPES.CUSTOMER,
        entityId: 'c2',
        operation: SYNC_OPERATIONS.UPSERT,
        payload: {
          id: 'c2',
          name: 'Invalid Email User',
          phone: '',
          email: 'not-an-email',
        },
      },
    ]

    const result = await mapOutboxEntries(entries, { registry })
    expect(result.changes.customers).toHaveLength(0)
    expect(result.blocked).toHaveLength(1)
    expect(result.blocked[0].code).toBe('INVALID_CUSTOMER_EMAIL')
  })
})

describe('P11: Expense Mapping', () => {
  let adapter
  let registry

  beforeEach(async () => {
    adapter = createMemoryAdapter()
    await adapter.initialize()
    registry = createSyncIdentityRegistry({ adapter })
  })

  it('maps expense title to description, normalizes date, and warns about local category', async () => {
    const entries = [
      {
        id: 'q-exp-1',
        entityType: SYNC_ENTITY_TYPES.EXPENSE,
        entityId: 'exp-1',
        operation: SYNC_OPERATIONS.UPSERT,
        payload: {
          id: 'exp-1',
          title: 'Beli Sabun Cuci',
          category: 'Operasional',
          amount: 25000,
          note: 'Struk terlampir',
          createdAt: '2026-08-24T10:00:00.000Z',
        },
      },
    ]

    const result = await mapOutboxEntries(entries, { registry })
    expect(result.changes.expenses).toHaveLength(1)
    expect(result.changes.expenses[0]).toMatchObject({
      description: 'Beli Sabun Cuci',
      amount: 25000,
      notes: 'Struk terlampir',
      shift_sync_id: null,
      occurred_at: '2026-08-24T10:00:00.000Z',
    })
    expect(result.changes.expenses[0].category).toBeUndefined()
    expect(result.warnings).toHaveLength(1)
    expect(result.warnings[0].code).toBe('UNSUPPORTED_EXPENSE_CATEGORY_FIELD')
    expect(result.mappedQueueIds).toEqual(['q-exp-1'])
  })

  it('blocks expense with negative or zero amount', async () => {
    const entries = [
      {
        id: 'q-exp-bad',
        entityType: SYNC_ENTITY_TYPES.EXPENSE,
        entityId: 'exp-2',
        operation: SYNC_OPERATIONS.UPSERT,
        payload: {
          id: 'exp-2',
          title: 'Test',
          amount: 0,
          createdAt: '2026-08-24T10:00:00.000Z',
        },
      },
    ]

    const result = await mapOutboxEntries(entries, { registry })
    expect(result.changes.expenses).toHaveLength(0)
    expect(result.blocked).toHaveLength(1)
    expect(result.blocked[0].code).toBe('INVALID_EXPENSE_AMOUNT')
  })
})

describe('P11: Transaction Mapping (Sale + Sale Items)', () => {
  let adapter
  let registry

  beforeEach(async () => {
    adapter = createMemoryAdapter()
    await adapter.initialize()
    registry = createSyncIdentityRegistry({ adapter })
  })

  it('expands modern transaction snapshot into 1 sale and N sale_items with matching SKUs', async () => {
    const entries = [
      {
        id: 'q-trx-1',
        entityType: SYNC_ENTITY_TYPES.TRANSACTION,
        entityId: 'trx-100',
        operation: SYNC_OPERATIONS.UPSERT,
        payload: {
          id: 'trx-100',
          invoiceNumber: 'INV-2026-001',
          customerId: 'cust-1',
          status: 'paid',
          subtotal: 35000,
          tax: 3500,
          total: 38500,
          paymentMethod: 'cash',
          cashReceived: 50000,
          changeAmount: 11500,
          createdAt: '2026-08-24T14:30:00.000Z',
          items: [
            { id: 'p1', name: 'Nasi Goreng', price: 20000, qty: 1 },
            { id: 'p2', name: 'Es Teh Manis', price: 7500, qty: 2 },
          ],
        },
      },
    ]

    const result = await mapOutboxEntries(entries, { registry })

    expect(result.changes.sales).toHaveLength(1)
    expect(result.changes.sale_items).toHaveLength(2)

    const sale = result.changes.sales[0]
    expect(sale.transaction_number).toBe('INV-2026-001')
    expect(sale.subtotal).toBe(35000)
    expect(sale.discount_amount).toBe(0)
    expect(sale.tax_amount).toBe(3500)
    expect(sale.total_amount).toBe(38500)
    expect(sale.shift_sync_id).toBeNull()
    expect(isUuid(sale.sync_id)).toBe(true)
    expect(isUuid(sale.customer_sync_id)).toBe(true)

    const [item1, item2] = result.changes.sale_items
    expect(item1.sale_sync_id).toBe(sale.sync_id)
    expect(item1.product_name).toBe('Nasi Goreng')
    expect(item1.unit_price).toBe(20000)
    expect(item1.quantity).toBe(1)
    expect(item1.line_total).toBe(20000)
    expect(item1.product_sku).toBe(buildProductSyncSku(item1.product_sync_id))

    expect(item2.sale_sync_id).toBe(sale.sync_id)
    expect(item2.product_name).toBe('Es Teh Manis')
    expect(item2.unit_price).toBe(7500)
    expect(item2.quantity).toBe(2)
    expect(item2.line_total).toBe(15000)

    // Warnings for local payment snapshot fields
    expect(result.warnings).toHaveLength(1)
    expect(result.warnings[0].code).toBe('UNSUPPORTED_TRANSACTION_SNAPSHOT_FIELDS')

    expect(result.mappedQueueIds).toEqual(['q-trx-1'])
  })

  it('fails atomically when a single sale item is invalid, producing no partial sales', async () => {
    const entries = [
      {
        id: 'q-trx-bad-item',
        entityType: SYNC_ENTITY_TYPES.TRANSACTION,
        entityId: 'trx-bad',
        operation: SYNC_OPERATIONS.UPSERT,
        payload: {
          id: 'trx-bad',
          invoiceNumber: 'INV-BAD',
          subtotal: 20000,
          total: 20000,
          createdAt: '2026-08-24T14:30:00.000Z',
          items: [
            { id: 'p1', name: 'Valid Item', price: 10000, qty: 1 },
            { id: 'p2', name: '', price: 10000, qty: 1 }, // INVALID NAME
          ],
        },
      },
    ]

    const result = await mapOutboxEntries(entries, { registry })

    expect(result.changes.sales).toHaveLength(0)
    expect(result.changes.sale_items).toHaveLength(0)
    expect(result.mappedQueueIds).toHaveLength(0)
    expect(result.blocked).toHaveLength(1)
    expect(result.blocked[0].code).toBe('INVALID_TRANSACTION_ITEM')
  })

  it('safely blocks legacy transactions with non-array items count (e.g. items: 3)', async () => {
    const entries = [
      {
        id: 'q-legacy-trx',
        entityType: SYNC_ENTITY_TYPES.TRANSACTION,
        entityId: 'TRX-1001',
        operation: SYNC_OPERATIONS.UPSERT,
        payload: {
          id: 'TRX-1001',
          items: 3, // Number instead of array
          total: 69000,
          createdAt: '2026-08-20T10:00:00.000Z',
        },
      },
    ]

    const result = await mapOutboxEntries(entries, { registry })

    expect(result.changes.sales).toHaveLength(0)
    expect(result.changes.sale_items).toHaveLength(0)
    expect(result.blocked).toHaveLength(1)
    expect(result.blocked[0].code).toBe('LEGACY_TRANSACTION_UNMAPPABLE')
    expect(result.mappedQueueIds).toHaveLength(0)
  })
})

describe('P11: Business Entity & Delete Operation Blocking', () => {
  let adapter
  let registry

  beforeEach(async () => {
    adapter = createMemoryAdapter()
    await adapter.initialize()
    registry = createSyncIdentityRegistry({ adapter })
  })

  it('blocks business outbox entry with UNSUPPORTED_SERVER_ENTITY_BUSINESS without silent drop', async () => {
    const entries = [
      {
        id: 'q-biz-1',
        entityType: SYNC_ENTITY_TYPES.BUSINESS,
        entityId: '1',
        operation: SYNC_OPERATIONS.UPSERT,
        payload: { name: 'Toko Baru', phone: '0811' },
      },
    ]

    const result = await mapOutboxEntries(entries, { registry })

    expect(result.changes.categories).toHaveLength(0)
    expect(result.changes.products).toHaveLength(0)
    expect(result.blocked).toHaveLength(1)
    expect(result.blocked[0]).toMatchObject({
      queueId: 'q-biz-1',
      code: 'UNSUPPORTED_SERVER_ENTITY_BUSINESS',
    })
    expect(result.mappedQueueIds).toHaveLength(0)
  })

  it('blocks delete operations across all entity types', async () => {
    const entries = [
      { id: 'd-1', entityType: SYNC_ENTITY_TYPES.PRODUCT, entityId: 'p1', operation: SYNC_OPERATIONS.DELETE },
      { id: 'd-2', entityType: SYNC_ENTITY_TYPES.CUSTOMER, entityId: 'c1', operation: SYNC_OPERATIONS.DELETE },
      { id: 'd-3', entityType: SYNC_ENTITY_TYPES.EXPENSE, entityId: 'e1', operation: SYNC_OPERATIONS.DELETE },
      { id: 'd-4', entityType: SYNC_ENTITY_TYPES.TRANSACTION, entityId: 't1', operation: SYNC_OPERATIONS.DELETE },
    ]

    const result = await mapOutboxEntries(entries, { registry })

    expect(result.blocked).toHaveLength(4)
    expect(result.blocked.every((b) => b.code === 'DELETE_NOT_SUPPORTED_BY_SERVER_V1')).toBe(true)
    expect(result.mappedQueueIds).toHaveLength(0)
  })
})

describe('P11: Mixed Batch Processing & Ordering', () => {
  let adapter
  let registry

  beforeEach(async () => {
    adapter = createMemoryAdapter()
    await adapter.initialize()
    registry = createSyncIdentityRegistry({ adapter })
  })

  it('maps valid items and isolates blocked items without crashing the batch', async () => {
    const entries = [
      {
        id: 'q-1',
        entityType: SYNC_ENTITY_TYPES.CATEGORY,
        entityId: 'Kategori 1',
        operation: SYNC_OPERATIONS.UPSERT,
        payload: { name: 'Kategori 1' },
      },
      {
        id: 'q-2',
        entityType: SYNC_ENTITY_TYPES.BUSINESS,
        entityId: '1',
        operation: SYNC_OPERATIONS.UPSERT,
        payload: { name: 'Business' },
      },
      {
        id: 'q-3',
        entityType: SYNC_ENTITY_TYPES.PRODUCT,
        entityId: 'p-valid',
        operation: SYNC_OPERATIONS.UPSERT,
        payload: { id: 'p-valid', name: 'Product A', price: 1000, isActive: true },
      },
      {
        id: 'q-4',
        entityType: SYNC_ENTITY_TYPES.PRODUCT,
        entityId: 'p-del',
        operation: SYNC_OPERATIONS.DELETE,
      },
      {
        id: 'q-5',
        entityType: SYNC_ENTITY_TYPES.CUSTOMER,
        entityId: 'c-valid',
        operation: SYNC_OPERATIONS.UPSERT,
        payload: { id: 'c-valid', name: 'Customer A' },
      },
    ]

    const mapper = createContractMapper({ registry })
    const result = await mapper.mapOutboxEntries(entries)

    expect(result.changes.categories).toHaveLength(1)
    expect(result.changes.products).toHaveLength(1)
    expect(result.changes.customers).toHaveLength(1)

    expect(result.mappedQueueIds).toEqual(['q-1', 'q-3', 'q-5'])
    expect(result.blocked).toHaveLength(2)
    expect(result.blocked[0].queueId).toBe('q-2')
    expect(result.blocked[1].queueId).toBe('q-4')
  })
})

describe('P11: Strict Network & Storage Isolation', () => {
  it('does not invoke global fetch or make HTTP calls during contract mapping', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const adapter = createMemoryAdapter()
    await adapter.initialize()

    const entries = [
      {
        id: 'q-iso',
        entityType: SYNC_ENTITY_TYPES.PRODUCT,
        entityId: 'p-iso',
        operation: SYNC_OPERATIONS.UPSERT,
        payload: { id: 'p-iso', name: 'Isolated Product', price: 5000, isActive: true },
      },
    ]

    await mapOutboxEntries(entries)

    expect(fetchSpy).not.toHaveBeenCalled()
    fetchSpy.mockRestore()
  })

  it('P7 backup does not include sync_identity_map', async () => {
    const mockStores = {
      businessStore: { name: 'Toko A', type: 'F&B', owner: 'Owner', phone: '081', outlet: 'Pusat' },
      productStore: { products: [{ id: 'p1', name: 'Kopi', category: 'Minuman', price: 10000, stock: 5, isActive: true }], categories: ['Minuman'] },
      customerStore: { customers: [{ id: 'c1', name: 'Budi', phone: '081', email: 'b@b.com' }] },
      expenseStore: { expenses: [{ id: 'e1', title: 'Es Batu', category: 'Operasional', amount: 5000, note: '', createdAt: new Date().toISOString() }] },
      transactionStore: { items: [{ id: 't1', invoiceNumber: 'INV-1', customer: 'Walk-in Customer', customerId: null, customerSnapshot: null, businessSnapshot: null, status: 'paid', items: [], itemCount: 0, subtotal: 0, tax: 0, total: 0, paymentMethod: 'cash', cashReceived: null, changeAmount: null, createdAt: new Date().toISOString() }] },
    }

    const backup = createBackupPayload(mockStores)
    const validation = validateBackupPayload(backup)

    expect(validation.valid).toBe(true)
    expect(backup.data.sync_identity_map).toBeUndefined()
    expect(backup.data.syncIdentityMap).toBeUndefined()
  })
})
