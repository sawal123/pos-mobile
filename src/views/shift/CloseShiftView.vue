<script setup>
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'

import AppIcon from '@/components/base/AppIcon.vue'
import BaseButton from '@/components/base/BaseButton.vue'
import BaseCard from '@/components/base/BaseCard.vue'
import BaseInput from '@/components/base/BaseInput.vue'
import BaseModal from '@/components/base/BaseModal.vue'
import { printShiftReceipt } from '@/services/printer/bluetoothPrinterService'
import { useBusinessStore } from '@/stores/businessStore'
import { useCashierStore } from '@/stores/cashierStore'
import { useCashStore } from '@/stores/cashStore'
import { usePrinterStore } from '@/stores/printerStore'
import { useReceiptStore } from '@/stores/receiptStore'
import { useShiftStore } from '@/stores/shiftStore'
import { isPaidTransaction, useTransactionStore } from '@/stores/transactionStore'
import { formatCurrency } from '@/utils/formatters'

const router = useRouter()
const businessStore = useBusinessStore()
const cashierStore = useCashierStore()
const cashStore = useCashStore()
const printerStore = usePrinterStore()
const receiptStore = useReceiptStore()
const shiftStore = useShiftStore()
const transactionStore = useTransactionStore()

const openingBalance = computed(() => Number(shiftStore.openingBalance) || 0)
const openedAt = computed(() => shiftStore.openedAt)

// Transactions in shift
const shiftTransactions = computed(() => {
  if (!shiftStore.isOpen || !openedAt.value) return []
  const startTime = new Date(openedAt.value).getTime()
  return transactionStore.items.filter((tx) => {
    const txTime = new Date(tx.createdAt).getTime()
    return txTime >= startTime
  })
})

const cashSalesTotal = computed(() => {
  return shiftTransactions.value
    .filter((tx) => (tx.paymentMethod || '').toLowerCase() === 'cash' && isPaidTransaction(tx))
    .reduce((sum, tx) => sum + (Number(tx.total) || 0), 0)
})

const nonCashSalesTotal = computed(() => {
  return shiftTransactions.value
    .filter((tx) => (tx.paymentMethod || '').toLowerCase() !== 'cash' && isPaidTransaction(tx))
    .reduce((sum, tx) => sum + (Number(tx.total) || 0), 0)
})

const totalOmzet = computed(() => cashSalesTotal.value + nonCashSalesTotal.value)
const totalTxCount = computed(() => shiftTransactions.value.length)

// Manual cash entries in shift
const manualCashEntries = computed(() => {
  if (!shiftStore.isOpen || !openedAt.value) return []
  const startTime = new Date(openedAt.value).getTime()
  return cashStore.entries.filter((entry) => {
    const entryTime = new Date(entry.createdAt).getTime()
    if (entryTime < startTime) return false
    if (entry.category === 'Saldo Awal' || entry.referenceId?.startsWith('opening-')) return false
    if (entry.category === 'Penjualan Cash' || entry.referenceId?.startsWith('sale-')) return false
    return true
  })
})

const manualCashIn = computed(() => {
  return manualCashEntries.value
    .filter((e) => e.type === 'in')
    .reduce((sum, e) => sum + (Number(e.amount) || 0), 0)
})

const manualCashOut = computed(() => {
  return manualCashEntries.value
    .filter((e) => e.type === 'out')
    .reduce((sum, e) => sum + (Number(e.amount) || 0), 0)
})

const expectedCash = computed(() => {
  return openingBalance.value + cashSalesTotal.value + manualCashIn.value - manualCashOut.value
})

const countedCashInput = ref(String(expectedCash.value))
const closeNotes = ref('')
const showSummaryModal = ref(false)
const summaryData = ref(null)
const isPrintingShift = ref(false)
const printShiftFeedback = ref('')
const printShiftError = ref('')

const countedCashNumber = computed(() => {
  const val = Number(countedCashInput.value)
  return Number.isFinite(val) && val >= 0 ? val : 0
})

const difference = computed(() => {
  return countedCashNumber.value - expectedCash.value
})

