<script setup>
import { computed, ref, watch } from 'vue'
import { useSyncPushStore } from '@/stores/syncPushStore'
import { useSyncStatusStore } from '@/stores/syncStatusStore'
import { useSyncReconciliationStore } from '@/stores/syncReconciliationStore'
import { formatCurrency, formatDateTime } from '@/utils/formatters'

const props = defineProps({
  modelValue: {
    type: Boolean,
    default: false,
  },
})

const emit = defineEmits(['update:modelValue'])

const syncPushStore = useSyncPushStore()
const syncStatusStore = useSyncStatusStore()
const syncReconciliationStore = useSyncReconciliationStore()

const items = ref([])
const loading = ref(false)
const actionLoading = ref(false)
const feedbackMessage = ref(null)

async function loadPendingItems() {
  loading.value = true
  feedbackMessage.value = null
  try {
    const list = await syncPushStore.listPendingItems({ limit: 100 })
    items.value = Array.isArray(list) ? list : []
  } catch (err) {
    items.value = []
    console.error('Failed to load pending queue items:', err)
  } finally {
    loading.value = false
  }
}

watch(
  () => props.modelValue,
  (isOpen) => {
    if (isOpen) {
      loadPendingItems()
    }
  },
  { immediate: true },
)

function closeModal() {
  emit('update:modelValue', false)
}

function getEntityLabel(type) {
  const t = String(type || '').toLowerCase()
  if (t === 'sale' || t === 'transaction' || t === 'order') return 'Transaksi Penjualan'
  if (t === 'product') return 'Produk / Menu'
  if (t === 'customer') return 'Pelanggan'
  if (t === 'expense') return 'Pengeluaran'
  if (t === 'category') return 'Kategori Produk'
  if (t === 'stock_movement' || t === 'movement') return 'Mutasi Stok'
  return type || 'Data'
}

function getEntityBadgeClass(type) {
  const t = String(type || '').toLowerCase()
  if (t === 'sale' || t === 'transaction' || t === 'order') {
    return 'bg-emerald-50 text-emerald-700 border-emerald-200/70 dark:bg-emerald-950/50 dark:text-emerald-300 dark:border-emerald-800/40'
  }
  if (t === 'product') {
    return 'bg-indigo-50 text-indigo-700 border-indigo-200/70 dark:bg-indigo-950/50 dark:text-indigo-300 dark:border-indigo-800/40'
  }
  if (t === 'customer') {
    return 'bg-amber-50 text-amber-700 border-amber-200/70 dark:bg-amber-950/50 dark:text-amber-300 dark:border-amber-800/40'
  }
  if (t === 'expense') {
    return 'bg-rose-50 text-rose-700 border-rose-200/70 dark:bg-rose-950/50 dark:text-rose-300 dark:border-rose-800/40'
  }
  return 'bg-zinc-100 text-zinc-700 border-zinc-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700'
}

function getOperationLabel(op) {
  const o = String(op || '').toLowerCase()
  if (o === 'delete') return 'Hapus'
  if (o === 'upsert' || o === 'update' || o === 'create') return 'Tambah / Edit'
  return op || 'Mutasi'
}

function getItemTitle(item) {
  const p = item.payload || {}
  const type = String(item.entityType || '').toLowerCase()

  if (type === 'sale' || type === 'transaction') {
    return p.invoiceNumber || p.invoice_number || `Transaksi #${String(item.entityId).slice(0, 8)}`
  }
  if (type === 'product') {
    return p.name || `Produk #${String(item.entityId).slice(0, 8)}`
  }
  if (type === 'customer') {
    return p.name || `Pelanggan #${String(item.entityId).slice(0, 8)}`
  }
  if (type === 'expense') {
    return p.description || p.note || `Pengeluaran #${String(item.entityId).slice(0, 8)}`
  }
  if (type === 'category') {
    return p.name || `Kategori #${String(item.entityId).slice(0, 8)}`
  }
  return `ID: ${item.entityId || item.id}`
}

