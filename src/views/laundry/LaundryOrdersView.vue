<script setup>
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import AppIcon from '@/components/base/AppIcon.vue'
import BaseBadge from '@/components/base/BaseBadge.vue'
import BaseButton from '@/components/base/BaseButton.vue'
import BaseCard from '@/components/base/BaseCard.vue'
import BaseInput from '@/components/base/BaseInput.vue'
import { useTransactionStore } from '@/stores/transactionStore'
import { formatCurrency, formatDateTime } from '@/utils/formatters'

const route = useRoute()
const router = useRouter()
const transactionStore = useTransactionStore()

const searchQuery = ref('')
const selectedStatus = ref('Semua')

const statuses = ['Semua', 'Masuk', 'Diproses', 'Siap Diambil', 'Selesai']

watch(
  () => route.query.status,
  (status) => {
    if (typeof status === 'string' && statuses.includes(status)) {
      selectedStatus.value = status
    }
  },
  { immediate: true },
)

const laundryOrders = computed(() => {
  return transactionStore.items.filter((item) => {
    // An order is a laundry order if it has orderNumber, orderStatus, or pricingUnit
    return Boolean(item.orderNumber || item.orderStatus || item.estimatedCompletedAt)
  })
})

const statusCounts = computed(() => {
  const counts = {
    Semua: laundryOrders.value.length,
    Masuk: 0,
    Diproses: 0,
    'Siap Diambil': 0,
    Selesai: 0,
  }

  for (const order of laundryOrders.value) {
    if (order.orderStatus && counts[order.orderStatus] !== undefined) {
      counts[order.orderStatus]++
    }
  }

  return counts
})

const filteredOrders = computed(() => {
  let list = [...laundryOrders.value]

  // Filter by order status
  if (selectedStatus.value !== 'Semua') {
    list = list.filter((order) => order.orderStatus === selectedStatus.value)
  }

  // Filter by search query
  if (searchQuery.value.trim()) {
    const q = searchQuery.value.trim().toLowerCase()
    list = list.filter((order) => {
      const orderNumber = (order.orderNumber || order.invoiceNumber || '').toLowerCase()
      const customer = (order.customer || '').toLowerCase()
      const phone = (order.customerSnapshot?.phone || '').toLowerCase()
      return orderNumber.includes(q) || customer.includes(q) || phone.includes(q)
    })
  }

  // Sort newest first
  list.sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime())

  return list
})

function orderStatusVariant(status) {
  if (status === 'Masuk') return 'neutral'
  if (status === 'Diproses') return 'primary'
  if (status === 'Siap Diambil') return 'warning'
  if (status === 'Selesai') return 'success'
  return 'neutral'
}

function paymentStatusVariant(status) {
  if (status === 'paid') return 'success'
  return 'danger'
}

function paymentStatusLabel(status) {
  if (status === 'paid') return 'Lunas'
  return 'Belum Lunas'
}

function formatEstimatedCompletion(datetime) {
  if (!datetime) return '-'
  return formatDateTime(datetime)
}
</script>

