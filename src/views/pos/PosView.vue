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

const productStore = useProductStore()
const cartStore = useCartStore()
const router = useRouter()

const { categories, filteredProducts, searchQuery, selectedCategory } = storeToRefs(productStore)
const { items, subtotal, tax, total } = storeToRefs(cartStore)

function handleCheckout() {
  if (!items.value.length) {
    return
  }

  router.push('/payment')
}
</script>

<template>
  <div class="space-y-6">
    <section class="overflow-hidden rounded-[2rem] bg-[linear-gradient(135deg,_rgba(73,69,214,1),_rgba(91,85,231,0.92)_45%,_rgba(255,122,0,0.92)_100%)] p-6 text-white shadow-[0_24px_60px_rgba(73,69,214,0.24)] md:p-8">
      <div class="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
        <div>
          <p class="text-xs uppercase tracking-[0.28em] text-white/70">Point Of Sale</p>
          <h1 class="mt-3 max-w-xl text-3xl font-semibold leading-tight md:text-4xl">
            Cari produk, pilih kategori, lalu proses transaksi lebih cepat.
          </h1>
          <p class="mt-3 max-w-2xl text-sm text-white/80">
            Product browser sekarang sudah terhubung ke filter kategori dan pencarian nama produk.
          </p>
        </div>

        <div class="grid gap-3 sm:grid-cols-3 lg:grid-cols-1 xl:grid-cols-3">
          <div class="rounded-3xl bg-white/12 p-4 backdrop-blur-sm">
            <p class="text-xs uppercase tracking-[0.16em] text-white/65">Produk Aktif</p>
            <p class="mt-2 text-2xl font-semibold">{{ filteredProducts.length }}</p>
          </div>
          <div class="rounded-3xl bg-white/12 p-4 backdrop-blur-sm">
            <p class="text-xs uppercase tracking-[0.16em] text-white/65">Kategori</p>
            <p class="mt-2 text-2xl font-semibold">{{ selectedCategory }}</p>
          </div>
          <div class="rounded-3xl bg-white/12 p-4 backdrop-blur-sm">
            <p class="text-xs uppercase tracking-[0.16em] text-white/65">Keranjang</p>
            <p class="mt-2 text-2xl font-semibold">{{ items.length }} item</p>
          </div>
        </div>
      </div>
    </section>

    <div class="grid gap-6 xl:grid-cols-[1.3fr_0.7fr]">
    <section class="space-y-5">
      <BaseCard class="space-y-5 border border-white/40 bg-white/90 shadow-[0_18px_40px_rgba(24,24,27,0.05)]">
        <div class="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <p class="text-sm font-medium uppercase tracking-[0.18em] text-primary">Product Browser</p>
            <h2 class="mt-2 text-2xl font-semibold text-ink-primary">Pilih produk untuk transaksi</h2>
            <p class="mt-2 text-sm text-ink-secondary">
              Gunakan kategori dan pencarian untuk menemukan menu dengan cepat.
            </p>
          </div>

          <div class="w-full md:max-w-xs">
            <BaseInput
              :model-value="searchQuery"
              label="Cari Produk"
              placeholder="Cari nama produk"
              @update:model-value="productStore.setSearchQuery"
            />
          </div>
        </div>

        <div class="flex gap-3 overflow-x-auto pb-1">
          <CategoryPill
            v-for="category in categories"
            :key="category"
            :label="category"
            :active="selectedCategory === category"
            @click="productStore.selectCategory(category)"
          />
        </div>
      </BaseCard>

      <div class="flex flex-wrap gap-3">
        <div class="rounded-full bg-white px-4 py-2 text-sm text-ink-secondary shadow-soft">
          {{ filteredProducts.length }} produk ditemukan
        </div>
        <div class="rounded-full bg-accent/10 px-4 py-2 text-sm text-accent">
          Kategori: {{ selectedCategory }}
        </div>
        <div v-if="searchQuery" class="rounded-full bg-primary/8 px-4 py-2 text-sm text-primary">
          Kata kunci: "{{ searchQuery }}"
        </div>
      </div>

      <div v-if="filteredProducts.length" class="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
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

    <section class="space-y-4">
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
  </div>
</template>
