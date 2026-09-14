<script setup>
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import AppIcon from '@/components/base/AppIcon.vue'
import BaseBadge from '@/components/base/BaseBadge.vue'
import BaseButton from '@/components/base/BaseButton.vue'
import BaseCard from '@/components/base/BaseCard.vue'
import BaseInput from '@/components/base/BaseInput.vue'
import BaseSheet from '@/components/base/BaseSheet.vue'
import { useCashStore } from '@/stores/cashStore'
import {
  ORDER_LIFECYCLE,
  NEXT_ORDER_STATUS,
  ORDER_STATUS_ACTIONS,
  useTransactionStore,
} from '@/stores/transactionStore'
import { formatCurrency, formatDateTime } from '@/utils/formatters'

const route = useRoute()
const router = useRouter()
const cashStore = useCashStore()
const transactionStore = useTransactionStore()

const orderId = computed(() => String(route.params.id))
const order = computed(() => {
  return transactionStore.items.find((item) => String(item.id) === orderId.value)
})

// Payment Modal State
const showPaymentModal = ref(false)
const selectedPayMethod = ref('cash')
const cashReceived = ref('')
const paymentError = ref('')
const isProcessingPayment = ref(false)

const isUnpaid = computed(() => order.value?.paymentStatus === 'unpaid')

const nextStatus = computed(() => {
  if (!order.value?.orderStatus) return null
  return NEXT_ORDER_STATUS[order.value.orderStatus] ?? null
})

const nextStatusActionLabel = computed(() => {
  if (!order.value?.orderStatus) return null
  return ORDER_STATUS_ACTIONS[order.value.orderStatus] ?? null
})

function handleAdvanceStatus() {
  if (!order.value) return
  transactionStore.advanceOrderStatus(order.value.id)
}

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

function openPaymentModal() {
  paymentError.value = ''
  cashReceived.value = ''
  selectedPayMethod.value = 'cash'
  showPaymentModal.value = true
}

const parsedCashReceived = computed(() => {
  if (cashReceived.value == null || `${cashReceived.value}`.trim() === '') {
    return null
  }
  const amount = Number(cashReceived.value)
  return Number.isFinite(amount) ? amount : Number.NaN
})

const changeAmount = computed(() => {
  if (selectedPayMethod.value !== 'cash' || !order.value) {
    return 0
  }
  if (parsedCashReceived.value == null || Number.isNaN(parsedCashReceived.value)) {
    return 0
  }
  return Math.max(0, parsedCashReceived.value - order.value.total)
})

function fillExactCash() {
  if (!order.value) return
  cashReceived.value = String(order.value.total)
}

const quickCashAmounts = computed(() => {
  if (!order.value) return []
  const base = [20000, 50000, 100000, 200000, 500000]
  return base.filter((val) => val > order.value.total).slice(0, 3)
})

function submitPayment() {
  paymentError.value = ''

  if (!order.value) return

  if (order.value.paymentStatus === 'paid') {
    showPaymentModal.value = false
    return
  }

  if (selectedPayMethod.value === 'cash') {
    if (parsedCashReceived.value == null || Number.isNaN(parsedCashReceived.value)) {
      paymentError.value = 'Uang diterima wajib diisi.'
      return
    }
    if (parsedCashReceived.value < order.value.total) {
      paymentError.value = 'Uang diterima kurang dari total pembayaran.'
      return
    }
  }

  isProcessingPayment.value = true

  try {
    const result = transactionStore.settleLaundryOrderPayment({
      orderId: order.value.id,
      paymentMethod: selectedPayMethod.value,
      cashReceived: selectedPayMethod.value === 'cash' ? parsedCashReceived.value : null,
      changeAmount: selectedPayMethod.value === 'cash' ? changeAmount.value : null,
      cashStore,
    })

    if (!result.success) {
      paymentError.value = result.error || 'Gagal memproses pembayaran.'
      return
    }

    showPaymentModal.value = false
  } catch (err) {
    console.error('Failed to pay order', err)
    paymentError.value = 'Gagal memproses pembayaran.'
  } finally {
    isProcessingPayment.value = false
  }
}
</script>

