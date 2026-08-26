/**
 * Mobile P13 — Pull + Apply Server Changes Test Suite
 *
 * Covers:
 * 1. Transport contract & query parameters (GET /api/sync/pull, Bearer header, no token in query)
 * 2. Preconditions enforcement (PRECONDITION_FAILED on missing token/context/registration)
 * 3. P12 Business Binding requirement (SYNC_BUSINESS_NOT_BOUND, SYNC_BUSINESS_BINDING_MISMATCH)
 * 4. P13 Pull Context Binding (first pull binds, subsequent context mismatch yields SYNC_PULL_CONTEXT_MISMATCH)
 * 5. First Pull (after=0, records applied, cursor updated, version metadata saved, no outbox)
 * 6. Pagination (multiple pages fetched, applied atomically only after snapshot completes)
 * 7. Mid-pagination Network Failure (no partial mutation, cursor unchanged, no outbox)
 * 8. Non-advancing cursor detection (NON_ADVANCING_PULL_CURSOR)
 * 9. Category Apply & Identity Resolution (new category, rename category & affected products, collision prevention)
 * 10. Product Apply (stock=0 for new with warning, stock preserved for existing, price exact, isActive mapped, category resolved)
 * 11. Customer Apply (name/phone/email mapped, no schema mutation for extra remote fields)
 * 12. Expense Apply (category='Lainnya' for new with warning, category preserved for existing)
 * 13. Shift Ignored (ShiftStore untouched, UNSUPPORTED_LOCAL_SHIFT_APPLY warning, versions saved, cursor advances)
 * 14. Transaction Replay (sales + sale_items reconstructed into single transaction, payment fields null, lastTransaction untouched)
 * 15. Local Pending Outbox Conflict (LOCAL_PENDING_SYNC_CONFLICT, no local overwrite, no cursor advance)
 * 16. Outbox Echo Prevention (no new P9 outbox entries created from remote apply)
 * 17. Idempotent Replay (cursor persist failure retry does not create duplicates)
 * 18. UI Integration in CloudLoginView (Tarik Data Cloud button, success and error presentation)
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

import { createMemoryAdapter } from '../services/database/memoryAdapter'
import { createSyncQueueService } from '../services/sync/syncQueueService'
import { createSyncIdentityRegistry } from '../services/sync/syncIdentityRegistry'
import { createSyncPullService } from '../services/sync/syncPullService'
import { pullSyncChanges } from '../services/sync/syncPullTransport'
import { createSyncChangeTracker } from '../services/sync/syncTracker'
import { SYNC_ENTITY_TYPES, SYNC_OPERATIONS } from '../services/sync/syncConstants'
import { useBusinessStore } from '../stores/businessStore'
import { useProductStore } from '../stores/productStore'
import { useCustomerStore } from '../stores/customerStore'
import { useExpenseStore } from '../stores/expenseStore'
import { useTransactionStore } from '../stores/transactionStore'
import { useShiftStore } from '../stores/shiftStore'
import { useCloudSessionStore } from '../stores/cloudSessionStore'
import { useSyncPushStore } from '../stores/syncPushStore'
import { useSyncPullStore } from '../stores/syncPullStore'
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

describe('P13: Pull Transport & Request Contract', () => {
  it('calls GET /api/sync/pull with query params and Bearer token in header', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        data: {
          records: [],
          next_cursor: 0,
          server_sequence: 0,
          has_more: false,
        },
      }),
    })
    globalThis.fetch = fetchMock

    const res = await pullSyncChanges({
      token: 'secret-token-xyz',
      businessId: 10,
      deviceIdentifier: '123e4567-e89b-12d3-a456-426614174000',
      after: 50,
      limit: 200,
    })

    expect(res.ok).toBe(true)
    expect(fetchMock).toHaveBeenCalled()
    const [url, options] = fetchMock.mock.calls[0]
    expect(url).toContain('/api/sync/pull')
    expect(url).toContain('business_id=10')
    expect(url).toContain('device_identifier=123e4567-e89b-12d3-a456-426614174000')
    expect(url).toContain('after=50')
    expect(url).toContain('limit=200')
    expect(url).not.toContain('secret-token-xyz') // token NOT in query
    expect(options.headers.Authorization).toBe('Bearer secret-token-xyz')
    expect(options.method).toBe('GET')
  })
})

describe('P13: Sync Pull Service Preconditions & Bindings', () => {
  let pinia
  let adapter
  let queueService
  let registry

  beforeEach(async () => {
    pinia = createPinia()
    setActivePinia(pinia)

    adapter = createMemoryAdapter()
    await adapter.initialize()

    // Pre-bind P12 push business binding
    await adapter.saveSyncPushBinding({
      businessId: 10,
      deviceIdentifier: '123e4567-e89b-12d3-a456-426614174000',
      registeredDeviceId: 55,
      boundAt: new Date().toISOString(),
    })

    queueService = createSyncQueueService({ adapter })
    registry = createSyncIdentityRegistry({ adapter })
  })

  it('fails with PRECONDITION_FAILED when context is incomplete', async () => {
    const transport = vi.fn()
    const pullService = createSyncPullService({
      adapter,
      queueService,
      registry,
      pinia,
      tokenFetcher: async () => 'test-token',
      transport,
    })

    // Missing selectedOutlet
    const invalidCtx = makeValidCloudContext({ selectedOutlet: null })
    const res = await pullService.pullNow({ context: invalidCtx })

    expect(res.ok).toBe(false)
    expect(res.code).toBe('PRECONDITION_FAILED')
    expect(transport).not.toHaveBeenCalled()
  })

  it('fails with SYNC_BUSINESS_NOT_BOUND when P12 push binding is missing', async () => {
    const freshAdapter = createMemoryAdapter()
    await freshAdapter.initialize()

    const transport = vi.fn()
    const pullService = createSyncPullService({
      adapter: freshAdapter,
      queueService: createSyncQueueService({ adapter: freshAdapter }),
      registry: createSyncIdentityRegistry({ adapter: freshAdapter }),
      pinia,
      tokenFetcher: async () => 'test-token',
      transport,
    })

    const res = await pullService.pullNow({ context: makeValidCloudContext() })
    expect(res.ok).toBe(false)
    expect(res.code).toBe('SYNC_BUSINESS_NOT_BOUND')
    expect(transport).not.toHaveBeenCalled()
  })

  it('fails with SYNC_BUSINESS_BINDING_MISMATCH when current business differs from P12 binding', async () => {
    const transport = vi.fn()
    const pullService = createSyncPullService({
      adapter,
      queueService,
      registry,
      pinia,
      tokenFetcher: async () => 'test-token',
      transport,
    })

    const mismatchedCtx = makeValidCloudContext({ selectedBusiness: { id: 999, name: 'Other Biz' } })
    const res = await pullService.pullNow({ context: mismatchedCtx })

    expect(res.ok).toBe(false)
    expect(res.code).toBe('SYNC_BUSINESS_BINDING_MISMATCH')
    expect(transport).not.toHaveBeenCalled()
  })

  it('creates P13 pull binding on first pull and prevents pulling from another outlet later', async () => {
    const transport = vi.fn().mockResolvedValue({
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

    const pullService = createSyncPullService({
      adapter,
      queueService,
      registry,
      pinia,
      tokenFetcher: async () => 'test-token',
      transport,
    })

    // First pull with Outlet 101
    const res1 = await pullService.pullNow({ context: makeValidCloudContext({ selectedOutlet: { id: 101 } }) })
    expect(res1.ok).toBe(true)

    // Verify pull binding saved
    const binding = await adapter.loadSyncPullBinding()
    expect(binding).not.toBeNull()
    expect(binding.outletId).toBe(101)

    // Second pull with Outlet 202 -> SYNC_PULL_CONTEXT_MISMATCH
    const res2 = await pullService.pullNow({ context: makeValidCloudContext({ selectedOutlet: { id: 202 } }) })
    expect(res2.ok).toBe(false)
    expect(res2.code).toBe('SYNC_PULL_CONTEXT_MISMATCH')
  })
})

describe('P13: Pagination & Validation', () => {
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
      deviceIdentifier: '123e4567-e89b-12d3-a456-426614174000',
      registeredDeviceId: 55,
      boundAt: new Date().toISOString(),
    })

    queueService = createSyncQueueService({ adapter })
    registry = createSyncIdentityRegistry({ adapter })
  })

  it('fetches multiple pages until has_more=false and advances cursor only at the end', async () => {
    const catUuid = '11111111-1111-4111-8111-111111111111'
    const prodUuid = '22222222-2222-4222-8222-222222222222'

    const transport = vi.fn().mockImplementation(async ({ after }) => {
      if (after === 0) {
        return {
          ok: true,
          status: 200,
          data: {
            data: {
              records: [
                {
                  entity: 'categories',
                  sync_sequence: 1,
                  data: {
                    sync_id: catUuid,
                    sync_version: 1,
                    name: 'Kopi Baru',
                    status: 'active',
                  },
                },
              ],
              next_cursor: 100,
              server_sequence: 150,
              has_more: true,
            },
          },
        }
      } else if (after === 100) {
        return {
          ok: true,
          status: 200,
          data: {
            data: {
              records: [
                {
                  entity: 'products',
                  sync_sequence: 2,
                  data: {
                    sync_id: prodUuid,
                    sync_version: 1,
                    category_sync_id: catUuid,
                    name: 'Espresso Single',
                    sku: 'ESP-1',
                    barcode: '123456',
                    price: 15000,
                    status: 'active',
                  },
                },
              ],
              next_cursor: 250,
              server_sequence: 250,
              has_more: false,
            },
          },
        }
      }
    })

    const pullService = createSyncPullService({
      adapter,
      queueService,
      registry,
      pinia,
      tokenFetcher: async () => 'test-token',
      transport,
    })

    const result = await pullService.pullNow({ context: makeValidCloudContext() })

    expect(result.ok).toBe(true)
    expect(result.fetched).toBe(2)
    expect(result.applied).toBe(2)
    expect(result.pages).toBe(2)
    expect(result.cursorBefore).toBe(0)
    expect(result.cursorAfter).toBe(250)
    expect(result.serverSequence).toBe(250)

    // Check store contents
    const productStore = useProductStore(pinia)
    expect(productStore.categories).toContain('Kopi Baru')
    const addedProd = productStore.products.find((p) => p.id === prodUuid)
    expect(addedProd).toBeDefined()
    expect(addedProd.name).toBe('Espresso Single')
    expect(addedProd.category).toBe('Kopi Baru')
    expect(addedProd.price).toBe(15000)
    expect(addedProd.stock).toBe(0)

    // Check cursor persisted
    const savedState = await adapter.loadSyncPullState()
    expect(savedState.cursor).toBe(250)
    expect(savedState.serverSequence).toBe(250)
  })

  it('fails safely without mutating state when middle page returns network error', async () => {
    const catUuid = '11111111-1111-4111-8111-111111111111'

    const transport = vi.fn().mockImplementation(async ({ after }) => {
      if (after === 0) {
        return {
          ok: true,
          status: 200,
          data: {
            data: {
              records: [
                {
                  entity: 'categories',
                  sync_sequence: 1,
                  data: {
                    sync_id: catUuid,
                    sync_version: 1,
                    name: 'Kopi Baru',
                    status: 'active',
                  },
                },
              ],
              next_cursor: 100,
              server_sequence: 150,
              has_more: true,
            },
          },
        }
      }
      // Page 2 fails with network error
      return {
        ok: false,
        status: 0,
        data: null,
        error: { code: 'NETWORK_ERROR', message: 'Connection dropped' },
      }
    })

    const pullService = createSyncPullService({
      adapter,
      queueService,
      registry,
      pinia,
      tokenFetcher: async () => 'test-token',
      transport,
    })

    const result = await pullService.pullNow({ context: makeValidCloudContext() })

    expect(result.ok).toBe(false)
    expect(result.code).toBe('NETWORK_ERROR')

    // Local state must NOT be mutated
    const productStore = useProductStore(pinia)
    expect(productStore.categories).not.toContain('Kopi Baru')

    // Cursor must NOT have advanced
    const savedState = await adapter.loadSyncPullState()
    expect(savedState).toBeNull()
  })

  it('aborts with NON_ADVANCING_PULL_CURSOR when next_cursor does not advance with has_more=true', async () => {
    const transport = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        data: {
          records: [],
          next_cursor: 0, // same as after=0 with has_more=true
          server_sequence: 100,
          has_more: true,
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

    const result = await pullService.pullNow({ context: makeValidCloudContext() })

    expect(result.ok).toBe(false)
    expect(result.code).toBe('NON_ADVANCING_PULL_CURSOR')
  })

  it('rejects malformed or non-boolean has_more with INVALID_PULL_RESPONSE (fail-closed)', async () => {
    for (const invalidHasMore of ['false', 'true', 0, 1, null, undefined, {}]) {
      const transport = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        data: {
          data: {
            records: [],
            next_cursor: 10,
            server_sequence: 10,
            has_more: invalidHasMore,
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

      const result = await pullService.pullNow({ context: makeValidCloudContext() })

      expect(result.ok).toBe(false)
      expect(result.code).toBe('INVALID_PULL_RESPONSE')
    }
  })
})

describe('P13: Entity Apply & Domain Logic', () => {
  let pinia
  let adapter
  let queueService
  let registry
  let productStore
  let customerStore
  let expenseStore
  let transactionStore
  let shiftStore

  beforeEach(async () => {
    pinia = createPinia()
    setActivePinia(pinia)

    adapter = createMemoryAdapter()
    await adapter.initialize()

    await adapter.saveSyncPushBinding({
      businessId: 10,
      deviceIdentifier: '123e4567-e89b-12d3-a456-426614174000',
      registeredDeviceId: 55,
      boundAt: new Date().toISOString(),
    })

    queueService = createSyncQueueService({ adapter })
    registry = createSyncIdentityRegistry({ adapter })

    productStore = useProductStore(pinia)
    customerStore = useCustomerStore(pinia)
    expenseStore = useExpenseStore(pinia)
    transactionStore = useTransactionStore(pinia)
    shiftStore = useShiftStore(pinia)
  })

  it('applies category rename, renames matching products, and preserves sync registry identity', async () => {
    const catUuid = '11111111-1111-4111-8111-111111111111'

    // Setup existing local category 'Minuman' bound to catUuid
    await registry.bindSyncId('category', 'Minuman', catUuid)
    productStore.categories = ['Semua', 'Minuman', 'Makanan']
    productStore.products = [
      { id: 'p1', name: 'Es Teh', category: 'Minuman', price: 5000, stock: 10, isActive: true },
    ]

    const transport = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        data: {
          records: [
            {
              entity: 'categories',
              sync_sequence: 1,
              data: {
                sync_id: catUuid,
                sync_version: 2,
                name: 'Beverages', // Renamed on server
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

    const res = await pullService.pullNow({ context: makeValidCloudContext() })
    expect(res.ok).toBe(true)

    // Category should be renamed in store
    expect(productStore.categories).toContain('Beverages')
    expect(productStore.categories).not.toContain('Minuman')

    // Product's category should be updated to 'Beverages'
    expect(productStore.products[0].category).toBe('Beverages')

    // Registry reverse resolution should now point to Beverages
    const resolved = await registry.findLocalKeyBySyncId('category', catUuid)
    expect(resolved).toBe('Beverages')
  })

  it('fails with CATEGORY_SYNC_IDENTITY_COLLISION when remote category name collides with another syncId', async () => {
    const catUuidA = '11111111-1111-4111-8111-111111111111'
    const catUuidB = '22222222-2222-4222-8222-222222222222'

    // Local 'Minuman' is bound to catUuidA
    await registry.bindSyncId('category', 'Minuman', catUuidA)
    productStore.categories = ['Semua', 'Minuman']

    // Remote server tries to send 'Minuman' with catUuidB
    const transport = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        data: {
          records: [
            {
              entity: 'categories',
              sync_sequence: 1,
              data: {
                sync_id: catUuidB,
                sync_version: 1,
                name: 'Minuman',
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

    const res = await pullService.pullNow({ context: makeValidCloudContext() })
    expect(res.ok).toBe(false)
    expect(res.code).toBe('CATEGORY_SYNC_IDENTITY_COLLISION')
  })

  it('applies product updates: preserves existing stock, updates price and active status', async () => {
    const catUuid = '11111111-1111-4111-8111-111111111111'
    const prodUuid = '22222222-2222-4222-8222-222222222222'

    await registry.bindSyncId('category', 'Minuman', catUuid)
    productStore.categories = ['Semua', 'Minuman']
    productStore.products = [
      { id: prodUuid, name: 'Es Teh Manis', category: 'Minuman', price: 4000, stock: 55, isActive: true },
    ]

    const transport = vi.fn().mockResolvedValue({
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
                sync_version: 2,
                category_sync_id: catUuid,
                name: 'Es Teh Jumbo',
                price: 6000,
                status: 'inactive',
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

    const res = await pullService.pullNow({ context: makeValidCloudContext() })
    expect(res.ok).toBe(true)

    const updated = productStore.products.find((p) => p.id === prodUuid)
    expect(updated.name).toBe('Es Teh Jumbo')
    expect(updated.price).toBe(6000)
    expect(updated.isActive).toBe(false)
    expect(updated.stock).toBe(55) // stock preserved!
  })

  it('applies customer records: maps name, phone, email without expanding local schema', async () => {
    const custUuid = '33333333-3333-4333-8333-333333333333'

    const transport = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        data: {
          records: [
            {
              entity: 'customers',
              sync_sequence: 1,
              data: {
                sync_id: custUuid,
                sync_version: 1,
                name: 'Budi Santoso',
                phone: '08123456789',
                email: 'budi@example.com',
                address: 'Jl. Melati No. 5', // unsupported remote field
                notes: 'VIP customer', // unsupported remote field
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

    const res = await pullService.pullNow({ context: makeValidCloudContext() })
    expect(res.ok).toBe(true)

    const cust = customerStore.customers.find((c) => c.id === custUuid)
    expect(cust).toBeDefined()
    expect(cust.name).toBe('Budi Santoso')
    expect(cust.phone).toBe('08123456789')
    expect(cust.email).toBe('budi@example.com')
  })

  it('applies expense records: preserves existing category on update, assigns Lainnya on new with warning', async () => {
    const expUuid1 = '44444444-4444-4444-8444-444444444444'
    const expUuid2 = '55555555-5555-4555-8555-555555555555'

    expenseStore.expenses = [
      {
        id: expUuid1,
        title: 'Beli Gula',
        category: 'Belanja Stok',
        amount: 25000,
        note: 'Old note',
        createdAt: '2026-01-01T00:00:00Z',
      },
    ]

    const transport = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        data: {
          records: [
            {
              entity: 'expenses',
              sync_sequence: 1,
              data: {
                sync_id: expUuid1,
                sync_version: 2,
                description: 'Beli Gula Pasir',
                amount: 30000,
                notes: 'Updated note',
                occurred_at: '2026-01-01T01:00:00Z',
              },
            },
            {
              entity: 'expenses',
              sync_sequence: 2,
              data: {
                sync_id: expUuid2,
                sync_version: 1,
                description: 'Beli Sabun Cuci',
                amount: 15000,
                notes: '',
                occurred_at: '2026-01-02T00:00:00Z',
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

    const res = await pullService.pullNow({ context: makeValidCloudContext() })
    expect(res.ok).toBe(true)
    expect(res.warnings).toContain('SERVER_EXPENSE_CATEGORY_UNAVAILABLE')

    const exp1 = expenseStore.expenses.find((e) => e.id === expUuid1)
    expect(exp1.title).toBe('Beli Gula Pasir')
    expect(exp1.amount).toBe(30000)
    expect(exp1.category).toBe('Belanja Stok') // Preserved!

    const exp2 = expenseStore.expenses.find((e) => e.id === expUuid2)
    expect(exp2.title).toBe('Beli Sabun Cuci')
    expect(exp2.category).toBe('Lainnya')
  })

  it('reconstructs remote sales + sale_items into single transaction with items, lastTransaction untouched', async () => {
    const saleUuid = '66666666-6666-4666-8666-666666666666'
    const itemUuid1 = '77777777-7777-4777-8777-777777777771'
    const itemUuid2 = '77777777-7777-4777-8777-777777777772'
    const prodUuid1 = '88888888-8888-4888-8888-888888888881'
    const prodUuid2 = '88888888-8888-4888-8888-888888888882'

    const initialLastTrx = { id: 'old-trx' }
    transactionStore.lastTransaction = initialLastTrx

    const transport = vi.fn().mockResolvedValue({
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
                transaction_number: 'INV-20260101-001',
                status: 'paid',
                subtotal: 35000,
                tax_amount: 3500,
                total_amount: 38500,
                sold_at: '2026-01-01T10:00:00Z',
                customer_sync_id: null,
              },
            },
            {
              entity: 'sale_items',
              sync_sequence: 2,
              data: {
                sync_id: itemUuid1,
                sync_version: 1,
                sale_sync_id: saleUuid,
                product_sync_id: prodUuid1,
                product_name: 'Cappuccino',
                unit_price: 20000,
                quantity: 1,
                line_total: 20000,
              },
            },
            {
              entity: 'sale_items',
              sync_sequence: 3,
              data: {
                sync_id: itemUuid2,
                sync_version: 1,
                sale_sync_id: saleUuid,
                product_sync_id: prodUuid2,
                product_name: 'Croissant',
                unit_price: 15000,
                quantity: 1,
                line_total: 15000,
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

    const res = await pullService.pullNow({ context: makeValidCloudContext() })
    expect(res.ok).toBe(true)

    const trx = transactionStore.items.find((t) => t.id === saleUuid)
    expect(trx).toBeDefined()
    expect(trx.invoiceNumber).toBe('INV-20260101-001')
    expect(trx.total).toBe(38500)
    expect(trx.subtotal).toBe(35000)
    expect(trx.tax).toBe(3500)
    expect(trx.customer).toBe('Walk-in Customer')
    expect(trx.items.length).toBe(2)
    expect(trx.itemCount).toBe(2)
    expect(trx.paymentMethod).toBeNull()

    // lastTransaction must NOT be modified
    expect(transactionStore.lastTransaction).toEqual(initialLastTrx)
    expect(transactionStore.lastTransaction.id).toBe('old-trx')
  })

  it('reconstructs remote sales preserving legacy Customer and Product IDs from identity registry', async () => {
    const saleUuid = '66666666-6666-4666-8666-666666666666'
    const itemUuid1 = '77777777-7777-4777-8777-777777777771'
    const itemUuid2 = '77777777-7777-4777-8777-777777777772'
    const custUuid = '99999999-9999-4999-8999-999999999991'
    const prodUuid1 = '88888888-8888-4888-8888-888888888881'
    const prodUuid2 = '88888888-8888-4888-8888-888888888882'

    // Pre-bind legacy identities into registry
    await registry.bindSyncId('customer', 'c-legacy-101', custUuid)
    await registry.bindSyncId('product', 'p-legacy-coffee', prodUuid1)
    await registry.bindSyncId('product', 'p-legacy-croissant', prodUuid2)

    // Populate local stores with legacy IDs
    customerStore.customers = [
      { id: 'c-legacy-101', name: 'Budi Santoso', phone: '08123456789', email: 'budi@example.com' },
    ]
    productStore.products = [
      { id: 'p-legacy-coffee', name: 'Kopi Susu', category: 'Kopi', price: 20000, stock: 10, isActive: true },
      { id: 'p-legacy-croissant', name: 'Croissant', category: 'Makanan', price: 15000, stock: 5, isActive: true },
    ]

    const transport = vi.fn().mockResolvedValue({
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
                transaction_number: 'INV-20260101-LEGACY',
                status: 'paid',
                subtotal: 35000,
                tax_amount: 3500,
                total_amount: 38500,
                sold_at: '2026-01-01T10:00:00Z',
                customer_sync_id: custUuid,
              },
            },
            {
              entity: 'sale_items',
              sync_sequence: 2,
              data: {
                sync_id: itemUuid1,
                sync_version: 1,
                sale_sync_id: saleUuid,
                product_sync_id: prodUuid1,
                product_name: 'Kopi Susu',
                unit_price: 20000,
                quantity: 1,
                line_total: 20000,
              },
            },
            {
              entity: 'sale_items',
              sync_sequence: 3,
              data: {
                sync_id: itemUuid2,
                sync_version: 1,
                sale_sync_id: saleUuid,
                product_sync_id: prodUuid2,
                product_name: 'Croissant',
                unit_price: 15000,
                quantity: 1,
                line_total: 15000,
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

    const res = await pullService.pullNow({ context: makeValidCloudContext() })
    expect(res.ok).toBe(true)

    const trx = transactionStore.items.find((t) => t.id === saleUuid)
    expect(trx).toBeDefined()
    expect(trx.customerId).toBe('c-legacy-101') // Must resolve to local legacy customer ID!
    expect(trx.customer).toBe('Budi Santoso')
    expect(trx.customerSnapshot).toEqual({
      id: 'c-legacy-101',
      name: 'Budi Santoso',
      phone: '08123456789',
      email: 'budi@example.com',
    })
    expect(trx.items.length).toBe(2)
    expect(trx.items[0].id).toBe('p-legacy-coffee') // Must resolve to local legacy product ID!
    expect(trx.items[1].id).toBe('p-legacy-croissant') // Must resolve to local legacy product ID!
  })

  it('updates standalone sale_item on legacy product without creating duplicate items', async () => {
    const saleUuid = '66666666-6666-4666-8666-666666666666'
    const itemUuid1 = '77777777-7777-4777-8777-777777777771'
    const prodUuid1 = '88888888-8888-4888-8888-888888888881'

    await registry.bindSyncId('product', 'p-legacy-coffee', prodUuid1)

    transactionStore.items = [
      {
        id: saleUuid,
        invoiceNumber: 'INV-001',
        customer: 'Walk-in Customer',
        customerId: null,
        status: 'paid',
        items: [
          { id: 'p-legacy-coffee', name: 'Kopi Susu', price: 20000, qty: 1 },
        ],
        itemCount: 1,
        total: 20000,
      },
    ]

    const transport = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        data: {
          records: [
            {
              entity: 'sale_items',
              sync_sequence: 1,
              data: {
                sync_id: itemUuid1,
                sync_version: 2,
                sale_sync_id: saleUuid,
                product_sync_id: prodUuid1,
                product_name: 'Kopi Susu Updated',
                unit_price: 22000,
                quantity: 3,
                line_total: 66000,
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

    const res = await pullService.pullNow({ context: makeValidCloudContext() })
    expect(res.ok).toBe(true)

    const trx = transactionStore.items.find((t) => t.id === saleUuid)
    expect(trx.items.length).toBe(1) // No duplicate item created!
    expect(trx.items[0].id).toBe('p-legacy-coffee')
    expect(trx.items[0].price).toBe(22000)
    expect(trx.items[0].qty).toBe(3)
    expect(trx.itemCount).toBe(3)
  })

  it('records shift version metadata, issues UNSUPPORTED_LOCAL_SHIFT_APPLY warning, leaves ShiftStore untouched', async () => {
    const shiftUuid = '99999999-9999-4999-8999-999999999999'

    shiftStore.isOpen = false
    shiftStore.openingBalance = 0

    const transport = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        data: {
          records: [
            {
              entity: 'shifts',
              sync_sequence: 1,
              data: {
                sync_id: shiftUuid,
                sync_version: 1,
                shift_number: 1,
                status: 'closed',
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

    const res = await pullService.pullNow({ context: makeValidCloudContext() })
    expect(res.ok).toBe(true)
    expect(res.ignored).toBe(1)
    expect(res.warnings).toContain('UNSUPPORTED_LOCAL_SHIFT_APPLY')

    // ShiftStore must remain unchanged
    expect(shiftStore.isOpen).toBe(false)

    // Version metadata must be recorded
    const versions = await adapter.loadSyncServerVersions()
    expect(versions[`shifts:${shiftUuid}`]).toEqual({ syncVersion: 1, syncSequence: 1 })
  })
})

describe('P13: Conflict Protection & Outbox Integrity', () => {
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
      deviceIdentifier: '123e4567-e89b-12d3-a456-426614174000',
      registeredDeviceId: 55,
      boundAt: new Date().toISOString(),
    })

    queueService = createSyncQueueService({ adapter })
    registry = createSyncIdentityRegistry({ adapter })

    const bizStore = useBusinessStore(pinia)
    bizStore.mode = 'cloud'
  })

  it('detects pending local mutation and aborts pull with LOCAL_PENDING_SYNC_CONFLICT', async () => {
    const prodUuid = '22222222-2222-4222-8222-222222222222'

    // Enqueue a local pending mutation for prodUuid
    await queueService.enqueueUpsert(SYNC_ENTITY_TYPES.PRODUCT, prodUuid, {
      id: prodUuid,
      name: 'Local Edited Product',
      price: 20000,
    })

    expect(await queueService.countPending()).toBe(1)

    const transport = vi.fn().mockResolvedValue({
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
                category_sync_id: '11111111-1111-4111-8111-111111111111',
                name: 'Server Product',
                price: 15000,
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

    const res = await pullService.pullNow({ context: makeValidCloudContext() })

    expect(res.ok).toBe(false)
    expect(res.code).toBe('LOCAL_PENDING_SYNC_CONFLICT')
    expect(res.conflict).toBeDefined()
    expect(res.conflict.syncId).toBe(prodUuid)

    // Cursor must NOT have advanced
    expect(await adapter.loadSyncPullState()).toBeNull()

    // Queue must remain untouched
    expect(await queueService.countPending()).toBe(1)
  })

  it('detects conflict beyond the first 100 outbox items (>100 pending queue items)', async () => {
    const targetProdUuid = '55555555-5555-4555-8555-555555555555'

    // Enqueue 104 dummy mutations
    for (let i = 1; i <= 104; i++) {
      await queueService.enqueueUpsert(SYNC_ENTITY_TYPES.PRODUCT, `dummy-prod-${i}`, {
        id: `dummy-prod-${i}`,
        name: `Dummy Product ${i}`,
        price: 10000,
      })
    }

    // Mutation #105 is our conflict target
    await queueService.enqueueUpsert(SYNC_ENTITY_TYPES.PRODUCT, targetProdUuid, {
      id: targetProdUuid,
      name: 'Local Target Product',
      price: 25000,
    })

    // Enqueue a few more mutations after #105
    for (let i = 106; i <= 110; i++) {
      await queueService.enqueueUpsert(SYNC_ENTITY_TYPES.PRODUCT, `dummy-prod-${i}`, {
        id: `dummy-prod-${i}`,
        name: `Dummy Product ${i}`,
        price: 10000,
      })
    }

    expect(await queueService.countPending()).toBe(110)

    const transport = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        data: {
          records: [
            {
              entity: 'products',
              sync_sequence: 1,
              data: {
                sync_id: targetProdUuid,
                sync_version: 2,
                category_sync_id: '11111111-1111-4111-8111-111111111111',
                name: 'Server Conflicted Product',
                price: 30000,
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

    const res = await pullService.pullNow({ context: makeValidCloudContext() })

    expect(res.ok).toBe(false)
    expect(res.code).toBe('LOCAL_PENDING_SYNC_CONFLICT')
    expect(res.conflict).toBeDefined()
    expect(res.conflict.syncId).toBe(targetProdUuid)
    expect(res.conflict.localEntityId).toBe(targetProdUuid)

    // Cursor must NOT have advanced
    expect(await adapter.loadSyncPullState()).toBeNull()

    // Queue must remain intact with all 110 items
    expect(await queueService.countPending()).toBe(110)
  })

  it('does NOT create new P9 outbox entries when applying server changes', async () => {
    const catUuid = '11111111-1111-4111-8111-111111111111'
    const prodUuid = '22222222-2222-4222-8222-222222222222'

    const transport = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        data: {
          records: [
            {
              entity: 'categories',
              sync_sequence: 1,
              data: {
                sync_id: catUuid,
                sync_version: 1,
                name: 'Minuman Khas',
                status: 'active',
              },
            },
            {
              entity: 'products',
              sync_sequence: 2,
              data: {
                sync_id: prodUuid,
                sync_version: 1,
                category_sync_id: catUuid,
                name: 'Kopi Susu Gula Aren',
                price: 18000,
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

    const res = await pullService.pullNow({ context: makeValidCloudContext() })
    expect(res.ok).toBe(true)

    // Outbox count MUST remain 0!
    expect(await queueService.countPending()).toBe(0)
  })

  it('replay is idempotent when cursor save failed on previous run', async () => {
    const catUuid = '11111111-1111-4111-8111-111111111111'
    const prodUuid = '22222222-2222-4222-8222-222222222222'

    const payload = {
      ok: true,
      status: 200,
      data: {
        data: {
          records: [
            {
              entity: 'categories',
              sync_sequence: 1,
              data: {
                sync_id: catUuid,
                sync_version: 1,
                name: 'Kopi Khas',
                status: 'active',
              },
            },
            {
              entity: 'products',
              sync_sequence: 2,
              data: {
                sync_id: prodUuid,
                sync_version: 1,
                category_sync_id: catUuid,
                name: 'Kopi Tubruk',
                price: 10000,
                status: 'active',
              },
            },
          ],
          next_cursor: 10,
          server_sequence: 10,
          has_more: false,
        },
      },
    }

    const transport = vi.fn().mockResolvedValue(payload)

    // Mock saveSyncPullState to fail on 1st run
    const originalSaveState = adapter.saveSyncPullState.bind(adapter)
    adapter.saveSyncPullState = vi.fn().mockRejectedValueOnce(new Error('Disk write error'))

    const pullService = createSyncPullService({
      adapter,
      queueService,
      registry,
      pinia,
      tokenFetcher: async () => 'test-token',
      transport,
    })

    // 1st run -> fails on cursor persist
    const res1 = await pullService.pullNow({ context: makeValidCloudContext() })
    expect(res1.ok).toBe(false)
    expect(res1.code).toBe('SYNC_PULL_CURSOR_PERSIST_FAILED')

    const productStore = useProductStore(pinia)
    expect(productStore.products.filter((p) => p.id === prodUuid).length).toBe(1)

    // 2nd run -> retry fetches same records, must be idempotent
    adapter.saveSyncPullState = originalSaveState
    const res2 = await pullService.pullNow({ context: makeValidCloudContext() })
    expect(res2.ok).toBe(true)

    // Verify no duplicates
    expect(productStore.products.filter((p) => p.id === prodUuid).length).toBe(1)
    expect(productStore.categories.filter((c) => c === 'Kopi Khas').length).toBe(1)
    expect(await adapter.loadSyncPullState()).not.toBeNull()
  })
})

describe('P13: UI Integration in CloudLoginView', () => {
  it('displays Tarik Data Cloud button and triggers pullNow on click', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)

    const cloudStore = useCloudSessionStore(pinia)
    cloudStore.token = 'test-token'
    cloudStore.user = { id: 1, name: 'Owner' }
    cloudStore.selectedBusiness = { id: 10, name: 'Kedai Kopi' }
    cloudStore.selectedOutlet = { id: 101, name: 'Outlet Pusat' }
    cloudStore.cloudAccess = true
    cloudStore.deviceIdentifier = '123e4567-e89b-12d3-a456-426614174000'
    cloudStore.registeredDeviceId = 55
    cloudStore.businesses = [
      {
        id: 10,
        name: 'Kedai Kopi',
        cloud_access: true,
        outlets: [{ id: 101, name: 'Outlet Pusat', status: 'active' }],
      },
    ]

    const syncPullStore = useSyncPullStore(pinia)
    const mockPullService = {
      pullNow: vi.fn().mockResolvedValue({
        ok: true,
        applied: 5,
        remaining: 0,
      }),
    }
    syncPullStore.init({ pullService: mockPullService })

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

    const pullBtn = wrapper.find('#pull-now-btn')
    expect(pullBtn.exists()).toBe(true)

    await pullBtn.trigger('click')
    await flushPromises()

    expect(mockPullService.pullNow).toHaveBeenCalled()
    expect(wrapper.text()).toContain('5 perubahan cloud diterapkan.')
  })
})
