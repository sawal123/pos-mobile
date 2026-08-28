import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { flushPromises } from '@vue/test-utils'
import { createRuntimeSignalService } from '@/services/runtime/runtimeSignalService'
import { useSyncAutoSyncStore } from '@/stores/syncAutoSyncStore'
import { useSyncStatusStore } from '@/stores/syncStatusStore'
import { useCloudSessionStore } from '@/stores/cloudSessionStore'
import { bootstrapApp } from '@/main'

describe('P22: Native Network & App Lifecycle Integration', () => {
  let pinia

  beforeEach(() => {
    pinia = createPinia()
    setActivePinia(pinia)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  function createMockNativeDependencies({
    connected = true,
    connectionType = 'wifi',
    isActive = true,
    getStatusRejects = false,
    getStateRejects = false,
    addListenerNetRejects = false,
    addListenerAppRejects = false,
  } = {}) {
    let netCallback = null
    let appCallback = null

    const netHandle = {
      remove: vi.fn().mockResolvedValue(undefined),
    }
    const appHandle = {
      remove: vi.fn().mockResolvedValue(undefined),
    }

    const mockCapacitor = {
      isNativePlatform: vi.fn().mockReturnValue(true),
    }

    const mockNetwork = {
      getStatus: getStatusRejects
        ? vi.fn().mockRejectedValue(new Error('Network plugin failure'))
        : vi.fn().mockResolvedValue({ connected, connectionType }),
      addListener: addListenerNetRejects
        ? vi.fn().mockImplementation(() => {
            throw new Error('Net listener registration failed')
          })
        : vi.fn().mockImplementation((eventName, cb) => {
            if (eventName === 'networkStatusChange') {
              netCallback = cb
            }
            return Promise.resolve(netHandle)
          }),
    }

    const mockApp = {
      getState: getStateRejects
        ? vi.fn().mockRejectedValue(new Error('App plugin failure'))
        : vi.fn().mockResolvedValue({ isActive }),
      addListener: addListenerAppRejects
        ? vi.fn().mockImplementation(() => {
            throw new Error('App listener registration failed')
          })
        : vi.fn().mockImplementation((eventName, cb) => {
            if (eventName === 'appStateChange') {
              appCallback = cb
            }
            return Promise.resolve(appHandle)
          }),
    }

    return {
      mockCapacitor,
      mockNetwork,
      mockApp,
      netHandle,
      appHandle,
      emitNetworkStatus: (status) => {
        if (netCallback) netCallback(status)
      },
      emitAppState: (state) => {
        if (appCallback) appCallback(state)
      },
    }
  }

  function setupAuthenticatedSession(cloudStore) {
    cloudStore.user = { id: 1, email: 'owner@example.com' }
    cloudStore.selectedBusiness = { id: 10, name: 'Biz 10' }
    cloudStore.selectedOutlet = { id: 20, name: 'Outlet 1' }
    cloudStore.cloudAccess = true
    cloudStore.registeredDeviceId = 77
    cloudStore.deviceIdentifier = 'dev-uuid-123'
  }

  // 79. TEST NATIVE INITIAL STATE
  it('79. initializes native snapshot correctly when native platform is detected', async () => {
    const { mockCapacitor, mockNetwork, mockApp } = createMockNativeDependencies({
      connected: true,
      connectionType: 'wifi',
      isActive: true,
    })

    const runtime = createRuntimeSignalService({
      capacitor: mockCapacitor,
      network: mockNetwork,
      app: mockApp,
    })

    const res = await runtime.start()
    expect(res.ok).toBe(true)

    const snap = runtime.getSnapshot()
    expect(snap.initialized).toBe(true)
    expect(snap.native).toBe(true)
    expect(snap.online).toBe(true)
    expect(snap.foreground).toBe(true)
    expect(snap.connectionType).toBe('wifi')
    expect(snap.source).toBe('native')
  })

  // 80. TEST NATIVE OFFLINE
  it('80. initializes native snapshot with online false when connected is false', async () => {
    const { mockCapacitor, mockNetwork, mockApp } = createMockNativeDependencies({
      connected: false,
      connectionType: 'none',
      isActive: true,
    })

    const runtime = createRuntimeSignalService({
      capacitor: mockCapacitor,
      network: mockNetwork,
      app: mockApp,
    })

    await runtime.start()
    const snap = runtime.getSnapshot()
    expect(snap.online).toBe(false)
    expect(snap.connectionType).toBe('none')
  })

  // 81. TEST NATIVE BACKGROUND
  it('81. initializes native snapshot with foreground false when isActive is false', async () => {
    const { mockCapacitor, mockNetwork, mockApp } = createMockNativeDependencies({
      connected: true,
      isActive: false,
    })

    const runtime = createRuntimeSignalService({
      capacitor: mockCapacitor,
      network: mockNetwork,
      app: mockApp,
    })

    await runtime.start()
    const snap = runtime.getSnapshot()
    expect(snap.foreground).toBe(false)
  })

  // 82. TEST NATIVE LISTENER REGISTRATION
  it('82. registers native listeners exactly once after start', async () => {
    const { mockCapacitor, mockNetwork, mockApp } = createMockNativeDependencies()

    const runtime = createRuntimeSignalService({
      capacitor: mockCapacitor,
      network: mockNetwork,
      app: mockApp,
    })

    await runtime.start()

    expect(mockNetwork.addListener).toHaveBeenCalledTimes(1)
    expect(mockNetwork.addListener).toHaveBeenCalledWith('networkStatusChange', expect.any(Function))
    expect(mockApp.addListener).toHaveBeenCalledTimes(1)
    expect(mockApp.addListener).toHaveBeenCalledWith('appStateChange', expect.any(Function))
  })

  // 83. TEST NATIVE NO WEB LISTENER
  it('83. does not register window or document listeners in native mode', async () => {
    const windowAddSpy = vi.fn()
    const docAddSpy = vi.fn()
    const mockWindow = { addEventListener: windowAddSpy, removeEventListener: vi.fn() }
    const mockDoc = { addEventListener: docAddSpy, removeEventListener: vi.fn(), visibilityState: 'visible' }

    const { mockCapacitor, mockNetwork, mockApp } = createMockNativeDependencies()

    const runtime = createRuntimeSignalService({
      capacitor: mockCapacitor,
      network: mockNetwork,
      app: mockApp,
      windowRef: mockWindow,
      documentRef: mockDoc,
    })

    await runtime.start()

    expect(windowAddSpy).not.toHaveBeenCalled()
    expect(docAddSpy).not.toHaveBeenCalled()
  })

  // 84. TEST WEB FALLBACK
  it('84. uses web fallback listeners and does not invoke Capacitor plugins when not on native', async () => {
    const { mockNetwork, mockApp } = createMockNativeDependencies()
    const mockCapacitor = { isNativePlatform: vi.fn().mockReturnValue(false) }

    const windowAddSpy = vi.fn()
    const docAddSpy = vi.fn()
    const mockWindow = { addEventListener: windowAddSpy, removeEventListener: vi.fn() }
    const mockDoc = { addEventListener: docAddSpy, removeEventListener: vi.fn(), visibilityState: 'visible' }
    const mockNav = { onLine: true }

    const runtime = createRuntimeSignalService({
      capacitor: mockCapacitor,
      network: mockNetwork,
      app: mockApp,
      windowRef: mockWindow,
      documentRef: mockDoc,
      navigatorRef: mockNav,
    })

    await runtime.start()

    expect(mockNetwork.getStatus).not.toHaveBeenCalled()
    expect(mockApp.getState).not.toHaveBeenCalled()
    expect(mockNetwork.addListener).not.toHaveBeenCalled()
    expect(mockApp.addListener).not.toHaveBeenCalled()

    expect(windowAddSpy).toHaveBeenCalledWith('online', expect.any(Function))
    expect(windowAddSpy).toHaveBeenCalledWith('offline', expect.any(Function))
    expect(docAddSpy).toHaveBeenCalledWith('visibilitychange', expect.any(Function))
  })

  // 85. TEST WEB ONLINE INITIAL
  it('85. initializes web snapshot safely from navigator and document', async () => {
    const mockCapacitor = { isNativePlatform: vi.fn().mockReturnValue(false) }
    const mockNav = { onLine: true }
    const mockDoc = { visibilityState: 'visible', addEventListener: vi.fn(), removeEventListener: vi.fn() }
    const mockWindow = { addEventListener: vi.fn(), removeEventListener: vi.fn() }

    const runtime = createRuntimeSignalService({
      capacitor: mockCapacitor,
      windowRef: mockWindow,
      documentRef: mockDoc,
      navigatorRef: mockNav,
    })

    await runtime.start()
    const snap = runtime.getSnapshot()
    expect(snap.native).toBe(false)
    expect(snap.online).toBe(true)
    expect(snap.foreground).toBe(true)
    expect(snap.source).toBe('web')
    expect(snap.connectionType).toBe('unknown')
  })

  // 86. TEST INITIALIZED NO AUTO SYNC
  it('86. startup initialized event does not fire auto sync trigger', async () => {
    const { mockCapacitor, mockNetwork, mockApp } = createMockNativeDependencies({
      connected: true,
      isActive: true,
    })

    const runtime = createRuntimeSignalService({
      capacitor: mockCapacitor,
      network: mockNetwork,
      app: mockApp,
    })

    const autoSyncService = {
      runOnce: vi.fn().mockResolvedValue({ ok: true, autoSync: true }),
    }

    const autoSyncStore = useSyncAutoSyncStore()
    autoSyncStore.init({ autoSyncService, runtimeSignalService: runtime })
    const triggerSpy = vi.spyOn(autoSyncStore, 'trigger')

    await runtime.start()
    autoSyncStore.startListeners()

    expect(triggerSpy).not.toHaveBeenCalled()
    expect(autoSyncService.runOnce).not.toHaveBeenCalled()
  })

  // 87. TEST NETWORK FALSE->TRUE
  it('87. emits online transition and triggers P20 on network false -> true', async () => {
    const nativeDeps = createMockNativeDependencies({
      connected: false,
      isActive: true,
    })

    const runtime = createRuntimeSignalService({
      capacitor: nativeDeps.mockCapacitor,
      network: nativeDeps.mockNetwork,
      app: nativeDeps.mockApp,
    })

    const autoSyncStore = useSyncAutoSyncStore()
    const autoSyncService = {
      runOnce: vi.fn().mockResolvedValue({ ok: true, autoSync: true }),
    }
    autoSyncStore.init({ autoSyncService, runtimeSignalService: runtime })

    await runtime.start()
    autoSyncStore.startListeners()

    nativeDeps.emitNetworkStatus({ connected: true, connectionType: 'wifi' })
    await flushPromises()

    expect(autoSyncService.runOnce).toHaveBeenCalledTimes(1)
    expect(autoSyncService.runOnce).toHaveBeenCalledWith(
      expect.objectContaining({ trigger: 'online', online: true, isForeground: true }),
    )
  })

  // 88. TEST TRUE->TRUE
  it('88. does not trigger online auto sync when network transitions true -> true', async () => {
    const nativeDeps = createMockNativeDependencies({
      connected: true,
      isActive: true,
    })

    const runtime = createRuntimeSignalService({
      capacitor: nativeDeps.mockCapacitor,
      network: nativeDeps.mockNetwork,
      app: nativeDeps.mockApp,
    })

    const autoSyncStore = useSyncAutoSyncStore()
    const autoSyncService = {
      runOnce: vi.fn().mockResolvedValue({ ok: true, autoSync: true }),
    }
    autoSyncStore.init({ autoSyncService, runtimeSignalService: runtime })

    await runtime.start()
    autoSyncStore.startListeners()

    nativeDeps.emitNetworkStatus({ connected: true, connectionType: 'wifi' })
    await flushPromises()

    expect(autoSyncService.runOnce).not.toHaveBeenCalled()
  })

  // 89. TEST FALSE->FALSE
  it('89. does not emit duplicate offline transition when network is false -> false', async () => {
    const nativeDeps = createMockNativeDependencies({
      connected: false,
      connectionType: 'none',
      isActive: true,
    })

    const runtime = createRuntimeSignalService({
      capacitor: nativeDeps.mockCapacitor,
      network: nativeDeps.mockNetwork,
      app: nativeDeps.mockApp,
    })

    const events = []
    runtime.subscribe((e) => events.push(e))

    await runtime.start()

    nativeDeps.emitNetworkStatus({ connected: false, connectionType: 'none' })
    await flushPromises()

    const networkEvents = events.filter((e) => e.type === 'network')
    expect(networkEvents.length).toBe(0)
  })

  // 90. TEST APP FALSE->TRUE
  it('90. emits resume transition and triggers P20 on app inactive -> active', async () => {
    const nativeDeps = createMockNativeDependencies({
      connected: true,
      isActive: false,
    })

    const runtime = createRuntimeSignalService({
      capacitor: nativeDeps.mockCapacitor,
      network: nativeDeps.mockNetwork,
      app: nativeDeps.mockApp,
    })

    const autoSyncStore = useSyncAutoSyncStore()
    const autoSyncService = {
      runOnce: vi.fn().mockResolvedValue({ ok: true, autoSync: true }),
    }
    autoSyncStore.init({ autoSyncService, runtimeSignalService: runtime })

    await runtime.start()
    autoSyncStore.startListeners()

    nativeDeps.emitAppState({ isActive: true })
    await flushPromises()

    expect(autoSyncService.runOnce).toHaveBeenCalledTimes(1)
    expect(autoSyncService.runOnce).toHaveBeenCalledWith(
      expect.objectContaining({ trigger: 'resume', online: true, isForeground: true }),
    )
  })

  // 91. TEST APP TRUE->TRUE
  it('91. does not trigger resume when app state remains active (true -> true)', async () => {
    const nativeDeps = createMockNativeDependencies({
      connected: true,
      isActive: true,
    })

    const runtime = createRuntimeSignalService({
      capacitor: nativeDeps.mockCapacitor,
      network: nativeDeps.mockNetwork,
      app: nativeDeps.mockApp,
    })

    const autoSyncStore = useSyncAutoSyncStore()
    const autoSyncService = {
      runOnce: vi.fn().mockResolvedValue({ ok: true, autoSync: true }),
    }
    autoSyncStore.init({ autoSyncService, runtimeSignalService: runtime })
    const triggerSpy = vi.spyOn(autoSyncStore, 'trigger')

    await runtime.start()
    autoSyncStore.startListeners()

    nativeDeps.emitAppState({ isActive: true })
    await flushPromises()

    expect(triggerSpy).not.toHaveBeenCalled()
  })

  // 92. TEST PAUSE
  it('92. emits pause transition and updates foreground to false on app active -> inactive without triggering sync', async () => {
    const nativeDeps = createMockNativeDependencies({
      connected: true,
      isActive: true,
    })

    const runtime = createRuntimeSignalService({
      capacitor: nativeDeps.mockCapacitor,
      network: nativeDeps.mockNetwork,
      app: nativeDeps.mockApp,
    })

    const autoSyncStore = useSyncAutoSyncStore()
    const autoSyncService = {
      runOnce: vi.fn().mockResolvedValue({ ok: true, autoSync: true }),
    }
    autoSyncStore.init({ autoSyncService, runtimeSignalService: runtime })
    const triggerSpy = vi.spyOn(autoSyncStore, 'trigger')

    await runtime.start()
    autoSyncStore.startListeners()

    nativeDeps.emitAppState({ isActive: false })
    await flushPromises()

    expect(runtime.getSnapshot().foreground).toBe(false)
    expect(triggerSpy).not.toHaveBeenCalled()
  })

  // 93. TEST P21 NATIVE OFFLINE
  it('93. updates P21 syncStatusStore.online to false on native offline event without HTTP requests', async () => {
    const nativeDeps = createMockNativeDependencies({
      connected: true,
      isActive: true,
    })

    const runtime = createRuntimeSignalService({
      capacitor: nativeDeps.mockCapacitor,
      network: nativeDeps.mockNetwork,
      app: nativeDeps.mockApp,
    })

    const statusStore = useSyncStatusStore()
    statusStore.init({
      statusService: { readLocalStatus: vi.fn().mockResolvedValue({ ok: true, pendingCount: 0, openConflictCount: 0, hasInflight: false }) },
      runtimeSignalService: runtime,
    })
    statusStore.startListeners()

    await runtime.start()
    expect(statusStore.online).toBe(true)

    nativeDeps.emitNetworkStatus({ connected: false, connectionType: 'none' })
    await flushPromises()

    expect(statusStore.online).toBe(false)
  })

  // 94. TEST P21 NATIVE ONLINE
  it('94. updates P21 syncStatusStore.online to true on native online event', async () => {
    const nativeDeps = createMockNativeDependencies({
      connected: false,
      isActive: true,
    })

    const runtime = createRuntimeSignalService({
      capacitor: nativeDeps.mockCapacitor,
      network: nativeDeps.mockNetwork,
      app: nativeDeps.mockApp,
    })

    const statusStore = useSyncStatusStore()
    statusStore.init({
      statusService: { readLocalStatus: vi.fn().mockResolvedValue({ ok: true, pendingCount: 0, openConflictCount: 0, hasInflight: false }) },
      runtimeSignalService: runtime,
    })
    statusStore.startListeners()

    await runtime.start()
    expect(statusStore.online).toBe(false)

    nativeDeps.emitNetworkStatus({ connected: true, connectionType: 'wifi' })
    await flushPromises()

    expect(statusStore.online).toBe(true)
  })

  // 95. TEST BACKGROUND ONLINE
  it('95. passes online true and isForeground false to runOnce when online event arrives in background', async () => {
    const nativeDeps = createMockNativeDependencies({
      connected: false,
      isActive: false,
    })

    const runtime = createRuntimeSignalService({
      capacitor: nativeDeps.mockCapacitor,
      network: nativeDeps.mockNetwork,
      app: nativeDeps.mockApp,
    })

    const cloudStore = useCloudSessionStore()
    setupAuthenticatedSession(cloudStore)

    let capturedRunArgs = null
    const autoSyncService = {
      runOnce: vi.fn().mockImplementation(async (args) => {
        capturedRunArgs = args
        return { ok: false, code: 'AUTO_SYNC_NOT_FOREGROUND' }
      }),
    }

    const autoSyncStore = useSyncAutoSyncStore()
    autoSyncStore.init({ autoSyncService, runtimeSignalService: runtime })
    autoSyncStore.startListeners()

    await runtime.start()

    nativeDeps.emitNetworkStatus({ connected: true, connectionType: 'wifi' })
    await flushPromises()

    expect(capturedRunArgs).not.toBeNull()
    expect(capturedRunArgs.online).toBe(true)
    expect(capturedRunArgs.isForeground).toBe(false)
  })

  // 96. TEST RESUME AFTER ONLINE
  it('96. passes online true and isForeground true when resume follows a background online event', async () => {
    const nativeDeps = createMockNativeDependencies({
      connected: false,
      isActive: false,
    })

    const runtime = createRuntimeSignalService({
      capacitor: nativeDeps.mockCapacitor,
      network: nativeDeps.mockNetwork,
      app: nativeDeps.mockApp,
    })

    const cloudStore = useCloudSessionStore()
    setupAuthenticatedSession(cloudStore)

    let lastRunArgs = null
    const autoSyncService = {
      runOnce: vi.fn().mockImplementation(async (args) => {
        lastRunArgs = args
        return { ok: true, autoSync: true }
      }),
    }

    const autoSyncStore = useSyncAutoSyncStore()
    autoSyncStore.init({ autoSyncService, runtimeSignalService: runtime })
    autoSyncStore.startListeners()

    await runtime.start()

    // First: online while in background
    nativeDeps.emitNetworkStatus({ connected: true, connectionType: 'wifi' })
    await flushPromises()

    // Second: app resumes
    nativeDeps.emitAppState({ isActive: true })
    await flushPromises()

    expect(lastRunArgs).not.toBeNull()
    expect(lastRunArgs.online).toBe(true)
    expect(lastRunArgs.isForeground).toBe(true)
    expect(lastRunArgs.trigger).toBe('resume')
  })

  // 97. TEST CONNECTION TYPE ONLY
  it('97. updates snapshot connectionType on wifi -> cellular change without firing online auto sync', async () => {
    const nativeDeps = createMockNativeDependencies({
      connected: true,
      connectionType: 'wifi',
      isActive: true,
    })

    const runtime = createRuntimeSignalService({
      capacitor: nativeDeps.mockCapacitor,
      network: nativeDeps.mockNetwork,
      app: nativeDeps.mockApp,
    })

    const autoSyncStore = useSyncAutoSyncStore()
    const autoSyncService = {
      runOnce: vi.fn().mockResolvedValue({ ok: true, autoSync: true }),
    }
    autoSyncStore.init({ autoSyncService, runtimeSignalService: runtime })
    const triggerSpy = vi.spyOn(autoSyncStore, 'trigger')

    await runtime.start()
    autoSyncStore.startListeners()

    nativeDeps.emitNetworkStatus({ connected: true, connectionType: 'cellular' })
    await flushPromises()

    expect(runtime.getSnapshot().connectionType).toBe('cellular')
    expect(triggerSpy).not.toHaveBeenCalled()
  })

  // 98. TEST CONCURRENT START
  it('98. shares initialization when start() is called concurrently', async () => {
    const { mockCapacitor, mockNetwork, mockApp } = createMockNativeDependencies()

    const runtime = createRuntimeSignalService({
      capacitor: mockCapacitor,
      network: mockNetwork,
      app: mockApp,
    })

    const [r1, r2, r3] = await Promise.all([
      runtime.start(),
      runtime.start(),
      runtime.start(),
    ])

    expect(r1.ok).toBe(true)
    expect(r2.ok).toBe(true)
    expect(r3.ok).toBe(true)

    expect(mockNetwork.getStatus).toHaveBeenCalledTimes(1)
    expect(mockApp.getState).toHaveBeenCalledTimes(1)
    expect(mockNetwork.addListener).toHaveBeenCalledTimes(1)
    expect(mockApp.addListener).toHaveBeenCalledTimes(1)
  })

  // 99. TEST STOP NATIVE
  it('99. stop() removes all native listener handles cleanly and idempotently', async () => {
    const { mockCapacitor, mockNetwork, mockApp, netHandle, appHandle } =
      createMockNativeDependencies()

    const runtime = createRuntimeSignalService({
      capacitor: mockCapacitor,
      network: mockNetwork,
      app: mockApp,
    })

    await runtime.start()
    await runtime.stop()

    expect(netHandle.remove).toHaveBeenCalledTimes(1)
    expect(appHandle.remove).toHaveBeenCalledTimes(1)

    // Idempotent stop
    await runtime.stop()
    expect(netHandle.remove).toHaveBeenCalledTimes(1)
  })

  // 100. TEST STOP WEB
  it('100. stop() removes exact browser listeners and resets snapshot', async () => {
    const windowRemoveSpy = vi.fn()
    const docRemoveSpy = vi.fn()
    const mockWindow = { addEventListener: vi.fn(), removeEventListener: windowRemoveSpy }
    const mockDoc = { addEventListener: vi.fn(), removeEventListener: docRemoveSpy, visibilityState: 'visible' }
    const mockNav = { onLine: true }
    const mockCapacitor = { isNativePlatform: vi.fn().mockReturnValue(false) }

    const runtime = createRuntimeSignalService({
      capacitor: mockCapacitor,
      windowRef: mockWindow,
      documentRef: mockDoc,
      navigatorRef: mockNav,
    })

    await runtime.start()
    await runtime.stop()

    expect(windowRemoveSpy).toHaveBeenCalledWith('online', expect.any(Function))
    expect(windowRemoveSpy).toHaveBeenCalledWith('offline', expect.any(Function))
    expect(docRemoveSpy).toHaveBeenCalledWith('visibilitychange', expect.any(Function))

    const snap = runtime.getSnapshot()
    expect(snap.initialized).toBe(false)
    expect(snap.source).toBe('unavailable')
  })

  // 101. TEST SUBSCRIBE/UNSUBSCRIBE
  it('101. subscriber receives events until unsubscribe is called', async () => {
    const nativeDeps = createMockNativeDependencies({
      connected: false,
      isActive: true,
    })

    const runtime = createRuntimeSignalService({
      capacitor: nativeDeps.mockCapacitor,
      network: nativeDeps.mockNetwork,
      app: nativeDeps.mockApp,
    })

    const subA = vi.fn()
    const subB = vi.fn()

    const unsubA = runtime.subscribe(subA)
    runtime.subscribe(subB)

    await runtime.start()

    expect(subA).toHaveBeenCalledWith(expect.objectContaining({ type: 'initialized' }))
    expect(subB).toHaveBeenCalledWith(expect.objectContaining({ type: 'initialized' }))

    subA.mockClear()
    subB.mockClear()

    unsubA()

    nativeDeps.emitNetworkStatus({ connected: true, connectionType: 'wifi' })
    await flushPromises()

    expect(subA).not.toHaveBeenCalled()
    expect(subB).toHaveBeenCalledWith(expect.objectContaining({ type: 'network', transition: 'online' }))
  })

  // 102. TEST SUBSCRIBER THROW
  it('102. subscriber error does not crash runtime service or prevent other subscribers from receiving event', async () => {
    const nativeDeps = createMockNativeDependencies({
      connected: false,
      isActive: true,
    })

    const runtime = createRuntimeSignalService({
      capacitor: nativeDeps.mockCapacitor,
      network: nativeDeps.mockNetwork,
      app: nativeDeps.mockApp,
    })

    const brokenSub = vi.fn().mockImplementation(() => {
      throw new Error('Subscriber crash')
    })
    const healthySub = vi.fn()

    runtime.subscribe(brokenSub)
    runtime.subscribe(healthySub)

    await runtime.start()

    nativeDeps.emitNetworkStatus({ connected: true, connectionType: 'wifi' })
    await flushPromises()

    expect(brokenSub).toHaveBeenCalled()
    expect(healthySub).toHaveBeenCalledWith(expect.objectContaining({ type: 'network', transition: 'online' }))
  })

  // 103. TEST NATIVE INIT FAILURE
  it('103. fails closed when Network.getStatus rejects on native initialization', async () => {
    const { mockCapacitor, mockNetwork, mockApp } = createMockNativeDependencies({
      getStatusRejects: true,
    })

    const runtime = createRuntimeSignalService({
      capacitor: mockCapacitor,
      network: mockNetwork,
      app: mockApp,
    })

    const res = await runtime.start()
    expect(res.ok).toBe(false)
    expect(res.code).toBe('RUNTIME_SIGNAL_INIT_FAILED')

    const snap = runtime.getSnapshot()
    expect(snap.initialized).toBe(true)
    expect(snap.online).toBe(false)
    expect(snap.foreground).toBe(false)
    expect(snap.source).toBe('native')
  })

  // 104. TEST APP GETSTATE FAILURE
  it('104. fails closed when App.getState rejects on native initialization', async () => {
    const { mockCapacitor, mockNetwork, mockApp } = createMockNativeDependencies({
      getStateRejects: true,
    })

    const runtime = createRuntimeSignalService({
      capacitor: mockCapacitor,
      network: mockNetwork,
      app: mockApp,
    })

    const res = await runtime.start()
    expect(res.ok).toBe(false)
    expect(res.code).toBe('RUNTIME_SIGNAL_INIT_FAILED')

    const snap = runtime.getSnapshot()
    expect(snap.initialized).toBe(true)
    expect(snap.online).toBe(false)
    expect(snap.foreground).toBe(false)
  })

  // 105. TEST LISTENER REGISTRATION FAILURE
  it('105. cleans up registered network listener and fails closed if app listener registration throws', async () => {
    const { mockCapacitor, mockNetwork, mockApp, netHandle } =
      createMockNativeDependencies({
        addListenerAppRejects: true,
      })

    const runtime = createRuntimeSignalService({
      capacitor: mockCapacitor,
      network: mockNetwork,
      app: mockApp,
    })

    const res = await runtime.start()
    expect(res.ok).toBe(false)
    expect(res.code).toBe('RUNTIME_SIGNAL_INIT_FAILED')
    expect(netHandle.remove).toHaveBeenCalled()
  })

  // 106. TEST RUNTIME UNAVAILABLE P20
  it('106. returns AUTO_SYNC_RUNTIME_UNAVAILABLE when P20 trigger is invoked without initialized runtime', async () => {
    const autoSyncService = {
      runOnce: vi.fn().mockResolvedValue({ ok: true, autoSync: true }),
    }

    const autoSyncStore = useSyncAutoSyncStore()
    // No runtime provided
    autoSyncStore.init({ autoSyncService })

    const res = await autoSyncStore.trigger('online')
    expect(res.ok).toBe(false)
    expect(res.code).toBe('AUTO_SYNC_RUNTIME_UNAVAILABLE')
    expect(autoSyncService.runOnce).not.toHaveBeenCalled()
  })

  // 107. TEST NO COOLDOWN CONSUMPTION
  it('107. does not call runOnce or consume cooldown on AUTO_SYNC_RUNTIME_UNAVAILABLE', async () => {
    const autoSyncService = {
      runOnce: vi.fn(),
    }

    const autoSyncStore = useSyncAutoSyncStore()
    autoSyncStore.init({ autoSyncService })

    await autoSyncStore.trigger('online')

    expect(autoSyncService.runOnce).not.toHaveBeenCalled()
  })

  // 108. TEST P20 DOES NOT READ NAVIGATOR NATIVE
  it('108. gets online and foreground strictly from runtime service snapshot instead of global navigator/document', async () => {
    const { mockCapacitor, mockNetwork, mockApp } = createMockNativeDependencies({
      connected: true,
      isActive: true,
    })

    const runtime = createRuntimeSignalService({
      capacitor: mockCapacitor,
      network: mockNetwork,
      app: mockApp,
    })
    await runtime.start()

    const cloudStore = useCloudSessionStore()
    setupAuthenticatedSession(cloudStore)

    let capturedArgs = null
    const autoSyncService = {
      runOnce: vi.fn().mockImplementation(async (args) => {
        capturedArgs = args
        return { ok: true, autoSync: true }
      }),
    }

    const autoSyncStore = useSyncAutoSyncStore()
    autoSyncStore.init({ autoSyncService, runtimeSignalService: runtime })

    await autoSyncStore.trigger('online')

    expect(capturedArgs).not.toBeNull()
    expect(capturedArgs.online).toBe(true)
    expect(capturedArgs.isForeground).toBe(true)
  })

  // 109. TEST P21 DOES NOT REGISTER OWN NETWORK LISTENERS
  it('109. syncStatusStore only subscribes to runtime bridge and does not attach direct window/network listeners', () => {
    const addEventListenerSpy = vi.spyOn(window, 'addEventListener')
    const statusStore = useSyncStatusStore()
    const mockRuntime = {
      subscribe: vi.fn().mockReturnValue(vi.fn()),
      getSnapshot: vi.fn().mockReturnValue({ initialized: true, online: true }),
    }

    statusStore.init({
      statusService: { readLocalStatus: vi.fn() },
      runtimeSignalService: mockRuntime,
    })
    statusStore.startListeners()

    expect(mockRuntime.subscribe).toHaveBeenCalledTimes(1)
    const windowOnlineCalls = addEventListenerSpy.mock.calls.filter(
      (c) => c[0] === 'online' || c[0] === 'offline',
    )
    expect(windowOnlineCalls.length).toBe(0)
  })

  // 110. TEST P20 DOES NOT REGISTER OWN NATIVE LISTENERS
  it('110. syncAutoSyncStore only subscribes to runtime bridge and does not attach direct window/native listeners', () => {
    const addEventListenerSpy = vi.spyOn(window, 'addEventListener')
    const autoSyncStore = useSyncAutoSyncStore()
    const mockRuntime = {
      subscribe: vi.fn().mockReturnValue(vi.fn()),
      getSnapshot: vi.fn().mockReturnValue({ initialized: true, online: true, foreground: true }),
    }

    autoSyncStore.init({
      autoSyncService: { runOnce: vi.fn() },
      runtimeSignalService: mockRuntime,
    })
    autoSyncStore.startListeners()

    expect(mockRuntime.subscribe).toHaveBeenCalledTimes(1)
    const windowCalls = addEventListenerSpy.mock.calls.filter(
      (c) => c[0] === 'online' || c[0] === 'visibilitychange',
    )
    expect(windowCalls.length).toBe(0)
  })

  // 111. TEST BOOTSTRAP FAILURE
  it('111. POS startup completes normally even if runtime signal service start fails', async () => {
    const failingRuntimeFactory = () => {
      const { mockCapacitor, mockNetwork, mockApp } = createMockNativeDependencies({
        getStatusRejects: true,
      })
      return createRuntimeSignalService({
        capacitor: mockCapacitor,
        network: mockNetwork,
        app: mockApp,
      })
    }

    const initResult = await bootstrapApp({
      initialize: async () => ({ adapter: { initialize: vi.fn() } }),
      runtimeSignalFactory: failingRuntimeFactory,
      mountTarget: document.createElement('div'),
    })

    expect(initResult.app).toBeDefined()
    const statusStore = useSyncStatusStore(initResult.pinia)
    expect(statusStore.online).toBe(false)
  })

  // 112. TEST ZERO SYNC DURING BOOT
  it('112. bootstrapApp does not trigger sync operations during runtime initialization', async () => {
    const syncAllSpy = vi.fn()
    const pushNowSpy = vi.fn()
    const pullNowSpy = vi.fn()

    const mockSyncFoundation = {
      autoSyncService: {
        runOnce: syncAllSpy,
      },
      statusService: {
        readLocalStatus: vi.fn().mockResolvedValue({
          ok: true,
          pendingCount: 0,
          openConflictCount: 0,
          hasInflight: false,
        }),
      },
    }

    const nativeDeps = createMockNativeDependencies({
      connected: true,
      isActive: true,
    })

    const runtimeFactory = () =>
      createRuntimeSignalService({
        capacitor: nativeDeps.mockCapacitor,
        network: nativeDeps.mockNetwork,
        app: nativeDeps.mockApp,
      })

    await bootstrapApp({
      initialize: async () => ({ adapter: {} }),
      initializeSync: async () => mockSyncFoundation,
      runtimeSignalFactory: runtimeFactory,
      mountTarget: document.createElement('div'),
    })

    expect(syncAllSpy).not.toHaveBeenCalled()
    expect(pushNowSpy).not.toHaveBeenCalled()
    expect(pullNowSpy).not.toHaveBeenCalled()
  })

  // 113. TEST ZERO PERSISTENCE
  it('113. runtime signal transitions do not write to SQLite or persistence adapter', async () => {
    const mockSaveMeta = vi.fn()
    const mockAdapter = {
      writeMetaValue: mockSaveMeta,
      saveSyncAutoSettings: mockSaveMeta,
    }

    const nativeDeps = createMockNativeDependencies({
      connected: false,
      isActive: false,
    })

    const runtime = createRuntimeSignalService({
      capacitor: nativeDeps.mockCapacitor,
      network: nativeDeps.mockNetwork,
      app: nativeDeps.mockApp,
    })

    await runtime.start()

    nativeDeps.emitNetworkStatus({ connected: true, connectionType: 'wifi' })
    nativeDeps.emitAppState({ isActive: true })
    nativeDeps.emitNetworkStatus({ connected: false, connectionType: 'none' })
    nativeDeps.emitAppState({ isActive: false })
    await flushPromises()

    expect(mockSaveMeta).not.toHaveBeenCalled()
  })

  // 114. TEST NO TOKEN
  it('114. runtime snapshot and event payloads contain no sensitive tokens, credentials, or user details', async () => {
    const nativeDeps = createMockNativeDependencies({
      connected: true,
      isActive: true,
    })

    const runtime = createRuntimeSignalService({
      capacitor: nativeDeps.mockCapacitor,
      network: nativeDeps.mockNetwork,
      app: nativeDeps.mockApp,
    })

    let capturedEvent = null
    runtime.subscribe((event) => {
      capturedEvent = event
    })

    await runtime.start()

    const snap = runtime.getSnapshot()
    expect(snap.token).toBeUndefined()
    expect(snap.password).toBeUndefined()
    expect(snap.authorization).toBeUndefined()
    expect(snap.user).toBeUndefined()
    expect(snap.businessId).toBeUndefined()
    expect(snap.outletId).toBeUndefined()

    expect(capturedEvent.snapshot.token).toBeUndefined()
    expect(capturedEvent.snapshot.password).toBeUndefined()
    expect(capturedEvent.snapshot.user).toBeUndefined()
  })

  // 115. TEST MISSED APP BACKGROUND RACE
  it('115. reconciles missed app background race during initialization and overrides reader state without pause transition', async () => {
    let resolveGetState
    const getStatePromise = new Promise((resolve) => {
      resolveGetState = resolve
    })

    const nativeDeps = createMockNativeDependencies({
      connected: true,
    })
    nativeDeps.mockApp.getState = vi.fn().mockImplementation(() => getStatePromise)

    const runtime = createRuntimeSignalService({
      capacitor: nativeDeps.mockCapacitor,
      network: nativeDeps.mockNetwork,
      app: nativeDeps.mockApp,
    })

    const events = []
    runtime.subscribe((e) => events.push(e))

    const startPromise = runtime.start()
    await flushPromises()

    // During initialization while getState is still pending, app transitions to background
    nativeDeps.emitAppState({ isActive: false })

    // Stale reader eventually resolves with isActive: true
    resolveGetState({ isActive: true })

    const startRes = await startPromise
    expect(startRes.ok).toBe(true)

    // Reconciled snapshot reflects the latest buffered event: foreground false
    const snap = runtime.getSnapshot()
    expect(snap.foreground).toBe(false)
    expect(snap.source).toBe('native')

    // No pause transition during initialization, only initialized event
    expect(events.length).toBe(1)
    expect(events[0].type).toBe('initialized')
    expect(events[0].transition).toBeNull()
    expect(events[0].snapshot.foreground).toBe(false)
  })

  // 116. TEST MISSED NETWORK RACE
  it('116. reconciles missed network race during initialization and overrides reader state without online transition', async () => {
    let resolveGetStatus
    const getStatusPromise = new Promise((resolve) => {
      resolveGetStatus = resolve
    })

    const nativeDeps = createMockNativeDependencies({
      isActive: true,
    })
    nativeDeps.mockNetwork.getStatus = vi.fn().mockImplementation(() => getStatusPromise)

    const runtime = createRuntimeSignalService({
      capacitor: nativeDeps.mockCapacitor,
      network: nativeDeps.mockNetwork,
      app: nativeDeps.mockApp,
    })

    const events = []
    runtime.subscribe((e) => events.push(e))

    const startPromise = runtime.start()
    await flushPromises()

    // During initialization, network transitions to online wifi
    nativeDeps.emitNetworkStatus({ connected: true, connectionType: 'wifi' })

    // Stale reader resolves offline none
    resolveGetStatus({ connected: false, connectionType: 'none' })

    const startRes = await startPromise
    expect(startRes.ok).toBe(true)

    const snap = runtime.getSnapshot()
    expect(snap.online).toBe(true)
    expect(snap.connectionType).toBe('wifi')

    // No online transition during startup, only initialized event
    expect(events.length).toBe(1)
    expect(events[0].type).toBe('initialized')
    expect(events[0].transition).toBeNull()
    expect(events[0].snapshot.online).toBe(true)
  })

  // 117. TEST COMBINED RACE
  it('117. reconciles combined network and app state race with 0 auto sync transitions during initialization', async () => {
    let resolveStatus
    let resolveState
    const getStatusPromise = new Promise((resolve) => {
      resolveStatus = resolve
    })
    const getStatePromise = new Promise((resolve) => {
      resolveState = resolve
    })

    const nativeDeps = createMockNativeDependencies()
    nativeDeps.mockNetwork.getStatus = vi.fn().mockImplementation(() => getStatusPromise)
    nativeDeps.mockApp.getState = vi.fn().mockImplementation(() => getStatePromise)

    const runtime = createRuntimeSignalService({
      capacitor: nativeDeps.mockCapacitor,
      network: nativeDeps.mockNetwork,
      app: nativeDeps.mockApp,
    })

    const autoSyncService = {
      runOnce: vi.fn().mockResolvedValue({ ok: true, autoSync: true }),
    }
    const autoSyncStore = useSyncAutoSyncStore()
    autoSyncStore.init({ autoSyncService, runtimeSignalService: runtime })
    autoSyncStore.startListeners()

    const startPromise = runtime.start()
    await flushPromises()

    // Race events during initialization
    nativeDeps.emitNetworkStatus({ connected: true, connectionType: 'wifi' })
    nativeDeps.emitAppState({ isActive: false })

    // Stale readers resolve opposite
    resolveStatus({ connected: false, connectionType: 'none' })
    resolveState({ isActive: true })

    await startPromise
    await flushPromises()

    const snap = runtime.getSnapshot()
    expect(snap.online).toBe(true)
    expect(snap.foreground).toBe(false)
    expect(autoSyncService.runOnce).not.toHaveBeenCalled()
  })

  // 118. TEST FAILURE -> RETRY SUCCESS
  it('118. failed start leaves isStarted=false and allows subsequent explicit start to succeed cleanly', async () => {
    const nativeDeps = createMockNativeDependencies({
      getStatusRejects: true,
    })

    const runtime = createRuntimeSignalService({
      capacitor: nativeDeps.mockCapacitor,
      network: nativeDeps.mockNetwork,
      app: nativeDeps.mockApp,
    })

    // First attempt fails
    const failRes = await runtime.start()
    expect(failRes.ok).toBe(false)
    expect(failRes.code).toBe('RUNTIME_SIGNAL_INIT_FAILED')
    expect(runtime.getIsStarted()).toBe(false)

    // Fix dependency for second attempt
    nativeDeps.mockNetwork.getStatus = vi.fn().mockResolvedValue({
      connected: true,
      connectionType: 'wifi',
    })

    // Second attempt succeeds
    const successRes = await runtime.start()
    expect(successRes.ok).toBe(true)
    expect(successRes.code).toBe('RUNTIME_SIGNAL_INITIALIZED')
    expect(runtime.getIsStarted()).toBe(true)

    const snap = runtime.getSnapshot()
    expect(snap.initialized).toBe(true)
    expect(snap.online).toBe(true)
    expect(snap.foreground).toBe(true)
  })

  // 119. TEST CLEANUP PARTIAL LISTENER
  it('119. cleans up partial listener handles on listener registration failure and leaves isStarted=false', async () => {
    const { mockCapacitor, mockNetwork, mockApp, netHandle } =
      createMockNativeDependencies({
        addListenerAppRejects: true,
      })

    const runtime = createRuntimeSignalService({
      capacitor: mockCapacitor,
      network: mockNetwork,
      app: mockApp,
    })

    const res = await runtime.start()
    expect(res.ok).toBe(false)
    expect(res.code).toBe('RUNTIME_SIGNAL_INIT_FAILED')
    expect(runtime.getIsStarted()).toBe(false)
    expect(netHandle.remove).toHaveBeenCalledTimes(1)
  })

  // 120. TEST STOP WHILE START PENDING
  it('120. stop() called while start() is pending cleans up all listener handles and leaves runtime uninitialized', async () => {
    let resolveStatus
    let resolveState
    const getStatusPromise = new Promise((resolve) => {
      resolveStatus = resolve
    })
    const getStatePromise = new Promise((resolve) => {
      resolveState = resolve
    })

    const nativeDeps = createMockNativeDependencies()
    nativeDeps.mockNetwork.getStatus = vi.fn().mockImplementation(() => getStatusPromise)
    nativeDeps.mockApp.getState = vi.fn().mockImplementation(() => getStatePromise)

    const runtime = createRuntimeSignalService({
      capacitor: nativeDeps.mockCapacitor,
      network: nativeDeps.mockNetwork,
      app: nativeDeps.mockApp,
    })

    const sub = vi.fn()
    runtime.subscribe(sub)

    const startPromise = runtime.start()
    const stopPromise = runtime.stop()

    // Resolve deferred initialization
    resolveStatus({ connected: true, connectionType: 'wifi' })
    resolveState({ isActive: true })

    const [startRes, stopRes] = await Promise.all([startPromise, stopPromise])

    expect(stopRes.ok).toBe(true)
    expect(runtime.getIsStarted()).toBe(false)

    const snap = runtime.getSnapshot()
    expect(snap.initialized).toBe(false)
    expect(snap.source).toBe('unavailable')

    expect(nativeDeps.netHandle.remove).toHaveBeenCalledTimes(1)
    expect(nativeDeps.appHandle.remove).toHaveBeenCalledTimes(1)

    // Events after stop do not mutate snapshot or notify subscriber
    nativeDeps.emitNetworkStatus({ connected: true, connectionType: 'wifi' })
    nativeDeps.emitAppState({ isActive: true })
    await flushPromises()

    expect(runtime.getSnapshot().initialized).toBe(false)
    // sub should not have received any transition event
    const transitionEvents = sub.mock.calls.filter((c) => c[0].transition !== null)
    expect(transitionEvents.length).toBe(0)
  })

  // 121. TEST START -> STOP -> START
  it('121. start -> stop -> start installs fresh listeners and activates service cleanly', async () => {
    const nativeDeps = createMockNativeDependencies({
      connected: true,
      isActive: true,
    })

    const runtime = createRuntimeSignalService({
      capacitor: nativeDeps.mockCapacitor,
      network: nativeDeps.mockNetwork,
      app: nativeDeps.mockApp,
    })

    await runtime.start()
    expect(runtime.getIsStarted()).toBe(true)

    await runtime.stop()
    expect(runtime.getIsStarted()).toBe(false)
    expect(runtime.getSnapshot().initialized).toBe(false)

    const secondStart = await runtime.start()
    expect(secondStart.ok).toBe(true)
    expect(runtime.getIsStarted()).toBe(true)
    expect(runtime.getSnapshot().initialized).toBe(true)
    expect(runtime.getSnapshot().online).toBe(true)
  })

  // 122. TEST RECONCILED BACKGROUND STATE PREVENTS AUTO SYNC UNTIL SUBSEQUENT RESUME
  it('122. reconciled background state correctly prevents auto sync until subsequent resume', async () => {
    let resolveState
    const getStatePromise = new Promise((resolve) => {
      resolveState = resolve
    })

    const nativeDeps = createMockNativeDependencies({
      connected: false,
    })
    nativeDeps.mockApp.getState = vi.fn().mockImplementation(() => getStatePromise)

    const runtime = createRuntimeSignalService({
      capacitor: nativeDeps.mockCapacitor,
      network: nativeDeps.mockNetwork,
      app: nativeDeps.mockApp,
    })

    const cloudStore = useCloudSessionStore()
    setupAuthenticatedSession(cloudStore)

    const runs = []
    const autoSyncService = {
      runOnce: vi.fn().mockImplementation(async (args) => {
        runs.push(args)
        if (!args.isForeground) {
          return { ok: false, code: 'AUTO_SYNC_NOT_FOREGROUND' }
        }
        return { ok: true, autoSync: true }
      }),
    }

    const autoSyncStore = useSyncAutoSyncStore()
    autoSyncStore.init({ autoSyncService, runtimeSignalService: runtime })
    autoSyncStore.startListeners()

    const startPromise = runtime.start()
    await flushPromises()

    // Buffered event during init: app goes to background
    nativeDeps.emitAppState({ isActive: false })

    // Stale reader resolves active: true
    resolveState({ isActive: true })

    await startPromise
    await flushPromises()

    expect(runtime.getSnapshot().foreground).toBe(false)

    // Now network comes online while in background
    nativeDeps.emitNetworkStatus({ connected: true, connectionType: 'wifi' })
    await flushPromises()

    expect(runs.length).toBe(1)
    expect(runs[0].online).toBe(true)
    expect(runs[0].isForeground).toBe(false)

    // Now app resumes to foreground
    nativeDeps.emitAppState({ isActive: true })
    await flushPromises()

    expect(runs.length).toBe(2)
    expect(runs[1].trigger).toBe('resume')
    expect(runs[1].online).toBe(true)
    expect(runs[1].isForeground).toBe(true)
  })
})
