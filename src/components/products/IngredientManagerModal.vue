<script setup>
import { computed, reactive, ref } from 'vue'

import AppIcon from '@/components/base/AppIcon.vue'
import BaseButton from '@/components/base/BaseButton.vue'
import BaseInput from '@/components/base/BaseInput.vue'
import BaseModal from '@/components/base/BaseModal.vue'
import { useIngredientStore } from '@/stores/ingredientStore'
import { formatCurrency, formatDateTime } from '@/utils/formatters'

const props = defineProps({
  open: {
    type: Boolean,
    default: false,
  },
})

const emit = defineEmits(['close'])

const ingredientStore = useIngredientStore()

// Tab: 'ingredients' | 'movements'
const activeTab = ref('ingredients')
// Mode: 'list' | 'create' | 'edit' | 'restock'
const mode = ref('list')
const editingIngredientId = ref(null)
const restockIngredient = ref(null)

const searchQuery = ref('')
const filterStatus = ref('all') // 'all' | 'low' | 'empty'

const ingredientForm = reactive({
  name: '',
  unit: 'gram',
  costPerUnit: '',
  stock: '',
  minStock: '',
  category: 'Bahan Baku',
})

const restockForm = reactive({
  amount: '',
  note: 'Restock bahan baku',
})

const formError = ref('')

const COMMON_UNITS = ['gram', 'kg', 'ml', 'liter', 'pcs', 'lembar', 'shot', 'porsi']

const activeIngredients = computed(() => ingredientStore.activeIngredients || [])

const filteredIngredients = computed(() => {
  let list = activeIngredients.value

  if (filterStatus.value === 'low') {
    list = list.filter((i) => Number(i.minStock || 0) > 0 && Number(i.stock || 0) <= Number(i.minStock || 0))
  } else if (filterStatus.value === 'empty') {
    list = list.filter((i) => Number(i.stock || 0) <= 0)
  }

  const q = searchQuery.value.trim().toLowerCase()
  if (!q) return list

  return list.filter((i) => {
    return (
      i.name.toLowerCase().includes(q) ||
      i.unit.toLowerCase().includes(q) ||
      (i.category && i.category.toLowerCase().includes(q))
    )
  })
})

const recentMovements = computed(() => ingredientStore.movements.slice(0, 50))

function openCreate() {
  editingIngredientId.value = null
  ingredientForm.name = ''
  ingredientForm.unit = 'gram'
  ingredientForm.costPerUnit = ''
  ingredientForm.stock = ''
  ingredientForm.minStock = ''
  ingredientForm.category = 'Bahan Baku'
  formError.value = ''
  mode.value = 'create'
}

function openEdit(item) {
  editingIngredientId.value = item.id
  ingredientForm.name = item.name || ''
  ingredientForm.unit = item.unit || 'gram'
  ingredientForm.costPerUnit = item.costPerUnit ?? 0
  ingredientForm.stock = item.stock ?? 0
  ingredientForm.minStock = item.minStock ?? 0
  ingredientForm.category = item.category || 'Bahan Baku'
  formError.value = ''
  mode.value = 'edit'
}

function openRestock(item) {
  restockIngredient.value = item
  restockForm.amount = ''
  restockForm.note = 'Restock bahan baku'
  formError.value = ''
  mode.value = 'restock'
}

function handleSaveIngredient() {
  formError.value = ''
  const name = ingredientForm.name.trim()
  if (!name) {
    formError.value = 'Nama bahan baku wajib diisi.'
    return
  }

  ingredientStore.saveIngredient({
    id: editingIngredientId.value,
    name,
    unit: ingredientForm.unit,
    costPerUnit: Number(ingredientForm.costPerUnit || 0),
    stock: Number(ingredientForm.stock || 0),
    minStock: Number(ingredientForm.minStock || 0),
    category: ingredientForm.category,
  })

  mode.value = 'list'
}

function handleSaveRestock() {
  formError.value = ''
  const amount = Number(restockForm.amount || 0)
  if (!amount || amount <= 0) {
    formError.value = 'Jumlah restock harus lebih dari 0.'
    return
  }

  ingredientStore.adjustStock(restockIngredient.value.id, {
    quantityChange: amount,
    type: 'in',
    category: 'Restock',
    note: restockForm.note.trim() || 'Restock bahan baku',
  })

  mode.value = 'list'
}

