<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useRoute, useRouter } from 'vue-router'

import ProductScannerSheet from '@/components/scanner/ProductScannerSheet.vue'
import { useRetailProductCodes } from '@/composables/useRetailProductCodes'

import AppIcon from '@/components/base/AppIcon.vue'
import BaseCard from '@/components/base/BaseCard.vue'
import BaseInput from '@/components/base/BaseInput.vue'
import ActiveOrdersSheet from '@/components/pos/ActiveOrdersSheet.vue'
import CartItem from '@/components/pos/CartItem.vue'
import CartCustomerInput from '@/components/pos/CartCustomerInput.vue'
import CartSummary from '@/components/pos/CartSummary.vue'
import CategoryPill from '@/components/pos/CategoryPill.vue'
import DiscountPromoModal from '@/components/pos/DiscountPromoModal.vue'
import MobileCartSheet from '@/components/pos/MobileCartSheet.vue'
import ProductCard from '@/components/pos/ProductCard.vue'
import ProductVariantSheet from '@/components/pos/ProductVariantSheet.vue'
import { useCartStore } from '@/stores/cartStore'
import { useProductStore } from '@/stores/productStore'
import { useTaxStore } from '@/stores/taxStore'
import { useCloudSessionStore } from '@/stores/cloudSessionStore'
import { useSyncPullStore } from '@/stores/syncPullStore'
import { useSyncPushStore } from '@/stores/syncPushStore'
import { useTransactionStore } from '@/stores/transactionStore'
import { useVariantStore } from '@/stores/variantStore'

const productStore = useProductStore()
const cartStore = useCartStore()
const taxStore = useTaxStore()
const cloudStore = useCloudSessionStore()
const syncPullStore = useSyncPullStore()
const syncPushStore = useSyncPushStore()
const transactionStore = useTransactionStore()
const variantStore = useVariantStore()
const route = useRoute()
const router = useRouter()
const { isRetail, scanContext } = useRetailProductCodes()
const showScanner = ref(false)
const showActiveOrdersSheet = ref(false)
const scanFeedback = ref('')
const scanError = ref(false)
const lastScannedProduct = ref(null)
let scanVariantContext = null
let globalScanBuffer = ''
let globalScanLastTime = 0
let globalScanTimer = null
let lastAutoSubmittedAt = 0
let searchLastInputTime = 0
let searchRapidStreak = 0
let searchAutoScanTimer = null

function isSameDay(date1, date2) {
  const d1 = new Date(date1)
  const d2 = new Date(date2)
  return (
    d1.getFullYear() === d2.getFullYear() &&
    d1.getMonth() === d2.getMonth() &&
    d1.getDate() === d2.getDate()
  )
}

const activeOrdersCount = computed(() => {
  const today = new Date()
  return transactionStore.items.filter((item) => {
    if (item.orderStatus === 'Batal') return false
    const isToday = item.createdAt ? isSameDay(item.createdAt, today) : true
    const isPending =
      item.orderStatus === 'Proses' ||
      item.paymentStatus === 'unpaid' ||
      item.status === 'unpaid'
    return isToday && isPending
  }).length
})

function getProductCartQty(productId) {
  if (!productId) return 0
  return items.value
    .filter((item) => String(item.productId ?? item.id) === String(productId))
    .reduce((sum, item) => sum + (Number(item.qty) || 0), 0)
}

const lastScannedItemQty = computed(() => {
  if (!lastScannedProduct.value?.id) return 0
  return getProductCartQty(lastScannedProduct.value.id)
})

function handleScanned(code, { fromCamera = true } = {}) {
  if (!isRetail.value) return
  if (fromCamera && !showScanner.value) return
  const result = productStore.resolveScanCode(code)
  scanError.value = !result.success
  if (!result.success) {
    lastScannedProduct.value = null
    scanFeedback.value = result.error
    return
  }
  const outcome = handleProductAdd(result.product)
  if (outcome === 'variant') {
    showScanner.value = false
    scanVariantContext = scanContext.value
    lastScannedProduct.value = result.product
    scanFeedback.value = 'Pilih varian untuk menambahkan produk.'
  } else {
    lastScannedProduct.value = result.product
    const currentItemQty = getProductCartQty(result.product.id)
    scanFeedback.value = `✓ ${result.product.name} ditambahkan ke keranjang (Qty: ${currentItemQty}).`
  }
}

