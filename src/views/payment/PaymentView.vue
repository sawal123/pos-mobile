<script setup>
import { computed, ref } from 'vue'
import { storeToRefs } from 'pinia'
import { useRouter } from 'vue-router'

import BaseButton from '@/components/base/BaseButton.vue'
import BaseCard from '@/components/base/BaseCard.vue'
import BaseInput from '@/components/base/BaseInput.vue'
import PaymentMethodCard from '@/components/payment/PaymentMethodCard.vue'
import CartSummary from '@/components/pos/CartSummary.vue'
import { useCartStore } from '@/stores/cartStore'
import { useCustomerStore } from '@/stores/customerStore'
import { useTransactionStore } from '@/stores/transactionStore'
import { formatCurrency } from '@/utils/formatters'

const QUICK_CASH_AMOUNTS = [20000, 50000, 100000, 200000, 500000]

const cartStore = useCartStore()
const customerStore = useCustomerStore()
const transactionStore = useTransactionStore()
const router = useRouter()

const { customers } = storeToRefs(customerStore)

const selectedMethod = ref('cash')
const selectedCustomerId = ref('')
const cashReceived = ref('')
const isProcessing = ref(false)
const hasAttemptedSubmit = ref(false)

const paymentMethods = [
  { id: 'cash', label: 'Cash', description: 'Pembayaran tunai di kasir' },
  { id: 'qris', label: 'QRIS', description: 'Scan QR untuk pelanggan' },
  { id: 'card', label: 'Card', description: 'Debit atau kartu kredit' },
]

const isCashMethod = computed(() => selectedMethod.value === 'cash')
const selectedCustomer = computed(() => customerStore.getCustomerById(selectedCustomerId.value))

const parsedCashReceived = computed(() => {
  if (cashReceived.value == null || `${cashReceived.value}`.trim() === '') {
    return null
  }

  const amount = Number(cashReceived.value)
  return Number.isFinite(amount) ? amount : Number.NaN
})

const cashValidationState = computed(() => {
  if (!isCashMethod.value) {
    return 'valid'
  }

  if (parsedCashReceived.value === null) {
    return 'required'
  }

  if (Number.isNaN(parsedCashReceived.value)) {
    return 'invalid'
  }

  if (parsedCashReceived.value < 0) {
    return 'negative'
  }

  if (parsedCashReceived.value < cartStore.total) {
    return 'insufficient'
  }

  return 'valid'
})

const cashValidationMessage = computed(() => {
  if (!isCashMethod.value) {
    return ''
  }

  if (cashValidationState.value === 'required') {
    return hasAttemptedSubmit.value ? 'Uang diterima wajib diisi' : ''
  }

  if (cashValidationState.value === 'invalid') {
    return 'Uang diterima harus berupa angka valid'
  }

  if (cashValidationState.value === 'negative') {
    return 'Uang diterima tidak boleh negatif'
  }

  if (cashValidationState.value === 'insufficient') {
    return 'Uang diterima kurang dari total pembayaran'
  }

  return ''
})

const isCashPaymentValid = computed(() => isCashMethod.value && cashValidationState.value === 'valid')

const displayedCashReceived = computed(() => (
  parsedCashReceived.value == null || Number.isNaN(parsedCashReceived.value)
    ? 0
    : parsedCashReceived.value
))

const changeAmount = computed(() => {
  if (!isCashPaymentValid.value) {
    return 0
  }

  return Math.max(0, parsedCashReceived.value - cartStore.total)
})

const quickCashAmounts = computed(() => {
  const amounts = QUICK_CASH_AMOUNTS.filter((amount) => amount > cartStore.total)
  return [...new Set(amounts)].slice(0, 3)
})

const isSubmitDisabled = computed(() => {
  if (!cartStore.items.length || isProcessing.value) {
    return true
  }

  if (!isCashMethod.value) {
    return false
  }

  return !isCashPaymentValid.value
})

function fillExactAmount() {
  cashReceived.value = String(cartStore.total)
  hasAttemptedSubmit.value = false
}

function selectQuickCashAmount(amount) {
  cashReceived.value = String(amount)
  hasAttemptedSubmit.value = false
}

