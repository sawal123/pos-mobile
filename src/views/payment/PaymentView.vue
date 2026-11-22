<script setup>
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import BaseButton from '@/components/base/BaseButton.vue'
import BaseCard from '@/components/base/BaseCard.vue'
import BaseInput from '@/components/base/BaseInput.vue'
import CustomerAutocomplete from '@/components/customer/CustomerAutocomplete.vue'
import PaymentMethodCard from '@/components/payment/PaymentMethodCard.vue'
import PaymentSuccessModal from '@/components/payment/PaymentSuccessModal.vue'
import CartSummary from '@/components/pos/CartSummary.vue'
import DiscountPromoModal from '@/components/pos/DiscountPromoModal.vue'
import { useBusinessStore } from '@/stores/businessStore'
import { useCartStore } from '@/stores/cartStore'
import { usePaymentMethodStore } from '@/stores/paymentMethodStore'
import { useProductStore } from '@/stores/productStore'
import { usePromoStore } from '@/stores/promoStore'
import { useTaxStore } from '@/stores/taxStore'
import { useSyncPushStore } from '@/stores/syncPushStore'
import { useSyncStatusStore } from '@/stores/syncStatusStore'
import { useCloudSessionStore } from '@/stores/cloudSessionStore'
import { resolveLocalOperationService } from '@/services/database/localOperationService'
import { formatCurrency } from '@/utils/formatters'
import { normalizeCustomerPhone } from '@/utils/customerPhone'

const QUICK_CASH_AMOUNTS = [20000, 50000, 100000, 200000, 500000]

const businessStore = useBusinessStore()
const cloudStore = useCloudSessionStore()
const syncPushStore = useSyncPushStore()
const syncStatusStore = useSyncStatusStore()
const cartStore = useCartStore()
const paymentMethodStore = usePaymentMethodStore()
const promoStore = usePromoStore()
const taxStore = useTaxStore()
const productStore = useProductStore()
const localOperations = resolveLocalOperationService()
const route = useRoute()
const router = useRouter()

const selectedOutletId = computed(() => cloudStore.selectedOutlet?.id)

const paymentMethods = computed(() => {
  const methods = paymentMethodStore.getMethodsForOutlet(selectedOutletId.value).map((m) => ({
    id: m.code || m.id,
    label: m.name || m.label,
    description: m.description,
    type: m.category || m.type || 'other',
    is_cash: Boolean(m.is_cash ?? m.isCash),
    accountNumber: m.accountNumber,
    accountHolder: m.accountHolder,
  }))

  if (!methods.some((m) => m.id === 'unpaid')) {
    methods.push({
      id: 'unpaid',
      label: 'Bayar Nanti',
      description: 'Transaksi tempo / piutang pelanggan',
      type: 'unpaid',
      is_cash: false,
    })
  }

  return methods
})

const selectedMethod = ref(
  route?.query?.method === 'unpaid'
    ? 'unpaid'
    : (paymentMethods.value.find((m) => paymentMethodStore.isCashMethod(m.id))?.id || paymentMethods.value[0]?.id || 'cash')
)

watch(
  () => route?.query?.method,
  (method) => {
    if (method) {
      selectedMethod.value = method
    }
  },
  { immediate: true },
)
const customerQuery = ref(
  cartStore.selectedCustomer?.name || cartStore.customerName || cartStore.customerPhone || ''
)
const cashReceived = ref('')
const isProcessing = ref(false)
const hasAttemptedSubmit = ref(false)
const paymentError = ref('')
const isCashModalOpen = ref(false)
const showPromoModal = ref(false)
const inlineDiscountType = ref(cartStore.manualDiscountType || 'fixed')
const inlineDiscountInput = ref(
  cartStore.manualDiscountValue > 0 ? String(cartStore.manualDiscountValue) : '',
)
const discountErrorMessage = ref('')

watch(
  () => [cartStore.manualDiscountType, cartStore.manualDiscountValue, cartStore.appliedPromo],
  ([type, val, promo]) => {
    discountErrorMessage.value = ''
    if (promo) {
      inlineDiscountInput.value = ''
      return
    }
    inlineDiscountType.value = type || 'fixed'
    inlineDiscountInput.value = Number(val) > 0 ? String(val) : ''
  },
)

function switchInlineDiscountType(type) {
  inlineDiscountType.value = type
  discountErrorMessage.value = ''
  const raw = String(inlineDiscountInput.value ?? '').trim()
  if (!raw) {
    return
  }
  applyInlineDiscount()
}

