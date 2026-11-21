<script setup>
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import BaseButton from '@/components/base/BaseButton.vue'
import BaseCard from '@/components/base/BaseCard.vue'
import BaseModal from '@/components/base/BaseModal.vue'
import BaseSheet from '@/components/base/BaseSheet.vue'
import ReceiptContent from '@/components/receipt/ReceiptContent.vue'
import {
  isNativePrinterPlatform,
  listPairedPrinters,
  openCashDrawer,
  printReceipt,
} from '@/services/printer/bluetoothPrinterService'
import { SUPPORTED_PAPER_WIDTHS } from '@/services/printer/escposReceiptBuilder'
import {
  decodeReceiptLogo,
  rasterizeImageElement,
  rasterizeLogoUrl,
} from '@/services/printer/receiptSettings'
import { useBusinessStore } from '@/stores/businessStore'
import { useCloudSessionStore } from '@/stores/cloudSessionStore'
import { usePrinterStore } from '@/stores/printerStore'
import { useReceiptStore } from '@/stores/receiptStore'
import { useSubscriptionStore } from '@/stores/subscriptionStore'
import { useSyncPushStore } from '@/stores/syncPushStore'
import { useTransactionStore } from '@/stores/transactionStore'

const route = useRoute()
const router = useRouter()
const businessStore = useBusinessStore()
const cloudStore = useCloudSessionStore()
const printerStore = usePrinterStore()
const receiptStore = useReceiptStore()
const subscriptionStore = useSubscriptionStore()
const syncPushStore = useSyncPushStore()
const transactionStore = useTransactionStore()

const isFree = computed(() => !subscriptionStore.isPremium)

const isPrinting = ref(false)
const isOpeningDrawer = ref(false)
const printFeedback = ref('')
const printError = ref('')

const showChangePaymentModal = ref(false)
const selectedNewPaymentMethod = ref('cash')
const paymentChangeSuccess = ref('')
const paymentChangeError = ref('')

const showVoidModal = ref(false)
const voidReason = ref('')
const voidError = ref('')
const voidSuccess = ref('')

const isVoided = computed(() => {
  const status = String(transaction.value?.status || '').toLowerCase()
  const paymentStatus = String(transaction.value?.paymentStatus || '').toLowerCase()
  return status === 'cancelled' || status === 'batal' || paymentStatus === 'cancelled'
})

function openChangePayment() {
  selectedNewPaymentMethod.value = transaction.value?.paymentMethod || 'cash'
  paymentChangeError.value = ''
  paymentChangeSuccess.value = ''
  showChangePaymentModal.value = true
}

async function confirmChangePayment() {
  if (!transaction.value) return
  paymentChangeError.value = ''
  const res = transactionStore.updatePaymentMethod(transaction.value.id, selectedNewPaymentMethod.value)
  if (res.success) {
    showChangePaymentModal.value = false
    paymentChangeSuccess.value = `Metode pembayaran berhasil diubah ke ${selectedNewPaymentMethod.value.toUpperCase()}.`
    void syncPushStore.pushIfOnline?.()
  } else {
    paymentChangeError.value = res.error || 'Gagal mengubah metode pembayaran.'
  }
}

function openVoidModal() {
  voidReason.value = ''
  voidError.value = ''
  voidSuccess.value = ''
  showVoidModal.value = true
}

async function confirmVoidTransaction() {
  if (!transaction.value) return
  voidError.value = ''
  const res = transactionStore.voidTransaction(transaction.value.id, voidReason.value)
  if (res.success) {
    showVoidModal.value = false
    voidSuccess.value = 'Transaksi berhasil dibatalkan (Void).'
    void syncPushStore.pushIfOnline?.()
  } else {
    voidError.value = res.error || 'Gagal membatalkan transaksi.'
  }
}

async function handleOpenCashDrawer() {
  if (isOpeningDrawer.value || isPrinting.value) return
  if (needsPrinterSelection.value) {
    printError.value = 'Printer Bluetooth belum dipilih.'
    return
  }

  isOpeningDrawer.value = true
  printFeedback.value = ''
  printError.value = ''

  try {
    const result = await openCashDrawer({
      printer: printerStore.selectedPrinter,
    })

    if (!result.success) {
      printError.value = result.message || 'Gagal membuka laci kasir.'
      return
    }

    printFeedback.value = 'Perintah buka laci kasir berhasil dikirim.'
  } finally {
    isOpeningDrawer.value = false
  }
}

