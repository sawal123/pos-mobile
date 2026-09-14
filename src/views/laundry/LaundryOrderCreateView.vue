<script setup>
import { computed, reactive, ref, watch } from 'vue'
import { useRouter } from 'vue-router'

import AppIcon from '@/components/base/AppIcon.vue'
import BaseBadge from '@/components/base/BaseBadge.vue'
import BaseButton from '@/components/base/BaseButton.vue'
import BaseCard from '@/components/base/BaseCard.vue'
import BaseInput from '@/components/base/BaseInput.vue'
import { useBusinessStore } from '@/stores/businessStore'
import { useCashStore } from '@/stores/cashStore'
import { useCustomerStore } from '@/stores/customerStore'
import { useProductStore } from '@/stores/productStore'
import { useTransactionStore } from '@/stores/transactionStore'
import { formatCurrency } from '@/utils/formatters'

const router = useRouter()
const businessStore = useBusinessStore()
const cashStore = useCashStore()
const customerStore = useCustomerStore()
const productStore = useProductStore()
const transactionStore = useTransactionStore()

// Customer state
const customerName = ref('')
const customerPhone = ref('')
const orderNote = ref('')

// Service selection state
// Array of { serviceId, name, pricingUnit, quantity, unitPrice, cost, minQuantity, imageData, estimatedDuration }
const orderItems = ref([])

// Estimasi Selesai
const now = new Date()
const defaultDate = new Date(now.getTime() + 48 * 3600 * 1000)
const estimatedDate = ref(defaultDate.toISOString().slice(0, 10))
const estimatedTime = ref('17:00')
const hasManuallyChangedEstimate = ref(false)

// Payment options
const paymentChoice = ref('later') // 'later' | 'now'
const selectedMethod = ref('cash') // 'cash' | 'qris' | 'card'
const cashReceived = ref('')
const isSubmitting = ref(false)
const errorMessage = ref('')
const validationErrors = reactive({
  customerName: '',
  customerPhone: '',
  items: '',
  estimatedCompletedAt: '',
  payment: '',
})

// Active services available
const availableServices = computed(() => {
  return productStore.products.filter((p) => {
    return p.isActive !== false && ((p.kind ?? 'service') === 'service' || p.pricingUnit != null || businessStore.normalizedType === 'Laundry')
  })
})

// Existing customer matched by phone
const matchedCustomer = computed(() => {
  const phone = customerPhone.value.trim()
  if (!phone) return null
  return customerStore.findByPhone(phone)
})

function applyMatchedCustomer() {
  if (matchedCustomer.value) {
    customerName.value = matchedCustomer.value.name
  }
}

// Check if a service is already added
function isServiceAdded(serviceId) {
  return orderItems.value.some((item) => item.serviceId === serviceId)
}

function toggleService(service) {
  const index = orderItems.value.findIndex((item) => item.serviceId === service.id)
  if (index >= 0) {
    orderItems.value.splice(index, 1)
  } else {
    const minQty = Number(service.minQuantity) || 0
    const initialQty = service.pricingUnit === 'kg'
      ? (minQty > 0 ? minQty : 1)
      : (minQty > 0 ? Math.ceil(minQty) : 1)

    orderItems.value.push({
      serviceId: service.id,
      name: service.name,
      pricingUnit: service.pricingUnit || 'kg',
      quantity: initialQty,
      unitPrice: Number(service.price ?? service.unitPrice ?? 0),
      cost: Number(service.cost ?? 0),
      minQuantity: minQty,
      imageData: service.imageData || '',
      estimatedDuration: service.estimatedDuration || '',
    })

    // Suggest estimated completion if not manually changed
    if (!hasManuallyChangedEstimate.value && service.estimatedDuration) {
      updateSuggestedEstimate(service.estimatedDuration)
    }
  }
}

function removeOrderItem(index) {
  orderItems.value.splice(index, 1)
}

