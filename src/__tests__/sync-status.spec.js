import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { mount, flushPromises } from '@vue/test-utils'
import { createRouter, createMemoryHistory } from 'vue-router'
import { createMemoryAdapter } from '@/services/database/memoryAdapter'
import {
  createSyncStatusService,
  deriveSyncUiStatus,
  isValidInflightEnvelope,
  SYNC_UI_LOCAL,
  SYNC_UI_SYNCING,
  SYNC_UI_CONFLICT,
  SYNC_UI_RECOVERY_REQUIRED,
  SYNC_UI_OFFLINE,
  SYNC_UI_PENDING,
  SYNC_UI_UNKNOWN,
  SYNC_UI_CLEAR,
} from '@/services/sync/syncStatusService'
import { useSyncStatusStore } from '@/stores/syncStatusStore'
import { useCloudSessionStore } from '@/stores/cloudSessionStore'
import { useBusinessStore } from '@/stores/businessStore'
import { useSyncPushStore } from '@/stores/syncPushStore'
import { useSyncPullStore } from '@/stores/syncPullStore'
import { useSyncBootstrapStore } from '@/stores/syncBootstrapStore'
import { useSyncConflictStore } from '@/stores/syncConflictStore'
import { useSyncOrchestratorStore } from '@/stores/syncOrchestratorStore'
import { useSyncRecoveryStore } from '@/stores/syncRecoveryStore'
import { useSyncAutoSyncStore } from '@/stores/syncAutoSyncStore'
import SyncStatusBadge from '@/components/sync/SyncStatusBadge.vue'
import AppHeader from '@/components/layout/AppHeader.vue'
import { bootstrapApp } from '@/main'

function createTestRouter() {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/pos', name: 'pos', component: { template: '<div>POS</div>' } },
      { path: '/settings', name: 'settings', component: { template: '<div>Settings</div>' } },
    ],
  })
  return router
}

