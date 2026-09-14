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

const summaries = computed(() => [
  { label: 'Omzet Hari Ini', value: formatCurrency(todayRevenue.value), tone: 'text-primary' },
  { label: 'Transaksi Hari Ini', value: todayTransactions.value.length, tone: 'text-ink-primary' },
  { label: 'Saldo Kas', value: formatCurrency(cashStore.balance), tone: 'text-success' },
  { label: 'Stok Minimum', value: productStore.lowStockProducts.length, tone: 'text-warning' },
])
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

      <div class="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div
          v-for="summary in summaries"
          :key="summary.label"
          class="min-h-[88px] rounded-2xl bg-surface p-4"
        >
          <p class="text-xs font-medium uppercase tracking-[0.14em] text-ink-secondary">{{ summary.label }}</p>
          <p class="mt-2 break-words text-xl font-semibold" :class="summary.tone">{{ summary.value }}</p>
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