function updateSuggestedEstimate(durationStr) {
  const text = `${durationStr}`.toLowerCase()
  let hours = 48
  const matchHari = text.match(/(\d+)\s*(?:hari|day)/)
  const matchJam = text.match(/(\d+)\s*(?:jam|hour)/)

  if (matchHari) {
    hours = Number(matchHari[1]) * 24
  } else if (matchJam) {
    hours = Number(matchJam[1])
  }

  const targetDate = new Date(Date.now() + hours * 3600 * 1000)
  estimatedDate.value = targetDate.toISOString().slice(0, 10)
  const h = String(targetDate.getHours()).padStart(2, '0')
  const m = String(targetDate.getMinutes()).padStart(2, '0')
  estimatedTime.value = `${h}:${m}`
}

function adjustQuantity(item, delta) {
  const step = item.pricingUnit === 'kg' ? 0.5 : 1
  const nextQty = Math.max(0.1, Math.round((Number(item.quantity || 0) + delta * step) * 100) / 100)
  item.quantity = nextQty
}

function onQuantityInput(item, event) {
  const val = event.target.value
  item.quantity = val
}

// Totals calculation
const subtotal = computed(() => {
  return orderItems.value.reduce((sum, item) => {
    const qty = Number(item.quantity) || 0
    const price = Number(item.unitPrice) || 0
    return sum + (qty * price)
  }, 0)
})

const total = computed(() => subtotal.value)

// Cash validation
const parsedCashReceived = computed(() => {
  if (cashReceived.value == null || `${cashReceived.value}`.trim() === '') {
    return null
  }
  const amount = Number(cashReceived.value)
  return Number.isFinite(amount) ? amount : Number.NaN
})

const changeAmount = computed(() => {
  if (paymentChoice.value !== 'now' || selectedMethod.value !== 'cash') {
    return 0
  }
  if (parsedCashReceived.value == null || Number.isNaN(parsedCashReceived.value)) {
    return 0
  }
  return Math.max(0, parsedCashReceived.value - total.value)
})

function fillExactCash() {
  cashReceived.value = String(total.value)
}

function selectQuickCash(amount) {
  cashReceived.value = String(amount)
}

const quickCashAmounts = computed(() => {
  const base = [20000, 50000, 100000, 200000, 500000]
  return base.filter((val) => val > total.value).slice(0, 3)
})

// Item validation check
function validateItemQuantity(item) {
  const qty = Number(item.quantity)
  if (!Number.isFinite(qty) || qty <= 0) {
    return 'Jumlah harus lebih dari 0'
  }

  if (item.pricingUnit === 'pcs') {
    if (!Number.isInteger(qty)) {
      return 'Layanan satuan (pcs) harus berupa angka bulat'
    }
  }

  if (item.minQuantity > 0 && qty < item.minQuantity) {
    return `Minimal order ${item.minQuantity} ${item.pricingUnit}`
  }

  return null
}

const hasItemErrors = computed(() => {
  return orderItems.value.some((item) => Boolean(validateItemQuantity(item)))
})

