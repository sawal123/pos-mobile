<script setup>
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'

import AppIcon from '@/components/base/AppIcon.vue'
import BaseButton from '@/components/base/BaseButton.vue'
import BaseCard from '@/components/base/BaseCard.vue'
import BaseInput from '@/components/base/BaseInput.vue'
import BaseModal from '@/components/base/BaseModal.vue'
import { useCloudSessionStore } from '@/stores/cloudSessionStore'
import { useUnitStore } from '@/stores/unitStore'

const router = useRouter()
const cloudStore = useCloudSessionStore()
const unitStore = useUnitStore()

const isCashier = computed(
  () => cloudStore.role === 'cashier' || cloudStore.isCashierContext === true,
)

const searchQuery = ref('')
const newUnitName = ref('')
const editingUnit = ref('')
const editUnitName = ref('')
const unitToDelete = ref('')
const isForceDelete = ref(false)

const message = ref('')
const error = ref('')

const isAddModalOpen = ref(false)
const isEditModalOpen = ref(false)
const isDeleteModalOpen = ref(false)

function resetFeedback() {
  message.value = ''
  error.value = ''
}

const filteredUnits = computed(() => {
  const query = searchQuery.value.trim().toLowerCase()
  if (!query) {
    return unitStore.sortedUnits
  }
  return unitStore.sortedUnits.filter((u) => u.toLowerCase().includes(query))
})

const totalUnitsCount = computed(() => unitStore.units.length)
const usedUnitsCount = computed(() => {
  return unitStore.units.filter((u) => unitStore.getUnitUsage(u) > 0).length
})

function openAddModal() {
  if (isCashier.value) return
  resetFeedback()
  newUnitName.value = ''
  isAddModalOpen.value = true
}

function handleCreateUnit() {
  if (isCashier.value) return
  resetFeedback()

  const result = unitStore.createUnit(newUnitName.value)
  if (!result.success) {
    error.value = result.error
    return
  }

  message.value = `Satuan "${result.unit}" berhasil ditambahkan.`
  newUnitName.value = ''
  isAddModalOpen.value = false
}

function openEditModal(unit) {
  if (isCashier.value) return
  resetFeedback()
  editingUnit.value = unit
  editUnitName.value = unit
  isEditModalOpen.value = true
}

function handleUpdateUnit() {
  if (isCashier.value) return
  resetFeedback()

  const result = unitStore.updateUnit(editingUnit.value, editUnitName.value)
  if (!result.success) {
    error.value = result.error
    return
  }

  const updatedMsg = result.updatedProductsCount > 0
    ? ` dan ${result.updatedProductsCount} produk diperbarui.`
    : '.'
  message.value = `Satuan "${editingUnit.value}" berhasil diubah menjadi "${result.unit}"${updatedMsg}`
  editingUnit.value = ''
  editUnitName.value = ''
  isEditModalOpen.value = false
}

function openDeleteModal(unit) {
  if (isCashier.value) return
  resetFeedback()
  unitToDelete.value = unit
  isForceDelete.value = false
  isDeleteModalOpen.value = true
}

function handleDeleteUnit() {
  if (isCashier.value) return
  resetFeedback()

  const result = unitStore.deleteUnit(unitToDelete.value, isForceDelete.value)
  if (!result.success) {
    if (result.inUse && !isForceDelete.value) {
      isForceDelete.value = true
      error.value = `${result.error} Klik "Tetap Hapus" jika yakin ingin menghapusnya dari daftar master.`
      return
    }
    error.value = result.error
    return
  }

  message.value = `Satuan "${unitToDelete.value}" berhasil dihapus.`
  unitToDelete.value = ''
  isForceDelete.value = false
  isDeleteModalOpen.value = false
}

function goBack() {
  if (window.history.length > 1) {
    router.back()
  } else {
    router.push({ name: 'products' })
  }
}
</script>

