<script setup>
import { computed } from 'vue'
import BaseButton from '@/components/base/BaseButton.vue'
import BaseCard from '@/components/base/BaseCard.vue'
import { formatCurrency } from '@/utils/formatters'
import { useBusinessStore } from '@/stores/businessStore'
import { useCartStore } from '@/stores/cartStore'
import { useTableStore } from '@/stores/tableStore'
import { useTransactionStore } from '@/stores/transactionStore'

defineProps({
  subtotal: {
    type: Number,
    default: 0,
  },
  discount: {
    type: Number,
    default: 0,
  },
  discountLabel: {
    type: String,
    default: '',
  },
  appliedPromo: {
    type: Object,
    default: null,
  },
  tax: {
    type: Number,
    default: 0,
  },
  taxEnabled: {
    type: Boolean,
    default: true,
  },
  taxRate: {
    type: Number,
    default: 11,
  },
  total: {
    type: Number,
    default: 0,
  },
  disabled: {
    type: Boolean,
    default: false,
  },
  showAction: {
    type: Boolean,
    default: true,
  },
  actionLabel: {
    type: String,
    default: 'Bayar',
  },
  allowPromoSelect: {
    type: Boolean,
    default: true,
  },
})

defineEmits(['checkout', 'select-promo', 'remove-promo'])

let businessStore = null
let tableStore = null
let cartStore = null
let transactionStore = null

try {
  businessStore = useBusinessStore()
  tableStore = useTableStore()
  cartStore = useCartStore()
  transactionStore = useTransactionStore()
} catch {
  // outside Pinia scope fallback
}

const isTableManagementEnabled = computed(() => {
  return (
    businessStore?.tableManagementEnabled ||
    Boolean(businessStore?.table_management_enabled)
  )
})

const availableTables = computed(() => tableStore?.availableTables || [])

const inProcessOrders = computed(() => {
  return (transactionStore?.items || []).filter((it) => {
    if (it.orderStatus === 'Batal') return false
    return (
      it.orderStatus === 'Proses' ||
      it.paymentStatus === 'unpaid' ||
      it.status === 'unpaid'
    )
  })
})

function onTableSelect(val) {
  if (!cartStore) return
  if (val === 'custom') {
    // leave as is for free typing
  } else {
    cartStore.setTableNumber(val)
  }
}

function onAttachToOrderSelect(orderId) {
  if (!orderId || !cartStore) return
  const found = inProcessOrders.value.find((it) => String(it.id) === String(orderId))
  if (found) {
    cartStore.attachToActiveOrder(found)
  }
}
</script>

