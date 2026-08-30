import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { mount, flushPromises } from '@vue/test-utils'
import { createSyncHealthService } from '@/services/sync/syncHealthService'
import { useSyncHealthStore } from '@/stores/syncHealthStore'
import { useCloudSessionStore } from '@/stores/cloudSessionStore'
import { useSyncPushStore } from '@/stores/syncPushStore'
import { useSyncPullStore } from '@/stores/syncPullStore'
import { useSyncBootstrapStore } from '@/stores/syncBootstrapStore'
import { useSyncConflictStore } from '@/stores/syncConflictStore'
import { useSyncOrchestratorStore } from '@/stores/syncOrchestratorStore'
import { useSyncContextGuardStore } from '@/stores/syncContextGuardStore'
import CloudLoginView from '@/views/settings/CloudLoginView.vue'

describe('P17: Sync Health & Diagnostics Service', () => {
  let mockAdapter
  let mockQueueService
  let mockConflictService
  let healthService
  let validContext

  beforeEach(() => {
    validContext = {
      user: { id: 1, email: 'test@example.com' },
      selectedBusiness: { id: 10, name: 'Biz 10' },
      selectedOutlet: { id: 101, name: 'Outlet 1' },
      cloudAccess: true,
      deviceIdentifier: 'dev-uuid-123',
      registeredDeviceId: 77,
    }

    mockAdapter = {
      loadSyncPushBinding: vi.fn().mockResolvedValue({ businessId: 10 }),
      loadSyncPullBinding: vi.fn().mockResolvedValue({
        businessId: 10,
        outletId: 101,
        deviceIdentifier: 'dev-uuid-123',
        registeredDeviceId: 77,
      }),
      loadSyncPullState: vi.fn().mockResolvedValue({ version: 1, cursor: 120, serverSequence: 120 }),
      loadSyncPushInflight: vi.fn().mockResolvedValue(null),
      loadSyncBootstrapState: vi.fn().mockResolvedValue({
        version: 1,
        status: 'completed',
        businessId: 10,
        outletId: 101,
        deviceIdentifier: 'dev-uuid-123',
        registeredDeviceId: 77,
      }),
      loadSyncConflicts: vi.fn().mockResolvedValue({ version: 1, conflicts: [] }),
      countSyncQueueItems: vi.fn().mockResolvedValue(0),
      saveSyncPushBinding: vi.fn(),
      saveSyncPullBinding: vi.fn(),
      saveSyncPullState: vi.fn(),
      saveSyncPushInflight: vi.fn(),
      clearSyncPushInflight: vi.fn(),
      saveSyncBootstrapState: vi.fn(),
      saveSyncConflicts: vi.fn(),
    }

    mockQueueService = {
      countPending: vi.fn().mockResolvedValue(0),
      enqueueUpsert: vi.fn(),
      removeIfUnchanged: vi.fn(),
    }

    mockConflictService = {
      countOpenConflicts: vi.fn().mockResolvedValue(0),
      listOpenConflicts: vi.fn().mockResolvedValue([]),
    }

    healthService = createSyncHealthService({
      adapter: mockAdapter,
      queueService: mockQueueService,
      conflictService: mockConflictService,
    })
  })

  it('TEST — READY: returns SYNC_HEALTH_READY when all bindings match and no pending/conflicts/inflight', async () => {
    const result = await healthService.checkHealth({ context: validContext })

    expect(result.ok).toBe(true)
    expect(result.code).toBe('SYNC_HEALTH_READY')
    expect(result.status).toBe('ready')
    expect(result.issues).toEqual([])
    expect(result.summary).toEqual({
      pendingCount: 0,
      openConflictCount: 0,
      hasInflight: false,
      bootstrapStatus: 'completed',
      pullCursor: 120,
    })
  })

  it('TEST — REALISTIC READY AFTER BOOTSTRAP: returns READY when bootstrap is staged, pushBinding exists, and pendingCount is 0', async () => {
    mockAdapter.loadSyncBootstrapState.mockResolvedValue({
      version: 1,
      status: 'staged',
      businessId: 10,
      outletId: 101,
      deviceIdentifier: 'dev-uuid-123',
      registeredDeviceId: 77,
    })
    mockAdapter.loadSyncPushBinding.mockResolvedValue({ businessId: 10 })
    mockQueueService.countPending.mockResolvedValue(0)

    const result = await healthService.checkHealth({ context: validContext })

    expect(result.ok).toBe(true)
    expect(result.code).toBe('SYNC_HEALTH_READY')
    expect(result.status).toBe('ready')
    expect(result.summary.bootstrapStatus).toBe('staged')
    expect(result.issues).toEqual([])
  })

  it('TEST — STAGED BELUM PUSH: returns ATTENTION and SYNC_BOOTSTRAP_STAGED when staged, no pushBinding, pending > 0', async () => {
    mockAdapter.loadSyncBootstrapState.mockResolvedValue({
      version: 1,
      status: 'staged',
      businessId: 10,
      outletId: 101,
      deviceIdentifier: 'dev-uuid-123',
      registeredDeviceId: 77,
    })
    mockAdapter.loadSyncPushBinding.mockResolvedValue(null)
    mockQueueService.countPending.mockResolvedValue(5)

    const result = await healthService.checkHealth({ context: validContext })

    expect(result.ok).toBe(true)
    expect(result.code).toBe('SYNC_HEALTH_ATTENTION')
    expect(result.status).toBe('attention')
    expect(result.issues).toContainEqual(
      expect.objectContaining({
        code: 'SYNC_BOOTSTRAP_STAGED',
        severity: 'attention',
      }),
    )
    expect(result.issues).toContainEqual(
      expect.objectContaining({
        code: 'SYNC_PENDING_QUEUE',
        severity: 'attention',
      }),
    )
  })

  it('TEST — STAGED + PENDING MESKI BINDING SUDAH ADA: returns ATTENTION and SYNC_BOOTSTRAP_STAGED when staged with pendingCount > 0', async () => {
    mockAdapter.loadSyncBootstrapState.mockResolvedValue({
      version: 1,
      status: 'staged',
      businessId: 10,
      outletId: 101,
      deviceIdentifier: 'dev-uuid-123',
      registeredDeviceId: 77,
    })
    mockAdapter.loadSyncPushBinding.mockResolvedValue({ businessId: 10 })
    mockQueueService.countPending.mockResolvedValue(2)

    const result = await healthService.checkHealth({ context: validContext })

    expect(result.ok).toBe(true)
    expect(result.code).toBe('SYNC_HEALTH_ATTENTION')
    expect(result.status).toBe('attention')
    expect(result.issues).toContainEqual(
      expect.objectContaining({
        code: 'SYNC_BOOTSTRAP_STAGED',
        severity: 'attention',
      }),
    )
  })

  it('TEST — PENDING: returns SYNC_HEALTH_ATTENTION and SYNC_PENDING_QUEUE when pendingCount > 0', async () => {
    mockQueueService.countPending.mockResolvedValue(5)

    const result = await healthService.checkHealth({ context: validContext })

    expect(result.ok).toBe(true)
    expect(result.code).toBe('SYNC_HEALTH_ATTENTION')
    expect(result.status).toBe('attention')
    expect(result.summary.pendingCount).toBe(5)
    expect(result.issues).toContainEqual(
      expect.objectContaining({
        code: 'SYNC_PENDING_QUEUE',
        severity: 'attention',
      }),
    )
  })

  it('TEST — CONFLICT: returns SYNC_HEALTH_BLOCKED and SYNC_OPEN_CONFLICT when valid open conflicts exist', async () => {
    mockAdapter.loadSyncConflicts.mockResolvedValue({
      version: 1,
      conflicts: [
        {
          id: 'c1',
          requestId: 'req-1',
          queueId: 'q1',
          entityType: 'products',
          serverEntity: 'products',
          syncId: 'p1-uuid',
          serverSyncVersion: 2,
          status: 'open',
          queueSnapshot: {
            id: 'q1',
            entityType: 'products',
            entityId: 'p1',
            operation: 'create',
            updatedAt: '2026-08-27T00:00:00.000Z',
          },
        },
      ],
    })

    const result = await healthService.checkHealth({ context: validContext })

    expect(result.ok).toBe(true)
    expect(result.code).toBe('SYNC_HEALTH_BLOCKED')
    expect(result.status).toBe('blocked')
    expect(result.summary.openConflictCount).toBe(1)
    expect(result.issues).toContainEqual(
      expect.objectContaining({
        code: 'SYNC_OPEN_CONFLICT',
        severity: 'blocked',
      }),
    )
  })

  it('TEST — OPEN CONFLICT QUEUE SNAPSHOT STRUCTURE: fails closed when open conflict snapshot is malformed or mismatched queueId', async () => {
    // 1. Snapshot missing required field (operation)
    mockAdapter.loadSyncConflicts.mockResolvedValueOnce({
      version: 1,
      conflicts: [
        {
          id: 'c1',
          requestId: 'req-1',
          queueId: 'q1',
          entityType: 'products',
          serverEntity: 'products',
          syncId: 'p1-uuid',
          serverSyncVersion: 2,
          status: 'open',
          queueSnapshot: {
            id: 'q1',
            entityType: 'products',
            entityId: 'p1',
            // missing operation & updatedAt
          },
        },
      ],
    })

    const res1 = await healthService.checkHealth({ context: validContext })
    expect(res1.ok).toBe(true)
    expect(res1.code).toBe('SYNC_HEALTH_BLOCKED')
    expect(res1.issues).toContainEqual(
      expect.objectContaining({
        code: 'SYNC_HEALTH_METADATA_INVALID',
        severity: 'blocked',
      }),
    )

    // 2. Snapshot ID does not match conflict.queueId
    mockAdapter.loadSyncConflicts.mockResolvedValueOnce({
      version: 1,
      conflicts: [
        {
          id: 'c2',
          requestId: 'req-2',
          queueId: 'q2',
          entityType: 'products',
          serverEntity: 'products',
          syncId: 'p2-uuid',
          serverSyncVersion: 2,
          status: 'open',
          queueSnapshot: {
            id: 'DIFFERENT_QUEUE_ID',
            entityType: 'products',
            entityId: 'p2',
            operation: 'update',
            updatedAt: '2026-08-27T00:00:00.000Z',
          },
        },
      ],
    })

    const res2 = await healthService.checkHealth({ context: validContext })
    expect(res2.ok).toBe(true)
    expect(res2.code).toBe('SYNC_HEALTH_BLOCKED')
    expect(res2.issues).toContainEqual(
      expect.objectContaining({
        code: 'SYNC_HEALTH_METADATA_INVALID',
        severity: 'blocked',
      }),
    )
  })

  it('TEST — VALID INFLIGHT: returns SYNC_HEALTH_ATTENTION and SYNC_PUSH_INFLIGHT with full P12 shape without clearing inflight', async () => {
    mockAdapter.loadSyncPushInflight.mockResolvedValue({
      version: 1,
      requestId: 'req-1',
      businessId: 10,
      outletId: 101,
      deviceIdentifier: 'dev-uuid-123',
      registeredDeviceId: 77,
      createdAt: '2026-08-27T00:00:00.000Z',
      queueSnapshots: [
        {
          id: 'q1',
          entityType: 'products',
          entityId: 'p1',
          operation: 'create',
          updatedAt: '2026-08-27T00:00:00.000Z',
        },
      ],
      changes: {
        categories: [],
        products: [{ id: 'p1' }],
        customers: [],
        shifts: [],
        sales: [],
        sale_items: [],
        expenses: [],
      },
    })

    const result = await healthService.checkHealth({ context: validContext })

    expect(result.ok).toBe(true)
    expect(result.code).toBe('SYNC_HEALTH_ATTENTION')
    expect(result.status).toBe('attention')
    expect(result.summary.hasInflight).toBe(true)
    expect(result.issues).toContainEqual(
      expect.objectContaining({
        code: 'SYNC_PUSH_INFLIGHT',
        severity: 'attention',
      }),
    )
    expect(mockAdapter.clearSyncPushInflight).not.toHaveBeenCalled()
  })

  it('TEST — MALFORMED CHANGES: returns SYNC_HEALTH_BLOCKED and SYNC_HEALTH_METADATA_INVALID when changes shape is incomplete or non-object', async () => {
    const malformedChangesList = [
      {}, // empty object
      [], // array
      { products: [] }, // missing 6 keys
      {
        categories: {}, // not an array
        products: [],
        customers: [],
        shifts: [],
        sales: [],
        sale_items: [],
        expenses: [],
      },
    ]

    for (const ch of malformedChangesList) {
      mockAdapter.loadSyncPushInflight.mockResolvedValueOnce({
        version: 1,
        requestId: 'req-1',
        businessId: 10,
        outletId: 101,
        deviceIdentifier: 'dev-uuid-123',
        registeredDeviceId: 77,
        createdAt: '2026-08-27T00:00:00.000Z',
        queueSnapshots: [
          {
            id: 'q1',
            entityType: 'products',
            entityId: 'p1',
            operation: 'create',
            updatedAt: '2026-08-27T00:00:00.000Z',
          },
        ],
        changes: ch,
      })

      const result = await healthService.checkHealth({ context: validContext })

      expect(result.ok).toBe(true)
      expect(result.code).toBe('SYNC_HEALTH_BLOCKED')
      expect(result.status).toBe('blocked')
      expect(result.issues).toContainEqual(
        expect.objectContaining({
          code: 'SYNC_HEALTH_METADATA_INVALID',
          severity: 'blocked',
        }),
      )
    }
  })

  it('TEST — INFLIGHT MISMATCH: returns SYNC_HEALTH_BLOCKED and SYNC_INFLIGHT_CONTEXT_MISMATCH without clearing inflight', async () => {
    mockAdapter.loadSyncPushInflight.mockResolvedValue({
      version: 1,
      requestId: 'req-1',
      businessId: 10,
      outletId: 202, // Different outlet
      deviceIdentifier: 'dev-uuid-123',
      registeredDeviceId: 77,
      createdAt: '2026-08-27T00:00:00.000Z',
      queueSnapshots: [
        {
          id: 'q1',
          entityType: 'products',
          entityId: 'p1',
          operation: 'create',
          updatedAt: '2026-08-27T00:00:00.000Z',
        },
      ],
      changes: {
        categories: [],
        products: [{ id: 'p1' }],
        customers: [],
        shifts: [],
        sales: [],
        sale_items: [],
        expenses: [],
      },
    })

    const result = await healthService.checkHealth({ context: validContext })

    expect(result.ok).toBe(true)
    expect(result.code).toBe('SYNC_HEALTH_BLOCKED')
    expect(result.status).toBe('blocked')
    expect(result.issues).toContainEqual(
      expect.objectContaining({
        code: 'SYNC_INFLIGHT_CONTEXT_MISMATCH',
        severity: 'blocked',
      }),
    )
    expect(mockAdapter.clearSyncPushInflight).not.toHaveBeenCalled()
  })

  it('TEST — NUMERIC STRING PUSH BINDING: returns SYNC_HEALTH_BLOCKED and SYNC_HEALTH_METADATA_INVALID', async () => {
    mockAdapter.loadSyncPushBinding.mockResolvedValue({ businessId: '10' }) // numeric string, not number

    const result = await healthService.checkHealth({ context: validContext })

    expect(result.ok).toBe(true)
    expect(result.code).toBe('SYNC_HEALTH_BLOCKED')
    expect(result.status).toBe('blocked')
    expect(result.issues).toContainEqual(
      expect.objectContaining({
        code: 'SYNC_HEALTH_METADATA_INVALID',
        severity: 'blocked',
      }),
    )
  })

  it('TEST — PUSH BINDING MISMATCH: returns SYNC_HEALTH_BLOCKED and SYNC_PUSH_BINDING_MISMATCH when business differs', async () => {
    mockAdapter.loadSyncPushBinding.mockResolvedValue({ businessId: 99 })

    const result = await healthService.checkHealth({ context: validContext })

    expect(result.ok).toBe(true)
    expect(result.code).toBe('SYNC_HEALTH_BLOCKED')
    expect(result.status).toBe('blocked')
    expect(result.issues).toContainEqual(
      expect.objectContaining({
        code: 'SYNC_PUSH_BINDING_MISMATCH',
        severity: 'blocked',
      }),
    )
  })

  it('TEST — PULL BINDING MISMATCH: returns SYNC_HEALTH_BLOCKED and SYNC_PULL_BINDING_MISMATCH when context differs', async () => {
    mockAdapter.loadSyncPullBinding.mockResolvedValue({
      businessId: 10,
      outletId: 101,
      deviceIdentifier: 'dev-different',
      registeredDeviceId: 77,
    })

    const result = await healthService.checkHealth({ context: validContext })

    expect(result.ok).toBe(true)
    expect(result.code).toBe('SYNC_HEALTH_BLOCKED')
    expect(result.status).toBe('blocked')
    expect(result.issues).toContainEqual(
      expect.objectContaining({
        code: 'SYNC_PULL_BINDING_MISMATCH',
        severity: 'blocked',
      }),
    )
  })

  it('TEST — BOOTSTRAP MISMATCH: returns SYNC_HEALTH_BLOCKED and SYNC_BOOTSTRAP_CONTEXT_MISMATCH when staged context differs', async () => {
    mockAdapter.loadSyncBootstrapState.mockResolvedValue({
      version: 1,
      status: 'staged',
      businessId: 10,
      outletId: 999, // mismatch
      deviceIdentifier: 'dev-uuid-123',
      registeredDeviceId: 77,
    })

    const result = await healthService.checkHealth({ context: validContext })

    expect(result.ok).toBe(true)
    expect(result.code).toBe('SYNC_HEALTH_BLOCKED')
    expect(result.status).toBe('blocked')
    expect(result.issues).toContainEqual(
      expect.objectContaining({
        code: 'SYNC_BOOTSTRAP_CONTEXT_MISMATCH',
        severity: 'blocked',
      }),
    )
  })

  it('TEST — BOOTSTRAP NOT PREPARED: returns SYNC_BOOTSTRAP_NOT_PREPARED (attention) when no push binding and no bootstrap', async () => {
    mockAdapter.loadSyncPushBinding.mockResolvedValue(null)
    mockAdapter.loadSyncBootstrapState.mockResolvedValue(null)

    const result = await healthService.checkHealth({ context: validContext })

    expect(result.ok).toBe(true)
    expect(result.code).toBe('SYNC_HEALTH_ATTENTION')
    expect(result.status).toBe('attention')
    expect(result.issues).toContainEqual(
      expect.objectContaining({
        code: 'SYNC_BOOTSTRAP_NOT_PREPARED',
        severity: 'attention',
      }),
    )
  })

  it('TEST — MALFORMED BOOTSTRAP STATUS: returns SYNC_HEALTH_METADATA_INVALID and summary.bootstrapStatus invalid', async () => {
    mockAdapter.loadSyncBootstrapState.mockResolvedValue({
      version: 1,
      status: 'unknown_status',
      businessId: 10,
      outletId: 101,
      deviceIdentifier: 'dev-uuid-123',
      registeredDeviceId: 77,
    })

    const result = await healthService.checkHealth({ context: validContext })

    expect(result.ok).toBe(true)
    expect(result.code).toBe('SYNC_HEALTH_BLOCKED')
    expect(result.status).toBe('blocked')
    expect(result.summary.bootstrapStatus).toBe('invalid')
    expect(result.issues).toContainEqual(
      expect.objectContaining({
        code: 'SYNC_HEALTH_METADATA_INVALID',
        severity: 'blocked',
      }),
    )
  })

  it('TEST — PULL CURSOR: reads cursor accurately without modifying state', async () => {
    mockAdapter.loadSyncPullState.mockResolvedValue({ version: 1, cursor: 9988, serverSequence: 9988 })

    const result = await healthService.checkHealth({ context: validContext })

    expect(result.summary.pullCursor).toBe(9988)
    expect(mockAdapter.saveSyncPullState).not.toHaveBeenCalled()
  })

  it('TEST — MALFORMED PULL CURSOR: fails closed on invalid cursor / sequence / version', async () => {
    const invalidPullStates = [
      { version: 1, cursor: -1, serverSequence: 0 },
      { version: 1, cursor: 'abc', serverSequence: 0 },
      { version: 1, cursor: null, serverSequence: 0 },
      { version: 99, cursor: 10, serverSequence: 10 },
      { version: 1, cursor: 10, serverSequence: -1 },
    ]

    for (const ps of invalidPullStates) {
      mockAdapter.loadSyncPullState.mockResolvedValueOnce(ps)

      const result = await healthService.checkHealth({ context: validContext })

      expect(result.ok).toBe(true)
      expect(result.code).toBe('SYNC_HEALTH_BLOCKED')
      expect(result.status).toBe('blocked')
      expect(result.issues).toContainEqual(
        expect.objectContaining({
          code: 'SYNC_HEALTH_METADATA_INVALID',
          severity: 'blocked',
        }),
      )
    }
  })

  it('TEST — MALFORMED CONFLICT STATE: fails closed when conflict object or open item is malformed', async () => {
    const invalidConflictStates = [
      { version: 1, conflicts: 'not-an-array' },
      {
        version: 1,
        conflicts: [
          { id: 'c1', status: 'open' }, // missing queueId, requestId, entityType, etc.
        ],
      },
    ]

    for (const cs of invalidConflictStates) {
      mockAdapter.loadSyncConflicts.mockResolvedValueOnce(cs)

      const result = await healthService.checkHealth({ context: validContext })

      expect(result.ok).toBe(true)
      expect(result.code).toBe('SYNC_HEALTH_BLOCKED')
      expect(result.status).toBe('blocked')
      expect(result.issues).toContainEqual(
        expect.objectContaining({
          code: 'SYNC_HEALTH_METADATA_INVALID',
          severity: 'blocked',
        }),
      )
    }
  })

  it('TEST — READ FAILURE: catches adapter throw and returns SYNC_HEALTH_READ_FAILED fail-closed', async () => {
    mockAdapter.loadSyncPushBinding.mockRejectedValue(new Error('SQLite disk I/O error'))

    const result = await healthService.checkHealth({ context: validContext })

    expect(result.ok).toBe(false)
    expect(result.code).toBe('SYNC_HEALTH_READ_FAILED')
    expect(result.status).toBe('blocked')
    expect(result.issues[0].code).toBe('SYNC_HEALTH_READ_FAILED')
  })

  it('TEST — REQUIRED READ CAPABILITY MISSING: returns SYNC_HEALTH_READ_FAILED if adapter lacks required reader', async () => {
    const incompleteAdapter = { ...mockAdapter, loadSyncPushInflight: undefined }
    const partialHealthService = createSyncHealthService({
      adapter: incompleteAdapter,
      queueService: mockQueueService,
      conflictService: mockConflictService,
    })

    const result = await partialHealthService.checkHealth({ context: validContext })
    expect(result.ok).toBe(false)
    expect(result.code).toBe('SYNC_HEALTH_READ_FAILED')
    expect(result.status).toBe('blocked')
  })

  it('TEST — INVALID CONTEXT VALUES: returns SYNC_HEALTH_CONTEXT_INCOMPLETE without calling durable reads', async () => {
    const invalidContexts = [
      { ...validContext, user: { email: 'no-id@example.com' } }, // user without id
      { ...validContext, selectedBusiness: { id: 0 } }, // business id = 0
      { ...validContext, selectedBusiness: { id: 'abc' } }, // business id = "abc"
      { ...validContext, selectedOutlet: { id: -1 } }, // outlet id = -1
      { ...validContext, cloudAccess: false },
      { ...validContext, deviceIdentifier: '   ' }, // empty whitespace
      { ...validContext, registeredDeviceId: 0 },
    ]

    for (const ctx of invalidContexts) {
      const result = await healthService.checkHealth({ context: ctx })
      expect(result.ok).toBe(false)
      expect(result.code).toBe('SYNC_HEALTH_CONTEXT_INCOMPLETE')
      expect(result.status).toBe('blocked')
    }

    expect(mockAdapter.loadSyncPushBinding).not.toHaveBeenCalled()
    expect(mockAdapter.loadSyncPullBinding).not.toHaveBeenCalled()
  })

  it('TEST — ZERO MUTATION: checkHealth does not trigger any save/clear/delete/mutation operations', async () => {
    await healthService.checkHealth({ context: validContext })

    expect(mockAdapter.saveSyncPushBinding).not.toHaveBeenCalled()
    expect(mockAdapter.saveSyncPullBinding).not.toHaveBeenCalled()
    expect(mockAdapter.saveSyncPullState).not.toHaveBeenCalled()
    expect(mockAdapter.saveSyncPushInflight).not.toHaveBeenCalled()
    expect(mockAdapter.clearSyncPushInflight).not.toHaveBeenCalled()
    expect(mockAdapter.saveSyncBootstrapState).not.toHaveBeenCalled()
    expect(mockAdapter.saveSyncConflicts).not.toHaveBeenCalled()
    expect(mockQueueService.enqueueUpsert).not.toHaveBeenCalled()
    expect(mockQueueService.removeIfUnchanged).not.toHaveBeenCalled()
  })

  it('TEST — NO TOKEN: context received by service contains no token or password', async () => {
    const contextWithToken = {
      ...validContext,
      token: 'secret-token-123',
      password: 'secret-password',
    }

    const result = await healthService.checkHealth({ context: contextWithToken })
    expect(result.ok).toBe(true)

    const serialized = JSON.stringify(result)
    expect(serialized).not.toContain('secret-token-123')
    expect(serialized).not.toContain('secret-password')
  })
})

