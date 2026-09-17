<script setup>
import { computed, ref, watch } from 'vue'
import { useRouter } from 'vue-router'

import BaseButton from '@/components/base/BaseButton.vue'
import BaseCard from '@/components/base/BaseCard.vue'
import BaseInput from '@/components/base/BaseInput.vue'
import CustomerAutocomplete from '@/components/customer/CustomerAutocomplete.vue'
import PaymentMethodCard from '@/components/payment/PaymentMethodCard.vue'
import CartSummary from '@/components/pos/CartSummary.vue'
import { useBusinessStore } from '@/stores/businessStore'
import { useCartStore } from '@/stores/cartStore'
import { useCustomerStore } from '@/stores/customerStore'
import { useProductStore } from '@/stores/productStore'
import { resolveLocalOperationService } from '@/services/database/localOperationService'
import { formatCurrency } from '@/utils/formatters'

const QUICK_CASH_AMOUNTS = [20000, 50000, 100000, 200000, 500000]

const businessStore = useBusinessStore()
const cartStore = useCartStore()
const customerStore = useCustomerStore()
const productStore = useProductStore()
const localOperations = resolveLocalOperationService()
const router = useRouter()

const selectedMethod = ref('cash')
const selectedCustomerId = ref('')
const customerQuery = ref('')
const cashReceived = ref('')
const isProcessing = ref(false)
const hasAttemptedSubmit = ref(false)
const paymentError = ref('')
const isCashModalOpen = ref(false)

const paymentMethods = [
  { id: 'cash', label: 'Cash', description: 'Pembayaran tunai di kasir' },
  { id: 'qris', label: 'QRIS', description: 'Scan QR untuk pelanggan' },
  { id: 'card', label: 'Card', description: 'Debit atau kartu kredit' },
]

const isCashMethod = computed(() => selectedMethod.value === 'cash')
const selectedCustomer = computed(() => customerStore.getCustomerById(selectedCustomerId.value))

function onSelectCustomer(customer) {
  selectedCustomerId.value = customer.id
  customerQuery.value = customer.name
}

function clearCustomer() {
  selectedCustomerId.value = ''
  customerQuery.value = ''
}

// Mengetik ulang sampai tidak cocok lagi = kembali Walk-in Customer
watch(customerQuery, (value) => {
  if (!selectedCustomerId.value) {
    return
  }

  const selected = customerStore.getCustomerById(selectedCustomerId.value)

  if (!selected) {
    selectedCustomerId.value = ''
    return
  }

  if (selected.name.trim() !== `${value}`.trim()) {
    selectedCustomerId.value = ''
  }
})

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

function selectMethod(id) {
  selectedMethod.value = id
  if (id === 'cash' && !cashReceived.value) {
    isCashModalOpen.value = true
  }
}

function appendDigit(digit) {
  const current = cashReceived.value ? String(cashReceived.value) : ''
  if (digit === '000') {
    if (!current || current === '0') return
    cashReceived.value = current + '000'
  } else if (digit === '0') {
    if (!current || current === '0') {
      cashReceived.value = '0'
      return
    }
    cashReceived.value = current + '0'
  } else {
    if (current === '0') {
      cashReceived.value = String(digit)
    } else {
      cashReceived.value = current + String(digit)
    }
  }
  hasAttemptedSubmit.value = false
}

function backspaceDigit() {
  const current = cashReceived.value ? String(cashReceived.value) : ''
  if (current.length <= 1) {
    cashReceived.value = ''
  } else {
    cashReceived.value = current.slice(0, -1)
  }
  hasAttemptedSubmit.value = false
}

function clearCashInput() {
  cashReceived.value = ''
  hasAttemptedSubmit.value = false
}

