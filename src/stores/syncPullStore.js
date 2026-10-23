import { defineStore } from 'pinia'
import { ref } from 'vue'
import { createSyncPullService } from '@/services/sync/syncPullService'
import { useCloudSessionStore } from './cloudSessionStore'
import { useProductStore } from './productStore'

export const useSyncPullStore = defineStore('syncPull', () => {
  const cloudStore = useCloudSessionStore()
  const loading = ref(false)
  const lastResult = ref(null)
  const lastError = ref(null)

  let _pullService = null
  let _adapter = null
  let _scheduler = null

  function init({ pullService = null, adapter = null, scheduler = null } = {}) {
    if (adapter) {
      _adapter = adapter
    }
    if (scheduler) {
      _scheduler = scheduler
    }
    if (pullService) {
      _pullService = pullService
    } else if (adapter) {
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
      cloudAccess: cloudStore.isOperationalCloudAccess,
      deviceIdentifier: cloudStore.deviceIdentifier,
      registeredDeviceId: cloudStore.registeredDeviceId,
    }

    // Auto-detect initialCloudRead if not explicitly specified:
    // If device has no push binding and no completed pull binding, it's an initial cloud read.
    let isInitialCloudRead = options.initialCloudRead
    if (isInitialCloudRead === undefined && _adapter) {
      try {
        const [pushB, pullB] = await Promise.all([
          typeof _adapter.loadSyncPushBinding === 'function' ? _adapter.loadSyncPushBinding() : null,
          typeof _adapter.loadSyncPullBinding === 'function' ? _adapter.loadSyncPullBinding() : null,
        ])
        if (!pushB && (!pullB || pullB.status === 'initializing')) {
          isInitialCloudRead = true
        }
      } catch {
        // fallback to provided options
      }
    }

    try {
      const result = await _pullService.pullNow({
        ...options,
        ...(isInitialCloudRead !== undefined ? { initialCloudRead: isInitialCloudRead } : {}),
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

  async function ensureCatalogLoaded({ force = false } = {}) {
    let productStore = null
    try {
      productStore = useProductStore()
    } catch {
      productStore = null
    }

    if (!force && productStore && productStore.products.length > 0) {
      return { ok: true, alreadyLoaded: true }
    }
    if (!cloudStore.isLinked || !cloudStore.isOperationalCloudAccess) {
      return { ok: false, reason: 'not_linked' }
    }
    if (loading.value) {
      return { ok: true, inProgress: true }
    }

    let isInitial = false
    if (_adapter && typeof _adapter.loadSyncPullBinding === 'function') {
      try {
        const binding = await _adapter.loadSyncPullBinding()
        if (!binding || binding.status !== 'completed') {
          isInitial = true
        }
      } catch {
        isInitial = true
      }
    } else {
      isInitial = true
    }

    const res = await pullNow({ initialCloudRead: isInitial })
    if (!res.ok && res.code === 'CLOUD_INITIALIZATION_WORKSPACE_NOT_EMPTY') {
      let transactionStore = null
      try {
        const { useTransactionStore } = await import('./transactionStore')
        transactionStore = useTransactionStore()
      } catch {
        transactionStore = null
      }
      if (!transactionStore?.items || transactionStore.items.length === 0) {
        try {
          const { clearLocalCache } = await import('@/services/localCacheService')
          await clearLocalCache({
            pinia: null,
            adapter: _adapter,
            scheduler: _scheduler,
            resetBusiness: false,
          })
          return pullNow({ initialCloudRead: true })
        } catch {
          // If clearing fails, return original result
        }
      }
    }

    return res
  }

  return {
    loading,
    lastResult,
    lastError,
    init,
    pullNow,
    ensureCatalogLoaded,
    getPullService: () => _pullService,
  }
})
