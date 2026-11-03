<script setup>
import { computed } from 'vue'

const props = defineProps({
  variant: {
    type: String,
    default: 'neutral',
  },
})

const variantClasses = {
  neutral:
    'border border-zinc-200/80 bg-zinc-100 text-zinc-700 dark:border-slate-700/70 dark:bg-slate-800/80 dark:text-slate-200',
  success:
    'border border-emerald-200/80 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/15 dark:text-emerald-300',
  warning:
    'border border-amber-200/80 bg-amber-50 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/15 dark:text-amber-300',
  danger:
    'border border-rose-200/80 bg-rose-50 text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/15 dark:text-rose-300',
  primary:
    'border border-primary/20 bg-primary/10 text-primary dark:border-indigo-400/30 dark:bg-indigo-500/15 dark:text-indigo-300',
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
