import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { describe, expect, it, vi } from 'vitest'

import { createAppRouter } from '@/router'
import { formatCurrency, formatDateTime } from '@/utils/formatters'
import { useBusinessStore } from '@/stores/businessStore'
import { useCartStore } from '@/stores/cartStore'
import { useCashierStore } from '@/stores/cashierStore'
import { useCustomerStore } from '@/stores/customerStore'
import { useShiftStore } from '@/stores/shiftStore'
import { useTransactionStore } from '@/stores/transactionStore'
import PaymentSuccessView from '@/views/payment/PaymentSuccessView.vue'
import PaymentView from '@/views/payment/PaymentView.vue'
import ReceiptView from '@/views/transactions/ReceiptView.vue'
import TransactionDetailView from '@/views/transactions/TransactionDetailView.vue'

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

function makeBusinessReady(businessStore, overrides = {}) {
  businessStore.setBusiness({
    name: 'Toko ABC',
    type: 'Cafe',
    owner: 'Admin',
    phone: '08123456789',
    outlet: 'Outlet Utama',
    mode: 'free',
    ...overrides,
  })
}

function seedTransaction(transactionStore, overrides = {}) {
  const hasOverride = (key) => Object.prototype.hasOwnProperty.call(overrides, key)

  return transactionStore.addTransaction({
    id: overrides.id ?? 'trx-receipt-1',
    invoiceNumber: overrides.invoiceNumber ?? 'INV-RECEIPT-001',
    customer: overrides.customer ?? 'Budi',
    customerId: overrides.customerId ?? 'customer-1',
    customerSnapshot: hasOverride('customerSnapshot') ? overrides.customerSnapshot : {
      id: 'customer-1',
      name: 'Budi',
      phone: '081234567890',
      email: 'budi@email.com',
    },
    businessSnapshot: hasOverride('businessSnapshot') ? overrides.businessSnapshot : {
      name: 'Toko ABC',
      outlet: 'Outlet Lama',
      phone: '08123456789',
    },
    status: overrides.status ?? 'paid',
    items: overrides.items ?? [
      { id: 1, name: 'Es Kopi Susu', price: 22000, qty: 1 },
      { id: 2, name: 'Croissant Butter', price: 25000, qty: 2 },
    ],
    itemCount: overrides.itemCount ?? 3,
    subtotal: overrides.subtotal ?? 72000,
    tax: overrides.tax ?? 7920,
    total: overrides.total ?? 79920,
    paymentMethod: overrides.paymentMethod ?? 'cash',
    cashReceived: hasOverride('cashReceived') ? overrides.cashReceived : 100000,
    changeAmount: hasOverride('changeAmount') ? overrides.changeAmount : 20080,
    createdAt: overrides.createdAt ?? '2026-08-21T10:05:00+07:00',
  })
}

