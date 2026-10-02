<script setup>
import { computed, ref, watch } from 'vue'
import { useRouter } from 'vue-router'

import AppIcon from '@/components/base/AppIcon.vue'
import BaseButton from '@/components/base/BaseButton.vue'
import BaseCard from '@/components/base/BaseCard.vue'
import BaseModal from '@/components/base/BaseModal.vue'
import BaseSheet from '@/components/base/BaseSheet.vue'
import SettingsMenuItem from '@/components/settings/SettingsMenuItem.vue'
import CloudBackupPanel from '@/components/settings/CloudBackupPanel.vue'
import {
  RESTORE_CONFIRMATION_MESSAGE,
  createBackupPayload,
  downloadBackupFile,
  restoreBackupPayload,
  validateBackupPayload,
} from '@/services/backupService'
import {
  isNativePrinterPlatform,
  listPairedPrinters,
  printTestReceipt,
} from '@/services/printer/bluetoothPrinterService'
import { SUPPORTED_PAPER_WIDTHS } from '@/services/printer/escposReceiptBuilder'
import { useBusinessStore } from '@/stores/businessStore'
import { useCartStore } from '@/stores/cartStore'
import { useCashStore } from '@/stores/cashStore'
import { useCloudSessionStore } from '@/stores/cloudSessionStore'
import { useCustomerStore } from '@/stores/customerStore'
import { useExpenseStore } from '@/stores/expenseStore'
import { usePrinterStore } from '@/stores/printerStore'
import { useProductStore } from '@/stores/productStore'
import { useShiftStore } from '@/stores/shiftStore'
import { useSubscriptionStore } from '@/stores/subscriptionStore'
import { useSyncStatusStore } from '@/stores/syncStatusStore'
import { useTransactionStore } from '@/stores/transactionStore'
import { isValidTaxRate, useTaxStore } from '@/stores/taxStore'

const businessStore = useBusinessStore()
const cartStore = useCartStore()
const cashStore = useCashStore()
const cloudStore = useCloudSessionStore()
const customerStore = useCustomerStore()
const expenseStore = useExpenseStore()
const printerStore = usePrinterStore()
const productStore = useProductStore()
const shiftStore = useShiftStore()
const subscriptionStore = useSubscriptionStore()
const syncStatusStore = useSyncStatusStore()
const transactionStore = useTransactionStore()
const taxStore = useTaxStore()
const router = useRouter()

const taxDraftEnabled = ref(taxStore.enabled)
const taxDraftRate = ref(String(taxStore.rate))
const taxFeedback = ref('')
const taxRateValid = computed(() => !taxDraftEnabled.value || isValidTaxRate(taxDraftRate.value))
watch([taxDraftEnabled, taxDraftRate], () => {
  taxFeedback.value = ''
})
const taxPreview = computed(() => {
  if (!taxDraftEnabled.value || !taxRateValid.value) return 0
  return Math.round((100000 * Number(taxDraftRate.value)) / 100)
})

function saveTaxSettings() {
  const result = taxStore.setSettings({
    enabled: taxDraftEnabled.value,
    rate: taxDraftEnabled.value
      ? taxDraftRate.value
      : isValidTaxRate(taxDraftRate.value)
        ? taxDraftRate.value
        : taxStore.rate,
  })

  taxFeedback.value = result.success ? 'Pengaturan pajak berhasil disimpan.' : result.error
}

const lockedFeature = ref(null)
const showPrinterSheet = ref(false)
const backupInputRef = ref(null)
const feedbackType = ref('success')
const feedbackMessage = ref('')

const printerDevices = ref([])
const printerBusy = ref(false)
const printerFeedbackType = ref('success')
const printerFeedbackMessage = ref('')

const isNativePrinter = computed(() => isNativePrinterPlatform())
const paperWidths = SUPPORTED_PAPER_WIDTHS
const printerStatusText = computed(() =>
  printerStore.hasSelectedPrinter
    ? printerStore.selectedPrinter.name || printerStore.selectedPrinter.address
    : 'Belum memilih printer',
)

// ── Subscription / entitlement presentation ─────────────────────────────────

const subscriptionStatus = computed(() => subscriptionStore.status)
const isPremium = computed(() => subscriptionStore.isPremium)
const showCloudDetails = computed(
  () => isPremium.value || subscriptionStatus.value === 'unverified',
)
const showSubscriptionSkeleton = computed(
  () => subscriptionStore.isLoading && !subscriptionStore.entitlement.plan,
)

