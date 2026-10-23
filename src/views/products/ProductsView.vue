<script setup>
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'

import AppIcon from '@/components/base/AppIcon.vue'
import BaseBadge from '@/components/base/BaseBadge.vue'
import BaseButton from '@/components/base/BaseButton.vue'
import BaseModal from '@/components/base/BaseModal.vue'
import { useBusinessStore } from '@/stores/businessStore'
import { useProductStore } from '@/stores/productStore'
import { useCloudSessionStore } from '@/stores/cloudSessionStore'
import { useSyncPullStore } from '@/stores/syncPullStore'
import { formatCurrency } from '@/utils/formatters'

const businessStore = useBusinessStore()
const productStore = useProductStore()
const cloudStore = useCloudSessionStore()
const syncPullStore = useSyncPullStore()
const router = useRouter()

const isLaundry = computed(() => businessStore.normalizedType === 'Laundry')
const products = computed(() => productStore.products)
const categories = computed(() => productStore.categories || [])

// Search and filters
const searchQuery = ref('')
const selectedCategory = ref('Semua')
const selectedStatus = ref('all') // 'all' | 'active' | 'inactive'

// Delete modal state
const productToDelete = ref(null)

onMounted(async () => {
  if (cloudStore.isLinked && cloudStore.isOperationalCloudAccess && productStore.products.length === 0) {
    await syncPullStore.ensureCatalogLoaded()
  }
})

// Metrics
const totalProductsCount = computed(() => products.value.length)
const activeProductsCount = computed(() => products.value.filter((p) => p.isActive).length)
const totalCategoriesCount = computed(() => categories.value.length)

// Filtered products list
const filteredProducts = computed(() => {
  let list = products.value

  // Filter by category
  if (selectedCategory.value !== 'Semua') {
    list = list.filter((p) => (p.category || '').toLowerCase() === selectedCategory.value.toLowerCase())
  }

  // Filter by active status
  if (selectedStatus.value === 'active') {
    list = list.filter((p) => p.isActive)
  } else if (selectedStatus.value === 'inactive') {
    list = list.filter((p) => !p.isActive)
  }

  // Filter by search query (name, category, or sku)
  const q = searchQuery.value.trim().toLowerCase()
  if (q) {
    list = list.filter((p) => {
      const name = (p.name || '').toLowerCase()
      const cat = (p.category || '').toLowerCase()
      const sku = (p.sku || '').toLowerCase()
      return name.includes(q) || cat.includes(q) || sku.includes(q)
    })
  }

  return list
})

function handleToggle(product) {
  productStore.toggleProductActive(product.id)
}

function promptDelete(product) {
  productToDelete.value = product
}

function confirmDelete() {
  if (productToDelete.value) {
    productStore.deleteProduct(productToDelete.value.id)
    productToDelete.value = null
  }
}

function cancelDelete() {
  productToDelete.value = null
}

function goToCreate() {
  router.push({ name: 'product-create' })
}

function goToEdit(product) {
  router.push({ name: 'product-edit', params: { id: product.id } })
}

function goToCategories() {
  router.push({ name: 'categories' })
}

function resetFilters() {
  searchQuery.value = ''
  selectedCategory.value = 'Semua'
  selectedStatus.value = 'all'
}
</script>

