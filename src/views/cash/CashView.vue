<script setup>
import { computed, ref } from 'vue'

import BaseButton from '@/components/base/BaseButton.vue'
import BaseInput from '@/components/base/BaseInput.vue'
import BaseSheet from '@/components/base/BaseSheet.vue'
import { isNativePrinterPlatform, openCashDrawer } from '@/services/printer/bluetoothPrinterService'
import { useCashStore } from '@/stores/cashStore'
import { useCloudSessionStore } from '@/stores/cloudSessionStore'
import { useNotificationStore } from '@/stores/notificationStore'
import { usePrinterStore } from '@/stores/printerStore'
import { formatCurrency, formatDateTime } from '@/utils/formatters'

const cashStore = useCashStore()
const cloudStore = useCloudSessionStore()
const notificationStore = useNotificationStore()
const printerStore = usePrinterStore()

const isCashier = computed(
  () => cloudStore.role === 'cashier' || cloudStore.isCashierContext === true,
)

const isNative = computed(() => isNativePrinterPlatform())
const isOpeningDrawer = ref(false)

async function handleOpenDrawer() {
  if (isOpeningDrawer.value) return
  if (!printerStore.hasSelectedPrinter) {
    notificationStore.notifyError({
      title: 'Printer Belum Dipilih',
      message: 'Pilih printer Bluetooth terlebih dahulu di menu Struk atau Pengaturan.',
    })
    return
  }

  isOpeningDrawer.value = true
  try {
    const res = await openCashDrawer({ printer: printerStore.selectedPrinter })
    if (res.success) {
      notificationStore.notifySuccess({
        title: 'Laci Terbuka',
        message: 'Perintah buka laci kasir berhasil dikirim.',
      })
    } else {
      notificationStore.notifyError({
        title: 'Gagal Buka Laci',
        message: res.message || 'Tidak dapat mengirim perintah ke printer.',
      })
    }
  } finally {
    isOpeningDrawer.value = false
  }
}

const showRecordSheet = ref(false)
const filterType = ref('all') // 'all', 'in', 'out'
const searchQuery = ref('')

const cashForm = ref({
  type: 'in',
  amount: '',
  category: 'Modal',
  note: '',
})
const cashError = ref('')
const feedbackMessage = ref('')

const QUICK_AMOUNTS = [10000, 20000, 50000, 100000, 200000, 500000]

const CATEGORY_SUGGESTIONS = {
  in: ['Modal', 'Penjualan Non-POS', 'Setoran Tunai', 'Penerimaan Lain'],
  out: ['Bahan Baku', 'Operasional', 'Listrik & Air', 'Gaji / Upah', 'Prive / Pribadi', 'Lainnya'],
}

function setCashType(type) {
  cashForm.value.type = type
  cashForm.value.category = type === 'in' ? 'Modal' : 'Operasional'
}

function openRecordModal(type = 'in') {
  if (isCashier.value) {
    notificationStore.notifyError({
      title: 'Akses Dibatasi',
      message: 'Peran Kasir tidak memiliki akses mencatat kas masuk atau kas keluar manual.',
    })
    return
  }
  setCashType(type)
  cashForm.value.amount = ''
  cashForm.value.note = ''
  cashError.value = ''
  feedbackMessage.value = ''
  showRecordSheet.value = true
}

function selectQuickAmount(val) {
  const current = Number(cashForm.value.amount) || 0
  cashForm.value.amount = String(current + val)
}

function handleManualCash() {
  if (isCashier.value) {
    cashError.value = 'Peran Kasir tidak diizinkan mencatat kas manual.'
    return
  }
  cashError.value = ''
  feedbackMessage.value = ''

  const result = cashStore.recordEntry({
    type: cashForm.value.type,
    amount: cashForm.value.amount,
    category: cashForm.value.category,
    note: cashForm.value.note,
  })

  if (!result.success) {
    cashError.value = result.error
    return
  }

  cashForm.value.amount = ''
  cashForm.value.note = ''
  feedbackMessage.value = 'Transaksi kas berhasil dicatat.'
  notificationStore.notifySuccessAndSync({
    title: 'Kas Berhasil Dicatat',
    message: 'Catatan arus kas berhasil disimpan.',
  })
  setTimeout(() => {
    showRecordSheet.value = false
    feedbackMessage.value = ''
  }, 900)
}