const isNotesRequired = computed(() => difference.value !== 0)
const canCloseShift = computed(() => !isNotesRequired.value || Boolean(closeNotes.value.trim()))

function setExactCounted() {
  countedCashInput.value = String(expectedCash.value)
}

function handleCloseShift() {
  if (!canCloseShift.value) return

  summaryData.value = {
    cashier: cashierStore.activeCashier?.name || 'Kasir Utama',
    totalOmzet: totalOmzet.value,
    totalTransactions: totalTxCount.value,
    openingBalance: openingBalance.value,
    cashSales: cashSalesTotal.value,
    nonCashSales: nonCashSalesTotal.value,
    manualCashIn: manualCashIn.value,
    manualCashOut: manualCashOut.value,
    expectedCash: expectedCash.value,
    actualCash: countedCashNumber.value,
    difference: difference.value,
    notes: closeNotes.value,
    openedAt: openedAt.value,
    closedAt: new Date().toISOString(),
  }

  shiftStore.closeShift(countedCashNumber.value, closeNotes.value)
  showSummaryModal.value = true
}

async function handlePrintShiftReceipt() {
  if (isPrintingShift.value || !summaryData.value) return
  isPrintingShift.value = true
  printShiftFeedback.value = ''
  printShiftError.value = ''

  try {
    const res = await printShiftReceipt({
      shiftSummary: summaryData.value,
      business: businessStore.business,
      printer: printerStore.selectedPrinter,
      paperWidth: printerStore.paperWidth,
      receiptSettings: receiptStore.settings,
      outlet: businessStore.outlet,
    })

    if (!res.success) {
      printShiftError.value = res.message || 'Gagal mencetak struk rekap shift.'
    } else {
      printShiftFeedback.value = 'Struk rekap shift berhasil dikirim ke printer.'
    }
  } catch (err) {
    printShiftError.value = err.message || 'Terjadi kesalahan saat mencetak.'
  } finally {
    isPrintingShift.value = false
  }
}

function handleDone() {
  showSummaryModal.value = false
  router.push('/home')
}
</script>

