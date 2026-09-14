<script setup>
import { storeToRefs } from 'pinia'
import { useRouter } from 'vue-router'

import BaseCard from '@/components/base/BaseCard.vue'
import BaseInput from '@/components/base/BaseInput.vue'
import CartItem from '@/components/pos/CartItem.vue'
import CartSummary from '@/components/pos/CartSummary.vue'
import CategoryPill from '@/components/pos/CategoryPill.vue'
import ProductCard from '@/components/pos/ProductCard.vue'
import { useCartStore } from '@/stores/cartStore'
import { useProductStore } from '@/stores/productStore'
import { formatCurrency } from '@/utils/formatters'

const productStore = useProductStore()
const cartStore = useCartStore()
const router = useRouter()

const { filterCategories, filteredProducts, searchQuery, selectedCategory } = storeToRefs(productStore)
const { items, subtotal, tax, total } = storeToRefs(cartStore)

function handleCheckout() {
  if (!items.value.length) {
    return
  }

  router.push('/payment')
}
</script>

<template>
  <div class="w-full min-w-0 space-y-4 md:space-y-5">
    <div class="grid gap-5 xl:grid-cols-[1.3fr_0.7fr]">
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
            @add="cartStore.addItem"
          />
        </div>
        <BaseCard v-else class="py-10 text-center">
          <p class="text-base font-semibold text-ink-primary">Produk tidak ditemukan</p>
          <p class="mt-2 text-sm text-ink-secondary">
            Coba ganti kategori atau ubah kata kunci pencarian Anda.
          </p>
        </BaseCard>
      </section>

      <section class="hidden min-w-0 space-y-4 md:block">
        <BaseCard class="space-y-4 border border-white/40 bg-white/90">
          <div class="flex items-center justify-between">
            <h2 class="text-lg font-semibold text-ink-primary">Keranjang</h2>
            <span class="text-sm text-ink-secondary">{{ items.length }} item</span>
          </div>

          <div v-if="items.length" class="space-y-3">
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
          <p v-else class="text-sm text-ink-secondary">Belum ada item yang ditambahkan.</p>
        </BaseCard>

        <CartSummary
          :subtotal="subtotal"
          :tax="tax"
          :total="total"
          :disabled="!items.length"
          @checkout="handleCheckout"
        />
      </section>
    </div>

    <!-- Floating Mobile Checkout Bar for convenient POS checkout on phone screens -->
    <div
      v-if="items.length"
      class="fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+5.25rem)] z-20 px-4 py-2 md:hidden"
    >
      <div class="flex items-center justify-between gap-3 rounded-2xl bg-ink-primary px-4 py-3 text-white shadow-2xl backdrop-blur-md">
        <div class="min-w-0">
          <p class="text-xs text-white/70">{{ items.length }} item &bull; Total</p>
          <p class="text-base font-bold text-white">{{ formatCurrency(total) }}</p>
        </div>
        <button
          type="button"
          class="flex shrink-0 items-center gap-1.5 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-white shadow-md transition active:scale-95"
          @click="handleCheckout"
        >
          <span>Bayar</span>
          <span aria-hidden="true">&rarr;</span>
        </button>
      </div>
    </div>
  </div>
</template>
