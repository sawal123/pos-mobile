<script setup>
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'

import AppIcon from '@/components/base/AppIcon.vue'
import BaseButton from '@/components/base/BaseButton.vue'
import BaseModal from '@/components/base/BaseModal.vue'
import { useBusinessStore } from '@/stores/businessStore'
import { useExpenseStore } from '@/stores/expenseStore'
import { isPaidTransaction, useTransactionStore } from '@/stores/transactionStore'
import { formatCurrency, formatDateTime } from '@/utils/formatters'

const router = useRouter()
const businessStore = useBusinessStore()
const expenseStore = useExpenseStore()
const transactionStore = useTransactionStore()

// Period filter: 'all' | 'today' | '7days' | 'month'
const selectedPeriod = ref('all')
const showReceiptModal = ref(false)
const copiedNotice = ref(false)

const periods = [
  { id: 'all', label: 'Semua Waktu' },
  { id: 'today', label: 'Hari Ini' },
  { id: '7days', label: '7 Hari' },
  { id: 'month', label: 'Bulan Ini' },
]

function isSameDay(d1, d2) {
  return (
    d1.getFullYear() === d2.getFullYear() &&
    d1.getMonth() === d2.getMonth() &&
    d1.getDate() === d2.getDate()
  )
}

function matchesPeriod(dateString, period) {
  if (period === 'all') return true
  if (!dateString) return false
  const date = new Date(dateString)
  if (Number.isNaN(date.getTime())) return false

  const now = new Date()

  if (period === 'today') {
    return isSameDay(date, now)
  }

  if (period === '7days') {
    const diffTime = now.getTime() - date.getTime()
    const diffDays = diffTime / (1000 * 3600 * 24)
    return diffDays >= 0 && diffDays <= 7
  }

  if (period === 'month') {
    return (
      date.getFullYear() === now.getFullYear() &&
      date.getMonth() === now.getMonth()
    )
  }

  return true
}

const periodLabel = computed(() => {
  switch (selectedPeriod.value) {
    case 'today':
      return 'Hari Ini'
    case '7days':
      return '7 Hari Terakhir'
    case 'month':
      return 'Bulan Ini'
    case 'all':
    default:
      return 'Semua Waktu'
  }
})

// Filtered Transactions
const filteredTransactions = computed(() =>
  transactionStore.items.filter((t) =>
    matchesPeriod(t.paidAt || t.createdAt, selectedPeriod.value),
  ),
)

const paidTransactions = computed(() =>
  filteredTransactions.value.filter(isPaidTransaction),
)

// Financial Key Figures
const revenue = computed(() =>
  paidTransactions.value.reduce((sum, t) => sum + Number(t.total || 0), 0),
)

const grossProfit = computed(() =>
  paidTransactions.value.reduce(
    (sum, t) => sum + Number(t.grossProfit || 0),
    0,
  ),
)

// Filtered Expenses
const filteredExpenses = computed(() =>
  expenseStore.expenses.filter((e) =>
    matchesPeriod(e.createdAt, selectedPeriod.value),
  ),
)

const totalExpenses = computed(() =>
  filteredExpenses.value.reduce((sum, e) => sum + Number(e.amount || 0), 0),
)

// Net Profit = Gross Profit - Total Expenses
const netProfit = computed(() => grossProfit.value - totalExpenses.value)

// Total HPP = Omzet - Gross Profit
const totalHpp = computed(() => Math.max(0, revenue.value - grossProfit.value))

// Margin (%)
const netMargin = computed(() =>
  revenue.value > 0 ? Math.round((netProfit.value / revenue.value) * 100) : 0,
)

