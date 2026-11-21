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

    // Default filter shows Hari Ini (Andi Wijaya created today)
    expect(wrapper.text()).toContain('Andi Wijaya')
    expect(wrapper.text()).not.toContain('Sari Dewi')

    // Switch date filter to "Semua Tanggal" to show all
    const allDateBtn = wrapper.find('[data-testid="filter-date-all"]')
    await allDateBtn.trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('Andi Wijaya')
    expect(wrapper.text()).toContain('Sari Dewi')

    // Search for "Espresso"
    const searchInput = wrapper.find('input[type="search"]')
    await searchInput.setValue('Espresso')

    expect(wrapper.text()).toContain('Andi Wijaya')
    expect(wrapper.text()).not.toContain('Sari Dewi')

    // Reset search, test QRIS filter
    await searchInput.setValue('')
    const qrisBtn = wrapper.find('[data-testid="filter-pay-qris"]')
    await qrisBtn.trigger('click')

    expect(wrapper.text()).toContain('Sari Dewi')
    expect(wrapper.text()).not.toContain('Andi Wijaya')

    // Test Date Flicker controls
    const prevBtn = wrapper.find('[data-testid="date-flicker-prev"]')
    expect(prevBtn.exists()).toBe(true)
    await prevBtn.trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-testid="date-flicker-label"]').exists()).toBe(true)
  })

  it('menyembunyikan Status Order Laundry saat bisnis bertipe Cafe / UMKM meski orderStatus terisi', async () => {
    const { pinia, router, businessStore, transactionStore } = setupContext()
    businessStore.setBusiness({
      name: 'Temuan Space',
      type: 'Cafe / UMKM',
      owner: 'Owner',
      phone: '08123456789',
      outlet: 'Temuan Space Laksana',
      mode: 'cloud',
    })

    const migratedTx = transactionStore.addTransaction({
      id: 'trx-cafe-migrated-1',
      invoiceNumber: 'CJYFOHUM1711',
      customer: 'Walk-in',
      status: 'completed',
      orderStatus: 'Masuk',
      items: [{ id: 'p1', name: 'Americano', qty: 1, price: 18000, subtotal: 18000 }],
      total: 18000,
      paymentMethod: 'cash',
      createdAt: '2026-11-17T10:00:00+07:00',
    })

    await router.push(`/transactions/${migratedTx.id}`)
    await flushPromises()

    const wrapper = mount(TransactionDetailView, {
      global: { plugins: [pinia, router] },
    })

    expect(wrapper.find('[data-testid="laundry-order-status-section"]').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('Status Order Laundry')
    expect(wrapper.text()).toContain('Lunas')
  })

  it('menampilkan Status Order Laundry saat bisnis bertipe Laundry', async () => {
    const { pinia, router, businessStore, transactionStore } = setupContext()
    businessStore.setBusiness({
      name: 'Clean Laundry',
      type: 'Laundry',
      owner: 'Owner',
      phone: '08123456789',
      outlet: 'Cabang 1',
      mode: 'free',
    })

    const laundryTx = transactionStore.addTransaction({
      id: 'trx-laundry-1',
      invoiceNumber: 'LDR-20261118-0001',
      customer: 'Budi',
      status: 'paid',
      orderStatus: 'Masuk',
      items: [{ id: 's1', name: 'Cuci Setrika', qty: 3, price: 8000, subtotal: 24000, unit: 'kg' }],
      total: 24000,
      paymentMethod: 'cash',
      createdAt: '2026-11-18T10:00:00+07:00',
    })

    await router.push(`/transactions/${laundryTx.id}`)
    await flushPromises()

    const wrapper = mount(TransactionDetailView, {
      global: { plugins: [pinia, router] },
    })

    expect(wrapper.find('[data-testid="laundry-order-status-section"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('Status Order Laundry')
  })

  it('mendukung pelunasan transaksi Belum Lunas (Bayar Nanti / Tempo) menjadi Siap & Lunas', async () => {
    const { pinia, router, transactionStore } = setupContext()

    const unpaidTx = transactionStore.createTransaction({
      customer: 'Pak Ahmad',
      subtotal: 50000,
      total: 50000,
      paymentMethod: 'unpaid',
      paymentStatus: 'unpaid',
      status: 'unpaid',
      orderStatus: 'Proses',
      items: [{ id: 'p1', name: 'Kopi Susu Literan', qty: 1, price: 50000, subtotal: 50000 }],
    })

    expect(unpaidTx.paymentStatus).toBe('unpaid')
    expect(unpaidTx.orderStatus).toBe('Proses')

    await router.push(`/transactions/${unpaidTx.id}`)
    await flushPromises()

    const wrapper = mount(TransactionDetailView, {
      global: { plugins: [pinia, router] },
    })

    expect(wrapper.text()).toContain('Belum Lunas')
    expect(wrapper.find('[data-testid="unpaid-settlement-section"]').exists()).toBe(true)

    // Buka modal pelunasan
    await wrapper.find('[data-testid="btn-open-settle-modal"]').trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-testid="settlement-modal"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('Pelunasan Pembayaran')
    expect(wrapper.text()).toContain('Transfer')
    expect(wrapper.text()).toContain('QRIS')

    // Konfirmasi pelunasan dengan tunai
    await wrapper.find('[data-testid="btn-confirm-settlement"]').trigger('click')
    await flushPromises()

    const updated = transactionStore.items.find((t) => t.id === unpaidTx.id)
    expect(updated.paymentStatus).toBe('paid')
    expect(updated.orderStatus).toBe('Siap')
  })
})
