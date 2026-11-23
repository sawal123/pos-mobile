import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createMemoryAdapter } from '@/services/database/memoryAdapter'
import { createSyncPushService } from '@/services/sync/syncPushService'
import { createSyncReconciliationService } from '@/services/sync/syncReconciliationService'
import { createSyncQueueService } from '@/services/sync/syncQueueService'

function makeValidCloudContext(overrides = {}) {
  return {
    user: { id: 1, name: 'Owner User', email: 'owner@example.com' },
    selectedBusiness: { id: 10, name: 'Kedai Kopi' },
    selectedOutlet: { id: 101, name: 'Outlet Utama' },
    cloudAccess: true,
    deviceIdentifier: 'dev-123',
    registeredDeviceId: 55,
    role: 'owner',
    ...overrides,
  }
}

describe('Sync In-flight Recovery & Auto-Reconcile on Lag', () => {
  let adapter
  let queueService
  let reconService
  let pushService
  let mockTransport
  let mockStatusTransport

  beforeEach(async () => {
    adapter = createMemoryAdapter()
    await adapter.initialize()

    await adapter.saveSyncPushBinding({
      businessId: 10,
      boundAt: new Date().toISOString(),
    })

    queueService = createSyncQueueService({ adapter })

    mockTransport = vi.fn().mockImplementation(async ({ body }) => ({
      ok: true,
      status: 200,
      data: {
        data: {
          request_id: body?.request_id || 'req-id',
          duplicate: false,
        },
      },
    }))

    mockStatusTransport = vi.fn()

    reconService = createSyncReconciliationService({
      adapter,
      statusTransport: mockStatusTransport,
      queueService,
      tokenFetcher: async () => 'mock-token',
    })

    pushService = createSyncPushService({
      adapter,
      transport: mockTransport,
      queueService,
      tokenFetcher: async () => 'mock-token',
      reconciliationService: reconService,
    })
  })

  it('automatically reconciles and acknowledges when server already COMMITTED the lagging push', async () => {
    // Setup in-flight envelope stuck in unknown acceptance
    const stuckEnvelope = {
      envelopeId: 'env-lag-001',
      requestId: 'req-lag-001',
      businessId: 10,
      outletId: 101,
      deviceIdentifier: 'dev-123',
      registeredDeviceId: 55,
      acceptance: 'unknown',
      reconciliationRequired: true,
      status: 'inflight',
      items: [
        {
          id: 'q-item-1',
          entityType: 'sale',
          entityId: 'tx-1',
          operation: 'create',
          payload: { id: 'tx-1', total: 10000 },
          updatedAt: '2026-11-23T01:00:00Z',
        },
      ],
      queueSnapshots: [
        {
          id: 'q-item-1',
          entityType: 'sale',
          entityId: 'tx-1',
          operation: 'create',
          payload: { id: 'tx-1', total: 10000 },
          updatedAt: '2026-11-23T01:00:00Z',
        },
      ],
      changes: [
        {
          entity_type: 'sales',
          entity_id: 'tx-1',
          action: 'create',
          payload: { id: 'tx-1', total: 10000 },
        },
      ],
      createdAt: '2026-11-23T01:00:00Z',
    }

    await adapter.saveSyncPushInflight(stuckEnvelope)
    await adapter.upsertSyncQueueItem({
      id: 'q-item-1',
      entityType: 'sale',
      entityId: 'tx-1',
      operation: 'create',
      payload: { id: 'tx-1', total: 10000 },
      updatedAt: '2026-11-23T01:00:00Z',
    })

    // Server says it received and committed it
    mockStatusTransport.mockResolvedValueOnce({
      ok: true,
      status: 200,
      data: {
        status: 'committed',
        request_id: 'req-lag-001',
      },
    })

    // Cashier triggers push
    const res = await pushService.pushNow({ context: makeValidCloudContext() })

    expect(res.ok).toBe(true)
    expect(res.status).toBe('committed')

    // Inflight is cleared
    const inflightAfter = await adapter.loadSyncPushInflight()
    expect(inflightAfter).toBeNull()

    // Queue item is cleaned up
    const queueItems = await queueService.listPending()
    expect(queueItems).toHaveLength(0)

    // No duplicate network send occurred
    expect(mockTransport).not.toHaveBeenCalled()
  })

  it('automatically unblocks and safely resends envelope when server reports NOT_FOUND for the lagging push', async () => {
    // Setup in-flight envelope stuck in unknown acceptance
    const stuckEnvelope = {
      envelopeId: 'env-lag-002',
      requestId: 'req-lag-002',
      businessId: 10,
      outletId: 101,
      deviceIdentifier: 'dev-123',
      registeredDeviceId: 55,
      acceptance: 'unknown',
      reconciliationRequired: true,
      status: 'inflight',
      items: [
        {
          id: 'q-item-2',
          entityType: 'sale',
          entityId: 'tx-2',
          operation: 'create',
          payload: { id: 'tx-2', total: 25000 },
          updatedAt: '2026-11-23T01:05:00Z',
        },
      ],
      queueSnapshots: [
        {
          id: 'q-item-2',
          entityType: 'sale',
          entityId: 'tx-2',
          operation: 'create',
          payload: { id: 'tx-2', total: 25000 },
          updatedAt: '2026-11-23T01:05:00Z',
        },
      ],
      changes: [
        {
          entity_type: 'sales',
          entity_id: 'tx-2',
          action: 'create',
          payload: { id: 'tx-2', total: 25000 },
        },
      ],
      createdAt: '2026-11-23T01:05:00Z',
    }

    await adapter.saveSyncPushInflight(stuckEnvelope)
    await adapter.upsertSyncQueueItem({
      id: 'q-item-2',
      entityType: 'sale',
      entityId: 'tx-2',
      operation: 'create',
      payload: { id: 'tx-2', total: 25000 },
      updatedAt: '2026-11-23T01:05:00Z',
    })

    // Server says request was never received (lost due to network lag)
    mockStatusTransport.mockResolvedValueOnce({
      ok: true,
      status: 200,
      data: {
        status: 'not_found',
        request_id: 'req-lag-002',
      },
    })

    // Cashier triggers push
    const res = await pushService.pushNow({ context: makeValidCloudContext() })

    expect(res.ok).toBe(true)

    // Transport was called with the exact same requestId (idempotency guaranteed)
    expect(mockTransport).toHaveBeenCalledTimes(1)
    const callArgs = mockTransport.mock.calls[0][0]
    expect(callArgs.body.request_id).toBe('req-lag-002')

    // Inflight is cleared
    const inflightAfter = await adapter.loadSyncPushInflight()
    expect(inflightAfter).toBeNull()

    // Queue item is cleaned up
    const queueItems = await queueService.listPending()
    expect(queueItems).toHaveLength(0)
  })
})
