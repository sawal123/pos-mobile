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

const items = computed(() => {
  if (!Array.isArray(props.transaction.items)) {
    return []
  }

  return props.transaction.items.map((item) => {
    const name = item.name || item.serviceName || 'Item'
    const qty = Number(item.qty ?? item.quantity) || 0
    const price = Number(item.price ?? item.unitPrice) || 0
    const rawUnit = `${item.unit ?? item.pricingUnit ?? ''}`.trim()
    const unitSuffix = rawUnit && rawUnit.toLowerCase() !== 'pcs' ? ` ${rawUnit}` : ''
    const lineTotal = item.subtotal != null ? Number(item.subtotal) : price * qty

    return {
      ...item,
      name,
      qty,
      price,
      unitSuffix,
      lineTotal,
    }
  })
})

const paymentMethodLabel = computed(() => {
  const method = `${props.transaction.paymentMethod ?? ''}`.toLowerCase()

  if (method === 'qris') return 'QRIS'
  if (method === 'card') return 'Card'
  if (method === 'cash') return 'Cash'

  return props.transaction.paymentMethod || '-'
})

const isPaid = computed(() => {
  const status = `${props.transaction.paymentStatus ?? props.transaction.status ?? 'paid'}`.toLowerCase()
  return status === 'paid' || status === 'completed'
})

const taxLabel = computed(() => {
  const rate = props.transaction.taxRate
  return typeof rate === 'number' && Number.isFinite(rate) && rate > 0
    ? `Pajak (${rate}%)`
    : 'Pajak'
})

const showCashSummary = computed(() => (
  `${props.transaction.paymentMethod ?? ''}`.toLowerCase() === 'cash'
  && props.transaction.cashReceived != null
  && props.transaction.changeAmount != null
))
</script>