<template>
  <div class="space-y-4">
    <!-- Header -->
    <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <p class="text-xs font-semibold uppercase tracking-wider text-primary">Laundry Service</p>
        <h1 class="text-2xl font-bold text-ink-primary">Daftar Order Laundry</h1>
      </div>
      <BaseButton
        data-testid="btn-create-order"
        @click="router.push('/laundry/orders/create')"
      >
        + Order Baru
      </BaseButton>
    </div>

    <!-- Search input -->
    <div>
      <BaseInput
        v-model="searchQuery"
        placeholder="Cari nomor order, nama customer, atau HP..."
        data-testid="search-order-input"
      />
    </div>

    <!-- Status filter chips -->
    <div class="no-scrollbar -mx-1 flex gap-2 overflow-x-auto px-1 py-1">
      <button
        v-for="status in statuses"
        :key="status"
        type="button"
        :data-testid="`filter-status-${status}`"
        class="inline-flex shrink-0 items-center gap-1.5 rounded-2xl px-3.5 py-2 text-xs font-medium transition"
        :class="selectedStatus === status
          ? 'bg-primary text-white shadow-soft'
          : 'border border-zinc-200 bg-white text-ink-secondary hover:border-zinc-300 hover:text-ink-primary'"
        @click="selectedStatus = status"
      >
        <span>{{ status }}</span>
        <span
          class="rounded-full px-1.5 py-0.5 text-[10px] font-semibold"
          :class="selectedStatus === status ? 'bg-white/20 text-white' : 'bg-zinc-100 text-ink-secondary'"
        >
          {{ statusCounts[status] ?? 0 }}
        </span>
      </button>
    </div>

    <!-- Order list -->
    <div v-if="filteredOrders.length > 0" class="space-y-3" data-testid="laundry-order-list">
      <div
        v-for="order in filteredOrders"
        :key="order.id"
        :data-testid="`order-card-${order.id}`"
        class="cursor-pointer rounded-3xl border border-zinc-200/80 bg-white p-4 shadow-soft transition hover:-translate-y-0.5 hover:shadow-md"
        @click="router.push(`/laundry/orders/${order.id}`)"
      >
        <!-- Top row: Order Number & Badges -->
        <div class="flex items-start justify-between gap-2">
          <div class="min-w-0">
            <span class="font-mono text-xs font-semibold text-primary" data-testid="order-number">
              {{ order.orderNumber || order.invoiceNumber }}
            </span>
            <h3 class="truncate text-base font-semibold text-ink-primary" data-testid="order-customer">
              {{ order.customer || order.customerSnapshot?.name || 'Walk-in' }}
            </h3>
            <p v-if="order.customerSnapshot?.phone" class="text-xs text-ink-secondary" data-testid="order-phone">
              {{ order.customerSnapshot.phone }}
            </p>
          </div>

          <div class="flex flex-col items-end gap-1.5 shrink-0">
            <BaseBadge
              :variant="orderStatusVariant(order.orderStatus)"
              data-testid="order-status-badge"
            >
              {{ order.orderStatus || 'Masuk' }}
            </BaseBadge>
            <BaseBadge
              :variant="paymentStatusVariant(order.paymentStatus)"
              size="sm"
              data-testid="order-payment-badge"
            >
              {{ paymentStatusLabel(order.paymentStatus) }}
            </BaseBadge>
          </div>
        </div>

        <!-- Services summary snippet -->
        <div v-if="order.items && order.items.length > 0" class="mt-3 rounded-2xl bg-zinc-50 p-2.5 text-xs text-ink-secondary">
          <div v-for="(item, idx) in order.items" :key="idx" class="flex justify-between py-0.5">
            <span class="truncate">{{ item.name || item.serviceName }} ({{ item.qty || item.quantity }} {{ item.unit || item.pricingUnit }})</span>
            <span class="font-medium text-ink-primary">{{ formatCurrency(item.subtotal || (item.price * item.qty)) }}</span>
          </div>
        </div>

        <!-- Bottom row: Dates & Total -->
        <div class="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-zinc-100 pt-3 text-xs">
          <div class="space-y-0.5 text-ink-secondary">
            <p>Waktu Masuk: <span class="text-ink-primary">{{ formatDateTime(order.createdAt) }}</span></p>
            <p>Estimasi: <span class="font-medium text-ink-primary">{{ formatEstimatedCompletion(order.estimatedCompletedAt) }}</span></p>
          </div>
          <div class="text-right">
            <p class="text-[11px] uppercase tracking-wider text-ink-secondary">Total</p>
            <p class="text-base font-bold text-ink-primary" data-testid="order-total">
              {{ formatCurrency(order.total) }}
            </p>
          </div>
        </div>
      </div>
    </div>

    <!-- Empty state -->
    <BaseCard v-else class="py-12 text-center" data-testid="empty-orders">
      <div class="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
        <AppIcon name="transactions" />
      </div>
      <h3 class="mt-3 text-base font-semibold text-ink-primary">Belum ada order laundry</h3>
      <p class="mt-1 text-sm text-ink-secondary">
        {{ searchQuery ? 'Tidak ada order yang cocok dengan pencarian.' : 'Mulai transaksi dengan membuat order baru.' }}
      </p>
      <div class="mt-4">
        <BaseButton @click="router.push('/laundry/orders/create')">
          Buat Order Sekarang
        </BaseButton>
      </div>
    </BaseCard>
  </div>
</template>
