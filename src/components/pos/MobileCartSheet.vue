<script setup>
import { computed, watch } from 'vue'

import BaseButton from '@/components/base/BaseButton.vue'
import BaseSheet from '@/components/base/BaseSheet.vue'
import CartItem from '@/components/pos/CartItem.vue'
import { useCartStore } from '@/stores/cartStore'
import { useTaxStore } from '@/stores/taxStore'
import { formatCurrency } from '@/utils/formatters'

const props = defineProps({
  open: {
    type: Boolean,
    default: false,
  },
})

const emit = defineEmits(['close', 'checkout'])

const cartStore = useCartStore()
const taxStore = useTaxStore()

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
</script>

<template>
  <BaseSheet :open="open" title="Keranjang" @close="close">
    <div data-testid="mobile-cart-sheet" class="flex flex-col gap-3">
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

        <BaseButton
          block
          size="lg"
          data-testid="mobile-cart-checkout"
          @click="checkout"
        >
          Bayar
        </BaseButton>
        <p class="text-center text-[11px] text-ink-secondary">
          {{ itemCount }} item &bull; Ubah jumlah atau hapus produk sebelum bayar
        </p>
      </div>
    </div>
  </BaseSheet>
</template>