<template>
  <div class="mx-auto max-w-2xl space-y-4">
    <!-- Top actions -->
    <div class="flex flex-wrap items-center justify-between gap-3">
      <BaseButton variant="ghost" size="sm" @click="router.push('/laundry/orders')">
        ← Kembali ke Daftar
      </BaseButton>

      <div class="flex items-center gap-2">
        <BaseButton
          v-if="order"
          variant="secondary"
          size="sm"
          data-testid="btn-view-receipt"
          @click="router.push(`/transactions/${order.id}/receipt`)"
        >
          Lihat / Cetak Struk
        </BaseButton>
      </div>
    </div>

    <div v-if="order" class="space-y-4">
      <!-- Order Header Card -->
      <BaseCard class="space-y-4">
        <div class="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <span class="font-mono text-xs font-bold text-primary" data-testid="detail-order-number">
              {{ order.orderNumber || order.invoiceNumber }}
            </span>
            <h1 class="text-2xl font-bold text-ink-primary" data-testid="detail-customer-name">
              {{ order.customer || order.customerSnapshot?.name }}
            </h1>
            <p v-if="order.customerSnapshot?.phone" class="text-sm font-medium text-ink-secondary" data-testid="detail-customer-phone">
              {{ order.customerSnapshot.phone }}
            </p>
          </div>

          <div class="flex flex-wrap items-center gap-2">
            <BaseBadge
              :variant="orderStatusVariant(order.orderStatus)"
              data-testid="detail-order-status"
            >
              {{ order.orderStatus }}
            </BaseBadge>
            <BaseBadge
              :variant="paymentStatusVariant(order.paymentStatus)"
              data-testid="detail-payment-status"
            >
              {{ order.paymentStatus === 'paid' ? 'Lunas' : 'Belum Lunas' }}
            </BaseBadge>
          </div>
        </div>

        <!-- Lifecycle Action Button -->
        <div class="rounded-2xl border border-zinc-200 bg-surface p-4">
          <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p class="text-xs uppercase tracking-wider text-ink-secondary">Status Pengerjaan</p>
              <p class="text-base font-bold text-ink-primary">{{ order.orderStatus }}</p>
            </div>

            <div v-if="nextStatusActionLabel">
              <BaseButton
                data-testid="btn-advance-status"
                class="w-full sm:w-auto"
                @click="handleAdvanceStatus"
              >
                {{ nextStatusActionLabel }} →
              </BaseButton>
            </div>
            <div v-else class="text-xs font-semibold text-success">
              ✓ Order telah selesai
            </div>
          </div>
        </div>

        <!-- Payment Status and Pay Button -->
        <div class="rounded-2xl border border-zinc-200 bg-surface p-4">
          <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p class="text-xs uppercase tracking-wider text-ink-secondary">Status Pembayaran</p>
              <div class="flex items-center gap-2 mt-0.5">
                <span class="text-base font-bold text-ink-primary">
                  {{ order.paymentStatus === 'paid' ? 'Lunas' : 'Belum Lunas' }}
                </span>
                <span v-if="order.paymentMethod" class="text-xs text-ink-secondary uppercase">
                  ({{ order.paymentMethod }})
                </span>
              </div>
            </div>

            <div v-if="isUnpaid">
              <BaseButton
                variant="primary"
                data-testid="btn-pay-now"
                class="w-full sm:w-auto"
                @click="openPaymentModal"
              >
                Bayar Sekarang
              </BaseButton>
            </div>
            <div v-else class="text-xs font-semibold text-success">
              ✓ Telah dibayar
            </div>
          </div>
        </div>
      </BaseCard>

      <!-- Order Details & Timeline -->
      <BaseCard class="space-y-3">
        <h2 class="text-base font-semibold text-ink-primary border-b border-zinc-100 pb-2">
          Informasi Waktu
        </h2>

        <div class="grid grid-cols-2 gap-3 text-sm">
          <div class="rounded-2xl bg-surface p-3">
            <p class="text-xs text-ink-secondary">Tanggal Masuk</p>
            <p class="mt-1 font-semibold text-ink-primary" data-testid="detail-created-at">
              {{ formatDateTime(order.createdAt) }}
            </p>
          </div>

          <div class="rounded-2xl bg-surface p-3">
            <p class="text-xs text-ink-secondary">Estimasi Selesai</p>
            <p class="mt-1 font-semibold text-ink-primary" data-testid="detail-estimated-completed">
              {{ order.estimatedCompletedAt ? formatDateTime(order.estimatedCompletedAt) : '-' }}
            </p>
          </div>
        </div>

        <div v-if="order.note" class="rounded-2xl bg-surface p-3 text-sm">
          <p class="text-xs text-ink-secondary">Catatan Pelanggan / Order</p>
          <p class="mt-1 text-ink-primary" data-testid="detail-order-note">{{ order.note }}</p>
        </div>
      </BaseCard>

      <!-- Services breakdown card -->
      <BaseCard class="space-y-4">
        <h2 class="text-base font-semibold text-ink-primary border-b border-zinc-100 pb-2">
          Rincian Layanan Cucian
        </h2>

        <div class="space-y-2.5" data-testid="detail-service-items">
          <div
            v-for="(item, index) in order.items"
            :key="index"
            class="flex items-center justify-between rounded-2xl bg-surface p-3 text-sm"
          >
            <div class="min-w-0 space-y-0.5">
              <p class="font-semibold text-ink-primary">{{ item.name || item.serviceName }}</p>
              <p class="text-xs text-ink-secondary">
                {{ item.qty || item.quantity }} {{ item.unit || item.pricingUnit }} × {{ formatCurrency(item.price || item.unitPrice) }}
              </p>
            </div>
            <div class="text-right">
              <p class="font-bold text-ink-primary">
                {{ formatCurrency(item.subtotal || ((item.qty || item.quantity) * (item.price || item.unitPrice))) }}
              </p>
            </div>
          </div>
        </div>

        <!-- Order Totals -->
        <div class="border-t border-zinc-100 pt-3 space-y-2 text-sm">
          <div class="flex justify-between text-ink-secondary">
            <span>Subtotal</span>
            <span class="font-medium text-ink-primary">{{ formatCurrency(order.subtotal) }}</span>
          </div>
          <div v-if="order.tax" class="flex justify-between text-ink-secondary">
            <span>Pajak</span>
            <span class="font-medium text-ink-primary">{{ formatCurrency(order.tax) }}</span>
          </div>
          <div class="flex justify-between text-base font-bold text-ink-primary border-t border-zinc-100 pt-2">
            <span>Total</span>
            <span class="text-lg text-primary" data-testid="detail-order-total">{{ formatCurrency(order.total) }}</span>
          </div>
        </div>
      </BaseCard>
    </div>

    <BaseCard v-else class="py-12 text-center">
      <p class="text-sm text-ink-secondary">Order tidak ditemukan.</p>
      <div class="mt-4">
        <BaseButton @click="router.push('/laundry/orders')">Kembali ke Daftar</BaseButton>
      </div>
    </BaseCard>

    <!-- Payment Sheet / Modal -->
    <BaseSheet
      :open="showPaymentModal"
      title="Bayar Order Laundry"
      @close="showPaymentModal = false"
    >
      <div v-if="order" class="space-y-4">
        <div class="rounded-2xl bg-surface p-3 text-center">
          <p class="text-xs text-ink-secondary uppercase tracking-wider">Total Tagihan</p>
          <p class="text-2xl font-bold text-ink-primary mt-1">{{ formatCurrency(order.total) }}</p>
        </div>

        <div v-if="paymentError" class="text-xs text-red-600 bg-red-50 p-2.5 rounded-xl border border-red-200">
          {{ paymentError }}
        </div>

        <!-- Payment Method Selection -->
        <div class="grid grid-cols-3 gap-2">
          <button
            type="button"
            data-testid="modal-pay-cash"
            class="rounded-2xl border p-3 text-center transition"
            :class="selectedPayMethod === 'cash'
              ? 'border-primary bg-primary/10 text-primary font-bold'
              : 'border-zinc-200 bg-white text-ink-secondary'"
            @click="selectedPayMethod = 'cash'"
          >
            Cash
          </button>
          <button
            type="button"
            data-testid="modal-pay-qris"
            class="rounded-2xl border p-3 text-center transition"
            :class="selectedPayMethod === 'qris'
              ? 'border-primary bg-primary/10 text-primary font-bold'
              : 'border-zinc-200 bg-white text-ink-secondary'"
            @click="selectedPayMethod = 'qris'"
          >
            QRIS
          </button>
          <button
            type="button"
            data-testid="modal-pay-card"
            class="rounded-2xl border p-3 text-center transition"
            :class="selectedPayMethod === 'card'
              ? 'border-primary bg-primary/10 text-primary font-bold'
              : 'border-zinc-200 bg-white text-ink-secondary'"
            @click="selectedPayMethod = 'card'"
          >
            Card
          </button>
        </div>

        <!-- Cash received input if cash -->
        <div v-if="selectedPayMethod === 'cash'" class="space-y-3 rounded-2xl bg-surface p-3">
          <BaseInput
            v-model="cashReceived"
            label="Uang Diterima *"
            placeholder="Nominal uang tunai"
            type="number"
            data-testid="modal-input-cash-received"
          />

          <div class="flex flex-wrap items-center gap-2">
            <button
              type="button"
              class="rounded-xl border border-primary/30 bg-primary/5 px-2.5 py-1 text-xs font-semibold text-primary"
              @click="fillExactCash"
            >
              Uang Pas
            </button>
            <button
              v-for="amt in quickCashAmounts"
              :key="amt"
              type="button"
              class="rounded-xl border border-zinc-200 bg-white px-2.5 py-1 text-xs font-medium text-ink-primary shadow-soft"
              @click="cashReceived = String(amt)"
            >
              {{ formatCurrency(amt) }}
            </button>
          </div>

          <div class="flex items-center justify-between border-t border-zinc-200 pt-2 text-sm">
            <span class="text-ink-secondary">Kembalian:</span>
            <span class="font-bold text-success" data-testid="modal-change-amount">
              {{ formatCurrency(changeAmount) }}
            </span>
          </div>
        </div>

        <div class="pt-2">
          <BaseButton
            class="w-full py-3"
            :disabled="isProcessingPayment"
            data-testid="btn-confirm-payment"
            @click="submitPayment"
          >
            {{ isProcessingPayment ? 'Memproses...' : 'Konfirmasi Pembayaran' }}
          </BaseButton>
        </div>
      </div>
    </BaseSheet>
  </div>
</template>
