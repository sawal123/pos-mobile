import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { describe, expect, it } from 'vitest'

import { createAppRouter } from '@/router'
import { useBusinessStore } from '@/stores/businessStore'
import { useCashierStore } from '@/stores/cashierStore'
import { useTransactionStore } from '@/stores/transactionStore'
import { formatCurrency } from '@/utils/formatters'
import TransactionCard from '@/components/transaction/TransactionCard.vue'
import TransactionDetailView from '@/views/transactions/TransactionDetailView.vue'
import TransactionsView from '@/views/transactions/TransactionsView.vue'

function setupContext() {
  const pinia = createPinia()
  setActivePinia(pinia)
  const router = createAppRouter()
  const businessStore = useBusinessStore()
  const cashierStore = useCashierStore()
  const transactionStore = useTransactionStore()

  businessStore.setBusiness({
    name: 'Kopi Nusantara',
    type: 'Cafe',
    owner: 'Owner',
    phone: '08123456789',
    outlet: 'Outlet Utama',
    mode: 'cloud',
  })
  cashierStore.setPinConfigured(true)

  return { pinia, router, businessStore, cashierStore, transactionStore }
}

describe('Transaction Detail & Minimalist UI', () => {
  it('menampilkan detail item pesanan secara lengkap (nama, kuantitas, harga, subtotal baris)', async () => {
    const { pinia, router, transactionStore } = setupContext()

    const sampleTx = transactionStore.addTransaction({
      id: 'trx-test-detail-1',
      invoiceNumber: 'INV-20261021-TEST1',
      customer: 'Siti Rahma',
      status: 'paid',
      items: [
        { id: 'prod-1', name: 'Americano Double', qty: 2, price: 22000, subtotal: 44000, unit: 'cup' },
        { id: 'prod-2', name: 'Croissant Cokelat', qty: 1, price: 28000, subtotal: 28000, unit: 'pcs' },
      ],
      itemCount: 3,
      subtotal: 72000,
      tax: 7920,
      taxRate: 11,
      total: 79920,
      paymentMethod: 'cash',
      cashReceived: 100000,
      changeAmount: 20080,
      createdAt: '2026-10-21T09:30:00+07:00',
    })

    await router.push(`/transactions/${sampleTx.id}`)
    await flushPromises()

    const wrapper = mount(TransactionDetailView, {
      global: {
        plugins: [pinia, router],
      },
    })

    // Invoice & customer
    expect(wrapper.text()).toContain('INV-20261021-TEST1')
    expect(wrapper.text()).toContain('Siti Rahma')
    expect(wrapper.text()).toContain('Lunas')

    // Item rows
    const rows = wrapper.findAll('[data-testid="transaction-item-row"]')
    expect(rows.length).toBe(2)

    expect(wrapper.text()).toContain('Americano Double')
    expect(wrapper.text()).toContain(formatCurrency(44000))
    expect(wrapper.text()).toContain('Croissant Cokelat')
    expect(wrapper.text()).toContain(formatCurrency(28000))

    // Total & Breakdown
    expect(wrapper.text()).toContain(formatCurrency(72000))
    expect(wrapper.text()).toContain('Pajak (11%)')
    expect(wrapper.text()).toContain(formatCurrency(7920))
    expect(wrapper.text()).toContain(formatCurrency(79920))

    // Cash info
    expect(wrapper.text()).toContain('Uang Diterima')
    expect(wrapper.text()).toContain(formatCurrency(100000))
    expect(wrapper.text()).toContain('Kembalian')
    expect(wrapper.text()).toContain(formatCurrency(20080))
  })

  it('navigasi ke receipt tetap berfungsi via tombol "Lihat Struk"', async () => {
    const { pinia, router, transactionStore } = setupContext()

    const sampleTx = transactionStore.addTransaction({
      id: 'trx-test-receipt-nav',
      invoiceNumber: 'INV-20261021-NAV',
      customer: 'Walk-in Customer',
      status: 'paid',
      items: [{ id: 'p1', name: 'Kopi Tubruk', qty: 1, price: 15000, subtotal: 15000 }],
      total: 15000,
      paymentMethod: 'qris',
      createdAt: '2026-10-21T10:00:00+07:00',
    })

    await router.push(`/transactions/${sampleTx.id}`)
    await flushPromises()

    const wrapper = mount(TransactionDetailView, {
      global: {
        plugins: [pinia, router],
      },
    })

    const receiptButtons = wrapper.findAll('button').filter((b) => b.text().includes('Lihat Struk'))
    expect(receiptButtons.length).toBeGreaterThanOrEqual(1)

    await receiptButtons[0].trigger('click')
    await flushPromises()

    expect(router.currentRoute.value.fullPath).toBe(`/transactions/${sampleTx.id}/receipt`)
  })

  it('TransactionCard menampilkan preview item dan identifier minimalis', async () => {
    const { pinia, router } = setupContext()

    const sampleTx = {
      id: 'd9059d63-ba87-4b1d-993a-de58b2661a8b',
      invoiceNumber: 'INV-20261021-X1',
      customer: 'Budi Santoso',
      status: 'completed',
      items: [
        { name: 'Matcha Latte', qty: 2, price: 25000 },
        { name: 'Brownies', qty: 1, price: 18000 },
      ],
      total: 68000,
      paymentMethod: 'qris',
      createdAt: '2026-10-21T11:00:00+07:00',
    }

    const wrapper = mount(TransactionCard, {
      props: { transaction: sampleTx },
      global: { plugins: [pinia, router] },
    })

    expect(wrapper.text()).toContain('INV-20261021-X1')
    expect(wrapper.text()).toContain('Budi Santoso')
    expect(wrapper.text()).toContain('Matcha Latte (2x), Brownies (1x)')
    expect(wrapper.text()).toContain('3 item')
    expect(wrapper.text()).toContain('QRIS')
    expect(wrapper.text()).toContain(formatCurrency(68000))
    expect(wrapper.text()).toContain('Selesai')
  })

  it('TransactionsView mendukung pencarian dan filter transaksi', async () => {
    const { pinia, router, transactionStore } = setupContext()

    transactionStore.items = [
      {
        id: 'trx-1',
        invoiceNumber: 'INV-ALPHA-01',
        customer: 'Andi Wijaya',
        items: [{ name: 'Espresso', qty: 1, price: 20000 }],
        total: 20000,
        paymentMethod: 'cash',
        status: 'paid',
        createdAt: new Date().toISOString(),
      },
      {
        id: 'trx-2',
        invoiceNumber: 'INV-BETA-02',
        customer: 'Sari Dewi',
        items: [{ name: 'Latte', qty: 1, price: 25000 }],
        total: 25000,
        paymentMethod: 'qris',
        status: 'completed',
        createdAt: '2026-01-01T10:00:00Z',
      },
    ]

    await router.push('/transactions')
    await flushPromises()

    const wrapper = mount(TransactionsView, {
      global: { plugins: [pinia, router] },
    })

    // Initially shows both
    expect(wrapper.text()).toContain('Andi Wijaya')
    expect(wrapper.text()).toContain('Sari Dewi')

    // Search for "Espresso"
    const searchInput = wrapper.find('input[type="search"]')
    await searchInput.setValue('Espresso')

    expect(wrapper.text()).toContain('Andi Wijaya')
    expect(wrapper.text()).not.toContain('Sari Dewi')

    // Reset search, test QRIS filter
    await searchInput.setValue('')
    const qrisBtn = wrapper.findAll('button').find((b) => b.text().includes('QRIS'))
    await qrisBtn.trigger('click')

    expect(wrapper.text()).toContain('Sari Dewi')
    expect(wrapper.text()).not.toContain('Andi Wijaya')
  })
})
