import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { mount, flushPromises } from '@vue/test-utils'
import { createSyncOrchestratorService } from '@/services/sync/syncOrchestratorService'
import { useSyncOrchestratorStore } from '@/stores/syncOrchestratorStore'
import { useCloudSessionStore } from '@/stores/cloudSessionStore'
import { useSyncPushStore } from '@/stores/syncPushStore'
import { useSyncPullStore } from '@/stores/syncPullStore'
import { useSyncBootstrapStore } from '@/stores/syncBootstrapStore'
import { useSyncConflictStore } from '@/stores/syncConflictStore'
import CloudLoginView from '@/views/settings/CloudLoginView.vue'

describe('P16: Manual Full Sync Orchestrator Service', () => {
  let mockPushService
  let mockPullService
  let mockConflictService
  let orchestratorService

  beforeEach(() => {
    mockPushService = {
      pushNow: vi.fn(),
    }
    mockPullService = {
      pullNow: vi.fn(),
    }
    mockConflictService = {
      countOpenConflicts: vi.fn().mockResolvedValue(0),
    }
    orchestratorService = createSyncOrchestratorService({
      pushService: mockPushService,
      pullService: mockPullService,
      conflictService: mockConflictService,
    })
  })

  it('TEST — SUCCESS: runs push then pull in exact order when push is clean and remaining is 0', async () => {
    const callOrder = []

    mockPushService.pushNow.mockImplementation(async () => {
      callOrder.push('push')
      return {
        ok: true,
        code: 'SYNC_PUSH_SUCCESS',
        remaining: 0,
        removedQueueIds: ['q1', 'q2'],
        sentQueueIds: ['q1', 'q2'],
      }
    })

    mockPullService.pullNow.mockImplementation(async () => {
      callOrder.push('pull')
      return {
        ok: true,
        code: 'SYNC_PULL_SUCCESS',
        applied: 3,
        cursor: 100,
      }
    })

    const result = await orchestratorService.syncAll()

    expect(result.ok).toBe(true)
    expect(result.code).toBe('SYNC_ALL_COMPLETED')
    expect(result.stage).toBe('completed')
    expect(callOrder).toEqual(['push', 'pull'])
    expect(mockPushService.pushNow).toHaveBeenCalledTimes(1)
    expect(mockPullService.pullNow).toHaveBeenCalledTimes(1)
    expect(mockConflictService.countOpenConflicts).toHaveBeenCalledTimes(1)
    expect(result.push.removedQueueIds).toEqual(['q1', 'q2'])
    expect(result.pull.applied).toBe(3)
  })

  it('TEST — EMPTY PUSH: runs pull even if push queue was empty (requestId: null, remaining: 0)', async () => {
    mockPushService.pushNow.mockResolvedValue({
      ok: true,
      code: 'SYNC_PUSH_EMPTY',
      requestId: null,
      remaining: 0,
      removedQueueIds: [],
    })

    mockPullService.pullNow.mockResolvedValue({
      ok: true,
      code: 'SYNC_PULL_SUCCESS',
      applied: 0,
    })

    const result = await orchestratorService.syncAll()

    expect(result.ok).toBe(true)
    expect(result.code).toBe('SYNC_ALL_COMPLETED')
    expect(mockPushService.pushNow).toHaveBeenCalledTimes(1)
    expect(mockPullService.pullNow).toHaveBeenCalledTimes(1)
  })

  it('TEST — PUSH ERROR: stops immediately, does not call pull, returns stage push and propagates error', async () => {
    mockPushService.pushNow.mockResolvedValue({
      ok: false,
      code: 'NETWORK_ERROR',
      message: 'Network timeout',
      error: { code: 'NETWORK_ERROR', message: 'Network timeout' },
    })

    const result = await orchestratorService.syncAll()

    expect(result.ok).toBe(false)
    expect(result.code).toBe('NETWORK_ERROR')
    expect(result.stage).toBe('push')
    expect(result.pull).toBeNull()
    expect(mockPullService.pullNow).not.toHaveBeenCalled()
  })

  it('TEST — CONFLICT: stops immediately on SYNC_CONFLICT, does not call pull, no retry', async () => {
    mockPushService.pushNow.mockResolvedValue({
      ok: false,
      code: 'SYNC_CONFLICT',
      message: 'Sync data conflict detected on server.',
      error: { code: 'SYNC_CONFLICT' },
      conflicts: [{ id: 'c1', entity: 'products' }],
    })

    const result = await orchestratorService.syncAll()

    expect(result.ok).toBe(false)
    expect(result.code).toBe('SYNC_CONFLICT')
    expect(result.stage).toBe('push')
    expect(mockPullService.pullNow).not.toHaveBeenCalled()
  })

  it('TEST — CONFLICT PENDING: stops immediately on SYNC_CONFLICT_PENDING without calling pull', async () => {
    mockPushService.pushNow.mockResolvedValue({
      ok: false,
      code: 'SYNC_CONFLICT_PENDING',
      message: 'Queue item is blocked due to open sync conflict.',
      error: { code: 'SYNC_CONFLICT_PENDING' },
    })

    const result = await orchestratorService.syncAll()

    expect(result.ok).toBe(false)
    expect(result.code).toBe('SYNC_CONFLICT_PENDING')
    expect(result.stage).toBe('push')
    expect(mockPullService.pullNow).not.toHaveBeenCalled()
  })

  it('TEST — P15 NEW CONFLICT CODES: stops immediately and propagates error', async () => {
    const errorCodes = [
      'SYNC_CONFLICT_MAPPING_FAILED',
      'INVALID_SYNC_CONFLICT_RESPONSE',
      'SYNC_CONFLICT_PERSIST_FAILED',
      'SYNC_STALE_CONFLICT_ENVELOPE_CLEARED',
    ]

    for (const code of errorCodes) {
      mockPushService.pushNow.mockResolvedValueOnce({
        ok: false,
        code,
        message: `Error with ${code}`,
      })

      const result = await orchestratorService.syncAll()
      expect(result.ok).toBe(false)
      expect(result.code).toBe(code)
      expect(result.stage).toBe('push')
      expect(mockPullService.pullNow).not.toHaveBeenCalled()
    }
  })

  it('TEST — MIXED CONFLICT: push ok with remaining 1 and open conflict returns SYNC_CONFLICT_PENDING, 0 pull calls', async () => {
    mockPushService.pushNow.mockResolvedValue({
      ok: true,
      remaining: 1,
      blocked: [],
    })
    mockConflictService.countOpenConflicts.mockResolvedValue(1)

    const result = await orchestratorService.syncAll()

    expect(result.ok).toBe(false)
    expect(result.code).toBe('SYNC_CONFLICT_PENDING')
    expect(result.stage).toBe('push')
    expect(result.message).toBe('Ada konflik sinkronisasi yang harus diselesaikan terlebih dahulu.')
    expect(result.pull).toBeNull()
    expect(mockPullService.pullNow).not.toHaveBeenCalled()
  })

  it('TEST — DANGLING OPEN CONFLICT: push ok with remaining 0 but open conflicts > 0 returns SYNC_CONFLICT_PENDING, 0 pull calls', async () => {
    mockPushService.pushNow.mockResolvedValue({
      ok: true,
      remaining: 0,
      removedQueueIds: ['q1'],
    })
    mockConflictService.countOpenConflicts.mockResolvedValue(1)

    const result = await orchestratorService.syncAll()

    expect(result.ok).toBe(false)
    expect(result.code).toBe('SYNC_CONFLICT_PENDING')
    expect(result.stage).toBe('push')
    expect(mockPullService.pullNow).not.toHaveBeenCalled()
  })

  it('TEST — CONFLICT STATE READ FAILURE: returns SYNC_CONFLICT_STATE_READ_FAILED if conflict count throws', async () => {
    mockPushService.pushNow.mockResolvedValue({
      ok: true,
      remaining: 0,
    })
    mockConflictService.countOpenConflicts.mockRejectedValue(new Error('SQLite disk error'))

    const result = await orchestratorService.syncAll()

    expect(result.ok).toBe(false)
    expect(result.code).toBe('SYNC_CONFLICT_STATE_READ_FAILED')
    expect(result.stage).toBe('push')
    expect(mockPullService.pullNow).not.toHaveBeenCalled()
  })

  it('TEST — BLOCKED ONLY: push returns remaining > 0 and blocked entries returns SYNC_PUSH_BLOCKED_PENDING', async () => {
    mockPushService.pushNow.mockResolvedValue({
      ok: true,
      remaining: 1,
      blocked: [{ queueId: 'Q1', code: 'INVALID_TRANSACTION_SNAPSHOT' }],
    })
    mockConflictService.countOpenConflicts.mockResolvedValue(0)

    const result = await orchestratorService.syncAll()

    expect(result.ok).toBe(false)
    expect(result.code).toBe('SYNC_PUSH_BLOCKED_PENDING')
    expect(result.stage).toBe('push')
    expect(result.message).toBe('Ada data lokal yang belum dapat disinkronkan dan perlu diperiksa.')
    expect(result.blocked).toEqual([{ queueId: 'Q1', code: 'INVALID_TRANSACTION_SNAPSHOT' }])
    expect(mockPullService.pullNow).not.toHaveBeenCalled()
  })

  it('TEST — BLOCKED + NORMAL REMAINING: prioritizes SYNC_PUSH_BLOCKED_PENDING over SYNC_MORE_PUSH_PENDING', async () => {
    mockPushService.pushNow.mockResolvedValue({
      ok: true,
      remaining: 5,
      blocked: [{ queueId: 'Q2', code: 'SERVER_V1_ENTITY_LIMIT_EXCEEDED' }],
    })
    mockConflictService.countOpenConflicts.mockResolvedValue(0)

    const result = await orchestratorService.syncAll()

    expect(result.ok).toBe(false)
    expect(result.code).toBe('SYNC_PUSH_BLOCKED_PENDING')
    expect(result.stage).toBe('push')
    expect(mockPullService.pullNow).not.toHaveBeenCalled()
  })

  it('TEST — NORMAL BATCH REMAINING: stops after 1 push if remaining > 0 and no blocked/conflict, returns SYNC_MORE_PUSH_PENDING', async () => {
    mockPushService.pushNow.mockResolvedValue({
      ok: true,
      code: 'SYNC_PUSH_SUCCESS',
      remaining: 50,
      blocked: [],
      removedQueueIds: ['q1'],
    })
    mockConflictService.countOpenConflicts.mockResolvedValue(0)

    const result = await orchestratorService.syncAll()

    expect(result.ok).toBe(false)
    expect(result.code).toBe('SYNC_MORE_PUSH_PENDING')
    expect(result.stage).toBe('push')
    expect(result.message).toBe(
      'Masih ada data lokal yang menunggu dikirim. Tekan Sinkronkan Semua kembali.',
    )
    expect(result.pull).toBeNull()
    expect(mockPullService.pullNow).not.toHaveBeenCalled()
  })

  it('TEST — INVALID PUSH RESULT: fail closed if remaining is missing, null, not an integer, or negative', async () => {
    const invalidCases = [
      { ok: true }, // missing remaining
      { ok: true, remaining: null },
      { ok: true, remaining: 'abc' },
      { ok: true, remaining: -1 },
    ]

    for (const pushPayload of invalidCases) {
      mockPushService.pushNow.mockResolvedValueOnce(pushPayload)
      mockConflictService.countOpenConflicts.mockResolvedValueOnce(0)

      const result = await orchestratorService.syncAll()

      expect(result.ok).toBe(false)
      expect(result.code).toBe('SYNC_INVALID_PUSH_RESULT')
      expect(result.stage).toBe('push')
      expect(mockPullService.pullNow).not.toHaveBeenCalled()
    }
  })

  it('TEST — PUSH THROW: catches unexpected exception, returns SYNC_PUSH_EXCEPTION and releases lock', async () => {
    mockPushService.pushNow.mockRejectedValue(new Error('Fatal push network crash'))

    const result = await orchestratorService.syncAll()

    expect(result.ok).toBe(false)
    expect(result.code).toBe('SYNC_PUSH_EXCEPTION')
    expect(result.stage).toBe('push')
    expect(result.message).toContain('Fatal push network crash')
    expect(mockPullService.pullNow).not.toHaveBeenCalled()
    expect(orchestratorService.isSyncing()).toBe(false)
  })

  it('TEST — PULL THROW: catches unexpected exception, returns SYNC_PULL_EXCEPTION and releases lock without retrying push', async () => {
    mockPushService.pushNow.mockResolvedValue({
      ok: true,
      remaining: 0,
    })
    mockConflictService.countOpenConflicts.mockResolvedValue(0)
    mockPullService.pullNow.mockRejectedValue(new Error('Fatal pull parsing crash'))

    const result = await orchestratorService.syncAll()

    expect(result.ok).toBe(false)
    expect(result.code).toBe('SYNC_PULL_EXCEPTION')
    expect(result.stage).toBe('pull')
    expect(result.message).toContain('Fatal pull parsing crash')
    expect(mockPushService.pushNow).toHaveBeenCalledTimes(1)
    expect(mockPullService.pullNow).toHaveBeenCalledTimes(1)
    expect(orchestratorService.isSyncing()).toBe(false)
  })

  it('TEST — PULL ERROR: does not rollback successful push or retry push if pull fails', async () => {
    mockPushService.pushNow.mockResolvedValue({
      ok: true,
      code: 'SYNC_PUSH_SUCCESS',
      remaining: 0,
      removedQueueIds: ['q1'],
    })
    mockConflictService.countOpenConflicts.mockResolvedValue(0)

    mockPullService.pullNow.mockResolvedValue({
      ok: false,
      code: 'NETWORK_ERROR',
      message: 'Pull network timeout',
      error: { code: 'NETWORK_ERROR', message: 'Pull network timeout' },
    })

    const result = await orchestratorService.syncAll()

    expect(result.ok).toBe(false)
    expect(result.code).toBe('NETWORK_ERROR')
    expect(result.stage).toBe('pull')
    expect(result.push.ok).toBe(true)
    expect(result.pull.ok).toBe(false)
    expect(mockPushService.pushNow).toHaveBeenCalledTimes(1)
    expect(mockPullService.pullNow).toHaveBeenCalledTimes(1)
  })

  it('TEST — LOCAL_PENDING_SYNC_CONFLICT: propagates pull conflict error as is without auto-resolve', async () => {
    mockPushService.pushNow.mockResolvedValue({
      ok: true,
      code: 'SYNC_PUSH_SUCCESS',
      remaining: 0,
    })
    mockConflictService.countOpenConflicts.mockResolvedValue(0)

    mockPullService.pullNow.mockResolvedValue({
      ok: false,
      code: 'LOCAL_PENDING_SYNC_CONFLICT',
      message: 'Local changes conflict with incoming snapshot.',
      error: { code: 'LOCAL_PENDING_SYNC_CONFLICT' },
    })

    const result = await orchestratorService.syncAll()

    expect(result.ok).toBe(false)
    expect(result.code).toBe('LOCAL_PENDING_SYNC_CONFLICT')
    expect(result.stage).toBe('pull')
  })

  it('TEST — DOUBLE CALL: single run lock blocks concurrent invocations with SYNC_ALREADY_IN_PROGRESS', async () => {
    let resolvePush
    const pushPromise = new Promise((res) => {
      resolvePush = res
    })

    mockPushService.pushNow.mockImplementation(() => pushPromise)
    mockConflictService.countOpenConflicts.mockResolvedValue(0)
    mockPullService.pullNow.mockResolvedValue({ ok: true, code: 'SYNC_PULL_SUCCESS' })

    // Trigger first call
    const call1Promise = orchestratorService.syncAll()

    // Trigger second concurrent call while first is in flight
    const call2Result = await orchestratorService.syncAll()

    expect(call2Result.ok).toBe(false)
    expect(call2Result.code).toBe('SYNC_ALREADY_IN_PROGRESS')

    // Complete first call
    resolvePush({
      ok: true,
      code: 'SYNC_PUSH_SUCCESS',
      remaining: 0,
    })

    const call1Result = await call1Promise
    expect(call1Result.ok).toBe(true)
    expect(call1Result.code).toBe('SYNC_ALL_COMPLETED')

    expect(mockPushService.pushNow).toHaveBeenCalledTimes(1)
  })
})

