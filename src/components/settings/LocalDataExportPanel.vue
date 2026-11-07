<script setup>
import { computed, ref } from 'vue'

import AppIcon from '@/components/base/AppIcon.vue'
import BaseButton from '@/components/base/BaseButton.vue'
import {
  EXPORT_FORMATS,
  EXPORT_PERIODS,
  EXPORT_SCOPES,
  buildExportDataset,
  exportLocalPosData,
} from '@/services/dataExportService'
import { useBusinessStore } from '@/stores/businessStore'
import { useCashStore } from '@/stores/cashStore'
import { useCustomerStore } from '@/stores/customerStore'
import { useExpenseStore } from '@/stores/expenseStore'
import { useProductStore } from '@/stores/productStore'
import { useTransactionStore } from '@/stores/transactionStore'

const emit = defineEmits(['feedback'])

const businessStore = useBusinessStore()
const productStore = useProductStore()
const customerStore = useCustomerStore()
const transactionStore = useTransactionStore()
const cashStore = useCashStore()
const expenseStore = useExpenseStore()

const selectedScope = ref(EXPORT_SCOPES.ALL)
const selectedPeriod = ref(EXPORT_PERIODS.TODAY)
const customStartDate = ref('')
const customEndDate = ref('')
const exportingFormat = ref(null) // 'excel' | 'pdf' | null
const inlineStatus = ref(null) // { type: 'success' | 'error', message: string }

const scopeOptions = [
  {
    id: EXPORT_SCOPES.ALL,
    title: 'Semua Data',
    subtitle: 'Data Master + Penjualan, Kas & Pengeluaran',
    icon: 'backup',
  },
  {
    id: EXPORT_SCOPES.MASTER,
    title: 'Data Master',
    subtitle: 'Menu & Layanan, Stok, Kategori & Pelanggan',
    icon: 'products',
  },
  {
    id: EXPORT_SCOPES.SALES,
    title: 'Data Penjualan & Kas',
    subtitle: 'Transaksi, Item Terjual, Arus Kas & Pengeluaran',
    icon: 'transactions',
  },
]

const periodOptions = [
  { id: EXPORT_PERIODS.TODAY, label: 'Hari Ini' },
  { id: EXPORT_PERIODS.SEVEN_DAYS, label: '7 Hari' },
  { id: EXPORT_PERIODS.MONTH, label: 'Bulan Ini' },
  { id: EXPORT_PERIODS.ALL_TIME, label: 'Semua Waktu' },
  { id: EXPORT_PERIODS.CUSTOM, label: 'Pilih Tanggal' },
]

const showPeriodFilter = computed(() => selectedScope.value !== EXPORT_SCOPES.MASTER)

function getStoresSnapshot() {
  return {
    businessStore,
    productStore,
    customerStore,
    transactionStore,
    cashStore,
    expenseStore,
  }
}

const previewDataset = computed(() =>
  buildExportDataset(getStoresSnapshot(), {
    scope: selectedScope.value,
    period: selectedPeriod.value,
    startDate: customStartDate.value,
    endDate: customEndDate.value,
  }),
)

const previewSummaryText = computed(() => {
  const c = previewDataset.value.counts
  const parts = []
  if (selectedScope.value !== EXPORT_SCOPES.SALES) {
    parts.push(`${c.menus} Menu`)
    parts.push(`${c.stock} Stok`)
    parts.push(`${c.customers} Pelanggan`)
  }
  if (selectedScope.value !== EXPORT_SCOPES.MASTER) {
    parts.push(`${c.transactions} Transaksi`)
    parts.push(`${c.cashEntries} Kas`)
    parts.push(`${c.expenses} Pengeluaran`)
  }
  return `Siap diunduh: ${parts.join(' · ')}`
})

function selectScope(scopeId) {
  selectedScope.value = scopeId
  inlineStatus.value = null
}

function selectPeriod(periodId) {
  selectedPeriod.value = periodId
  inlineStatus.value = null
}

