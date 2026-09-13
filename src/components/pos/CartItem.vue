<script setup>
import BaseButton from '@/components/base/BaseButton.vue'
import { formatCurrency } from '@/utils/formatters'

defineProps({
  item: {
    type: Object,
    required: true,
  },
})

defineEmits(['increase', 'decrease', 'remove', 'update-qty'])
</script>

<template>
  <div class="flex items-start justify-between gap-3 rounded-2xl bg-surface p-3">
    <div class="min-w-0 flex-1">
      <h4 class="truncate font-medium text-ink-primary">{{ item.name }}</h4>
      <p class="text-sm text-ink-secondary">
        {{ formatCurrency(item.price) }} / {{ item.pricingUnit || item.unit || 'pcs' }}
      </p>
    </div>

    <div class="flex shrink-0 items-center gap-1.5 sm:gap-2">
      <BaseButton size="sm" variant="ghost" @click="$emit('decrease', item.id)">-</BaseButton>
      <input
        class="h-9 w-20 rounded-xl border border-zinc-200 bg-white px-2 text-center text-sm font-medium text-ink-primary outline-none focus:border-primary"
        type="number"
        :step="item.kind === 'service' && item.pricingUnit === 'kg' ? '0.1' : '1'"
        min="0"
        :value="item.qty"
        @change="$emit('update-qty', item.id, $event.target.value)"
      />
      <BaseButton size="sm" variant="ghost" @click="$emit('increase', item.id)">+</BaseButton>
      <BaseButton size="sm" variant="danger" @click="$emit('remove', item.id)">Hapus</BaseButton>
    </div>
  </div>
</template>
