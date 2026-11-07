<script setup>
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import AppIcon from '@/components/base/AppIcon.vue'
import BaseButton from '@/components/base/BaseButton.vue'
import BaseCard from '@/components/base/BaseCard.vue'
import BaseModal from '@/components/base/BaseModal.vue'
import BaseSheet from '@/components/base/BaseSheet.vue'
import NexaPosLogo from '@/components/base/NexaPosLogo.vue'
import { useSyncAccess } from '@/composables/useSyncAccess'
import { APP_VERSION } from '@/constants/appInfo'
import SettingsMenuItem from '@/components/settings/SettingsMenuItem.vue'
import SettingsSection from '@/components/settings/SettingsSection.vue'
import ReceiptSettingsPanel from '@/components/settings/ReceiptSettingsPanel.vue'
import CloudBackupPanel from '@/components/settings/CloudBackupPanel.vue'
import LocalDataExportPanel from '@/components/settings/LocalDataExportPanel.vue'
import { clearLocalCache } from '@/services/localCacheService'
import { saveOrShareJsonBackup } from '@/services/dataExportService'
import { apiRequest } from '@/services/cloud/apiClient'
import {
  RESTORE_CONFIRMATION_MESSAGE,
  createBackupPayload,
  validateBackupPayload,
} from '@/services/backupService'
import { RESTORE_MODE, getActiveRestoreSafetyEngine } from '@/services/restoreSafetyEngine'
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
import { useReceiptStore } from '@/stores/receiptStore'
import { useProductStore } from '@/stores/productStore'
import { useShiftStore } from '@/stores/shiftStore'
import { useSubscriptionStore } from '@/stores/subscriptionStore'
import { useSyncStatusStore } from '@/stores/syncStatusStore'
import { useSyncPullStore } from '@/stores/syncPullStore'
import { useSyncContextGuardStore } from '@/stores/syncContextGuardStore'
import { useThemeStore } from '@/stores/themeStore'
import { useTransactionStore } from '@/stores/transactionStore'
import { isValidTaxRate, useTaxStore } from '@/stores/taxStore'

const businessStore = useBusinessStore()
const cartStore = useCartStore()
const cashStore = useCashStore()
const cloudStore = useCloudSessionStore()
const customerStore = useCustomerStore()
const expenseStore = useExpenseStore()
const printerStore = usePrinterStore()
const receiptStore = useReceiptStore()
const productStore = useProductStore()
const shiftStore = useShiftStore()
const subscriptionStore = useSubscriptionStore()
const syncStatusStore = useSyncStatusStore()
const syncPullStore = useSyncPullStore()
const syncContextGuardStore = useSyncContextGuardStore()
const themeStore = useThemeStore()
const transactionStore = useTransactionStore()
const taxStore = useTaxStore()
const { isSyncLocked, isSyncUnlocked } = useSyncAccess()
const route = useRoute()
const router = useRouter()

const taxDraftEnabled = ref(taxStore.enabled)
const taxDraftRate = ref(String(taxStore.rate))
const taxFeedback = ref('')
const taxRateValid = computed(() => !taxDraftEnabled.value || isValidTaxRate(taxDraftRate.value))
watch([taxDraftEnabled, taxDraftRate], () => {
  taxFeedback.value = ''
})
watch(() => [taxStore.enabled, taxStore.rate], ([newEnabled, newRate]) => {
  if (taxDraftEnabled.value !== newEnabled) {
    taxDraftEnabled.value = newEnabled
  }
  if (Number(taxDraftRate.value) !== Number(newRate)) {
    taxDraftRate.value = String(newRate)
  }
})
const taxPreview = computed(() => {
  if (!taxDraftEnabled.value || !taxRateValid.value) return 0
  return Math.round((100000 * Number(taxDraftRate.value)) / 100)
})

