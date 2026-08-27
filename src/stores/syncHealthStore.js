import { defineStore } from 'pinia'
import { ref } from 'vue'
import { createSyncHealthService } from '@/services/sync/syncHealthService'
import { useCloudSessionStore } from '@/stores/cloudSessionStore'

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

export const useSyncHealthStore = defineStore('syncHealth', () => {
  const loading = ref(false)
  const status = ref(null)
  const summary = ref(null)
  const issues = ref([])
  const lastResult = ref(null)
  const lastError = ref(null)
  const lastCheckedAt = ref(null)

  let _healthService = null

  function init({
    healthService = null,
    adapter = null,
    queueService = null,
    conflictService = null,
  } = {}) {
    if (healthService) {
      _healthService = healthService
    } else if (adapter) {
      _healthService = createSyncHealthService({
        adapter,
        queueService,
        conflictService,
      })
    }
  }

  function resetResult() {
    status.value = null
    summary.value = null
    issues.value = []
    lastResult.value = null
    lastError.value = null
    lastCheckedAt.value = null
  }

  async function checkHealth(options = {}) {
    if (loading.value === true) {
      return {
        ok: false,
        code: 'SYNC_HEALTH_ALREADY_CHECKING',
        status: 'blocked',
        message: 'Sync health check is already in progress.',
        error: {
          code: 'SYNC_HEALTH_ALREADY_CHECKING',
          message: 'Sync health check is already in progress.',
        },
      }
    }

    if (!_healthService) {
      return {
        ok: false,
        code: 'SERVICE_NOT_INITIALIZED',
        status: 'blocked',
        message: 'Sync health service is not initialized.',
        error: {
          code: 'SERVICE_NOT_INITIALIZED',
          message: 'Sync health service is not initialized.',
        },
      }
    }

    loading.value = true
    lastError.value = null

    try {
      const cloudStore = useCloudSessionStore()
      const rawSource = options.context ?? cloudStore
      const context = sanitizeContext(rawSource)

      const result = await _healthService.checkHealth({
        ...options,
        context,
      })

      lastResult.value = result
      status.value = result.status
      summary.value = result.summary
      issues.value = result.issues || []
      lastCheckedAt.value = result.checkedAt || new Date().toISOString()

      if (!result.ok) {
        lastError.value =
          result.issues?.[0]?.message ?? result.message ?? 'Pemeriksaan status sinkronisasi gagal.'
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
        status: 'blocked',
        message: msg,
        error: { code: 'EXCEPTION', message: msg },
        summary: {
          pendingCount: 0,
          openConflictCount: 0,
          hasInflight: false,
          bootstrapStatus: 'none',
          pullCursor: 0,
        },
        issues: [
          {
            code: 'EXCEPTION',
            severity: 'blocked',
            message: msg,
          },
        ],
      }
      lastResult.value = errorResult
      status.value = 'blocked'
      summary.value = errorResult.summary
      issues.value = errorResult.issues
      return errorResult
    } finally {
      loading.value = false
    }
  }

  return {
    loading,
    status,
    summary,
    issues,
    lastResult,
    lastError,
    lastCheckedAt,
    init,
    resetResult,
    checkHealth,
    getHealthService: () => _healthService,
  }
})