// Payment Methods Breakdown
const paymentBreakdown = computed(() => {
  const result = {
    cash: { count: 0, total: 0, label: 'Tunai (Cash)', icon: 'cash' },
    qris: { count: 0, total: 0, label: 'QRIS', icon: 'pos' },
    transfer: { count: 0, total: 0, label: 'Transfer Bank', icon: 'sync' },
    other: { count: 0, total: 0, label: 'Lainnya', icon: 'more' },
  }

  for (const trx of paidTransactions.value) {
    const method = (trx.paymentMethod || 'cash').toLowerCase()
    const amount = Number(trx.total || 0)

    if (method === 'cash') {
      result.cash.count++
      result.cash.total += amount
    } else if (method === 'qris') {
      result.qris.count++
      result.qris.total += amount
    } else if (method.includes('transfer') || method === 'bank') {
      result.transfer.count++
      result.transfer.total += amount
    } else {
      result.other.count++
      result.other.total += amount
    }
  }

  return Object.values(result).map((p) => ({
    ...p,
    percent: revenue.value > 0 ? Math.round((p.total / revenue.value) * 100) : 0,
  }))
})

// Top Selling Products
const topSellingItems = computed(() => {
  const map = new Map()

  for (const trx of paidTransactions.value) {
    if (!Array.isArray(trx.items)) continue

    for (const item of trx.items) {
      const name = item.name || 'Produk'
      const qty = Number(item.qty || 1)
      const price = Number(item.price || 0)
      const itemTotal = price * qty

      if (!map.has(name)) {
        map.set(name, {
          name,
          category: item.category || 'Umum',
          qty: 0,
          total: 0,
        })
      }

      const current = map.get(name)
      current.qty += qty
      current.total += itemTotal
    }
  }

  return Array.from(map.values())
    .sort((a, b) => b.qty - a.qty || b.total - a.total)
    .slice(0, 5)
})

// Expense Categories Breakdown
const expenseCategoryBreakdown = computed(() => {
  const map = new Map()

  for (const exp of filteredExpenses.value) {
    const cat = exp.category || 'Lainnya'
    const amount = Number(exp.amount || 0)

    if (!map.has(cat)) {
      map.set(cat, { category: cat, total: 0, count: 0 })
    }
    const current = map.get(cat)
    current.total += amount
    current.count++
  }

  return Array.from(map.values())
    .map((c) => ({
      ...c,
      percent:
        totalExpenses.value > 0
          ? Math.round((c.total / totalExpenses.value) * 100)
          : 0,
    }))
    .sort((a, b) => b.total - a.total)
})

// Copy text receipt to clipboard
function copyReportReceipt() {
  const lines = [
    `=== RINGKASAN LAPORAN KEUANGAN ===`,
    `${businessStore.name || 'POS Mobile'} - ${businessStore.outlet || 'Outlet Utama'}`,
    `Periode: ${periodLabel.value}`,
    `Dicetak: ${formatDateTime(new Date().toISOString())}`,
    `----------------------------------`,
    `Total Transaksi : ${filteredTransactions.value.length} (${paidTransactions.value.length} lunas)`,
    `Omzet Penjualan : ${formatCurrency(revenue.value)}`,
    `Estimasi HPP    : ${formatCurrency(totalHpp.value)}`,
    `Laba Kotor (GP) : ${formatCurrency(grossProfit.value)}`,
    `Total Biaya     : ${formatCurrency(totalExpenses.value)}`,
    `----------------------------------`,
    `LABA BERSIH     : ${formatCurrency(netProfit.value)} (Margin ${netMargin.value}%)`,
    `==================================`,
  ]

  const text = lines.join('\n')
  navigator.clipboard?.writeText?.(text)
  copiedNotice.value = true
  setTimeout(() => {
    copiedNotice.value = false
  }, 2500)
}
</script>

