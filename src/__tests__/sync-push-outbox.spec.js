/**
 * Mobile P12 — Push Outbox → Laravel /api/sync/push Test Suite
 *
 * Covers:
 * 1. Request Contract & Payload Shaping (UUID requestId, token, changes, blocked filtering)
 * 2. Standard Success (duplicate=false, CAS queue deletion, envelope cleared)
 * 3. Idempotent Duplicate Success (duplicate=true)
 * 4. Network Timeout & Idempotent Retry (envelope reuse, same requestId & changes across restart)
 * 5. Concurrent Local Mutation During Request (CAS prevents deleting updated mutations)
 * 6. Failure Isolation (CAS prevents marking failure on updated mutations)
 * 7. Server Batch Limits (atomic batching, max 100 per entity type, deferred candidates)
 * 8. Single Oversized Entry (>100 sale_items blocked with SERVER_V1_ENTITY_LIMIT_EXCEEDED)
 * 9. Business Binding Protection (anti-cross-tenant data leakage, SYNC_BUSINESS_BINDING_MISMATCH)
 * 10. Preconditions Enforcement (fail local without network call on missing credentials/context)
 * 11. Malformed Server Response Validation (INVALID_SYNC_PUSH_RESPONSE)
 * 12. 409 Conflict Handling (SYNC_CONFLICT, envelope & queue preserved, no pull)
 * 13. Envelope Context Mismatch (fail-closed on cross-business envelope)
 * 14. Starvation Prevention (skips blocked entries to batch valid subsequent candidates)
 * 15. UI Integration in CloudLoginView (Sync Sekarang button and status presentation)
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

import { createMemoryAdapter } from '../services/database/memoryAdapter'
import { createSyncQueueService } from '../services/sync/syncQueueService'
import { createSyncIdentityRegistry, isUuid } from '../services/sync/syncIdentityRegistry'
import { createSyncPushService } from '../services/sync/syncPushService'
import { pushSyncRequest } from '../services/sync/syncPushTransport'
import { SYNC_ENTITY_TYPES, SYNC_OPERATIONS } from '../services/sync/syncConstants'
import { useCloudSessionStore } from '../stores/cloudSessionStore'
import { useSyncPushStore } from '../stores/syncPushStore'
import { useSyncContextGuardStore } from '../stores/syncContextGuardStore'
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

describe('P12: Push Transport & Request Contract', () => {
  let adapter
  let queueService
  let registry
  let mockTransport

  beforeEach(async () => {
    adapter = createMemoryAdapter()
    await adapter.initialize()
    await adapter.saveSyncPushBinding({
      businessId: 10,
      boundAt: new Date().toISOString(),
    })
    queueService = createSyncQueueService({ adapter })
    registry = createSyncIdentityRegistry({ adapter })
    mockTransport = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        data: {
          request_id: '',
          duplicate: false,
        },
      },
    })
  })

  it('builds valid Laravel v1 push request body with Bearer token and UUID request_id', async () => {
    await queueService.enqueueUpsert(SYNC_ENTITY_TYPES.CATEGORY, 'Minuman', { name: 'Minuman' })
    await queueService.enqueueUpsert(SYNC_ENTITY_TYPES.PRODUCT, 'p1', {
      id: 'p1',
      name: 'Kopi Susu',
      category: 'Minuman',
      price: 15000,
      isActive: true,
    })
    await queueService.enqueueUpsert(SYNC_ENTITY_TYPES.CUSTOMER, 'c1', {
      id: 'c1',
      name: 'Budi Santoso',
      phone: '08123456789',
    })
    await queueService.enqueueUpsert(SYNC_ENTITY_TYPES.TRANSACTION, 't1', {
      id: 't1',
      invoiceNumber: 'INV-001',
      customerId: 'c1',
      status: 'paid',
      subtotal: 15000,
      tax: 0,
      total: 15000,
      createdAt: '2026-08-25T10:00:00.000Z',
      items: [{ id: 'p1', name: 'Kopi Susu', price: 15000, qty: 1 }],
    })
    // Blocked entries that should not be sent; the product delete becomes a
    // tombstone deletion, so only the business entry stays blocked.
    await queueService.enqueueUpsert(SYNC_ENTITY_TYPES.BUSINESS, '1', { name: 'Ignored Biz' })
    await queueService.enqueueDelete(SYNC_ENTITY_TYPES.PRODUCT, 'p-old')

    mockTransport.mockImplementation(async ({ body }) => ({
      ok: true,
      status: 200,
      data: {
        data: {
          request_id: body.request_id,
          duplicate: false,
        },
      },
    }))

    const pushService = createSyncPushService({
      adapter,
      queueService,
      registry,
      tokenFetcher: async () => 'mock-bearer-token-123',
      transport: mockTransport,
    })

    const result = await pushService.pushNow({
      context: makeValidCloudContext(),
    })

    expect(result.ok).toBe(true)
    expect(mockTransport).toHaveBeenCalledTimes(1)

    const transportCall = mockTransport.mock.calls[0][0]
    expect(transportCall.token).toBe('mock-bearer-token-123')

    const body = transportCall.body
    expect(body.business_id).toBe(10)
    expect(body.device_identifier).toBe('123e4567-e89b-12d3-a456-426614174000')
    expect(isUuid(body.request_id)).toBe(true)
    expect(result.requestId).toBe(body.request_id)

    // Verify mapped changes
    expect(body.changes.categories).toHaveLength(1)
    expect(body.changes.categories[0].name).toBe('Minuman')
    expect(body.changes.products).toHaveLength(1)
    expect(body.changes.products[0].name).toBe('Kopi Susu')
    expect(body.changes.customers).toHaveLength(1)
    expect(body.changes.customers[0].name).toBe('Budi Santoso')
    expect(body.changes.sales).toHaveLength(1)
    expect(body.changes.sales[0].status).toBe('paid')
    expect(body.changes.sale_items).toHaveLength(1)

    // Blocked business must be filtered out; the product delete now travels
    // as a tombstone deletion.
    expect(result.blocked).toHaveLength(1)
    expect(result.blocked.some((b) => b.code === 'UNSUPPORTED_SERVER_ENTITY_BUSINESS')).toBe(true)
    expect(body.changes.deletions).toHaveLength(1)
    expect(body.changes.deletions[0].entity).toBe('products')
  })
})

describe('P12: Success & Idempotent Duplicate Handling', () => {
  let adapter
  let queueService
  let registry

  beforeEach(async () => {
    adapter = createMemoryAdapter()
    await adapter.initialize()
    await adapter.saveSyncPushBinding({
      businessId: 10,
      boundAt: new Date().toISOString(),
    })
    queueService = createSyncQueueService({ adapter })
    registry = createSyncIdentityRegistry({ adapter })
  })

  it('removes sent unchanged queue items and clears envelope on server success (duplicate=false)', async () => {
    const q1 = await queueService.enqueueUpsert(SYNC_ENTITY_TYPES.CATEGORY, 'Makanan', { name: 'Makanan' })
    const q2 = await queueService.enqueueDelete(SYNC_ENTITY_TYPES.PRODUCT, 'p-del') // tombstone

    const transport = vi.fn().mockImplementation(async ({ body }) => ({
      ok: true,
      status: 200,
      data: {
        data: {
          request_id: body.request_id,
          duplicate: false,
        },
      },
    }))

    const pushService = createSyncPushService({
      adapter,
      queueService,
      registry,
      tokenFetcher: async () => 'test-token',
      transport,
    })

    const result = await pushService.pushNow({ context: makeValidCloudContext() })

    expect(result.ok).toBe(true)
    expect(result.duplicate).toBe(false)
    expect(result.removedQueueIds).toEqual(expect.arrayContaining([q1.entry.id, q2.entry.id]))
    expect(result.preservedQueueIds).toEqual([])
    expect(result.remaining).toBe(0) // tombstone delete travels and clears too

    // Verify envelope is cleared
    const inflight = await adapter.loadSyncPushInflight()
    expect(inflight).toBeNull()

    // Verify queue in storage
    const pending = await queueService.listPending()
    expect(pending).toHaveLength(0)
  })

  it('removes sent unchanged queue items and clears envelope on duplicate success (duplicate=true)', async () => {
    const q1 = await queueService.enqueueUpsert(SYNC_ENTITY_TYPES.PRODUCT, 'p2', {
      id: 'p2',
      name: 'Teh Manis',
      price: 5000,
      isActive: true,
    })

    const transport = vi.fn().mockImplementation(async ({ body }) => ({
      ok: true,
      status: 200,
      data: {
        data: {
          request_id: body.request_id,
          duplicate: true,
        },
      },
    }))

    const pushService = createSyncPushService({
      adapter,
      queueService,
      registry,
      tokenFetcher: async () => 'test-token',
      transport,
    })

    const result = await pushService.pushNow({ context: makeValidCloudContext() })

    expect(result.ok).toBe(true)
    expect(result.duplicate).toBe(true)
    expect(result.removedQueueIds).toEqual([q1.entry.id])
    expect(result.remaining).toBe(0)

    const inflight = await adapter.loadSyncPushInflight()
    expect(inflight).toBeNull()
  })
})

describe('P12: Network Timeout, In-Flight Envelope & Idempotent Retry', () => {
  let adapter
  let queueService
  let registry

  beforeEach(async () => {
    adapter = createMemoryAdapter()
    await adapter.initialize()
    await adapter.saveSyncPushBinding({
      businessId: 10,
      boundAt: new Date().toISOString(),
    })
    queueService = createSyncQueueService({ adapter })
    registry = createSyncIdentityRegistry({ adapter })
  })

  it('re-uses identical requestId and changes across simulated restart after network timeout', async () => {
    const q1 = await queueService.enqueueUpsert(SYNC_ENTITY_TYPES.PRODUCT, 'p-timeout', {
      id: 'p-timeout',
      name: 'Kopi Susu Botol',
      price: 25000,
      isActive: true,
    })

    let transportCallCount = 0
    let firstRequestId = null

    const transport = vi.fn().mockImplementation(async ({ body }) => {
      transportCallCount++
      if (transportCallCount === 1) {
        firstRequestId = body.request_id
        return {
          ok: false,
          status: 0,
          data: null,
          error: {
            status: 0,
            code: 'NETWORK_ERROR',
            message: 'Network request timed out',
            data: null,
          },
        }
      }

      return {
        ok: true,
        status: 200,
        data: {
          data: {
            request_id: body.request_id,
            duplicate: true, // Server committed earlier, returns duplicate on retry
          },
        },
      }
    })

    const pushService1 = createSyncPushService({
      adapter,
      queueService,
      registry,
      tokenFetcher: async () => 'test-token',
      transport,
    })

    // 1st Push: Fails due to network timeout
    const result1 = await pushService1.pushNow({ context: makeValidCloudContext() })
    expect(result1.ok).toBe(false)
    expect(result1.error.code).toBe('NETWORK_ERROR')

    // Envelope and queue remain intact
    const inflight = await adapter.loadSyncPushInflight()
    expect(inflight).not.toBeNull()
    expect(inflight.requestId).toBe(firstRequestId)
    expect(await queueService.countPending()).toBe(1)

    // 2nd Push (simulated app restart with new service instance):
    const newRegistry = createSyncIdentityRegistry({ adapter })
    const pushService2 = createSyncPushService({
      adapter,
      queueService,
      registry: newRegistry,
      tokenFetcher: async () => 'test-token',
      transport,
    })

    const result2 = await pushService2.pushNow({ context: makeValidCloudContext() })

    expect(result2.ok).toBe(true)
    expect(result2.requestId).toBe(firstRequestId)
    expect(result2.duplicate).toBe(true)
    expect(result2.removedQueueIds).toEqual([q1.entry.id])
    expect(result2.remaining).toBe(0)

    // Envelope cleared after successful retry
    expect(await adapter.loadSyncPushInflight()).toBeNull()
  })
})

describe('P12: Compare-And-Swap (CAS) Mutation Safety', () => {
  let adapter
  let queueService
  let registry

  beforeEach(async () => {
    adapter = createMemoryAdapter()
    await adapter.initialize()
    await adapter.saveSyncPushBinding({
      businessId: 10,
      boundAt: new Date().toISOString(),
    })
    queueService = createSyncQueueService({ adapter })
    registry = createSyncIdentityRegistry({ adapter })
  })

  it('does NOT delete queue item if user mutated entity while network request was in-flight', async () => {
    // 1. Enqueue Product V1
    const q1 = await queueService.enqueueUpsert(SYNC_ENTITY_TYPES.PRODUCT, 'p-cas', {
      id: 'p-cas',
      name: 'Product V1',
      price: 10000,
      isActive: true,
    })

    // 2. Transport simulates network delay and concurrent local mutation
    const transport = vi.fn().mockImplementation(async ({ body }) => {
      // User updates Product to V2 while request is in flight
      await queueService.enqueueUpsert(SYNC_ENTITY_TYPES.PRODUCT, 'p-cas', {
        id: 'p-cas',
        name: 'Product V2 Edited',
        price: 12000,
        isActive: true,
      })

      return {
        ok: true,
        status: 200,
        data: {
          data: {
            request_id: body.request_id,
            duplicate: false,
          },
        },
      }
    })

    const pushService = createSyncPushService({
      adapter,
      queueService,
      registry,
      tokenFetcher: async () => 'test-token',
      transport,
    })

    const result = await pushService.pushNow({ context: makeValidCloudContext() })

    expect(result.ok).toBe(true)
    // Snapshot V1 changed, so it was preserved, not removed
    expect(result.removedQueueIds).toEqual([])
    expect(result.preservedQueueIds).toEqual([q1.entry.id])
    expect(result.remaining).toBe(1)

    // Verify queue still holds V2
    const pending = await queueService.listPending()
    expect(pending).toHaveLength(1)
    expect(pending[0].payload.name).toBe('Product V2 Edited')
    expect(pending[0].payload.price).toBe(12000)
  })

  it('does NOT mark failure metadata on new mutation if older snapshot request failed', async () => {
    await queueService.enqueueUpsert(SYNC_ENTITY_TYPES.EXPENSE, 'e-cas', {
      id: 'e-cas',
      title: 'Expense V1',
      amount: 10000,
      createdAt: '2026-08-25T10:00:00.000Z',
    })

    const transport = vi.fn().mockImplementation(async () => {
      // User updates Expense to V2 while request is in flight
      await queueService.enqueueUpsert(SYNC_ENTITY_TYPES.EXPENSE, 'e-cas', {
        id: 'e-cas',
        title: 'Expense V2 Edited',
        amount: 15000,
        createdAt: '2026-08-25T10:00:00.000Z',
      })

      return {
        ok: false,
        status: 500,
        data: null,
        error: {
          status: 500,
          code: 'SERVER_ERROR',
          message: 'Internal Server Error',
        },
      }
    })

    const pushService = createSyncPushService({
      adapter,
      queueService,
      registry,
      tokenFetcher: async () => 'test-token',
      transport,
    })

    const result = await pushService.pushNow({ context: makeValidCloudContext() })

    expect(result.ok).toBe(false)

    // Verify V2 was NOT marked with failure metadata
    const pending = await queueService.listPending()
    expect(pending).toHaveLength(1)
    expect(pending[0].payload.title).toBe('Expense V2 Edited')
    expect(pending[0].attemptCount).toBe(0)
    expect(pending[0].lastError).toBeNull()
  })
})

describe('P12: Server Batch Limits (Max 100 per Entity Array)', () => {
  let adapter
  let queueService
  let registry

  beforeEach(async () => {
    adapter = createMemoryAdapter()
    await adapter.initialize()
    await adapter.saveSyncPushBinding({
      businessId: 10,
      boundAt: new Date().toISOString(),
    })
    queueService = createSyncQueueService({ adapter })
    registry = createSyncIdentityRegistry({ adapter })
  })

  it('defers candidates when adding them would exceed 100 sale_items in a single request', async () => {
    // 60 transactions with 2 items each = 120 items -> only first 50 transactions (100 items) should be batched
    for (let i = 1; i <= 60; i++) {
      await queueService.enqueueUpsert(SYNC_ENTITY_TYPES.TRANSACTION, `trx-${i}`, {
        id: `trx-${i}`,
        invoiceNumber: `INV-${i}`,
        subtotal: 20000,
        tax: 0,
        total: 20000,
        createdAt: '2026-08-25T10:00:00.000Z',
        items: [
          { id: `p-${i}-a`, name: `Item A ${i}`, price: 10000, qty: 1 },
          { id: `p-${i}-b`, name: `Item B ${i}`, price: 10000, qty: 1 },
        ],
      })
    }

    let capturedChanges = null
    const transport = vi.fn().mockImplementation(async ({ body }) => {
      capturedChanges = body.changes
      return {
        ok: true,
        status: 200,
        data: {
          data: {
            request_id: body.request_id,
            duplicate: false,
          },
        },
      }
    })

    const pushService = createSyncPushService({
      adapter,
      queueService,
      registry,
      tokenFetcher: async () => 'test-token',
      transport,
    })

    const result = await pushService.pushNow({ context: makeValidCloudContext() })

    expect(result.ok).toBe(true)
    expect(capturedChanges.sales.length).toBe(50)
    expect(capturedChanges.sale_items.length).toBe(100) // Exactly at 100 max
    expect(result.removedQueueIds).toHaveLength(50)
    expect(result.remaining).toBe(10) // 10 transactions deferred
  })

  it('blocks single oversized transaction with >100 items with SERVER_V1_ENTITY_LIMIT_EXCEEDED', async () => {
    const items = []
    for (let i = 1; i <= 101; i++) {
      items.push({ id: `p-${i}`, name: `Item ${i}`, price: 1000, qty: 1 })
    }

    await queueService.enqueueUpsert(SYNC_ENTITY_TYPES.TRANSACTION, 'huge-trx', {
      id: 'huge-trx',
      invoiceNumber: 'INV-HUGE',
      subtotal: 101000,
      tax: 0,
      total: 101000,
      createdAt: '2026-08-25T10:00:00.000Z',
      items,
    })

    const transport = vi.fn()

    const pushService = createSyncPushService({
      adapter,
      queueService,
      registry,
      tokenFetcher: async () => 'test-token',
      transport,
    })

    const result = await pushService.pushNow({ context: makeValidCloudContext() })

    expect(result.ok).toBe(true)
    expect(transport).not.toHaveBeenCalled() // Nothing valid to send
    expect(result.blocked).toHaveLength(1)
    expect(result.blocked[0].code).toBe('SERVER_V1_ENTITY_LIMIT_EXCEEDED')
    expect(result.remaining).toBe(1)
  })
})

describe('P12: Business Binding & Anti-Cross-Tenant Leakage', () => {
  let adapter
  let queueService
  let registry

  beforeEach(async () => {
    adapter = createMemoryAdapter()
    await adapter.initialize()
    queueService = createSyncQueueService({ adapter })
    registry = createSyncIdentityRegistry({ adapter })
  })

  it('binds outbox to first pushed business and blocks subsequent push to different business', async () => {
    await adapter.saveSyncBootstrapState({
      version: 1,
      businessId: 10,
      outletId: 101,
      deviceIdentifier: '123e4567-e89b-12d3-a456-426614174000',
      registeredDeviceId: 55,
      status: 'staged',
      stagedAt: new Date().toISOString(),
      counts: { categories: 0, products: 1, customers: 0, expenses: 0, transactions: 0 },
    })

    await queueService.enqueueUpsert(SYNC_ENTITY_TYPES.PRODUCT, 'p-biz', {
      id: 'p-biz',
      name: 'Business Item',
      price: 10000,
      isActive: true,
    })

    const transport = vi.fn().mockImplementation(async ({ body }) => ({
      ok: true,
      status: 200,
      data: {
        data: {
          request_id: body.request_id,
          duplicate: false,
        },
      },
    }))

    const pushService = createSyncPushService({
      adapter,
      queueService,
      registry,
      tokenFetcher: async () => 'test-token',
      transport,
    })

    // 1st Push: Bound to Business 10
    const res1 = await pushService.pushNow({
      context: makeValidCloudContext({ selectedBusiness: { id: 10, name: 'Business 10' } }),
    })
    expect(res1.ok).toBe(true)

    const binding = await adapter.loadSyncPushBinding()
    expect(binding).toMatchObject({ businessId: 10 })

    // Add new queue entry
    await queueService.enqueueUpsert(SYNC_ENTITY_TYPES.PRODUCT, 'p-biz-2', {
      id: 'p-biz-2',
      name: 'Business Item 2',
      price: 20000,
      isActive: true,
    })

    // 2nd Push: Caller tries to push with Business 99
    const res2 = await pushService.pushNow({
      context: makeValidCloudContext({ selectedBusiness: { id: 99, name: 'Business 99' } }),
    })

    expect(res2.ok).toBe(false)
    expect(res2.code).toBe('SYNC_BUSINESS_BINDING_MISMATCH')
    expect(transport).toHaveBeenCalledTimes(1) // No second HTTP call made
    expect(await queueService.countPending()).toBe(1) // Queue untouched
  })
})

describe('P12: Preconditions & Error Handling', () => {
  let adapter
  let queueService
  let registry
  let mockTransport

  beforeEach(async () => {
    adapter = createMemoryAdapter()
    await adapter.initialize()
    await adapter.saveSyncPushBinding({
      businessId: 10,
      boundAt: new Date().toISOString(),
    })
    queueService = createSyncQueueService({ adapter })
    registry = createSyncIdentityRegistry({ adapter })
    mockTransport = vi.fn()
  })

  it('fails local without network call when token or context preconditions are missing', async () => {
    await queueService.enqueueUpsert(SYNC_ENTITY_TYPES.PRODUCT, 'p-pre', { id: 'p-pre', name: 'Item', price: 1000 })

    const pushService = createSyncPushService({
      adapter,
      queueService,
      registry,
      tokenFetcher: async () => '', // Empty token
      transport: mockTransport,
    })

    // Test missing token
    const res1 = await pushService.pushNow({ context: makeValidCloudContext() })
    expect(res1.ok).toBe(false)
    expect(res1.code).toBe('PRECONDITION_FAILED')
    expect(mockTransport).not.toHaveBeenCalled()

    // Test cloudAccess false
    const res2 = await pushService.pushNow({
      token: 'valid-token',
      context: makeValidCloudContext({ cloudAccess: false }),
    })
    expect(res2.ok).toBe(false)
    expect(res2.code).toBe('PRECONDITION_FAILED')
    expect(mockTransport).not.toHaveBeenCalled()

    // Test unregistered device
    const res3 = await pushService.pushNow({
      token: 'valid-token',
      context: makeValidCloudContext({ registeredDeviceId: null }),
    })
    expect(res3.ok).toBe(false)
    expect(res3.code).toBe('PRECONDITION_FAILED')
    expect(mockTransport).not.toHaveBeenCalled()
  })

  it('handles malformed 2xx response as INVALID_SYNC_PUSH_RESPONSE without deleting queue or clearing envelope', async () => {
    await queueService.enqueueUpsert(SYNC_ENTITY_TYPES.CATEGORY, 'Minuman', { name: 'Minuman' })

    mockTransport.mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        data: {
          request_id: 'different-uuid-returned-by-bad-proxy',
          duplicate: false,
        },
      },
    })

    const pushService = createSyncPushService({
      adapter,
      queueService,
      registry,
      tokenFetcher: async () => 'valid-token',
      transport: mockTransport,
    })

    const result = await pushService.pushNow({ context: makeValidCloudContext() })

    expect(result.ok).toBe(false)
    expect(result.error.code).toBe('INVALID_SYNC_PUSH_RESPONSE')
    expect(await queueService.countPending()).toBe(1)
    expect(await adapter.loadSyncPushInflight()).not.toBeNull()
  })

  it('handles 409 SYNC_CONFLICT without deleting queue, clearing envelope and persisting conflict record', async () => {
    await queueService.enqueueUpsert(SYNC_ENTITY_TYPES.PRODUCT, 'p-conflict', {
      id: 'p-conflict',
      name: 'Conflict Product',
      price: 10000,
      isActive: true,
    })

    const prodSyncId = await registry.resolveSyncId(SYNC_ENTITY_TYPES.PRODUCT, 'p-conflict')

    mockTransport.mockResolvedValue({
      ok: false,
      status: 409,
      data: {
        code: 'SYNC_CONFLICT',
        conflicts: [
          {
            entity: 'products',
            sync_id: prodSyncId,
            server_sync_version: 2,
          },
        ],
      },
    })

    const pushService = createSyncPushService({
      adapter,
      queueService,
      registry,
      tokenFetcher: async () => 'valid-token',
      transport: mockTransport,
    })

    const result = await pushService.pushNow({ context: makeValidCloudContext() })

    expect(result.ok).toBe(false)
    expect(result.code).toBe('SYNC_CONFLICT')
    expect(await queueService.countPending()).toBe(1)
    expect(await adapter.loadSyncPushInflight()).toBeNull()

    const conflictState = await adapter.loadSyncConflicts()
    expect(conflictState).not.toBeNull()
    expect(conflictState.conflicts).toHaveLength(1)
    expect(conflictState.conflicts[0].status).toBe('open')
  })
})

describe('P12: In-Flight Envelope Context Validation', () => {
  let adapter
  let queueService
  let registry
  let mockTransport

  beforeEach(async () => {
    adapter = createMemoryAdapter()
    await adapter.initialize()
    queueService = createSyncQueueService({ adapter })
    registry = createSyncIdentityRegistry({ adapter })
    mockTransport = vi.fn()

    // Seed existing in-flight envelope
    await adapter.saveSyncPushInflight({
      version: 1,
      requestId: '11111111-1111-1111-1111-111111111111',
      businessId: 10,
      outletId: 100,
      deviceIdentifier: 'DEVICE-A',
      registeredDeviceId: 50,
      createdAt: '2026-08-25T10:00:00.000Z',
      queueSnapshots: [
        {
          id: 'q1',
          entityType: 'product',
          entityId: 'p1',
          operation: 'upsert',
          payload: {},
          updatedAt: '2026-08-25T10:00:00.000Z',
        },
      ],
      changes: {
        categories: [],
        products: [{ name: 'P' }],
        customers: [],
        shifts: [],
        sales: [],
        sale_items: [],
        expenses: [],
      },
    })
  })

  it('fails closed on businessId mismatch without network call', async () => {
    const pushService = createSyncPushService({
      adapter,
      queueService,
      registry,
      tokenFetcher: async () => 'test-token',
      transport: mockTransport,
    })

    const result = await pushService.pushNow({
      context: makeValidCloudContext({
        selectedBusiness: { id: 99, name: 'Other Business' },
        selectedOutlet: { id: 100, name: 'Outlet' },
        deviceIdentifier: 'DEVICE-A',
        registeredDeviceId: 50,
      }),
    })

    expect(result.ok).toBe(false)
    expect(result.code).toBe('SYNC_ENVELOPE_CONTEXT_MISMATCH')
    expect(mockTransport).not.toHaveBeenCalled()
    expect(await adapter.loadSyncPushInflight()).not.toBeNull()
  })

  it('fails closed on outletId mismatch without network call', async () => {
    const pushService = createSyncPushService({
      adapter,
      queueService,
      registry,
      tokenFetcher: async () => 'test-token',
      transport: mockTransport,
    })

    const result = await pushService.pushNow({
      context: makeValidCloudContext({
        selectedBusiness: { id: 10, name: 'Business 10' },
        selectedOutlet: { id: 200, name: 'Other Outlet' },
        deviceIdentifier: 'DEVICE-A',
        registeredDeviceId: 50,
      }),
    })

    expect(result.ok).toBe(false)
    expect(result.code).toBe('SYNC_ENVELOPE_CONTEXT_MISMATCH')
    expect(mockTransport).not.toHaveBeenCalled()
    expect(await adapter.loadSyncPushInflight()).not.toBeNull()
  })

  it('fails closed on deviceIdentifier mismatch without network call', async () => {
    const pushService = createSyncPushService({
      adapter,
      queueService,
      registry,
      tokenFetcher: async () => 'test-token',
      transport: mockTransport,
    })

    const result = await pushService.pushNow({
      context: makeValidCloudContext({
        selectedBusiness: { id: 10, name: 'Business 10' },
        selectedOutlet: { id: 100, name: 'Outlet' },
        deviceIdentifier: 'DEVICE-B',
        registeredDeviceId: 50,
      }),
    })

    expect(result.ok).toBe(false)
    expect(result.code).toBe('SYNC_ENVELOPE_CONTEXT_MISMATCH')
    expect(mockTransport).not.toHaveBeenCalled()
    expect(await adapter.loadSyncPushInflight()).not.toBeNull()
  })

  it('fails closed on registeredDeviceId mismatch without network call', async () => {
    const pushService = createSyncPushService({
      adapter,
      queueService,
      registry,
      tokenFetcher: async () => 'test-token',
      transport: mockTransport,
    })

    const result = await pushService.pushNow({
      context: makeValidCloudContext({
        selectedBusiness: { id: 10, name: 'Business 10' },
        selectedOutlet: { id: 100, name: 'Outlet' },
        deviceIdentifier: 'DEVICE-A',
        registeredDeviceId: 60,
      }),
    })

    expect(result.ok).toBe(false)
    expect(result.code).toBe('SYNC_ENVELOPE_CONTEXT_MISMATCH')
    expect(mockTransport).not.toHaveBeenCalled()
    expect(await adapter.loadSyncPushInflight()).not.toBeNull()
  })
})

describe('P12: Mixed Limits & Candidate Deferral', () => {
  let adapter
  let queueService
  let registry

  beforeEach(async () => {
    adapter = createMemoryAdapter()
    await adapter.initialize()
    await adapter.saveSyncPushBinding({
      businessId: 10,
      boundAt: new Date().toISOString(),
    })
    queueService = createSyncQueueService({ adapter })
    registry = createSyncIdentityRegistry({ adapter })
  })

  it('defers 101st category but includes subsequent valid product in same HTTP batch', async () => {
    for (let i = 1; i <= 101; i++) {
      await queueService.enqueueUpsert(SYNC_ENTITY_TYPES.CATEGORY, `cat-${i}`, { name: `Cat ${i}` })
    }
    const prodEntry = await queueService.enqueueUpsert(SYNC_ENTITY_TYPES.PRODUCT, 'p-mixed', {
      id: 'p-mixed',
      name: 'Product In Mixed Batch',
      price: 15000,
      isActive: true,
    })

    let capturedChanges = null
    const transport = vi.fn().mockImplementation(async ({ body }) => {
      capturedChanges = body.changes
      return {
        ok: true,
        status: 200,
        data: {
          data: {
            request_id: body.request_id,
            duplicate: false,
          },
        },
      }
    })

    const pushService = createSyncPushService({
      adapter,
      queueService,
      registry,
      tokenFetcher: async () => 'test-token',
      transport,
    })

    const result = await pushService.pushNow({ context: makeValidCloudContext() })

    expect(result.ok).toBe(true)
    expect(transport).toHaveBeenCalledTimes(1)
    expect(capturedChanges.categories).toHaveLength(100)
    expect(capturedChanges.products).toHaveLength(1)
    expect(result.removedQueueIds).toHaveLength(101) // 100 categories + 1 product
    expect(result.removedQueueIds).toContain(prodEntry.entry.id)
    expect(result.remaining).toBe(1) // 101st category remains pending
  })
})

describe('P12: Zero-Mapped Entry & Reserved Category Handling', () => {
  let adapter
  let queueService
  let registry
  let mockTransport

  beforeEach(async () => {
    adapter = createMemoryAdapter()
    await adapter.initialize()
    await adapter.saveSyncPushBinding({
      businessId: 10,
      boundAt: new Date().toISOString(),
    })
    queueService = createSyncQueueService({ adapter })
    registry = createSyncIdentityRegistry({ adapter })
    mockTransport = vi.fn()
  })

  it('does not call transport or remove queue when only reserved category Semua is queued', async () => {
    await queueService.enqueueUpsert(SYNC_ENTITY_TYPES.CATEGORY, 'Semua', { name: 'Semua' })

    const pushService = createSyncPushService({
      adapter,
      queueService,
      registry,
      tokenFetcher: async () => 'test-token',
      transport: mockTransport,
    })

    const result = await pushService.pushNow({ context: makeValidCloudContext() })

    expect(result.ok).toBe(true)
    expect(mockTransport).not.toHaveBeenCalled()
    expect(result.sentQueueIds).toEqual([])
    expect(result.removedQueueIds).toEqual([])
    expect(result.blocked).toHaveLength(1)
    expect(result.blocked[0].code).toBe('NO_MAPPED_SERVER_CHANGE')
    expect(result.remaining).toBe(1)
    expect(await queueService.countPending()).toBe(1)
  })

  it('includes only valid product when queue contains reserved category Semua + product', async () => {
    await queueService.enqueueUpsert(SYNC_ENTITY_TYPES.CATEGORY, 'Semua', { name: 'Semua' })
    const prod = await queueService.enqueueUpsert(SYNC_ENTITY_TYPES.PRODUCT, 'p-valid', {
      id: 'p-valid',
      name: 'Valid Product',
      price: 10000,
      isActive: true,
    })

    let capturedChanges = null
    mockTransport.mockImplementation(async ({ body }) => {
      capturedChanges = body.changes
      return {
        ok: true,
        status: 200,
        data: {
          data: {
            request_id: body.request_id,
            duplicate: false,
          },
        },
      }
    })

    const pushService = createSyncPushService({
      adapter,
      queueService,
      registry,
      tokenFetcher: async () => 'test-token',
      transport: mockTransport,
    })

    const result = await pushService.pushNow({ context: makeValidCloudContext() })

    expect(result.ok).toBe(true)
    expect(mockTransport).toHaveBeenCalledTimes(1)
    expect(capturedChanges.categories).toHaveLength(0)
    expect(capturedChanges.products).toHaveLength(1)
    expect(result.sentQueueIds).toEqual([prod.entry.id])
    expect(result.removedQueueIds).toEqual([prod.entry.id])
    expect(result.remaining).toBe(1) // 'Semua' remains in queue
    expect(await queueService.countPending()).toBe(1)
  })
})

describe('P12: Production-Like Store Wiring', () => {
  let adapter
  let pinia
  let queueService
  let registry
  let mockTransport

  beforeEach(async () => {
    pinia = createPinia()
    setActivePinia(pinia)
    adapter = createMemoryAdapter()
    await adapter.initialize()
    await adapter.saveSyncPushBinding({
      businessId: 10,
      boundAt: new Date().toISOString(),
    })
    queueService = createSyncQueueService({ adapter })
    registry = createSyncIdentityRegistry({ adapter })
    mockTransport = vi.fn().mockImplementation(async ({ body }) => ({
      ok: true,
      status: 200,
      data: {
        data: {
          request_id: body.request_id,
          duplicate: false,
        },
      },
    }))
  })

  it('bridges CloudSessionStore context to pushService in syncPushStore.pushNow() without explicit context', async () => {
    await queueService.enqueueUpsert(SYNC_ENTITY_TYPES.PRODUCT, 'p-wire', {
      id: 'p-wire',
      name: 'Kopi Susu Wiring',
      price: 18000,
      isActive: true,
    })

    const pushService = createSyncPushService({
      adapter,
      queueService,
      registry,
      tokenFetcher: async () => 'production-secure-token',
      transport: mockTransport,
    })

    const cloudStore = useCloudSessionStore()
    const syncPushStore = useSyncPushStore()

    cloudStore.user = { id: 1, email: 'owner@example.com' }
    cloudStore.selectedBusiness = { id: 10, name: 'Business 10' }
    cloudStore.selectedOutlet = { id: 101, name: 'Outlet 1' }
    cloudStore.cloudAccess = true
    cloudStore.deviceIdentifier = '123e4567-e89b-12d3-a456-426614174000'
    cloudStore.registeredDeviceId = 55

    syncPushStore.init({ pushService })

    const result = await syncPushStore.pushNow() // No explicit context passed

    expect(result.ok).toBe(true)
    expect(mockTransport).toHaveBeenCalledTimes(1)
    const call = mockTransport.mock.calls[0][0]
    expect(call.token).toBe('production-secure-token')
    expect(call.body.business_id).toBe(10)
    expect(call.body.device_identifier).toBe('123e4567-e89b-12d3-a456-426614174000')
  })
})

describe('P12: UI Integration in CloudLoginView', () => {
  let adapter
  let pinia

  beforeEach(async () => {
    pinia = createPinia()
    setActivePinia(pinia)
    adapter = createMemoryAdapter()
    await adapter.initialize()

    const guardStore = useSyncContextGuardStore()
    guardStore.init({
      contextGuardService: {
        inspect: vi.fn().mockResolvedValue({
          ok: true,
          status: 'safe',
          code: 'SYNC_CONTEXT_SAFE',
        }),
      },
    })
  })

  it('displays Sync Sekarang button when authenticated with cloud access and registered device', async () => {
    const cloudStore = useCloudSessionStore()
    const syncPushStore = useSyncPushStore()

    cloudStore.user = { id: 1, email: 'owner@example.com' }
    cloudStore.selectedBusiness = { id: 10, name: 'Business 10' }
    cloudStore.selectedOutlet = { id: 101, name: 'Outlet 1' }
    cloudStore.cloudAccess = true
    cloudStore.deviceIdentifier = 'dev-uuid-123'
    cloudStore.registeredDeviceId = 50

    const mockPushService = {
      queueService: {
        countPending: vi.fn().mockResolvedValue(5),
      },
      pushNow: vi.fn().mockResolvedValue({
        ok: true,
        removedQueueIds: ['q1', 'q2'],
        remaining: 3,
      }),
    }

    syncPushStore.init({ pushService: mockPushService })

    const wrapper = mount(CloudLoginView, {
      global: { plugins: [pinia] },
    })

    await flushPromises()

    const syncSection = wrapper.find('#cloud-sync-section')
    expect(syncSection.exists()).toBe(true)

    const syncBtn = wrapper.find('#sync-now-btn')
    expect(syncBtn.exists()).toBe(true)

    await syncBtn.trigger('click')
    await flushPromises()

    expect(mockPushService.pushNow).toHaveBeenCalled()
    expect(wrapper.text()).toContain('2 data berhasil dikirim, 3 masih menunggu.')
  })
})

describe('P12: Server Success + Local Queue Cleanup Failure (LOCAL_SYNC_CLEANUP_FAILED)', () => {
  let adapter
  let queueService
  let registry

  function makeSuccessTransport(requestIdRef = { value: null }) {
    return vi.fn().mockImplementation(async ({ body }) => {
      requestIdRef.value = body.request_id
      return {
        ok: true,
        status: 200,
        data: {
          data: {
            request_id: body.request_id,
            duplicate: false,
          },
        },
      }
    })
  }

  function makeDuplicateTransport(firstRequestId) {
    return vi.fn().mockImplementation(async ({ body }) => ({
      ok: true,
      status: 200,
      data: {
        data: {
          request_id: body.request_id,
          duplicate: body.request_id === firstRequestId,
        },
      },
    }))
  }

  beforeEach(async () => {
    adapter = createMemoryAdapter()
    await adapter.initialize()
    await adapter.saveSyncPushBinding({
      businessId: 10,
      boundAt: new Date().toISOString(),
    })
    queueService = createSyncQueueService({ adapter })
    registry = createSyncIdentityRegistry({ adapter })
  })

  it('returns LOCAL_SYNC_CLEANUP_FAILED and preserves envelope when CAS delete throws storage error', async () => {
    const q1 = await queueService.enqueueUpsert(SYNC_ENTITY_TYPES.PRODUCT, 'p-cleanup-fail', {
      id: 'p-cleanup-fail',
      name: 'Cleanup Fail Product',
      price: 12000,
      isActive: true,
    })

    const requestIdRef = { value: null }
    const transport = makeSuccessTransport(requestIdRef)

    // Override adapter CAS delete to simulate SQLite storage error
    const originalDelete = adapter.deleteSyncQueueItemIfUnchanged.bind(adapter)
    adapter.deleteSyncQueueItemIfUnchanged = vi.fn().mockRejectedValue(
      new Error('SQLite disk I/O error'),
    )

    const pushService = createSyncPushService({
      adapter,
      queueService,
      registry,
      tokenFetcher: async () => 'test-token',
      transport,
    })

    const result = await pushService.pushNow({ context: makeValidCloudContext() })

    expect(result.ok).toBe(false)
    expect(result.code).toBe('LOCAL_SYNC_CLEANUP_FAILED')
    expect(result.requestId).toBeTruthy()
    expect(result.cleanupFailedQueueIds).toContain(q1.entry.id)
    expect(result.removedQueueIds).toEqual([])
    expect(result.error.code).toBe('LOCAL_SYNC_CLEANUP_FAILED')

    // Envelope must still be persisted for retry
    const inflight = await adapter.loadSyncPushInflight()
    expect(inflight).not.toBeNull()
    expect(inflight.requestId).toBe(result.requestId)

    // Queue item must still be present
    expect(await queueService.countPending()).toBe(1)

    // Now simulate retry after storage error is resolved
    adapter.deleteSyncQueueItemIfUnchanged = originalDelete
    const savedRequestId = result.requestId

    const retryTransport = makeDuplicateTransport(savedRequestId)
    const retryRegistry = createSyncIdentityRegistry({ adapter })
    const retryService = createSyncPushService({
      adapter,
      queueService,
      registry: retryRegistry,
      tokenFetcher: async () => 'test-token',
      transport: retryTransport,
    })

    const retryResult = await retryService.pushNow({ context: makeValidCloudContext() })

    expect(retryResult.ok).toBe(true)
    expect(retryResult.requestId).toBe(savedRequestId)
    expect(retryResult.duplicate).toBe(true)
    expect(retryResult.removedQueueIds).toContain(q1.entry.id)
    expect(retryResult.remaining).toBe(0)

    // Envelope must be cleared on successful retry
    expect(await adapter.loadSyncPushInflight()).toBeNull()
  })

  it('handles partial cleanup: queue #1 removed, queue #2 fails, envelope preserved, retry clears all', async () => {
    const q1 = await queueService.enqueueUpsert(SYNC_ENTITY_TYPES.PRODUCT, 'p-partial-1', {
      id: 'p-partial-1',
      name: 'Partial Product 1',
      price: 10000,
      isActive: true,
    })
    const q2 = await queueService.enqueueUpsert(SYNC_ENTITY_TYPES.PRODUCT, 'p-partial-2', {
      id: 'p-partial-2',
      name: 'Partial Product 2',
      price: 20000,
      isActive: true,
    })

    const requestIdRef = { value: null }
    const transport = makeSuccessTransport(requestIdRef)

    // First call succeeds for q1, fails for q2
    let callCount = 0
    const originalDelete = adapter.deleteSyncQueueItemIfUnchanged.bind(adapter)
    adapter.deleteSyncQueueItemIfUnchanged = vi.fn().mockImplementation(async (snapshot) => {
      callCount++
      if (callCount === 1) {
        // q1 — succeed
        return originalDelete(snapshot)
      }
      // q2 — storage error
      throw new Error('SQLite disk I/O error on second item')
    })

    const pushService = createSyncPushService({
      adapter,
      queueService,
      registry,
      tokenFetcher: async () => 'test-token',
      transport,
    })

    const result = await pushService.pushNow({ context: makeValidCloudContext() })

    expect(result.ok).toBe(false)
    expect(result.code).toBe('LOCAL_SYNC_CLEANUP_FAILED')
    expect(result.removedQueueIds).toContain(q1.entry.id)
    expect(result.cleanupFailedQueueIds).toContain(q2.entry.id)

    // Envelope still present
    const inflight = await adapter.loadSyncPushInflight()
    expect(inflight).not.toBeNull()
    const savedRequestId = result.requestId

    // q1 is already gone, q2 still in queue
    expect(await queueService.countPending()).toBe(1)
    const pending = await queueService.listPending()
    expect(pending[0].id).toBe(q2.entry.id)

    // Retry after storage error resolved
    adapter.deleteSyncQueueItemIfUnchanged = originalDelete

    const retryTransport = makeDuplicateTransport(savedRequestId)
    const retryRegistry = createSyncIdentityRegistry({ adapter })
    const retryService = createSyncPushService({
      adapter,
      queueService,
      registry: retryRegistry,
      tokenFetcher: async () => 'test-token',
      transport: retryTransport,
    })

    const retryResult = await retryService.pushNow({ context: makeValidCloudContext() })

    expect(retryResult.ok).toBe(true)
    expect(retryResult.requestId).toBe(savedRequestId)
    expect(retryResult.duplicate).toBe(true)

    // Both q1 and q2 are now gone (q1 was already removed, q2 now removed)
    expect(retryResult.remaining).toBe(0)
    expect(await adapter.loadSyncPushInflight()).toBeNull()
  })
})

describe('P12: Business Binding Timing & Anti-Cross-Tenant', () => {
  let adapter
  let queueService
  let registry

  beforeEach(async () => {
    adapter = createMemoryAdapter()
    await adapter.initialize()
    queueService = createSyncQueueService({ adapter })
    registry = createSyncIdentityRegistry({ adapter })
  })

  it('does NOT save sync_push_binding_v1 on empty push', async () => {
    const transport = vi.fn()
    const pushService = createSyncPushService({
      adapter,
      queueService,
      registry,
      tokenFetcher: async () => 'test-token',
      transport,
    })

    const result = await pushService.pushNow({ context: makeValidCloudContext() })

    expect(result.ok).toBe(true)
    expect(result.requestId).toBeNull()
    expect(transport).not.toHaveBeenCalled()
    expect(await adapter.loadSyncPushBinding()).toBeNull()
  })

  it('does NOT save sync_push_binding_v1 when queue contains only blocked or unsupported items', async () => {
    // Only reserved category 'Semua' and unsupported business
    await queueService.enqueueUpsert(SYNC_ENTITY_TYPES.CATEGORY, 'Semua', { name: 'Semua' })
    await queueService.enqueueUpsert(SYNC_ENTITY_TYPES.BUSINESS, 'biz-1', { name: 'Business' })

    const transport = vi.fn()
    const pushService = createSyncPushService({
      adapter,
      queueService,
      registry,
      tokenFetcher: async () => 'test-token',
      transport,
    })

    const result = await pushService.pushNow({ context: makeValidCloudContext() })

    expect(result.ok).toBe(true)
    expect(result.requestId).toBeNull()
    expect(transport).not.toHaveBeenCalled()
    expect(await adapter.loadSyncPushBinding()).toBeNull()
  })

  it('saves sync_push_binding_v1 before HTTP transport on first real push batch', async () => {
    await adapter.saveSyncBootstrapState({
      version: 1,
      businessId: 10,
      outletId: 101,
      deviceIdentifier: '123e4567-e89b-12d3-a456-426614174000',
      registeredDeviceId: 55,
      status: 'staged',
      stagedAt: new Date().toISOString(),
      counts: { categories: 0, products: 1, customers: 0, expenses: 0, transactions: 0 },
    })

    await queueService.enqueueUpsert(SYNC_ENTITY_TYPES.PRODUCT, 'p-1', {
      id: 'p-1',
      name: 'Kopi Susu',
      price: 15000,
    })

    let bindingAtTransportTime = null
    const transport = vi.fn().mockImplementation(async ({ body }) => {
      // Check that binding is already durable before HTTP request is processed
      bindingAtTransportTime = await adapter.loadSyncPushBinding()
      return {
        ok: true,
        status: 200,
        data: {
          data: {
            request_id: body.request_id,
            duplicate: false,
          },
        },
      }
    })

    const pushService = createSyncPushService({
      adapter,
      queueService,
      registry,
      tokenFetcher: async () => 'test-token',
      transport,
    })

    const result = await pushService.pushNow({ context: makeValidCloudContext() })

    expect(result.ok).toBe(true)
    expect(transport).toHaveBeenCalled()
    expect(bindingAtTransportTime).toBeDefined()
    expect(bindingAtTransportTime.businessId).toBe(10)
    expect(await adapter.loadSyncPushBinding()).toBeDefined()
  })
})

describe('P14: Bootstrap Context Verification & Dependency-Aware Push', () => {
  let adapter
  let queueService
  let registry

  beforeEach(async () => {
    adapter = createMemoryAdapter()
    await adapter.initialize()
    queueService = createSyncQueueService({ adapter })
    registry = createSyncIdentityRegistry({ adapter })
  })

  it('fails with SYNC_BOOTSTRAP_REQUIRED when queue has entries but no push binding and no bootstrap state', async () => {
    await queueService.enqueueUpsert(SYNC_ENTITY_TYPES.PRODUCT, 'p-1', {
      id: 'p-1',
      name: 'Kopi Susu',
      price: 15000,
    })

    const transport = vi.fn()
    const pushService = createSyncPushService({
      adapter,
      queueService,
      registry,
      tokenFetcher: async () => 'test-token',
      transport,
    })

    const result = await pushService.pushNow({ context: makeValidCloudContext() })

    expect(result.ok).toBe(false)
    expect(result.code).toBe('SYNC_BOOTSTRAP_REQUIRED')
    expect(transport).not.toHaveBeenCalled()
    expect(await adapter.loadSyncPushBinding()).toBeNull()
    expect(await queueService.countPending()).toBe(1)
  })

  it('returns ok: true on empty push even without bootstrap state or binding', async () => {
    const transport = vi.fn()
    const pushService = createSyncPushService({
      adapter,
      queueService,
      registry,
      tokenFetcher: async () => 'test-token',
      transport,
    })

    const result = await pushService.pushNow({ context: makeValidCloudContext() })

    expect(result.ok).toBe(true)
    expect(result.requestId).toBeNull()
    expect(transport).not.toHaveBeenCalled()
    expect(await adapter.loadSyncPushBinding()).toBeNull()
  })

  it('proceeds with push if valid push binding already exists even without bootstrap state', async () => {
    await adapter.saveSyncPushBinding({
      businessId: 10,
      boundAt: new Date().toISOString(),
    })

    await queueService.enqueueUpsert(SYNC_ENTITY_TYPES.PRODUCT, 'p-1', {
      id: 'p-1',
      name: 'Kopi Susu',
      category: 'Minuman',
      price: 15000,
    })

    const transport = vi.fn().mockImplementation(async ({ body }) => ({
      ok: true,
      status: 200,
      data: { data: { request_id: body.request_id, duplicate: false } },
    }))

    const pushService = createSyncPushService({
      adapter,
      queueService,
      registry,
      tokenFetcher: async () => 'test-token',
      transport,
    })

    const result = await pushService.pushNow({ context: makeValidCloudContext() })

    expect(result.ok).toBe(true)
    expect(transport).toHaveBeenCalled()
  })

  it('fails with SYNC_BOOTSTRAP_CONTEXT_MISMATCH when bootstrap businessId differs', async () => {
    await adapter.saveSyncBootstrapState({
      version: 1,
      businessId: 99, // Mismatched business
      outletId: 101,
      deviceIdentifier: '123e4567-e89b-12d3-a456-426614174000',
      registeredDeviceId: 55,
      status: 'staged',
      stagedAt: new Date().toISOString(),
      counts: { categories: 0, products: 1, customers: 0, expenses: 0, transactions: 0 },
    })

    await queueService.enqueueUpsert(SYNC_ENTITY_TYPES.PRODUCT, 'p-1', {
      id: 'p-1',
      name: 'Kopi Susu',
      price: 15000,
    })

    const transport = vi.fn()
    const pushService = createSyncPushService({
      adapter,
      queueService,
      registry,
      tokenFetcher: async () => 'test-token',
      transport,
    })

    const result = await pushService.pushNow({ context: makeValidCloudContext() })

    expect(result.ok).toBe(false)
    expect(result.code).toBe('SYNC_BOOTSTRAP_CONTEXT_MISMATCH')
    expect(transport).not.toHaveBeenCalled()
    expect(await adapter.loadSyncPushBinding()).toBeNull()
    expect(await queueService.countPending()).toBe(1)
  })

  it('fails with SYNC_BOOTSTRAP_CONTEXT_MISMATCH when bootstrap outletId or device differs', async () => {
    // 1. Outlet mismatch
    await adapter.saveSyncBootstrapState({
      version: 1,
      businessId: 10,
      outletId: 999, // Mismatched outlet
      deviceIdentifier: '123e4567-e89b-12d3-a456-426614174000',
      registeredDeviceId: 55,
      status: 'staged',
      stagedAt: new Date().toISOString(),
      counts: { categories: 0, products: 1, customers: 0, expenses: 0, transactions: 0 },
    })

    await queueService.enqueueUpsert(SYNC_ENTITY_TYPES.PRODUCT, 'p-1', {
      id: 'p-1',
      name: 'Kopi Susu',
      price: 15000,
    })

    const transport = vi.fn()
    const pushService = createSyncPushService({
      adapter,
      queueService,
      registry,
      tokenFetcher: async () => 'test-token',
      transport,
    })

    const res1 = await pushService.pushNow({ context: makeValidCloudContext() })
    expect(res1.ok).toBe(false)
    expect(res1.code).toBe('SYNC_BOOTSTRAP_CONTEXT_MISMATCH')

    // 2. Device mismatch
    await adapter.saveSyncBootstrapState({
      version: 1,
      businessId: 10,
      outletId: 101,
      deviceIdentifier: 'other-device-uuid',
      registeredDeviceId: 55,
      status: 'staged',
      stagedAt: new Date().toISOString(),
      counts: { categories: 0, products: 1, customers: 0, expenses: 0, transactions: 0 },
    })

    const res2 = await pushService.pushNow({ context: makeValidCloudContext() })
    expect(res2.ok).toBe(false)
    expect(res2.code).toBe('SYNC_BOOTSTRAP_CONTEXT_MISMATCH')
  })

  it('defers transaction when referenced product parent is pending and not included in current batch (>100 products limit)', async () => {
    await adapter.saveSyncPushBinding({
      businessId: 10,
      boundAt: new Date().toISOString(),
    })

    // Queue: 1 category, 101 products, 1 transaction using product #101
    await queueService.enqueueUpsert(SYNC_ENTITY_TYPES.CATEGORY, 'Minuman', { name: 'Minuman' })

    for (let i = 1; i <= 101; i++) {
      await queueService.enqueueUpsert(SYNC_ENTITY_TYPES.PRODUCT, `prod-${i}`, {
        id: `prod-${i}`,
        name: `Product ${i}`,
        category: 'Minuman',
        price: 10000,
        isActive: true,
      })
    }

    await queueService.enqueueUpsert(SYNC_ENTITY_TYPES.TRANSACTION, 'trx-1', {
      id: 'trx-1',
      invoiceNumber: 'INV-101',
      customerId: null,
      status: 'paid',
      subtotal: 10000,
      tax: 0,
      total: 10000,
      createdAt: '2026-08-26T10:00:00.000Z',
      items: [{ id: 'prod-101', name: 'Product 101', price: 10000, qty: 1 }],
    })

    let push1Changes = null
    let push2Changes = null

    const transport = vi.fn().mockImplementation(async ({ body }) => {
      if (!push1Changes) {
        push1Changes = body.changes
      } else {
        push2Changes = body.changes
      }
      return {
        ok: true,
        status: 200,
        data: { data: { request_id: body.request_id, duplicate: false } },
      }
    })

    const pushService = createSyncPushService({
      adapter,
      queueService,
      registry,
      tokenFetcher: async () => 'test-token',
      transport,
    })

    // ── Push 1: Should send 1 category + 100 products. Transaction must be DEFERRED because prod-101 is not in batch 1.
    const res1 = await pushService.pushNow({ context: makeValidCloudContext() })
    expect(res1.ok).toBe(true)
    expect(push1Changes.categories).toHaveLength(1)
    expect(push1Changes.products).toHaveLength(100)
    expect(push1Changes.sales).toHaveLength(0) // Deferred
    expect(push1Changes.sale_items).toHaveLength(0)

    // ── Push 2: prod-101 is now in batch 2, so Transaction is allowed to be included in batch 2!
    const res2 = await pushService.pushNow({ context: makeValidCloudContext() })
    expect(res2.ok).toBe(true)
    expect(push2Changes.products).toHaveLength(1) // prod-101
    expect(push2Changes.sales).toHaveLength(1) // Transaction is now included!
    expect(push2Changes.sale_items).toHaveLength(1)
  })

  it('defers transaction when referenced customer parent is pending and deferred (>100 customers limit)', async () => {
    await adapter.saveSyncPushBinding({
      businessId: 10,
      boundAt: new Date().toISOString(),
    })

    for (let i = 1; i <= 101; i++) {
      await queueService.enqueueUpsert(SYNC_ENTITY_TYPES.CUSTOMER, `cust-${i}`, {
        id: `cust-${i}`,
        name: `Customer ${i}`,
        phone: `081234567${i.toString().padStart(3, '0')}`,
      })
    }

    await queueService.enqueueUpsert(SYNC_ENTITY_TYPES.TRANSACTION, 'trx-cust', {
      id: 'trx-cust',
      invoiceNumber: 'INV-CUST',
      customerId: 'cust-101',
      status: 'paid',
      subtotal: 10000,
      tax: 0,
      total: 10000,
      createdAt: '2026-08-26T10:00:00.000Z',
      items: [{ id: 'p-existing', name: 'Existing Product', price: 10000, qty: 1 }],
    })

    let push1Changes = null
    const transport = vi.fn().mockImplementation(async ({ body }) => {
      if (!push1Changes) {
        push1Changes = body.changes
      }
      return {
        ok: true,
        status: 200,
        data: { data: { request_id: body.request_id, duplicate: false } },
      }
    })

    const pushService = createSyncPushService({
      adapter,
      queueService,
      registry,
      tokenFetcher: async () => 'test-token',
      transport,
    })

    const res1 = await pushService.pushNow({ context: makeValidCloudContext() })
    expect(res1.ok).toBe(true)
    expect(push1Changes.customers).toHaveLength(100)
    expect(push1Changes.sales).toHaveLength(0) // Deferred because cust-101 is not yet pushed
  })

  it('defers transaction when referenced product parent is blocked, without starving independent expenses', async () => {
    await adapter.saveSyncPushBinding({
      businessId: 10,
      boundAt: new Date().toISOString(),
    })

    // Blocked product in queue (e.g. invalid price)
    await queueService.enqueueUpsert(SYNC_ENTITY_TYPES.PRODUCT, 'prod-bad', {
      id: 'prod-bad',
      name: 'Bad Product',
      price: -500, // Invalid -> blocked by mapper
    })

    // Transaction dependent on prod-bad
    await queueService.enqueueUpsert(SYNC_ENTITY_TYPES.TRANSACTION, 'trx-bad', {
      id: 'trx-bad',
      invoiceNumber: 'INV-BAD',
      customerId: null,
      status: 'paid',
      subtotal: 10000,
      tax: 0,
      total: 10000,
      createdAt: '2026-08-26T10:00:00.000Z',
      items: [{ id: 'prod-bad', name: 'Bad Product', price: 10000, qty: 1 }],
    })

    // Independent valid expense
    await queueService.enqueueUpsert(SYNC_ENTITY_TYPES.EXPENSE, 'exp-1', {
      id: 'exp-1',
      amount: 50000,
      description: 'Listrik',
      occurred_at: '2026-08-26T00:00:00.000Z',
    })

    let capturedChanges = null
    const transport = vi.fn().mockImplementation(async ({ body }) => {
      capturedChanges = body.changes
      return {
        ok: true,
        status: 200,
        data: { data: { request_id: body.request_id, duplicate: false } },
      }
    })

    const pushService = createSyncPushService({
      adapter,
      queueService,
      registry,
      tokenFetcher: async () => 'test-token',
      transport,
    })

    const res = await pushService.pushNow({ context: makeValidCloudContext() })
    expect(res.ok).toBe(true)
    // Product is blocked, Transaction is deferred
    expect(capturedChanges.products).toHaveLength(0)
    expect(capturedChanges.sales).toHaveLength(0)
    // Independent expense must not be starved!
    expect(capturedChanges.expenses).toHaveLength(1)
    expect(capturedChanges.expenses[0].description).toBe('Listrik')
  })

  it('fails with SYNC_BOOTSTRAP_CONTEXT_MISMATCH on reused envelope when bootstrap deviceIdentifier differs', async () => {
    // 1. Existing inflight envelope with DEVICE-A
    await adapter.saveSyncPushInflight({
      version: 1,
      requestId: 'req-reused-1',
      businessId: 10,
      outletId: 101,
      deviceIdentifier: 'DEVICE-A',
      registeredDeviceId: 55,
      createdAt: new Date().toISOString(),
      queueSnapshots: [{ id: 'q1', entityType: SYNC_ENTITY_TYPES.PRODUCT, entityId: 'p-1', operation: 'upsert' }],
      changes: { products: [{ sync_id: 'prod-uuid', name: 'Product' }] },
    })

    // 2. Bootstrap state has DEVICE-B (mismatched device)
    await adapter.saveSyncBootstrapState({
      version: 1,
      businessId: 10,
      outletId: 101,
      deviceIdentifier: 'DEVICE-B',
      registeredDeviceId: 55,
      status: 'staged',
      stagedAt: new Date().toISOString(),
      counts: { categories: 0, products: 1, customers: 0, expenses: 0, transactions: 0 },
    })

    const transport = vi.fn()
    const pushService = createSyncPushService({
      adapter,
      queueService,
      registry,
      tokenFetcher: async () => 'test-token',
      transport,
    })

    const result = await pushService.pushNow({
      context: makeValidCloudContext({ deviceIdentifier: 'DEVICE-A' }),
    })

    expect(result.ok).toBe(false)
    expect(result.code).toBe('SYNC_BOOTSTRAP_CONTEXT_MISMATCH')
    expect(transport).not.toHaveBeenCalled()
    expect(await adapter.loadSyncPushBinding()).toBeNull()
    expect(await adapter.loadSyncPushInflight()).not.toBeNull() // Envelope preserved
  })

  it('fails with SYNC_BOOTSTRAP_CONTEXT_MISMATCH when existing push binding is present but current context differs from staged bootstrap state', async () => {
    // Existing push binding
    await adapter.saveSyncPushBinding({
      businessId: 10,
      boundAt: new Date().toISOString(),
    })

    // Staged bootstrap state for Outlet 101
    await adapter.saveSyncBootstrapState({
      version: 1,
      businessId: 10,
      outletId: 101,
      deviceIdentifier: '123e4567-e89b-12d3-a456-426614174000',
      registeredDeviceId: 55,
      status: 'staged',
      stagedAt: new Date().toISOString(),
      counts: { categories: 0, products: 1, customers: 0, expenses: 0, transactions: 0 },
    })

    await queueService.enqueueUpsert(SYNC_ENTITY_TYPES.PRODUCT, 'p-1', {
      id: 'p-1',
      name: 'Kopi Susu',
      category: 'Minuman',
      price: 15000,
    })

    const transport = vi.fn()
    const pushService = createSyncPushService({
      adapter,
      queueService,
      registry,
      tokenFetcher: async () => 'test-token',
      transport,
    })

    // Caller attempts push with Outlet 202
    const result = await pushService.pushNow({
      context: makeValidCloudContext({ selectedOutlet: { id: 202, name: 'Outlet 202' } }),
    })

    expect(result.ok).toBe(false)
    expect(result.code).toBe('SYNC_BOOTSTRAP_CONTEXT_MISMATCH')
    expect(transport).not.toHaveBeenCalled()
    expect(await adapter.loadSyncPushInflight()).toBeNull()
    expect(await queueService.countPending()).toBe(1)
  })

  it('blocks second batch in multi-batch bootstrap if outlet is switched after first push', async () => {
    await adapter.saveSyncBootstrapState({
      version: 1,
      businessId: 10,
      outletId: 101,
      deviceIdentifier: '123e4567-e89b-12d3-a456-426614174000',
      registeredDeviceId: 55,
      status: 'staged',
      stagedAt: new Date().toISOString(),
      counts: { categories: 1, products: 101, customers: 0, expenses: 0, transactions: 0 },
    })

    await queueService.enqueueUpsert(SYNC_ENTITY_TYPES.CATEGORY, 'Minuman', { name: 'Minuman' })

    for (let i = 1; i <= 101; i++) {
      await queueService.enqueueUpsert(SYNC_ENTITY_TYPES.PRODUCT, `p-${i}`, {
        id: `p-${i}`,
        name: `Product ${i}`,
        category: 'Minuman',
        price: 10000,
      })
    }

    const transport = vi.fn().mockImplementation(async ({ body }) => ({
      ok: true,
      status: 200,
      data: { data: { request_id: body.request_id, duplicate: false } },
    }))

    const pushService = createSyncPushService({
      adapter,
      queueService,
      registry,
      tokenFetcher: async () => 'test-token',
      transport,
    })

    // Push 1: Context is Outlet 101 -> succeeds
    const res1 = await pushService.pushNow({
      context: makeValidCloudContext({ selectedOutlet: { id: 101, name: 'Outlet 101' } }),
    })
    expect(res1.ok).toBe(true)
    expect(transport).toHaveBeenCalledTimes(1)
    expect(await queueService.countPending()).toBe(1) // 1 product left

    // Push 2: Context is switched to Outlet 202 -> BLOCKED
    const res2 = await pushService.pushNow({
      context: makeValidCloudContext({ selectedOutlet: { id: 202, name: 'Outlet 202' } }),
    })
    expect(res2.ok).toBe(false)
    expect(res2.code).toBe('SYNC_BOOTSTRAP_CONTEXT_MISMATCH')
    expect(transport).toHaveBeenCalledTimes(1) // No new HTTP request
    expect(await queueService.countPending()).toBe(1)
  })

  it('blocks second batch in multi-batch bootstrap if deviceIdentifier is switched after first push', async () => {
    await adapter.saveSyncBootstrapState({
      version: 1,
      businessId: 10,
      outletId: 101,
      deviceIdentifier: 'DEVICE-ORIGINAL',
      registeredDeviceId: 55,
      status: 'staged',
      stagedAt: new Date().toISOString(),
      counts: { categories: 0, products: 2, customers: 0, expenses: 0, transactions: 0 },
    })

    await queueService.enqueueUpsert(SYNC_ENTITY_TYPES.PRODUCT, 'p-1', {
      id: 'p-1',
      name: 'Product 1',
      category: 'Minuman',
      price: 10000,
    })

    const transport = vi.fn().mockImplementation(async ({ body }) => ({
      ok: true,
      status: 200,
      data: { data: { request_id: body.request_id, duplicate: false } },
    }))

    const pushService = createSyncPushService({
      adapter,
      queueService,
      registry,
      tokenFetcher: async () => 'test-token',
      transport,
    })

    // Push 1: DEVICE-ORIGINAL -> succeeds
    const res1 = await pushService.pushNow({
      context: makeValidCloudContext({ deviceIdentifier: 'DEVICE-ORIGINAL' }),
    })
    expect(res1.ok).toBe(true)

    // Add new product
    await queueService.enqueueUpsert(SYNC_ENTITY_TYPES.PRODUCT, 'p-2', {
      id: 'p-2',
      name: 'Product 2',
      category: 'Minuman',
      price: 15000,
    })

    // Push 2: DEVICE-SWITCHED -> BLOCKED
    const res2 = await pushService.pushNow({
      context: makeValidCloudContext({ deviceIdentifier: 'DEVICE-SWITCHED' }),
    })
    expect(res2.ok).toBe(false)
    expect(res2.code).toBe('SYNC_BOOTSTRAP_CONTEXT_MISMATCH')
    expect(transport).toHaveBeenCalledTimes(1)
  })

  it('handles crash window where binding was saved but envelope persist threw: blocks mismatched context retry and allows valid context retry', async () => {
    await adapter.saveSyncBootstrapState({
      version: 1,
      businessId: 10,
      outletId: 101,
      deviceIdentifier: '123e4567-e89b-12d3-a456-426614174000',
      registeredDeviceId: 55,
      status: 'staged',
      stagedAt: new Date().toISOString(),
      counts: { categories: 0, products: 1, customers: 0, expenses: 0, transactions: 0 },
    })

    await queueService.enqueueUpsert(SYNC_ENTITY_TYPES.PRODUCT, 'p-crash', {
      id: 'p-crash',
      name: 'Crash Product',
      category: 'Minuman',
      price: 10000,
    })

    // Mock saveSyncPushInflight failure
    const originalSaveInflight = adapter.saveSyncPushInflight.bind(adapter)
    adapter.saveSyncPushInflight = vi.fn().mockRejectedValueOnce(new Error('Disk write failed on envelope'))

    const transport = vi.fn().mockImplementation(async ({ body }) => ({
      ok: true,
      status: 200,
      data: { data: { request_id: body.request_id, duplicate: false } },
    }))

    const pushService = createSyncPushService({
      adapter,
      queueService,
      registry,
      tokenFetcher: async () => 'test-token',
      transport,
    })

    // Push 1 fails at envelope save
    const res1 = await pushService.pushNow({ context: makeValidCloudContext() })
    expect(res1.ok).toBe(false)
    expect(res1.code).toBe('SYNC_ENVELOPE_PERSIST_FAILED')
    expect(transport).not.toHaveBeenCalled()
    expect(await adapter.loadSyncPushBinding()).not.toBeNull() // Binding was saved
    expect(await queueService.countPending()).toBe(1) // Queue intact

    // Retry with mismatched outlet -> BLOCKED
    const res2 = await pushService.pushNow({
      context: makeValidCloudContext({ selectedOutlet: { id: 999, name: 'Wrong Outlet' } }),
    })
    expect(res2.ok).toBe(false)
    expect(res2.code).toBe('SYNC_BOOTSTRAP_CONTEXT_MISMATCH')
    expect(transport).not.toHaveBeenCalled()

    // Retry with correct context -> SUCCEEDS
    adapter.saveSyncPushInflight = originalSaveInflight
    const res3 = await pushService.pushNow({ context: makeValidCloudContext() })
    expect(res3.ok).toBe(true)
    expect(transport).toHaveBeenCalledTimes(1)
    expect(await queueService.countPending()).toBe(0)
  })

  it('re-uses in-flight envelope when bootstrap state is staged and context is valid', async () => {
    await adapter.saveSyncPushBinding({
      businessId: 10,
      boundAt: new Date().toISOString(),
    })

    await adapter.saveSyncBootstrapState({
      version: 1,
      businessId: 10,
      outletId: 101,
      deviceIdentifier: '123e4567-e89b-12d3-a456-426614174000',
      registeredDeviceId: 55,
      status: 'staged',
      stagedAt: new Date().toISOString(),
      counts: { categories: 0, products: 1, customers: 0, expenses: 0, transactions: 0 },
    })

    await adapter.saveSyncPushInflight({
      version: 1,
      requestId: 'req-inflight-valid',
      businessId: 10,
      outletId: 101,
      deviceIdentifier: '123e4567-e89b-12d3-a456-426614174000',
      registeredDeviceId: 55,
      createdAt: new Date().toISOString(),
      queueSnapshots: [{ id: 'q1', entityType: SYNC_ENTITY_TYPES.PRODUCT, entityId: 'p-1', operation: 'upsert' }],
      changes: { products: [{ sync_id: 'prod-uuid', name: 'Product' }] },
    })

    let sentRequestId = null
    const transport = vi.fn().mockImplementation(async ({ body }) => {
      sentRequestId = body.request_id
      return {
        ok: true,
        status: 200,
        data: { data: { request_id: body.request_id, duplicate: true } },
      }
    })

    const pushService = createSyncPushService({
      adapter,
      queueService,
      registry,
      tokenFetcher: async () => 'test-token',
      transport,
    })

    const result = await pushService.pushNow({ context: makeValidCloudContext() })
    expect(result.ok).toBe(true)
    expect(result.requestId).toBe('req-inflight-valid')
    expect(sentRequestId).toBe('req-inflight-valid')
    expect(transport).toHaveBeenCalledTimes(1)
  })
})



