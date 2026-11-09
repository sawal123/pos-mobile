<script setup>
import { computed, ref } from 'vue'
import { RouterLink } from 'vue-router'

import TransactionCard from '@/components/transaction/TransactionCard.vue'
import { useTransactionStore } from '@/stores/transactionStore'
import { formatCurrency, toLocalDateString } from '@/utils/formatters'

const transactionStore = useTransactionStore()

const searchQuery = ref('')

// Default filter tanggal: 'today' (Hari ini)
const dateFilter = ref('today') // 'today', 'all', 'yesterday', 'last7', 'last30', 'custom'

// Filter metode pembayaran: 'all', 'cash', 'qris', 'transfer', 'card'
const paymentFilter = ref('all')

// State tanggal flicker / flipper navigator (YYYY-MM-DD)
const todayStr = toLocalDateString(new Date())
const flickerDate = ref(todayStr)

const yesterdayStr = (() => {
  const d = new Date()
  d.setDate(d.getDate() - 1)
  return toLocalDateString(d)
})()

function getTxDateString(t) {
  const raw = t.createdAt || t.date || t.timestamp
  if (!raw) return ''
  try {
    return toLocalDateString(new Date(raw))
  } catch {
    return ''
  }
}

function getTxTimestamp(t) {
  const raw = t.createdAt || t.date || t.timestamp
  if (!raw) return 0
  const ts = new Date(raw).getTime()
  return Number.isNaN(ts) ? 0 : ts
}

function prevDay() {
  const base = flickerDate.value ? new Date(flickerDate.value) : new Date()
  base.setDate(base.getDate() - 1)
  flickerDate.value = toLocalDateString(base)
  dateFilter.value = 'custom'
}

function nextDay() {
  const base = flickerDate.value ? new Date(flickerDate.value) : new Date()
  base.setDate(base.getDate() + 1)
  flickerDate.value = toLocalDateString(base)
  dateFilter.value = 'custom'
}

function setDateFilter(filter) {
  dateFilter.value = filter
  if (filter === 'today') {
    flickerDate.value = todayStr
  } else if (filter === 'yesterday') {
    flickerDate.value = yesterdayStr
  }
}

function onCustomDateChange(e) {
  if (e.target.value) {
    flickerDate.value = e.target.value
    dateFilter.value = 'custom'
  }
}

function formatDateDisplay(dateStr) {
  if (!dateStr) return '-'
  try {
    const parts = dateStr.split('-')
    if (parts.length === 3) {
      const d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]))
      return new Intl.DateTimeFormat('id-ID', {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      }).format(d)
    }
    return new Intl.DateTimeFormat('id-ID', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    }).format(new Date(dateStr))
  } catch {
    return dateStr
  }
}

const flickerDisplayLabel = computed(() => {
  if (dateFilter.value === 'all') return 'Semua Tanggal'
  if (dateFilter.value === 'last7') return '7 Hari Terakhir'
  if (dateFilter.value === 'last30') return '30 Hari Terakhir'

  const activeDate = dateFilter.value === 'today'
    ? todayStr
    : (dateFilter.value === 'yesterday' ? yesterdayStr : flickerDate.value)

  if (activeDate === todayStr) {
    return `Hari Ini • ${formatDateDisplay(activeDate)}`
  }
  if (activeDate === yesterdayStr) {
    return `Kemarin • ${formatDateDisplay(activeDate)}`
  }
  return formatDateDisplay(activeDate)
})

