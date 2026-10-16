import { mount } from '@vue/test-utils'
import { defineComponent, nextTick, ref } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { PULL_TO_REFRESH_THRESHOLD, usePullToRefresh } from '@/composables/usePullToRefresh'

function createTouchEvent(type, { x = 0, y = 0 } = {}) {
  const event = new Event(type, { bubbles: true, cancelable: true })
  Object.defineProperties(event, {
    touches: { value: [{ clientX: x, clientY: y }] },
  })

  return event
}

function dispatchTouch(element, type, options = {}) {
  const event = createTouchEvent(type, options)
  element.dispatchEvent(event)
  return event
}

function createHarness(onRefresh) {
  return defineComponent({
    setup() {
      const root = ref(null)
      const pullToRefresh = usePullToRefresh({ root, onRefresh })

      return { ...pullToRefresh, root }
    },
    template: `
      <main>
        <div ref="root" data-testid="pull-root">
          <button type="button">Aksi</button>
          <span data-testid="message">{{ message }}</span>
          <span v-if="isVisible" data-testid="indicator">Indikator</span>
          <div data-testid="pull-content" :style="{ transform: \`translateY(\${indicatorOffset}px)\` }" />
        </div>
      </main>
    `,
  })
}

function pull(wrapper, { distance = PULL_TO_REFRESH_THRESHOLD + 10, xDistance = 0 } = {}) {
  const root = wrapper.get('[data-testid="pull-root"]').element
  dispatchTouch(root, 'touchstart', { x: 0, y: 0 })
  const moveEvent = dispatchTouch(root, 'touchmove', { x: xDistance, y: distance })
  dispatchTouch(root, 'touchend', { x: xDistance, y: distance })
  return moveEvent
}

afterEach(() => {
  vi.useRealTimers()
})

describe('usePullToRefresh', () => {
  it('ignores gestures when the containing page is not at its scroll top', () => {
    const refresh = vi.fn()
    const wrapper = mount(createHarness(refresh))
    wrapper.get('main').element.scrollTop = 12

    pull(wrapper)

    expect(refresh).not.toHaveBeenCalled()
  })

  it('captures a pull that starts in the scroll container padding', async () => {
    const refresh = vi.fn(() => new Promise(() => {}))
    const wrapper = mount(createHarness(refresh))
    const main = wrapper.get('main').element

    dispatchTouch(main, 'touchstart', { x: 0, y: 0 })
    dispatchTouch(main, 'touchmove', { x: 0, y: PULL_TO_REFRESH_THRESHOLD + 10 })
    dispatchTouch(main, 'touchend')
    await Promise.resolve()

    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('cancels a pull shorter than the threshold', () => {
    const refresh = vi.fn()
    const wrapper = mount(createHarness(refresh))

    pull(wrapper, { distance: PULL_TO_REFRESH_THRESHOLD - 1 })

    expect(refresh).not.toHaveBeenCalled()
    expect(wrapper.get('[data-testid="message"]').text()).toBe('Tarik untuk memperbarui')
  })

  it('does not show the indicator before the finger has moved down', async () => {
    const wrapper = mount(createHarness(vi.fn()))
    const root = wrapper.get('[data-testid="pull-root"]').element

    dispatchTouch(root, 'touchstart', { x: 0, y: 0 })
    await nextTick()

    expect(wrapper.find('[data-testid="indicator"]').exists()).toBe(false)
  })

  it('reveals the indicator and moves content down while pulling', async () => {
    const wrapper = mount(createHarness(vi.fn()))
    const root = wrapper.get('[data-testid="pull-root"]').element

    dispatchTouch(root, 'touchstart', { x: 0, y: 0 })
    dispatchTouch(root, 'touchmove', { x: 0, y: 50 })
    await nextTick()

    expect(wrapper.find('[data-testid="indicator"]').exists()).toBe(true)
    const contentStyle = wrapper.get('[data-testid="pull-content"]').attributes('style')
    expect(contentStyle).toContain('translateY(')
    expect(contentStyle).not.toContain('translateY(0px)')
  })

  it('refreshes once after a qualifying vertical pull and shows completion feedback', async () => {
    vi.useFakeTimers()
    const refresh = vi.fn().mockResolvedValue({ ok: true })
    const wrapper = mount(createHarness(refresh))

    const moveEvent = pull(wrapper)
    await Promise.resolve()
    await vi.runOnlyPendingTimersAsync()

    expect(moveEvent.defaultPrevented).toBe(true)
    expect(refresh).toHaveBeenCalledTimes(1)
    expect(wrapper.get('[data-testid="message"]').text()).toBe('Tarik untuk memperbarui')
  })

  it('does not begin another refresh while the first refresh is loading', async () => {
    let resolveRefresh
    const refresh = vi.fn(
      () =>
        new Promise((resolve) => {
          resolveRefresh = resolve
        }),
    )
    const wrapper = mount(createHarness(refresh))

    pull(wrapper)
    await Promise.resolve()
    pull(wrapper)

    expect(refresh).toHaveBeenCalledTimes(1)
    resolveRefresh({ ok: true })
  })

  it('leaves horizontal gestures and interactive controls alone', () => {
    const refresh = vi.fn()
    const wrapper = mount(createHarness(refresh))
    const root = wrapper.get('[data-testid="pull-root"]').element

    const horizontalMove = pull(wrapper, { distance: 12, xDistance: 90 })
    dispatchTouch(wrapper.get('button').element, 'touchstart', { x: 0, y: 0 })
    dispatchTouch(wrapper.get('button').element, 'touchmove', { x: 0, y: 100 })
    dispatchTouch(wrapper.get('button').element, 'touchend', { x: 0, y: 100 })

    expect(horizontalMove.defaultPrevented).toBe(false)
    expect(refresh).not.toHaveBeenCalled()
    expect(root.style.transform).toBe('')
  })

  it('removes every touch listener when unmounted', () => {
    const removeEventListener = vi.spyOn(HTMLElement.prototype, 'removeEventListener')
    const wrapper = mount(createHarness(vi.fn()))

    wrapper.unmount()

    for (const type of ['touchstart', 'touchmove', 'touchend', 'touchcancel']) {
      expect(removeEventListener).toHaveBeenCalledWith(type, expect.any(Function))
    }
    removeEventListener.mockRestore()
  })
})
