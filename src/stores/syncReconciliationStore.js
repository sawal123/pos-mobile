import { defineStore } from 'pinia'
import { ref } from 'vue'
import { createSyncReconciliationService } from '@/services/sync/syncReconciliationService'
import { useCloudSessionStore } from './cloudSessionStore'

export const useSyncReconciliationStore = defineStore('syncReconciliation', () => {
  const loading = ref(false)
  const lastResult = ref(null)
  const lastError = ref(null)

  let _reconciliationService = null

  function init({ reconciliationService = null, adapter = null, queueService = null, registry = null } = {}) {
    if (reconciliationService) {
      _reconciliationService = reconciliationService
    } else if (adapter) {
      _reconciliationService = createSyncReconciliationService({
        adapter,
        queueService,
        registry,
      })
    }
  }

  async function reconcile(options = {}) {
    if (loading.value) {
      return {
        ok: false,
        code: 'SYNC_RECONCILIATION_IN_PROGRESS',
        message: 'Rekonsiliasi sinkronisasi sedang berjalan.',
        error: {
          code: 'SYNC_RECONCILIATION_IN_PROGRESS',
          message: 'Rekonsiliasi sinkronisasi sedang berjalan.',
        },
      }
    }

    if (!_reconciliationService) {
      const notInitialized = {
        ok: false,
        code: 'SERVICE_NOT_INITIALIZED',
        message: 'Reconciliation service belum diinisialisasi.',
        error: { code: 'SERVICE_NOT_INITIALIZED' },
      }
      lastResult.value = notInitialized
      lastError.value = notInitialized.message
      return notInitialized
    }

    loading.value = true
    lastError.value = null

    try {
      const cloudStore = useCloudSessionStore()
      const context = options.context ?? {
        user: cloudStore.user,
        selectedBusiness: cloudStore.selectedBusiness,
        selectedOutlet: cloudStore.selectedOutlet,
        cloudAccess: cloudStore.cloudAccess,
        deviceIdentifier: cloudStore.deviceIdentifier,
        registeredDeviceId: cloudStore.registeredDeviceId,
      }

      const result = await _reconciliationService.reconcile({ ...options, context })
      lastResult.value = result

      if (!result.ok) {
        lastError.value = result.message ?? result.error?.message ?? 'Rekonsiliasi sinkronisasi gagal.'
      } else {
        lastError.value = null
      }

      return result
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      const errorResult = {
        ok: false,
        code: 'EXCEPTION',
        message: msg,
        error: { code: 'EXCEPTION', message: msg },
      }
      lastResult.value = errorResult
      lastError.value = msg
      return errorResult
    } finally {
      loading.value = false
    }
  }

  function resetResult() {
    lastResult.value = null
    lastError.value = null
  }

  return {
    loading,
    lastResult,
    lastError,
    init,
    reconcile,
    resetResult,
    getReconciliationService: () => _reconciliationService,
  }
})
