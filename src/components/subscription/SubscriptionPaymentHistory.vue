<script setup>
import { computed, ref, watch } from 'vue'
import BaseButton from '@/components/base/BaseButton.vue'
import BaseCard from '@/components/base/BaseCard.vue'
import BaseModal from '@/components/base/BaseModal.vue'
import { paymentStatusLabel, paymentStatusTone } from '@/services/premium/paymentStatus'
import { PLAN_PERIOD_LABELS, formatPlanPrice } from '@/services/subscription/planCatalogService'
import { formatServerDateTime } from '@/services/subscription/subscriptionPresentation'

const props = defineProps({
  payments: { type: Array, default: () => [] },
  loading: Boolean,
  error: { type: String, default: '' },
  cancellationError: { type: String, default: '' },
  cancellingId: { type: [String, Number], default: null },
  offline: Boolean,
  businessId: { type: [String, Number], default: null },
})
const emit = defineEmits(['refresh', 'cancel'])
const selectedId = ref(null)
const selected = computed(() =>
  props.payments.find((p) => p.id === selectedId.value && p.status === 'pending' && p.canCancel),
)
watch(
  () => props.businessId,
  () => {
    selectedId.value = null
  },
  { flush: 'sync' },
)
watch(
  () => props.cancellingId,
  (value, previous) => {
    if (previous !== null && value === null) selectedId.value = null
  },
)
function tone(status) {
  return {
    success: 'bg-emerald-100 text-emerald-700',
    warning: 'bg-amber-100 text-amber-700',
    danger: 'bg-red-100 text-red-700',
    muted: 'bg-zinc-100 text-zinc-700',
  }[paymentStatusTone(status)]
}
</script>

<template>
  <BaseCard class="space-y-3" data-testid="payment-history-section">
    <div class="flex items-center justify-between gap-3">
      <div>
        <h3 class="text-base font-semibold text-ink-primary">Riwayat Pembayaran</h3>
        <p class="text-xs text-ink-secondary">20 transaksi langganan terbaru.</p>
      </div>
      <BaseButton
        size="sm"
        variant="secondary"
        :disabled="loading || offline || cancellingId !== null"
        @click="emit('refresh')"
        >Perbarui</BaseButton
      >
    </div>
    <p v-if="offline" class="text-sm text-amber-700">
      Hubungkan internet untuk memperbarui atau membatalkan pembayaran.
    </p>
    <p
      v-if="cancellationError"
      role="alert"
      class="text-sm text-red-600"
      data-testid="history-cancel-error"
    >
      {{ cancellationError }}
    </p>
    <p v-if="loading" class="text-sm text-ink-secondary" data-testid="history-loading">
      Memuat riwayat...
    </p>
    <p v-else-if="error" class="text-sm text-amber-700" data-testid="history-error">{{ error }}</p>
    <p v-else-if="!payments.length" class="text-sm text-ink-secondary" data-testid="history-empty">
      Belum ada riwayat pembayaran.
    </p>
    <div v-else class="space-y-2" data-testid="history-list">
      <div
        v-for="payment in payments"
        :key="payment.id"
        class="rounded-2xl border border-zinc-200 px-4 py-3"
        :data-testid="`history-payment-${payment.id}`"
      >
        <div class="flex flex-wrap items-center justify-between gap-2">
          <p class="text-sm font-semibold text-ink-primary">
            {{ PLAN_PERIOD_LABELS[payment.billingPeriod] ?? payment.billingPeriod ?? '-' }}
          </p>
          <span
            class="rounded-full px-2.5 py-1 text-xs font-medium"
            :class="tone(payment.status)"
            >{{ paymentStatusLabel(payment.status) }}</span
          >
        </div>
        <p class="mt-1 text-xs text-ink-secondary">
          {{ formatServerDateTime(payment.createdAt || payment.paidAt) || '-' }}
        </p>
        <p class="mt-1 break-all text-xs text-ink-secondary">
          {{ payment.orderId || `#${payment.id}` }}
        </p>
        <div class="mt-3 flex flex-wrap items-center justify-between gap-3">
          <p class="text-sm font-semibold text-ink-primary">
            {{
              payment.amount == null
                ? '-'
                : formatPlanPrice(payment.amount, payment.currency || 'IDR')
            }}
          </p>
          <BaseButton
            v-if="payment.status === 'pending' && payment.canCancel"
            size="sm"
            variant="secondary"
            :disabled="offline || cancellingId !== null"
            :data-testid="`cancel-payment-${payment.id}`"
            @click="selectedId = payment.id"
            >{{ cancellingId === payment.id ? 'Membatalkan...' : 'Batalkan' }}</BaseButton
          >
        </div>
      </div>
    </div>
    <BaseModal
      :open="!!selected"
      title="Batalkan pembayaran?"
      @close="cancellingId === null && (selectedId = null)"
    >
      <p class="text-sm text-ink-secondary">
        Pembayaran langganan ini akan dibatalkan. Anda dapat membuat pembayaran baru setelah
        pembatalan berhasil.
      </p>
      <div class="mt-5 flex justify-end gap-2">
        <BaseButton variant="secondary" :disabled="cancellingId !== null" @click="selectedId = null"
          >Kembali</BaseButton
        >
        <BaseButton
          :disabled="offline || cancellingId !== null"
          data-testid="confirm-cancel-payment"
          @click="emit('cancel', selected)"
          >{{ cancellingId !== null ? 'Membatalkan...' : 'Ya, batalkan' }}</BaseButton
        >
      </div>
    </BaseModal>
  </BaseCard>
</template>
