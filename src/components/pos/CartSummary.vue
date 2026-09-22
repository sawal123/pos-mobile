<script setup>
import BaseButton from '@/components/base/BaseButton.vue'
import BaseCard from '@/components/base/BaseCard.vue'
import { formatCurrency } from '@/utils/formatters'

defineProps({
  subtotal: {
    type: Number,
    default: 0,
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
    default: 'Kunci Pesanan',
  },
})

defineEmits(['checkout'])
</script>

<template>
  <BaseCard class="space-y-3">
    <div class="flex items-center justify-between text-sm text-ink-secondary">
      <span>Subtotal</span>
      <span>{{ formatCurrency(subtotal) }}</span>
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
