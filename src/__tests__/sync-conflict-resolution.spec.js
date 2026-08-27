/**
 * Mobile P15 — Manual Sync Conflict Resolution Test Suite
 *
 * Covers:
 * 1. Capture 409 SYNC_CONFLICT response & map to local queue snapshots
 * 2. Durable conflict state persistence (survives restart, no token, app_meta sync_conflicts_v1)
 * 3. Conflicted outbox queue items blocked from subsequent pushes without starving independent entries
 * 4. All pending entries conflicted returns SYNC_CONFLICT_PENDING without HTTP request
 * 5. Manual resolution: useServer(conflictId) removes queue via CAS and resolves conflict
 * 6. Manual resolution CAS mismatch: useServer on modified local queue returns SYNC_CONFLICT_LOCAL_CHANGED
 * 7. Manual resolution: keepLocal(conflictId) updates server version and next push maps base_sync_version
 * 8. Transaction atomicity: conflict on sale or sale_item marks whole transaction conflicted
 * 9. Deduplication of identical conflict responses across retries
 * 10. Partial resolution: resolving one conflict unblocks that entry while other conflicts remain open
 * 11. Malformed 409 response handling (INVALID_SYNC_CONFLICT_RESPONSE)
 * 12. Storage failure during conflict persist (SYNC_CONFLICT_PERSIST_FAILED) preserves envelope
 * 13. UI integration in CloudLoginView (Konflik Sinkronisasi section & actions)
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

import { createMemoryAdapter } from '../services/database/memoryAdapter'
import { createSQLiteAdapter } from '../services/database/sqliteAdapter'
import { createSyncQueueService } from '../services/sync/syncQueueService'
import { createSyncIdentityRegistry } from '../services/sync/syncIdentityRegistry'
import { createSyncPushService } from '../services/sync/syncPushService'
import { createSyncConflictService } from '../services/sync/syncConflictService'
import { SYNC_ENTITY_TYPES } from '../services/sync/syncConstants'
import { useCloudSessionStore } from '../stores/cloudSessionStore'
import { useSyncPushStore } from '../stores/syncPushStore'
import { useSyncConflictStore } from '../stores/syncConflictStore'
import CloudLoginView from '../views/settings/CloudLoginView.vue'

const { fakeDb } = vi.hoisted(() => {
  const fakeDb = {
    beginTransaction: vi.fn(async () => {}),
    commitTransaction: vi.fn(async () => {}),
    rollbackTransaction: vi.fn(async () => {}),
    run: vi.fn(async () => ({ changes: { changes: 1 } })),
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

describe('P15: Capture & Persist 409 SYNC_CONFLICT', () => {
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

  it('captures 409 SYNC_CONFLICT, saves durable conflict record, clears envelope, and keeps queue intact', async () => {
    const q1 = await queueService.enqueueUpsert(SYNC_ENTITY_TYPES.PRODUCT, 'p-1', {
      id: 'p-1',
      name: 'Kopi Susu',
      category: 'Minuman',
      price: 15000,
    })

    const prodSyncId = await registry.resolveSyncId(SYNC_ENTITY_TYPES.PRODUCT, 'p-1')

    const mockTransport = vi.fn().mockResolvedValue({
      ok: false,
      status: 409,
      data: {
        code: 'SYNC_CONFLICT',
        conflicts: [
          {
            entity: 'products',
            sync_id: prodSyncId,
            server_sync_version: 3,
          },
        ],
      },
    })

    const pushService = createSyncPushService({
      adapter,
      queueService,
      registry,
      tokenFetcher: async () => 'test-token',
      transport: mockTransport,
    })

    const result = await pushService.pushNow({ context: makeValidCloudContext() })

    expect(result.ok).toBe(false)
    expect(result.code).toBe('SYNC_CONFLICT')
    expect(result.conflicts).toHaveLength(1)
    expect(result.conflicts[0]).toMatchObject({
      entityType: SYNC_ENTITY_TYPES.PRODUCT,
      entityId: 'p-1',
      serverEntity: 'products',
      syncId: prodSyncId,
      serverSyncVersion: 3,
      status: 'open',
    })

    // 1. Durable conflict state must be saved in adapter
    const savedConflicts = await adapter.loadSyncConflicts()
    expect(savedConflicts).not.toBeNull()
    expect(savedConflicts.conflicts).toHaveLength(1)
    expect(savedConflicts.conflicts[0].queueId).toBe(q1.entry.id)
    expect(savedConflicts.conflicts[0].status).toBe('open')

    // 2. Queue must remain intact
    expect(await queueService.countPending()).toBe(1)

    // 3. Inflight envelope must be cleared after conflict state is durable
    expect(await adapter.loadSyncPushInflight()).toBeNull()
  })

  it('survives simulated restart: hydrates open conflict records from durable storage', async () => {
    await adapter.saveSyncConflicts({
      version: 1,
      conflicts: [
        {
          id: 'conf-1',
          requestId: 'req-1',
          queueId: 'q-1',
          entityType: 'product',
          entityId: 'p-1',
          serverEntity: 'products',
          syncId: 'prod-uuid-1',
          serverSyncVersion: 2,
          queueSnapshot: { id: 'q-1', entityType: 'product', entityId: 'p-1', operation: 'upsert', updatedAt: '2026-08-26T00:00:00Z' },
          status: 'open',
          createdAt: new Date().toISOString(),
        },
      ],
    })

    const conflictService = createSyncConflictService({ adapter, queueService, registry })
    const openConflicts = await conflictService.listOpenConflicts()

    expect(openConflicts).toHaveLength(1)
    expect(openConflicts[0].id).toBe('conf-1')
    expect(openConflicts[0].status).toBe('open')
  })

  it('deduplicates identical conflict responses across retries without duplicate durable entries', async () => {
    await queueService.enqueueUpsert(SYNC_ENTITY_TYPES.PRODUCT, 'p-dup', {
      id: 'p-dup',
      name: 'Item Dup',
      price: 10000,
    })
    const prodSyncId = await registry.resolveSyncId(SYNC_ENTITY_TYPES.PRODUCT, 'p-dup')

    const mockTransport = vi.fn().mockResolvedValue({
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
      tokenFetcher: async () => 'test-token',
      transport: mockTransport,
    })

    // Push 1 -> creates conflict
    await pushService.pushNow({ context: makeValidCloudContext() })

    // Simulate envelope existing with same conflict on retry
    const saved = await adapter.loadSyncConflicts()
    expect(saved.conflicts).toHaveLength(1)

    // Re-run push with mock creating same conflict response
    await pushService.pushNow({ context: makeValidCloudContext() })

    const saved2 = await adapter.loadSyncConflicts()
    // Must NOT have duplicated the conflict record
    expect(saved2.conflicts).toHaveLength(1)
  })
})

describe('P15: Conflicted Queue Blocking & Non-Starvation', () => {
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

  it('blocks conflicted entry from push while allowing independent unconflicted entries to be sent', async () => {
    // 1. Conflicted Product
    const q1 = await queueService.enqueueUpsert(SYNC_ENTITY_TYPES.PRODUCT, 'p-conflicted', {
      id: 'p-conflicted',
      name: 'Conflicted Coffee',
      category: 'Minuman',
      price: 15000,
    })
    const prodSyncId = await registry.resolveSyncId(SYNC_ENTITY_TYPES.PRODUCT, 'p-conflicted')

    await adapter.saveSyncConflicts({
      version: 1,
      conflicts: [
        {
          id: 'conf-p1',
          requestId: 'req-old',
          queueId: q1.entry.id,
          entityType: SYNC_ENTITY_TYPES.PRODUCT,
          entityId: 'p-conflicted',
          serverEntity: 'products',
          syncId: prodSyncId,
          serverSyncVersion: 4,
          queueSnapshot: q1.entry,
          status: 'open',
          createdAt: new Date().toISOString(),
        },
      ],
    })

    // 2. Normal unconflicted Expense
    await queueService.enqueueUpsert(SYNC_ENTITY_TYPES.EXPENSE, 'e-normal', {
      id: 'e-normal',
      title: 'Beli Gula',
      amount: 25000,
      createdAt: '2026-08-26T00:00:00.000Z',
    })

    let capturedChanges = null
    const mockTransport = vi.fn().mockImplementation(async ({ body }) => {
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
      transport: mockTransport,
    })

    const result = await pushService.pushNow({ context: makeValidCloudContext() })

    expect(result.ok).toBe(true)
    expect(mockTransport).toHaveBeenCalledTimes(1)
    // Product was blocked by open conflict
    expect(capturedChanges.products).toHaveLength(0)
    // Expense was batched and sent!
    expect(capturedChanges.expenses).toHaveLength(1)
    expect(capturedChanges.expenses[0].description).toBe('Beli Gula')
    // 1 item remaining (the conflicted product)
    expect(result.remaining).toBe(1)
  })

  it('returns SYNC_CONFLICT_PENDING without HTTP request when all pending entries are blocked by open conflicts', async () => {
    const q1 = await queueService.enqueueUpsert(SYNC_ENTITY_TYPES.PRODUCT, 'p-only', {
      id: 'p-only',
      name: 'Solo Product',
      price: 10000,
    })

    await adapter.saveSyncConflicts({
      version: 1,
      conflicts: [
        {
          id: 'conf-solo',
          requestId: 'req-old',
          queueId: q1.entry.id,
          entityType: SYNC_ENTITY_TYPES.PRODUCT,
          entityId: 'p-only',
          serverEntity: 'products',
          syncId: 'prod-uuid-solo',
          serverSyncVersion: 2,
          queueSnapshot: q1.entry,
          status: 'open',
          createdAt: new Date().toISOString(),
        },
      ],
    })

    const mockTransport = vi.fn()
    const pushService = createSyncPushService({
      adapter,
      queueService,
      registry,
      tokenFetcher: async () => 'test-token',
      transport: mockTransport,
    })

    const result = await pushService.pushNow({ context: makeValidCloudContext() })

    expect(result.ok).toBe(false)
    expect(result.code).toBe('SYNC_CONFLICT_PENDING')
    expect(mockTransport).not.toHaveBeenCalled()
    expect(await adapter.loadSyncPushInflight()).toBeNull()
  })
})

describe('P15: Manual Conflict Resolution (useServer & keepLocal)', () => {
  let adapter
  let queueService
  let registry
  let conflictService

  beforeEach(async () => {
    adapter = createMemoryAdapter()
    await adapter.initialize()
    await adapter.saveSyncPushBinding({
      businessId: 10,
      boundAt: new Date().toISOString(),
    })
    queueService = createSyncQueueService({ adapter })
    registry = createSyncIdentityRegistry({ adapter })
    conflictService = createSyncConflictService({ adapter, queueService, registry })
  })

  it('resolves conflict with useServer: removes queue item via CAS, marks conflict resolved, and does NOT auto-pull', async () => {
    const q1 = await queueService.enqueueUpsert(SYNC_ENTITY_TYPES.PRODUCT, 'p-server', {
      id: 'p-server',
      name: 'Kopi Lokal',
      price: 10000,
    })

    const conflictRecord = {
      id: 'conf-use-server',
      requestId: 'req-srv',
      queueId: q1.entry.id,
      entityType: SYNC_ENTITY_TYPES.PRODUCT,
      entityId: 'p-server',
      serverEntity: 'products',
      syncId: 'prod-uuid-srv',
      serverSyncVersion: 5,
      queueSnapshot: q1.entry,
      status: 'open',
      createdAt: new Date().toISOString(),
    }

    await adapter.saveSyncConflicts({
      version: 1,
      conflicts: [conflictRecord],
    })

    const res = await conflictService.useServer('conf-use-server')

    expect(res.ok).toBe(true)
    expect(res.code).toBe('SYNC_CONFLICT_RESOLVED')
    expect(res.message).toContain('Tarik Data Cloud')

    // 1. Queue item must be removed
    expect(await queueService.countPending()).toBe(0)

    // 2. Conflict must be marked resolved
    const state = await adapter.loadSyncConflicts()
    expect(state.conflicts[0].status).toBe('resolved')
    expect(state.conflicts[0].resolution).toBe('use_server')
    expect(state.conflicts[0].resolvedAt).toBeTruthy()
  })

  it('fails useServer with SYNC_CONFLICT_LOCAL_CHANGED when local queue item was modified after conflict was recorded', async () => {
    const q1 = await queueService.enqueueUpsert(SYNC_ENTITY_TYPES.PRODUCT, 'p-cas-fail', {
      id: 'p-cas-fail',
      name: 'Kopi Original',
      price: 10000,
    })

    const originalSnapshot = { ...q1.entry }

    await adapter.saveSyncConflicts({
      version: 1,
      conflicts: [
        {
          id: 'conf-cas-fail',
          requestId: 'req-cas',
          queueId: q1.entry.id,
          entityType: SYNC_ENTITY_TYPES.PRODUCT,
          entityId: 'p-cas-fail',
          serverEntity: 'products',
          syncId: 'prod-uuid-cas',
          serverSyncVersion: 2,
          queueSnapshot: originalSnapshot,
          status: 'open',
          createdAt: new Date().toISOString(),
        },
      ],
    })

    // User edits Product locally while conflict is open
    await queueService.enqueueUpsert(SYNC_ENTITY_TYPES.PRODUCT, 'p-cas-fail', {
      id: 'p-cas-fail',
      name: 'Kopi Edited Locally',
      price: 12000,
    })

    const res = await conflictService.useServer('conf-cas-fail')

    expect(res.ok).toBe(false)
    expect(res.code).toBe('SYNC_CONFLICT_LOCAL_CHANGED')

    // Queue item must still exist with new mutation
    expect(await queueService.countPending()).toBe(1)
    const pending = await queueService.listPending()
    expect(pending[0].payload.name).toBe('Kopi Edited Locally')

    // Conflict must remain open
    const state = await adapter.loadSyncConflicts()
    expect(state.conflicts[0].status).toBe('open')
  })

  it('resolves conflict with keepLocal: updates sync_server_versions_v1, preserves queue, and next push maps base_sync_version', async () => {
    const q1 = await queueService.enqueueUpsert(SYNC_ENTITY_TYPES.PRODUCT, 'p-keep', {
      id: 'p-keep',
      name: 'Kopi Keep Local',
      category: 'Minuman',
      price: 18000,
    })
    const prodSyncId = await registry.resolveSyncId(SYNC_ENTITY_TYPES.PRODUCT, 'p-keep')

    const conflictRecord = {
      id: 'conf-keep-local',
      requestId: 'req-keep',
      queueId: q1.entry.id,
      entityType: SYNC_ENTITY_TYPES.PRODUCT,
      entityId: 'p-keep',
      serverEntity: 'products',
      syncId: prodSyncId,
      serverSyncVersion: 7,
      queueSnapshot: q1.entry,
      status: 'open',
      createdAt: new Date().toISOString(),
    }

    await adapter.saveSyncConflicts({
      version: 1,
      conflicts: [conflictRecord],
    })

    const res = await conflictService.keepLocal('conf-keep-local')

    expect(res.ok).toBe(true)
    expect(res.code).toBe('SYNC_CONFLICT_RESOLVED')
    expect(res.message).toContain('Sync Sekarang')

    // 1. sync_server_versions_v1 must have products:prodSyncId in flat P13 format
    const serverVersions = await adapter.loadSyncServerVersions()
    expect(serverVersions).not.toBeNull()
    expect(serverVersions[`products:${prodSyncId}`].syncVersion).toBe(7)

    // 2. Queue item must remain intact
    expect(await queueService.countPending()).toBe(1)

    // 3. Conflict marked resolved
    const state = await adapter.loadSyncConflicts()
    expect(state.conflicts[0].status).toBe('resolved')
    expect(state.conflicts[0].resolution).toBe('keep_local')

    // 4. Next manual push must map base_sync_version = 7
    let capturedChanges = null
    const mockTransport = vi.fn().mockImplementation(async ({ body }) => {
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
      transport: mockTransport,
    })

    const pushRes = await pushService.pushNow({ context: makeValidCloudContext() })
    expect(pushRes.ok).toBe(true)
    expect(capturedChanges.products).toHaveLength(1)
    expect(capturedChanges.products[0].base_sync_version).toBe(7)
  })

  it('marks whole transaction conflicted when sale_items conflicts and keeps transaction intact', async () => {
    const q1 = await queueService.enqueueUpsert(SYNC_ENTITY_TYPES.TRANSACTION, 't-conflict', {
      id: 't-conflict',
      invoiceNumber: 'INV-TRX-CONF',
      subtotal: 30000,
      tax: 0,
      total: 30000,
      createdAt: '2026-08-26T10:00:00.000Z',
      items: [
        { id: 'p-item-1', name: 'Item 1', price: 15000, qty: 1 },
        { id: 'p-item-2', name: 'Item 2', price: 15000, qty: 1 },
      ],
    })

    const itemSyncId = await registry.resolveSyncId('sale_item', 't-conflict:0:p-item-1')

    const mockTransport = vi.fn().mockResolvedValue({
      ok: false,
      status: 409,
      data: {
        code: 'SYNC_CONFLICT',
        conflicts: [
          {
            entity: 'sale_items',
            sync_id: itemSyncId,
            server_sync_version: 4,
          },
        ],
      },
    })

    const pushService = createSyncPushService({
      adapter,
      queueService,
      registry,
      tokenFetcher: async () => 'test-token',
      transport: mockTransport,
    })

    const pushResult = await pushService.pushNow({ context: makeValidCloudContext() })

    expect(pushResult.ok).toBe(false)
    expect(pushResult.code).toBe('SYNC_CONFLICT')

    const state = await adapter.loadSyncConflicts()
    expect(state.conflicts).toHaveLength(1)
    expect(state.conflicts[0].entityType).toBe(SYNC_ENTITY_TYPES.TRANSACTION)
    expect(state.conflicts[0].entityId).toBe('t-conflict')
    expect(state.conflicts[0].queueId).toBe(q1.entry.id)

    // Entire transaction remains in queue
    expect(await queueService.countPending()).toBe(1)
  })

  it('supports partial resolution: resolving 1 conflict unblocks only that entry while others remain blocked', async () => {
    const q1 = await queueService.enqueueUpsert(SYNC_ENTITY_TYPES.PRODUCT, 'p-res-1', {
      id: 'p-res-1',
      name: 'Product 1',
      category: 'Minuman',
      price: 10000,
    })
    const q2 = await queueService.enqueueUpsert(SYNC_ENTITY_TYPES.PRODUCT, 'p-res-2', {
      id: 'p-res-2',
      name: 'Product 2',
      category: 'Minuman',
      price: 20000,
    })

    const syncId1 = await registry.resolveSyncId(SYNC_ENTITY_TYPES.PRODUCT, 'p-res-1')
    const syncId2 = await registry.resolveSyncId(SYNC_ENTITY_TYPES.PRODUCT, 'p-res-2')

    await adapter.saveSyncConflicts({
      version: 1,
      conflicts: [
        {
          id: 'conf-1',
          requestId: 'req-1',
          queueId: q1.entry.id,
          entityType: SYNC_ENTITY_TYPES.PRODUCT,
          entityId: 'p-res-1',
          serverEntity: 'products',
          syncId: syncId1,
          serverSyncVersion: 2,
          queueSnapshot: q1.entry,
          status: 'open',
          createdAt: new Date().toISOString(),
        },
        {
          id: 'conf-2',
          requestId: 'req-1',
          queueId: q2.entry.id,
          entityType: SYNC_ENTITY_TYPES.PRODUCT,
          entityId: 'p-res-2',
          serverEntity: 'products',
          syncId: syncId2,
          serverSyncVersion: 3,
          queueSnapshot: q2.entry,
          status: 'open',
          createdAt: new Date().toISOString(),
        },
      ],
    })

    // Resolve only conflict 1 via keepLocal
    await conflictService.keepLocal('conf-1')

    let capturedChanges = null
    const mockTransport = vi.fn().mockImplementation(async ({ body }) => {
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
      transport: mockTransport,
    })

    const result = await pushService.pushNow({ context: makeValidCloudContext() })

    expect(result.ok).toBe(true)
    // Product 1 was unblocked and pushed!
    expect(capturedChanges.products).toHaveLength(1)
    expect(capturedChanges.products[0].name).toBe('Product 1')
    // Product 2 remains in queue due to open conflict 2
    expect(result.remaining).toBe(1)
  })

  it('handles malformed 409 response as INVALID_SYNC_CONFLICT_RESPONSE without touching queue or envelope', async () => {
    await queueService.enqueueUpsert(SYNC_ENTITY_TYPES.PRODUCT, 'p-malformed', {
      id: 'p-malformed',
      name: 'Product Malformed',
      price: 10000,
    })

    const mockTransport = vi.fn().mockResolvedValue({
      ok: false,
      status: 409,
      data: {
        code: 'SYNC_CONFLICT',
        conflicts: [], // Empty conflicts array
      },
    })

    const pushService = createSyncPushService({
      adapter,
      queueService,
      registry,
      tokenFetcher: async () => 'test-token',
      transport: mockTransport,
    })

    const result = await pushService.pushNow({ context: makeValidCloudContext() })

    expect(result.ok).toBe(false)
    expect(result.code).toBe('INVALID_SYNC_CONFLICT_RESPONSE')
    expect(await queueService.countPending()).toBe(1)
    expect(await adapter.loadSyncPushInflight()).not.toBeNull() // Envelope preserved
  })
})

describe('P15: UI Integration in CloudLoginView', () => {
  let pinia
  let adapter

  beforeEach(async () => {
    pinia = createPinia()
    setActivePinia(pinia)
    adapter = createMemoryAdapter()
    await adapter.initialize()
  })

  it('renders "Konflik Sinkronisasi" section when open conflicts exist and handles resolution clicks', async () => {
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

    await adapter.saveSyncConflicts({
      version: 1,
      conflicts: [
        {
          id: 'conf-ui-1',
          requestId: 'req-ui',
          queueId: 'q-1',
          entityType: 'product',
          entityId: 'p-ui-1',
          serverEntity: 'products',
          syncId: 'uuid-p1',
          serverSyncVersion: 5,
          queueSnapshot: { id: 'q-1', entityType: 'product', entityId: 'p-ui-1', operation: 'upsert' },
          status: 'open',
          createdAt: new Date().toISOString(),
        },
      ],
    })

    const syncConflictStore = useSyncConflictStore(pinia)
    const mockConflictService = {
      listConflicts: vi.fn().mockResolvedValue({
        version: 1,
        conflicts: [
          {
            id: 'conf-ui-1',
            entityType: 'product',
            entityId: 'p-ui-1',
            serverEntity: 'products',
            serverSyncVersion: 5,
            status: 'open',
          },
        ],
      }),
      useServer: vi.fn().mockResolvedValue({
        ok: true,
        code: 'SYNC_CONFLICT_RESOLVED',
        message: 'Konflik selesai. Gunakan Tarik Data Cloud untuk mengambil versi server.',
      }),
      keepLocal: vi.fn().mockResolvedValue({
        ok: true,
        code: 'SYNC_CONFLICT_RESOLVED',
        message: 'Konflik selesai. Gunakan Sync Sekarang untuk mengirim ulang data lokal.',
      }),
    }

    syncConflictStore.init({ conflictService: mockConflictService, adapter })
    await syncConflictStore.loadConflicts()

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

    const conflictSection = wrapper.find('#cloud-conflict-section')
    expect(conflictSection.exists()).toBe(true)
    expect(conflictSection.text()).toContain('Konflik Sinkronisasi')
    expect(conflictSection.text()).toContain('p-ui-1')

    // Click "Gunakan Cloud"
    const useServerBtn = wrapper.find('#use-server-btn-conf-ui-1')
    expect(useServerBtn.exists()).toBe(true)
    await useServerBtn.trigger('click')
    await flushPromises()

    expect(mockConflictService.useServer).toHaveBeenCalledWith('conf-ui-1')
    expect(wrapper.text()).toContain('Gunakan Tarik Data Cloud untuk mengambil data server.')
  })

  it('immediately updates conflict section in UI when handleSyncNow receives 409 SYNC_CONFLICT without page refresh', async () => {
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

    const syncPushStore = useSyncPushStore(pinia)
    const syncConflictStore = useSyncConflictStore(pinia)

    syncPushStore.pushNow = vi.fn().mockImplementation(async () => {
      // Simulate push saving conflict to adapter and returning 409
      await adapter.saveSyncConflicts({
        version: 1,
        conflicts: [
          {
            id: 'conf-live-409',
            requestId: 'req-409',
            queueId: 'q-live',
            entityType: 'product',
            entityId: 'p-live',
            serverEntity: 'products',
            syncId: 'uuid-live',
            serverSyncVersion: 2,
            status: 'open',
            createdAt: new Date().toISOString(),
          },
        ],
      })
      return {
        ok: false,
        code: 'SYNC_CONFLICT',
        message: 'Sync data conflict detected on server.',
        error: { code: 'SYNC_CONFLICT' },
      }
    })

    syncConflictStore.init({ adapter })

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
    expect(wrapper.find('#cloud-conflict-section').exists()).toBe(false)

    // Trigger Sync Sekarang
    const syncBtn = wrapper.find('#sync-now-btn')
    expect(syncBtn.exists()).toBe(true)
    await syncBtn.trigger('click')
    await flushPromises()

    // Conflict section must now appear immediately!
    const conflictSection = wrapper.find('#cloud-conflict-section')
    expect(conflictSection.exists()).toBe(true)
    expect(conflictSection.text()).toContain('p-live')
  })
})

describe('P15: Regression — P13 Compatibility, Async Registry Mapping, & Fail-Safe CAS', () => {
  let adapter
  let queueService
  let registry
  let conflictService

  beforeEach(async () => {
    adapter = createMemoryAdapter()
    await adapter.initialize()
    await adapter.saveSyncPushBinding({
      businessId: 10,
      boundAt: new Date().toISOString(),
    })
    queueService = createSyncQueueService({ adapter })
    registry = createSyncIdentityRegistry({ adapter })
    conflictService = createSyncConflictService({ adapter, queueService, registry })
  })

  it('maps base_sync_version from flat P13 sync_server_versions_v1 metadata', async () => {
    await queueService.enqueueUpsert(SYNC_ENTITY_TYPES.PRODUCT, 'p-p13', {
      id: 'p-p13',
      name: 'P13 Product',
      category: 'Minuman',
      price: 15000,
    })
    const prodSyncId = await registry.resolveSyncId(SYNC_ENTITY_TYPES.PRODUCT, 'p-p13')

    // Save version in flat P13 format
    await adapter.saveSyncServerVersions({
      [`products:${prodSyncId}`]: { syncVersion: 12, syncSequence: 100 },
    })

    let capturedChanges = null
    const mockTransport = vi.fn().mockImplementation(async ({ body }) => {
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
      transport: mockTransport,
    })

    const res = await pushService.pushNow({ context: makeValidCloudContext() })
    expect(res.ok).toBe(true)
    expect(capturedChanges.products[0].base_sync_version).toBe(12)
  })

  it('correctly maps 409 conflict to the specific legacy product in a multi-item batch without grabbing first entity', async () => {
    // Legacy product A (local ID 'p-legacy-a')
    await queueService.enqueueUpsert(SYNC_ENTITY_TYPES.PRODUCT, 'p-legacy-a', {
      id: 'p-legacy-a',
      name: 'Legacy Product A',
      category: 'Minuman',
      price: 10000,
    })
    // Legacy product B (local ID 'p-legacy-b')
    const qB = await queueService.enqueueUpsert(SYNC_ENTITY_TYPES.PRODUCT, 'p-legacy-b', {
      id: 'p-legacy-b',
      name: 'Legacy Product B',
      category: 'Minuman',
      price: 20000,
    })

    const uuidA = await registry.resolveSyncId(SYNC_ENTITY_TYPES.PRODUCT, 'p-legacy-a')
    const uuidB = await registry.resolveSyncId(SYNC_ENTITY_TYPES.PRODUCT, 'p-legacy-b')

    // Server returns conflict specifically for Product B
    const mockTransport = vi.fn().mockResolvedValue({
      ok: false,
      status: 409,
      data: {
        code: 'SYNC_CONFLICT',
        conflicts: [
          {
            entity: 'products',
            sync_id: uuidB,
            server_sync_version: 3,
          },
        ],
      },
    })

    const pushService = createSyncPushService({
      adapter,
      queueService,
      registry,
      tokenFetcher: async () => 'test-token',
      transport: mockTransport,
    })

    const res = await pushService.pushNow({ context: makeValidCloudContext() })
    expect(res.ok).toBe(false)
    expect(res.code).toBe('SYNC_CONFLICT')

    const savedConflicts = await adapter.loadSyncConflicts()
    expect(savedConflicts.conflicts).toHaveLength(1)
    // Must be mapped to Product B, NOT Product A!
    expect(savedConflicts.conflicts[0].entityId).toBe('p-legacy-b')
    expect(savedConflicts.conflicts[0].queueId).toBe(qB.entry.id)
    expect(savedConflicts.conflicts[0].syncId).toBe(uuidB)
  })

  it('safely rolls back and restores queue item if adapter.resolveSyncConflictUseServerAtomic fails during useServer', async () => {
    const q1 = await queueService.enqueueUpsert(SYNC_ENTITY_TYPES.PRODUCT, 'p-atomic', {
      id: 'p-atomic',
      name: 'Atomic Product',
      price: 10000,
    })

    const conflictRecord = {
      id: 'conf-atomic',
      requestId: 'req-atomic',
      queueId: q1.entry.id,
      entityType: SYNC_ENTITY_TYPES.PRODUCT,
      entityId: 'p-atomic',
      serverEntity: 'products',
      syncId: 'uuid-atomic',
      serverSyncVersion: 2,
      queueSnapshot: q1.entry,
      status: 'open',
      createdAt: new Date().toISOString(),
    }

    await adapter.saveSyncConflicts({
      version: 1,
      conflicts: [conflictRecord],
    })

    // Force adapter atomic method to reject
    vi.spyOn(adapter, 'resolveSyncConflictUseServerAtomic').mockRejectedValueOnce(
      new Error('SQLite disk I/O error'),
    )

    const res = await conflictService.useServer('conf-atomic')

    expect(res.ok).toBe(false)
    expect(res.code).toBe('SYNC_CONFLICT_PERSIST_FAILED')

    // Local queue item MUST remain intact!
    expect(await queueService.countPending()).toBe(1)
    const pending = await queueService.listPending()
    expect(pending[0].payload.name).toBe('Atomic Product')

    // Conflict must remain open
    const saved = await adapter.loadSyncConflicts()
    expect(saved.conflicts[0].status).toBe('open')
  })

  it('fails useServer with SYNC_CONFLICT_QUEUE_MISSING when conflict is open but queue row no longer exists', async () => {
    const conflictRecord = {
      id: 'conf-missing-q',
      requestId: 'req-missing',
      queueId: 'q-vanished',
      entityType: SYNC_ENTITY_TYPES.PRODUCT,
      entityId: 'p-vanished',
      serverEntity: 'products',
      syncId: 'uuid-vanished',
      serverSyncVersion: 2,
      queueSnapshot: {
        id: 'q-vanished',
        entityType: 'product',
        entityId: 'p-vanished',
        operation: 'upsert',
        updatedAt: '2026-08-27T00:00:00Z',
        payload: { name: 'Ghost' },
      },
      status: 'open',
      createdAt: new Date().toISOString(),
    }

    await adapter.saveSyncConflicts({
      version: 1,
      conflicts: [conflictRecord],
    })

    const res = await conflictService.useServer('conf-missing-q')

    expect(res.ok).toBe(false)
    expect(res.code).toBe('SYNC_CONFLICT_QUEUE_MISSING')

    // Conflict must remain open
    const saved = await adapter.loadSyncConflicts()
    expect(saved.conflicts[0].status).toBe('open')
  })
})

describe('P15: SQLite Adapter resolveSyncConflictUseServerAtomic', () => {
  it('executes in single transaction: deletes queue row and saves updated conflicts', async () => {
    const sqliteAdapter = createSQLiteAdapter()

    const queueSnapshot = {
      id: 'q-sql-1',
      entityType: 'product',
      entityId: 'p-1',
      operation: 'upsert',
      updatedAt: '2026-08-27T00:00:00Z',
      payload: { name: 'Kopi' },
    }

    const nextConflictsState = {
      version: 1,
      conflicts: [
        {
          id: 'conf-1',
          status: 'resolved',
          resolution: 'use_server',
          resolvedAt: '2026-08-27T00:00:00Z',
        },
      ],
    }

    // Mock db.query to return matching row
    fakeDb.query.mockResolvedValueOnce({
      values: [
        {
          id: 'q-sql-1',
          updated_at: '2026-08-27T00:00:00Z',
          operation: 'upsert',
          payload: JSON.stringify({ name: 'Kopi' }),
        },
      ],
    })

    const result = await sqliteAdapter.resolveSyncConflictUseServerAtomic({
      queueSnapshot,
      conflictsState: nextConflictsState,
    })

    expect(result.ok).toBe(true)
    expect(result.code).toBe('SYNC_CONFLICT_RESOLVED')
    expect(fakeDb.beginTransaction).toHaveBeenCalled()
    expect(fakeDb.commitTransaction).toHaveBeenCalled()
    expect(fakeDb.run).toHaveBeenCalledWith(
      expect.stringContaining('DELETE FROM sync_queue'),
      expect.any(Array),
      false,
    )
    expect(fakeDb.run).toHaveBeenCalledWith(
      expect.stringContaining('INSERT OR REPLACE INTO app_meta'),
      ['sync_conflicts_v1', JSON.stringify(nextConflictsState)],
      false,
    )
  })

  it('rolls back whole transaction when app_meta write fails inside transaction', async () => {
    const sqliteAdapter = createSQLiteAdapter()

    const queueSnapshot = {
      id: 'q-sql-fail',
      entityType: 'product',
      entityId: 'p-1',
      operation: 'upsert',
      updatedAt: '2026-08-27T00:00:00Z',
      payload: { name: 'Kopi' },
    }

    const nextConflictsState = {
      version: 1,
      conflicts: [
        {
          id: 'conf-sql-fail',
          status: 'resolved',
          resolution: 'use_server',
          resolvedAt: '2026-08-27T00:00:00Z',
        },
      ],
    }

    fakeDb.query.mockResolvedValueOnce({
      values: [
        {
          id: 'q-sql-fail',
          updated_at: '2026-08-27T00:00:00Z',
          operation: 'upsert',
          payload: JSON.stringify({ name: 'Kopi' }),
        },
      ],
    })

    // Fail during INSERT OR REPLACE INTO app_meta
    fakeDb.run.mockImplementation(async (sql) => {
      if (sql.includes('INSERT OR REPLACE INTO app_meta')) {
        throw new Error('SQLite disk full')
      }
      return { changes: { changes: 1 } }
    })

    await expect(
      sqliteAdapter.resolveSyncConflictUseServerAtomic({
        queueSnapshot,
        conflictsState: nextConflictsState,
      }),
    ).rejects.toThrow('SQLite disk full')

    expect(fakeDb.rollbackTransaction).toHaveBeenCalled()
  })
})

describe('P15: Strict 409 Conflict Detection & Exact Mapping', () => {
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

  it('handles HTTP 409 with SYNC_DATA_CONFLICT via generic P12 failure handling without creating durable conflicts', async () => {
    await queueService.enqueueUpsert(SYNC_ENTITY_TYPES.PRODUCT, 'p-data-conflict', {
      id: 'p-data-conflict',
      name: 'Item Data Conflict',
      price: 10000,
    })

    const mockTransport = vi.fn().mockResolvedValue({
      ok: false,
      status: 409,
      data: {
        code: 'SYNC_DATA_CONFLICT',
        message: 'Business data validation conflict',
      },
    })

    const pushService = createSyncPushService({
      adapter,
      queueService,
      registry,
      tokenFetcher: async () => 'test-token',
      transport: mockTransport,
    })

    const result = await pushService.pushNow({ context: makeValidCloudContext() })

    expect(result.ok).toBe(false)
    expect(result.code).toBe('SYNC_DATA_CONFLICT')
    expect(result.code).not.toBe('SYNC_CONFLICT')
    expect(result.code).not.toBe('INVALID_SYNC_CONFLICT_RESPONSE')

    // No durable sync conflicts created
    const savedConflicts = await adapter.loadSyncConflicts()
    expect(savedConflicts).toBeNull()

    // Inflight envelope is retained for retry
    expect(await adapter.loadSyncPushInflight()).not.toBeNull()

    // Queue item is preserved and marked failed
    expect(await queueService.countPending()).toBe(1)
    const pending = await queueService.listPending()
    expect(pending[0].attemptCount).toBe(1)
  })

  it('handles generic HTTP 409 without SYNC_CONFLICT code via generic failure handling', async () => {
    await queueService.enqueueUpsert(SYNC_ENTITY_TYPES.PRODUCT, 'p-generic-409', {
      id: 'p-generic-409',
      name: 'Product 409',
      price: 5000,
    })

    const mockTransport = vi.fn().mockResolvedValue({
      ok: false,
      status: 409,
      data: {
        error: 'Generic 409 Conflict',
      },
    })

    const pushService = createSyncPushService({
      adapter,
      queueService,
      registry,
      tokenFetcher: async () => 'test-token',
      transport: mockTransport,
    })

    const result = await pushService.pushNow({ context: makeValidCloudContext() })

    expect(result.ok).toBe(false)
    expect(result.code).not.toBe('SYNC_CONFLICT')
    expect(await adapter.loadSyncConflicts()).toBeNull()
    expect(await adapter.loadSyncPushInflight()).not.toBeNull()
  })

  it('fails closed with SYNC_CONFLICT_MAPPING_FAILED when product conflict UUID cannot be mapped to envelope queue snapshot', async () => {
    const q1 = await queueService.enqueueUpsert(SYNC_ENTITY_TYPES.PRODUCT, 'p-real', {
      id: 'p-real',
      name: 'Real Product',
      price: 15000,
    })

    const mockTransport = vi.fn().mockResolvedValue({
      ok: false,
      status: 409,
      data: {
        code: 'SYNC_CONFLICT',
        conflicts: [
          {
            entity: 'products',
            sync_id: 'unknown-uuid-never-in-envelope',
            server_sync_version: 5,
          },
        ],
      },
    })

    const pushService = createSyncPushService({
      adapter,
      queueService,
      registry,
      tokenFetcher: async () => 'test-token',
      transport: mockTransport,
    })

    const result = await pushService.pushNow({ context: makeValidCloudContext() })

    expect(result.ok).toBe(false)
    expect(result.code).toBe('SYNC_CONFLICT_MAPPING_FAILED')

    // No durable conflicts saved
    expect(await adapter.loadSyncConflicts()).toBeNull()

    // Inflight envelope retained
    expect(await adapter.loadSyncPushInflight()).not.toBeNull()

    // Queue item untouched
    expect(await queueService.countPending()).toBe(1)
  })

  it('fails closed (all-or-nothing) with SYNC_CONFLICT_MAPPING_FAILED when multiple conflicts have partial mapping failure', async () => {
    const q1 = await queueService.enqueueUpsert(SYNC_ENTITY_TYPES.PRODUCT, 'p-mapped', {
      id: 'p-mapped',
      name: 'Mapped Product',
      price: 10000,
    })
    const mappedUuid = await registry.resolveSyncId(SYNC_ENTITY_TYPES.PRODUCT, 'p-mapped')

    const mockTransport = vi.fn().mockResolvedValue({
      ok: false,
      status: 409,
      data: {
        code: 'SYNC_CONFLICT',
        conflicts: [
          {
            entity: 'products',
            sync_id: mappedUuid, // Resolves to p-mapped
            server_sync_version: 2,
          },
          {
            entity: 'products',
            sync_id: 'unknown-unmapped-uuid', // Fails mapping
            server_sync_version: 3,
          },
        ],
      },
    })

    const pushService = createSyncPushService({
      adapter,
      queueService,
      registry,
      tokenFetcher: async () => 'test-token',
      transport: mockTransport,
    })

    const result = await pushService.pushNow({ context: makeValidCloudContext() })

    expect(result.ok).toBe(false)
    expect(result.code).toBe('SYNC_CONFLICT_MAPPING_FAILED')

    // Neither conflict should be persisted (all or nothing)
    expect(await adapter.loadSyncConflicts()).toBeNull()

    // Inflight envelope retained
    expect(await adapter.loadSyncPushInflight()).not.toBeNull()
  })

  it('keeps queue byte-for-byte unchanged when server returns malformed 409 SYNC_CONFLICT', async () => {
    const q1 = await queueService.enqueueUpsert(SYNC_ENTITY_TYPES.PRODUCT, 'p-malformed', {
      id: 'p-malformed',
      name: 'Malformed Item',
      price: 20000,
    })

    const queueBefore = (await queueService.listPending())[0]

    const mockTransport = vi.fn().mockResolvedValue({
      ok: false,
      status: 409,
      data: {
        code: 'SYNC_CONFLICT',
        conflicts: [], // Invalid empty conflicts
      },
    })

    const pushService = createSyncPushService({
      adapter,
      queueService,
      registry,
      tokenFetcher: async () => 'test-token',
      transport: mockTransport,
    })

    const result = await pushService.pushNow({ context: makeValidCloudContext() })

    expect(result.ok).toBe(false)
    expect(result.code).toBe('INVALID_SYNC_CONFLICT_RESPONSE')

    const queueAfter = (await queueService.listPending())[0]
    expect(queueAfter).toEqual(queueBefore)
    expect(queueAfter.attemptCount).toBe(0)
    expect(queueAfter.lastError).toBeNull()
  })

  it('keeps queue byte-for-byte unchanged when server conflict fails mapping', async () => {
    const q1 = await queueService.enqueueUpsert(SYNC_ENTITY_TYPES.PRODUCT, 'p-unmapped-exact', {
      id: 'p-unmapped-exact',
      name: 'Unmapped Item',
      price: 30000,
    })

    const queueBefore = (await queueService.listPending())[0]

    const mockTransport = vi.fn().mockResolvedValue({
      ok: false,
      status: 409,
      data: {
        code: 'SYNC_CONFLICT',
        conflicts: [
          {
            entity: 'products',
            sync_id: 'unknown-uuid-xyz',
            server_sync_version: 1,
          },
        ],
      },
    })

    const pushService = createSyncPushService({
      adapter,
      queueService,
      registry,
      tokenFetcher: async () => 'test-token',
      transport: mockTransport,
    })

    const result = await pushService.pushNow({ context: makeValidCloudContext() })

    expect(result.ok).toBe(false)
    expect(result.code).toBe('SYNC_CONFLICT_MAPPING_FAILED')

    const queueAfter = (await queueService.listPending())[0]
    expect(queueAfter).toEqual(queueBefore)
    expect(queueAfter.attemptCount).toBe(0)
    expect(queueAfter.lastError).toBeNull()
  })

  it('does not mutate sync identity map during failed conflict mapping (side-effect free)', async () => {
    await queueService.enqueueUpsert(SYNC_ENTITY_TYPES.PRODUCT, 'p-side-effect', {
      id: 'p-side-effect',
      name: 'Side Effect Test',
      price: 5000,
    })
    // Pre-resolve product so initial outbox mapping is already durable
    await registry.resolveSyncId(SYNC_ENTITY_TYPES.PRODUCT, 'p-side-effect')

    // Establish baseline identity map
    const initialMap = (await adapter.loadSyncIdentityMap()) || {}

    const mockTransport = vi.fn().mockResolvedValue({
      ok: false,
      status: 409,
      data: {
        code: 'SYNC_CONFLICT',
        conflicts: [
          {
            entity: 'products',
            sync_id: 'unknown-ghost-uuid',
            server_sync_version: 1,
          },
        ],
      },
    })

    const pushService = createSyncPushService({
      adapter,
      queueService,
      registry,
      tokenFetcher: async () => 'test-token',
      transport: mockTransport,
    })

    const result = await pushService.pushNow({ context: makeValidCloudContext() })

    expect(result.ok).toBe(false)
    expect(result.code).toBe('SYNC_CONFLICT_MAPPING_FAILED')

    const finalMap = (await adapter.loadSyncIdentityMap()) || {}
    expect(finalMap).toEqual(initialMap)
    expect(Object.keys(finalMap)).not.toContain('products:unknown-ghost-uuid')
  })
})

describe('P15: Stale Conflicted Envelope Defense & Atomic Inflight Clear', () => {
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

  it('blocks push and prevents HTTP request if existing in-flight envelope has open conflicts', async () => {
    const q1 = await queueService.enqueueUpsert(SYNC_ENTITY_TYPES.PRODUCT, 'p-stale', {
      id: 'p-stale',
      name: 'Stale Product',
      price: 10000,
    })

    await adapter.saveSyncPushInflight({
      version: 1,
      requestId: 'req-stale-1',
      businessId: 10,
      outletId: 101,
      deviceIdentifier: '123e4567-e89b-12d3-a456-426614174000',
      registeredDeviceId: 55,
      createdAt: new Date().toISOString(),
      queueSnapshots: [q1.entry],
      changes: { products: [{ sync_id: 'prod-uuid-stale', name: 'Stale Product' }] },
    })

    await adapter.saveSyncConflicts({
      version: 1,
      conflicts: [
        {
          id: 'conf-stale-1',
          requestId: 'req-stale-1',
          queueId: q1.entry.id,
          entityType: 'product',
          entityId: 'p-stale',
          serverEntity: 'products',
          syncId: 'prod-uuid-stale',
          serverSyncVersion: 2,
          queueSnapshot: q1.entry,
          status: 'open',
          createdAt: new Date().toISOString(),
        },
      ],
    })

    const mockTransport = vi.fn()

    const pushService = createSyncPushService({
      adapter,
      queueService,
      registry,
      tokenFetcher: async () => 'test-token',
      transport: mockTransport,
    })

    const result = await pushService.pushNow({ context: makeValidCloudContext() })

    expect(result.ok).toBe(false)
    expect(result.code).toBe('SYNC_CONFLICT_PENDING')
    expect(mockTransport).not.toHaveBeenCalled()
  })

  it('safely clears stale envelope if all its conflicts are resolved and requires user to sync again with fresh requestId', async () => {
    const q1 = await queueService.enqueueUpsert(SYNC_ENTITY_TYPES.PRODUCT, 'p-stale-resolved', {
      id: 'p-stale-resolved',
      name: 'Resolved Product',
      price: 10000,
    })

    await adapter.saveSyncPushInflight({
      version: 1,
      requestId: 'req-stale-resolved',
      businessId: 10,
      outletId: 101,
      deviceIdentifier: '123e4567-e89b-12d3-a456-426614174000',
      registeredDeviceId: 55,
      createdAt: new Date().toISOString(),
      queueSnapshots: [q1.entry],
      changes: { products: [{ sync_id: 'prod-uuid-stale-res', name: 'Resolved Product' }] },
    })

    await adapter.saveSyncConflicts({
      version: 1,
      conflicts: [
        {
          id: 'conf-stale-res',
          requestId: 'req-stale-resolved',
          queueId: q1.entry.id,
          entityType: 'product',
          entityId: 'p-stale-resolved',
          serverEntity: 'products',
          syncId: 'prod-uuid-stale-res',
          serverSyncVersion: 2,
          queueSnapshot: q1.entry,
          status: 'resolved',
          resolution: 'use_server',
          resolvedAt: new Date().toISOString(),
        },
      ],
    })

    const mockTransport = vi.fn()

    const pushService = createSyncPushService({
      adapter,
      queueService,
      registry,
      tokenFetcher: async () => 'test-token',
      transport: mockTransport,
    })

    const result = await pushService.pushNow({ context: makeValidCloudContext() })

    expect(result.ok).toBe(false)
    expect(result.code).toBe('SYNC_STALE_CONFLICT_ENVELOPE_CLEARED')
    expect(mockTransport).not.toHaveBeenCalled()
    expect(await adapter.loadSyncPushInflight()).toBeNull()
  })
})

describe('P15: Group useServer Resolution for Same Queue ID', () => {
  let adapter
  let queueService
  let registry
  let conflictService

  beforeEach(async () => {
    adapter = createMemoryAdapter()
    await adapter.initialize()
    await adapter.saveSyncPushBinding({
      businessId: 10,
      boundAt: new Date().toISOString(),
    })
    queueService = createSyncQueueService({ adapter })
    registry = createSyncIdentityRegistry({ adapter })
    conflictService = createSyncConflictService({ adapter, queueService, registry })
  })

  it('resolves all open conflicts that point to the same Transaction queue entry when useServer is called', async () => {
    // 1. Transaction queue item QT1
    const qTrx = await queueService.enqueueUpsert(SYNC_ENTITY_TYPES.TRANSACTION, 'trx-1', {
      id: 'trx-1',
      invoiceNumber: 'INV-001',
      total: 50000,
      items: [{ id: 'p-1', name: 'Item', price: 50000, qty: 1 }],
    })

    // 2. Another independent Product queue item QP2
    const qProd = await queueService.enqueueUpsert(SYNC_ENTITY_TYPES.PRODUCT, 'p-2', {
      id: 'p-2',
      name: 'Independent Product',
      price: 20000,
    })

    const conflicts = [
      {
        id: 'conf-sale-trx1',
        requestId: 'req-multi',
        queueId: qTrx.entry.id,
        entityType: 'transaction',
        entityId: 'trx-1',
        serverEntity: 'sales',
        syncId: 'sale-uuid-1',
        serverSyncVersion: 2,
        queueSnapshot: qTrx.entry,
        status: 'open',
        createdAt: new Date().toISOString(),
      },
      {
        id: 'conf-item-trx1',
        requestId: 'req-multi',
        queueId: qTrx.entry.id,
        entityType: 'transaction',
        entityId: 'trx-1',
        serverEntity: 'sale_items',
        syncId: 'item-uuid-1',
        serverSyncVersion: 3,
        queueSnapshot: qTrx.entry,
        status: 'open',
        createdAt: new Date().toISOString(),
      },
      {
        id: 'conf-prod2',
        requestId: 'req-multi',
        queueId: qProd.entry.id,
        entityType: 'product',
        entityId: 'p-2',
        serverEntity: 'products',
        syncId: 'prod-uuid-2',
        serverSyncVersion: 4,
        queueSnapshot: qProd.entry,
        status: 'open',
        createdAt: new Date().toISOString(),
      },
    ]

    await adapter.saveSyncConflicts({
      version: 1,
      conflicts,
    })

    // User clicks useServer on the sales conflict
    const res = await conflictService.useServer('conf-sale-trx1')

    expect(res.ok).toBe(true)
    expect(res.code).toBe('SYNC_CONFLICT_RESOLVED')

    // QT1 must be deleted from queue
    expect(await queueService.countPending()).toBe(1)
    const remainingPending = await queueService.listPending()
    expect(remainingPending[0].id).toBe(qProd.entry.id)

    // Verify durable conflicts
    const saved = await adapter.loadSyncConflicts()
    const salesConf = saved.conflicts.find((c) => c.id === 'conf-sale-trx1')
    const itemConf = saved.conflicts.find((c) => c.id === 'conf-item-trx1')
    const prodConf = saved.conflicts.find((c) => c.id === 'conf-prod2')

    // Both conflicts for QT1 must be resolved with same resolvedAt and resolution
    expect(salesConf.status).toBe('resolved')
    expect(salesConf.resolution).toBe('use_server')
    expect(itemConf.status).toBe('resolved')
    expect(itemConf.resolution).toBe('use_server')
    expect(salesConf.resolvedAt).toBe(itemConf.resolvedAt)

    // Conflict for QP2 must remain open!
    expect(prodConf.status).toBe('open')
  })

  it('keeps keepLocal per-conflict and keeps queue item blocked while any sibling conflict is open', async () => {
    const qTrx = await queueService.enqueueUpsert(SYNC_ENTITY_TYPES.TRANSACTION, 'trx-keep', {
      id: 'trx-keep',
      invoiceNumber: 'INV-KEEP',
      total: 30000,
      items: [{ id: 'p-1', name: 'Item', price: 30000, qty: 1 }],
    })

    const conflicts = [
      {
        id: 'conf-keep-sales',
        requestId: 'req-keep-sibling',
        queueId: qTrx.entry.id,
        entityType: 'transaction',
        entityId: 'trx-keep',
        serverEntity: 'sales',
        syncId: 'sale-uuid-keep',
        serverSyncVersion: 5,
        queueSnapshot: qTrx.entry,
        status: 'open',
        createdAt: new Date().toISOString(),
      },
      {
        id: 'conf-keep-item',
        requestId: 'req-keep-sibling',
        queueId: qTrx.entry.id,
        entityType: 'transaction',
        entityId: 'trx-keep',
        serverEntity: 'sale_items',
        syncId: 'item-uuid-keep',
        serverSyncVersion: 7,
        queueSnapshot: qTrx.entry,
        status: 'open',
        createdAt: new Date().toISOString(),
      },
    ]

    await adapter.saveSyncConflicts({
      version: 1,
      conflicts,
    })

    // Resolve ONLY the sales conflict with keepLocal
    const res = await conflictService.keepLocal('conf-keep-sales')
    expect(res.ok).toBe(true)

    const saved = await adapter.loadSyncConflicts()
    const salesConf = saved.conflicts.find((c) => c.id === 'conf-keep-sales')
    const itemConf = saved.conflicts.find((c) => c.id === 'conf-keep-item')

    expect(salesConf.status).toBe('resolved')
    expect(salesConf.resolution).toBe('keep_local')
    // Sibling sale_item conflict remains open!
    expect(itemConf.status).toBe('open')

    // Transaction queue item is still in queue and still blocked from push
    expect(await queueService.countPending()).toBe(1)

    const mockTransport = vi.fn()
    const pushService = createSyncPushService({
      adapter,
      queueService,
      registry,
      tokenFetcher: async () => 'test-token',
      transport: mockTransport,
    })

    const pushRes = await pushService.pushNow({ context: makeValidCloudContext() })
    expect(pushRes.ok).toBe(false)
    expect(pushRes.code).toBe('SYNC_CONFLICT_PENDING')
    expect(mockTransport).not.toHaveBeenCalled()
  })
})

