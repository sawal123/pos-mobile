import { defineStore } from 'pinia'
import { ref } from 'vue'

export const useSyncStatusStore = defineStore('syncStatus', () => {
  const online = ref(
    typeof navigator !== 'undefined' ? navigator.onLine === true : false,
  )
  const refreshing = ref(false)
  const pendingCount = ref(0)
  const openConflictCount = ref(0)
  const hasInflight = ref(false)
  const lastCheckedAt = ref(null)
  const lastError = ref(null)

  let _statusService = null
  let _listenersAttached = false
  let _onOnlineHandler = null
  let _onOfflineHandler = null

  function init({ statusService = null } = {}) {
    if (statusService) {
      _statusService = statusService
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
    if (typeof window === 'undefined') return

    _onOnlineHandler = () => {
      online.value = true
    }

    _onOfflineHandler = () => {
      online.value = false
    }

    window.addEventListener('online', _onOnlineHandler)
    window.addEventListener('offline', _onOfflineHandler)

    _listenersAttached = true
  }

  function stopListeners() {
    if (!_listenersAttached) return
    if (typeof window !== 'undefined' && _onOnlineHandler) {
      window.removeEventListener('online', _onOnlineHandler)
    }
    if (typeof window !== 'undefined' && _onOfflineHandler) {
      window.removeEventListener('offline', _onOfflineHandler)
    }
    _onOnlineHandler = null
    _onOfflineHandler = null
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
  }
})
