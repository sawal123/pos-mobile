<script setup>
import { ref } from 'vue'
import { storeToRefs } from 'pinia'

import BaseButton from '@/components/base/BaseButton.vue'
import BaseCard from '@/components/base/BaseCard.vue'
import BaseInput from '@/components/base/BaseInput.vue'
import BaseModal from '@/components/base/BaseModal.vue'
import { useProductStore } from '@/stores/productStore'

const productStore = useProductStore()

const { categories } = storeToRefs(productStore)

const newCategoryName = ref('')
const editingCategory = ref('')
const editCategoryName = ref('')
const message = ref('')
const error = ref('')

function resetFeedback() {
  message.value = ''
  error.value = ''
}

function handleCreateCategory() {
  resetFeedback()

  const result = productStore.createCategory(newCategoryName.value)

  if (!result.success) {
    error.value = result.error
    return
  }

  newCategoryName.value = ''
  message.value = 'Kategori berhasil ditambahkan.'
}

function openEditModal(category) {
  resetFeedback()
  editingCategory.value = category
  editCategoryName.value = category
}

function closeEditModal() {
  editingCategory.value = ''
  editCategoryName.value = ''
}

function handleUpdateCategory() {
  resetFeedback()

  const result = productStore.updateCategory(editingCategory.value, editCategoryName.value)

  if (!result.success) {
    error.value = result.error
    return
  }

  message.value = 'Kategori berhasil diperbarui.'
  closeEditModal()
}

function handleDeleteCategory(category) {
  resetFeedback()

  if (!window.confirm(`Hapus kategori "${category}"?`)) {
    return
  }

  const result = productStore.deleteCategory(category)

  if (!result.success) {
    error.value = result.error
    return
  }

  message.value = 'Kategori berhasil dihapus.'
}
</script>

<template>
  <div class="space-y-6">
    <section>
      <p class="text-sm font-medium uppercase tracking-[0.18em] text-primary">Category Management</p>
      <h1 class="mt-2 text-3xl font-semibold text-ink-primary">Daftar Kategori</h1>
      <p class="mt-2 text-sm text-ink-secondary">
        Tambah, ubah, dan hapus kategori bisnis yang dipakai produk.
      </p>
    </section>

    <BaseCard class="space-y-4">
      <div class="flex items-center justify-between">
        <h2 class="text-lg font-semibold text-ink-primary">Tambah Kategori</h2>
      </div>

      <p v-if="message" class="rounded-2xl bg-emerald-100 px-4 py-3 text-sm text-emerald-700">
        {{ message }}
      </p>
      <p v-if="error" class="rounded-2xl bg-danger/10 px-4 py-3 text-sm text-danger">
        {{ error }}
      </p>

      <div class="flex flex-col gap-3 md:flex-row">
        <BaseInput
          :model-value="newCategoryName"
          label="Category Name"
          placeholder="Masukkan nama kategori"
          @update:model-value="newCategoryName = $event"
        />
        <div class="md:pt-8">
          <BaseButton @click="handleCreateCategory">Tambah</BaseButton>
        </div>
      </div>
    </BaseCard>

    <BaseCard class="space-y-4">
      <div class="flex items-center justify-between">
        <h2 class="text-lg font-semibold text-ink-primary">Semua Kategori</h2>
        <span class="text-sm text-ink-secondary">{{ categories.length }} kategori</span>
      </div>

      <div v-if="categories.length" class="space-y-3">
        <div
          v-for="category in categories"
          :key="category"
          class="flex flex-col gap-3 rounded-2xl border border-zinc-200 bg-white p-4 md:flex-row md:items-center md:justify-between"
        >
          <div>
            <h3 class="text-base font-semibold text-ink-primary">{{ category }}</h3>
            <p class="text-sm text-ink-secondary">Kategori ini tersedia untuk form produk dan filter POS.</p>
          </div>

          <div class="flex flex-wrap gap-2">
            <BaseButton size="sm" variant="secondary" @click="openEditModal(category)">Edit</BaseButton>
            <BaseButton size="sm" variant="danger" @click="handleDeleteCategory(category)">Delete</BaseButton>
          </div>
        </div>
      </div>

      <div v-else class="rounded-2xl border border-dashed border-zinc-200 p-6 text-center text-sm text-ink-secondary">
        Belum ada kategori.
      </div>
    </BaseCard>

    <BaseModal :open="Boolean(editingCategory)" title="Edit Category" @close="closeEditModal">
      <div class="space-y-4">
        <BaseInput
          :model-value="editCategoryName"
          label="Category Name"
          placeholder="Masukkan nama kategori"
          @update:model-value="editCategoryName = $event"
        />

        <div class="flex flex-wrap gap-3">
          <BaseButton @click="handleUpdateCategory">Simpan</BaseButton>
          <BaseButton variant="secondary" @click="closeEditModal">Batal</BaseButton>
        </div>
      </div>
    </BaseModal>
  </div>
</template>