// Cloud access and the last sync run are separate signals; neither is derived
// from the subscription, so Premium alone never claims an active sync.
const cloudAccessLabel = computed(() => {
  if (cloudStore.isAuthenticated !== true) return 'Belum ada akun'
  return subscriptionStore.hasCloudAccess ? 'Aktif' : 'Tidak aktif'
})

const lastSyncLabel = computed(() => {
  const checkedAt = syncStatusStore.lastCheckedAt
  if (!checkedAt) return 'Belum ada riwayat'
  const date = new Date(checkedAt)
  if (Number.isNaN(date.getTime())) return 'Belum ada riwayat'
  return date.toLocaleString('id-ID', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
})

const expiresAtLabel = computed(() => {
  if (!subscriptionStore.expiresAt) return ''
  const date = new Date(subscriptionStore.expiresAt)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })
})

const subscriptionView = computed(() => {
  switch (subscriptionStatus.value) {
    case 'premium':
      return {
        badge: 'PREMIUM',
        subtitle: 'Kelola langganan dan sinkronisasi Anda.',
        cardClass: 'border-emerald-300 bg-gradient-to-br from-emerald-50 to-white',
        badgeClass: 'bg-emerald-100 text-emerald-700',
        crownClass: 'bg-emerald-100 text-emerald-600',
      }
    case 'expired':
      return {
        badge: 'EXPIRED',
        subtitle: 'Langganan Premium berakhir. Perbarui untuk mengaktifkan sinkronisasi cloud.',
        cardClass: 'border-red-200 bg-gradient-to-br from-red-50 to-white',
        badgeClass: 'bg-red-100 text-red-700',
        crownClass: 'bg-red-100 text-red-600',
      }
    case 'pending':
      return {
        badge: 'MENUNGGU',
        subtitle: 'Pembayaran langganan belum selesai. Selesaikan untuk mengaktifkan Premium.',
        cardClass: 'border-amber-300 bg-gradient-to-br from-amber-50 to-white',
        badgeClass: 'bg-amber-100 text-amber-700',
        crownClass: 'bg-amber-100 text-amber-600',
      }
    case 'unverified':
      return {
        badge: 'BELUM TERVERIFIKASI',
        subtitle: 'Data terakhir yang diketahui. Status langganan belum dikonfirmasi ulang.',
        cardClass: 'border-zinc-300 bg-gradient-to-br from-zinc-50 to-white',
        badgeClass: 'bg-zinc-200 text-zinc-700',
        crownClass: 'bg-zinc-100 text-zinc-500',
      }
    case 'error':
      return {
        badge: 'TIDAK DIKETAHUI',
        subtitle: 'Status langganan belum dapat dipastikan. Periksa koneksi lalu coba lagi.',
        cardClass: 'border-zinc-200 bg-white',
        badgeClass: 'bg-zinc-100 text-zinc-600',
        crownClass: 'bg-zinc-100 text-zinc-500',
      }
    default:
      return {
        badge: 'FREE',
        subtitle: 'Upgrade ke Premium untuk sinkronisasi data dan dashboard.',
        cardClass: 'border-amber-300 bg-gradient-to-br from-amber-50 to-white',
        badgeClass: 'bg-amber-100 text-amber-700',
        crownClass: 'bg-amber-100 text-amber-600',
      }
  }
})

const cloudAccountSubtitle = computed(() => {
  if (!cloudStore.isAuthenticated) return 'Belum terhubung'
  if (!cloudStore.isLinked) return 'Belum ada bisnis tertaut'
  return cloudStore.user?.email || cloudStore.selectedBusiness?.name || 'Terhubung'
})

// PREM-M03: Cloud link presentation (display only, never authorizes)
const cloudLinked = computed(() => cloudStore.isLinked)
const cloudAccount = computed(() => cloudStore.user?.email || '-')
const subscriptionEntryTitle = computed(() => (cloudLinked.value ? 'Langganan Saya' : 'Langganan'))

const cloudSubscriptionLabel = computed(() => {
  if (subscriptionStore.status === 'free') return 'Free'
  return subscriptionStore.planLabel || subscriptionStore.status
})