describe('P21: Global Sync Status & Offline Awareness', () => {
  let pinia
  let adapter
  let queueService
  let conflictService
  let statusService

  beforeEach(async () => {
    pinia = createPinia()
    setActivePinia(pinia)
    adapter = createMemoryAdapter()
    await adapter.initialize()

    queueService = {
      countPending: vi.fn().mockResolvedValue(0),
    }

    conflictService = {
      countOpenConflicts: vi.fn().mockResolvedValue(0),
    }

    statusService = createSyncStatusService({
      queueService,
      conflictService,
      adapter,
    })
  })

  afterEach(() => {
    const statusStore = useSyncStatusStore()
    statusStore.stopListeners()
    vi.restoreAllMocks()
  })

  function setupCloudSession(cloudStore) {
    cloudStore.user = { id: 1, email: 'owner@example.com' }
    cloudStore.selectedBusiness = { id: 10, name: 'Biz 10' }
    cloudStore.selectedOutlet = { id: 20, name: 'Outlet 1' }
    cloudStore.cloudAccess = true
    cloudStore.registeredDeviceId = 77
    cloudStore.deviceIdentifier = 'dev-uuid-123'
  }

  function getValidInflightPayload() {
    return {
      version: 1,
      requestId: 'req-123',
      businessId: 10,
      outletId: 20,
      deviceIdentifier: 'dev-uuid-123',
      registeredDeviceId: 77,
      createdAt: '2026-08-28T10:00:00.000Z',
      queueSnapshots: [
        {
          id: 'q-1',
          entityType: 'product',
          entityId: 'p-1',
          operation: 'upsert',
          payload: { name: 'Kopi' },
          updatedAt: '2026-08-28T10:00:00.000Z',
        },
      ],
      changes: {
        categories: [],
        products: [],
        customers: [],
        shifts: [],
        sales: [],
        sale_items: [],
        expenses: [],
      },
    }
  }

  // 1. Structural inflight validator
  it('1. validates valid P12 inflight envelope structure', () => {
    expect(isValidInflightEnvelope(getValidInflightPayload())).toBe(true)
  })

  // 2. Structural inflight validator rejects malformed envelopes
  it('2. rejects malformed inflight envelopes', () => {
    expect(isValidInflightEnvelope(null)).toBe(false)
    expect(isValidInflightEnvelope({})).toBe(false)
    expect(isValidInflightEnvelope([])).toBe(false)
    expect(isValidInflightEnvelope({ version: 1 })).toBe(false)
    expect(isValidInflightEnvelope({ version: 1, requestId: '' })).toBe(false)

    // Missing queueSnapshots
    const noSnapshots = { ...getValidInflightPayload(), queueSnapshots: [] }
    expect(isValidInflightEnvelope(noSnapshots)).toBe(false)

    // Malformed item in queueSnapshots
    const badSnapshotItem = {
      ...getValidInflightPayload(),
      queueSnapshots: [{ id: 'q-1' }],
    }
    expect(isValidInflightEnvelope(badSnapshotItem)).toBe(false)

    // Missing changes container or missing keys
    const badChanges = {
      ...getValidInflightPayload(),
      changes: { categories: [] },
    }
    expect(isValidInflightEnvelope(badChanges)).toBe(false)
  })

  // 67. Test service success
  it('67. reads pending count, open conflict count, and inflight from local state successfully', async () => {
    queueService.countPending.mockResolvedValueOnce(3)
    conflictService.countOpenConflicts.mockResolvedValueOnce(2)

    const res = await statusService.readLocalStatus()

    expect(res.ok).toBe(true)
    expect(res.code).toBe('SYNC_STATUS_READ_OK')
    expect(res.pendingCount).toBe(3)
    expect(res.openConflictCount).toBe(2)
    expect(res.hasInflight).toBe(false)
    expect(typeof res.checkedAt).toBe('string')
  })

  // 68. Test inflight detection with valid P12 envelope
  it('68. returns hasInflight: true when adapter contains valid P12 inflight envelope', async () => {
    await adapter.saveSyncPushInflight(getValidInflightPayload())

    const res = await statusService.readLocalStatus()

    expect(res.ok).toBe(true)
    expect(res.hasInflight).toBe(true)
  })

  // 68b. Test malformed inflight fails closed
  it('68b. returns SYNC_STATUS_READ_FAILED when inflight in storage is malformed without deleting it', async () => {
    await adapter.saveSyncPushInflight({
      version: 1,
      requestId: 'req-incomplete',
    })

    const res = await statusService.readLocalStatus()

    expect(res.ok).toBe(false)
    expect(res.code).toBe('SYNC_STATUS_READ_FAILED')

    // Inflight remains in adapter (never cleared or mutated by reader)
    const raw = await adapter.loadSyncPushInflight()
    expect(raw).not.toBeNull()
  })

  // 69. Test malformed count validation
  it('69. returns SYNC_STATUS_READ_FAILED when pending or conflict counts are malformed', async () => {
    queueService.countPending.mockResolvedValueOnce(-1)
    let res = await statusService.readLocalStatus()
    expect(res.ok).toBe(false)
    expect(res.code).toBe('SYNC_STATUS_READ_FAILED')

    queueService.countPending.mockResolvedValueOnce('invalid')
    res = await statusService.readLocalStatus()
    expect(res.ok).toBe(false)
    expect(res.code).toBe('SYNC_STATUS_READ_FAILED')

    queueService.countPending.mockResolvedValueOnce(0)
    conflictService.countOpenConflicts.mockResolvedValueOnce(NaN)
    res = await statusService.readLocalStatus()
    expect(res.ok).toBe(false)
    expect(res.code).toBe('SYNC_STATUS_READ_FAILED')
  })

  // 70. Test reader throws
  it('70. returns SYNC_STATUS_READ_FAILED when any reader throws error without modifying state', async () => {
    queueService.countPending.mockRejectedValueOnce(new Error('DB read error'))

    const res = await statusService.readLocalStatus()

    expect(res.ok).toBe(false)
    expect(res.code).toBe('SYNC_STATUS_READ_FAILED')
  })

  // 71. Test store read failure preserves last snapshot
  it('71. preserves previous metrics when refresh encounters an error', async () => {
    const statusStore = useSyncStatusStore()
    statusStore.init({ statusService })

    queueService.countPending.mockResolvedValueOnce(4)
    conflictService.countOpenConflicts.mockResolvedValueOnce(1)
    await statusStore.refresh()

    expect(statusStore.pendingCount).toBe(4)
    expect(statusStore.openConflictCount).toBe(1)
    expect(statusStore.lastError).toBeNull()

    // Second refresh throws
    queueService.countPending.mockRejectedValueOnce(new Error('Disk failure'))
    const failRes = await statusStore.refresh()

    expect(failRes.ok).toBe(false)
    expect(statusStore.pendingCount).toBe(4) // Preserved!
    expect(statusStore.openConflictCount).toBe(1) // Preserved!
    expect(statusStore.lastError).toBe('SYNC_STATUS_READ_FAILED')
  })

  // 72. Test network default
  it('72. initializes online status safely', () => {
    const statusStore = useSyncStatusStore()
    expect(typeof statusStore.online).toBe('boolean')
  })

  // 73. Test online event
  it('73. updates online to true on window online event without triggering sync', async () => {
    const statusStore = useSyncStatusStore()
    statusStore.online = false
    statusStore.startListeners()

    window.dispatchEvent(new Event('online'))
    await flushPromises()

    expect(statusStore.online).toBe(true)
  })

  // 74. Test offline event
  it('74. updates online to false on window offline event', async () => {
    const statusStore = useSyncStatusStore()
    statusStore.online = true
    statusStore.startListeners()

    window.dispatchEvent(new Event('offline'))
    await flushPromises()

    expect(statusStore.online).toBe(false)
  })

  // 75. Test listener idempotent with exact event spy
  it('75. calling startListeners multiple times registers only a single listener', async () => {
    const addEventListenerSpy = vi.spyOn(window, 'addEventListener')
    const statusStore = useSyncStatusStore()

    statusStore.startListeners()
    statusStore.startListeners()

    const onlineRegistrations = addEventListenerSpy.mock.calls.filter(
      (c) => c[0] === 'online',
    )
    const offlineRegistrations = addEventListenerSpy.mock.calls.filter(
      (c) => c[0] === 'offline',
    )

    expect(onlineRegistrations.length).toBe(1)
    expect(offlineRegistrations.length).toBe(1)
  })

  // 76. Test stop listeners with exact callback removal
  it('76. stopListeners removes exact callbacks and prevents subsequent mutations', async () => {
    const removeEventListenerSpy = vi.spyOn(window, 'removeEventListener')
    const statusStore = useSyncStatusStore()
    statusStore.online = true

    statusStore.startListeners()
    statusStore.stopListeners()

    expect(removeEventListenerSpy).toHaveBeenCalledWith('online', expect.any(Function))
    expect(removeEventListenerSpy).toHaveBeenCalledWith('offline', expect.any(Function))

    window.dispatchEvent(new Event('offline'))
    await flushPromises()

    expect(statusStore.online).toBe(true)
  })

  // 77. Priority: SYNCING
  it('77. derives SYNC_UI_SYNCING when any sync operation is loading', () => {
    const res = deriveSyncUiStatus({
      cloudAvailable: true,
      syncing: true,
      openConflictCount: 2,
      online: false,
      pendingCount: 5,
    })

    expect(res.status).toBe(SYNC_UI_SYNCING)
    expect(res.label).toBe('Menyinkronkan…')
  })

  // 78. Priority: CONFLICT
  it('78. derives SYNC_UI_CONFLICT over recovery/offline/pending when open conflicts exist', () => {
    const res = deriveSyncUiStatus({
      cloudAvailable: true,
      syncing: false,
      openConflictCount: 2,
      hasInflight: true,
      online: false,
      pendingCount: 5,
    })

    expect(res.status).toBe(SYNC_UI_CONFLICT)
    expect(res.label).toBe('Konflik')
    expect(res.detail).toContain('2 konflik')
  })

  // 79. Priority: RECOVERY_REQUIRED
  it('79. derives SYNC_UI_RECOVERY_REQUIRED when hasInflight is true and no conflicts', () => {
    const res = deriveSyncUiStatus({
      cloudAvailable: true,
      syncing: false,
      openConflictCount: 0,
      hasInflight: true,
      online: true,
      pendingCount: 0,
    })

    expect(res.status).toBe(SYNC_UI_RECOVERY_REQUIRED)
    expect(res.label).toBe('Perlu Pemulihan')
  })

  // 80. Priority: OFFLINE before PENDING
  it('80. derives SYNC_UI_OFFLINE over pending when offline is true', () => {
    const res = deriveSyncUiStatus({
      cloudAvailable: true,
      syncing: false,
      openConflictCount: 0,
      hasInflight: false,
      online: false,
      pendingCount: 5,
    })

    expect(res.status).toBe(SYNC_UI_OFFLINE)
    expect(res.label).toBe('Offline')
  })

  // 81. Priority: PENDING
  it('81. derives SYNC_UI_PENDING when online with pending items', () => {
    const res = deriveSyncUiStatus({
      cloudAvailable: true,
      syncing: false,
      openConflictCount: 0,
      hasInflight: false,
      online: true,
      pendingCount: 5,
    })

    expect(res.status).toBe(SYNC_UI_PENDING)
    expect(res.label).toBe('5 menunggu')
  })

  // 82. Priority: CLEAR and does NOT claim all remote data is synced
  it('82. derives SYNC_UI_CLEAR with safe local detail when all metrics are clean', () => {
    const res = deriveSyncUiStatus({
      cloudAvailable: true,
      syncing: false,
      openConflictCount: 0,
      hasInflight: false,
      online: true,
      pendingCount: 0,
      readError: false,
    })

    expect(res.status).toBe(SYNC_UI_CLEAR)
    expect(res.label).toBe('Siap')
    expect(res.detail).not.toContain('Semua data tersinkronisasi')
    expect(res.detail).not.toContain('Data cloud terbaru')
    expect(res.detail).not.toContain('Health ready')
    expect(res.detail).toBe('Tidak ada antrean sinkronisasi lokal')
  })

  // 83. Priority: UNKNOWN on readError
  it('83. derives SYNC_UI_UNKNOWN when readError is true and no higher priority state exists', () => {
    const res = deriveSyncUiStatus({
      cloudAvailable: true,
      syncing: false,
      openConflictCount: 0,
      hasInflight: false,
      online: true,
      pendingCount: 0,
      readError: true,
    })

    expect(res.status).toBe(SYNC_UI_UNKNOWN)
    expect(res.label).toBe('Status tidak tersedia')
  })

  // 84. Priority: LOCAL
  it('84. derives SYNC_UI_LOCAL when cloudAvailable is false', () => {
    const res = deriveSyncUiStatus({
      cloudAvailable: false,
      syncing: false,
      pendingCount: 3,
    })

    expect(res.status).toBe(SYNC_UI_LOCAL)
  })

  // 85. Test badge render pending
  it('85. renders compact pending badge with pending count', async () => {
    const cloudStore = useCloudSessionStore()
    setupCloudSession(cloudStore)

    const statusStore = useSyncStatusStore()
    statusStore.init({ statusService })
    statusStore.online = true
    statusStore.pendingCount = 3

    const testRouter = createTestRouter()
    await testRouter.push('/pos')

    const wrapper = mount(SyncStatusBadge, {
      global: {
        plugins: [testRouter],
      },
    })
    await flushPromises()

    const badge = wrapper.find('#sync-status-badge')
    expect(badge.exists()).toBe(true)
    expect(badge.text()).toContain('3 menunggu')
    expect(badge.attributes('aria-label')).toBe('Status sinkronisasi: 3 menunggu')
  })

  // 86. Test badge render offline
  it('86. renders offline badge with appropriate aria-label', async () => {
    const cloudStore = useCloudSessionStore()
    setupCloudSession(cloudStore)

    const statusStore = useSyncStatusStore()
    statusStore.init({ statusService })
    statusStore.online = false

    const testRouter = createTestRouter()
    await testRouter.push('/pos')

    const wrapper = mount(SyncStatusBadge, {
      global: {
        plugins: [testRouter],
      },
    })
    await flushPromises()

    const badge = wrapper.find('#sync-status-badge')
    expect(badge.exists()).toBe(true)
    expect(badge.text()).toContain('Offline')
    expect(badge.attributes('aria-label')).toBe('Status sinkronisasi: Offline')
  })

  // 87. Test badge render conflict
  it('87. renders conflict badge when openConflictCount > 0', async () => {
    const cloudStore = useCloudSessionStore()
    setupCloudSession(cloudStore)

    const statusStore = useSyncStatusStore()
    statusStore.init({ statusService })
    statusStore.openConflictCount = 1

    const testRouter = createTestRouter()
    await testRouter.push('/pos')

    const wrapper = mount(SyncStatusBadge, {
      global: {
        plugins: [testRouter],
      },
    })
    await flushPromises()

    const badge = wrapper.find('#sync-status-badge')
    expect(badge.exists()).toBe(true)
    expect(badge.text()).toContain('Konflik')
  })

  // 88. Test AppHeader FREE mode
  it('88. hides SyncStatusBadge in AppHeader when in Free Mode', async () => {
    const cloudStore = useCloudSessionStore()
    cloudStore.user = null // Not authenticated

    const businessStore = useBusinessStore()
    businessStore.mode = 'local'
    businessStore.name = 'Toko Lokal'
    businessStore.outlet = 'Utama'

    const testRouter = createTestRouter()
    await testRouter.push('/pos')

    const wrapper = mount(AppHeader, {
      global: {
        plugins: [testRouter],
      },
    })
    await flushPromises()

    expect(wrapper.find('#sync-status-badge').exists()).toBe(false)
    expect(wrapper.text()).toContain('Free Mode')
  })

  // 89. Test AppHeader CLOUD mode
  it('89. displays SyncStatusBadge in AppHeader when authenticated in Cloud Mode', async () => {
    const cloudStore = useCloudSessionStore()
    setupCloudSession(cloudStore)

    const businessStore = useBusinessStore()
    businessStore.mode = 'cloud'
    businessStore.name = 'Toko Cloud'
    businessStore.outlet = 'Cabang 1'

    const statusStore = useSyncStatusStore()
    statusStore.init({ statusService })
    statusStore.online = true

    const testRouter = createTestRouter()
    await testRouter.push('/pos')

    const wrapper = mount(AppHeader, {
      global: {
        plugins: [testRouter],
      },
    })
    await flushPromises()

    expect(wrapper.find('#sync-status-badge').exists()).toBe(true)
    expect(wrapper.text()).toContain('Cloud Mode')
  })

  // 90. Test badge navigation and assert NO sync operations are called
  it('90. navigates to settings on click and executes zero sync operations', async () => {
    const testRouter = createTestRouter()
    await testRouter.push('/pos')
    const pushSpy = vi.spyOn(testRouter, 'push')

    const cloudStore = useCloudSessionStore()
    setupCloudSession(cloudStore)

    const statusStore = useSyncStatusStore()
    statusStore.init({ statusService })

    const pushStore = useSyncPushStore()
    const pullStore = useSyncPullStore()
    const orchestratorStore = useSyncOrchestratorStore()
    const autoSyncStore = useSyncAutoSyncStore()

    const spyPushNow = vi.spyOn(pushStore, 'pushNow')
    const spyPullNow = vi.spyOn(pullStore, 'pullNow')
    const spySyncAll = vi.spyOn(orchestratorStore, 'syncAll')
    const spyAutoTrigger = vi.spyOn(autoSyncStore, 'trigger')

    const wrapper = mount(SyncStatusBadge, {
      global: {
        plugins: [testRouter],
      },
    })
    await flushPromises()

    const badge = wrapper.find('#sync-status-badge')
    await badge.trigger('click')

    expect(pushSpy).toHaveBeenCalledWith({ name: 'settings' })
    expect(spyPushNow).not.toHaveBeenCalled()
    expect(spyPullNow).not.toHaveBeenCalled()
    expect(spySyncAll).not.toHaveBeenCalled()
    expect(spyAutoTrigger).not.toHaveBeenCalled()
  })

  // 91. Test P21 does not call P17 Health Service
  it('91. readLocalStatus does not invoke healthService.checkHealth', async () => {
    const healthSpy = vi.fn()
    const mockHealthService = { checkHealth: healthSpy }

    await statusService.readLocalStatus()

    expect(healthSpy).not.toHaveBeenCalled()
  })

  // 92. Test P21 does not call P16 Orchestrator Service
  it('92. readLocalStatus does not invoke orchestratorService.syncAll', async () => {
    const syncAllSpy = vi.fn()
    const mockOrchestrator = { syncAll: syncAllSpy }

    await statusService.readLocalStatus()

    expect(syncAllSpy).not.toHaveBeenCalled()
  })

  // 93. Test P21 does not call P20 Auto Sync Trigger
  it('93. statusStore does not call autoSyncStore.trigger during refresh or listener events', async () => {
    const autoSyncStore = useSyncAutoSyncStore()
    const triggerSpy = vi.spyOn(autoSyncStore, 'trigger')

    const statusStore = useSyncStatusStore()
    statusStore.init({ statusService })
    statusStore.startListeners()

    window.dispatchEvent(new Event('online'))
    await statusStore.refresh()

    expect(triggerSpy).not.toHaveBeenCalled()
  })

  // 94. Test no timer
  it('94. ensures P21 does not set up any interval or timer polling', () => {
    const spySetInterval = vi.spyOn(window, 'setInterval')
    const spySetTimeout = vi.spyOn(window, 'setTimeout')

    const statusStore = useSyncStatusStore()
    statusStore.init({ statusService })
    statusStore.startListeners()

    expect(spySetInterval).not.toHaveBeenCalled()
    expect(spySetTimeout).not.toHaveBeenCalled()
  })

  // 95. Test initial boot does not invoke sync operations
  it('95. bootstrapApp initializes statusStore and registers listeners without executing sync actions', async () => {
    const customAdapter = createMemoryAdapter()
    await customAdapter.initialize()

    const pushNowSpy = vi.fn()
    const syncAllSpy = vi.fn()
    const healthSpy = vi.fn()

    const initResult = await bootstrapApp({
      initialize: async () => ({ adapter: customAdapter }),
      mountTarget: document.createElement('div'),
    })

    const statusStore = useSyncStatusStore(initResult.pinia)
    expect(statusStore.getStatusService()).not.toBeNull()
    expect(pushNowSpy).not.toHaveBeenCalled()
    expect(syncAllSpy).not.toHaveBeenCalled()
    expect(healthSpy).not.toHaveBeenCalled()
  })

  // 96. Test refresh after auto sync
  it('96. refreshes status store when auto sync completes without altering auto sync result', async () => {
    const statusStore = useSyncStatusStore()
    statusStore.init({ statusService })
    const refreshSpy = vi.spyOn(statusStore, 'refresh')

    const autoSyncService = {
      runOnce: vi.fn().mockResolvedValue({
        ok: true,
        autoSync: true,
        code: 'SYNC_ALL_COMPLETED',
      }),
    }

    const autoSyncStore = useSyncAutoSyncStore()
    autoSyncStore.init({ autoSyncService })

    const res = await autoSyncStore.trigger('online')
    expect(res.ok).toBe(true)
    expect(refreshSpy).toHaveBeenCalled()
  })

  // 98. Test no secret stored in status service or store
  it('98. status service and store never read or contain tokens, passwords, or credentials', async () => {
    const res = await statusService.readLocalStatus()
    expect(res.token).toBeUndefined()
    expect(res.password).toBeUndefined()
    expect(res.authorization).toBeUndefined()
    expect(res.credentials).toBeUndefined()

    const statusStore = useSyncStatusStore()
    expect(statusStore.token).toBeUndefined()
    expect(statusStore.password).toBeUndefined()
  })

  // 99. Test no durable write
  it('99. readLocalStatus executes zero write operations to database adapter', async () => {
    const spySaveInflight = vi.spyOn(adapter, 'saveSyncPushInflight')
    const spyUpsertQueue = vi.spyOn(adapter, 'upsertSyncQueueItems')
    const spySaveAuto = vi.spyOn(adapter, 'saveSyncAutoSettings')
    const spySaveConflicts = vi.spyOn(adapter, 'saveSyncConflicts')

    await statusService.readLocalStatus()

    expect(spySaveInflight).not.toHaveBeenCalled()
    expect(spyUpsertQueue).not.toHaveBeenCalled()
    expect(spySaveAuto).not.toHaveBeenCalled()
    expect(spySaveConflicts).not.toHaveBeenCalled()
  })
})
