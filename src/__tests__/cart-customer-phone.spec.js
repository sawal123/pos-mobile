import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { flushPromises, mount } from '@vue/test-utils'
import CartCustomerInput from '@/components/pos/CartCustomerInput.vue'
import MobileCartSheet from '@/components/pos/MobileCartSheet.vue'
import PaymentView from '@/views/payment/PaymentView.vue'
import PosView from '@/views/pos/PosView.vue'
import { createAppRouter } from '@/router'
import { useBusinessStore } from '@/stores/businessStore'
import { useCartStore } from '@/stores/cartStore'
import { useCashierStore } from '@/stores/cashierStore'
import { useCustomerStore } from '@/stores/customerStore'
import { useProductStore } from '@/stores/productStore'
import { useShiftStore } from '@/stores/shiftStore'
import { useTransactionStore } from '@/stores/transactionStore'

const wrappers = []
let pinia
beforeEach(() => {
  pinia = createPinia()
  setActivePinia(pinia)
  useBusinessStore().setBusiness({ name: 'Toko Uji', type: 'Grosir', mode: 'free' })
  useCashierStore().setPinConfigured(true)
  useCustomerStore().customers = [
    { id: 'c1', name: 'Budi', phone: '081234567890', email: '' },
    { id: 'c2', name: 'Sari', phone: '+6281355555555', email: '' },
  ]
})
afterEach(() => wrappers.splice(0).forEach((wrapper) => wrapper.unmount()))

function mountInput(id = 'cart-phone-test') {
  const wrapper = mount(CartCustomerInput, { props: { inputId: id }, global: { plugins: [pinia] } })
  wrappers.push(wrapper)
  return wrapper
}

