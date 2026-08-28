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
import { useSyncStatusStore } from '@/stores/syncStatusStore'

function createContextFingerprint(ctx) {
  if (!ctx) return 'null'
  const userId = ctx.user?.id ?? ''
  const bizId = ctx.selectedBusiness?.id ?? ''
  const outletId = ctx.selectedOutlet?.id ?? ''
  const regId = ctx.registeredDeviceId ?? ''
  const devId = ctx.deviceIdentifier ?? ''
  const cloudAccess = ctx.cloudAccess === true ? 'true' : 'false'
  return `${userId}:${bizId}:${outletId}:${regId}:${devId}:${cloudAccess}`
}

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
  let _runtimeSignalService = null
  let _listenersAttached = false
  let _unsubscribeRuntime = null
  let _preferenceLoadSeq = 0

  function init({ autoSyncService = null, runtimeSignalService = null } = {}) {
    if (autoSyncService) {
      _autoSyncService = autoSyncService
    }
    if (runtimeSignalService) {
      _runtimeSignalService = runtimeSignalService
    }
  }

  function resetPresentation() {
    lastResult.value = null
    lastError.value = null
    lastTriggeredAt.value = null
    lastSkippedCode.value = null
  }

  function snapshotCloudContext() {
    const cloudStore = useCloudSessionStore()
    return {
      user:
        cloudStore.user &&
        cloudStore.user.id != null &&
        String(cloudStore.user.id).trim().length > 0
          ? { id: cloudStore.user.id }
          : null,
      selectedBusiness: cloudStore.selectedBusiness
        ? { id: cloudStore.selectedBusiness.id }
        : null,
      selectedOutlet: cloudStore.selectedOutlet
        ? { id: cloudStore.selectedOutlet.id }
        : null,
      cloudAccess: cloudStore.cloudAccess === true,
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
      // Fail closed
      return true
    }
  }

  async function loadPreference() {
    if (!_autoSyncService) {
      enabled.value = false
      preferenceLoaded.value = true
      return { ok: false, code: 'SERVICE_NOT_INITIALIZED', enabled: false }
    }

    const requestSeq = ++_preferenceLoadSeq
    const ctx = snapshotCloudContext()
    const fingerprint = createContextFingerprint(ctx)

    loadingPreference.value = true
    try {
      const res = await _autoSyncService.loadPreference({ context: ctx })

      if (
        requestSeq !== _preferenceLoadSeq ||
        fingerprint !== createContextFingerprint(snapshotCloudContext())
      ) {
        return {
          ...res,
          stale: true,
        }
      }

      if (res.ok) {
        enabled.value = Boolean(res.enabled && res.contextMatches)
      } else {
        enabled.value = false
      }
      preferenceLoaded.value = true
      return res
    } catch (err) {
      if (
        requestSeq !== _preferenceLoadSeq ||
        fingerprint !== createContextFingerprint(snapshotCloudContext())
      ) {
        return {
          ok: false,
          code: 'AUTO_SYNC_LOAD_FAILED',
          stale: true,
          enabled: false,
        }
      }

      enabled.value = false
      preferenceLoaded.value = true
      return {
        ok: false,
        code: 'AUTO_SYNC_LOAD_FAILED',
        message: err.message || 'Gagal memuat preferensi auto sync.',
        enabled: false,
      }
    } finally {
      if (requestSeq === _preferenceLoadSeq) {
        loadingPreference.value = false
      }
    }
  }

  async function setEnabled(targetEnabled) {
    if (!_autoSyncService) {
      return { ok: false, code: 'SERVICE_NOT_INITIALIZED' }
    }

    const requestSeq = ++_preferenceLoadSeq
    const ctx = snapshotCloudContext()
    const fingerprint = createContextFingerprint(ctx)

    loadingPreference.value = true
    try {
      const res = await _autoSyncService.setEnabled({
        context: ctx,
        enabled: targetEnabled,
      })

      if (
        requestSeq !== _preferenceLoadSeq ||
        fingerprint !== createContextFingerprint(snapshotCloudContext())
      ) {
        // Current context changed mid-flight; reload preference for current context
        void loadPreference()
        return {
          ...res,
          stale: true,
        }
      }

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
      if (requestSeq === _preferenceLoadSeq) {
        loadingPreference.value = false
      }
    }
  }

  async function trigger(triggerType) {
    if (!_autoSyncService) {
      lastSkippedCode.value = 'SERVICE_NOT_INITIALIZED'
      return { ok: false, code: 'SERVICE_NOT_INITIALIZED' }
    }

    if (!_runtimeSignalService) {
      lastSkippedCode.value = 'AUTO_SYNC_RUNTIME_UNAVAILABLE'
      return { ok: false, code: 'AUTO_SYNC_RUNTIME_UNAVAILABLE' }
    }

    const runtime = _runtimeSignalService.getSnapshot()
    if (!runtime || runtime.initialized !== true) {
      lastSkippedCode.value = 'AUTO_SYNC_RUNTIME_UNAVAILABLE'
      return { ok: false, code: 'AUTO_SYNC_RUNTIME_UNAVAILABLE' }
    }

    if (loadingPreference.value) {
      lastSkippedCode.value = 'AUTO_SYNC_PREFERENCE_BUSY'
      return { ok: false, code: 'AUTO_SYNC_PREFERENCE_BUSY' }
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
    const online = runtime.online === true
    const isForeground = runtime.foreground === true

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
          const statusStore = useSyncStatusStore()
          void pushStore.refreshPendingCount()
          void conflictStore.loadConflicts()
          void activityStore.refresh({ limit: 10 })
          void statusStore.refresh()
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
    if (!_runtimeSignalService) return

    _unsubscribeRuntime = _runtimeSignalService.subscribe((event) => {
      if (!event) return
      if (event.transition === 'online') {
        void trigger('online')
      } else if (event.transition === 'resume') {
        void trigger('resume')
      }
    })

    _listenersAttached = true
  }

  function stopListeners() {
    if (!_listenersAttached) return
    if (_unsubscribeRuntime) {
      _unsubscribeRuntime()
      _unsubscribeRuntime = null
    }
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
    resetPresentation,
    loadPreference,
    setEnabled,
    trigger,
    startListeners,
    stopListeners,
    getAutoSyncService: () => _autoSyncService,
    getRuntimeSignalService: () => _runtimeSignalService,
  }
})
