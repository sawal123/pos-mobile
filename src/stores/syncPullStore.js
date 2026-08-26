import { defineStore } from 'pinia'
import { ref } from 'vue'
import { createSyncPullService } from '@/services/sync/syncPullService'
import { useCloudSessionStore } from './cloudSessionStore'

export const useSyncPullStore = defineStore('syncPull', () => {
  const cloudStore = useCloudSessionStore()
  const loading = ref(false)
  const lastResult = ref(null)
  const lastError = ref(null)

  let _pullService = null
  let _adapter = null
  let _scheduler = null

  function init({ pullService = null, adapter = null, scheduler = null } = {}) {
    if (pullService) {
      _pullService = pullService
    } else if (adapter) {
      _adapter = adapter
      _scheduler = scheduler
      _pullService = createSyncPullService({
        adapter,
        scheduler,
        cloudStore,
      })
    }
  }

  async function pullNow(options = {}) {
    if (!_pullService) {
      if (_adapter) {
        _pullService = createSyncPullService({
          adapter: _adapter,
          scheduler: _scheduler,
          cloudStore,
        })
      } else {
        return {
          ok: false,
          code: 'SERVICE_NOT_INITIALIZED',
          message: 'Sync pull service is not initialized.',
          error: {
            code: 'SERVICE_NOT_INITIALIZED',
            message: 'Sync pull service is not initialized.',
          },
        }
      }
    }

    loading.value = true
    lastError.value = null

    const resolvedContext = options.context ?? {
      user: cloudStore.user,
      selectedBusiness: cloudStore.selectedBusiness,
      selectedOutlet: cloudStore.selectedOutlet,
      cloudAccess: cloudStore.cloudAccess,
      deviceIdentifier: cloudStore.deviceIdentifier,
      registeredDeviceId: cloudStore.registeredDeviceId,
    }

    try {
      const result = await _pullService.pullNow({
        ...options,
        context: resolvedContext,
      })
      lastResult.value = result
      if (!result.ok) {
        lastError.value = result.error?.message ?? result.message ?? 'Sync pull failed'
      } else {
        lastError.value = null
      }
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
    lastResult,
    lastError,
    init,
    pullNow,
    getPullService: () => _pullService,
  }
})