async function submitOrder() {
  errorMessage.value = ''
  validationErrors.customerName = ''
  validationErrors.customerPhone = ''
  validationErrors.items = ''
  validationErrors.payment = ''

  let hasError = false

  if (!customerName.value.trim()) {
    validationErrors.customerName = 'Nama pelanggan wajib diisi.'
    hasError = true
  }

  if (!customerPhone.value.trim()) {
    validationErrors.customerPhone = 'Nomor HP pelanggan wajib diisi.'
    hasError = true
  }

  if (orderItems.value.length === 0) {
    validationErrors.items = 'Pilih minimal satu layanan laundry.'
    hasError = true
  }

  for (const item of orderItems.value) {
    const itemErr = validateItemQuantity(item)
    if (itemErr) {
      errorMessage.value = `${item.name}: ${itemErr}`
      hasError = true
      break
    }
  }

  if (paymentChoice.value === 'now' && selectedMethod.value === 'cash') {
    if (parsedCashReceived.value == null || Number.isNaN(parsedCashReceived.value)) {
      validationErrors.payment = 'Uang diterima wajib diisi.'
      hasError = true
    } else if (parsedCashReceived.value < total.value) {
      validationErrors.payment = 'Uang diterima kurang dari total pembayaran.'
      hasError = true
    }
  }

  if (hasError) {
    return
  }

  isSubmitting.value = true

  try {
    // 1. Create or resolve customer
    const customerResult = customerStore.findOrCreateCustomer({
      name: customerName.value.trim(),
      phone: customerPhone.value.trim(),
    })

    const customer = customerResult.customer || {
      id: null,
      name: customerName.value.trim(),
      phone: customerPhone.value.trim(),
    }

    // 2. Prepare datetime for estimated completion
    let estimatedCompletedAt = null
    if (estimatedDate.value && estimatedTime.value) {
      estimatedCompletedAt = new Date(`${estimatedDate.value}T${estimatedTime.value}:00`).toISOString()
    } else {
      estimatedCompletedAt = defaultDate.toISOString()
    }

    // 3. Snapshot items
    const snapshotItems = orderItems.value.map((item) => {
      const qty = Number(item.quantity)
      const unitPrice = Number(item.unitPrice)
      const cost = Number(item.cost)
      const itemSubtotal = qty * unitPrice

      return {
        serviceId: item.serviceId,
        serviceName: item.name,
        name: item.name,
        pricingUnit: item.pricingUnit,
        unit: item.pricingUnit,
        quantity: qty,
        qty,
        unitPrice,
        price: unitPrice,
        costSnapshot: cost,
        hppSnapshot: cost,
        subtotal: itemSubtotal,
        imageData: item.imageData || '',
        kind: 'service',
      }
    })

    const isPaid = paymentChoice.value === 'now'
    const paymentMethod = isPaid ? selectedMethod.value : ''

    // 4. Create Order
    const order = transactionStore.createLaundryOrder({
      customerId: customer.id,
      customer: customer.name,
      customerSnapshot: {
        id: customer.id,
        name: customer.name,
        phone: customer.phone,
      },
      businessSnapshot: {
        name: businessStore.name,
        outlet: businessStore.outlet,
        phone: businessStore.phone,
        type: businessStore.type,
      },
      items: snapshotItems,
      subtotal: subtotal.value,
      tax: 0,
      total: total.value,
      orderStatus: 'Masuk',
      paymentStatus: isPaid ? 'paid' : 'unpaid',
      paymentMethod,
      cashReceived: (isPaid && selectedMethod.value === 'cash') ? parsedCashReceived.value : null,
      changeAmount: (isPaid && selectedMethod.value === 'cash') ? changeAmount.value : null,
      estimatedCompletedAt,
      note: orderNote.value.trim(),
    })

    // 5. If paid by CASH right now, record cash in cashStore
    if (isPaid && selectedMethod.value === 'cash') {
      cashStore.recordSalePayment(order)
    }

    await router.push(`/laundry/orders/${order.id}`)
  } catch (err) {
    console.error('Failed to create laundry order', err)
    errorMessage.value = 'Gagal menyimpan order. Coba lagi.'
  } finally {
    isSubmitting.value = false
  }
}
</script>

