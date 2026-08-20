<script setup>
import { computed } from 'vue'

const props = defineProps({
  type: {
    type: String,
    default: 'button',
  },
  variant: {
    type: String,
    default: 'primary',
  },
  size: {
    type: String,
    default: 'md',
  },
  block: {
    type: Boolean,
    default: false,
  },
  disabled: {
    type: Boolean,
    default: false,
  },
})

const variantClasses = {
  primary: 'bg-primary text-white hover:bg-primary-light',
  secondary: 'bg-white text-ink-primary ring-1 ring-zinc-200 hover:bg-zinc-50',
  accent: 'bg-accent text-white hover:brightness-110',
  ghost: 'bg-transparent text-ink-secondary hover:bg-zinc-100',
  danger: 'bg-danger text-white hover:brightness-110',
}

const sizeClasses = {
  sm: 'h-9 px-3 text-sm',
  md: 'h-11 px-4 text-sm',
  lg: 'h-12 px-5 text-base',
}

const buttonClass = computed(() => [
  'inline-flex items-center justify-center rounded-2xl font-medium transition focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:cursor-not-allowed disabled:opacity-50',
  variantClasses[props.variant] ?? variantClasses.primary,
  sizeClasses[props.size] ?? sizeClasses.md,
  props.block ? 'w-full' : '',
])
</script>

<template>
  <button :type="type" :disabled="disabled" :class="buttonClass">
    <slot />
  </button>
</template>