async function saveTaxSettings() {
  if (isCashier.value) {
    taxFeedback.value = 'Kasir tidak dapat mengubah pengaturan pajak.'
    return
  }

  const result = taxStore.setSettings({
    enabled: taxDraftEnabled.value,
    rate: taxDraftEnabled.value
      ? taxDraftRate.value
      : isValidTaxRate(taxDraftRate.value)
        ? taxDraftRate.value
        : taxStore.rate,
  })

  taxFeedback.value = result.success ? 'Pengaturan pajak berhasil disimpan.' : result.error

  if (result.success && cloudStore.isLinked && cloudStore.selectedBusiness?.id) {
    try {
      await apiRequest(`/api/mobile/businesses/${cloudStore.selectedBusiness.id}/tax-settings`, {
        method: 'PATCH',
        body: {
          tax_enabled: taxStore.enabled,
          tax_rate: taxStore.rate,
        },
      })
    } catch {
      // offline fallback: locally persisted
    }
  }
}

const VALID_SETTINGS_SECTIONS = new Set([
  'appearance',
  'tax',
  'printer',
  'receipt',
  'cloud',
  'data',
])

const activeSection = ref(
  typeof route?.query?.section === 'string' && VALID_SETTINGS_SECTIONS.has(route.query.section)
    ? route.query.section
    : null,
)

watch(
  () => route?.query?.section,
  (section) => {
    if (typeof section === 'string' && VALID_SETTINGS_SECTIONS.has(section)) {
      activeSection.value = section
    }
  },
)

