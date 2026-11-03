<script setup>
defineProps({
  open: {
    type: Boolean,
    default: false,
  },
  title: {
    type: String,
    default: '',
  },
})

defineEmits(['close'])
</script>

<template>
  <div
    v-if="open"
    class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-[2px]"
    @click.self="$emit('close')"
  >
    <div class="w-full max-w-md rounded-3xl border border-transparent bg-card p-5 shadow-medium dark:border-slate-700/60">
      <div class="mb-4 flex items-center justify-between">
        <h3 class="text-lg font-semibold text-ink-primary">{{ title }}</h3>
        <button class="text-sm text-ink-secondary" @click="$emit('close')">Tutup</button>
      </div>

      <slot />
    </div>
  </div>
</template>