function adjustLastScannedProductQty(delta) {
  const product = lastScannedProduct.value
  if (!product) return
  if (delta > 0) {
    cartStore.addItem(product)
  } else {
    const existing = items.value.find(
      (item) => String(item.productId ?? item.id) === String(product.id),
    )
    if (existing) {
      cartStore.decreaseQty(existing.id)
    }
  }
  const updatedQty = getProductCartQty(product.id)
  if (updatedQty <= 0) {
    scanFeedback.value = ''
    lastScannedProduct.value = null
  } else {
    scanFeedback.value = `✓ ${product.name} di keranjang (Qty: ${updatedQty}).`
  }
}

function handleSearchUpdate(value) {
  productStore.setSearchQuery(value)
  if (!isRetail.value) return
  const now = Date.now()
  if (now - searchLastInputTime < 85) {
    searchRapidStreak += 1
  } else {
    searchRapidStreak = 1
  }
  searchLastInputTime = now

  if (searchAutoScanTimer) clearTimeout(searchAutoScanTimer)
  const trimmed = String(value || '').trim()
  if (trimmed.length >= 4 && searchRapidStreak >= 4) {
    searchAutoScanTimer = setTimeout(() => {
      const check = productStore.resolveScanCode(trimmed)
      if (check.success) {
        handleScanned(trimmed, { fromCamera: false })
        productStore.setSearchQuery('')
        searchRapidStreak = 0
      }
    }, 180)
  }
}

function handleSearchScanSubmit() {
  if (!isRetail.value) return
  const code = String(searchQuery.value || '').trim()
  if (!code) return
  if (searchAutoScanTimer) clearTimeout(searchAutoScanTimer)
  handleScanned(code, { fromCamera: false })
  productStore.setSearchQuery('')
  searchRapidStreak = 0
}

function handleGlobalHardwareScanKeydown(event) {
  if (!isRetail.value || showVariantSheet.value || showPromoModal.value) return
  const activeEl = document.activeElement
  const tag = activeEl ? activeEl.tagName.toLowerCase() : ''
  const inputType = tag === 'input' && activeEl?.type ? activeEl.type.toLowerCase() : ''
  const isTextInput =
    tag === 'input' &&
    !['range', 'checkbox', 'radio', 'button', 'submit', 'file'].includes(inputType)
  const isEditing =
    isTextInput || tag === 'textarea' || tag === 'select' || Boolean(activeEl?.isContentEditable)
  if (isEditing || event.ctrlKey || event.altKey || event.metaKey) return

  const now = Date.now()
  if (now - globalScanLastTime > 480) {
    globalScanBuffer = ''
  }

  if (event.key === 'Enter' || event.key === 'Tab') {
    const code = globalScanBuffer.trim()
    globalScanBuffer = ''
    if (globalScanTimer) clearTimeout(globalScanTimer)
    if (code.length >= 2) {
      event.preventDefault()
      event.stopPropagation()
      lastAutoSubmittedAt = now
      handleScanned(code, { fromCamera: false })
    } else if (now - lastAutoSubmittedAt < 350) {
      event.preventDefault()
      event.stopPropagation()
    }
    return
  }

  if (event.key && event.key.length === 1) {
    globalScanBuffer += event.key
    globalScanLastTime = now
    if (globalScanTimer) clearTimeout(globalScanTimer)
    const candidate = globalScanBuffer.trim()
    globalScanTimer = setTimeout(() => {
      if (candidate.length >= 4 && productStore.resolveScanCode(candidate).success) {
        lastAutoSubmittedAt = Date.now()
        handleScanned(candidate, { fromCamera: false })
        globalScanBuffer = ''
      } else if (Date.now() - globalScanLastTime >= 480) {
        globalScanBuffer = ''
      }
    }, 260)
  }
}

function closeVariantSheet() {
  showVariantSheet.value = false
  selectedVariantProduct.value = null
  if (scanVariantContext !== null) scanFeedback.value = ''
  scanVariantContext = null
}

watch(
  scanContext,
  () => {
    showScanner.value = false
    scanFeedback.value = ''
    closeVariantSheet()
  },
  { flush: 'sync' },
)

const { filterCategories, filteredProducts, searchQuery, selectedCategory } =
  storeToRefs(productStore)
const { items, subtotal, tax, total } = storeToRefs(cartStore)

const totalQty = computed(() => {
  const sum = items.value.reduce((acc, item) => acc + (Number(item.qty) || 0), 0)
  return Number.isInteger(sum) ? sum : Number(sum.toFixed(1))
})

const showCartSheet = ref(false)
const showPromoModal = ref(false)
const showVariantSheet = ref(false)
const selectedVariantProduct = ref(null)

