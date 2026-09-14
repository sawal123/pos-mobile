<script setup>
import { computed } from 'vue'
import { RouterLink } from 'vue-router'

import AppIcon from '@/components/base/AppIcon.vue'
import BaseBadge from '@/components/base/BaseBadge.vue'
import BaseCard from '@/components/base/BaseCard.vue'
import { getOperationalMenuItems } from '@/navigation/operationalMenu'
import { useBusinessStore } from '@/stores/businessStore'
import { useCashStore } from '@/stores/cashStore'
import { useProductStore } from '@/stores/productStore'
import { useShiftStore } from '@/stores/shiftStore'
import { useTransactionStore } from '@/stores/transactionStore'
import { formatCurrency } from '@/utils/formatters'

const businessStore = useBusinessStore()
const cashStore = useCashStore()
const productStore = useProductStore()
const shiftStore = useShiftStore()
const transactionStore = useTransactionStore()

function isToday(dateString) {
  const date = new Date(dateString)
  const today = new Date()

  return date.getFullYear() === today.getFullYear()
    && date.getMonth() === today.getMonth()
    && date.getDate() === today.getDate()
}

const todayTransactions = computed(() => transactionStore.items.filter((transaction) => isToday(transaction.createdAt)))
const todayRevenue = computed(() => todayTransactions.value.reduce((sum, transaction) => sum + Number(transaction.total || 0), 0))
const menuItems = computed(() => getOperationalMenuItems(businessStore.normalizedType))

const isLaundry = computed(() => businessStore.normalizedType === 'Laundry')

const summaries = computed(() => {
  if (isLaundry.value) {
    return [
      { label: 'Omzet Hari Ini', value: formatCurrency(todayRevenue.value), tone: 'text-primary' },
      { label: 'Order Hari Ini', value: todayTransactions.value.length, tone: 'text-ink-primary' },
      { label: 'Saldo Kas', value: formatCurrency(cashStore.balance), tone: 'text-success' },
    ]
  }

  return [
    { label: 'Omzet Hari Ini', value: formatCurrency(todayRevenue.value), tone: 'text-primary' },
    { label: 'Transaksi Hari Ini', value: todayTransactions.value.length, tone: 'text-ink-primary' },
    { label: 'Saldo Kas', value: formatCurrency(cashStore.balance), tone: 'text-success' },
    { label: 'Stok Minimum', value: productStore.lowStockProducts.length, tone: 'text-warning' },
  ]
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
  <div class="space-y-5">
    <BaseCard class="space-y-5">
      <div class="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div class="min-w-0">
          <p class="text-sm font-medium uppercase tracking-[0.18em] text-primary">Home</p>
          <h2 class="mt-2 truncate text-2xl font-semibold text-ink-primary">
            {{ businessStore.name || 'POS Mobile' }}
          </h2>
          <div class="mt-2 flex flex-wrap gap-2 text-sm text-ink-secondary">
            <span>{{ businessStore.outlet || 'Outlet Utama' }}</span>
            <span>{{ businessStore.normalizedType }}</span>
          </div>
        </div>

        <BaseBadge :variant="shiftStore.isOpen ? 'success' : 'warning'">
          {{ shiftStore.isOpen ? 'Shift Aktif' : 'Shift Belum Dibuka' }}
        </BaseBadge>
      </div>

      <div class="grid grid-cols-2 gap-3" :class="isLaundry ? 'lg:grid-cols-3' : 'lg:grid-cols-4'">
        <div
          v-for="summary in summaries"
          :key="summary.label"
          class="min-h-[88px] rounded-2xl bg-surface p-4"
        >
          <p class="text-xs font-medium uppercase tracking-[0.14em] text-ink-secondary">{{ summary.label }}</p>
          <p class="mt-2 break-words text-xl font-semibold" :class="summary.tone">{{ summary.value }}</p>
        </div>
      </div>

      <!-- Laundry Order Status summaries -->
      <div v-if="isLaundry" class="space-y-2 border-t border-zinc-100 pt-4" data-testid="laundry-status-summaries">
        <p class="text-xs font-semibold uppercase tracking-[0.14em] text-ink-secondary">Status Order Laundry</p>
        <div class="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <RouterLink
            v-for="item in laundryStatusSummaries"
            :key="item.status"
            :to="{ path: '/laundry/orders', query: { status: item.status } }"
            :data-testid="`laundry-summary-${item.status}`"
            class="group min-h-[80px] rounded-2xl border border-zinc-200/80 bg-white p-3.5 shadow-soft transition hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md"
          >
            <p class="text-xs font-medium text-ink-secondary group-hover:text-primary transition">{{ item.status }}</p>
            <p class="mt-1 text-2xl font-bold" :class="item.tone">{{ item.count }}</p>
          </RouterLink>
        </div>
      </div>
    </BaseCard>

    <section class="space-y-3">
      <div>
        <h3 class="text-lg font-semibold text-ink-primary">Menu Operasional</h3>
      </div>

      <div class="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <RouterLink
          v-for="item in menuItems"
          :key="item.key"
          :to="item.to"
          :data-testid="`home-menu-${item.key}`"
          class="min-h-[116px] rounded-3xl bg-card p-4 shadow-soft transition hover:-translate-y-0.5 hover:shadow-md focus:outline-none focus:ring-4 focus:ring-primary/15"
        >
          <span class="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <AppIcon :name="item.icon" />
          </span>
          <span class="mt-4 block text-base font-semibold text-ink-primary">{{ item.title }}</span>
          <span class="mt-1 block text-sm leading-snug text-ink-secondary">{{ item.subtitle }}</span>
        </RouterLink>
      </div>
    </section>
  </div>
</template>