function getItemSubtitle(item) {
  const p = item.payload || {}
  const type = String(item.entityType || '').toLowerCase()

  if (type === 'sale' || type === 'transaction') {
    const cust = p.customer || p.customer_name || 'Walk-in Customer'
    const total = p.total ?? p.grandTotal ?? 0
    const count = Array.isArray(p.items) ? `${p.items.length} item` : ''
    return `${cust} • ${formatCurrency(total)} ${count ? '• ' + count : ''}`
  }
  if (type === 'product') {
    return `Harga: ${formatCurrency(p.price || 0)} • Stok: ${p.stock ?? '-'}`
  }
  if (type === 'customer') {
    return `No HP: ${p.phone || '-'}`
  }
  if (type === 'expense') {
    return `Nominal: ${formatCurrency(p.amount || 0)}`
  }
  return ''
}

async function handleSyncNow() {
  actionLoading.value = true
  feedbackMessage.value = null
  try {
    if (syncStatusStore.reconciliationRequired || syncStatusStore.hasInflight) {
      try {
        const reconRes = await syncReconciliationStore.reconcile()
        if (reconRes?.outcome === 'COMMITTED') {
          feedbackMessage.value = {
            type: 'success',
            text: 'Pemulihan berhasil! Transaksi tertunda telah terkonfirmasi tersimpan di server Cloud.',
          }
          await syncStatusStore.refresh()
          await loadPendingItems()
          return
        }
      } catch (reconErr) {
        console.warn('Reconcile pre-check warning:', reconErr)
      }
    }

    const res = await syncPushStore.pushNow()
    if (res?.ok) {
      feedbackMessage.value = {
        type: 'success',
        text: 'Sinkronisasi berhasil! Data lokal telah terkirim ke server Cloud.',
      }
    } else {
      feedbackMessage.value = {
        type: 'error',
        text: res?.message || res?.error?.message || 'Sinkronisasi belum berhasil. Periksa koneksi internet Anda.',
      }
    }
    await syncStatusStore.refresh()
    await loadPendingItems()
  } catch (err) {
    feedbackMessage.value = {
      type: 'error',
      text: err instanceof Error ? err.message : String(err),
    }
  } finally {
    actionLoading.value = false
  }
}

async function handleDeleteQueueItem(item) {
  const confirmMsg = `Hapus antrean "${getItemTitle(item)}" dari daftar sinkronisasi? Tindakan ini tidak dapat dibatalkan.`
  if (!window.confirm(confirmMsg)) return

  try {
    await syncPushStore.removePendingItem(item.id)
    await loadPendingItems()
  } catch (err) {
    window.alert('Gagal menghapus antrean: ' + (err?.message || err))
  }
}
</script>