const activeVariantGroupsForProduct = computed(() => {
  if (!selectedVariantProduct.value) return []
  return variantStore.getProductVariantGroups(selectedVariantProduct.value)
})

function handleProductAdd(product) {
  const groups = variantStore.getProductVariantGroups(product)
  if (groups.length > 0) {
    selectedVariantProduct.value = product
    showVariantSheet.value = true
    return 'variant'
  }
  cartStore.addItem(product)
  return 'added'
}

function handleVariantConfirm({ product, selectedOptions }) {
  if (scanVariantContext !== null && scanVariantContext !== scanContext.value) {
    closeVariantSheet()
    return
  }
  cartStore.addItem(product, selectedOptions)
  if (scanVariantContext !== null) scanFeedback.value = `${product.name} ditambahkan ke keranjang.`
  scanVariantContext = null
  showVariantSheet.value = false
  selectedVariantProduct.value = null
}

const orderFeedbackMsg = ref('')

function handleLoadOrderForAdding(order) {
  if (!order) return
  cartStore.loadOrderForEditing(order)
  showActiveOrdersSheet.value = false
  orderFeedbackMsg.value = `✓ Memuat pesanan ${order.invoiceNumber || order.id}. Silakan tambah item baru dari katalog!`
  setTimeout(() => {
    orderFeedbackMsg.value = ''
  }, 3000)
}

function handleCancelEditOrder() {
  cartStore.cancelEditingOrder()
}

async function handleSaveOrderAddition() {
  const transactionId = cartStore.editingTransactionId
  if (!transactionId) return

  const result = transactionStore.updateTransactionItems({
    transactionId,
    items: cartStore.items,
    productStore,
    discount: cartStore.discount,
    appliedPromo: cartStore.appliedPromo,
    tax: cartStore.tax,
    total: cartStore.total,
    tableNumber: cartStore.tableNumber,
    customerName: cartStore.customerName,
  })

  if (result.success) {
    const invoice = cartStore.editingTransactionInvoice
    cartStore.clearCart()
    showCartSheet.value = false
    orderFeedbackMsg.value = `✓ Berhasil menambahkan item ke pesanan ${invoice}!`

    if (syncPushStore?.pushIfOnline) {
      try {
        await syncPushStore.pushIfOnline()
      } catch {
        // Safe offline fallback
      }
    }

    setTimeout(() => {
      orderFeedbackMsg.value = ''
    }, 3500)
  } else {
    orderFeedbackMsg.value = result.error || 'Gagal memperbarui pesanan.'
  }
}

onMounted(async () => {
  document.addEventListener('keydown', handleGlobalHardwareScanKeydown)
  if (cloudStore.isLinked && cloudStore.isOperationalCloudAccess) {
    await syncPullStore.ensureCatalogLoaded()
  }
  if (route?.query?.open_queue === '1' || route?.query?.open_queue === 'true') {
    showActiveOrdersSheet.value = true
  }
  if (route?.query?.add_to_order || route?.query?.order_id) {
    const targetId = route.query.add_to_order || route.query.order_id
    const targetOrder = transactionStore.items.find((it) => String(it.id) === String(targetId))
    if (targetOrder) {
      handleLoadOrderForAdding(targetOrder)
    }
  }
})

watch(
  () => route?.query?.open_queue,
  (val) => {
    if (val === '1' || val === 'true') {
      showActiveOrdersSheet.value = true
    }
  },
)

watch(
  () => route?.query?.add_to_order,
  (val) => {
    if (val) {
      const targetOrder = transactionStore.items.find((it) => String(it.id) === String(val))
      if (targetOrder) {
        handleLoadOrderForAdding(targetOrder)
      }
    }
  },
)

onBeforeUnmount(() => {
  document.removeEventListener('keydown', handleGlobalHardwareScanKeydown)
  if (globalScanTimer) clearTimeout(globalScanTimer)
  if (searchAutoScanTimer) clearTimeout(searchAutoScanTimer)
})

function openCartSheet() {
  if (!items.value.length) {
    return
  }

  showCartSheet.value = true
}

function closeCartSheet() {
  showCartSheet.value = false
}

function openPromoModal() {
  showPromoModal.value = true
}

function closePromoModal() {
  showPromoModal.value = false
}

async function handleCheckout(options = {}) {
  if (!items.value.length) {
    return
  }

  if (cartStore.isEditingOrder) {
    await handleSaveOrderAddition()
    return
  }

  showCartSheet.value = false
  if (options.payLater || options.method === 'unpaid') {
    router.push({ path: '/payment', query: { method: 'unpaid' } })
  } else {
    router.push('/payment')
  }
}
</script>