function handleDelete(item) {
  if (confirm(`Yakin ingin menghapus bahan baku "${item.name}"?`)) {
    ingredientStore.deleteIngredient(item.id)
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
        ? 'Tambah Bahan Baku Baru'
        : mode === 'edit'
          ? 'Edit Bahan Baku'
          : mode === 'restock'
            ? 'Restock Bahan Baku'
            : 'Persediaan Bahan Baku & HPP (Cloud)'
    "
    @close="handleClose"
  >
    <!-- TAB BAR (Only in List Mode) -->
    <div v-if="mode === 'list'" class="space-y-4" data-testid="ingredient-manager-container">
      <div class="flex items-center justify-between gap-2 border-b border-zinc-200/80 pb-2 dark:border-slate-800">
        <div class="flex items-center gap-1">
          <button
            type="button"
            class="rounded-xl px-3 py-1.5 text-xs font-bold transition"
            :class="
              activeTab === 'ingredients'
                ? 'bg-primary text-white shadow-xs'
                : 'text-ink-secondary hover:bg-zinc-100 dark:hover:bg-slate-800'
            "
            @click="activeTab = 'ingredients'"
          >
            Persediaan Bahan ({{ activeIngredients.length }})
          </button>
          <button
            type="button"
            class="rounded-xl px-3 py-1.5 text-xs font-bold transition"
            :class="
              activeTab === 'movements'
                ? 'bg-primary text-white shadow-xs'
                : 'text-ink-secondary hover:bg-zinc-100 dark:hover:bg-slate-800'
            "
            @click="activeTab = 'movements'"
          >
            Riwayat Pemotongan Stok
          </button>
        </div>

        <BaseButton
          v-if="activeTab === 'ingredients'"
          size="sm"
          data-testid="btn-add-ingredient"
          class="shrink-0 text-xs font-bold"
          @click="openCreate"
        >
          <AppIcon name="package" class="h-3.5 w-3.5" />
          <span>+ Tambah Bahan</span>
        </BaseButton>
      </div>

      <!-- TAB 1: INGREDIENTS LIST -->
      <div v-if="activeTab === 'ingredients'" class="space-y-3">
        <!-- Search & Quick Filters -->
        <div class="flex items-center gap-2">
          <div class="flex-1 min-w-0">
            <input
              v-model="searchQuery"
              type="text"
              placeholder="Cari bahan baku (kopi, susu, cup...)"
              class="h-9 w-full rounded-xl border border-zinc-200 bg-white px-3 text-xs text-ink-primary outline-none focus:border-primary dark:border-slate-700 dark:bg-slate-900"
            />
          </div>
          <select
            v-model="filterStatus"
            class="h-9 rounded-xl border border-zinc-200 bg-white px-2.5 text-xs font-medium text-ink-secondary outline-none focus:border-primary dark:border-slate-700 dark:bg-slate-900"
          >
            <option value="all">Semua Status</option>
            <option value="low">Stok Menipis</option>
            <option value="empty">Stok Habis</option>
          </select>
        </div>

        <!-- Empty State -->
        <div
          v-if="filteredIngredients.length === 0"
          class="flex flex-col items-center justify-center rounded-2xl border border-dashed border-zinc-300 py-8 text-center dark:border-slate-700"
        >
          <span class="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary/10 text-primary mb-2.5">
            <AppIcon name="stock" class="h-5 w-5" />
          </span>
          <p class="text-sm font-bold text-ink-primary">Belum Ada Bahan Baku</p>
          <p class="mt-1 text-xs text-ink-secondary max-w-xs">
            Masukkan data persediaan bahan baku (misal: Biji Kopi, Susu, Gula, Cup) untuk menghitung HPP otomatis.
          </p>
          <button
            type="button"
            class="mt-3 text-xs font-bold text-primary underline"
            @click="ingredientStore.seedDefaultIngredientsIfEmpty()"
          >
            Gunakan Contoh Bahan Baku Default F&B
          </button>
        </div>

        <!-- Ingredients Cards List -->
        <div v-else class="space-y-2.5 max-h-[55vh] overflow-y-auto pr-1">
          <div
            v-for="item in filteredIngredients"
            :key="item.id"
            class="flex items-center justify-between gap-3 rounded-2xl border border-zinc-200/90 bg-white p-3 shadow-2xs dark:border-slate-700/70 dark:bg-[#1B2133]"
          >
            <div class="min-w-0 flex-1">
              <div class="flex items-center gap-2">
                <p class="truncate text-xs font-bold text-ink-primary">{{ item.name }}</p>
                <span
                  v-if="Number(item.stock || 0) <= 0"
                  class="rounded-md bg-rose-50 px-1.5 py-0.5 text-[9px] font-bold text-rose-600 dark:bg-rose-950/60 dark:text-rose-400"
                >
                  Habis
                </span>
                <span
                  v-else-if="Number(item.minStock || 0) > 0 && Number(item.stock || 0) <= Number(item.minStock || 0)"
                  class="rounded-md bg-amber-50 px-1.5 py-0.5 text-[9px] font-bold text-amber-700 dark:bg-amber-950/60 dark:text-amber-300"
                >
                  Menipis
                </span>
              </div>

              <div class="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-ink-secondary">
                <span>
                  Sisa Stok:
                  <strong class="font-bold text-ink-primary">{{ item.stock }} {{ item.unit }}</strong>
                </span>
                <span>•</span>
                <span>
                  Modal:
                  <strong class="font-semibold text-ink-primary">{{ formatCurrency(item.costPerUnit) }}</strong> / {{ item.unit }}
                </span>
              </div>
            </div>

            <div class="flex items-center gap-1 shrink-0">
              <button
                type="button"
                data-testid="btn-restock-ingredient"
                class="inline-flex h-8 items-center gap-1 rounded-xl bg-emerald-50 px-2.5 text-[11px] font-bold text-emerald-700 hover:bg-emerald-100 dark:bg-emerald-950/60 dark:text-emerald-300"
                title="Restock Bahan"
                @click="openRestock(item)"
              >
                + Restock
              </button>
              <button
                type="button"
                class="flex h-8 w-8 items-center justify-center rounded-xl text-ink-secondary hover:bg-zinc-100 dark:hover:bg-slate-700"
                title="Edit Bahan"
                @click="openEdit(item)"
              >
                <AppIcon name="edit" class="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                class="flex h-8 w-8 items-center justify-center rounded-xl text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/50"
                title="Hapus Bahan"
                @click="handleDelete(item)"
              >
                <AppIcon name="trash" class="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- TAB 2: STOCK MOVEMENTS -->
      <div v-else class="space-y-3">
        <div v-if="recentMovements.length === 0" class="py-8 text-center text-xs text-ink-secondary">
          Belum ada riwayat mutasi stok bahan baku.
        </div>
        <div v-else class="space-y-2 max-h-[55vh] overflow-y-auto pr-1">
          <div
            v-for="mov in recentMovements"
            :key="mov.id"
            class="flex items-center justify-between rounded-xl border border-zinc-200/80 bg-surface/50 p-2.5 text-xs dark:border-slate-800"
          >
            <div>
              <p class="font-bold text-ink-primary">{{ mov.ingredientName }}</p>
              <p class="text-[10px] text-ink-secondary">
                {{ mov.note || mov.category }} • {{ formatDateTime(mov.timestamp) }}
              </p>
            </div>
            <div class="text-right">
              <span
                class="font-black"
                :class="mov.quantityChange < 0 ? 'text-rose-600' : 'text-emerald-600'"
              >
                {{ mov.quantityChange > 0 ? `+${mov.quantityChange}` : mov.quantityChange }}
              </span>
              <p class="text-[10px] text-ink-secondary">Sisa: {{ mov.stockAfter }}</p>
            </div>
          </div>
        </div>
      </div>

      <div class="pt-2">
        <BaseButton variant="secondary" block @click="handleClose"> Tutup </BaseButton>
      </div>
    </div>

    <!-- 2. CREATE / EDIT INGREDIENT FORM -->
    <div v-else-if="mode === 'create' || mode === 'edit'" class="space-y-4" data-testid="ingredient-form">
      <div v-if="formError" class="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700">
        {{ formError }}
      </div>

      <div class="space-y-3">
        <div>
          <label class="block text-xs font-semibold text-ink-secondary mb-1"> Nama Bahan Baku </label>
          <BaseInput
            :model-value="ingredientForm.name"
            placeholder="Contoh: Biji Kopi Espresso, Susu UHT, Cup 16oz"
            @update:model-value="ingredientForm.name = $event"
          />
        </div>

        <div class="grid grid-cols-2 gap-2.5">
          <div>
            <label class="block text-xs font-semibold text-ink-secondary mb-1"> Satuan Ukur </label>
            <select
              v-model="ingredientForm.unit"
              class="h-11 w-full appearance-none rounded-xl border border-zinc-200 bg-white px-3 text-xs font-medium text-ink-primary outline-none focus:border-primary dark:border-slate-700 dark:bg-slate-900"
            >
              <option v-for="unit in COMMON_UNITS" :key="unit" :value="unit">
                {{ unit }}
              </option>
            </select>
          </div>

          <div>
            <label class="block text-xs font-semibold text-ink-secondary mb-1">
              Harga Beli / Satuan (Rp)
            </label>
            <BaseInput
              :model-value="ingredientForm.costPerUnit"
              type="number"
              placeholder="Contoh: 180"
              @update:model-value="ingredientForm.costPerUnit = $event"
            />
          </div>
        </div>

        <div class="grid grid-cols-2 gap-2.5">
          <div>
            <label class="block text-xs font-semibold text-ink-secondary mb-1"> Stok Saat Ini </label>
            <BaseInput
              :model-value="ingredientForm.stock"
              type="number"
              placeholder="Contoh: 2000"
              @update:model-value="ingredientForm.stock = $event"
            />
          </div>

          <div>
            <label class="block text-xs font-semibold text-ink-secondary mb-1"> Batas Minimal Stok </label>
            <BaseInput
              :model-value="ingredientForm.minStock"
              type="number"
              placeholder="Contoh: 250"
              @update:model-value="ingredientForm.minStock = $event"
            />
          </div>
        </div>
      </div>

      <div class="grid grid-cols-2 gap-2 pt-2">
        <BaseButton variant="secondary" @click="mode = 'list'"> Batal </BaseButton>
        <BaseButton data-testid="btn-save-ingredient" @click="handleSaveIngredient"> Simpan </BaseButton>
      </div>
    </div>

    <!-- 3. RESTOCK FORM -->
    <div v-else-if="mode === 'restock'" class="space-y-4" data-testid="restock-form">
      <div v-if="formError" class="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700">
        {{ formError }}
      </div>

      <div class="rounded-2xl border border-zinc-200 bg-surface/60 p-3 text-xs dark:border-slate-700">
        <p class="font-bold text-ink-primary">{{ restockIngredient?.name }}</p>
        <p class="text-ink-secondary">
          Stok saat ini:
          <strong class="font-semibold text-ink-primary">
            {{ restockIngredient?.stock }} {{ restockIngredient?.unit }}
          </strong>
        </p>
      </div>

      <div class="space-y-3">
        <div>
          <label class="block text-xs font-semibold text-ink-secondary mb-1">
            Jumlah Masuk ({{ restockIngredient?.unit }})
          </label>
          <BaseInput
            :model-value="restockForm.amount"
            type="number"
            placeholder="Masukkan jumlah stok tambahan"
            @update:model-value="restockForm.amount = $event"
          />
        </div>

        <div>
          <label class="block text-xs font-semibold text-ink-secondary mb-1"> Catatan / Keterangan </label>
          <BaseInput
            :model-value="restockForm.note"
            placeholder="Contoh: Pembelian supplier, Restock mingguan"
            @update:model-value="restockForm.note = $event"
          />
        </div>
      </div>

      <div class="grid grid-cols-2 gap-2 pt-2">
        <BaseButton variant="secondary" @click="mode = 'list'"> Batal </BaseButton>
        <BaseButton data-testid="btn-submit-restock" @click="handleSaveRestock"> Tambahkan Stok </BaseButton>
      </div>
    </div>
  </BaseModal>
</template>
