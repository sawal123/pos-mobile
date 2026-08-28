import { defineStore } from 'pinia'
import { ref } from 'vue'
import { createSyncRecoveryService, RECOVERY_ACTIONS } from '@/services/sync/syncRecoveryService'
import { useCloudSessionStore } from '@/stores/cloudSessionStore'
import { useSyncHealthStore } from '@/stores/syncHealthStore'

function sanitizeContext(source = {}) {
  const user = source.user
    ? { id: source.user.id, email: source.user.email }
    : null

  const selectedBusiness = source.selectedBusiness
    ? { id: source.selectedBusiness.id, name: source.selectedBusiness.name }
    : null

  const selectedOutlet = source.selectedOutlet
    ? { id: source.selectedOutlet.id, name: source.selectedOutlet.name }
    : null

  const cloudAccess = source.cloudAccess === true
  const deviceIdentifier = source.deviceIdentifier != null ? String(source.deviceIdentifier) : null
  const registeredDeviceId = source.registeredDeviceId != null ? source.registeredDeviceId : null

  return {
    user,
    selectedBusiness,
    selectedOutlet,
    cloudAccess,
    deviceIdentifier,
    registeredDeviceId,
  }
}

export const useSyncRecoveryStore = defineStore('syncRecovery', () => {
  const loading = ref(false)
  const lastAction = ref(null)
  const lastResult = ref(null)
  const lastError = ref(null)

  let _recoveryService = null

  function init({
    recoveryService = null,
    healthService = null,
    pushService = null,
    bootstrapService = null,
    orchestratorService = null,
    conflictService = null,
  } = {}) {
    if (recoveryService) {
      _recoveryService = recoveryService
    } else if (healthService) {
      _recoveryService = createSyncRecoveryService({
        healthService,
        pushService,
        bootstrapService,
        orchestratorService,
        conflictService,
      })
    }
  }

  function resetResult() {
    lastAction.value = null
    lastResult.value = null
    lastError.value = null
  }

  function getRecoveryPlan(healthResult) {
    if (!_recoveryService) {
      return {
        recommendedAction: null,
        availableActions: [],
        message: 'Recovery service belum diinisialisasi.',
      }
    }
    return _recoveryService.getRecoveryPlan({ healthResult })
  }

  async function recover(action, options = {}) {
    if (loading.value === true) {
      return {
        ok: false,
        code: 'SYNC_RECOVERY_ALREADY_IN_PROGRESS',
        message: 'Pemulihan sinkronisasi sedang berjalan.',
        error: {
          code: 'SYNC_RECOVERY_ALREADY_IN_PROGRESS',
          message: 'Pemulihan sinkronisasi sedang berjalan.',
        },
      }
    }

    if (!_recoveryService) {
      return {
        ok: false,
        code: 'SERVICE_NOT_INITIALIZED',
        message: 'Recovery service belum diinisialisasi.',
        error: {
          code: 'SERVICE_NOT_INITIALIZED',
          message: 'Recovery service belum diinisialisasi.',
        },
      }
    }

    loading.value = true
    lastAction.value = action
    lastError.value = null

    try {
      // Invalidate old health result since mutation will alter local state
      try {
        const healthStore = useSyncHealthStore()
        healthStore.resetResult()
      } catch {
        // Safe fallback if called outside Pinia or during tests
      }

      // Snapshot sanitized cloud context ONCE
      const cloudStore = useCloudSessionStore()
      const rawSource = options.context ?? cloudStore
      const context = sanitizeContext(rawSource)

      const result = await _recoveryService.recover(action, {
        ...options,
        context,
      })

      lastResult.value = result

      if (!result.ok) {
        lastError.value = result.message ?? result.error?.message ?? 'Pemulihan sinkronisasi gagal.'
      } else {
        lastError.value = null
      }

      return result
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      lastError.value = msg
      const errorResult = {
        ok: false,
        code: 'EXCEPTION',
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
    lastAction,
    lastResult,
    lastError,
    init,
    resetResult,
    getRecoveryPlan,
    recover,
    getRecoveryService: () => _recoveryService,
  }
})
