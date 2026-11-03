<script setup>
import { computed, onMounted, ref } from 'vue'
import { storeToRefs } from 'pinia'
import { useRouter } from 'vue-router'

import AppIcon from '@/components/base/AppIcon.vue'
import BaseCard from '@/components/base/BaseCard.vue'
import BaseInput from '@/components/base/BaseInput.vue'
import CartItem from '@/components/pos/CartItem.vue'
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

const { filterCategories, filteredProducts, searchQuery, selectedCategory } = storeToRefs(productStore)
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
    return
  }
  cartStore.addItem(product)
}

function handleVariantConfirm({ product, selectedOptions }) {
  cartStore.addItem(product, selectedOptions)
  showVariantSheet.value = false
  selectedVariantProduct.value = null
}

onMounted(async () => {
  if (cloudStore.isLinked && cloudStore.isOperationalCloudAccess) {
    await syncPullStore.ensureCatalogLoaded()
  }
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
  <div
    class="w-full min-w-0 space-y-4 md:space-y-5"
    :class="items.length ? 'pb-20 md:pb-0' : ''"
  >
    <div class="grid gap-5 md:grid-cols-[1fr_340px] lg:grid-cols-[1fr_380px] xl:grid-cols-[1fr_420px] items-start">
      <!-- Left Column: Product Catalog -->
      <section class="min-w-0 space-y-3 sm:space-y-4">
        <div class="space-y-3">
          <BaseInput
            :model-value="searchQuery"
            placeholder="Cari produk..."
            aria-label="Cari produk"
            @update:model-value="productStore.setSearchQuery"
          />

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

        <div v-if="filteredProducts.length" class="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3 2xl:grid-cols-4" data-testid="pos-product-grid">
          <ProductCard
            v-for="product in filteredProducts"
            :key="product.id"
            :product="product"
            @add="handleProductAdd"
          />
        </div>
        <BaseCard v-else-if="syncPullStore.loading" class="py-12 text-center space-y-3">
          <div class="inline-flex size-10 items-center justify-center rounded-full bg-primary/10 text-primary animate-spin">
            <svg class="size-5" fill="none" viewBox="0 0 24 24">
              <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
              <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
          </div>
          <p class="text-base font-semibold text-ink-primary">Memuat menu dari Cloud...</p>
          <p class="text-xs text-ink-secondary">Mengambil katalog produk &amp; kategori terbaru dari server...</p>
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

          <div v-if="items.length" class="no-scrollbar max-h-[calc(100vh-340px)] space-y-3 overflow-y-auto pr-1">
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
            <p class="mt-1 text-xs text-ink-secondary">Pilih produk di sebelah kiri untuk menambahkan ke keranjang.</p>
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
    <DiscountPromoModal
      :open="showPromoModal"
      @close="closePromoModal"
    />

    <!-- Variant Selection Bottom Sheet -->
    <ProductVariantSheet
      :open="showVariantSheet"
      :product="selectedVariantProduct"
      :variant-groups="activeVariantGroupsForProduct"
      @close="showVariantSheet = false"
      @confirm="handleVariantConfirm"
    />
  </div>
</template>
