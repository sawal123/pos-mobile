<script setup>
import { computed } from 'vue'

const props = defineProps({
  text: {
    type: String,
    default: '',
  },
  label: {
    type: String,
    default: '',
  },
})

const displayText = computed(() => props.label || props.text || 'atau lanjutkan dengan')
</script>

<template>
  <div class="relative my-6 flex items-center justify-center" data-testid="cloud-auth-divider">
    <div class="absolute inset-0 flex items-center" aria-hidden="true">
      <div class="w-full border-t border-zinc-200" />
    </div>
    <div class="relative bg-white px-3 text-xs font-medium uppercase tracking-wider text-ink-secondary/70">
      {{ displayText }}
    </div>
  </div>
</template>
