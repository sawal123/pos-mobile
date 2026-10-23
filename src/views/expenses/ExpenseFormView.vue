<script setup>
import { computed, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import BaseButton from '@/components/base/BaseButton.vue'
import BaseInput from '@/components/base/BaseInput.vue'
import { EXPENSE_CATEGORIES, useExpenseStore } from '@/stores/expenseStore'
import { formatCurrency } from '@/utils/formatters'

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

const isEditMode = computed(() => Boolean(route.params.id))

const QUICK_AMOUNTS = [10000, 20000, 50000, 100000, 200000, 500000]

function selectQuickAmount(val) {
  const current = Number(form.amount) || 0
  form.amount = String(current + val)
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
    <!-- Header Minimalis -->
    <header class="flex items-center justify-between gap-1.5">
      <div class="flex items-center gap-2 min-w-0">
        <button
          type="button"
          class="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-zinc-200 bg-white text-ink-primary shadow-xs transition hover:bg-zinc-50 active:scale-95"
          aria-label="Kembali ke Daftar Pengeluaran"
          @click="router.push({ name: 'expenses' })"
        >
          <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
          </svg>
        </button>

        <div class="min-w-0">
          <p class="text-[9px] font-bold uppercase tracking-wider text-primary">Biaya Operasional</p>
          <h1 class="text-sm sm:text-base font-bold tracking-tight text-ink-primary whitespace-nowrap">
            {{ isEditMode ? 'Edit Pengeluaran' : 'Catat Pengeluaran Baru' }}
          </h1>
        </div>
      </div>
    </header>

    <!-- Form Container -->
    <section class="rounded-3xl border border-zinc-200/80 bg-white p-4 sm:p-5 shadow-soft">
      <form class="space-y-4" @submit.prevent="handleSubmit">
        <p v-if="formError" class="rounded-2xl bg-danger/10 px-3.5 py-2.5 text-xs text-danger">
          {{ formError }}
        </p>

        <!-- Judul Pengeluaran -->
        <div class="space-y-1.5">
          <BaseInput
            :model-value="form.title"
            label="Judul Pengeluaran"
            placeholder="Contoh: Beli Tissue / Listrik Toko"
            @update:model-value="form.title = $event"
          />
          <p v-if="errors.title" class="text-xs text-danger">{{ errors.title }}</p>
        </div>

        <!-- Kategori Chips Selector -->
        <div class="space-y-1.5">
          <label class="text-xs font-semibold text-ink-secondary">Pilih Kategori</label>
          <div class="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <button
              v-for="cat in EXPENSE_CATEGORIES"
              :key="cat"
              type="button"
              class="flex items-center justify-center rounded-2xl border px-3 py-2 text-xs font-semibold transition active:scale-95 text-center"
              :class="
                form.category === cat
                  ? 'border-primary bg-primary text-white shadow-soft'
                  : 'border-zinc-200/80 bg-white text-zinc-700 hover:bg-zinc-50'
              "
              @click="form.category = cat"
            >
              {{ cat }}
            </button>
          </div>
          <p v-if="errors.category" class="text-xs text-danger">{{ errors.category }}</p>
        </div>

        <!-- Nominal Jumlah Pengeluaran -->
        <div class="space-y-1.5">
          <BaseInput
            :model-value="form.amount"
            type="number"
            label="Nominal (Rp)"
            placeholder="0"
            hint="Masukkan nominal pengeluaran dalam Rupiah."
            @update:model-value="form.amount = $event"
          />

          <!-- Quick Amount Buttons -->
          <div class="flex flex-wrap gap-1.5 pt-1">
            <button
              v-for="amt in QUICK_AMOUNTS"
              :key="amt"
              type="button"
              class="rounded-xl border border-zinc-200/80 bg-zinc-50 px-2.5 py-1 text-[11px] font-semibold text-zinc-600 transition hover:bg-zinc-100 active:scale-95"
              @click="selectQuickAmount(amt)"
            >
              +{{ formatCurrency(amt) }}
            </button>
            <button
              v-if="Number(form.amount) > 0"
              type="button"
              class="rounded-xl border border-rose-200 bg-rose-50 px-2.5 py-1 text-[11px] font-semibold text-rose-600 transition hover:bg-rose-100 active:scale-95"
              @click="form.amount = ''"
            >
              Reset
            </button>
          </div>

          <p v-if="errors.amount" class="text-xs text-danger">{{ errors.amount }}</p>
        </div>

        <!-- Catatan Tambahan (Opsional) -->
        <div class="space-y-1.5">
          <BaseInput
            :model-value="form.note"
            label="Catatan Tambahan (Opsional)"
            placeholder="Keterangan nota, toko pembelian, dll."
            @update:model-value="form.note = $event"
          />
        </div>

        <!-- Submit & Cancel Actions -->
        <div class="flex items-center gap-2 pt-2 border-t border-zinc-100">
          <BaseButton
            type="button"
            variant="secondary"
            block
            @click="router.push({ name: 'expenses' })"
          >
            Batal
          </BaseButton>
          <BaseButton type="submit" variant="primary" block>
            Simpan
          </BaseButton>
        </div>
      </form>
    </section>
  </div>
</template>
