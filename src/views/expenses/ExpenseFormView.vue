<script setup>
import { computed, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import BaseButton from '@/components/base/BaseButton.vue'
import BaseCard from '@/components/base/BaseCard.vue'
import BaseInput from '@/components/base/BaseInput.vue'
import { EXPENSE_CATEGORIES, useExpenseStore } from '@/stores/expenseStore'

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
  <div class="space-y-6">
    <section>
      <p class="text-sm font-medium uppercase tracking-[0.18em] text-primary">Expense Management</p>
      <h1 class="mt-2 text-3xl font-semibold text-ink-primary">
        {{ isEditMode ? 'Edit Pengeluaran' : 'Tambah Pengeluaran' }}
      </h1>
      <p class="mt-2 text-sm text-ink-secondary">
        {{
          isEditMode
            ? 'Perbarui data pengeluaran yang sudah ada.'
            : 'Catat pengeluaran baru untuk usaha Anda.'
        }}
      </p>
    </section>

    <BaseCard>
      <form class="space-y-5" @submit.prevent="handleSubmit">
        <p v-if="formError" class="rounded-2xl bg-danger/10 px-4 py-3 text-sm text-danger">
          {{ formError }}
        </p>

        <div class="space-y-2">
          <BaseInput
            :model-value="form.title"
            label="Judul"
            placeholder="Contoh: Beli Tissue"
            @update:model-value="form.title = $event"
          />
          <p v-if="errors.title" class="text-sm text-danger">{{ errors.title }}</p>
        </div>

        <div class="space-y-2">
          <label class="flex w-full flex-col gap-2">
            <span class="text-sm font-medium text-ink-secondary">Kategori</span>
            <select
              v-model="form.category"
              class="h-12 rounded-2xl border border-zinc-200 bg-white px-4 text-sm text-ink-primary outline-none transition focus:border-primary focus:ring-4 focus:ring-primary/10"
            >
              <option value="" disabled>Pilih kategori</option>
              <option v-for="category in EXPENSE_CATEGORIES" :key="category" :value="category">
                {{ category }}
              </option>
            </select>
          </label>
          <p v-if="errors.category" class="text-sm text-danger">{{ errors.category }}</p>
        </div>

        <div class="space-y-2">
          <BaseInput
            :model-value="form.amount"
            type="number"
            label="Jumlah"
            placeholder="Contoh: 25000"
            hint="Masukkan angka tanpa titik atau koma, minimal Rp1."
            @update:model-value="form.amount = $event"
          />
          <p v-if="errors.amount" class="text-sm text-danger">{{ errors.amount }}</p>
        </div>

        <BaseInput
          :model-value="form.note"
          label="Catatan"
          placeholder="Catatan tambahan (opsional)"
          @update:model-value="form.note = $event"
        />

        <div class="flex flex-wrap gap-3">
          <BaseButton type="submit">
            {{ isEditMode ? 'Simpan Perubahan' : 'Simpan' }}
          </BaseButton>
          <BaseButton type="button" variant="secondary" @click="router.push({ name: 'expenses' })">
            Batal
          </BaseButton>
        </div>
      </form>
    </BaseCard>
  </div>
</template>