const cloudCheckedLabel = computed(() => {
  const checkedAt = cloudStore.contextCheckedAt
  if (!checkedAt) return 'Belum diperiksa ulang'
  const date = new Date(checkedAt)
  if (Number.isNaN(date.getTime())) return 'Belum diperiksa ulang'
  return date.toLocaleString('id-ID', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
})

const showDisconnectConfirm = ref(false)

function goToCloud() {
  lockedFeature.value = null
  router.push({ name: 'cloud' })
}

async function confirmDisconnect() {
  showDisconnectConfirm.value = false
  await cloudStore.logout()
}

function handleCloudLocked() {
  lockedFeature.value = { title: 'Backup Cloud' }
}

const settingsMenu = computed(() => [
  {
    key: 'cloud',
    icon: 'cloud',
    title: 'Akun Cloud',
    subtitle: cloudAccountSubtitle.value,
    testid: 'settings-menu-cloud',
    to: { name: 'cloud' },
  },
  {
    key: 'customers',
    icon: 'customers',
    title: 'Kelola Pelanggan',
    subtitle: 'Data pelanggan dan riwayat',
    testid: 'settings-menu-customers',
    to: { name: 'customers' },
  },
  {
    key: 'expenses',
    icon: 'expenses',
    title: 'Kelola Pengeluaran',
    subtitle: 'Biaya operasional toko',
    testid: 'settings-menu-expenses',
    to: { name: 'expenses' },
  },
  {
    key: 'backup',
    icon: 'backup',
    title: 'Backup Data',
    subtitle: 'Simpan salinan data ke file lokal',
    testid: 'settings-menu-backup',
    action: 'backup',
  },
  {
    key: 'restore',
    icon: 'restore',
    title: 'Restore Backup',
    subtitle: 'Pulihkan data dari file backup',
    testid: 'settings-menu-restore',
    action: 'restore',
  },
  {
    key: 'sync',
    icon: 'sync',
    title: 'Sinkronisasi',
    subtitle: isPremium.value ? 'Sinkronkan data ke cloud' : 'Memerlukan Premium',
    testid: 'settings-menu-sync',
    locked: !isPremium.value,
    to: { name: 'cloud' },
  },
])

const lockedFeatureMessage = computed(() => {
  const label = lockedFeature.value?.title ?? 'Fitur ini'
  return `${label} memerlukan langganan Premium untuk menyinkronkan data antar perangkat.`
})

function goToSubscription() {
  lockedFeature.value = null
  router.push({ name: cloudLinked.value ? 'my-subscription' : 'subscription' })
}

function handleBack() {
  router.back()
}

function handleMenuSelect(item) {
  if (item.locked) {
    lockedFeature.value = item
    return
  }

  if (item.action === 'backup') {
    handleBackup()
    return
  }

  if (item.action === 'restore') {
    handleRestoreClick()
    return
  }

  if (item.to) {
    router.push(item.to)
  }
}

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

function setFeedback(type, message) {
  feedbackType.value = type
  feedbackMessage.value = message
}

function setPrinterFeedback(type, message) {
  printerFeedbackType.value = type
  printerFeedbackMessage.value = message
}

function buildBusinessSnapshot() {
  return {
    name: businessStore.name || '-',
    outlet: businessStore.outlet || '-',
    phone: businessStore.phone || '',
  }
}

// Permission/Bluetooth errors are requested here (not at startup).
async function handleSelectPrinterClick() {
  printerBusy.value = true
  setPrinterFeedback('success', '')

  try {
    const result = await listPairedPrinters()

    if (!result.success) {
      printerDevices.value = []
      setPrinterFeedback('error', result.message)
      return
    }

    if (!result.native) {
      printerDevices.value = []
      setPrinterFeedback('error', 'Pilih printer hanya tersedia di perangkat Android.')
      return
    }

    printerDevices.value = result.devices
    showPrinterSheet.value = true

    if (!result.devices.length) {
      setPrinterFeedback('error', 'Tidak ada printer Bluetooth yang sudah dipairing.')
    }
  } finally {
    printerBusy.value = false
  }
}

function handlePrinterSelected(device) {
  printerStore.selectPrinter(device)
  showPrinterSheet.value = false
  setPrinterFeedback('success', `Printer ${device.name || device.address} dipilih.`)
}

function handlePaperWidthChange(width) {
  printerStore.setPaperWidth(width)
}

function handleForgetPrinter() {
  printerStore.clearPrinter()
  setPrinterFeedback('success', 'Printer dilupakan.')
}

async function handleTestPrint() {
  if (!printerStore.hasSelectedPrinter) {
    setPrinterFeedback('error', 'Printer Bluetooth belum dipilih.')
    return
  }

  printerBusy.value = true

  try {
    const result = await printTestReceipt({
      printer: printerStore.selectedPrinter,
      paperWidth: printerStore.paperWidth,
      business: buildBusinessSnapshot(),
    })

    if (!result.success) {
      setPrinterFeedback('error', result.message)
      return
    }

    setPrinterFeedback('success', 'Perintah tes print dikirim ke printer.')
  } finally {
    printerBusy.value = false
  }
}

function handleBackup() {
  const payload = createBackupPayload(getStoreContext())
  downloadBackupFile(payload)
  setFeedback('success', 'Backup berhasil dibuat.')
}

function handleRestoreClick() {
  if (shiftStore.isOpen) {
    setFeedback(
      'error',
      'Restore backup tidak dapat dilakukan saat shift aktif. Tutup shift terlebih dahulu.',
    )
    return
  }

  backupInputRef.value?.click()
}

async function handleRestoreFileChange(event) {
  const input = event.target
  const [file] = input.files ?? []

  if (!file) {
    input.value = ''
    return
  }

  try {
    const text = await file.text()
    let payload

    try {
      payload = JSON.parse(text)
    } catch {
      setFeedback('error', 'File backup tidak valid.')
      return
    }

    const validation = validateBackupPayload(payload)

    if (!validation.valid) {
      setFeedback('error', validation.error)
      return
    }

    if (!window.confirm(RESTORE_CONFIRMATION_MESSAGE)) {
      return
    }

    const result = restoreBackupPayload(payload, getStoreContext())

    if (!result.success) {
      setFeedback('error', result.error)
      return
    }

    setFeedback('success', 'Backup berhasil dipulihkan.')
  } finally {
    input.value = ''
  }
}
</script>

<template>
  <div class="mx-auto max-w-3xl space-y-5">
    <input
      ref="backupInputRef"
      class="hidden"
      type="file"
      accept=".json,application/json"
      @change="handleRestoreFileChange"
    />

    <div class="flex items-center gap-3">
      <button
        type="button"
        data-testid="settings-back-btn"
        class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-zinc-200 bg-white text-ink-primary transition active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
        aria-label="Kembali"
        @click="handleBack"
      >
        <AppIcon name="chevron-left" />
      </button>
      <div class="min-w-0">
        <p class="text-xs font-medium uppercase tracking-[0.18em] text-primary">Pengaturan</p>
        <h2 class="truncate text-2xl font-semibold text-ink-primary">Pengaturan aplikasi</h2>
      </div>
    </div>

    <!-- Active business -->
    <BaseCard v-if="businessStore.name" class="space-y-3" data-testid="active-business-card">
      <div class="flex items-center gap-3">
        <span
          class="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary"
        >
          <AppIcon name="store" />
        </span>
        <div class="min-w-0">
          <p class="text-xs uppercase tracking-[0.16em] text-ink-secondary">Bisnis Aktif</p>
          <h3 class="truncate text-base font-semibold text-ink-primary" data-testid="business-name">
            {{ businessStore.name }}
          </h3>
        </div>
      </div>
      <div class="flex flex-wrap gap-2">
        <span
          class="inline-flex items-center rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary"
          data-testid="business-type"
        >
          {{ businessStore.normalizedType || '-' }}
        </span>
        <span
          class="inline-flex items-center rounded-full bg-surface px-3 py-1 text-xs font-medium text-ink-secondary"
          data-testid="business-outlet"
        >
          {{ businessStore.outlet || '-' }}
        </span>
      </div>
    </BaseCard>

    <div
      v-else
      class="animate-pulse rounded-3xl border border-zinc-200 bg-white p-4"
      data-testid="active-business-skeleton"
    >
      <div class="flex items-center gap-3">
        <div class="h-11 w-11 rounded-2xl bg-zinc-100" />
        <div class="flex-1 space-y-2">
          <div class="h-3 w-24 rounded bg-zinc-100" />
          <div class="h-3 w-40 rounded bg-zinc-100" />
        </div>
      </div>
    </div>

    <!-- Cloud account (PREM-M03) -->
    <BaseCard class="space-y-3" data-testid="cloud-account-card">
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-3">
          <span
            class="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary"
          >
            <AppIcon name="cloud" />
          </span>
          <div class="min-w-0">
            <p class="text-xs uppercase tracking-[0.16em] text-ink-secondary">Akun Cloud</p>
            <h3
              class="truncate text-base font-semibold text-ink-primary"
              data-testid="cloud-account-status"
            >
              {{ cloudLinked ? 'Terhubung' : 'Belum terhubung' }}
            </h3>
          </div>
        </div>
        <span
          class="rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide"
          :class="cloudLinked ? 'bg-emerald-100 text-emerald-700' : 'bg-zinc-100 text-zinc-600'"
          data-testid="cloud-account-badge"
        >
          {{ cloudLinked ? 'Cloud' : 'Lokal' }}
        </span>
      </div>

      <dl v-if="cloudLinked" class="space-y-1 text-xs text-ink-secondary">
        <div class="flex items-center justify-between">
          <dt>Akun</dt>
          <dd class="font-medium text-ink-primary" data-testid="cloud-account-email">
            {{ cloudAccount }}
          </dd>
        </div>
        <div class="flex items-center justify-between">
          <dt>Bisnis Cloud</dt>
          <dd class="font-medium text-ink-primary" data-testid="cloud-account-business">
            {{ cloudStore.selectedBusiness?.name ?? '-' }}
          </dd>
        </div>
        <div class="flex items-center justify-between">
          <dt>Subscription</dt>
          <dd class="font-medium text-ink-primary" data-testid="cloud-account-subscription">
            {{ cloudSubscriptionLabel }}
          </dd>
        </div>
        <div class="flex items-center justify-between">
          <dt>Status diperiksa</dt>
          <dd class="font-medium text-ink-primary" data-testid="cloud-account-checked">
            {{ cloudCheckedLabel }}
          </dd>
        </div>
      </dl>

      <p v-else class="text-xs text-ink-secondary">
        Hubungkan POS ini dengan akun Cloud dan Dashboard. POS tetap dapat digunakan tanpa Cloud.
      </p>

      <div class="flex flex-wrap gap-2">
        <BaseButton
          v-if="!cloudLinked"
          size="sm"
          data-testid="cloud-login-entry"
          @click="goToCloud"
        >
          Masuk ke Cloud
        </BaseButton>
        <template v-else>
          <BaseButton
            size="sm"
            variant="secondary"
            data-testid="settings-my-subscription-entry"
            @click="goToSubscription"
          >
            Langganan Saya
          </BaseButton>
          <BaseButton
            size="sm"
            variant="danger"
            data-testid="cloud-disconnect"
            @click="showDisconnectConfirm = true"
          >
            Putuskan Cloud
          </BaseButton>
        </template>
      </div>
    </BaseCard>

    <!-- Subscription -->
    <div
      v-if="showSubscriptionSkeleton"
      class="animate-pulse rounded-3xl border border-zinc-200 bg-white p-4"
      data-testid="subscription-skeleton"
    >
      <div class="flex items-center gap-3">
        <div class="h-11 w-11 rounded-2xl bg-zinc-100" />
        <div class="flex-1 space-y-2">
          <div class="h-3 w-20 rounded bg-zinc-100" />
          <div class="h-3 w-52 rounded bg-zinc-100" />
        </div>
      </div>
    </div>

    <button
      v-else
      type="button"
      data-testid="subscription-card"
      class="w-full rounded-3xl border-2 p-4 text-left shadow-soft transition active:scale-[0.99] focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
      :class="subscriptionView.cardClass"
      aria-label="Kelola langganan"
      @click="goToSubscription"
    >
      <div class="flex items-center gap-3">
        <span
          class="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl"
          :class="subscriptionView.crownClass"
        >
          <AppIcon name="crown" />
        </span>

        <div class="min-w-0 flex-1">
          <div class="flex flex-wrap items-center gap-2">
            <span class="text-sm font-semibold text-ink-primary">{{ subscriptionEntryTitle }}</span>
            <span
              class="rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide"
              :class="subscriptionView.badgeClass"
              data-testid="subscription-badge"
            >
              {{ subscriptionView.badge }}
            </span>
          </div>

          <p
            class="mt-1 text-xs leading-relaxed text-ink-secondary"
            data-testid="subscription-subtitle"
          >
            {{ subscriptionView.subtitle }}
          </p>

          <p
            v-if="isPremium"
            class="mt-1 text-xs font-semibold text-emerald-700"
            data-testid="subscription-plan"
          >
            Paket {{ subscriptionStore.planLabel }}
          </p>

          <p
            v-if="isPremium && expiresAtLabel"
            class="text-xs text-ink-secondary"
            data-testid="subscription-expiry"
          >
            Berakhir pada {{ expiresAtLabel }}
          </p>

          <p
            v-if="subscriptionStatus === 'unverified' && subscriptionStore.entitlement.plan"
            class="mt-1 text-xs text-ink-secondary"
            data-testid="subscription-last-known-plan"
          >
            Paket terakhir: {{ subscriptionStore.planLabel }}
          </p>

          <div v-if="showCloudDetails" class="mt-2 space-y-0.5">
            <p class="text-xs text-ink-secondary" data-testid="cloud-access-status">
              Akses cloud: <span class="font-medium text-ink-primary">{{ cloudAccessLabel }}</span>
            </p>
            <p class="text-xs text-ink-secondary" data-testid="last-sync-status">
              Status diperiksa:
              <span class="font-medium text-ink-primary">{{ lastSyncLabel }}</span>
            </p>
          </div>
        </div>

        <AppIcon name="chevron-right" class="text-ink-secondary" />
      </div>
    </button>

    <!-- Settings menu -->
    <BaseCard class="space-y-1" data-testid="settings-menu">
      <SettingsMenuItem
        v-for="item in settingsMenu"
        :key="item.key"
        :icon="item.icon"
        :title="item.title"
        :subtitle="item.subtitle"
        :testid="item.testid"
        :locked="item.locked"
        @select="handleMenuSelect(item)"
      />
    </BaseCard>

    <!-- Backup data: local (free) vs cloud (premium) -->
    <BaseCard class="space-y-5" data-testid="backup-card">
      <div>
        <h3 class="text-lg font-semibold text-ink-primary">Backup Data</h3>
        <p class="mt-1 text-sm text-ink-secondary">
          Simpan salinan data POS Anda. Backup Lokal tetap gratis; Backup Cloud memerlukan Premium.
        </p>
      </div>

      <div
        class="space-y-3 rounded-3xl border border-zinc-200 bg-surface/60 p-4"
        data-testid="local-backup-section"
      >
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-3">
            <span
              class="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary"
            >
              <AppIcon name="backup" />
            </span>
            <div class="min-w-0">
              <h4 class="text-base font-semibold text-ink-primary">Backup Lokal</h4>
              <p class="text-xs text-ink-secondary">Backup data ke perangkat ini.</p>
            </div>
          </div>
          <span
            class="rounded-full bg-emerald-100 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-emerald-700"
          >
            Gratis
          </span>
        </div>

        <BaseButton data-testid="local-backup-now" @click="handleBackup">
          Buat Backup Lokal
        </BaseButton>
      </div>

      <CloudBackupPanel @locked="handleCloudLocked" />
    </BaseCard>

    <p
      v-if="feedbackMessage"
      class="rounded-2xl px-4 py-3 text-sm"
      :class="
        feedbackType === 'error' ? 'bg-danger/10 text-danger' : 'bg-emerald-100 text-emerald-700'
      "
      role="status"
      data-testid="settings-feedback"
    >
      {{ feedbackMessage }}
    </p>

    <BaseCard class="space-y-5" data-testid="tax-settings-card">
      <div>
        <h3 class="text-lg font-semibold text-ink-primary">Pengaturan Pajak</h3>
        <p class="mt-1 text-sm text-ink-secondary">
          Atur pajak untuk transaksi POS berikutnya. Transaksi sebelumnya tidak berubah.
        </p>
      </div>

      <form class="space-y-5" @submit.prevent="saveTaxSettings">
        <label
          class="flex cursor-pointer items-center justify-between gap-4 rounded-2xl bg-surface px-4 py-4"
        >
          <span>
            <span class="block text-sm font-semibold text-ink-primary">Aktifkan pajak</span>
            <span class="mt-1 block text-xs leading-relaxed text-ink-secondary"
              >Nonaktifkan untuk transaksi tanpa pajak.</span
            >
          </span>
          <input
            v-model="taxDraftEnabled"
            data-testid="tax-enabled-switch"
            type="checkbox"
            role="switch"
            :aria-checked="taxDraftEnabled"
            class="size-5 shrink-0 accent-primary"
          />
        </label>

        <div class="space-y-2">
          <label for="tax-rate-input" class="block text-sm font-medium text-ink-primary"
            >Persentase pajak</label
          >
          <div class="relative">
            <input
              id="tax-rate-input"
              v-model="taxDraftRate"
              data-testid="tax-rate-input"
              type="number"
              min="0"
              max="100"
              step="0.01"
              inputmode="decimal"
              :disabled="!taxDraftEnabled"
              :aria-invalid="taxDraftEnabled && !taxRateValid"
              aria-describedby="tax-rate-help"
              class="h-12 w-full rounded-2xl border border-zinc-200 bg-white px-4 pr-10 text-sm text-ink-primary outline-none transition focus:border-primary focus:ring-4 focus:ring-primary/10 disabled:bg-zinc-100 disabled:text-zinc-500"
            />
            <span
              class="pointer-events-none absolute right-4 top-3.5 text-sm font-medium text-ink-secondary"
              >%</span
            >
          </div>
          <p id="tax-rate-help" class="text-xs text-ink-secondary">
            Isi angka 0–100 dengan maksimal 2 angka desimal.
          </p>
          <p
            v-if="taxDraftEnabled && !taxRateValid"
            class="text-xs font-medium text-danger"
            data-testid="tax-validation-error"
          >
            Persentase pajak tidak valid.
          </p>
        </div>

        <div class="rounded-2xl border border-primary/10 bg-primary/5 p-4">
          <p class="text-xs font-semibold uppercase tracking-widest text-primary">
            Simulasi transaksi
          </p>
          <div class="mt-3 flex items-center justify-between text-sm">
            <span class="text-ink-secondary">Subtotal</span>
            <span class="font-medium text-ink-primary">Rp 100.000</span>
          </div>
          <div v-if="taxDraftEnabled" class="mt-2 flex items-center justify-between gap-3 text-sm">
            <span class="text-ink-secondary">Pajak ({{ taxDraftRate || '0' }}%)</span>
            <span class="font-medium text-ink-primary">{{
              taxRateValid ? `Rp ${taxPreview.toLocaleString('id-ID')}` : '—'
            }}</span>
          </div>
          <div
            class="mt-3 flex items-center justify-between border-t border-primary/10 pt-3 text-sm font-semibold"
          >
            <span>Total</span>
            <span data-testid="tax-preview-total">{{
              taxRateValid ? `Rp ${(100000 + taxPreview).toLocaleString('id-ID')}` : '—'
            }}</span>
          </div>
        </div>

        <div class="flex flex-wrap items-center gap-3">
          <BaseButton type="submit" data-testid="save-tax-settings" :disabled="!taxRateValid">
            Simpan Pengaturan
          </BaseButton>
          <span
            v-if="taxFeedback"
            class="text-xs text-ink-secondary"
            role="status"
            data-testid="tax-feedback"
          >
            {{ taxFeedback }}
          </span>
        </div>
      </form>
    </BaseCard>

    <BaseCard class="space-y-4" data-testid="printer-settings-card">
      <div class="flex items-center justify-between">
        <h3 class="text-base font-semibold text-ink-primary">Printer Bluetooth</h3>
        <span class="text-xs text-ink-secondary">Android</span>
      </div>

      <div class="rounded-2xl bg-surface px-4 py-3">
        <p class="text-xs text-ink-secondary">Status</p>
        <p class="text-sm font-medium text-ink-primary" data-testid="printer-status">
          {{ printerStatusText }}
        </p>
        <p
          v-if="printerStore.hasSelectedPrinter"
          class="text-xs text-ink-secondary"
          data-testid="printer-address"
        >
          {{ printerStore.selectedPrinter.address }}
        </p>
      </div>

      <div>
        <p class="text-xs font-medium text-ink-secondary">Paper</p>
        <div class="mt-2 grid grid-cols-2 gap-2">
          <button
            v-for="width in paperWidths"
            :key="width"
            type="button"
            :data-testid="`paper-width-${width}`"
            class="h-12 rounded-2xl border text-sm font-semibold transition"
            :class="
              printerStore.paperWidth === width
                ? 'border-primary bg-primary/10 text-primary'
                : 'border-zinc-200 bg-white text-ink-secondary'
            "
            @click="handlePaperWidthChange(width)"
          >
            {{ width }} mm
          </button>
        </div>
      </div>

      <p
        v-if="printerFeedbackMessage"
        class="rounded-2xl px-4 py-3 text-sm"
        :class="
          printerFeedbackType === 'error'
            ? 'bg-danger/10 text-danger'
            : 'bg-emerald-100 text-emerald-700'
        "
        data-testid="printer-feedback"
      >
        {{ printerFeedbackMessage }}
      </p>

      <div class="flex flex-wrap gap-3">
        <BaseButton
          variant="secondary"
          :disabled="printerBusy"
          data-testid="btn-select-printer"
          @click="handleSelectPrinterClick"
        >
          Pilih Printer
        </BaseButton>
        <BaseButton
          variant="secondary"
          :disabled="printerBusy || !printerStore.hasSelectedPrinter || !isNativePrinter"
          data-testid="btn-test-print"
          @click="handleTestPrint"
        >
          Tes Print
        </BaseButton>
        <BaseButton
          variant="ghost"
          :disabled="!printerStore.hasSelectedPrinter"
          data-testid="btn-forget-printer"
          @click="handleForgetPrinter"
        >
          Lupakan Printer
        </BaseButton>
      </div>

      <p v-if="!isNativePrinter" class="text-xs text-ink-secondary">
        Tes print Bluetooth hanya tersedia di perangkat Android.
      </p>
    </BaseCard>

    <BaseButton block variant="secondary" data-testid="settings-close-btn" @click="handleBack">
      Tutup
    </BaseButton>

    <BaseModal :open="Boolean(lockedFeature)" title="Fitur Premium" @close="lockedFeature = null">
      <div class="space-y-4" data-testid="locked-feature-modal">
        <div class="flex items-center gap-3">
          <span
            class="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-amber-100 text-amber-600"
          >
            <AppIcon name="lock" />
          </span>
          <p class="text-sm text-ink-secondary" data-testid="locked-feature-message">
            {{ lockedFeatureMessage }}
          </p>
        </div>

        <BaseButton block data-testid="locked-feature-cta" @click="goToSubscription">
          Lihat Paket Premium
        </BaseButton>
      </div>
    </BaseModal>

    <BaseSheet
      :open="showPrinterSheet"
      title="Pilih Printer Bluetooth"
      @close="showPrinterSheet = false"
    >
      <div class="grid gap-2">
        <template v-if="printerDevices.length">
          <button
            v-for="device in printerDevices"
            :key="device.address"
            type="button"
            :data-testid="`printer-device-${device.address}`"
            class="flex min-h-12 w-full flex-col items-start justify-center rounded-2xl border border-zinc-200 px-4 py-2 text-left transition active:bg-zinc-100"
            @click="handlePrinterSelected(device)"
          >
            <span class="text-sm font-semibold text-ink-primary">{{
              device.name || 'Tanpa nama'
            }}</span>
            <span class="text-xs text-ink-secondary">{{ device.address }}</span>
          </button>
        </template>

        <template v-else>
          <p class="text-sm text-ink-secondary" data-testid="printer-empty-message">
            Tidak ada printer Bluetooth yang sudah dipairing.
          </p>
          <p class="text-sm text-ink-secondary">
            Pair printer melalui pengaturan Bluetooth Android terlebih dahulu.
          </p>
        </template>
      </div>
    </BaseSheet>

    <BaseModal
      :open="showDisconnectConfirm"
      title="Putuskan Cloud"
      @close="showDisconnectConfirm = false"
    >
      <div class="space-y-4" data-testid="settings-disconnect-modal">
        <p class="text-sm text-ink-secondary">
          Sesi Cloud akan diputuskan dari POS ini. Data lokal (produk, transaksi, pelanggan, kas,
          dan pengaturan) tidak akan dihapus.
        </p>
        <div class="flex flex-wrap gap-2">
          <BaseButton
            variant="danger"
            data-testid="settings-disconnect-confirm"
            @click="confirmDisconnect"
          >
            Ya, Putuskan
          </BaseButton>
          <BaseButton
            variant="ghost"
            data-testid="settings-disconnect-cancel"
            @click="showDisconnectConfirm = false"
          >
            Batal
          </BaseButton>
        </div>
      </div>
    </BaseModal>
  </div>
</template>