describe('P17: Pinia Store (useSyncHealthStore)', () => {
  let pinia
  let store
  let cloudStore
  let mockHealthService
  let validContext

  beforeEach(() => {
    pinia = createPinia()
    setActivePinia(pinia)
    store = useSyncHealthStore()
    cloudStore = useCloudSessionStore()

    cloudStore.user = { id: 1, email: 'test@example.com' }
    cloudStore.selectedBusiness = { id: 10, name: 'Biz 10' }
    cloudStore.selectedOutlet = { id: 101, name: 'Outlet 1' }
    cloudStore.cloudAccess = true
    cloudStore.deviceIdentifier = 'dev-uuid-123'
    cloudStore.registeredDeviceId = 77

    validContext = {
      user: { id: 1, email: 'test@example.com' },
      selectedBusiness: { id: 10, name: 'Biz 10' },
      selectedOutlet: { id: 101, name: 'Outlet 1' },
      cloudAccess: true,
      deviceIdentifier: 'dev-uuid-123',
      registeredDeviceId: 77,
    }

    mockHealthService = {
      checkHealth: vi.fn(),
    }
    store.init({ healthService: mockHealthService })
  })

  it('TEST — STORE REENTRANT: blocks concurrent checkHealth and keeps loading true until first completes', async () => {
    let resolveFirst
    const pendingPromise = new Promise((resolve) => {
      resolveFirst = resolve
    })
    mockHealthService.checkHealth.mockImplementation(() => pendingPromise)

    const call1 = store.checkHealth()
    expect(store.loading).toBe(true)

    const call2Result = await store.checkHealth()
    expect(call2Result.ok).toBe(false)
    expect(call2Result.code).toBe('SYNC_HEALTH_ALREADY_CHECKING')
    expect(store.loading).toBe(true)

    resolveFirst({
      ok: true,
      code: 'SYNC_HEALTH_READY',
      status: 'ready',
      summary: { pendingCount: 0, openConflictCount: 0, hasInflight: false, bootstrapStatus: 'none', pullCursor: 0 },
      issues: [],
    })
    await call1
    expect(store.loading).toBe(false)
    expect(store.status).toBe('ready')
  })

  it('TEST — OPTIONS CONTEXT SANITIZATION: sanitizes options.context and strips token/password', async () => {
    let capturedOptions
    mockHealthService.checkHealth.mockImplementation(async (opts) => {
      capturedOptions = opts
      return {
        ok: true,
        code: 'SYNC_HEALTH_READY',
        status: 'ready',
        summary: { pendingCount: 0, openConflictCount: 0, hasInflight: false, bootstrapStatus: 'none', pullCursor: 0 },
        issues: [],
      }
    })

    await store.checkHealth({
      context: {
        ...validContext,
        token: 'SUPER_SECRET_TOKEN',
        password: 'SUPER_SECRET_PASSWORD',
        authorization: 'Bearer xyz',
      },
    })

    expect(capturedOptions.context).toBeDefined()
    expect(capturedOptions.context.user.id).toBe(1)
    expect(capturedOptions.context.token).toBeUndefined()
    expect(capturedOptions.context.password).toBeUndefined()
    expect(capturedOptions.context.authorization).toBeUndefined()
  })

  it('TEST — RESET RESULT: clears diagnostic UI state without touching persistence', () => {
    store.status = 'ready'
    store.summary = { pendingCount: 0 }
    store.issues = [{ code: 'TEST' }]
    store.lastResult = { ok: true }
    store.lastCheckedAt = '2026-08-27T00:00:00.000Z'

    store.resetResult()

    expect(store.status).toBeNull()
    expect(store.summary).toBeNull()
    expect(store.issues).toEqual([])
    expect(store.lastResult).toBeNull()
    expect(store.lastCheckedAt).toBeNull()
  })
})