const filteredTransactions = computed(() => {
  const list = transactionStore.items || transactionStore.transactions || []
  const now = Date.now()

  return list.filter((t) => {
    // 1. Date Filter
    const txDateStr = getTxDateString(t)
    const txTs = getTxTimestamp(t)

    if (dateFilter.value === 'today') {
      if (txDateStr !== todayStr) return false
    } else if (dateFilter.value === 'yesterday') {
      if (txDateStr !== yesterdayStr) return false
    } else if (dateFilter.value === 'last7') {
      const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000
      if (txTs < sevenDaysAgo) return false
    } else if (dateFilter.value === 'last30') {
      const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000
      if (txTs < thirtyDaysAgo) return false
    } else if (dateFilter.value === 'custom') {
      if (txDateStr !== flickerDate.value) return false
    }
    // 'all' passes date filter

    // 2. Payment Method Filter
    if (paymentFilter.value !== 'all') {
      const method = String(t.paymentMethod || '').toLowerCase()
      if (paymentFilter.value === 'cash') {
        if (method !== 'cash' && method !== 'tunai') return false
      } else if (paymentFilter.value === 'qris') {
        if (!method.includes('qris')) return false
      } else if (paymentFilter.value === 'transfer') {
        if (!method.includes('transfer') && !method.includes('bank')) return false
      } else if (paymentFilter.value === 'card') {
        if (!method.includes('card') && !method.includes('debit') && !method.includes('credit')) return false
      }
    }

    // 3. Search Filter
    const q = searchQuery.value.trim().toLowerCase()
    if (q) {
      const inv = String(t.invoiceNumber || t.orderNumber || t.id || '').toLowerCase()
      const customer = String(t.customer || '').toLowerCase()
      const itemMatch = Array.isArray(t.items)
        ? t.items.some((it) => String(it.name || it.serviceName || '').toLowerCase().includes(q))
        : false
      if (!inv.includes(q) && !customer.includes(q) && !itemMatch) {
        return false
      }
    }

    return true
  })
})

const totalRevenue = computed(() => {
  return filteredTransactions.value.reduce((acc, t) => acc + (Number(t.total) || 0), 0)
})

function resetAllFilters() {
  searchQuery.value = ''
  dateFilter.value = 'today'
  flickerDate.value = todayStr
  paymentFilter.value = 'all'
}
</script>

