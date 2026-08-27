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
      loadConflicts: vi.fn().mockResolvedValue({ version: 1, conflicts: [] }),
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

  it('TEST — MORE QUEUE: stops after 1 push if remaining > 0 (e.g. 50 items), returns SYNC_MORE_PUSH_PENDING, 0 pull calls', async () => {
    mockPushService.pushNow.mockResolvedValue({
      ok: true,
      code: 'SYNC_PUSH_SUCCESS',
      remaining: 50,
      removedQueueIds: ['q1'],
    })

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

  it('TEST — PULL ERROR: does not rollback successful push or retry push if pull fails', async () => {
    mockPushService.pushNow.mockResolvedValue({
      ok: true,
      code: 'SYNC_PUSH_SUCCESS',
      remaining: 0,
      removedQueueIds: ['q1'],
    })

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
  let mockOrchestratorService

  beforeEach(() => {
    pinia = createPinia()
    setActivePinia(pinia)
    store = useSyncOrchestratorStore()

    mockOrchestratorService = {
      syncAll: vi.fn(),
    }
    store.init({ orchestratorService: mockOrchestratorService })
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
    cloudStore.token = 'test-token'
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
})