async function completePayment() {
  paymentError.value = ''

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

  const stockValidation = productStore.canFulfillSale(cartStore.items)

  if (!stockValidation.success) {
    paymentError.value = stockValidation.error
    isProcessing.value = false
    return
  }

  await localOperations.commitRetailSale({
    checkout: {
      items: cartStore.items,
      subtotal: cartStore.subtotal,
      tax: cartStore.tax,
      total: cartStore.total,
      businessSnapshot: {
        name: businessStore.name,
        outlet: businessStore.outlet,
        phone: businessStore.phone,
      },
      customer: selectedCustomer.value?.name ?? 'Walk-in Customer',
      customerId: selectedCustomer.value?.id ?? null,
      customerSnapshot: selectedCustomer.value ? { ...selectedCustomer.value } : null,
      paymentMethod: selectedMethod.value,
      cashReceived: isCashMethod.value ? parsedCashReceived.value : null,
      changeAmount: isCashMethod.value ? changeAmount.value : null,
      orderStatus: businessStore.normalizedType === 'Laundry' ? 'Masuk' : null,
    },
  })

  cartStore.clearCart()
  isCashModalOpen.value = false
  await router.push('/payment/success')
}
</script>

<template>
  <div class="grid gap-5 lg:grid-cols-[1fr_380px] xl:grid-cols-[1fr_400px] items-start">
    <!-- Left Column: Payment Details -->
    <section class="min-w-0 space-y-4">
      <div>
        <p class="text-xs font-bold uppercase tracking-[0.18em] text-primary">Payment</p>
        <h2 class="mt-1 text-xl font-bold text-ink-primary">Pilih Metode Pembayaran</h2>
      </div>

      <!-- Minimalist Payment Methods in a 3-Column Grid -->
      <div class="grid grid-cols-3 gap-2.5 sm:gap-3">
        <button
          v-for="method in paymentMethods"
          :key="method.id"
          type="button"
          class="text-left"
          @click="selectMethod(method.id)"
        >
          <PaymentMethodCard :method="method" :active="selectedMethod === method.id" />
        </button>
      </div>

      <!-- Compact Customer Selector -->
      <BaseCard class="space-y-2 border border-zinc-200/70 p-4">
        <div class="flex items-center justify-between">
          <p class="text-xs font-semibold text-ink-primary">Pelanggan</p>
          <span class="text-[11px] text-ink-secondary">Opsional</span>
        </div>

        <CustomerAutocomplete
          v-model="customerQuery"
          testid="input-customer-search"
          placeholder="Cari nama / nomor pelanggan"
          @select="onSelectCustomer"
        />

        <div class="flex items-center justify-between gap-2 text-[11px]">
          <span class="truncate text-ink-secondary" data-testid="selected-customer-label">
            {{ selectedCustomer ? selectedCustomer.name : 'Walk-in Customer' }}
          </span>
          <button
            v-if="selectedCustomer || customerQuery"
            type="button"
            data-testid="btn-clear-customer"
            class="shrink-0 rounded-lg border border-zinc-200 px-2.5 py-1 font-semibold text-ink-secondary transition active:bg-zinc-100"
            @click="clearCustomer"
          >
            Hapus
          </button>
        </div>
      </BaseCard>

      <!-- Cash Section: Minimalist Summary + Keypad Trigger -->
      <BaseCard v-if="isCashMethod" class="space-y-3.5 border border-zinc-200/70 p-4">
        <div class="flex items-center justify-between">
          <div>
            <h3 class="text-sm font-bold text-ink-primary">Pembayaran Tunai</h3>
            <p class="text-[11px] text-ink-secondary">Input uang tunai dari pelanggan</p>
          </div>
          <button
            type="button"
            id="btn-open-cash-modal"
            @click="isCashModalOpen = true"
            class="inline-flex items-center gap-1.5 rounded-xl border border-primary/30 bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary hover:bg-primary/20 active:scale-95 transition cursor-pointer"
          >
            <svg class="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <rect x="4" y="2" width="16" height="20" rx="2" />
              <line x1="8" y1="6" x2="16" y2="6" />
              <line x1="16" y1="14" x2="16" y2="18" />
              <path d="M16 10h.01M12 10h.01M8 10h.01M12 14h.01M8 14h.01M12 18h.01M8 18h.01" />
            </svg>
            <span>Buka Keypad</span>
          </button>
        </div>

        <!-- Input Box: Direct Input + Clickable to Open Modal -->
        <div class="space-y-2">
          <BaseInput
            :model-value="cashReceived"
            label="Uang Diterima"
            type="number"
            placeholder="Masukkan nominal uang diterima"
            @update:model-value="cashReceived = $event"
          />

          <!-- Quick Cash Shortcuts -->
          <div class="flex flex-wrap items-center gap-1.5 pt-1">
            <BaseButton size="sm" variant="secondary" @click="fillExactAmount">
              Uang Pas
            </BaseButton>
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
        </div>

        <p v-if="cashValidationMessage" class="text-xs font-medium text-danger">
          {{ cashValidationMessage }}
        </p>

        <!-- Calculation Display Box -->
        <div class="rounded-2xl border border-zinc-100 bg-zinc-50/80 p-3">
          <div class="flex items-center justify-between text-xs">
            <span class="text-ink-secondary">Total Tagihan</span>
            <span class="font-bold text-ink-primary">{{ formatCurrency(cartStore.total) }}</span>
          </div>
          <div class="mt-1.5 flex items-center justify-between text-xs">
            <span class="text-ink-secondary">Uang Diterima</span>
            <span class="font-bold text-ink-primary">{{ formatCurrency(displayedCashReceived) }}</span>
          </div>
          <div class="mt-1.5 flex items-center justify-between border-t border-zinc-200/60 pt-1.5 text-xs">
            <span class="font-semibold text-ink-secondary">Kembalian</span>
            <span
              class="font-extrabold"
              :class="changeAmount > 0 ? 'text-emerald-600' : 'text-ink-primary'"
            >
              {{ formatCurrency(changeAmount) }}
            </span>
          </div>
        </div>
      </BaseCard>
    </section>

    <!-- Right Column: Order Summary & Checkout -->
    <section class="space-y-4 md:sticky md:top-4">
      <BaseCard class="space-y-4 border border-zinc-200/70 p-4 shadow-sm">
        <h3 class="text-base font-bold text-ink-primary">Ringkasan Pembayaran</h3>
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

      <p v-if="paymentError" class="rounded-2xl bg-danger/10 p-3 text-xs font-semibold text-danger">
        {{ paymentError }}
      </p>
    </section>

    <!-- Modal Keypad Uang Diterima (Khusus CASH) -->
    <div
      v-if="isCashModalOpen"
      class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs animate-in fade-in duration-150"
    >
      <div
        class="relative w-full max-w-sm rounded-3xl bg-white p-5 shadow-2xl space-y-4 animate-in zoom-in-95 duration-200"
      >
        <!-- Modal Header -->
        <div class="flex items-center justify-between border-b border-zinc-100 pb-3">
          <div class="flex items-center gap-2">
            <div class="flex h-8 w-8 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <rect x="2" y="6" width="20" height="12" rx="2" />
                <circle cx="12" cy="12" r="2" />
                <path d="M6 12h.01M18 12h.01" />
              </svg>
            </div>
            <div>
              <h3 class="text-sm font-bold text-ink-primary">Uang Diterima</h3>
              <p class="text-[10px] text-ink-secondary">Kalkulator Pembayaran Tunai</p>
            </div>
          </div>

          <button
            type="button"
            @click="isCashModalOpen = false"
            class="flex h-8 w-8 items-center justify-center rounded-xl border border-zinc-200 text-zinc-400 hover:bg-zinc-100 hover:text-ink-primary transition cursor-pointer"
            aria-label="Tutup"
          >
            <svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <!-- Total Tagihan & Display Nominal -->
        <div class="rounded-2xl bg-zinc-50 p-3.5 border border-zinc-100 space-y-2">
          <div class="flex items-center justify-between text-xs">
            <span class="text-zinc-500">Total Tagihan:</span>
            <span class="font-bold text-zinc-900">{{ formatCurrency(cartStore.total) }}</span>
          </div>

          <!-- Display Input Uang Diterima -->
          <div class="flex items-baseline justify-between rounded-xl bg-white px-3 py-2 border border-zinc-200 shadow-inner">
            <span class="text-xs font-semibold text-zinc-400">Rp</span>
            <span class="text-xl font-black text-ink-primary tracking-tight">
              {{ displayedCashReceived ? Number(displayedCashReceived).toLocaleString('id-ID') : '0' }}
            </span>
          </div>

          <!-- Kembalian Info -->
          <div class="flex items-center justify-between text-xs pt-1 border-t border-zinc-200/60">
            <span class="font-medium text-zinc-500">Kembalian:</span>
            <span
              v-if="cashValidationState === 'insufficient'"
              class="font-bold text-danger text-[11px]"
            >
              Kurang {{ formatCurrency(cartStore.total - displayedCashReceived) }}
            </span>
            <span
              v-else-if="changeAmount > 0"
              class="font-extrabold text-emerald-600 text-sm"
            >
              {{ formatCurrency(changeAmount) }}
            </span>
            <span
              v-else-if="displayedCashReceived === cartStore.total && displayedCashReceived > 0"
              class="font-bold text-primary text-xs"
            >
              Uang Pas (Kembalian Rp 0)
            </span>
            <span v-else class="text-zinc-400 text-xs">Rp 0</span>
          </div>
        </div>

        <!-- Quick Shortcut: Button Uang Pas & Quick Amounts -->
        <div class="flex items-center gap-1.5 overflow-x-auto pb-1">
          <button
            type="button"
            @click="fillExactAmount"
            class="flex-1 shrink-0 rounded-xl bg-primary/10 border border-primary/20 px-2.5 py-1.5 text-xs font-bold text-primary hover:bg-primary/20 active:scale-95 transition cursor-pointer"
          >
            Uang Pas
          </button>
          <button
            v-for="amount in quickCashAmounts"
            :key="amount"
            type="button"
            @click="selectQuickCashAmount(amount)"
            class="shrink-0 rounded-xl border border-zinc-200 bg-zinc-50 px-2.5 py-1.5 text-xs font-semibold text-zinc-700 hover:bg-zinc-100 active:scale-95 transition cursor-pointer"
          >
            {{ formatCurrency(amount) }}
          </button>
        </div>

        <!-- Numeric Keypad (1 - 0, 000, Clear, Backspace) -->
        <div class="grid grid-cols-3 gap-2">
          <button
            v-for="num in [1, 2, 3, 4, 5, 6, 7, 8, 9]"
            :key="num"
            type="button"
            @click="appendDigit(num)"
            class="flex h-11 items-center justify-center rounded-2xl bg-zinc-100 text-base font-bold text-ink-primary hover:bg-zinc-200 active:scale-95 transition cursor-pointer"
          >
            {{ num }}
          </button>

          <!-- Row 4: 000, 0, Backspace/Clear -->
          <button
            type="button"
            @click="appendDigit('000')"
            class="flex h-11 items-center justify-center rounded-2xl bg-zinc-100 text-xs font-bold text-zinc-600 hover:bg-zinc-200 active:scale-95 transition cursor-pointer"
          >
            000
          </button>

          <button
            type="button"
            @click="appendDigit(0)"
            class="flex h-11 items-center justify-center rounded-2xl bg-zinc-100 text-base font-bold text-ink-primary hover:bg-zinc-200 active:scale-95 transition cursor-pointer"
          >
            0
          </button>

          <button
            type="button"
            @click="backspaceDigit"
            class="flex h-11 items-center justify-center rounded-2xl bg-zinc-100 text-sm font-semibold text-zinc-600 hover:bg-rose-50 hover:text-danger active:scale-95 transition cursor-pointer"
            title="Hapus 1 angka"
            aria-label="Hapus 1 angka"
          >
            <svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M21 4H8l-7 8 7 8h13a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2z" />
              <line x1="18" y1="9" x2="12" y2="15" />
              <line x1="12" y1="9" x2="18" y2="15" />
            </svg>
          </button>
        </div>

        <!-- Modal Actions Footer -->
        <div class="flex items-center gap-2 pt-1">
          <button
            type="button"
            @click="clearCashInput"
            class="h-10 rounded-xl border border-zinc-200 px-3 text-xs font-semibold text-zinc-600 hover:bg-zinc-100 active:scale-95 transition cursor-pointer"
          >
            Reset
          </button>

          <button
            type="button"
            @click="isCashModalOpen = false"
            class="flex-1 h-10 rounded-xl bg-zinc-800 text-xs font-bold text-white hover:bg-zinc-900 active:scale-95 transition cursor-pointer"
          >
            Simpan Nominal
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