const showPrinterSheet = ref(false)
const isLoadingPrinters = ref(false)
const pairedPrinters = ref([])
const printerListError = ref('')

const transaction = computed(() => (
  transactionStore.items.find((item) => String(item.id) === String(route.params.id)) ?? null
))

const activeOutlet = computed(() => cloudStore.selectedOutlet || null)

const business = computed(() => {
  const branchAddress = activeOutlet.value?.address || null
  const branchPhone = activeOutlet.value?.phone || null
  const branchName = activeOutlet.value?.name || businessStore.outlet || '-'

  if (transaction.value?.businessSnapshot) {
    return {
      name: transaction.value.businessSnapshot.name || '-',
      outlet: transaction.value.businessSnapshot.outlet || branchName,
      phone: branchPhone || transaction.value.businessSnapshot.phone || '',
      address: branchAddress || transaction.value.businessSnapshot.address || '',
    }
  }

  return {
    name: businessStore.name || '-',
    outlet: branchName,
    phone: branchPhone || businessStore.phone || '',
    address: branchAddress || '',
  }
})

const effectiveReceiptSettings = computed(() => {
  const settings = { ...receiptStore.$state }
  if (business.value.address) {
    settings.address = business.value.address
  }
  return settings
})

const isNativePrinter = computed(() => isNativePrinterPlatform())
const needsPrinterSelection = computed(() => isNativePrinter.value && !printerStore.hasSelectedPrinter)

const selectedPrinterLabel = computed(() => {
  if (!isNativePrinter.value) {
    return 'Cetak via Browser / Sistem'
  }
  if (!printerStore.hasSelectedPrinter) {
    return 'Printer Bluetooth belum dipilih'
  }
  return printerStore.selectedPrinter.name || printerStore.selectedPrinter.address
})

async function openPrinterPicker() {
  printError.value = ''
  printerListError.value = ''
  showPrinterSheet.value = true
  isLoadingPrinters.value = true

  try {
    const result = await listPairedPrinters()
    if (!result.success) {
      pairedPrinters.value = []
      printerListError.value = result.message || 'Gagal memuat daftar printer Bluetooth.'
      return
    }
    pairedPrinters.value = result.devices ?? []
  } finally {
    isLoadingPrinters.value = false
  }
}

function handlePickPrinter(device) {
  const res = printerStore.selectPrinter(device)
  if (res.success) {
    showPrinterSheet.value = false
    printError.value = ''
  }
}

function handlePaperWidthSelect(width) {
  printerStore.setPaperWidth(width)
}

async function ensureLogoRasterized() {
  const currentLogo = receiptStore.logo
  if (!currentLogo || decodeReceiptLogo(currentLogo)) {
    return
  }

  const logoUrl =
    typeof currentLogo === 'string'
      ? currentLogo
      : currentLogo?.url || null

  if (!logoUrl) return

  // 1. Prioritaskan rasterize via URL (memanggil native Java di Android yang bebas CORS)
  try {
    const raster = await rasterizeLogoUrl(logoUrl)
    if (raster) {
      receiptStore.setLogoRaster(raster)
      return
    }
  } catch {
    // Abaikan jika gagal
  }

  // 2. Fallback: ambil dari elemen img yang sudah ter-render di DOM
  if (typeof document !== 'undefined') {
    const imgEl = document.querySelector('.receipt-logo')
    if (imgEl && imgEl.complete && imgEl.naturalWidth > 0) {
      try {
        const raster = rasterizeImageElement(imgEl)
        if (raster) {
          receiptStore.setLogoRaster(raster)
        }
      } catch {
        // Abaikan jika canvas tainted
      }
    }
  }
}

onMounted(() => {
  ensureLogoRasterized()
})

async function handlePrint() {
  if (isPrinting.value || !transaction.value) {
    return
  }

  printFeedback.value = ''
  printError.value = ''

  if (needsPrinterSelection.value) {
    printError.value = 'Printer Bluetooth belum dipilih.'
    return
  }

  isPrinting.value = true

  try {
    await ensureLogoRasterized()

    const result = await printReceipt({
      transaction: transaction.value,
      business: business.value,
      printer: printerStore.selectedPrinter,
      paperWidth: printerStore.paperWidth,
      receiptSettings: effectiveReceiptSettings.value,
      isFree: isFree.value,
      outlet: activeOutlet.value,
    })

    if (!result.success) {
      printError.value = result.message
      return
    }

    // Web keeps the browser print dialog; only native Bluetooth reports delivery.
    if (result.mode === 'native') {
      printFeedback.value = 'Struk berhasil dikirim ke printer.'
    }
  } finally {
    isPrinting.value = false
  }
}
</script>