<template>
  <div class="space-y-4 pb-32">
    <!-- Header with Revenue & Count Summary -->
    <div class="flex items-center justify-between gap-3">
      <div>
        <p class="text-xs font-semibold uppercase tracking-wider text-primary">Penjualan</p>
        <h1 class="mt-0.5 text-2xl font-bold text-ink-primary">Riwayat Transaksi</h1>
      </div>
      <div class="flex flex-col items-end gap-1">
        <span class="rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
          {{ filteredTransactions.length }} Transaksi
        </span>
        <span v-if="filteredTransactions.length > 0" class="text-xs font-bold text-ink-primary">
          {{ formatCurrency(totalRevenue) }}
        </span>
      </div>
    </div>

    <!-- Search Input -->
    <div class="relative">
      <div class="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3.5 text-zinc-400">
        <svg class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
      </div>
      <input
        v-model="searchQuery"
        type="search"
        placeholder="Cari invoice, pelanggan, atau produk..."
        class="h-11 w-full rounded-2xl border border-zinc-200/80 bg-white pl-10 pr-4 text-sm text-ink-primary shadow-xs placeholder:text-zinc-400 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 dark:border-slate-700/60 dark:bg-[#171C2B] dark:text-white transition"
      />
    </div>

    <!-- Date Flicker / Navigator Bar -->
    <div class="flex items-center justify-between rounded-2xl border border-zinc-200/80 bg-white p-1.5 shadow-xs dark:border-slate-700/60 dark:bg-[#171C2B]">
      <button
        type="button"
        data-testid="date-flicker-prev"
        class="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-zinc-600 hover:bg-zinc-100 hover:text-ink-primary active:scale-95 transition dark:text-zinc-300 dark:hover:bg-slate-800"
        title="Hari Sebelumnya"
        @click="prevDay"
      >
        <svg class="h-5 w-5" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
        </svg>
      </button>

      <!-- Center Date Display with Interactive Native Date Picker Overlay -->
      <div class="relative flex flex-1 items-center justify-center gap-2 px-2 text-center">
        <svg class="h-4 w-4 text-primary shrink-0" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5" />
        </svg>
        <span data-testid="date-flicker-label" class="text-xs sm:text-sm font-semibold text-ink-primary dark:text-white truncate">
          {{ flickerDisplayLabel }}
        </span>

        <!-- Native hidden date picker overlay covering center -->
        <input
          type="date"
          data-testid="date-flicker-input"
          class="absolute inset-0 cursor-pointer opacity-0"
          :value="flickerDate"
          title="Klik untuk memilih tanggal kustom"
          @change="onCustomDateChange"
        />
      </div>

      <button
        type="button"
        data-testid="date-flicker-next"
        class="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-zinc-600 hover:bg-zinc-100 hover:text-ink-primary active:scale-95 transition dark:text-zinc-300 dark:hover:bg-slate-800"
        title="Hari Berikutnya"
        @click="nextDay"
      >
        <svg class="h-5 w-5" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
        </svg>
      </button>
    </div>

    <!-- Quick Date Presets Row -->
    <div class="space-y-1.5">
      <div class="flex items-center gap-1.5 overflow-x-auto pb-1 text-xs no-scrollbar">
        <button
          type="button"
          data-testid="filter-date-today"
          class="rounded-full px-3 py-1.5 font-medium whitespace-nowrap transition active:scale-95"
          :class="
            dateFilter === 'today'
              ? 'bg-ink-primary text-white shadow-xs dark:bg-white dark:text-ink-primary'
              : 'bg-white text-zinc-600 border border-zinc-200/70 hover:bg-zinc-50 dark:border-slate-700/60 dark:bg-[#171C2B] dark:text-zinc-300'
          "
          @click="setDateFilter('today')"
        >
          Hari Ini
        </button>
        <button
          type="button"
          data-testid="filter-date-yesterday"
          class="rounded-full px-3 py-1.5 font-medium whitespace-nowrap transition active:scale-95"
          :class="
            dateFilter === 'yesterday'
              ? 'bg-ink-primary text-white shadow-xs dark:bg-white dark:text-ink-primary'
              : 'bg-white text-zinc-600 border border-zinc-200/70 hover:bg-zinc-50 dark:border-slate-700/60 dark:bg-[#171C2B] dark:text-zinc-300'
          "
          @click="setDateFilter('yesterday')"
        >
          Kemarin
        </button>
        <button
          type="button"
          data-testid="filter-date-last7"
          class="rounded-full px-3 py-1.5 font-medium whitespace-nowrap transition active:scale-95"
          :class="
            dateFilter === 'last7'
              ? 'bg-ink-primary text-white shadow-xs dark:bg-white dark:text-ink-primary'
              : 'bg-white text-zinc-600 border border-zinc-200/70 hover:bg-zinc-50 dark:border-slate-700/60 dark:bg-[#171C2B] dark:text-zinc-300'
          "
          @click="setDateFilter('last7')"
        >
          7 Hari
        </button>
        <button
          type="button"
          data-testid="filter-date-last30"
          class="rounded-full px-3 py-1.5 font-medium whitespace-nowrap transition active:scale-95"
          :class="
            dateFilter === 'last30'
              ? 'bg-ink-primary text-white shadow-xs dark:bg-white dark:text-ink-primary'
              : 'bg-white text-zinc-600 border border-zinc-200/70 hover:bg-zinc-50 dark:border-slate-700/60 dark:bg-[#171C2B] dark:text-zinc-300'
          "
          @click="setDateFilter('last30')"
        >
          30 Hari
        </button>
        <button
          type="button"
          data-testid="filter-date-all"
          class="rounded-full px-3 py-1.5 font-medium whitespace-nowrap transition active:scale-95"
          :class="
            dateFilter === 'all'
              ? 'bg-ink-primary text-white shadow-xs dark:bg-white dark:text-ink-primary'
              : 'bg-white text-zinc-600 border border-zinc-200/70 hover:bg-zinc-50 dark:border-slate-700/60 dark:bg-[#171C2B] dark:text-zinc-300'
          "
          @click="setDateFilter('all')"
        >
          Semua Tanggal
        </button>
      </div>
    </div>

    <!-- Payment Method Filter Row -->
    <div class="space-y-1">
      <div class="flex items-center justify-between">
        <span class="text-[11px] font-semibold text-zinc-500 uppercase tracking-wider">Metode Bayar:</span>
      </div>
      <div class="flex items-center gap-1.5 overflow-x-auto pb-1 text-xs no-scrollbar">
        <button
          type="button"
          data-testid="filter-pay-all"
          class="rounded-xl px-3 py-1.5 font-medium whitespace-nowrap transition active:scale-95"
          :class="
            paymentFilter === 'all'
              ? 'bg-primary text-white shadow-xs'
              : 'bg-white text-zinc-600 border border-zinc-200/70 hover:bg-zinc-50 dark:border-slate-700/60 dark:bg-[#171C2B] dark:text-zinc-300'
          "
          @click="paymentFilter = 'all'"
        >
          Semua
        </button>
        <button
          type="button"
          data-testid="filter-pay-cash"
          class="rounded-xl px-3 py-1.5 font-medium whitespace-nowrap transition active:scale-95"
          :class="
            paymentFilter === 'cash'
              ? 'bg-primary text-white shadow-xs'
              : 'bg-white text-zinc-600 border border-zinc-200/70 hover:bg-zinc-50 dark:border-slate-700/60 dark:bg-[#171C2B] dark:text-zinc-300'
          "
          @click="paymentFilter = 'cash'"
        >
          Tunai
        </button>
        <button
          type="button"
          data-testid="filter-pay-qris"
          class="rounded-xl px-3 py-1.5 font-medium whitespace-nowrap transition active:scale-95"
          :class="
            paymentFilter === 'qris'
              ? 'bg-primary text-white shadow-xs'
              : 'bg-white text-zinc-600 border border-zinc-200/70 hover:bg-zinc-50 dark:border-slate-700/60 dark:bg-[#171C2B] dark:text-zinc-300'
          "
          @click="paymentFilter = 'qris'"
        >
          QRIS
        </button>
        <button
          type="button"
          data-testid="filter-pay-transfer"
          class="rounded-xl px-3 py-1.5 font-medium whitespace-nowrap transition active:scale-95"
          :class="
            paymentFilter === 'transfer'
              ? 'bg-primary text-white shadow-xs'
              : 'bg-white text-zinc-600 border border-zinc-200/70 hover:bg-zinc-50 dark:border-slate-700/60 dark:bg-[#171C2B] dark:text-zinc-300'
          "
          @click="paymentFilter = 'transfer'"
        >
          Transfer
        </button>
        <button
          type="button"
          data-testid="filter-pay-card"
          class="rounded-xl px-3 py-1.5 font-medium whitespace-nowrap transition active:scale-95"
          :class="
            paymentFilter === 'card'
              ? 'bg-primary text-white shadow-xs'
              : 'bg-white text-zinc-600 border border-zinc-200/70 hover:bg-zinc-50 dark:border-slate-700/60 dark:bg-[#171C2B] dark:text-zinc-300'
          "
          @click="paymentFilter = 'card'"
        >
          Kartu / Debit
        </button>
      </div>
    </div>

    <!-- Transaction Cards Grid -->
    <div v-if="filteredTransactions.length > 0" class="grid gap-3">
      <RouterLink
        v-for="transaction in filteredTransactions"
        :key="transaction.id"
        :to="`/transactions/${transaction.id}`"
        class="block focus:outline-none"
      >
        <TransactionCard :transaction="transaction" />
      </RouterLink>
    </div>

    <!-- Empty State -->
    <div
      v-else
      class="rounded-3xl border border-zinc-200/70 bg-white p-8 text-center shadow-soft space-y-3 mt-4 dark:border-slate-700/60 dark:bg-[#171C2B]"
    >
      <div class="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-zinc-100 text-zinc-400 dark:bg-slate-800">
        <svg class="h-6 w-6" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
        </svg>
      </div>
      <div>
        <p class="text-sm font-semibold text-ink-primary dark:text-white">Tidak Ada Transaksi</p>
        <p class="mt-1 text-xs text-ink-secondary dark:text-zinc-400">
          {{ searchQuery ? 'Tidak ada transaksi yang cocok dengan pencarian Anda.' : 'Belum ada transaksi pada periode atau filter yang dipilih.' }}
        </p>
      </div>
      <button
        type="button"
        class="inline-flex items-center gap-1.5 rounded-xl border border-zinc-200 bg-zinc-50 px-3.5 py-1.5 text-xs font-semibold text-ink-primary hover:bg-zinc-100 dark:border-slate-700 dark:bg-slate-800 dark:text-zinc-200"
        @click="resetAllFilters"
      >
        Reset Filter
      </button>
    </div>
  </div>
</template>
