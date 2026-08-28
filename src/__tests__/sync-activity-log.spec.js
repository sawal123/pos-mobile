import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { mount, flushPromises } from '@vue/test-utils'
import { createMemoryAdapter } from '@/services/database/memoryAdapter'
import {
  createSyncActivityLogService,
  SYNC_ACTIVITY_TYPES,
  SYNC_ACTIVITY_STATUSES,
  SYNC_ACTIVITY_ACTIONS,
} from '@/services/sync/syncActivityLogService'
import { useSyncActivityLogStore } from '@/stores/syncActivityLogStore'
import { useCloudSessionStore } from '@/stores/cloudSessionStore'
import { useSyncPushStore } from '@/stores/syncPushStore'
import { useSyncPullStore } from '@/stores/syncPullStore'
import { useSyncBootstrapStore } from '@/stores/syncBootstrapStore'
import { useSyncConflictStore } from '@/stores/syncConflictStore'
import { useSyncOrchestratorStore } from '@/stores/syncOrchestratorStore'
import { useSyncHealthStore } from '@/stores/syncHealthStore'
import { useSyncRecoveryStore } from '@/stores/syncRecoveryStore'
import CloudLoginView from '@/views/settings/CloudLoginView.vue'
import { createBackupPayload } from '@/services/backupService'