describe('P16: Pinia Store (useSyncOrchestratorStore)', () => {
  let pinia
  let store
  let cloudStore
  let mockOrchestratorService

  beforeEach(() => {
    pinia = createPinia()
    setActivePinia(pinia)
    store = useSyncOrchestratorStore()
    cloudStore = useCloudSessionStore()

    cloudStore.user = { id: 1, email: 'test@example.com' }
    cloudStore.selectedBusiness = { id: 10, name: 'Biz 10' }
    cloudStore.selectedOutlet = { id: 101, name: 'Outlet 1' }
    cloudStore.cloudAccess = true
    cloudStore.deviceIdentifier = 'dev-uuid-123'
    cloudStore.registeredDeviceId = 77

    mockOrchestratorService = {
      syncAll: vi.fn(),
    }
    store.init({ orchestratorService: mockOrchestratorService })
  })

  it('TEST — CONTEXT SNAPSHOT: creates one snapshot of cloud session and passes to orchestrator without token', async () => {
    let capturedOptions
    mockOrchestratorService.syncAll.mockImplementation(async (opts) => {
      capturedOptions = opts
      return { ok: true, code: 'SYNC_ALL_COMPLETED' }
    })

    await store.syncAll()

    expect(capturedOptions).toBeDefined()
    expect(capturedOptions.context).toEqual({
      user: { id: 1, email: 'test@example.com' },
      selectedBusiness: { id: 10, name: 'Biz 10' },
      selectedOutlet: { id: 101, name: 'Outlet 1' },
      cloudAccess: true,
      deviceIdentifier: 'dev-uuid-123',
      registeredDeviceId: 77,
    })
    expect(capturedOptions.context.token).toBeUndefined()
  })

  it('TEST — CONTEXT IMMUTABILITY: changing cloudStore during sync does not affect snapshot used', async () => {
    let capturedContextDuringExecution

    mockOrchestratorService.syncAll.mockImplementation(async (opts) => {
      // simulate in-flight mutation of cloudStore
      cloudStore.selectedBusiness = { id: 999, name: 'Mutated Biz' }
      cloudStore.selectedOutlet = { id: 9991, name: 'Mutated Outlet' }
      capturedContextDuringExecution = opts.context
      return { ok: true, code: 'SYNC_ALL_COMPLETED' }
    })

    await store.syncAll()

    expect(capturedContextDuringExecution.selectedBusiness.id).toBe(10)
    expect(capturedContextDuringExecution.selectedOutlet.id).toBe(101)
  })

  it('TEST — STORE LOADING RACE: second concurrent syncAll returns SYNC_ALREADY_IN_PROGRESS and does not reset loading', async () => {
    let resolveService
    const deferredPromise = new Promise((resolve) => {
      resolveService = resolve
    })

    mockOrchestratorService.syncAll.mockImplementation(() => deferredPromise)

    // Call A begins
    const callAPromise = store.syncAll()
    expect(store.loading).toBe(true)

    // Call B is invoked while Call A is still active
    const callBResult = await store.syncAll()
    expect(callBResult.ok).toBe(false)
    expect(callBResult.code).toBe('SYNC_ALREADY_IN_PROGRESS')

    // Call A is still in progress -> loading MUST still be true
    expect(store.loading).toBe(true)

    // Call A finishes
    resolveService({ ok: true, code: 'SYNC_ALL_COMPLETED' })
    await callAPromise

    // Now loading is reset to false
    expect(store.loading).toBe(false)
    expect(mockOrchestratorService.syncAll).toHaveBeenCalledTimes(1)
  })

  it('TEST — lastSyncedAt: sets timestamp on SYNC_ALL_COMPLETED and leaves it unchanged on failure', async () => {
    expect(store.lastSyncedAt).toBeNull()

    // 1. Failure run
    mockOrchestratorService.syncAll.mockResolvedValue({
      ok: false,
      code: 'NETWORK_ERROR',
      message: 'Failed to push',
    })

    const failRes = await store.syncAll()
    expect(failRes.ok).toBe(false)
    expect(store.lastSyncedAt).toBeNull()
    expect(store.lastError).toBe('Failed to push')

    // 2. Success run
    mockOrchestratorService.syncAll.mockResolvedValue({
      ok: true,
      code: 'SYNC_ALL_COMPLETED',
      message: 'Sinkronisasi selesai.',
    })

    const successRes = await store.syncAll()
    expect(successRes.ok).toBe(true)
    expect(store.lastSyncedAt).not.toBeNull()
    expect(store.lastError).toBeNull()

    const initialTimestamp = store.lastSyncedAt

    // 3. Subsequent failure run should not overwrite lastSyncedAt
    mockOrchestratorService.syncAll.mockResolvedValue({
      ok: false,
      code: 'SYNC_CONFLICT',
      message: 'Conflict',
    })

    await store.syncAll()
    expect(store.lastSyncedAt).toBe(initialTimestamp)
  })
})

