import { defineStore } from 'pinia'
import { ref } from 'vue'

export const useSyncStatusStore = defineStore('syncStatus', () => {
  const online = ref(false)
  const refreshing = ref(false)
  const pendingCount = ref(0)
  const openConflictCount = ref(0)
  const hasInflight = ref(false)
  const lastCheckedAt = ref(null)
  const lastError = ref(null)

  let _statusService = null
  let _runtimeSignalService = null
  let _listenersAttached = false
  let _unsubscribeRuntime = null

  function init({ statusService = null, runtimeSignalService = null } = {}) {
    if (statusService) {
      _statusService = statusService
    }
    if (runtimeSignalService) {
      _runtimeSignalService = runtimeSignalService
      const snap = _runtimeSignalService.getSnapshot()
      online.value = snap && snap.initialized ? snap.online === true : false
    }
  }

  async function refresh() {
    if (!_statusService) {
      lastError.value = 'SERVICE_NOT_INITIALIZED'
      return { ok: false, code: 'SERVICE_NOT_INITIALIZED' }
    }

    refreshing.value = true
    try {
      const res = await _statusService.readLocalStatus()
      if (res.ok) {
        pendingCount.value = res.pendingCount
        openConflictCount.value = res.openConflictCount
        hasInflight.value = res.hasInflight
        lastCheckedAt.value = res.checkedAt
        lastError.value = null
      } else {
        lastError.value = res.code || 'SYNC_STATUS_READ_FAILED'
      }
      return res
    } catch (err) {
      lastError.value = 'SYNC_STATUS_READ_FAILED'
      return {
        ok: false,
        code: 'SYNC_STATUS_READ_FAILED',
        message: err.message || 'Gagal membaca status sync lokal.',
      }
    } finally {
      refreshing.value = false
    }
  }

  function startListeners() {
    if (_listenersAttached) return
    if (!_runtimeSignalService) return

    _unsubscribeRuntime = _runtimeSignalService.subscribe((event) => {
      if (event && event.snapshot) {
        online.value = event.snapshot.online === true
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
    online,
    refreshing,
    pendingCount,
    openConflictCount,
    hasInflight,
    lastCheckedAt,
    lastError,
    init,
    refresh,
    startListeners,
    stopListeners,
    getStatusService: () => _statusService,
    getRuntimeSignalService: () => _runtimeSignalService,
  }
})
