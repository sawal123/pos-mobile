<script setup>
import { computed, reactive, ref } from 'vue'
import { storeToRefs } from 'pinia'
import { useRouter } from 'vue-router'

import BaseButton from '@/components/base/BaseButton.vue'
import BaseCard from '@/components/base/BaseCard.vue'
import BaseInput from '@/components/base/BaseInput.vue'
import BaseModal from '@/components/base/BaseModal.vue'
import { useBusinessStore } from '@/stores/businessStore'
import { useProductStore } from '@/stores/productStore'
import { formatCurrency, formatDateTime } from '@/utils/formatters'

const businessStore = useBusinessStore()
const productStore = useProductStore()
const router = useRouter()

const { products, stockMovements } = storeToRefs(productStore)
const adjustingProduct = ref(null)
const adjustmentForm = reactive({
  quantityChange: '',
  note: '',
})
const adjustmentError = ref('')

const isLaundry = computed(() => businessStore.normalizedType === 'Laundry')

function handleToggle(product) {
  productStore.toggleProductActive(product.id)
}

function handleDelete(product) {
  if (!window.confirm(`Hapus produk "${product.name}"?`)) {
    return
  }

  productStore.deleteProduct(product.id)
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
  <div class="space-y-6">
    <section class="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
      <div>
        <p class="text-sm font-medium uppercase tracking-[0.18em] text-primary">Product Management</p>
        <h1 class="mt-2 text-3xl font-semibold text-ink-primary">
          {{ isLaundry ? 'Daftar Layanan' : 'Daftar Produk' }}
        </h1>
        <p class="mt-2 text-sm text-ink-secondary">
          {{ isLaundry ? 'Kelola layanan laundry aktif yang tampil di POS.' : 'Kelola produk aktif, stok, dan status tampil di POS.' }}
        </p>
      </div>

      <div class="flex flex-wrap gap-3">
        <BaseButton variant="secondary" @click="goToCategories">Kelola Kategori</BaseButton>
        <BaseButton @click="goToCreate">{{ isLaundry ? 'Tambah Layanan' : 'Tambah Produk' }}</BaseButton>
      </div>
    </section>

    <BaseCard class="space-y-4">
      <div class="flex items-center justify-between">
        <h2 class="text-lg font-semibold text-ink-primary">Semua Produk</h2>
        <span class="text-sm text-ink-secondary">{{ products.length }} {{ isLaundry ? 'layanan' : 'produk' }}</span>
      </div>

      <div v-if="products.length" class="space-y-3">
        <div
          v-for="product in products"
          :key="product.id"
          class="rounded-2xl border border-zinc-200 bg-white p-4"
        >
          <div class="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div class="space-y-2">
              <div class="flex flex-wrap items-center gap-2">
                <h3 class="text-lg font-semibold text-ink-primary">{{ product.name }}</h3>
                <span
                  class="rounded-full px-3 py-1 text-xs font-medium"
                  :class="product.isActive ? 'bg-emerald-100 text-emerald-700' : 'bg-zinc-100 text-zinc-600'"
                >
                  {{ product.isActive ? 'Active' : 'Inactive' }}
                </span>
              </div>

              <div class="flex flex-wrap gap-4 text-sm text-ink-secondary">
                <span>Kategori: {{ product.category }}</span>
                <span>{{ isLaundry ? 'Harga/unit' : 'Harga' }}: {{ formatCurrency(product.price) }}</span>
                <span>HPP: {{ formatCurrency(product.cost || 0) }}</span>
                <span v-if="product.kind === 'service'">Unit: {{ product.pricingUnit }}</span>
                <span v-else>Stok: {{ product.stock }} {{ product.unit || 'pcs' }}</span>
                <span
                  v-if="product.kind !== 'service' && Number(product.minStock || 0) > 0 && Number(product.stock || 0) <= Number(product.minStock || 0)"
                  class="font-medium text-warning"
                >
                  Stok minimum
                </span>
              </div>
            </div>

            <div class="flex flex-wrap gap-2">
              <BaseButton size="sm" variant="secondary" @click="goToEdit(product)">Edit</BaseButton>
              <BaseButton
                v-if="product.kind !== 'service'"
                size="sm"
                variant="secondary"
                @click="openAdjustment(product)"
              >
                Adjust Stok
              </BaseButton>
              <BaseButton size="sm" variant="ghost" @click="handleToggle(product)">
                {{ product.isActive ? 'Inactive' : 'Activate' }}
              </BaseButton>
              <BaseButton size="sm" variant="danger" @click="handleDelete(product)">Delete</BaseButton>
            </div>
          </div>
        </div>
      </div>

      <div v-else class="rounded-2xl border border-dashed border-zinc-200 p-6 text-center text-sm text-ink-secondary">
        Belum ada {{ isLaundry ? 'layanan' : 'produk' }} yang tersedia.
      </div>
    </BaseCard>

    <BaseCard v-if="!isLaundry" class="space-y-4">
      <div class="flex items-center justify-between">
        <h2 class="text-lg font-semibold text-ink-primary">Riwayat Stok</h2>
        <span class="text-sm text-ink-secondary">{{ stockMovements.length }} perubahan</span>
      </div>

      <div v-if="stockMovements.length" class="space-y-3">
        <div
          v-for="movement in stockMovements.slice(0, 8)"
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
