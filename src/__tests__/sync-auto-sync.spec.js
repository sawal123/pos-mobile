import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { mount, flushPromises } from '@vue/test-utils'
import { createMemoryAdapter } from '@/services/database/memoryAdapter'
import {
  createSyncAutoSyncService,
  AUTO_SYNC_TRIGGER_ONLINE,
  AUTO_SYNC_TRIGGER_RESUME,
  AUTO_SYNC_COOLDOWN_MS,
} from '@/services/sync/syncAutoSyncService'
import {
  createSyncActivityLogService,
  isValidSummary,
} from '@/services/sync/syncActivityLogService'
import { useSyncAutoSyncStore } from '@/stores/syncAutoSyncStore'
import { useCloudSessionStore } from '@/stores/cloudSessionStore'
import { useSyncPushStore } from '@/stores/syncPushStore'
import { useSyncPullStore } from '@/stores/syncPullStore'
import { useSyncBootstrapStore } from '@/stores/syncBootstrapStore'
import { useSyncConflictStore } from '@/stores/syncConflictStore'
import { useSyncOrchestratorStore } from '@/stores/syncOrchestratorStore'
import { useSyncHealthStore } from '@/stores/syncHealthStore'
import { useSyncRecoveryStore } from '@/stores/syncRecoveryStore'
import { useSyncActivityLogStore } from '@/stores/syncActivityLogStore'
import CloudLoginView from '@/views/settings/CloudLoginView.vue'

