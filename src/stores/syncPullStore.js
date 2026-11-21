import { defineStore } from 'pinia'
import { ref } from 'vue'
import { createSyncPullService } from '@/services/sync/syncPullService'
import { isUuid } from '@/services/sync/syncIdentityRegistry'
import { useCloudSessionStore } from './cloudSessionStore'
import { useProductStore } from './productStore'
import { useSyncProgressStore } from './syncProgressStore'

export const useSyncPullStore = defineStore('syncPull', () => {
  const cloudStore = useCloudSessionStore()
  const loading = ref(false)
  const lastResult = ref(null)
  const lastError = ref(null)

  let _pullService = null
  let _adapter = null
  let _scheduler = null
  let _imageBackfillAttempted = false

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

    // PAIR-01: perangkat owner/member tidak memakai kode pairing. Server
    // membuat/mengenali perangkat ini pada sync pertama, dan binding lokal
    // diselesaikan diam-diam supaya metadata pull binding tetap konsisten.
    // Untuk kasir fungsi ini langsung gagal (tanpa network) dan pengguna
    // diarahkan ke pairing di layar Sinkronisasi.
    if (
      options.context == null &&
      cloudStore.isAuthenticated &&
      cloudStore.registeredDeviceId == null &&
      typeof cloudStore.ensureDeviceBinding === 'function'
    ) {
      try {
        await cloudStore.ensureDeviceBinding()
      } catch {
        // Non-blocking: the readiness/precondition path reports the blocker.
      }
    }

    // A restored Cloud context can be complete enough for the UI while one sync
    // requirement (typically the selected outlet or the pre-registered device)
    // is still missing locally. Ask the server once for the authoritative
    // context before failing closed, so a stale local cache cannot block a pull
    // that the backend would happily serve.
    const readiness = cloudStore.syncReadiness
    const isBrowserOnline = typeof navigator === 'undefined' || navigator.onLine !== false
    if (
      options.context == null &&
      readiness?.ready === false &&
      cloudStore.isAuthenticated &&
      isBrowserOnline &&
      typeof cloudStore.refreshContext === 'function'
    ) {
      try {
        await cloudStore.refreshContext()
      } catch {
        // Non-blocking: the precondition check below reports what is still missing.
      }
    }

    // A restored capability cache is display-only. Reconfirm the Cloud
    // session before any pull can apply tenant data to the local workspace.
    if (options.refreshContext !== false && cloudStore.isAuthenticated) {
      let verification
      try {
        verification = await cloudStore.ensureVerifiedContext()
      } catch {
        verification = { ok: false, code: 'CONTEXT_REFRESH_FAILED' }
      }
      if (!verification.ok && verification.skipped !== true) {
        const blocked = {
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
        lastResult.value = blocked
        lastError.value = blocked.message
        loading.value = false
        return blocked
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

    let backfillProductImages = options.backfillProductImages
    if (backfillProductImages === undefined && !_imageBackfillAttempted) {
      try {
        const productStore = useProductStore()
        if (
          productStore &&
          productStore.products.length > 0 &&
          productStore.products.some((p) => isUuid(p.id)) &&
          productStore.products.every((p) => !p.imageData)
        ) {
          backfillProductImages = true
        }
      } catch {
        // unavailable outside a Pinia component context
      }
    }

    try {
      const progressStore = useSyncProgressStore()
      const result = await _pullService.pullNow({
        ...options,
        ...(isInitialCloudRead !== undefined ? { initialCloudRead: isInitialCloudRead } : {}),
        ...(backfillProductImages !== undefined ? { backfillProductImages } : {}),
        context: resolvedContext,
        onProgress: (pct, msg) => {
          if (progressStore.isRunning) {
            progressStore.setProgress(pct, msg)
          }
          options.onProgress?.(pct, msg)
        },
      })
      lastResult.value = result
      if (!result.ok) {
        const isOutletDenied =
          result.code === 'OUTLET_ACCESS_DENIED' ||
          result.error?.code === 'OUTLET_ACCESS_DENIED'
        lastError.value = isOutletDenied
          ? 'Akun kasir ini hanya memiliki akses untuk cabang yang ditugaskan. Perangkat ini terdaftar di cabang berbeda.'
          : (result.error?.message ?? result.message ?? 'Sync pull failed')
      } else {
        lastError.value = null
        if (backfillProductImages) {
          _imageBackfillAttempted = true
        }

        // Data Cloud yang baru diterapkan harus langsung tersimpan di SQLite,
        // bukan menunggu flush berikutnya. Tanpa ini data bisa "hilang" lagi
        // saat aplikasi ditutup sebelum scheduler menulis.
        if (_scheduler && typeof _scheduler.flush === 'function') {
          try {
            await _scheduler.flush()
          } catch {
            // Persistensi tetap dicoba ulang oleh scheduler; tarikan dianggap sukses.
          }
        }
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
      // unavailable outside a Pinia component context
    }

    if (!cloudStore.isLinked || !cloudStore.isOperationalCloudAccess) {
      return { ok: false, reason: 'not_linked' }
    }
    if (loading.value) {
      return { ok: true, inProgress: true }
    }

    let pullBinding = null
    let isInitial = true
    if (_adapter) {
      try {
        const bindings = await Promise.all([
          typeof _adapter.loadSyncPushBinding === 'function'
            ? _adapter.loadSyncPushBinding()
            : Promise.resolve(null),
          typeof _adapter.loadSyncPullBinding === 'function'
            ? _adapter.loadSyncPullBinding()
            : Promise.resolve(null),
        ])
        const pushBinding = bindings[0]
        pullBinding = bindings[1]
        isInitial = Boolean(
          !pushBinding && (!pullBinding || pullBinding.status === 'initializing'),
        )
      } catch {
        isInitial = false
      }
    }

    // The default local template is not a Cloud catalog. Only a completed
    // pull binding proves that the current business/outlet has been loaded.
    // A push-only workspace must still perform a normal incremental pull.
    const needsImageBackfill = Boolean(
      !_imageBackfillAttempted &&
      productStore &&
      productStore.products.length > 0 &&
      productStore.products.some((p) => isUuid(p.id)) &&
      productStore.products.every((p) => !p.imageData),
    )

    if (
      !force &&
      !needsImageBackfill &&
      pullBinding?.status === 'completed' &&
      productStore &&
      productStore.products.length > 0
    ) {
      return { ok: true, alreadyLoaded: true }
    }

    return pullNow({
      initialCloudRead: isInitial,
      ...(needsImageBackfill ? { backfillProductImages: true } : {}),
    })
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