describe('P16: UI Integration in CloudLoginView', () => {
  let pinia
  let cloudStore
  let pushStore
  let pullStore
  let bootstrapStore
  let conflictStore
  let orchestratorStore

  beforeEach(() => {
    pinia = createPinia()
    setActivePinia(pinia)

    cloudStore = useCloudSessionStore()
    pushStore = useSyncPushStore()
    pullStore = useSyncPullStore()
    bootstrapStore = useSyncBootstrapStore()
    conflictStore = useSyncConflictStore()
    orchestratorStore = useSyncOrchestratorStore()

    // Set up ready cloud session
    cloudStore.user = { id: 1, email: 'test@example.com' }
    cloudStore.cloudAccess = true
    cloudStore.businesses = [{ id: 10, name: 'Biz 10', outlets: [{ id: 101, status: 'active' }] }]
    cloudStore.selectedBusiness = { id: 10, name: 'Biz 10' }
    cloudStore.selectedOutlet = { id: 101, name: 'Outlet 1' }
    cloudStore.deviceIdentifier = 'dev-uuid-123'
    cloudStore.registeredDeviceId = 77
  })

  it('renders "Sinkronkan Semua" button and maintains existing "Sync Sekarang" and "Tarik Data Cloud" buttons', async () => {
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

    expect(wrapper.find('#sync-all-btn').exists()).toBe(true)
    expect(wrapper.find('#sync-all-btn').text()).toContain('Sinkronkan Semua')

    // Existing buttons still exist
    expect(wrapper.find('#sync-now-btn').exists()).toBe(true)
    expect(wrapper.find('#pull-now-btn').exists()).toBe(true)
  })

  it('handles click on "Sinkronkan Semua" and displays success message and updates conflict/pending state', async () => {
    const mockOrchestratorService = {
      syncAll: vi.fn().mockResolvedValue({
        ok: true,
        code: 'SYNC_ALL_COMPLETED',
        stage: 'completed',
        push: { removedQueueIds: ['q1', 'q2'], remaining: 0 },
        pull: { applied: 5 },
      }),
    }
    orchestratorStore.init({ orchestratorService: mockOrchestratorService })

    const loadConflictsSpy = vi.spyOn(conflictStore, 'loadConflicts').mockResolvedValue()
    const refreshPendingSpy = vi.spyOn(pushStore, 'refreshPendingCount').mockResolvedValue()

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

    expect(mockOrchestratorService.syncAll).toHaveBeenCalledTimes(1)
    expect(loadConflictsSpy).toHaveBeenCalled()
    expect(refreshPendingSpy).toHaveBeenCalled()

    expect(wrapper.find('#sync-all-result-message').exists()).toBe(true)
    expect(wrapper.find('#sync-all-result-message').text()).toContain('Sinkronisasi selesai')
  })

  it('displays descriptive message when push has remaining items (SYNC_MORE_PUSH_PENDING)', async () => {
    const mockOrchestratorService = {
      syncAll: vi.fn().mockResolvedValue({
        ok: false,
        code: 'SYNC_MORE_PUSH_PENDING',
        stage: 'push',
        remaining: 20,
      }),
    }
    orchestratorStore.init({ orchestratorService: mockOrchestratorService })

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

    expect(wrapper.find('#sync-all-result-message').text()).toContain(
      'Masih ada data lokal yang menunggu dikirim. Tekan Sinkronkan Semua kembali.',
    )
  })

  it('displays descriptive message when push is blocked (SYNC_PUSH_BLOCKED_PENDING)', async () => {
    const mockOrchestratorService = {
      syncAll: vi.fn().mockResolvedValue({
        ok: false,
        code: 'SYNC_PUSH_BLOCKED_PENDING',
        stage: 'push',
        blocked: [{ queueId: 'q1' }],
      }),
    }
    orchestratorStore.init({ orchestratorService: mockOrchestratorService })

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

    expect(wrapper.find('#sync-all-result-message').text()).toContain(
      'Ada data lokal yang belum dapat disinkronkan dan perlu diperiksa.',
    )
  })

  it('TEST — MUTUAL EXCLUSION: orchestratorStore.loading disables all other sync & session action buttons', async () => {
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

    orchestratorStore.loading = true
    await flushPromises()

    expect(wrapper.find('#sync-all-btn').attributes('disabled')).toBeDefined()
    expect(wrapper.find('#sync-now-btn').attributes('disabled')).toBeDefined()
    expect(wrapper.find('#pull-now-btn').attributes('disabled')).toBeDefined()
    expect(wrapper.find('#bootstrap-btn').attributes('disabled')).toBeDefined()
    expect(wrapper.find('#cloud-logout-btn').attributes('disabled')).toBeDefined()
    expect(wrapper.find('#use-server-btn-c1').attributes('disabled')).toBeDefined()
    expect(wrapper.find('#keep-local-btn-c1').attributes('disabled')).toBeDefined()
  })

  it('TEST — MUTUAL EXCLUSION: push/pull loading disables "Sinkronkan Semua"', async () => {
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

    // 1. pushStore is busy
    pushStore.loading = true
    await flushPromises()
    expect(wrapper.find('#sync-all-btn').attributes('disabled')).toBeDefined()

    // Reset pushStore, set pullStore busy
    pushStore.loading = false
    pullStore.loading = true
    await flushPromises()
    expect(wrapper.find('#sync-all-btn').attributes('disabled')).toBeDefined()

    // Reset pullStore, set conflictStore busy
    pullStore.loading = false
    conflictStore.loading = true
    await flushPromises()
    expect(wrapper.find('#sync-all-btn').attributes('disabled')).toBeDefined()

    // Reset conflictStore, set bootstrapStore busy
    conflictStore.loading = false
    bootstrapStore.loading = true
    await flushPromises()
    expect(wrapper.find('#sync-all-btn').attributes('disabled')).toBeDefined()
  })

  it('TEST — RAPID DOUBLE CLICK: handler guard returns early if already busy', async () => {
    let resolveFirst
    const firstPromise = new Promise((res) => {
      resolveFirst = res
    })

    const mockOrchestratorService = {
      syncAll: vi.fn().mockImplementation(() => firstPromise),
    }
    orchestratorStore.init({ orchestratorService: mockOrchestratorService })

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

    // Click first time
    wrapper.find('#sync-all-btn').trigger('click')
    // Immediately click second time before first resolves
    wrapper.find('#sync-all-btn').trigger('click')

    await flushPromises()

    expect(mockOrchestratorService.syncAll).toHaveBeenCalledTimes(1)

    resolveFirst({
      ok: true,
      code: 'SYNC_ALL_COMPLETED',
      push: { removedQueueIds: [], remaining: 0 },
      pull: { applied: 0 },
    })
    await flushPromises()
  })
})
