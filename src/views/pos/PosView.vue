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
