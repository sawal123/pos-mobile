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
  loading: {
    type: Boolean,
    default: false,
  },
})

const variantClasses = {
  primary: 'bg-primary text-white hover:bg-primary-light',
  secondary:
    'bg-card text-ink-primary ring-1 ring-zinc-200 hover:bg-zinc-50 dark:ring-slate-700/70 dark:hover:bg-slate-800/70',
  accent: 'bg-accent text-white hover:brightness-110',
  ghost: 'bg-transparent text-ink-secondary hover:bg-zinc-100 dark:hover:bg-slate-800/60',
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
  <button :type="type" :disabled="disabled || loading" :class="buttonClass">
    <svg
      v-if="loading"
      class="mr-2 h-4 w-4 shrink-0 animate-spin"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <circle
        class="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        stroke-width="3"
      />
      <path
        class="opacity-85"
        fill="currentColor"
        d="M4 12a8 8 0 018-8v3a5 5 0 00-5 5H4z"
      />
    </svg>
    <slot />
  </button>
</template>