async function completePayment() {
  if (!cartStore.items.length) {
    await router.push('/pos')
    return
  }

  hasAttemptedSubmit.value = true

  if (isCashMethod.value && !isCashPaymentValid.value) {
    return
  }

  if (isProcessing.value) {
    return
  }

  isProcessing.value = true

  transactionStore.createTransaction({
    items: cartStore.items,
    subtotal: cartStore.subtotal,
    tax: cartStore.tax,
    total: cartStore.total,
    customer: selectedCustomer.value?.name ?? 'Walk-in Customer',
    customerId: selectedCustomer.value?.id ?? null,
    customerSnapshot: selectedCustomer.value ? { ...selectedCustomer.value } : null,
    paymentMethod: selectedMethod.value,
    cashReceived: isCashMethod.value ? parsedCashReceived.value : null,
    changeAmount: isCashMethod.value ? changeAmount.value : null,
  })

  cartStore.clearCart()
  await router.push('/payment/success')
}
</script>

<template>
  <div class="grid gap-6 lg:grid-cols-[1fr_0.8fr]">
    <section class="space-y-4">
      <div>
        <p class="text-sm font-medium uppercase tracking-[0.18em] text-primary">Payment</p>
        <h2 class="mt-2 text-2xl font-semibold text-ink-primary">Pilih metode pembayaran</h2>
      </div>

      <div class="grid gap-4">
        <button
          v-for="method in paymentMethods"
          :key="method.id"
          class="text-left"
          @click="selectedMethod = method.id"
        >
          <PaymentMethodCard :method="method" :active="selectedMethod === method.id" />
        </button>
      </div>

      <BaseCard class="space-y-3">
        <div>
          <p class="text-sm font-medium text-ink-primary">Pelanggan</p>
          <p class="mt-1 text-sm text-ink-secondary">
            Pilih pelanggan jika transaksi tidak menggunakan Walk-in Customer.
          </p>
        </div>

        <label class="flex flex-col gap-2">
          <span class="text-sm font-medium text-ink-secondary">Customer</span>
          <select
            v-model="selectedCustomerId"
            class="h-12 rounded-2xl border border-zinc-200 bg-white px-4 text-sm text-ink-primary outline-none transition focus:border-primary focus:ring-4 focus:ring-primary/10"
          >
            <option value="">Walk-in Customer</option>
            <option v-for="customer in customers" :key="customer.id" :value="customer.id">
              {{ customer.name }}
            </option>
          </select>
        </label>
      </BaseCard>

      <BaseCard v-if="isCashMethod" class="space-y-4">
        <BaseInput
          :model-value="cashReceived"
          label="Uang Diterima"
          type="number"
          placeholder="Masukkan nominal uang diterima"
          @update:model-value="cashReceived = $event"
        />

        <div class="flex flex-wrap gap-2">
          <BaseButton size="sm" variant="secondary" @click="fillExactAmount">Uang Pas</BaseButton>
          <BaseButton
            v-for="amount in quickCashAmounts"
            :key="amount"
            size="sm"
            variant="ghost"
            @click="selectQuickCashAmount(amount)"
          >
            {{ formatCurrency(amount) }}
          </BaseButton>
        </div>

        <p v-if="cashValidationMessage" class="text-sm text-danger">
          {{ cashValidationMessage }}
        </p>

        <div class="rounded-2xl bg-zinc-50 px-4 py-3">
          <div class="flex items-center justify-between gap-3 text-sm">
            <span class="text-ink-secondary">Total</span>
            <span class="font-medium text-ink-primary">{{ formatCurrency(cartStore.total) }}</span>
          </div>
          <div class="mt-2 flex items-center justify-between gap-3 text-sm">
            <span class="text-ink-secondary">Uang Diterima</span>
            <span class="font-medium text-ink-primary">
              {{ formatCurrency(displayedCashReceived) }}
            </span>
          </div>
          <div class="mt-2 flex items-center justify-between gap-3 text-sm">
            <span class="text-ink-secondary">Kembalian</span>
            <span class="font-medium text-ink-primary">{{ formatCurrency(changeAmount) }}</span>
          </div>
        </div>
      </BaseCard>
    </section>

    <section class="space-y-4">
      <BaseCard class="space-y-4">
        <h3 class="text-lg font-semibold text-ink-primary">Ringkasan Pembayaran</h3>
        <CartSummary
          :subtotal="cartStore.subtotal"
          :tax="cartStore.tax"
          :total="cartStore.total"
          :show-action="false"
        />
      </BaseCard>

      <BaseButton block size="lg" :disabled="isSubmitDisabled" @click="completePayment">
        Selesaikan Pembayaran
      </BaseButton>
    </section>
  </div>
</template>
