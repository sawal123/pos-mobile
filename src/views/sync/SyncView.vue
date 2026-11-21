<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'

import AppIcon from '@/components/base/AppIcon.vue'
import BaseButton from '@/components/base/BaseButton.vue'
import BaseCard from '@/components/base/BaseCard.vue'
import BaseModal from '@/components/base/BaseModal.vue'
import DevicePairingModal from '@/components/cloud/DevicePairingModal.vue'
import SyncPendingDetailsModal from '@/components/sync/SyncPendingDetailsModal.vue'
import { useCashStore } from '@/stores/cashStore'
import { useCloudSessionStore } from '@/stores/cloudSessionStore'
import { useCustomerStore } from '@/stores/customerStore'
import { useProductStore } from '@/stores/productStore'
import { useSubscriptionStore } from '@/stores/subscriptionStore'
import { useSyncAutoSyncStore } from '@/stores/syncAutoSyncStore'
import { useSyncOrchestratorStore } from '@/stores/syncOrchestratorStore'
import { useSyncPushStore } from '@/stores/syncPushStore'
import { useSyncPullStore } from '@/stores/syncPullStore'
import { useSyncContextGuardStore } from '@/stores/syncContextGuardStore'
import { useSyncStatusStore } from '@/stores/syncStatusStore'
import { useSyncProgressStore } from '@/stores/syncProgressStore'
import { useTransactionStore } from '@/stores/transactionStore'
import { clearLocalCache } from '@/services/localCacheService'
import {
  captureLocalSafetyBackup,
  clearLocalSafetyBackup,
  restoreLocalSafetyBackup,
} from '@/services/localSafetyBackup'
import {
  SYNC_REQUIREMENT_LABELS,
  SYNC_REQUIREMENT_HINTS,
  SYNC_REQUIREMENT_ORDER,
} from '@/services/sync/syncPreconditions'

const router = useRouter()
const cashStore = useCashStore()
const cloudStore = useCloudSessionStore()
const customerStore = useCustomerStore()
const productStore = useProductStore()
const subscriptionStore = useSubscriptionStore()
const syncAutoSyncStore = useSyncAutoSyncStore()
const syncOrchestratorStore = useSyncOrchestratorStore()
const syncPushStore = useSyncPushStore()
const syncPullStore = useSyncPullStore()
const syncContextGuardStore = useSyncContextGuardStore()
const syncStatusStore = useSyncStatusStore()
const syncProgressStore = useSyncProgressStore()
const transactionStore = useTransactionStore()

const isSyncing = ref(false)
const isPulling = ref(false)
const isClearingCache = ref(false)
const syncFeedback = ref(null) // { type: 'success' | 'error', message: string }
const autoSyncDraft = ref(syncAutoSyncStore.enabled)

onMounted(async () => {
  await syncStatusStore.refresh()
  await syncPushStore.refreshPendingCount()
  await loadWorkspaceFootprint()
  try {
    await syncAutoSyncStore.loadPreference()
    autoSyncDraft.value = syncAutoSyncStore.enabled
  } catch {
    // Non-blocking
  }
})

watch(
  () => syncAutoSyncStore.enabled,
  (val) => {
    autoSyncDraft.value = val
  },
)

async function handleToggleAutoSync() {
  const nextVal = !autoSyncDraft.value
  autoSyncDraft.value = nextVal
  try {
    const res = await syncAutoSyncStore.setEnabled(nextVal)
    if (!res || !res.ok) {
      autoSyncDraft.value = syncAutoSyncStore.enabled
    }
  } catch {
    autoSyncDraft.value = syncAutoSyncStore.enabled
  }
}

const isOnline = computed(() => syncStatusStore.online)
const isCloudLinked = computed(() => cloudStore.isLinked)
const pendingCount = computed(() => {
  return Math.max(syncStatusStore.pendingCount || 0, syncPushStore.pendingCount || 0)
})

/**
 * Tarik data hanya relevan untuk akun dengan akses Cloud (paket berbayar).
 * Paket Free menyimpan data lokal saja, jadi tombolnya tidak ditampilkan.
 */
const canPullFromCloud = computed(() => cloudStore.cloudAccess === true)
const isAnyBusy = computed(() => isSyncing.value || isPulling.value || isClearingCache.value)

