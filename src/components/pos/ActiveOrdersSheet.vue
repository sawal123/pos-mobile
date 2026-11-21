<script setup>
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'

import BaseButton from '@/components/base/BaseButton.vue'
import BaseSheet from '@/components/base/BaseSheet.vue'
import { useBusinessStore } from '@/stores/businessStore'
import { useSyncPushStore } from '@/stores/syncPushStore'
import { useTransactionStore } from '@/stores/transactionStore'
import { formatCurrency, formatDateTime } from '@/utils/formatters'

const props = defineProps({
  open: {
    type: Boolean,
    default: false,
  },
})

const emit = defineEmits(['close', 'add-to-order', 'edit-order'])

const router = useRouter()
const transactionStore = useTransactionStore()
const businessStore = useBusinessStore()
const syncPushStore = useSyncPushStore()

const feedbackMsg = ref('')

function isSameDay(date1, date2) {
  const d1 = new Date(date1)
  const d2 = new Date(date2)
  return (
    d1.getFullYear() === d2.getFullYear() &&
    d1.getMonth() === d2.getMonth() &&
    d1.getDate() === d2.getDate()
  )
}

function formatOrderTime(value) {
  if (!value) return ''
  try {
    const d = new Date(value)
    if (isNaN(d.getTime())) return ''
    return new Intl.DateTimeFormat('id-ID', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(d)
  } catch {
    return ''
  }
}

const activeOrders = computed(() => {
  const today = new Date()
  return transactionStore.items
    .filter((item) => {
      if (item.orderStatus === 'Batal') return false
      // Filter transaksi hari ini
      const isToday = item.createdAt ? isSameDay(item.createdAt, today) : true
      // Kriteria aktif: sedang diproses ATAU belum lunas
      const isPending =
        item.orderStatus === 'Proses' ||
        item.paymentStatus === 'unpaid' ||
        item.status === 'unpaid'
      return isToday && isPending
    })
    .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))
})

const activeCount = computed(() => activeOrders.value.length)

async function markAsReady(order) {
  const ok = transactionStore.updateOrderStatus(order.id, 'Siap')
  if (ok) {
    feedbackMsg.value = `✓ Pesanan ${order.invoiceNumber || ''} berhasil ditandai Siap!`
    setTimeout(() => {
      feedbackMsg.value = ''
    }, 2500)

    if (businessStore.isCloudMode) {
      try {
        await syncPushStore.pushIfOnline?.()
      } catch {
        // Safe fallback
      }
    }
  }
}

function printReceipt(order) {
  emit('close')
  router.push(`/transactions/${order.id}/receipt`)
}

function settlePayment(order) {
  emit('close')
  router.push(`/transactions/${order.id}`)
}

function addToOrder(order) {
  emit('close')
  emit('add-to-order', order)
}

function editOrder(order) {
  emit('close')
  router.push(`/transactions/${order.id}?edit=items`)
}

function viewOrderDetail(order) {
  emit('close')
  router.push(`/transactions/${order.id}`)
}

function viewAllTransactions() {
  emit('close')
  router.push('/transactions')
}
</script>