<template>
  <div class="mx-auto flex w-full max-w-5xl flex-col gap-5 p-4 sm:p-6 pb-24">
    <!-- Top Bar Navigation -->
    <header class="flex items-center justify-between gap-3">
      <div class="flex items-center gap-3">
        <button
          type="button"
          class="flex h-10 w-10 items-center justify-center rounded-2xl border border-zinc-200/80 bg-white text-ink-primary shadow-soft hover:bg-zinc-50 active:scale-95 dark:border-slate-800 dark:bg-slate-900 dark:text-white"
          aria-label="Kembali"
          @click="goBack"
        >
          <AppIcon name="arrow-left" class="h-4 w-4" />
        </button>
        <div>
          <h1 class="text-xl sm:text-2xl font-bold tracking-tight text-ink-primary dark:text-white">
            Master Satuan (Units)
          </h1>
          <p class="text-xs text-ink-secondary">
            Kelola satuan takaran dan penjualan (seperti ml, gr, pcs, pack, cup)
          </p>
        </div>
      </div>

      <BaseButton
        v-if="!isCashier"
        data-testid="add-unit-button"
        size="sm"
        class="gap-1.5 shadow-sm shadow-primary/20"
        @click="openAddModal"
      >
        <span class="text-base font-bold leading-none">+</span>
        <span>Tambah Satuan</span>
      </BaseButton>
    </header>

    <!-- Cashier Readonly Alert -->
    <div
      v-if="isCashier"
      class="flex items-center gap-2 rounded-2xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-300"
    >
      <AppIcon name="lock" class="h-4 w-4 shrink-0" />
      <span>Mode Kasir: Anda hanya dapat melihat daftar satuan master. Pengubahan master satuan dibatasi untuk Pemilik/Admin.</span>
    </div>

    <!-- Feedback Message / Error -->
    <div
      v-if="message"
      class="flex items-center justify-between rounded-2xl border border-emerald-200 bg-emerald-50 p-3.5 text-xs font-medium text-emerald-800 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-300"
    >
      <span>{{ message }}</span>
      <button type="button" class="text-emerald-700 hover:text-emerald-900" @click="message = ''">✕</button>
    </div>

    <div
      v-if="error"
      class="flex items-center justify-between rounded-2xl border border-rose-200 bg-rose-50 p-3.5 text-xs font-medium text-rose-800 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-300"
    >
      <span>{{ error }}</span>
      <button type="button" class="text-rose-700 hover:text-rose-900" @click="error = ''">✕</button>
    </div>

    <!-- Summary Stats -->
    <div class="grid grid-cols-2 sm:grid-cols-3 gap-3">
      <BaseCard class="p-3.5">
        <span class="text-[11px] font-semibold text-ink-secondary">Total Satuan</span>
        <p class="mt-1 text-2xl font-bold font-mono text-ink-primary dark:text-white" data-testid="total-units-count">
          {{ totalUnitsCount }}
        </p>
      </BaseCard>

      <BaseCard class="p-3.5">
        <span class="text-[11px] font-semibold text-ink-secondary">Sedang Digunakan</span>
        <p class="mt-1 text-2xl font-bold font-mono text-emerald-600 dark:text-emerald-400">
          {{ usedUnitsCount }}
        </p>
      </BaseCard>

      <BaseCard class="col-span-2 sm:col-span-1 p-3.5">
        <span class="text-[11px] font-semibold text-ink-secondary">Contoh Satuan Standar</span>
        <p class="mt-1 text-xs text-ink-secondary font-mono truncate">
          ml, gr, pcs, gram, kg, cup...
        </p>
      </BaseCard>
    </div>

    <!-- Search Bar -->
    <div class="relative">
      <BaseInput
        v-model="searchQuery"
        placeholder="Cari satuan (misal: ml, gr, pcs)..."
        class="w-full pl-3"
      />
    </div>

    <!-- Units Grid / List -->
    <div v-if="filteredUnits.length > 0" class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
      <article
        v-for="unit in filteredUnits"
        :key="unit"
        data-testid="unit-item-card"
        class="group flex items-center justify-between gap-3 rounded-2xl border border-zinc-200/80 bg-white p-3.5 shadow-soft transition hover:border-primary/40 dark:border-slate-800 dark:bg-slate-900"
      >
        <div class="flex items-center gap-3 min-w-0">
          <div
            class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-50 font-mono text-sm font-black uppercase text-primary dark:bg-indigo-950/60 dark:text-indigo-400"
          >
            {{ unit.slice(0, 3) }}
          </div>
          <div class="min-w-0">
            <h3 class="font-bold text-sm text-ink-primary dark:text-white truncate">
              {{ unit }}
            </h3>
            <span
              class="inline-block text-[11px]"
              :class="unitStore.getUnitUsage(unit) > 0 ? 'text-emerald-600 dark:text-emerald-400 font-semibold' : 'text-ink-secondary'"
            >
              {{ unitStore.getUnitUsage(unit) > 0 ? `${unitStore.getUnitUsage(unit)} produk memakai` : 'Belum digunakan' }}
            </span>
          </div>
        </div>

        <div v-if="!isCashier" class="flex items-center gap-1 shrink-0">
          <button
            type="button"
            class="flex h-8 w-8 items-center justify-center rounded-lg border border-zinc-200 text-ink-secondary hover:border-primary hover:text-primary dark:border-slate-700 dark:text-slate-400"
            title="Edit satuan"
            @click="openEditModal(unit)"
          >
            <AppIcon name="edit" class="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            class="flex h-8 w-8 items-center justify-center rounded-lg border border-zinc-200 text-ink-secondary hover:border-red-500 hover:text-red-600 dark:border-slate-700 dark:text-slate-400"
            title="Hapus satuan"
            @click="openDeleteModal(unit)"
          >
            <AppIcon name="delete" class="h-3.5 w-3.5" />
          </button>
        </div>
      </article>
    </div>

    <!-- Empty State -->
    <div
      v-else
      class="flex flex-col items-center justify-center rounded-3xl border border-dashed border-zinc-200 p-10 text-center dark:border-slate-800"
    >
      <div class="flex h-14 w-14 items-center justify-center rounded-2xl bg-zinc-100 text-ink-secondary dark:bg-slate-800">
        <AppIcon name="package" class="h-6 w-6" />
      </div>
      <h3 class="mt-3 text-sm font-bold text-ink-primary dark:text-white">
        Satuan tidak ditemukan
      </h3>
      <p class="mt-1 text-xs text-ink-secondary max-w-xs">
        Tidak ada data satuan yang cocok dengan kata kunci "{{ searchQuery }}".
      </p>
      <BaseButton
        v-if="!isCashier && searchQuery"
        size="sm"
        variant="secondary"
        class="mt-4"
        @click="newUnitName = searchQuery; isAddModalOpen = true"
      >
        Tambah "{{ searchQuery }}" Sekarang
      </BaseButton>
    </div>

    <!-- Modal: Tambah Satuan -->
    <BaseModal
      :open="isAddModalOpen"
      title="Tambah Satuan Baru"
      @close="isAddModalOpen = false"
    >
      <form class="space-y-4" @submit.prevent="handleCreateUnit">
        <BaseInput
          v-model="newUnitName"
          label="Nama Satuan"
          placeholder="Contoh: ml, gr, pcs, karton, porsi"
          required
          autofocus
        />
        <p class="text-[11px] text-ink-secondary">
          Nama satuan akan otomatis dinormalisasi menjadi huruf kecil dan dapat langsung dipilih pada formulir produk dan resep.
        </p>

        <div class="flex items-center justify-end gap-2 pt-2">
          <BaseButton
            type="button"
            variant="ghost"
            size="sm"
            @click="isAddModalOpen = false"
          >
            Batal
          </BaseButton>
          <BaseButton
            type="submit"
            size="sm"
            :disabled="!newUnitName.trim()"
          >
            Simpan Satuan
          </BaseButton>
        </div>
      </form>
    </BaseModal>

    <!-- Modal: Edit Satuan -->
    <BaseModal
      :open="isEditModalOpen"
      title="Ubah Satuan"
      @close="isEditModalOpen = false"
    >
      <form class="space-y-4" @submit.prevent="handleUpdateUnit">
        <div>
          <label class="block text-xs font-semibold text-ink-secondary mb-1">Satuan Saat Ini</label>
          <p class="font-mono font-bold text-sm text-ink-primary dark:text-white">{{ editingUnit }}</p>
        </div>

        <BaseInput
          v-model="editUnitName"
          label="Nama Satuan Baru"
          placeholder="Nama satuan baru..."
          required
          autofocus
        />

        <div
          v-if="unitStore.getUnitUsage(editingUnit) > 0"
          class="rounded-xl border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-300"
        >
          Satuan ini sedang dipakai oleh {{ unitStore.getUnitUsage(editingUnit) }} produk. Mengubah nama satuan akan otomatis memperbarui seluruh produk terkait.
        </div>

        <div class="flex items-center justify-end gap-2 pt-2">
          <BaseButton
            type="button"
            variant="ghost"
            size="sm"
            @click="isEditModalOpen = false"
          >
            Batal
          </BaseButton>
          <BaseButton
            type="submit"
            size="sm"
            :disabled="!editUnitName.trim() || editUnitName.trim().toLowerCase() === editingUnit.toLowerCase()"
          >
            Simpan Perubahan
          </BaseButton>
        </div>
      </form>
    </BaseModal>

    <!-- Modal: Hapus Satuan -->
    <BaseModal
      :open="isDeleteModalOpen"
      title="Hapus Satuan"
      @close="isDeleteModalOpen = false"
    >
      <div class="space-y-4">
        <p class="text-sm text-ink-primary dark:text-white">
          Apakah Anda yakin ingin menghapus satuan <strong class="font-mono text-red-600">{{ unitToDelete }}</strong> dari master data?
        </p>

        <div
          v-if="unitStore.getUnitUsage(unitToDelete) > 0"
          class="rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-800 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300"
        >
          <strong>Peringatan:</strong> Satuan ini saat ini digunakan oleh {{ unitStore.getUnitUsage(unitToDelete) }} produk aktif!
        </div>

        <div class="flex items-center justify-end gap-2 pt-2">
          <BaseButton
            type="button"
            variant="ghost"
            size="sm"
            @click="isDeleteModalOpen = false"
          >
            Batal
          </BaseButton>
          <BaseButton
            type="button"
            size="sm"
            class="bg-red-600 hover:bg-red-700 text-white"
            @click="handleDeleteUnit"
          >
            {{ isForceDelete ? 'Tetap Hapus' : 'Hapus Satuan' }}
          </BaseButton>
        </div>
      </div>
    </BaseModal>
  </div>
</template>