describe('P17: UI Integration in CloudLoginView', () => {
  let pinia
  let cloudStore
  let healthStore
  let orchestratorStore
  let pushStore
  let pullStore
  let bootstrapStore
  let conflictStore

  beforeEach(() => {
    pinia = createPinia()
    setActivePinia(pinia)

    cloudStore = useCloudSessionStore()
    healthStore = useSyncHealthStore()
    orchestratorStore = useSyncOrchestratorStore()
    pushStore = useSyncPushStore()
    pullStore = useSyncPullStore()
    bootstrapStore = useSyncBootstrapStore()
    conflictStore = useSyncConflictStore()

    cloudStore.user = { id: 1, email: 'test@example.com' }
    cloudStore.cloudAccess = true
    cloudStore.businesses = [{ id: 10, name: 'Biz 10', outlets: [{ id: 101, status: 'active' }] }]
    cloudStore.selectedBusiness = { id: 10, name: 'Biz 10' }
    cloudStore.selectedOutlet = { id: 101, name: 'Outlet 1' }
    cloudStore.deviceIdentifier = 'dev-uuid-123'
    cloudStore.registeredDeviceId = 77

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

  it('renders "Periksa Status Sync" button and displays summary and status when clicked', async () => {
    const mockHealthService = {
      checkHealth: vi.fn().mockResolvedValue({
        ok: true,
        code: 'SYNC_HEALTH_READY',
        status: 'ready',
        checkedAt: '2026-08-27T10:00:00.000Z',
        summary: {
          pendingCount: 0,
          openConflictCount: 0,
          hasInflight: false,
          bootstrapStatus: 'completed',
          pullCursor: 45,
        },
        issues: [],
      }),
    }
    healthStore.init({ healthService: mockHealthService })

    const wrapper = mount(CloudLoginView, {
      global: {
        plugins: [pinia],
        stubs: {
          BaseButton: {
            template: '<button :id="$attrs.id" :disabled="$attrs.disabled"><slot /></button>',
          },
          BaseInput: true,
          BaseCard: { template: '<div><slot /></div>' },
        },
      },
    })

    await flushPromises()

    expect(wrapper.find('#sync-health-btn').exists()).toBe(true)
    expect(wrapper.find('#sync-health-btn').text()).toContain('Periksa Status Sync')

    await wrapper.find('#sync-health-btn').trigger('click')
    await flushPromises()

    expect(mockHealthService.checkHealth).toHaveBeenCalledTimes(1)
    expect(wrapper.find('#sync-health-status-message').text()).toContain('Status sinkronisasi lokal sehat')
    expect(wrapper.find('#health-pending-count').text()).toContain('Pending: 0')
    expect(wrapper.find('#health-pull-cursor').text()).toContain('Pull Cursor: 45')
    expect(wrapper.find('#health-last-checked-at').text()).toContain('Terakhir diperiksa:')
  })

  it('TEST — UI BOOTSTRAP STATUS INVALID: displays Bootstrap: Invalid when bootstrapStatus is invalid', async () => {
    const mockHealthService = {
      checkHealth: vi.fn().mockResolvedValue({
        ok: true,
        code: 'SYNC_HEALTH_BLOCKED',
        status: 'blocked',
        checkedAt: '2026-08-27T10:00:00.000Z',
        summary: {
          pendingCount: 0,
          openConflictCount: 0,
          hasInflight: false,
          bootstrapStatus: 'invalid',
          pullCursor: 0,
        },
        issues: [{ code: 'SYNC_HEALTH_METADATA_INVALID', severity: 'blocked', message: 'Bootstrap invalid' }],
      }),
    }
    healthStore.init({ healthService: mockHealthService })

    const wrapper = mount(CloudLoginView, {
      global: {
        plugins: [pinia],
        stubs: {
          BaseButton: {
            template: '<button :id="$attrs.id" :disabled="$attrs.disabled"><slot /></button>',
          },
          BaseInput: true,
          BaseCard: { template: '<div><slot /></div>' },
        },
      },
    })

    await flushPromises()

    await wrapper.find('#sync-health-btn').trigger('click')
    await flushPromises()

    expect(wrapper.find('#health-bootstrap-status').text()).toContain('Bootstrap: Invalid')
  })

  it('TEST — CONTEXT CHANGE INVALIDATES OLD RESULT: resets health result when context changes without auto check', async () => {
    healthStore.status = 'ready'
    healthStore.summary = { pendingCount: 0 }
    healthStore.lastCheckedAt = '2026-08-27T10:00:00.000Z'

    const wrapper = mount(CloudLoginView, {
      global: {
        plugins: [pinia],
        stubs: {
          BaseButton: true,
          BaseInput: true,
          BaseCard: { template: '<div><slot /></div>' },
        },
      },
    })

    await flushPromises()

    // Switch business
    cloudStore.selectedBusiness = { id: 20, name: 'Biz 20' }
    await flushPromises()

    expect(healthStore.status).toBeNull()
    expect(healthStore.summary).toBeNull()
    expect(healthStore.lastCheckedAt).toBeNull()
  })

  it('TEST — SYNC MUTATION INVALIDATES RESULT: resetResult called when sync action is triggered', async () => {
    healthStore.status = 'ready'
    healthStore.summary = { pendingCount: 0 }

    vi.spyOn(orchestratorStore, 'syncAll').mockResolvedValue({ ok: true, code: 'SYNC_ALL_COMPLETED' })
    vi.spyOn(conflictStore, 'loadConflicts').mockResolvedValue()
    vi.spyOn(pushStore, 'refreshPendingCount').mockResolvedValue()

    const wrapper = mount(CloudLoginView, {
      global: {
        plugins: [pinia],
        stubs: {
          BaseButton: {
            template: '<button :id="$attrs.id" :disabled="$attrs.disabled"><slot /></button>',
          },
          BaseInput: true,
          BaseCard: { template: '<div><slot /></div>' },
        },
      },
    })

    await flushPromises()

    await wrapper.find('#sync-all-btn').trigger('click')
    await flushPromises()

    expect(healthStore.status).toBeNull()
    expect(healthStore.summary).toBeNull()
  })

  it('TEST — LOGOUT INVALIDATES HEALTH RESULT: resetResult called on logout', async () => {
    healthStore.status = 'ready'
    vi.spyOn(cloudStore, 'logout').mockResolvedValue()

    const wrapper = mount(CloudLoginView, {
      global: {
        plugins: [pinia],
        stubs: {
          BaseButton: {
            template: '<button :id="$attrs.id" :disabled="$attrs.disabled"><slot /></button>',
          },
          BaseInput: true,
          BaseCard: { template: '<div><slot /></div>' },
        },
      },
    })

    await flushPromises()

    await wrapper.find('#cloud-logout-btn').trigger('click')
    await flushPromises()

    expect(healthStore.status).toBeNull()
  })

  it('TEST — MULTIPLE METADATA INVALID UI: renders multiple issues without duplicate key warning', async () => {
    healthStore.status = 'blocked'
    healthStore.issues = [
      { code: 'SYNC_HEALTH_METADATA_INVALID', severity: 'blocked', message: 'Push binding invalid' },
      { code: 'SYNC_HEALTH_METADATA_INVALID', severity: 'blocked', message: 'Pull state invalid' },
    ]

    const wrapper = mount(CloudLoginView, {
      global: {
        plugins: [pinia],
        stubs: {
          BaseButton: true,
          BaseInput: true,
          BaseCard: { template: '<div><slot /></div>' },
        },
      },
    })

    await flushPromises()

    expect(wrapper.find('#health-issue-SYNC_HEALTH_METADATA_INVALID-0').exists()).toBe(true)
    expect(wrapper.find('#health-issue-SYNC_HEALTH_METADATA_INVALID-1').exists()).toBe(true)
  })

  it('TEST — UI MUTUAL EXCLUSION: healthStore.loading disables other buttons', async () => {
    vi.spyOn(conflictStore, 'loadConflicts').mockResolvedValue()
    conflictStore.conflicts = [
      { id: 'c1', status: 'open', entityType: 'products', entityId: 'p1', serverSyncVersion: 2 },
    ]

    const wrapper = mount(CloudLoginView, {
      global: {
        plugins: [pinia],
        stubs: {
          BaseButton: {
            template: '<button :id="$attrs.id" :disabled="$attrs.disabled"><slot /></button>',
          },
          BaseInput: true,
          BaseCard: { template: '<div><slot /></div>' },
        },
      },
    })

    await flushPromises()

    healthStore.loading = true
    await flushPromises()

    expect(wrapper.find('#sync-all-btn').attributes('disabled')).toBeDefined()
    expect(wrapper.find('#sync-now-btn').attributes('disabled')).toBeDefined()
    expect(wrapper.find('#pull-now-btn').attributes('disabled')).toBeDefined()
    expect(wrapper.find('#bootstrap-btn').attributes('disabled')).toBeDefined()
    expect(wrapper.find('#cloud-logout-btn').attributes('disabled')).toBeDefined()
    expect(wrapper.find('#use-server-btn-c1').attributes('disabled')).toBeDefined()
    expect(wrapper.find('#keep-local-btn-c1').attributes('disabled')).toBeDefined()
  })

  it('TEST — UI MUTUAL EXCLUSION: orchestrator/push/pull loading disables #sync-health-btn', async () => {
    const wrapper = mount(CloudLoginView, {
      global: {
        plugins: [pinia],
        stubs: {
          BaseButton: {
            template: '<button :id="$attrs.id" :disabled="$attrs.disabled"><slot /></button>',
          },
          BaseInput: true,
          BaseCard: { template: '<div><slot /></div>' },
        },
      },
    })

    await flushPromises()

    orchestratorStore.loading = true
    await flushPromises()
    expect(wrapper.find('#sync-health-btn').attributes('disabled')).toBeDefined()

    orchestratorStore.loading = false
    pushStore.loading = true
    await flushPromises()
    expect(wrapper.find('#sync-health-btn').attributes('disabled')).toBeDefined()

    pushStore.loading = false
    pullStore.loading = true
    await flushPromises()
    expect(wrapper.find('#sync-health-btn').attributes('disabled')).toBeDefined()
  })
})