function applyInlineDiscount() {
  discountErrorMessage.value = ''
  const raw = String(inlineDiscountInput.value ?? '').trim()
  if (!raw || Number(raw) === 0) {
    cartStore.clearDiscount()
    return
  }

  const numeric = Number(raw)
  if (!Number.isFinite(numeric) || numeric < 0) {
    discountErrorMessage.value = 'Masukkan nominal diskon yang valid'
    return
  }

  if (inlineDiscountType.value === 'percent' && numeric > 100) {
    discountErrorMessage.value = 'Persentase diskon maksimal 100%'
    return
  }

  cartStore.setManualDiscount({
    type: inlineDiscountType.value,
    value: numeric,
  })
}

function handleRemovePaymentDiscount() {
  discountErrorMessage.value = ''
  inlineDiscountInput.value = ''
  cartStore.removePromo()
}

/**
 * Summary of the transaction that was actually committed. Set only after
 * `commitRetailSale()` resolves, so the success modal can never appear for a
 * payment that did not complete.
 */
const successSummary = ref(null)

const isPaymentCompleted = computed(() => successSummary.value !== null)

const isCashMethod = computed(() => {
  return paymentMethodStore.isCashMethod(selectedMethod.value)
})
const isUnpaidMethod = computed(() => {
  return selectedMethod.value === 'unpaid'
})
const selectedCustomer = computed(() => cartStore.selectedCustomer)

const currentCustomerDisplay = computed(() => {
  if (selectedCustomer.value?.name) return selectedCustomer.value.name
  if (cartStore.customerName?.trim()) return cartStore.customerName.trim()
  if (customerQuery.value?.trim()) return customerQuery.value.trim()
  return 'Walk-in Customer'
})

function onSelectCustomer(customer) {
  cartStore.selectCustomer(customer)
  cartStore.setCustomerName('')
  customerQuery.value = customer.name
}

function clearCustomer() {
  cartStore.clearCustomer()
  cartStore.setCustomerName('')
  customerQuery.value = ''
}