<template>
  <BaseCard class="space-y-3">
    <!-- Active Editing Order Indicator -->
    <div
      v-if="cartStore?.isEditingOrder"
      data-testid="cart-editing-order-indicator"
      class="flex items-center justify-between rounded-xl border border-sky-300 bg-sky-50 px-2.5 py-2 text-xs font-semibold text-sky-800 dark:border-sky-800 dark:bg-sky-950/60 dark:text-sky-300"
    >
      <div class="min-w-0 pr-1">
        <div class="flex items-center gap-1.5 truncate">
          <span class="inline-block h-2 w-2 rounded-full bg-sky-500 animate-pulse"></span>
          <span class="font-bold">Menambah: {{ cartStore.editingTransactionInvoice }}</span>
        </div>
        <p v-if="cartStore.tableNumber || cartStore.customerName" class="text-[10px] text-sky-600 dark:text-sky-400 mt-0.5 truncate">
          {{ cartStore.tableNumber ? `Meja ${cartStore.tableNumber}` : '' }}
          {{ cartStore.tableNumber && cartStore.customerName ? '• ' : '' }}
          {{ cartStore.customerName ? cartStore.customerName : '' }}
        </p>
      </div>
      <button
        type="button"
        data-testid="btn-cart-cancel-editing"
        class="text-xs text-sky-600 hover:text-red-600 underline font-semibold cursor-pointer shrink-0"
        @click="cartStore.cancelEditingOrder()"
      >
        Batal
      </button>
    </div>

    <!-- Attach to Active In-Process Order Dropdown (if not editing yet) -->
    <div
      v-if="!cartStore?.isEditingOrder && inProcessOrders.length > 0 && (cartStore?.items || []).length > 0"
      class="space-y-1.5 rounded-xl border border-sky-200/80 bg-sky-50/70 p-2.5 text-xs dark:border-sky-800/60 dark:bg-sky-950/40"
      data-testid="attach-to-order-section"
    >
      <div class="flex items-center justify-between">
        <label for="select-attach-order" class="font-semibold text-sky-900 dark:text-sky-200">
          Tambah ke Pesanan Berjalan
        </label>
        <span class="text-[10px] text-sky-700 dark:text-sky-400">Opsional</span>
      </div>
      <select
        id="select-attach-order"
        data-testid="select-attach-to-active-order"
        class="w-full h-8.5 rounded-lg border border-sky-300 bg-white px-2 text-xs text-ink-primary outline-none focus:border-primary dark:border-sky-700 dark:bg-slate-900"
        @change="onAttachToOrderSelect($event.target.value); $event.target.value = ''"
      >
        <option value="">-- Pilih Pesanan (Gabungkan) --</option>
        <option
          v-for="order in inProcessOrders"
          :key="order.id"
          :value="order.id"
        >
          {{ order.invoiceNumber || order.id }} - {{ order.customer || 'Walk-in' }} {{ order.tableNumber ? `(Meja ${order.tableNumber})` : '' }}
        </option>
      </select>
    </div>
    <!-- Table Management (Nomor Meja) -->
    <div
      v-if="isTableManagementEnabled"
      class="space-y-1.5 rounded-xl border border-zinc-200/80 bg-zinc-50/80 p-2.5 text-xs dark:border-slate-700/60 dark:bg-slate-800/60"
      data-testid="cart-table-section"
    >
      <div class="flex items-center justify-between">
        <label for="cart-table-input" class="font-semibold text-ink-primary">
          Nomor Meja (Dine-In)
        </label>
        <span class="text-[10px] text-ink-secondary">Opsional</span>
      </div>
      <div class="flex items-center gap-1.5">
        <select
          v-if="availableTables.length > 0"
          id="cart-table-select"
          :value="availableTables.some((t) => t.name === cartStore?.tableNumber) ? cartStore?.tableNumber : (cartStore?.tableNumber ? 'custom' : '')"
          data-testid="cart-table-select"
          class="h-9 rounded-lg border border-zinc-200 bg-white px-2 text-xs text-ink-primary outline-none focus:border-primary dark:border-slate-700 dark:bg-slate-900"
          @change="onTableSelect($event.target.value)"
        >
          <option value="">Pilih Meja...</option>
          <option v-for="tbl in availableTables" :key="tbl.id" :value="tbl.name">
            {{ tbl.name }} {{ tbl.capacity ? `(${tbl.capacity} org)` : '' }}
          </option>
          <option value="custom">Ketik Bebas...</option>
        </select>
        <input
          id="cart-table-input"
          :value="cartStore?.tableNumber || ''"
          type="text"
          placeholder="No. Meja (misal: 01, VIP 1)"
          data-testid="cart-table-input"
          class="h-9 min-w-0 flex-1 rounded-lg border border-zinc-200 bg-white px-2.5 text-xs text-ink-primary outline-none transition placeholder:text-zinc-400 focus:border-primary dark:border-slate-700 dark:bg-slate-900"
          @input="cartStore?.setTableNumber($event.target.value)"
        />
        <button
          v-if="cartStore?.tableNumber"
          type="button"
          class="text-xs text-zinc-400 hover:text-red-500 cursor-pointer px-1"
          title="Hapus nomor meja"
          @click="cartStore?.setTableNumber('')"
        >
          ✕
        </button>
      </div>
    </div>

    <div class="flex items-center justify-between text-sm text-ink-secondary">
      <span>Subtotal</span>
      <span>{{ formatCurrency(subtotal) }}</span>
    </div>

    <div
      v-if="appliedPromo || discount > 0"
      class="flex items-center justify-between text-sm"
      :class="
        allowPromoSelect
          ? 'rounded-lg bg-emerald-50 px-2.5 py-1.5 font-medium text-emerald-700 cursor-pointer hover:bg-emerald-100/70 transition-colors dark:bg-emerald-950/40 dark:text-emerald-300'
          : 'text-ink-secondary'
      "
      @click="allowPromoSelect && $emit('select-promo')"
    >
      <div class="flex items-center gap-1.5 min-w-0">
        <span v-if="allowPromoSelect" class="text-xs">🏷️</span>
        <span class="truncate font-medium">{{ discountLabel || appliedPromo?.name || 'Diskon' }}</span>
        <button
          v-if="allowPromoSelect"
          type="button"
          class="ml-1 text-xs text-zinc-400 hover:text-red-500 transition-colors cursor-pointer"
          title="Hapus diskon"
          aria-label="Hapus diskon"
          @click.stop="$emit('remove-promo')"
        >
          ✕
        </button>
      </div>
      <span class="shrink-0 font-semibold text-emerald-600 dark:text-emerald-400">-{{ formatCurrency(discount) }}</span>
    </div>

    <div
      v-else-if="allowPromoSelect && !disabled"
      class="flex cursor-pointer items-center justify-between rounded-lg border border-dashed border-zinc-200 px-2.5 py-1.5 text-xs font-medium text-primary hover:border-primary/50 transition-colors"
      role="button"
      tabindex="0"
      data-testid="cart-summary-select-discount"
      @click="$emit('select-promo')"
    >
      <span class="flex items-center gap-1.5">
        <span>🏷️</span> Tambah Diskon / Promo
      </span>
      <span class="text-zinc-400">›</span>
    </div>

    <div
      v-else-if="!allowPromoSelect"
      class="flex items-center justify-between text-sm text-ink-secondary"
      data-testid="cart-summary-zero-discount"
    >
      <span>Diskon</span>
      <span class="font-mono text-ink-primary dark:text-zinc-300">Rp 0</span>
    </div>

    <div v-if="taxEnabled && taxRate > 0" class="flex items-center justify-between text-sm text-ink-secondary">
      <span>Pajak ({{ taxRate }}%)</span>
      <span>{{ formatCurrency(tax) }}</span>
    </div>
    <div class="flex items-center justify-between border-t border-zinc-200 pt-3 text-base font-semibold">
      <span>Total</span>
      <span>{{ formatCurrency(total) }}</span>
    </div>

    <BaseButton
      v-if="showAction"
      block
      :disabled="disabled"
      @click="$emit('checkout')"
    >
      {{ actionLabel }}
    </BaseButton>
  </BaseCard>
</template>
