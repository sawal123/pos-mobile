<script setup>
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import BaseBadge from '@/components/base/BaseBadge.vue'
import BaseButton from '@/components/base/BaseButton.vue'
import BaseInput from '@/components/base/BaseInput.vue'
import { useBusinessStore } from '@/stores/businessStore'
import { useCashStore } from '@/stores/cashStore'
import { useProductStore } from '@/stores/productStore'
import { useSyncPushStore } from '@/stores/syncPushStore'
import { useTransactionStore } from '@/stores/transactionStore'
import { formatCurrency, formatDateTime } from '@/utils/formatters'

const route = useRoute()
const router = useRouter()
const businessStore = useBusinessStore()
const cashStore = useCashStore()
const productStore = useProductStore()
const transactionStore = useTransactionStore()
const syncPushStore = useSyncPushStore()

const copied = ref(false)
const feedbackToast = ref('')
const showSettlementModal = ref(false)
const settlementMethod = ref('cash')
const settlementCashReceived = ref('')
const settlementError = ref('')

function showToast(msg) {
  feedbackToast.value = msg
  setTimeout(() => {
    feedbackToast.value = ''
  }, 2500)
}

const isLaundry = computed(() => {
  return businessStore.normalizedType === 'Laundry' || businessStore.type === 'Laundry'
})

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
  if (method === 'transfer') return 'Transfer Bank'
  if (method === 'unpaid') return 'Bayar Nanti (Tempo)'
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

const paymentBadge = computed(() => {
  const pStatus = `${transaction.value?.paymentStatus ?? transaction.value?.payment_status ?? transaction.value?.status ?? ''}`.toLowerCase()
  if (pStatus === 'unpaid' || pStatus === 'pending' || pStatus === 'tempo' || pStatus === 'belum lunas') {
    return { label: 'Belum Lunas', variant: 'warning' }
  }
  if (pStatus === 'refund' || pStatus === 'refunded') {
    return { label: 'Refund', variant: 'purple' }
  }
  if (pStatus === 'paid' || pStatus === 'lunas' || pStatus === 'completed') {
    return { label: 'Lunas', variant: 'success' }
  }
  return { label: transaction.value?.paymentStatus || transaction.value?.status || 'Lunas', variant: 'success' }
})

const orderBadge = computed(() => {
  const os = transaction.value?.orderStatus ?? transaction.value?.order_status
  if (!os) {
    if (transaction.value?.status === 'completed') {
      return { label: 'Selesai', variant: 'success' }
    }
    return null
  }
  const s = String(os).toLowerCase()
  if (s === 'batal' || s === 'cancelled' || s === 'void') {
    return { label: 'Batal', variant: 'danger' }
  }
  if (s === 'proses' || s === 'diproses' || s === 'processing' || s === 'masuk') {
    return { label: 'Proses', variant: 'info' }
  }
  if (s === 'siap' || s === 'siap diambil' || s === 'ready') {
    return { label: 'Siap', variant: 'success' }
  }
  if (s === 'selesai' || s === 'completed') {
    return { label: 'Selesai', variant: 'success' }
  }
  return { label: os, variant: 'info' }
})

const currentOrderStatus = computed(() => {
  const os = transaction.value?.orderStatus
  if (os === 'Batal' || os === 'cancelled') return 'Batal'
  if (os === 'Siap' || os === 'ready' || os === 'Selesai' || os === 'completed') return 'Siap'
  return 'Proses'
})

const isUnpaidTransaction = computed(() => paymentBadge.value.label === 'Belum Lunas')

const canEditItems = computed(() => {
  if (!transaction.value) return false
  const os = currentOrderStatus.value
  return (os === 'Proses' || isUnpaidTransaction.value) && os !== 'Batal'
})

// === MODAL EDIT MENU / ITEM PESANAN ===
const showEditItemsModal = ref(false)
const editableItems = ref([])
const showAddProductPicker = ref(false)
const productSearchQuery = ref('')
const editItemsError = ref('')

const availableProducts = computed(() => {
  const query = productSearchQuery.value.trim().toLowerCase()
  return (productStore.products || [])
    .filter((p) => p.active !== false)
    .filter((p) => {
      if (!query) return true
      return (
        (p.name && p.name.toLowerCase().includes(query)) ||
        (p.category && p.category.toLowerCase().includes(query))
      )
    })
})