<template>
  <div class="mx-auto max-w-2xl space-y-5 pb-24">
    <!-- Header -->
    <div class="flex items-center justify-between">
      <div>
        <p class="text-xs font-semibold uppercase tracking-wider text-primary">Laundry POS</p>
        <h1 class="text-2xl font-bold text-ink-primary">Order Laundry Baru</h1>
      </div>
      <BaseButton variant="ghost" size="sm" @click="router.push('/laundry/orders')">
        Batal
      </BaseButton>
    </div>

    <!-- Error Alert if any -->
    <div v-if="errorMessage" class="rounded-2xl border border-red-200 bg-red-50 p-3 text-xs text-red-600">
      {{ errorMessage }}
    </div>

    <!-- 1. Customer Section -->
    <BaseCard class="space-y-4">
      <div class="flex items-center justify-between border-b border-zinc-100 pb-3">
        <h2 class="text-base font-semibold text-ink-primary">1. Data Pelanggan</h2>
        <span class="text-xs text-ink-secondary">* Wajib</span>
      </div>

      <div class="space-y-3">
        <div>
          <BaseInput
            v-model="customerPhone"
            label="Nomor HP Pelanggan *"
            placeholder="Contoh: 08123456789"
            type="tel"
            data-testid="input-customer-phone"
          />
          <p v-if="validationErrors.customerPhone" class="mt-1 text-xs text-red-500" data-testid="error-customer-phone">
            {{ validationErrors.customerPhone }}
          </p>
          <div v-if="matchedCustomer" class="mt-1.5 flex items-center justify-between rounded-xl bg-primary/10 px-3 py-1.5 text-xs text-primary">
            <span>Pelanggan terdaftar: <strong>{{ matchedCustomer.name }}</strong></span>
            <button
              v-if="customerName !== matchedCustomer.name"
              type="button"
              class="font-semibold underline"
              @click="applyMatchedCustomer"
            >
              Gunakan Nama Ini
            </button>
          </div>
        </div>

        <div>
          <BaseInput
            v-model="customerName"
            label="Nama Pelanggan *"
            placeholder="Nama lengkap pelanggan"
            data-testid="input-customer-name"
          />
          <p v-if="validationErrors.customerName" class="mt-1 text-xs text-red-500" data-testid="error-customer-name">
            {{ validationErrors.customerName }}
          </p>
        </div>

        <div>
          <label class="block text-xs font-medium text-ink-secondary mb-1">Catatan Order (Opsional)</label>
          <textarea
            v-model="orderNote"
            rows="2"
            placeholder="Catatan khusus pelanggan, instruksi cucian, pewangi..."
            data-testid="input-order-note"
            class="w-full rounded-2xl border border-zinc-200 bg-white p-3 text-sm text-ink-primary placeholder:text-zinc-400 focus:border-primary focus:outline-none focus:ring-4 focus:ring-primary/10"
          />
        </div>
      </div>
    </BaseCard>

    <!-- 2. Services Selection Section -->
    <BaseCard class="space-y-4">
      <div class="flex items-center justify-between border-b border-zinc-100 pb-3">
        <h2 class="text-base font-semibold text-ink-primary">2. Pilih Layanan</h2>
        <span class="text-xs text-ink-secondary">{{ availableServices.length }} layanan aktif</span>
      </div>

      <div v-if="validationErrors.items" class="text-xs text-red-500">
        {{ validationErrors.items }}
      </div>

      <!-- Services 2-column grid -->
      <div v-if="availableServices.length > 0" class="grid grid-cols-2 gap-2.5 sm:gap-3" data-testid="service-grid">
        <div
          v-for="service in availableServices"
          :key="service.id"
          :data-testid="`service-card-${service.id}`"
          class="flex cursor-pointer flex-col justify-between rounded-2xl border p-3 transition"
          :class="isServiceAdded(service.id)
            ? 'border-primary bg-primary/5 shadow-soft ring-2 ring-primary/20'
            : 'border-zinc-200 bg-white hover:border-zinc-300'"
          @click="toggleService(service)"
        >
          <div class="space-y-1">
            <div v-if="service.imageData" class="mb-2 h-20 w-full overflow-hidden rounded-xl bg-zinc-100">
              <img :src="service.imageData" :alt="service.name" class="h-full w-full object-cover" />
            </div>
            <div class="flex items-start justify-between gap-1">
              <h3 class="text-sm font-semibold text-ink-primary leading-tight">{{ service.name }}</h3>
              <span
                class="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs"
                :class="isServiceAdded(service.id) ? 'bg-primary text-white' : 'border border-zinc-300 text-zinc-300'"
              >
                ✓
              </span>
            </div>
          </div>

          <div class="mt-3 flex items-baseline justify-between pt-1 border-t border-zinc-100 text-xs">
            <span class="font-bold text-primary">{{ formatCurrency(service.price) }}</span>
            <span class="font-medium text-ink-secondary">/ {{ service.pricingUnit || 'kg' }}</span>
          </div>
        </div>
      </div>

      <div v-else class="py-6 text-center text-xs text-ink-secondary">
        Belum ada layanan laundry. Silakan tambahkan layanan di menu Layanan.
      </div>
    </BaseCard>

    <!-- 3. Selected Items & Quantity Configuration -->
    <BaseCard v-if="orderItems.length > 0" class="space-y-4" data-testid="selected-services-card">
      <div class="flex items-center justify-between border-b border-zinc-100 pb-3">
        <h2 class="text-base font-semibold text-ink-primary">3. Atur Jumlah Cucian</h2>
        <span class="text-xs font-semibold text-primary">{{ orderItems.length }} layanan dipilih</span>
      </div>

      <div class="space-y-3">
        <div
          v-for="(item, index) in orderItems"
          :key="item.serviceId"
          :data-testid="`selected-item-${item.serviceId}`"
          class="space-y-2 rounded-2xl border border-zinc-200 bg-surface p-3"
        >
          <div class="flex items-start justify-between gap-2">
            <div class="min-w-0">
              <h3 class="text-sm font-semibold text-ink-primary">{{ item.name }}</h3>
              <p class="text-xs text-ink-secondary">
                {{ formatCurrency(item.unitPrice) }} / {{ item.pricingUnit }}
                <span v-if="item.minQuantity > 0" class="ml-1 text-primary">
                  (Min. {{ item.minQuantity }} {{ item.pricingUnit }})
                </span>
              </p>
            </div>
            <button
              type="button"
              class="text-xs text-red-500 hover:text-red-700"
              @click="removeOrderItem(index)"
            >
              Hapus
            </button>
          </div>

          <!-- Quantity Input with Android-friendly controls -->
          <div class="flex items-center justify-between gap-3 pt-1">
            <div class="flex items-center gap-1.5">
              <button
                type="button"
                class="flex h-9 w-9 items-center justify-center rounded-xl border border-zinc-200 bg-white text-base font-bold text-ink-primary shadow-soft active:bg-zinc-100"
                @click="adjustQuantity(item, -1)"
              >
                -
              </button>

              <input
                :value="item.quantity"
                :type="'number'"
                :step="item.pricingUnit === 'kg' ? '0.1' : '1'"
                :min="item.pricingUnit === 'kg' ? '0.1' : '1'"
                data-testid="input-item-qty"
                class="h-9 w-20 rounded-xl border border-zinc-200 bg-white text-center text-sm font-semibold text-ink-primary focus:border-primary focus:outline-none"
                @input="onQuantityInput(item, $event)"
              />

              <button
                type="button"
                class="flex h-9 w-9 items-center justify-center rounded-xl border border-zinc-200 bg-white text-base font-bold text-ink-primary shadow-soft active:bg-zinc-100"
                @click="adjustQuantity(item, 1)"
              >
                +
              </button>
              <span class="text-xs font-semibold text-ink-secondary ml-1">{{ item.pricingUnit }}</span>
            </div>

            <!-- Line subtotal -->
            <div class="text-right">
              <span class="text-sm font-bold text-ink-primary">
                {{ formatCurrency((Number(item.quantity) || 0) * (Number(item.unitPrice) || 0)) }}
              </span>
            </div>
          </div>

          <!-- Item validation error if any -->
          <div v-if="validateItemQuantity(item)" class="text-xs text-red-500">
            {{ validateItemQuantity(item) }}
          </div>
        </div>
      </div>
    </BaseCard>

    <!-- 4. Estimasi Selesai Section -->
    <BaseCard class="space-y-4">
      <div class="flex items-center justify-between border-b border-zinc-100 pb-3">
        <h2 class="text-base font-semibold text-ink-primary">4. Estimasi Selesai</h2>
        <span class="text-xs text-ink-secondary">Pilih tanggal & jam</span>
      </div>

      <div class="grid grid-cols-2 gap-3">
        <div>
          <label class="block text-xs font-medium text-ink-secondary mb-1">Tanggal Selesai *</label>
          <input
            v-model="estimatedDate"
            type="date"
            data-testid="input-estimated-date"
            class="w-full rounded-2xl border border-zinc-200 bg-white p-2.5 text-sm text-ink-primary focus:border-primary focus:outline-none"
            @change="hasManuallyChangedEstimate = true"
          />
        </div>
        <div>
          <label class="block text-xs font-medium text-ink-secondary mb-1">Jam Selesai *</label>
          <input
            v-model="estimatedTime"
            type="time"
            data-testid="input-estimated-time"
            class="w-full rounded-2xl border border-zinc-200 bg-white p-2.5 text-sm text-ink-primary focus:border-primary focus:outline-none"
            @change="hasManuallyChangedEstimate = true"
          />
        </div>
      </div>
    </BaseCard>

    <!-- 5. Pembayaran Section -->
    <BaseCard class="space-y-4">
      <div class="flex items-center justify-between border-b border-zinc-100 pb-3">
        <h2 class="text-base font-semibold text-ink-primary">5. Status Pembayaran</h2>
        <BaseBadge :variant="paymentChoice === 'now' ? 'success' : 'warning'">
          {{ paymentChoice === 'now' ? 'Bayar Sekarang' : 'Bayar Nanti' }}
        </BaseBadge>
      </div>

      <!-- Toggle Bayar Nanti / Bayar Sekarang -->
      <div class="grid grid-cols-2 gap-2 rounded-2xl bg-zinc-100 p-1">
        <button
          type="button"
          data-testid="payment-choice-later"
          class="rounded-xl py-2.5 text-xs font-semibold transition"
          :class="paymentChoice === 'later' ? 'bg-white text-ink-primary shadow-soft' : 'text-ink-secondary hover:text-ink-primary'"
          @click="paymentChoice = 'later'"
        >
          Bayar Nanti
        </button>
        <button
          type="button"
          data-testid="payment-choice-now"
          class="rounded-xl py-2.5 text-xs font-semibold transition"
          :class="paymentChoice === 'now' ? 'bg-white text-primary shadow-soft' : 'text-ink-secondary hover:text-ink-primary'"
          @click="paymentChoice = 'now'"
        >
          Bayar Sekarang
        </button>
      </div>

      <!-- Payment Method Selection when 'Bayar Sekarang' -->
      <div v-if="paymentChoice === 'now'" class="space-y-3 pt-2" data-testid="payment-now-section">
        <div class="grid grid-cols-3 gap-2">
          <button
            type="button"
            data-testid="method-cash"
            class="rounded-2xl border p-3 text-center transition"
            :class="selectedMethod === 'cash'
              ? 'border-primary bg-primary/10 text-primary font-bold'
              : 'border-zinc-200 bg-white text-ink-secondary'"
            @click="selectedMethod = 'cash'"
          >
            Cash
          </button>
          <button
            type="button"
            data-testid="method-qris"
            class="rounded-2xl border p-3 text-center transition"
            :class="selectedMethod === 'qris'
              ? 'border-primary bg-primary/10 text-primary font-bold'
              : 'border-zinc-200 bg-white text-ink-secondary'"
            @click="selectedMethod = 'qris'"
          >
            QRIS
          </button>
          <button
            type="button"
            data-testid="method-card"
            class="rounded-2xl border p-3 text-center transition"
            :class="selectedMethod === 'card'
              ? 'border-primary bg-primary/10 text-primary font-bold'
              : 'border-zinc-200 bg-white text-ink-secondary'"
            @click="selectedMethod = 'card'"
          >
            Card
          </button>
        </div>

        <!-- Cash details if cash -->
        <div v-if="selectedMethod === 'cash'" class="space-y-3 rounded-2xl bg-surface p-3">
          <BaseInput
            v-model="cashReceived"
            label="Uang Diterima *"
            placeholder="Nominal uang tunai"
            type="number"
            data-testid="input-cash-received"
            :error="validationErrors.payment"
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
              @click="selectQuickCash(amt)"
            >
              {{ formatCurrency(amt) }}
            </button>
          </div>

          <div class="flex items-center justify-between border-t border-zinc-200 pt-2 text-sm">
            <span class="text-ink-secondary">Kembalian:</span>
            <span class="font-bold text-success" data-testid="change-amount">
              {{ formatCurrency(changeAmount) }}
            </span>
          </div>
        </div>
      </div>
    </BaseCard>

    <!-- Sticky Bottom Bar -->
    <div class="fixed inset-x-0 bottom-0 z-20 border-t border-zinc-200/80 bg-white/95 px-4 py-3 shadow-[0_-8px_25px_rgba(0,0,0,0.06)] backdrop-blur-md">
      <div class="mx-auto flex max-w-2xl items-center justify-between gap-4">
        <div>
          <p class="text-[11px] uppercase tracking-wider text-ink-secondary">Total Biaya</p>
          <p class="text-xl font-bold text-ink-primary" data-testid="order-total-preview">
            {{ formatCurrency(total) }}
          </p>
        </div>

        <BaseButton
          :disabled="isSubmitting || hasItemErrors"
          data-testid="btn-submit-order"
          class="px-6 py-3 font-semibold"
          @click="submitOrder"
        >
          {{ isSubmitting ? 'Menyimpan...' : 'Simpan Order' }}
        </BaseButton>
      </div>
    </div>
  </div>
</template>
