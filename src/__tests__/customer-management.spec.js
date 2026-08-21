import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { describe, expect, it } from 'vitest'

import { createAppRouter } from '@/router'
import BaseInput from '@/components/base/BaseInput.vue'
import { useBusinessStore } from '@/stores/businessStore'
import { useCartStore } from '@/stores/cartStore'
import { useCashierStore } from '@/stores/cashierStore'
import { useCustomerStore } from '@/stores/customerStore'
import { useShiftStore } from '@/stores/shiftStore'
import { useTransactionStore } from '@/stores/transactionStore'
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
    customerStore: useCustomerStore(),
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

async function setCashInputValue(wrapper, value) {
  wrapper.findComponent(BaseInput).vm.$emit('update:modelValue', value)
  await flushPromises()
}

async function selectCustomer(wrapper, customerId) {
  await flushPromises()
  await wrapper.find('select').setValue(customerId)
  await flushPromises()
}

describe('P4 customer management', () => {
  it('create customer menambah tepat 1 customer', () => {
    const { customerStore } = createContext()
    const initialCount = customerStore.customers.length

    const result = customerStore.createCustomer({
      name: 'Budi',
      phone: '081234567890',
      email: 'budi@email.com',
    })

    expect(result.success).toBe(true)
    expect(customerStore.customers).toHaveLength(initialCount + 1)
  })

  it('create customer menghasilkan ID unik', () => {
    const { customerStore } = createContext()

    const firstResult = customerStore.createCustomer({ name: 'Budi', phone: '', email: '' })
    const secondResult = customerStore.createCustomer({ name: 'Sari', phone: '', email: '' })

    expect(firstResult.customer.id).not.toBe(secondResult.customer.id)
  })

  it('name kosong ditolak', () => {
    const { customerStore } = createContext()

    const result = customerStore.createCustomer({ name: '', phone: '', email: '' })

    expect(result.success).toBe(false)
    expect(result.errors.name).toBeTruthy()
  })

  it('name whitespace-only ditolak', () => {
    const { customerStore } = createContext()

    const result = customerStore.createCustomer({ name: '   ', phone: '', email: '' })

    expect(result.success).toBe(false)
    expect(result.errors.name).toBeTruthy()
  })

  it('phone mempertahankan leading zero', () => {
    const { customerStore } = createContext()

    const result = customerStore.createCustomer({
      name: 'Budi',
      phone: '081234567890',
      email: '',
    })

    expect(result.success).toBe(true)
    expect(result.customer.phone).toBe('081234567890')
  })

  it('update customer mengubah customer yang benar', () => {
    const { customerStore } = createContext()
    const created = customerStore.createCustomer({
      name: 'Budi',
      phone: '081234567890',
      email: 'budi@email.com',
    })

    const result = customerStore.updateCustomer(created.customer.id, {
      name: 'Budi Santoso',
      phone: '081111111111',
      email: 'budi.santoso@email.com',
    })

    expect(result.success).toBe(true)
    expect(customerStore.getCustomerById(created.customer.id)).toMatchObject({
      name: 'Budi Santoso',
      phone: '081111111111',
      email: 'budi.santoso@email.com',
    })
  })

  it('update ID tidak ditemukan ditolak', () => {
    const { customerStore } = createContext()

    const result = customerStore.updateCustomer('missing-id', {
      name: 'Budi',
      phone: '',
      email: '',
    })

    expect(result.success).toBe(false)
    expect(result.errors.form).toBeTruthy()
  })

  it('delete customer berhasil', () => {
    const { customerStore } = createContext()
    const created = customerStore.createCustomer({
      name: 'Budi',
      phone: '',
      email: '',
    })

    const deleted = customerStore.deleteCustomer(created.customer.id)

    expect(deleted).toBe(true)
    expect(customerStore.getCustomerById(created.customer.id)).toBeNull()
  })

  it('/customers dapat diakses tanpa shift aktif jika business + PIN siap', async () => {
    const { router, businessStore, cashierStore } = createContext()

    makeBusinessReady(businessStore)
    cashierStore.setPinConfigured(true)
    await router.push('/customers')

    expect(router.currentRoute.value.fullPath).toBe('/customers')
  })

  it('/customers/create dapat diakses tanpa shift aktif', async () => {
    const { router, businessStore, cashierStore } = createContext()

    makeBusinessReady(businessStore)
    cashierStore.setPinConfigured(true)
    await router.push('/customers/create')

    expect(router.currentRoute.value.fullPath).toBe('/customers/create')
  })

  it('/customers/:id/edit dapat diakses tanpa shift aktif', async () => {
    const { router, businessStore, cashierStore, customerStore } = createContext()
    const created = customerStore.createCustomer({
      name: 'Budi',
      phone: '',
      email: '',
    })

    makeBusinessReady(businessStore)
    cashierStore.setPinConfigured(true)
    await router.push(`/customers/${created.customer.id}/edit`)

    expect(router.currentRoute.value.fullPath).toBe(`/customers/${created.customer.id}/edit`)
  })

  it('payment tanpa customer menghasilkan Walk-in Customer', async () => {
    const { wrapper, transactionStore } = await mountPaymentView()

    await getButtonByText(wrapper, 'QRIS').trigger('click')
    await flushPromises()
    await getButtonByText(wrapper, 'Selesaikan Pembayaran').trigger('click')
    await flushPromises()

    expect(transactionStore.lastTransaction.customer).toBe('Walk-in Customer')
    expect(transactionStore.lastTransaction.customerId).toBeNull()
    expect(transactionStore.lastTransaction.customerSnapshot).toBeNull()
  })

  it('payment dengan customer menghasilkan nama customer yang benar', async () => {
    const { wrapper, customerStore, transactionStore } = await mountPaymentView()
    const created = customerStore.createCustomer({
      name: 'Budi',
      phone: '081234567890',
      email: 'budi@email.com',
    })

    await selectCustomer(wrapper, created.customer.id)
    await getButtonByText(wrapper, 'QRIS').trigger('click')
    await flushPromises()
    await getButtonByText(wrapper, 'Selesaikan Pembayaran').trigger('click')
    await flushPromises()

    expect(transactionStore.lastTransaction.customer).toBe('Budi')
  })

  it('transaction menyimpan customerId', async () => {
    const { wrapper, customerStore, transactionStore } = await mountPaymentView()
    const created = customerStore.createCustomer({
      name: 'Budi',
      phone: '081234567890',
      email: 'budi@email.com',
    })

    await selectCustomer(wrapper, created.customer.id)
    await getButtonByText(wrapper, 'QRIS').trigger('click')
    await flushPromises()
    await getButtonByText(wrapper, 'Selesaikan Pembayaran').trigger('click')
    await flushPromises()

    expect(transactionStore.lastTransaction.customerId).toBe(created.customer.id)
  })

  it('transaction menyimpan customerSnapshot', async () => {
    const { wrapper, customerStore, transactionStore } = await mountPaymentView()
    const created = customerStore.createCustomer({
      name: 'Budi',
      phone: '081234567890',
      email: 'budi@email.com',
    })

    await selectCustomer(wrapper, created.customer.id)
    await getButtonByText(wrapper, 'QRIS').trigger('click')
    await flushPromises()
    await getButtonByText(wrapper, 'Selesaikan Pembayaran').trigger('click')
    await flushPromises()

    expect(transactionStore.lastTransaction.customerSnapshot).toEqual(created.customer)
  })

  it('edit customer setelah transaksi tidak mengubah snapshot transaction', async () => {
    const { wrapper, customerStore, transactionStore } = await mountPaymentView()
    const created = customerStore.createCustomer({
      name: 'Budi',
      phone: '081234567890',
      email: 'budi@email.com',
    })

    await selectCustomer(wrapper, created.customer.id)
    await getButtonByText(wrapper, 'QRIS').trigger('click')
    await flushPromises()
    await getButtonByText(wrapper, 'Selesaikan Pembayaran').trigger('click')
    await flushPromises()

    customerStore.updateCustomer(created.customer.id, {
      name: 'Budi Santoso',
      phone: '089999999999',
      email: 'baru@email.com',
    })

    expect(transactionStore.lastTransaction.customer).toBe('Budi')
    expect(transactionStore.lastTransaction.customerSnapshot).toEqual({
      id: created.customer.id,
      name: 'Budi',
      phone: '081234567890',
      email: 'budi@email.com',
    })
  })

  it('delete customer setelah transaksi tidak mengubah transaction', async () => {
    const { wrapper, customerStore, transactionStore } = await mountPaymentView()
    const created = customerStore.createCustomer({
      name: 'Budi',
      phone: '081234567890',
      email: 'budi@email.com',
    })

    await selectCustomer(wrapper, created.customer.id)
    await getButtonByText(wrapper, 'QRIS').trigger('click')
    await flushPromises()
    await getButtonByText(wrapper, 'Selesaikan Pembayaran').trigger('click')
    await flushPromises()

    customerStore.deleteCustomer(created.customer.id)

    expect(customerStore.getCustomerById(created.customer.id)).toBeNull()
    expect(transactionStore.lastTransaction.customer).toBe('Budi')
    expect(transactionStore.lastTransaction.customerSnapshot).toEqual({
      id: created.customer.id,
      name: 'Budi',
      phone: '081234567890',
      email: 'budi@email.com',
    })
  })

  it('transaction existing tanpa payload customer tetap fallback Walk-in Customer', () => {
    const { transactionStore } = createContext()

    const transaction = transactionStore.createTransaction({
      items: [{ id: 1, name: 'Es Kopi Susu', price: 22000, qty: 1 }],
      subtotal: 22000,
      tax: 2420,
      total: 24420,
      paymentMethod: 'qris',
    })

    expect(transaction.customer).toBe('Walk-in Customer')
    expect(transaction.customerId).toBeNull()
    expect(transaction.customerSnapshot).toBeNull()
  })

  it('cash payment P3 tetap menyimpan cashReceived', async () => {
    const { wrapper, transactionStore } = await mountPaymentView()

    await setCashInputValue(wrapper, '50000')
    await getButtonByText(wrapper, 'Selesaikan Pembayaran').trigger('click')
    await flushPromises()

    expect(transactionStore.lastTransaction.cashReceived).toBe(50000)
  })

  it('cash payment P3 tetap menyimpan changeAmount', async () => {
    const { wrapper, transactionStore } = await mountPaymentView()

    await setCashInputValue(wrapper, '50000')
    await getButtonByText(wrapper, 'Selesaikan Pembayaran').trigger('click')
    await flushPromises()

    expect(transactionStore.lastTransaction.changeAmount).toBe(25580)
  })
})
