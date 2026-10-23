<script setup>
import { computed, onMounted, ref } from 'vue'
import { RouterLink } from 'vue-router'

import AppIcon from '@/components/base/AppIcon.vue'
import BaseBadge from '@/components/base/BaseBadge.vue'
import HomeSalesChart from '@/components/home/HomeSalesChart.vue'
import { usePullToRefresh } from '@/composables/usePullToRefresh'
import { getOperationalMenuItems } from '@/navigation/operationalMenu'
import { useBusinessStore } from '@/stores/businessStore'
import { useCashStore } from '@/stores/cashStore'
import { useProductStore } from '@/stores/productStore'
import { useShiftStore } from '@/stores/shiftStore'
import { useSyncStatusStore } from '@/stores/syncStatusStore'
import { useCloudSessionStore } from '@/stores/cloudSessionStore'
import { useSyncPullStore } from '@/stores/syncPullStore'
import { isPaidTransaction, useTransactionStore } from '@/stores/transactionStore'
import { formatCurrency } from '@/utils/formatters'

const businessStore = useBusinessStore()
const cashStore = useCashStore()
const productStore = useProductStore()
const shiftStore = useShiftStore()
const syncStatusStore = useSyncStatusStore()
const transactionStore = useTransactionStore()
const cloudStore = useCloudSessionStore()
const syncPullStore = useSyncPullStore()
const refreshRoot = ref(null)

onMounted(async () => {
  if (cloudStore.isLinked && cloudStore.isOperationalCloudAccess && productStore.products.length === 0) {
    void syncPullStore.ensureCatalogLoaded()
  }
})

async function refreshHome() {
  return syncStatusStore.refresh()
}

const {
  indicatorOffset,
  isDragging,
  isRefreshing,
  isVisible: isRefreshIndicatorVisible,
  message: refreshMessage,
} = usePullToRefresh({
  root: refreshRoot,
  onRefresh: refreshHome,
})

function isToday(dateString) {
  if (!dateString) return false
  const date = new Date(dateString)
  const today = new Date()

  return (
    date.getFullYear() === today.getFullYear() &&
    date.getMonth() === today.getMonth() &&
    date.getDate() === today.getDate()
  )
}

const todayTransactions = computed(() =>
  transactionStore.items.filter((transaction) => isToday(transaction.createdAt)),
)
const todayRevenue = computed(() =>
  transactionStore.items
    .filter(isPaidTransaction)
    .filter((transaction) => isToday(transaction.paidAt ?? transaction.createdAt))
    .reduce((sum, transaction) => sum + Number(transaction.total || 0), 0),
)
const menuItems = computed(() => getOperationalMenuItems(businessStore.normalizedType))

const isLaundry = computed(() => businessStore.normalizedType === 'Laundry')

const todayFormatted = computed(() => {
  const now = new Date()
  const day = now.getDate()
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des']
  return `${day} ${monthNames[now.getMonth()]} ${now.getFullYear()}`
})

const laundryStatusSummaries = computed(() => {
  const counts = {
    Masuk: 0,
    Diproses: 0,
    'Siap Diambil': 0,
    Selesai: 0,
  }

  for (const item of transactionStore.items) {
    if (item.orderStatus && counts[item.orderStatus] !== undefined) {
      counts[item.orderStatus]++
    }
  }

  return [
    { status: 'Masuk', count: counts.Masuk, tone: 'text-primary' },
    { status: 'Diproses', count: counts.Diproses, tone: 'text-indigo-600' },
    { status: 'Siap Diambil', count: counts['Siap Diambil'], tone: 'text-amber-600' },
    { status: 'Selesai', count: counts.Selesai, tone: 'text-emerald-600' },
  ]
})
</script>