function openEditItemsModal() {
  if (!transaction.value) return
  editableItems.value = (transaction.value.items || []).map((it) => {
    const rawProdId = it.productId ?? it.product_id ?? it.serviceId ?? it.id
    const cleanProdId =
      typeof rawProdId === 'string' && rawProdId.includes('::')
        ? rawProdId.split('::')[0]
        : rawProdId
    const qty = Number(it.qty ?? it.quantity) || 1
    const price = Number(it.price ?? it.unitPrice) || 0
    return {
      ...it,
      id: it.id || cleanProdId,
      productId: cleanProdId,
      name: it.name || it.serviceName || 'Item',
      qty,
      price,
      subtotal: it.subtotal != null ? Number(it.subtotal) : price * qty,
      unit: it.unit || it.pricingUnit || 'pcs',
    }
  })
  productSearchQuery.value = ''
  showAddProductPicker.value = false
  editItemsError.value = ''
  showEditItemsModal.value = true
}

function incrementEditItem(index) {
  const it = editableItems.value[index]
  if (!it) return
  it.qty += 1
  it.subtotal = it.qty * it.price
}

function decrementEditItem(index) {
  const it = editableItems.value[index]
  if (!it) return
  if (it.qty > 1) {
    it.qty -= 1
    it.subtotal = it.qty * it.price
  } else {
    removeEditItem(index)
  }
}

function removeEditItem(index) {
  editableItems.value.splice(index, 1)
}

function addProductToEdit(product) {
  const existing = editableItems.value.find(
    (it) => String(it.productId ?? it.id) === String(product.id),
  )
  if (existing) {
    existing.qty += 1
    existing.subtotal = existing.qty * existing.price
  } else {
    const price = Number(product.price ?? product.unitPrice) || 0
    editableItems.value.push({
      id: product.id,
      productId: product.id,
      name: product.name,
      price,
      qty: 1,
      subtotal: price,
      unit: product.unit || product.pricingUnit || 'pcs',
    })
  }
  showAddProductPicker.value = false
  productSearchQuery.value = ''
}

const editItemsSubtotal = computed(() => {
  return editableItems.value.reduce(
    (sum, it) => sum + (Number(it.subtotal) || Number(it.price || 0) * Number(it.qty || 1)),
    0,
  )
})

const editItemsDiscount = computed(() => {
  if (!transaction.value) return 0
  const sub = editItemsSubtotal.value
  let disc = Number(transaction.value.discount || 0)
  if (transaction.value.appliedPromo) {
    const promo = transaction.value.appliedPromo
    const isPercent =
      promo.discount_type === 'percentage' ||
      promo.discountType === 'percentage' ||
      promo.type === 'percentage'
    if (isPercent) {
      const rate = Number(promo.discount_value ?? promo.discountValue ?? promo.value ?? 0)
      disc = Math.round((sub * rate) / 100)
      const maxDisc = Number(promo.max_discount ?? promo.maxDiscount ?? 0)
      if (maxDisc > 0) disc = Math.min(disc, maxDisc)
    }
  }
  return Math.min(disc, sub)
})

const editItemsTax = computed(() => {
  if (!transaction.value) return 0
  const taxable = editItemsSubtotal.value - editItemsDiscount.value
  if (transaction.value.taxRate && Number(transaction.value.taxRate) > 0) {
    return Math.round((taxable * Number(transaction.value.taxRate)) / 100)
  }
  if (
    transaction.value.taxEnabled &&
    Number(transaction.value.tax) > 0 &&
    Number(transaction.value.subtotal) > 0
  ) {
    const effRate = Number(transaction.value.tax) / Number(transaction.value.subtotal)
    return Math.round(taxable * effRate)
  }
  return 0
})

const editItemsTotal = computed(() => {
  return Math.max(0, editItemsSubtotal.value - editItemsDiscount.value + editItemsTax.value)
})

function saveEditedItems() {
  if (!transaction.value) return
  editItemsError.value = ''
  if (editableItems.value.length === 0) {
    editItemsError.value = 'Pesanan harus memiliki minimal 1 item menu.'
    return
  }

  const res = transactionStore.updateTransactionItems({
    transactionId: transaction.value.id,
    items: editableItems.value,
    productStore,
    cashStore,
  })

  if (res.success) {
    showEditItemsModal.value = false
    void syncPushStore.pushIfOnline()
    showToast('✓ Menu pesanan berhasil diperbarui!')
  } else {
    editItemsError.value = res.error || 'Gagal menyimpan perubahan menu.'
  }
}

// === MODAL EDIT STATUS & METODE PEMBAYARAN ===
const showEditPaymentModal = ref(false)
const editOrderStatus = ref('Proses')
const editPaymentStatus = ref('paid')
const editPaymentMethod = ref('cash')
const editCashReceived = ref('')
const editPaymentError = ref('')