describe('P20: Safe Foreground Auto Sync Trigger', () => {
  let pinia
  let adapter
  let activityLogService
  let autoSyncService
  let healthService
  let orchestratorService
  let currentTime

  function setupAuthenticatedSession(cloudStore) {
    cloudStore.user = { id: 1, email: 'owner@example.com' }
    cloudStore.businesses = [
      {
        id: 10,
        name: 'Biz 10',
        cloud_access: true,
        outlets: [{ id: 20, name: 'Outlet 1', status: 'active' }],
      },
      {
        id: 99,
        name: 'Biz 99',
        cloud_access: true,
        outlets: [{ id: 88, name: 'Outlet 88', status: 'active' }],
      },
    ]
    cloudStore.selectedBusiness = { id: 10, name: 'Biz 10' }
    cloudStore.selectedOutlet = { id: 20, name: 'Outlet 1' }
    cloudStore.cloudAccess = true
    cloudStore.registeredDeviceId = 77
    cloudStore.deviceIdentifier = 'dev-uuid-123'
  }

  function getValidContext() {
    return {
      user: { id: 1 },
      selectedBusiness: { id: 10 },
      selectedOutlet: { id: 20 },
      cloudAccess: true,
      registeredDeviceId: 77,
      deviceIdentifier: 'dev-uuid-123',
    }
  }

  beforeEach(async () => {
    Object.defineProperty(document, 'visibilityState', {
      value: 'visible',
      configurable: true,
    })
    currentTime = 1756375200000 // 2025-08-28T10:00:00.000Z
    pinia = createPinia()
    setActivePinia(pinia)
    adapter = createMemoryAdapter()
    await adapter.initialize()

    activityLogService = createSyncActivityLogService({ adapter })

    healthService = {
      checkHealth: vi.fn().mockResolvedValue({
        ok: true,
        status: 'ready',
        code: 'SYNC_HEALTH_READY',
        summary: { pendingCount: 0, openConflictCount: 0, hasInflight: false },
        issues: [],
      }),
    }

    orchestratorService = {
      syncAll: vi.fn().mockResolvedValue({
        ok: true,
        code: 'SYNC_ALL_COMPLETED',
        push: { removedQueueIds: [] },
        pull: { applied: 0 },
        stage: 'done',
      }),
    }

    autoSyncService = createSyncAutoSyncService({
      adapter,
      healthService,
      orchestratorService,
      activityLogService,
      now: () => currentTime,
    })
  })

  afterEach(() => {
    const autoSyncStore = useSyncAutoSyncStore()
    autoSyncStore.stopListeners()
    vi.restoreAllMocks()
  })

  // 81. Test default OFF
  it('81. default OFF when no durable setting exists and skips auto sync', async () => {
    const res = await autoSyncService.runOnce({
      context: getValidContext(),
      trigger: AUTO_SYNC_TRIGGER_ONLINE,
      online: true,
      isForeground: true,
    })

    expect(res.ok).toBe(false)
    expect(res.code).toBe('AUTO_SYNC_DISABLED')
    expect(healthService.checkHealth).not.toHaveBeenCalled()
    expect(orchestratorService.syncAll).not.toHaveBeenCalled()
  })

  // 82. Test enable
  it('82. sets enabled to true with current context and does not trigger sync on enable', async () => {
    const setRes = await autoSyncService.setEnabled({
      context: getValidContext(),
      enabled: true,
    })

    expect(setRes.ok).toBe(true)
    expect(setRes.enabled).toBe(true)

    const pref = await autoSyncService.loadPreference({ context: getValidContext() })
    expect(pref.ok).toBe(true)
    expect(pref.enabled).toBe(true)
    expect(pref.contextMatches).toBe(true)
    expect(pref.preference.context.businessId).toBe(10)

    expect(healthService.checkHealth).not.toHaveBeenCalled()
    expect(orchestratorService.syncAll).not.toHaveBeenCalled()
  })

  // 83. Test disable
  it('83. sets enabled to false without modifying sync queue or conflicts', async () => {
    await adapter.upsertSyncQueueItems([{ id: 'q1', entityType: 'product', entityId: 'p1', operation: 'insert' }])
    await adapter.saveSyncConflicts({ version: 1, conflicts: [{ id: 'c1' }] })

    const setRes = await autoSyncService.setEnabled({
      context: getValidContext(),
      enabled: false,
    })

    expect(setRes.ok).toBe(true)
    expect(setRes.enabled).toBe(false)

    expect(await adapter.countSyncQueueItems()).toBe(1)
    expect(await adapter.loadSyncConflicts()).toEqual({ version: 1, conflicts: [{ id: 'c1' }] })
  })

  // 84. Test context binding
  it('84. skips auto sync when enabled preference context does not match current context', async () => {
    await autoSyncService.setEnabled({
      context: getValidContext(),
      enabled: true,
    })

    // Switch context to Business 99 / Outlet 88
    const switchedContext = {
      ...getValidContext(),
      selectedBusiness: { id: 99 },
      selectedOutlet: { id: 88 },
    }

    const res = await autoSyncService.runOnce({
      context: switchedContext,
      trigger: AUTO_SYNC_TRIGGER_ONLINE,
      online: true,
      isForeground: true,
    })

    expect(res.ok).toBe(false)
    expect(res.code).toBe('AUTO_SYNC_CONTEXT_MISMATCH')
    expect(healthService.checkHealth).not.toHaveBeenCalled()
    expect(orchestratorService.syncAll).not.toHaveBeenCalled()
  })

  // 85. Test free / no cloud
  it('85. skips auto sync when cloudAccess is false or user is missing', async () => {
    const freeContext = {
      ...getValidContext(),
      cloudAccess: false,
    }

    const res = await autoSyncService.runOnce({
      context: freeContext,
      trigger: AUTO_SYNC_TRIGGER_ONLINE,
      online: true,
      isForeground: true,
    })

    expect(res.ok).toBe(false)
    expect(res.code).toBe('AUTO_SYNC_CONTEXT_UNAVAILABLE')
    expect(healthService.checkHealth).not.toHaveBeenCalled()
  })

  // 86. Test offline
  it('86. skips auto sync when online parameter is false', async () => {
    await autoSyncService.setEnabled({
      context: getValidContext(),
      enabled: true,
    })

    const res = await autoSyncService.runOnce({
      context: getValidContext(),
      trigger: AUTO_SYNC_TRIGGER_ONLINE,
      online: false,
      isForeground: true,
    })

    expect(res.ok).toBe(false)
    expect(res.code).toBe('AUTO_SYNC_OFFLINE')
    expect(healthService.checkHealth).not.toHaveBeenCalled()
  })

  // 87. Test ready
  it('87. runs syncAll exactly once when health is READY and issues is empty', async () => {
    await autoSyncService.setEnabled({
      context: getValidContext(),
      enabled: true,
    })

    const res = await autoSyncService.runOnce({
      context: getValidContext(),
      trigger: AUTO_SYNC_TRIGGER_ONLINE,
      online: true,
      isForeground: true,
    })

    expect(res.ok).toBe(true)
    expect(res.autoSync).toBe(true)
    expect(healthService.checkHealth).toHaveBeenCalledTimes(1)
    expect(orchestratorService.syncAll).toHaveBeenCalledTimes(1)
  })

  // 88. Test pending only
  it('88. runs syncAll when health is ATTENTION with only SYNC_PENDING_QUEUE issue', async () => {
    await autoSyncService.setEnabled({
      context: getValidContext(),
      enabled: true,
    })

    healthService.checkHealth.mockResolvedValueOnce({
      ok: true,
      status: 'attention',
      code: 'SYNC_HEALTH_ATTENTION',
      summary: { pendingCount: 3, openConflictCount: 0, hasInflight: false },
      issues: [{ code: 'SYNC_PENDING_QUEUE', severity: 'attention' }],
    })

    const res = await autoSyncService.runOnce({
      context: getValidContext(),
      trigger: AUTO_SYNC_TRIGGER_RESUME,
      online: true,
      isForeground: true,
    })

    expect(res.ok).toBe(true)
    expect(orchestratorService.syncAll).toHaveBeenCalledTimes(1)
  })

  // 89. Test conflict block
  it('89. blocks auto sync when health indicates open conflict', async () => {
    await autoSyncService.setEnabled({
      context: getValidContext(),
      enabled: true,
    })

    healthService.checkHealth.mockResolvedValueOnce({
      ok: true,
      status: 'blocked',
      code: 'SYNC_HEALTH_BLOCKED',
      summary: { pendingCount: 0, openConflictCount: 1, hasInflight: false },
      issues: [{ code: 'SYNC_OPEN_CONFLICT', severity: 'blocked' }],
    })

    const res = await autoSyncService.runOnce({
      context: getValidContext(),
      trigger: AUTO_SYNC_TRIGGER_ONLINE,
      online: true,
      isForeground: true,
    })

    expect(res.ok).toBe(false)
    expect(res.code).toBe('AUTO_SYNC_UNSAFE_HEALTH')
    expect(orchestratorService.syncAll).not.toHaveBeenCalled()
  })

  // 90. Test inflight block
  it('90. blocks auto sync when health indicates push in-flight', async () => {
    await autoSyncService.setEnabled({
      context: getValidContext(),
      enabled: true,
    })

    healthService.checkHealth.mockResolvedValueOnce({
      ok: true,
      status: 'attention',
      code: 'SYNC_HEALTH_ATTENTION',
      summary: { pendingCount: 0, openConflictCount: 0, hasInflight: true },
      issues: [{ code: 'SYNC_PUSH_INFLIGHT', severity: 'attention' }],
    })

    const res = await autoSyncService.runOnce({
      context: getValidContext(),
      trigger: AUTO_SYNC_TRIGGER_ONLINE,
      online: true,
      isForeground: true,
    })

    expect(res.ok).toBe(false)
    expect(res.code).toBe('AUTO_SYNC_UNSAFE_HEALTH')
    expect(orchestratorService.syncAll).not.toHaveBeenCalled()
  })

  // 91. Test bootstrap not prepared
  it('91. blocks auto sync when bootstrap is not prepared', async () => {
    await autoSyncService.setEnabled({
      context: getValidContext(),
      enabled: true,
    })

    healthService.checkHealth.mockResolvedValueOnce({
      ok: true,
      status: 'blocked',
      code: 'SYNC_HEALTH_BLOCKED',
      summary: { pendingCount: 0, openConflictCount: 0, hasInflight: false },
      issues: [{ code: 'SYNC_BOOTSTRAP_NOT_PREPARED', severity: 'blocked' }],
    })

    const res = await autoSyncService.runOnce({
      context: getValidContext(),
      trigger: AUTO_SYNC_TRIGGER_ONLINE,
      online: true,
      isForeground: true,
    })

    expect(res.ok).toBe(false)
    expect(res.code).toBe('AUTO_SYNC_UNSAFE_HEALTH')
    expect(orchestratorService.syncAll).not.toHaveBeenCalled()
  })

  // 92. Test bootstrap staged
  it('92. blocks auto sync when bootstrap is staged alongside pending queue', async () => {
    await autoSyncService.setEnabled({
      context: getValidContext(),
      enabled: true,
    })

    healthService.checkHealth.mockResolvedValueOnce({
      ok: true,
      status: 'attention',
      code: 'SYNC_HEALTH_ATTENTION',
      summary: { pendingCount: 5, openConflictCount: 0, hasInflight: false },
      issues: [
        { code: 'SYNC_BOOTSTRAP_STAGED', severity: 'attention' },
        { code: 'SYNC_PENDING_QUEUE', severity: 'attention' },
      ],
    })

    const res = await autoSyncService.runOnce({
      context: getValidContext(),
      trigger: AUTO_SYNC_TRIGGER_ONLINE,
      online: true,
      isForeground: true,
    })

    expect(res.ok).toBe(false)
    expect(res.code).toBe('AUTO_SYNC_UNSAFE_HEALTH')
    expect(orchestratorService.syncAll).not.toHaveBeenCalled()
  })

  // 93. Test blocked health
  it('93. blocks auto sync on any blocked health severity', async () => {
    await autoSyncService.setEnabled({
      context: getValidContext(),
      enabled: true,
    })

    healthService.checkHealth.mockResolvedValueOnce({
      ok: true,
      status: 'blocked',
      code: 'SYNC_HEALTH_BLOCKED',
      issues: [{ code: 'SYNC_BUSINESS_BINDING_MISMATCH', severity: 'blocked' }],
    })

    const res = await autoSyncService.runOnce({
      context: getValidContext(),
      trigger: AUTO_SYNC_TRIGGER_ONLINE,
      online: true,
      isForeground: true,
    })

    expect(res.ok).toBe(false)
    expect(res.code).toBe('AUTO_SYNC_UNSAFE_HEALTH')
    expect(orchestratorService.syncAll).not.toHaveBeenCalled()
  })

  // 94. Test unknown attention
  it('94. blocks auto sync on unknown attention issue', async () => {
    await autoSyncService.setEnabled({
      context: getValidContext(),
      enabled: true,
    })

    healthService.checkHealth.mockResolvedValueOnce({
      ok: true,
      status: 'attention',
      code: 'SYNC_HEALTH_ATTENTION',
      issues: [{ code: 'SOME_UNEXPECTED_ATTENTION', severity: 'attention' }],
    })

    const res = await autoSyncService.runOnce({
      context: getValidContext(),
      trigger: AUTO_SYNC_TRIGGER_ONLINE,
      online: true,
      isForeground: true,
    })

    expect(res.ok).toBe(false)
    expect(res.code).toBe('AUTO_SYNC_UNSAFE_HEALTH')
    expect(orchestratorService.syncAll).not.toHaveBeenCalled()
  })

  // 95. Test health failure
  it('95. returns AUTO_SYNC_HEALTH_CHECK_FAILED when healthService returns ok: false', async () => {
    await autoSyncService.setEnabled({
      context: getValidContext(),
      enabled: true,
    })

    healthService.checkHealth.mockResolvedValueOnce({
      ok: false,
      message: 'Health check disk failure',
    })

    const res = await autoSyncService.runOnce({
      context: getValidContext(),
      trigger: AUTO_SYNC_TRIGGER_ONLINE,
      online: true,
      isForeground: true,
    })

    expect(res.ok).toBe(false)
    expect(res.code).toBe('AUTO_SYNC_HEALTH_CHECK_FAILED')
    expect(orchestratorService.syncAll).not.toHaveBeenCalled()
  })

  // 96. Test max one P16
  it('96. stops immediately without looping when P16 returns SYNC_MORE_PUSH_PENDING', async () => {
    await autoSyncService.setEnabled({
      context: getValidContext(),
      enabled: true,
    })

    orchestratorService.syncAll.mockResolvedValueOnce({
      ok: false,
      code: 'SYNC_MORE_PUSH_PENDING',
      message: 'Masih ada data lokal.',
    })

    const res = await autoSyncService.runOnce({
      context: getValidContext(),
      trigger: AUTO_SYNC_TRIGGER_ONLINE,
      online: true,
      isForeground: true,
    })

    expect(res.ok).toBe(false)
    expect(res.code).toBe('SYNC_MORE_PUSH_PENDING')
    expect(orchestratorService.syncAll).toHaveBeenCalledTimes(1)
  })

  // 97. Test P16 network failure
  it('97. does not retry when P16 syncAll fails with network error', async () => {
    await autoSyncService.setEnabled({
      context: getValidContext(),
      enabled: true,
    })

    orchestratorService.syncAll.mockResolvedValueOnce({
      ok: false,
      code: 'NETWORK_ERROR',
      message: 'Koneksi terputus',
    })

    const res = await autoSyncService.runOnce({
      context: getValidContext(),
      trigger: AUTO_SYNC_TRIGGER_ONLINE,
      online: true,
      isForeground: true,
    })

    expect(res.ok).toBe(false)
    expect(res.code).toBe('NETWORK_ERROR')
    expect(orchestratorService.syncAll).toHaveBeenCalledTimes(1)
  })

  // 98. Test concurrent triggers
  it('98. returns AUTO_SYNC_ALREADY_IN_PROGRESS on concurrent second trigger', async () => {
    await autoSyncService.setEnabled({
      context: getValidContext(),
      enabled: true,
    })

    let resolveSyncAll
    orchestratorService.syncAll.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveSyncAll = resolve
        }),
    )

    const p1 = autoSyncService.runOnce({
      context: getValidContext(),
      trigger: AUTO_SYNC_TRIGGER_ONLINE,
      online: true,
      isForeground: true,
    })

    // Immediate second trigger while p1 is running
    const p2 = autoSyncService.runOnce({
      context: getValidContext(),
      trigger: AUTO_SYNC_TRIGGER_RESUME,
      online: true,
      isForeground: true,
    })

    const res2 = await p2
    expect(res2.ok).toBe(false)
    expect(res2.code).toBe('AUTO_SYNC_ALREADY_IN_PROGRESS')

    resolveSyncAll({ ok: true, code: 'SYNC_ALL_COMPLETED' })
    const res1 = await p1
    expect(res1.ok).toBe(true)
    expect(orchestratorService.syncAll).toHaveBeenCalledTimes(1)
  })

  // 99. Test cooldown
  it('99. enforces 30s cooldown and skips second trigger within cooldown window', async () => {
    await autoSyncService.setEnabled({
      context: getValidContext(),
      enabled: true,
    })

    const res1 = await autoSyncService.runOnce({
      context: getValidContext(),
      trigger: AUTO_SYNC_TRIGGER_ONLINE,
      online: true,
      isForeground: true,
    })
    expect(res1.ok).toBe(true)

    // Advance clock by only 5 seconds (5000 ms)
    currentTime += 5000

    const res2 = await autoSyncService.runOnce({
      context: getValidContext(),
      trigger: AUTO_SYNC_TRIGGER_RESUME,
      online: true,
      isForeground: true,
    })

    expect(res2.ok).toBe(false)
    expect(res2.code).toBe('AUTO_SYNC_COOLDOWN')
    expect(orchestratorService.syncAll).toHaveBeenCalledTimes(1)
  })

  // 100. Test cooldown expires
  it('100. allows auto sync again after 30s cooldown expires', async () => {
    await autoSyncService.setEnabled({
      context: getValidContext(),
      enabled: true,
    })

    await autoSyncService.runOnce({
      context: getValidContext(),
      trigger: AUTO_SYNC_TRIGGER_ONLINE,
      online: true,
      isForeground: true,
    })

    // Advance clock by 31 seconds
    currentTime += AUTO_SYNC_COOLDOWN_MS + 1000

    const res = await autoSyncService.runOnce({
      context: getValidContext(),
      trigger: AUTO_SYNC_TRIGGER_RESUME,
      online: true,
      isForeground: true,
    })

    expect(res.ok).toBe(true)
    expect(orchestratorService.syncAll).toHaveBeenCalledTimes(2)
  })

  // 101. Test busy
  it('101. skips auto sync when manual sync store is currently loading', async () => {
    const syncOrchestratorStore = useSyncOrchestratorStore()
    syncOrchestratorStore.loading = true

    const syncAutoSyncStore = useSyncAutoSyncStore()
    syncAutoSyncStore.init({ autoSyncService })

    const res = await syncAutoSyncStore.trigger(AUTO_SYNC_TRIGGER_ONLINE)
    expect(res.ok).toBe(false)
    expect(res.code).toBe('AUTO_SYNC_OTHER_SYNC_BUSY')
    expect(healthService.checkHealth).not.toHaveBeenCalled()
    expect(orchestratorService.syncAll).not.toHaveBeenCalled()
  })

  // 102. Test same context snapshot
  it('102. uses exact context snapshot taken at start throughout health and syncAll', async () => {
    const cloudStore = useCloudSessionStore()
    setupAuthenticatedSession(cloudStore)

    await autoSyncService.setEnabled({
      context: getValidContext(),
      enabled: true,
    })

    let capturedHealthCtx = null
    let capturedSyncCtx = null

    healthService.checkHealth.mockImplementation(async ({ context }) => {
      capturedHealthCtx = { ...context }
      // Mutate cloudStore mid-run
      cloudStore.selectedBusiness = { id: 99, name: 'Changed' }
      cloudStore.selectedOutlet = { id: 88, name: 'Changed' }
      return { ok: true, status: 'ready', code: 'SYNC_HEALTH_READY', issues: [] }
    })

    orchestratorService.syncAll.mockImplementation(async ({ context }) => {
      capturedSyncCtx = { ...context }
      return { ok: true, code: 'SYNC_ALL_COMPLETED' }
    })

    const syncAutoSyncStore = useSyncAutoSyncStore()
    syncAutoSyncStore.init({ autoSyncService })

    await syncAutoSyncStore.trigger(AUTO_SYNC_TRIGGER_ONLINE)

    expect(capturedHealthCtx.selectedBusiness.id).toBe(10)
    expect(capturedSyncCtx.selectedBusiness.id).toBe(10)
  })

  // 103. Test no token in context
  it('103. ensures tokens and credentials are never included in context passed to services', async () => {
    const cloudStore = useCloudSessionStore()
    setupAuthenticatedSession(cloudStore)

    await autoSyncService.setEnabled({
      context: getValidContext(),
      enabled: true,
    })

    let capturedCtx = null
    orchestratorService.syncAll.mockImplementation(async ({ context }) => {
      capturedCtx = context
      return { ok: true, code: 'SYNC_ALL_COMPLETED' }
    })

    const syncAutoSyncStore = useSyncAutoSyncStore()
    syncAutoSyncStore.init({ autoSyncService })

    await syncAutoSyncStore.trigger(AUTO_SYNC_TRIGGER_ONLINE)

    expect(capturedCtx.token).toBeUndefined()
    expect(capturedCtx.password).toBeUndefined()
    expect(capturedCtx.authorization).toBeUndefined()
  })

  // 104. Test start listener no initial run
  it('104. startListeners attaches listeners without immediately firing auto sync', async () => {
    const syncAutoSyncStore = useSyncAutoSyncStore()
    syncAutoSyncStore.init({ autoSyncService })

    const spyTrigger = vi.spyOn(syncAutoSyncStore, 'trigger')
    syncAutoSyncStore.startListeners()

    expect(spyTrigger).not.toHaveBeenCalled()
    expect(orchestratorService.syncAll).not.toHaveBeenCalled()
  })

  // 105. Test online event
  it('105. triggers auto sync on window online event', async () => {
    const cloudStore = useCloudSessionStore()
    setupAuthenticatedSession(cloudStore)

    await autoSyncService.setEnabled({
      context: getValidContext(),
      enabled: true,
    })

    const syncAutoSyncStore = useSyncAutoSyncStore()
    syncAutoSyncStore.init({ autoSyncService })
    syncAutoSyncStore.startListeners()

    window.dispatchEvent(new Event('online'))
    await flushPromises()

    expect(orchestratorService.syncAll).toHaveBeenCalledTimes(1)
  })

  // 106. Test hidden online
  it('106. skips auto sync when online event fires while document is hidden', async () => {
    await autoSyncService.setEnabled({
      context: getValidContext(),
      enabled: true,
    })

    const res = await autoSyncService.runOnce({
      context: getValidContext(),
      trigger: AUTO_SYNC_TRIGGER_ONLINE,
      online: true,
      isForeground: false,
    })

    expect(res.ok).toBe(false)
    expect(res.code).toBe('AUTO_SYNC_NOT_FOREGROUND')
    expect(orchestratorService.syncAll).not.toHaveBeenCalled()
  })

  // 107. Test resume visibilitychange
  it('107. triggers auto sync on visibilitychange to visible', async () => {
    const cloudStore = useCloudSessionStore()
    setupAuthenticatedSession(cloudStore)

    await autoSyncService.setEnabled({
      context: getValidContext(),
      enabled: true,
    })

    const syncAutoSyncStore = useSyncAutoSyncStore()
    syncAutoSyncStore.init({ autoSyncService })
    syncAutoSyncStore.startListeners()

    Object.defineProperty(document, 'visibilityState', {
      value: 'visible',
      configurable: true,
    })

    document.dispatchEvent(new Event('visibilitychange'))
    await flushPromises()

    expect(orchestratorService.syncAll).toHaveBeenCalledTimes(1)
  })

  // 108. Test hidden visibilitychange
  it('108. does not trigger auto sync on visibilitychange to hidden', async () => {
    const cloudStore = useCloudSessionStore()
    setupAuthenticatedSession(cloudStore)

    const syncAutoSyncStore = useSyncAutoSyncStore()
    syncAutoSyncStore.init({ autoSyncService })
    syncAutoSyncStore.startListeners()

    Object.defineProperty(document, 'visibilityState', {
      value: 'hidden',
      configurable: true,
    })

    document.dispatchEvent(new Event('visibilitychange'))
    await flushPromises()

    expect(orchestratorService.syncAll).not.toHaveBeenCalled()
  })

  // 109. Test listener idempotent
  it('109. calling startListeners multiple times registers listeners only once', async () => {
    const cloudStore = useCloudSessionStore()
    setupAuthenticatedSession(cloudStore)

    await autoSyncService.setEnabled({
      context: getValidContext(),
      enabled: true,
    })

    const syncAutoSyncStore = useSyncAutoSyncStore()
    syncAutoSyncStore.init({ autoSyncService })

    syncAutoSyncStore.startListeners()
    syncAutoSyncStore.startListeners()

    window.dispatchEvent(new Event('online'))
    await flushPromises()

    expect(orchestratorService.syncAll).toHaveBeenCalledTimes(1)
  })

  // 110. Test stop listeners
  it('110. stopListeners successfully unregisters all event listeners', async () => {
    const syncAutoSyncStore = useSyncAutoSyncStore()
    syncAutoSyncStore.init({ autoSyncService })

    syncAutoSyncStore.startListeners()
    syncAutoSyncStore.stopListeners()

    window.dispatchEvent(new Event('online'))
    await flushPromises()

    expect(orchestratorService.syncAll).not.toHaveBeenCalled()
  })

  // 112. Test auto activity log
  it('112. records single AUTO_SYNC activity log entry with trigger metadata on completion', async () => {
    await autoSyncService.setEnabled({
      context: getValidContext(),
      enabled: true,
    })

    orchestratorService.syncAll.mockResolvedValueOnce({
      ok: true,
      code: 'SYNC_ALL_COMPLETED',
      push: { removedQueueIds: ['q1'] },
      pull: { applied: 2 },
      stage: 'done',
    })

    await autoSyncService.runOnce({
      context: getValidContext(),
      trigger: AUTO_SYNC_TRIGGER_ONLINE,
      online: true,
      isForeground: true,
    })

    const list = await activityLogService.listRecent()
    expect(list).toHaveLength(1)
    expect(list[0].type).toBe('full_sync')
    expect(list[0].action).toBe('AUTO_SYNC')
    expect(list[0].status).toBe('success')
    expect(list[0].summary.trigger).toBe('online')
    expect(list[0].summary.pushed).toBe(1)
    expect(list[0].summary.pulled).toBe(2)
  })

  // 113. Test no double log
  it('113. does not produce separate push or pull activities during auto sync', async () => {
    await autoSyncService.setEnabled({
      context: getValidContext(),
      enabled: true,
    })

    await autoSyncService.runOnce({
      context: getValidContext(),
      trigger: AUTO_SYNC_TRIGGER_RESUME,
      online: true,
      isForeground: true,
    })

    const list = await activityLogService.listRecent()
    expect(list).toHaveLength(1)
    expect(list.find((e) => e.action === 'PUSH_NOW')).toBeUndefined()
    expect(list.find((e) => e.action === 'PULL_NOW')).toBeUndefined()
  })

  // 114. Test skip no activity
  it('114. does not write activity log when auto sync is skipped due to offline or disabled', async () => {
    await autoSyncService.runOnce({
      context: getValidContext(),
      trigger: AUTO_SYNC_TRIGGER_ONLINE,
      online: false,
      isForeground: true,
    })

    const list = await activityLogService.listRecent()
    expect(list).toHaveLength(0)
  })

  // 115. Test more pending activity status
  it('115. records attention status in activity log when P16 returns SYNC_MORE_PUSH_PENDING', async () => {
    await autoSyncService.setEnabled({
      context: getValidContext(),
      enabled: true,
    })

    orchestratorService.syncAll.mockResolvedValueOnce({
      ok: false,
      code: 'SYNC_MORE_PUSH_PENDING',
      message: 'More push pending',
    })

    await autoSyncService.runOnce({
      context: getValidContext(),
      trigger: AUTO_SYNC_TRIGGER_ONLINE,
      online: true,
      isForeground: true,
    })

    const list = await activityLogService.listRecent()
    expect(list).toHaveLength(1)
    expect(list[0].status).toBe('attention')
    expect(list[0].code).toBe('SYNC_MORE_PUSH_PENDING')
  })

  // 116. Test conflict activity status
  it('116. records blocked status in activity log when P16 returns SYNC_CONFLICT', async () => {
    await autoSyncService.setEnabled({
      context: getValidContext(),
      enabled: true,
    })

    orchestratorService.syncAll.mockResolvedValueOnce({
      ok: false,
      code: 'SYNC_CONFLICT',
      message: 'Conflict occurred during sync',
    })

    await autoSyncService.runOnce({
      context: getValidContext(),
      trigger: AUTO_SYNC_TRIGGER_ONLINE,
      online: true,
      isForeground: true,
    })

    const list = await activityLogService.listRecent()
    expect(list).toHaveLength(1)
    expect(list[0].status).toBe('blocked')
    expect(list[0].code).toBe('SYNC_CONFLICT')
  })

  // 117. Test log failure non-blocking
  it('117. does not fail auto sync operation when activityLogService.record throws', async () => {
    await autoSyncService.setEnabled({
      context: getValidContext(),
      enabled: true,
    })

    vi.spyOn(activityLogService, 'record').mockRejectedValueOnce(new Error('Activity log disk full'))

    const res = await autoSyncService.runOnce({
      context: getValidContext(),
      trigger: AUTO_SYNC_TRIGGER_ONLINE,
      online: true,
      isForeground: true,
    })

    expect(res.ok).toBe(true)
    expect(res.code).toBe('SYNC_ALL_COMPLETED')
  })

  // 118. Test UI default OFF
  it('118. renders auto sync toggle as OFF by default in CloudLoginView', async () => {
    const cloudStore = useCloudSessionStore()
    setupAuthenticatedSession(cloudStore)

    const syncAutoSyncStore = useSyncAutoSyncStore()
    syncAutoSyncStore.init({ autoSyncService })

    const wrapper = mount(CloudLoginView)
    await flushPromises()

    const toggle = wrapper.find('#auto-sync-toggle')
    expect(toggle.exists()).toBe(true)
    expect(toggle.element.checked).toBe(false)
  })

  // 119. Test UI enable
  it('119. toggling auto sync ON persists preference without immediately invoking syncAll', async () => {
    const cloudStore = useCloudSessionStore()
    setupAuthenticatedSession(cloudStore)

    const syncAutoSyncStore = useSyncAutoSyncStore()
    syncAutoSyncStore.init({ autoSyncService })

    const wrapper = mount(CloudLoginView)
    await flushPromises()

    const toggle = wrapper.find('#auto-sync-toggle')
    await toggle.setValue(true)
    await flushPromises()

    expect(syncAutoSyncStore.enabled).toBe(true)
    expect(wrapper.find('#auto-sync-status-message').text()).toContain(
      'Sinkronisasi otomatis aktif untuk koneksi dan konteks ini.',
    )

    expect(orchestratorService.syncAll).not.toHaveBeenCalled()
  })

  // 120. Test UI context change
  it('120. switches toggle OFF in UI when business or outlet changes to an unconfigured context', async () => {
    const cloudStore = useCloudSessionStore()
    setupAuthenticatedSession(cloudStore)

    // Enable for Business 10
    await autoSyncService.setEnabled({
      context: getValidContext(),
      enabled: true,
    })

    const syncAutoSyncStore = useSyncAutoSyncStore()
    syncAutoSyncStore.init({ autoSyncService })

    const wrapper = mount(CloudLoginView)
    await flushPromises()

    expect(wrapper.find('#auto-sync-toggle').element.checked).toBe(true)

    // Change to Business 99 / Outlet 88
    cloudStore.selectedBusiness = { id: 99, name: 'Biz 99' }
    cloudStore.selectedOutlet = { id: 88, name: 'Outlet 88' }
    await flushPromises()

    expect(syncAutoSyncStore.enabled).toBe(false)
    expect(wrapper.find('#auto-sync-toggle').element.checked).toBe(false)
  })

  // 121. Test UI mutual exclusion
  it('121. disables all manual sync buttons while syncAutoSyncStore.running is true', async () => {
    const cloudStore = useCloudSessionStore()
    setupAuthenticatedSession(cloudStore)

    const syncAutoSyncStore = useSyncAutoSyncStore()
    syncAutoSyncStore.init({ autoSyncService })
    syncAutoSyncStore.running = true

    const wrapper = mount(CloudLoginView)
    await flushPromises()

    expect(wrapper.find('#sync-all-btn').attributes('disabled')).toBeDefined()
    expect(wrapper.find('#sync-now-btn').attributes('disabled')).toBeDefined()
    expect(wrapper.find('#pull-now-btn').attributes('disabled')).toBeDefined()
    expect(wrapper.find('#bootstrap-btn').attributes('disabled')).toBeDefined()
    expect(wrapper.find('#sync-health-btn').attributes('disabled')).toBeDefined()
  })

  // 123. Regression P14
  it('123. ensures auto sync never calls bootstrapService directly', async () => {
    const syncBootstrapStore = useSyncBootstrapStore()
    const spyBootstrap = vi.spyOn(syncBootstrapStore, 'bootstrapNow')

    await autoSyncService.setEnabled({
      context: getValidContext(),
      enabled: true,
    })

    await autoSyncService.runOnce({
      context: getValidContext(),
      trigger: AUTO_SYNC_TRIGGER_ONLINE,
      online: true,
      isForeground: true,
    })

    expect(spyBootstrap).not.toHaveBeenCalled()
  })

  // 124. Regression P15
  it('124. ensures auto sync never calls useServer or keepLocal conflict resolutions', async () => {
    const syncConflictStore = useSyncConflictStore()
    const spyUseServer = vi.spyOn(syncConflictStore, 'useServer')
    const spyKeepLocal = vi.spyOn(syncConflictStore, 'keepLocal')

    await autoSyncService.setEnabled({
      context: getValidContext(),
      enabled: true,
    })

    await autoSyncService.runOnce({
      context: getValidContext(),
      trigger: AUTO_SYNC_TRIGGER_ONLINE,
      online: true,
      isForeground: true,
    })

    expect(spyUseServer).not.toHaveBeenCalled()
    expect(spyKeepLocal).not.toHaveBeenCalled()
  })

  // 125. Regression P18
  it('125. ensures auto sync never calls syncRecoveryService.recover', async () => {
    const syncRecoveryStore = useSyncRecoveryStore()
    const spyRecover = vi.spyOn(syncRecoveryStore, 'recover')

    await autoSyncService.setEnabled({
      context: getValidContext(),
      enabled: true,
    })

    await autoSyncService.runOnce({
      context: getValidContext(),
      trigger: AUTO_SYNC_TRIGGER_ONLINE,
      online: true,
      isForeground: true,
    })

    expect(spyRecover).not.toHaveBeenCalled()
  })

  // 127. Health READY with BLOCKED issue
  it('127. rejects sync when health status is READY but issues contains a blocked severity issue', async () => {
    await autoSyncService.setEnabled({
      context: getValidContext(),
      enabled: true,
    })

    healthService.checkHealth.mockResolvedValueOnce({
      ok: true,
      status: 'ready',
      code: 'SYNC_HEALTH_READY',
      issues: [{ code: 'SYNC_OPEN_CONFLICT', severity: 'blocked' }],
    })

    const res = await autoSyncService.runOnce({
      context: getValidContext(),
      trigger: AUTO_SYNC_TRIGGER_ONLINE,
      online: true,
      isForeground: true,
    })

    expect(res.ok).toBe(false)
    expect(res.code).toBe('AUTO_SYNC_UNSAFE_HEALTH')
    expect(orchestratorService.syncAll).not.toHaveBeenCalled()
  })

  // 128. Health READY with INFLIGHT issue
  it('128. rejects sync when health status is READY but issues contains SYNC_PUSH_INFLIGHT', async () => {
    await autoSyncService.setEnabled({
      context: getValidContext(),
      enabled: true,
    })

    healthService.checkHealth.mockResolvedValueOnce({
      ok: true,
      status: 'ready',
      code: 'SYNC_HEALTH_READY',
      issues: [{ code: 'SYNC_PUSH_INFLIGHT', severity: 'attention' }],
    })

    const res = await autoSyncService.runOnce({
      context: getValidContext(),
      trigger: AUTO_SYNC_TRIGGER_ONLINE,
      online: true,
      isForeground: true,
    })

    expect(res.ok).toBe(false)
    expect(res.code).toBe('AUTO_SYNC_UNSAFE_HEALTH')
    expect(orchestratorService.syncAll).not.toHaveBeenCalled()
  })

  // 129. Health READY with UNKNOWN issue
  it('129. rejects sync when health status is READY but issues contains any unexpected issue', async () => {
    await autoSyncService.setEnabled({
      context: getValidContext(),
      enabled: true,
    })

    healthService.checkHealth.mockResolvedValueOnce({
      ok: true,
      status: 'ready',
      code: 'SYNC_HEALTH_READY',
      issues: [{ code: 'UNKNOWN_ISSUE', severity: 'attention' }],
    })

    const res = await autoSyncService.runOnce({
      context: getValidContext(),
      trigger: AUTO_SYNC_TRIGGER_ONLINE,
      online: true,
      isForeground: true,
    })

    expect(res.ok).toBe(false)
    expect(res.code).toBe('AUTO_SYNC_UNSAFE_HEALTH')
    expect(orchestratorService.syncAll).not.toHaveBeenCalled()
  })

  // 130. Health response missing ok: true
  it('130. returns AUTO_SYNC_HEALTH_CHECK_FAILED when health response lacks ok: true', async () => {
    await autoSyncService.setEnabled({
      context: getValidContext(),
      enabled: true,
    })

    healthService.checkHealth.mockResolvedValueOnce({
      status: 'ready',
      issues: [],
    })

    const res = await autoSyncService.runOnce({
      context: getValidContext(),
      trigger: AUTO_SYNC_TRIGGER_ONLINE,
      online: true,
      isForeground: true,
    })

    expect(res.ok).toBe(false)
    expect(res.code).toBe('AUTO_SYNC_HEALTH_CHECK_FAILED')
    expect(orchestratorService.syncAll).not.toHaveBeenCalled()
  })

  // 131. Health issues not an array
  it('131. returns AUTO_SYNC_HEALTH_CHECK_FAILED when health.issues is not an array', async () => {
    await autoSyncService.setEnabled({
      context: getValidContext(),
      enabled: true,
    })

    healthService.checkHealth.mockResolvedValueOnce({
      ok: true,
      status: 'ready',
      issues: null,
    })

    const res = await autoSyncService.runOnce({
      context: getValidContext(),
      trigger: AUTO_SYNC_TRIGGER_ONLINE,
      online: true,
      isForeground: true,
    })

    expect(res.ok).toBe(false)
    expect(res.code).toBe('AUTO_SYNC_HEALTH_CHECK_FAILED')
    expect(orchestratorService.syncAll).not.toHaveBeenCalled()
  })

  // 132. Direct service safety: missing online or isForeground
  it('132. fails closed without executing health check when online or isForeground is omitted', async () => {
    await autoSyncService.setEnabled({
      context: getValidContext(),
      enabled: true,
    })

    const resWithoutForeground = await autoSyncService.runOnce({
      context: getValidContext(),
      trigger: AUTO_SYNC_TRIGGER_ONLINE,
      online: true,
    })
    expect(resWithoutForeground.ok).toBe(false)
    expect(resWithoutForeground.code).toBe('AUTO_SYNC_NOT_FOREGROUND')

    const resWithoutOnline = await autoSyncService.runOnce({
      context: getValidContext(),
      trigger: AUTO_SYNC_TRIGGER_ONLINE,
      isForeground: true,
    })
    expect(resWithoutOnline.ok).toBe(false)
    expect(resWithoutOnline.code).toBe('AUTO_SYNC_OFFLINE')

    expect(healthService.checkHealth).not.toHaveBeenCalled()
    expect(orchestratorService.syncAll).not.toHaveBeenCalled()
  })

  // 133. Corrupt enabled setting: enabled: true with context: null
  it('133. treats enabled: true with null context as AUTO_SYNC_SETTINGS_INVALID', async () => {
    await adapter.saveSyncAutoSettings({
      version: 1,
      enabled: true,
      context: null,
      updatedAt: new Date(currentTime).toISOString(),
    })

    const pref = await autoSyncService.loadPreference({ context: getValidContext() })
    expect(pref.ok).toBe(false)
    expect(pref.code).toBe('AUTO_SYNC_SETTINGS_INVALID')

    const res = await autoSyncService.runOnce({
      context: getValidContext(),
      trigger: AUTO_SYNC_TRIGGER_ONLINE,
      online: true,
      isForeground: true,
    })
    expect(res.ok).toBe(false)
    expect(res.code).toBe('AUTO_SYNC_SETTINGS_INVALID')
    expect(healthService.checkHealth).not.toHaveBeenCalled()
  })

  // 134. Invalid user cannot enable
  it('134. rejects setEnabled(true) when user.id is whitespace or empty', async () => {
    const invalidCtx = {
      ...getValidContext(),
      user: { id: '   ' },
    }

    const setRes = await autoSyncService.setEnabled({
      context: invalidCtx,
      enabled: true,
    })

    expect(setRes.ok).toBe(false)
    expect(setRes.code).toBe('AUTO_SYNC_CONTEXT_UNAVAILABLE')

    const raw = await adapter.loadSyncAutoSettings()
    expect(raw).toBeNull()
  })

  // 135. Malformed cloudAccess cannot enable
  it('135. rejects setEnabled(true) when cloudAccess is string "false"', async () => {
    const invalidCtx = {
      ...getValidContext(),
      cloudAccess: 'false',
    }

    const setRes = await autoSyncService.setEnabled({
      context: invalidCtx,
      enabled: true,
    })

    expect(setRes.ok).toBe(false)
    expect(setRes.code).toBe('AUTO_SYNC_CONTEXT_UNAVAILABLE')
  })

  // 136. Device identifier change
  it('136. reloads preference and switches toggle OFF when deviceIdentifier changes', async () => {
    const cloudStore = useCloudSessionStore()
    setupAuthenticatedSession(cloudStore)

    await autoSyncService.setEnabled({
      context: getValidContext(),
      enabled: true,
    })

    const syncAutoSyncStore = useSyncAutoSyncStore()
    syncAutoSyncStore.init({ autoSyncService })

    const wrapper = mount(CloudLoginView)
    await flushPromises()

    expect(wrapper.find('#auto-sync-toggle').element.checked).toBe(true)

    // Change deviceIdentifier
    cloudStore.deviceIdentifier = 'dev-uuid-DIFFERENT'
    await flushPromises()

    expect(syncAutoSyncStore.enabled).toBe(false)
    expect(wrapper.find('#auto-sync-toggle').element.checked).toBe(false)
  })

  // 137. Stale async loadPreference A -> B
  it('137. ignores stale loadPreference response from previous context', async () => {
    const cloudStore = useCloudSessionStore()
    setupAuthenticatedSession(cloudStore)

    const syncAutoSyncStore = useSyncAutoSyncStore()
    syncAutoSyncStore.init({ autoSyncService })

    let resolveLoadA
    const origLoad = autoSyncService.loadPreference
    vi.spyOn(autoSyncService, 'loadPreference').mockImplementation(({ context }) => {
      if (context.selectedBusiness?.id === 10) {
        return new Promise((resolve) => {
          resolveLoadA = () => resolve({ ok: true, enabled: true, contextMatches: true })
        })
      }
      return origLoad({ context })
    })

    // Start load for Context A (Business 10)
    const pA = syncAutoSyncStore.loadPreference()

    // Immediately switch to Context B (Business 99)
    cloudStore.selectedBusiness = { id: 99 }
    cloudStore.selectedOutlet = { id: 88 }

    // Start and complete load for Context B (unconfigured -> enabled: false)
    const pB = syncAutoSyncStore.loadPreference()
    await pB

    expect(syncAutoSyncStore.enabled).toBe(false)

    // Now resolve delayed A
    resolveLoadA()
    await pA

    // Context B must remain enabled: false (not overwritten by stale A)
    expect(syncAutoSyncStore.enabled).toBe(false)
  })

  // 138. Stale async loadPreference B -> A
  it('138. ignores stale loadPreference response from B when switching back to A', async () => {
    const cloudStore = useCloudSessionStore()
    setupAuthenticatedSession(cloudStore)

    await autoSyncService.setEnabled({
      context: getValidContext(),
      enabled: true,
    })

    const syncAutoSyncStore = useSyncAutoSyncStore()
    syncAutoSyncStore.init({ autoSyncService })

    let resolveLoadB
    const origLoad = autoSyncService.loadPreference
    vi.spyOn(autoSyncService, 'loadPreference').mockImplementation(({ context }) => {
      if (context.selectedBusiness?.id === 99) {
        return new Promise((resolve) => {
          resolveLoadB = () => resolve({ ok: true, enabled: false, contextMatches: false })
        })
      }
      return origLoad({ context })
    })

    // Switch to B and start load
    cloudStore.selectedBusiness = { id: 99 }
    cloudStore.selectedOutlet = { id: 88 }
    const pB = syncAutoSyncStore.loadPreference()

    // Switch back to A and finish load
    cloudStore.selectedBusiness = { id: 10 }
    cloudStore.selectedOutlet = { id: 20 }
    const pA = syncAutoSyncStore.loadPreference()
    await pA

    expect(syncAutoSyncStore.enabled).toBe(true)

    // Resolve late B
    resolveLoadB()
    await pB

    expect(syncAutoSyncStore.enabled).toBe(true)
  })

  // 139. Clock zero
  it('139. allows first auto sync when system clock is zero', async () => {
    currentTime = 0
    await autoSyncService.setEnabled({
      context: getValidContext(),
      enabled: true,
    })

    const res = await autoSyncService.runOnce({
      context: getValidContext(),
      trigger: AUTO_SYNC_TRIGGER_ONLINE,
      online: true,
      isForeground: true,
    })

    expect(res.ok).toBe(true)
    expect(orchestratorService.syncAll).toHaveBeenCalledTimes(1)
  })

  // 140. Clock regression prevents burst sync
  it('140. blocks burst auto sync if system clock moves backwards', async () => {
    currentTime = 100000
    await autoSyncService.setEnabled({
      context: getValidContext(),
      enabled: true,
    })

    const res1 = await autoSyncService.runOnce({
      context: getValidContext(),
      trigger: AUTO_SYNC_TRIGGER_ONLINE,
      online: true,
      isForeground: true,
    })
    expect(res1.ok).toBe(true)

    // Clock regresses to 50000 (< 100000)
    currentTime = 50000

    const res2 = await autoSyncService.runOnce({
      context: getValidContext(),
      trigger: AUTO_SYNC_TRIGGER_RESUME,
      online: true,
      isForeground: true,
    })

    expect(res2.ok).toBe(false)
    expect(res2.code).toBe('AUTO_SYNC_COOLDOWN')
    expect(orchestratorService.syncAll).toHaveBeenCalledTimes(1)
  })

  // 141. Invalid durable trigger validation in P19 activity log
  it('141. rejects activity log entries with arbitrary trigger strings', () => {
    expect(isValidSummary({ trigger: 'online' })).toBe(true)
    expect(isValidSummary({ trigger: 'resume' })).toBe(true)
    expect(isValidSummary({ trigger: 'custom_arbitrary_trigger' })).toBe(false)
    expect(isValidSummary({ trigger: 'secret_leak_trigger' })).toBe(false)
  })

  // 142. Busy check fail closed on error
  it('142. fails closed when accessing store busy state encounters an error', async () => {
    const syncAutoSyncStore = useSyncAutoSyncStore()
    syncAutoSyncStore.init({ autoSyncService })

    // Simulate pushStore property getter throwing
    const pushStore = useSyncPushStore()
    Object.defineProperty(pushStore, 'loading', {
      get() {
        throw new Error('Store access failure')
      },
      configurable: true,
    })

    const res = await syncAutoSyncStore.trigger(AUTO_SYNC_TRIGGER_ONLINE)
    expect(res.ok).toBe(false)
    expect(res.code).toBe('AUTO_SYNC_OTHER_SYNC_BUSY')
    expect(orchestratorService.syncAll).not.toHaveBeenCalled()
  })

  // 143. User disable race
  it('143. returns AUTO_SYNC_PREFERENCE_BUSY when runOnce is invoked while setEnabled(false) is pending', async () => {
    await autoSyncService.setEnabled({
      context: getValidContext(),
      enabled: true,
    })

    let resolveSave
    const origSave = adapter.saveSyncAutoSettings
    vi.spyOn(adapter, 'saveSyncAutoSettings').mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveSave = resolve
        }),
    )

    const setPromise = autoSyncService.setEnabled({
      context: getValidContext(),
      enabled: false,
    })

    // Trigger runOnce while setEnabled(false) is pending
    const runRes = await autoSyncService.runOnce({
      context: getValidContext(),
      trigger: AUTO_SYNC_TRIGGER_ONLINE,
      online: true,
      isForeground: true,
    })

    expect(runRes.ok).toBe(false)
    expect(runRes.code).toBe('AUTO_SYNC_PREFERENCE_BUSY')
    expect(healthService.checkHealth).not.toHaveBeenCalled()
    expect(orchestratorService.syncAll).not.toHaveBeenCalled()

    resolveSave()
    await setPromise
  })

  // 144. Store disable race
  it('144. returns AUTO_SYNC_PREFERENCE_BUSY when store trigger is invoked while setEnabled(false) is pending', async () => {
    const cloudStore = useCloudSessionStore()
    setupAuthenticatedSession(cloudStore)

    const syncAutoSyncStore = useSyncAutoSyncStore()
    syncAutoSyncStore.init({ autoSyncService })

    let resolveSave
    vi.spyOn(adapter, 'saveSyncAutoSettings').mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveSave = resolve
        }),
    )

    const setPromise = syncAutoSyncStore.setEnabled(false)

    // Store loadingPreference is now true
    expect(syncAutoSyncStore.loadingPreference).toBe(true)

    const triggerRes = await syncAutoSyncStore.trigger(AUTO_SYNC_TRIGGER_ONLINE)
    expect(triggerRes.ok).toBe(false)
    expect(triggerRes.code).toBe('AUTO_SYNC_PREFERENCE_BUSY')
    expect(orchestratorService.syncAll).not.toHaveBeenCalled()

    resolveSave()
    await setPromise
  })

  // 145. Enable race
  it('145. returns AUTO_SYNC_PREFERENCE_BUSY when runOnce is invoked while setEnabled(true) is pending', async () => {
    let resolveSave
    vi.spyOn(adapter, 'saveSyncAutoSettings').mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveSave = resolve
        }),
    )

    const setPromise = autoSyncService.setEnabled({
      context: getValidContext(),
      enabled: true,
    })

    const runRes = await autoSyncService.runOnce({
      context: getValidContext(),
      trigger: AUTO_SYNC_TRIGGER_ONLINE,
      online: true,
      isForeground: true,
    })

    expect(runRes.ok).toBe(false)
    expect(runRes.code).toBe('AUTO_SYNC_PREFERENCE_BUSY')
    expect(orchestratorService.syncAll).not.toHaveBeenCalled()

    resolveSave()
    await setPromise
  })

  // 146. Load preference race
  it('146. returns AUTO_SYNC_PREFERENCE_BUSY when trigger is called while loadingPreference is true', async () => {
    const syncAutoSyncStore = useSyncAutoSyncStore()
    syncAutoSyncStore.init({ autoSyncService })

    syncAutoSyncStore.loadingPreference = true

    const triggerRes = await syncAutoSyncStore.trigger(AUTO_SYNC_TRIGGER_ONLINE)
    expect(triggerRes.ok).toBe(false)
    expect(triggerRes.code).toBe('AUTO_SYNC_PREFERENCE_BUSY')
    expect(orchestratorService.syncAll).not.toHaveBeenCalled()
  })

  // 147. Safe execution context forwarding
  it('147. strips token, password, authorization, credentials, and user.email before forwarding to health/orchestrator', async () => {
    await autoSyncService.setEnabled({
      context: getValidContext(),
      enabled: true,
    })

    let capturedHealthCtx = null
    let capturedOrchestratorCtx = null

    healthService.checkHealth.mockImplementationOnce(async ({ context }) => {
      capturedHealthCtx = context
      return { ok: true, status: 'ready', code: 'SYNC_HEALTH_READY', issues: [] }
    })

    orchestratorService.syncAll.mockImplementationOnce(async ({ context }) => {
      capturedOrchestratorCtx = context
      return { ok: true, code: 'SYNC_ALL_COMPLETED' }
    })

    const rawContextWithCredentials = {
      ...getValidContext(),
      token: 'SUPER_SECRET_TOKEN',
      password: 'SUPER_SECRET_PASSWORD',
      authorization: 'Bearer SUPER_SECRET_BEARER',
      credentials: { secret: 'SECRET_CRED' },
      user: {
        id: 1,
        email: 'leaked@example.com',
        role: 'admin',
      },
    }

    const res = await autoSyncService.runOnce({
      context: rawContextWithCredentials,
      trigger: AUTO_SYNC_TRIGGER_ONLINE,
      online: true,
      isForeground: true,
    })

    expect(res.ok).toBe(true)

    // Check health context
    expect(capturedHealthCtx.token).toBeUndefined()
    expect(capturedHealthCtx.password).toBeUndefined()
    expect(capturedHealthCtx.authorization).toBeUndefined()
    expect(capturedHealthCtx.credentials).toBeUndefined()
    expect(capturedHealthCtx.user.email).toBeUndefined()
    expect(capturedHealthCtx.user.id).toBe(1)
    expect(capturedHealthCtx.selectedBusiness.id).toBe(10)
    expect(capturedHealthCtx.selectedOutlet.id).toBe(20)
    expect(capturedHealthCtx.cloudAccess).toBe(true)
    expect(capturedHealthCtx.deviceIdentifier).toBe('dev-uuid-123')
    expect(capturedHealthCtx.registeredDeviceId).toBe(77)

    // Check orchestrator context
    expect(capturedOrchestratorCtx.token).toBeUndefined()
    expect(capturedOrchestratorCtx.password).toBeUndefined()
    expect(capturedOrchestratorCtx.authorization).toBeUndefined()
    expect(capturedOrchestratorCtx.credentials).toBeUndefined()
    expect(capturedOrchestratorCtx.user.email).toBeUndefined()
    expect(capturedOrchestratorCtx.user.id).toBe(1)
    expect(capturedOrchestratorCtx.selectedBusiness.id).toBe(10)
    expect(capturedOrchestratorCtx.selectedOutlet.id).toBe(20)
  })

  // 148. Inconsistent health code ↔ status combinations
  it('148. rejects auto sync with AUTO_SYNC_HEALTH_CHECK_FAILED when health code contradicts status', async () => {
    await autoSyncService.setEnabled({
      context: getValidContext(),
      enabled: true,
    })

    // Case 1: status ready + code SYNC_HEALTH_BLOCKED
    healthService.checkHealth.mockResolvedValueOnce({
      ok: true,
      status: 'ready',
      code: 'SYNC_HEALTH_BLOCKED',
      issues: [],
    })
    let res = await autoSyncService.runOnce({
      context: getValidContext(),
      trigger: AUTO_SYNC_TRIGGER_ONLINE,
      online: true,
      isForeground: true,
    })
    expect(res.ok).toBe(false)
    expect(res.code).toBe('AUTO_SYNC_HEALTH_CHECK_FAILED')

    // Advance clock past cooldown
    currentTime += AUTO_SYNC_COOLDOWN_MS + 1000

    // Case 2: status ready + code SYNC_HEALTH_ATTENTION
    healthService.checkHealth.mockResolvedValueOnce({
      ok: true,
      status: 'ready',
      code: 'SYNC_HEALTH_ATTENTION',
      issues: [],
    })
    res = await autoSyncService.runOnce({
      context: getValidContext(),
      trigger: AUTO_SYNC_TRIGGER_ONLINE,
      online: true,
      isForeground: true,
    })
    expect(res.ok).toBe(false)
    expect(res.code).toBe('AUTO_SYNC_HEALTH_CHECK_FAILED')

    // Advance clock past cooldown
    currentTime += AUTO_SYNC_COOLDOWN_MS + 1000

    // Case 3: status attention + code SYNC_HEALTH_READY
    healthService.checkHealth.mockResolvedValueOnce({
      ok: true,
      status: 'attention',
      code: 'SYNC_HEALTH_READY',
      issues: [{ code: 'SYNC_PENDING_QUEUE', severity: 'attention' }],
    })
    res = await autoSyncService.runOnce({
      context: getValidContext(),
      trigger: AUTO_SYNC_TRIGGER_ONLINE,
      online: true,
      isForeground: true,
    })
    expect(res.ok).toBe(false)
    expect(res.code).toBe('AUTO_SYNC_HEALTH_CHECK_FAILED')

    // Advance clock past cooldown
    currentTime += AUTO_SYNC_COOLDOWN_MS + 1000

    // Case 4: unknown status
    healthService.checkHealth.mockResolvedValueOnce({
      ok: true,
      status: 'unknown_status',
      code: 'SYNC_HEALTH_READY',
      issues: [],
    })
    res = await autoSyncService.runOnce({
      context: getValidContext(),
      trigger: AUTO_SYNC_TRIGGER_ONLINE,
      online: true,
      isForeground: true,
    })
    expect(res.ok).toBe(false)
    expect(res.code).toBe('AUTO_SYNC_HEALTH_CHECK_FAILED')

    expect(orchestratorService.syncAll).not.toHaveBeenCalled()
  })

  // 149. Exact READY test
  it('149. executes syncAll when health is exact READY with SYNC_HEALTH_READY and empty issues', async () => {
    await autoSyncService.setEnabled({
      context: getValidContext(),
      enabled: true,
    })

    healthService.checkHealth.mockResolvedValueOnce({
      ok: true,
      code: 'SYNC_HEALTH_READY',
      status: 'ready',
      issues: [],
    })

    const res = await autoSyncService.runOnce({
      context: getValidContext(),
      trigger: AUTO_SYNC_TRIGGER_ONLINE,
      online: true,
      isForeground: true,
    })

    expect(res.ok).toBe(true)
    expect(orchestratorService.syncAll).toHaveBeenCalledTimes(1)
  })

  // 150. Exact ATTENTION test
  it('150. executes syncAll when health is exact ATTENTION with SYNC_HEALTH_ATTENTION and pending-only queue', async () => {
    await autoSyncService.setEnabled({
      context: getValidContext(),
      enabled: true,
    })

    healthService.checkHealth.mockResolvedValueOnce({
      ok: true,
      code: 'SYNC_HEALTH_ATTENTION',
      status: 'attention',
      issues: [{ code: 'SYNC_PENDING_QUEUE', severity: 'attention' }],
    })

    const res = await autoSyncService.runOnce({
      context: getValidContext(),
      trigger: AUTO_SYNC_TRIGGER_RESUME,
      online: true,
      isForeground: true,
    })

    expect(res.ok).toBe(true)
    expect(orchestratorService.syncAll).toHaveBeenCalledTimes(1)
  })

  // 151. Context presentation reset
  it('151. clears volatile lastResult and lastTriggeredAt on context switch', async () => {
    const cloudStore = useCloudSessionStore()
    setupAuthenticatedSession(cloudStore)

    const syncAutoSyncStore = useSyncAutoSyncStore()
    syncAutoSyncStore.init({ autoSyncService })
    syncAutoSyncStore.lastResult = { code: 'SYNC_ALL_COMPLETED' }
    syncAutoSyncStore.lastTriggeredAt = '2025-08-28T10:00:00.000Z'

    const wrapper = mount(CloudLoginView)
    await flushPromises()

    expect(wrapper.find('#auto-sync-last-status').text()).toContain('Auto Sync terakhir:')

    // Switch context to Business 99 / Outlet 88
    cloudStore.selectedBusiness = { id: 99, name: 'Biz 99' }
    cloudStore.selectedOutlet = { id: 88, name: 'Outlet 88' }
    await flushPromises()

    expect(syncAutoSyncStore.lastResult).toBeNull()
    expect(syncAutoSyncStore.lastTriggeredAt).toBeNull()
    expect(wrapper.find('#auto-sync-last-status').exists()).toBe(false)
  })

  // 152. Logout resets presentation without clearing durable preference
  it('152. resets presentation state on logout while preserving durable sync auto settings', async () => {
    const cloudStore = useCloudSessionStore()
    setupAuthenticatedSession(cloudStore)

    await autoSyncService.setEnabled({
      context: getValidContext(),
      enabled: true,
    })

    const syncAutoSyncStore = useSyncAutoSyncStore()
    syncAutoSyncStore.init({ autoSyncService })
    syncAutoSyncStore.lastResult = { code: 'SYNC_ALL_COMPLETED' }
    syncAutoSyncStore.lastTriggeredAt = '2025-08-28T10:00:00.000Z'

    const wrapper = mount(CloudLoginView)
    await flushPromises()

    // Trigger logout
    await wrapper.find('#cloud-logout-btn').trigger('click')
    await flushPromises()

    expect(syncAutoSyncStore.lastResult).toBeNull()
    expect(syncAutoSyncStore.lastTriggeredAt).toBeNull()

    // Durable preference must remain in storage
    const raw = await adapter.loadSyncAutoSettings()
    expect(raw).not.toBeNull()
    expect(raw.enabled).toBe(true)
    expect(raw.context.businessId).toBe(10)
  })
})