<template>
  <div class="mx-auto max-w-xl space-y-4 pb-28">
    <header class="flex items-center gap-3 pt-1">
      <button
        type="button"
        data-testid="close-shift-back-btn"
        class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-zinc-200 bg-white text-ink-primary transition active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
        aria-label="Kembali"
        @click="router.back()"
      >
        <AppIcon name="chevron-left" />
      </button>
      <div class="min-w-0">
        <p class="text-xs font-semibold uppercase tracking-wider text-danger">Tutup Shift</p>
        <h2 class="truncate text-xl font-bold text-ink-primary sm:text-2xl">Penutupan Kasir</h2>
      </div>
    </header>

    <BaseCard class="space-y-4 p-5" data-testid="close-shift-card">
      <div class="flex items-center gap-3">
        <span class="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-danger/10 text-danger">
          <AppIcon name="shift" class="h-6 w-6" />
        </span>
        <div class="min-w-0">
          <h3 class="text-base font-bold text-ink-primary">Rekonsiliasi Kas Laci</h3>
          <p class="text-xs text-ink-secondary">
            Kasir: {{ cashierStore.activeCashier?.name || 'Kasir Utama' }} • {{ businessStore.outlet || 'Outlet Utama' }}
          </p>
        </div>
      </div>

      <!-- Formula Rekonsiliasi Kas -->
      <div class="rounded-2xl border border-blue-200/80 bg-blue-50/60 p-3.5 space-y-1 text-xs dark:bg-blue-950/30 dark:border-blue-900/40">
        <p class="font-bold uppercase tracking-wider text-[11px] text-blue-700 dark:text-blue-300">
          Formula Rekonsiliasi Kas:
        </p>
        <p class="font-mono text-xs font-semibold text-blue-900 dark:text-blue-200" data-testid="reconciliation-formula">
          Estimasi Kas = Kas Awal + Penjualan Tunai + Kas Masuk - Kas Keluar
        </p>
      </div>

      <!-- Detail Perhitungan Kas -->
      <div class="rounded-2xl border border-zinc-200/80 bg-surface/70 p-4 space-y-2.5 text-xs">
        <div class="flex items-center justify-between">
          <span class="text-ink-secondary">Estimasi Uang Fisik Seharusnya:</span>
          <span class="font-mono text-base font-bold text-ink-primary" data-testid="close-expected-amount">
            {{ formatCurrency(expectedCash) }}
          </span>
        </div>

        <div class="border-t border-zinc-200/60 pt-2 space-y-1 text-ink-secondary text-[11px]">
          <div class="flex justify-between">
            <span>Saldo Awal Modal:</span>
            <span>+{{ formatCurrency(openingBalance) }}</span>
          </div>
          <div class="flex justify-between">
            <span>Penjualan Tunai:</span>
            <span>+{{ formatCurrency(cashSalesTotal) }}</span>
          </div>
          <div v-if="manualCashIn > 0" class="flex justify-between">
            <span>Kas Masuk Tambahan:</span>
            <span>+{{ formatCurrency(manualCashIn) }}</span>
          </div>
          <div v-if="manualCashOut > 0" class="flex justify-between text-danger">
            <span>Kas Keluar / Biaya:</span>
            <span>-{{ formatCurrency(manualCashOut) }}</span>
          </div>
        </div>
      </div>

      <!-- Input Hitung Kas Fisik -->
      <div class="space-y-1.5">
        <div class="flex items-center justify-between text-xs">
          <label class="font-semibold text-ink-primary">Hitung Uang Tunai di Laci (Fisik)</label>
          <button
            type="button"
            class="text-[11px] font-semibold text-primary hover:underline"
            @click="setExactCounted"
          >
            Isi Sesuai Estimasi
          </button>
        </div>
        <BaseInput
          v-model="countedCashInput"
          type="number"
          data-testid="input-physical-cash"
          placeholder="Masukkan jumlah uang fisik di laci kasir"
        />
      </div>

      <!-- Selisih Banner -->
      <div
        class="rounded-2xl p-3 flex items-center justify-between text-xs"
        :class="{
          'bg-emerald-50 text-emerald-800 border border-emerald-200': difference === 0,
          'bg-danger/10 text-danger border border-danger/20': difference < 0,
          'bg-blue-50 text-blue-800 border border-blue-200': difference > 0,
        }"
        data-testid="close-diff-banner"
      >
        <span class="font-medium">
          {{
            difference === 0
              ? '✓ Uang kas di laci pas (Sesuai)'
              : difference < 0
                ? '⚠ Selisih Kurang (Uang fisik kurang)'
                : '★ Selisih Lebih (Uang fisik berlebih)'
          }}
        </span>
        <span class="font-mono font-bold text-sm">
          {{ difference === 0 ? 'Rp 0' : formatCurrency(difference) }}
        </span>
      </div>

      <!-- Catatan / Alasan Selisih Kas -->
      <div class="space-y-1 text-xs">
        <label class="font-medium text-ink-secondary">
          {{ isNotesRequired ? 'Alasan / Keterangan Selisih Kas' : 'Catatan Tutup Shift (Opsional)' }}
          <span v-if="isNotesRequired" class="text-danger font-bold">* (Wajib diisi)</span>
        </label>
        <textarea
          v-model="closeNotes"
          rows="2"
          placeholder="Tuliskan keterangan jika ada selisih uang kas..."
          class="w-full rounded-2xl border border-zinc-200 bg-white p-2.5 text-xs text-ink-primary outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
          data-testid="input-close-shift-notes"
        />
        <p v-if="isNotesRequired && !closeNotes.trim()" class="text-[11px] text-danger font-medium" data-testid="error-notes-required">
          Wajib memberikan keterangan/alasan jika terdapat selisih uang kas fisik.
        </p>
      </div>

      <div class="flex gap-2 pt-1">
        <BaseButton
          variant="secondary"
          class="flex-1"
          @click="router.back()"
        >
          Batal
        </BaseButton>
        <BaseButton
          variant="danger"
          class="flex-1"
          data-testid="btn-execute-close"
          :disabled="!canCloseShift"
          @click="handleCloseShift"
        >
          Konfirmasi Tutup Shift
        </BaseButton>
      </div>
    </BaseCard>

    <!-- Ringkasan Laporan Tutup Shift Modal -->
    <BaseModal
      :open="showSummaryModal"
      title="Laporan Shift Selesai"
      @close="handleDone"
    >
      <div v-if="summaryData" class="space-y-4 text-xs">
        <div class="rounded-2xl bg-emerald-50 border border-emerald-200/80 p-3.5 text-center space-y-1">
          <p class="text-xs font-semibold uppercase tracking-wider text-emerald-800">Shift Telah Ditutup</p>
          <p class="font-mono text-2xl font-extrabold text-ink-primary">
            {{ formatCurrency(summaryData.totalOmzet) }}
          </p>
          <p class="text-[11px] text-emerald-700">{{ summaryData.totalTransactions }} Transaksi Selesai</p>
        </div>

        <div class="rounded-2xl border border-zinc-200 bg-surface p-3.5 space-y-2">
          <div class="flex justify-between">
            <span class="text-ink-secondary">Kasir</span>
            <span class="font-semibold text-ink-primary">{{ summaryData.cashier }}</span>
          </div>
          <div class="flex justify-between border-t border-zinc-200/60 pt-2">
            <span class="text-ink-secondary">Saldo Awal</span>
            <span class="font-semibold text-ink-primary">{{ formatCurrency(summaryData.openingBalance) }}</span>
          </div>
          <div class="flex justify-between">
            <span class="text-ink-secondary">Penjualan Tunai</span>
            <span class="font-semibold text-emerald-700">+{{ formatCurrency(summaryData.cashSales) }}</span>
          </div>
          <div class="flex justify-between">
            <span class="text-ink-secondary">Penjualan Non-Tunai</span>
            <span class="font-semibold text-blue-700">+{{ formatCurrency(summaryData.nonCashSales) }}</span>
          </div>
          <div class="flex justify-between border-t border-zinc-200/60 pt-2">
            <span class="text-ink-secondary">Uang Fisik Kas di Laci</span>
            <span class="font-mono font-bold text-ink-primary">{{ formatCurrency(summaryData.actualCash) }}</span>
          </div>
          <div class="flex justify-between">
            <span class="text-ink-secondary">Selisih Kas</span>
            <span
              class="font-mono font-bold"
              :class="summaryData.difference === 0 ? 'text-emerald-700' : summaryData.difference < 0 ? 'text-danger' : 'text-blue-700'"
            >
              {{ summaryData.difference === 0 ? 'Pas (Rp 0)' : formatCurrency(summaryData.difference) }}
            </span>
          </div>
          <div v-if="summaryData.notes" class="border-t border-zinc-200/60 pt-2">
            <p class="text-ink-secondary">Catatan / Alasan Selisih:</p>
            <p class="italic text-ink-primary">{{ summaryData.notes }}</p>
          </div>
        </div>

        <!-- Print Feedback / Error -->
        <div v-if="printShiftFeedback" class="rounded-xl bg-emerald-50 border border-emerald-200 p-2.5 text-xs text-emerald-800 font-medium" data-testid="print-shift-feedback">
          {{ printShiftFeedback }}
        </div>
        <div v-if="printShiftError" class="rounded-xl bg-danger/10 p-2.5 text-xs text-danger font-medium" data-testid="print-shift-error">
          {{ printShiftError }}
        </div>

        <div class="flex flex-col gap-2 pt-2">
          <BaseButton
            variant="secondary"
            block
            size="md"
            class="gap-2"
            :disabled="isPrintingShift"
            data-testid="btn-print-shift-receipt"
            @click="handlePrintShiftReceipt"
          >
            <svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="6 9 6 2 18 2 18 9" />
              <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
              <rect x="6" y="14" width="12" height="8" />
            </svg>
            <span>{{ isPrintingShift ? 'Mencetak Rekap...' : 'Cetak Struk Rekap Shift (Z-Report)' }}</span>
          </BaseButton>

          <BaseButton block size="lg" @click="handleDone">
            Kembali ke Beranda
          </BaseButton>
        </div>
      </div>
    </BaseModal>
  </div>
</template>
