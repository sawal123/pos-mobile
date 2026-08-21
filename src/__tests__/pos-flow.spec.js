import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { describe, expect, it } from 'vitest'

import { createAppRouter } from '@/router'
import { useBusinessStore } from '@/stores/businessStore'
import { useCartStore } from '@/stores/cartStore'
import { useCashierStore } from '@/stores/cashierStore'
import { useShiftStore } from '@/stores/shiftStore'
import { useTransactionStore } from '@/stores/transactionStore'
import PaymentView from '@/views/payment/PaymentView.vue'
import PosView from '@/views/pos/PosView.vue'

function createContext() {
  const pinia = createPinia()
  setActivePinia(pinia)

  return {
    pinia,
    router: createAppRouter(),
    businessStore: useBusinessStore(),
    cartStore: useCartStore(),
    cashierStore: useCashierStore(),
    shiftStore: useShiftStore(),
    transactionStore: useTransactionStore(),
  }
}

function makeBusinessReady(businessStore) {
  businessStore.setBusiness({
    name: 'Demo POS Store',
    type: 'Cafe',
    owner: 'Admin',
    phone: '08123456789',
    outlet: 'Outlet Utama',
    mode: 'free',
  })
}

function getButtonByText(wrapper, label) {
  return wrapper.findAll('button').find((button) => button.text().includes(label))
}

describe('P1 POS flow', () => {
  it('redirects to business setup when business is not ready', async () => {
    const { router } = createContext()

    await router.push('/pos')

    expect(router.currentRoute.value.fullPath).toBe('/setup/business')
  })

  it('redirects to pin setup when business is ready but pin is not configured', async () => {
    const { router, businessStore } = createContext()

    makeBusinessReady(businessStore)
    await router.push('/pos')

    expect(router.currentRoute.value.fullPath).toBe('/setup/pin')
  })

  it('redirects to open shift when business and pin are ready but shift is closed', async () => {
    const { router, businessStore, cashierStore } = createContext()

    makeBusinessReady(businessStore)
    cashierStore.setPinConfigured(true)
    await router.push('/pos')

    expect(router.currentRoute.value.fullPath).toBe('/shift/open')
  })

  it('allows transactions route when business and pin are ready even if shift is closed', async () => {
    const { router, businessStore, cashierStore } = createContext()

    makeBusinessReady(businessStore)
    cashierStore.setPinConfigured(true)
    await router.push('/transactions')

    expect(router.currentRoute.value.fullPath).toBe('/transactions')
  })

  it('allows settings route when business and pin are ready even if shift is closed', async () => {
    const { router, businessStore, cashierStore } = createContext()

    makeBusinessReady(businessStore)
    cashierStore.setPinConfigured(true)
    await router.push('/settings')

    expect(router.currentRoute.value.fullPath).toBe('/settings')
  })

  it('redirects payment access back to POS when cart is empty', async () => {
    const { router, businessStore, cashierStore, shiftStore } = createContext()

    makeBusinessReady(businessStore)
    cashierStore.setPinConfigured(true)
    shiftStore.openShift(100000)
    await router.push('/payment')

    expect(router.currentRoute.value.fullPath).toBe('/pos')
  })

  it('redirects payment success access back to POS when there is no successful transaction', async () => {
    const { router, businessStore, cashierStore, shiftStore } = createContext()

    makeBusinessReady(businessStore)
    cashierStore.setPinConfigured(true)
    shiftStore.openShift(100000)
    await router.push('/payment/success')

    expect(router.currentRoute.value.fullPath).toBe('/pos')
  })

  it('prevents checkout when cart is empty', async () => {
    const { pinia, router, businessStore, cashierStore, shiftStore } = createContext()

    makeBusinessReady(businessStore)
    cashierStore.setPinConfigured(true)
    shiftStore.openShift(100000)
    await router.push('/pos')
    await flushPromises()

    const wrapper = mount(PosView, {
      global: {
        plugins: [pinia, router],
      },
    })

    const checkoutButton = getButtonByText(wrapper, 'Kunci Pesanan')

    expect(checkoutButton).toBeTruthy()
    expect(checkoutButton.attributes('disabled')).toBeDefined()

    await checkoutButton.trigger('click')
    await flushPromises()

    expect(router.currentRoute.value.fullPath).toBe('/pos')
  })

  it('allows checkout to payment when cart has items', async () => {
    const { pinia, router, businessStore, cartStore, cashierStore, shiftStore } = createContext()

    makeBusinessReady(businessStore)
    cashierStore.setPinConfigured(true)
    shiftStore.openShift(100000)
    cartStore.addItem({ id: 1, name: 'Es Kopi Susu', category: 'Minuman', price: 22000, stock: 10 })
    await router.push('/pos')
    await flushPromises()

    const wrapper = mount(PosView, {
      global: {
        plugins: [pinia, router],
      },
    })

    const checkoutButton = getButtonByText(wrapper, 'Kunci Pesanan')

    expect(checkoutButton.attributes('disabled')).toBeUndefined()

    await checkoutButton.trigger('click')
    await flushPromises()

    expect(router.currentRoute.value.fullPath).toBe('/payment')
  })

  it('creates one transaction, keeps item snapshot, and clears cart after payment', async () => {
    const {
      pinia,
      router,
      businessStore,
      cartStore,
      cashierStore,
      shiftStore,
      transactionStore,
    } = createContext()

    makeBusinessReady(businessStore)
    cashierStore.setPinConfigured(true)
    shiftStore.openShift(100000)
    cartStore.addItem({ id: 1, name: 'Es Kopi Susu', category: 'Minuman', price: 22000, stock: 10 })
    const cartSnapshot = cartStore.items.map((item) => ({ ...item }))
    const initialTransactionCount = transactionStore.items.length

    await router.push('/payment')
    await flushPromises()

    const wrapper = mount(PaymentView, {
      global: {
        plugins: [pinia, router],
      },
    })

    const payButton = getButtonByText(wrapper, 'Selesaikan Pembayaran')

    await payButton.trigger('click')
    await flushPromises()

    expect(transactionStore.items).toHaveLength(initialTransactionCount + 1)
    expect(transactionStore.lastTransaction).toBeTruthy()
    expect(transactionStore.lastTransaction.items).toEqual(cartSnapshot)
    expect(transactionStore.lastTransaction.subtotal).toBe(22000)
    expect(transactionStore.lastTransaction.tax).toBe(2420)
    expect(transactionStore.lastTransaction.total).toBe(24420)
    expect(transactionStore.lastTransaction.paymentMethod).toBe('cash')
    expect(transactionStore.lastTransaction.invoiceNumber).toMatch(/^INV-/)
    expect(cartStore.items).toHaveLength(0)
    expect(router.currentRoute.value.fullPath).toBe('/payment/success')
  })
})
