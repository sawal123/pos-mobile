<script setup>
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'

import AppIcon from '@/components/base/AppIcon.vue'
import BaseButton from '@/components/base/BaseButton.vue'
import BaseCard from '@/components/base/BaseCard.vue'
import BaseInput from '@/components/base/BaseInput.vue'
import BaseModal from '@/components/base/BaseModal.vue'
import { useBusinessStore } from '@/stores/businessStore'
import { useCashierStore } from '@/stores/cashierStore'
import { useCashStore } from '@/stores/cashStore'
import { useShiftStore } from '@/stores/shiftStore'
import { isPaidTransaction, useTransactionStore } from '@/stores/transactionStore'
import { formatCurrency, formatDateTime } from '@/utils/formatters'

const router = useRouter()
const businessStore = useBusinessStore()
const cashierStore = useCashierStore()
const cashStore = useCashStore()
const shiftStore = useShiftStore()
const transactionStore = useTransactionStore()

// ── Status & Times ──────────────────────────────────────────────────────────
const isOpen = computed(() => shiftStore.isOpen)
const openingBalance = computed(() => Number(shiftStore.openingBalance) || 0)
const openedAt = computed(() => shiftStore.openedAt)

const openedAtFormatted = computed(() => {
  if (!openedAt.value) return '-'
  return formatDateTime(openedAt.value)
})

const durationText = computed(() => {
  if (!openedAt.value) return '-'
  const start = new Date(openedAt.value).getTime()
  const now = Date.now()
  const diffMinutes = Math.max(0, Math.floor((now - start) / (1000 * 60)))
  const hours = Math.floor(diffMinutes / 60)
  const mins = diffMinutes % 60
  if (hours === 0) return `${mins} menit`
  return `${hours} jam ${mins} mnt`
})

// ── Shift Transactions & Sales ──────────────────────────────────────────────
const shiftTransactions = computed(() => {
  if (!isOpen.value || !openedAt.value) return []
  const startTime = new Date(openedAt.value).getTime()
  return transactionStore.items.filter((tx) => {
    const txTime = new Date(tx.createdAt).getTime()
    return txTime >= startTime
  })
})

const recentTransactions = computed(() => {
  return shiftTransactions.value.slice(0, 4)
})

const cashSalesTotal = computed(() => {
  return shiftTransactions.value
    .filter((tx) => (tx.paymentMethod || '').toLowerCase() === 'cash' && isPaidTransaction(tx))
    .reduce((sum, tx) => sum + (Number(tx.total) || 0), 0)
})

const cashSalesCount = computed(() => {
  return shiftTransactions.value.filter(
    (tx) => (tx.paymentMethod || '').toLowerCase() === 'cash' && isPaidTransaction(tx),
  ).length
})

const nonCashSalesTotal = computed(() => {
  return shiftTransactions.value
    .filter((tx) => (tx.paymentMethod || '').toLowerCase() !== 'cash' && isPaidTransaction(tx))
    .reduce((sum, tx) => sum + (Number(tx.total) || 0), 0)
})

const nonCashSalesCount = computed(() => {
  return shiftTransactions.value.filter(
    (tx) => (tx.paymentMethod || '').toLowerCase() !== 'cash' && isPaidTransaction(tx),
  ).length
})

const totalOmzet = computed(() => cashSalesTotal.value + nonCashSalesTotal.value)
const totalTxCount = computed(() => shiftTransactions.value.length)

const avgBasketSize = computed(() => {
  if (totalTxCount.value === 0) return 0
  return Math.round(totalOmzet.value / totalTxCount.value)
})

// ── Manual Cash In/Out in Drawer during Shift ───────────────────────────────
const manualCashEntries = computed(() => {
  if (!isOpen.value || !openedAt.value) return []
  const startTime = new Date(openedAt.value).getTime()
  return cashStore.entries.filter((entry) => {
    const entryTime = new Date(entry.createdAt).getTime()
    if (entryTime < startTime) return false
    if (entry.category === 'Saldo Awal' || entry.referenceId?.startsWith('opening-')) return false
    if (entry.category === 'Penjualan Cash' || entry.referenceId?.startsWith('sale-')) return false
    return true
  })
})

