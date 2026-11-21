<script setup>
import { ref } from 'vue'
import { usePullToRefresh } from '@/composables/usePullToRefresh'

const props = defineProps({
  onRefresh: {
    type: Function,
    default: null,
  },
  threshold: {
    type: Number,
    default: undefined,
  },
  disabled: {
    type: Boolean,
    default: false,
  },
})

const emit = defineEmits(['refresh'])
const root = ref(null)

async function executeRefresh() {
  if (props.disabled) return { ok: true }
  try {
    if (props.onRefresh) {
      const res = await props.onRefresh()
      return res ?? { ok: true }
    }
    emit('refresh')
    await new Promise((resolve) => setTimeout(resolve, 600))
    return { ok: true }
  } catch (err) {
    return { ok: false, message: err?.message || 'Gagal memperbarui data' }
  }
}

const { indicatorOffset, isDragging, isRefreshing, isVisible, message, status, resetGesture } =
  usePullToRefresh({
    root,
    onRefresh: executeRefresh,
    threshold: props.threshold,
  })

defineExpose({
  root,
  isRefreshing,
  isVisible,
  status,
  resetGesture,
})
</script>

<template>
  <div ref="root" class="relative">
    <!-- Pull to refresh spinner indicator -->
    <div
      v-show="isVisible"
      class="pointer-events-none absolute inset-x-0 -top-3 z-30 flex items-center justify-center gap-2 text-sm font-medium text-ink-secondary"
      aria-live="polite"
      :style="{ transform: `translateY(${indicatorOffset}px)` }"
    >
      <span
        class="h-4 w-4 rounded-full border-2 border-primary/25 border-t-primary"
        :class="isRefreshing ? 'animate-spin' : ''"
      />
      <span>{{ message }}</span>
    </div>

    <div
      :class="
        isDragging || isRefreshing || indicatorOffset > 0
          ? isDragging || isRefreshing
            ? 'transition-transform duration-150'
            : 'transition-transform duration-300'
          : ''
      "
      :style="indicatorOffset > 0 ? { transform: `translateY(${indicatorOffset}px)` } : undefined"
    >
      <slot />
    </div>
  </div>
</template>
