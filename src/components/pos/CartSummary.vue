<script setup>
import BaseButton from '@/components/base/BaseButton.vue'
import BaseCard from '@/components/base/BaseCard.vue'
import { formatCurrency } from '@/utils/formatters'

defineProps({
  subtotal: {
    type: Number,
    default: 0,
  },
  discount: {
    type: Number,
    default: 0,
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
</script>

<template>
  <BaseCard class="space-y-3">
    <div class="flex items-center justify-between text-sm text-ink-secondary">
      <span>Subtotal</span>
      <span>{{ formatCurrency(subtotal) }}</span>
    </div>

    <div
      v-if="appliedPromo || discount > 0"
      class="flex items-center justify-between rounded-lg bg-emerald-50 px-2.5 py-1.5 text-sm font-medium text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
    >
      <div class="flex items-center gap-1.5 min-w-0">
        <span class="text-xs">🏷️</span>
        <span class="truncate font-medium">{{ appliedPromo?.name || 'Diskon Promo' }}</span>
        <button
          v-if="allowPromoSelect"
          type="button"
          class="ml-1 text-xs text-zinc-400 hover:text-red-500 transition-colors"
          title="Hapus promo"
          aria-label="Hapus promo"
          @click.stop="$emit('remove-promo')"
        >
          ✕
        </button>
      </div>
      <span class="shrink-0 font-semibold">-{{ formatCurrency(discount) }}</span>
    </div>

    <div
      v-else-if="allowPromoSelect && !disabled"
      class="flex cursor-pointer items-center justify-between rounded-lg border border-dashed border-zinc-200 px-2.5 py-1.5 text-xs font-medium text-primary hover:border-primary/50 transition-colors"
      role="button"
      tabindex="0"
      @click="$emit('select-promo')"
    >
      <span class="flex items-center gap-1.5">
        <span>🏷️</span> Gunakan Promo / Voucher
      </span>
      <span class="text-zinc-400">›</span>
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
