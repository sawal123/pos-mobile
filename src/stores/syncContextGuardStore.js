import { defineStore } from 'pinia'
import { ref } from 'vue'
import { useCloudSessionStore } from '@/stores/cloudSessionStore'

export const useSyncContextGuardStore = defineStore('syncContextGuard', () => {
  const loading = ref(false)
  const status = ref('idle')
  const code = ref(null)
  const currentContext = ref(null)
  const canonicalContext = ref(null)
  const sources = ref([])
  const issues = ref([])
  const lastCheckedAt = ref(null)
  const lastError = ref(null)

  let _contextGuardService = null

  function init({ contextGuardService = null } = {}) {
    if (contextGuardService) {
      _contextGuardService = contextGuardService
    }
  }

  function resetPresentation() {
    status.value = 'idle'
    code.value = null
    currentContext.value = null
    canonicalContext.value = null
    sources.value = []
    issues.value = []
    lastCheckedAt.value = null
    lastError.value = null
  }

  function snapshotCloudContext() {
    try {
      const cloudStore = useCloudSessionStore()
      return {
        user: cloudStore.user ? { id: cloudStore.user.id } : null,
        cloudAccess: cloudStore.cloudAccess === true,
        selectedBusiness: cloudStore.selectedBusiness
          ? { id: cloudStore.selectedBusiness.id }
          : null,
        selectedOutlet: cloudStore.selectedOutlet
          ? { id: cloudStore.selectedOutlet.id }
          : null,
        deviceIdentifier: cloudStore.deviceIdentifier,
        registeredDeviceId: cloudStore.registeredDeviceId,
      }
    } catch {
      return null
    }
  }

  async function check({ context = null } = {}) {
    const effectiveContext = context || snapshotCloudContext()

    if (!_contextGuardService) {
      loading.value = false
      status.value = 'unbound'
      code.value = 'SYNC_CONTEXT_UNBOUND'
      issues.value = []
      lastCheckedAt.value = new Date().toISOString()
      return {
        ok: true,
        code: 'SYNC_CONTEXT_UNBOUND',
        status: 'unbound',
        currentContext: null,
        canonicalContext: null,
        issues: [],
      }
    }

    loading.value = true
    lastError.value = null

    try {
      const result = await _contextGuardService.inspect({ context: effectiveContext })
      status.value = result.status || (result.ok ? 'safe' : 'blocked')
      code.value = result.code || null
      currentContext.value = result.currentContext || null
      canonicalContext.value = result.canonicalContext || null
      sources.value = Array.isArray(result.sources) ? [...result.sources] : []
      issues.value = Array.isArray(result.issues) ? [...result.issues] : []
      lastCheckedAt.value = new Date().toISOString()
      return result
    } catch (err) {
      status.value = 'blocked'
      code.value = 'SYNC_CONTEXT_READ_FAILED'
      issues.value = [{ code: 'INSPECT_FAILED', source: 'store' }]
      lastError.value = err
      lastCheckedAt.value = new Date().toISOString()
      return {
        ok: false,
        code: 'SYNC_CONTEXT_READ_FAILED',
        status: 'blocked',
        currentContext: null,
        canonicalContext: null,
        issues: issues.value,
      }
    } finally {
      loading.value = false
    }
  }

  return {
    loading,
    status,
    code,
    currentContext,
    canonicalContext,
    sources,
    issues,
    lastCheckedAt,
    lastError,
    init,
    check,
    reset: resetPresentation,
    resetPresentation,
    getContextGuardService: () => _contextGuardService,
  }
})
