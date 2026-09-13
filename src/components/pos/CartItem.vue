<script setup>
import BaseButton from '@/components/base/BaseButton.vue'
import { formatCurrency } from '@/utils/formatters'

defineProps({
  item: {
    type: Object,
    required: true,
  },
})

defineEmits(['increase', 'decrease', 'remove'])
</script>

<template>
  <div class="flex items-start justify-between gap-3 rounded-2xl bg-surface p-3">
    <div class="min-w-0 flex-1">
      <h4 class="truncate font-medium text-ink-primary">{{ item.name }}</h4>
      <p class="text-sm text-ink-secondary">{{ formatCurrency(item.price) }}</p>
    </div>

    <div class="flex shrink-0 items-center gap-1.5 sm:gap-2">
      <BaseButton size="sm" variant="ghost" @click="$emit('decrease', item.id)">-</BaseButton>
      <span class="w-6 text-center text-sm font-medium">{{ item.qty }}</span>
      <BaseButton size="sm" variant="ghost" @click="$emit('increase', item.id)">+</BaseButton>
      <BaseButton size="sm" variant="danger" @click="$emit('remove', item.id)">Hapus</BaseButton>
    </div>
  </div>
</template>
