import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { defineComponent, h, nextTick } from 'vue'
import { describe, expect, it, vi } from 'vitest'

import AppLayout from '@/layouts/AppLayout.vue'
import { createAppRouter } from '@/router'
import { PULL_TO_REFRESH_THRESHOLD } from '@/composables/usePullToRefresh'
import { usePageRefresh } from '@/composables/usePageRefresh'
import { useSyncStatusStore } from '@/stores/syncStatusStore'
import { useTransactionStore } from '@/stores/transactionStore'
import { useProductStore } from '@/stores/productStore'
import { useCustomerStore } from '@/stores/customerStore'

import { useBusinessStore } from '@/stores/businessStore'
import { useCashierStore } from '@/stores/cashierStore'
import { useShiftStore } from '@/stores/shiftStore'

function setupBusinessAndAuth() {
  const businessStore = useBusinessStore()
  const cashierStore = useCashierStore()
  const shiftStore = useShiftStore()

  businessStore.setBusiness({
    name: 'Demo Store',
    type: 'Cafe / UMKM',
    owner: 'Owner',
    phone: '08123456789',
    outlet: 'Outlet Utama',
    mode: 'free',
  })
  cashierStore.setPinConfigured(true)
  shiftStore.openShift(100000)
}

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

function pullElement(element, distance = PULL_TO_REFRESH_THRESHOLD + 10) {
  dispatchTouch(element, 'touchstart', { x: 0, y: 0 })
  dispatchTouch(element, 'touchmove', { x: 0, y: distance })
  dispatchTouch(element, 'touchend', { x: 0, y: distance })
}

describe('AppLayout Pull-to-Refresh across all pages', () => {
  it('renders pull-to-refresh indicator and wrapper inside AppLayout', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    setupBusinessAndAuth()
    const router = createAppRouter()
    await router.push('/home')
    await flushPromises()

    const wrapper = mount(AppLayout, {
      global: {
        plugins: [pinia, router],
      },
    })

    const mainEl = wrapper.find('[data-testid="app-pull-to-refresh"]')
    expect(mainEl.exists()).toBe(true)
  })

  it('triggers syncStatusStore.refresh and transactionStore.loadTransactions when pulling on /transactions', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    setupBusinessAndAuth()
    const syncStatusStore = useSyncStatusStore()
    const transactionStore = useTransactionStore()

    syncStatusStore.refresh = vi.fn().mockResolvedValue({ ok: true })
    transactionStore.loadTransactions = vi.fn().mockResolvedValue([])

    const router = createAppRouter()
    await router.push('/transactions')
    await flushPromises()

    const wrapper = mount(AppLayout, {
      global: {
        plugins: [pinia, router],
      },
    })

    const main = wrapper.get('[data-testid="app-pull-to-refresh"]').element
    pullElement(main)
    await flushPromises()

    expect(syncStatusStore.refresh).toHaveBeenCalled()
    expect(transactionStore.loadTransactions).toHaveBeenCalled()
  })

  it('triggers productStore.loadProducts when pulling on /products', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    setupBusinessAndAuth()
    const syncStatusStore = useSyncStatusStore()
    const productStore = useProductStore()

    syncStatusStore.refresh = vi.fn().mockResolvedValue({ ok: true })
    productStore.loadProducts = vi.fn().mockResolvedValue([])

    const router = createAppRouter()
    await router.push('/products')
    await flushPromises()

    const wrapper = mount(AppLayout, {
      global: {
        plugins: [pinia, router],
      },
    })

    const main = wrapper.get('[data-testid="app-pull-to-refresh"]').element
    pullElement(main)
    await flushPromises()

    expect(syncStatusStore.refresh).toHaveBeenCalled()
    expect(productStore.loadProducts).toHaveBeenCalled()
  })

  it('triggers customerStore.loadCustomers when pulling on /customers', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    setupBusinessAndAuth()
    const syncStatusStore = useSyncStatusStore()
    const customerStore = useCustomerStore()

    syncStatusStore.refresh = vi.fn().mockResolvedValue({ ok: true })
    customerStore.loadCustomers = vi.fn().mockResolvedValue([])

    const router = createAppRouter()
    await router.push('/customers')
    await flushPromises()

    const wrapper = mount(AppLayout, {
      global: {
        plugins: [pinia, router],
      },
    })

    const main = wrapper.get('[data-testid="app-pull-to-refresh"]').element
    pullElement(main)
    await flushPromises()

    expect(syncStatusStore.refresh).toHaveBeenCalled()
    expect(customerStore.loadCustomers).toHaveBeenCalled()
  })

  it('invokes custom view refresh handler registered via usePageRefresh', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    setupBusinessAndAuth()
    const customRefresh = vi.fn().mockResolvedValue({ ok: true })

    const CustomView = defineComponent({
      setup() {
        usePageRefresh(customRefresh)
        return () => h('div', 'Halaman Khusus')
      },
    })

    const router = createAppRouter()
    await router.push('/home')
    await flushPromises()

    const wrapper = mount(AppLayout, {
      global: {
        plugins: [pinia, router],
        stubs: {
          RouterView: CustomView,
        },
      },
    })

    await flushPromises()
    const main = wrapper.get('[data-testid="app-pull-to-refresh"]').element
    pullElement(main)
    await flushPromises()

    expect(customRefresh).toHaveBeenCalledTimes(1)
  })

  it('shows visual feedback message when pulling and releasing', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    setupBusinessAndAuth()
    const router = createAppRouter()
    await router.push('/home')
    await flushPromises()

    const wrapper = mount(AppLayout, {
      global: {
        plugins: [pinia, router],
      },
    })

    const main = wrapper.get('[data-testid="app-pull-to-refresh"]').element

    // Pull partway (< threshold)
    dispatchTouch(main, 'touchstart', { x: 0, y: 0 })
    dispatchTouch(main, 'touchmove', { x: 0, y: 30 })
    await nextTick()

    expect(wrapper.text()).toContain('Tarik untuk memperbarui')

    // Pull past threshold (>= threshold)
    dispatchTouch(main, 'touchmove', { x: 0, y: PULL_TO_REFRESH_THRESHOLD + 20 })
    await nextTick()

    expect(wrapper.text()).toContain('Lepaskan untuk memperbarui')

    // Release to trigger refresh
    dispatchTouch(main, 'touchend')
    await nextTick()

    expect(wrapper.text()).toContain('Memperbarui...')
  })

  it('does not apply transform style to RouterView wrapper when idle so position:fixed sheets and floating cart stay pinned to viewport', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    setupBusinessAndAuth()
    const router = createAppRouter()
    await router.push('/pos')
    await flushPromises()

    const wrapper = mount(AppLayout, {
      global: {
        plugins: [pinia, router],
      },
    })
    await flushPromises()

    const pullContent = wrapper.get('[data-testid="app-pull-content"]').element
    expect(pullContent.style.transform).toBe('')

    // Pulling down applies translateY while active
    const main = wrapper.get('[data-testid="app-pull-to-refresh"]').element
    dispatchTouch(main, 'touchstart', { x: 0, y: 0 })
    dispatchTouch(main, 'touchmove', { x: 0, y: 40 })
    await nextTick()
    expect(pullContent.style.transform).toContain('translateY(')

    // Cancelling / returning to 0 clears transform so fixed overlays remain anchored to viewport
    dispatchTouch(main, 'touchend')
    await nextTick()
    expect(pullContent.style.transform).toBe('')
  })
})
