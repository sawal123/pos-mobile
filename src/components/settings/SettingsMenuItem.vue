<script setup>
import { computed } from 'vue'

import AppIcon from '@/components/base/AppIcon.vue'

const props = defineProps({
  icon: {
    type: String,
    default: 'settings',
  },
  title: {
    type: String,
    required: true,
  },
  subtitle: {
    type: String,
    default: '',
  },
  testid: {
    type: String,
    default: undefined,
  },
  htmlId: {
    type: String,
    default: undefined,
  },
  locked: {
    type: Boolean,
    default: false,
  },
  tone: {
    type: String,
    default: 'primary',
  },
})

defineEmits(['select'])

const iconClass = computed(() => {
  if (props.locked) return 'bg-amber-100 text-amber-600'
  if (props.tone === 'accent') return 'bg-amber-100 text-amber-600'
  return 'bg-primary/10 text-primary'
})
</script>

<template>
  <button
    :id="htmlId"
    :data-testid="testid"
    type="button"
    :aria-label="locked ? `${title} — Memerlukan Premium` : title"
    :aria-haspopup="locked ? 'dialog' : undefined"
    class="group flex min-h-14 w-full items-center gap-3 rounded-2xl px-3 py-3 text-left transition active:scale-[0.99] active:bg-surface focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
    @click="$emit('select')"
  >
    <span
      class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl"
      :class="iconClass"
    >
      <AppIcon :name="icon" />
    </span>

    <span class="min-w-0 flex-1">
      <span class="flex items-center gap-2">
        <span class="truncate text-sm font-semibold text-ink-primary">{{ title }}</span>
        <span
          v-if="locked"
          class="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700"
        >
          Premium
        </span>
      </span>
      <span
        v-if="subtitle"
        class="mt-0.5 block truncate text-xs text-ink-secondary"
      >
        {{ subtitle }}
      </span>
    </span>

    <span class="flex shrink-0 items-center gap-1">
      <AppIcon v-if="locked" name="lock" class="text-amber-500" />
      <AppIcon name="chevron-right" class="text-ink-secondary" />
    </span>
  </button>
</template>
