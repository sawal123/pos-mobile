import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { describe, expect, it } from 'vitest'

import { createAppRouter } from '@/router'
import BaseInput from '@/components/base/BaseInput.vue'
import { useBusinessStore } from '@/stores/businessStore'
import { useCashierStore } from '@/stores/cashierStore'
import { useCustomerStore } from '@/stores/customerStore'
import { useTransactionStore } from '@/stores/transactionStore'
import CustomerFormView from '@/views/customers/CustomerFormView.vue'
import CustomersView from '@/views/customers/CustomersView.vue'

function createContext() {
  const pinia = createPinia()
  setActivePinia(pinia)

  const router = createAppRouter()
  const businessStore = useBusinessStore()
  const cashierStore = useCashierStore()
  const customerStore = useCustomerStore()
  const transactionStore = useTransactionStore()

  businessStore.setBusiness({
    name: 'Kopi Kenangan Senja',
    type: 'Cafe',
    owner: 'Owner Test',
    phone: '08123456789',
    outlet: 'Outlet Utama',
    mode: 'free',
  })
  cashierStore.setPinConfigured(true)

  return { pinia, router, businessStore, cashierStore, customerStore, transactionStore }
}

describe('CustomersView & CustomerFormView UI/UX Enhancement', () => {
  it('menampilkan header CRM, tombol tambah customer, dan metrik total', async () => {
    const context = createContext()
    context.customerStore.createCustomer({ name: 'Andi Wijaya', phone: '081234567890', email: 'andi@test.com' })
    context.customerStore.createCustomer({ name: 'Budi Santoso', phone: '', email: 'budi@test.com' })

    await context.router.push('/customers')
    await flushPromises()

    const wrapper = mount(CustomersView, {
      global: {
        plugins: [context.pinia, context.router],
      },
    })

    expect(wrapper.text()).toContain('Daftar Pelanggan')
    expect(wrapper.text()).toContain('Tambah Customer')
    expect(wrapper.text()).toContain('Andi Wijaya')
    expect(wrapper.text()).toContain('Budi Santoso')
    // Avatar initials
    expect(wrapper.text()).toContain('AW')
    expect(wrapper.text()).toContain('BS')
    // Total count metric
    expect(wrapper.find('[data-testid="total-customers-count"]').text()).toBe('2')
  })

  it('fitur pencarian memfilter pelanggan berdasarkan nama, no hp, atau email', async () => {
    const context = createContext()
    context.customerStore.createCustomer({ name: 'Citra Dewi', phone: '08571234567', email: 'citra@gmail.com' })
    context.customerStore.createCustomer({ name: 'Doni Pratama', phone: '08199988877', email: 'doni@yahoo.com' })

    await context.router.push('/customers')
    await flushPromises()

    const wrapper = mount(CustomersView, {
      global: {
        plugins: [context.pinia, context.router],
      },
    })

    const searchInput = wrapper.find('input[type="text"]')
    await searchInput.setValue('citra')
    await flushPromises()

    expect(wrapper.text()).toContain('Citra Dewi')
    expect(wrapper.text()).not.toContain('Doni Pratama')

    // Search by phone
    await searchInput.setValue('081999')
    await flushPromises()

    expect(wrapper.text()).not.toContain('Citra Dewi')
    expect(wrapper.text()).toContain('Doni Pratama')
  })

  it('modal detail profil pelanggan menampilkan ringkasan belanja dan kontak', async () => {
    const context = createContext()
    const c1 = context.customerStore.createCustomer({ name: 'Eka Saputra', phone: '081234567890', email: 'eka@test.com' })

    context.transactionStore.createTransaction({
      customerId: c1.customer.id,
      customer: 'Eka Saputra',
      items: [{ id: 1, name: 'Latte', price: 25000, qty: 2 }],
      total: 50000,
      paymentMethod: 'cash',
      status: 'paid',
    })

    await context.router.push('/customers')
    await flushPromises()

    const wrapper = mount(CustomersView, {
      global: {
        plugins: [context.pinia, context.router],
      },
    })

    // Click "Detail"
    const detailBtn = wrapper.findAll('button').find((b) => b.text() === 'Detail')
    expect(detailBtn).toBeTruthy()
    await detailBtn.trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('Profil Pelanggan')
    expect(wrapper.text()).toContain('Chat WhatsApp')
    expect(wrapper.text()).toContain('Telepon')
    expect(wrapper.text()).toContain('1 Kali')
  })

  it('modal konfirmasi hapus menghapus pelanggan ketika dikonfirmasi', async () => {
    const context = createContext()
    context.customerStore.createCustomer({ name: 'Fani Halim', phone: '', email: '' })

    await context.router.push('/customers')
    await flushPromises()

    const wrapper = mount(CustomersView, {
      global: {
        plugins: [context.pinia, context.router],
      },
    })

    expect(context.customerStore.customers).toHaveLength(1)

    // Click Delete button on card
    const deleteBtn = wrapper.findAll('button').find((b) => b.text().includes('Delete'))
    expect(deleteBtn).toBeTruthy()
    await deleteBtn.trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('Yakin hapus pelanggan ini?')

    // Click "Hapus Pelanggan" in modal
    const confirmDeleteBtn = wrapper.findAll('button').find((b) => b.text() === 'Hapus Pelanggan')
    expect(confirmDeleteBtn).toBeTruthy()
    await confirmDeleteBtn.trigger('click')
    await flushPromises()

    expect(context.customerStore.customers).toHaveLength(0)
  })

  it('CustomerFormView menampilkan live card preview yang reaktif terhadap input nama dan kontak', async () => {
    const context = createContext()
    await context.router.push('/customers/create')
    await flushPromises()

    const wrapper = mount(CustomerFormView, {
      global: {
        plugins: [context.pinia, context.router],
      },
    })

    expect(wrapper.text()).toContain('Pratinjau Kartu Pelanggan')
    expect(wrapper.text()).toContain('Live Preview')

    const inputs = wrapper.findAllComponents(BaseInput)
    // Input 0: Name, Input 1: Phone, Input 2: Email
    await inputs[0].vm.$emit('update:modelValue', 'Grace Kelly')
    await inputs[1].vm.$emit('update:modelValue', '0812345678')
    await flushPromises()

    expect(wrapper.text()).toContain('Grace Kelly')
    expect(wrapper.text()).toContain('GK')
    expect(wrapper.text()).toContain('0812345678')
  })
})