async function handleExport(format) {
  if (exportingFormat.value) return
  exportingFormat.value = format
  inlineStatus.value = null

  try {
    const result = await exportLocalPosData({
      stores: getStoresSnapshot(),
      scope: selectedScope.value,
      period: selectedPeriod.value,
      startDate: customStartDate.value,
      endDate: customEndDate.value,
      format,
    })

    if (!result.success) {
      inlineStatus.value = { type: 'error', message: result.error }
      emit('feedback', { type: 'error', message: result.error })
      return
    }

    const formatLabel = format === EXPORT_FORMATS.PDF ? 'PDF (.pdf)' : 'Excel (.xlsx)'
    const msg =
      result.mode === 'native-share'
        ? `File ${formatLabel} (${result.filename}) siap disimpan atau dibagikan.`
        : `File ${formatLabel} (${result.filename}) berhasil diunduh.`

    inlineStatus.value = { type: 'success', message: msg }
    emit('feedback', { type: 'success', message: msg })
  } catch (err) {
    const errMsg = `Gagal menyiapkan file export: ${err?.message || err}`
    inlineStatus.value = { type: 'error', message: errMsg }
    emit('feedback', { type: 'error', message: errMsg })
  } finally {
    exportingFormat.value = null
  }
}
</script>

<template>
  <div
    class="space-y-4 rounded-3xl border border-zinc-200 bg-surface/60 p-4 dark:border-slate-700/60 dark:bg-[#121726]"
    data-testid="local-export-panel"
  >
    <!-- Header -->
    <div class="flex items-start justify-between gap-3">
      <div class="flex items-center gap-3">
        <span
          class="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300"
        >
          <AppIcon name="download" />
        </span>
        <div class="min-w-0">
          <h4 class="text-base font-semibold text-ink-primary">
            Download &amp; Export Data (Excel / PDF)
          </h4>
          <p class="text-xs text-ink-secondary">
            Unduh laporan menu, stok, penjualan, dan kas untuk pembukuan.
          </p>
        </div>
      </div>

      <span
        class="shrink-0 rounded-full bg-emerald-100 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300"
      >
        Gratis
      </span>
    </div>

    <!-- 1. Scope Selector -->
    <div class="space-y-2" data-testid="export-scope-selector">
      <p class="text-xs font-semibold text-ink-secondary">1. Pilih Data yang Ingin Diunduh</p>
      <div class="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <button
          v-for="option in scopeOptions"
          :key="option.id"
          type="button"
          :data-testid="`export-scope-${option.id}`"
          :aria-pressed="selectedScope === option.id ? 'true' : 'false'"
          :class="[
            'flex items-start gap-2.5 rounded-2xl border p-3 text-left transition active:scale-[0.99] focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30',
            selectedScope === option.id
              ? 'border-primary bg-primary/8 shadow-xs dark:border-indigo-400 dark:bg-indigo-500/15'
              : 'border-zinc-200/90 bg-card hover:border-primary/40 dark:border-slate-700/60',
          ]"
          @click="selectScope(option.id)"
        >
          <span
            :class="[
              'mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl transition',
              selectedScope === option.id
                ? 'bg-primary text-white dark:bg-indigo-500'
                : 'bg-zinc-100 text-zinc-600 dark:bg-slate-800 dark:text-slate-300',
            ]"
          >
            <AppIcon :name="option.icon" class="h-4 w-4" />
          </span>
          <span class="min-w-0 flex-1">
            <span class="block text-xs font-bold text-ink-primary">{{ option.title }}</span>
            <span class="mt-0.5 block text-[11px] leading-snug text-ink-secondary">
              {{ option.subtitle }}
            </span>
          </span>
        </button>
      </div>
    </div>

    <!-- 2. Period Filter (Shown when Sales/Cash data is included) -->
    <div v-if="showPeriodFilter" class="space-y-2.5" data-testid="export-period-filter">
      <p class="text-xs font-semibold text-ink-secondary">
        2. Periode Data Penjualan &amp; Kas
      </p>

      <div class="flex flex-wrap gap-1.5">
        <button
          v-for="period in periodOptions"
          :key="period.id"
          type="button"
          :data-testid="`export-period-${period.id}`"
          :aria-pressed="selectedPeriod === period.id ? 'true' : 'false'"
          :class="[
            'rounded-xl border px-3 py-1.5 text-xs font-semibold transition active:scale-95',
            selectedPeriod === period.id
              ? 'border-primary bg-primary text-white shadow-xs dark:border-indigo-400 dark:bg-indigo-500'
              : 'border-zinc-200 bg-card text-ink-secondary hover:border-primary/40 hover:text-ink-primary dark:border-slate-700/60',
          ]"
          @click="selectPeriod(period.id)"
        >
          {{ period.label }}
        </button>
      </div>

      <!-- Custom Date Range Inputs -->
      <div
        v-if="selectedPeriod === EXPORT_PERIODS.CUSTOM"
        class="grid grid-cols-1 gap-2.5 pt-1 sm:grid-cols-2"
        data-testid="export-custom-dates"
      >
        <label class="space-y-1 text-xs">
          <span class="block font-medium text-ink-secondary">Dari Tanggal</span>
          <input
            v-model="customStartDate"
            type="date"
            data-testid="export-start-date"
            class="w-full rounded-xl border border-zinc-200 bg-card px-3 py-2 text-xs text-ink-primary focus:border-primary focus:outline-none dark:border-slate-700"
          />
        </label>
        <label class="space-y-1 text-xs">
          <span class="block font-medium text-ink-secondary">Sampai Tanggal</span>
          <input
            v-model="customEndDate"
            type="date"
            data-testid="export-end-date"
            class="w-full rounded-xl border border-zinc-200 bg-card px-3 py-2 text-xs text-ink-primary focus:border-primary focus:outline-none dark:border-slate-700"
          />
        </label>
      </div>
    </div>

    <!-- Live Data Count Preview -->
    <div
      class="flex items-center justify-between gap-2 rounded-2xl border border-zinc-200/80 bg-card px-3.5 py-2.5 text-xs dark:border-slate-700/60"
      data-testid="export-preview-summary"
    >
      <span class="text-ink-secondary">{{ previewSummaryText }}</span>
      <span class="shrink-0 font-semibold text-primary dark:text-indigo-300">
        {{ previewDataset.periodLabel }}
      </span>
    </div>

    <!-- Inline Status Notice -->
    <p
      v-if="inlineStatus"
      data-testid="local-export-feedback"
      class="rounded-2xl px-3.5 py-2.5 text-xs font-medium"
      :class="
        inlineStatus.type === 'error'
          ? 'border border-danger/20 bg-danger/10 text-danger'
          : 'border border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-950/40 dark:text-emerald-300'
      "
    >
      {{ inlineStatus.message }}
    </p>

    <!-- 3. Download Format Buttons -->
    <div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
      <BaseButton
        block
        data-testid="btn-export-excel"
        :loading="exportingFormat === EXPORT_FORMATS.EXCEL"
        :disabled="Boolean(exportingFormat)"
        @click="handleExport(EXPORT_FORMATS.EXCEL)"
      >
        <AppIcon name="excel" class="h-4 w-4" />
        <span>Download Excel (.xlsx)</span>
      </BaseButton>

      <BaseButton
        variant="secondary"
        block
        data-testid="btn-export-pdf"
        :loading="exportingFormat === EXPORT_FORMATS.PDF"
        :disabled="Boolean(exportingFormat)"
        @click="handleExport(EXPORT_FORMATS.PDF)"
      >
        <AppIcon name="pdf" class="h-4 w-4" />
        <span>Download PDF (.pdf)</span>
      </BaseButton>
    </div>
  </div>
</template>