const lastSyncFormatted = computed(() => {
  // Only a completed push/pull cycle counts as a sync. Falling back to the
  // context check time (or the local status read time) produced a fake
  // "Terakhir disinkronkan" timestamp even when nothing had ever been synced.
  const raw = syncOrchestratorStore.lastSyncedAt

  if (!raw) return 'Belum pernah'
  const date = new Date(raw)
  if (Number.isNaN(date.getTime())) return 'Belum pernah'

  return date.toLocaleString('id-ID', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
})

/**
 * Why a Cloud sync can or cannot run. The local precondition check inside the
 * push/pull services fails closed, so the screen must expose the same list
 * instead of claiming everything is synced.
 */
const syncReadiness = computed(() => cloudStore.syncReadiness ?? { ready: false, missing: [] })
const isSyncReady = computed(() => syncReadiness.value.ready === true)
const isCashier = computed(
  () => cloudStore.isCashierContext === true || cloudStore.role === 'cashier',
)
// PAIR-01: kode pairing 4 digit hanya untuk role kasir. Perangkat owner/member
// dikelola dari Dashboard dan di-bind otomatis oleh server.
const requiresDevicePairing = computed(() => isCashier.value)
const missingRequirements = computed(() =>
  Array.isArray(syncReadiness.value.missing) ? syncReadiness.value.missing : [],
)
const readinessRows = computed(() =>
  SYNC_REQUIREMENT_ORDER.filter(
    (key) => key !== 'device_registration' || requiresDevicePairing.value,
  ).map((key) => ({
    key,
    label: SYNC_REQUIREMENT_LABELS[key] ?? key,
    hint: SYNC_REQUIREMENT_HINTS[key] ?? '',
    ok: !missingRequirements.value.includes(key),
  })),
)
const deviceIdentifierLabel = computed(() => cloudStore.deviceIdentifier || '-')
const hasDeviceBinding = computed(
  () => cloudStore.registeredDeviceId !== null && cloudStore.registeredDeviceId !== undefined,
)
const isDeviceMissing = computed(() => requiresDevicePairing.value && !hasDeviceBinding.value)

const isPairingModalOpen = ref(false)

/**
 * Diagnostik ruang kerja.
 *
 * Kalau pengguna melihat "data hilang" padahal sebelumnya ada, penyebab paling
 * sering bukan penghapusan: saat berpindah bisnis Cloud, aplikasi menyimpan
 * data ruang kerja lama sebagai snapshot dan menampilkan ruang kerja baru yang
 * mungkin masih kosong. Footprint ini menunjukkan bahwa data tersebut masih ada
 * beserta jumlahnya, supaya tidak dikira hilang.
 */
const workspaceFootprint = ref(null)

async function loadWorkspaceFootprint() {
  const adapter = cloudStore.adapter
  if (!adapter || typeof adapter.loadWorkspaceRegistry !== 'function') return

  try {
    const registry = await adapter.loadWorkspaceRegistry()
    const active = registry?.activeWorkspaceId ?? cloudStore.activeWorkspaceId ?? null

    const others = []
    const workspaces = registry?.workspaces ?? {}

    for (const [workspaceId, meta] of Object.entries(workspaces)) {
      if (workspaceId === active) continue

      let snapshot = null
      try {
        snapshot =
          typeof adapter.loadWorkspaceSnapshot === 'function'
            ? await adapter.loadWorkspaceSnapshot(workspaceId)
            : null
      } catch {
        snapshot = null
      }

      const products = Array.isArray(snapshot?.products) ? snapshot.products.length : 0
      const transactions = Array.isArray(snapshot?.transactions) ? snapshot.transactions.length : 0
      const customers = Array.isArray(snapshot?.customers) ? snapshot.customers.length : 0

      if (products > 0 || transactions > 0 || customers > 0) {
        others.push({
          id: workspaceId,
          name: meta?.name || snapshot?.business?.name || workspaceId,
          products,
          transactions,
          customers,
        })
      }
    }

    workspaceFootprint.value = { active, others }
  } catch {
    workspaceFootprint.value = null
  }
}

function openPairingModal() {
  isPairingModalOpen.value = true
}

function closePairingModal() {
  isPairingModalOpen.value = false
}

/**
 * PAIR-01 — setelah kasir memasukkan kode 4 digit, `device_context` sudah
 * di-refresh oleh store. Layar hanya perlu memperbarui status + memberi tahu
 * bahwa data Cloud siap ditarik.
 */
async function handleDevicePaired() {
  isPairingModalOpen.value = false

  try {
    await syncPushStore.refreshPendingCount()
    await syncStatusStore.refresh()
  } catch {
    // Non-blocking: status cards refresh on the next visit.
  }

  syncFeedback.value = {
    type: 'success',
    message: 'Perangkat kasir berhasil dipasangkan. Tekan Tarik untuk memuat data dari server.',
  }
}

const showPendingDetailsModal = ref(false)

const syncBadgeLabel = computed(() => {
  if (pendingCount.value > 0) return `${pendingCount.value} Data Pending`
  return isSyncReady.value ? 'Semua Tersinkron' : 'Belum Siap'
})

const syncBadgeClass = computed(() => {
  if (pendingCount.value > 0) return 'bg-amber-100 text-amber-800'
  return isSyncReady.value ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-700'
})

/**
 * A failed sync keeps the technical code, but the message must be actionable:
 * a precondition failure is a configuration problem, not a network problem.
 */
function describeSyncFailure(result, fallback) {
  const message = result?.message || fallback
  if (result?.code === 'PRECONDITION_FAILED') {
    return `${message} Periksa panel "Kesiapan Sinkronisasi" di atas.`
  }
  return message
}

async function handleSyncNow() {
  if (isSyncing.value || isPulling.value || isClearingCache.value) return
  isSyncing.value = true
  syncFeedback.value = null

  try {
    await syncProgressStore.runWithProgress(
      {
        type: 'sync',
        title: 'Sinkronisasi Data',
        description: 'Sedang mengirim antrean data lokal dan menyinkronkan dengan server...',
      },
      async (setProgress) => {
        setProgress(20, 'Menghubungkan ke server cloud...')
        let result = null
        if (syncOrchestratorStore && typeof syncOrchestratorStore.syncAll === 'function') {
          result = await syncOrchestratorStore.syncAll()
        } else {
          result = await syncPushStore.pushNow()
        }

        setProgress(60, 'Memverifikasi status antrean data...')
        // Perangkat yang belum pernah memuat data Cloud tidak bisa push/pull
        // reguler. Jangan menyuruh pengguna menekan tombol: langsung muat datanya
        // sekali (initial read) supaya data Cloud tampil setelah login.
        if (
          result?.ok === false &&
          result.code === 'SYNC_BUSINESS_NOT_BOUND' &&
          canPullFromCloud.value
        ) {
          setProgress(75, 'Memuat data Cloud pertama kali...')
          const initial = await syncPullStore.pullNow({ initialCloudRead: true })
          await syncPushStore.refreshPendingCount()
          await syncStatusStore.refresh()

          if (initial?.ok) {
            setProgress(100, 'Data Cloud berhasil dimuat ke SQLite.')
            syncFeedback.value = {
              type: 'success',
              message:
                'Data Cloud berhasil dimuat ke perangkat dan disimpan di SQLite. Sinkronisasi selesai.',
            }
            return { ok: true }
          }

          result = initial
        }

        await syncPushStore.refreshPendingCount()
        await syncStatusStore.refresh()

        if (result && result.ok === false) {
          syncFeedback.value = buildFailureFeedback(result)
          return result
        }

        setProgress(100, 'Sinkronisasi selesai!')
        syncFeedback.value = {
          type: 'success',
          message: 'Sinkronisasi berhasil! Semua data offline telah terkirim ke server.',
        }
        return { ok: true }
      },
    )
  } catch (err) {
    syncFeedback.value = {
      type: 'error',
      message: err.message || 'Terjadi kesalahan saat melakukan sinkronisasi.',
    }
  } finally {
    isSyncing.value = false
  }
}

async function handlePullNow(opts = {}) {
  if (isSyncing.value || isPulling.value || isClearingCache.value) return
  isPulling.value = true
  syncFeedback.value = null

  try {
    await syncProgressStore.runWithProgress(
      {
        type: 'pull',
        title: 'Tarik Data Cloud',
        description: 'Sedang mengunduh dan menyelaraskan katalog data dari cloud...',
      },
      async (setProgress) => {
        setProgress(25, 'Memeriksa otorisasi ruang kerja cloud...')
        await syncContextGuardStore.check()
        const sources = Array.isArray(syncContextGuardStore.sources)
          ? syncContextGuardStore.sources
          : []
        const hasCatalogBinding =
          sources.includes('push_binding') || sources.includes('pull_binding')
        const isInitial = Boolean(
          (typeof opts === 'object' && opts && opts.initialCloudRead === true) ||
          !hasCatalogBinding,
        )

        setProgress(55, 'Mengunduh data dan menyimpan ke SQLite...')
        const result = await syncPullStore.pullNow({ initialCloudRead: isInitial })
        await syncPushStore.refreshPendingCount()
        await syncStatusStore.refresh()

        if (result && !result.ok) {
          syncFeedback.value = buildFailureFeedback(result, 'Gagal menarik data cloud.')
          return result
        }

        setProgress(100, 'Data Cloud berhasil disimpan!')
        syncFeedback.value = {
          type: 'success',
          message:
            'Data Cloud berhasil dimuat ke perangkat dan disimpan di SQLite. Jumlah data: ' +
            `${result?.applied ?? 0}.`,
        }
        return { ok: true }
      },
    )
  } catch (err) {
    syncFeedback.value = {
      type: 'error',
      message: err.message || 'Gagal menarik data cloud.',
    }
  } finally {
    isPulling.value = false
  }
}

/**
 * Muat ulang data lokal dari Cloud = operasi DESTRUKTIF.
 *
 * Data lokal dihapus lebih dulu, jadi:
 *  1. wajib konfirmasi eksplisit,
 *  2. snapshot data lama disimpan sebelum dihapus,
 *  3. bila pemuatan Cloud gagal, snapshot dikembalikan apa adanya.
 *
 * Sebelumnya tombol ini langsung menghapus data tanpa konfirmasi, sehingga satu
 * kegagalan tarik data membuat seluruh riwayat pengguna hilang.
 */
const showClearConfirm = ref(false)

function requestClearAndPull() {
  if (isAnyBusy.value || !canPullFromCloud.value) return
  showClearConfirm.value = true
}

function cancelClearAndPull() {
  showClearConfirm.value = false
}

async function handleClearAndPull() {
  showClearConfirm.value = false
  if (isSyncing.value || isPulling.value || isClearingCache.value) return

  isClearingCache.value = true
  syncFeedback.value = null

  const adapter = cloudStore.adapter
  let backup = null

  try {
    await syncProgressStore.runWithProgress(
      {
        type: 'reload',
        title: 'Memuat Ulang Data Cloud',
        description: 'Sedang menyiapkan cadangan lokal dan memuat ulang data dari cloud...',
      },
      async (setProgress) => {
        setProgress(15, 'Membuat cadangan pengaman data lokal...')
        backup = await captureLocalSafetyBackup({ adapter })

        setProgress(35, 'Menyiapkan ruang penyimpanan lokal...')
        await clearLocalCache({
          pinia: null,
          adapter,
          scheduler: cloudStore.scheduler,
          resetBusiness: false,
        })
        await syncContextGuardStore.check()

        setProgress(65, 'Mengunduh seluruh data dari Cloud...')
        const pullRes = await syncPullStore.pullNow({ initialCloudRead: true })
        await syncPushStore.refreshPendingCount()
        await syncStatusStore.refresh()

        if (pullRes.ok) {
          clearLocalSafetyBackup()
          setProgress(100, 'Data Cloud berhasil dimuat ulang!')
          syncFeedback.value = {
            type: 'success',
            message: 'Data Cloud berhasil dimuat ulang dan disimpan di SQLite.',
          }
          return { ok: true }
        }

        // Pemuatan gagal → kembalikan data yang tadi dihapus.
        setProgress(80, 'Pemuatan gagal, memulihkan data lokal...')
        const restore = await restoreLocalSafetyBackup(backup, { adapter })
        syncFeedback.value = {
          type: 'error',
          code: pullRes.code,
          message: restore.restored
            ? `${pullRes.message || 'Gagal memuat data dari Cloud.'} Data lokal Anda dikembalikan, tidak ada yang hilang.`
            : `${pullRes.message || 'Gagal memuat data dari Cloud.'} ${
                restore.reason === 'EMPTY_SNAPSHOT'
                  ? ''
                  : 'Namun pemulihan otomatis gagal — gunakan Restore Backup dari Pengaturan.'
              }`,
        }
        return pullRes
      },
    )
  } catch (err) {
    const restore = await restoreLocalSafetyBackup(backup, { adapter })
    syncFeedback.value = {
      type: 'error',
      message: `Gagal memuat ulang data: ${err?.message || err}.${
        restore.restored ? ' Data lokal Anda dikembalikan.' : ''
      }`,
    }
  } finally {
    isClearingCache.value = false
  }
}

/**
 * Ubah hasil gagal dari service menjadi banner yang bisa ditindaklanjuti.
 * Pesan teknis berbahasa Inggris tidak pernah ditampilkan ke kasir.
 */
function buildFailureFeedback(
  result,
  fallback = 'Sinkronisasi gagal. Pastikan koneksi internet stabil.',
) {
  const code = result?.code

  if (code === 'INITIAL_PULL_ALREADY_IN_PROGRESS') {
    return {
      type: 'info',
      code,
      message: 'Data Cloud sedang dimuat. Tunggu sampai selesai — data akan tampil otomatis.',
    }
  }

  if (code === 'SYNC_BUSINESS_NOT_BOUND') {
    return {
      type: 'error',
      code,
      message:
        'Perangkat ini belum memuat data Cloud. Tekan "Muat Data Cloud" untuk mengunduh dan menyimpannya ke SQLite.',
    }
  }

  if (code === 'CLOUD_INITIALIZATION_WORKSPACE_NOT_EMPTY') {
    return {
      type: 'error',
      code,
      message:
        'Data lokal masih ada, jadi data Cloud tidak dimuat agar tidak menimpa. Data Anda aman — gunakan "Muat ulang dari Cloud" hanya jika Anda yakin ingin menggantinya.',
    }
  }

  return { type: 'error', code, message: describeSyncFailure(result, fallback) }
}

function handleOpenSettingsCloud() {
  router.push({ name: 'settings', query: { section: 'cloud' } })
}

function handleBack() {
  router.back()
}
</script>

<template>
  <div class="mx-auto max-w-3xl space-y-4 pb-28 sm:pb-16" data-testid="sync-page">
    <!-- Header -->
    <header class="flex items-center gap-3">
      <button
        type="button"
        data-testid="sync-back-btn"
        class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-zinc-200 bg-white text-ink-primary transition active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
        aria-label="Kembali"
        @click="handleBack"
      >
        <AppIcon name="chevron-left" />
      </button>
      <div class="min-w-0">
        <p class="text-xs font-semibold uppercase tracking-wider text-primary">Sinkronisasi</p>
        <h2 class="truncate text-xl font-bold text-ink-primary sm:text-2xl">
          Pusat Sinkronisasi Data
        </h2>
      </div>
    </header>

    <!-- Real-time Connectivity Status Card -->
    <BaseCard class="space-y-3" data-testid="sync-status-card">
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-3">
          <span
            class="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl"
            :class="isOnline ? 'bg-emerald-100 text-emerald-600' : 'bg-zinc-100 text-zinc-500'"
          >
            <AppIcon name="sync" class="h-6 w-6" :class="isSyncing ? 'animate-spin' : ''" />
          </span>
          <div>
            <div class="flex items-center gap-2">
              <span
                class="inline-block h-2.5 w-2.5 rounded-full"
                :class="isOnline ? 'bg-emerald-500 animate-pulse' : 'bg-zinc-400'"
              />
              <h3
                class="text-base font-bold text-ink-primary"
                data-testid="connection-status-title"
              >
                {{ isOnline ? 'Online (Terhubung)' : 'Offline (Mode Lokal)' }}
              </h3>
            </div>
            <p class="text-xs text-ink-secondary mt-0.5">
              {{
                isOnline
                  ? isCloudLinked
                    ? 'Terhubung dengan database server Cloud'
                    : 'Terhubung ke internet. Belum masuk akun Cloud.'
                  : 'Internet tidak aktif. Transaksi tersimpan aman di database lokal HP.'
              }}
            </p>
          </div>
        </div>

        <span
          class="rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider"
          :class="isOnline ? 'bg-emerald-100 text-emerald-700' : 'bg-zinc-100 text-zinc-600'"
          data-testid="connection-status-badge"
        >
          {{ isOnline ? 'Online' : 'Offline' }}
        </span>
      </div>
    </BaseCard>

    <!-- Cloud Account & Workspace Card -->
    <BaseCard class="space-y-4" data-testid="sync-cloud-account-card">
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-3">
          <span
            class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary"
          >
            <AppIcon name="cloud" class="h-5 w-5" />
          </span>
          <div>
            <h4 class="text-sm font-bold text-ink-primary">Akun Cloud & Outlet</h4>
            <p class="text-xs text-ink-secondary">Integrasi dashboard & multi-device</p>
          </div>
        </div>

        <span
          class="rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase"
          :class="isCloudLinked ? 'bg-emerald-100 text-emerald-700' : 'bg-zinc-100 text-zinc-600'"
          data-testid="cloud-link-badge"
        >
          {{ isCloudLinked ? 'Tertaut' : 'Belum Tertaut' }}
        </span>
      </div>

      <!-- If Authenticated -->
      <div v-if="cloudStore.isAuthenticated" class="space-y-3 rounded-2xl bg-surface p-3.5 text-xs">
        <div class="flex items-center justify-between">
          <span class="text-ink-secondary">Email Akun</span>
          <span class="font-semibold text-ink-primary" data-testid="cloud-user-email">
            {{ cloudStore.user?.email || '-' }}
          </span>
        </div>
        <div class="flex items-center justify-between border-t border-zinc-200/50 pt-2">
          <span class="text-ink-secondary">Bisnis Cloud</span>
          <span class="font-semibold text-ink-primary" data-testid="cloud-business-name">
            {{ cloudStore.selectedBusiness?.name || '-' }}
          </span>
        </div>
        <div class="flex items-center justify-between border-t border-zinc-200/50 pt-2">
          <span class="text-ink-secondary">Outlet Tertaut</span>
          <span class="font-semibold text-ink-primary" data-testid="cloud-outlet-name">
            {{ cloudStore.selectedOutlet?.name || '-' }}
          </span>
        </div>
        <div class="flex items-center justify-between border-t border-zinc-200/50 pt-2">
          <span class="text-ink-secondary">Paket Langganan</span>
          <span class="font-semibold text-primary" data-testid="cloud-subscription-tier">
            {{ subscriptionStore.isPremium ? 'Premium' : 'Free' }}
          </span>
        </div>
      </div>

      <!-- If Not Authenticated -->
      <div v-else class="rounded-2xl bg-surface p-4 text-xs text-ink-secondary space-y-1">
        <p class="font-semibold text-ink-primary">Belum terhubung ke Akun Cloud</p>
        <p>
          Silakan login ke Akun Cloud melalui menu Pengaturan untuk menyinkronkan data antar
          perangkat dan dashboard web.
        </p>
      </div>

      <!-- Settings Redirect Note (Login & Logout strictly live in Settings) -->
      <div
        class="flex flex-wrap items-center justify-between gap-2.5 border-t border-zinc-200/60 pt-3 dark:border-slate-700/50"
      >
        <p class="text-xs text-ink-secondary">
          Pengaturan <strong class="font-semibold text-ink-primary">Login</strong>, kelola akun, dan
          <strong class="font-semibold text-ink-primary">Logout</strong> Cloud terletak di menu
          <strong class="font-semibold text-ink-primary">Pengaturan</strong>.
        </p>
        <BaseButton
          size="sm"
          variant="secondary"
          data-testid="btn-sync-open-settings"
          @click="handleOpenSettingsCloud"
        >
          <AppIcon name="settings" class="h-4 w-4" />
          <span>Buka Pengaturan</span>
        </BaseButton>
      </div>
    </BaseCard>

    <!-- Cloud Readiness Checklist -->
    <BaseCard class="space-y-3" data-testid="sync-readiness-card">
      <div class="flex items-start justify-between gap-3">
        <div>
          <h4 class="text-base font-bold text-ink-primary">Kesiapan Sinkronisasi</h4>
          <p class="mt-0.5 text-xs text-ink-secondary">
            Syarat agar tarik dan kirim data Cloud dapat berjalan
          </p>
        </div>
        <span
          class="shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider"
          :class="isSyncReady ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'"
          data-testid="sync-readiness-badge"
        >
          {{ isSyncReady ? 'Siap' : `${missingRequirements.length} Belum Siap` }}
        </span>
      </div>

      <ul class="space-y-2" data-testid="sync-readiness-list">
        <li
          v-for="row in readinessRows"
          :key="row.key"
          :data-testid="`sync-requirement-${row.key}`"
          :data-satisfied="row.ok ? 'true' : 'false'"
          class="flex items-start gap-2.5 rounded-2xl bg-surface/70 px-3 py-2"
        >
          <span
            class="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold"
            :class="row.ok ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'"
            aria-hidden="true"
          >
            {{ row.ok ? '✓' : '!' }}
          </span>
          <div class="min-w-0">
            <p class="text-xs font-semibold text-ink-primary">{{ row.label }}</p>
            <p v-if="!row.ok" class="mt-0.5 text-[11px] leading-relaxed text-ink-secondary">
              {{ row.hint }}
            </p>
            <p
              v-if="!row.ok && row.key === 'device_registration'"
              class="mt-0.5 break-all font-mono text-[11px] text-ink-secondary"
              data-testid="sync-device-identifier"
            >
              ID perangkat: {{ deviceIdentifierLabel }}
            </p>
          </div>
        </li>
      </ul>

      <div v-if="!isSyncReady" class="flex flex-wrap items-center gap-2">
        <BaseButton
          v-if="isDeviceMissing"
          size="sm"
          data-testid="btn-sync-pair-device"
          @click="openPairingModal"
        >
          Pasangkan Perangkat (Kode 4 Digit)
        </BaseButton>
        <BaseButton
          size="sm"
          variant="secondary"
          data-testid="btn-sync-fix-readiness"
          @click="handleOpenSettingsCloud"
        >
          Buka Pengaturan Cloud
        </BaseButton>
      </div>
      <p
        v-else-if="!requiresDevicePairing"
        class="text-[11px] leading-relaxed text-ink-secondary"
        data-testid="sync-owner-no-pairing-note"
      >
        Akun owner tidak memerlukan kode pairing. Perangkat owner dikelola dari Dashboard dan
        di-bind otomatis saat sinkronisasi.
      </p>
    </BaseCard>

    <!-- Manual Sync Action Panel -->
    <BaseCard class="space-y-4" data-testid="sync-action-panel">
      <div class="flex items-start justify-between gap-3">
        <div>
          <h4 class="text-base font-bold text-ink-primary">Aksi Sinkronisasi</h4>
          <p class="text-xs text-ink-secondary mt-0.5">
            Kirim perubahan data penjualan dan stok ke server
          </p>
        </div>

        <div class="text-right">
          <span
            class="inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold"
            :class="syncBadgeClass"
            data-testid="pending-data-badge"
          >
            {{ syncBadgeLabel }}
          </span>
        </div>
      </div>

      <div class="rounded-2xl border border-zinc-200/80 bg-surface/70 p-4 space-y-2">
        <div class="flex items-center justify-between text-xs">
          <span class="text-ink-secondary">Data lokal belum terkirim:</span>
          <div class="flex items-center gap-2">
            <span
              class="font-mono font-bold text-ink-primary text-sm"
              data-testid="pending-count-value"
            >
              {{ pendingCount }}
            </span>
            <button
              v-if="pendingCount > 0"
              type="button"
              class="rounded-lg bg-sky-50 px-2 py-0.5 text-[11px] font-bold text-sky-700 border border-sky-200/70 hover:bg-sky-100 transition cursor-pointer dark:bg-sky-950/60 dark:text-sky-300 dark:border-sky-800"
              data-testid="btn-view-pending-details"
              @click="showPendingDetailsModal = true"
            >
              Lihat Rincian →
            </button>
          </div>
        </div>
        <div class="flex items-center justify-between text-xs border-t border-zinc-200/50 pt-2">
          <span class="text-ink-secondary">Terakhir disinkronkan:</span>
          <span class="font-medium text-ink-primary" data-testid="last-sync-time">
            {{ lastSyncFormatted }}
          </span>
        </div>
      </div>

      <!-- Feedback alert -->
      <div
        v-if="syncFeedback"
        class="rounded-2xl p-3 text-xs flex flex-col gap-2"
        :class="
          syncFeedback.type === 'error'
            ? 'bg-danger/10 text-danger'
            : syncFeedback.type === 'info'
              ? 'bg-amber-50 text-amber-800 border border-amber-200/70'
              : 'bg-emerald-50 text-emerald-800 border border-emerald-200/60'
        "
        data-testid="sync-feedback-banner"
      >
        <div class="flex items-center gap-2">
          <span class="text-sm font-bold">{{
            syncFeedback.type === 'error' ? '!' : syncFeedback.type === 'info' ? 'i' : '✓'
          }}</span>
          <span class="flex-1">{{ syncFeedback.message }}</span>
        </div>
        <div
          v-if="syncFeedback.code === 'SYNC_BUSINESS_NOT_BOUND' && canPullFromCloud"
          class="mt-1"
        >
          <BaseButton
            size="sm"
            data-testid="btn-load-cloud-data"
            :disabled="isAnyBusy"
            @click="handlePullNow({ initialCloudRead: true })"
          >
            <span v-if="isPulling">Memuat data Cloud...</span>
            <span v-else>Muat Data Cloud</span>
          </BaseButton>
        </div>
      </div>

      <!-- Trigger Button -->
      <div>
        <BaseButton
          block
          data-testid="btn-sync-now"
          :disabled="isSyncing || (!isOnline && !cloudStore.isLinked)"
          @click="handleSyncNow"
        >
          <span v-if="isSyncing" class="flex items-center justify-center gap-2">
            <span
              class="h-4 w-4 rounded-full border-2 border-white/30 border-t-white animate-spin"
            />
            <span>Sinkronisasi...</span>
          </span>
          <span v-else class="flex items-center justify-center gap-2">
            <AppIcon name="sync" class="h-4 w-4" />
            <span>Sync</span>
          </span>
        </BaseButton>

        <div v-if="canPullFromCloud" class="mt-2.5 flex flex-col gap-2">
          <BaseButton
            variant="secondary"
            block
            data-testid="btn-pull-cloud"
            :disabled="
              isPulling || isSyncing || isClearingCache || (!isOnline && !cloudStore.isLinked)
            "
            @click="handlePullNow"
          >
            <span v-if="isPulling" class="flex items-center justify-center gap-2">
              <span
                class="h-4 w-4 rounded-full border-2 border-primary/30 border-t-primary animate-spin"
              />
              <span>Mengunduh...</span>
            </span>
            <span v-else class="flex items-center justify-center gap-2">
              <AppIcon name="download" class="h-4 w-4" />
              <span>Tarik</span>
            </span>
          </BaseButton>

          <BaseButton
            variant="ghost"
            size="sm"
            block
            class="text-xs text-danger hover:bg-danger/10"
            data-testid="btn-manual-clear-cache"
            :disabled="isAnyBusy"
            @click="requestClearAndPull"
          >
            <span v-if="isClearingCache">Memuat ulang...</span>
            <span v-else>Muat ulang dari Cloud</span>
          </BaseButton>
        </div>

        <p
          v-else
          class="mt-3 rounded-2xl bg-surface px-3 py-2 text-center text-[11px] leading-relaxed text-ink-secondary"
          data-testid="sync-free-plan-note"
        >
          Paket Free: data hanya tersimpan di perangkat ini. Tarik data Cloud tidak tersedia —
          aktifkan paket Cloud untuk menyinkronkan antar perangkat.
        </p>

        <p v-if="!isOnline" class="text-center text-[11px] text-zinc-400 mt-2">
          Perangkat sedang offline. Sambungkan WiFi atau data seluler untuk sinkronisasi.
        </p>
      </div>
    </BaseCard>

    <!-- Auto-Sync Toggle Card -->
    <BaseCard class="space-y-3" data-testid="auto-sync-card">
      <label class="flex cursor-pointer items-center justify-between gap-4">
        <div>
          <span class="block text-sm font-bold text-ink-primary">Sinkronisasi Otomatis</span>
          <span class="mt-0.5 block text-xs leading-relaxed text-ink-secondary">
            Otomatis sinkronkan data ketika perangkat terhubung ke internet.
          </span>
        </div>
        <input
          v-model="autoSyncDraft"
          data-testid="auto-sync-switch"
          type="checkbox"
          role="switch"
          class="size-5 shrink-0 accent-primary cursor-pointer"
          @change="handleToggleAutoSync"
        />
      </label>
    </BaseCard>

    <!-- Local Offline Data Summary Card -->
    <BaseCard class="space-y-3" data-testid="local-data-summary-card">
      <div>
        <h4 class="text-sm font-bold text-ink-primary">Ringkasan Data Lokal Perangkat</h4>
        <p class="text-xs text-ink-secondary">Data tersimpan di penyimpanan lokal SQLite HP</p>
      </div>

      <div class="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <div class="rounded-2xl bg-surface p-3 text-center">
          <p class="text-[10px] font-medium uppercase tracking-wider text-ink-secondary">
            Transaksi
          </p>
          <p
            class="mt-1 font-mono text-base font-bold text-ink-primary"
            data-testid="local-tx-count"
          >
            {{ transactionStore.items.length }}
          </p>
        </div>
        <div class="rounded-2xl bg-surface p-3 text-center">
          <p class="text-[10px] font-medium uppercase tracking-wider text-ink-secondary">
            Entri Kas
          </p>
          <p
            class="mt-1 font-mono text-base font-bold text-ink-primary"
            data-testid="local-cash-count"
          >
            {{ cashStore.entries.length }}
          </p>
        </div>
        <div class="rounded-2xl bg-surface p-3 text-center">
          <p class="text-[10px] font-medium uppercase tracking-wider text-ink-secondary">
            Produk/Layanan
          </p>
          <p
            class="mt-1 font-mono text-base font-bold text-ink-primary"
            data-testid="local-product-count"
          >
            {{ productStore.products.length }}
          </p>
        </div>
        <div class="rounded-2xl bg-surface p-3 text-center">
          <p class="text-[10px] font-medium uppercase tracking-wider text-ink-secondary">
            Pelanggan
          </p>
          <p
            class="mt-1 font-mono text-base font-bold text-ink-primary"
            data-testid="local-customer-count"
          >
            {{ customerStore.customers.length }}
          </p>
        </div>
      </div>

      <!-- Diagnostik ruang kerja: menjelaskan "data hilang" yang sebenarnya
           hanya berada di ruang kerja lain. -->
      <div
        v-if="workspaceFootprint"
        class="space-y-2 border-t border-zinc-200/60 pt-3 text-[11px] text-ink-secondary dark:border-slate-700/50"
        data-testid="workspace-footprint"
      >
        <p>
          Ruang kerja aktif:
          <span class="font-mono font-semibold text-ink-primary">{{
            workspaceFootprint.active || '—'
          }}</span>
        </p>

        <div
          v-if="workspaceFootprint.others.length > 0"
          class="rounded-xl border border-amber-200 bg-amber-50 p-2.5 leading-relaxed text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200"
          data-testid="workspace-other-data"
        >
          <p class="font-semibold">Data dari ruang kerja lain masih tersimpan</p>
          <ul class="mt-1 list-disc pl-4">
            <li v-for="other in workspaceFootprint.others" :key="other.id">
              <span class="font-mono">{{ other.id }}</span> — {{ other.name }}:
              {{ other.products }} produk, {{ other.transactions }} transaksi,
              {{ other.customers }} pelanggan
            </li>
          </ul>
          <p class="mt-1">
            Data tersebut tidak hilang, hanya tidak sedang aktif. Simpan ID ruang kerja di atas
            sebelum melakukan perubahan apa pun.
          </p>
        </div>
      </div>
    </BaseCard>

    <DevicePairingModal
      :open="isPairingModalOpen"
      :business-name="cloudStore.selectedBusiness?.name || ''"
      @close="closePairingModal"
      @paired="handleDevicePaired"
    />

    <BaseModal
      :open="showClearConfirm"
      title="Muat ulang data dari Cloud?"
      data-testid="clear-cloud-confirm"
      @close="cancelClearAndPull"
    >
      <div class="space-y-4">
        <p class="text-sm leading-relaxed text-ink-secondary">
          Data lokal di perangkat ini (<span class="font-semibold text-ink-primary"
            >produk, transaksi, pelanggan, kas, dan shift</span
          >) akan dihapus lebih dulu, lalu diunduh ulang dari Cloud.
        </p>
        <p class="text-xs leading-relaxed text-ink-secondary">
          Gunakan hanya jika Anda yakin data di Cloud sudah lengkap. Sebelum menghapus, aplikasi
          menyimpan snapshot lokal dan akan mengembalikannya otomatis bila pengunduhan gagal.
        </p>
        <div class="flex items-center justify-end gap-2">
          <BaseButton
            variant="ghost"
            size="sm"
            data-testid="btn-cancel-clear-and-pull"
            @click="cancelClearAndPull"
          >
            Batal
          </BaseButton>
          <BaseButton
            variant="danger"
            size="sm"
            data-testid="btn-confirm-clear-and-pull"
            :disabled="isAnyBusy"
            @click="handleClearAndPull"
          >
            Hapus &amp; Muat Ulang
          </BaseButton>
        </div>
      </div>
    </BaseModal>

    <!-- Modal Rincian Data Pending -->
    <SyncPendingDetailsModal v-model="showPendingDetailsModal" />
  </div>
</template>
