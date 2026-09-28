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

  async function pushNow(options = {}) {
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
      // INT-02: a cached capability contract is never permanent authorization.
      // Re-confirm it online before an authorization-sensitive push. A failed
      // re-confirmation fails closed for mutation without deleting any data.
      if (
        options.refreshContext !== false &&
        cloudStore.isAuthenticated &&
        cloudStore.capabilityState === 'unverified'
      ) {
        const refreshed = await cloudStore.refreshContext()
        if (!refreshed.ok) {
          const unverified = {
            ok: false,
            code: 'SYNC_CAPABILITIES_UNVERIFIED',
            message:
              'Izin sinkronisasi belum dapat diverifikasi ulang. Data lokal tetap aman dan menunggu koneksi.',
            error: {
              code: 'SYNC_CAPABILITIES_UNVERIFIED',
              message: 'Izin sinkronisasi belum dapat diverifikasi ulang.',
            },
          }
          lastResult.value = unverified
          lastError.value = unverified.message
          return unverified
        }
      }

      const resolvedContext = options.context ?? {
        user: cloudStore.user,
        selectedBusiness: cloudStore.selectedBusiness,
        selectedOutlet: cloudStore.selectedOutlet,
        cloudAccess: cloudStore.cloudAccess,
        deviceIdentifier: cloudStore.deviceIdentifier,
        registeredDeviceId: cloudStore.registeredDeviceId,
        role: cloudStore.role,
        syncCapabilities: cloudStore.syncCapabilities,
        capabilityState: cloudStore.capabilityState,
      }

      const result = await _pushService.pushNow({
        ...options,
        context: resolvedContext,
      })

      // INT-02: a 403 means the cached role/capabilities are stale. Refresh
      // online so the next attempt uses fresh authorization. Data is preserved.
      if (result && result.requiresContextRefresh && cloudStore.isAuthenticated) {
        await cloudStore.refreshContext().catch(() => {})
      }

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
