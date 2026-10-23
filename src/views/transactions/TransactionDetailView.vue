<script setup>
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import BaseBadge from '@/components/base/BaseBadge.vue'
import BaseButton from '@/components/base/BaseButton.vue'
import { useTransactionStore } from '@/stores/transactionStore'
import { formatCurrency, formatDateTime } from '@/utils/formatters'

const route = useRoute()
const router = useRouter()
const transactionStore = useTransactionStore()

const copied = ref(false)

const transaction = computed(() =>
  transactionStore.items.find((item) => String(item.id) === String(route.params.id)),
)

const laundryStatuses = ['Masuk', 'Diproses', 'Siap Diambil', 'Selesai']

const displayInvoiceNumber = computed(() => {
  if (!transaction.value) return ''
  return transaction.value.invoiceNumber || transaction.value.orderNumber || transaction.value.id
})

const isRawUuid = computed(() => {
  if (!transaction.value?.id) return false
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    transaction.value.id,
  )
})

const itemList = computed(() => {
  if (!transaction.value) return []
  if (Array.isArray(transaction.value.items)) {
    return transaction.value.items.map((it) => {
      const name = it.name || it.serviceName || 'Item'
      const qty = Number(it.qty ?? it.quantity) || 1
      const price = Number(it.price ?? it.unitPrice) || 0
      const subtotal = it.subtotal != null ? Number(it.subtotal) : price * qty
      const unit = it.unit || it.pricingUnit || 'pcs'
      return {
        ...it,
        name,
        qty,
        price,
        subtotal,
        unit,
      }
    })
  }
  return []
})

const totalItemCount = computed(() => {
  if (!transaction.value) return 0
  if (typeof transaction.value.itemCount === 'number') return transaction.value.itemCount
  if (itemList.value.length > 0) {
    return itemList.value.reduce((acc, it) => acc + it.qty, 0)
  }
  if (typeof transaction.value.items === 'number') return transaction.value.items
  return 0
})

const paymentMethodLabel = computed(() => {
  const method = `${transaction.value?.paymentMethod ?? ''}`.toLowerCase()
  if (method === 'qris') return 'QRIS'
  if (method === 'card') return 'Kartu Debit/Kredit'
  if (method === 'cash') return 'Tunai (Cash)'
  return transaction.value?.paymentMethod || '-'
})

const taxLabel = computed(() => {
  const rate = transaction.value?.taxRate
  return typeof rate === 'number' && Number.isFinite(rate) && rate > 0
    ? `Pajak (${rate}%)`
    : 'Pajak'
})

