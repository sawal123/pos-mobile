<script setup>
import { computed, ref } from 'vue'
import { storeToRefs } from 'pinia'
import { useRouter } from 'vue-router'

import AppIcon from '@/components/base/AppIcon.vue'
import BaseBadge from '@/components/base/BaseBadge.vue'
import BaseButton from '@/components/base/BaseButton.vue'
import BaseModal from '@/components/base/BaseModal.vue'
import { useCustomerStore } from '@/stores/customerStore'
import { isPaidTransaction, useTransactionStore } from '@/stores/transactionStore'
import { formatCurrency, formatDateTime } from '@/utils/formatters'

const customerStore = useCustomerStore()
const transactionStore = useTransactionStore()
const router = useRouter()

const { customers } = storeToRefs(customerStore)

const searchQuery = ref('')
const activeFilter = ref('all') // 'all' | 'with_phone' | 'with_email' | 'has_orders'
const sortBy = ref('name_asc') // 'name_asc' | 'name_desc' | 'spend_desc' | 'orders_desc'

// Modals
const customerToDelete = ref(null)
const selectedCustomer = ref(null)

const AVATAR_PALETTES = [
  'bg-gradient-to-br from-indigo-500 to-violet-600 text-white',
  'bg-gradient-to-br from-emerald-500 to-teal-600 text-white',
  'bg-gradient-to-br from-blue-500 to-cyan-600 text-white',
  'bg-gradient-to-br from-amber-500 to-orange-600 text-white',
  'bg-gradient-to-br from-rose-500 to-pink-600 text-white',
  'bg-gradient-to-br from-purple-500 to-fuchsia-600 text-white',
]

function getAvatarPalette(name = '') {
  let hash = 0
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash)
  }
  const index = Math.abs(hash) % AVATAR_PALETTES.length
  return AVATAR_PALETTES[index]
}

function getInitials(name = '') {
  const parts = (name || '').trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[1][0]).toUpperCase()
}

function cleanPhoneForWhatsApp(phone = '') {
  if (!phone) return ''
  let cleaned = phone.replace(/\D/g, '')
  if (cleaned.startsWith('0')) {
    cleaned = '62' + cleaned.slice(1)
  }
  return cleaned
}

function getWhatsAppUrl(phone = '') {
  const clean = cleanPhoneForWhatsApp(phone)
  return clean ? `https://wa.me/${clean}` : ''
}

function openWhatsApp(customer) {
  const url = getWhatsAppUrl(customer.phone)
  if (url) {
    window.open(url, '_blank')
  }
}

// Compute metrics for all customers based on transactionStore
const customerStatsMap = computed(() => {
  const map = new Map()

  for (const customer of customers.value) {
    map.set(customer.id, {
      trxCount: 0,
      totalSpent: 0,
      lastTrxDate: null,
      recentTrx: [],
    })
  }

  // Iterate over transactions to match customer
  for (const trx of transactionStore.items) {
    let matchedId = trx.customerId
    if (!matchedId && trx.customer && trx.customer !== 'Walk-in Customer') {
      const found = customers.value.find((c) => c.name.toLowerCase() === trx.customer.toLowerCase())
      if (found) matchedId = found.id
    }

    if (matchedId && map.has(matchedId)) {
      const stats = map.get(matchedId)
      stats.trxCount++
      if (isPaidTransaction(trx)) {
        stats.totalSpent += Number(trx.total || 0)
      }
      if (!stats.lastTrxDate || new Date(trx.createdAt) > new Date(stats.lastTrxDate)) {
        stats.lastTrxDate = trx.createdAt
      }
      stats.recentTrx.push(trx)
    }
  }

  return map
})

// Global Metrics
const totalCustomersCount = computed(() => customers.value.length)
const customersWithPhoneCount = computed(() => customers.value.filter((c) => Boolean(c.phone)).length)
const totalLoyaltyRevenue = computed(() => {
  let sum = 0
  for (const stats of customerStatsMap.value.values()) {
    sum += stats.totalSpent
  }
  return sum
})

