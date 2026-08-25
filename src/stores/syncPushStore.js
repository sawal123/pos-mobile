import { defineStore } from 'pinia'
import { ref } from 'vue'
import { createSyncPushService } from '@/services/sync/syncPushService'
import { useCloudSessionStore } from './cloudSessionStore'

export const useSyncPushStore = defineStore('syncPush', () => {
  const cloudStore = useCloudSessionStore()
  const loading = ref(false)
  const pendingCount = ref(0)
  const lastResult = ref(null)
  const lastError = ref(null)

  let _pushService = null
  let _adapter = null
  let _scheduler = null

  function init({ pushService = null, adapter = null, scheduler = null } = {}) {
    if (pushService) {
      _pushService = pushService
    } else if (adapter) {
      _adapter = adapter
      _scheduler = scheduler
      _pushService = createSyncPushService({
        adapter,
        scheduler,
        cloudStore,
      })
    }
  }

  async function refreshPendingCount() {
    if (_pushService?.queueService) {
      try {
        pendingCount.value = await _pushService.queueService.countPending()
      } catch {
        // non-blocking
      }
    }
  }

  async function pushNow(options) {
    if (!_pushService) {
      if (_adapter) {
        _pushService = createSyncPushService({
          adapter: _adapter,
          scheduler: _scheduler,
          cloudStore,
        })
      } else {
        return {
          ok: false,
          code: 'SERVICE_NOT_INITIALIZED',
          message: 'Sync push service is not initialized.',
          error: { code: 'SERVICE_NOT_INITIALIZED', message: 'Sync push service is not initialized.' },
        }
      }
    }

    loading.value = true
    lastError.value = null

    try {
      const result = await _pushService.pushNow(options)
      lastResult.value = result
      if (!result.ok) {
        lastError.value = result.error?.message ?? result.message ?? 'Sync push failed'
      } else {
        lastError.value = null
      }
      pendingCount.value = result.remaining ?? (await _pushService.queueService.countPending())
      return result
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      lastError.value = msg
      return {
        ok: false,
        error: { code: 'EXCEPTION', message: msg },
      }
    } finally {
      loading.value = false
    }
  }

  return {
    loading,
    pendingCount,
    lastResult,
    lastError,
    init,
    refreshPendingCount,
    pushNow,
    getPushService: () => _pushService,
  }
})
