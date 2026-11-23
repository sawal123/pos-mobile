import { defineStore } from 'pinia'
import { ref } from 'vue'
import { createSyncPushService } from '@/services/sync/syncPushService'
import { useCloudSessionStore } from './cloudSessionStore'
import { useSyncReconciliationStore } from './syncReconciliationStore'

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
      const reconStore = useSyncReconciliationStore()
      _pushService = createSyncPushService({
        adapter,
        scheduler,
        cloudStore,
        reconciliationService: reconStore.getReconciliationService(),
        capabilityVerifier: () => cloudStore.ensureVerifiedContext(),
        onAuthorizationRejected: () => cloudStore.refreshContext().catch(() => {}),
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
      const activeAdapter = _adapter || cloudStore?.adapter?.value || cloudStore?.adapter
      const activeScheduler = _scheduler || cloudStore?.scheduler?.value || cloudStore?.scheduler
      if (activeAdapter) {
        const reconStore = useSyncReconciliationStore()
        _pushService = createSyncPushService({
          adapter: activeAdapter,
          scheduler: activeScheduler,
          cloudStore,
          reconciliationService: reconStore.getReconciliationService(),
          capabilityVerifier: () => cloudStore.ensureVerifiedContext(),
          onAuthorizationRejected: () => cloudStore.refreshContext().catch(() => {}),
        })
      } else {
        return {
          ok: false,
          code: 'SERVICE_NOT_INITIALIZED',
          message: 'Sync push service is not initialized.',
          error: {
            code: 'SERVICE_NOT_INITIALIZED',
            message: 'Sync push service is not initialized.',
          },
        }
      }
    }

    loading.value = true
    lastError.value = null

    try {
      // PAIR-01: owner/member devices are bound silently; a cashier without a
      // pairing code gets the pairing instruction from the precondition error.
      if (
        options.context == null &&
        cloudStore.isAuthenticated &&
        cloudStore.registeredDeviceId == null &&
        typeof cloudStore.ensureDeviceBinding === 'function'
      ) {
        try {
          await cloudStore.ensureDeviceBinding()
        } catch {
          // Non-blocking: preconditions below report the blocker.
        }
      }

      // INT-02: a cached capability contract is never permanent authorization.
      // Re-confirm it online before an authorization-sensitive push. A failed
      // re-confirmation fails closed for mutation without deleting any data.
      // `ensureVerifiedContext` covers the `legacy`, `unverified` and `revoked`
      // states and short-circuits once the contract is verified.
      if (options.refreshContext !== false && cloudStore.isAuthenticated) {
        const verification = await cloudStore.ensureVerifiedContext()

        if (!verification.ok && verification.skipped !== true) {
          const unverified = {
            ok: false,
            code: 'SYNC_CAPABILITIES_UNVERIFIED',
            authorizationCode: verification.code ?? 'CONTEXT_REFRESH_FAILED',
            message:
              verification.message ??
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
        cloudAccess: cloudStore.isOperationalCloudAccess,
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

      // INT-02: the push service itself refreshes role + sync_capabilities via
      // its shared `onAuthorizationRejected` hook when a 403 requires it, so
      // manual push, "Sync Semua" and auto-sync all recover identically.
      lastResult.value = result
      if (!result.ok) {
        const isOutletDenied =
          result.code === 'OUTLET_ACCESS_DENIED' ||
          result.error?.code === 'OUTLET_ACCESS_DENIED'
        lastError.value = isOutletDenied
          ? 'Akun kasir ini hanya memiliki akses untuk cabang yang ditugaskan. Perangkat ini terdaftar di cabang berbeda.'
          : (result.error?.message ?? result.message ?? 'Sync push failed')
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

  let _directPushTimer = null

  async function pushIfOnline({ delay = 100 } = {}) {
    if (_directPushTimer) {
      clearTimeout(_directPushTimer)
      _directPushTimer = null
    }

    return new Promise((resolve) => {
      _directPushTimer = setTimeout(async () => {
        try {
          const { useBusinessStore } = await import('@/stores/businessStore')
          const { useSyncStatusStore } = await import('@/stores/syncStatusStore')
          const businessStore = useBusinessStore()
          const syncStatusStore = useSyncStatusStore()

          const isCloudMode =
            businessStore.mode === 'cloud' ||
            (cloudStore.isLinked && cloudStore.hasCloudAccess)

          if (!isCloudMode || !syncStatusStore.online) {
            resolve({ ok: false, code: 'OFFLINE_OR_NOT_CLOUD' })
            return
          }

          const scheduler =
            cloudStore.scheduler ?? cloudStore.getPersistenceScheduler?.()
          await scheduler?.flush?.()

          const result = await pushNow()
          await syncStatusStore.refresh()
          resolve(result)
        } catch (err) {
          resolve({ ok: false, error: err })
        }
      }, delay)
    })
  }

  async function listPendingItems(options = {}) {
    if (_pushService?.queueService?.listPending) {
      try {
        return await _pushService.queueService.listPending(options)
      } catch (err) {
        console.error('Failed to list pending items from queueService', err)
      }
    }
    if (_adapter?.listSyncQueueItems) {
      try {
        return await _adapter.listSyncQueueItems(options)
      } catch (err) {
        console.error('Failed to list pending items from adapter', err)
      }
    }
    try {
      const { resolvePersistenceAdapter } = await import('@/services/database')
      const adapter = await resolvePersistenceAdapter()
      if (adapter?.listSyncQueueItems) {
        return await adapter.listSyncQueueItems(options)
      }
    } catch {
      // non-blocking
    }
    return []
  }

  async function removePendingItem(queueId) {
    if (!queueId) return { ok: false }
    try {
      if (_pushService?.queueService?.remove) {
        const res = await _pushService.queueService.remove(queueId)
        await refreshPendingCount()
        const { useSyncStatusStore } = await import('@/stores/syncStatusStore')
        await useSyncStatusStore().refresh()
        return res
      }
      if (_adapter?.deleteSyncQueueItem) {
        await _adapter.deleteSyncQueueItem(queueId)
        await refreshPendingCount()
        const { useSyncStatusStore } = await import('@/stores/syncStatusStore')
        await useSyncStatusStore().refresh()
        return { ok: true }
      }
    } catch (err) {
      return { ok: false, error: err }
    }
    return { ok: false }
  }

  return {
    loading,
    pendingCount,
    lastResult,
    lastError,
    init,
    refreshPendingCount,
    pushNow,
    pushIfOnline,
    listPendingItems,
    removePendingItem,
    getPushService: () => _pushService,
  }
})
