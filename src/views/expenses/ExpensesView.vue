<script setup>
import { computed, ref } from 'vue'
import { storeToRefs } from 'pinia'
import { useRouter } from 'vue-router'

import AppIcon from '@/components/base/AppIcon.vue'
import BaseButton from '@/components/base/BaseButton.vue'
import BaseModal from '@/components/base/BaseModal.vue'
import { EXPENSE_CATEGORIES, useExpenseStore } from '@/stores/expenseStore'
import { formatCurrency, formatDateTime } from '@/utils/formatters'

const expenseStore = useExpenseStore()
const router = useRouter()

const { sortedExpenses } = storeToRefs(expenseStore)

const searchQuery = ref('')
const selectedCategory = ref('all')
const expenseToDelete = ref(null)

const filteredExpenses = computed(() => {
  let list = sortedExpenses.value || []

  if (selectedCategory.value !== 'all') {
    list = list.filter((e) => e.category === selectedCategory.value)
  }

  const q = searchQuery.value.trim().toLowerCase()
  if (!q) return list

  return list.filter((e) => {
    const title = String(e.title || '').toLowerCase()
    const note = String(e.note || '').toLowerCase()
    const cat = String(e.category || '').toLowerCase()
    return title.includes(q) || note.includes(q) || cat.includes(q)
  })
})

function goToCreate() {
  router.push({ name: 'expense-create' })
}

function goToEdit(expense) {
  router.push({ name: 'expense-edit', params: { id: expense.id } })
}

function confirmDelete(expense) {
  expenseToDelete.value = expense
}

function executeDelete() {
  if (expenseToDelete.value) {
    expenseStore.deleteExpense(expenseToDelete.value.id)
    expenseToDelete.value = null
  }
}

function getCategoryBadgeClass(category) {
  switch (category) {
    case 'Operasional':
      return 'bg-blue-50 text-blue-700 border-blue-200/60'
    case 'Belanja Stok':
      return 'bg-amber-50 text-amber-700 border-amber-200/60'
    case 'Transportasi':
      return 'bg-indigo-50 text-indigo-700 border-indigo-200/60'
    case 'Lainnya':
    default:
      return 'bg-zinc-100 text-zinc-700 border-zinc-200'
  }
}
</script>

