import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { describe, expect, it } from 'vitest'

import { createAppRouter } from '@/router'
import { useBusinessStore } from '@/stores/businessStore'
import { useCartStore } from '@/stores/cartStore'
import { useCashierStore } from '@/stores/cashierStore'
import { useShiftStore } from '@/stores/shiftStore'
import { useTransactionStore } from '@/stores/transactionStore'
import { formatCurrency } from '@/utils/formatters'
import PaymentView from '@/views/payment/PaymentView.vue'

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

async function mountPaymentView() {
  const context = createContext()

  makeBusinessReady(context.businessStore)
  context.cashierStore.setPinConfigured(true)
  context.shiftStore.openShift(100000)
  context.cartStore.addItem({ id: 1, name: 'Es Kopi Susu', category: 'Minuman', price: 22000, stock: 10 })

  await context.router.push('/payment')
  await flushPromises()

  const wrapper = mount(PaymentView, {
    global: {
      plugins: [context.pinia, context.router],
    },
  })

  return { wrapper, ...context }
}

function getButtonByText(wrapper, label) {
  return wrapper.findAll('button').find((button) => button.text().includes(label))
}

function getCashInput(wrapper) {
  return wrapper.find('input[type="number"]')
}

describe('P3 cash payment', () => {
  it('cash kosong tidak dapat menyelesaikan pembayaran', async () => {
    const { wrapper, transactionStore, cartStore } = await mountPaymentView()
    const initialCount = transactionStore.items.length
    await getCashInput(wrapper).setValue('')
    await flushPromises()
    const payButton = getButtonByText(wrapper, 'Selesaikan Pembayaran')

    expect(payButton.attributes('disabled')).toBeDefined()

    await payButton.trigger('click')
    await flushPromises()

    expect(transactionStore.items).toHaveLength(initialCount)
    expect(cartStore.items).toHaveLength(1)
  })

  it('cashReceived < total ditolak', async () => {
    const { wrapper, transactionStore, cartStore } = await mountPaymentView()
    const initialCount = transactionStore.items.length

    await getCashInput(wrapper).setValue('20000')
    await flushPromises()

    const payButton = getButtonByText(wrapper, 'Selesaikan Pembayaran')

    expect(payButton.attributes('disabled')).toBeDefined()
    expect(wrapper.text()).toContain('Uang diterima kurang dari total pembayaran')

    await payButton.trigger('click')
    await flushPromises()

    expect(transactionStore.items).toHaveLength(initialCount)
    expect(cartStore.items).toHaveLength(1)
  })

  it('cashReceived === total valid', async () => {
    const { wrapper, transactionStore, cartStore, router } = await mountPaymentView()
    const initialCount = transactionStore.items.length
    const total = cartStore.total

    await getCashInput(wrapper).setValue(String(total))
    await flushPromises()

    const payButton = getButtonByText(wrapper, 'Selesaikan Pembayaran')

    expect(payButton.attributes('disabled')).toBeUndefined()

    await payButton.trigger('click')
    await flushPromises()

    expect(transactionStore.items).toHaveLength(initialCount + 1)
    expect(transactionStore.lastTransaction.cashReceived).toBe(total)
    expect(transactionStore.lastTransaction.changeAmount).toBe(0)
    expect(router.currentRoute.value.fullPath).toBe('/payment/success')
  })

  it('cashReceived > total valid', async () => {
    const { wrapper, transactionStore, router } = await mountPaymentView()
    const initialCount = transactionStore.items.length

    await getCashInput(wrapper).setValue('50000')
    await flushPromises()

    await getButtonByText(wrapper, 'Selesaikan Pembayaran').trigger('click')
    await flushPromises()

    expect(transactionStore.items).toHaveLength(initialCount + 1)
    expect(transactionStore.lastTransaction.cashReceived).toBe(50000)
    expect(router.currentRoute.value.fullPath).toBe('/payment/success')
  })

  it('kembalian dihitung dengan benar', async () => {
    const { wrapper } = await mountPaymentView()

    await getCashInput(wrapper).setValue('50000')
    await flushPromises()

    expect(wrapper.text()).toContain(formatCurrency(25580))
  })

  it('kembalian tidak pernah negatif', async () => {
    const { wrapper } = await mountPaymentView()

    await getCashInput(wrapper).setValue('20000')
    await flushPromises()

    expect(wrapper.text()).toContain(formatCurrency(0))
    expect(wrapper.text()).not.toContain('-')
  })

  it('Uang Pas mengisi total transaksi', async () => {
    const { wrapper, cartStore } = await mountPaymentView()

    await getButtonByText(wrapper, 'Uang Pas').trigger('click')
    await flushPromises()

    expect(getCashInput(wrapper).element.value).toBe(String(cartStore.total))
  })

  it('nominal cepat tidak menampilkan nominal di bawah total', async () => {
    const { wrapper } = await mountPaymentView()

    expect(wrapper.text()).not.toContain(formatCurrency(20000))
    expect(wrapper.text()).toContain(formatCurrency(50000))
  })

  it('nominal cepat tidak duplicate', async () => {
    const { wrapper } = await mountPaymentView()
    const quickAmountLabels = wrapper
      .findAll('button')
      .map((button) => button.text().trim())
      .filter((label) => label.startsWith('Rp'))

    expect(new Set(quickAmountLabels).size).toBe(quickAmountLabels.length)
  })

  it('transaksi cash menyimpan cashReceived', async () => {
    const { wrapper, transactionStore } = await mountPaymentView()

    await getCashInput(wrapper).setValue('50000')
    await flushPromises()
    await getButtonByText(wrapper, 'Selesaikan Pembayaran').trigger('click')
    await flushPromises()

    expect(transactionStore.lastTransaction.cashReceived).toBe(50000)
  })

  it('transaksi cash menyimpan changeAmount', async () => {
    const { wrapper, transactionStore } = await mountPaymentView()

    await getCashInput(wrapper).setValue('50000')
    await flushPromises()
    await getButtonByText(wrapper, 'Selesaikan Pembayaran').trigger('click')
    await flushPromises()

    expect(transactionStore.lastTransaction.changeAmount).toBe(25580)
  })

  it('pembayaran invalid tidak membuat transaction', async () => {
    const { wrapper, transactionStore } = await mountPaymentView()
    const initialCount = transactionStore.items.length

    await getCashInput(wrapper).setValue('20000')
    await flushPromises()
    await getButtonByText(wrapper, 'Selesaikan Pembayaran').trigger('click')
    await flushPromises()

    expect(transactionStore.items).toHaveLength(initialCount)
  })

  it('pembayaran invalid tidak clear cart', async () => {
    const { wrapper, cartStore } = await mountPaymentView()

    await getCashInput(wrapper).setValue('20000')
    await flushPromises()
    await getButtonByText(wrapper, 'Selesaikan Pembayaran').trigger('click')
    await flushPromises()

    expect(cartStore.items).toHaveLength(1)
  })

  it('pembayaran cash valid membuat tepat 1 transaction', async () => {
    const { wrapper, transactionStore } = await mountPaymentView()
    const initialCount = transactionStore.items.length

    await getCashInput(wrapper).setValue('50000')
    await flushPromises()
    await getButtonByText(wrapper, 'Selesaikan Pembayaran').trigger('click')
    await flushPromises()

    expect(transactionStore.items).toHaveLength(initialCount + 1)
  })

  it('pembayaran cash valid clear cart setelah transaction dibuat', async () => {
    const { wrapper, cartStore } = await mountPaymentView()

    await getCashInput(wrapper).setValue('50000')
    await flushPromises()
    await getButtonByText(wrapper, 'Selesaikan Pembayaran').trigger('click')
    await flushPromises()

    expect(cartStore.items).toHaveLength(0)
  })

  it('metode non-cash tidak membutuhkan cashReceived', async () => {
    const { wrapper, transactionStore, router } = await mountPaymentView()
    const initialCount = transactionStore.items.length

    await getButtonByText(wrapper, 'QRIS').trigger('click')
    await flushPromises()

    const payButton = getButtonByText(wrapper, 'Selesaikan Pembayaran')

    expect(payButton.attributes('disabled')).toBeUndefined()

    await payButton.trigger('click')
    await flushPromises()

    expect(transactionStore.items).toHaveLength(initialCount + 1)
    expect(router.currentRoute.value.fullPath).toBe('/payment/success')
  })

  it('transaksi non-cash tidak membawa cashReceived/changeAmount dari cash', async () => {
    const { wrapper, transactionStore } = await mountPaymentView()

    await getCashInput(wrapper).setValue('50000')
    await flushPromises()
    await getButtonByText(wrapper, 'QRIS').trigger('click')
    await flushPromises()
    await getButtonByText(wrapper, 'Selesaikan Pembayaran').trigger('click')
    await flushPromises()

    expect(transactionStore.lastTransaction.paymentMethod).toBe('qris')
    expect(transactionStore.lastTransaction.cashReceived).toBeNull()
    expect(transactionStore.lastTransaction.changeAmount).toBeNull()
  })
})
