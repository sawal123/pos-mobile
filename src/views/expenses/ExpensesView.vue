<script setup>
import { storeToRefs } from 'pinia'
import { useRouter } from 'vue-router'

import BaseButton from '@/components/base/BaseButton.vue'
import BaseCard from '@/components/base/BaseCard.vue'
import { useExpenseStore } from '@/stores/expenseStore'
import { formatCurrency, formatDateTime } from '@/utils/formatters'

const expenseStore = useExpenseStore()
const router = useRouter()

const { sortedExpenses } = storeToRefs(expenseStore)

function goToCreate() {
  router.push({ name: 'expense-create' })
}

function goToEdit(expense) {
  router.push({ name: 'expense-edit', params: { id: expense.id } })
}

function handleDelete(expense) {
  if (!window.confirm(`Hapus pengeluaran "${expense.title}"?`)) {
    return
  }

  expenseStore.deleteExpense(expense.id)
}
</script>

<template>
  <div class="space-y-6">
    <section class="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
      <div>
        <p class="text-sm font-medium uppercase tracking-[0.18em] text-primary">Expense Management</p>
        <h1 class="mt-2 text-3xl font-semibold text-ink-primary">Riwayat Pengeluaran</h1>
        <p class="mt-2 text-sm text-ink-secondary">
          Catat pengeluaran usaha di luar penjualan.
        </p>
      </div>

      <BaseButton @click="goToCreate">Tambah Pengeluaran</BaseButton>
    </section>

    <BaseCard class="space-y-1">
      <p class="text-sm text-ink-secondary">Total Pengeluaran</p>
      <p class="text-2xl font-semibold text-ink-primary">{{ formatCurrency(expenseStore.totalExpenses) }}</p>
    </BaseCard>

    <BaseCard class="space-y-4">
      <div class="flex items-center justify-between">
        <h2 class="text-lg font-semibold text-ink-primary">Semua Pengeluaran</h2>
        <span class="text-sm text-ink-secondary">{{ sortedExpenses.length }} pengeluaran</span>
      </div>

      <div v-if="sortedExpenses.length" class="space-y-3">
        <div
          v-for="expense in sortedExpenses"
          :key="expense.id"
          class="flex flex-col gap-4 rounded-2xl border border-zinc-200 bg-white p-4 lg:flex-row lg:items-start lg:justify-between"
        >
          <div class="space-y-2">
            <h3 class="text-lg font-semibold text-ink-primary">{{ expense.title }}</h3>
            <p class="text-sm text-ink-secondary">Kategori: {{ expense.category }}</p>
            <p class="text-sm font-semibold text-ink-primary">{{ formatCurrency(expense.amount) }}</p>
            <p class="text-sm text-ink-secondary">{{ formatDateTime(expense.createdAt) }}</p>
            <p v-if="expense.note" class="text-sm text-ink-secondary">Catatan: {{ expense.note }}</p>
          </div>

          <div class="flex flex-wrap gap-2">
            <BaseButton size="sm" variant="secondary" @click="goToEdit(expense)">Edit</BaseButton>
            <BaseButton size="sm" variant="danger" @click="handleDelete(expense)">Delete</BaseButton>
          </div>
        </div>
      </div>

      <div
        v-else
        class="rounded-2xl border border-dashed border-zinc-200 p-6 text-center text-sm text-ink-secondary"
      >
        Belum ada pengeluaran yang ditambahkan.
      </div>
    </BaseCard>
  </div>
</template>