// Filtered and Sorted list
const processedCustomers = computed(() => {
  const query = searchQuery.value.trim().toLowerCase()

  return customers.value
    .map((customer) => {
      const stats = customerStatsMap.value.get(customer.id) || {
        trxCount: 0,
        totalSpent: 0,
        lastTrxDate: null,
        recentTrx: [],
      }
      return {
        ...customer,
        ...stats,
        initials: getInitials(customer.name),
        avatarClass: getAvatarPalette(customer.name),
        waUrl: getWhatsAppUrl(customer.phone),
      }
    })
    .filter((c) => {
      // Search
      if (query) {
        const nameMatch = c.name?.toLowerCase().includes(query)
        const phoneMatch = c.phone?.toLowerCase().includes(query)
        const emailMatch = c.email?.toLowerCase().includes(query)
        if (!nameMatch && !phoneMatch && !emailMatch) return false
      }

      // Filter
      if (activeFilter.value === 'with_phone') return Boolean(c.phone)
      if (activeFilter.value === 'with_email') return Boolean(c.email)
      if (activeFilter.value === 'has_orders') return c.trxCount > 0

      return true
    })
    .sort((a, b) => {
      if (sortBy.value === 'name_asc') return a.name.localeCompare(b.name)
      if (sortBy.value === 'name_desc') return b.name.localeCompare(a.name)
      if (sortBy.value === 'spend_desc') return b.totalSpent - a.totalSpent
      if (sortBy.value === 'orders_desc') return b.trxCount - a.trxCount
      return 0
    })
})

function goToCreate() {
  router.push({ name: 'customer-create' })
}

function goToEdit(customer) {
  router.push({ name: 'customer-edit', params: { id: customer.id } })
}

function confirmDelete(customer) {
  customerToDelete.value = customer
}

function executeDelete() {
  if (customerToDelete.value) {
    customerStore.deleteCustomer(customerToDelete.value.id)
    if (selectedCustomer.value?.id === customerToDelete.value.id) {
      selectedCustomer.value = null
    }
    customerToDelete.value = null
  }
}

