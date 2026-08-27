import { defineStore } from 'pinia'
import { ref } from 'vue'
import { createSyncOrchestratorService } from '@/services/sync/syncOrchestratorService'

export const useSyncOrchestratorStore = defineStore('syncOrchestrator', () => {
  const loading = ref(false)
  const lastResult = ref(null)
  const lastError = ref(null)
  const lastSyncedAt = ref(null)

  let _orchestratorService = null

  function init({
    orchestratorService = null,
    pushService = null,
    pullService = null,
    conflictService = null,
  } = {}) {
    if (orchestratorService) {
      _orchestratorService = orchestratorService
    } else if (pushService && pullService) {
      _orchestratorService = createSyncOrchestratorService({
        pushService,
        pullService,
        conflictService,
      })
    }
  }

  async function syncAll(options = {}) {
    if (!_orchestratorService) {
      return {
        ok: false,
        code: 'SERVICE_NOT_INITIALIZED',
        message: 'Sync orchestrator service is not initialized.',
        stage: 'init',
        error: {
          code: 'SERVICE_NOT_INITIALIZED',
          message: 'Sync orchestrator service is not initialized.',
        },
      }
    }

    loading.value = true
    lastError.value = null

    try {
      const result = await _orchestratorService.syncAll(options)
      lastResult.value = result

      if (result.ok && result.code === 'SYNC_ALL_COMPLETED') {
        lastSyncedAt.value = new Date().toISOString()
        lastError.value = null
      } else {
        lastError.value =
          result.error?.message ?? result.message ?? 'Sinkronisasi gagal.'
      }

      return result
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      lastError.value = msg
      const errorResult = {
        ok: false,
        code: 'EXCEPTION',
        stage: 'exception',
        message: msg,
        error: { code: 'EXCEPTION', message: msg },
      }
      lastResult.value = errorResult
      return errorResult
    } finally {
      loading.value = false
    }
  }

  return {
    loading,
    lastResult,
    lastError,
    lastSyncedAt,
    init,
    syncAll,
    getOrchestratorService: () => _orchestratorService,
  }
})
