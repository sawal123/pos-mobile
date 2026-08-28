import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { mount, flushPromises } from '@vue/test-utils'
import { createSyncRecoveryService, RECOVERY_ACTIONS } from '@/services/sync/syncRecoveryService'
import { useSyncRecoveryStore } from '@/stores/syncRecoveryStore'
import { useSyncHealthStore } from '@/stores/syncHealthStore'
import { useCloudSessionStore } from '@/stores/cloudSessionStore'
import { useSyncPushStore } from '@/stores/syncPushStore'
import { useSyncPullStore } from '@/stores/syncPullStore'
import { useSyncBootstrapStore } from '@/stores/syncBootstrapStore'
import { useSyncConflictStore } from '@/stores/syncConflictStore'
import { useSyncOrchestratorStore } from '@/stores/syncOrchestratorStore'
import CloudLoginView from '@/views/settings/CloudLoginView.vue'

describe('P18: Manual Sync Recovery Center', () => {
  let mockHealthService
  let mockPushService
  let mockBootstrapService
  let mockOrchestratorService
  let mockConflictService
  let recoveryService
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

    mockHealthService = {
      checkHealth: vi.fn().mockResolvedValue({
        ok: true,
        code: 'SYNC_HEALTH_READY',
        status: 'ready',
        checkedAt: new Date().toISOString(),
        summary: {
          pendingCount: 0,
          openConflictCount: 0,
          hasInflight: false,
          bootstrapStatus: 'completed',
          pullCursor: 100,
        },
        issues: [],
      }),
    }

    mockPushService = {
      pushNow: vi.fn().mockResolvedValue({
        ok: true,
        code: 'SYNC_PUSH_SUCCESS',
        removedQueueIds: ['q-1'],
        remaining: 0,
      }),
    }

    mockBootstrapService = {
      bootstrapNow: vi.fn().mockResolvedValue({
        ok: true,
        code: 'BOOTSTRAP_STAGED',
        stagedCount: 10,
      }),
    }

    mockOrchestratorService = {
      syncAll: vi.fn().mockResolvedValue({
        ok: true,
        code: 'SYNC_ALL_COMPLETED',
        stage: 'completed',
        push: { removedQueueIds: ['q-1'] },
        pull: { applied: 2 },
      }),
    }

    mockConflictService = {
      useServer: vi.fn().mockResolvedValue({ ok: true }),
      keepLocal: vi.fn().mockResolvedValue({ ok: true }),
    }

    recoveryService = createSyncRecoveryService({
      healthService: mockHealthService,
      pushService: mockPushService,
      bootstrapService: mockBootstrapService,
      orchestratorService: mockOrchestratorService,
      conflictService: mockConflictService,
    })
  })

  // ── 51. Fresh health meski UI result stale ──────────────────────────────────
  it('51. Fresh health check overrides stale UI health: does not push if fresh health is READY', async () => {
    // Health service reports ready
    mockHealthService.checkHealth.mockResolvedValueOnce({
      ok: true,
      code: 'SYNC_HEALTH_READY',
      status: 'ready',
      summary: { pendingCount: 0, openConflictCount: 0, hasInflight: false },
      issues: [],
    })

    const result = await recoveryService.recover(RECOVERY_ACTIONS.RETRY_INFLIGHT, {
      context: validContext,
    })

    expect(result.ok).toBe(true)
    expect(result.code).toBe('SYNC_RECOVERY_NOT_REQUIRED')
    expect(mockPushService.pushNow).not.toHaveBeenCalled()
    expect(mockOrchestratorService.syncAll).not.toHaveBeenCalled()
    expect(mockBootstrapService.bootstrapNow).not.toHaveBeenCalled()
  })

  // ── 52. Test — RETRY_INFLIGHT ────────────────────────────────────────────────
  it('52. RETRY_INFLIGHT calls pushService.pushNow 1x when inflight issue exists without blocker', async () => {
    mockHealthService.checkHealth.mockResolvedValueOnce({
      ok: true,
      code: 'SYNC_HEALTH_ATTENTION',
      status: 'attention',
      summary: { pendingCount: 1, openConflictCount: 0, hasInflight: true },
      issues: [
        {
          code: 'SYNC_PUSH_INFLIGHT',
          severity: 'attention',
          message: 'Terdapat push in-flight.',
        },
      ],
    })

    const result = await recoveryService.recover(RECOVERY_ACTIONS.RETRY_INFLIGHT, {
      context: validContext,
    })

    expect(result.ok).toBe(true)
    expect(result.action).toBe('RETRY_INFLIGHT')
    expect(result.stage).toBe('push')
    expect(mockPushService.pushNow).toHaveBeenCalledTimes(1)
    expect(mockPushService.pushNow).toHaveBeenCalledWith({ context: validContext })
    expect(mockOrchestratorService.syncAll).not.toHaveBeenCalled()
    expect(mockBootstrapService.bootstrapNow).not.toHaveBeenCalled()
  })

  // ── 53. Test — Same request preserved by delegation ──────────────────────────
  it('53. RETRY_INFLIGHT delegates to pushService.pushNow without generating new requestId or clearing inflight', async () => {
    mockHealthService.checkHealth.mockResolvedValueOnce({
      ok: true,
      status: 'attention',
      summary: { hasInflight: true },
      issues: [{ code: 'SYNC_PUSH_INFLIGHT', severity: 'attention' }],
    })

    await recoveryService.recover(RECOVERY_ACTIONS.RETRY_INFLIGHT, { context: validContext })

    expect(mockPushService.pushNow).toHaveBeenCalledTimes(1)
    expect(mockPushService.pushNow).toHaveBeenCalledWith({ context: validContext })
  })

  // ── 54. Test — Conflict blocks retry ─────────────────────────────────────────
  it('54. SYNC_OPEN_CONFLICT blocks recovery and requires conflict resolution via P15', async () => {
    mockHealthService.checkHealth.mockResolvedValueOnce({
      ok: true,
      status: 'attention',
      summary: { openConflictCount: 1 },
      issues: [{ code: 'SYNC_OPEN_CONFLICT', severity: 'attention' }],
    })

    const result = await recoveryService.recover(RECOVERY_ACTIONS.RETRY_INFLIGHT, {
      context: validContext,
    })

    expect(result.ok).toBe(false)
    expect(result.code).toBe('SYNC_RECOVERY_CONFLICT_ACTION_REQUIRED')
    expect(result.message).toContain('Gunakan Cloud atau Pertahankan Lokal')
    expect(mockPushService.pushNow).not.toHaveBeenCalled()
    expect(mockBootstrapService.bootstrapNow).not.toHaveBeenCalled()
    expect(mockOrchestratorService.syncAll).not.toHaveBeenCalled()
    expect(mockConflictService.useServer).not.toHaveBeenCalled()
    expect(mockConflictService.keepLocal).not.toHaveBeenCalled()
  })

  // ── 55. Test — Metadata invalid ──────────────────────────────────────────────
  it('55. SYNC_HEALTH_METADATA_INVALID returns SYNC_RECOVERY_MANUAL_INTERVENTION_REQUIRED with 0 mutation calls', async () => {
    mockHealthService.checkHealth.mockResolvedValueOnce({
      ok: true,
      status: 'blocked',
      summary: { pendingCount: 1 },
      issues: [{ code: 'SYNC_HEALTH_METADATA_INVALID', severity: 'blocked' }],
    })

    const result = await recoveryService.recover(RECOVERY_ACTIONS.CONTINUE_PENDING, {
      context: validContext,
    })

    expect(result.ok).toBe(false)
    expect(result.code).toBe('SYNC_RECOVERY_MANUAL_INTERVENTION_REQUIRED')
    expect(mockPushService.pushNow).not.toHaveBeenCalled()
    expect(mockBootstrapService.bootstrapNow).not.toHaveBeenCalled()
    expect(mockOrchestratorService.syncAll).not.toHaveBeenCalled()
  })

  // ── 56. Test — Context mismatch ──────────────────────────────────────────────
  it.each([
    'SYNC_PUSH_BINDING_MISMATCH',
    'SYNC_PULL_BINDING_MISMATCH',
    'SYNC_INFLIGHT_CONTEXT_MISMATCH',
    'SYNC_BOOTSTRAP_CONTEXT_MISMATCH',
  ])('56. Context mismatch %s returns SYNC_RECOVERY_MANUAL_INTERVENTION_REQUIRED with no mutation', async (mismatchCode) => {
    mockHealthService.checkHealth.mockResolvedValueOnce({
      ok: true,
      status: 'blocked',
      summary: { pendingCount: 1 },
      issues: [{ code: mismatchCode, severity: 'blocked' }],
    })

    const result = await recoveryService.recover(RECOVERY_ACTIONS.CONTINUE_PENDING, {
      context: validContext,
    })

    expect(result.ok).toBe(false)
    expect(result.code).toBe('SYNC_RECOVERY_MANUAL_INTERVENTION_REQUIRED')
    expect(mockPushService.pushNow).not.toHaveBeenCalled()
    expect(mockBootstrapService.bootstrapNow).not.toHaveBeenCalled()
    expect(mockOrchestratorService.syncAll).not.toHaveBeenCalled()
  })

  // ── 57. Test — CONTINUE_PENDING ──────────────────────────────────────────────
  it('57. CONTINUE_PENDING calls orchestratorService.syncAll 1x when normal pending exists', async () => {
    mockHealthService.checkHealth.mockResolvedValueOnce({
      ok: true,
      status: 'attention',
      summary: { pendingCount: 3, openConflictCount: 0, hasInflight: false, bootstrapStatus: 'completed' },
      issues: [{ code: 'SYNC_PENDING_QUEUE', severity: 'attention' }],
    })

    const result = await recoveryService.recover(RECOVERY_ACTIONS.CONTINUE_PENDING, {
      context: validContext,
    })

    expect(result.ok).toBe(true)
    expect(result.action).toBe('CONTINUE_PENDING')
    expect(result.stage).toBe('completed')
    expect(mockOrchestratorService.syncAll).toHaveBeenCalledTimes(1)
    expect(mockOrchestratorService.syncAll).toHaveBeenCalledWith({ context: validContext })
    expect(mockPushService.pushNow).not.toHaveBeenCalled()
    expect(mockBootstrapService.bootstrapNow).not.toHaveBeenCalled()
  })

  // ── 58. Test — PREPARE_BOOTSTRAP ─────────────────────────────────────────────
  it('58. PREPARE_BOOTSTRAP calls bootstrapService.bootstrapNow 1x when bootstrap is not prepared', async () => {
    mockHealthService.checkHealth.mockResolvedValueOnce({
      ok: true,
      status: 'attention',
      summary: { pendingCount: 0, openConflictCount: 0, hasInflight: false, bootstrapStatus: 'not_prepared' },
      issues: [{ code: 'SYNC_BOOTSTRAP_NOT_PREPARED', severity: 'attention' }],
    })

    const result = await recoveryService.recover(RECOVERY_ACTIONS.PREPARE_BOOTSTRAP, {
      context: validContext,
    })

    expect(result.ok).toBe(true)
    expect(result.action).toBe('PREPARE_BOOTSTRAP')
    expect(result.stage).toBe('bootstrap')
    expect(mockBootstrapService.bootstrapNow).toHaveBeenCalledTimes(1)
    expect(mockBootstrapService.bootstrapNow).toHaveBeenCalledWith({ context: validContext })
    expect(mockOrchestratorService.syncAll).not.toHaveBeenCalled()
    expect(mockPushService.pushNow).not.toHaveBeenCalled()
  })

  // ── 59. Test — CONTINUE_BOOTSTRAP ────────────────────────────────────────────
  it('59. CONTINUE_BOOTSTRAP calls orchestratorService.syncAll 1x when bootstrap is staged with pending items', async () => {
    mockHealthService.checkHealth.mockResolvedValueOnce({
      ok: true,
      status: 'attention',
      summary: { pendingCount: 5, openConflictCount: 0, hasInflight: false, bootstrapStatus: 'staged' },
      issues: [
        { code: 'SYNC_BOOTSTRAP_STAGED', severity: 'attention' },
        { code: 'SYNC_PENDING_QUEUE', severity: 'attention' },
      ],
    })

    const result = await recoveryService.recover(RECOVERY_ACTIONS.CONTINUE_BOOTSTRAP, {
      context: validContext,
    })

    expect(result.ok).toBe(true)
    expect(result.action).toBe('CONTINUE_BOOTSTRAP')
    expect(result.stage).toBe('completed')
    expect(mockOrchestratorService.syncAll).toHaveBeenCalledTimes(1)
    expect(mockOrchestratorService.syncAll).toHaveBeenCalledWith({ context: validContext })
    expect(mockPushService.pushNow).not.toHaveBeenCalled()
    expect(mockBootstrapService.bootstrapNow).not.toHaveBeenCalled()
  })

  // ── 60. Test — READY ─────────────────────────────────────────────────────────
  it('60. Health READY returns SYNC_RECOVERY_NOT_REQUIRED for any recovery action with 0 mutations', async () => {
    mockHealthService.checkHealth.mockResolvedValue({
      ok: true,
      code: 'SYNC_HEALTH_READY',
      status: 'ready',
      summary: { pendingCount: 0, openConflictCount: 0, hasInflight: false, bootstrapStatus: 'completed' },
      issues: [],
    })

    for (const action of Object.values(RECOVERY_ACTIONS)) {
      const result = await recoveryService.recover(action, { context: validContext })
      expect(result.ok).toBe(true)
      expect(result.code).toBe('SYNC_RECOVERY_NOT_REQUIRED')
    }

    expect(mockPushService.pushNow).not.toHaveBeenCalled()
    expect(mockBootstrapService.bootstrapNow).not.toHaveBeenCalled()
    expect(mockOrchestratorService.syncAll).not.toHaveBeenCalled()
  })

  // ── 61. Test — Action not applicable ─────────────────────────────────────────
  it('61. Invoking RETRY_INFLIGHT when health only has SYNC_PENDING_QUEUE returns SYNC_RECOVERY_ACTION_NOT_APPLICABLE', async () => {
    mockHealthService.checkHealth.mockResolvedValueOnce({
      ok: true,
      status: 'attention',
      summary: { pendingCount: 2, hasInflight: false },
      issues: [{ code: 'SYNC_PENDING_QUEUE', severity: 'attention' }],
    })

    const result = await recoveryService.recover(RECOVERY_ACTIONS.RETRY_INFLIGHT, {
      context: validContext,
    })

    expect(result.ok).toBe(false)
    expect(result.code).toBe('SYNC_RECOVERY_ACTION_NOT_APPLICABLE')
    expect(mockPushService.pushNow).not.toHaveBeenCalled()
    expect(mockOrchestratorService.syncAll).not.toHaveBeenCalled()
  })

  // ── 62. Test — Priority inflight ─────────────────────────────────────────────
  it('62. getRecoveryPlan recommends RETRY_INFLIGHT over CONTINUE_PENDING when both inflight and pending exist', () => {
    const healthResult = {
      ok: true,
      status: 'attention',
      summary: { pendingCount: 5, hasInflight: true, openConflictCount: 0 },
      issues: [
        { code: 'SYNC_PUSH_INFLIGHT', severity: 'attention' },
        { code: 'SYNC_PENDING_QUEUE', severity: 'attention' },
      ],
    }

    const plan = recoveryService.getRecoveryPlan({ healthResult })

    expect(plan.recommendedAction).toBe(RECOVERY_ACTIONS.RETRY_INFLIGHT)
    expect(plan.availableActions).toEqual([RECOVERY_ACTIONS.RETRY_INFLIGHT])
  })

  // ── 63. Test — Blocked priority ──────────────────────────────────────────────
  it('63. getRecoveryPlan returns empty availableActions and null recommendedAction when blocked issue exists', () => {
    const healthResult = {
      ok: true,
      status: 'blocked',
      summary: { pendingCount: 5, hasInflight: false, openConflictCount: 0 },
      issues: [
        { code: 'SYNC_HEALTH_METADATA_INVALID', severity: 'blocked' },
        { code: 'SYNC_PENDING_QUEUE', severity: 'attention' },
      ],
    }

    const plan = recoveryService.getRecoveryPlan({ healthResult })

    expect(plan.recommendedAction).toBeNull()
    expect(plan.availableActions).toEqual([])
    expect(plan.message).toContain('tidak aman untuk dipulihkan otomatis')
  })

  // ── 64. Test — Store context sanitization ────────────────────────────────────
  it('64. Sanitizes options.context: strips token, password, authorization, credentials', async () => {
    const dirtyContext = {
      ...validContext,
      token: 'secret-token-123',
      password: 'secret-password-xyz',
      authorization: 'Bearer secret',
      credentials: { secret: true },
    }

    mockHealthService.checkHealth.mockResolvedValueOnce({
      ok: true,
      status: 'attention',
      summary: { pendingCount: 1, hasInflight: false, openConflictCount: 0 },
      issues: [{ code: 'SYNC_PENDING_QUEUE', severity: 'attention' }],
    })

    await recoveryService.recover(RECOVERY_ACTIONS.CONTINUE_PENDING, { context: dirtyContext })

    const calledHealthContext = mockHealthService.checkHealth.mock.calls[0][0].context
    expect(calledHealthContext.token).toBeUndefined()
    expect(calledHealthContext.password).toBeUndefined()
    expect(calledHealthContext.authorization).toBeUndefined()
    expect(calledHealthContext.credentials).toBeUndefined()
    expect(calledHealthContext.user).toEqual({ id: 1, email: 'test@example.com' })

    const calledSyncContext = mockOrchestratorService.syncAll.mock.calls[0][0].context
    expect(calledSyncContext.token).toBeUndefined()
    expect(calledSyncContext.password).toBeUndefined()
  })

  // ── 65. Test — Same context snapshot ─────────────────────────────────────────
  it('65. Uses the exact same context snapshot across health check and target recovery action', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)

    const cloudStore = useCloudSessionStore()
    cloudStore.user = { id: 1, email: 'bizA@example.com' }
    cloudStore.selectedBusiness = { id: 10, name: 'Business A' }
    cloudStore.selectedOutlet = { id: 101, name: 'Outlet A' }
    cloudStore.cloudAccess = true
    cloudStore.deviceIdentifier = 'dev-uuid-123'
    cloudStore.registeredDeviceId = 77

    const recoveryStore = useSyncRecoveryStore()
    recoveryStore.init({ recoveryService })

    mockHealthService.checkHealth.mockImplementation(async () => {
      // Simulate context mutation in cloudStore while health check is pending
      cloudStore.selectedBusiness = { id: 20, name: 'Business B' }
      cloudStore.selectedOutlet = { id: 202, name: 'Outlet B' }

      return {
        ok: true,
        status: 'attention',
        summary: { pendingCount: 1, hasInflight: false, openConflictCount: 0 },
        issues: [{ code: 'SYNC_PENDING_QUEUE', severity: 'attention' }],
      }
    })

    await recoveryStore.recover(RECOVERY_ACTIONS.CONTINUE_PENDING)

    const healthCallContext = mockHealthService.checkHealth.mock.calls[0][0].context
    const orchCallContext = mockOrchestratorService.syncAll.mock.calls[0][0].context

    expect(healthCallContext.selectedBusiness.id).toBe(10)
    expect(orchCallContext.selectedBusiness.id).toBe(10)
  })

  // ── 66. Test — Store reentrant ───────────────────────────────────────────────
  it('66. Store reentrant guard: rejects concurrent recovery and maintains loading state', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)

    const cloudStore = useCloudSessionStore()
    cloudStore.user = { id: 1, email: 'test@example.com' }
    cloudStore.selectedBusiness = { id: 10, name: 'Biz 10' }
    cloudStore.selectedOutlet = { id: 101, name: 'Outlet 1' }
    cloudStore.cloudAccess = true
    cloudStore.deviceIdentifier = 'dev-uuid-123'
    cloudStore.registeredDeviceId = 77

    const recoveryStore = useSyncRecoveryStore()
    recoveryStore.init({ recoveryService })

    let resolveHealth
    mockHealthService.checkHealth.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveHealth = resolve
        }),
    )

    const firstPromise = recoveryStore.recover(RECOVERY_ACTIONS.CONTINUE_PENDING)
    expect(recoveryStore.loading).toBe(true)

    // Second recovery call while first is in progress
    const secondResult = await recoveryStore.recover(RECOVERY_ACTIONS.CONTINUE_PENDING)
    expect(secondResult.ok).toBe(false)
    expect(secondResult.code).toBe('SYNC_RECOVERY_ALREADY_IN_PROGRESS')
    expect(recoveryStore.loading).toBe(true)

    resolveHealth({
      ok: true,
      status: 'attention',
      summary: { pendingCount: 1, hasInflight: false },
      issues: [{ code: 'SYNC_PENDING_QUEUE', severity: 'attention' }],
    })

    const firstResult = await firstPromise
    expect(firstResult.ok).toBe(true)
    expect(recoveryStore.loading).toBe(false)
  })

  // ── 67. Test — Service exception ─────────────────────────────────────────────
  it('67. Service exception returns SYNC_RECOVERY_ACTION_FAILED without throwing to UI', async () => {
    mockHealthService.checkHealth.mockResolvedValueOnce({
      ok: true,
      status: 'attention',
      summary: { pendingCount: 1, hasInflight: false },
      issues: [{ code: 'SYNC_PENDING_QUEUE', severity: 'attention' }],
    })

    mockOrchestratorService.syncAll.mockRejectedValueOnce(new Error('Network socket hang up'))

    const result = await recoveryService.recover(RECOVERY_ACTIONS.CONTINUE_PENDING, {
      context: validContext,
    })

    expect(result.ok).toBe(false)
    expect(result.code).toBe('SYNC_RECOVERY_ACTION_FAILED')
    expect(result.message).toBe('Network socket hang up')
  })

  // ── 68. Test — Zero destructive calls ────────────────────────────────────────
  it('68. P18 never performs direct destructive storage adapter mutations', async () => {
    const mockAdapter = {
      clearSyncPushInflight: vi.fn(),
      saveSyncPushBinding: vi.fn(),
      saveSyncPullBinding: vi.fn(),
      saveSyncPullState: vi.fn(),
      saveSyncConflicts: vi.fn(),
      deleteSyncQueueItem: vi.fn(),
      deleteSyncQueueItemIfUnchanged: vi.fn(),
    }

    mockHealthService.checkHealth.mockResolvedValueOnce({
      ok: true,
      status: 'attention',
      summary: { hasInflight: true },
      issues: [{ code: 'SYNC_PUSH_INFLIGHT', severity: 'attention' }],
    })

    await recoveryService.recover(RECOVERY_ACTIONS.RETRY_INFLIGHT, { context: validContext })

    expect(mockAdapter.clearSyncPushInflight).not.toHaveBeenCalled()
    expect(mockAdapter.saveSyncPushBinding).not.toHaveBeenCalled()
    expect(mockAdapter.saveSyncPullBinding).not.toHaveBeenCalled()
    expect(mockAdapter.saveSyncPullState).not.toHaveBeenCalled()
    expect(mockAdapter.saveSyncConflicts).not.toHaveBeenCalled()
    expect(mockAdapter.deleteSyncQueueItem).not.toHaveBeenCalled()
    expect(mockAdapter.deleteSyncQueueItemIfUnchanged).not.toHaveBeenCalled()
  })

  // ── 69. Test — UI safe action ────────────────────────────────────────────────
  it('69. UI renders "Coba Ulang Push" button when inflight exists and does not render destructive buttons', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)

    const cloudStore = useCloudSessionStore()
    cloudStore.token = 'valid-token'
    cloudStore.user = { id: 1, email: 'test@example.com' }
    cloudStore.businesses = [{ id: 10, name: 'Biz 10', outlets: [{ id: 101, name: 'Outlet 1', status: 'active' }] }]
    cloudStore.selectedBusiness = { id: 10, name: 'Biz 10' }
    cloudStore.selectedOutlet = { id: 101, name: 'Outlet 1' }
    cloudStore.cloudAccess = true
    cloudStore.registeredDeviceId = 77
    cloudStore.deviceIdentifier = 'dev-uuid-123'

    const syncHealthStore = useSyncHealthStore()
    syncHealthStore.lastResult = {
      ok: true,
      code: 'SYNC_HEALTH_ATTENTION',
      status: 'attention',
      summary: { pendingCount: 1, openConflictCount: 0, hasInflight: true },
      issues: [{ code: 'SYNC_PUSH_INFLIGHT', severity: 'attention', message: 'Ada push in-flight.' }],
    }

    const syncRecoveryStore = useSyncRecoveryStore()
    syncRecoveryStore.init({ recoveryService })

    const wrapper = mount(CloudLoginView, {
      global: {
        plugins: [pinia],
        stubs: {
          BaseCard: { template: '<div class="base-card"><slot /></div>' },
          BaseButton: {
            props: ['id', 'variant', 'size', 'disabled', 'loading'],
            template: '<button :id="id" :disabled="disabled"><slot /></button>',
          },
          BaseInput: { template: '<input />' },
        },
      },
    })

    await flushPromises()

    expect(wrapper.find('#cloud-recovery-section').exists()).toBe(true)
    const retryBtn = wrapper.find('#recovery-retry-inflight-btn')
    expect(retryBtn.exists()).toBe(true)
    expect(retryBtn.text()).toContain('Coba Ulang Push')

    expect(wrapper.html()).not.toContain('Reset')
    expect(wrapper.html()).not.toContain('Clear')
    expect(wrapper.html()).not.toContain('Overwrite')
  })

  // ── 70. Test — UI blocked ────────────────────────────────────────────────────
  it('70. UI blocked state shows safe message and no recovery mutation buttons', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)

    const cloudStore = useCloudSessionStore()
    cloudStore.token = 'valid-token'
    cloudStore.user = { id: 1, email: 'test@example.com' }
    cloudStore.businesses = [{ id: 10, name: 'Biz 10', outlets: [{ id: 101, name: 'Outlet 1', status: 'active' }] }]
    cloudStore.selectedBusiness = { id: 10, name: 'Biz 10' }
    cloudStore.selectedOutlet = { id: 101, name: 'Outlet 1' }
    cloudStore.cloudAccess = true
    cloudStore.registeredDeviceId = 77
    cloudStore.deviceIdentifier = 'dev-uuid-123'

    const syncHealthStore = useSyncHealthStore()
    syncHealthStore.lastResult = {
      ok: true,
      status: 'blocked',
      summary: { pendingCount: 1 },
      issues: [{ code: 'SYNC_HEALTH_METADATA_INVALID', severity: 'blocked', message: 'Metadata rusak.' }],
    }

    const syncRecoveryStore = useSyncRecoveryStore()
    syncRecoveryStore.init({ recoveryService })

    const wrapper = mount(CloudLoginView, {
      global: {
        plugins: [pinia],
        stubs: {
          BaseCard: { template: '<div class="base-card"><slot /></div>' },
          BaseButton: {
            props: ['id', 'variant', 'size', 'disabled', 'loading'],
            template: '<button :id="id" :disabled="disabled"><slot /></button>',
          },
          BaseInput: { template: '<input />' },
        },
      },
    })

    await flushPromises()

    expect(wrapper.find('#recovery-retry-inflight-btn').exists()).toBe(false)
    expect(wrapper.find('#recovery-continue-pending-btn').exists()).toBe(false)
    expect(wrapper.find('#recovery-prepare-bootstrap-btn').exists()).toBe(false)
    expect(wrapper.find('#recovery-continue-bootstrap-btn').exists()).toBe(false)
    expect(wrapper.find('#recovery-plan-message').text()).toContain('tidak aman untuk dipulihkan otomatis')
  })

  // ── 71. Test — UI conflict ───────────────────────────────────────────────────
  it('71. UI conflict directs user to conflict section without duplicating resolution buttons', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)

    const cloudStore = useCloudSessionStore()
    cloudStore.token = 'valid-token'
    cloudStore.user = { id: 1, email: 'test@example.com' }
    cloudStore.businesses = [{ id: 10, name: 'Biz 10', outlets: [{ id: 101, name: 'Outlet 1', status: 'active' }] }]
    cloudStore.selectedBusiness = { id: 10, name: 'Biz 10' }
    cloudStore.selectedOutlet = { id: 101, name: 'Outlet 1' }
    cloudStore.cloudAccess = true
    cloudStore.registeredDeviceId = 77
    cloudStore.deviceIdentifier = 'dev-uuid-123'

    const syncHealthStore = useSyncHealthStore()
    syncHealthStore.lastResult = {
      ok: true,
      status: 'attention',
      summary: { openConflictCount: 1 },
      issues: [{ code: 'SYNC_OPEN_CONFLICT', severity: 'attention', message: 'Terdapat konflik.' }],
    }

    const syncRecoveryStore = useSyncRecoveryStore()
    syncRecoveryStore.init({ recoveryService })

    const wrapper = mount(CloudLoginView, {
      global: {
        plugins: [pinia],
        stubs: {
          BaseCard: { template: '<div class="base-card"><slot /></div>' },
          BaseButton: {
            props: ['id', 'variant', 'size', 'disabled', 'loading'],
            template: '<button :id="id" :disabled="disabled"><slot /></button>',
          },
          BaseInput: { template: '<input />' },
        },
      },
    })

    await flushPromises()

    expect(wrapper.find('#recovery-retry-inflight-btn').exists()).toBe(false)
    expect(wrapper.find('#recovery-plan-message').text()).toContain('Selesaikan konflik terlebih dahulu')
  })

  // ── 72. Test — UI mutual exclusion ───────────────────────────────────────────
  it('72. UI disables all action buttons when syncRecoveryStore.loading is true, and disables recovery buttons when health check is loading', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)

    const cloudStore = useCloudSessionStore()
    cloudStore.token = 'valid-token'
    cloudStore.user = { id: 1, email: 'test@example.com' }
    cloudStore.businesses = [{ id: 10, name: 'Biz 10', outlets: [{ id: 101, name: 'Outlet 1', status: 'active' }] }]
    cloudStore.selectedBusiness = { id: 10, name: 'Biz 10' }
    cloudStore.selectedOutlet = { id: 101, name: 'Outlet 1' }
    cloudStore.cloudAccess = true
    cloudStore.registeredDeviceId = 77
    cloudStore.deviceIdentifier = 'dev-uuid-123'

    const syncHealthStore = useSyncHealthStore()
    syncHealthStore.lastResult = {
      ok: true,
      status: 'attention',
      summary: { hasInflight: true },
      issues: [{ code: 'SYNC_PUSH_INFLIGHT', severity: 'attention' }],
    }

    const syncRecoveryStore = useSyncRecoveryStore()
    syncRecoveryStore.init({ recoveryService })

    const wrapper = mount(CloudLoginView, {
      global: {
        plugins: [pinia],
        stubs: {
          BaseCard: { template: '<div class="base-card"><slot /></div>' },
          BaseButton: {
            props: ['id', 'variant', 'size', 'disabled', 'loading'],
            template: '<button :id="id" :disabled="disabled"><slot /></button>',
          },
          BaseInput: { template: '<input />' },
        },
      },
    })

    // 1. When syncRecoveryStore.loading is true
    syncRecoveryStore.loading = true
    await flushPromises()

    expect(wrapper.find('#sync-all-btn').attributes('disabled')).toBeDefined()
    expect(wrapper.find('#sync-now-btn').attributes('disabled')).toBeDefined()
    expect(wrapper.find('#pull-now-btn').attributes('disabled')).toBeDefined()
    expect(wrapper.find('#sync-health-btn').attributes('disabled')).toBeDefined()
    expect(wrapper.find('#cloud-logout-btn').attributes('disabled')).toBeDefined()
    expect(wrapper.find('#recovery-retry-inflight-btn').attributes('disabled')).toBeDefined()

    // 2. When syncRecoveryStore.loading is false but syncHealthStore.loading is true
    syncRecoveryStore.loading = false
    syncHealthStore.loading = true
    await flushPromises()

    expect(wrapper.find('#recovery-retry-inflight-btn').attributes('disabled')).toBeDefined()
  })

  // ── Extra: Health Check Read Failure ─────────────────────────────────────────
  it('Health read failure or incomplete context returns SYNC_RECOVERY_HEALTH_CHECK_FAILED', async () => {
    mockHealthService.checkHealth.mockResolvedValueOnce({
      ok: false,
      code: 'SYNC_HEALTH_READ_FAILED',
      status: 'blocked',
      issues: [{ code: 'SYNC_HEALTH_READ_FAILED', severity: 'blocked' }],
    })

    const result = await recoveryService.recover(RECOVERY_ACTIONS.RETRY_INFLIGHT, {
      context: validContext,
    })

    expect(result.ok).toBe(false)
    expect(result.code).toBe('SYNC_RECOVERY_HEALTH_CHECK_FAILED')
    expect(mockPushService.pushNow).not.toHaveBeenCalled()

    mockHealthService.checkHealth.mockResolvedValueOnce({
      ok: false,
      code: 'SYNC_HEALTH_CONTEXT_INCOMPLETE',
      status: 'blocked',
      issues: [{ code: 'SYNC_HEALTH_CONTEXT_INCOMPLETE', severity: 'blocked' }],
    })

    const result2 = await recoveryService.recover(RECOVERY_ACTIONS.RETRY_INFLIGHT, {
      context: validContext,
    })

    expect(result2.ok).toBe(false)
    expect(result2.code).toBe('SYNC_RECOVERY_HEALTH_CHECK_FAILED')
  })

  // ── Extra: Attention without safe action ─────────────────────────────────────
  it('Attention state without recognizable safe condition returns SYNC_RECOVERY_NO_SAFE_ACTION', async () => {
    mockHealthService.checkHealth.mockResolvedValueOnce({
      ok: true,
      status: 'attention',
      summary: { pendingCount: 0, openConflictCount: 0, hasInflight: false, bootstrapStatus: 'completed' },
      issues: [{ code: 'UNKNOWN_ATTENTION_ISSUE', severity: 'attention' }],
    })

    const result = await recoveryService.recover(RECOVERY_ACTIONS.CONTINUE_PENDING, {
      context: validContext,
    })

    expect(result.ok).toBe(false)
    expect(result.code).toBe('SYNC_RECOVERY_ACTION_NOT_APPLICABLE')
  })

  // ── Extra: UI clicking recovery button executes recover and resets health store ──
  it('UI clicking recovery button triggers recover, resets health store, and displays result message', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)

    const cloudStore = useCloudSessionStore()
    cloudStore.token = 'valid-token'
    cloudStore.user = { id: 1, email: 'test@example.com' }
    cloudStore.businesses = [{ id: 10, name: 'Biz 10', outlets: [{ id: 101, name: 'Outlet 1', status: 'active' }] }]
    cloudStore.selectedBusiness = { id: 10, name: 'Biz 10' }
    cloudStore.selectedOutlet = { id: 101, name: 'Outlet 1' }
    cloudStore.cloudAccess = true
    cloudStore.registeredDeviceId = 77
    cloudStore.deviceIdentifier = 'dev-uuid-123'

    const syncHealthStore = useSyncHealthStore()
    syncHealthStore.lastResult = {
      ok: true,
      status: 'attention',
      summary: { hasInflight: true },
      issues: [{ code: 'SYNC_PUSH_INFLIGHT', severity: 'attention' }],
    }

    mockHealthService.checkHealth.mockResolvedValueOnce({
      ok: true,
      status: 'attention',
      summary: { hasInflight: true },
      issues: [{ code: 'SYNC_PUSH_INFLIGHT', severity: 'attention' }],
    })

    const syncRecoveryStore = useSyncRecoveryStore()
    syncRecoveryStore.init({ recoveryService })

    const wrapper = mount(CloudLoginView, {
      global: {
        plugins: [pinia],
        stubs: {
          BaseCard: { template: '<div class="base-card"><slot /></div>' },
          BaseButton: {
            props: ['id', 'variant', 'size', 'disabled', 'loading'],
            template: '<button :id="id" :disabled="disabled"><slot /></button>',
          },
          BaseInput: { template: '<input />' },
        },
      },
    })

    await flushPromises()

    const retryBtn = wrapper.find('#recovery-retry-inflight-btn')
    expect(retryBtn.exists()).toBe(true)

    await retryBtn.trigger('click')
    await flushPromises()

    expect(mockPushService.pushNow).toHaveBeenCalledTimes(1)
    expect(syncHealthStore.lastResult).toBeNull()
    expect(wrapper.find('#recovery-result-message').exists()).toBe(true)
  })

  // ── Extra: Store init with adapter / services directly ───────────────────────
  it('Store init creates recovery service when healthService and subservices are passed', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)

    const syncRecoveryStore = useSyncRecoveryStore()
    syncRecoveryStore.init({
      healthService: mockHealthService,
      pushService: mockPushService,
      bootstrapService: mockBootstrapService,
      orchestratorService: mockOrchestratorService,
      conflictService: mockConflictService,
    })

    expect(syncRecoveryStore.getRecoveryService()).not.toBeNull()

    syncRecoveryStore.resetResult()
    expect(syncRecoveryStore.lastAction).toBeNull()
    expect(syncRecoveryStore.lastResult).toBeNull()
    expect(syncRecoveryStore.lastError).toBeNull()
  })
})

