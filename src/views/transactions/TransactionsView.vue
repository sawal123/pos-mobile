<script setup>
import { computed, ref } from 'vue'
import { RouterLink } from 'vue-router'

import TransactionCard from '@/components/transaction/TransactionCard.vue'
import { useTransactionStore } from '@/stores/transactionStore'

const transactionStore = useTransactionStore()

const searchQuery = ref('')
const activeFilter = ref('all') // 'all', 'today', 'cash', 'qris'

const isToday = (dateString) => {
  if (!dateString) return false
  const date = new Date(dateString)
  const today = new Date()
  return (
    date.getDate() === today.getDate() &&
    date.getMonth() === today.getMonth() &&
    date.getFullYear() === today.getFullYear()
  )
}

const filteredTransactions = computed(() => {
  let list = transactionStore.items || []

  // Filter tab
  if (activeFilter.value === 'today') {
    list = list.filter((t) => isToday(t.createdAt))
  } else if (activeFilter.value === 'cash') {
    list = list.filter((t) => `${t.paymentMethod || ''}`.toLowerCase() === 'cash')
  } else if (activeFilter.value === 'qris') {
    list = list.filter((t) => `${t.paymentMethod || ''}`.toLowerCase() === 'qris')
  }

  // Search filter
  const q = searchQuery.value.trim().toLowerCase()
  if (!q) return list

  return list.filter((t) => {
    const inv = String(t.invoiceNumber || t.orderNumber || t.id || '').toLowerCase()
    const customer = String(t.customer || '').toLowerCase()
    const itemMatch = Array.isArray(t.items)
      ? t.items.some((it) => String(it.name || it.serviceName || '').toLowerCase().includes(q))
      : false

    return inv.includes(q) || customer.includes(q) || itemMatch
  })
})
</script>

<template>
  <div class="space-y-4 pb-32">
    <!-- Header -->
    <div class="flex items-end justify-between gap-3">
      <div>
        <p class="text-xs font-semibold uppercase tracking-wider text-primary">Penjualan</p>
        <h1 class="mt-1 text-2xl font-bold text-ink-primary">Riwayat Transaksi</h1>
      </div>
      <span class="rounded-full bg-zinc-100 px-2.5 py-1 text-xs font-medium text-zinc-600">
        {{ filteredTransactions.length }} transaksi
      </span>
    </div>

    <!-- Minimalist Search Input -->
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
        class="h-11 w-full rounded-2xl border border-zinc-200/80 bg-white pl-10 pr-4 text-sm text-ink-primary shadow-xs placeholder:text-zinc-400 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 transition"
      />
    </div>

    <!-- Filter Tabs (Minimalist pills) -->
    <div class="flex items-center gap-1.5 overflow-x-auto pb-1 text-xs no-scrollbar">
      <button
        type="button"
        class="rounded-full px-3 py-1.5 font-medium transition whitespace-nowrap"
        :class="
          activeFilter === 'all'
            ? 'bg-ink-primary text-white shadow-xs'
            : 'bg-white text-zinc-600 border border-zinc-200/70 hover:bg-zinc-50'
        "
        @click="activeFilter = 'all'"
      >
        Semua
      </button>
      <button
        type="button"
        class="rounded-full px-3 py-1.5 font-medium transition whitespace-nowrap"
        :class="
          activeFilter === 'today'
            ? 'bg-ink-primary text-white shadow-xs'
            : 'bg-white text-zinc-600 border border-zinc-200/70 hover:bg-zinc-50'
        "
        @click="activeFilter = 'today'"
      >
        Hari Ini
      </button>
      <button
        type="button"
        class="rounded-full px-3 py-1.5 font-medium transition whitespace-nowrap"
        :class="
          activeFilter === 'cash'
            ? 'bg-ink-primary text-white shadow-xs'
            : 'bg-white text-zinc-600 border border-zinc-200/70 hover:bg-zinc-50'
        "
        @click="activeFilter = 'cash'"
      >
        Tunai (Cash)
      </button>
      <button
        type="button"
        class="rounded-full px-3 py-1.5 font-medium transition whitespace-nowrap"
        :class="
          activeFilter === 'qris'
            ? 'bg-ink-primary text-white shadow-xs'
            : 'bg-white text-zinc-600 border border-zinc-200/70 hover:bg-zinc-50'
        "
        @click="activeFilter = 'qris'"
      >
        QRIS
      </button>
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
      class="rounded-3xl border border-zinc-200/70 bg-white p-8 text-center shadow-soft space-y-2 mt-4"
    >
      <div class="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-zinc-100 text-zinc-400">
        <svg class="h-6 w-6" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
        </svg>
      </div>
      <p class="text-sm font-semibold text-ink-primary">Tidak Ada Transaksi</p>
      <p class="text-xs text-ink-secondary">
        {{ searchQuery ? 'Tidak ada transaksi yang cocok dengan pencarian Anda.' : 'Belum ada transaksi pada kategori ini.' }}
      </p>
    </div>
  </div>
</template>
