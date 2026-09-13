<script setup>
import { computed } from 'vue'
import { storeToRefs } from 'pinia'
import { useRouter } from 'vue-router'

import BaseCard from '@/components/base/BaseCard.vue'
import BaseInput from '@/components/base/BaseInput.vue'
import CartItem from '@/components/pos/CartItem.vue'
import CartSummary from '@/components/pos/CartSummary.vue'
import CategoryPill from '@/components/pos/CategoryPill.vue'
import ProductCard from '@/components/pos/ProductCard.vue'
import { useBusinessStore } from '@/stores/businessStore'
import { useCartStore } from '@/stores/cartStore'
import { useCashStore } from '@/stores/cashStore'
import { useProductStore } from '@/stores/productStore'
import { useTransactionStore } from '@/stores/transactionStore'
import { formatCurrency } from '@/utils/formatters'

const businessStore = useBusinessStore()
const productStore = useProductStore()
const cartStore = useCartStore()
const cashStore = useCashStore()
const transactionStore = useTransactionStore()
const router = useRouter()

const { filterCategories, filteredProducts, lowStockProducts, searchQuery, selectedCategory } = storeToRefs(productStore)
const { items, subtotal, tax, total } = storeToRefs(cartStore)

function isToday(dateString) {
  const date = new Date(dateString)
  const today = new Date()

  return date.getFullYear() === today.getFullYear()
    && date.getMonth() === today.getMonth()
    && date.getDate() === today.getDate()
}

const todayTransactions = computed(() => transactionStore.items.filter((transaction) => (
  transaction.status === 'paid' && isToday(transaction.createdAt)
)))

const todayRevenue = computed(() => todayTransactions.value.reduce((sum, transaction) => sum + Number(transaction.total || 0), 0))
const todayGrossProfit = computed(() => todayTransactions.value.reduce((sum, transaction) => {
  if (Number.isFinite(transaction.grossProfit)) {
    return sum + transaction.grossProfit
  }

  const itemProfit = Array.isArray(transaction.items)
    ? transaction.items.reduce((itemSum, item) => itemSum + (
      (Number(item.price || 0) - Number(item.hppSnapshot || item.costSnapshot || 0)) * Number(item.qty || 0)
    ), 0)
    : 0

  return sum + itemProfit
}, 0))

const laundryStatusSummary = computed(() => {
  const statuses = ['Masuk', 'Diproses', 'Siap Diambil', 'Selesai']

  return statuses.map((status) => ({
    status,
    count: transactionStore.items.filter((transaction) => transaction.orderStatus === status).length,
  }))
})

function handleCheckout() {
  if (!items.value.length) {
    return
  }

  router.push('/payment')
}
</script>

