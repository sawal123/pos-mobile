<script setup>
import { onBeforeUnmount, ref, watch } from 'vue'

const props = defineProps({
  open: {
    type: Boolean,
    default: false,
  },
  title: {
    type: String,
    default: '',
  },
})

const emit = defineEmits(['close'])

const sheetRef = ref(null)
const dragOffset = ref(0)
const isDragging = ref(false)
const isClosing = ref(false)

let startY = null
let startX = null
let startTime = 0
let scrollableEl = null
let canDrag = false
let gestureLocked = false
let closeTimer = null

function clearCloseTimer() {
  if (closeTimer) {
    clearTimeout(closeTimer)
    closeTimer = null
  }
}

function resetDragState() {
  clearCloseTimer()
  startY = null
  startX = null
  scrollableEl = null
  canDrag = false
  gestureLocked = false
  dragOffset.value = 0
  isDragging.value = false
  isClosing.value = false
}

watch(
  () => props.open,
  () => {
    resetDragState()
  },
)

onBeforeUnmount(() => {
  clearCloseTimer()
})

function findScrollableParent(target, boundary) {
  let el = target
  while (el && el !== boundary) {
    if (typeof Element !== 'undefined' && el instanceof Element) {
      const overflowY = window.getComputedStyle?.(el)?.overflowY
      if ((overflowY === 'auto' || overflowY === 'scroll') && el.scrollHeight > el.clientHeight) {
        return el
      }
    }
    el = el.parentElement
  }
  return null
}

function handleTouchStart(e) {
  if (!props.open || isClosing.value || !e.touches || e.touches.length !== 1) return
  startY = e.touches[0].clientY
  startX = e.touches[0].clientX
  startTime = Date.now()
  scrollableEl = findScrollableParent(e.target, sheetRef.value)
  canDrag = false
  gestureLocked = false
}

function handleTouchMove(e) {
  if (!props.open || isClosing.value || startY === null || !e.touches?.[0]) return
  const dy = e.touches[0].clientY - startY
  const dx = e.touches[0].clientX - startX

  if (!gestureLocked) {
    if (Math.abs(dy) < 5 && Math.abs(dx) < 5) return
    if (Math.abs(dx) > Math.abs(dy) || dy < 0) {
      gestureLocked = true
      canDrag = false
      return
    }
    if (scrollableEl && scrollableEl.scrollTop > 0) {
      gestureLocked = true
      canDrag = false
      return
    }
    gestureLocked = true
    canDrag = true
    isDragging.value = true
  }

  if (!canDrag) return
  if (e.cancelable) e.preventDefault()
  e.stopPropagation()
  dragOffset.value = Math.max(0, dy)
}

function handleTouchEnd() {
  const wasDragging = canDrag
  startY = null
  startX = null
  scrollableEl = null
  canDrag = false
  gestureLocked = false
  isDragging.value = false

  if (!wasDragging) return

  const elapsed = Math.max(1, Date.now() - startTime)
  const velocity = dragOffset.value / elapsed
  const sheetHeight = sheetRef.value?.offsetHeight || 400
  const shouldClose =
    dragOffset.value > 100 ||
    dragOffset.value > sheetHeight * 0.3 ||
    (dragOffset.value > 35 && velocity > 0.45)

  if (shouldClose) {
    isClosing.value = true
    dragOffset.value = sheetHeight
    clearCloseTimer()
    closeTimer = setTimeout(() => {
      closeTimer = null
      isClosing.value = false
      dragOffset.value = 0
      emit('close')
    }, 200)
  } else {
    dragOffset.value = 0
  }
}

function handleBackdropClose() {
  if (isClosing.value) return
  emit('close')
}
</script>

<template>
  <div
    v-if="open"
    data-testid="base-sheet-backdrop"
    class="fixed inset-0 z-50 bg-black/45 backdrop-blur-[1px] transition-opacity duration-200 overflow-hidden"
    :style="
      dragOffset > 0
        ? { opacity: Math.max(0, 1 - dragOffset / Math.max(240, sheetRef?.offsetHeight || 360)) }
        : undefined
    "
    @click.self="handleBackdropClose"
    @touchmove.stop
  >
    <div
      ref="sheetRef"
      data-testid="base-sheet-panel"
      :class="[
        'absolute inset-x-0 bottom-0 rounded-t-3xl border border-white/70 bg-white/95 p-5 pb-[calc(env(safe-area-inset-bottom)+1.25rem)] shadow-bottom-sheet backdrop-blur-xl dark:border-slate-700/60 dark:bg-[#171C2B]/96 will-change-transform',
        isDragging
          ? 'transition-none'
          : 'transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]',
      ]"
      :style="dragOffset > 0 ? { transform: `translate3d(0, ${dragOffset}px, 0)` } : undefined"
      @touchstart.passive="handleTouchStart"
      @touchmove="handleTouchMove"
      @touchend="handleTouchEnd"
      @touchcancel="handleTouchEnd"
    >
      <div class="mx-auto mb-4 flex justify-center py-1 touch-none cursor-grab active:cursor-grabbing">
        <div class="h-1.5 w-14 rounded-full bg-zinc-200 dark:bg-slate-700" />
      </div>
      <div class="mb-4 flex items-center justify-between">
        <h3 class="text-lg font-semibold text-ink-primary">{{ title }}</h3>
        <button class="text-sm text-ink-secondary" @click="handleBackdropClose">Tutup</button>
      </div>
      <slot />
    </div>
  </div>
</template>