<template>
  <BaseSheet
    :open="open"
    :title="`Antrean Pesanan Aktif (${activeCount})`"
    @close="emit('close')"
  >
    <div
      data-testid="pos-active-orders-sheet"
      class="flex max-h-[calc(100dvh-8rem)] flex-col gap-3 overflow-y-auto pb-4"
    >
      <!-- Feedback notification -->
      <div
        v-if="feedbackMsg"
        class="flex items-center gap-2 rounded-2xl bg-emerald-50 px-3.5 py-2.5 text-xs font-bold text-emerald-700 transition dark:bg-emerald-950/40 dark:text-emerald-300"
      >
        <span>{{ feedbackMsg }}</span>
      </div>

      <!-- Empty state -->
      <div
        v-if="activeOrders.length === 0"
        class="flex flex-col items-center justify-center py-10 text-center"
      >
        <div class="flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100 text-emerald-600 dark:bg-emerald-950/50 dark:text-emerald-400">
          <svg class="h-7 w-7" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        </div>
        <h3 class="mt-3 text-sm font-bold text-ink-primary">Tidak Ada Antrean Berjalan</h3>
        <p class="mt-1 max-w-xs text-xs text-ink-secondary">
          Semua pesanan hari ini sudah selesai atau belum ada pesanan baru yang sedang diproses.
        </p>
      </div>

      <!-- Active Orders List -->
      <div v-else class="no-scrollbar space-y-3 overflow-y-auto pr-0.5">
        <div
          v-for="order in activeOrders"
          :key="order.id"
          class="rounded-2xl border border-zinc-200/90 bg-white p-3.5 shadow-2xs transition hover:border-zinc-300 dark:border-slate-800 dark:bg-[#1B2133]"
        >
          <!-- Card Header: Invoice & Status Badges -->
          <div class="flex items-start justify-between gap-2 border-b border-zinc-100 pb-2 dark:border-slate-800/80">
            <div class="min-w-0">
              <div class="flex items-center gap-1.5 flex-wrap">
                <span class="truncate font-mono text-xs font-bold text-ink-primary dark:text-white">
                  {{ order.invoiceNumber || '-' }}
                </span>
                <span v-if="order.createdAt" class="text-[11px] text-ink-secondary">
                  • {{ formatOrderTime(order.createdAt) }}
                </span>
              </div>
              <p class="truncate text-xs font-medium text-ink-secondary mt-0.5">
                {{ order.customer || 'Walk-in Customer' }}
                <span v-if="order.tableNumber || order.table_number" class="ml-1 font-bold text-amber-700 dark:text-amber-400">
                  • Meja {{ order.tableNumber || order.table_number }}
                </span>
              </p>
            </div>

            <!-- Status Badges & Quick Action Button -->
            <div class="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
              <!-- Order Status Badge -->
              <span
                v-if="order.orderStatus === 'Proses'"
                class="inline-flex items-center gap-1 rounded-full bg-sky-50 px-2 py-0.5 text-[10px] font-bold text-sky-700 border border-sky-200/60 dark:bg-sky-950/50 dark:text-sky-300 dark:border-sky-800/40"
              >
                <span class="h-1.5 w-1.5 rounded-full bg-sky-500 animate-pulse" />
                <span>Proses</span>
              </span>
              <span
                v-else-if="order.orderStatus === 'Siap'"
                class="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700 border border-emerald-200/60 dark:bg-emerald-950/50 dark:text-emerald-300 dark:border-emerald-800/40"
              >
                <span>Siap</span>
              </span>

              <!-- Payment Status Badge -->
              <span
                v-if="order.paymentStatus === 'unpaid' || order.status === 'unpaid'"
                class="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-700 border border-amber-200/60 dark:bg-amber-950/50 dark:text-amber-300 dark:border-amber-800/40"
              >
                <span>Belum Lunas</span>
              </span>

              <!-- Tombol Tambah Pesanan Langsung di Header (Selalu Terlihat Tanpa Scroll) -->
              <button
                v-if="order.orderStatus === 'Proses' || order.paymentStatus === 'unpaid' || order.status === 'unpaid'"
                type="button"
                data-testid="btn-add-items-to-order-header"
                title="Tambah pesanan untuk antrean ini di kasir"
                class="inline-flex h-7 items-center gap-1 rounded-lg bg-primary/10 border border-primary/25 px-2 text-[11px] font-bold text-primary hover:bg-primary/20 active:scale-95 transition cursor-pointer whitespace-nowrap shrink-0 dark:border-primary/40 dark:bg-primary/20 dark:text-primary-light"
                @click="addToOrder(order)"
              >
                <svg class="h-3 w-3 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
                <span>Tambah Pesanan</span>
              </button>
            </div>
          </div>

          <!-- Items Summary (dibatasi max-height agar tidak menutupi layar saat banyak pesanan) -->
          <div class="py-2.5 space-y-1 max-h-36 overflow-y-auto no-scrollbar">
            <div
              v-for="(line, idx) in (order.items || [])"
              :key="idx"
              class="flex items-center justify-between text-xs"
            >
              <div class="truncate text-ink-primary dark:text-slate-200">
                <span class="font-bold">{{ line.qty ?? line.quantity ?? 1 }}x</span>
                {{ line.name || line.serviceName || 'Item' }}
              </div>
              <span class="shrink-0 font-mono text-ink-secondary">
                {{ formatCurrency(line.subtotal ?? (Number(line.price ?? 0) * Number(line.qty ?? 1))) }}
              </span>
            </div>
          </div>

          <!-- Card Footer: Total & 1-Click Action Buttons -->
          <div class="flex items-center justify-between gap-2 border-t border-zinc-100 pt-2.5 dark:border-slate-800/80">
            <div>
              <p class="text-[10px] font-medium text-ink-secondary uppercase tracking-wider">Total</p>
              <p class="font-mono text-sm font-bold text-primary dark:text-indigo-400">
                {{ formatCurrency(order.total) }}
              </p>
            </div>

            <!-- Action Buttons -->
            <div class="flex flex-wrap items-center justify-end gap-1.5">
              <!-- Tombol Tambah Pesanan Langsung di Kasir -->
              <button
                v-if="order.orderStatus === 'Proses' || order.paymentStatus === 'unpaid' || order.status === 'unpaid'"
                type="button"
                data-testid="btn-add-items-to-order"
                title="Tambah pesanan untuk antrean ini di kasir"
                class="inline-flex h-8 items-center gap-1.5 rounded-xl bg-primary/10 border border-primary/25 px-2.5 text-xs font-bold text-primary hover:bg-primary/20 active:scale-95 transition cursor-pointer whitespace-nowrap shrink-0 dark:border-primary/40 dark:bg-primary/20 dark:text-primary-light"
                @click="addToOrder(order)"
              >
                <svg class="h-3.5 w-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
                <span>Tambah Pesanan</span>
              </button>

              <!-- Tombol Cetak Struk -->
              <button
                type="button"
                title="Cetak Struk"
                class="inline-flex h-8 w-8 items-center justify-center rounded-xl border border-zinc-200 bg-white text-ink-secondary shadow-2xs transition hover:bg-zinc-50 hover:text-ink-primary active:scale-95 cursor-pointer dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
                @click="printReceipt(order)"
              >
                <svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <polyline points="6 9 6 2 18 2 18 9" />
                  <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
                  <rect x="6" y="14" width="12" height="8" />
                </svg>
              </button>

              <!-- Tombol Edit Menu Pesanan -->
              <button
                type="button"
                title="Edit Menu Pesanan"
                class="inline-flex h-8 w-8 items-center justify-center rounded-xl border border-zinc-200 bg-white text-ink-secondary shadow-2xs transition hover:bg-zinc-50 hover:text-primary active:scale-95 cursor-pointer dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
                data-testid="btn-sheet-edit-order"
                @click="editOrder(order)"
              >
                <svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                  <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
                </svg>
              </button>

              <!-- Tombol Lunasi jika unpaid -->
              <button
                v-if="order.paymentStatus === 'unpaid' || order.status === 'unpaid'"
                type="button"
                class="inline-flex h-8 items-center gap-1 rounded-xl bg-amber-500 px-2.5 text-xs font-bold text-white shadow-2xs transition hover:bg-amber-600 active:scale-95 cursor-pointer"
                @click="settlePayment(order)"
              >
                <span>Bayar</span>
              </button>

              <!-- Tombol 1-Tap Tandai Siap -->
              <button
                v-if="order.orderStatus === 'Proses'"
                type="button"
                class="inline-flex h-8 items-center gap-1.5 rounded-xl bg-emerald-600 px-3 text-xs font-bold text-white shadow-2xs transition hover:bg-emerald-700 active:scale-95 cursor-pointer"
                @click="markAsReady(order)"
              >
                <svg class="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                <span>Tandai Siap</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- Bottom link to full transaction history -->
      <div class="pt-2 text-center">
        <button
          type="button"
          class="text-xs font-semibold text-primary transition hover:underline cursor-pointer dark:text-indigo-400"
          @click="viewAllTransactions"
        >
          Lihat Semua Riwayat Transaksi →
        </button>
      </div>
    </div>
  </BaseSheet>
</template>