function openEditPaymentModal() {
  if (!transaction.value) return
  editOrderStatus.value = currentOrderStatus.value
  const ps = String(
    transaction.value.paymentStatus || transaction.value.status || 'paid',
  ).toLowerCase()
  if (ps === 'unpaid' || ps === 'pending' || ps === 'tempo' || ps === 'belum lunas') {
    editPaymentStatus.value = 'unpaid'
  } else if (ps === 'refund' || ps === 'refunded') {
    editPaymentStatus.value = 'refund'
  } else {
    editPaymentStatus.value = 'paid'
  }

  const pm = String(transaction.value.paymentMethod || 'cash').toLowerCase()
  editPaymentMethod.value = pm === 'unpaid' ? 'cash' : pm
  editCashReceived.value = String(transaction.value.cashReceived ?? transaction.value.total ?? '')
  editPaymentError.value = ''
  showEditPaymentModal.value = true
}

const editCalculatedChange = computed(() => {
  if (editPaymentMethod.value !== 'cash' || !transaction.value) return 0
  const received = Number(editCashReceived.value) || 0
  return Math.max(0, received - Number(transaction.value.total || 0))
})

function saveEditedPayment() {
  if (!transaction.value) return
  editPaymentError.value = ''

  const isCash = editPaymentMethod.value === 'cash'
  const isPaid = editPaymentStatus.value === 'paid'
  const total = Number(transaction.value.total) || 0

  if (isPaid && isCash) {
    const rec = Number(editCashReceived.value)
    if (Number.isNaN(rec) || rec < total) {
      editPaymentError.value = 'Nominal uang diterima kurang dari total pembayaran.'
      return
    }
  }

  const res = transactionStore.updateTransactionPayment({
    transactionId: transaction.value.id,
    orderStatus: editOrderStatus.value,
    paymentStatus: editPaymentStatus.value,
    paymentMethod: editPaymentMethod.value,
    cashReceived: isCash ? Number(editCashReceived.value) : 0,
    changeAmount: isCash ? editCalculatedChange.value : 0,
    cashStore,
    productStore,
  })

  if (res.success) {
    showEditPaymentModal.value = false
    void syncPushStore.pushIfOnline()
    showToast('✓ Status & pembayaran berhasil diperbarui!')
  } else {
    editPaymentError.value = res.error || 'Gagal mengubah pembayaran.'
  }
}

onMounted(() => {
  if (route.query.edit === 'items' && canEditItems.value) {
    openEditItemsModal()
  } else if (route.query.edit === 'payment') {
    openEditPaymentModal()
  }
})

function handleUpdateOrderStatus(status) {
  if (!transaction.value) return
  transactionStore.updateOrderStatus(transaction.value.id, status)
  void syncPushStore.pushIfOnline()
}

function openSettlement() {
  settlementMethod.value = 'cash'
  settlementCashReceived.value = String(transaction.value?.total ?? '')
  settlementError.value = ''
  showSettlementModal.value = true
}

function confirmSettlement() {
  if (!transaction.value) return
  settlementError.value = ''
  const total = Number(transaction.value.total) || 0
  const isCash = settlementMethod.value === 'cash'
  const cashRec = isCash ? Number(settlementCashReceived.value) : 0
  if (isCash && (Number.isNaN(cashRec) || cashRec < total)) {
    settlementError.value = 'Nominal uang diterima kurang dari total tagihan.'
    return
  }
  const change = isCash ? Math.max(0, cashRec - total) : 0
  const result = transactionStore.settleTransactionPayment({
    transactionId: transaction.value.id,
    paymentMethod: settlementMethod.value,
    cashReceived: cashRec,
    changeAmount: change,
  })
  if (result.success) {
    showSettlementModal.value = false
    void syncPushStore.pushIfOnline()
  } else {
    settlementError.value = result.error || 'Pelunasan gagal disimpan.'
  }
}

function statusVariant(status) {
  if (status === 'paid' || status === 'completed') return 'success'
  if (status === 'refunded') return 'purple'
  if (status === 'unpaid' || status === 'pending') return 'warning'
  return 'neutral'
}