const manualCashIn = computed(() => {
  return manualCashEntries.value
    .filter((e) => e.type === 'in')
    .reduce((sum, e) => sum + (Number(e.amount) || 0), 0)
})

const manualCashOut = computed(() => {
  return manualCashEntries.value
    .filter((e) => e.type === 'out')
    .reduce((sum, e) => sum + (Number(e.amount) || 0), 0)
})

// Expected Cash in Drawer
const expectedCashInDrawer = computed(() => {
  return openingBalance.value + cashSalesTotal.value + manualCashIn.value - manualCashOut.value
})

// ── Open Shift State (Inline for Closed State) ───────────────────────────────
const openShiftDraft = ref('100000')
const presetOpeningBalances = [50000, 100000, 200000, 500000]

function selectOpeningPreset(amount) {
  openShiftDraft.value = String(amount)
}

function handleOpenShift() {
  const nominal = Number(openShiftDraft.value) || 0
  shiftStore.openShift(nominal)
  cashStore.recordOpeningBalance(nominal, shiftStore.openedAt)
}

// ── Close Shift Interactive Modal ───────────────────────────────────────────
const showCloseShiftModal = ref(false)
const countedCashInput = ref('')
const closeShiftNotes = ref('')
const showCloseSummaryModal = ref(false)
const closedSummaryData = ref(null)

function openCloseShiftFlow() {
  countedCashInput.value = String(expectedCashInDrawer.value)
  closeShiftNotes.value = ''
  showCloseShiftModal.value = true
}

const countedCashNumber = computed(() => {
  const val = Number(countedCashInput.value)
  return Number.isFinite(val) && val >= 0 ? val : 0
})

const cashDifference = computed(() => {
  return countedCashNumber.value - expectedCashInDrawer.value
})

function setExactCountedCash() {
  countedCashInput.value = String(expectedCashInDrawer.value)
}

function confirmCloseShift() {
  const finalSummary = {
    openedAt: shiftStore.openedAt,
    closedAt: new Date().toISOString(),
    openingBalance: openingBalance.value,
    cashSales: cashSalesTotal.value,
    nonCashSales: nonCashSalesTotal.value,
    totalOmzet: totalOmzet.value,
    totalTransactions: totalTxCount.value,
    manualCashIn: manualCashIn.value,
    manualCashOut: manualCashOut.value,
    expectedCash: expectedCashInDrawer.value,
    actualCash: countedCashNumber.value,
    difference: cashDifference.value,
    notes: closeShiftNotes.value,
    cashier: cashierStore.activeCashier?.name || 'Kasir Utama',
    outlet: businessStore.outlet || 'Outlet Utama',
  }

  shiftStore.closeShift(countedCashNumber.value, closeShiftNotes.value)
  closedSummaryData.value = finalSummary
  showCloseShiftModal.value = false
  showCloseSummaryModal.value = true
}

// ── Quick Mutation Modal (Cash In/Out) ──────────────────────────────────────
const showMutationModal = ref(false)
const mutationType = ref('in') // 'in' | 'out'
const mutationAmount = ref('')
const mutationCategory = ref('')
const mutationNote = ref('')
const mutationFeedback = ref('')

function openQuickMutation(type = 'in') {
  mutationType.value = type
  mutationAmount.value = ''
  mutationCategory.value = type === 'in' ? 'Kas Masuk Laci' : 'Pengeluaran Laci'
  mutationNote.value = ''
  mutationFeedback.value = ''
  showMutationModal.value = true
}

function submitQuickMutation() {
  const amount = Number(mutationAmount.value)
  if (Number.isNaN(amount) || amount <= 0) {
    mutationFeedback.value = 'Nominal harus lebih dari 0'
    return
  }

  cashStore.recordEntry({
    type: mutationType.value,
    amount,
    category: mutationCategory.value || (mutationType.value === 'in' ? 'Kas Masuk Laci' : 'Pengeluaran Laci'),
    note: mutationNote.value,
  })

  showMutationModal.value = false
}
</script>

