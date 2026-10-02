<script setup>
import { computed, onMounted, watch } from 'vue'

import AppIcon from '@/components/base/AppIcon.vue'
import BaseButton from '@/components/base/BaseButton.vue'
import { createBackupPayload } from '@/services/backupService'
import { CLOUD_BACKUP_PHASE, usePremiumCloudBackupStore } from '@/stores/premiumCloudBackupStore'
import { useBusinessStore } from '@/stores/businessStore'
import { useCartStore } from '@/stores/cartStore'
import { useCashStore } from '@/stores/cashStore'
import { useCloudSessionStore } from '@/stores/cloudSessionStore'
import { useCustomerStore } from '@/stores/customerStore'
import { useExpenseStore } from '@/stores/expenseStore'
import { useProductStore } from '@/stores/productStore'
import { useShiftStore } from '@/stores/shiftStore'
import { useSubscriptionStore } from '@/stores/subscriptionStore'
import { useTaxStore } from '@/stores/taxStore'
import { useTransactionStore } from '@/stores/transactionStore'

const emit = defineEmits(['locked'])

const store = usePremiumCloudBackupStore()
const cloudStore = useCloudSessionStore()
const subscriptionStore = useSubscriptionStore()

const businessStore = useBusinessStore()
const cartStore = useCartStore()
const cashStore = useCashStore()
const customerStore = useCustomerStore()
const expenseStore = useExpenseStore()
const productStore = useProductStore()
const shiftStore = useShiftStore()
const taxStore = useTaxStore()
const transactionStore = useTransactionStore()

const locked = computed(() => store.isCloudBackupLocked)
const canRetry = computed(() => store.canRetry)

const lockMessage = computed(() => {
  if (cloudStore.isAuthenticated !== true || cloudStore.isLinked !== true) {
    return 'Hubungkan dan tautkan akun Cloud untuk mengaktifkan Backup Cloud.'
  }
  if (subscriptionStore.isPremium !== true) {
    return 'Backup Cloud memerlukan langganan Premium yang aktif.'
  }
  return 'Backup Cloud belum tersedia saat ini.'
})

const busyLabel = computed(() => {
  switch (store.phase) {
    case CLOUD_BACKUP_PHASE.PREPARING:
      return 'Menyiapkan…'
    case CLOUD_BACKUP_PHASE.HASHING:
      return 'Memeriksa…'
    case CLOUD_BACKUP_PHASE.UPLOADING:
      return 'Mengunggah…'
    default:
      return 'Backup Sekarang'
  }
})

const statusMessage = computed(() => {
  if (store.phase === CLOUD_BACKUP_PHASE.SUCCESS) {
    return 'Backup Cloud berhasil diunggah.'
  }
  if (store.error) return store.error
  return ''
})

const statusTone = computed(() => {
  if (store.phase === CLOUD_BACKUP_PHASE.SUCCESS) return 'success'
  if (store.error) return 'error'
  return 'idle'
})

function getStoreContext() {
  return {
    businessStore,
    taxStore,
    productStore,
    customerStore,
    expenseStore,
    transactionStore,
    cashStore,
    cartStore,
    shiftStore,
  }
}

async function handleBackup() {
  if (locked.value) {
    emit('locked')
    return
  }

  const snapshot = createBackupPayload(getStoreContext())
  await store.startBackup({ snapshot })
}

async function handleRefresh() {
  if (locked.value) {
    emit('locked')
    return
  }
  await store.refreshList()
}