describe('customer phone in cart', () => {
  it.each(['081234567890', '+62 812-3456-7890', '6281234567890', '0062 (812) 3456 7890'])(
    'automatically resolves the saved name from %s',
    async (phone) => {
      const wrapper = mountInput()
      await wrapper.get('input').setValue(phone)
      expect(wrapper.get('[data-testid="cart-customer-match"]').text()).toBe('Budi')
      expect(useCartStore().selectedCustomer.id).toBe('c1')
      expect(wrapper.get('input').element.value).toBe(phone)
    },
  )

  it('does not choose by partial number, invent a customer, or retain an old match after typing', async () => {
    const wrapper = mountInput()
    await wrapper.get('input').setValue('081234567890')
    expect(useCartStore().selectedCustomer.name).toBe('Budi')
    await wrapper.get('input').setValue('0812345')
    expect(useCartStore().selectedCustomer).toBeNull()
    expect(wrapper.get('[data-testid="cart-customer-not-found"]').text()).toContain(
      'belum ditemukan',
    )
    await wrapper.get('input').setValue('089999999999')
    expect(useCustomerStore().customers).toHaveLength(2)
    await wrapper.get('input').setValue('081355555555')
    expect(useCartStore().selectedCustomer.name).toBe('Sari')
    await wrapper.get('[data-testid="cart-clear-customer"]').trigger('click')
    expect(useCartStore().selectedCustomer).toBeNull()
    expect(wrapper.get('input').element.value).toBe('')
  })

  it('rejects ambiguous normalized numbers and reacts when customer data changes', async () => {
    const wrapper = mountInput()
    await wrapper.get('input').setValue('081234567890')
    useCustomerStore().customers.push({ id: 'c3', name: 'Budi Lain', phone: '+62 81234567890' })
    await flushPromises()
    expect(useCartStore().selectedCustomer).toBeNull()
    expect(wrapper.text()).toContain('beberapa pelanggan')
    useCustomerStore().deleteCustomer('c3')
    useCustomerStore().updateCustomer('c1', {
      name: 'Budi Santoso',
      phone: '081234567890',
      email: '',
    })
    await flushPromises()
    expect(wrapper.get('[data-testid="cart-customer-match"]').text()).toBe('Budi Santoso')
    useCustomerStore().deleteCustomer('c1')
    await flushPromises()
    expect(useCartStore().selectedCustomer).toBeNull()
  })

  it('shares the selection across desktop and mobile inputs and resets when the cart is emptied', async () => {
    const first = mountInput('desktop-phone')
    const second = mountInput('mobile-phone')
    await first.get('input').setValue('081234567890')
    expect(second.get('input').element.value).toBe('081234567890')
    expect(second.text()).toContain('Budi')
    useCartStore().addItem({ id: 'p1', name: 'Beras', price: 10000, stock: 10 })
    useCartStore().removeItem('p1')
    expect(useCartStore().customerPhone).toBe('')
    useCartStore().selectCustomer(useCustomerStore().customers[0])
    useCartStore().clearCart()
    expect(useCartStore().selectedCustomer).toBeNull()
    expect(useCartStore().customerId).toBeNull()
  })

  it('provides the field in both the POS desktop cart and the mobile cart sheet', async () => {
    const router = createAppRouter()
    await router.push('/pos')
    const pos = mount(PosView, { global: { plugins: [pinia, router] } })
    wrappers.push(pos)
    expect(pos.find('#desktop-cart-customer-phone').exists()).toBe(true)
    useCartStore().addItem({ id: 'p1', name: 'Beras', price: 10000, stock: 10 })
    const sheet = mount(MobileCartSheet, { props: { open: true }, global: { plugins: [pinia] } })
    wrappers.push(sheet)
    await flushPromises()
    await sheet.get('#mobile-cart-customer-phone').setValue('081234567890')
    expect(pos.get('[data-testid="cart-customer-match"]').text()).toBe('Budi')
    expect(sheet.get('[data-testid="cart-customer-match"]').text()).toBe('Budi')
  })

  it('carries the matched customer through payment and snapshots the customer before clearing the cart', async () => {
    useShiftStore().openShift(100000)
    const store = useProductStore()
    const created = store.createProduct({
      name: 'Kopi',
      category: store.categories[0],
      price: 10000,
      stock: 10,
      isActive: true,
    })
    useCartStore().addItem(created.product)
    useCartStore().setCustomerPhone('+62 81234567890')
    const router = createAppRouter()
    await router.push('/payment')
    const wrapper = mount(PaymentView, { global: { plugins: [pinia, router] } })
    wrappers.push(wrapper)
    expect(wrapper.get('[data-testid="selected-customer-label"]').text()).toBe('Budi')
    await wrapper
      .findAll('button')
      .find((button) => button.text().includes('QRIS'))
      .trigger('click')
    await wrapper.get('[data-testid="mobile-submit-payment"]').trigger('click')
    await flushPromises()
    const transaction = useTransactionStore().lastTransaction
    expect(transaction).toMatchObject({
      customer: 'Budi',
      customerId: 'c1',
      customerSnapshot: { id: 'c1', name: 'Budi', phone: '081234567890' },
    })
    expect(useCartStore().customerPhone).toBe('')
    expect(useCartStore().selectedCustomer).toBeNull()
    useCustomerStore().updateCustomer('c1', { name: 'Nama Baru', phone: '089999999999', email: '' })
    expect(transaction.customerSnapshot.name).toBe('Budi')
  })

  it('reflects customer changes made on payment when returning to the cart', async () => {
    useCartStore().addItem({ id: 'p1', name: 'Kopi', price: 10000, stock: 10 })
    useCartStore().setCustomerPhone('081234567890')
    const router = createAppRouter()
    await router.push('/payment')
    const wrapper = mount(PaymentView, { global: { plugins: [pinia, router] } })
    wrappers.push(wrapper)
    const input = wrapper.get('[data-testid="input-customer-search"] input')
    await input.setValue('081355555555')
    expect(wrapper.get('[data-testid="selected-customer-label"]').text()).toBe('Sari')
    const cart = mountInput()
    expect(cart.get('input').element.value).toBe('081355555555')
    expect(cart.text()).toContain('Sari')
    await wrapper.get('[data-testid="btn-clear-customer"]').trigger('click')
    expect(useCartStore().selectedCustomer).toBeNull()
    expect(useCartStore().customerPhone).toBe('')
  })
})