<template>
  <article
    class="receipt-paper relative mx-auto w-full max-w-[390px] overflow-hidden rounded-3xl border border-zinc-200/90 bg-white text-ink-primary shadow-xl shadow-zinc-900/5 print:max-w-none print:rounded-none print:border-none print:shadow-none"
    data-testid="receipt-paper"
  >
    <!-- Top Thermal Ticket Accent Strip (Screen only) -->
    <div class="h-2 w-full bg-gradient-to-r from-primary via-primary/80 to-emerald-500 print:hidden" />

    <div class="space-y-4 px-5 py-6 sm:px-6 print:px-0 print:py-2">
      <!-- Store Header -->
      <header class="text-center">
        <div
          class="mx-auto mb-2.5 flex h-11 w-11 items-center justify-center rounded-2xl bg-primary/10 text-primary print:hidden"
        >
          <svg class="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
            <polyline points="9 22 9 12 15 12 15 22" />
          </svg>
        </div>

        <h1 class="text-lg font-extrabold tracking-tight text-ink-primary uppercase">
          {{ business.name || '-' }}
        </h1>
        <p class="mt-0.5 text-xs font-medium text-ink-secondary">
          {{ business.outlet || '-' }}
        </p>
        <p v-if="business.phone" class="mt-0.5 font-mono text-xs text-ink-secondary">
          {{ business.phone }}
        </p>

        <div class="mt-2.5 inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider print:hidden"
          :class="isPaid ? 'bg-emerald-50 text-emerald-700 border border-emerald-200/70' : 'bg-amber-50 text-amber-700 border border-amber-200/70'"
        >
          <span class="h-1.5 w-1.5 rounded-full" :class="isPaid ? 'bg-emerald-500' : 'bg-amber-500'" />
          <span>{{ isPaid ? 'Lunas' : 'Belum Bayar' }}</span>
        </div>
      </header>

      <!-- Perforated Divider with Side Cutout Notches -->
      <div class="relative py-1">
        <span class="absolute -left-8 top-1/2 -mt-2.5 h-5 w-5 rounded-full border border-zinc-200/90 bg-surface print:hidden" />
        <span class="absolute -right-8 top-1/2 -mt-2.5 h-5 w-5 rounded-full border border-zinc-200/90 bg-surface print:hidden" />
        <div class="border-b border-dashed border-zinc-300" />
      </div>

      <!-- Transaction Metadata -->
      <section class="space-y-1.5 text-xs">
        <div class="flex items-start justify-between gap-3">
          <span class="text-ink-secondary">{{ transaction.orderNumber ? 'No. Order' : 'Invoice' }}</span>
          <span class="text-right font-mono font-semibold text-ink-primary break-all">
            {{ transaction.orderNumber || transaction.invoiceNumber || transaction.id }}
          </span>
        </div>
        <div class="flex items-start justify-between gap-3">
          <span class="text-ink-secondary">Tanggal</span>
          <span class="text-right font-medium tabular-nums text-ink-primary">
            {{ formatDateTime(transaction.createdAt) }}
          </span>
        </div>
        <div v-if="transaction.estimatedCompletedAt" class="flex items-start justify-between gap-3">
          <span class="text-ink-secondary">Estimasi Selesai</span>
          <span class="text-right font-medium tabular-nums text-ink-primary">
            {{ formatDateTime(transaction.estimatedCompletedAt) }}
          </span>
        </div>
        <div class="flex items-start justify-between gap-3">
          <span class="text-ink-secondary">Customer</span>
          <span class="text-right font-semibold text-ink-primary">
            {{ transaction.customer || 'Walk-in Customer' }}
          </span>
        </div>
        <div class="flex items-start justify-between gap-3">
          <span class="text-ink-secondary">Metode Pembayaran</span>
          <span class="text-right font-semibold text-ink-primary">{{ paymentMethodLabel }}</span>
        </div>
      </section>

      <div class="border-b border-dashed border-zinc-300" />

      <!-- Line Items -->
      <section class="space-y-2.5 text-xs">
        <div
          v-for="(item, index) in items"
          :key="`${item.id ?? item.name}-${index}`"
          class="space-y-0.5"
        >
          <p class="text-[13px] font-semibold text-ink-primary leading-snug">{{ item.name }}</p>
          <div class="flex items-baseline justify-between gap-4 tabular-nums text-ink-secondary">
            <span>{{ item.qty }}{{ item.unitSuffix }} x {{ formatCurrency(item.price) }}</span>
            <span class="text-right font-semibold text-ink-primary">{{ formatCurrency(item.lineTotal) }}</span>
          </div>
        </div>
      </section>

      <div class="border-b border-dashed border-zinc-300" />

      <!-- Totals & Payment Breakdown -->
      <section class="space-y-1.5 text-xs tabular-nums">
        <div class="flex items-center justify-between gap-4">
          <span class="text-ink-secondary">Subtotal</span>
          <span class="font-medium text-ink-primary">{{ formatCurrency(transaction.subtotal) }}</span>
        </div>

        <div
          v-if="Number(transaction.discount) > 0"
          class="flex items-center justify-between gap-4 text-emerald-600 dark:text-emerald-400"
        >
          <span>{{ transaction.appliedPromo?.name || transaction.discountLabel || 'Diskon' }}</span>
          <span class="font-semibold">-{{ formatCurrency(transaction.discount) }}</span>
        </div>

        <div v-if="Number(transaction.tax) > 0" class="flex items-center justify-between gap-4">
          <span class="text-ink-secondary">{{ taxLabel }}</span>
          <span class="font-medium text-ink-primary">{{ formatCurrency(transaction.tax) }}</span>
        </div>

        <div class="my-2 rounded-xl bg-zinc-50 px-3 py-2.5 border border-zinc-200/70 flex items-center justify-between gap-4 print:rounded-none print:border-x-0 print:border-y print:border-dashed print:border-zinc-400 print:bg-transparent print:px-0">
          <span class="text-sm font-extrabold uppercase tracking-wide text-ink-primary">Total</span>
          <span class="text-base font-black text-ink-primary">{{ formatCurrency(transaction.total) }}</span>
        </div>

        <template v-if="showCashSummary">
          <div class="flex items-center justify-between gap-4 pt-0.5">
            <span class="text-ink-secondary">Uang Diterima</span>
            <span class="font-medium text-ink-primary">{{ formatCurrency(transaction.cashReceived) }}</span>
          </div>
          <div class="flex items-center justify-between gap-4">
            <span class="font-medium text-ink-secondary">Kembalian</span>
            <span class="font-bold text-emerald-600 print:text-ink-primary">
              {{ formatCurrency(transaction.changeAmount) }}
            </span>
          </div>
        </template>
      </section>

      <!-- Optional Note (e.g. Laundry) -->
      <div
        v-if="transaction.note"
        class="rounded-xl bg-zinc-50 px-3 py-2 text-xs text-ink-secondary border border-zinc-100 print:border-zinc-300 print:bg-transparent"
      >
        <span class="font-semibold text-ink-primary">Catatan:</span> {{ transaction.note }}
      </div>

      <!-- Receipt Footer -->
      <footer class="border-t border-dashed border-zinc-300 pt-4 text-center space-y-1">
        <p class="text-xs font-semibold text-ink-primary">Terima kasih atas kunjungan Anda!</p>
        <p class="text-[11px] text-ink-secondary">
          Simpan struk ini sebagai bukti pembayaran yang sah.
        </p>
      </footer>
    </div>

    <!-- Decorative Thermal Tear-off Zigzag Bottom (Screen only) -->
    <div
      class="h-3 w-full bg-surface print:hidden"
      style="background-image: linear-gradient(135deg, var(--color-card) 50%, transparent 50%), linear-gradient(225deg, var(--color-card) 50%, transparent 50%); background-position: top left; background-size: 14px 14px; background-repeat: repeat-x;"
    />
  </article>
</template>
