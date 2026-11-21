<script setup>
import { computed, watch } from 'vue'

import BaseButton from '@/components/base/BaseButton.vue'
import BaseSheet from '@/components/base/BaseSheet.vue'
import CartItem from '@/components/pos/CartItem.vue'
import CartCustomerInput from '@/components/pos/CartCustomerInput.vue'
import { useCartStore } from '@/stores/cartStore'
import { useTaxStore } from '@/stores/taxStore'
import { useBusinessStore } from '@/stores/businessStore'
import { useTableStore } from '@/stores/tableStore'
import { useTransactionStore } from '@/stores/transactionStore'
import { formatCurrency } from '@/utils/formatters'

const props = defineProps({
  open: {
    type: Boolean,
    default: false,
  },
})

const emit = defineEmits(['close', 'checkout', 'pay-later', 'select-promo'])

const cartStore = useCartStore()
const taxStore = useTaxStore()
const businessStore = useBusinessStore()
const tableStore = useTableStore()
const transactionStore = useTransactionStore()

const isTableManagementEnabled = computed(() => {
  return (
    businessStore.tableManagementEnabled ||
    Boolean(businessStore.table_management_enabled)
  )
})

const availableTables = computed(() => tableStore.availableTables || [])

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
  if (val === 'custom') {
    // leave as is
  } else {
    cartStore.setTableNumber(val)
  }
}

function onAttachToOrderSelect(orderId) {
  if (!orderId) return
  const found = inProcessOrders.value.find((it) => String(it.id) === String(orderId))
  if (found) {
    cartStore.attachToActiveOrder(found)
  }
}

const items = computed(() => cartStore.items)
const itemCount = computed(() => items.value.length)

// The floating checkout bar (this sheet's trigger) disappears when the cart is
// empty, so the sheet must close itself when the last line is removed.
watch(
  () => cartStore.items.length,
  (length) => {
    if (props.open && length === 0) {
      emit('close')
    }
  },
)

function close() {
  emit('close')
}

function checkout() {
  emit('close')
  emit('checkout')
}

function payLater() {
  emit('close')
  emit('pay-later')
}
</script>