<template>
  <div class="space-y-4 pb-28">
    <!-- Header Minimalist & Clean -->
    <header class="flex items-center justify-between gap-3">
      <div class="flex items-center gap-3 min-w-0">
        <button
          type="button"
          class="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-zinc-200/80 bg-white text-ink-primary shadow-xs transition hover:bg-zinc-50 active:scale-95"
          aria-label="Kembali ke Home"
          @click="router.push('/home')"
        >
          <AppIcon name="chevron-left" class="h-5 w-5" />
        </button>

        <div class="min-w-0">
          <div class="flex items-center gap-2">
            <span class="text-[11px] font-bold uppercase tracking-widest text-primary">
              {{ isLaundry ? 'Katalog Layanan' : 'Katalog & Menu' }}
            </span>
            <span class="inline-flex h-1.5 w-1.5 rounded-full bg-primary" />
          </div>
          <h1 class="truncate text-xl font-black tracking-tight text-ink-primary sm:text-2xl">
            {{ isLaundry ? 'Daftar Layanan' : 'Daftar Produk' }}
          </h1>
        </div>
      </div>

      <div class="flex items-center gap-2 shrink-0">
        <!-- Kelola Kategori Button -->
        <button
          type="button"
          class="inline-flex h-9 items-center gap-1.5 rounded-xl border border-zinc-200/90 bg-white px-3 text-xs font-semibold text-ink-primary shadow-xs transition hover:bg-zinc-50 active:scale-95"
          @click="goToCategories"
        >
          <AppIcon name="categories" class="h-3.5 w-3.5 text-ink-secondary" />
          <span class="hidden sm:inline">Kategori</span>
        </button>

        <!-- Tambah Produk Button -->
        <BaseButton size="sm" class="h-9 font-semibold shadow-soft whitespace-nowrap" @click="goToCreate">
          <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M12 4v16m8-8H4" />
          </svg>
          <span>Tambah</span>
        </BaseButton>
      </div>
    </header>

    <!-- Compact Hero Metrics -->
    <section class="grid grid-cols-3 gap-2.5 rounded-3xl border border-zinc-200/80 bg-white p-3 shadow-soft sm:gap-4 sm:p-4">
      <!-- Total Produk -->
      <div class="flex flex-col justify-between rounded-2xl bg-surface/80 p-3 sm:p-4">
        <div class="flex items-center justify-between">
          <span class="text-[11px] font-semibold uppercase tracking-wider text-ink-secondary">Total</span>
          <span class="flex h-6 w-6 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <AppIcon name="products" class="h-3.5 w-3.5" />
          </span>
        </div>
        <p class="mt-1.5 text-xl font-black text-ink-primary sm:text-2xl" data-testid="total-products-count">
          {{ totalProductsCount }}
        </p>
        <span class="text-[10px] text-ink-secondary mt-0.5">{{ isLaundry ? 'Layanan' : 'Item' }}</span>
      </div>

      <!-- Produk Aktif -->
      <div class="flex flex-col justify-between rounded-2xl bg-surface/80 p-3 sm:p-4">
        <div class="flex items-center justify-between">
          <span class="text-[11px] font-semibold uppercase tracking-wider text-ink-secondary">Aktif</span>
          <span class="flex h-6 w-6 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600">
            <svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M5 13l4 4L19 7" />
            </svg>
          </span>
        </div>
        <p class="mt-1.5 text-xl font-black text-emerald-600 sm:text-2xl" data-testid="active-products-count">
          {{ activeProductsCount }}
        </p>
        <span class="text-[10px] text-ink-secondary mt-0.5">Tampil di POS</span>
      </div>

      <!-- Total Kategori -->
      <div class="flex flex-col justify-between rounded-2xl bg-surface/80 p-3 sm:p-4">
        <div class="flex items-center justify-between">
          <span class="text-[11px] font-semibold uppercase tracking-wider text-ink-secondary">Kategori</span>
          <span class="flex h-6 w-6 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600">
            <AppIcon name="categories" class="h-3.5 w-3.5" />
          </span>
        </div>
        <p class="mt-1.5 text-xl font-black text-ink-primary sm:text-2xl" data-testid="total-categories-count">
          {{ totalCategoriesCount }}
        </p>
        <span class="text-[10px] text-ink-secondary mt-0.5">Grup</span>
      </div>
    </section>

    <!-- Search & Filter Controls -->
    <section class="space-y-2.5">
      <!-- Search Input -->
      <div class="relative">
        <div class="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3.5 text-ink-secondary">
          <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
        </div>
        <input
          v-model="searchQuery"
          type="text"
          :placeholder="`Cari nama ${isLaundry ? 'layanan' : 'produk'} atau SKU...`"
          class="w-full rounded-2xl border border-zinc-200/90 bg-white py-2.5 pl-10 pr-9 text-sm text-ink-primary placeholder:text-zinc-400 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/10"
        />
        <button
          v-if="searchQuery"
          type="button"
          class="absolute inset-y-0 right-0 flex items-center pr-3 text-zinc-400 hover:text-ink-primary"
          @click="searchQuery = ''"
        >
          <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <!-- Filter Row: Category Chips & Status Toggle -->
      <div class="flex items-center gap-2 overflow-x-auto pb-1 no-scrollbar">
        <!-- Category: Semua -->
        <button
          type="button"
          class="shrink-0 rounded-full px-3.5 py-1.5 text-xs font-semibold transition active:scale-95"
          :class="
            selectedCategory === 'Semua'
              ? 'bg-ink-primary text-white shadow-xs'
              : 'border border-zinc-200 bg-white text-ink-secondary hover:bg-zinc-50'
          "
          @click="selectedCategory = 'Semua'"
        >
          Semua
        </button>

        <!-- Category Chips -->
        <button
          v-for="cat in categories"
          :key="cat"
          type="button"
          class="shrink-0 rounded-full px-3.5 py-1.5 text-xs font-semibold transition active:scale-95"
          :class="
            selectedCategory === cat
              ? 'bg-ink-primary text-white shadow-xs'
              : 'border border-zinc-200 bg-white text-ink-secondary hover:bg-zinc-50'
          "
          @click="selectedCategory = cat"
        >
          {{ cat }}
        </button>

        <span class="inline-block h-4 w-[1px] bg-zinc-200 shrink-0 mx-1" />

        <!-- Status Filter: All / Active / Inactive -->
        <button
          type="button"
          class="shrink-0 rounded-full px-3 py-1.5 text-xs font-medium transition active:scale-95"
          :class="
            selectedStatus === 'active'
              ? 'bg-emerald-100 text-emerald-800 font-semibold'
              : 'border border-zinc-200 bg-white text-ink-secondary hover:bg-zinc-50'
          "
          @click="selectedStatus = selectedStatus === 'active' ? 'all' : 'active'"
        >
          Aktif Saja
        </button>
        <button
          type="button"
          class="shrink-0 rounded-full px-3 py-1.5 text-xs font-medium transition active:scale-95"
          :class="
            selectedStatus === 'inactive'
              ? 'bg-zinc-200 text-zinc-800 font-semibold'
              : 'border border-zinc-200 bg-white text-ink-secondary hover:bg-zinc-50'
          "
          @click="selectedStatus = selectedStatus === 'inactive' ? 'all' : 'inactive'"
        >
          Nonaktif
        </button>
      </div>
    </section>

    <!-- Cloud Sync Loading State -->
    <div
      v-if="syncPullStore.loading"
      class="rounded-3xl border border-dashed border-primary/30 bg-primary/5 p-8 text-center text-sm"
    >
      <div class="inline-flex size-9 items-center justify-center rounded-full bg-primary/10 text-primary animate-spin mb-2">
        <svg class="size-4" fill="none" viewBox="0 0 24 24">
          <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
          <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
        </svg>
      </div>
      <p class="font-semibold text-ink-primary">Memuat katalog dari Cloud...</p>
      <p class="mt-1 text-xs text-ink-secondary">Mengambil daftar produk &amp; kategori terbaru...</p>
    </div>

    <!-- Product Card List -->
    <div v-else-if="filteredProducts.length > 0" class="space-y-2.5">
      <div
        v-for="product in filteredProducts"
        :key="product.id"
        class="group relative flex flex-col justify-between gap-3 rounded-2xl border border-zinc-200/80 bg-white p-3.5 shadow-xs transition hover:border-primary/40 hover:shadow-soft"
      >
        <!-- Top Row: Name, Category, Price & Status -->
        <div class="flex items-start justify-between gap-2.5">
          <div class="min-w-0 flex-1">
            <!-- Product Name + Active Icon Indicator -->
            <div class="flex items-center gap-2">
              <span
                v-if="product.isActive"
                class="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-600 shadow-2xs"
                title="Menu aktif di POS"
              >
                <svg class="h-2.5 w-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M5 13l4 4L19 7" />
                </svg>
              </span>
              <span
                v-else
                class="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-zinc-100 text-zinc-400"
                title="Menu nonaktif"
              >
                <svg class="h-2.5 w-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </span>
              <h3 class="truncate text-base font-bold text-ink-primary">
                {{ product.name }}
              </h3>
            </div>

            <!-- Chips: Category, SKU, Unit -->
            <div class="mt-1 flex flex-wrap items-center gap-1.5 text-xs">
              <span class="rounded-md bg-zinc-100 px-2 py-0.5 font-medium text-zinc-600">
                {{ product.category || 'Tanpa Kategori' }}
              </span>
              <span v-if="product.sku" class="rounded-md bg-zinc-100 px-2 py-0.5 font-mono text-[11px] text-zinc-500">
                SKU: {{ product.sku }}
              </span>
              <span v-if="product.kind === 'service'" class="rounded-md bg-indigo-50 px-2 py-0.5 font-medium text-indigo-600">
                {{ product.pricingUnit }}
              </span>
              <span
                v-if="(product.kind ?? 'product') !== 'service' && product.stock !== undefined"
                class="rounded-md px-2 py-0.5 font-medium text-[11px]"
                :class="Number(product.stock) <= Number(product.minStock || 0) && Number(product.minStock || 0) > 0 ? 'bg-amber-100 text-amber-700' : 'bg-zinc-100 text-zinc-600'"
              >
                Stok: {{ product.stock }}
              </span>
            </div>
          </div>

          <!-- Price Highlight -->
          <div class="text-right shrink-0">
            <p class="text-base font-black tracking-tight text-primary">
              {{ formatCurrency(product.price) }}
            </p>
            <p v-if="product.cost" class="text-[11px] text-ink-secondary">
              HPP: {{ formatCurrency(product.cost) }}
            </p>
          </div>
        </div>

        <!-- Divider Line -->
        <div class="h-[1px] w-full bg-zinc-100" />

        <!-- Bottom Row: Pure Icon Actions (Status, Edit, Delete) -->
        <div class="flex items-center justify-between gap-2">
          <!-- Toggle Active Icon Button (No Text) -->
          <button
            type="button"
            class="inline-flex h-8 w-8 items-center justify-center rounded-xl border transition active:scale-95"
            :class="
              product.isActive
                ? 'border-emerald-200 bg-emerald-50 text-emerald-600 hover:bg-emerald-100 shadow-2xs'
                : 'border-zinc-200 bg-zinc-100 text-zinc-400 hover:bg-zinc-200'
            "
            :title="product.isActive ? 'Menu aktif di POS (Klik untuk nonaktifkan)' : 'Menu nonaktif (Klik untuk aktifkan)'"
            :aria-label="product.isActive ? 'Menu aktif di POS' : 'Menu nonaktif'"
            @click="handleToggle(product)"
          >
            <!-- Icon when active: Checkmark inside circle -->
            <svg v-if="product.isActive" class="h-4 w-4 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <!-- Icon when inactive: Slashed circle -->
            <svg v-else class="h-4 w-4 text-zinc-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
            </svg>
          </button>

          <!-- Edit & Delete Pure Icon Buttons -->
          <div class="flex items-center gap-1.5">
            <!-- Edit Icon Button (Pure Icon, No Text) -->
            <button
              type="button"
              class="inline-flex h-8 w-8 items-center justify-center rounded-xl border border-zinc-200/90 bg-white text-ink-primary shadow-2xs transition hover:bg-zinc-50 active:scale-95"
              title="Edit produk"
              aria-label="Edit produk"
              @click="goToEdit(product)"
            >
              <svg class="h-4 w-4 text-ink-secondary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
              </svg>
            </button>

            <!-- Delete Icon Button -->
            <button
              type="button"
              class="inline-flex h-8 w-8 items-center justify-center rounded-xl border border-red-100 bg-red-50 text-red-600 transition hover:bg-red-100 active:scale-95"
              title="Hapus produk"
              aria-label="Hapus produk"
              @click="promptDelete(product)"
            >
              <AppIcon name="trash" class="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Empty Search Results -->
    <div
      v-else-if="products.length > 0"
      class="rounded-3xl border border-dashed border-zinc-200 bg-white p-8 text-center shadow-xs"
    >
      <div class="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-zinc-100 text-zinc-400 mb-3">
        <svg class="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
      </div>
      <h3 class="text-sm font-bold text-ink-primary">Tidak Ada Produk yang Cocok</h3>
      <p class="mt-1 text-xs text-ink-secondary">
        Tidak ditemukan produk dengan kata kunci "{{ searchQuery }}" atau filter yang dipilih.
      </p>
      <div class="mt-4">
        <BaseButton size="sm" variant="secondary" @click="resetFilters">
          Reset Filter
        </BaseButton>
      </div>
    </div>

    <!-- Empty Products State -->
    <div
      v-else
      class="rounded-3xl border border-dashed border-zinc-200 bg-white p-10 text-center shadow-xs"
    >
      <div class="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary mb-3">
        <AppIcon name="products" class="h-7 w-7" />
      </div>
      <h3 class="text-base font-bold text-ink-primary">
        Belum Ada {{ isLaundry ? 'Layanan' : 'Produk' }}
      </h3>
      <p class="mt-1 text-xs text-ink-secondary max-w-xs mx-auto">
        Mulai tambahkan {{ isLaundry ? 'layanan laundry' : 'produk' }} baru untuk mulai melakukan transaksi penjualan di POS.
      </p>
      <div class="mt-5 flex justify-center gap-2">
        <BaseButton size="sm" @click="goToCreate">
          <svg class="mr-1 h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
          </svg>
          Tambah
        </BaseButton>
      </div>
    </div>

    <!-- Modal Konfirmasi Hapus Produk -->
    <BaseModal
      :open="Boolean(productToDelete)"
      title="Hapus Produk"
      @close="cancelDelete"
    >
      <div class="space-y-4">
        <div class="flex items-center gap-3 rounded-2xl bg-red-50 p-3.5 text-red-700">
          <div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-red-100 text-red-600">
            <AppIcon name="trash" class="h-5 w-5" />
          </div>
          <div class="text-xs">
            <p class="font-bold text-red-800">Tindakan ini tidak dapat dibatalkan</p>
            <p class="mt-0.5 text-red-600">Produk yang dihapus tidak akan muncul lagi di kasir POS.</p>
          </div>
        </div>

        <p class="text-sm text-ink-primary">
          Apakah Anda yakin ingin menghapus produk
          <strong class="font-bold text-ink-primary">"{{ productToDelete?.name }}"</strong>?
        </p>

        <div class="flex justify-end gap-2 pt-2">
          <BaseButton variant="ghost" size="sm" @click="cancelDelete">
            Batal
          </BaseButton>
          <BaseButton variant="danger" size="sm" @click="confirmDelete">
            Hapus
          </BaseButton>
        </div>
      </div>
    </BaseModal>
  </div>
</template>

<style scoped>
.no-scrollbar::-webkit-scrollbar {
  display: none;
}
.no-scrollbar {
  -ms-overflow-style: none;
  scrollbar-width: none;
}
</style>