async function mountReceiptView(options = {}) {
  const context = createContext()

  makeBusinessReady(context.businessStore, options.businessOverrides)
  context.cashierStore.setPinConfigured(true)

  if (options.transaction) {
    context.transactionStore.addTransaction(options.transaction)
  } else if (options.seed !== false) {
    seedTransaction(context.transactionStore, options.transactionOverrides)
  }

  const id = options.id ?? options.transaction?.id ?? options.transactionOverrides?.id ?? 'trx-receipt-1'

  await context.router.push(`/transactions/${id}/receipt`)
  await flushPromises()

  const wrapper = mount(ReceiptView, {
    global: {
      plugins: [context.pinia, context.router],
    },
  })

  return { wrapper, ...context, id }
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

describe('P6 receipt print', () => {
  it('receipt menemukan transaction berdasarkan route ID', async () => {
    const { wrapper, router } = await mountReceiptView()

    expect(router.currentRoute.value.fullPath).toBe('/transactions/trx-receipt-1/receipt')
    expect(wrapper.text()).toContain('INV-RECEIPT-001')
  })

  it('invalid transaction ID tidak crash', async () => {
    const { wrapper } = await mountReceiptView({ seed: false, id: 'missing-id' })

    expect(wrapper.text()).toContain('Transaksi tidak ditemukan.')
  })

  it('invoice number tampil', async () => {
    const { wrapper } = await mountReceiptView()

    expect(wrapper.text()).toContain('INV-RECEIPT-001')
  })

  it('transaction date tersedia pada receipt', async () => {
    const createdAt = '2026-08-21T10:05:00+07:00'
    const { wrapper } = await mountReceiptView({ transactionOverrides: { createdAt } })

    expect(wrapper.text()).toContain(formatDateTime(createdAt))
  })

  it('customer tampil dari transaction snapshot', async () => {
    const { wrapper } = await mountReceiptView()

    expect(wrapper.text()).toContain('Budi')
  })

  it('payment method tampil', async () => {
    const { wrapper } = await mountReceiptView({ transactionOverrides: { paymentMethod: 'qris' } })

    expect(wrapper.text()).toContain('QRIS')
  })

  it('item name tampil', async () => {
    const { wrapper } = await mountReceiptView()

    expect(wrapper.text()).toContain('Es Kopi Susu')
  })

  it('item qty tampil', async () => {
    const { wrapper } = await mountReceiptView()

    expect(wrapper.text()).toContain('2 x')
  })

  it('item unit price tampil', async () => {
    const { wrapper } = await mountReceiptView()

    expect(wrapper.text()).toContain(formatCurrency(22000))
  })

  it('item line total benar', async () => {
    const { wrapper } = await mountReceiptView()

    expect(wrapper.text()).toContain(formatCurrency(50000))
  })

  it('subtotal tampil', async () => {
    const { wrapper } = await mountReceiptView()

    expect(wrapper.text()).toContain(formatCurrency(72000))
  })

  it('tax tampil', async () => {
    const { wrapper } = await mountReceiptView()

    expect(wrapper.text()).toContain(formatCurrency(7920))
  })

  it('total tampil', async () => {
    const { wrapper } = await mountReceiptView()

    expect(wrapper.text()).toContain(formatCurrency(79920))
  })

  it('cash receipt menampilkan cashReceived', async () => {
    const { wrapper } = await mountReceiptView()

    expect(wrapper.text()).toContain(formatCurrency(100000))
  })

  it('cash receipt menampilkan changeAmount', async () => {
    const { wrapper } = await mountReceiptView()

    expect(wrapper.text()).toContain(formatCurrency(20080))
  })

  it('non-cash receipt tidak menampilkan cashReceived/changeAmount', async () => {
    const { wrapper } = await mountReceiptView({
      transactionOverrides: {
        paymentMethod: 'qris',
        cashReceived: null,
        changeAmount: null,
      },
    })

    expect(wrapper.text()).not.toContain('Uang Diterima')
    expect(wrapper.text()).not.toContain('Kembalian')
  })

  it('receipt menggunakan harga snapshot transaction, bukan productStore', async () => {
    const { wrapper } = await mountReceiptView({
      transactionOverrides: {
        items: [{ id: 1, name: 'Es Kopi Susu', price: 9999, qty: 1 }],
        subtotal: 9999,
        tax: 1100,
        total: 11099,
      },
    })

    expect(wrapper.text()).toContain(formatCurrency(9999))
  })

  it('receipt menggunakan transaction.customer, bukan customerStore terbaru', async () => {
    const { wrapper, customerStore } = await mountReceiptView()

    customerStore.createCustomer({
      name: 'Budi Santoso',
      phone: '081234567890',
      email: 'baru@email.com',
    })

    expect(wrapper.text()).toContain('Budi')
    expect(wrapper.text()).not.toContain('Budi Santoso')
  })

  it('transaction baru menyimpan businessSnapshot', async () => {
    const { wrapper, transactionStore } = await mountPaymentView()

    await getButtonByText(wrapper, 'QRIS').trigger('click')
    await flushPromises()
    await getButtonByText(wrapper, 'Selesaikan Pembayaran').trigger('click')
    await flushPromises()

    expect(transactionStore.lastTransaction.businessSnapshot).toEqual({
      name: 'Toko ABC',
      outlet: 'Outlet Utama',
      phone: '08123456789',
    })
  })

  it('businessSnapshot merupakan clone', () => {
    const { transactionStore } = createContext()
    const businessSnapshot = {
      name: 'Toko ABC',
      outlet: 'Outlet Utama',
      phone: '08123456789',
    }

    const transaction = transactionStore.createTransaction({
      items: [{ id: 1, name: 'Es Kopi Susu', price: 22000, qty: 1 }],
      subtotal: 22000,
      tax: 2420,
      total: 24420,
      paymentMethod: 'qris',
      businessSnapshot,
    })

    businessSnapshot.name = 'Toko XYZ'

    expect(transaction.businessSnapshot.name).toBe('Toko ABC')
  })

  it('receipt menggunakan businessSnapshot ketika tersedia', async () => {
    const { wrapper, businessStore } = await mountReceiptView({
      businessOverrides: {
        name: 'Toko XYZ',
        outlet: 'Outlet Baru',
        phone: '089999999999',
      },
    })

    expect(businessStore.name).toBe('Toko XYZ')
    expect(wrapper.text()).toContain('Toko ABC')
    expect(wrapper.text()).toContain('Outlet Lama')
    expect(wrapper.text()).not.toContain('Toko XYZ')
  })

  it('legacy transaction tanpa businessSnapshot tetap dapat ditampilkan', async () => {
    const { wrapper } = await mountReceiptView({
      transactionOverrides: {
        id: 'legacy-transaction',
        businessSnapshot: null,
      },
      businessOverrides: {
        name: 'Toko Fallback',
        outlet: 'Outlet Fallback',
        phone: '081111111111',
      },
      id: 'legacy-transaction',
    })

    expect(wrapper.text()).toContain('Toko Fallback')
    expect(wrapper.text()).toContain('Outlet Fallback')
  })

  it('tombol Print memanggil window.print() tepat 1 kali', async () => {
    const printSpy = vi.spyOn(window, 'print').mockImplementation(() => {})
    const { wrapper } = await mountReceiptView()

    await getButtonByText(wrapper, 'Print').trigger('click')

    expect(printSpy).toHaveBeenCalledTimes(1)
    printSpy.mockRestore()
  })

  it('/transactions/:id/receipt dapat dibuka dengan shift closed jika Business + PIN ready', async () => {
    const { router, businessStore, cashierStore, transactionStore } = createContext()

    makeBusinessReady(businessStore)
    cashierStore.setPinConfigured(true)
    seedTransaction(transactionStore)
    await router.push('/transactions/trx-receipt-1/receipt')

    expect(router.currentRoute.value.fullPath).toBe('/transactions/trx-receipt-1/receipt')
  })

  it('route POS tetap membutuhkan active shift', async () => {
    const { router, businessStore, cashierStore } = createContext()

    makeBusinessReady(businessStore)
    cashierStore.setPinConfigured(true)
    await router.push('/pos')

    expect(router.currentRoute.value.fullPath).toBe('/shift/open')
  })

  it('Payment Success memiliki navigasi ke receipt transaction terakhir', async () => {
    const context = createContext()

    makeBusinessReady(context.businessStore)
    context.cashierStore.setPinConfigured(true)
    context.shiftStore.openShift(100000)
    const transaction = seedTransaction(context.transactionStore, { id: 'success-1' })
    context.transactionStore.lastTransaction = transaction

    await context.router.push('/payment/success')
    await flushPromises()

    const wrapper = mount(PaymentSuccessView, {
      global: {
        plugins: [context.pinia, context.router],
      },
    })

    await getButtonByText(wrapper, 'Lihat Struk').trigger('click')
    await flushPromises()

    expect(context.router.currentRoute.value.fullPath).toBe('/transactions/success-1/receipt')
  })

  it('Transaction Detail memiliki navigasi ke receipt', async () => {
    const context = createContext()

    makeBusinessReady(context.businessStore)
    context.cashierStore.setPinConfigured(true)
    const transaction = seedTransaction(context.transactionStore, { id: 'detail-1' })

    await context.router.push(`/transactions/${transaction.id}`)
    await flushPromises()

    const wrapper = mount(TransactionDetailView, {
      global: {
        plugins: [context.pinia, context.router],
      },
    })

    await getButtonByText(wrapper, 'Lihat Struk').trigger('click')
    await flushPromises()

    expect(context.router.currentRoute.value.fullPath).toBe(`/transactions/${transaction.id}/receipt`)
  })
})