function viewCustomerDetail(customer) {
  selectedCustomer.value = customer
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
            <span class="text-[11px] font-bold uppercase tracking-widest text-primary">CRM & Pelanggan</span>
            <span class="inline-flex h-1.5 w-1.5 rounded-full bg-primary" />
          </div>
          <h1 class="text-xl font-black tracking-tight text-ink-primary sm:text-2xl">Daftar Pelanggan</h1>
        </div>
      </div>

      <BaseButton size="sm" class="shrink-0 font-semibold shadow-soft" @click="goToCreate">
        <svg class="mr-1.5 h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M12 4v16m8-8H4" />
        </svg>
        Tambah Customer
      </BaseButton>
    </header>

    <!-- Eyecatching Minimalist Hero Metric Banner -->
    <section class="grid grid-cols-3 gap-2.5 rounded-3xl border border-zinc-200/80 bg-white p-3.5 shadow-soft sm:gap-4 sm:p-5">
      <!-- Total Pelanggan -->
      <div class="flex flex-col justify-between rounded-2xl bg-surface/80 p-3 sm:p-4">
        <div class="flex items-center justify-between">
          <span class="text-[11px] font-semibold uppercase tracking-wider text-ink-secondary">Total</span>
          <span class="flex h-6 w-6 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <AppIcon name="customers" class="h-3.5 w-3.5" />
          </span>
        </div>
        <p class="mt-2 text-xl font-black text-ink-primary sm:text-2xl" data-testid="total-customers-count">
          {{ totalCustomersCount }}
        </p>
        <span class="text-[10px] text-ink-secondary mt-0.5">Pelanggan</span>
      </div>

      <!-- Kontak Terhubung -->
      <div class="flex flex-col justify-between rounded-2xl bg-surface/80 p-3 sm:p-4">
        <div class="flex items-center justify-between">
          <span class="text-[11px] font-semibold uppercase tracking-wider text-ink-secondary">Kontak</span>
          <span class="flex h-6 w-6 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600">
            <svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
            </svg>
          </span>
        </div>
        <p class="mt-2 text-xl font-black text-ink-primary sm:text-2xl">
          {{ customersWithPhoneCount }}
        </p>
        <span class="text-[10px] text-ink-secondary mt-0.5">Ada No. HP</span>
      </div>

      <!-- Omzet Member -->
      <div class="flex flex-col justify-between rounded-2xl bg-surface/80 p-3 sm:p-4">
        <div class="flex items-center justify-between">
          <span class="text-[11px] font-semibold uppercase tracking-wider text-ink-secondary">Omzet</span>
          <span class="flex h-6 w-6 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600">
            <AppIcon name="transactions" class="h-3.5 w-3.5" />
          </span>
        </div>
        <p class="mt-2 truncate font-mono text-base font-black text-primary sm:text-xl">
          {{ formatCurrency(totalLoyaltyRevenue) }}
        </p>
        <span class="text-[10px] text-ink-secondary mt-0.5">Total Belanja</span>
      </div>
    </section>

    <!-- Search & Filter Controls -->
    <section class="space-y-3">
      <!-- Search Input -->
      <div class="relative">
        <span class="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3.5 text-zinc-400">
          <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
        </span>
        <input
          v-model="searchQuery"
          type="text"
          placeholder="Cari nama, no. HP, atau email pelanggan..."
          class="h-11 w-full rounded-2xl border border-zinc-200/90 bg-white pl-10 pr-10 text-sm text-ink-primary placeholder:text-zinc-400 focus:border-primary focus:outline-none focus:ring-4 focus:ring-primary/10 transition shadow-xs"
        />
        <button
          v-if="searchQuery"
          type="button"
          class="absolute inset-y-0 right-0 flex items-center pr-3.5 text-zinc-400 hover:text-ink-primary transition"
          @click="searchQuery = ''"
        >
          <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <!-- Quick Filter Chips & Sort -->
      <div class="flex items-center justify-between gap-2 overflow-x-auto pb-1 text-xs">
        <div class="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            class="rounded-xl px-3 py-1.5 font-medium transition active:scale-95"
            :class="activeFilter === 'all' ? 'bg-primary text-white shadow-xs' : 'bg-white border border-zinc-200 text-zinc-600 hover:bg-zinc-50'"
            @click="activeFilter = 'all'"
          >
            Semua ({{ totalCustomersCount }})
          </button>
          <button
            type="button"
            class="rounded-xl px-3 py-1.5 font-medium transition active:scale-95"
            :class="activeFilter === 'with_phone' ? 'bg-primary text-white shadow-xs' : 'bg-white border border-zinc-200 text-zinc-600 hover:bg-zinc-50'"
            @click="activeFilter = 'with_phone'"
          >
            Ada No. HP ({{ customersWithPhoneCount }})
          </button>
          <button
            type="button"
            class="rounded-xl px-3 py-1.5 font-medium transition active:scale-95"
            :class="activeFilter === 'has_orders' ? 'bg-primary text-white shadow-xs' : 'bg-white border border-zinc-200 text-zinc-600 hover:bg-zinc-50'"
            @click="activeFilter = 'has_orders'"
          >
            Pernah Belanja
          </button>
        </div>

        <!-- Sort Select -->
        <select
          v-model="sortBy"
          class="h-8 rounded-xl border border-zinc-200 bg-white px-2 text-[11px] font-medium text-ink-primary outline-none focus:border-primary shrink-0"
        >
          <option value="name_asc">Nama (A - Z)</option>
          <option value="name_desc">Nama (Z - A)</option>
          <option value="spend_desc">Belanja Tertinggi</option>
          <option value="orders_desc">Transaksi Terbanyak</option>
        </select>
      </div>
    </section>

    <!-- Customer Card List -->
    <section class="space-y-3">
      <div class="flex items-center justify-between px-1">
        <h2 class="text-sm font-bold text-ink-primary">Semua Pelanggan</h2>
        <span class="text-xs text-ink-secondary">{{ processedCustomers.length }} pelanggan ditampilkan</span>
      </div>

      <!-- Has Customers List -->
      <div v-if="processedCustomers.length" class="space-y-3">
        <article
          v-for="customer in processedCustomers"
          :key="customer.id"
          class="group relative overflow-hidden rounded-3xl border border-zinc-200/80 bg-white p-4 shadow-soft transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md"
        >
          <div class="flex items-start gap-3.5">
            <!-- Dynamic Initial Avatar -->
            <button
              type="button"
              class="relative flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl shadow-xs text-sm font-black transition group-hover:scale-105 active:scale-95"
              :class="customer.avatarClass"
              @click="viewCustomerDetail(customer)"
            >
              {{ customer.initials }}
            </button>

            <!-- Customer Meta -->
            <div class="min-w-0 flex-1">
              <div class="flex items-center justify-between gap-2">
                <h3
                  class="truncate text-base font-bold text-ink-primary transition group-hover:text-primary cursor-pointer"
                  @click="viewCustomerDetail(customer)"
                >
                  {{ customer.name }}
                </h3>

                <!-- Loyalty / Purchase Badge -->
                <span
                  v-if="customer.trxCount > 0"
                  class="shrink-0 inline-flex items-center rounded-full bg-emerald-50 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-700 border border-emerald-200/50"
                >
                  {{ customer.trxCount }}x &bull; {{ formatCurrency(customer.totalSpent) }}
                </span>
                <span
                  v-else
                  class="shrink-0 inline-flex items-center rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-medium text-zinc-500"
                >
                  Belum belanja
                </span>
              </div>

              <!-- Contact Pills -->
              <div class="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-ink-secondary">
                <!-- Phone -->
                <span v-if="customer.phone" class="inline-flex items-center gap-1 font-mono text-[11px] text-zinc-700 bg-zinc-100/80 px-2 py-0.5 rounded-lg">
                  <svg class="h-3 w-3 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                  </svg>
                  {{ customer.phone }}
                </span>
                <span v-else class="text-[11px] text-zinc-400 italic">Tanpa No. HP</span>

                <!-- Email -->
                <span v-if="customer.email" class="inline-flex items-center gap-1 text-[11px] text-zinc-600 bg-zinc-100/80 px-2 py-0.5 rounded-lg truncate max-w-[170px]">
                  <svg class="h-3 w-3 text-indigo-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                  </svg>
                  <span class="truncate">{{ customer.email }}</span>
                </span>
              </div>
            </div>
          </div>

          <!-- Bottom Action Buttons Grid -->
          <div class="mt-3 flex flex-wrap items-center justify-between gap-1.5 border-t border-zinc-100 pt-2.5">
            <!-- Left: Direct WhatsApp Quick Action & Detail -->
            <div class="flex items-center gap-1.5">
              <button
                v-if="customer.phone"
                type="button"
                class="inline-flex items-center gap-1 rounded-xl bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-700 transition hover:bg-emerald-100 active:scale-95"
                title="Hubungi via WhatsApp"
                @click="openWhatsApp(customer)"
              >
                <svg class="h-3.5 w-3.5" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12.031 6.172c-3.181 0-5.767 2.586-5.768 5.766-.001 1.298.38 2.27 1.019 3.287l-.582 2.128 2.182-.573c.978.58 1.911.928 3.145.929 3.178 0 5.767-2.587 5.768-5.766.001-3.187-2.575-5.77-5.764-5.771zm3.392 8.244c-.144.405-.837.774-1.17.824-.312.045-.694.043-1.109-.089a7.078 7.078 0 0 1-1.077-.478 9.539 9.539 0 0 1-2.457-2.449c-.272-.37-.484-.799-.608-1.258-.152-.56.027-.98.24-1.205.111-.118.252-.266.393-.41.054-.055.109-.115.158-.173.12-.139.227-.149.333-.149.106 0 .213.003.307.009.117.008.232-.036.319.182.106.265.362.885.393.949.032.064.053.139.011.223-.043.085-.064.139-.128.213-.064.074-.135.166-.192.223-.064.064-.131.134-.056.263.075.129.333.551.715.891.492.438.907.574 1.036.638.128.064.203.053.278-.032.074-.085.32-.373.405-.501.085-.128.17-.107.288-.064.117.043.746.352.874.416.128.064.213.096.245.149.032.053.032.31-.112.715z" />
                </svg>
                WA
              </button>

              <button
                type="button"
                class="inline-flex items-center gap-1 rounded-xl bg-zinc-100 px-2.5 py-1 text-xs font-medium text-zinc-700 transition hover:bg-zinc-200 active:scale-95"
                @click="viewCustomerDetail(customer)"
              >
                Detail
              </button>
            </div>

            <!-- Right: Edit & Delete -->
            <div class="flex items-center gap-1.5 ml-auto">
              <BaseButton size="sm" variant="secondary" class="h-7 px-2 text-xs" @click="goToEdit(customer)">
                <svg class="mr-0.5 h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                </svg>
                Edit
              </BaseButton>

              <BaseButton size="sm" variant="danger" class="h-7 px-2 text-xs" @click="confirmDelete(customer)">
                <svg class="mr-0.5 h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
                Delete
              </BaseButton>
            </div>
          </div>
        </article>
      </div>

      <!-- Search Empty State -->
      <div
        v-else-if="searchQuery || activeFilter !== 'all'"
        class="rounded-3xl border border-dashed border-zinc-200 bg-white p-8 text-center shadow-xs space-y-3"
      >
        <div class="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-zinc-100 text-zinc-400">
          <svg class="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
        </div>
        <div>
          <h3 class="text-base font-bold text-ink-primary">Pelanggan tidak ditemukan</h3>
          <p class="mt-1 text-xs text-ink-secondary">
            Tidak ada pelanggan yang cocok dengan kriteria pencarian Anda.
          </p>
        </div>
        <button
          type="button"
          class="inline-flex items-center rounded-xl bg-zinc-100 px-3.5 py-2 text-xs font-semibold text-zinc-700 transition hover:bg-zinc-200 active:scale-95"
          @click="searchQuery = ''; activeFilter = 'all'"
        >
          Reset Pencarian & Filter
        </button>
      </div>

      <!-- Completely Empty State -->
      <div
        v-else
        class="rounded-3xl border border-dashed border-zinc-200 bg-white p-8 text-center shadow-xs space-y-4"
      >
        <div class="mx-auto flex h-16 w-16 items-center justify-center rounded-3xl bg-primary/10 text-primary">
          <AppIcon name="customers" class="h-8 w-8" />
        </div>
        <div class="max-w-xs mx-auto">
          <h3 class="text-base font-bold text-ink-primary">Belum ada pelanggan</h3>
          <p class="mt-1 text-xs text-ink-secondary leading-relaxed">
            Catat nama & nomor HP pelanggan untuk memudahkan pengiriman struk digital dan program loyalitas.
          </p>
        </div>
        <BaseButton @click="goToCreate">
          Tambah Customer Pertama
        </BaseButton>
      </div>
    </section>

    <!-- Modal: Customer Detail Profile & Purchase History -->
    <BaseModal
      :open="Boolean(selectedCustomer)"
      title="Profil Pelanggan"
      @close="selectedCustomer = null"
    >
      <div v-if="selectedCustomer" class="space-y-4">
        <!-- Top Profile Badge -->
        <div class="flex items-center gap-3.5 rounded-2xl bg-surface p-4">
          <div
            class="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl text-lg font-black shadow-soft"
            :class="selectedCustomer.avatarClass"
          >
            {{ selectedCustomer.initials }}
          </div>
          <div class="min-w-0 flex-1">
            <h4 class="truncate text-lg font-black text-ink-primary">{{ selectedCustomer.name }}</h4>
            <p v-if="selectedCustomer.phone" class="font-mono text-xs text-zinc-600 mt-0.5">
              {{ selectedCustomer.phone }}
            </p>
            <p v-if="selectedCustomer.email" class="truncate text-xs text-zinc-500">
              {{ selectedCustomer.email }}
            </p>
          </div>
        </div>

        <!-- Quick Contact Shortcuts -->
        <div class="grid grid-cols-2 gap-2">
          <a
            v-if="selectedCustomer.phone"
            :href="selectedCustomer.waUrl"
            target="_blank"
            class="flex items-center justify-center gap-2 rounded-2xl bg-emerald-500 py-2.5 px-3 text-xs font-bold text-white shadow-soft transition hover:bg-emerald-600 active:scale-95"
          >
            <svg class="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12.031 6.172c-3.181 0-5.767 2.586-5.768 5.766-.001 1.298.38 2.27 1.019 3.287l-.582 2.128 2.182-.573c.978.58 1.911.928 3.145.929 3.178 0 5.767-2.587 5.768-5.766.001-3.187-2.575-5.77-5.764-5.771zm3.392 8.244c-.144.405-.837.774-1.17.824-.312.045-.694.043-1.109-.089a7.078 7.078 0 0 1-1.077-.478 9.539 9.539 0 0 1-2.457-2.449c-.272-.37-.484-.799-.608-1.258-.152-.56.027-.98.24-1.205.111-.118.252-.266.393-.41.054-.055.109-.115.158-.173.12-.139.227-.149.333-.149.106 0 .213.003.307.009.117.008.232-.036.319.182.106.265.362.885.393.949.032.064.053.139.011.223-.043.085-.064.139-.128.213-.064.074-.135.166-.192.223-.064.064-.131.134-.056.263.075.129.333.551.715.891.492.438.907.574 1.036.638.128.064.203.053.278-.032.074-.085.32-.373.405-.501.085-.128.17-.107.288-.064.117.043.746.352.874.416.128.064.213.096.245.149.032.053.032.31-.112.715z" />
            </svg>
            Chat WhatsApp
          </a>
          <a
            v-if="selectedCustomer.phone"
            :href="`tel:${selectedCustomer.phone}`"
            class="flex items-center justify-center gap-2 rounded-2xl border border-zinc-200 bg-white py-2.5 px-3 text-xs font-bold text-zinc-700 shadow-xs transition hover:bg-zinc-50 active:scale-95"
          >
            <svg class="h-4 w-4 text-zinc-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
            </svg>
            Telepon
          </a>
        </div>

        <!-- Metrics Cards 2x2 -->
        <div class="grid grid-cols-2 gap-2.5 pt-1">
          <div class="rounded-2xl border border-zinc-100 bg-white p-3 shadow-xs">
            <span class="text-[10px] font-semibold uppercase text-ink-secondary">Total Belanja</span>
            <p class="mt-1 font-mono text-base font-bold text-primary">
              {{ formatCurrency(selectedCustomer.totalSpent) }}
            </p>
          </div>
          <div class="rounded-2xl border border-zinc-100 bg-white p-3 shadow-xs">
            <span class="text-[10px] font-semibold uppercase text-ink-secondary">Jumlah Transaksi</span>
            <p class="mt-1 text-base font-bold text-ink-primary">
              {{ selectedCustomer.trxCount }} Kali
            </p>
          </div>
        </div>

        <!-- Recent Transactions List -->
        <div class="space-y-2 pt-1">
          <div class="flex items-center justify-between">
            <span class="text-xs font-bold text-ink-primary">Riwayat Transaksi Terakhir</span>
            <span class="text-[11px] text-ink-secondary">{{ selectedCustomer.recentTrx?.length || 0 }} nota</span>
          </div>

          <div v-if="selectedCustomer.recentTrx?.length" class="max-h-48 overflow-y-auto space-y-2 pr-1">
            <div
              v-for="trx in selectedCustomer.recentTrx.slice(0, 5)"
              :key="trx.id"
              class="flex items-center justify-between rounded-xl border border-zinc-100 bg-surface/70 px-3 py-2 text-xs"
            >
              <div>
                <p class="font-mono font-semibold text-ink-primary">{{ trx.invoiceNumber || trx.id }}</p>
                <p class="text-[10px] text-ink-secondary">{{ formatDateTime(trx.createdAt) }}</p>
              </div>
              <div class="text-right">
                <p class="font-mono font-bold text-ink-primary">{{ formatCurrency(trx.total) }}</p>
                <span class="text-[10px] uppercase font-medium text-emerald-600">{{ trx.paymentMethod || 'Tunai' }}</span>
              </div>
            </div>
          </div>

          <p v-else class="text-center py-4 text-xs text-zinc-400 italic">
            Belum ada histori transaksi untuk pelanggan ini.
          </p>
        </div>

        <!-- Modal Actions -->
        <div class="flex items-center gap-2 pt-2 border-t border-zinc-100">
          <BaseButton block variant="secondary" @click="goToEdit(selectedCustomer)">
            Edit Data Pelanggan
          </BaseButton>
          <BaseButton block variant="ghost" @click="selectedCustomer = null">
            Tutup
          </BaseButton>
        </div>
      </div>
    </BaseModal>

    <!-- Modal: Sleek Delete Confirmation -->
    <BaseModal
      :open="Boolean(customerToDelete)"
      title="Hapus Pelanggan"
      @close="customerToDelete = null"
    >
      <div v-if="customerToDelete" class="space-y-4">
        <div class="flex items-center gap-3 rounded-2xl bg-rose-50 p-3.5 text-rose-800">
          <div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-rose-100 text-rose-600">
            <svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
          <div class="min-w-0">
            <h4 class="text-sm font-bold text-rose-900">Yakin hapus pelanggan ini?</h4>
            <p class="text-xs text-rose-700 mt-0.5">
              Data pelanggan <strong>"{{ customerToDelete.name }}"</strong> akan dihapus dari sistem.
            </p>
          </div>
        </div>

        <p class="text-xs text-ink-secondary leading-relaxed">
          Catatan: Histori transaksi penjualan yang pernah dilakukan pelanggan ini tidak akan terhapus demi integritas laporan pembukuan toko.
        </p>

        <div class="flex items-center gap-2 pt-2">
          <BaseButton block variant="secondary" @click="customerToDelete = null">
            Batal
          </BaseButton>
          <BaseButton block variant="danger" @click="executeDelete">
            Hapus Pelanggan
          </BaseButton>
        </div>
      </div>
    </BaseModal>
  </div>
</template>
