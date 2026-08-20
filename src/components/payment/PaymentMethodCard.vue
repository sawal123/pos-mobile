<script setup>
import BaseCard from '@/components/base/BaseCard.vue'

defineProps({
  method: {
    type: Object,
    required: true,
  },
  active: {
    type: Boolean,
    default: false,
  },
})
</script>

<template>
  <BaseCard
    class="cursor-pointer border transition"
    :class="active ? 'border-primary ring-4 ring-primary/10' : 'border-transparent'"
  >
    <div class="flex items-center justify-between gap-3">
      <div>
        <h3 class="font-semibold text-ink-primary">{{ method.label }}</h3>
        <p class="text-sm text-ink-secondary">{{ method.description }}</p>
      </div>
      <span class="text-sm font-medium" :class="active ? 'text-primary' : 'text-ink-secondary'">
        {{ active ? 'Dipilih' : 'Pilih' }}
      </span>
    </div>
  </BaseCard>
</template>
