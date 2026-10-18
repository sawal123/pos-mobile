// src/__tests__/sync-push-only-initial-pull.spec.js
//
// PR #60 — Push-only workspace initial pull.
// A device that holds a valid push binding but no pull binding must be able to
// run its first pull without being forced through Cloud-first bootstrap/reset.

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryAdapter } from '../services/database/memoryAdapter'
import { createSyncQueueService } from '../services/sync/syncQueueService'
import { createSyncIdentityRegistry } from '../services/sync/syncIdentityRegistry'
import { createSyncPullService } from '../services/sync/syncPullService'
import { createSyncContextGuardService } from '../services/sync/syncContextGuardService'
import { SYNC_ENTITY_TYPES } from '../services/sync/syncConstants'
import { useBusinessStore } from '../stores/businessStore'

const DEVICE = '123e4567-e89b-12d3-a456-426614174000'
const CAT_ID = '11111111-1111-4111-8111-111111111111'
const PROD_ID = '22222222-2222-4222-8222-222222222222'

function ctx(overrides = {}) {
  return {
    user: { id: 1, name: 'Owner', email: 'o@example.com' },
    selectedBusiness: { id: 10, name: 'Kedai' },
    selectedOutlet: { id: 101, name: 'Outlet' },
    cloudAccess: true,
    deviceIdentifier: DEVICE,
    registeredDeviceId: 55,
    ...overrides,
  }
}

function serverTransport() {
  return vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    data: {
      data: {
        records: [
          {
            entity: 'categories',
            sync_sequence: 1,
            data: { sync_id: CAT_ID, sync_version: 1, name: 'Minuman', status: 'active' },
          },
          {
            entity: 'products',
            sync_sequence: 2,
            data: {
              sync_id: PROD_ID,
              sync_version: 1,
              category_sync_id: CAT_ID,
              name: 'Kopi Cloud',
              price: 15000,
              status: 'active',
            },
          },
        ],
        next_cursor: 2,
        server_sequence: 2,
        has_more: false,
      },
    },
  })
}

