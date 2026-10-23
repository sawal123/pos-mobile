<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'

import AppIcon from '@/components/base/AppIcon.vue'
import BaseButton from '@/components/base/BaseButton.vue'
import BaseCard from '@/components/base/BaseCard.vue'
import BaseModal from '@/components/base/BaseModal.vue'
import { useBusinessStore } from '@/stores/businessStore'
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
import { useTransactionStore } from '@/stores/transactionStore'
import { clearLocalCache } from '@/services/localCacheService'

const router = useRouter()
const businessStore = useBusinessStore()
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
const transactionStore = useTransactionStore()

const isSyncing = ref(false)
const isPulling = ref(false)
const isClearingCache = ref(false)
const syncFeedback = ref(null) // { type: 'success' | 'error', message: string }
const showDisconnectConfirm = ref(false)
const autoSyncDraft = ref(syncAutoSyncStore.enabled)

onMounted(async () => {
  await syncStatusStore.refresh()
  await syncPushStore.refreshPendingCount()
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

const lastSyncFormatted = computed(() => {
  const raw =
    syncOrchestratorStore.lastSyncedAt ||
    syncStatusStore.lastCheckedAt ||
    cloudStore.contextCheckedAt

  if (!raw) return 'Belum ada riwayat sinkronisasi'
  const date = new Date(raw)
  if (Number.isNaN(date.getTime())) return 'Belum ada riwayat'

  return date.toLocaleString('id-ID', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
})

async function handleSyncNow() {
  if (isSyncing.value || isPulling.value || isClearingCache.value) return
  isSyncing.value = true
  syncFeedback.value = null

  try {
    let result = null
    if (syncOrchestratorStore && typeof syncOrchestratorStore.syncAll === 'function') {
      result = await syncOrchestratorStore.syncAll()
    } else {
      result = await syncPushStore.pushNow()
    }

    await syncPushStore.refreshPendingCount()
    await syncStatusStore.refresh()

    if (result && result.ok === false) {
      if (
        result.code === 'CLOUD_FIRST_INITIALIZATION_INCOMPLETE' ||
        result.code === 'SYNC_CLOUD_FIRST_NOT_READY' ||
        result.code === 'SYNC_BUSINESS_NOT_BOUND'
      ) {
        const hasTransactions = transactionStore.items && transactionStore.items.length > 0
        if (!hasTransactions) {
          await handleClearAndPull()
          return
        }
      }

      syncFeedback.value = {
        type: 'error',
        code: result.code,
        message: result.message || 'Sinkronisasi gagal. Pastikan koneksi internet stabil.',
      }
    } else {
      syncFeedback.value = {
        type: 'success',
        message: 'Sinkronisasi berhasil! Semua data offline telah terkirim ke server.',
      }
    }
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
    await syncContextGuardStore.check()
    const isInitial = Boolean(
      (typeof opts === 'object' && opts && opts.initialCloudRead === true) ||
      !cloudStore.pushBinding ||
      (cloudStore.pullBinding?.status === 'initializing')
    )
    const result = await syncPullStore.pullNow({ initialCloudRead: isInitial })
    await syncPushStore.refreshPendingCount()
    await syncStatusStore.refresh()

    if (result && !result.ok) {
      if (result.code === 'CLOUD_INITIALIZATION_WORKSPACE_NOT_EMPTY') {
        const hasTransactions = transactionStore.items && transactionStore.items.length > 0
        if (!hasTransactions) {
          await handleClearAndPull()
          return
        }
        syncFeedback.value = {
          type: 'error',
          code: result.code,
          message:
            'Terdapat data lokal belum tersinkron (misal: shift/kas yang sedang berjalan). Bersihkan cache jika ingin memuat ulang dari Cloud.',
        }
      } else {
        syncFeedback.value = {
          type: 'error',
          code: result.code,
          message: result.message || 'Gagal menarik data cloud.',
        }
      }
    } else {
      syncFeedback.value = {
        type: 'success',
        message: 'Data Cloud berhasil dimuat ke perangkat!',
      }
    }
  } catch (err) {
    syncFeedback.value = {
      type: 'error',
      message: err.message || 'Gagal menarik data cloud.',
    }
  } finally {
    isPulling.value = false
  }
}

async function handleClearAndPull() {
  if (isSyncing.value || isClearingCache.value) return
  isClearingCache.value = true
  syncFeedback.value = null

  try {
    await clearLocalCache({
      pinia: null,
      adapter: cloudStore.adapter,
      scheduler: cloudStore.scheduler,
      resetBusiness: false,
    })
    await syncContextGuardStore.check()
    const pullRes = await syncPullStore.pullNow({ initialCloudRead: true })
    await syncPushStore.refreshPendingCount()
    await syncStatusStore.refresh()

    if (pullRes.ok) {
      syncFeedback.value = {
        type: 'success',
        message: 'Cache dibersihkan dan menu produk Cloud berhasil dimuat ulang!',
      }
    } else {
      syncFeedback.value = {
        type: 'error',
        message: pullRes.message || 'Gagal memuat data dari Cloud setelah membersihkan cache.',
      }
    }
  } catch (err) {
    syncFeedback.value = {
      type: 'error',
      message: 'Gagal membersihkan cache: ' + (err?.message || err),
    }
  } finally {
    isClearingCache.value = false
  }
}

async function confirmDisconnect() {
  showDisconnectConfirm.value = false
  await clearLocalCache({
    pinia: null,
    adapter: cloudStore.adapter,
    scheduler: cloudStore.scheduler,
    resetBusiness: true,
  })
  await cloudStore.logout()
  syncFeedback.value = {
    type: 'success',
    message: 'Hubungan Cloud berhasil diputuskan dan data cache lokal telah dibersihkan.',
  }
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
              <h3 class="text-base font-bold text-ink-primary" data-testid="connection-status-title">
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
          <span class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
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
        <p>Hubungkan aplikasi POS ini dengan akun Cloud untuk menyinkronkan data antar perangkat dan dashboard web.</p>
      </div>

      <!-- Action Buttons -->
      <div class="flex flex-wrap gap-2 pt-1">
        <BaseButton
          v-if="!cloudStore.isAuthenticated"
          size="sm"
          data-testid="btn-login-cloud"
          @click="router.push('/cloud')"
        >
          Masuk
        </BaseButton>

        <template v-else>
          <BaseButton
            size="sm"
            variant="secondary"
            data-testid="btn-manage-cloud"
            @click="router.push('/cloud')"
          >
            Kelola
          </BaseButton>
          <BaseButton
            size="sm"
            variant="ghost"
            class="text-danger hover:bg-danger/10"
            data-testid="btn-disconnect-cloud"
            @click="showDisconnectConfirm = true"
          >
            Putuskan
          </BaseButton>
        </template>
      </div>
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
            :class="pendingCount > 0 ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-800'"
            data-testid="pending-data-badge"
          >
            {{ pendingCount > 0 ? `${pendingCount} Data Pending` : 'Semua Tersinkron' }}
          </span>
        </div>
      </div>

      <div class="rounded-2xl border border-zinc-200/80 bg-surface/70 p-4 space-y-2">
        <div class="flex items-center justify-between text-xs">
          <span class="text-ink-secondary">Data lokal belum terkirim:</span>
          <span class="font-mono font-bold text-ink-primary text-sm" data-testid="pending-count-value">
            {{ pendingCount }}
          </span>
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
        :class="syncFeedback.type === 'error' ? 'bg-danger/10 text-danger' : 'bg-emerald-50 text-emerald-800 border border-emerald-200/60'"
        data-testid="sync-feedback-banner"
      >
        <div class="flex items-center gap-2">
          <span class="text-sm font-bold">{{ syncFeedback.type === 'error' ? '!' : '✓' }}</span>
          <span class="flex-1">{{ syncFeedback.message }}</span>
        </div>
        <div v-if="syncFeedback.type === 'error' && (syncFeedback.code === 'CLOUD_INITIALIZATION_WORKSPACE_NOT_EMPTY' || syncFeedback.message?.includes('Bersihkan cache'))" class="mt-1">
          <BaseButton
            size="sm"
            variant="danger"
            data-testid="btn-clear-and-pull"
            :disabled="isClearingCache || isSyncing"
            @click="handleClearAndPull"
          >
            <span v-if="isClearingCache">Memuat...</span>
            <span v-else>Bersihkan</span>
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
            <span class="h-4 w-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />
            <span>Sinkronisasi...</span>
          </span>
          <span v-else class="flex items-center justify-center gap-2">
            <AppIcon name="sync" class="h-4 w-4" />
            <span>Sync</span>
          </span>
        </BaseButton>

        <div class="mt-2.5 flex flex-col gap-2">
          <BaseButton
            variant="secondary"
            block
            data-testid="btn-pull-cloud"
            :disabled="isPulling || isSyncing || isClearingCache || (!isOnline && !cloudStore.isLinked)"
            @click="handlePullNow"
          >
            <span v-if="isPulling" class="flex items-center justify-center gap-2">
              <span class="h-4 w-4 rounded-full border-2 border-primary/30 border-t-primary animate-spin" />
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
            :disabled="isPulling || isSyncing || isClearingCache"
            @click="handleClearAndPull"
          >
            <span v-if="isClearingCache">Reset...</span>
            <span v-else>Bersihkan</span>
          </BaseButton>
        </div>

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
          <p class="text-[10px] font-medium uppercase tracking-wider text-ink-secondary">Transaksi</p>
          <p class="mt-1 font-mono text-base font-bold text-ink-primary" data-testid="local-tx-count">
            {{ transactionStore.items.length }}
          </p>
        </div>
        <div class="rounded-2xl bg-surface p-3 text-center">
          <p class="text-[10px] font-medium uppercase tracking-wider text-ink-secondary">Entri Kas</p>
          <p class="mt-1 font-mono text-base font-bold text-ink-primary" data-testid="local-cash-count">
            {{ cashStore.entries.length }}
          </p>
        </div>
        <div class="rounded-2xl bg-surface p-3 text-center">
          <p class="text-[10px] font-medium uppercase tracking-wider text-ink-secondary">Produk/Layanan</p>
          <p class="mt-1 font-mono text-base font-bold text-ink-primary" data-testid="local-product-count">
            {{ productStore.products.length }}
          </p>
        </div>
        <div class="rounded-2xl bg-surface p-3 text-center">
          <p class="text-[10px] font-medium uppercase tracking-wider text-ink-secondary">Pelanggan</p>
          <p class="mt-1 font-mono text-base font-bold text-ink-primary" data-testid="local-customer-count">
            {{ customerStore.customers.length }}
          </p>
        </div>
      </div>
    </BaseCard>

    <!-- Disconnect Modal -->
    <BaseModal
      :open="showDisconnectConfirm"
      title="Putuskan Cloud"
      @close="showDisconnectConfirm = false"
    >
      <div class="space-y-4" data-testid="sync-disconnect-modal">
        <p class="text-sm text-ink-secondary">
          Sesi Cloud akan diputuskan dari POS ini. Seluruh data cache lokal (menu produk, transaksi, dan sesi kasir lokal) akan dibersihkan agar aman saat berganti akun.
        </p>
        <div class="flex flex-wrap gap-2">
          <BaseButton
            variant="danger"
            data-testid="sync-disconnect-confirm"
            @click="confirmDisconnect"
          >
            Putuskan
          </BaseButton>
          <BaseButton
            variant="ghost"
            data-testid="sync-disconnect-cancel"
            @click="showDisconnectConfirm = false"
          >
            Batal
          </BaseButton>
        </div>
      </div>
    </BaseModal>
  </div>
</template>
