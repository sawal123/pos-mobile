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
  total: {
    type: Number,
    default: 0,
  },
})
</script>

<template>
  <BaseCard class="space-y-3">
    <div class="flex items-center justify-between text-sm text-ink-secondary">
      <span>Subtotal</span>
      <span>{{ formatCurrency(subtotal) }}</span>
    </div>
    <div class="flex items-center justify-between text-sm text-ink-secondary">
      <span>Pajak 11%</span>
      <span>{{ formatCurrency(tax) }}</span>
    </div>
    <div class="flex items-center justify-between border-t border-zinc-200 pt-3 text-base font-semibold">
      <span>Total</span>
      <span>{{ formatCurrency(total) }}</span>
    </div>

    <BaseButton block>Kunci Pesanan</BaseButton>
  </BaseCard>
</template>