<template>
  <div class="mx-auto max-w-xl space-y-4 pb-36">
    <!-- Header Minimalis & Simple -->
    <header class="flex items-center justify-between gap-1.5">
      <div class="flex items-center gap-2 min-w-0">
        <button
          type="button"
          class="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-zinc-200 bg-white text-ink-primary shadow-xs transition hover:bg-zinc-50 active:scale-95"
          aria-label="Kembali ke Home"
          @click="router.push('/home')"
        >
          <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
          </svg>
        </button>

        <div class="min-w-0">
          <p class="text-[9px] font-bold uppercase tracking-wider text-primary">Biaya Usaha</p>
          <h1 class="text-xs sm:text-sm font-bold tracking-tight text-ink-primary whitespace-nowrap">Riwayat Pengeluaran</h1>
        </div>
      </div>

      <button
        type="button"
        class="inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-primary px-3 py-1.5 text-xs font-semibold text-white shadow-soft transition hover:bg-primary-light active:scale-95"
        @click="goToCreate"
      >
        <svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
        </svg>
        <span class="whitespace-nowrap">Catat Biaya</span>
      </button>
    </header>

    <!-- Summary Hero Card Minimalis -->
    <section class="rounded-3xl border border-zinc-200/80 bg-white p-4 sm:p-5 shadow-soft space-y-3">
      <div class="flex items-start justify-between gap-2">
        <div class="min-w-0">
          <p class="text-[11px] font-medium text-ink-secondary">
            Total Pengeluaran Tercatat
          </p>
          <h2 class="mt-1 font-mono text-2xl sm:text-3xl font-bold tracking-tight text-rose-600 truncate">
            {{ formatCurrency(expenseStore.totalExpenses) }}
          </h2>
          <p class="mt-0.5 text-[11px] text-ink-secondary">
            Total: <span class="font-semibold text-ink-primary">{{ sortedExpenses.length }} transaksi biaya</span>
          </p>
        </div>

        <span class="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-rose-50 text-rose-600 border border-rose-100">
          <AppIcon name="expenses" class="h-5 w-5" />
        </span>
      </div>
    </section>

    <!-- Search & Filter Bar -->
    <section class="space-y-2">
      <!-- Search Input -->
      <div class="relative">
        <svg class="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
        <input
          v-model="searchQuery"
          type="text"
          placeholder="Cari pengeluaran atau catatan..."
          class="h-10 w-full rounded-2xl border border-zinc-200 bg-white pl-10 pr-4 text-xs text-ink-primary shadow-xs outline-none transition placeholder:text-zinc-400 focus:border-primary focus:ring-2 focus:ring-primary/10"
        />
        <button
          v-if="searchQuery"
          type="button"
          class="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-semibold text-zinc-400 hover:text-zinc-600"
          @click="searchQuery = ''"
        >
          &times;
        </button>
      </div>

      <!-- Category Filter Chips -->
      <div class="flex items-center gap-1.5 overflow-x-auto pb-1 text-[11px]">
        <button
          type="button"
          class="shrink-0 rounded-xl px-2.5 py-1 font-medium transition active:scale-95"
          :class="selectedCategory === 'all' ? 'bg-primary text-white font-bold shadow-xs' : 'bg-white border border-zinc-200/80 text-zinc-600 hover:bg-zinc-50'"
          @click="selectedCategory = 'all'"
        >
          Semua ({{ sortedExpenses.length }})
        </button>
        <button
          v-for="cat in EXPENSE_CATEGORIES"
          :key="cat"
          type="button"
          class="shrink-0 rounded-xl px-2.5 py-1 font-medium transition active:scale-95 whitespace-nowrap"
          :class="selectedCategory === cat ? 'bg-primary text-white font-bold shadow-xs' : 'bg-white border border-zinc-200/80 text-zinc-600 hover:bg-zinc-50'"
          @click="selectedCategory = cat"
        >
          {{ cat }}
        </button>
      </div>
    </section>

    <!-- Expenses List -->
    <section class="space-y-2.5">
      <div v-if="filteredExpenses.length" class="space-y-2">
        <div
          v-for="expense in filteredExpenses"
          :key="expense.id"
          class="rounded-3xl border border-zinc-200/80 bg-white p-4 shadow-soft transition hover:border-zinc-300 space-y-2.5"
        >
          <!-- Top Row: Category Badge & Date -->
          <div class="flex items-center justify-between gap-2">
            <span
              class="inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold"
              :class="getCategoryBadgeClass(expense.category)"
            >
              {{ expense.category }}
            </span>
            <span class="text-[10px] text-zinc-400 font-mono">
              {{ formatDateTime(expense.createdAt) }}
            </span>
          </div>

          <!-- Middle Row: Title & Amount -->
          <div class="flex items-start justify-between gap-3">
            <div class="min-w-0">
              <h3 class="font-bold text-sm text-ink-primary truncate">{{ expense.title }}</h3>
              <p v-if="expense.note" class="text-xs text-ink-secondary mt-0.5 line-clamp-2">
                {{ expense.note }}
              </p>
            </div>
            <div class="text-right shrink-0">
              <p class="font-mono text-base font-bold text-rose-600">
                -{{ formatCurrency(expense.amount) }}
              </p>
            </div>
          </div>

          <!-- Bottom Row: Action Buttons -->
          <div class="flex items-center justify-end gap-2 pt-2 border-t border-zinc-100 text-xs">
            <button
              type="button"
              class="inline-flex items-center gap-1 rounded-xl border border-zinc-200 bg-white px-2.5 py-1 font-medium text-zinc-700 transition hover:bg-zinc-50 active:scale-95"
              @click="goToEdit(expense)"
            >
              <svg class="h-3.5 w-3.5 text-zinc-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
              <span>Edit</span>
            </button>

            <button
              type="button"
              class="inline-flex items-center gap-1 rounded-xl border border-rose-200 bg-rose-50/60 px-2.5 py-1 font-medium text-rose-700 transition hover:bg-rose-100 active:scale-95"
              @click="confirmDelete(expense)"
            >
              <svg class="h-3.5 w-3.5 text-rose-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
              <span>Hapus</span>
            </button>
          </div>
        </div>
      </div>

      <!-- Empty State -->
      <div
        v-else
        class="rounded-3xl border border-dashed border-zinc-200 bg-white p-8 text-center space-y-3"
      >
        <div class="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-zinc-100 text-zinc-400">
          <AppIcon name="expenses" class="h-6 w-6" />
        </div>
        <div class="space-y-1">
          <p class="text-sm font-bold text-ink-primary">
            {{ searchQuery || selectedCategory !== 'all' ? 'Pengeluaran tidak ditemukan' : 'Belum ada pengeluaran' }}
          </p>
          <p class="text-xs text-ink-secondary">
            {{ searchQuery || selectedCategory !== 'all' ? 'Coba ubah kata kunci atau filter kategori.' : 'Catat biaya operasional toko agar keuangan tercatat rapi.' }}
          </p>
        </div>
        <div v-if="!searchQuery && selectedCategory === 'all'" class="pt-2">
          <BaseButton size="sm" @click="goToCreate">
            + Catat Pengeluaran Pertama
          </BaseButton>
        </div>
      </div>
    </section>

    <!-- Delete Confirmation Modal -->
    <BaseModal
      :open="Boolean(expenseToDelete)"
      title="Hapus Catatan Pengeluaran"
      @close="expenseToDelete = null"
    >
      <div class="space-y-4">
        <p class="text-sm text-ink-secondary">
          Apakah Anda yakin ingin menghapus catatan pengeluaran
          <strong class="text-ink-primary">"{{ expenseToDelete?.title }}"</strong> sebesar
          <strong class="text-rose-600 font-mono">{{ formatCurrency(expenseToDelete?.amount || 0) }}</strong>?
        </p>
        <p class="text-xs text-zinc-400">Tindakan ini tidak dapat dibatalkan.</p>

        <div class="flex items-center gap-2 pt-2">
          <BaseButton block variant="secondary" @click="expenseToDelete = null">
            Batal
          </BaseButton>
          <BaseButton
            data-testid="confirm-delete-expense-btn"
            block
            variant="danger"
            @click="executeDelete"
          >
            Hapus
          </BaseButton>
        </div>
      </div>
    </BaseModal>
  </div>
</template>
