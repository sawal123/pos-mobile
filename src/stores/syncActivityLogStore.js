import { defineStore } from 'pinia'
import { ref } from 'vue'
import { createSyncActivityLogService } from '@/services/sync/syncActivityLogService'

export const useSyncActivityLogStore = defineStore('syncActivityLog', () => {
  const loading = ref(false)
  const entries = ref([])
  const error = ref(null)

  let _activityLogService = null

  function init({ activityLogService = null, adapter = null } = {}) {
    if (activityLogService) {
      _activityLogService = activityLogService
    } else if (adapter) {
      _activityLogService = createSyncActivityLogService({ adapter })
    }
  }

  async function refresh({ limit = 20 } = {}) {
    if (!_activityLogService) {
      entries.value = []
      return []
    }

    loading.value = true
    error.value = null

    try {
      const list = await _activityLogService.listRecent({ limit })
      entries.value = Array.isArray(list) ? list : []
      return entries.value
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      error.value = msg
      return []
    } finally {
      loading.value = false
    }
  }

  async function record(entry) {
    if (!_activityLogService) {
      return {
        ok: false,
        code: 'SERVICE_NOT_INITIALIZED',
        message: 'Sync activity log service belum diinisialisasi.',
      }
    }

    try {
      const result = await _activityLogService.record(entry)
      if (result.ok && result.entry) {
        entries.value = [result.entry, ...entries.value.filter((e) => e.id !== result.entry.id)].slice(0, 100)
      }
      return result
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return {
        ok: false,
        code: 'SYNC_ACTIVITY_LOG_PERSIST_FAILED',
        message: msg,
      }
    }
  }

  async function clearHistory() {
    if (!_activityLogService) {
      return {
        ok: false,
        code: 'SERVICE_NOT_INITIALIZED',
        message: 'Sync activity log service belum diinisialisasi.',
      }
    }

    loading.value = true
    error.value = null

    try {
      const result = await _activityLogService.clearHistory()
      if (result.ok) {
        entries.value = []
      } else {
        error.value = result.message || 'Gagal menghapus riwayat aktivitas sinkronisasi.'
      }
      return result
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      error.value = msg
      return {
        ok: false,
        code: 'SYNC_ACTIVITY_LOG_PERSIST_FAILED',
        message: msg,
      }
    } finally {
      loading.value = false
    }
  }

  return {
    loading,
    entries,
    error,
    init,
    refresh,
    record,
    clearHistory,
    getActivityLogService: () => _activityLogService,
  }
})
