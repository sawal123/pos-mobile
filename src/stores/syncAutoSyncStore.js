import { defineStore } from 'pinia'
import { ref } from 'vue'
import { useCloudSessionStore } from '@/stores/cloudSessionStore'
import { useSyncPushStore } from '@/stores/syncPushStore'
import { useSyncPullStore } from '@/stores/syncPullStore'
import { useSyncBootstrapStore } from '@/stores/syncBootstrapStore'
import { useSyncConflictStore } from '@/stores/syncConflictStore'
import { useSyncOrchestratorStore } from '@/stores/syncOrchestratorStore'
import { useSyncHealthStore } from '@/stores/syncHealthStore'
import { useSyncRecoveryStore } from '@/stores/syncRecoveryStore'
import { useSyncActivityLogStore } from '@/stores/syncActivityLogStore'

export const useSyncAutoSyncStore = defineStore('syncAutoSync', () => {
  const enabled = ref(false)
  const preferenceLoaded = ref(false)
  const loadingPreference = ref(false)
  const running = ref(false)
  const lastResult = ref(null)
  const lastError = ref(null)
  const lastTriggeredAt = ref(null)
  const lastSkippedCode = ref(null)

  let _autoSyncService = null
  let _listenersAttached = false
  let _onOnlineHandler = null
  let _onVisibilityHandler = null

  function init({ autoSyncService = null } = {}) {
    if (autoSyncService) {
      _autoSyncService = autoSyncService
    }
  }

  function snapshotCloudContext() {
    const cloudStore = useCloudSessionStore()
    return {
      user: cloudStore.user ? { id: cloudStore.user.id } : null,
      selectedBusiness: cloudStore.selectedBusiness
        ? { id: cloudStore.selectedBusiness.id }
        : null,
      selectedOutlet: cloudStore.selectedOutlet
        ? { id: cloudStore.selectedOutlet.id }
        : null,
      cloudAccess: Boolean(cloudStore.cloudAccess),
      deviceIdentifier: cloudStore.deviceIdentifier || null,
      registeredDeviceId: cloudStore.registeredDeviceId || null,
    }
  }

  function isAnyOtherSyncBusy() {
    try {
      const pushStore = useSyncPushStore()
      const pullStore = useSyncPullStore()
      const bootstrapStore = useSyncBootstrapStore()
      const conflictStore = useSyncConflictStore()
      const orchestratorStore = useSyncOrchestratorStore()
      const healthStore = useSyncHealthStore()
      const recoveryStore = useSyncRecoveryStore()
      const cloudStore = useCloudSessionStore()

      return Boolean(
        pushStore.loading ||
          pullStore.loading ||
          bootstrapStore.loading ||
          conflictStore.loading ||
          orchestratorStore.loading ||
          healthStore.loading ||
          recoveryStore.loading ||
          cloudStore.loading,
      )
    } catch {
      return false
    }
  }

  async function loadPreference() {
    if (!_autoSyncService) {
      enabled.value = false
      preferenceLoaded.value = true
      return { ok: false, code: 'SERVICE_NOT_INITIALIZED', enabled: false }
    }

    loadingPreference.value = true
    try {
      const ctx = snapshotCloudContext()
      const res = await _autoSyncService.loadPreference({ context: ctx })
      if (res.ok) {
        enabled.value = Boolean(res.enabled && res.contextMatches)
      } else {
        enabled.value = false
      }
      preferenceLoaded.value = true
      return res
    } catch (err) {
      enabled.value = false
      preferenceLoaded.value = true
      return {
        ok: false,
        code: 'AUTO_SYNC_LOAD_FAILED',
        message: err.message || 'Gagal memuat preferensi auto sync.',
        enabled: false,
      }
    } finally {
      loadingPreference.value = false
    }
  }

  async function setEnabled(targetEnabled) {
    if (!_autoSyncService) {
      return { ok: false, code: 'SERVICE_NOT_INITIALIZED' }
    }

    loadingPreference.value = true
    try {
      const ctx = snapshotCloudContext()
      const res = await _autoSyncService.setEnabled({
        context: ctx,
        enabled: targetEnabled,
      })
      if (res.ok) {
        enabled.value = targetEnabled
      }
      preferenceLoaded.value = true
      return res
    } catch (err) {
      return {
        ok: false,
        code: 'AUTO_SYNC_SET_FAILED',
        message: err.message || 'Gagal menyimpan preferensi auto sync.',
      }
    } finally {
      loadingPreference.value = false
    }
  }

  async function trigger(triggerType) {
    if (!_autoSyncService) {
      lastSkippedCode.value = 'SERVICE_NOT_INITIALIZED'
      return { ok: false, code: 'SERVICE_NOT_INITIALIZED' }
    }

    if (running.value) {
      lastSkippedCode.value = 'AUTO_SYNC_ALREADY_IN_PROGRESS'
      return { ok: false, code: 'AUTO_SYNC_ALREADY_IN_PROGRESS' }
    }

    if (isAnyOtherSyncBusy()) {
      lastSkippedCode.value = 'AUTO_SYNC_OTHER_SYNC_BUSY'
      return { ok: false, code: 'AUTO_SYNC_OTHER_SYNC_BUSY' }
    }

    const contextSnapshot = snapshotCloudContext()
    const online = typeof navigator !== 'undefined' ? navigator.onLine : true
    const isForeground =
      typeof document !== 'undefined' ? document.visibilityState === 'visible' : true

    running.value = true
    lastError.value = null

    try {
      const result = await _autoSyncService.runOnce({
        context: contextSnapshot,
        trigger: triggerType,
        online,
        isForeground,
      })

      if (result.autoSync) {
        lastResult.value = result
        lastTriggeredAt.value = new Date().toISOString()
        lastSkippedCode.value = null

        // Best effort post-sync store refreshes
        try {
          const pushStore = useSyncPushStore()
          const conflictStore = useSyncConflictStore()
          const activityStore = useSyncActivityLogStore()
          void pushStore.refreshPendingCount()
          void conflictStore.loadConflicts()
          void activityStore.refresh({ limit: 10 })
        } catch {
          // Non-blocking
        }
      } else {
        lastSkippedCode.value = result.code
      }

      return result
    } catch (err) {
      const msg = err.message || 'Auto sync gagal dijalankan.'
      lastError.value = msg
      return { ok: false, code: 'AUTO_SYNC_EXCEPTION', message: msg }
    } finally {
      running.value = false
    }
  }

  function startListeners() {
    if (_listenersAttached) return
    if (typeof window === 'undefined') return

    _onOnlineHandler = () => {
      void trigger('online')
    }

    _onVisibilityHandler = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
        void trigger('resume')
      }
    }

    window.addEventListener('online', _onOnlineHandler)
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', _onVisibilityHandler)
    }

    _listenersAttached = true
  }

  function stopListeners() {
    if (!_listenersAttached) return
    if (typeof window !== 'undefined' && _onOnlineHandler) {
      window.removeEventListener('online', _onOnlineHandler)
    }
    if (typeof document !== 'undefined' && _onVisibilityHandler) {
      document.removeEventListener('visibilitychange', _onVisibilityHandler)
    }
    _onOnlineHandler = null
    _onVisibilityHandler = null
    _listenersAttached = false
  }

  return {
    enabled,
    preferenceLoaded,
    loadingPreference,
    running,
    lastResult,
    lastError,
    lastTriggeredAt,
    lastSkippedCode,
    init,
    loadPreference,
    setEnabled,
    trigger,
    startListeners,
    stopListeners,
    getAutoSyncService: () => _autoSyncService,
  }
})