describe('PR #60: push-only workspace initial pull', () => {
  let pinia
  let adapter
  let queueService
  let registry
  let guard

  function makeService(transport) {
    return createSyncPullService({
      adapter,
      queueService,
      registry,
      pinia,
      tokenFetcher: async () => 'test-token',
      transport,
      contextGuardService: guard,
    })
  }

  beforeEach(async () => {
    pinia = createPinia()
    setActivePinia(pinia)
    useBusinessStore(pinia).mode = 'cloud'

    adapter = createMemoryAdapter()
    await adapter.initialize()
    await adapter.saveSyncPushBinding({ businessId: 10, boundAt: new Date().toISOString() })

    queueService = createSyncQueueService({ adapter })
    registry = createSyncIdentityRegistry({ adapter })
    guard = createSyncContextGuardService({ adapter })
  })

  it('classifies push-only as unbound with only the push_binding source', async () => {
    const res = await guard.inspect({ context: ctx() })
    expect(res.ok).toBe(true)
    expect(res.status).toBe('unbound')
    expect(res.sources).toEqual(['push_binding'])
  })

  it('pulls successfully, keeps the push binding and writes a complete pull binding', async () => {
    const pushBefore = await adapter.loadSyncPushBinding()
    const transport = serverTransport()

    const res = await makeService(transport).pullNow({ context: ctx() })

    expect(res.ok).toBe(true)
    expect(res.applied).toBe(2)
    expect(await adapter.loadSyncPushBinding()).toEqual(pushBefore)

    const pull = await adapter.loadSyncPullBinding()
    expect(pull).toMatchObject({
      businessId: 10,
      outletId: 101,
      deviceIdentifier: DEVICE,
      registeredDeviceId: 55,
      status: 'completed',
    })
    expect(typeof pull.boundAt).toBe('string')

    // No bootstrap, no dummy mutation, no reset.
    expect(await adapter.loadSyncBootstrapState()).toBeNull()
    expect(await queueService.countPending()).toBe(0)

    const after = await guard.inspect({ context: ctx() })
    expect(after.status).toBe('safe')
  })

  it('pull binding stays valid after restart (fresh services on same storage)', async () => {
    await makeService(serverTransport()).pullNow({ context: ctx() })

    const restartedGuard = createSyncContextGuardService({ adapter })
    const res = await restartedGuard.inspect({ context: ctx() })
    expect(res.ok).toBe(true)
    expect(res.status).toBe('safe')

    // A second, regular pull on the "restarted" service continues to work.
    const empty = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      data: { data: { records: [], next_cursor: 2, server_sequence: 2, has_more: false } },
    })
    const again = await makeService(empty).pullNow({ context: ctx() })
    expect(again.ok).toBe(true)
  })

  it('blocks push-only binding that belongs to a different business', async () => {
    await adapter.saveSyncPushBinding({ businessId: 99, boundAt: new Date().toISOString() })
    const transport = serverTransport()

    const res = await makeService(transport).pullNow({ context: ctx() })

    expect(res.ok).toBe(false)
    expect(['SYNC_CONTEXT_GUARD_BLOCKED', 'SYNC_BUSINESS_BINDING_MISMATCH']).toContain(res.code)
    expect(transport).not.toHaveBeenCalled()
    expect(await adapter.loadSyncPullBinding()).toBeNull()
    expect((await adapter.loadSyncPushBinding()).businessId).toBe(99)
  })

  it('fails closed on a corrupt push binding', async () => {
    await adapter.saveSyncPushBinding({ businessId: 'oops', boundAt: '' })
    const transport = serverTransport()

    const res = await makeService(transport).pullNow({ context: ctx() })

    expect(res.ok).toBe(false)
    expect(transport).not.toHaveBeenCalled()
    expect(await adapter.loadSyncPullBinding()).toBeNull()
  })

  it('does not overwrite conflicting pending local changes', async () => {
    await queueService.enqueueUpsert(SYNC_ENTITY_TYPES.PRODUCT, PROD_ID, {
      id: PROD_ID,
      name: 'Local Edit',
      price: 20000,
    })

    const res = await makeService(serverTransport()).pullNow({ context: ctx() })

    expect(res.ok).toBe(false)
    expect(res.code).toBe('LOCAL_PENDING_SYNC_CONFLICT')
    expect(await queueService.countPending()).toBe(1)
    expect(await adapter.loadSyncPullBinding()).toBeNull()
    expect(await adapter.loadSyncPullState()).toBeNull()
    expect((await adapter.loadSyncPushBinding()).businessId).toBe(10)
  })

  it('keeps non-conflicting pending outbox items untouched', async () => {
    await queueService.enqueueUpsert(
      SYNC_ENTITY_TYPES.PRODUCT,
      '33333333-3333-4333-8333-333333333333',
      { id: '33333333-3333-4333-8333-333333333333', name: 'Local Only', price: 1000 },
    )

    const res = await makeService(serverTransport()).pullNow({ context: ctx() })

    expect(res.ok).toBe(true)
    expect(await queueService.countPending()).toBe(1)
  })

  it('blocks while open sync conflicts exist', async () => {
    await adapter.saveSyncConflicts({
      version: 1,
      conflicts: [{ id: 'c1', status: 'open', entityType: 'product', entityId: 'x' }],
    })
    const transport = serverTransport()

    const res = await makeService(transport).pullNow({ context: ctx() })

    expect(res.ok).toBe(false)
    expect(res.code).toBe('SYNC_PUSH_ONLY_PULL_OPEN_CONFLICTS')
    expect(transport).not.toHaveBeenCalled()
    expect(await adapter.loadSyncPullBinding()).toBeNull()
  })

  it('blocks when persistence flush fails (journal/persistence recovery pending)', async () => {
    const scheduler = { flush: vi.fn().mockRejectedValue(new Error('pending')) }
    const transport = serverTransport()
    const service = createSyncPullService({
      adapter,
      queueService,
      registry,
      pinia,
      scheduler,
      tokenFetcher: async () => 'test-token',
      transport,
      contextGuardService: guard,
    })

    const res = await service.pullNow({ context: ctx() })

    expect(res.ok).toBe(false)
    expect(res.code).toBe('SYNC_PUSH_ONLY_PULL_PERSISTENCE_PENDING')
    expect(transport).not.toHaveBeenCalled()
  })
})