<template>
  <div class="w-full min-w-0 space-y-4 md:space-y-5" :class="items.length ? 'pb-20 md:pb-0' : ''">
    <!-- Active Editing Order Banner -->
    <div
      v-if="cartStore.isEditingOrder"
      data-testid="editing-order-banner"
      class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-2xl border-2 border-sky-400 bg-sky-50/90 p-3.5 shadow-sm dark:border-sky-700 dark:bg-sky-950/70"
    >
      <div class="flex items-center gap-3 min-w-0">
        <div class="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-sky-500 text-white shadow-2xs">
          <svg class="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 5v14M5 12h14" />
          </svg>
        </div>
        <div class="min-w-0">
          <div class="flex flex-wrap items-center gap-2">
            <span class="text-xs font-bold uppercase tracking-wider text-sky-800 dark:text-sky-300">
              Mode Tambah Pesanan
            </span>
            <span class="rounded-md bg-white px-2 py-0.5 font-mono text-xs font-extrabold text-sky-900 border border-sky-200 dark:bg-slate-900 dark:text-sky-200 dark:border-sky-800">
              {{ cartStore.editingTransactionInvoice }}
            </span>
            <span
              v-if="cartStore.tableNumber"
              class="rounded-md bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-900 border border-amber-200 dark:bg-amber-950 dark:text-amber-200 dark:border-amber-800"
            >
              Meja {{ cartStore.tableNumber }}
            </span>
            <span
              v-if="cartStore.customerName"
              class="text-xs text-sky-900 dark:text-sky-200 font-medium"
            >
              ({{ cartStore.customerName }})
            </span>
          </div>
          <p class="text-xs text-sky-700 dark:text-sky-300 mt-0.5">
            Pilih menu baru dari katalog di bawah. Klik tombol "Simpan Tambahan Pesanan" untuk menyelesaikan.
          </p>
        </div>
      </div>

      <div class="flex items-center gap-2 shrink-0 self-end sm:self-auto">
        <button
          type="button"
          data-testid="btn-cancel-edit-order"
          class="rounded-xl border border-zinc-300 bg-white px-3 py-1.5 text-xs font-bold text-ink-primary shadow-2xs hover:bg-zinc-50 active:scale-95 transition cursor-pointer dark:border-slate-700 dark:bg-slate-900 dark:text-white"
          @click="handleCancelEditOrder"
        >
          Batal Tambah
        </button>
        <button
          type="button"
          data-testid="btn-save-order-addition"
          class="rounded-xl bg-primary px-3.5 py-1.5 text-xs font-bold text-white shadow-2xs hover:bg-primary-light active:scale-95 transition cursor-pointer"
          @click="handleSaveOrderAddition"
        >
          Simpan Tambahan
        </button>
      </div>
    </div>

    <!-- Feedback Message Notification -->
    <div
      v-if="orderFeedbackMsg"
      class="flex items-center gap-2 rounded-2xl bg-emerald-50 border border-emerald-200 px-4 py-2.5 text-xs font-bold text-emerald-800 transition dark:bg-emerald-950/60 dark:text-emerald-200 dark:border-emerald-800"
      data-testid="pos-order-feedback"
    >
      <span>{{ orderFeedbackMsg }}</span>
    </div>
    <div
      class="grid gap-5 md:grid-cols-[1fr_340px] lg:grid-cols-[1fr_380px] xl:grid-cols-[1fr_420px] items-start"
    >
      <!-- Left Column: Product Catalog -->
      <section class="min-w-0 space-y-3 sm:space-y-4">
        <div class="space-y-3">
          <div class="flex items-start gap-2">
            <BaseInput
              class="min-w-0 flex-1"
              :model-value="searchQuery"
              :placeholder="
                isRetail ? 'Cari produk atau langsung scan barcode/SKU...' : 'Cari produk...'
              "
              aria-label="Cari produk"
              @update:model-value="handleSearchUpdate"
              @keydown.enter.prevent="handleSearchScanSubmit"
            />

            <!-- Active Orders Quick Access Pill Button -->
            <button
              v-if="activeOrdersCount > 0"
              type="button"
              data-testid="pos-active-orders-button"
              title="Lihat antrean pesanan aktif"
              class="relative flex h-12 shrink-0 items-center gap-2 rounded-2xl border border-amber-300 bg-amber-50 px-3.5 text-xs font-bold text-amber-900 shadow-2xs transition hover:bg-amber-100 active:scale-95 cursor-pointer dark:border-amber-700/60 dark:bg-amber-950/40 dark:text-amber-200"
              @click="showActiveOrdersSheet = true"
            >
              <span class="relative flex h-2 w-2">
                <span class="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400 opacity-75"></span>
                <span class="relative inline-flex h-2 w-2 rounded-full bg-amber-500"></span>
              </span>
              <span>{{ activeOrdersCount }} Antrean</span>
            </button>

            <button
              v-if="isRetail"
              type="button"
              data-testid="pos-scan-button"
              aria-label="Scan QR atau barcode produk (Beruntun)"
              class="flex h-12 shrink-0 items-center gap-2 rounded-2xl bg-primary px-4 text-sm font-semibold text-white transition active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
              @click="showScanner = true"
            >
              <AppIcon name="scan" /><span>Scan</span>
            </button>
          </div>
          <div
            v-if="scanFeedback"
            class="flex flex-wrap items-center justify-between gap-2 rounded-2xl border px-3.5 py-2.5 text-xs sm:text-sm"
            :class="
              scanError
                ? 'border-danger/30 bg-danger/10 text-danger'
                : 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
            "
            role="status"
            data-testid="pos-scan-feedback"
          >
            <div class="flex items-center gap-2 min-w-0">
              <p class="min-w-0 break-words font-semibold">{{ scanFeedback }}</p>
              <span
                v-if="!scanError && lastScannedItemQty > 0"
                class="shrink-0 rounded-lg bg-emerald-500 px-2 py-0.5 font-mono text-xs font-extrabold text-zinc-950"
              >
                Qty: {{ lastScannedItemQty }}
              </span>
            </div>
            <div class="flex items-center gap-1.5 ml-auto shrink-0">
              <template v-if="!scanError && lastScannedProduct && lastScannedItemQty > 0">
                <button
                  type="button"
                  class="rounded-lg border border-current/25 px-2.5 py-1 text-xs font-bold"
                  @click="adjustLastScannedProductQty(-1)"
                >
                  -1
                </button>
                <button
                  type="button"
                  class="rounded-lg bg-emerald-500 px-2.5 py-1 text-xs font-extrabold text-zinc-950"
                  @click="adjustLastScannedProductQty(1)"
                >
                  +1 Lagi
                </button>
              </template>
              <button
                v-if="scanError"
                type="button"
                class="min-h-8 font-semibold underline"
                @click="showScanner = true"
              >
                Scan Lagi
              </button>
            </div>
          </div>

          <div class="flex gap-2 overflow-x-auto pb-1 sm:gap-3">
            <CategoryPill
              v-for="category in filterCategories"
              :key="category"
              :label="category"
              :active="selectedCategory === category"
              @click="productStore.selectCategory(category)"
            />
          </div>
        </div>

        <div
          v-if="filteredProducts.length"
          class="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3 2xl:grid-cols-4"
          data-testid="pos-product-grid"
        >
          <ProductCard
            v-for="product in filteredProducts"
            :key="product.id"
            :product="product"
            @add="handleProductAdd"
          />
        </div>
        <BaseCard v-else-if="syncPullStore.loading" class="py-12 text-center space-y-3">
          <div
            class="inline-flex size-10 items-center justify-center rounded-full bg-primary/10 text-primary animate-spin"
          >
            <svg class="size-5" fill="none" viewBox="0 0 24 24">
              <circle
                class="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                stroke-width="4"
              ></circle>
              <path
                class="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
              ></path>
            </svg>
          </div>
          <p class="text-base font-semibold text-ink-primary">Memuat menu dari Cloud...</p>
          <p class="text-xs text-ink-secondary">
            Mengambil katalog produk &amp; kategori terbaru dari server...
          </p>
        </BaseCard>
        <BaseCard v-else class="py-10 text-center">
          <p class="text-base font-semibold text-ink-primary">Produk tidak ditemukan</p>
          <p class="mt-2 text-sm text-ink-secondary">
            Coba ganti kategori atau ubah kata kunci pencarian Anda.
          </p>
        </BaseCard>
      </section>

      <!-- Right Column: Cart Details (Sticky on the right side) -->
      <section class="hidden min-w-0 space-y-4 md:block md:sticky md:top-4">
        <BaseCard class="space-y-4 border border-zinc-200/70 bg-white/95 shadow-sm">
          <div class="flex items-center justify-between border-b border-zinc-100 pb-3">
            <div>
              <h2 class="text-base font-bold text-ink-primary">Keranjang</h2>
              <p class="text-xs text-ink-secondary">Daftar item pesanan</p>
            </div>
            <span class="rounded-lg bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary">
              {{ items.length }} item
            </span>
          </div>

          <CartCustomerInput input-id="desktop-cart-customer-phone" />

          <div
            v-if="items.length"
            class="no-scrollbar max-h-[calc(100vh-340px)] space-y-3 overflow-y-auto pr-1"
          >
            <CartItem
              v-for="item in items"
              :key="item.id"
              :item="item"
              @increase="cartStore.increaseQty"
              @decrease="cartStore.decreaseQty"
              @update-qty="cartStore.updateQty"
              @remove="cartStore.removeItem"
            />
          </div>
          <div v-else class="py-8 text-center text-sm text-ink-secondary">
            <p class="font-medium text-ink-primary">Belum ada item yang ditambahkan.</p>
            <p class="mt-1 text-xs text-ink-secondary">
              Pilih produk di sebelah kiri untuk menambahkan ke keranjang.
            </p>
          </div>
        </BaseCard>

        <CartSummary
          :subtotal="subtotal"
          :discount="cartStore.discount"
          :discount-label="cartStore.discountLabel"
          :applied-promo="cartStore.appliedPromo"
          :tax="tax"
          :tax-enabled="taxStore.enabled"
          :tax-rate="taxStore.rate"
          :total="total"
          :disabled="!items.length"
          :action-label="cartStore.isEditingOrder ? 'Simpan Tambahan Pesanan' : 'Bayar'"
          @checkout="handleCheckout"
          @select-promo="openPromoModal"
          @remove-promo="cartStore.removePromo"
        />
      </section>
    </div>

    <!-- Floating Circular Cart Button with Total Qty Badge (Mobile) -->
    <div
      v-if="items.length"
      class="fixed right-5 bottom-[calc(env(safe-area-inset-bottom)+6.75rem)] z-30 md:hidden"
    >
      <button
        type="button"
        data-testid="mobile-cart-summary"
        :aria-label="`Buka keranjang (${totalQty} pesanan)`"
        title="Lihat detail keranjang"
        class="group relative flex h-14 w-14 items-center justify-center rounded-full bg-primary text-white shadow-[0_12px_28px_rgba(73,69,214,0.45)] ring-4 ring-white/90 transition-all hover:scale-105 hover:bg-primary-light active:scale-95 cursor-pointer dark:ring-[#0F131F]/90 dark:shadow-[0_14px_32px_rgba(0,0,0,0.65)]"
        @click="openCartSheet"
      >
        <AppIcon name="pos" class="h-6 w-6 transition-transform group-hover:-rotate-6" />

        <span
          data-testid="mobile-cart-qty-badge"
          class="absolute -right-1 -top-1 flex min-h-6 min-w-6 items-center justify-center rounded-full bg-[#FF7A00] px-1.5 font-mono text-xs font-extrabold leading-none text-white shadow-md ring-2 ring-white dark:ring-[#0F131F]"
        >
          {{ totalQty }}
        </span>
      </button>
    </div>

    <MobileCartSheet
      :open="showCartSheet"
      @close="closeCartSheet"
      @checkout="handleCheckout"
      @pay-later="handleCheckout({ payLater: true })"
      @select-promo="openPromoModal"
    />

    <!-- Discount & Promo Selection Modal -->
    <DiscountPromoModal :open="showPromoModal" @close="closePromoModal" />

    <ProductScannerSheet
      :open="showScanner && isRetail"
      :context-key="scanContext"
      :continuous="true"
      :last-scanned-text="scanFeedback"
      :last-scan-error="scanError"
      :last-scanned-item-qty="lastScannedItemQty"
      :cart-count="Number(totalQty) || 0"
      @close="showScanner = false"
      @scanned="handleScanned"
    />

    <!-- Variant Selection Bottom Sheet -->
    <ProductVariantSheet
      :open="showVariantSheet"
      :product="selectedVariantProduct"
      :variant-groups="activeVariantGroupsForProduct"
      @close="closeVariantSheet"
      @confirm="handleVariantConfirm"
    />

    <!-- Active Orders (Antrean Berjalan) Quick Sheet -->
    <ActiveOrdersSheet
      :open="showActiveOrdersSheet"
      @close="showActiveOrdersSheet = false"
      @add-to-order="handleLoadOrderForAdding"
    />
  </div>
</template>
