<script setup>
import { computed, onMounted, ref } from 'vue'
import { storeToRefs } from 'pinia'

import BaseButton from '@/components/base/BaseButton.vue'
import BaseCard from '@/components/base/BaseCard.vue'
import BaseInput from '@/components/base/BaseInput.vue'
import BaseModal from '@/components/base/BaseModal.vue'
import { useCloudSessionStore } from '@/stores/cloudSessionStore'
import { useNotificationStore } from '@/stores/notificationStore'
import { useProductStore } from '@/stores/productStore'
import { useSyncPullStore } from '@/stores/syncPullStore'

const cloudStore = useCloudSessionStore()
const notificationStore = useNotificationStore()
const productStore = useProductStore()
const syncPullStore = useSyncPullStore()

const isCashier = computed(
  () => cloudStore.role === 'cashier' || cloudStore.isCashierContext === true,
)

const { categories } = storeToRefs(productStore)

onMounted(async () => {
  if (
    cloudStore.isLinked &&
    cloudStore.isOperationalCloudAccess
  ) {
    try {
      await syncPullStore.ensureCatalogLoaded()
    } catch {
      // Non-blocking fallback
    }
  }
})

const newCategoryName = ref('')
const editingCategory = ref('')
const editCategoryName = ref('')
const message = ref('')
const error = ref('')

const categoryToDelete = ref('')

function resetFeedback() {
  message.value = ''
  error.value = ''
}

function handleCreateCategory() {
  if (isCashier.value) return
  resetFeedback()

  const result = productStore.createCategory(newCategoryName.value)

  if (!result.success) {
    error.value = result.error
    return
  }

  newCategoryName.value = ''
  message.value = 'Kategori berhasil ditambahkan.'
  notificationStore.notifySuccessAndSync({
    title: 'Kategori Ditambahkan',
    message: 'Kategori baru berhasil ditambahkan.',
  })
}

function openEditModal(category) {
  if (isCashier.value) return
  resetFeedback()
  editingCategory.value = category
  editCategoryName.value = category
}

function closeEditModal() {
  editingCategory.value = ''
  editCategoryName.value = ''
}

function handleUpdateCategory() {
  if (isCashier.value) return
  resetFeedback()

  const result = productStore.updateCategory(editingCategory.value, editCategoryName.value)

  if (!result.success) {
    error.value = result.error
    return
  }

  message.value = 'Kategori berhasil diperbarui.'
  closeEditModal()
  notificationStore.notifySuccessAndSync({
    title: 'Kategori Diperbarui',
    message: 'Nama kategori berhasil diperbarui.',
  })
}

function promptDeleteCategory(category) {
  if (isCashier.value) return
  resetFeedback()
  categoryToDelete.value = category
}

function confirmDeleteCategory() {
  if (isCashier.value || !categoryToDelete.value) {
    categoryToDelete.value = ''
    return
  }

  const category = categoryToDelete.value
  categoryToDelete.value = ''
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

    <BaseCard v-if="!isCashier" class="space-y-4">
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
          <button
            type="button"
            class="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-primary text-white shadow-soft transition hover:bg-primary-light active:scale-95 cursor-pointer"
            title="Tambah Kategori"
            aria-label="Tambah Kategori"
            @click="handleCreateCategory"
          >
            <svg class="h-5 w-5" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4" />
            </svg>
            <span class="sr-only">Tambah</span>
          </button>
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

          <div v-if="!isCashier" class="flex flex-wrap gap-2">
            <button
              type="button"
              class="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-zinc-200 bg-white text-ink-secondary transition hover:border-primary/40 hover:text-primary active:scale-95 cursor-pointer"
              title="Edit kategori"
              aria-label="Edit kategori"
              @click="openEditModal(category)"
            >
              <svg class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
              </svg>
              <span class="sr-only">Edit</span>
            </button>
            <button
              type="button"
              class="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-rose-200 bg-rose-50 text-rose-600 transition hover:bg-rose-100 active:scale-95 cursor-pointer"
              title="Hapus kategori"
              aria-label="Hapus kategori"
              @click="promptDeleteCategory(category)"
            >
              <svg class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
              <span class="sr-only">Hapus</span>
            </button>
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

    <!-- Modal Konfirmasi Hapus Kategori -->
    <BaseModal :open="Boolean(categoryToDelete)" title="Hapus Kategori" @close="categoryToDelete = ''">
      <div class="space-y-4">
        <p class="text-sm text-ink-secondary">
          Apakah Anda yakin ingin menghapus kategori <span class="font-bold text-ink-primary">"{{ categoryToDelete }}"</span>?
        </p>

        <div class="flex flex-wrap gap-3">
          <BaseButton variant="danger" @click="confirmDeleteCategory">Hapus</BaseButton>
          <BaseButton variant="secondary" @click="categoryToDelete = ''">Batal</BaseButton>
        </div>
      </div>
    </BaseModal>
  </div>
</template>