<template>
  <div class="mx-auto max-w-3xl space-y-4 pb-28">
    <!-- Header -->
    <header class="flex items-center justify-between gap-3 pt-1">
      <div class="flex items-center gap-3">
        <button
          type="button"
          data-testid="shift-back-btn"
          class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-zinc-200 bg-white text-ink-primary transition active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
          aria-label="Kembali"
          @click="router.back()"
        >
          <AppIcon name="chevron-left" />
        </button>
        <div class="min-w-0">
          <p class="text-xs font-semibold uppercase tracking-wider text-primary">Operasional</p>
          <h2 class="truncate text-xl font-bold text-ink-primary sm:text-2xl">
            Manajemen Shift
          </h2>
        </div>
      </div>

      <div class="flex items-center gap-2">
        <span
          class="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold"
          :class="isOpen ? 'bg-emerald-100 text-emerald-800' : 'bg-zinc-100 text-zinc-600'"
          data-testid="shift-status-badge"
        >
          <span
            class="h-2 w-2 rounded-full"
            :class="isOpen ? 'bg-emerald-500 animate-pulse' : 'bg-zinc-400'"
          />
          {{ isOpen ? 'Shift Aktif' : 'Shift Tutup' }}
        </span>
      </div>
    </header>

    <!-- ═══════════════════════════════════════════════════════════════════════ -->
    <!-- STATE 1: SHIFT AKTIF (OPEN)                                            -->
    <!-- ═══════════════════════════════════════════════════════════════════════ -->
    <template v-if="isOpen">
      <!-- Hero Card: Saldo Kas di Laci Saat Ini -->
      <BaseCard
        class="relative overflow-hidden border border-emerald-200/80 bg-gradient-to-br from-emerald-50/70 via-white to-emerald-50/40 p-5 space-y-4 shadow-soft"
        data-testid="shift-active-hero"
      >
        <div class="flex items-start justify-between gap-3">
          <div class="space-y-1">
            <span class="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-800">
              <span class="h-2 w-2 rounded-full bg-emerald-500 animate-ping" />
              Kasir: {{ cashierStore.activeCashier?.name || 'Kasir Utama' }} • {{ businessStore.outlet || 'Outlet Utama' }}
            </span>
            <p class="text-xs font-medium uppercase tracking-wider text-ink-secondary">
              Estimasi Uang Fisik di Laci
            </p>
            <h3
              class="font-mono text-3xl font-extrabold tracking-tight text-ink-primary sm:text-4xl"
              data-testid="expected-cash-drawer"
            >
              {{ formatCurrency(expectedCashInDrawer) }}
            </h3>
            <p class="text-[11px] text-ink-secondary">
              Modal Awal ({{ formatCurrency(openingBalance) }}) + Tunai ({{ formatCurrency(cashSalesTotal) }}) + Kas Masuk ({{ formatCurrency(manualCashIn) }}) - Kas Keluar ({{ formatCurrency(manualCashOut) }})
            </p>
          </div>

          <div class="rounded-2xl bg-white/80 p-3 shadow-xs border border-emerald-100 text-right shrink-0">
            <p class="text-[10px] font-medium uppercase text-ink-secondary">Durasi Shift</p>
            <p class="font-bold text-sm text-emerald-700" data-testid="shift-duration">
              {{ durationText }}
            </p>
            <p class="text-[10px] text-ink-secondary mt-0.5">
              Sejak {{ openedAtFormatted.split(',')[1] || openedAtFormatted }}
            </p>
          </div>
        </div>

        <!-- Quick actions strip inside Hero -->
        <div class="grid grid-cols-2 gap-2 pt-2 border-t border-emerald-100/60">
          <BaseButton
            size="md"
            class="shadow-xs col-span-2"
            data-testid="btn-pos-shortcut"
            @click="router.push('/pos')"
          >
            <AppIcon name="pos" class="h-4 w-4 mr-2" />
            Buka Kasir (POS)
          </BaseButton>

          <BaseButton
            size="sm"
            variant="secondary"
            data-testid="btn-quick-mutation"
            @click="openQuickMutation('in')"
          >
            <AppIcon name="cash" class="h-4 w-4 mr-1.5 text-emerald-600" />
            Mutasi Kas
          </BaseButton>

          <BaseButton
            size="sm"
            variant="danger"
            data-testid="btn-trigger-close-shift"
            @click="openCloseShiftFlow"
          >
            Tutup Shift
          </BaseButton>
        </div>
      </BaseCard>

      <!-- 2x2 Metric Cards -->
      <div class="grid grid-cols-2 gap-3 sm:grid-cols-4" data-testid="shift-metrics-grid">
        <!-- Saldo Awal -->
        <BaseCard class="space-y-1 p-3.5">
          <div class="flex items-center justify-between">
            <span class="text-[11px] font-medium text-ink-secondary">Saldo Awal</span>
            <span class="rounded-lg bg-zinc-100 p-1 text-zinc-600">
              <AppIcon name="store" class="h-3.5 w-3.5" />
            </span>
          </div>
          <p class="font-mono text-base font-bold text-ink-primary truncate" data-testid="metric-opening-balance">
            {{ formatCurrency(openingBalance) }}
          </p>
          <p class="text-[10px] text-ink-secondary">Modal kasir dibuka</p>
        </BaseCard>

        <!-- Penjualan Tunai -->
        <BaseCard class="space-y-1 p-3.5">
          <div class="flex items-center justify-between">
            <span class="text-[11px] font-medium text-ink-secondary">Penjualan Tunai</span>
            <span class="rounded-lg bg-emerald-100 p-1 text-emerald-700">
              <AppIcon name="cash" class="h-3.5 w-3.5" />
            </span>
          </div>
          <p class="font-mono text-base font-bold text-emerald-700 truncate" data-testid="metric-cash-sales">
            {{ formatCurrency(cashSalesTotal) }}
          </p>
          <p class="text-[10px] text-ink-secondary">{{ cashSalesCount }} transaksi tunai</p>
        </BaseCard>

        <!-- Penjualan Non-Tunai -->
        <BaseCard class="space-y-1 p-3.5">
          <div class="flex items-center justify-between">
            <span class="text-[11px] font-medium text-ink-secondary">Non-Tunai / QRIS</span>
            <span class="rounded-lg bg-blue-100 p-1 text-blue-700">
              <AppIcon name="transactions" class="h-3.5 w-3.5" />
            </span>
          </div>
          <p class="font-mono text-base font-bold text-blue-700 truncate" data-testid="metric-non-cash-sales">
            {{ formatCurrency(nonCashSalesTotal) }}
          </p>
          <p class="text-[10px] text-ink-secondary">{{ nonCashSalesCount }} transaksi online</p>
        </BaseCard>

        <!-- Mutasi Kas Laci -->
        <BaseCard class="space-y-1 p-3.5">
          <div class="flex items-center justify-between">
            <span class="text-[11px] font-medium text-ink-secondary">Mutasi Laci</span>
            <span class="rounded-lg bg-amber-100 p-1 text-amber-700">
              <AppIcon name="shift" class="h-3.5 w-3.5" />
            </span>
          </div>
          <p class="font-mono text-sm font-bold text-ink-primary truncate" data-testid="metric-mutation">
            +{{ formatCurrency(manualCashIn) }}
          </p>
          <p class="text-[10px] text-danger truncate">
            -{{ formatCurrency(manualCashOut) }}
          </p>
        </BaseCard>
      </div>

      <!-- Ringkasan Performa Shift -->
      <BaseCard class="space-y-3" data-testid="shift-summary-card">
        <div class="flex items-center justify-between">
          <h4 class="text-sm font-bold text-ink-primary">Ringkasan Penjualan Shift Ini</h4>
          <span class="text-xs text-ink-secondary">
            Total Transaksi: <strong class="text-ink-primary">{{ totalTxCount }}</strong>
          </span>
        </div>

        <div class="grid grid-cols-2 gap-2 text-xs">
          <div class="rounded-2xl bg-surface p-3 space-y-1">
            <p class="text-[10px] uppercase tracking-wider text-ink-secondary font-medium">Total Omzet Shift</p>
            <p class="font-mono text-lg font-bold text-ink-primary" data-testid="shift-total-omzet">
              {{ formatCurrency(totalOmzet) }}
            </p>
            <p class="text-[10px] text-ink-secondary">Tunai + Non-Tunai</p>
          </div>

          <div class="rounded-2xl bg-surface p-3 space-y-1">
            <p class="text-[10px] uppercase tracking-wider text-ink-secondary font-medium">Rata-rata / Nota</p>
            <p class="font-mono text-lg font-bold text-ink-primary" data-testid="shift-avg-basket">
              {{ formatCurrency(avgBasketSize) }}
            </p>
            <p class="text-[10px] text-ink-secondary">Per transaksi selesai</p>
          </div>
        </div>

        <!-- Breakdown Metode Pembayaran Bar -->
        <div class="rounded-2xl border border-zinc-200/80 p-3 space-y-2">
          <div class="flex items-center justify-between text-xs font-semibold">
            <span class="flex items-center gap-1.5 text-emerald-700">
              <span class="h-2.5 w-2.5 rounded-full bg-emerald-500" />
              Tunai ({{ totalOmzet > 0 ? Math.round((cashSalesTotal / totalOmzet) * 100) : 0 }}%)
            </span>
            <span class="flex items-center gap-1.5 text-blue-700">
              <span class="h-2.5 w-2.5 rounded-full bg-blue-500" />
              Non-Tunai ({{ totalOmzet > 0 ? Math.round((nonCashSalesTotal / totalOmzet) * 100) : 0 }}%)
            </span>
          </div>

          <div class="h-2.5 w-full overflow-hidden rounded-full bg-zinc-100 flex">
            <div
              class="h-full bg-emerald-500 transition-all duration-500"
              :style="{ width: totalOmzet > 0 ? `${(cashSalesTotal / totalOmzet) * 100}%` : '50%' }"
            />
            <div
              class="h-full bg-blue-500 transition-all duration-500"
              :style="{ width: totalOmzet > 0 ? `${(nonCashSalesTotal / totalOmzet) * 100}%` : '50%' }"
            />
          </div>
        </div>
      </BaseCard>

      <!-- Transaksi Terbaru Shift -->
      <BaseCard class="space-y-3" data-testid="shift-recent-tx-card">
        <div class="flex items-center justify-between">
          <h4 class="text-sm font-bold text-ink-primary">Transaksi Shift Ini</h4>
          <button
            type="button"
            class="text-xs font-semibold text-primary hover:underline"
            @click="router.push('/transactions')"
          >
            Lihat Semua →
          </button>
        </div>

        <div v-if="recentTransactions.length === 0" class="rounded-2xl bg-surface p-4 text-center text-xs text-ink-secondary">
          Belum ada transaksi penjualan pada shift ini.
        </div>

        <div v-else class="space-y-2">
          <div
            v-for="tx in recentTransactions"
            :key="tx.id"
            class="flex items-center justify-between rounded-2xl border border-zinc-200/70 p-3 text-xs"
          >
            <div class="min-w-0 space-y-0.5">
              <p class="font-semibold text-ink-primary truncate">
                {{ tx.orderNumber || tx.invoiceNumber || tx.id }}
              </p>
              <div class="flex items-center gap-2 text-ink-secondary text-[11px]">
                <span>{{ tx.createdAt ? new Date(tx.createdAt).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) : '-' }}</span>
                <span>•</span>
                <span class="capitalize">{{ tx.paymentMethod || 'Cash' }}</span>
              </div>
            </div>

            <div class="text-right shrink-0">
              <p class="font-mono font-bold text-ink-primary">
                {{ formatCurrency(tx.total) }}
              </p>
              <span
                class="inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold"
                :class="isPaidTransaction(tx) ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'"
              >
                {{ isPaidTransaction(tx) ? 'Lunas' : tx.status }}
              </span>
            </div>
          </div>
        </div>
      </BaseCard>
    </template>

    <!-- ═══════════════════════════════════════════════════════════════════════ -->
    <!-- STATE 2: SHIFT BELUM DIBUKA (CLOSED)                                   -->
    <!-- ═══════════════════════════════════════════════════════════════════════ -->
    <template v-else>
      <BaseCard class="space-y-4 p-5 text-center" data-testid="shift-closed-hero">
        <div class="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
          <AppIcon name="shift" class="h-8 w-8" />
        </div>

        <div class="space-y-1">
          <h3 class="text-xl font-bold text-ink-primary">Shift Belum Dibuka</h3>
          <p class="text-xs text-ink-secondary max-w-sm mx-auto">
            Buka shift kasir untuk mencatat modal kas laci dan mengaktifkan fitur pembayaran POS.
          </p>
        </div>

        <div class="rounded-2xl border border-zinc-200 bg-surface/70 p-4 text-left space-y-3">
          <label class="block text-xs font-semibold text-ink-primary">
            Modal / Saldo Awal Kasir (Rp)
          </label>

          <!-- Quick Presets -->
          <div class="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <button
              v-for="preset in presetOpeningBalances"
              :key="preset"
              type="button"
              class="rounded-xl border py-2 text-xs font-semibold transition"
              :class="
                Number(openShiftDraft) === preset
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-zinc-200 bg-white text-ink-secondary hover:bg-zinc-50'
              "
              @click="selectOpeningPreset(preset)"
            >
              {{ formatCurrency(preset) }}
            </button>
          </div>

          <BaseInput
            v-model="openShiftDraft"
            type="number"
            placeholder="Contoh: 100000"
            hint="Uang tunai awal di laci untuk modal kembalian."
          />
        </div>

        <BaseButton block size="lg" data-testid="btn-open-shift" @click="handleOpenShift">
          Buka Shift Sekarang
        </BaseButton>
      </BaseCard>
    </template>

    <!-- ═══════════════════════════════════════════════════════════════════════ -->
    <!-- MODAL: TUTUP SHIFT INTERAKTIF                                         -->
    <!-- ═══════════════════════════════════════════════════════════════════════ -->
    <BaseModal
      :open="showCloseShiftModal"
      title="Tutup Shift Kasir"
      @close="showCloseShiftModal = false"
    >
      <div class="space-y-4 text-xs" data-testid="modal-close-shift">
        <!-- Expected Cash Display -->
        <div class="rounded-2xl border border-zinc-200 bg-surface p-3.5 space-y-2">
          <div class="flex items-center justify-between">
            <span class="text-ink-secondary">Estimasi Uang Kas di Laci:</span>
            <span class="font-mono text-base font-bold text-ink-primary" data-testid="close-expected-cash">
              {{ formatCurrency(expectedCashInDrawer) }}
            </span>
          </div>

          <div class="text-[11px] text-ink-secondary border-t border-zinc-200/50 pt-2 space-y-1">
            <div class="flex justify-between">
              <span>Saldo Awal:</span>
              <span>+{{ formatCurrency(openingBalance) }}</span>
            </div>
            <div class="flex justify-between">
              <span>Penjualan Tunai:</span>
              <span>+{{ formatCurrency(cashSalesTotal) }}</span>
            </div>
            <div v-if="manualCashIn > 0" class="flex justify-between">
              <span>Kas Masuk Tambahan:</span>
              <span>+{{ formatCurrency(manualCashIn) }}</span>
            </div>
            <div v-if="manualCashOut > 0" class="flex justify-between text-danger">
              <span>Pengeluaran Kas:</span>
              <span>-{{ formatCurrency(manualCashOut) }}</span>
            </div>
          </div>
        </div>

        <!-- Counted Cash Input -->
        <div class="space-y-1.5">
          <div class="flex items-center justify-between">
            <label class="font-semibold text-ink-primary">Hitung Uang Fisik Kas di Laci (Rp)</label>
            <button
              type="button"
              class="text-[11px] font-semibold text-primary hover:underline"
              @click="setExactCountedCash"
            >
              Isi Sesuai Estimasi
            </button>
          </div>
          <BaseInput
            v-model="countedCashInput"
            type="number"
            data-testid="input-counted-cash"
            placeholder="Masukkan jumlah uang fisik di laci"
          />
        </div>

        <!-- Real-time Difference (Selisih) Alert -->
        <div
          class="rounded-2xl p-3 flex items-center justify-between"
          :class="{
            'bg-emerald-50 text-emerald-800 border border-emerald-200': cashDifference === 0,
            'bg-danger/10 text-danger border border-danger/20': cashDifference < 0,
            'bg-blue-50 text-blue-800 border border-blue-200': cashDifference > 0,
          }"
          data-testid="cash-difference-banner"
        >
          <span class="font-medium">
            {{
              cashDifference === 0
                ? '✓ Uang fisik di laci pas (Sesuai)'
                : cashDifference < 0
                  ? '⚠ Selisih Kurang (Uang fisik kurang)'
                  : '★ Selisih Lebih (Uang fisik berlebih)'
            }}
          </span>
          <span class="font-mono font-bold text-sm">
            {{ cashDifference === 0 ? 'Rp 0' : formatCurrency(cashDifference) }}
          </span>
        </div>

        <!-- Notes -->
        <div class="space-y-1">
          <label class="font-medium text-ink-secondary">Catatan Tutup Shift (Opsional)</label>
          <textarea
            v-model="closeShiftNotes"
            rows="2"
            data-testid="input-close-notes"
            placeholder="Contoh: Selisih Rp 500 karena pembulatan kembalian"
            class="w-full rounded-2xl border border-zinc-200 bg-white p-2.5 text-xs text-ink-primary outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
          />
        </div>

        <!-- Modal Actions -->
        <div class="flex gap-2 pt-2">
          <BaseButton
            variant="secondary"
            class="flex-1"
            @click="showCloseShiftModal = false"
          >
            Batal
          </BaseButton>
          <BaseButton
            variant="danger"
            class="flex-1"
            data-testid="btn-confirm-close"
            @click="confirmCloseShift"
          >
            Konfirmasi Tutup
          </BaseButton>
        </div>
      </div>
    </BaseModal>

    <!-- ═══════════════════════════════════════════════════════════════════════ -->
    <!-- MODAL: RINGKASAN LAPORAN TUTUP SHIFT                                  -->
    <!-- ═══════════════════════════════════════════════════════════════════════ -->
    <BaseModal
      :open="showCloseSummaryModal"
      title="Laporan Shift Selesai"
      @close="showCloseSummaryModal = false"
    >
      <div v-if="closedSummaryData" class="space-y-4 text-xs" data-testid="modal-close-summary">
        <div class="rounded-2xl bg-emerald-50 border border-emerald-200/80 p-3.5 text-center space-y-1">
          <p class="text-xs font-semibold uppercase tracking-wider text-emerald-800">Shift Berhasil Ditutup</p>
          <p class="font-mono text-2xl font-extrabold text-ink-primary">
            {{ formatCurrency(closedSummaryData.totalOmzet) }}
          </p>
          <p class="text-[11px] text-emerald-700">Total Omzet Penjualan</p>
        </div>

        <div class="rounded-2xl border border-zinc-200 bg-surface p-3.5 space-y-2">
          <div class="flex justify-between">
            <span class="text-ink-secondary">Kasir</span>
            <span class="font-semibold text-ink-primary">{{ closedSummaryData.cashier }}</span>
          </div>
          <div class="flex justify-between">
            <span class="text-ink-secondary">Total Transaksi</span>
            <span class="font-semibold text-ink-primary">{{ closedSummaryData.totalTransactions }} Transaksi</span>
          </div>
          <div class="flex justify-between border-t border-zinc-200/60 pt-2">
            <span class="text-ink-secondary">Saldo Awal</span>
            <span class="font-semibold text-ink-primary">{{ formatCurrency(closedSummaryData.openingBalance) }}</span>
          </div>
          <div class="flex justify-between">
            <span class="text-ink-secondary">Penjualan Tunai</span>
            <span class="font-semibold text-emerald-700">+{{ formatCurrency(closedSummaryData.cashSales) }}</span>
          </div>
          <div class="flex justify-between">
            <span class="text-ink-secondary">Penjualan Non-Tunai</span>
            <span class="font-semibold text-blue-700">+{{ formatCurrency(closedSummaryData.nonCashSales) }}</span>
          </div>
          <div class="flex justify-between border-t border-zinc-200/60 pt-2">
            <span class="text-ink-secondary">Uang Fisik Kas di Laci</span>
            <span class="font-mono font-bold text-ink-primary">{{ formatCurrency(closedSummaryData.actualCash) }}</span>
          </div>
          <div class="flex justify-between">
            <span class="text-ink-secondary">Selisih</span>
            <span
              class="font-mono font-bold"
              :class="closedSummaryData.difference === 0 ? 'text-emerald-700' : closedSummaryData.difference < 0 ? 'text-danger' : 'text-blue-700'"
            >
              {{ closedSummaryData.difference === 0 ? 'Pas (Rp 0)' : formatCurrency(closedSummaryData.difference) }}
            </span>
          </div>
          <div v-if="closedSummaryData.notes" class="border-t border-zinc-200/60 pt-2">
            <p class="text-ink-secondary">Catatan:</p>
            <p class="italic text-ink-primary">{{ closedSummaryData.notes }}</p>
          </div>
        </div>

        <div class="flex flex-col gap-2 pt-2">
          <BaseButton
            block
            data-testid="btn-summary-home"
            @click="showCloseSummaryModal = false; router.push('/home')"
          >
            Kembali ke Beranda
          </BaseButton>
        </div>
      </div>
    </BaseModal>

    <!-- ═══════════════════════════════════════════════════════════════════════ -->
    <!-- MODAL: QUICK MUTATION (KAS MASUK / KAS KELUAR)                        -->
    <!-- ═══════════════════════════════════════════════════════════════════════ -->
    <BaseModal
      :open="showMutationModal"
      :title="mutationType === 'in' ? 'Catat Kas Masuk Laci' : 'Catat Pengeluaran Laci'"
      @close="showMutationModal = false"
    >
      <div class="space-y-4 text-xs" data-testid="modal-quick-mutation">
        <!-- Toggle In / Out -->
        <div class="flex rounded-2xl bg-zinc-100 p-1">
          <button
            type="button"
            class="flex-1 rounded-xl py-2 font-semibold transition"
            :class="mutationType === 'in' ? 'bg-white text-emerald-700 shadow-xs' : 'text-ink-secondary'"
            @click="mutationType = 'in'; mutationCategory = 'Kas Masuk Laci'"
          >
            Kas Masuk (+)
          </button>
          <button
            type="button"
            class="flex-1 rounded-xl py-2 font-semibold transition"
            :class="mutationType === 'out' ? 'bg-white text-danger shadow-xs' : 'text-ink-secondary'"
            @click="mutationType = 'out'; mutationCategory = 'Pengeluaran Laci'"
          >
            Kas Keluar (-)
          </button>
        </div>

        <div class="space-y-1">
          <label class="font-semibold text-ink-primary">Nominal (Rp)</label>
          <BaseInput
            v-model="mutationAmount"
            type="number"
            data-testid="input-mutation-amount"
            placeholder="Contoh: 50000"
          />
        </div>

        <div class="space-y-1">
          <label class="font-semibold text-ink-primary">Kategori / Keperluan</label>
          <BaseInput
            v-model="mutationCategory"
            placeholder="Contoh: Tambah modal receh / Beli galon air"
          />
        </div>

        <div class="space-y-1">
          <label class="font-semibold text-ink-primary">Keterangan (Opsional)</label>
          <BaseInput
            v-model="mutationNote"
            placeholder="Keterangan tambahan"
          />
        </div>

        <p v-if="mutationFeedback" class="text-xs font-semibold text-danger">
          {{ mutationFeedback }}
        </p>

        <div class="flex gap-2 pt-2">
          <BaseButton
            variant="secondary"
            class="flex-1"
            @click="showMutationModal = false"
          >
            Batal
          </BaseButton>
          <BaseButton
            class="flex-1"
            data-testid="btn-submit-mutation"
            @click="submitQuickMutation"
          >
            Simpan Mutasi
          </BaseButton>
        </div>
      </div>
    </BaseModal>
  </div>
</template>
