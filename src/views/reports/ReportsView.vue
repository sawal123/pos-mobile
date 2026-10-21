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

// Net Profit (Laba Bersih) = Gross Profit - Total Expenses
const netProfit = computed(() => grossProfit.value - totalExpenses.value)

// Total HPP (Cost of Goods Sold) = Omzet - Gross Profit
const totalHpp = computed(() => Math.max(0, revenue.value - grossProfit.value))

// Margins
const grossMargin = computed(() =>
  revenue.value > 0 ? Math.round((grossProfit.value / revenue.value) * 100) : 0,
)

const netMargin = computed(() =>
  revenue.value > 0 ? Math.round((netProfit.value / revenue.value) * 100) : 0,
)

const averageBasket = computed(() =>
  paidTransactions.value.length > 0
    ? Math.round(revenue.value / paidTransactions.value.length)
    : 0,
)

// Payment Methods Breakdown
const paymentBreakdown = computed(() => {
  const result = {
    cash: { count: 0, total: 0, label: 'Tunai (Cash)', icon: 'cash', color: 'emerald' },
    qris: { count: 0, total: 0, label: 'QRIS', icon: 'pos', color: 'blue' },
    transfer: { count: 0, total: 0, label: 'Transfer Bank', icon: 'sync', color: 'indigo' },
    other: { count: 0, total: 0, label: 'Lainnya', icon: 'more', color: 'zinc' },
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

// Top Selling Products / Services
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
    `Laba Kotor (GP) : ${formatCurrency(grossProfit.value)} (Margin ${grossMargin.value}%)`,
    `Total Biaya     : ${formatCurrency(totalExpenses.value)} (${filteredExpenses.value.length} pos)`,
    `----------------------------------`,
    `LABA BERSIH     : ${formatCurrency(netProfit.value)} (Margin ${netMargin.value}%)`,
    `==================================`,
    `Metode Pembayaran:`,
    ...paymentBreakdown.value
      .filter((p) => p.count > 0)
      .map((p) => `- ${p.label}: ${formatCurrency(p.total)} (${p.count}x, ${p.percent}%)`),
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
  <div class="space-y-5 pb-28">
    <!-- Header Minimalist & Sticky -->
    <header class="flex items-center justify-between gap-3">
      <div class="flex items-center gap-3">
        <button
          type="button"
          class="flex h-10 w-10 items-center justify-center rounded-2xl border border-zinc-200/80 bg-white text-ink-primary shadow-xs transition hover:bg-zinc-50 active:scale-95"
          aria-label="Kembali ke Home"
          @click="router.push('/home')"
        >
          <svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
          </svg>
        </button>

        <div>
          <div class="flex items-center gap-2">
            <span class="text-[11px] font-bold uppercase tracking-widest text-primary">Finansial & Analitik</span>
            <span class="inline-flex h-1.5 w-1.5 rounded-full bg-primary" />
          </div>
          <h1 class="text-xl font-black tracking-tight text-ink-primary sm:text-2xl">Laporan Keuangan</h1>
        </div>
      </div>

      <button
        type="button"
        class="inline-flex items-center gap-1.5 rounded-2xl border border-zinc-200 bg-white px-3 py-2 text-xs font-semibold text-zinc-700 shadow-xs transition hover:bg-zinc-50 active:scale-95"
        @click="showReceiptModal = true"
      >
        <svg class="h-4 w-4 text-zinc-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
        Ringkasan Struk
      </button>
    </header>

    <!-- Period Filter Switcher (Eyecatching Chips) -->
    <section class="flex items-center gap-1.5 overflow-x-auto pb-1 text-xs">
      <button
        type="button"
        class="rounded-xl px-3 py-1.5 font-semibold transition active:scale-95 shrink-0"
        :class="selectedPeriod === 'all' ? 'bg-primary text-white shadow-soft' : 'bg-white border border-zinc-200/80 text-zinc-600 hover:bg-zinc-50'"
        @click="selectedPeriod = 'all'"
      >
        Semua Waktu
      </button>

      <button
        type="button"
        class="rounded-xl px-3 py-1.5 font-semibold transition active:scale-95 shrink-0"
        :class="selectedPeriod === 'today' ? 'bg-primary text-white shadow-soft' : 'bg-white border border-zinc-200/80 text-zinc-600 hover:bg-zinc-50'"
        @click="selectedPeriod = 'today'"
      >
        Hari Ini
      </button>

      <button
        type="button"
        class="rounded-xl px-3 py-1.5 font-semibold transition active:scale-95 shrink-0"
        :class="selectedPeriod === '7days' ? 'bg-primary text-white shadow-soft' : 'bg-white border border-zinc-200/80 text-zinc-600 hover:bg-zinc-50'"
        @click="selectedPeriod = '7days'"
      >
        7 Hari Terakhir
      </button>

      <button
        type="button"
        class="rounded-xl px-3 py-1.5 font-semibold transition active:scale-95 shrink-0"
        :class="selectedPeriod === 'month' ? 'bg-primary text-white shadow-soft' : 'bg-white border border-zinc-200/80 text-zinc-600 hover:bg-zinc-50'"
        @click="selectedPeriod = 'month'"
      >
        Bulan Ini
      </button>
    </section>

    <!-- Eyecatching Hero Card: Net Profit & Health -->
    <section class="relative overflow-hidden rounded-3xl border border-zinc-200/80 bg-white p-5 shadow-soft space-y-4">
      <div class="flex items-start justify-between gap-3">
        <div>
          <span class="text-xs font-bold uppercase tracking-wider text-ink-secondary">
            Estimasi Laba Bersih (Net Profit)
          </span>
          <p
            class="mt-1 font-mono text-3xl font-black tracking-tight"
            :class="netProfit >= 0 ? 'text-emerald-600' : 'text-rose-600'"
            data-testid="reports-net-profit"
          >
            {{ formatCurrency(netProfit) }}
          </p>
          <p class="mt-1 text-xs text-ink-secondary">
            Periode: <strong class="text-ink-primary">{{ periodLabel }}</strong> &bull; Margin Bersih:
            <strong :class="netMargin >= 0 ? 'text-emerald-700' : 'text-rose-700'">{{ netMargin }}%</strong>
          </p>
        </div>

        <span
          class="shrink-0 inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold shadow-xs"
          :class="netProfit >= 0 ? 'bg-emerald-50 text-emerald-700 border border-emerald-200/60' : 'bg-rose-50 text-rose-700 border border-rose-200/60'"
        >
          <span class="h-2 w-2 rounded-full" :class="netProfit >= 0 ? 'bg-emerald-500' : 'bg-rose-500'" />
          {{ netProfit >= 0 ? 'Profit Bersih' : 'Defisit Usaha' }}
        </span>
      </div>

      <!-- Quick Breakdown Strip -->
      <div class="rounded-2xl bg-surface/70 p-3 text-xs text-ink-secondary flex items-center justify-between border border-zinc-100">
        <span>Formula: Laba Kotor - Pengeluaran</span>
        <span class="font-mono font-semibold text-ink-primary">
          {{ formatCurrency(grossProfit) }} - {{ formatCurrency(totalExpenses) }}
        </span>
      </div>
    </section>

    <!-- 2x2 Core Metrics Grid (Omzet, Transaksi, Gross Profit, Pengeluaran) -->
    <section class="grid grid-cols-2 gap-3">
      <!-- Omzet -->
      <div class="rounded-3xl border border-zinc-200/80 bg-white p-4 shadow-soft">
        <div class="flex items-center justify-between">
          <p class="text-xs font-bold uppercase tracking-wider text-ink-secondary">Omzet</p>
          <span class="flex h-7 w-7 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <AppIcon name="transactions" class="h-4 w-4" />
          </span>
        </div>
        <p class="mt-2 break-words font-mono text-xl font-black text-ink-primary sm:text-2xl" data-testid="reports-revenue">
          {{ formatCurrency(revenue) }}
        </p>
        <span class="text-[11px] text-ink-secondary mt-1 block">
          {{ paidTransactions.length }} order lunas
        </span>
      </div>

      <!-- Transaksi -->
      <div class="rounded-3xl border border-zinc-200/80 bg-white p-4 shadow-soft">
        <div class="flex items-center justify-between">
          <p class="text-xs font-bold uppercase tracking-wider text-ink-secondary">Transaksi</p>
          <span class="flex h-7 w-7 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600">
            <AppIcon name="pos" class="h-4 w-4" />
          </span>
        </div>
        <p class="mt-2 text-xl font-black text-ink-primary sm:text-2xl" data-testid="reports-transactions-count">
          {{ filteredTransactions.length }}
        </p>
        <span class="text-[11px] text-ink-secondary mt-1 block">
          Rata-rata: {{ formatCurrency(averageBasket) }}
        </span>
      </div>

      <!-- Gross Profit -->
      <div class="rounded-3xl border border-zinc-200/80 bg-white p-4 shadow-soft">
        <div class="flex items-center justify-between">
          <p class="text-xs font-bold uppercase tracking-wider text-ink-secondary">Gross Profit</p>
          <span class="flex h-7 w-7 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600">
            <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
            </svg>
          </span>
        </div>
        <p class="mt-2 break-words font-mono text-xl font-black text-success sm:text-2xl" data-testid="reports-gross-profit">
          {{ formatCurrency(grossProfit) }}
        </p>
        <span class="text-[11px] text-emerald-700 font-semibold mt-1 block">
          Margin kotor: {{ grossMargin }}%
        </span>
      </div>

      <!-- Pengeluaran -->
      <div class="rounded-3xl border border-zinc-200/80 bg-white p-4 shadow-soft">
        <div class="flex items-center justify-between">
          <p class="text-xs font-bold uppercase tracking-wider text-ink-secondary">Pengeluaran</p>
          <span class="flex h-7 w-7 items-center justify-center rounded-xl bg-rose-50 text-rose-600">
            <AppIcon name="expenses" class="h-4 w-4" />
          </span>
        </div>
        <p class="mt-2 break-words font-mono text-xl font-black text-danger sm:text-2xl" data-testid="reports-expenses">
          {{ formatCurrency(totalExpenses) }}
        </p>
        <span class="text-[11px] text-rose-700 font-semibold mt-1 block">
          {{ filteredExpenses.length }} pencatatan biaya
        </span>
      </div>
    </section>

    <!-- Visual Waterfall Bar: Alur Omzet -> HPP -> Beban -> Laba -->
    <section class="rounded-3xl border border-zinc-200/80 bg-white p-5 shadow-soft space-y-3">
      <div class="flex items-center justify-between">
        <h3 class="text-sm font-bold text-ink-primary">Struktur Alokasi Pendapatan</h3>
        <span class="text-xs font-semibold text-primary">{{ periodLabel }}</span>
      </div>

      <!-- Proportional Bar -->
      <div class="h-4 w-full overflow-hidden rounded-full bg-zinc-100 flex shadow-inner">
        <!-- HPP Bar -->
        <div
          class="bg-indigo-500 transition-all duration-500"
          :style="{ width: `${revenue > 0 ? Math.min(100, Math.round((totalHpp / revenue) * 100)) : 0}%` }"
          title="HPP"
        />
        <!-- Expense Bar -->
        <div
          class="bg-rose-500 transition-all duration-500"
          :style="{ width: `${revenue > 0 ? Math.min(100, Math.round((totalExpenses / revenue) * 100)) : 0}%` }"
          title="Pengeluaran"
        />
        <!-- Net Profit Bar -->
        <div
          class="bg-emerald-500 transition-all duration-500"
          :style="{ width: `${revenue > 0 && netProfit > 0 ? Math.min(100, Math.round((netProfit / revenue) * 100)) : 0}%` }"
          title="Laba Bersih"
        />
      </div>

      <!-- Legend -->
      <div class="grid grid-cols-3 gap-2 pt-2 border-t border-zinc-100 text-xs">
        <div>
          <span class="inline-flex items-center gap-1 font-semibold text-indigo-700">
            <span class="h-2 w-2 rounded-full bg-indigo-500" />
            Modal HPP
          </span>
          <p class="font-mono text-[11px] text-zinc-600 mt-0.5">{{ formatCurrency(totalHpp) }}</p>
        </div>

        <div>
          <span class="inline-flex items-center gap-1 font-semibold text-rose-700">
            <span class="h-2 w-2 rounded-full bg-rose-500" />
            Biaya Usaha
          </span>
          <p class="font-mono text-[11px] text-zinc-600 mt-0.5">{{ formatCurrency(totalExpenses) }}</p>
        </div>

        <div>
          <span class="inline-flex items-center gap-1 font-semibold text-emerald-700">
            <span class="h-2 w-2 rounded-full bg-emerald-500" />
            Sisa Bersih
          </span>
          <p class="font-mono text-[11px] text-zinc-600 mt-0.5">{{ formatCurrency(netProfit) }}</p>
        </div>
      </div>
    </section>

    <!-- Payment Channels Breakdown -->
    <section class="rounded-3xl border border-zinc-200/80 bg-white p-5 shadow-soft space-y-3.5">
      <div class="flex items-center justify-between">
        <div>
          <h3 class="text-sm font-bold text-ink-primary">Metode Pembayaran</h3>
          <p class="text-xs text-ink-secondary mt-0.5">Distribusi penerimaan kas & digital</p>
        </div>
        <span class="text-xs font-semibold text-ink-secondary">{{ paidTransactions.length }} nota lunas</span>
      </div>

      <div class="space-y-3">
        <div
          v-for="payment in paymentBreakdown"
          :key="payment.label"
          class="rounded-2xl border border-zinc-100 bg-surface/60 p-3.5 space-y-2"
        >
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-2">
              <span class="flex h-7 w-7 items-center justify-center rounded-xl bg-white border border-zinc-200 shadow-xs text-primary">
                <AppIcon :name="payment.icon" class="h-3.5 w-3.5" />
              </span>
              <div>
                <p class="text-xs font-bold text-ink-primary">{{ payment.label }}</p>
                <p class="text-[10px] text-ink-secondary">{{ payment.count }} transaksi</p>
              </div>
            </div>

            <div class="text-right">
              <p class="font-mono text-sm font-bold text-ink-primary">{{ formatCurrency(payment.total) }}</p>
              <p class="text-[10px] font-semibold text-primary">{{ payment.percent }}%</p>
            </div>
          </div>

          <!-- Mini Progress Bar -->
          <div class="h-1.5 w-full overflow-hidden rounded-full bg-zinc-200/80">
            <div
              class="h-full bg-primary rounded-full transition-all duration-300"
              :style="{ width: `${payment.percent}%` }"
            />
          </div>
        </div>
      </div>
    </section>

    <!-- Top Selling Products / Services -->
    <section class="rounded-3xl border border-zinc-200/80 bg-white p-5 shadow-soft space-y-3.5">
      <div class="flex items-center justify-between">
        <div>
          <h3 class="text-sm font-bold text-ink-primary">Produk / Layanan Terlaris</h3>
          <p class="text-xs text-ink-secondary mt-0.5">Berdasarkan volume penjualan</p>
        </div>
        <span class="text-xs font-semibold text-primary">Top {{ topSellingItems.length }}</span>
      </div>

      <div v-if="topSellingItems.length" class="space-y-2.5">
        <div
          v-for="(item, idx) in topSellingItems"
          :key="item.name"
          class="flex items-center justify-between rounded-2xl border border-zinc-100 bg-surface/50 p-3 transition hover:bg-surface"
        >
          <div class="flex items-center gap-3 min-w-0">
            <!-- Rank Badge -->
            <span
              class="flex h-7 w-7 shrink-0 items-center justify-center rounded-xl text-xs font-black shadow-xs"
              :class="
                idx === 0
                  ? 'bg-amber-100 text-amber-800 border border-amber-200'
                  : idx === 1
                  ? 'bg-zinc-200 text-zinc-800 border border-zinc-300'
                  : idx === 2
                  ? 'bg-amber-50 text-amber-900 border border-amber-200'
                  : 'bg-zinc-100 text-zinc-500'
              "
            >
              {{ idx + 1 }}
            </span>

            <div class="min-w-0">
              <p class="truncate text-xs font-bold text-ink-primary">{{ item.name }}</p>
              <p class="text-[10px] text-ink-secondary">{{ item.category }} &bull; {{ item.qty }} terjual</p>
            </div>
          </div>

          <div class="text-right shrink-0">
            <p class="font-mono text-xs font-bold text-ink-primary">{{ formatCurrency(item.total) }}</p>
          </div>
        </div>
      </div>

      <div v-else class="rounded-2xl border border-dashed border-zinc-200 p-6 text-center text-xs text-zinc-400 italic">
        Belum ada item penjualan tercatat pada periode ini.
      </div>
    </section>

    <!-- Expense Categories Breakdown -->
    <section v-if="expenseCategoryBreakdown.length" class="rounded-3xl border border-zinc-200/80 bg-white p-5 shadow-soft space-y-3.5">
      <div class="flex items-center justify-between">
        <div>
          <h3 class="text-sm font-bold text-ink-primary">Pos Biaya & Pengeluaran</h3>
          <p class="text-xs text-ink-secondary mt-0.5">Klasifikasi beban operasional</p>
        </div>
        <span class="font-mono text-xs font-bold text-danger">{{ formatCurrency(totalExpenses) }}</span>
      </div>

      <div class="space-y-2">
        <div
          v-for="cat in expenseCategoryBreakdown"
          :key="cat.category"
          class="rounded-2xl border border-zinc-100 bg-surface/50 p-3 space-y-1.5"
        >
          <div class="flex items-center justify-between text-xs">
            <span class="font-semibold text-ink-primary">{{ cat.category }}</span>
            <span class="font-mono font-bold text-zinc-700">
              {{ formatCurrency(cat.total) }} ({{ cat.percent }}%)
            </span>
          </div>

          <div class="h-1.5 w-full overflow-hidden rounded-full bg-zinc-200/80">
            <div
              class="h-full bg-rose-500 rounded-full transition-all duration-300"
              :style="{ width: `${cat.percent}%` }"
            />
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