<template>
  <div class="w-full min-w-0 space-y-5 md:space-y-6">
    <section class="overflow-hidden rounded-[1.75rem] bg-[linear-gradient(135deg,_rgba(73,69,214,1),_rgba(91,85,231,0.92)_45%,_rgba(255,122,0,0.92)_100%)] p-5 text-white shadow-[0_24px_60px_rgba(73,69,214,0.24)] sm:rounded-[2rem] sm:p-6 md:p-8">
      <div class="grid gap-5 lg:grid-cols-[1.1fr_0.9fr] lg:gap-6">
        <div class="min-w-0">
          <p class="text-xs uppercase tracking-[0.24em] text-white/70 sm:tracking-[0.28em]">Point Of Sale</p>
          <h1 class="mt-2 text-2xl font-semibold leading-tight sm:mt-3 sm:text-3xl md:text-4xl">
            Cari produk, pilih kategori, lalu proses transaksi lebih cepat.
          </h1>
          <p class="mt-2 text-xs text-white/80 sm:mt-3 sm:text-sm">
            Product browser sekarang sudah terhubung ke filter kategori dan pencarian nama produk.
          </p>
        </div>

        <div class="grid grid-cols-3 gap-2 sm:gap-3 lg:grid-cols-1 xl:grid-cols-3">
          <div class="min-w-0 rounded-2xl bg-white/12 p-3 backdrop-blur-sm sm:rounded-3xl sm:p-4">
            <p class="truncate text-[10px] uppercase tracking-wider text-white/65 sm:text-xs sm:tracking-[0.16em]">Produk Aktif</p>
            <p class="mt-1 truncate text-lg font-semibold sm:mt-2 sm:text-2xl">{{ filteredProducts.length }}</p>
          </div>
          <div class="min-w-0 rounded-2xl bg-white/12 p-3 backdrop-blur-sm sm:rounded-3xl sm:p-4">
            <p class="truncate text-[10px] uppercase tracking-wider text-white/65 sm:text-xs sm:tracking-[0.16em]">Kategori</p>
            <p class="mt-1 truncate text-lg font-semibold sm:mt-2 sm:text-2xl">{{ selectedCategory }}</p>
          </div>
          <div class="min-w-0 rounded-2xl bg-white/12 p-3 backdrop-blur-sm sm:rounded-3xl sm:p-4">
            <p class="truncate text-[10px] uppercase tracking-wider text-white/65 sm:text-xs sm:tracking-[0.16em]">Keranjang</p>
            <p class="mt-1 truncate text-lg font-semibold sm:mt-2 sm:text-2xl">{{ items.length }} item</p>
          </div>
        </div>
      </div>
    </section>

    <section class="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
      <BaseCard class="space-y-1">
        <p class="text-xs uppercase tracking-[0.16em] text-ink-secondary">Omzet Hari Ini</p>
        <p class="text-xl font-semibold text-ink-primary">{{ formatCurrency(todayRevenue) }}</p>
      </BaseCard>
      <BaseCard class="space-y-1">
        <p class="text-xs uppercase tracking-[0.16em] text-ink-secondary">Estimasi Laba Kotor</p>
        <p class="text-xl font-semibold text-ink-primary">{{ formatCurrency(todayGrossProfit) }}</p>
      </BaseCard>
      <BaseCard class="space-y-1">
        <p class="text-xs uppercase tracking-[0.16em] text-ink-secondary">Kas Masuk</p>
        <p class="text-xl font-semibold text-success">{{ formatCurrency(cashStore.todayCashIn) }}</p>
      </BaseCard>
      <BaseCard class="space-y-1">
        <p class="text-xs uppercase tracking-[0.16em] text-ink-secondary">Kas Keluar</p>
        <p class="text-xl font-semibold text-danger">{{ formatCurrency(cashStore.todayCashOut) }}</p>
      </BaseCard>
      <BaseCard class="space-y-1">
        <p class="text-xs uppercase tracking-[0.16em] text-ink-secondary">Saldo Kas</p>
        <p class="text-xl font-semibold text-ink-primary">{{ formatCurrency(cashStore.balance) }}</p>
      </BaseCard>
      <BaseCard class="space-y-1">
        <p class="text-xs uppercase tracking-[0.16em] text-ink-secondary">Stok Minimum</p>
        <p class="text-xl font-semibold" :class="lowStockProducts.length ? 'text-warning' : 'text-ink-primary'">
          {{ lowStockProducts.length }}
        </p>
      </BaseCard>
    </section>

    <section v-if="businessStore.normalizedType === 'Laundry'" class="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <BaseCard
        v-for="item in laundryStatusSummary"
        :key="item.status"
        class="space-y-1"
      >
        <p class="text-xs uppercase tracking-[0.16em] text-ink-secondary">{{ item.status }}</p>
        <p class="text-2xl font-semibold text-ink-primary">{{ item.count }}</p>
      </BaseCard>
    </section>

    <div class="grid gap-6 xl:grid-cols-[1.3fr_0.7fr]">
      <section class="min-w-0 space-y-4 sm:space-y-5">
        <BaseCard class="space-y-4 border border-white/40 bg-white/90 shadow-[0_18px_40px_rgba(24,24,27,0.05)] sm:space-y-5">
          <div class="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <div class="min-w-0">
              <p class="text-xs font-medium uppercase tracking-[0.18em] text-primary sm:text-sm">Product Browser</p>
              <h2 class="mt-1 text-xl font-semibold text-ink-primary sm:mt-2 sm:text-2xl">Pilih produk untuk transaksi</h2>
              <p class="mt-1 text-xs text-ink-secondary sm:mt-2 sm:text-sm">
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

          <div class="flex gap-2 overflow-x-auto pb-1 sm:gap-3">
            <CategoryPill
              v-for="category in filterCategories"
              :key="category"
              :label="category"
              :active="selectedCategory === category"
              @click="productStore.selectCategory(category)"
            />
          </div>
        </BaseCard>

        <div class="flex flex-wrap gap-2 sm:gap-3">
          <div class="rounded-full bg-white px-3 py-1.5 text-xs text-ink-secondary shadow-soft sm:px-4 sm:py-2 sm:text-sm">
            {{ filteredProducts.length }} produk ditemukan
          </div>
          <div class="rounded-full bg-accent/10 px-3 py-1.5 text-xs text-accent sm:px-4 sm:py-2 sm:text-sm">
            Kategori: {{ selectedCategory }}
          </div>
          <div v-if="searchQuery" class="rounded-full bg-primary/8 px-3 py-1.5 text-xs text-primary sm:px-4 sm:py-2 sm:text-sm">
            Kata kunci: "{{ searchQuery }}"
          </div>
        </div>

        <div v-if="filteredProducts.length" class="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 xl:grid-cols-3">
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

      <section class="min-w-0 space-y-4">
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
      class="fixed inset-x-0 bottom-16 z-20 px-4 py-2 md:hidden"
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