function statusLabel(status) {
  if (status === 'paid') return 'Lunas'
  if (status === 'completed') return 'Selesai'
  if (status === 'refunded') return 'Refund'
  if (status === 'unpaid' || status === 'pending') return 'Belum Lunas'
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
    <!-- Floating Toast Notification -->
    <div
      v-if="feedbackToast"
      class="fixed top-16 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 rounded-2xl bg-emerald-600 px-4 py-2.5 text-xs font-bold text-white shadow-xl transition-all"
    >
      <svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
        <polyline points="20 6 9 17 4 12" />
      </svg>
      <span>{{ feedbackToast }}</span>
    </div>

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

          <div class="flex items-center gap-1.5 flex-wrap justify-end">
            <BaseBadge
              v-if="orderBadge"
              :variant="orderBadge.variant"
              class="capitalize shrink-0"
              data-testid="detail-order-status-badge"
            >
              {{ orderBadge.label }}
            </BaseBadge>
            <BaseBadge
              :variant="paymentBadge.variant"
              class="capitalize shrink-0"
              data-testid="detail-payment-status-badge"
            >
              {{ paymentBadge.label }}
            </BaseBadge>
          </div>
        </div>

        <!-- Detail Item List (User Request) -->
        <div class="space-y-3">
          <div class="flex flex-wrap items-center justify-between gap-2 text-xs font-semibold uppercase tracking-wider text-ink-secondary">
            <div class="flex items-center gap-2">
              <span>Rincian Item</span>
              <span class="rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-medium text-zinc-600 dark:bg-slate-800 dark:text-slate-300">
                {{ totalItemCount }} item
              </span>
            </div>
            <div class="flex flex-wrap items-center gap-1.5 shrink-0">
              <button
                v-if="canEditItems"
                type="button"
                class="inline-flex shrink-0 whitespace-nowrap items-center gap-1 rounded-lg border border-sky-300 bg-sky-50 px-2.5 py-1 text-xs font-bold text-sky-700 hover:bg-sky-100 transition cursor-pointer dark:border-sky-800 dark:bg-sky-950/60 dark:text-sky-300"
                data-testid="btn-add-items-in-pos"
                title="Buka di kasir POS untuk tambah menu"
                @click="router.push({ path: '/pos', query: { add_to_order: transaction.id } })"
              >
                <svg class="h-3.5 w-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                  <path d="M12 5v14M5 12h14" />
                </svg>
                <span>Tambah di Kasir</span>
              </button>
              <button
                v-if="canEditItems"
                type="button"
                class="inline-flex shrink-0 whitespace-nowrap items-center gap-1 rounded-lg bg-primary/10 px-2.5 py-1 text-xs font-bold text-primary hover:bg-primary/20 transition cursor-pointer dark:bg-primary/20 dark:text-primary-light"
                data-testid="btn-open-edit-items"
                @click="openEditItemsModal"
              >
                <svg class="h-3.5 w-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
                  <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
                </svg>
                <span>Edit Menu</span>
              </button>
            </div>
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
            v-if="Number(transaction.discount) > 0"
            class="flex items-center justify-between text-emerald-600"
          >
            <span>{{ transaction.appliedPromo?.name || transaction.discountLabel || 'Diskon' }}</span>
            <span class="font-semibold">-{{ formatCurrency(transaction.discount) }}</span>
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
            <div class="flex items-center gap-2">
              <span
                class="font-semibold uppercase tracking-wide text-ink-primary bg-white px-2.5 py-1 rounded-lg border border-zinc-200/60 shadow-2xs"
              >
                {{ paymentMethodLabel }}
              </span>
              <button
                type="button"
                class="inline-flex items-center gap-1 rounded-lg bg-zinc-200/80 px-2.5 py-1 text-xs font-bold text-ink-primary hover:bg-zinc-300 transition cursor-pointer"
                data-testid="btn-open-edit-payment"
                @click="openEditPaymentModal"
              >
                <svg class="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
                  <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
                </svg>
                <span>Ubah</span>
              </button>
            </div>
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

        <!-- Pelunasan Pembayaran (Jika Belum Lunas / Unpaid) -->
        <div
          v-if="isUnpaidTransaction"
          class="rounded-2xl border border-amber-200/80 bg-amber-50/60 p-4 space-y-3 dark:border-amber-500/30 dark:bg-amber-500/10"
          data-testid="unpaid-settlement-section"
        >
          <div class="flex items-center justify-between gap-3">
            <div>
              <p class="text-xs font-bold text-amber-900 dark:text-amber-200">Pesanan Belum Lunas (Tempo)</p>
              <p class="text-[11px] text-amber-800/80 dark:text-amber-300/80">Tagihan sebesar {{ formatCurrency(transaction.total) }}</p>
            </div>
            <BaseButton
              size="sm"
              variant="primary"
              data-testid="btn-open-settle-modal"
              @click="openSettlement"
            >
              Lunasi Pembayaran
            </BaseButton>
          </div>
        </div>

        <!-- Order Laundry Stepper/Status (HANYA jika bisnis bertipe Laundry) -->
        <div
          v-if="isLaundry && transaction.orderStatus"
          class="rounded-2xl border border-zinc-200/70 p-4 space-y-3"
          data-testid="laundry-order-status-section"
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
              @click="transactionStore.updateOrderStatus(transaction.id, status); syncPushStore.pushIfOnline()"
            >
              {{ status }}
            </BaseButton>
          </div>
        </div>

        <!-- Status Order Pesanan (Untuk Retail / Cafe / UMKM) -->
        <div
          v-else-if="!isLaundry"
          class="rounded-2xl border border-zinc-200/70 p-4 space-y-3"
          data-testid="retail-order-status-section"
        >
          <div class="flex items-center justify-between">
            <p class="text-xs font-semibold uppercase tracking-wider text-ink-secondary">
              Status Pesanan
            </p>
            <BaseBadge :variant="orderBadge?.variant || 'info'">
              {{ orderBadge?.label || 'Proses' }}
            </BaseBadge>
          </div>
          <div class="grid grid-cols-3 gap-2">
            <BaseButton
              v-for="status in ['Proses', 'Siap', 'Batal']"
              :key="status"
              size="sm"
              :variant="currentOrderStatus === status ? 'primary' : 'secondary'"
              class="w-full text-xs"
              @click="handleUpdateOrderStatus(status)"
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

    <!-- Settlement Modal -->
    <div
      v-if="showSettlementModal && transaction"
      class="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] backdrop-blur-xs sm:items-center"
      data-testid="settlement-modal"
    >
      <div class="max-h-[90vh] w-full max-w-sm overflow-y-auto rounded-3xl bg-white p-5 shadow-2xl space-y-4">
        <div class="flex items-center justify-between border-b border-zinc-100 pb-3">
          <h3 class="text-base font-bold text-ink-primary">Pelunasan Pembayaran</h3>
          <button
            type="button"
            class="rounded-lg p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600"
            @click="showSettlementModal = false"
          >
            ✕
          </button>
        </div>

        <div class="space-y-1">
          <p class="text-xs text-ink-secondary">Total Tagihan:</p>
          <p class="text-xl font-bold text-primary">{{ formatCurrency(transaction.total) }}</p>
        </div>

        <div class="space-y-2">
          <label class="text-xs font-semibold text-ink-secondary">Pilih Metode Pelunasan</label>
          <div class="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <button
              v-for="m in [
                { id: 'cash', label: 'Tunai' },
                { id: 'qris', label: 'QRIS' },
                { id: 'transfer', label: 'Transfer' },
                { id: 'card', label: 'Kartu' },
              ]"
              :key="m.id"
              type="button"
              class="rounded-xl border p-2.5 text-center text-xs font-bold transition"
              :class="settlementMethod === m.id ? 'border-primary bg-primary/10 text-primary' : 'border-zinc-200 text-zinc-600 hover:bg-zinc-50'"
              @click="settlementMethod = m.id"
            >
              {{ m.label }}
            </button>
          </div>
        </div>

        <div v-if="settlementMethod === 'cash'" class="space-y-2">
          <BaseInput
            v-model="settlementCashReceived"
            label="Uang Diterima"
            type="number"
            placeholder="Nominal uang tunai"
          />
          <div class="flex gap-2">
            <BaseButton
              size="sm"
              variant="secondary"
              class="w-full text-xs"
              @click="settlementCashReceived = String(transaction.total)"
            >
              Uang Pas
            </BaseButton>
          </div>
        </div>

        <p v-if="settlementError" class="text-xs font-medium text-danger">
          {{ settlementError }}
        </p>

        <div class="flex gap-2 pt-2">
          <BaseButton
            variant="secondary"
            size="md"
            class="flex-1"
            @click="showSettlementModal = false"
          >
            Batal
          </BaseButton>
          <BaseButton
            variant="primary"
            size="md"
            class="flex-1"
            data-testid="btn-confirm-settlement"
            @click="confirmSettlement"
          >
            Simpan Lunas
          </BaseButton>
        </div>
      </div>
    </div>

    <!-- Modal Edit Menu / Items Pesanan -->
    <div
      v-if="showEditItemsModal && transaction"
      class="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] backdrop-blur-xs sm:items-center"
      data-testid="edit-items-modal"
    >
      <div class="max-h-[90vh] w-full max-w-md flex flex-col overflow-hidden rounded-3xl bg-white shadow-2xl dark:bg-slate-900">
        <!-- Header -->
        <div class="flex items-center justify-between border-b border-zinc-100 p-4 dark:border-slate-800">
          <div>
            <h3 class="text-base font-bold text-ink-primary dark:text-white">Edit Menu Pesanan</h3>
            <p class="text-xs text-ink-secondary">Tambah atau kurangi menu saat pesanan proses</p>
          </div>
          <button
            type="button"
            class="rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-slate-800 cursor-pointer"
            @click="showEditItemsModal = false"
          >
            ✕
          </button>
        </div>

        <!-- Body (scrollable) -->
        <div class="flex-1 overflow-y-auto p-4 space-y-4">
          <!-- Item List -->
          <div class="space-y-2.5">
            <div
              v-for="(item, idx) in editableItems"
              :key="idx"
              class="flex items-center justify-between gap-2 rounded-2xl border border-zinc-200/80 bg-zinc-50/70 p-3 dark:border-slate-800 dark:bg-slate-800/50"
              data-testid="editable-item-row"
            >
              <div class="min-w-0 flex-1">
                <p class="text-sm font-semibold text-ink-primary truncate dark:text-white">{{ item.name }}</p>
                <p class="text-xs text-ink-secondary">{{ formatCurrency(item.price) }} / {{ item.unit || 'pcs' }}</p>
                <p class="text-xs font-bold text-primary dark:text-indigo-400 mt-0.5">
                  Subtotal: {{ formatCurrency(item.qty * item.price) }}
                </p>
              </div>

              <!-- Quantity Controls -->
              <div class="flex items-center gap-1.5 shrink-0">
                <button
                  type="button"
                  class="flex h-8 w-8 items-center justify-center rounded-xl border border-zinc-300 bg-white text-ink-primary shadow-2xs hover:bg-zinc-100 active:scale-95 transition cursor-pointer dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  :title="item.qty === 1 ? 'Hapus Item' : 'Kurangi Jumlah'"
                  :data-testid="`btn-decrement-${idx}`"
                  @click="decrementEditItem(idx)"
                >
                  <svg v-if="item.qty > 1" class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24">
                    <line x1="5" y1="12" x2="19" y2="12" />
                  </svg>
                  <svg v-else class="h-4 w-4 text-rose-500" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                    <path d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                </button>

                <span class="w-7 text-center font-mono text-sm font-bold text-ink-primary dark:text-white" :data-testid="`qty-val-${idx}`">
                  {{ item.qty }}
                </span>

                <button
                  type="button"
                  class="flex h-8 w-8 items-center justify-center rounded-xl bg-primary text-white shadow-2xs hover:bg-primary-hover active:scale-95 transition cursor-pointer"
                  title="Tambah Jumlah"
                  :data-testid="`btn-increment-${idx}`"
                  @click="incrementEditItem(idx)"
                >
                  <svg class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24">
                    <line x1="12" y1="5" x2="12" y2="19" />
                    <line x1="5" y1="12" x2="19" y2="12" />
                  </svg>
                </button>
              </div>
            </div>

            <div v-if="editableItems.length === 0" class="rounded-2xl border border-dashed border-zinc-200 p-6 text-center text-xs text-ink-secondary dark:border-slate-700">
              Belum ada menu yang dipilih. Klik "Tambah Menu Lain" di bawah.
            </div>
          </div>

          <!-- Add Product Section -->
          <div class="space-y-2 border-t border-zinc-100 pt-3 dark:border-slate-800">
            <button
              v-if="!showAddProductPicker"
              type="button"
              class="w-full inline-flex items-center justify-center gap-1.5 rounded-2xl border-2 border-dashed border-primary/40 bg-primary/5 py-2.5 text-xs font-bold text-primary hover:bg-primary/10 transition cursor-pointer dark:bg-primary/10"
              data-testid="btn-show-add-product"
              @click="showAddProductPicker = true"
            >
              <svg class="h-4 w-4 shrink-0" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              <span>Tambah Menu Lain</span>
            </button>

            <!-- Product Picker Dropdown / Box -->
            <div v-else class="rounded-2xl border border-zinc-200 bg-white p-3 space-y-2 shadow-xs dark:border-slate-700 dark:bg-slate-800">
              <div class="flex items-center justify-between gap-2">
                <span class="text-xs font-bold text-ink-primary dark:text-white">Pilih Menu untuk Ditambahkan</span>
                <button
                  type="button"
                  class="text-xs text-zinc-400 hover:text-zinc-600 cursor-pointer"
                  @click="showAddProductPicker = false"
                >
                  Tutup
                </button>
              </div>

              <input
                v-model="productSearchQuery"
                type="text"
                placeholder="Cari menu produk..."
                class="w-full rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-1.5 text-xs text-ink-primary focus:border-primary focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-white"
              />

              <div class="max-h-44 overflow-y-auto space-y-1 pr-1">
                <div
                  v-for="prod in availableProducts"
                  :key="prod.id"
                  class="flex items-center justify-between rounded-xl p-2 hover:bg-zinc-50 transition cursor-pointer dark:hover:bg-slate-700/60"
                  @click="addProductToEdit(prod)"
                >
                  <div class="min-w-0 pr-2">
                    <p class="text-xs font-semibold text-ink-primary truncate dark:text-white">{{ prod.name }}</p>
                    <p class="text-[11px] text-ink-secondary">{{ formatCurrency(prod.price) }}</p>
                  </div>
                  <button
                    type="button"
                    class="shrink-0 rounded-lg bg-primary/10 px-2 py-1 text-xs font-bold text-primary hover:bg-primary/20 cursor-pointer"
                  >
                    + Tambah
                  </button>
                </div>
                <div v-if="availableProducts.length === 0" class="py-3 text-center text-xs text-zinc-400">
                  Tidak ada menu yang sesuai
                </div>
              </div>
            </div>
          </div>

          <!-- Total Calculation Summary -->
          <div class="rounded-2xl bg-zinc-50 p-3 space-y-1.5 border border-zinc-100 text-xs dark:bg-slate-800/40 dark:border-slate-800">
            <div class="flex items-center justify-between text-ink-secondary">
              <span>Subtotal Baru</span>
              <span class="font-medium text-ink-primary dark:text-white">{{ formatCurrency(editItemsSubtotal) }}</span>
            </div>
            <div v-if="editItemsDiscount > 0" class="flex items-center justify-between text-emerald-600">
              <span>Diskon</span>
              <span class="font-semibold">-{{ formatCurrency(editItemsDiscount) }}</span>
            </div>
            <div v-if="editItemsTax > 0" class="flex items-center justify-between text-ink-secondary">
              <span>{{ taxLabel }}</span>
              <span class="font-medium text-ink-primary dark:text-white">{{ formatCurrency(editItemsTax) }}</span>
            </div>
            <div class="flex items-center justify-between border-t border-zinc-200/80 pt-2 text-sm font-bold text-ink-primary dark:text-white dark:border-slate-700">
              <span>Total Baru</span>
              <span class="text-base text-primary dark:text-indigo-400">{{ formatCurrency(editItemsTotal) }}</span>
            </div>
          </div>

          <p v-if="editItemsError" class="text-xs font-semibold text-rose-500">
            {{ editItemsError }}
          </p>
        </div>

        <!-- Footer -->
        <div class="flex gap-2 border-t border-zinc-100 p-4 dark:border-slate-800">
          <BaseButton
            variant="secondary"
            size="md"
            class="flex-1"
            @click="showEditItemsModal = false"
          >
            Batal
          </BaseButton>
          <BaseButton
            variant="primary"
            size="md"
            class="flex-1"
            data-testid="btn-save-edited-items"
            @click="saveEditedItems"
          >
            Simpan Perubahan
          </BaseButton>
        </div>
      </div>
    </div>

    <!-- Modal Edit Status & Metode Pembayaran -->
    <div
      v-if="showEditPaymentModal && transaction"
      class="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] backdrop-blur-xs sm:items-center"
      data-testid="edit-payment-modal"
    >
      <div class="max-h-[90vh] w-full max-w-sm flex flex-col overflow-hidden rounded-3xl bg-white shadow-2xl dark:bg-slate-900">
        <!-- Header -->
        <div class="flex items-center justify-between border-b border-zinc-100 p-4 dark:border-slate-800">
          <div>
            <h3 class="text-base font-bold text-ink-primary dark:text-white">Edit Status & Pembayaran</h3>
            <p class="font-mono text-xs text-ink-secondary">{{ displayInvoiceNumber }}</p>
          </div>
          <button
            type="button"
            class="rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-slate-800 cursor-pointer"
            @click="showEditPaymentModal = false"
          >
            ✕
          </button>
        </div>

        <!-- Body -->
        <div class="flex-1 overflow-y-auto p-4 space-y-4">
          <!-- 1. Status Pesanan -->
          <div class="space-y-2">
            <label class="text-xs font-bold uppercase tracking-wider text-ink-secondary">Status Pesanan</label>
            <div class="grid grid-cols-3 gap-2">
              <button
                v-for="s in ['Proses', 'Siap', 'Batal']"
                :key="s"
                type="button"
                class="rounded-xl border p-2 text-center text-xs font-bold transition cursor-pointer"
                :class="
                  editOrderStatus === s
                    ? s === 'Proses'
                      ? 'border-sky-500 bg-sky-50 text-sky-700 dark:bg-sky-950/60 dark:text-sky-300'
                      : s === 'Siap'
                        ? 'border-emerald-500 bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300'
                        : 'border-rose-500 bg-rose-50 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300'
                    : 'border-zinc-200 text-zinc-600 hover:bg-zinc-50 dark:border-slate-700 dark:text-slate-300'
                "
                :data-testid="`btn-select-order-status-${s.toLowerCase()}`"
                @click="editOrderStatus = s"
              >
                {{ s }}
              </button>
            </div>
          </div>

          <!-- 2. Status Pembayaran -->
          <div class="space-y-2">
            <label class="text-xs font-bold uppercase tracking-wider text-ink-secondary">Status Pembayaran</label>
            <div class="grid grid-cols-3 gap-2">
              <button
                v-for="ps in [
                  { id: 'paid', label: 'Lunas', color: 'emerald' },
                  { id: 'unpaid', label: 'Belum Lunas', color: 'amber' },
                  { id: 'refund', label: 'Refund', color: 'purple' },
                ]"
                :key="ps.id"
                type="button"
                class="rounded-xl border p-2 text-center text-xs font-bold transition cursor-pointer"
                :class="
                  editPaymentStatus === ps.id
                    ? ps.id === 'paid'
                      ? 'border-emerald-500 bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300'
                      : ps.id === 'unpaid'
                        ? 'border-amber-500 bg-amber-50 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300'
                        : 'border-purple-500 bg-purple-50 text-purple-700 dark:bg-purple-950/60 dark:text-purple-300'
                    : 'border-zinc-200 text-zinc-600 hover:bg-zinc-50 dark:border-slate-700 dark:text-slate-300'
                "
                :data-testid="`btn-select-payment-status-${ps.id}`"
                @click="editPaymentStatus = ps.id"
              >
                {{ ps.label }}
              </button>
            </div>
          </div>

          <!-- 3. Metode Pembayaran -->
          <div v-if="editPaymentStatus !== 'refund'" class="space-y-2">
            <label class="text-xs font-bold uppercase tracking-wider text-ink-secondary">Metode Pembayaran</label>
            <div class="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <button
                v-for="m in [
                  { id: 'cash', label: 'Tunai' },
                  { id: 'qris', label: 'QRIS' },
                  { id: 'transfer', label: 'Transfer' },
                  { id: 'card', label: 'Kartu' },
                ]"
                :key="m.id"
                type="button"
                class="rounded-xl border p-2 text-center text-xs font-bold transition cursor-pointer"
                :class="
                  editPaymentMethod === m.id
                    ? 'border-primary bg-primary/10 text-primary dark:border-indigo-500 dark:bg-indigo-500/20 dark:text-indigo-300'
                    : 'border-zinc-200 text-zinc-600 hover:bg-zinc-50 dark:border-slate-700 dark:text-slate-300'
                "
                :data-testid="`btn-select-payment-method-${m.id}`"
                @click="editPaymentMethod = m.id"
              >
                {{ m.label }}
              </button>
            </div>
          </div>

          <!-- 4. Uang Diterima & Kembalian jika Tunai -->
          <div
            v-if="editPaymentStatus === 'paid' && editPaymentMethod === 'cash'"
            class="space-y-2 rounded-2xl bg-zinc-50 p-3 border border-zinc-100 dark:bg-slate-800/50 dark:border-slate-700"
          >
            <div class="flex items-center justify-between text-xs text-ink-secondary">
              <span>Total Tagihan:</span>
              <span class="font-bold text-primary dark:text-indigo-400">{{ formatCurrency(transaction.total) }}</span>
            </div>

            <BaseInput
              v-model="editCashReceived"
              label="Uang Diterima"
              type="number"
              placeholder="Nominal uang tunai"
            />

            <div class="flex gap-2">
              <BaseButton
                size="sm"
                variant="secondary"
                class="flex-1 text-xs"
                @click="editCashReceived = String(transaction.total)"
              >
                Uang Pas
              </BaseButton>
              <BaseButton
                size="sm"
                variant="secondary"
                class="flex-1 text-xs"
                @click="editCashReceived = '50000'"
              >
                Rp 50.000
              </BaseButton>
              <BaseButton
                size="sm"
                variant="secondary"
                class="flex-1 text-xs"
                @click="editCashReceived = '100000'"
              >
                Rp 100.000
              </BaseButton>
            </div>

            <div class="flex items-center justify-between border-t border-zinc-200/80 pt-2 text-xs">
              <span class="text-ink-secondary font-medium">Kembalian:</span>
              <span class="font-bold text-ink-primary dark:text-white">{{ formatCurrency(editCalculatedChange) }}</span>
            </div>
          </div>

          <p v-if="editPaymentError" class="text-xs font-semibold text-rose-500">
            {{ editPaymentError }}
          </p>
        </div>

        <!-- Footer -->
        <div class="flex gap-2 border-t border-zinc-100 p-4 dark:border-slate-800">
          <BaseButton
            variant="secondary"
            size="md"
            class="flex-1"
            @click="showEditPaymentModal = false"
          >
            Batal
          </BaseButton>
          <BaseButton
            variant="primary"
            size="md"
            class="flex-1"
            data-testid="btn-save-edited-payment"
            @click="saveEditedPayment"
          >
            Simpan Perubahan
          </BaseButton>
        </div>
      </div>
    </div>

    <!-- Not Found State -->
    <div
      v-else-if="!transaction"
      class="rounded-3xl border border-zinc-200/70 bg-white p-8 text-center shadow-soft space-y-3"
    >
      <p class="text-sm text-ink-secondary">Transaksi tidak ditemukan.</p>
      <BaseButton variant="secondary" size="sm" @click="router.push('/transactions')">
        Kembali
      </BaseButton>
    </div>
  </div>
</template>
