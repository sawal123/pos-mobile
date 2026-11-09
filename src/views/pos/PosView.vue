<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useRouter } from 'vue-router'

import ProductScannerSheet from '@/components/scanner/ProductScannerSheet.vue'
import { useRetailProductCodes } from '@/composables/useRetailProductCodes'

import AppIcon from '@/components/base/AppIcon.vue'
import BaseCard from '@/components/base/BaseCard.vue'
import BaseInput from '@/components/base/BaseInput.vue'
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
import { useVariantStore } from '@/stores/variantStore'

const productStore = useProductStore()
const cartStore = useCartStore()
const taxStore = useTaxStore()
const cloudStore = useCloudSessionStore()
const syncPullStore = useSyncPullStore()
const variantStore = useVariantStore()
const router = useRouter()
const { isRetail, scanContext } = useRetailProductCodes()
const showScanner = ref(false)
const scanFeedback = ref('')
const scanError = ref(false)
let scanVariantContext = null
let globalScanBuffer = ''
let globalScanLastTime = 0
let globalScanTimer = null
let searchLastInputTime = 0
let searchRapidStreak = 0
let searchAutoScanTimer = null

function handleScanned(code, { fromCamera = true } = {}) {
  if (!isRetail.value) return
  if (fromCamera && !showScanner.value) return
  const result = productStore.resolveScanCode(code)
  scanError.value = !result.success
  if (!result.success) {
    scanFeedback.value = result.error
    return
  }
  const outcome = handleProductAdd(result.product)
  if (outcome === 'variant') {
    showScanner.value = false
    scanVariantContext = scanContext.value
    scanFeedback.value = 'Pilih varian untuk menambahkan produk.'
  } else {
    scanFeedback.value = `${result.product.name} ditambahkan ke keranjang.`
  }
}

function handleSearchUpdate(value) {
  productStore.setSearchQuery(value)
  if (!isRetail.value) return
  const now = Date.now()
  if (now - searchLastInputTime < 55) {
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
    }, 90)
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
  if (!isRetail.value || showScanner.value || showVariantSheet.value || showPromoModal.value) return
  const activeEl = document.activeElement
  const tag = activeEl ? activeEl.tagName.toLowerCase() : ''
  const isEditing =
    tag === 'input' || tag === 'textarea' || tag === 'select' || Boolean(activeEl?.isContentEditable)
  if (isEditing || event.ctrlKey || event.altKey || event.metaKey) return

  const now = Date.now()
  if (now - globalScanLastTime > 120) {
    globalScanBuffer = ''
  }

  if (event.key === 'Enter') {
    const code = globalScanBuffer.trim()
    globalScanBuffer = ''
    if (globalScanTimer) clearTimeout(globalScanTimer)
    if (code.length >= 3) {
      event.preventDefault()
      handleScanned(code, { fromCamera: false })
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
        handleScanned(candidate, { fromCamera: false })
      }
      globalScanBuffer = ''
    }, 130)
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

onMounted(async () => {
  document.addEventListener('keydown', handleGlobalHardwareScanKeydown)
  if (cloudStore.isLinked && cloudStore.isOperationalCloudAccess) {
    await syncPullStore.ensureCatalogLoaded()
  }
})

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

function handleCheckout() {
  if (!items.value.length) {
    return
  }

  showCartSheet.value = false
  router.push('/payment')
}
</script>

<template>
  <div class="w-full min-w-0 space-y-4 md:space-y-5" :class="items.length ? 'pb-20 md:pb-0' : ''">
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
            class="flex flex-wrap items-center justify-between gap-2 rounded-2xl px-4 py-3 text-sm"
            :class="scanError ? 'bg-danger/10 text-danger' : 'bg-primary/10 text-primary'"
            role="status"
            data-testid="pos-scan-feedback"
          >
            <p class="min-w-0 break-words">{{ scanFeedback }}</p>
            <button
              v-if="scanError"
              type="button"
              class="min-h-10 font-semibold underline"
              @click="showScanner = true"
            >
              Scan Lagi
            </button>
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
          @checkout="handleCheckout"
          @select-promo="openPromoModal"
          @remove-promo="cartStore.removePromo"
        />
      </section>
    </div>

    <!-- Floating Circular Cart Button with Total Qty Badge (Mobile) -->
    <div
      v-if="items.length"
      class="fixed right-4 bottom-[calc(env(safe-area-inset-bottom)+5.6rem)] z-20 md:hidden"
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
  </div>
</template>
