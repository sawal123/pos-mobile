<script setup>
import { computed } from 'vue'
import { useRouter } from 'vue-router'

import BaseButton from '@/components/base/BaseButton.vue'
import BaseCard from '@/components/base/BaseCard.vue'
import { useBusinessStore } from '@/stores/businessStore'
import { useProductStore } from '@/stores/productStore'
import { formatCurrency } from '@/utils/formatters'

const businessStore = useBusinessStore()
const productStore = useProductStore()
const router = useRouter()

const isLaundry = computed(() => businessStore.normalizedType === 'Laundry')
const products = computed(() => productStore.products)

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
          {{ isLaundry ? 'Kelola master layanan laundry yang tampil di POS.' : 'Kelola master produk, HPP, harga, SKU, dan status tampil di POS.' }}
        </p>
      </div>

      <div class="flex flex-wrap gap-3">
        <BaseButton variant="secondary" @click="goToCategories">Kelola Kategori</BaseButton>
        <BaseButton @click="goToCreate">{{ isLaundry ? 'Tambah Layanan' : 'Tambah Produk' }}</BaseButton>
      </div>
    </section>

    <BaseCard class="space-y-4">
      <div class="flex items-center justify-between">
        <h2 class="text-lg font-semibold text-ink-primary">{{ isLaundry ? 'Semua Layanan' : 'Semua Produk' }}</h2>
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
                <span>SKU: {{ product.sku || '-' }}</span>
                <span>HPP: {{ formatCurrency(product.cost || 0) }}</span>
                <span>{{ isLaundry ? 'Harga/unit' : 'Harga' }}: {{ formatCurrency(product.price) }}</span>
                <span v-if="product.kind === 'service'">Unit: {{ product.pricingUnit }}</span>
              </div>
            </div>

            <div class="flex flex-wrap gap-2">
              <BaseButton size="sm" variant="secondary" @click="goToEdit(product)">Edit</BaseButton>
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
  </div>
</template>
