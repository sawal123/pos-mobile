<script setup>
const props = defineProps({
  label: {
    type: String,
    required: true,
  },
  active: {
    type: Boolean,
    default: false,
  },
})
</script>

<template>
  <button
    type="button"
    class="shrink-0 whitespace-nowrap rounded-full border px-4 py-2 text-sm font-semibold transition active:scale-95 cursor-pointer sm:py-2.5"
    :class="
      props.active
        ? 'border-primary bg-primary text-white shadow-[0_8px_20px_rgba(73,69,214,0.28)]'
        : 'border-zinc-200/90 bg-card text-ink-secondary hover:border-primary/40 hover:text-primary dark:border-slate-700/70 dark:bg-[#171C2B] dark:text-slate-300 dark:hover:border-indigo-400/50 dark:hover:text-white'
    "
  >
    {{ label }}
  </button>
</template>