function toggleSection(section) {
  activeSection.value = activeSection.value === section ? null : section
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
        cardClass:
          'border-emerald-300/90 bg-gradient-to-br from-emerald-50 via-white to-white dark:border-emerald-500/35 dark:from-emerald-950/55 dark:via-[#171C2B] dark:to-[#171C2B]',
        badgeClass: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300',
        crownClass: 'bg-emerald-100 text-emerald-600 dark:bg-emerald-500/20 dark:text-emerald-300',
      }
    case 'expired':
      return {
        badge: 'EXPIRED',
        subtitle: 'Langganan Premium berakhir. Perbarui untuk mengaktifkan sinkronisasi cloud.',
        cardClass:
          'border-red-200 bg-gradient-to-br from-red-50 via-white to-white dark:border-rose-500/35 dark:from-rose-950/50 dark:via-[#171C2B] dark:to-[#171C2B]',
        badgeClass: 'bg-red-100 text-red-700 dark:bg-rose-500/20 dark:text-rose-300',
        crownClass: 'bg-red-100 text-red-600 dark:bg-rose-500/20 dark:text-rose-300',
      }
    case 'pending':
      return {
        badge: 'MENUNGGU',
        subtitle: 'Pembayaran langganan belum selesai. Selesaikan untuk mengaktifkan Premium.',
        cardClass:
          'border-amber-300/90 bg-gradient-to-br from-amber-50 via-white to-white dark:border-amber-500/35 dark:from-amber-950/45 dark:via-[#171C2B] dark:to-[#171C2B]',
        badgeClass: 'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300',
        crownClass: 'bg-amber-100 text-amber-600 dark:bg-amber-500/20 dark:text-amber-300',
      }
    case 'unverified':
      return {
        badge: 'BELUM TERVERIFIKASI',
        subtitle: 'Data terakhir yang diketahui. Status langganan belum dikonfirmasi ulang.',
        cardClass:
          'border-zinc-300 bg-gradient-to-br from-zinc-50 via-white to-white dark:border-slate-700/80 dark:from-slate-800/55 dark:via-[#171C2B] dark:to-[#171C2B]',
        badgeClass: 'bg-zinc-200 text-zinc-700 dark:bg-slate-700/70 dark:text-slate-200',
        crownClass: 'bg-zinc-100 text-zinc-500 dark:bg-slate-800 dark:text-slate-300',
      }
    case 'error':
      return {
        badge: 'TIDAK DIKETAHUI',
        subtitle: 'Status langganan belum dapat dipastikan. Periksa koneksi lalu coba lagi.',
        cardClass: 'border-zinc-200 bg-card dark:border-slate-700/80',
        badgeClass: 'bg-zinc-100 text-zinc-600 dark:bg-slate-800 dark:text-slate-300',
        crownClass: 'bg-zinc-100 text-zinc-500 dark:bg-slate-800 dark:text-slate-300',
      }
    default:
      return {
        badge: 'FREE',
        subtitle: 'Upgrade ke Premium untuk sinkronisasi data dan dashboard.',
        cardClass:
          'border-amber-300/90 bg-gradient-to-br from-amber-50 via-white to-white dark:border-amber-500/35 dark:from-amber-950/45 dark:via-[#171C2B] dark:to-[#171C2B]',
        badgeClass: 'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300',
        crownClass: 'bg-amber-100 text-amber-600 dark:bg-amber-500/20 dark:text-amber-300',
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
const isCashier = computed(
  () => cloudStore.role === 'cashier' || cloudStore.isCashierContext === true,
)
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
const showClearCacheConfirm = ref(false)
const isClearingCache = ref(false)

function goToCloud() {
  lockedFeature.value = null
  router.push({ name: 'cloud' })
}

async function confirmDisconnect() {
  showDisconnectConfirm.value = false
  await clearLocalCache({
    adapter: cloudStore.adapter,
    scheduler: cloudStore.scheduler,
    resetBusiness: true,
  })
  await cloudStore.logout()
  setFeedback('success', 'Akun Cloud berhasil diputuskan dan data cache lokal telah dibersihkan.')
}

async function handleClearCache() {
  isClearingCache.value = true
  try {
    await clearLocalCache({
      adapter: cloudStore.adapter,
      scheduler: cloudStore.scheduler,
      resetBusiness: false,
    })
    showClearCacheConfirm.value = false
    setFeedback('success', 'Data cache lokal berhasil dibersihkan.')

    if (cloudStore.isLinked && cloudStore.isOperationalCloudAccess) {
      try {
        await syncContextGuardStore.check()
        const pullRes = await syncPullStore.pullNow({ initialCloudRead: true })
        if (pullRes.ok) {
          setFeedback(
            'success',
            'Data cache dibersihkan dan menu produk Cloud berhasil dimuat ulang!',
          )
        }
      } catch (pullErr) {
        console.warn('Auto-pull after clear cache error:', pullErr)
      }
    }
  } catch (err) {
    setFeedback('error', 'Gagal menghapus data cache: ' + (err?.message || err))
  } finally {
    isClearingCache.value = false
  }
}

function handleCloudLocked() {
  lockedFeature.value = { title: 'Backup Cloud' }
}

const lockedFeatureMessage = computed(() => {
  const label = lockedFeature.value?.title ?? 'Fitur ini'
  if (!cloudStore.isAuthenticated) {
    return `${label} terkunci karena Anda belum login Akun Cloud dan masih menggunakan paket Free (memerlukan Premium).`
  }
  return `${label} memerlukan langganan Premium untuk menyinkronkan data antar perangkat.`
})

function goToSubscription() {
  if (isCashier.value) return
  lockedFeature.value = null
  router.push({ name: cloudLinked.value ? 'my-subscription' : 'subscription' })
}

function handleBack() {
  router.back()
}

function handleSyncSelect() {
  if (isSyncLocked.value) {
    lockedFeature.value = { title: 'Sinkronisasi' }
    return
  }
  router.push({ name: 'sync' })
}

function getStoreContext() {
  return {
    businessStore,
    taxStore,
    receiptStore,
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
      receiptSettings: receiptStore.$state,
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

async function handleBackup() {
  try {
    const payload = createBackupPayload(getStoreContext())
    await saveOrShareJsonBackup(payload)
    setFeedback('success', 'Backup berhasil dibuat.')
  } catch (err) {
    setFeedback('error', `Gagal membuat file backup: ${err?.message || err}`)
  }
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

    const restoreSafetyEngine = getActiveRestoreSafetyEngine()
    if (!restoreSafetyEngine) {
      setFeedback('error', 'Restore aman belum siap. Tutup dan buka kembali aplikasi.')
      return
    }

    const result = await restoreSafetyEngine.restore({
      payload,
      mode: RESTORE_MODE.SAME_DEVICE,
      confirmed: true,
    })

    if (!result.success) {
      setFeedback('error', result.error || 'Restore backup dibatalkan oleh safety engine.')
      return
    }

    setFeedback('success', 'Backup berhasil dipulihkan.')
  } finally {
    input.value = ''
  }
}
</script>

<template>
  <div class="mx-auto max-w-2xl space-y-4">
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
        class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-zinc-200 bg-card text-ink-primary transition active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
        aria-label="Kembali"
        @click="handleBack"
      >
        <AppIcon name="chevron-left" />
      </button>
      <div class="min-w-0">
        <h2 class="truncate text-2xl font-semibold text-ink-primary">Pengaturan</h2>
      </div>
    </div>

    <BaseCard v-if="businessStore.name" data-testid="active-business-card">
      <div class="flex items-center gap-3">
        <span
          class="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary"
        >
          <AppIcon name="store" />
        </span>
        <div class="min-w-0 flex-1">
          <h3 class="truncate text-sm font-semibold text-ink-primary" data-testid="business-name">
            {{ businessStore.name }}
          </h3>
          <p class="mt-1 flex min-w-0 gap-1 text-xs text-ink-secondary">
            <span class="truncate" data-testid="business-outlet">{{
              businessStore.outlet || '-'
            }}</span>
            <span aria-hidden="true">&middot;</span>
            <span class="truncate" data-testid="business-type">{{
              businessStore.normalizedType || '-'
            }}</span>
          </p>
        </div>
      </div>
    </BaseCard>

    <template v-if="!isCashier">
      <div
        v-if="showSubscriptionSkeleton"
        class="animate-pulse rounded-3xl border border-zinc-200 bg-card p-4 dark:border-slate-700/60"
        data-testid="subscription-skeleton"
      >
        <div class="flex items-center gap-3">
          <div class="h-11 w-11 rounded-2xl bg-zinc-100 dark:bg-slate-800" />
          <div class="flex-1 space-y-2">
            <div class="h-3 w-20 rounded bg-zinc-100 dark:bg-slate-800" />
            <div class="h-3 w-52 rounded bg-zinc-100 dark:bg-slate-800" />
          </div>
        </div>
      </div>

      <button
        v-else
        type="button"
        data-testid="subscription-card"
        class="w-full rounded-3xl border p-4 text-left shadow-soft transition active:scale-[0.99] focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
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
          </div>

          <AppIcon name="chevron-right" class="text-ink-secondary" />
        </div>
      </button>
    </template>

    <BaseCard
      class="divide-y divide-zinc-100 overflow-hidden !p-0 dark:divide-slate-700/45"
      data-testid="settings-menu"
    >
      <SettingsSection
        section-id="appearance"
        title="Tampilan"
        :summary="themeStore.isDark ? 'Tema gelap' : 'Tema terang'"
        :icon="themeStore.isDark ? 'moon' : 'sun'"
        :open="activeSection === 'appearance'"
        @toggle="toggleSection('appearance')"
      >
        <!-- Theme Appearance (Light / Dark + Adaptive Logo) -->
        <div class="space-y-4" data-testid="theme-settings-card">
          <div class="grid grid-cols-2 gap-2.5">
            <button
              type="button"
              data-testid="theme-option-light"
              :aria-pressed="!themeStore.isDark"
              class="flex items-center gap-3 rounded-2xl border p-3 text-left transition active:scale-[0.99] cursor-pointer"
              :class="
                !themeStore.isDark
                  ? 'border-primary bg-primary/8 ring-2 ring-primary/20'
                  : 'border-zinc-200 bg-surface hover:border-primary/40'
              "
              @click="themeStore.setTheme('light')"
            >
              <span
                class="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl"
                :class="
                  !themeStore.isDark ? 'bg-primary text-white' : 'bg-zinc-100 text-ink-secondary'
                "
              >
                <AppIcon name="sun" class="h-4 w-4" />
              </span>
              <span class="min-w-0">
                <span class="block text-sm font-semibold text-ink-primary">Terang</span>
              </span>
            </button>

            <button
              type="button"
              data-testid="theme-option-dark"
              :aria-pressed="themeStore.isDark"
              class="flex items-center gap-3 rounded-2xl border p-3 text-left transition active:scale-[0.99] cursor-pointer"
              :class="
                themeStore.isDark
                  ? 'border-indigo-400 bg-indigo-500/15 ring-2 ring-indigo-400/25'
                  : 'border-zinc-200 bg-surface hover:border-primary/40'
              "
              @click="themeStore.setTheme('dark')"
            >
              <span
                class="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl"
                :class="
                  themeStore.isDark ? 'bg-indigo-500 text-white' : 'bg-zinc-100 text-ink-secondary'
                "
              >
                <AppIcon name="moon" class="h-4 w-4" />
              </span>
              <span class="min-w-0">
                <span class="block text-sm font-semibold text-ink-primary">Gelap</span>
              </span>
            </button>
          </div>
        </div>
      </SettingsSection>
      <SettingsSection
        section-id="tax"
        title="Pajak"
        :summary="taxStore.enabled ? `${taxStore.rate}% per transaksi` : 'Tidak aktif'"
        icon="expenses"
        :open="activeSection === 'tax'"
        @toggle="toggleSection('tax')"
      >
        <div class="space-y-5" data-testid="tax-settings-card">
          <p class="text-xs leading-relaxed text-ink-secondary">
            Berlaku untuk transaksi baru. Transaksi sebelumnya tidak berubah.
          </p>

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
                :disabled="isCashier"
                class="size-5 shrink-0 accent-primary disabled:opacity-50"
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
                  :disabled="!taxDraftEnabled || isCashier"
                  :aria-invalid="taxDraftEnabled && !taxRateValid"
                  aria-describedby="tax-rate-help"
                  class="h-12 w-full rounded-2xl border border-zinc-200 bg-card px-4 pr-10 text-sm text-ink-primary outline-none transition focus:border-primary focus:ring-4 focus:ring-primary/10 disabled:bg-zinc-100 disabled:text-zinc-500 dark:border-slate-700/70 dark:bg-[#121726] dark:disabled:bg-slate-800/60 dark:disabled:text-slate-500"
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

            <div
              class="rounded-2xl border border-primary/10 bg-primary/5 p-4 dark:border-indigo-400/20 dark:bg-indigo-500/10"
            >
              <p
                class="text-xs font-semibold uppercase tracking-widest text-primary dark:text-indigo-300"
              >
                Simulasi transaksi
              </p>
              <div class="mt-3 flex items-center justify-between text-sm">
                <span class="text-ink-secondary">Subtotal</span>
                <span class="font-medium text-ink-primary">Rp 100.000</span>
              </div>
              <div
                v-if="taxDraftEnabled"
                class="mt-2 flex items-center justify-between gap-3 text-sm"
              >
                <span class="text-ink-secondary">Pajak ({{ taxDraftRate || '0' }}%)</span>
                <span class="font-medium text-ink-primary">{{
                  taxRateValid ? `Rp ${taxPreview.toLocaleString('id-ID')}` : '—'
                }}</span>
              </div>
              <div
                class="mt-3 flex items-center justify-between border-t border-primary/10 pt-3 text-sm font-semibold dark:border-indigo-400/20"
              >
                <span>Total</span>
                <span data-testid="tax-preview-total">{{
                  taxRateValid ? `Rp ${(100000 + taxPreview).toLocaleString('id-ID')}` : '—'
                }}</span>
              </div>
            </div>

            <div class="flex flex-wrap items-center gap-3">
              <BaseButton type="submit" data-testid="save-tax-settings" :disabled="!taxRateValid || isCashier">
                Simpan
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
            <p v-if="isCashier" class="text-xs text-amber-600 dark:text-amber-400">
              Pengaturan pajak hanya dapat diubah oleh pemilik bisnis.
            </p>
          </form>
        </div>
      </SettingsSection>
      <SettingsSection
        section-id="receipt"
        title="Pengaturan Struk"
        summary="Alamat, logo, dan footer"
        icon="transactions"
        :open="activeSection === 'receipt'"
        @toggle="toggleSection('receipt')"
      >
        <ReceiptSettingsPanel />
      </SettingsSection>
      <SettingsSection
        section-id="printer"
        title="Printer Bluetooth"
        :summary="printerStatusText"
        icon="transactions"
        :open="activeSection === 'printer'"
        @toggle="toggleSection('printer')"
      >
        <div class="space-y-4" data-testid="printer-settings-card">
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
            <p class="text-xs font-medium text-ink-secondary">Ukuran kertas</p>
            <div class="mt-2 grid grid-cols-2 gap-2">
              <button
                v-for="width in paperWidths"
                :key="width"
                type="button"
                :data-testid="`paper-width-${width}`"
                class="h-12 rounded-2xl border text-sm font-semibold transition"
                :class="
                  printerStore.paperWidth === width
                    ? 'border-primary bg-primary/10 text-primary dark:border-indigo-400/60 dark:bg-indigo-500/15 dark:text-indigo-200'
                    : 'border-zinc-200 bg-card text-ink-secondary dark:border-slate-700/70 dark:bg-[#121726]'
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
              Pilih
            </BaseButton>
            <BaseButton
              variant="secondary"
              :disabled="printerBusy || !printerStore.hasSelectedPrinter || !isNativePrinter"
              data-testid="btn-test-print"
              @click="handleTestPrint"
            >
              Tes
            </BaseButton>
            <BaseButton
              variant="ghost"
              :disabled="!printerStore.hasSelectedPrinter"
              data-testid="btn-forget-printer"
              @click="handleForgetPrinter"
            >
              Lupakan
            </BaseButton>
          </div>

          <p v-if="!isNativePrinter" class="text-xs text-ink-secondary">
            Tes print Bluetooth hanya tersedia di perangkat Android.
          </p>
        </div>
      </SettingsSection>
      <SettingsSection
        section-id="cloud"
        title="Akun Cloud"
        :summary="cloudAccountSubtitle"
        icon="cloud"
        :open="activeSection === 'cloud'"
        @toggle="toggleSection('cloud')"
      >
        <!-- Cloud account (PREM-M03) -->
        <div class="space-y-3" data-testid="cloud-account-card">
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
            <div class="flex items-start justify-between gap-4">
              <dt class="shrink-0">Akun</dt>
              <dd
                class="min-w-0 break-words text-right font-medium text-ink-primary"
                data-testid="cloud-account-email"
              >
                {{ cloudAccount }}
              </dd>
            </div>
            <div class="flex items-start justify-between gap-4">
              <dt class="shrink-0">Bisnis Cloud</dt>
              <dd
                class="min-w-0 break-words text-right font-medium text-ink-primary"
                data-testid="cloud-account-business"
              >
                {{ cloudStore.selectedBusiness?.name ?? '-' }}
              </dd>
            </div>
            <div v-if="!isCashier" class="flex items-start justify-between gap-4">
              <dt class="shrink-0">Subscription</dt>
              <dd
                class="min-w-0 break-words text-right font-medium text-ink-primary"
                data-testid="cloud-account-subscription"
              >
                {{ cloudSubscriptionLabel }}
              </dd>
            </div>
            <div class="flex items-start justify-between gap-4">
              <dt class="shrink-0">Status diperiksa</dt>
              <dd
                class="min-w-0 break-words text-right font-medium text-ink-primary"
                data-testid="cloud-account-checked"
              >
                {{ cloudCheckedLabel }}
              </dd>
            </div>
          </dl>

          <p v-else class="text-xs text-ink-secondary">
            Hubungkan POS ini dengan akun Cloud dan Dashboard. POS tetap dapat digunakan tanpa
            Cloud.
          </p>

          <div class="flex flex-wrap gap-2">
            <BaseButton
              v-if="!cloudLinked"
              size="sm"
              data-testid="cloud-login-entry"
              @click="goToCloud"
            >
              {{ cloudStore.isAuthenticated ? 'Pilih Bisnis / Kelola Akun' : 'Masuk' }}
            </BaseButton>
            <BaseButton
              v-else
              size="sm"
              variant="secondary"
              data-testid="settings-cloud-account-entry"
              @click="goToCloud"
            >
              Kelola Akun / Ganti Email
            </BaseButton>
            <BaseButton
              v-if="cloudStore.isAuthenticated"
              size="sm"
              variant="danger"
              data-testid="cloud-disconnect"
              @click="showDisconnectConfirm = true"
            >
              Logout / Putuskan
            </BaseButton>
          </div>
          <p
            v-if="!isCashier && isPremium"
            class="mt-1 text-xs font-semibold text-emerald-700 dark:text-emerald-300"
            data-testid="subscription-plan"
          >
            Paket {{ subscriptionStore.planLabel }}
          </p>

          <p
            v-if="!isCashier && isPremium && expiresAtLabel"
            class="text-xs text-ink-secondary"
            data-testid="subscription-expiry"
          >
            Berakhir pada {{ expiresAtLabel }}
          </p>

          <p
            v-if="!isCashier && subscriptionStatus === 'unverified' && subscriptionStore.entitlement.plan"
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
          <SettingsMenuItem
            icon="sync"
            title="Sinkronisasi"
            :subtitle="
              isSyncUnlocked
                ? 'Sinkronkan data ke cloud'
                : !cloudStore.isAuthenticated
                  ? 'Memerlukan Login & Premium'
                  : 'Memerlukan Premium'
            "
            testid="settings-menu-sync"
            :locked="isSyncLocked"
            @select="handleSyncSelect"
          />
        </div>
      </SettingsSection>
      <SettingsSection
        section-id="data"
        title="Backup & Data"
        summary="Backup, pemulihan, dan cache"
        icon="backup"
        :open="activeSection === 'data'"
        @toggle="toggleSection('data')"
      >
        <!-- Backup data: local (free) vs cloud (premium) -->
        <div class="space-y-5" data-testid="backup-card">
          <LocalDataExportPanel
            @feedback="({ type, message }) => setFeedback(type, message)"
          />

          <div
            class="space-y-3 rounded-3xl border border-zinc-200 bg-surface/60 p-4 dark:border-slate-700/60 dark:bg-[#121726]"
            data-testid="local-backup-section"
          >
            <div class="flex items-center justify-between gap-3">
              <div class="flex items-center gap-3">
                <span
                  class="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary dark:bg-indigo-500/20 dark:text-indigo-300"
                >
                  <AppIcon name="backup" />
                </span>
                <div class="min-w-0">
                  <h4 class="text-base font-semibold text-ink-primary">
                    Backup &amp; Restore Sistem (.json)
                  </h4>
                  <p class="text-xs text-ink-secondary">
                    Simpan file sistem untuk dipulihkan kembali saat ganti HP atau install ulang.
                  </p>
                </div>
              </div>
              <span
                class="shrink-0 rounded-full bg-emerald-100 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300"
              >
                Gratis
              </span>
            </div>

            <div class="flex flex-wrap gap-2">
              <BaseButton data-testid="local-backup-now" @click="handleBackup">
                Backup Data (.json)
              </BaseButton>
              <BaseButton
                variant="secondary"
                data-testid="settings-menu-restore"
                @click="handleRestoreClick"
              >
                Restore Backup
              </BaseButton>
            </div>
          </div>

          <CloudBackupPanel @locked="handleCloudLocked" />
        </div>

        <div
          class="mt-5 space-y-3 border-t border-zinc-200 pt-5 dark:border-slate-700/60"
          data-testid="cache-settings-card"
        >
          <div>
            <h4 class="text-sm font-semibold text-ink-primary">Cache Lokal</h4>
            <p class="mt-1 text-xs leading-relaxed text-ink-secondary">
              Bersihkan data produk, transaksi, dan riwayat pada perangkat ini.
            </p>
          </div>
          <BaseButton
            variant="danger"
            data-testid="btn-clear-cache"
            @click="showClearCacheConfirm = true"
          >
            Hapus Cache
          </BaseButton>
        </div>
      </SettingsSection>
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

    <BaseCard
      class="flex items-center justify-between gap-3 !border-0 !bg-transparent !px-1 !py-2 !shadow-none"
      data-testid="app-version-card"
    >
      <div class="min-w-0 space-y-1">
        <NexaPosLogo size="sm" with-wordmark />
      </div>
      <span
        data-testid="app-version-badge"
        class="shrink-0 rounded-full border border-primary/20 bg-primary/10 px-3 py-1 font-mono text-xs font-bold text-primary"
      >
        v{{ APP_VERSION }}
      </span>
    </BaseCard>

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

        <div class="flex flex-col gap-2">
          <BaseButton block data-testid="locked-feature-cta" @click="goToSubscription">
            Upgrade
          </BaseButton>
          <BaseButton
            v-if="!cloudStore.isAuthenticated"
            variant="secondary"
            block
            data-testid="locked-feature-login-cta"
            @click="goToCloud"
          >
            Masuk Akun Cloud
          </BaseButton>
        </div>
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
          Apakah Anda yakin ingin memutuskan akun Cloud? Sesi Cloud akan diputuskan dan seluruh data
          cache lokal (menu produk, transaksi, riwayat kas, dan shift) akan dibersihkan agar data
          tidak tumpang tindih saat login dengan akun lain.
        </p>
        <div class="flex flex-wrap gap-2">
          <BaseButton
            variant="danger"
            data-testid="settings-disconnect-confirm"
            @click="confirmDisconnect"
          >
            Putuskan
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

    <BaseModal
      :open="showClearCacheConfirm"
      title="Hapus Data Cache"
      @close="showClearCacheConfirm = false"
    >
      <div class="space-y-4" data-testid="clear-cache-modal">
        <p class="text-sm text-ink-secondary">
          Apakah Anda yakin ingin menghapus data cache lokal? Semua data menu produk, transaksi,
          riwayat kas, dan shift yang tersimpan di perangkat ini akan dibersihkan.
        </p>
        <p class="text-xs text-amber-600 bg-amber-50 p-2.5 rounded-xl border border-amber-200">
          Pastikan transaksi penting sudah disinkronkan ke Cloud atau dibackup sebelum menghapus
          cache.
        </p>
        <div class="flex flex-wrap gap-2">
          <BaseButton
            variant="danger"
            data-testid="btn-confirm-clear-cache"
            :loading="isClearingCache"
            @click="handleClearCache"
          >
            Hapus
          </BaseButton>
          <BaseButton
            variant="ghost"
            data-testid="btn-cancel-clear-cache"
            @click="showClearCacheConfirm = false"
          >
            Batal
          </BaseButton>
        </div>
      </div>
    </BaseModal>
  </div>
</template>
