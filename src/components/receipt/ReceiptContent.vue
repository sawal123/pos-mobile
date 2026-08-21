<script setup>
import { computed } from 'vue'

import { formatCurrency, formatDateTime } from '@/utils/formatters'

const props = defineProps({
  transaction: {
    type: Object,
    required: true,
  },
  business: {
    type: Object,
    default: () => ({
      name: '',
      outlet: '',
      phone: '',
    }),
  },
})

const items = computed(() => (Array.isArray(props.transaction.items) ? props.transaction.items : []))

const paymentMethodLabel = computed(() => {
  const method = `${props.transaction.paymentMethod ?? ''}`.toLowerCase()

  if (method === 'qris') return 'QRIS'
  if (method === 'card') return 'Card'
  if (method === 'cash') return 'Cash'

  return props.transaction.paymentMethod || '-'
})

const showCashSummary = computed(() => (
  `${props.transaction.paymentMethod ?? ''}`.toLowerCase() === 'cash'
  && props.transaction.cashReceived != null
  && props.transaction.changeAmount != null
))
</script>

<template>
  <article class="mx-auto w-full max-w-md space-y-5 rounded-3xl bg-white p-6 text-sm text-ink-primary shadow-soft print:max-w-none print:rounded-none print:p-0 print:shadow-none">
    <header class="border-b border-dashed border-zinc-300 pb-4 text-center">
      <h1 class="text-xl font-semibold">{{ business.name || '-' }}</h1>
      <p class="mt-1 text-sm text-ink-secondary">{{ business.outlet || '-' }}</p>
      <p v-if="business.phone" class="mt-1 text-sm text-ink-secondary">{{ business.phone }}</p>
    </header>

    <section class="space-y-2 border-b border-dashed border-zinc-300 pb-4">
      <div class="flex items-start justify-between gap-4">
        <span class="text-ink-secondary">Invoice</span>
        <span class="text-right font-medium">{{ transaction.invoiceNumber || transaction.id }}</span>
      </div>
      <div class="flex items-start justify-between gap-4">
        <span class="text-ink-secondary">Tanggal</span>
        <span class="text-right font-medium">{{ formatDateTime(transaction.createdAt) }}</span>
      </div>
      <div class="flex items-start justify-between gap-4">
        <span class="text-ink-secondary">Customer</span>
        <span class="text-right font-medium">{{ transaction.customer || 'Walk-in Customer' }}</span>
      </div>
      <div class="flex items-start justify-between gap-4">
        <span class="text-ink-secondary">Metode Pembayaran</span>
        <span class="text-right font-medium">{{ paymentMethodLabel }}</span>
      </div>
    </section>

    <section class="space-y-3 border-b border-dashed border-zinc-300 pb-4">
      <div
        v-for="(item, index) in items"
        :key="`${item.id ?? item.name}-${index}`"
        class="space-y-1"
      >
        <p class="font-medium">{{ item.name }}</p>
        <div class="flex items-start justify-between gap-4 text-ink-secondary">
          <span>{{ item.qty }} x {{ formatCurrency(item.price) }}</span>
          <span class="text-right">{{ formatCurrency(item.price * item.qty) }}</span>
        </div>
      </div>
    </section>

    <section class="space-y-2">
      <div class="flex items-start justify-between gap-4">
        <span class="text-ink-secondary">Subtotal</span>
        <span class="font-medium">{{ formatCurrency(transaction.subtotal) }}</span>
      </div>
      <div class="flex items-start justify-between gap-4">
        <span class="text-ink-secondary">Pajak</span>
        <span class="font-medium">{{ formatCurrency(transaction.tax) }}</span>
      </div>
      <div class="flex items-start justify-between gap-4 text-base">
        <span class="font-semibold">Total</span>
        <span class="font-semibold">{{ formatCurrency(transaction.total) }}</span>
      </div>
      <template v-if="showCashSummary">
        <div class="flex items-start justify-between gap-4">
          <span class="text-ink-secondary">Uang Diterima</span>
          <span class="font-medium">{{ formatCurrency(transaction.cashReceived) }}</span>
        </div>
        <div class="flex items-start justify-between gap-4">
          <span class="text-ink-secondary">Kembalian</span>
          <span class="font-medium">{{ formatCurrency(transaction.changeAmount) }}</span>
        </div>
      </template>
    </section>
  </article>
</template>