<template>
  <div
    v-if="modelValue"
    class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs transition-opacity"
    data-testid="sync-pending-details-modal"
  >
    <div
      class="flex max-h-[90vh] w-full max-w-xl flex-col rounded-3xl border border-zinc-200/90 bg-white shadow-2xl dark:border-slate-800 dark:bg-[#161B2A]"
    >
      <!-- Modal Header -->
      <div class="flex items-center justify-between border-b border-zinc-100 p-4.5 dark:border-slate-800/80">
        <div class="flex items-center gap-2.5">
          <div class="flex h-10 w-10 items-center justify-center rounded-2xl bg-sky-50 text-sky-600 dark:bg-sky-950/60 dark:text-sky-300">
            <svg class="h-5 w-5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <div>
            <h2 class="text-base font-bold text-ink-primary dark:text-white">
              Data Belum Terkirim ke Cloud
            </h2>
            <p class="text-xs text-ink-secondary dark:text-zinc-400">
              {{ items.length }} data lokal menunggu sinkronisasi
            </p>
          </div>
        </div>

        <button
          type="button"
          class="flex h-8 w-8 items-center justify-center rounded-xl text-zinc-400 hover:bg-zinc-100 hover:text-ink-primary dark:hover:bg-slate-800 cursor-pointer"
          @click="closeModal"
        >
          <svg class="h-5 w-5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <!-- Modal Body -->
      <div class="flex-1 overflow-y-auto p-4 space-y-3 no-scrollbar">
        <!-- Recovery / Inflight Alert Banner -->
        <div
          v-if="syncStatusStore.hasInflight || syncStatusStore.reconciliationRequired"
          class="rounded-2xl border border-amber-300 bg-amber-50/90 p-3.5 text-xs text-amber-900 shadow-2xs dark:border-amber-700/60 dark:bg-amber-950/40 dark:text-amber-200"
        >
          <div class="flex items-start gap-2">
            <span class="text-base text-amber-600 dark:text-amber-400">⚠️</span>
            <div class="space-y-1">
              <p class="font-bold text-amber-900 dark:text-amber-100">
                Data Tertunda Membutuhkan Pemulihan
              </p>
              <p class="text-[11px] leading-relaxed text-amber-800 dark:text-amber-200">
                Pengiriman data sebelumnya terputus saat kasir menyimpan pesanan (koneksi ngelag/timeout). Data transaksi Anda aman di perangkat ini. Tekan tombol <strong>"Pulihkan &amp; Sinkronkan"</strong> di bawah untuk menyelesaikan pengiriman ke Cloud secara aman.
              </p>
            </div>
          </div>
        </div>

        <!-- Info Banner -->
        <div class="rounded-2xl border border-sky-200/70 bg-sky-50/70 p-3 text-xs text-sky-900 dark:border-sky-800/40 dark:bg-sky-950/30 dark:text-sky-200">
          <p class="font-medium">
            💡 Semua transaksi dan perubahan data tersimpan aman secara offline di SQLite HP/Tablet ini. Data otomatis terkirim saat tersambung internet.
          </p>
        </div>

        <!-- Feedback Alert -->
        <div
          v-if="feedbackMessage"
          class="rounded-2xl p-3 text-xs font-semibold"
          :class="
            feedbackMessage.type === 'success'
              ? 'bg-emerald-50 text-emerald-800 border border-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-300'
              : 'bg-rose-50 text-rose-800 border border-rose-200 dark:bg-rose-950/50 dark:text-rose-300'
          "
        >
          {{ feedbackMessage.text }}
        </div>

        <!-- Loading State -->
        <div v-if="loading" class="py-12 text-center text-xs text-zinc-400">
          <div class="inline-block h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent mb-2" />
          <p>Memuat daftar antrean lokal...</p>
        </div>

        <!-- Empty State -->
        <div
          v-else-if="items.length === 0"
          class="rounded-3xl border border-dashed border-zinc-200 p-8 text-center dark:border-slate-800"
        >
          <div class="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-600 dark:bg-emerald-950/60 dark:text-emerald-300">
            <svg class="h-6 w-6" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" d="M4.5 12.75l6 6 9-13.5" />
            </svg>
          </div>
          <p class="mt-3 text-sm font-bold text-ink-primary dark:text-white">Semua Data Sudah Tersinkronkan</p>
          <p class="mt-1 text-xs text-ink-secondary dark:text-zinc-400">
            Tidak ada transaksi atau perubahan data lokal yang tertahan di antrean.
          </p>
        </div>

        <!-- Pending Items List -->
        <div v-else class="space-y-2.5">
          <div
            v-for="item in items"
            :key="item.id"
            class="rounded-2xl border border-zinc-200/80 bg-white p-3.5 shadow-2xs space-y-2 dark:border-slate-800 dark:bg-[#1B2133]"
            data-testid="sync-pending-item-card"
          >
            <!-- Item Header: Type & Action Badges -->
            <div class="flex items-center justify-between gap-2 flex-wrap">
              <div class="flex items-center gap-1.5 flex-wrap">
                <span
                  class="rounded-lg border px-2 py-0.5 text-[10px] font-bold"
                  :class="getEntityBadgeClass(item.entityType)"
                >
                  {{ getEntityLabel(item.entityType) }}
                </span>
                <span
                  class="rounded-lg border px-2 py-0.5 text-[10px] font-bold"
                  :class="
                    item.operation === 'delete'
                      ? 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/50 dark:text-rose-300'
                      : 'bg-zinc-100 text-zinc-600 border-zinc-200 dark:bg-slate-800 dark:text-zinc-300'
                  "
                >
                  {{ getOperationLabel(item.operation) }}
                </span>
              </div>

              <span class="text-[11px] text-zinc-400 font-mono">
                {{ item.createdAt ? formatDateTime(item.createdAt) : '-' }}
              </span>
            </div>

            <!-- Item Main Content -->
            <div>
              <p class="text-sm font-bold text-ink-primary dark:text-white truncate">
                {{ getItemTitle(item) }}
              </p>
              <p v-if="getItemSubtitle(item)" class="text-xs text-ink-secondary mt-0.5 truncate">
                {{ getItemSubtitle(item) }}
              </p>
            </div>

            <!-- Error Banner (Why it failed / why it's pending) -->
            <div
              v-if="item.lastError"
              class="rounded-xl border border-rose-200/80 bg-rose-50/80 p-2.5 text-xs text-rose-800 space-y-1 dark:border-rose-900/50 dark:bg-rose-950/40 dark:text-rose-200"
            >
              <div class="flex items-start gap-1.5 font-semibold">
                <span class="text-rose-600 dark:text-rose-400">⚠️</span>
                <span>Penyebab Belum Terkirim:</span>
              </div>
              <p class="text-[11px] leading-relaxed break-words font-mono">
                {{ item.lastError }}
              </p>
              <p v-if="item.attemptCount > 0" class="text-[10px] text-rose-600/80 dark:text-rose-400">
                Telah dicoba sebanyak: {{ item.attemptCount }} kali
              </p>
            </div>

            <div
              v-else-if="item.attemptCount > 0"
              class="rounded-xl bg-amber-50 p-2 text-[11px] text-amber-800 dark:bg-amber-950/40 dark:text-amber-300"
            >
              Sedang dalam antrean pengiriman ulang (Percobaan ke-{{ item.attemptCount }})
            </div>

            <!-- Card Bottom: Option to Remove Stuck Item -->
            <div class="flex items-center justify-end pt-1">
              <button
                type="button"
                class="text-[11px] font-medium text-rose-600 hover:text-rose-700 hover:underline cursor-pointer dark:text-rose-400"
                @click="handleDeleteQueueItem(item)"
              >
                Hapus dari Antrean
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- Modal Footer -->
      <div class="flex items-center justify-between gap-3 border-t border-zinc-100 p-4 dark:border-slate-800/80">
        <button
          type="button"
          class="rounded-xl border border-zinc-200 bg-white px-4 py-2 text-xs font-semibold text-ink-primary hover:bg-zinc-50 active:scale-95 transition cursor-pointer dark:border-slate-700 dark:bg-slate-800 dark:text-white"
          @click="closeModal"
        >
          Tutup
        </button>

        <button
          type="button"
          class="inline-flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-xs font-bold text-white shadow-xs hover:bg-primary-hover active:scale-95 transition disabled:opacity-50 cursor-pointer"
          :disabled="actionLoading || (items.length === 0 && !syncStatusStore.hasInflight && !syncStatusStore.reconciliationRequired)"
          @click="handleSyncNow"
        >
          <svg
            v-if="actionLoading"
            class="h-4 w-4 animate-spin"
            fill="none"
            viewBox="0 0 24 24"
          >
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          <svg
            v-else
            class="h-4 w-4"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            viewBox="0 0 24 24"
          >
            <path stroke-linecap="round" stroke-linejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" />
          </svg>
          <span>{{ actionLoading ? 'Memulihkan & Mengirim...' : (syncStatusStore.hasInflight || syncStatusStore.reconciliationRequired ? 'Pulihkan & Sinkronkan' : 'Sinkronkan Sekarang') }}</span>
        </button>
      </div>
    </div>
  </div>
</template>
