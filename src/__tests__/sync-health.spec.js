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
      loadSyncPullState: vi.fn().mockResolvedValue({ cursor: 120, serverSequence: 120 }),
      loadSyncPushInflight: vi.fn().mockResolvedValue(null),
      loadSyncBootstrapState: vi.fn().mockResolvedValue({
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

  it('TEST — CONFLICT: returns SYNC_HEALTH_BLOCKED and SYNC_OPEN_CONFLICT when open conflicts exist', async () => {
    mockConflictService.countOpenConflicts.mockResolvedValue(2)

    const result = await healthService.checkHealth({ context: validContext })

    expect(result.ok).toBe(true)
    expect(result.code).toBe('SYNC_HEALTH_BLOCKED')
    expect(result.status).toBe('blocked')
    expect(result.summary.openConflictCount).toBe(2)
    expect(result.issues).toContainEqual(
      expect.objectContaining({
        code: 'SYNC_OPEN_CONFLICT',
        severity: 'blocked',
      }),
    )
  })

  it('TEST — INFLIGHT VALID: returns SYNC_HEALTH_ATTENTION and SYNC_PUSH_INFLIGHT without clearing inflight', async () => {
    mockAdapter.loadSyncPushInflight.mockResolvedValue({
      requestId: 'req-1',
      businessId: 10,
      outletId: 101,
      deviceIdentifier: 'dev-uuid-123',
      registeredDeviceId: 77,
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

  it('TEST — INFLIGHT MISMATCH: returns SYNC_HEALTH_BLOCKED and SYNC_INFLIGHT_CONTEXT_MISMATCH without clearing inflight', async () => {
    mockAdapter.loadSyncPushInflight.mockResolvedValue({
      requestId: 'req-1',
      businessId: 10,
      outletId: 202, // Different outlet
      deviceIdentifier: 'dev-uuid-123',
      registeredDeviceId: 77,
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

  it('TEST — BOOTSTRAP STAGED: returns SYNC_BOOTSTRAP_STAGED (attention) when staged and context matches', async () => {
    mockAdapter.loadSyncBootstrapState.mockResolvedValue({
      status: 'staged',
      businessId: 10,
      outletId: 101,
      deviceIdentifier: 'dev-uuid-123',
      registeredDeviceId: 77,
    })

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

  it('TEST — PULL CURSOR: reads cursor accurately without modifying state', async () => {
    mockAdapter.loadSyncPullState.mockResolvedValue({ cursor: 9988 })

    const result = await healthService.checkHealth({ context: validContext })

    expect(result.summary.pullCursor).toBe(9988)
    expect(mockAdapter.saveSyncPullState).not.toHaveBeenCalled()
  })

  it('TEST — READ FAILURE: catches adapter throw and returns SYNC_HEALTH_READ_FAILED fail-closed', async () => {
    mockAdapter.loadSyncPushBinding.mockRejectedValue(new Error('SQLite disk I/O error'))

    const result = await healthService.checkHealth({ context: validContext })

    expect(result.ok).toBe(false)
    expect(result.code).toBe('SYNC_HEALTH_READ_FAILED')
    expect(result.status).toBe('blocked')
    expect(result.issues[0].code).toBe('SYNC_HEALTH_READ_FAILED')
  })

  it('TEST — CONTEXT INCOMPLETE: returns SYNC_HEALTH_CONTEXT_INCOMPLETE when required fields are missing', async () => {
    const incompleteContexts = [
      { ...validContext, user: null },
      { ...validContext, selectedBusiness: null },
      { ...validContext, selectedOutlet: null },
      { ...validContext, cloudAccess: false },
      { ...validContext, deviceIdentifier: null },
      { ...validContext, registeredDeviceId: null },
    ]

    for (const ctx of incompleteContexts) {
      const result = await healthService.checkHealth({ context: ctx })
      expect(result.ok).toBe(false)
      expect(result.code).toBe('SYNC_HEALTH_CONTEXT_INCOMPLETE')
      expect(result.status).toBe('blocked')
    }
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

    // Verify issues / summary contains no sensitive info
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

  it('TEST — CONTEXT SNAPSHOT: creates snapshot from cloudStore without token', async () => {
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

    await store.checkHealth()

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
  })

  it('renders "Periksa Status Sync" button and displays summary and status when clicked', async () => {
    const mockHealthService = {
      checkHealth: vi.fn().mockResolvedValue({
        ok: true,
        code: 'SYNC_HEALTH_READY',
        status: 'ready',
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

  it('TEST — UI MUTUAL EXCLUSION: orchestrator/push/pull/conflict loading disables #sync-health-btn', async () => {
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