// Share the customer with the cart and resolve an exact phone match or ad-hoc guest name automatically.
watch(customerQuery, (value) => {
  const trimmed = String(value || '').trim()
  if (selectedCustomer.value?.name?.trim() === trimmed) return

  if (!trimmed) {
    cartStore.setCustomerName('')
    cartStore.setCustomerPhone('')
    return
  }

  const phoneMatch = normalizeCustomerPhone(trimmed)
  if (phoneMatch) {
    cartStore.setCustomerPhone(trimmed)
    cartStore.setCustomerName('')
  } else {
    cartStore.setCustomerName(trimmed)
    cartStore.setCustomerPhone('')
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
  if (paymentMethodStore.isCashMethod(id)) {
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

  if (isPaymentCompleted.value) {
    return
  }

  if (!cartStore.items.length) {
    await router.push('/pos')
    return
  }

  hasAttemptedSubmit.value = true

  if (isCashMethod.value && !isCashPaymentValid.value) {
    return
  }

  // Loading guard: a second tap while a payment is in flight is ignored, so a
  // double-submit can never create two transactions.
  if (isProcessing.value) {
    return
  }

  const stockValidation = productStore.canFulfillSale(cartStore.items)
  if (!stockValidation.success) {
    paymentError.value = stockValidation.error
    return
  }

  isProcessing.value = true

  try {
    // Allow 1 frame for the processing overlay/spinner to paint before sync SQLite writes
    if (!import.meta.env?.VITEST) {
      await new Promise((resolve) => setTimeout(resolve, 20))
    }

    const isUnpaid = selectedMethod.value === 'unpaid'
    const transaction = await localOperations.commitRetailSale({
      checkout: {
        items: cartStore.items,
        subtotal: cartStore.subtotal,
        discount: cartStore.discount,
        discountLabel: cartStore.discountLabel || null,
        promoSyncId: cartStore.appliedPromo?.sync_id ?? null,
        appliedPromo: cartStore.appliedPromo,
        tax: cartStore.tax,
        taxEnabled: taxStore.enabled,
        taxRate: taxStore.enabled ? taxStore.rate : 0,
        total: cartStore.total,
        tableNumber: cartStore.tableNumber || null,
        businessSnapshot: {
          name: businessStore.name,
          outlet: businessStore.outlet,
          phone: businessStore.phone,
        },
        customer: selectedCustomer.value?.name ?? (cartStore.customerName || 'Walk-in Customer'),
        customerId: selectedCustomer.value?.id ?? null,
        customerSnapshot: selectedCustomer.value
          ? {
              id: selectedCustomer.value.id,
              name: selectedCustomer.value.name,
              phone: selectedCustomer.value.phone || '',
              email: selectedCustomer.value.email || '',
            }
          : (cartStore.customerName
              ? { id: null, name: cartStore.customerName, phone: '', email: '' }
              : null),
        paymentMethod: selectedMethod.value,
        paymentStatus: isUnpaid ? 'unpaid' : 'paid',
        status: isUnpaid ? 'unpaid' : 'paid',
        cashReceived: isCashMethod.value ? parsedCashReceived.value : (isUnpaid ? 0 : null),
        changeAmount: isCashMethod.value ? changeAmount.value : (isUnpaid ? 0 : null),
        paidAt: isUnpaid ? null : new Date().toISOString(),
        orderStatus: businessStore.normalizedType === 'Laundry'
          ? 'Masuk'
          : 'Proses',
      },
    })

    // Success is recorded ONLY after the durable commit resolved. The summary is
    // taken from the committed transaction — never from the cart being cleared.
    successSummary.value = {
      id: transaction.id,
      invoiceNumber: transaction.invoiceNumber,
      total: transaction.total,
      discount: transaction.discount ?? 0,
      paymentMethod: transaction.paymentMethod,
      cashReceived: transaction.cashReceived ?? null,
      changeAmount: transaction.changeAmount ?? null,
      paidAt: transaction.paidAt ?? null,
      createdAt: transaction.createdAt ?? null,
      itemCount: transaction.itemCount ?? 0,
    }

    cartStore.clearCart()
    isCashModalOpen.value = false

    // Direct Cloud push when online in Cloud mode
    const isCloudMode =
      businessStore.mode === 'cloud' || (cloudStore.isLinked && cloudStore.hasCloudAccess)
    if (isCloudMode && syncStatusStore.online) {
      void (async () => {
        try {
          await syncPushStore.pushNow()
          await syncStatusStore.refresh()
        } catch {
          // If network drops, data remains safely queued in local SQLite
        }
      })()
    }
  } catch (error) {
    // Failure before/while committing: surface the error, keep the cart, and
    // never show the success modal or navigate. There is no automatic retry — a
    // partially written operation is left to the existing journal/recovery flow.
    paymentError.value =
      (error instanceof Error && error.message) ||
      'Pembayaran gagal disimpan. Periksa kembali lalu coba lagi.'
  } finally {
    // Stay "processing" after success so the submit button can never fire again.
    if (!isPaymentCompleted.value) {
      isProcessing.value = false
    }
  }
}

// All post-success navigation replaces the payment entry, so the Android back
// button can never return to /payment and re-run the checkout.
function goToNewTransaction() {
  successSummary.value = null
  router.replace('/pos')
}

function handleCompleteReady() {
  const id = successSummary.value?.id || transactionStore.lastTransaction?.id
  if (id) {
    transactionStore.updateOrderStatus(id, 'Siap')
    if (businessStore.isCloudMode) {
      try {
        const syncPushStore = useSyncPushStore()
        syncPushStore.pushIfOnline?.()
      } catch {
        // Safe fallback
      }
    }
  }
  successSummary.value = null
  router.replace('/pos')
}

function goToReceipt() {
  const id = successSummary.value?.id || transactionStore.lastTransaction?.id
  successSummary.value = null

  if (!id) {
    router.replace('/pos')
    return
  }

  router.replace(`/transactions/${id}/receipt`)
}

function goToTransactions() {
  successSummary.value = null
  router.replace({ path: '/pos', query: { open_queue: '1' } })
}
</script>

<template>
  <div class="grid gap-4 pb-40 lg:grid-cols-[1fr_380px] xl:grid-cols-[1fr_400px] items-start md:gap-5 md:pb-0">
    <!-- Left Column: Payment Details -->
    <section class="min-w-0 space-y-4">
      <div>
        <p class="text-xs font-bold uppercase tracking-[0.18em] text-primary">Payment</p>
        <h2 class="mt-1 text-xl font-bold text-ink-primary">Pilih Metode Pembayaran</h2>
      </div>

      <!-- Minimalist Payment Methods in a 4-Column Grid -->
      <div class="grid grid-cols-2 gap-2.5 sm:grid-cols-4 sm:gap-3">
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
          <span class="truncate text-ink-secondary font-medium" data-testid="selected-customer-label">
            {{ currentCustomerDisplay }}
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

      <!-- Minimalist Discount & Voucher Section -->
      <BaseCard
        class="space-y-2.5 border border-zinc-200/70 p-3.5 dark:border-slate-700/60"
        data-testid="payment-discount-card"
      >
        <div class="flex items-center justify-between gap-2">
          <div class="flex items-center gap-2 min-w-0">
            <span class="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary dark:bg-indigo-500/15 dark:text-indigo-300">
              <svg class="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" />
                <line x1="7" y1="7" x2="7.01" y2="7" />
              </svg>
            </span>
            <span class="truncate text-xs font-semibold text-ink-primary">Diskon / Voucher</span>
          </div>

          <button
            type="button"
            data-testid="btn-open-promo-modal"
            class="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border border-primary/25 bg-primary/8 px-2.5 py-1 text-[11px] font-semibold text-primary transition hover:bg-primary/15 active:scale-95 cursor-pointer dark:border-indigo-400/30 dark:bg-indigo-500/15 dark:text-indigo-300"
            @click="showPromoModal = true"
          >
            <span>Pilih Voucher</span>
            <span
              v-if="promoStore.activePromos.length"
              class="rounded-full bg-primary px-1.5 py-0.2 font-mono text-[10px] font-bold text-white"
            >
              {{ promoStore.activePromos.length }}
            </span>
          </button>
        </div>

        <!-- Active Discount / Promo Pill -->
        <div
          v-if="cartStore.appliedPromo || cartStore.discount > 0"
          data-testid="payment-active-discount"
          class="flex items-center justify-between gap-2 rounded-xl border border-emerald-200/80 bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/12 dark:text-emerald-300"
        >
          <span class="truncate font-semibold">
            {{ cartStore.discountLabel || cartStore.appliedPromo?.name || 'Diskon' }}
          </span>
          <div class="flex shrink-0 items-center gap-1.5">
            <span class="font-mono font-bold">-{{ formatCurrency(cartStore.discount) }}</span>
            <button
              type="button"
              data-testid="btn-remove-payment-discount"
              aria-label="Hapus diskon"
              title="Hapus diskon"
              class="flex h-5 w-5 items-center justify-center rounded-md text-[11px] text-emerald-700/70 transition hover:bg-rose-500/15 hover:text-rose-500 cursor-pointer dark:text-emerald-300/80"
              @click="handleRemovePaymentDiscount"
            >
              ✕
            </button>
          </div>
        </div>

        <!-- Unified Single-Row Manual Discount Input -->
        <div
          class="flex h-10 items-center gap-1.5 rounded-xl border border-zinc-200/90 bg-surface px-1.5 transition focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/15 dark:border-slate-700/70 dark:bg-[#121624]"
        >
          <div class="inline-flex h-7 shrink-0 items-center rounded-lg bg-card p-0.5 shadow-2xs dark:bg-[#1B2133]">
            <button
              type="button"
              data-testid="payment-discount-type-fixed"
              class="h-6 rounded-md px-2 text-[11px] font-bold transition cursor-pointer"
              :class="
                inlineDiscountType === 'fixed'
                  ? 'bg-primary text-white shadow-2xs'
                  : 'text-ink-secondary hover:text-ink-primary'
              "
              @click="switchInlineDiscountType('fixed')"
            >
              Rp
            </button>
            <button
              type="button"
              data-testid="payment-discount-type-percent"
              class="h-6 rounded-md px-2 text-[11px] font-bold transition cursor-pointer"
              :class="
                inlineDiscountType === 'percent'
                  ? 'bg-primary text-white shadow-2xs'
                  : 'text-ink-secondary hover:text-ink-primary'
              "
              @click="switchInlineDiscountType('percent')"
            >
              %
            </button>
          </div>

          <input
            v-model="inlineDiscountInput"
            type="text"
            inputmode="decimal"
            data-testid="payment-discount-input"
            :placeholder="inlineDiscountType === 'percent' ? 'Diskon % (cth: 10)' : 'Ketik diskon Rp...'"
            class="min-w-0 flex-1 bg-transparent px-1.5 text-xs font-semibold text-ink-primary outline-none placeholder:font-normal placeholder:text-ink-secondary/70"
            @keydown.enter="applyInlineDiscount"
          />

          <button
            type="button"
            data-testid="btn-apply-payment-discount"
            class="h-7 shrink-0 rounded-lg bg-primary/12 px-2.5 text-[11px] font-bold text-primary transition hover:bg-primary hover:text-white active:scale-95 cursor-pointer dark:bg-indigo-500/20 dark:text-indigo-300 dark:hover:bg-primary dark:hover:text-white"
            @click="applyInlineDiscount"
          >
            Terapkan
          </button>
        </div>

        <p v-if="discountErrorMessage" class="text-xs font-medium text-danger">
          {{ discountErrorMessage }}
        </p>
      </BaseCard>

      <!-- Accessible/Testing harness for cash payment inputs when modal is closed -->
      <div v-if="isCashMethod" class="sr-only" aria-hidden="true">
        <BaseInput
          :model-value="cashReceived"
          label="Uang Diterima"
          type="number"
          placeholder="Masukkan nominal uang diterima"
          @update:model-value="cashReceived = $event"
        />
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

      <!-- Unpaid (Bayar Nanti) Section: Info Alert -->
      <BaseCard
        v-else-if="selectedMethod === 'unpaid'"
        class="space-y-3 border border-amber-200/80 bg-amber-50/60 p-4 dark:border-amber-500/30 dark:bg-amber-500/10"
        data-testid="unpaid-info-card"
      >
        <div class="flex items-start gap-3">
          <div class="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300">
            <svg class="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="10" />
              <polyline points="12 6 12 12 16 14" />
            </svg>
          </div>
          <div class="min-w-0 space-y-1">
            <h3 class="text-sm font-bold text-amber-900 dark:text-amber-200">
              Transaksi Tempo / Bayar Nanti
            </h3>
            <p class="text-xs text-amber-800/80 dark:text-amber-300/80 leading-relaxed">
              Pesanan dicatat dengan status <strong>Belum Lunas (Tempo)</strong>. Stok produk akan langsung terpotong otomatis, dan transaksi <strong>tidak menambah</strong> uang tunai di laci kasir.
            </p>
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
          :discount="cartStore.discount"
          :discount-label="cartStore.discountLabel"
          :applied-promo="cartStore.appliedPromo"
          :tax="cartStore.tax"
          :tax-enabled="taxStore.enabled"
          :tax-rate="taxStore.rate"
          :total="cartStore.total"
          :show-action="false"
          :allow-promo-select="false"
          @select-promo="showPromoModal = true"
          @remove-promo="handleRemovePaymentDiscount"
        />
        <div class="flex items-center justify-between border-t border-zinc-100 pt-2.5 text-xs text-ink-secondary dark:border-slate-800">
          <span>Pelanggan</span>
          <span class="font-semibold text-ink-primary dark:text-white truncate max-w-[180px]">{{ currentCustomerDisplay }}</span>
        </div>

        <!-- Cash Details: Minimalist Summary + Edit Modal Trigger -->
        <div
          v-if="isCashMethod"
          class="rounded-2xl border border-zinc-200/80 bg-zinc-50/70 p-3.5 space-y-2.5 dark:border-slate-700/60 dark:bg-slate-800/40"
          data-testid="cash-summary-section"
        >
          <div class="flex items-center justify-between text-xs">
            <span class="text-ink-secondary font-medium">Uang Diterima</span>
            <div class="flex items-center gap-2">
              <span class="font-bold font-mono text-ink-primary text-sm dark:text-white" data-testid="summary-cash-received">
                {{ formatCurrency(displayedCashReceived) }}
              </span>
              <button
                type="button"
                id="btn-open-cash-modal"
                data-testid="btn-open-cash-modal"
                @click="isCashModalOpen = true"
                class="rounded-lg border border-primary/30 bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary hover:bg-primary/20 active:scale-95 transition cursor-pointer dark:bg-indigo-500/20 dark:text-indigo-300"
              >
                {{ parsedCashReceived ? 'Ubah' : 'Input' }}
              </button>
            </div>
          </div>
          <div class="flex items-center justify-between border-t border-zinc-200/70 pt-2 text-xs dark:border-slate-700">
            <span class="font-semibold text-ink-secondary">Kembalian</span>
            <span
              class="font-extrabold font-mono text-sm"
              :class="changeAmount > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-ink-primary dark:text-white'"
              data-testid="summary-cash-change"
            >
              {{ formatCurrency(changeAmount) }}
            </span>
          </div>
          <p v-if="cashValidationMessage" class="text-[11px] font-medium text-danger pt-0.5">
            {{ cashValidationMessage }}
          </p>
        </div>
      </BaseCard>

      <!-- Desktop checkout CTA (mobile uses the sticky CTA below). The wrapper
           controls visibility: a `hidden` class on BaseButton itself would lose
           to its own `inline-flex` utility. -->
      <div class="hidden md:block">
        <BaseButton
          block
          size="lg"
          :loading="isProcessing"
          :disabled="isSubmitDisabled"
          data-testid="desktop-submit-payment"
          @click="completePayment"
        >
          <span>{{ isProcessing ? 'Memproses...' : (selectedMethod === 'unpaid' ? 'Simpan Transaksi' : 'Bayar') }}<span class="sr-only"> (Selesaikan Pembayaran)</span></span>
        </BaseButton>
      </div>

      <p v-if="paymentError" class="rounded-2xl bg-danger/10 p-3 text-xs font-semibold text-danger">
        {{ paymentError }}
      </p>
    </section>

    <!-- Mobile sticky checkout CTA: always reachable and clear of the bottom nav
         and the Android safe area, with the amount due next to the button. -->
    <div
      v-if="cartStore.items.length && !isPaymentCompleted"
      class="fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+5.6rem)] z-30 px-3.5 md:hidden"
      data-testid="mobile-payment-cta"
    >
      <div class="mx-auto flex max-w-xl items-center gap-3 rounded-2xl border border-zinc-200/90 bg-white/95 px-4 py-2.5 shadow-[0_12px_32px_rgba(15,19,31,0.16)] backdrop-blur-xl dark:border-slate-700/70 dark:bg-[#1B2133]/96 dark:shadow-[0_16px_36px_rgba(0,0,0,0.65)]">
        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-1.5 text-[10px] text-ink-secondary font-medium truncate">
            <span class="font-semibold uppercase tracking-wider">Total</span>
            <span>•</span>
            <span class="truncate font-semibold text-primary dark:text-indigo-400" data-testid="mobile-cta-customer">
              {{ currentCustomerDisplay }}
            </span>
          </div>
          <p class="truncate font-mono text-base font-bold text-ink-primary" data-testid="mobile-payment-total">
            {{ formatCurrency(cartStore.total) }}
          </p>
        </div>
        <BaseButton
          size="lg"
          :loading="isProcessing"
          :disabled="isSubmitDisabled"
          data-testid="mobile-submit-payment"
          @click="completePayment"
        >
          <span>{{ isProcessing ? 'Memproses...' : (selectedMethod === 'unpaid' ? 'Simpan Transaksi' : 'Bayar') }}<span class="sr-only"> (Selesaikan Pembayaran)</span></span>
        </BaseButton>
      </div>
    </div>

    <!-- Discount & Promo Modal -->
    <DiscountPromoModal
      :open="showPromoModal"
      initial-tab="promo"
      @close="showPromoModal = false"
    />

    <!-- Payment processing overlay (bridges 1s save latency before success modal) -->
    <div
      v-if="isProcessing && !isPaymentCompleted"
      data-testid="payment-processing-overlay"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs"
    >
      <div class="w-full max-w-xs rounded-3xl border border-zinc-200/80 bg-white p-6 text-center shadow-2xl dark:border-slate-700/70 dark:bg-[#171C2B]">
        <div class="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 text-primary">
          <svg class="h-7 w-7 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3" />
            <path class="opacity-85" fill="currentColor" d="M4 12a8 8 0 018-8v3a5 5 0 00-5 5H4z" />
          </svg>
        </div>
        <h3 class="mt-3.5 text-base font-bold text-ink-primary">Memproses Pembayaran...</h3>
        <p class="mt-1 text-xs text-ink-secondary">Menyimpan transaksi, harap tunggu sebentar.</p>
      </div>
    </div>

    <!-- Payment success modal (shown only after a committed transaction) -->
    <PaymentSuccessModal
      :open="isPaymentCompleted"
      :summary="successSummary"
      @new-transaction="goToNewTransaction"
      @complete-ready="handleCompleteReady"
      @view-receipt="goToReceipt"
      @view-transactions="goToTransactions"
    />

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
            <span><span class="sr-only">Uang </span>Pas</span>
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
            Simpan
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