<template>
  <div ref="refreshRoot" data-testid="home-pull-to-refresh" class="relative space-y-4 pb-28 sm:pb-16">
    <!-- Pull to refresh spinner indicator -->
    <div
      v-show="isRefreshIndicatorVisible"
      class="pointer-events-none absolute inset-x-0 -top-11 z-10 flex items-center justify-center gap-2 text-sm font-medium text-ink-secondary"
      aria-live="polite"
      :style="{ transform: `translateY(${indicatorOffset}px)` }"
    >
      <span
        class="h-4 w-4 rounded-full border-2 border-primary/25 border-t-primary"
        :class="isRefreshing ? 'animate-spin' : ''"
      />
      <span>{{ refreshMessage }}</span>
    </div>

    <div
      class="space-y-4"
      :class="
        isDragging || isRefreshing
          ? 'transition-transform duration-150'
          : 'transition-transform duration-300'
      "
      :style="{ transform: `translateY(${indicatorOffset}px)` }"
    >
      <!-- Minimalist Header Profile Card -->
      <header class="flex items-center justify-between gap-3 rounded-2xl bg-white px-4 py-3.5 border border-zinc-200/80 shadow-soft">
        <div class="min-w-0">
          <h2 class="truncate text-base font-bold text-ink-primary sm:text-lg">
            {{ businessStore.name || 'POS Mobile' }}
          </h2>
          <p class="truncate text-xs text-ink-secondary mt-0.5">
            {{ businessStore.outlet || 'Outlet Utama' }} &middot; {{ businessStore.normalizedType }}
          </p>
        </div>

        <RouterLink to="/shift/open" class="shrink-0 transition active:scale-95">
          <BaseBadge :variant="shiftStore.isOpen ? 'success' : 'warning'" class="cursor-pointer">
            <span class="mr-1.5 inline-block h-1.5 w-1.5 rounded-full" :class="shiftStore.isOpen ? 'bg-emerald-500' : 'bg-amber-500'" />
            {{ shiftStore.isOpen ? 'Shift Aktif' : 'Shift Tutup' }}
          </BaseBadge>
        </RouterLink>
      </header>

      <!-- Minimalist Hero: Omzet Hari Ini & Quick Stats -->
      <section class="min-h-[88px] rounded-3xl border border-zinc-200/80 bg-white p-5 shadow-soft space-y-4">
        <div class="flex items-center justify-between">
          <div>
            <p class="text-xs font-semibold uppercase tracking-wider text-ink-secondary">
              Omzet Hari Ini
            </p>
            <p class="mt-1 font-mono text-2xl font-bold tracking-tight text-primary sm:text-3xl" data-testid="today-revenue">
              {{ formatCurrency(todayRevenue) }}
            </p>
          </div>
          <div class="text-right">
            <span class="inline-flex items-center rounded-full bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary">
              {{ todayFormatted }}
            </span>
          </div>
        </div>

        <!-- Quick Stats Chips -->
        <div class="grid grid-cols-2 gap-2.5 pt-3 border-t border-zinc-100 sm:grid-cols-3">
          <div class="min-h-[88px] rounded-2xl bg-surface p-3.5 flex flex-col justify-between">
            <p class="text-xs font-medium uppercase tracking-[0.14em] text-ink-secondary">
              {{ isLaundry ? 'Order Hari Ini' : 'Transaksi Hari Ini' }}
            </p>
            <p class="mt-1 font-mono text-xl font-bold text-ink-primary" data-testid="today-transaction-count">
              {{ todayTransactions.length }}
            </p>
          </div>

          <div class="min-h-[88px] rounded-2xl bg-surface p-3.5 flex flex-col justify-between">
            <p class="text-xs font-medium uppercase tracking-[0.14em] text-ink-secondary">
              Saldo Kas
            </p>
            <p class="mt-1 font-mono text-base sm:text-xl font-bold text-success truncate" data-testid="today-cash-balance">
              {{ formatCurrency(cashStore.balance) }}
            </p>
          </div>

          <div v-if="!isLaundry" class="col-span-2 sm:col-span-1 min-h-[88px] rounded-2xl bg-surface p-3.5 flex flex-col justify-between">
            <p class="text-xs font-medium uppercase tracking-[0.14em] text-ink-secondary">
              Stok Minimum
            </p>
            <p class="mt-1 font-mono text-xl font-bold text-warning" data-testid="today-low-stock-count">
              {{ productStore.lowStockProducts.length }}
            </p>
          </div>
        </div>

        <!-- Laundry Order Status Shortcuts -->
        <div
          v-if="isLaundry"
          class="space-y-2 border-t border-zinc-100 pt-3"
          data-testid="laundry-status-summaries"
        >
          <div class="flex items-center justify-between">
            <p class="text-xs font-semibold uppercase tracking-wider text-ink-secondary">
              Status Order Laundry
            </p>
            <RouterLink to="/laundry/orders" class="text-xs font-medium text-primary hover:underline">
              Lihat Semua &rarr;
            </RouterLink>
          </div>

          <div class="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <RouterLink
              v-for="item in laundryStatusSummaries"
              :key="item.status"
              :to="{ path: '/laundry/orders', query: { status: item.status } }"
              :data-testid="`laundry-summary-${item.status}`"
              class="group rounded-2xl border border-zinc-200/70 bg-white p-3 shadow-xs transition hover:border-primary/40 hover:shadow-soft"
            >
              <p class="text-[11px] font-medium text-ink-secondary group-hover:text-primary transition">
                {{ item.status }}
              </p>
              <p class="mt-0.5 text-lg font-bold" :class="item.tone">{{ item.count }}</p>
            </RouterLink>
          </div>
        </div>
      </section>

      <!-- Grafik Penjualan (Minimalist Curve & Period Switcher) -->
      <HomeSalesChart />

      <!-- Minimalist Operational Menu Grid -->
      <section class="space-y-3 pt-1">
        <div class="flex items-center justify-between px-1">
          <h3 class="text-base font-bold text-ink-primary">Menu Operasional</h3>
          <span class="text-xs text-ink-secondary">{{ menuItems.length }} Menu</span>
        </div>

        <div class="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <RouterLink
            v-for="item in menuItems"
            :key="item.key"
            :to="item.to"
            :data-testid="`home-menu-${item.key}`"
            class="group flex flex-col justify-between rounded-2xl border border-zinc-200/80 bg-white p-4 shadow-soft transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-primary/20 active:scale-[0.98]"
          >
            <div class="flex items-start justify-between">
              <span
                class="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary transition group-hover:bg-primary group-hover:text-white"
              >
                <AppIcon :name="item.icon" class="h-5 w-5" />
              </span>
            </div>

            <div class="mt-3.5">
              <span class="block text-sm font-bold text-ink-primary group-hover:text-primary transition">
                {{ item.title }}
              </span>
              <span class="mt-0.5 block text-xs leading-tight text-ink-secondary line-clamp-1">
                {{ item.subtitle }}
              </span>
            </div>
          </RouterLink>
        </div>
      </section>
    </div>
  </div>
</template>
