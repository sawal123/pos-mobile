<script setup>
import { computed } from 'vue'
import { useRouter } from 'vue-router'

import BaseBadge from '@/components/base/BaseBadge.vue'
import { formatCurrency, formatDateTime } from '@/utils/formatters'

const router = useRouter()

const props = defineProps({
  transaction: {
    type: Object,
    required: true,
  },
})

const canAddOrder = computed(() => {
  const os = String(props.transaction.orderStatus ?? props.transaction.order_status ?? '').toLowerCase()
  const ps = String(props.transaction.paymentStatus ?? props.transaction.payment_status ?? props.transaction.status ?? '').toLowerCase()
  return os === 'proses' || os === 'diproses' || ps === 'unpaid' || ps === 'pending' || ps === 'tempo' || ps === 'belum lunas'
})

function goToAddInPos() {
  if (router) {
    router.push({ path: '/pos', query: { add_to_order: props.transaction.id } })
  }
}

const displayId = computed(() => {
  if (props.transaction.invoiceNumber) {
    return props.transaction.invoiceNumber
  }
  if (props.transaction.invoice_number) {
    return props.transaction.invoice_number
  }
  if (props.transaction.orderNumber) {
    return props.transaction.orderNumber
  }
  if (props.transaction.order_number) {
    return props.transaction.order_number
  }
  const raw = String(props.transaction.id ?? '')
  if (raw.length > 12) {
    return `#${raw.slice(0, 8).toUpperCase()}`
  }
  return raw
})

const itemCount = computed(() => {
  if (typeof props.transaction.itemCount === 'number') {
    return props.transaction.itemCount
  }
  if (typeof props.transaction.item_count === 'number') {
    return props.transaction.item_count
  }
  if (Array.isArray(props.transaction.items)) {
    return props.transaction.items.reduce(
      (count, item) => count + (Number(item.qty ?? item.quantity) || 1),
      0,
    )
  }
  return typeof props.transaction.items === 'number' ? props.transaction.items : 0
})

const itemsPreview = computed(() => {
  if (!Array.isArray(props.transaction.items) || props.transaction.items.length === 0) {
    return null
  }
  return props.transaction.items
    .map((item) => {
      const name = item.name || item.product_name || item.serviceName || 'Item'
      const qty = Number(item.qty ?? item.quantity) || 1
      return `${name} (${qty}x)`
    })
    .join(', ')
})

const paymentMethodLabel = computed(() => {
  const method = `${props.transaction.paymentMethod ?? props.transaction.payment_method ?? ''}`.toLowerCase()
  if (method === 'qris') return 'QRIS'
  if (method === 'card' || method === 'kartu') return 'Card'
  if (method === 'cash' || method === 'tunai') return 'Cash'
  if (method === 'transfer') return 'Transfer'
  if (method === 'unpaid') return 'Tempo'
  return props.transaction.paymentMethod || props.transaction.payment_method || '-'
})

const paymentBadge = computed(() => {
  const pStatus = `${props.transaction.paymentStatus ?? props.transaction.payment_status ?? props.transaction.status ?? ''}`.toLowerCase()
  if (pStatus === 'unpaid' || pStatus === 'pending' || pStatus === 'tempo' || pStatus === 'belum lunas') {
    return { label: 'Belum Lunas', variant: 'warning' }
  }
  if (pStatus === 'refund' || pStatus === 'refunded') {
    return { label: 'Refund', variant: 'purple' }
  }
  if (pStatus === 'paid' || pStatus === 'lunas' || pStatus === 'completed') {
    return { label: 'Lunas', variant: 'success' }
  }
  return { label: props.transaction.paymentStatus || props.transaction.status || 'Lunas', variant: 'success' }
})