<template>
  <div class="mx-auto max-w-xl space-y-4 pb-8 print:max-w-none print:space-y-0 print:pb-0">
    <!-- Top Navigation Bar (Hidden during print) -->
    <div class="flex items-center justify-between gap-3 print:hidden">
      <button
        type="button"
        class="inline-flex items-center gap-1.5 rounded-xl border border-zinc-200 bg-white px-3 py-2 text-xs font-semibold text-ink-primary shadow-2xs transition hover:bg-zinc-50 active:scale-95 cursor-pointer"
        @click="router.back()"
      >
        <svg class="h-4 w-4 text-ink-secondary" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M15 18l-6-6 6-6" />
        </svg>
        <span>Kembali</span>
      </button>

      <button
        type="button"
        class="inline-flex items-center gap-1.5 rounded-xl border border-primary/25 bg-primary/10 px-3 py-2 text-xs font-semibold text-primary transition hover:bg-primary/15 active:scale-95 cursor-pointer"
        @click="router.push('/pos')"
      >
        <svg class="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <line x1="12" y1="5" x2="12" y2="19" />
          <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
        <span>Transaksi Baru</span>
      </button>
    </div>

    <!-- Printer Control & Print Struk Action Card -->
    <BaseCard
      v-if="transaction"
      class="space-y-3.5 border border-zinc-200/80 p-4 shadow-sm print:hidden"
      data-testid="receipt-printer-bar"
    >
      <div class="flex items-center justify-between gap-3">
        <div class="flex min-w-0 items-center gap-2.5">
          <div
            class="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl"
            :class="
              !isNativePrinter || printerStore.hasSelectedPrinter
                ? 'bg-primary/10 text-primary'
                : 'bg-amber-100 text-amber-600'
            "
          >
            <!-- Bluetooth Icon on Android, Printer Icon on Web -->
            <svg
              v-if="isNativePrinter"
              class="h-4 w-4"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <polyline points="6.5 6.5 17.5 17.5 12 23 12 1 17.5 6.5 6.5 17.5" />
            </svg>
            <svg
              v-else
              class="h-4 w-4"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <polyline points="6 9 6 2 18 2 18 9" />
              <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
              <rect x="6" y="14" width="12" height="8" />
            </svg>
          </div>

          <div class="min-w-0">
            <div class="flex items-center gap-1.5">
              <p class="truncate text-xs font-bold text-ink-primary">
                {{ selectedPrinterLabel }}
              </p>
              <span
                v-if="isNativePrinter && printerStore.hasSelectedPrinter"
                class="inline-block h-2 w-2 shrink-0 rounded-full bg-emerald-500"
                title="Printer siap"
              />
            </div>
            <p class="truncate text-[11px] text-ink-secondary">
              <template v-if="isNativePrinter && printerStore.hasSelectedPrinter">
                {{ printerStore.selectedPrinter.address }} &bull; Thermal {{ printerStore.paperWidth }}mm
              </template>
              <template v-else-if="isNativePrinter">
                Pilih printer thermal 58mm / 80mm yang sudah dipairing
              </template>
              <template v-else>
                Dialog cetak sistem atau simpan PDF
              </template>
            </p>
          </div>
        </div>

        <!-- Quick Bluetooth Printer Selector & Paper Size on Android -->
        <div v-if="isNativePrinter" class="flex shrink-0 items-center gap-1.5">
          <div class="inline-flex rounded-lg border border-zinc-200 bg-zinc-50 p-0.5">
            <button
              v-for="width in SUPPORTED_PAPER_WIDTHS"
              :key="width"
              type="button"
              class="rounded-md px-2 py-1 text-[10px] font-bold transition cursor-pointer"
              :class="
                printerStore.paperWidth === width
                  ? 'bg-white text-primary shadow-2xs'
                  : 'text-ink-secondary hover:text-ink-primary'
              "
              @click="handlePaperWidthSelect(width)"
            >
              {{ width }}mm
            </button>
          </div>

          <button
            type="button"
            data-testid="btn-quick-select-printer"
            class="rounded-xl border border-zinc-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-ink-primary hover:bg-zinc-50 active:scale-95 transition cursor-pointer"
            @click="openPrinterPicker"
          >
            {{ printerStore.hasSelectedPrinter ? 'Ganti' : 'Pilih' }}
          </button>
        </div>
      </div>

      <!-- Primary Print Struk CTA Button -->
      <BaseButton
        block
        size="lg"
        class="gap-2 shadow-md shadow-primary/20"
        :disabled="isPrinting"
        data-testid="btn-print-receipt"
        @click="handlePrint"
      >
        <svg
          v-if="isPrinting"
          class="h-4 w-4 animate-spin"
          viewBox="0 0 24 24"
          fill="none"
          aria-hidden="true"
        >
          <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3.5" />
          <path class="opacity-80" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
        <svg
          v-else
          class="h-5 w-5"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <polyline points="6 9 6 2 18 2 18 9" />
          <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
          <rect x="6" y="14" width="12" height="8" />
        </svg>
        <span>{{ isPrinting ? 'Mencetak...' : 'Print' }}</span>
      </BaseButton>

      <!-- Secondary Actions: Ubah Metode Bayar & Void -->
      <div v-if="transaction" class="grid grid-cols-2 gap-2 pt-2 border-t border-zinc-100 print:hidden dark:border-slate-800">
        <BaseButton
          variant="secondary"
          size="md"
          data-testid="btn-change-payment-method"
          :disabled="isVoided"
          @click="openChangePayment"
        >
          Ubah Metode Bayar
        </BaseButton>

        <BaseButton
          variant="danger"
          size="md"
          data-testid="btn-void-transaction"
          :disabled="isVoided"
          @click="openVoidModal"
        >
          {{ isVoided ? 'Dibatalkan (Void)' : 'Batalkan (Void)' }}
        </BaseButton>
      </div>

      <div
        v-if="isVoided"
        class="rounded-xl bg-rose-50 border border-rose-200 p-2.5 text-xs text-rose-700 dark:bg-rose-950/40 dark:border-rose-900/60 dark:text-rose-300"
        data-testid="badge-void-notice"
      >
        <p class="font-bold">⚠️ Transaksi Telah Dibatalkan (Void)</p>
        <p v-if="transaction?.voidReason" class="mt-0.5 text-[11px] italic">
          Alasan: {{ transaction.voidReason }}
        </p>
      </div>

      <!-- Cash Drawer Quick Indicator & Manual Kick -->
      <div class="flex items-center justify-between border-t border-zinc-100 pt-2.5 text-xs print:hidden dark:border-slate-800">
        <div class="flex items-center gap-1.5 text-ink-secondary">
          <svg class="h-4 w-4 text-emerald-600 dark:text-emerald-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="2" y="4" width="20" height="16" rx="2" />
            <path d="M6 12h.01M10 12h8" />
          </svg>
          <span class="text-[11px] font-medium">Laci kasir otomatis terbuka saat print</span>
        </div>

        <button
          v-if="isNativePrinter"
          type="button"
          class="inline-flex items-center gap-1 rounded-xl border border-zinc-200 bg-zinc-50 px-2.5 py-1 text-xs font-semibold text-ink-primary shadow-2xs hover:bg-zinc-100 active:scale-95 transition cursor-pointer dark:border-slate-700 dark:bg-slate-800 dark:text-white"
          data-testid="btn-manual-open-drawer"
          :disabled="isOpeningDrawer || isPrinting"
          @click="handleOpenCashDrawer"
        >
          <svg class="h-3.5 w-3.5 text-zinc-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="2" y="6" width="20" height="12" rx="2" />
            <circle cx="12" cy="12" r="2" />
          </svg>
          <span>{{ isOpeningDrawer ? 'Membuka...' : 'Buka Laci' }}</span>
        </button>
      </div>
    </BaseCard>

    <!-- Payment Change Feedback Banner -->
    <div
      v-if="paymentChangeSuccess"
      class="flex items-center gap-2.5 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-700 print:hidden"
      data-testid="payment-change-feedback"
    >
      <p>{{ paymentChangeSuccess }}</p>
    </div>

    <!-- Void Feedback Banner -->
    <div
      v-if="voidSuccess"
      class="flex items-center gap-2.5 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-700 print:hidden"
      data-testid="void-feedback"
    >
      <p>{{ voidSuccess }}</p>
    </div>

    <!-- Print Feedback Banner -->
    <div
      v-if="printFeedback"
      class="flex items-center gap-2.5 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-700 print:hidden"
    >
      <svg class="h-4 w-4 shrink-0 text-emerald-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <circle cx="12" cy="12" r="9" />
        <path d="M8.5 12.5l2.5 2.5 4.5-5" />
      </svg>
      <p data-testid="print-feedback">{{ printFeedback }}</p>
    </div>

    <!-- Print Error Banner -->
    <div
      v-if="printError"
      class="space-y-2 rounded-2xl border border-danger/20 bg-danger/10 px-4 py-3 text-sm text-danger print:hidden"
      data-testid="print-error"
    >
      <p class="font-medium">{{ printError }}</p>
      <div v-if="needsPrinterSelection || isNativePrinter" class="flex flex-wrap items-center gap-3 text-xs">
        <button
          v-if="isNativePrinter"
          type="button"
          class="rounded-lg bg-white px-2.5 py-1 font-semibold text-ink-primary shadow-2xs hover:bg-zinc-50 cursor-pointer"
          @click="openPrinterPicker"
        >
          Pilih Printer Sekarang
        </button>
        <button
          v-if="needsPrinterSelection"
          type="button"
          class="font-semibold underline cursor-pointer"
          data-testid="link-configure-printer"
          @click="router.push('/settings')"
        >
          Atur Printer
        </button>
      </div>
    </div>

    <!-- Thermal Paper Receipt Preview -->
    <ReceiptContent
      v-if="transaction"
      :transaction="transaction"
      :business="business"
      :receipt-settings="effectiveReceiptSettings"
      :is-free="isFree"
    />

    <BaseCard v-else>
      <p class="text-sm text-ink-secondary">Transaksi tidak ditemukan.</p>
    </BaseCard>

    <!-- Quick Paired Bluetooth Printer Bottom Sheet (Android) -->
    <BaseSheet
      :open="showPrinterSheet"
      title="Pilih Printer Bluetooth"
      @close="showPrinterSheet = false"
    >
      <div class="space-y-3">
        <p v-if="isLoadingPrinters" class="py-4 text-center text-sm text-ink-secondary">
          Memuat perangkat Bluetooth yang sudah dipairing...
        </p>

        <p
          v-else-if="printerListError"
          class="rounded-2xl bg-danger/10 px-4 py-3 text-xs font-medium text-danger"
        >
          {{ printerListError }}
        </p>

        <div v-else-if="pairedPrinters.length" class="grid gap-2">
          <button
            v-for="device in pairedPrinters"
            :key="device.address"
            type="button"
            class="flex min-h-12 w-full items-center justify-between rounded-2xl border px-4 py-2.5 text-left transition cursor-pointer"
            :class="
              printerStore.selectedPrinter.address === device.address
                ? 'border-primary bg-primary/5'
                : 'border-zinc-200 bg-white hover:border-primary/40 active:bg-zinc-50'
            "
            @click="handlePickPrinter(device)"
          >
            <div>
              <span class="block text-sm font-semibold text-ink-primary">
                {{ device.name || 'Printer Tanpa Nama' }}
              </span>
              <span class="block font-mono text-xs text-ink-secondary">{{ device.address }}</span>
            </div>
            <span
              v-if="printerStore.selectedPrinter.address === device.address"
              class="rounded-lg bg-primary/10 px-2 py-0.5 text-xs font-bold text-primary"
            >
              Aktif
            </span>
          </button>
        </div>

        <div v-else class="rounded-2xl bg-zinc-50 p-4 text-center space-y-1.5">
          <p class="text-sm font-medium text-ink-primary">
            Belum ada printer Bluetooth yang dipairing
          </p>
          <p class="text-xs text-ink-secondary">
            Buka Pengaturan Bluetooth Android Anda, hubungkan (pair) printer thermal 58mm/80mm terlebih dahulu, lalu tekan Muat Ulang.
          </p>
        </div>

        <div class="flex items-center justify-between gap-2 border-t border-zinc-100 pt-2">
          <BaseButton variant="secondary" size="sm" @click="openPrinterPicker">
            Muat Ulang
          </BaseButton>
          <BaseButton variant="ghost" size="sm" @click="router.push('/settings')">
            Pengaturan Lengkap
          </BaseButton>
        </div>
      </div>
    </BaseSheet>

    <!-- Modal Ubah Metode Bayar -->
    <BaseModal
      :open="showChangePaymentModal"
      title="Ubah Metode Pembayaran"
      @close="showChangePaymentModal = false"
    >
      <div class="space-y-4">
        <p class="text-xs text-ink-secondary">
          Pilih metode pembayaran baru untuk transaksi ini. Jika diubah ke/dari Tunai, kas fisik shift akan disesuaikan secara otomatis.
        </p>

        <div v-if="paymentChangeError" class="rounded-xl bg-danger/10 p-3 text-xs text-danger font-medium" data-testid="payment-change-error">
          {{ paymentChangeError }}
        </div>

        <div class="grid grid-cols-2 gap-2">
          <button
            v-for="method in ['cash', 'qris', 'transfer', 'edc']"
            :key="method"
            type="button"
            :data-testid="`btn-select-payment-${method}`"
            class="flex items-center justify-center gap-2 rounded-xl border p-3 text-xs font-semibold capitalize transition cursor-pointer"
            :class="
              selectedNewPaymentMethod === method
                ? 'border-primary bg-primary/10 text-primary font-bold shadow-2xs'
                : 'border-zinc-200 bg-white hover:bg-zinc-50 text-ink-primary dark:border-slate-700 dark:bg-slate-800 dark:text-zinc-200'
            "
            @click="selectedNewPaymentMethod = method"
          >
            <span>{{ method.toUpperCase() }}</span>
          </button>
        </div>

        <div class="flex items-center justify-end gap-2 pt-2 border-t border-zinc-100 dark:border-slate-800">
          <BaseButton variant="secondary" size="md" @click="showChangePaymentModal = false">
            Batal
          </BaseButton>
          <BaseButton variant="primary" size="md" data-testid="btn-confirm-change-payment" @click="confirmChangePayment">
            Simpan Perubahan
          </BaseButton>
        </div>
      </div>
    </BaseModal>

    <!-- Modal Batalkan Transaksi (Void) -->
    <BaseModal
      :open="showVoidModal"
      title="Batalkan Transaksi (Void)"
      @close="showVoidModal = false"
    >
      <div class="space-y-4">
        <div class="rounded-xl bg-amber-50 border border-amber-200 p-3 text-xs text-amber-800 dark:bg-amber-950/40 dark:border-amber-900/60 dark:text-amber-300">
          <p class="font-bold">Perhatian</p>
          <p class="mt-0.5">
            Membatalkan transaksi akan mengubah status transaksi menjadi batal, mengembalikan stok produk, dan memotong uang tunai pada shift kasir jika dibayar tunai.
          </p>
        </div>

        <div v-if="voidError" class="rounded-xl bg-danger/10 p-3 text-xs text-danger font-medium" data-testid="void-error">
          {{ voidError }}
        </div>

        <div>
          <label class="block text-xs font-semibold text-ink-primary mb-1">
            Alasan Pembatalan <span class="text-danger">*</span>
          </label>
          <textarea
            v-model="voidReason"
            rows="3"
            class="w-full rounded-xl border border-zinc-200 p-2.5 text-xs text-ink-primary placeholder:text-ink-secondary/50 focus:border-primary focus:outline-hidden dark:border-slate-700 dark:bg-slate-900 dark:text-white"
            placeholder="Contoh: Pelanggan salah pesan / transaksi dobel / pesanan dibatalkan..."
            data-testid="input-void-reason"
          ></textarea>
        </div>

        <div class="flex items-center justify-end gap-2 pt-2 border-t border-zinc-100 dark:border-slate-800">
          <BaseButton variant="secondary" size="md" @click="showVoidModal = false">
            Kembali
          </BaseButton>
          <BaseButton
            variant="danger"
            size="md"
            data-testid="btn-confirm-void"
            :disabled="!voidReason.trim()"
            @click="confirmVoidTransaction"
          >
            Konfirmasi Void
          </BaseButton>
        </div>
      </div>
    </BaseModal>
  </div>
</template>
