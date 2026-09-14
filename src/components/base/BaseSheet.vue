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
  <div v-if="open" class="fixed inset-0 z-50 bg-black/30" @click.self="$emit('close')">
    <div class="absolute inset-x-0 bottom-0 rounded-t-3xl border border-white/70 bg-white/95 p-5 pb-[calc(env(safe-area-inset-bottom)+1.25rem)] shadow-bottom-sheet backdrop-blur-xl">
      <div class="mx-auto mb-4 h-1.5 w-14 rounded-full bg-zinc-200" />
      <div class="mb-4 flex items-center justify-between">
        <h3 class="text-lg font-semibold text-ink-primary">{{ title }}</h3>
        <button class="text-sm text-ink-secondary" @click="$emit('close')">Tutup</button>
      </div>
      <slot />
    </div>
  </div>
</template>