const filteredEntries = computed(() => {
  let list = cashStore.entries || []

  if (filterType.value === 'in') {
    list = list.filter((e) => e.type === 'in')
  } else if (filterType.value === 'out') {
    list = list.filter((e) => e.type === 'out')
  }

  const q = searchQuery.value.trim().toLowerCase()
  if (!q) return list

  return list.filter((e) => {
    const cat = String(e.category || '').toLowerCase()
    const note = String(e.note || '').toLowerCase()
    return cat.includes(q) || note.includes(q)
  })
})
</script>

<template>
  <div class="mx-auto max-w-xl space-y-4 pb-32">
    <!-- Header -->
    <div class="flex items-end justify-between gap-3">
      <div>
        <p class="text-xs font-semibold uppercase tracking-wider text-primary">Kas Operasional</p>
        <h1 class="mt-1 text-2xl font-bold text-ink-primary">Ledger kas operasional</h1>
      </div>
    </div>

    <!-- Unified Minimalist Financial Hero Card -->
    <div class="rounded-3xl border border-zinc-200/80 bg-card p-5 shadow-soft space-y-4 dark:border-slate-700/55">
      <div class="flex items-start justify-between gap-3">
        <div>
          <p class="text-xs font-semibold uppercase tracking-wider text-ink-secondary">Saldo Berjalan</p>
          <h2 class="mt-1 font-mono text-3xl font-bold tracking-tight text-ink-primary sm:text-4xl">
            {{ formatCurrency(cashStore.balance) }}
          </h2>
        </div>
        <div class="flex h-11 w-11 items-center justify-center rounded-2xl border border-primary/20 bg-primary/10 text-primary dark:border-indigo-400/25 dark:bg-indigo-500/15 dark:text-indigo-300">
          <svg class="h-5 w-5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" d="M12 6v12m-3-2.818.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
          </svg>
        </div>
      </div>

      <!-- Today In & Out Breakdown in 2 clean columns -->
      <div class="grid grid-cols-2 gap-2.5 border-t border-zinc-100 pt-3.5 dark:border-slate-700/50">
        <div
          data-testid="cash-in-summary-card"
          class="flex items-center gap-2.5 rounded-2xl border border-emerald-200/80 bg-emerald-50/80 p-3 dark:border-emerald-500/25 dark:bg-emerald-500/10"
        >
          <div class="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-emerald-500/15 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300">
            <svg class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" d="M12 19V5m-7 7l7-7 7 7" />
            </svg>
          </div>
          <div class="min-w-0">
            <p class="text-[11px] font-medium text-emerald-800 dark:text-emerald-200/85">Kas Masuk Hari Ini</p>
            <p class="truncate font-mono text-sm font-bold text-emerald-700 dark:text-emerald-300">
              {{ formatCurrency(cashStore.todayCashIn) }}
            </p>
          </div>
        </div>

        <div
          data-testid="cash-out-summary-card"
          class="flex items-center gap-2.5 rounded-2xl border border-rose-200/80 bg-rose-50/80 p-3 dark:border-rose-500/25 dark:bg-rose-500/10"
        >
          <div class="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-rose-500/15 text-rose-700 dark:bg-rose-500/20 dark:text-rose-300">
            <svg class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" d="M12 5v14m7-7l-7 7-7-7" />
            </svg>
          </div>
          <div class="min-w-0">
            <p class="text-[11px] font-medium text-rose-800 dark:text-rose-200/85">Kas Keluar Hari Ini</p>
            <p class="truncate font-mono text-sm font-bold text-rose-700 dark:text-rose-300">
              {{ formatCurrency(cashStore.todayCashOut) }}
            </p>
          </div>
        </div>
      </div>

      <!-- Quick Action Buttons -->
      <div v-if="!isCashier" class="grid grid-cols-2 gap-2.5 pt-1">
        <button
          type="button"
          data-testid="cash-in-action-btn"
          class="flex items-center justify-center gap-1.5 rounded-2xl bg-emerald-600 px-4 py-2.5 text-xs font-semibold text-white shadow-soft hover:bg-emerald-700 active:scale-[0.98] transition whitespace-nowrap cursor-pointer"
          @click="openRecordModal('in')"
        >
          <svg class="h-4 w-4 shrink-0" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
          <span>Masuk<span class="sr-only"> Kas Masuk</span></span>
        </button>

        <button
          type="button"
          data-testid="cash-out-action-btn"
          class="flex items-center justify-center gap-1.5 rounded-2xl bg-rose-600 px-4 py-2.5 text-xs font-semibold text-white shadow-soft hover:bg-rose-700 active:scale-[0.98] transition whitespace-nowrap cursor-pointer"
          @click="openRecordModal('out')"
        >
          <svg class="h-4 w-4 shrink-0" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" d="M5 12h14" />
          </svg>
          <span>Keluar<span class="sr-only"> Kas Keluar</span></span>
        </button>
      </div>

      <!-- Cashier Locked Entry Notice -->
      <div
        v-else
        data-testid="cashier-entry-locked-banner"
        class="rounded-2xl border border-amber-200/80 bg-amber-50/80 p-3 text-xs text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200 flex items-center gap-2.5"
      >
        <svg class="h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 1 0-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 0 0 2.25-2.25v-6.75a2.25 2.25 0 0 0-2.25-2.25H6.75a2.25 2.25 0 0 0-2.25 2.25v6.75a2.25 2.25 0 0 0 2.25 2.25Z" />
        </svg>
        <span class="font-medium">
          Peran Kasir hanya dapat melihat ringkasan kas &amp; membuka laci. Entry kas masuk/keluar manual dibatasi untuk Owner/Supervisor.
        </span>
      </div>

      <!-- Quick Buka Laci Kasir Button on Android Native -->
      <div v-if="isNative" class="pt-1">
        <button
          type="button"
          class="flex w-full items-center justify-center gap-2 rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-2 text-xs font-semibold text-ink-primary shadow-2xs hover:bg-zinc-100 active:scale-[0.98] transition cursor-pointer dark:border-slate-700 dark:bg-slate-800 dark:text-white"
          :disabled="isOpeningDrawer"
          @click="handleOpenDrawer"
        >
          <svg class="h-4 w-4 text-zinc-500 dark:text-zinc-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="2" y="6" width="20" height="12" rx="2" />
            <circle cx="12" cy="12" r="2" />
          </svg>
          <span>{{ isOpeningDrawer ? 'Membuka Laci...' : 'Buka Laci Kasir' }}</span>
        </button>
      </div>
    </div>

    <!-- Riwayat Kas Section -->
    <div class="rounded-3xl border border-zinc-200/80 bg-card p-5 shadow-soft space-y-4 dark:border-slate-700/55">
      <div class="flex items-center justify-between gap-3">
        <div>
          <h2 class="text-base font-bold text-ink-primary">Riwayat Kas</h2>
          <p class="text-xs text-ink-secondary">Catatan arus kas operasional</p>
        </div>
        <span class="rounded-full border border-zinc-200/80 bg-surface px-2.5 py-1 text-xs font-medium text-ink-secondary dark:border-slate-700/70 dark:bg-[#1E2538] dark:text-slate-300">
          {{ filteredEntries.length }} transaksi
        </span>
      </div>

      <!-- Filter Tabs -->
      <div class="flex items-center gap-1.5 text-xs overflow-x-auto pb-0.5 no-scrollbar">
        <button
          type="button"
          class="rounded-full border px-3 py-1.5 font-semibold transition whitespace-nowrap cursor-pointer"
          :class="
            filterType === 'all'
              ? 'border-primary bg-primary text-white shadow-xs'
              : 'border-zinc-200/80 bg-surface text-ink-secondary hover:text-ink-primary dark:border-slate-700/70 dark:bg-[#1E2538] dark:text-slate-300'
          "
          @click="filterType = 'all'"
        >
          Semua
        </button>
        <button
          type="button"
          class="rounded-full border px-3 py-1.5 font-semibold transition whitespace-nowrap cursor-pointer"
          :class="
            filterType === 'in'
              ? 'border-emerald-600 bg-emerald-600 text-white shadow-xs'
              : 'border-emerald-200/80 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 dark:border-emerald-500/30 dark:bg-emerald-500/12 dark:text-emerald-300'
          "
          @click="filterType = 'in'"
        >
          Kas Masuk
        </button>
        <button
          type="button"
          class="rounded-full border px-3 py-1.5 font-semibold transition whitespace-nowrap cursor-pointer"
          :class="
            filterType === 'out'
              ? 'border-rose-600 bg-rose-600 text-white shadow-xs'
              : 'border-rose-200/80 bg-rose-50 text-rose-700 hover:bg-rose-100 dark:border-rose-500/30 dark:bg-rose-500/12 dark:text-rose-300'
          "
          @click="filterType = 'out'"
        >
          Kas Keluar
        </button>
      </div>

      <!-- Ledger Entries List -->
      <div v-if="filteredEntries.length > 0" class="divide-y divide-zinc-100 dark:divide-slate-700/50">
        <div
          v-for="entry in filteredEntries"
          :key="entry.id"
          class="flex items-center justify-between py-3 first:pt-1 last:pb-1 gap-3"
          data-testid="cash-entry-row"
        >
          <div class="flex items-center gap-3 min-w-0">
            <div
              class="flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl border"
              :class="
                entry.type === 'in'
                  ? 'border-emerald-200/70 bg-emerald-50 text-emerald-700 dark:border-emerald-500/25 dark:bg-emerald-500/15 dark:text-emerald-300'
                  : 'border-rose-200/70 bg-rose-50 text-rose-700 dark:border-rose-500/25 dark:bg-rose-500/15 dark:text-rose-300'
              "
            >
              <svg
                v-if="entry.type === 'in'"
                class="h-4 w-4"
                fill="none"
                stroke="currentColor"
                stroke-width="2.5"
                viewBox="0 0 24 24"
              >
                <path stroke-linecap="round" stroke-linejoin="round" d="M12 19V5m-7 7l7-7 7 7" />
              </svg>
              <svg
                v-else
                class="h-4 w-4"
                fill="none"
                stroke="currentColor"
                stroke-width="2.5"
                viewBox="0 0 24 24"
              >
                <path stroke-linecap="round" stroke-linejoin="round" d="M12 5v14m7-7l-7 7-7-7" />
              </svg>
            </div>
            <div class="min-w-0">
              <p class="text-sm font-semibold text-ink-primary truncate">{{ entry.category }}</p>
              <p v-if="entry.note" class="text-xs text-ink-secondary truncate">{{ entry.note }}</p>
              <p class="text-[11px] text-zinc-400">{{ formatDateTime(entry.createdAt) }}</p>
            </div>
          </div>

          <div class="text-right shrink-0">
            <p
              class="font-mono text-sm font-bold"
              :class="entry.type === 'in' ? 'text-emerald-600' : 'text-rose-600'"
            >
              {{ entry.type === 'in' ? '+' : '-' }}{{ formatCurrency(entry.amount) }}
            </p>
          </div>
        </div>
      </div>

      <!-- Empty State -->
      <div v-else class="rounded-2xl border border-dashed border-zinc-200 p-8 text-center space-y-1">
        <p class="text-sm font-semibold text-ink-primary">Belum ada riwayat kas.</p>
        <p class="text-xs text-ink-secondary">
          Transaksi kas masuk atau keluar yang dicatat akan muncul di sini.
        </p>
      </div>
    </div>

    <!-- Catat Kas Bottom Sheet Modal -->
    <BaseSheet
      :open="showRecordSheet"
      :title="cashForm.type === 'in' ? 'Catat Kas Masuk' : 'Catat Kas Keluar'"
      @close="showRecordSheet = false"
    >
      <div class="max-h-[75vh] overflow-y-auto space-y-4 pr-1">
        <!-- Type Toggle Segmented Control -->
        <div class="grid grid-cols-2 rounded-2xl bg-zinc-100 p-1">
          <button
            type="button"
            class="rounded-xl py-2 text-xs font-semibold transition"
            :class="
              cashForm.type === 'in'
                ? 'bg-emerald-600 text-white shadow-xs'
                : 'text-zinc-600 hover:text-zinc-900'
            "
            @click="setCashType('in')"
          >
            + Kas Masuk
          </button>
          <button
            type="button"
            class="rounded-xl py-2 text-xs font-semibold transition"
            :class="
              cashForm.type === 'out'
                ? 'bg-rose-600 text-white shadow-xs'
                : 'text-zinc-600 hover:text-zinc-900'
            "
            @click="setCashType('out')"
          >
            - Kas Keluar
          </button>
        </div>

        <!-- Alert notifications -->
        <p v-if="cashError" class="rounded-2xl bg-danger/10 px-4 py-2.5 text-xs font-medium text-danger">
          {{ cashError }}
        </p>
        <p
          v-if="feedbackMessage"
          class="rounded-2xl bg-emerald-100 px-4 py-2.5 text-xs font-medium text-emerald-700"
        >
          {{ feedbackMessage }}
        </p>

        <!-- Nominal Input with Quick Chips -->
        <div>
          <BaseInput
            :model-value="cashForm.amount"
            label="Nominal (Rp)"
            type="number"
            placeholder="0"
            @update:model-value="cashForm.amount = $event"
          />
          <div class="mt-2 flex flex-wrap gap-1.5">
            <button
              v-for="amt in QUICK_AMOUNTS"
              :key="amt"
              type="button"
              class="rounded-lg border border-zinc-200/80 bg-zinc-50 px-2 py-1 text-[11px] font-medium text-zinc-600 hover:bg-zinc-100 active:scale-95 transition"
              @click="selectQuickAmount(amt)"
            >
              +{{ amt >= 1000 ? `${amt / 1000}rb` : amt }}
            </button>
          </div>
        </div>

        <!-- Kategori with Suggestion Chips -->
        <div>
          <BaseInput
            :model-value="cashForm.category"
            label="Kategori"
            placeholder="Modal, Bahan, Listrik..."
            @update:model-value="cashForm.category = $event"
          />
          <div class="mt-2 flex flex-wrap gap-1.5">
            <button
              v-for="cat in CATEGORY_SUGGESTIONS[cashForm.type]"
              :key="cat"
              type="button"
              class="rounded-lg border border-zinc-200/80 bg-zinc-50 px-2 py-1 text-[11px] font-medium text-zinc-600 hover:bg-zinc-100 active:scale-95 transition"
              @click="cashForm.category = cat"
            >
              {{ cat }}
            </button>
          </div>
        </div>

        <!-- Catatan Input -->
        <BaseInput
          :model-value="cashForm.note"
          label="Catatan (Opsional)"
          placeholder="Keterangan transaksi kas..."
          @update:model-value="cashForm.note = $event"
        />

        <!-- Submit Button -->
        <div class="pt-1">
          <BaseButton
            block
            :variant="cashForm.type === 'in' ? 'primary' : 'danger'"
            @click="handleManualCash"
          >
            <span>Simpan<span class="sr-only"> Catat {{ cashForm.type === 'in' ? 'Kas Masuk' : 'Kas Keluar' }}</span></span>
          </BaseButton>
        </div>
      </div>
    </BaseSheet>

    <!-- Floating Action Button (FAB) -->
    <button
      v-if="!isCashier"
      type="button"
      data-testid="cash-open-modal"
      class="fixed right-5 bottom-[calc(env(safe-area-inset-bottom)+6.75rem)] md:bottom-8 z-30 flex h-14 w-14 items-center justify-center rounded-full bg-primary text-white shadow-[0_10px_25px_rgba(73,69,214,0.45)] transition hover:bg-primary-light active:scale-95 cursor-pointer"
      title="Catat Kas"
      aria-label="Catat Kas"
      @click="openRecordModal('in')"
    >
      <svg class="h-6 w-6" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
      </svg>
      <span class="sr-only">Catat</span>
    </button>
  </div>
</template>
