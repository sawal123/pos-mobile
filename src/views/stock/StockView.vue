<script setup>
import { computed, reactive, ref } from 'vue'

import BaseButton from '@/components/base/BaseButton.vue'
import BaseCard from '@/components/base/BaseCard.vue'
import BaseInput from '@/components/base/BaseInput.vue'
import BaseModal from '@/components/base/BaseModal.vue'
import { useProductStore } from '@/stores/productStore'
import { formatDateTime } from '@/utils/formatters'

const productStore = useProductStore()

const adjustingProduct = ref(null)
const adjustmentForm = reactive({
  quantityChange: '',
  note: '',
})
const adjustmentError = ref('')

const inventoryProducts = computed(() => productStore.products.filter((product) => (product.kind ?? 'product') !== 'service'))

function isLowStock(product) {
  return Number(product.minStock || 0) > 0 && Number(product.stock || 0) <= Number(product.minStock || 0)
}

function openAdjustment(product) {
  adjustingProduct.value = product
  adjustmentForm.quantityChange = ''
  adjustmentForm.note = ''
  adjustmentError.value = ''
}

function closeAdjustment() {
  adjustingProduct.value = null
}

function handleStockAdjustment() {
  if (!adjustingProduct.value) {
    return
  }

  const result = productStore.adjustStock(adjustingProduct.value.id, {
    quantityChange: adjustmentForm.quantityChange,
    category: 'Adjustment Manual',
    note: adjustmentForm.note,
  })

  if (!result.success) {
    adjustmentError.value = result.error
    return
  }

  closeAdjustment()
}
</script>

<template>
  <div class="space-y-5">
    <div class="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
      <div>
        <p class="text-sm font-medium uppercase tracking-[0.18em] text-primary">Stock Management</p>
        <h2 class="mt-2 text-2xl font-semibold text-ink-primary">Inventory produk</h2>
      </div>
      <div class="rounded-2xl bg-card px-4 py-3 text-sm text-ink-secondary shadow-soft">
        <span class="font-semibold text-ink-primary">{{ productStore.lowStockProducts.length }}</span>
        stok minimum
      </div>
    </div>

    <BaseCard class="space-y-4">
      <div class="flex items-center justify-between gap-3">
        <h3 class="text-lg font-semibold text-ink-primary">Daftar Stok</h3>
        <span class="shrink-0 text-sm text-ink-secondary">{{ inventoryProducts.length }} produk</span>
      </div>

      <div v-if="inventoryProducts.length" class="space-y-3">
        <div
          v-for="product in inventoryProducts"
          :key="product.id"
          :data-testid="`stock-product-${product.id}`"
          class="rounded-2xl border border-zinc-200 bg-white p-4"
        >
          <div class="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div class="min-w-0 space-y-2">
              <div class="flex flex-wrap items-center gap-2">
                <h3 class="text-lg font-semibold text-ink-primary">{{ product.name }}</h3>
                <span
                  v-if="isLowStock(product)"
                  class="rounded-full bg-amber-100 px-3 py-1 text-xs font-medium text-warning"
                >
                  Low stock
                </span>
                <span
                  v-if="product.isActive === false"
                  class="rounded-full bg-zinc-100 px-3 py-1 text-xs font-medium text-zinc-600"
                >
                  Inactive
                </span>
              </div>
              <div class="grid gap-2 text-sm text-ink-secondary sm:grid-cols-3">
                <span>Stok saat ini: <strong class="text-ink-primary">{{ product.stock }}</strong></span>
                <span>Satuan: <strong class="text-ink-primary">{{ product.unit || 'pcs' }}</strong></span>
                <span>Stok minimum: <strong class="text-ink-primary">{{ product.minStock || 0 }}</strong></span>
              </div>
            </div>

            <BaseButton class="shrink-0" variant="secondary" @click="openAdjustment(product)">
              Adjust Stok
            </BaseButton>
          </div>
        </div>
      </div>

      <p v-else class="rounded-2xl border border-dashed border-zinc-200 p-6 text-center text-sm text-ink-secondary">
        Belum ada produk inventory.
      </p>
    </BaseCard>

    <BaseCard class="space-y-4">
      <div class="flex items-center justify-between gap-3">
        <h3 class="text-lg font-semibold text-ink-primary">Riwayat Stock Movement</h3>
        <span class="shrink-0 text-sm text-ink-secondary">{{ productStore.stockMovements.length }} perubahan</span>
      </div>

      <div v-if="productStore.stockMovements.length" class="space-y-3">
        <div
          v-for="movement in productStore.stockMovements"
          :key="movement.id"
          class="flex flex-col gap-2 rounded-2xl border border-zinc-200 bg-white p-4 md:flex-row md:items-center md:justify-between"
        >
          <div>
            <p class="font-medium text-ink-primary">{{ movement.productName }}</p>
            <p class="text-sm text-ink-secondary">
              {{ movement.category }} &bull; {{ movement.note || '-' }} &bull; {{ formatDateTime(movement.createdAt) }}
            </p>
          </div>
          <div class="text-sm font-semibold" :class="movement.quantityChange > 0 ? 'text-success' : 'text-danger'">
            {{ movement.quantityChange > 0 ? '+' : '' }}{{ movement.quantityChange }}
            <span class="text-ink-secondary">({{ movement.stockBefore }} -> {{ movement.stockAfter }})</span>
          </div>
        </div>
      </div>

      <p v-else class="text-sm text-ink-secondary">Belum ada perubahan stok.</p>
    </BaseCard>

    <BaseModal :open="Boolean(adjustingProduct)" title="Adjustment Stok" @close="closeAdjustment">
      <div class="space-y-4">
        <p v-if="adjustingProduct" class="text-sm text-ink-secondary">
          {{ adjustingProduct.name }} &bull; Stok saat ini {{ adjustingProduct.stock }} {{ adjustingProduct.unit || 'pcs' }}
        </p>
        <p v-if="adjustmentError" class="rounded-2xl bg-danger/10 px-4 py-3 text-sm text-danger">
          {{ adjustmentError }}
        </p>
        <BaseInput
          :model-value="adjustmentForm.quantityChange"
          label="Perubahan Stok"
          type="number"
          placeholder="Contoh: 10 atau -2"
          @update:model-value="adjustmentForm.quantityChange = $event"
        />
        <BaseInput
          :model-value="adjustmentForm.note"
          label="Catatan"
          placeholder="Modal, koreksi stok, barang rusak"
          @update:model-value="adjustmentForm.note = $event"
        />
        <div class="flex flex-wrap gap-3">
          <BaseButton @click="handleStockAdjustment">Simpan Adjustment</BaseButton>
          <BaseButton variant="secondary" @click="closeAdjustment">Batal</BaseButton>
        </div>
      </div>
    </BaseModal>
  </div>
</template>
