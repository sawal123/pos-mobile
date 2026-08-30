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
  let _checkSeq = 0

  function init({ contextGuardService = null } = {}) {
    if (contextGuardService) {
      _contextGuardService = contextGuardService
    }
  }

  function resetPresentation() {
    _checkSeq++
    status.value = 'idle'
    code.value = null
    currentContext.value = null
    canonicalContext.value = null
    sources.value = []
    issues.value = []
    lastCheckedAt.value = null
    lastError.value = null
    loading.value = false
  }

  function buildContextFingerprint(ctx) {
    if (!ctx) return ''
    const userId = ctx.user?.id != null ? String(ctx.user.id) : ''
    const bizId = ctx.selectedBusiness?.id != null ? String(ctx.selectedBusiness.id) : ''
    const outletId = ctx.selectedOutlet?.id != null ? String(ctx.selectedOutlet.id) : ''
    const cloudAccess = ctx.cloudAccess === true ? '1' : '0'
    const devId = ctx.deviceIdentifier != null ? String(ctx.deviceIdentifier).trim() : ''
    const regId = ctx.registeredDeviceId != null ? String(ctx.registeredDeviceId) : ''
    return `${userId}:${bizId}:${outletId}:${cloudAccess}:${devId}:${regId}`
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
    const seq = ++_checkSeq
    const effectiveContext = context || snapshotCloudContext()
    const fingerprintBefore = buildContextFingerprint(effectiveContext)

    if (!_contextGuardService) {
      loading.value = false
      status.value = 'blocked'
      code.value = 'SYNC_CONTEXT_READ_FAILED'
      issues.value = [{ code: 'GUARD_SERVICE_MISSING', source: 'store' }]
      lastCheckedAt.value = new Date().toISOString()
      return {
        ok: false,
        code: 'SYNC_CONTEXT_READ_FAILED',
        status: 'blocked',
        currentContext: null,
        canonicalContext: null,
        issues: issues.value,
      }
    }

    loading.value = true
    lastError.value = null

    try {
      const result = await _contextGuardService.inspect({ context: effectiveContext })

      // Stale check protection: only apply if seq is still latest and context fingerprint has not changed
      const currentFingerprint = buildContextFingerprint(snapshotCloudContext())
      const isContextStillMatching = context !== null || currentFingerprint === fingerprintBefore

      if (seq === _checkSeq && isContextStillMatching) {
        status.value = result.status || (result.ok ? 'safe' : 'blocked')
        code.value = result.code || null
        currentContext.value = result.currentContext || null
        canonicalContext.value = result.canonicalContext || null
        sources.value = Array.isArray(result.sources) ? [...result.sources] : []
        issues.value = Array.isArray(result.issues) ? [...result.issues] : []
        lastCheckedAt.value = new Date().toISOString()
      }

      return result
    } catch (err) {
      if (seq === _checkSeq) {
        status.value = 'blocked'
        code.value = 'SYNC_CONTEXT_READ_FAILED'
        issues.value = [{ code: 'INSPECT_FAILED', source: 'store' }]
        lastError.value = err
        lastCheckedAt.value = new Date().toISOString()
      }
      return {
        ok: false,
        code: 'SYNC_CONTEXT_READ_FAILED',
        status: 'blocked',
        currentContext: null,
        canonicalContext: null,
        issues: [{ code: 'INSPECT_FAILED', source: 'store' }],
      }
    } finally {
      // Loading ownership: older check must not reset loading if a newer check is running
      if (seq === _checkSeq) {
        loading.value = false
      }
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
