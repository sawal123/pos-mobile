<script setup>
import { computed } from 'vue'

const props = defineProps({
  variant: {
    type: String,
    default: 'neutral',
  },
})

const variantClasses = {
  neutral: 'bg-zinc-100 text-zinc-700',
  success: 'bg-green-100 text-green-700',
  warning: 'bg-amber-100 text-amber-700',
  danger: 'bg-red-100 text-red-700',
  primary: 'bg-primary/10 text-primary',
}

const badgeClass = computed(() => [
  'inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium',
  variantClasses[props.variant] ?? variantClasses.neutral,
])
</script>

<template>
  <span :class="badgeClass">
    <slot />
  </span>
</template>
