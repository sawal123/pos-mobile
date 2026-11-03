<script setup>
import { computed, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import BaseButton from '@/components/base/BaseButton.vue'
import BaseInput from '@/components/base/BaseInput.vue'
import BaseModal from '@/components/base/BaseModal.vue'
import { EXPENSE_CATEGORIES, useExpenseStore } from '@/stores/expenseStore'
import { formatCurrency, formatDateTime } from '@/utils/formatters'

const expenseStore = useExpenseStore()
const route = useRoute()
const router = useRouter()

const form = reactive({
  title: '',
  category: '',
  amount: '',
  note: '',
})

const errors = ref({})
const formError = ref('')
const showDeleteModal = ref(false)

const isEditMode = computed(() => Boolean(route.params.id))

const existingExpense = computed(() => (
  isEditMode.value ? expenseStore.getExpenseById(route.params.id) : null
))

const QUICK_AMOUNTS = [10000, 20000, 50000, 100000, 200000, 500000]

const TITLE_SUGGESTIONS_BY_CATEGORY = {
  Operasional: ['Listrik & Air', 'Plastik & Kemasan', 'Kebersihan Toko', 'Internet / WiFi'],
  'Belanja Stok': ['Bahan Baku', 'Es Batu', 'Gas LPG', 'Air Galon'],
  Transportasi: ['Bensin Kurir', 'Ongkos Kirim', 'Parkir & Tol'],
  Lainnya: ['Konsumsi Staf', 'Perbaikan Alat', 'ATK & Kertas Struk'],
}

const titleSuggestions = computed(() => {
  if (form.category && TITLE_SUGGESTIONS_BY_CATEGORY[form.category]) {
    return TITLE_SUGGESTIONS_BY_CATEGORY[form.category]
  }
  return ['Listrik & Air', 'Bahan Baku', 'Plastik & Kemasan', 'Kertas Struk']
})

const parsedAmountPreview = computed(() => {
  const num = Number(form.amount)
  return Number.isFinite(num) && num > 0 ? num : 0
})

function selectQuickAmount(val) {
  const current = Number(form.amount) || 0
  form.amount = String(current + val)
  if (errors.value.amount) {
    errors.value = { ...errors.value, amount: '' }
  }
}

function clearAmount() {
  form.amount = ''
}

function onAmountInput(event) {
  form.amount = event.target.value
  if (errors.value.amount) {
    errors.value = { ...errors.value, amount: '' }
  }
}

function selectCategory(cat) {
  form.category = cat
  if (errors.value.category) {
    errors.value = { ...errors.value, category: '' }
  }
}

function applyTitleSuggestion(suggestion) {
  form.title = suggestion
  if (errors.value.title) {
    errors.value = { ...errors.value, title: '' }
  }
}

function onTitleUpdate(val) {
  form.title = val
  if (errors.value.title) {
    errors.value = { ...errors.value, title: '' }
  }
}

function getCategoryAccent(cat, isSelected) {
  if (!isSelected) {
    return 'border-zinc-200/90 bg-card text-ink-primary hover:border-primary/40 hover:bg-zinc-50/80 dark:border-slate-700/70 dark:bg-[#121726] dark:hover:border-indigo-400/50 dark:hover:bg-[#192034]'
  }

  switch (cat) {
    case 'Operasional':
      return 'border-blue-600 bg-blue-600 text-white shadow-md shadow-blue-600/20'
    case 'Belanja Stok':
      return 'border-amber-500 bg-amber-500 text-white shadow-md shadow-amber-500/20'
    case 'Transportasi':
      return 'border-indigo-600 bg-indigo-600 text-white shadow-md shadow-indigo-600/20'
    default:
      return 'border-primary bg-primary text-white shadow-md shadow-primary/20'
  }
}

function getCategoryBadgeClass(category) {
  switch (category) {
    case 'Operasional':
      return 'bg-blue-50 text-blue-700 border-blue-200/70 dark:bg-sky-500/15 dark:text-sky-300 dark:border-sky-400/30'
    case 'Belanja Stok':
      return 'bg-amber-50 text-amber-700 border-amber-200/70 dark:bg-amber-500/15 dark:text-amber-300 dark:border-amber-400/30'
    case 'Transportasi':
      return 'bg-indigo-50 text-indigo-700 border-indigo-200/70 dark:bg-indigo-500/15 dark:text-indigo-300 dark:border-indigo-400/30'
    default:
      return 'bg-zinc-100 text-zinc-700 border-zinc-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700'
  }
}

function resetForm() {
  form.title = ''
  form.category = ''
  form.amount = ''
  form.note = ''
  errors.value = {}
  formError.value = ''
}

function loadExpense() {
  resetForm()

  if (!isEditMode.value) {
    return
  }

  const expense = expenseStore.getExpenseById(route.params.id)

  if (!expense) {
    router.replace({ name: 'expenses' })
    return
  }

  form.title = expense.title
  form.category = expense.category
  form.amount = expense.amount
  form.note = expense.note
}

async function handleSubmit() {
  formError.value = ''

  const payload = {
    title: form.title,
    category: form.category,
    amount: form.amount,
    note: form.note,
  }

  const result = isEditMode.value
    ? expenseStore.updateExpense(route.params.id, payload)
    : expenseStore.createExpense(payload)

  if (!result.success) {
    errors.value = result.errors ?? {}
    formError.value = result.errors?.form ?? ''
    return
  }

  errors.value = {}
  await router.push({ name: 'expenses' })
}

async function handleDeleteExpense() {
  if (!isEditMode.value || !route.params.id) {
    return
  }
  expenseStore.deleteExpense(route.params.id)
  showDeleteModal.value = false
  await router.push({ name: 'expenses' })
}

watch(
  () => route.params.id,
  () => {
    loadExpense()
  },
  { immediate: true },
)
</script>

<template>
  <div class="mx-auto max-w-xl space-y-4 pb-32">
    <!-- Top Header -->
    <header class="flex items-center justify-between gap-3">
      <div class="flex min-w-0 items-center gap-3">
        <button
          type="button"
          class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-zinc-200 bg-white text-ink-primary shadow-2xs transition hover:bg-zinc-50 active:scale-95 cursor-pointer"
          aria-label="Kembali ke Daftar Pengeluaran"
          @click="router.push({ name: 'expenses' })"
        >
          <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
          </svg>
        </button>

        <div class="min-w-0">
          <div class="flex items-center gap-2">
            <p class="text-[11px] font-bold uppercase tracking-wider text-primary">
              Biaya Operasional
            </p>
            <span
              v-if="isEditMode"
              class="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-800"
            >
              Mode Edit
            </span>
          </div>
          <h1 class="truncate text-lg font-bold tracking-tight text-ink-primary sm:text-xl">
            {{ isEditMode ? 'Edit Pengeluaran' : 'Catat Pengeluaran Baru' }}
          </h1>
          <p v-if="isEditMode && existingExpense?.createdAt" class="text-[11px] text-ink-secondary">
            Dicatat {{ formatDateTime(existingExpense.createdAt) }}
          </p>
        </div>
      </div>

      <!-- Delete shortcut in Edit Mode -->
      <button
        v-if="isEditMode && existingExpense"
        type="button"
        data-testid="btn-delete-in-edit"
        aria-label="Hapus Pengeluaran"
        title="Hapus Pengeluaran"
        class="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-xl border border-rose-200 bg-rose-50 px-3 text-xs font-semibold text-rose-700 transition hover:bg-rose-100 active:scale-95 cursor-pointer"
        @click="showDeleteModal = true"
      >
        <svg class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" aria-hidden="true">
          <path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
        </svg>
        <span class="hidden sm:inline">Hapus</span>
      </button>
    </header>

    <!-- Global Form Error -->
    <div
      v-if="formError"
      class="flex items-center gap-2.5 rounded-2xl border border-danger/20 bg-danger/10 px-4 py-3 text-xs font-semibold text-danger"
    >
      <svg class="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
        <circle cx="12" cy="12" r="9" />
        <line x1="12" y1="8" x2="12" y2="12" />
        <line x1="12" y1="16" x2="12.01" y2="16" />
      </svg>
      <span>{{ formError }}</span>
    </div>

    <form class="space-y-4" @submit.prevent="handleSubmit">
      <!-- 1. Hero Nominal Pengeluaran Card -->
      <section
        class="overflow-hidden rounded-3xl border bg-card shadow-soft transition"
        :class="errors.amount ? 'border-danger/60' : 'border-zinc-200/80 dark:border-slate-700/60'"
      >
        <div class="border-b border-zinc-100 bg-gradient-to-r from-rose-50/80 via-white to-zinc-50/60 px-4 py-3 sm:px-5 dark:border-slate-700/60 dark:from-rose-950/45 dark:via-[#171C2B] dark:to-[#131826]">
          <div class="flex items-center justify-between gap-2">
            <label for="expense-amount-input" class="text-xs font-bold uppercase tracking-wider text-ink-secondary">
              Nominal Pengeluaran
            </label>
            <span
              data-testid="expense-amount-preview"
              class="font-mono text-xs font-bold tabular-nums"
              :class="parsedAmountPreview > 0 ? 'text-rose-600 dark:text-rose-400' : 'text-zinc-400 dark:text-slate-500'"
            >
              {{ parsedAmountPreview > 0 ? `-${formatCurrency(parsedAmountPreview)}` : 'Rp 0' }}
            </span>
          </div>
        </div>

        <div class="space-y-3 p-4 sm:p-5">
          <!-- Large Nominal Input -->
          <div class="relative flex items-center">
            <span class="pointer-events-none absolute left-4 text-base font-extrabold text-zinc-400 dark:text-slate-400">
              Rp
            </span>
            <input
              id="expense-amount-input"
              :value="form.amount"
              type="number"
              inputmode="numeric"
              min="0"
              placeholder="0"
              data-testid="expense-amount-input"
              class="h-14 w-full rounded-2xl border bg-surface pl-12 pr-20 font-mono text-2xl font-extrabold tabular-nums text-ink-primary outline-none transition placeholder:text-zinc-300 focus:bg-card focus:ring-4 dark:bg-[#121726] dark:placeholder:text-slate-600 dark:focus:bg-[#151C2E]"
              :class="
                errors.amount
                  ? 'border-danger focus:border-danger focus:ring-danger/10'
                  : 'border-zinc-200 focus:border-primary focus:ring-primary/10 dark:border-slate-700/70'
              "
              @input="onAmountInput"
            />
            <button
              v-if="Number(form.amount) > 0"
              type="button"
              data-testid="btn-reset-amount"
              class="absolute right-3 rounded-xl border border-rose-200 bg-rose-50 px-2.5 py-1 text-xs font-bold text-rose-600 transition hover:bg-rose-100 active:scale-95 cursor-pointer dark:border-rose-500/35 dark:bg-rose-500/15 dark:text-rose-300 dark:hover:bg-rose-500/25"
              @click="clearAmount"
            >
              Reset
            </button>
          </div>

          <!-- Quick Nominal Preset Grid -->
          <div>
            <p class="mb-1.5 text-[11px] font-medium text-ink-secondary">
              Tambah cepat nominal:
            </p>
            <div class="grid grid-cols-3 gap-1.5 sm:grid-cols-6">
              <button
                v-for="amt in QUICK_AMOUNTS"
                :key="amt"
                type="button"
                class="rounded-xl border border-zinc-200/90 bg-zinc-50/80 px-2 py-2 text-[11px] font-bold tabular-nums text-zinc-700 transition hover:border-primary/40 hover:bg-primary/5 hover:text-primary active:scale-95 cursor-pointer dark:border-slate-700/70 dark:bg-[#121726] dark:text-slate-200 dark:hover:border-indigo-400/50 dark:hover:bg-indigo-500/15 dark:hover:text-indigo-200"
                @click="selectQuickAmount(amt)"
              >
                +{{ formatCurrency(amt) }}
              </button>
            </div>
          </div>

          <p v-if="errors.amount" class="text-xs font-semibold text-danger" data-testid="error-amount">
            {{ errors.amount }}
          </p>
        </div>
      </section>

      <!-- 2. Kategori & Rincian Pengeluaran Card -->
      <section class="rounded-3xl border border-zinc-200/80 bg-card p-4 shadow-soft space-y-4 sm:p-5 dark:border-slate-700/60">
        <!-- Kategori Selector -->
        <div class="space-y-2">
          <div class="flex items-center justify-between">
            <label class="text-xs font-bold uppercase tracking-wider text-ink-secondary">
              Pilih Kategori
            </label>
            <span class="text-[11px] text-ink-secondary">Wajib</span>
          </div>

          <div class="grid grid-cols-2 gap-2.5">
            <button
              v-for="cat in EXPENSE_CATEGORIES"
              :key="cat"
              type="button"
              :data-testid="`expense-category-${cat}`"
              class="flex items-center gap-2.5 rounded-2xl border px-3.5 py-3 text-left text-xs font-bold transition active:scale-[0.98] cursor-pointer"
              :class="getCategoryAccent(cat, form.category === cat)"
              @click="selectCategory(cat)"
            >
              <span
                class="flex h-7 w-7 shrink-0 items-center justify-center rounded-xl"
                :class="form.category === cat ? 'bg-white/20 text-white' : 'bg-zinc-100 text-zinc-600 dark:bg-slate-800 dark:text-slate-300'"
              >
                <!-- Operasional icon -->
                <svg v-if="cat === 'Operasional'" class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
                </svg>
                <!-- Belanja Stok icon -->
                <svg v-else-if="cat === 'Belanja Stok'" class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z" />
                  <line x1="3" y1="6" x2="21" y2="6" />
                  <path d="M16 10a4 4 0 0 1-8 0" />
                </svg>
                <!-- Transportasi icon -->
                <svg v-else-if="cat === 'Transportasi'" class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <rect x="1" y="3" width="15" height="13" rx="2" />
                  <polygon points="16 8 20 8 23 11 23 16 16 16 16 8" />
                  <circle cx="5.5" cy="18.5" r="2.5" />
                  <circle cx="18.5" cy="18.5" r="2.5" />
                </svg>
                <!-- Lainnya icon -->
                <svg v-else class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <rect x="3" y="3" width="7" height="7" rx="1" />
                  <rect x="14" y="3" width="7" height="7" rx="1" />
                  <rect x="14" y="14" width="7" height="7" rx="1" />
                  <rect x="3" y="14" width="7" height="7" rx="1" />
                </svg>
              </span>
              <span class="truncate">{{ cat }}</span>
            </button>
          </div>

          <p v-if="errors.category" class="text-xs font-semibold text-danger" data-testid="error-category">
            {{ errors.category }}
          </p>
        </div>

        <div class="border-t border-zinc-100 dark:border-slate-700/60" />

        <!-- Judul Pengeluaran + Quick Suggestions -->
        <div class="space-y-2">
          <BaseInput
            :model-value="form.title"
            label="Judul Pengeluaran"
            placeholder="Contoh: Beli Tissue / Listrik Toko"
            data-testid="expense-title-input"
            @update:model-value="onTitleUpdate"
          />

          <div class="flex flex-wrap items-center gap-1.5">
            <span class="text-[11px] text-ink-secondary">Contoh:</span>
            <button
              v-for="item in titleSuggestions"
              :key="item"
              type="button"
              class="rounded-full border border-zinc-200 bg-zinc-50 px-2.5 py-0.5 text-[11px] font-medium text-ink-secondary transition hover:border-primary/40 hover:bg-primary/5 hover:text-primary active:scale-95 cursor-pointer dark:border-slate-700/70 dark:bg-[#121726] dark:text-slate-300 dark:hover:border-indigo-400/50 dark:hover:bg-indigo-500/15 dark:hover:text-indigo-200"
              @click="applyTitleSuggestion(item)"
            >
              {{ item }}
            </button>
          </div>

          <p v-if="errors.title" class="text-xs font-semibold text-danger" data-testid="error-title">
            {{ errors.title }}
          </p>
        </div>

        <!-- Catatan Tambahan (Textarea) -->
        <div class="space-y-1.5">
          <div class="flex items-center justify-between">
            <label for="expense-note-input" class="text-sm font-medium text-ink-secondary">
              Catatan Tambahan
            </label>
            <span class="text-[11px] text-ink-secondary">Opsional</span>
          </div>
          <textarea
            id="expense-note-input"
            v-model="form.note"
            rows="3"
            data-testid="expense-note-input"
            placeholder="Nomor nota, nama toko pembelian, atau keterangan lainnya..."
            class="w-full resize-none rounded-2xl border border-zinc-200 bg-card px-4 py-3 text-sm text-ink-primary outline-none transition placeholder:text-zinc-400 focus:border-primary focus:ring-4 focus:ring-primary/10 dark:border-slate-700/70 dark:bg-[#121726] dark:placeholder:text-slate-500"
          />
        </div>
      </section>

      <!-- 3. Live Summary Preview & Submit Footer -->
      <section
        class="rounded-3xl border border-zinc-200/80 bg-card p-4 shadow-soft space-y-3.5 sm:p-5 dark:border-slate-700/60"
        data-testid="expense-summary-footer"
      >
        <div
          class="flex items-center justify-between gap-3 rounded-2xl border border-zinc-200/70 bg-surface px-3.5 py-2.5 dark:border-slate-700/70 dark:bg-[#121726]"
          data-testid="expense-live-summary"
        >
          <div class="min-w-0">
            <div class="flex items-center gap-1.5">
              <span
                v-if="form.category"
                class="inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold"
                :class="getCategoryBadgeClass(form.category)"
              >
                {{ form.category }}
              </span>
              <span v-else class="text-[11px] text-zinc-400 dark:text-slate-400">Belum pilih kategori</span>
            </div>
            <p class="mt-0.5 truncate text-xs font-semibold text-ink-primary">
              {{ form.title.trim() || 'Judul pengeluaran belum diisi' }}
            </p>
          </div>

          <div class="shrink-0 text-right">
            <p class="text-[10px] font-medium uppercase tracking-wide text-ink-secondary">Total Biaya</p>
            <p class="font-mono text-sm font-extrabold tabular-nums text-rose-600 dark:text-rose-400">
              {{ parsedAmountPreview > 0 ? `-${formatCurrency(parsedAmountPreview)}` : 'Rp 0' }}
            </p>
          </div>
        </div>

        <div class="grid grid-cols-2 gap-2.5">
          <BaseButton
            type="button"
            variant="secondary"
            size="lg"
            block
            @click="router.push({ name: 'expenses' })"
          >
            Batal
          </BaseButton>
          <BaseButton
            type="submit"
            variant="primary"
            size="lg"
            block
            class="gap-1.5 shadow-md shadow-primary/20"
            data-testid="expense-submit-btn"
          >
            <svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <polyline points="20 6 9 17 4 12" />
            </svg>
            <span>{{ isEditMode ? 'Ubah' : 'Simpan' }}</span>
          </BaseButton>
        </div>
      </section>
    </form>

    <!-- Delete Confirmation Modal (Edit Mode) -->
    <BaseModal
      :open="showDeleteModal"
      title="Hapus Catatan Pengeluaran"
      @close="showDeleteModal = false"
    >
      <div class="space-y-4">
        <p class="text-sm text-ink-secondary">
          Apakah Anda yakin ingin menghapus pengeluaran
          <strong class="text-ink-primary">"{{ existingExpense?.title }}"</strong> sebesar
          <strong class="font-mono text-rose-600">{{ formatCurrency(existingExpense?.amount || 0) }}</strong>?
        </p>
        <div class="grid grid-cols-2 gap-2 pt-1">
          <BaseButton variant="secondary" block @click="showDeleteModal = false">
            Batal
          </BaseButton>
          <BaseButton
            variant="danger"
            block
            data-testid="confirm-delete-in-edit-btn"
            @click="handleDeleteExpense"
          >
            Hapus
          </BaseButton>
        </div>
      </div>
    </BaseModal>
  </div>
</template>