<template>
  <BaseSheet :open="open" title="Keranjang" @close="close">
    <div data-testid="mobile-cart-sheet" class="flex max-h-[calc(100dvh-8rem)] flex-col gap-3 overflow-y-auto">
      <!-- Active Editing Order Banner (Mobile) -->
      <div
        v-if="cartStore.isEditingOrder"
        data-testid="mobile-editing-order-banner"
        class="flex items-center justify-between rounded-xl border border-sky-300 bg-sky-50 p-2.5 text-xs text-sky-950 dark:border-sky-800 dark:bg-sky-950/60 dark:text-sky-200"
      >
        <div class="min-w-0 pr-1">
          <div class="flex items-center gap-1.5 font-bold truncate">
            <span class="inline-block h-2 w-2 rounded-full bg-sky-500 animate-pulse"></span>
            <span>Menambah: {{ cartStore.editingTransactionInvoice }}</span>
          </div>
          <p class="text-[11px] text-sky-700 dark:text-sky-400 mt-0.5 truncate">
            {{ cartStore.customerName ? `Tamu: ${cartStore.customerName}` : '' }}
            {{ cartStore.customerName && cartStore.tableNumber ? ' • ' : '' }}
            {{ cartStore.tableNumber ? `Meja ${cartStore.tableNumber}` : '' }}
          </p>
        </div>
        <button
          type="button"
          data-testid="btn-mobile-cancel-edit-order"
          class="rounded-lg border border-sky-300 bg-white px-2.5 py-1 text-xs font-bold text-sky-900 hover:bg-sky-100 cursor-pointer dark:border-sky-700 dark:bg-slate-900 dark:text-sky-200 shrink-0"
          @click="cartStore.cancelEditingOrder()"
        >
          Batal
        </button>
      </div>

      <!-- Attach to Active In-Process Order (Mobile) -->
      <div
        v-if="!cartStore.isEditingOrder && inProcessOrders.length > 0 && items.length"
        class="space-y-1.5 rounded-2xl border border-sky-200/80 bg-sky-50/80 p-2.5 text-xs dark:border-sky-800/60 dark:bg-sky-950/40"
        data-testid="mobile-cart-attach-section"
      >
        <div class="flex items-center justify-between">
          <label for="mobile-attach-order-select" class="font-semibold text-sky-900 dark:text-sky-200">
            Tambah ke Pesanan Berjalan
          </label>
          <span class="text-[10px] text-sky-700 dark:text-sky-400">Opsional</span>
        </div>
        <select
          id="mobile-attach-order-select"
          data-testid="mobile-select-attach-to-active-order"
          class="w-full h-9 rounded-lg border border-sky-300 bg-white px-2 text-xs text-ink-primary outline-none focus:border-primary dark:border-sky-700 dark:bg-slate-900"
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

      <CartCustomerInput v-if="items.length" input-id="mobile-cart-customer-phone" />

      <!-- Table Selection (Mobile) -->
      <div
        v-if="isTableManagementEnabled && items.length"
        class="space-y-1.5 rounded-2xl border border-zinc-200/80 bg-zinc-50/80 p-2.5 text-xs dark:border-slate-700/60 dark:bg-slate-800/60"
        data-testid="mobile-cart-table-section"
      >
        <div class="flex items-center justify-between">
          <label for="mobile-cart-table-input" class="font-semibold text-ink-primary">
            Nomor Meja (Dine-In)
          </label>
          <span class="text-[10px] text-ink-secondary">Opsional</span>
        </div>
        <div class="flex items-center gap-1.5">
          <select
            v-if="availableTables.length > 0"
            id="mobile-cart-table-select"
            :value="availableTables.some((t) => t.name === cartStore.tableNumber) ? cartStore.tableNumber : (cartStore.tableNumber ? 'custom' : '')"
            data-testid="mobile-cart-table-select"
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
            id="mobile-cart-table-input"
            :value="cartStore.tableNumber"
            type="text"
            placeholder="No. Meja"
            data-testid="mobile-cart-table-input"
            class="h-9 min-w-0 flex-1 rounded-lg border border-zinc-200 bg-white px-2.5 text-xs text-ink-primary outline-none transition placeholder:text-zinc-400 focus:border-primary dark:border-slate-700 dark:bg-slate-900"
            @input="cartStore.setTableNumber($event.target.value)"
          />
          <button
            v-if="cartStore.tableNumber"
            type="button"
            class="text-xs text-zinc-400 hover:text-red-500 cursor-pointer px-1"
            title="Hapus nomor meja"
            @click="cartStore.setTableNumber('')"
          >
            ✕
          </button>
        </div>
      </div>
      <div
        v-if="items.length"
        data-testid="mobile-cart-list"
        class="no-scrollbar max-h-[55vh] space-y-2.5 overflow-y-auto pr-0.5"
      >
        <CartItem
          v-for="item in items"
          :key="item.id"
          :item="item"
          touch
          show-subtotal
          @increase="cartStore.increaseQty"
          @decrease="cartStore.decreaseQty"
          @update-qty="cartStore.updateQty"
          @remove="cartStore.removeItem"
        />
      </div>

      <p v-else class="py-6 text-center text-sm text-ink-secondary" data-testid="mobile-cart-empty">
        Keranjang masih kosong.
      </p>

      <div v-if="items.length" class="space-y-3 border-t border-zinc-100 pt-3">
        <div class="flex items-center justify-between text-xs text-ink-secondary">
          <span>Subtotal</span>
          <span>{{ formatCurrency(cartStore.subtotal) }}</span>
        </div>

        <div
          v-if="cartStore.appliedPromo || cartStore.discount > 0"
          class="flex cursor-pointer items-center justify-between rounded-lg bg-emerald-50 px-2.5 py-1.5 text-xs font-medium text-emerald-700 hover:bg-emerald-100/70 transition-colors dark:bg-emerald-950/40 dark:text-emerald-300"
          @click="$emit('select-promo')"
        >
          <div class="flex items-center gap-1.5 min-w-0">
            <span>🏷️</span>
            <span class="truncate font-medium">{{ cartStore.discountLabel || cartStore.appliedPromo?.name || 'Diskon' }}</span>
            <button
              type="button"
              class="ml-1 text-xs text-zinc-400 hover:text-red-500 transition-colors cursor-pointer"
              title="Hapus diskon"
              aria-label="Hapus diskon"
              @click.stop="cartStore.removePromo()"
            >
              ✕
            </button>
          </div>
          <span class="shrink-0 font-semibold">-{{ formatCurrency(cartStore.discount) }}</span>
        </div>

        <button
          v-else
          type="button"
          class="flex w-full items-center justify-between rounded-lg border border-dashed border-zinc-200 px-2.5 py-1.5 text-xs font-medium text-primary hover:border-primary/50 transition-colors text-left cursor-pointer"
          @click="$emit('select-promo')"
        >
          <span class="flex items-center gap-1.5">
            <span>🏷️</span> Tambah Diskon / Promo
          </span>
          <span class="text-zinc-400">›</span>
        </button>

        <div
          v-if="taxStore.enabled && taxStore.rate > 0"
          class="flex items-center justify-between text-xs text-ink-secondary"
        >
          <span>Pajak ({{ taxStore.rate }}%)</span>
          <span>{{ formatCurrency(cartStore.tax) }}</span>
        </div>
        <div class="flex items-center justify-between border-t border-zinc-200 pt-2.5">
          <span class="text-sm font-semibold text-ink-primary">Total</span>
          <span class="text-base font-bold text-ink-primary" data-testid="mobile-cart-total">
            {{ formatCurrency(cartStore.total) }}
          </span>
        </div>

        <div v-if="cartStore.isEditingOrder" class="grid grid-cols-2 gap-2">
          <BaseButton
            variant="secondary"
            size="lg"
            data-testid="mobile-cart-cancel-edit"
            @click="cartStore.cancelEditingOrder()"
          >
            Batal
          </BaseButton>
          <BaseButton
            variant="primary"
            size="lg"
            data-testid="mobile-cart-save-order"
            @click="checkout"
          >
            Simpan Tambahan
          </BaseButton>
        </div>
        <div v-else class="grid grid-cols-2 gap-2">
          <BaseButton
            variant="secondary"
            size="lg"
            data-testid="mobile-cart-pay-later"
            @click="payLater"
          >
            Bayar Nanti
          </BaseButton>
          <BaseButton
            variant="primary"
            size="lg"
            data-testid="mobile-cart-checkout"
            @click="checkout"
          >
            Bayar
          </BaseButton>
        </div>
        <p class="text-center text-[11px] text-ink-secondary">
          {{ itemCount }} item &bull; Ubah jumlah atau hapus produk sebelum bayar
        </p>
      </div>
    </div>
  </BaseSheet>
</template>
