<script setup>
import { computed, ref, watch } from 'vue'

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

const emit = defineEmits(['new-transaction', 'complete-ready', 'view-receipt', 'view-transactions'])

const pendingAction = ref(null)

watch(
  () => props.open,
  (isOpen) => {
    if (!isOpen) {
      pendingAction.value = null
    }
  },
)

function handleCompleteReady() {
  if (pendingAction.value === 'ready') return
  pendingAction.value = 'ready'
  emit('complete-ready')
  setTimeout(() => {
    pendingAction.value = null
  }, 500)
}

function handleNewTransaction() {
  if (pendingAction.value === 'process') return
  pendingAction.value = 'process'
  emit('new-transaction')
  setTimeout(() => {
    pendingAction.value = null
  }, 500)
}

function handleViewReceipt() {
  if (pendingAction.value === 'receipt') return
  pendingAction.value = 'receipt'
  emit('view-receipt')
  setTimeout(() => {
    pendingAction.value = null
  }, 500)
}

function handleViewTransactions() {
  if (pendingAction.value === 'transactions') return
  pendingAction.value = 'transactions'
  emit('view-transactions')
  setTimeout(() => {
    pendingAction.value = null
  }, 500)
}

const METHOD_LABELS = {
  cash: 'Cash',
  qris: 'QRIS',
  card: 'Card',
  unpaid: 'Bayar Nanti (Tempo)',
}

const methodLabel = computed(() => {
  const method = `${props.summary?.paymentMethod ?? ''}`.toLowerCase()
  return METHOD_LABELS[method] ?? (props.summary?.paymentMethod || '-')
})

const isCash = computed(() => `${props.summary?.paymentMethod ?? ''}`.toLowerCase() === 'cash')
const isUnpaid = computed(() => `${props.summary?.paymentMethod ?? ''}`.toLowerCase() === 'unpaid')

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
        <div
          class="flex h-16 w-16 items-center justify-center rounded-full"
          :class="isUnpaid ? 'bg-amber-100 text-amber-600' : 'bg-emerald-100 text-emerald-600'"
        >
          <svg v-if="isUnpaid" class="h-8 w-8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="9" />
            <polyline points="12 6 12 12 16 14" />
          </svg>
          <svg v-else class="h-8 w-8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="9" />
            <path d="M8.5 12.5l2.5 2.5 4.5-5" />
          </svg>
        </div>
        <h2 class="mt-3 text-xl font-bold text-ink-primary">
          {{ isUnpaid ? 'Pesanan Berhasil Disimpan!' : 'Pembayaran Berhasil!' }}
        </h2>
        <p class="mt-1 text-sm text-ink-secondary">
          {{ isUnpaid ? 'Transaksi tempo disimpan. Pesanan siap diproses.' : 'Transaksi berhasil disimpan. Pesanan siap diproses.' }}
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
      <div class="mt-5 space-y-2.5">
        <!-- Pilihan Selesai & Langsung Siap (Grab & Go / Langsung Selesai) -->
        <button
          type="button"
          data-testid="success-complete-ready"
          :disabled="pendingAction === 'ready'"
          class="flex w-full items-center justify-center gap-2 rounded-2xl bg-emerald-600 px-4 py-3 text-sm font-bold text-white shadow-2xs transition hover:bg-emerald-700 active:scale-98 cursor-pointer disabled:opacity-75"
          @click="handleCompleteReady"
        >
          <svg v-if="pendingAction === 'ready'" class="h-4 w-4 shrink-0 animate-spin text-white" viewBox="0 0 24 24" fill="none">
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3" />
            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
          </svg>
          <svg v-else class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="20 6 9 17 4 12" />
          </svg>
          <span>{{ pendingAction === 'ready' ? 'Menandai Siap...' : 'Selesai & Tandai Siap' }}</span>
        </button>

        <!-- Pilihan Selesai (Pesanan Masih Diproses di Bar/Dapur) -->
        <button
          type="button"
          data-testid="success-new-transaction"
          :disabled="pendingAction === 'process'"
          class="flex w-full items-center justify-center gap-2 rounded-2xl border border-zinc-200 bg-white px-4 py-3 text-sm font-bold text-ink-primary shadow-2xs transition hover:bg-zinc-50 active:scale-98 cursor-pointer dark:border-slate-700 dark:bg-slate-800 dark:text-white disabled:opacity-75"
          @click="handleNewTransaction"
        >
          <svg v-if="pendingAction === 'process'" class="h-4 w-4 shrink-0 animate-spin text-amber-500" viewBox="0 0 24 24" fill="none">
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3" />
            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
          </svg>
          <svg v-else class="h-4 w-4 text-amber-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="10" />
            <polyline points="12 6 12 12 16 14" />
          </svg>
          <span>{{ pendingAction === 'process' ? 'Menyimpan...' : 'Selesai (Pesanan Diproses)' }}</span>
        </button>

        <div class="grid grid-cols-2 gap-2 pt-0.5">
          <BaseButton
            variant="secondary"
            :loading="pendingAction === 'receipt'"
            data-testid="success-view-receipt"
            @click="handleViewReceipt"
          >
            <span class="sr-only">Lihat </span>Struk
          </BaseButton>
          <BaseButton
            variant="secondary"
            :loading="pendingAction === 'transactions'"
            data-testid="success-view-transactions"
            @click="handleViewTransactions"
          >
            <span>Antrean Pesanan</span>
          </BaseButton>
        </div>
      </div>
    </div>
  </div>
</template>