function formatDate(value) {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '-'
  return date.toLocaleString('id-ID', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function formatSize(bytes) {
  const value = Number(bytes)
  if (!Number.isFinite(value) || value < 0) return '-'
  if (value >= 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`
  if (value >= 1024) return `${(value / 1024).toFixed(1)} KB`
  return `${value} B`
}

function deviceLabel(backup) {
  return backup?.device?.name || backup?.device?.identifier || 'Perangkat'
}

onMounted(() => {
  if (!locked.value) {
    void store.refreshList()
  }
})

// A business change or a Cloud disconnect must never leak the previous
// tenant's backup list or reuse its attempt.
watch(
  () => cloudStore.selectedBusiness?.id ?? null,
  (next, previous) => {
    if (previous !== undefined && next !== previous) {
      store.clear()
      if (!locked.value) void store.refreshList()
    }
  },
)

watch(
  () => cloudStore.isAuthenticated,
  (authenticated) => {
    if (authenticated !== true) store.clear()
  },
)
</script>

<template>
  <div
    class="space-y-4 rounded-3xl border border-zinc-200 bg-surface/60 p-4"
    data-testid="cloud-backup-section"
  >
    <div class="flex items-center justify-between">
      <div class="flex items-center gap-3">
        <span
          class="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary"
        >
          <AppIcon name="cloud" />
        </span>
        <div class="min-w-0">
          <h3 class="text-base font-semibold text-ink-primary">Backup Cloud</h3>
          <p class="text-xs text-ink-secondary">Tersimpan secara privat di Cloud.</p>
        </div>
      </div>
      <span
        class="rounded-full bg-amber-100 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-amber-700"
      >
        Premium
      </span>
    </div>

    <div v-if="locked" class="space-y-3" data-testid="cloud-backup-locked">
      <p
        class="flex items-center gap-2 text-sm text-ink-secondary"
        data-testid="cloud-backup-lock-message"
      >
        <AppIcon name="lock" class="text-amber-500" />
        {{ lockMessage }}
      </p>
      <BaseButton
        size="sm"
        variant="secondary"
        data-testid="cloud-backup-locked-cta"
        @click="emit('locked')"
      >
        Lihat Paket Premium
      </BaseButton>
    </div>

    <template v-else>
      <div class="flex flex-wrap items-center gap-2">
        <BaseButton data-testid="cloud-backup-now" :disabled="store.isBusy" @click="handleBackup">
          {{ busyLabel }}
        </BaseButton>
        <BaseButton
          v-if="canRetry"
          size="sm"
          variant="secondary"
          data-testid="cloud-backup-retry"
          :disabled="store.isBusy"
          @click="store.retry()"
        >
          Coba Lagi
        </BaseButton>
      </div>

      <p
        v-if="statusMessage"
        class="rounded-2xl px-3 py-2 text-sm"
        :class="
          statusTone === 'error' ? 'bg-danger/10 text-danger' : 'bg-emerald-100 text-emerald-700'
        "
        role="status"
        data-testid="cloud-backup-status"
      >
        {{ statusMessage }}
      </p>

      <p class="text-xs text-ink-secondary" data-testid="cloud-backup-retention">
        Cloud menyimpan hingga 10 backup terbaru.
      </p>

      <div class="space-y-2">
        <div class="flex items-center justify-between">
          <p class="text-sm font-semibold text-ink-primary">Backup Cloud</p>
          <button
            type="button"
            class="text-xs font-medium text-primary disabled:opacity-50"
            data-testid="cloud-backup-refresh"
            :disabled="store.listLoading"
            @click="handleRefresh"
          >
            Perbarui
          </button>
        </div>

        <p
          v-if="store.listError"
          class="text-xs text-ink-secondary"
          data-testid="cloud-backup-list-error"
        >
          {{ store.listError }}
        </p>

        <p
          v-if="store.listLoading && store.backups.length === 0"
          class="text-xs text-ink-secondary"
          data-testid="cloud-backup-list-loading"
        >
          Memuat daftar backup…
        </p>

        <p
          v-else-if="store.backups.length === 0"
          class="text-xs text-ink-secondary"
          data-testid="cloud-backup-empty"
        >
          Belum ada backup Cloud.
        </p>

        <ul v-else class="space-y-2" data-testid="cloud-backup-list">
          <li
            v-for="backup in store.backups"
            :key="backup.uuid"
            class="rounded-2xl bg-white px-3 py-2"
            data-testid="cloud-backup-item"
          >
            <p class="text-sm font-medium text-ink-primary" data-testid="cloud-backup-item-date">
              {{ formatDate(backup.createdAt) }}
            </p>
            <p class="text-xs text-ink-secondary">Perangkat: {{ deviceLabel(backup) }}</p>
            <p class="text-xs text-ink-secondary">
              Ukuran: {{ formatSize(backup.sizeBytes) }} · Schema: v{{ backup.schemaVersion }}
            </p>
          </li>
        </ul>

        <p
          v-if="store.listStale"
          class="text-xs text-ink-secondary"
          data-testid="cloud-backup-stale"
        >
          Menampilkan daftar terakhir yang diketahui.
        </p>
      </div>
    </template>
  </div>
</template>
