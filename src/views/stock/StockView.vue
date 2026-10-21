<script setup>
import { computed, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'

import AppIcon from '@/components/base/AppIcon.vue'
import BaseButton from '@/components/base/BaseButton.vue'
import BaseInput from '@/components/base/BaseInput.vue'
import BaseModal from '@/components/base/BaseModal.vue'
import { useProductStore } from '@/stores/productStore'
import { formatDateTime } from '@/utils/formatters'

const productStore = useProductStore()
const router = useRouter()

// View Tab: 'products' | 'movements'
const activeTab = ref('products')

// Search & Filter
const searchQuery = ref('')
const statusFilter = ref('all') // 'all' | 'low' | 'empty' | 'safe'

// Adjustment Modal State
const adjustingProduct = ref(null)
const adjustmentMode = ref('add') // 'add' | 'subtract' | 'set'
const adjustmentForm = reactive({
  amount: '',
  category: 'Restock',
  note: '',
})
const adjustmentError = ref('')

const QUICK_INCREMENTS = [5, 10, 20, 50, 100]
const REASON_SUGGESTIONS = ['Restock', 'Opname Fisik', 'Barang Rusak', 'Koreksi Stok']

const inventoryProducts = computed(() =>
  productStore.products.filter((product) => (product.kind ?? 'product') !== 'service'),
)

function isLowStock(product) {
  const stock = Number(product.stock || 0)
  const minStock = Number(product.minStock || 0)
  return minStock > 0 && stock <= minStock
}

function isOutOfStock(product) {
  return Number(product.stock || 0) <= 0
}

const lowStockCount = computed(() =>
  inventoryProducts.value.filter(isLowStock).length,
)

const outOfStockCount = computed(() =>
  inventoryProducts.value.filter(isOutOfStock).length,
)

const totalStockUnits = computed(() =>
  inventoryProducts.value.reduce((sum, p) => sum + Math.max(0, Number(p.stock || 0)), 0),
)

const filteredProducts = computed(() => {
  let list = inventoryProducts.value

  if (statusFilter.value === 'low') {
    list = list.filter(isLowStock)
  } else if (statusFilter.value === 'empty') {
    list = list.filter(isOutOfStock)
  } else if (statusFilter.value === 'safe') {
    list = list.filter((p) => !isLowStock(p) && !isOutOfStock(p))
  }

  const q = searchQuery.value.trim().toLowerCase()
  if (!q) return list

  return list.filter((p) => {
    const name = String(p.name || '').toLowerCase()
    const cat = String(p.category || '').toLowerCase()
    return name.includes(q) || cat.includes(q)
  })
})

const filteredMovements = computed(() => {
  let list = productStore.stockMovements || []
  const q = searchQuery.value.trim().toLowerCase()
  if (!q) return list

  return list.filter((m) => {
    const pName = String(m.productName || '').toLowerCase()
    const cat = String(m.category || '').toLowerCase()
    const note = String(m.note || '').toLowerCase()
    return pName.includes(q) || cat.includes(q) || note.includes(q)
  })
})

function openAdjustment(product) {
  adjustingProduct.value = product
  adjustmentMode.value = 'add'
  adjustmentForm.amount = ''
  adjustmentForm.category = 'Restock'
  adjustmentForm.note = ''
  adjustmentError.value = ''
}

function closeAdjustment() {
  adjustingProduct.value = null
}

function selectQuickIncrement(qty) {
  const current = Number(adjustmentForm.amount) || 0
  adjustmentForm.amount = String(current + qty)
}

const calculatedQuantityChange = computed(() => {
  const inputVal = Number(adjustmentForm.amount)
  if (!Number.isFinite(inputVal) || inputVal <= 0) return 0

  if (adjustmentMode.value === 'add') {
    return inputVal
  } else if (adjustmentMode.value === 'subtract') {
    return -inputVal
  } else if (adjustmentMode.value === 'set') {
    const currentStock = Number(adjustingProduct.value?.stock || 0)
    return inputVal - currentStock
  }
  return 0
})

const predictedFinalStock = computed(() => {
  if (!adjustingProduct.value) return 0
  const current = Number(adjustingProduct.value.stock || 0)
  return current + calculatedQuantityChange.value
})

function handleStockAdjustment() {
  if (!adjustingProduct.value) return
  adjustmentError.value = ''

  const change = calculatedQuantityChange.value
  if (change === 0) {
    adjustmentError.value = 'Nominal perubahan stok harus menghasilkan perubahan (tidak 0).'
    return
  }

  const result = productStore.adjustStock(adjustingProduct.value.id, {
    quantityChange: change,
    category: adjustmentForm.category || 'Adjustment Manual',
    note: adjustmentForm.note || (adjustmentMode.value === 'set' ? 'Stock opname fisik' : ''),
  })

  if (!result.success) {
    adjustmentError.value = result.error
    return
  }

  closeAdjustment()
}
</script>

<template>
  <div class="mx-auto max-w-xl space-y-4 pb-36">
    <!-- Header Minimalis & Clean -->
    <header class="flex items-center justify-between gap-1.5">
      <div class="flex items-center gap-2 min-w-0">
        <button
          type="button"
          class="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-zinc-200 bg-white text-ink-primary shadow-xs transition hover:bg-zinc-50 active:scale-95"
          aria-label="Kembali ke Home"
          @click="router.push('/home')"
        >
          <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
          </svg>
        </button>

        <div class="min-w-0">
          <p class="text-[9px] font-bold uppercase tracking-wider text-primary">Logistik & Inventaris</p>
          <h1 class="text-xs sm:text-sm font-bold tracking-tight text-ink-primary whitespace-nowrap">Stok Produk</h1>
        </div>
      </div>

      <!-- Low Stock Status Pill -->
      <span
        v-if="lowStockCount > 0"
        class="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-amber-200/80 bg-amber-50 px-2.5 py-1 text-[11px] font-semibold text-warning"
      >
        <span class="h-1.5 w-1.5 rounded-full bg-warning animate-pulse" />
        {{ lowStockCount }} Menipis
      </span>
      <span
        v-else
        class="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-emerald-200/80 bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-700"
      >
        <span class="h-1.5 w-1.5 rounded-full bg-emerald-500" />
        Stok Aman
      </span>
    </header>

    <!-- Unified Minimalist Metrics Card (3 Columns) -->
    <section class="rounded-3xl border border-zinc-200/80 bg-white p-4 sm:p-5 shadow-soft">
      <div class="grid grid-cols-3 divide-x divide-zinc-100 text-center">
        <!-- Total Items -->
        <div class="px-2">
          <p class="text-[10px] font-medium text-ink-secondary uppercase tracking-wider">Item Barang</p>
          <p class="mt-1 font-mono text-lg sm:text-xl font-bold text-ink-primary">
            {{ inventoryProducts.length }}
          </p>
          <span class="text-[10px] text-zinc-400 mt-0.5 block">Produk fisik</span>
        </div>

        <!-- Total Stock Units -->
        <div class="px-2">
          <p class="text-[10px] font-medium text-ink-secondary uppercase tracking-wider">Total Fisik</p>
          <p class="mt-1 font-mono text-lg sm:text-xl font-bold text-primary">
            {{ totalStockUnits }}
          </p>
          <span class="text-[10px] text-zinc-400 mt-0.5 block">Total kuantitas</span>
        </div>

        <!-- Low / Alert -->
        <div class="px-2">
          <p class="text-[10px] font-medium text-ink-secondary uppercase tracking-wider">Perlu Restock</p>
          <p
            class="mt-1 font-mono text-lg sm:text-xl font-bold"
            :class="lowStockCount > 0 ? 'text-warning' : 'text-emerald-600'"
          >
            {{ lowStockCount }}
          </p>
          <span class="text-[10px] mt-0.5 block" :class="lowStockCount > 0 ? 'text-warning font-semibold' : 'text-zinc-400'">
            {{ lowStockCount > 0 ? 'Segera isi' : 'Semua aman' }}
          </span>
        </div>
      </div>
    </section>

    <!-- Clean Segmented Tab Switcher (Stok vs Mutasi) -->
    <section class="flex rounded-2xl bg-zinc-100 p-1 text-[11px]">
      <button
        type="button"
        class="flex-1 py-1.5 text-center font-medium rounded-xl transition-all"
        :class="activeTab === 'products' ? 'bg-white font-bold text-ink-primary shadow-xs' : 'text-zinc-500 hover:text-ink-primary'"
        @click="activeTab = 'products'"
      >
        Daftar Stok ({{ inventoryProducts.length }})
      </button>

      <button
        type="button"
        class="flex-1 py-1.5 text-center font-medium rounded-xl transition-all"
        :class="activeTab === 'movements' ? 'bg-white font-bold text-ink-primary shadow-xs' : 'text-zinc-500 hover:text-ink-primary'"
        @click="activeTab = 'movements'"
      >
        Riwayat Mutasi ({{ productStore.stockMovements.length }})
      </button>
    </section>

    <!-- Search Bar -->
    <section class="relative">
      <svg class="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
      </svg>
      <input
        v-model="searchQuery"
        type="text"
        :placeholder="activeTab === 'products' ? 'Cari nama produk atau kategori...' : 'Cari riwayat mutasi...'"
        class="h-10 w-full rounded-2xl border border-zinc-200 bg-white pl-10 pr-4 text-xs text-ink-primary shadow-xs outline-none transition placeholder:text-zinc-400 focus:border-primary focus:ring-2 focus:ring-primary/10"
      />
      <button
        v-if="searchQuery"
        type="button"
        class="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-semibold text-zinc-400 hover:text-zinc-600"
        @click="searchQuery = ''"
      >
        &times;
      </button>
    </section>

    <!-- TAB 1: DAFTAR STOK PRODUK -->
    <section v-if="activeTab === 'products'" class="space-y-3">
      <!-- Status Filter Chips -->
      <div class="flex items-center gap-1.5 overflow-x-auto pb-1 text-[11px]">
        <button
          type="button"
          class="shrink-0 rounded-xl px-2.5 py-1 font-medium transition active:scale-95"
          :class="statusFilter === 'all' ? 'bg-primary text-white font-bold shadow-xs' : 'bg-white border border-zinc-200/80 text-zinc-600 hover:bg-zinc-50'"
          @click="statusFilter = 'all'"
        >
          Semua ({{ inventoryProducts.length }})
        </button>

        <button
          v-if="lowStockCount > 0"
          type="button"
          class="shrink-0 rounded-xl px-2.5 py-1 font-medium transition active:scale-95 whitespace-nowrap"
          :class="statusFilter === 'low' ? 'bg-warning text-white font-bold shadow-xs' : 'bg-amber-50 border border-amber-200/80 text-amber-800 hover:bg-amber-100'"
          @click="statusFilter = 'low'"
        >
          Menipis ({{ lowStockCount }})
        </button>

        <button
          v-if="outOfStockCount > 0"
          type="button"
          class="shrink-0 rounded-xl px-2.5 py-1 font-medium transition active:scale-95 whitespace-nowrap"
          :class="statusFilter === 'empty' ? 'bg-danger text-white font-bold shadow-xs' : 'bg-rose-50 border border-rose-200/80 text-rose-800 hover:bg-rose-100'"
          @click="statusFilter = 'empty'"
        >
          Habis ({{ outOfStockCount }})
        </button>

        <button
          type="button"
          class="shrink-0 rounded-xl px-2.5 py-1 font-medium transition active:scale-95 whitespace-nowrap"
          :class="statusFilter === 'safe' ? 'bg-emerald-600 text-white font-bold shadow-xs' : 'bg-white border border-zinc-200/80 text-zinc-600 hover:bg-zinc-50'"
          @click="statusFilter = 'safe'"
        >
          Stok Aman
        </button>
      </div>

      <!-- Product Stock Cards -->
      <div v-if="filteredProducts.length" class="space-y-2">
        <div
          v-for="product in filteredProducts"
          :key="product.id"
          :data-testid="`stock-product-${product.id}`"
          class="rounded-3xl border border-zinc-200/80 bg-white p-3.5 sm:p-4 shadow-soft transition hover:border-zinc-300 space-y-2.5"
        >
          <div class="flex items-start justify-between gap-3">
            <div class="min-w-0">
              <div class="flex items-center gap-1.5 flex-wrap">
                <h3 class="font-bold text-sm text-ink-primary truncate">{{ product.name }}</h3>
                <span
                  v-if="isOutOfStock(product)"
                  class="rounded-full bg-rose-50 border border-rose-200 px-2 py-0.5 text-[10px] font-bold text-danger"
                >
                  Habis
                </span>
                <span
                  v-else-if="isLowStock(product)"
                  class="rounded-full bg-amber-50 border border-amber-200 px-2 py-0.5 text-[10px] font-bold text-warning"
                >
                  Low Stock
                </span>
                <span
                  v-if="product.isActive === false"
                  class="rounded-full bg-zinc-100 border border-zinc-200 px-2 py-0.5 text-[10px] font-medium text-zinc-500"
                >
                  Nonaktif
                </span>
              </div>

              <p class="text-[11px] text-ink-secondary mt-0.5 truncate">
                {{ product.category || 'Umum' }} &bull; Satuan: {{ product.unit || 'pcs' }}
                <span v-if="Number(product.minStock || 0) > 0" class="text-zinc-400">
                  &bull; Min: {{ product.minStock }}
                </span>
              </p>
            </div>

            <!-- Stock Count Display -->
            <div class="text-right shrink-0">
              <p
                class="font-mono text-base sm:text-lg font-bold"
                :class="
                  isOutOfStock(product)
                    ? 'text-danger'
                    : isLowStock(product)
                    ? 'text-warning'
                    : 'text-ink-primary'
                "
              >
                {{ product.stock }}
                <span class="text-xs font-normal text-zinc-400 font-sans">{{ product.unit || 'pcs' }}</span>
              </p>
            </div>
          </div>

          <!-- Bottom Action Bar -->
          <div class="flex items-center justify-between pt-2 border-t border-zinc-100 text-xs">
            <span class="text-[10px] text-zinc-400">
              Stok min: {{ product.minStock || 0 }} {{ product.unit || 'pcs' }}
            </span>

            <button
              type="button"
              class="inline-flex items-center gap-1 rounded-xl border border-zinc-200 bg-zinc-50 px-2.5 py-1 text-xs font-semibold text-zinc-700 shadow-xs transition hover:bg-zinc-100 active:scale-95"
              @click="openAdjustment(product)"
            >
              <svg class="h-3.5 w-3.5 text-zinc-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
              </svg>
              <span>Adjust Stok</span>
            </button>
          </div>
        </div>
      </div>

      <!-- Empty State -->
      <div
        v-else
        class="rounded-3xl border border-dashed border-zinc-200 bg-white p-8 text-center space-y-2"
      >
        <div class="mx-auto flex h-11 w-11 items-center justify-center rounded-2xl bg-zinc-100 text-zinc-400">
          <AppIcon name="stock" class="h-5 w-5" />
        </div>
        <p class="text-sm font-bold text-ink-primary">
          {{ searchQuery ? 'Produk tidak ditemukan' : 'Belum ada produk inventory' }}
        </p>
        <p class="text-xs text-ink-secondary">
          {{ searchQuery ? 'Coba ubah kata kunci pencarian.' : 'Tambahkan produk pada menu Produk untuk mengelola stok fisik.' }}
        </p>
      </div>
    </section>

    <!-- TAB 2: RIWAYAT MUTASI STOK -->
    <section v-else-if="activeTab === 'movements'" class="space-y-2.5">
      <div v-if="filteredMovements.length" class="space-y-2">
        <div
          v-for="movement in filteredMovements"
          :key="movement.id"
          class="rounded-3xl border border-zinc-200/80 bg-white p-3.5 sm:p-4 shadow-soft space-y-1.5"
        >
          <div class="flex items-start justify-between gap-3">
            <div class="min-w-0">
              <h4 class="font-bold text-xs sm:text-sm text-ink-primary truncate">{{ movement.productName }}</h4>
              <p class="text-[10px] text-ink-secondary mt-0.5">
                {{ movement.category || 'Adjustment' }} &bull; {{ movement.note || 'Tanpa catatan' }}
              </p>
              <span class="text-[10px] text-zinc-400 font-mono">
                {{ formatDateTime(movement.createdAt) }}
              </span>
            </div>

            <div class="text-right shrink-0">
              <p
                class="font-mono text-sm font-bold"
                :class="movement.quantityChange > 0 ? 'text-success' : 'text-danger'"
              >
                {{ movement.quantityChange > 0 ? '+' : '' }}{{ movement.quantityChange }}
              </p>
              <p class="text-[10px] text-zinc-400 font-mono">
                {{ movement.stockBefore }} &rarr; {{ movement.stockAfter }}
              </p>
            </div>
          </div>
        </div>
      </div>

      <!-- Empty State for Movements -->
      <div
        v-else
        class="rounded-3xl border border-dashed border-zinc-200 bg-white p-8 text-center space-y-2"
      >
        <div class="mx-auto flex h-11 w-11 items-center justify-center rounded-2xl bg-zinc-100 text-zinc-400">
          <AppIcon name="stock" class="h-5 w-5" />
        </div>
        <p class="text-sm font-bold text-ink-primary">Belum ada riwayat mutasi</p>
        <p class="text-xs text-ink-secondary">Perubahan stok melalui penjualan atau penyesuaian manual akan tercatat otomatis di sini.</p>
      </div>
    </section>

    <!-- MODAL: ADJUSTMENT STOK MINIMALIS & INTERAKTIF -->
    <BaseModal
      :open="Boolean(adjustingProduct)"
      title="Adjustment Stok"
      @close="closeAdjustment"
    >
      <div v-if="adjustingProduct" class="space-y-3">
        <!-- Target Product Summary -->
        <div class="rounded-2xl bg-surface/70 border border-zinc-100 p-2.5 space-y-0.5">
          <p class="text-[9px] font-bold uppercase tracking-wider text-primary">Target Produk</p>
          <div class="flex items-center justify-between gap-2">
            <h4 class="font-bold text-xs sm:text-sm text-ink-primary truncate">{{ adjustingProduct.name }}</h4>
            <span class="font-mono text-xs font-bold text-ink-secondary shrink-0">
              Stok saat ini: <strong class="text-ink-primary">{{ adjustingProduct.stock }}</strong> {{ adjustingProduct.unit || 'pcs' }}
            </span>
          </div>
        </div>

        <p v-if="adjustmentError" class="rounded-xl bg-danger/10 px-3 py-1.5 text-xs text-danger font-medium">
          {{ adjustmentError }}
        </p>

        <!-- Mode Switcher (Tambah / Kurang / Set) -->
        <div class="space-y-1">
          <label class="text-[11px] font-semibold text-ink-secondary">Jenis Penyesuaian</label>
          <div class="grid grid-cols-3 gap-1 rounded-xl bg-zinc-100 p-1 text-xs">
            <button
              type="button"
              class="py-1 text-center font-semibold rounded-lg transition"
              :class="adjustmentMode === 'add' ? 'bg-white text-emerald-700 shadow-xs' : 'text-zinc-600'"
              @click="adjustmentMode = 'add'"
            >
              + Tambah
            </button>
            <button
              type="button"
              class="py-1 text-center font-semibold rounded-lg transition"
              :class="adjustmentMode === 'subtract' ? 'bg-white text-rose-700 shadow-xs' : 'text-zinc-600'"
              @click="adjustmentMode = 'subtract'"
            >
              - Kurang
            </button>
            <button
              type="button"
              class="py-1 text-center font-semibold rounded-lg transition"
              :class="adjustmentMode === 'set' ? 'bg-white text-primary shadow-xs' : 'text-zinc-600'"
              @click="adjustmentMode = 'set'"
            >
              = Set Total
            </button>
          </div>
        </div>

        <!-- Quantity Input with Quick Increments -->
        <div class="space-y-1">
          <label class="text-[11px] font-semibold text-ink-secondary">
            {{ adjustmentMode === 'set' ? 'Jumlah Stok Akhir' : 'Jumlah Perubahan' }}
          </label>
          <input
            v-model="adjustmentForm.amount"
            type="number"
            :placeholder="adjustmentMode === 'set' ? `Stok baru (${adjustingProduct.stock})` : '0'"
            class="h-9 w-full rounded-xl border border-zinc-200 bg-white px-3 text-xs text-ink-primary shadow-xs outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/10"
          />

          <!-- Quick chips (only for add/subtract) -->
          <div v-if="adjustmentMode !== 'set'" class="flex flex-wrap gap-1 pt-0.5">
            <button
              v-for="qty in QUICK_INCREMENTS"
              :key="qty"
              type="button"
              class="rounded-lg border border-zinc-200 bg-zinc-50 px-2 py-0.5 text-[10px] font-semibold text-zinc-600 transition hover:bg-zinc-100 active:scale-95"
              @click="selectQuickIncrement(qty)"
            >
              +{{ qty }}
            </button>
            <button
              v-if="Number(adjustmentForm.amount) > 0"
              type="button"
              class="rounded-lg border border-rose-200 bg-rose-50 px-2 py-0.5 text-[10px] font-semibold text-rose-600 transition hover:bg-rose-100 active:scale-95"
              @click="adjustmentForm.amount = ''"
            >
              Reset
            </button>
          </div>
        </div>

        <!-- Alasan / Kategori Penyesuaian -->
        <div class="space-y-1">
          <label class="text-[11px] font-semibold text-ink-secondary">Alasan Penyesuaian</label>
          <div class="flex flex-wrap gap-1">
            <button
              v-for="reason in REASON_SUGGESTIONS"
              :key="reason"
              type="button"
              class="rounded-lg border px-2 py-0.5 text-[10px] font-medium transition active:scale-95"
              :class="adjustmentForm.category === reason ? 'border-primary bg-primary text-white font-bold' : 'border-zinc-200 bg-white text-zinc-600'"
              @click="adjustmentForm.category = reason"
            >
              {{ reason }}
            </button>
          </div>
        </div>

        <!-- Final Stock Prediction Box -->
        <div
          v-if="calculatedQuantityChange !== 0"
          class="rounded-xl border p-2 flex items-center justify-between text-xs"
          :class="calculatedQuantityChange > 0 ? 'bg-emerald-50/60 border-emerald-200 text-emerald-800' : 'bg-rose-50/60 border-rose-200 text-rose-800'"
        >
          <span>Hasil:</span>
          <span class="font-mono font-bold text-xs sm:text-sm">
            {{ adjustingProduct.stock }} &rarr; {{ predictedFinalStock }} {{ adjustingProduct.unit || 'pcs' }}
            ({{ calculatedQuantityChange > 0 ? '+' : '' }}{{ calculatedQuantityChange }})
          </span>
        </div>

        <!-- Modal Actions -->
        <div class="flex items-center gap-2 pt-1 border-t border-zinc-100">
          <BaseButton block variant="secondary" @click="closeAdjustment">
            Batal
          </BaseButton>
          <BaseButton block variant="primary" @click="handleStockAdjustment">
            Simpan Perubahan
          </BaseButton>
        </div>
      </div>
    </BaseModal>
  </div>
</template>
