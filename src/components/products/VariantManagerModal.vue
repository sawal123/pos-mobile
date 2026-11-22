<script setup>
import { computed, reactive, ref } from 'vue'

import AppIcon from '@/components/base/AppIcon.vue'
import BaseButton from '@/components/base/BaseButton.vue'
import BaseInput from '@/components/base/BaseInput.vue'
import BaseModal from '@/components/base/BaseModal.vue'
import { useVariantStore } from '@/stores/variantStore'
import { formatCurrency } from '@/utils/formatters'

const props = defineProps({
  open: {
    type: Boolean,
    default: false,
  },
})

const emit = defineEmits(['close'])

const variantStore = useVariantStore()
const activeGroups = computed(() => variantStore.activeGroups || [])

// 'list' | 'create' | 'edit'
const mode = ref('list')
const editingGroupId = ref(null)

const groupForm = reactive({
  name: '',
  selectionType: 'single', // 'single' | 'multiple'
  isRequired: true,
  options: [
    { name: '', priceAdjustment: 0, costAdjustment: 0 },
    { name: '', priceAdjustment: 0, costAdjustment: 0 },
  ],
})

const formError = ref('')

function generateUniqueId(prefix = 'vg') {
  if (globalThis.crypto?.randomUUID) {
    return `${prefix}-${globalThis.crypto.randomUUID()}`
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`
}

function openCreate() {
  editingGroupId.value = null
  groupForm.name = ''
  groupForm.selectionType = 'single'
  groupForm.isRequired = true
  groupForm.options = [
    { name: '', priceAdjustment: 0, costAdjustment: 0 },
    { name: '', priceAdjustment: 0, costAdjustment: 0 },
  ]
  formError.value = ''
  mode.value = 'create'
}

function openEdit(group) {
  editingGroupId.value = group.id || group.syncId
  groupForm.name = group.name || ''
  groupForm.selectionType = group.selectionType || 'single'
  groupForm.isRequired = group.isRequired !== false
  groupForm.options = (group.options || []).map((opt) => ({
    id: opt.id,
    name: opt.name || '',
    priceAdjustment: Number(opt.priceAdjustment || 0),
    costAdjustment: Number(opt.costAdjustment || 0),
  }))
  if (groupForm.options.length === 0) {
    groupForm.options.push({ name: '', priceAdjustment: 0, costAdjustment: 0 })
  }
  formError.value = ''
  mode.value = 'edit'
}

function addOption() {
  groupForm.options.push({ name: '', priceAdjustment: 0, costAdjustment: 0 })
}

function removeOption(idx) {
  if (groupForm.options.length <= 1) {
    formError.value = 'Minimal harus memiliki 1 opsi varian.'
    return
  }
  groupForm.options.splice(idx, 1)
}

function handleSave() {
  formError.value = ''
  const trimmedName = groupForm.name.trim()
  if (!trimmedName) {
    formError.value = 'Nama grup varian wajib diisi.'
    return
  }

  const validOptions = groupForm.options
    .filter((opt) => opt.name && opt.name.trim())
    .map((opt, i) => ({
      id: opt.id || generateUniqueId('opt'),
      name: opt.name.trim(),
      priceAdjustment: Math.max(0, Number(opt.priceAdjustment || 0)),
      costAdjustment: Math.max(0, Number(opt.costAdjustment || 0)),
      sortOrder: i + 1,
    }))

  if (validOptions.length === 0) {
    formError.value = 'Minimal masukkan 1 nama opsi varian yang valid.'
    return
  }

  const existingGroup = editingGroupId.value
    ? activeGroups.value.find(
        (g) =>
          String(g.id).toLowerCase() === String(editingGroupId.value).toLowerCase() ||
          (g.syncId && String(g.syncId).toLowerCase() === String(editingGroupId.value).toLowerCase()),
      )
    : null

  const id = existingGroup?.id || generateUniqueId('vg')
  const syncId = existingGroup?.syncId || id

  const groupPayload = {
    id,
    syncId,
    name: trimmedName,
    selectionType: groupForm.selectionType,
    isRequired: groupForm.isRequired,
    minSelection: groupForm.isRequired ? 1 : 0,
    maxSelection: groupForm.selectionType === 'single' ? 1 : null,
    sortOrder: existingGroup?.sortOrder ?? activeGroups.value.length + 1,
    status: 'active',
    options: validOptions,
    updatedAt: new Date().toISOString(),
  }

  variantStore.upsertGroup(groupPayload)
  mode.value = 'list'
}

function handleDeleteGroup(group) {
  const targetId = group.id || group.syncId
  if (confirm(`Yakin ingin menghapus template varian "${group.name}"?`)) {
    variantStore.removeGroup(targetId)
  }
}

function handleClose() {
  mode.value = 'list'
  emit('close')
}
</script>

<template>
  <BaseModal
    :open="open"
    :title="
      mode === 'create'
        ? 'Tambah Grup Varian'
        : mode === 'edit'
          ? 'Edit Grup Varian'
          : 'Kelola Varian Menu (POS)'
    "
    @close="handleClose"
  >
    <!-- 1. LIST MODE -->
    <div v-if="mode === 'list'" class="space-y-4" data-testid="variant-manager-list">
      <div class="flex items-center justify-between gap-3">
        <div class="min-w-0">
          <p class="text-xs font-medium text-ink-secondary">
            Atur pilihan varian seperti ukuran cup, suhu, topping, dan level gula untuk menu kasir.
          </p>
        </div>
        <BaseButton
          size="sm"
          data-testid="btn-add-variant-group"
          class="shrink-0 text-xs font-bold"
          @click="openCreate"
        >
          <AppIcon name="variants" class="h-3.5 w-3.5" />
          <span>+ Tambah Varian</span>
        </BaseButton>
      </div>

      <!-- Empty State -->
      <div
        v-if="activeGroups.length === 0"
        class="flex flex-col items-center justify-center rounded-2xl border border-dashed border-zinc-300 py-8 text-center dark:border-slate-700"
      >
        <span
          class="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary mb-3"
        >
          <AppIcon name="variants" class="h-6 w-6" />
        </span>
        <p class="text-sm font-bold text-ink-primary">Belum Ada Grup Varian</p>
        <p class="mt-1 text-xs text-ink-secondary max-w-xs">
          Klik tombol di atas untuk membuat grup varian pertama Anda (misal: Ukuran Cup, Suhu, atau Topping).
        </p>
      </div>

      <!-- Groups List -->
      <div v-else class="space-y-3 max-h-[60vh] overflow-y-auto pr-1">
        <div
          v-for="group in activeGroups"
          :key="group.id || group.syncId"
          class="rounded-2xl border border-zinc-200/90 bg-white p-3.5 shadow-2xs dark:border-slate-700/70 dark:bg-[#1B2133]"
        >
          <div class="flex items-start justify-between gap-2">
            <div>
              <div class="flex items-center gap-2">
                <h3 class="text-sm font-bold text-ink-primary">{{ group.name }}</h3>
                <span
                  class="rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase"
                  :class="
                    group.selectionType === 'single'
                      ? 'bg-blue-50 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300'
                      : 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300'
                  "
                >
                  {{ group.selectionType === 'single' ? 'Pilih 1 (Radio)' : 'Multi (Checkbox)' }}
                </span>
                <span
                  v-if="group.isRequired"
                  class="rounded-md bg-amber-50 px-1.5 py-0.5 text-[10px] font-bold text-amber-700 dark:bg-amber-950/60 dark:text-amber-300"
                >
                  Wajib
                </span>
              </div>
              <p class="mt-1 text-[11px] text-ink-secondary">
                {{ (group.options || []).length }} opsi varian tersedia
              </p>
            </div>

            <div class="flex items-center gap-1">
              <button
                type="button"
                data-testid="btn-edit-group"
                class="flex h-8 w-8 items-center justify-center rounded-xl text-ink-secondary hover:bg-zinc-100 dark:hover:bg-slate-700"
                title="Edit Grup"
                @click="openEdit(group)"
              >
                <AppIcon name="edit" class="h-4 w-4" />
              </button>
              <button
                type="button"
                class="flex h-8 w-8 items-center justify-center rounded-xl text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/50"
                title="Hapus Grup"
                @click="handleDeleteGroup(group)"
              >
                <AppIcon name="trash" class="h-4 w-4" />
              </button>
            </div>
          </div>

          <!-- Options Pills -->
          <div class="mt-2.5 flex flex-wrap gap-1.5 pt-1 border-t border-zinc-100 dark:border-slate-800">
            <span
              v-for="opt in group.options"
              :key="opt.id || opt.name"
              class="inline-flex items-center gap-1 rounded-lg bg-surface px-2.5 py-1 text-[11px] font-medium text-ink-primary dark:bg-slate-800"
            >
              <span>{{ opt.name }}</span>
              <span v-if="Number(opt.priceAdjustment || 0) > 0" class="font-bold text-primary">
                +{{ formatCurrency(opt.priceAdjustment) }}
              </span>
            </span>
          </div>
        </div>
      </div>

      <div class="pt-2">
        <BaseButton variant="secondary" block @click="handleClose"> Selesai </BaseButton>
      </div>
    </div>

    <!-- 2. CREATE / EDIT FORM MODE -->
    <div v-else class="space-y-4" data-testid="variant-manager-form">
      <div v-if="formError" class="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700">
        {{ formError }}
      </div>

      <div class="space-y-3">
        <!-- Nama Grup -->
        <div>
          <label class="block text-xs font-semibold text-ink-secondary mb-1"> Nama Grup Varian </label>
          <BaseInput
            :model-value="groupForm.name"
            placeholder="Contoh: Ukuran Cup, Suhu, Level Gula, Topping"
            @update:model-value="groupForm.name = $event"
          />
        </div>

        <!-- Tipe Pilihan & Wajib -->
        <div class="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
          <div>
            <label class="block text-xs font-semibold text-ink-secondary mb-1"> Tipe Pilihan </label>
            <select
              v-model="groupForm.selectionType"
              class="h-11 w-full appearance-none rounded-xl border border-zinc-200 bg-white px-3 text-xs font-medium text-ink-primary outline-none focus:border-primary dark:border-slate-700 dark:bg-slate-900"
            >
              <option value="single">Pilih Satu (Radio - misal: Ukuran)</option>
              <option value="multiple">Pilih Banyak (Checkbox - misal: Topping)</option>
            </select>
          </div>

          <div>
            <label class="block text-xs font-semibold text-ink-secondary mb-1"> Sifat Pilihan </label>
            <select
              v-model="groupForm.isRequired"
              class="h-11 w-full appearance-none rounded-xl border border-zinc-200 bg-white px-3 text-xs font-medium text-ink-primary outline-none focus:border-primary dark:border-slate-700 dark:bg-slate-900"
            >
              <option :value="true">Wajib Dipilih Kasir</option>
              <option :value="false">Opsional (Boleh Dilewati)</option>
            </select>
          </div>
        </div>

        <!-- Daftar Opsi Varian -->
        <div class="space-y-2 pt-1">
          <div class="flex items-center justify-between">
            <span class="text-xs font-bold uppercase tracking-wider text-ink-secondary">
              Opsi Varian
            </span>
            <button
              type="button"
              class="text-xs font-bold text-primary hover:underline"
              @click="addOption"
            >
              + Tambah Opsi
            </button>
          </div>

          <div class="space-y-2 max-h-56 overflow-y-auto pr-1">
            <div
              v-for="(opt, idx) in groupForm.options"
              :key="idx"
              class="flex items-center gap-2 rounded-xl border border-zinc-200/80 bg-surface/50 p-2 dark:border-slate-700 dark:bg-slate-800/40"
            >
              <div class="flex-1 min-w-0">
                <input
                  v-model="opt.name"
                  type="text"
                  placeholder="Nama opsi (misal: Large)"
                  class="h-9 w-full rounded-lg border border-zinc-200 bg-white px-2.5 text-xs text-ink-primary outline-none focus:border-primary dark:border-slate-700 dark:bg-slate-900"
                />
              </div>

              <div class="w-28 shrink-0">
                <input
                  v-model.number="opt.priceAdjustment"
                  type="number"
                  placeholder="+Harga (Rp)"
                  class="h-9 w-full rounded-lg border border-zinc-200 bg-white px-2 text-xs text-ink-primary outline-none focus:border-primary dark:border-slate-700 dark:bg-slate-900"
                  title="Tambahan harga jual (Rp)"
                />
              </div>

              <button
                type="button"
                class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-rose-500 hover:bg-rose-50"
                title="Hapus opsi"
                @click="removeOption(idx)"
              >
                <AppIcon name="trash" class="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </div>
      </div>

      <div class="grid grid-cols-2 gap-2 pt-2">
        <BaseButton variant="secondary" @click="mode = 'list'"> Batal </BaseButton>
        <BaseButton data-testid="btn-save-variant-group" @click="handleSave"> Simpan </BaseButton>
      </div>
    </div>
  </BaseModal>
</template>