describe('P19: Sync Activity Log & Audit Trail', () => {
  let pinia
  let adapter
  let activityLogService

  function setupAuthenticatedSession(cloudStore) {
    cloudStore.user = { id: 1, email: 'test@example.com' }
    cloudStore.businesses = [
      { id: 10, name: 'Biz 10', outlets: [{ id: 20, name: 'Outlet 1', status: 'active' }] },
    ]
    cloudStore.selectedBusiness = { id: 10, name: 'Biz 10' }
    cloudStore.selectedOutlet = { id: 20, name: 'Outlet 1' }
    cloudStore.cloudAccess = true
    cloudStore.registeredDeviceId = 77
    cloudStore.deviceIdentifier = 'dev-uuid-123'
  }

  beforeEach(async () => {
    pinia = createPinia()
    setActivePinia(pinia)
    adapter = createMemoryAdapter()
    await adapter.initialize()
    activityLogService = createSyncActivityLogService({ adapter })
  })

  // 47. Test service append
  it('47. records valid entry into durable storage', async () => {
    const startedAt = new Date('2026-08-28T09:00:00Z').toISOString()
    const finishedAt = new Date('2026-08-28T09:00:02Z').toISOString()

    const result = await activityLogService.record({
      type: 'push',
      action: SYNC_ACTIVITY_ACTIONS.PUSH_NOW,
      status: 'success',
      code: 'SYNC_PUSH_SUCCESS',
      startedAt,
      finishedAt,
      businessId: 10,
      outletId: 20,
      deviceIdentifier: 'dev-123',
      registeredDeviceId: 5,
      summary: { sent: 3, remaining: 0 },
    })

    expect(result.ok).toBe(true)
    expect(result.code).toBe('SYNC_ACTIVITY_LOG_RECORDED')
    expect(result.entry.type).toBe('push')
    expect(result.entry.action).toBe('PUSH_NOW')
    expect(result.entry.status).toBe('success')

    const list = await activityLogService.listRecent()
    expect(list).toHaveLength(1)
    expect(list[0].id).toBe(result.entry.id)
    expect(list[0].summary.sent).toBe(3)
  })

  // 48. Test max 100 entries (oldest evicted, newest saved)
  it('48. caps history at 100 entries and drops oldest when 101st is added', async () => {
    const baseTime = new Date('2026-08-28T00:00:00Z').getTime()

    // Add 100 entries sequentially
    for (let i = 1; i <= 100; i++) {
      const startedAt = new Date(baseTime + i * 1000).toISOString()
      const finishedAt = new Date(baseTime + i * 1000 + 100).toISOString()
      await activityLogService.record({
        id: `entry-${i}`,
        type: 'push',
        action: 'PUSH_NOW',
        status: 'success',
        code: `PUSH_${i}`,
        startedAt,
        finishedAt,
      })
    }

    let list = await activityLogService.listRecent({ limit: 150 })
    expect(list).toHaveLength(100)
    expect(list[0].id).toBe('entry-100')
    expect(list[99].id).toBe('entry-1')

    // Add 101st entry
    const startedAt = new Date(baseTime + 101000).toISOString()
    const finishedAt = new Date(baseTime + 101100).toISOString()
    await activityLogService.record({
      id: 'entry-101',
      type: 'pull',
      action: 'PULL_NOW',
      status: 'success',
      code: 'PULL_101',
      startedAt,
      finishedAt,
    })

    list = await activityLogService.listRecent({ limit: 150 })
    expect(list).toHaveLength(100)
    expect(list[0].id).toBe('entry-101')
    expect(list[1].id).toBe('entry-100')
    expect(list.find((e) => e.id === 'entry-1')).toBeUndefined()
  })

  // 49. Test order (newest first)
  it('49. returns recent entries sorted newest first', async () => {
    const t1 = new Date('2026-08-28T09:00:00Z').toISOString()
    const t2 = new Date('2026-08-28T09:05:00Z').toISOString()

    await activityLogService.record({
      id: 'first',
      type: 'push',
      action: 'PUSH_NOW',
      status: 'success',
      code: 'SYNC_PUSH_SUCCESS',
      startedAt: t1,
      finishedAt: t1,
    })

    await activityLogService.record({
      id: 'second',
      type: 'pull',
      action: 'PULL_NOW',
      status: 'success',
      code: 'SYNC_PULL_SUCCESS',
      startedAt: t2,
      finishedAt: t2,
    })

    const list = await activityLogService.listRecent()
    expect(list[0].id).toBe('second')
    expect(list[1].id).toBe('first')
  })

  // 50. Test limit
  it('50. respects custom limit parameter', async () => {
    for (let i = 1; i <= 15; i++) {
      const t = new Date(Date.now() + i * 1000).toISOString()
      await activityLogService.record({
        type: 'health',
        action: 'CHECK_HEALTH',
        status: 'success',
        code: 'HEALTH_CHECK_COMPLETED',
        startedAt: t,
        finishedAt: t,
      })
    }

    const list10 = await activityLogService.listRecent({ limit: 10 })
    expect(list10).toHaveLength(10)

    const list5 = await activityLogService.listRecent({ limit: 5 })
    expect(list5).toHaveLength(5)
  })

  // 51. Test invalid entry
  it('51. rejects invalid entry and does not persist', async () => {
    // Missing type
    const res1 = await activityLogService.record({
      action: 'PUSH_NOW',
      status: 'success',
      code: 'OK',
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
    })
    expect(res1.ok).toBe(false)
    expect(res1.code).toBe('SYNC_ACTIVITY_LOG_INVALID_ENTRY')

    // Invalid status
    const res2 = await activityLogService.record({
      type: 'push',
      action: 'PUSH_NOW',
      status: 'unknown_status',
      code: 'OK',
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
    })
    expect(res2.ok).toBe(false)
    expect(res2.code).toBe('SYNC_ACTIVITY_LOG_INVALID_ENTRY')

    // Type <-> Action mismatch (e.g. push with PULL_NOW)
    const resMismatch = await activityLogService.record({
      type: 'push',
      action: 'PULL_NOW',
      status: 'success',
      code: 'OK',
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
    })
    expect(resMismatch.ok).toBe(false)
    expect(resMismatch.code).toBe('SYNC_ACTIVITY_LOG_INVALID_ENTRY')

    // finishedAt < startedAt
    const res3 = await activityLogService.record({
      type: 'push',
      action: 'PUSH_NOW',
      status: 'success',
      code: 'OK',
      startedAt: '2026-08-28T10:00:00Z',
      finishedAt: '2026-08-28T09:00:00Z',
    })
    expect(res3.ok).toBe(false)
    expect(res3.code).toBe('SYNC_ACTIVITY_LOG_INVALID_ENTRY')

    const list = await activityLogService.listRecent()
    expect(list).toHaveLength(0)
  })

  // 52. Test strict allowlist summary & secret dropping
  it('52. sanitizes and drops token, password, and unallowlisted domain fields from summary and entry', async () => {
    const t = new Date().toISOString()
    const result = await activityLogService.record({
      type: 'push',
      action: 'PUSH_NOW',
      status: 'success',
      code: 'SYNC_PUSH_SUCCESS',
      startedAt: t,
      finishedAt: t,
      token: 'TOP_SECRET_TOKEN',
      userEmail: 'leaked@domain.com',
      summary: {
        sent: 2,
        remaining: 0,
        token: 'secret-token-123',
        password: 'supersecretpass',
        authorization: 'Bearer abc',
        products: [{ name: 'Secret Product' }],
        transactions: [{ total: 50000 }],
        queueSnapshot: { id: 'q-1' },
      },
    })

    expect(result.ok).toBe(true)
    expect(result.entry.token).toBeUndefined()
    expect(result.entry.userEmail).toBeUndefined()
    expect(result.entry.summary.sent).toBe(2)
    expect(result.entry.summary.remaining).toBe(0)
    expect(result.entry.summary.token).toBeUndefined()
    expect(result.entry.summary.password).toBeUndefined()
    expect(result.entry.summary.authorization).toBeUndefined()
    expect(result.entry.summary.products).toBeUndefined()
    expect(result.entry.summary.transactions).toBeUndefined()
    expect(result.entry.summary.queueSnapshot).toBeUndefined()

    // Verify durable storage
    const raw = await adapter.loadSyncActivityLog()
    const persistedJson = JSON.stringify(raw)
    expect(persistedJson).not.toContain('secret-token-123')
    expect(persistedJson).not.toContain('supersecretpass')
    expect(persistedJson).not.toContain('Secret Product')
    expect(persistedJson).not.toContain('TOP_SECRET_TOKEN')
  })

  // 53. Test push success log in CloudLoginView
  it('53. records single PUSH_NOW activity when user clicks Sync Sekarang', async () => {
    const cloudStore = useCloudSessionStore()
    setupAuthenticatedSession(cloudStore)

    const syncPushStore = useSyncPushStore()
    vi.spyOn(syncPushStore, 'pushNow').mockResolvedValue({
      ok: true,
      code: 'SYNC_PUSH_SUCCESS',
      removedQueueIds: ['q1', 'q2'],
      remaining: 0,
      blocked: [],
    })

    const syncActivityLogStore = useSyncActivityLogStore()
    syncActivityLogStore.init({ activityLogService })

    const wrapper = mount(CloudLoginView)
    await flushPromises()

    const syncBtn = wrapper.find('#sync-now-btn')
    expect(syncBtn.exists()).toBe(true)
    await syncBtn.trigger('click')
    await flushPromises()

    const list = await activityLogService.listRecent()
    expect(list).toHaveLength(1)
    expect(list[0].type).toBe('push')
    expect(list[0].action).toBe('PUSH_NOW')
    expect(list[0].status).toBe('success')
    expect(list[0].code).toBe('SYNC_PUSH_SUCCESS')
    expect(list[0].summary.sent).toBe(2)
    expect(list[0].summary.remaining).toBe(0)
  })

  // 54. Test push failure log
  it('54. records failed push activity when network error occurs without mutating original error', async () => {
    const cloudStore = useCloudSessionStore()
    setupAuthenticatedSession(cloudStore)

    const syncPushStore = useSyncPushStore()
    vi.spyOn(syncPushStore, 'pushNow').mockResolvedValue({
      ok: false,
      code: 'NETWORK_ERROR',
      message: 'Jaringan terputus',
    })

    const syncActivityLogStore = useSyncActivityLogStore()
    syncActivityLogStore.init({ activityLogService })

    const wrapper = mount(CloudLoginView)
    await flushPromises()

    await wrapper.find('#sync-now-btn').trigger('click')
    await flushPromises()

    const list = await activityLogService.listRecent()
    expect(list).toHaveLength(1)
    expect(list[0].type).toBe('push')
    expect(list[0].status).toBe('failed')
    expect(list[0].code).toBe('NETWORK_ERROR')

    expect(wrapper.find('#sync-result-message').text()).toContain('Jaringan terputus')
  })

  // 55. Test conflict log
  it('55. records blocked status when push returns SYNC_CONFLICT', async () => {
    const cloudStore = useCloudSessionStore()
    setupAuthenticatedSession(cloudStore)

    const syncPushStore = useSyncPushStore()
    vi.spyOn(syncPushStore, 'pushNow').mockResolvedValue({
      ok: false,
      code: 'SYNC_CONFLICT',
      message: 'Konflik data terdeteksi',
      blocked: ['item-1'],
    })

    const syncActivityLogStore = useSyncActivityLogStore()
    syncActivityLogStore.init({ activityLogService })

    const wrapper = mount(CloudLoginView)
    await flushPromises()

    await wrapper.find('#sync-now-btn').trigger('click')
    await flushPromises()

    const list = await activityLogService.listRecent()
    expect(list).toHaveLength(1)
    expect(list[0].type).toBe('push')
    expect(list[0].status).toBe('blocked')
    expect(list[0].code).toBe('SYNC_CONFLICT')
  })

  // 56. Test full sync no double log
  it('56. records exactly one full_sync activity on Sinkronkan Semua (no push+pull duplicates)', async () => {
    const cloudStore = useCloudSessionStore()
    setupAuthenticatedSession(cloudStore)

    const syncOrchestratorStore = useSyncOrchestratorStore()
    vi.spyOn(syncOrchestratorStore, 'syncAll').mockResolvedValue({
      ok: true,
      code: 'SYNC_ALL_COMPLETED',
      push: { removedQueueIds: ['q1'] },
      pull: { applied: 3 },
      stage: 'done',
    })

    const syncActivityLogStore = useSyncActivityLogStore()
    syncActivityLogStore.init({ activityLogService })

    const wrapper = mount(CloudLoginView)
    await flushPromises()

    await wrapper.find('#sync-all-btn').trigger('click')
    await flushPromises()

    const list = await activityLogService.listRecent()
    expect(list).toHaveLength(1)
    expect(list[0].type).toBe('full_sync')
    expect(list[0].action).toBe('SYNC_ALL')
    expect(list[0].status).toBe('success')
    expect(list[0].summary.pushed).toBe(1)
    expect(list[0].summary.pulled).toBe(3)
  })

  // 57. Test recovery no double log
  it('57. records exactly one recovery activity on recovery action', async () => {
    const cloudStore = useCloudSessionStore()
    setupAuthenticatedSession(cloudStore)

    const syncHealthStore = useSyncHealthStore()
    syncHealthStore.lastResult = {
      status: 'attention',
      code: 'SYNC_HEALTH_ATTENTION',
      summary: { hasInflight: true },
      issues: [{ code: 'SYNC_PUSH_INFLIGHT', severity: 'attention', safeAction: 'RETRY_INFLIGHT' }],
    }

    const syncRecoveryStore = useSyncRecoveryStore()
    vi.spyOn(syncRecoveryStore, 'getRecoveryPlan').mockReturnValue({
      canRecover: true,
      action: 'RETRY_INFLIGHT',
      availableActions: ['RETRY_INFLIGHT'],
      actionLabel: 'Coba Ulang Push',
      message: 'In-flight push perlu dicoba ulang.',
    })
    vi.spyOn(syncRecoveryStore, 'recover').mockResolvedValue({
      ok: true,
      code: 'SYNC_RECOVERY_SUCCESS',
      message: 'Push in-flight berhasil diselesaikan.',
    })

    const syncActivityLogStore = useSyncActivityLogStore()
    syncActivityLogStore.init({ activityLogService })

    const wrapper = mount(CloudLoginView)
    await flushPromises()

    const recoveryBtn = wrapper.find('#recovery-retry-inflight-btn')
    expect(recoveryBtn.exists()).toBe(true)
    await recoveryBtn.trigger('click')
    await flushPromises()

    const list = await activityLogService.listRecent()
    expect(list).toHaveLength(1)
    expect(list[0].type).toBe('recovery')
    expect(list[0].action).toBe('RETRY_INFLIGHT')
    expect(list[0].status).toBe('success')
  })

  // 58. Test internal health check during recovery is NOT logged as separate HEALTH activity
  it('58. does not log internal health check triggered by recovery', async () => {
    const cloudStore = useCloudSessionStore()
    setupAuthenticatedSession(cloudStore)

    const syncRecoveryStore = useSyncRecoveryStore()
    vi.spyOn(syncRecoveryStore, 'recover').mockResolvedValue({
      ok: true,
      code: 'SYNC_RECOVERY_SUCCESS',
      message: 'Recovery selesai',
    })

    const syncActivityLogStore = useSyncActivityLogStore()
    syncActivityLogStore.init({ activityLogService })

    const wrapper = mount(CloudLoginView)
    await flushPromises()

    await wrapper.vm.handleRecovery('CONTINUE_PENDING')
    await flushPromises()

    const list = await activityLogService.listRecent()
    expect(list).toHaveLength(1)
    expect(list[0].type).toBe('recovery')
    expect(list.find((e) => e.type === 'health')).toBeUndefined()
  })

  // 59. Test user explicit health check log
  it('59. records CHECK_HEALTH activity when user clicks Periksa Status Sync', async () => {
    const cloudStore = useCloudSessionStore()
    setupAuthenticatedSession(cloudStore)

    const syncHealthStore = useSyncHealthStore()
    vi.spyOn(syncHealthStore, 'checkHealth').mockResolvedValue({
      status: 'ready',
      code: 'SYNC_HEALTH_READY',
      summary: { pendingCount: 0, openConflictCount: 0, hasInflight: false },
      issues: [],
    })

    const syncActivityLogStore = useSyncActivityLogStore()
    syncActivityLogStore.init({ activityLogService })

    const wrapper = mount(CloudLoginView)
    await flushPromises()

    await wrapper.find('#sync-health-btn').trigger('click')
    await flushPromises()

    const list = await activityLogService.listRecent()
    expect(list).toHaveLength(1)
    expect(list[0].type).toBe('health')
    expect(list[0].action).toBe('CHECK_HEALTH')
    expect(list[0].status).toBe('success')
    expect(list[0].summary.healthStatus).toBe('ready')
  })

  // 60. Test health attention
  it('60. records health activity with attention status', async () => {
    const cloudStore = useCloudSessionStore()
    setupAuthenticatedSession(cloudStore)

    const syncHealthStore = useSyncHealthStore()
    vi.spyOn(syncHealthStore, 'checkHealth').mockResolvedValue({
      status: 'attention',
      code: 'SYNC_HEALTH_ATTENTION',
      summary: { pendingCount: 3, openConflictCount: 0, hasInflight: false },
      issues: [{ code: 'SYNC_PENDING_QUEUE', severity: 'attention' }],
    })

    const syncActivityLogStore = useSyncActivityLogStore()
    syncActivityLogStore.init({ activityLogService })

    const wrapper = mount(CloudLoginView)
    await flushPromises()

    await wrapper.find('#sync-health-btn').trigger('click')
    await flushPromises()

    const list = await activityLogService.listRecent()
    expect(list).toHaveLength(1)
    expect(list[0].status).toBe('attention')
    expect(list[0].summary.pending).toBe(3)
  })

  // 61. Test health blocked
  it('61. records health activity with blocked status', async () => {
    const cloudStore = useCloudSessionStore()
    setupAuthenticatedSession(cloudStore)

    const syncHealthStore = useSyncHealthStore()
    vi.spyOn(syncHealthStore, 'checkHealth').mockResolvedValue({
      status: 'blocked',
      code: 'SYNC_HEALTH_BLOCKED',
      summary: { pendingCount: 0, openConflictCount: 1, hasInflight: false },
      issues: [{ code: 'SYNC_OPEN_CONFLICT', severity: 'blocked' }],
    })

    const syncActivityLogStore = useSyncActivityLogStore()
    syncActivityLogStore.init({ activityLogService })

    const wrapper = mount(CloudLoginView)
    await flushPromises()

    await wrapper.find('#sync-health-btn').trigger('click')
    await flushPromises()

    const list = await activityLogService.listRecent()
    expect(list).toHaveLength(1)
    expect(list[0].status).toBe('blocked')
    expect(list[0].summary.conflicts).toBe(1)
  })

  // 62. Test bootstrap
  it('62. records bootstrap activity on bootstrap action', async () => {
    const cloudStore = useCloudSessionStore()
    setupAuthenticatedSession(cloudStore)

    const syncBootstrapStore = useSyncBootstrapStore()
    syncBootstrapStore.bootstrapState = null
    vi.spyOn(syncBootstrapStore, 'bootstrapNow').mockResolvedValue({
      ok: true,
      code: 'BOOTSTRAP_STAGED',
      stagedCount: 12,
    })

    const syncActivityLogStore = useSyncActivityLogStore()
    syncActivityLogStore.init({ activityLogService })

    const wrapper = mount(CloudLoginView)
    await flushPromises()

    const bootstrapBtn = wrapper.find('#bootstrap-btn')
    expect(bootstrapBtn.exists()).toBe(true)
    await bootstrapBtn.trigger('click')
    await flushPromises()

    const list = await activityLogService.listRecent()
    expect(list).toHaveLength(1)
    expect(list[0].type).toBe('bootstrap')
    expect(list[0].action).toBe('BOOTSTRAP')
    expect(list[0].status).toBe('success')
    expect(list[0].summary.stagedCount).toBe(12)
  })

  // 63. Test conflict use server
  it('63. records USE_SERVER conflict resolution activity', async () => {
    const cloudStore = useCloudSessionStore()
    setupAuthenticatedSession(cloudStore)

    const syncConflictStore = useSyncConflictStore()
    vi.spyOn(syncConflictStore, 'loadConflicts').mockImplementation(async () => {})
    syncConflictStore.conflicts = [
      { id: 'conf-1', status: 'open', entityType: 'product', entityId: 'p-1', localPayload: {}, serverPayload: {} },
    ]
    vi.spyOn(syncConflictStore, 'useServer').mockResolvedValue({
      ok: true,
      code: 'CONFLICT_USE_SERVER_RESOLVED',
    })

    const syncActivityLogStore = useSyncActivityLogStore()
    syncActivityLogStore.init({ activityLogService })

    const wrapper = mount(CloudLoginView)
    await flushPromises()

    const useServerBtn = wrapper.find('#use-server-btn-conf-1')
    expect(useServerBtn.exists()).toBe(true)
    await useServerBtn.trigger('click')
    await flushPromises()

    const list = await activityLogService.listRecent()
    expect(list).toHaveLength(1)
    expect(list[0].type).toBe('conflict')
    expect(list[0].action).toBe('USE_SERVER')
    expect(list[0].status).toBe('success')
  })

  // 64. Test conflict keep local
  it('64. records KEEP_LOCAL conflict resolution activity', async () => {
    const cloudStore = useCloudSessionStore()
    setupAuthenticatedSession(cloudStore)

    const syncConflictStore = useSyncConflictStore()
    vi.spyOn(syncConflictStore, 'loadConflicts').mockImplementation(async () => {})
    syncConflictStore.conflicts = [
      { id: 'conf-2', status: 'open', entityType: 'customer', entityId: 'c-1', localPayload: {}, serverPayload: {} },
    ]
    vi.spyOn(syncConflictStore, 'keepLocal').mockResolvedValue({
      ok: true,
      code: 'CONFLICT_KEEP_LOCAL_RESOLVED',
    })

    const syncActivityLogStore = useSyncActivityLogStore()
    syncActivityLogStore.init({ activityLogService })

    const wrapper = mount(CloudLoginView)
    await flushPromises()

    const keepLocalBtn = wrapper.find('#keep-local-btn-conf-2')
    expect(keepLocalBtn.exists()).toBe(true)
    await keepLocalBtn.trigger('click')
    await flushPromises()

    const list = await activityLogService.listRecent()
    expect(list).toHaveLength(1)
    expect(list[0].type).toBe('conflict')
    expect(list[0].action).toBe('KEEP_LOCAL')
    expect(list[0].status).toBe('success')
  })

  // 65. Test logging failure is non-blocking to main sync operation
  it('65. does not fail main sync operation when activityLogService.record throws or fails', async () => {
    const cloudStore = useCloudSessionStore()
    setupAuthenticatedSession(cloudStore)

    const syncPushStore = useSyncPushStore()
    vi.spyOn(syncPushStore, 'pushNow').mockResolvedValue({
      ok: true,
      code: 'SYNC_PUSH_SUCCESS',
      removedQueueIds: ['q1'],
      remaining: 0,
    })

    const syncActivityLogStore = useSyncActivityLogStore()
    syncActivityLogStore.init({ activityLogService })
    vi.spyOn(activityLogService, 'record').mockRejectedValue(new Error('Disk write error'))

    const wrapper = mount(CloudLoginView)
    await flushPromises()

    await wrapper.find('#sync-now-btn').trigger('click')
    await flushPromises()

    // Sync operation still displays success in UI
    expect(wrapper.find('#sync-result-message').text()).toContain('1 data berhasil dikirim')
  })

  // 66. Test context snapshot on start
  it('66. snapshots business and outlet context at start of operation', async () => {
    const cloudStore = useCloudSessionStore()
    setupAuthenticatedSession(cloudStore)

    let capturedEntry = null
    const syncPushStore = useSyncPushStore()
    vi.spyOn(syncPushStore, 'pushNow').mockImplementation(async () => {
      // Simulate context change during async push
      cloudStore.selectedBusiness = { id: 99, name: 'Business Changed' }
      cloudStore.selectedOutlet = { id: 88, name: 'Outlet Changed' }
      return { ok: true, code: 'SYNC_PUSH_SUCCESS', removedQueueIds: [] }
    })

    const syncActivityLogStore = useSyncActivityLogStore()
    syncActivityLogStore.init({ activityLogService })
    const origRecord = activityLogService.record.bind(activityLogService)
    vi.spyOn(activityLogService, 'record').mockImplementation(async (entry) => {
      capturedEntry = entry
      return origRecord(entry)
    })

    const wrapper = mount(CloudLoginView)
    await flushPromises()

    await wrapper.find('#sync-now-btn').trigger('click')
    await flushPromises()

    expect(capturedEntry).not.toBeNull()
    expect(capturedEntry.businessId).toBe(10)
    expect(capturedEntry.outletId).toBe(20)
    expect(capturedEntry.deviceIdentifier).toBe('dev-uuid-123')
  })

  // 67. Test clear history
  it('67. clearHistory removes activity history without touching queue, inflight, conflicts, or pull state', async () => {
    // Setup state in adapter
    await adapter.saveSyncPushInflight({ requestId: 'req-1' })
    await adapter.saveSyncConflicts({ version: 1, conflicts: [{ id: 'c1' }] })
    await adapter.saveSyncPullState({ cursor: 'cur-123' })
    await adapter.upsertSyncQueueItems([
      {
        id: 'q1',
        entityType: 'product',
        entityId: 'p1',
        operation: 'insert',
      },
    ])

    // Record an activity entry
    await activityLogService.record({
      type: 'push',
      action: 'PUSH_NOW',
      status: 'success',
      code: 'SYNC_PUSH_SUCCESS',
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
    })

    expect(await activityLogService.listRecent()).toHaveLength(1)

    // Clear history
    const clearRes = await activityLogService.clearHistory()
    expect(clearRes.ok).toBe(true)

    // Verify activity history is empty
    expect(await activityLogService.listRecent()).toHaveLength(0)

    // Verify other sync artifacts are intact
    expect(await adapter.loadSyncPushInflight()).toEqual({ requestId: 'req-1' })
    expect(await adapter.loadSyncConflicts()).toEqual({ version: 1, conflicts: [{ id: 'c1' }] })
    expect(await adapter.loadSyncPullState()).toEqual({ cursor: 'cur-123' })
    const queueCount = await adapter.countSyncQueueItems()
    expect(queueCount).toBe(1)
  })

  // 68. Test UI section and buttons exist
  it('68. renders #sync-activity-section and refresh button when canSync is true', async () => {
    const cloudStore = useCloudSessionStore()
    setupAuthenticatedSession(cloudStore)

    const syncActivityLogStore = useSyncActivityLogStore()
    syncActivityLogStore.init({ activityLogService })

    const wrapper = mount(CloudLoginView)
    await flushPromises()

    expect(wrapper.find('#sync-activity-section').exists()).toBe(true)
    expect(wrapper.find('#sync-activity-refresh-btn').exists()).toBe(true)
  })

  // 69. Test UI row rendering
  it('69. renders activity rows with formatted action, status, and summary', async () => {
    const cloudStore = useCloudSessionStore()
    setupAuthenticatedSession(cloudStore)

    await activityLogService.record({
      id: 'act-demo-1',
      type: 'full_sync',
      action: 'SYNC_ALL',
      status: 'success',
      code: 'SYNC_ALL_COMPLETED',
      startedAt: new Date('2026-08-28T09:00:00Z').toISOString(),
      finishedAt: new Date('2026-08-28T09:00:02Z').toISOString(),
      summary: { pushed: 2, pulled: 3 },
    })

    const syncActivityLogStore = useSyncActivityLogStore()
    syncActivityLogStore.init({ activityLogService })

    const wrapper = mount(CloudLoginView)
    await flushPromises()

    const row = wrapper.find('#activity-entry-act-demo-1')
    expect(row.exists()).toBe(true)
    expect(row.text()).toContain('Sinkronkan Semua')
    expect(row.text()).toContain('success')
    expect(row.text()).toContain('2 dikirim • 3 diterapkan')
  })

  // 70. Test clear button does not mutate stores
  it('70. clearing history from UI does not affect pending counts or conflict state', async () => {
    const cloudStore = useCloudSessionStore()
    setupAuthenticatedSession(cloudStore)

    const syncPushStore = useSyncPushStore()
    syncPushStore.pendingCount = 5

    await activityLogService.record({
      type: 'push',
      action: 'PUSH_NOW',
      status: 'success',
      code: 'SYNC_PUSH_SUCCESS',
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
    })

    const syncActivityLogStore = useSyncActivityLogStore()
    syncActivityLogStore.init({ activityLogService })

    const wrapper = mount(CloudLoginView)
    await flushPromises()

    expect(wrapper.find('#sync-activity-clear-btn').exists()).toBe(true)
    await wrapper.find('#sync-activity-clear-btn').trigger('click')
    await flushPromises()

    // Confirmation box shown
    expect(wrapper.find('#sync-activity-clear-confirm').exists()).toBe(true)
    expect(wrapper.find('#sync-activity-clear-confirm').text()).toContain(
      'Hanya riwayat aktivitas sinkronisasi yang dihapus',
    )

    // Confirm clear
    await wrapper.find('#sync-activity-confirm-clear-btn').trigger('click')
    await flushPromises()

    expect(syncActivityLogStore.entries).toHaveLength(0)
    expect(syncPushStore.pendingCount).toBe(5)
  })

  // 71. Test no backup leak (sync_activity_log_v1 excluded from backup payload)
  it('71. ensures sync_activity_log_v1 is never included in backup payload', async () => {
    const mockStores = {
      businessStore: {
        name: 'Toko Test',
        type: 'Retail',
        owner: 'Owner',
        phone: '08123456789',
        outlet: 'Cabang 1',
        mode: 'simple',
      },
      productStore: {
        products: [],
        categories: [],
      },
      customerStore: {
        customers: [],
      },
      expenseStore: {
        expenses: [],
      },
      transactionStore: {
        items: [],
      },
    }

    const backup = createBackupPayload(mockStores)
    const serialized = JSON.stringify(backup)
    expect(serialized).not.toContain('sync_activity_log_v1')
    expect(serialized).not.toContain('entries')
  })

  // ── Concurrency & Serialization Tests ──────────────────────────────────────────

  it('72. handles concurrent record calls without lost updates', async () => {
    const startedAt = new Date().toISOString()
    const finishedAt = new Date().toISOString()

    const results = await Promise.all([
      activityLogService.record({
        id: 'concurrent-1',
        type: 'push',
        action: 'PUSH_NOW',
        status: 'success',
        code: 'PUSH_1',
        startedAt,
        finishedAt,
      }),
      activityLogService.record({
        id: 'concurrent-2',
        type: 'pull',
        action: 'PULL_NOW',
        status: 'success',
        code: 'PULL_2',
        startedAt,
        finishedAt,
      }),
    ])

    expect(results[0].ok).toBe(true)
    expect(results[1].ok).toBe(true)

    const list = await activityLogService.listRecent()
    expect(list).toHaveLength(2)
    const ids = list.map((e) => e.id)
    expect(ids).toContain('concurrent-1')
    expect(ids).toContain('concurrent-2')
  })

  it('73. handles burst of 20 concurrent records with zero lost entries', async () => {
    const promises = []
    const now = Date.now()
    for (let i = 1; i <= 20; i++) {
      const t = new Date(now + i * 100).toISOString()
      promises.push(
        activityLogService.record({
          id: `burst-${i}`,
          type: 'health',
          action: 'CHECK_HEALTH',
          status: 'success',
          code: `HEALTH_${i}`,
          startedAt: t,
          finishedAt: t,
        }),
      )
    }

    const results = await Promise.all(promises)
    expect(results.every((r) => r.ok)).toBe(true)

    const list = await activityLogService.listRecent({ limit: 50 })
    expect(list).toHaveLength(20)
    const uniqueIds = new Set(list.map((e) => e.id))
    expect(uniqueIds.size).toBe(20)
  })

  it('74. preserves max 100 cap and evicts oldest during concurrent record storm', async () => {
    // Seed 95 entries
    const base = Date.now()
    for (let i = 1; i <= 95; i++) {
      const t = new Date(base + i * 10).toISOString()
      await activityLogService.record({
        id: `seed-${i}`,
        type: 'push',
        action: 'PUSH_NOW',
        status: 'success',
        code: 'SEED',
        startedAt: t,
        finishedAt: t,
      })
    }

    // Add 10 concurrent entries
    const stormPromises = []
    for (let i = 1; i <= 10; i++) {
      const t = new Date(base + 1000 + i * 10).toISOString()
      stormPromises.push(
        activityLogService.record({
          id: `storm-${i}`,
          type: 'pull',
          action: 'PULL_NOW',
          status: 'success',
          code: 'STORM',
          startedAt: t,
          finishedAt: t,
        }),
      )
    }

    await Promise.all(stormPromises)

    const list = await activityLogService.listRecent({ limit: 150 })
    expect(list).toHaveLength(100)
    for (let i = 1; i <= 10; i++) {
      expect(list.some((e) => e.id === `storm-${i}`)).toBe(true)
    }
  })

  it('75. ensures clearHistory in race with record deterministically empties history', async () => {
    const t = new Date().toISOString()
    const p1 = activityLogService.record({
      id: 'race-record',
      type: 'push',
      action: 'PUSH_NOW',
      status: 'success',
      code: 'RACE',
      startedAt: t,
      finishedAt: t,
    })
    const p2 = activityLogService.clearHistory()

    await Promise.all([p1, p2])

    const list = await activityLogService.listRecent()
    expect(list).toHaveLength(0)
  })

  it('76. serializes listRecent after pending record calls', async () => {
    const t = new Date().toISOString()
    const p1 = activityLogService.record({
      id: 'order-check',
      type: 'push',
      action: 'PUSH_NOW',
      status: 'success',
      code: 'PUSH_ORDER',
      startedAt: t,
      finishedAt: t,
    })
    const p2 = activityLogService.listRecent()

    const [, list] = await Promise.all([p1, p2])
    expect(list.some((e) => e.id === 'order-check')).toBe(true)
  })

  // ── Adapter Capability Fail Closed Tests ──────────────────────────────────────

  it('77. fails closed with SYNC_ACTIVITY_LOG_ADAPTER_UNSUPPORTED when adapter lacks capabilities', async () => {
    const emptyAdapter = {}
    const svc = createSyncActivityLogService({ adapter: emptyAdapter })

    const recRes = await svc.record({
      type: 'push',
      action: 'PUSH_NOW',
      status: 'success',
      code: 'PUSH',
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
    })
    expect(recRes.ok).toBe(false)
    expect(recRes.code).toBe('SYNC_ACTIVITY_LOG_ADAPTER_UNSUPPORTED')

    const clearRes = await svc.clearHistory()
    expect(clearRes.ok).toBe(false)
    expect(clearRes.code).toBe('SYNC_ACTIVITY_LOG_ADAPTER_UNSUPPORTED')

    await expect(svc.listRecent()).rejects.toThrow('Persistence adapter tidak mendukung')
  })

  // ── Corrupt State Fail Closed Tests ──────────────────────────────────────────

  it('78. refuses to overwrite corrupt state on record and returns SYNC_ACTIVITY_LOG_STATE_INVALID', async () => {
    // Inject corrupt state (version 99)
    await adapter.saveSyncActivityLog({ version: 99, entries: [] })

    const res = await activityLogService.record({
      type: 'push',
      action: 'PUSH_NOW',
      status: 'success',
      code: 'PUSH',
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
    })

    expect(res.ok).toBe(false)
    expect(res.code).toBe('SYNC_ACTIVITY_LOG_STATE_INVALID')

    // Corrupt state remains intact
    const raw = await adapter.loadSyncActivityLog()
    expect(raw.version).toBe(99)
  })

  it('79. refuses to overwrite state containing malformed entries', async () => {
    // Inject state with malformed entry
    await adapter.saveSyncActivityLog({
      version: 1,
      entries: [{ invalid: 'entry' }],
    })

    const res = await activityLogService.record({
      type: 'push',
      action: 'PUSH_NOW',
      status: 'success',
      code: 'PUSH',
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
    })

    expect(res.ok).toBe(false)
    expect(res.code).toBe('SYNC_ACTIVITY_LOG_STATE_INVALID')
  })

  it('80. allows user-explicit clearHistory to clean up corrupt activity log state', async () => {
    // Inject corrupt state
    await adapter.saveSyncActivityLog({ version: 99, entries: 'broken' })

    const clearRes = await activityLogService.clearHistory()
    expect(clearRes.ok).toBe(true)

    const list = await activityLogService.listRecent()
    expect(list).toEqual([])
  })

  // ── Error Propagation to Store & UI ─────────────────────────────────────────

  it('81. propagates listRecent read failure to store and renders error in UI without clobbering existing entries', async () => {
    const cloudStore = useCloudSessionStore()
    setupAuthenticatedSession(cloudStore)

    // Prepopulate store entries
    const syncActivityLogStore = useSyncActivityLogStore()
    syncActivityLogStore.init({ activityLogService })
    syncActivityLogStore.entries = [
      {
        id: 'preserved-1',
        type: 'push',
        action: 'PUSH_NOW',
        status: 'success',
        code: 'SYNC_PUSH_SUCCESS',
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
        summary: { sent: 1 },
      },
    ]

    // Spy listRecent on activityLogService to reject
    vi.spyOn(activityLogService, 'listRecent').mockRejectedValue(new Error('Disk I/O error'))

    const wrapper = mount(CloudLoginView)
    await flushPromises()

    // Trigger refresh button
    await wrapper.find('#sync-activity-refresh-btn').trigger('click')
    await flushPromises()

    expect(syncActivityLogStore.error).toContain('Disk I/O error')
    expect(syncActivityLogStore.entries).toHaveLength(1)
    expect(syncActivityLogStore.entries[0].id).toBe('preserved-1')

    // Error rendered in UI
    expect(wrapper.find('#sync-activity-error').exists()).toBe(true)
    expect(wrapper.find('#sync-activity-error').text()).toContain('Gagal memuat riwayat sinkronisasi')
  })

  // ── ID Deduplication Test ───────────────────────────────────────────────────

  it('82. deduplicates entries with identical ID by updating to newest', async () => {
    const t1 = new Date('2026-08-28T09:00:00Z').toISOString()
    const t2 = new Date('2026-08-28T09:10:00Z').toISOString()

    await activityLogService.record({
      id: 'unique-key',
      type: 'push',
      action: 'PUSH_NOW',
      status: 'failed',
      code: 'NETWORK_ERROR',
      startedAt: t1,
      finishedAt: t1,
    })

    await activityLogService.record({
      id: 'unique-key',
      type: 'push',
      action: 'PUSH_NOW',
      status: 'success',
      code: 'SYNC_PUSH_SUCCESS',
      startedAt: t2,
      finishedAt: t2,
    })

    const list = await activityLogService.listRecent()
    expect(list).toHaveLength(1)
    expect(list[0].id).toBe('unique-key')
    expect(list[0].status).toBe('success')
    expect(list[0].code).toBe('SYNC_PUSH_SUCCESS')
  })
})