const showCashSummary = computed(() => {
  return (
    `${transaction.value?.paymentMethod ?? ''}`.toLowerCase() === 'cash' &&
    transaction.value?.cashReceived != null &&
    transaction.value?.changeAmount != null
  )
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

async function copyInvoiceNumber() {
  if (!displayInvoiceNumber.value) return
  try {
    if (navigator?.clipboard?.writeText) {
      await navigator.clipboard.writeText(displayInvoiceNumber.value)
    }
    copied.value = true
    setTimeout(() => {
      copied.value = false
    }, 2000)
  } catch {
    // clipboard fallback
  }
}
</script>

<template>
  <div class="mx-auto max-w-xl space-y-4 pb-28">
    <!-- Top Navigation Bar -->
    <div class="flex items-center justify-between gap-3">
      <BaseButton
        variant="ghost"
        size="sm"
        class="gap-1.5 text-ink-secondary hover:text-ink-primary -ml-2"
        @click="router.push('/transactions')"
      >
        <svg class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" d="M15 19l-7-7 7-7" />
        </svg>
        <span>Kembali</span>
      </BaseButton>

      <BaseButton
        v-if="transaction"
        variant="secondary"
        size="sm"
        class="gap-2 shadow-xs"
        @click="router.push(`/transactions/${transaction.id}/receipt`)"
      >
        <svg
          class="h-4 w-4 text-zinc-500"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          viewBox="0 0 24 24"
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
          />
        </svg>
        <span><span class="sr-only">Lihat </span>Struk</span>
      </BaseButton>
    </div>

    <!-- Main Minimalist Invoice Card -->
    <div v-if="transaction" class="space-y-4">
      <div class="rounded-3xl border border-zinc-200/80 bg-white p-5 shadow-soft md:p-6 space-y-5">
        <!-- Invoice & Status Header -->
        <div class="flex items-start justify-between gap-3 border-b border-zinc-100 pb-4">
          <div class="min-w-0 flex-1">
            <div class="flex flex-wrap items-center gap-1.5">
              <span class="font-mono text-xs font-semibold uppercase tracking-wider text-primary break-all">
                {{ displayInvoiceNumber }}
              </span>
              <button
                type="button"
                class="inline-flex items-center gap-1 rounded-md bg-zinc-100 px-1.5 py-0.5 text-[10px] font-medium text-zinc-500 hover:bg-zinc-200 transition"
                title="Salin No. Invoice"
                @click="copyInvoiceNumber"
              >
                <svg
                  v-if="!copied"
                  class="h-3 w-3"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  viewBox="0 0 24 24"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
                  />
                </svg>
                <span>{{ copied ? 'Disalin!' : 'Salin' }}</span>
              </button>
            </div>

            <!-- Customer Name -->
            <h2 class="mt-1.5 text-xl font-bold text-ink-primary truncate">
              {{ transaction.customer || 'Walk-in Customer' }}
            </h2>

            <!-- Timestamp & ID reference -->
            <div class="mt-1 flex flex-wrap items-center gap-2 text-xs text-ink-secondary">
              <span>{{ formatDateTime(transaction.createdAt) }}</span>
              <span v-if="isRawUuid && transaction.invoiceNumber" class="text-zinc-300">•</span>
              <span
                v-if="isRawUuid && transaction.invoiceNumber"
                class="font-mono text-[11px] text-zinc-400"
              >
                ID: {{ transaction.id.slice(0, 8) }}...
              </span>
            </div>
          </div>

          <BaseBadge :variant="statusVariant(transaction.status)" class="capitalize shrink-0">
            {{ statusLabel(transaction.status) }}
          </BaseBadge>
        </div>

        <!-- Detail Item List (User Request) -->
        <div class="space-y-3">
          <div class="flex items-center justify-between text-xs font-semibold uppercase tracking-wider text-ink-secondary">
            <span>Rincian Item</span>
            <span class="rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-medium text-zinc-600">
              {{ totalItemCount }} item
            </span>
          </div>

          <!-- Items Breakdown -->
          <div v-if="itemList.length > 0" class="divide-y divide-zinc-100">
            <div
              v-for="(item, index) in itemList"
              :key="`${item.id || item.name}-${index}`"
              class="flex items-center justify-between py-2.5 first:pt-0 last:pb-0"
              data-testid="transaction-item-row"
            >
              <div class="min-w-0 pr-3">
                <p class="text-sm font-medium text-ink-primary truncate">{{ item.name }}</p>
                <p class="text-xs text-ink-secondary mt-0.5">
                  {{ item.qty }} {{ item.unit && item.unit !== 'pcs' ? item.unit : '' }} ×
                  {{ formatCurrency(item.price) }}
                </p>
              </div>
              <div class="text-right text-sm font-semibold text-ink-primary shrink-0">
                {{ formatCurrency(item.subtotal) }}
              </div>
            </div>
          </div>

          <!-- Fallback when items is just a count or empty -->
          <div v-else class="rounded-2xl bg-zinc-50 p-3.5 text-xs text-ink-secondary text-center">
            {{ totalItemCount > 0 ? `${totalItemCount} item dalam pesanan ini` : 'Tidak ada rincian item' }}
          </div>
        </div>

        <!-- Payment Breakdown (Ringkasan Pembayaran) -->
        <div class="space-y-2 border-t border-zinc-100 pt-4 text-sm">
          <div class="flex items-center justify-between text-ink-secondary">
            <span>Subtotal</span>
            <span class="font-medium text-ink-primary">
              {{ formatCurrency(transaction.subtotal || transaction.total) }}
            </span>
          </div>

          <div
            v-if="Number(transaction.tax) > 0"
            class="flex items-center justify-between text-ink-secondary"
          >
            <span>{{ taxLabel }}</span>
            <span class="font-medium text-ink-primary">{{ formatCurrency(transaction.tax) }}</span>
          </div>

          <div class="flex items-center justify-between border-t border-zinc-200/80 pt-3 text-base">
            <span class="font-semibold text-ink-primary">Total Transaksi</span>
            <span class="text-xl font-bold text-primary">
              {{ formatCurrency(transaction.total) }}
            </span>
          </div>
        </div>

        <!-- Payment Method & Cash Info -->
        <div class="rounded-2xl bg-zinc-50 p-3.5 space-y-2 border border-zinc-100 text-xs">
          <div class="flex items-center justify-between">
            <span class="text-ink-secondary font-medium">Metode Pembayaran</span>
            <span
              class="font-semibold uppercase tracking-wide text-ink-primary bg-white px-2.5 py-1 rounded-lg border border-zinc-200/60 shadow-2xs"
            >
              {{ paymentMethodLabel }}
            </span>
          </div>

          <template v-if="showCashSummary">
            <div class="flex items-center justify-between text-ink-secondary">
              <span>Uang Diterima</span>
              <span class="font-medium text-ink-primary">{{ formatCurrency(transaction.cashReceived) }}</span>
            </div>
            <div class="flex items-center justify-between text-ink-secondary">
              <span>Kembalian</span>
              <span class="font-medium text-ink-primary">{{ formatCurrency(transaction.changeAmount) }}</span>
            </div>
          </template>
        </div>

        <!-- Order Laundry Stepper/Status (if laundry transaction) -->
        <div
          v-if="transaction.orderStatus"
          class="rounded-2xl border border-zinc-200/70 p-4 space-y-3"
        >
          <p class="text-xs font-semibold uppercase tracking-wider text-ink-secondary">
            Status Order Laundry
          </p>
          <div class="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <BaseButton
              v-for="status in laundryStatuses"
              :key="status"
              size="sm"
              :variant="transaction.orderStatus === status ? 'primary' : 'secondary'"
              class="w-full text-xs"
              @click="transactionStore.updateOrderStatus(transaction.id, status)"
            >
              {{ status }}
            </BaseButton>
          </div>
        </div>
      </div>

      <!-- Action Button at bottom -->
      <BaseButton
        block
        variant="primary"
        class="gap-2 shadow-soft"
        @click="router.push(`/transactions/${transaction.id}/receipt`)"
      >
        <svg class="h-5 w-5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z"
          />
        </svg>
        <span><span class="sr-only">Lihat </span>Struk</span>
      </BaseButton>
    </div>

    <!-- Not Found State -->
    <div
      v-else
      class="rounded-3xl border border-zinc-200/70 bg-white p-8 text-center shadow-soft space-y-3"
    >
      <p class="text-sm text-ink-secondary">Transaksi tidak ditemukan.</p>
      <BaseButton variant="secondary" size="sm" @click="router.push('/transactions')">
        Kembali
      </BaseButton>
    </div>
  </div>
</template>
