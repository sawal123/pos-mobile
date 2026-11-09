<script setup>
import { computed } from 'vue'

import BaseBadge from '@/components/base/BaseBadge.vue'
import { formatCurrency, formatDateTime } from '@/utils/formatters'

const props = defineProps({
  transaction: {
    type: Object,
    required: true,
  },
})

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
  return props.transaction.paymentMethod || props.transaction.payment_method || '-'
})

function statusVariant(status) {
  if (status === 'paid' || status === 'completed') return 'success'
  if (status === 'refunded') return 'warning'
  return 'neutral'
}

function statusLabel(status) {
  if (status === 'paid') return 'Lunas'
  if (status === 'completed') return 'Selesai'
  if (status === 'refunded') return 'Refund'
  if (status === 'unpaid' || status === 'pending') return 'Belum Bayar'
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
    <!-- Top Row: ID & Status -->
    <div class="flex items-center justify-between gap-2">
      <span class="font-mono text-xs font-semibold uppercase tracking-wider text-primary">
        {{ displayId }}
      </span>

      <BaseBadge :variant="statusVariant(transaction.status)" class="capitalize">
        {{ statusLabel(transaction.status) }}
      </BaseBadge>
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

      <div class="text-right">
        <span class="text-base font-bold text-ink-primary">
          {{ formatCurrency(transaction.total) }}
        </span>
      </div>
    </div>
  </div>
</template>
