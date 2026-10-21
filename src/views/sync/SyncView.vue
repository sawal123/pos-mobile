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
import { useSyncStatusStore } from '@/stores/syncStatusStore'
import { useTransactionStore } from '@/stores/transactionStore'

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
const syncStatusStore = useSyncStatusStore()
const transactionStore = useTransactionStore()

const isSyncing = ref(false)
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
  if (isSyncing.value) return
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
      syncFeedback.value = {
        type: 'error',
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

async function confirmDisconnect() {
  showDisconnectConfirm.value = false
  await cloudStore.logout()
  syncFeedback.value = {
    type: 'success',
    message: 'Hubungan Cloud berhasil diputuskan. Data lokal tetap aman.',
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
          Masuk ke Akun Cloud
        </BaseButton>

        <template v-else>
          <BaseButton
            size="sm"
            variant="secondary"
            data-testid="btn-manage-cloud"
            @click="router.push('/cloud')"
          >
            Kelola Akun Cloud
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
        class="rounded-2xl p-3 text-xs flex items-center gap-2"
        :class="syncFeedback.type === 'error' ? 'bg-danger/10 text-danger' : 'bg-emerald-50 text-emerald-800 border border-emerald-200/60'"
        data-testid="sync-feedback-banner"
      >
        <span class="text-sm font-bold">{{ syncFeedback.type === 'error' ? '!' : '✓' }}</span>
        <span>{{ syncFeedback.message }}</span>
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
            <span>Sedang Menyinkronkan Data...</span>
          </span>
          <span v-else class="flex items-center justify-center gap-2">
            <AppIcon name="sync" class="h-4 w-4" />
            <span>Sinkronkan Sekarang</span>
          </span>
        </BaseButton>

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
          Sesi Cloud akan diputuskan dari POS ini. Data lokal (produk, transaksi, pelanggan, kas,
          dan pengaturan) tetap aman dan tidak akan dihapus.
        </p>
        <div class="flex flex-wrap gap-2">
          <BaseButton
            variant="danger"
            data-testid="sync-disconnect-confirm"
            @click="confirmDisconnect"
          >
            Ya, Putuskan
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