const orderBadge = computed(() => {
  const os = props.transaction.orderStatus ?? props.transaction.order_status
  if (!os) {
    if (props.transaction.status === 'completed') {
      return { label: 'Selesai', variant: 'success' }
    }
    return null
  }
  const s = String(os).toLowerCase()
  if (s === 'batal' || s === 'cancelled' || s === 'void') {
    return { label: 'Batal', variant: 'danger' }
  }
  if (s === 'proses' || s === 'diproses' || s === 'processing' || s === 'masuk') {
    return { label: 'Proses', variant: 'info' }
  }
  if (s === 'siap' || s === 'siap diambil' || s === 'ready') {
    return { label: 'Siap', variant: 'success' }
  }
  if (s === 'selesai' || s === 'completed') {
    return { label: 'Selesai', variant: 'success' }
  }
  return { label: os, variant: 'info' }
})

function statusVariant(status) {
  if (status === 'paid' || status === 'completed') return 'success'
  if (status === 'refunded') return 'purple'
  if (status === 'unpaid' || status === 'pending') return 'warning'
  return 'neutral'
}

function statusLabel(status) {
  if (status === 'paid') return 'Lunas'
  if (status === 'completed') return 'Selesai'
  if (status === 'refunded') return 'Refund'
  if (status === 'unpaid' || status === 'pending') return 'Belum Lunas'
  return status || '-'
}

const txDate = computed(() => {
  return props.transaction.createdAt || props.transaction.created_at || props.transaction.date || props.transaction.timestamp
})
</script>

<template>
  <div
    class="group relative rounded-3xl border border-zinc-200/70 bg-white p-4 shadow-soft transition hover:border-primary/40 hover:shadow-medium active:scale-[0.99] space-y-2.5"
    data-testid="transaction-card"
  >
    <!-- Top Row: ID & Badges -->
    <div class="flex items-center justify-between gap-2">
      <span class="font-mono text-xs font-semibold uppercase tracking-wider text-primary">
        {{ displayId }}
      </span>

      <div class="flex items-center gap-1.5 flex-wrap justify-end">
        <BaseBadge
          v-if="orderBadge"
          :variant="orderBadge.variant"
          class="capitalize"
          data-testid="order-status-badge"
        >
          {{ orderBadge.label }}
        </BaseBadge>
        <BaseBadge
          :variant="paymentBadge.variant"
          class="capitalize"
          data-testid="payment-status-badge"
        >
          {{ paymentBadge.label }}
        </BaseBadge>
      </div>
    </div>

    <!-- Middle: Customer & Items Preview -->
    <div>
      <h3 class="text-base font-semibold text-ink-primary truncate">
        {{ transaction.customer || transaction.customer_name || 'Walk-in Customer' }}
      </h3>

      <p v-if="itemsPreview" class="mt-0.5 text-xs text-ink-secondary truncate">
        {{ itemsPreview }}
      </p>
    </div>

    <!-- Bottom: Meta Info & Total Amount -->
    <div class="flex items-end justify-between gap-3 border-t border-zinc-100 pt-2.5">
      <div class="space-y-0.5 text-xs text-ink-secondary">
        <div class="flex items-center gap-1.5 font-medium">
          <span>{{ itemCount }} item</span>
          <span class="text-zinc-300">•</span>
          <span class="uppercase tracking-wide font-semibold text-zinc-700">
            {{ paymentMethodLabel }}
          </span>
        </div>
        <p class="text-[11px] text-zinc-400">
          {{ formatDateTime(txDate) }}
        </p>
      </div>

      <div class="flex items-center gap-2">
        <button
          v-if="canAddOrder"
          type="button"
          data-testid="btn-card-add-items"
          title="Tambah pesanan langsung di kasir"
          class="inline-flex items-center gap-1 rounded-xl bg-sky-50 border border-sky-200/80 px-2.5 py-1 text-xs font-bold text-sky-700 hover:bg-sky-100 active:scale-95 transition cursor-pointer whitespace-nowrap dark:bg-sky-950/60 dark:text-sky-300 dark:border-sky-800"
          @click.stop.prevent="goToAddInPos"
        >
          <svg class="h-3 w-3 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          <span>Tambah Pesanan</span>
        </button>

        <div class="text-right">
          <span class="text-base font-bold text-ink-primary dark:text-white">
            {{ formatCurrency(transaction.total) }}
          </span>
        </div>
      </div>
    </div>
  </div>
</template>
