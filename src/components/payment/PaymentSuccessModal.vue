<script setup>
import { computed } from 'vue'

import BaseButton from '@/components/base/BaseButton.vue'
import { formatCurrency, formatDateTime } from '@/utils/formatters'

const props = defineProps({
  open: {
    type: Boolean,
    default: false,
  },
  summary: {
    type: Object,
    default: null,
  },
})

defineEmits(['new-transaction', 'view-receipt', 'view-transactions'])

const METHOD_LABELS = {
  cash: 'Cash',
  qris: 'QRIS',
  card: 'Card',
}

const methodLabel = computed(() => {
  const method = `${props.summary?.paymentMethod ?? ''}`.toLowerCase()
  return METHOD_LABELS[method] ?? (props.summary?.paymentMethod || '-')
})

const isCash = computed(() => `${props.summary?.paymentMethod ?? ''}`.toLowerCase() === 'cash')

const happenedAt = computed(() => props.summary?.paidAt || props.summary?.createdAt || null)
</script>

<template>
  <div
    v-if="open && summary"
    class="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] backdrop-blur-xs sm:items-center"
    data-testid="payment-success-modal"
  >
    <div class="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-3xl bg-white p-5 shadow-2xl">
      <!-- Header -->
      <div class="flex flex-col items-center text-center">
        <div class="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100 text-emerald-600">
          <svg class="h-8 w-8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="9" />
            <path d="M8.5 12.5l2.5 2.5 4.5-5" />
          </svg>
        </div>
        <h2 class="mt-3 text-xl font-bold text-ink-primary">Pembayaran Berhasil!</h2>
        <p class="mt-1 text-sm text-ink-secondary">
          Transaksi berhasil disimpan. Pesanan siap diproses.
        </p>
      </div>

      <!-- Summary -->
      <dl class="mt-5 space-y-2 rounded-2xl border border-zinc-100 bg-zinc-50/80 p-4 text-sm">
        <div class="flex items-center justify-between gap-3">
          <dt class="text-ink-secondary">Nomor Invoice</dt>
          <dd class="truncate font-semibold text-ink-primary" data-testid="success-invoice">
            {{ summary.invoiceNumber || '-' }}
          </dd>
        </div>
        <div class="flex items-center justify-between gap-3">
          <dt class="text-ink-secondary">Total Pembayaran</dt>
          <dd class="font-bold text-ink-primary" data-testid="success-total">
            {{ formatCurrency(summary.total) }}
          </dd>
        </div>
        <div class="flex items-center justify-between gap-3">
          <dt class="text-ink-secondary">Metode Pembayaran</dt>
          <dd class="font-semibold text-ink-primary" data-testid="success-method">
            {{ methodLabel }}
          </dd>
        </div>
        <template v-if="isCash">
          <div class="flex items-center justify-between gap-3">
            <dt class="text-ink-secondary">Uang Diterima</dt>
            <dd class="font-semibold text-ink-primary" data-testid="success-cash-received">
              {{ formatCurrency(summary.cashReceived ?? 0) }}
            </dd>
          </div>
          <div class="flex items-center justify-between gap-3">
            <dt class="text-ink-secondary">Kembalian</dt>
            <dd class="font-semibold text-emerald-600" data-testid="success-change">
              {{ formatCurrency(summary.changeAmount ?? 0) }}
            </dd>
          </div>
        </template>
        <div v-if="happenedAt" class="flex items-center justify-between gap-3">
          <dt class="text-ink-secondary">Waktu</dt>
          <dd class="text-right font-medium text-ink-primary" data-testid="success-time">
            {{ formatDateTime(happenedAt) }}
          </dd>
        </div>
      </dl>

      <!-- Actions -->
      <div class="mt-5 space-y-2">
        <BaseButton
          block
          size="lg"
          data-testid="success-new-transaction"
          @click="$emit('new-transaction')"
        >
          <span>Selesai<span class="sr-only"> / Transaksi Baru</span></span>
        </BaseButton>
        <div class="grid grid-cols-2 gap-2">
          <BaseButton
            variant="secondary"
            data-testid="success-view-receipt"
            @click="$emit('view-receipt')"
          >
            <span class="sr-only">Lihat </span>Struk
          </BaseButton>
          <BaseButton
            variant="secondary"
            data-testid="success-view-transactions"
            @click="$emit('view-transactions')"
          >
            <span class="sr-only">Lihat </span>Riwayat
          </BaseButton>
        </div>
      </div>
    </div>
  </div>
</template>