<template>
  <div class="mx-auto max-w-xl space-y-4 pb-36">
    <!-- Header Minimalis & Simple -->
    <header class="flex items-center justify-between gap-1.5">
      <div class="flex items-center gap-2 min-w-0">
        <button
          type="button"
          class="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-zinc-200 bg-white text-ink-primary shadow-xs transition hover:bg-zinc-50 active:scale-95"
          aria-label="Kembali ke Home"
          @click="router.push('/home')"
        >
          <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
          </svg>
        </button>

        <div class="min-w-0">
          <p class="text-[9px] font-bold uppercase tracking-wider text-primary">Finansial</p>
          <h1 class="text-xs sm:text-sm font-bold tracking-tight text-ink-primary whitespace-nowrap">Laporan Keuangan</h1>
        </div>
      </div>

      <button
        type="button"
        class="inline-flex shrink-0 items-center gap-1 rounded-xl border border-zinc-200 bg-white px-2 py-1 text-[11px] font-semibold text-zinc-700 shadow-xs transition hover:bg-zinc-50 active:scale-95"
        @click="showReceiptModal = true"
      >
        <svg class="h-3.5 w-3.5 text-zinc-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
        <span class="whitespace-nowrap">Ringkasan Struk</span>
      </button>
    </header>

    <!-- Period Segmented Control (Minimal & Simple) -->
    <section class="flex rounded-2xl bg-zinc-100 p-1 text-[11px]">
      <button
        v-for="p in periods"
        :key="p.id"
        type="button"
        class="flex-1 py-1.5 px-1 text-center font-medium rounded-xl transition-all whitespace-nowrap"
        :class="selectedPeriod === p.id ? 'bg-white font-bold text-ink-primary shadow-xs' : 'text-zinc-500 hover:text-ink-primary'"
        @click="selectedPeriod = p.id"
      >
        {{ p.label }}
      </button>
    </section>

    <!-- Unified Minimalist Financial Card -->
    <section class="rounded-3xl border border-zinc-200/80 bg-white p-4 sm:p-5 shadow-soft space-y-3">
      <!-- Top: Label & Status Badge -->
      <div class="flex items-center justify-between gap-2">
        <p class="text-[11px] font-medium text-ink-secondary">
          Estimasi Laba Bersih
        </p>

        <span
          class="shrink-0 inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-semibold"
          :class="netProfit >= 0 ? 'bg-emerald-50 text-emerald-700 border border-emerald-200/60' : 'bg-rose-50 text-rose-700 border border-rose-200/60'"
        >
          <span class="h-1.5 w-1.5 rounded-full" :class="netProfit >= 0 ? 'bg-emerald-500' : 'bg-rose-500'" />
          {{ netProfit >= 0 ? 'Profit Bersih' : 'Defisit Usaha' }}
        </span>
      </div>

      <!-- Net Profit Number & Margin -->
      <div class="flex items-baseline justify-between gap-2">
        <h2
          class="font-mono text-xl sm:text-2xl font-bold tracking-tight"
          :class="netProfit >= 0 ? 'text-emerald-600' : 'text-rose-600'"
          data-testid="reports-net-profit"
        >
          {{ formatCurrency(netProfit) }}
        </h2>
        <p class="text-[11px] text-ink-secondary shrink-0">
          Margin: <span class="font-semibold" :class="netMargin >= 0 ? 'text-emerald-700' : 'text-rose-700'">{{ netMargin }}%</span>
        </p>
      </div>

      <!-- 4 Core Metrics Grid -->
      <div class="grid grid-cols-2 gap-2 pt-3 border-t border-zinc-100">
        <!-- Omzet -->
        <div class="rounded-2xl bg-zinc-50/70 p-2.5 sm:p-3 border border-zinc-100 min-w-0">
          <p class="text-[11px] font-medium text-ink-secondary">Omzet</p>
          <p class="mt-0.5 font-mono text-xs sm:text-sm font-bold text-ink-primary truncate" data-testid="reports-revenue">
            {{ formatCurrency(revenue) }}
          </p>
          <span class="text-[10px] text-zinc-400 mt-0.5 block truncate">
            {{ paidTransactions.length }} lunas
          </span>
        </div>

        <!-- Transaksi -->
        <div class="rounded-2xl bg-zinc-50/70 p-2.5 sm:p-3 border border-zinc-100 min-w-0">
          <p class="text-[11px] font-medium text-ink-secondary">Transaksi</p>
          <p class="mt-0.5 text-xs sm:text-sm font-bold text-ink-primary truncate" data-testid="reports-transactions-count">
            {{ filteredTransactions.length }}
          </p>
          <span class="text-[10px] text-zinc-400 mt-0.5 block truncate">
            Total nota
          </span>
        </div>

        <!-- Gross Profit -->
        <div class="rounded-2xl bg-zinc-50/70 p-2.5 sm:p-3 border border-zinc-100 min-w-0">
          <p class="text-[11px] font-medium text-ink-secondary">Gross Profit</p>
          <p class="mt-0.5 font-mono text-xs sm:text-sm font-bold text-emerald-600 truncate" data-testid="reports-gross-profit">
            {{ formatCurrency(grossProfit) }}
          </p>
          <span class="text-[10px] text-emerald-600/80 mt-0.5 block truncate">
            Laba kotor
          </span>
        </div>

        <!-- Pengeluaran -->
        <div class="rounded-2xl bg-zinc-50/70 p-2.5 sm:p-3 border border-zinc-100 min-w-0">
          <p class="text-[11px] font-medium text-ink-secondary">Pengeluaran</p>
          <p class="mt-0.5 font-mono text-xs sm:text-sm font-bold text-rose-600 truncate" data-testid="reports-expenses">
            {{ formatCurrency(totalExpenses) }}
          </p>
          <span class="text-[10px] text-rose-600/80 mt-0.5 block truncate">
            {{ filteredExpenses.length }} catatan biaya
          </span>
        </div>
      </div>
    </section>

    <!-- Metode Pembayaran (Clean & Simple) -->
    <section class="rounded-3xl border border-zinc-200/80 bg-white p-4 sm:p-5 shadow-soft space-y-3">
      <div class="flex items-center justify-between">
        <h3 class="text-sm font-bold text-ink-primary">Metode Pembayaran</h3>
        <span class="text-xs text-ink-secondary">{{ paidTransactions.length }} nota lunas</span>
      </div>

      <div class="divide-y divide-zinc-100">
        <div
          v-for="p in paymentBreakdown"
          :key="p.label"
          class="flex items-center justify-between py-2.5 first:pt-0 last:pb-0 text-xs"
        >
          <div class="flex items-center gap-2.5 min-w-0">
            <span class="flex h-7 w-7 shrink-0 items-center justify-center rounded-xl bg-zinc-100 text-zinc-600">
              <AppIcon :name="p.icon" class="h-3.5 w-3.5" />
            </span>
            <div class="min-w-0">
              <p class="truncate font-semibold text-ink-primary">{{ p.label }}</p>
              <p class="text-[10px] text-ink-secondary">{{ p.count }} transaksi</p>
            </div>
          </div>
          <div class="text-right shrink-0">
            <p class="font-mono font-bold text-ink-primary">{{ formatCurrency(p.total) }}</p>
            <p class="text-[10px] text-ink-secondary">{{ p.percent }}%</p>
          </div>
        </div>
      </div>
    </section>

    <!-- Produk Terlaris (Clean & Simple List) -->
    <section class="rounded-3xl border border-zinc-200/80 bg-white p-4 sm:p-5 shadow-soft space-y-3">
      <div class="flex items-center justify-between">
        <h3 class="text-sm font-bold text-ink-primary">Produk Terlaris</h3>
        <span class="text-xs font-semibold text-primary">Top {{ topSellingItems.length }}</span>
      </div>

      <div v-if="topSellingItems.length" class="divide-y divide-zinc-100">
        <div
          v-for="(item, idx) in topSellingItems"
          :key="item.name"
          class="flex items-center justify-between py-2.5 first:pt-0 last:pb-0 text-xs"
        >
          <div class="flex items-center gap-2.5 min-w-0">
            <span class="flex h-5 w-5 shrink-0 items-center justify-center rounded-lg bg-zinc-100 text-[10px] font-bold text-zinc-600">
              {{ idx + 1 }}
            </span>
            <div class="min-w-0">
              <p class="truncate font-semibold text-ink-primary">{{ item.name }}</p>
              <p class="text-[10px] text-ink-secondary">{{ item.qty }} terjual</p>
            </div>
          </div>
          <div class="text-right shrink-0">
            <p class="font-mono font-bold text-ink-primary">{{ formatCurrency(item.total) }}</p>
          </div>
        </div>
      </div>
      <div v-else class="py-4 text-center text-xs text-zinc-400">
        Belum ada item penjualan tercatat pada periode ini.
      </div>
    </section>

    <!-- Pos Pengeluaran (Clean & Simple List, jika ada) -->
    <section v-if="expenseCategoryBreakdown.length" class="rounded-3xl border border-zinc-200/80 bg-white p-4 sm:p-5 shadow-soft space-y-3">
      <div class="flex items-center justify-between">
        <h3 class="text-sm font-bold text-ink-primary">Pos Pengeluaran</h3>
        <span class="font-mono text-xs font-bold text-rose-600">{{ formatCurrency(totalExpenses) }}</span>
      </div>

      <div class="divide-y divide-zinc-100">
        <div
          v-for="cat in expenseCategoryBreakdown"
          :key="cat.category"
          class="flex items-center justify-between py-2.5 first:pt-0 last:pb-0 text-xs"
        >
          <div>
            <p class="font-semibold text-ink-primary">{{ cat.category }}</p>
            <p class="text-[10px] text-ink-secondary">{{ cat.count }} catatan</p>
          </div>
          <div class="text-right">
            <p class="font-mono font-bold text-ink-primary">{{ formatCurrency(cat.total) }}</p>
            <p class="text-[10px] text-ink-secondary">{{ cat.percent }}%</p>
          </div>
        </div>
      </div>
    </section>

    <!-- Modal: Ringkasan Struk Laporan Keuangan -->
    <BaseModal
      :open="showReceiptModal"
      title="Ringkasan Struk Keuangan"
      @close="showReceiptModal = false"
    >
      <div class="space-y-4">
        <!-- Thermal Receipt Style Card -->
        <div class="rounded-2xl border border-zinc-200 bg-zinc-50 p-4 font-mono text-xs text-zinc-800 shadow-inner space-y-3">
          <div class="text-center space-y-1 border-b border-dashed border-zinc-300 pb-3">
            <h4 class="font-bold text-sm tracking-wider uppercase">{{ businessStore.name || 'POS MOBILE' }}</h4>
            <p class="text-[11px] text-zinc-500">{{ businessStore.outlet || 'Outlet Utama' }}</p>
            <p class="text-[10px] text-zinc-400">Periode: {{ periodLabel }}</p>
          </div>

          <div class="space-y-1.5 py-1">
            <div class="flex justify-between">
              <span>Total Nota:</span>
              <span class="font-bold">{{ filteredTransactions.length }}</span>
            </div>
            <div class="flex justify-between">
              <span>Omzet Penjualan:</span>
              <span class="font-bold text-primary">{{ formatCurrency(revenue) }}</span>
            </div>
            <div class="flex justify-between text-zinc-600">
              <span>Estimasi Modal HPP:</span>
              <span>{{ formatCurrency(totalHpp) }}</span>
            </div>
            <div class="flex justify-between text-emerald-700 font-semibold">
              <span>Laba Kotor (GP):</span>
              <span>{{ formatCurrency(grossProfit) }}</span>
            </div>
            <div class="flex justify-between text-rose-700">
              <span>Beban Pengeluaran:</span>
              <span>-{{ formatCurrency(totalExpenses) }}</span>
            </div>
          </div>

          <div class="border-t border-dashed border-zinc-300 pt-2 flex justify-between font-bold text-sm">
            <span>LABA BERSIH:</span>
            <span :class="netProfit >= 0 ? 'text-emerald-700' : 'text-rose-700'">
              {{ formatCurrency(netProfit) }}
            </span>
          </div>

          <div class="border-t border-dashed border-zinc-300 pt-2 text-[10px] text-zinc-500 text-center">
            Dicetak otomatis dari POS Mobile Offline System
          </div>
        </div>

        <div v-if="copiedNotice" class="rounded-xl bg-emerald-100 p-2 text-center text-xs font-semibold text-emerald-800">
          Ringkasan berhasil disalin ke clipboard!
        </div>

        <!-- Modal Actions -->
        <div class="flex items-center gap-2 pt-2">
          <BaseButton block variant="secondary" @click="copyReportReceipt">
            <svg class="mr-1.5 h-4 w-4 text-zinc-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" />
            </svg>
            Salin Teks Laporan
          </BaseButton>
          <BaseButton block variant="primary" @click="showReceiptModal = false">
            Selesai
          </BaseButton>
        </div>
      </div>
    </BaseModal>
  </div>
</template>
