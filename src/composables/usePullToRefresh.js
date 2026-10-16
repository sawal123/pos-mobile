import { computed, onMounted, onUnmounted, ref } from 'vue'

export const PULL_TO_REFRESH_THRESHOLD = 70

function getDocumentScrollTop() {
  return Math.max(
    window.scrollY || 0,
    document.documentElement?.scrollTop || 0,
    document.body?.scrollTop || 0,
  )
}

function isInteractiveTarget(target) {
  return (
    target instanceof Element &&
    Boolean(
      target.closest('a, button, input, textarea, select, [contenteditable], [role="button"]'),
    )
  )
}

/**
 * Adds a touch-only pull-to-refresh gesture to a scrollable view.
 * The callback is deliberately supplied by the view so this composable never
 * hydrates, mutates, or synchronises application data itself.
 */
export function usePullToRefresh({ root, onRefresh, threshold = PULL_TO_REFRESH_THRESHOLD } = {}) {
  const pullDistance = ref(0)
  const isDragging = ref(false)
  const isRefreshing = ref(false)
  const status = ref('idle')

  let startY = 0
  let startX = 0
  let gestureActive = false
  let gestureIsVertical = false
  let listenerTarget = null

  const indicatorOffset = computed(() => Math.min(pullDistance.value * 0.55, threshold + 28))
  const isVisible = computed(
    () =>
      isDragging.value ||
      isRefreshing.value ||
      status.value === 'success' ||
      status.value === 'error',
  )
  const message = computed(() => {
    if (status.value === 'refreshing') return 'Memperbarui...'
    if (status.value === 'success') return 'Data diperbarui'
    if (status.value === 'error') return 'Gagal memperbarui data'
    if (pullDistance.value >= threshold) return 'Lepaskan untuk memperbarui'
    return 'Tarik untuk memperbarui'
  })

  function resetGesture() {
    startY = 0
    startX = 0
    gestureActive = false
    gestureIsVertical = false
    isDragging.value = false
    pullDistance.value = 0
  }

  function isAtScrollTop() {
    const scrollContainer = root.value?.closest('main')
    const containerScrollTop = scrollContainer?.scrollTop ?? 0

    return containerScrollTop <= 0 && getDocumentScrollTop() <= 0
  }

  async function finishRefresh(nextStatus) {
    status.value = nextStatus
    await new Promise((resolve) => window.setTimeout(resolve, 650))
    status.value = 'idle'
    pullDistance.value = 0
  }

  async function runRefresh() {
    if (isRefreshing.value) return

    isRefreshing.value = true
    status.value = 'refreshing'
    pullDistance.value = threshold

    try {
      const result = await onRefresh?.()
      if (result?.ok === false) {
        throw new Error(result.message || result.code || 'REFRESH_FAILED')
      }
      await finishRefresh('success')
    } catch {
      await finishRefresh('error')
    } finally {
      isRefreshing.value = false
      pullDistance.value = 0
    }
  }

  function onTouchStart(event) {
    const touch = event.touches[0]
    if (!touch || isRefreshing.value || !isAtScrollTop() || isInteractiveTarget(event.target)) {
      return
    }

    startY = touch.clientY
    startX = touch.clientX
    gestureActive = true
    gestureIsVertical = false
    isDragging.value = true
    status.value = 'idle'
  }

  function onTouchMove(event) {
    const touch = event.touches[0]
    if (!gestureActive || !touch) return

    const deltaY = touch.clientY - startY
    const deltaX = touch.clientX - startX

    if (!gestureIsVertical) {
      if (Math.abs(deltaX) > Math.abs(deltaY)) {
        resetGesture()
        return
      }
      if (Math.abs(deltaY) < 6) return
      gestureIsVertical = deltaY > 0
    }

    if (!gestureIsVertical || deltaY <= 0) return

    if (event.cancelable) event.preventDefault()
    pullDistance.value = Math.min(deltaY, threshold + 56)
  }

  function onTouchEnd() {
    if (!gestureActive) return

    const shouldRefresh = gestureIsVertical && pullDistance.value >= threshold
    resetGesture()

    if (shouldRefresh) {
      void runRefresh()
    }
  }

  onMounted(() => {
    // The page's <main> owns scrolling on tablet/desktop layouts. Listening
    // there also keeps the gesture responsive when a pull begins in its
    // padding rather than directly on Home's content card.
    listenerTarget = root.value?.closest('main') ?? root.value
    if (!listenerTarget) return

    listenerTarget.addEventListener('touchstart', onTouchStart, { passive: true })
    listenerTarget.addEventListener('touchmove', onTouchMove, { passive: false })
    listenerTarget.addEventListener('touchend', onTouchEnd)
    listenerTarget.addEventListener('touchcancel', onTouchEnd)
  })

  onUnmounted(() => {
    if (listenerTarget) {
      listenerTarget.removeEventListener('touchstart', onTouchStart)
      listenerTarget.removeEventListener('touchmove', onTouchMove)
      listenerTarget.removeEventListener('touchend', onTouchEnd)
      listenerTarget.removeEventListener('touchcancel', onTouchEnd)
    }
    listenerTarget = null
    resetGesture()
  })

  return {
    indicatorOffset,
    isDragging,
    isRefreshing,
    isVisible,
    message,
    pullDistance,
    status,
  }
}
