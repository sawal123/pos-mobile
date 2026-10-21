import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { describe, expect, it } from 'vitest'

import { createAppRouter } from '@/router'
import { useBusinessStore } from '@/stores/businessStore'
import { useExpenseStore } from '@/stores/expenseStore'
import { useTransactionStore } from '@/stores/transactionStore'
import { formatCurrency } from '@/utils/formatters'
import ReportsView from '@/views/reports/ReportsView.vue'

function createContext() {
  const pinia = createPinia()
  setActivePinia(pinia)

  const router = createAppRouter()
  const businessStore = useBusinessStore()
  const expenseStore = useExpenseStore()
  const transactionStore = useTransactionStore()

  businessStore.setBusiness({
    name: 'Kopi Kenangan Senja',
    type: 'Cafe',
    owner: 'Owner Test',
    phone: '08123456789',
    outlet: 'Outlet Utama',
    mode: 'free',
  })

  return { pinia, router, businessStore, expenseStore, transactionStore }
}

describe('ReportsView UI/UX Enhancement', () => {
  it('menampilkan header finansial, switcher periode, dan metrik ringkasan performa', async () => {
    const context = createContext()
    context.transactionStore.items = [
      {
        id: 'trx-1',
        total: 100000,
        grossProfit: 60000,
        paymentMethod: 'cash',
        status: 'paid',
        createdAt: new Date().toISOString(),
        items: [{ id: 1, name: 'Latte', qty: 2, price: 50000 }],
      },
      {
        id: 'trx-2',
        total: 50000,
        grossProfit: 30000,
        paymentMethod: 'qris',
        status: 'paid',
        createdAt: new Date().toISOString(),
        items: [{ id: 2, name: 'Croissant', qty: 1, price: 50000 }],
      },
    ]

    context.expenseStore.expenses = [
      {
        id: 'exp-1',
        title: 'Beli susu segar',
        category: 'Belanja Stok',
        amount: 25000,
        createdAt: new Date().toISOString(),
      },
    ]

    await context.router.push('/reports')
    await flushPromises()

    const wrapper = mount(ReportsView, {
      global: { plugins: [context.pinia, context.router] },
    })

    // Header & period
    expect(wrapper.text()).toContain('Laporan Keuangan')
    expect(wrapper.text()).toContain('Semua Waktu')
    expect(wrapper.text()).toContain('Hari Ini')
    expect(wrapper.text()).toContain('Bulan Ini')

    // Revenue, Transactions, Gross Profit, Expenses
    expect(wrapper.find('[data-testid="reports-revenue"]').text()).toBe(formatCurrency(150000))
    expect(wrapper.find('[data-testid="reports-transactions-count"]').text()).toBe('2')
    expect(wrapper.find('[data-testid="reports-gross-profit"]').text()).toBe(formatCurrency(90000))
    expect(wrapper.find('[data-testid="reports-expenses"]').text()).toBe(formatCurrency(25000))

    // Net Profit = Gross Profit (90000) - Expense (25000) = 65000
    expect(wrapper.find('[data-testid="reports-net-profit"]').text()).toBe(formatCurrency(65000))
    expect(wrapper.text()).toContain('Profit Bersih')

    // Payment methods breakdown
    expect(wrapper.text()).toContain('Tunai (Cash)')
    expect(wrapper.text()).toContain('QRIS')

    // Top selling
    expect(wrapper.text()).toContain('Latte')
    expect(wrapper.text()).toContain('Croissant')
  })

  it('menghitung defisit jika total pengeluaran melebihi laba kotor', async () => {
    const context = createContext()
    context.transactionStore.items = [
      {
        id: 'trx-1',
        total: 50000,
        grossProfit: 20000,
        paymentMethod: 'cash',
        status: 'paid',
        createdAt: new Date().toISOString(),
      },
    ]

    context.expenseStore.expenses = [
      {
        id: 'exp-1',
        title: 'Sewa Tempat',
        category: 'Operasional',
        amount: 100000,
        createdAt: new Date().toISOString(),
      },
    ]

    await context.router.push('/reports')
    await flushPromises()

    const wrapper = mount(ReportsView, {
      global: { plugins: [context.pinia, context.router] },
    })

    // Net Profit = 20000 - 100000 = -80000
    expect(wrapper.find('[data-testid="reports-net-profit"]').text()).toBe(formatCurrency(-80000))
    expect(wrapper.text()).toContain('Defisit Usaha')
  })

  it('memfilter data transaksi dan biaya saat periode diubah', async () => {
    const context = createContext()
    const yesterday = new Date(Date.now() - 24 * 3600 * 1000 * 2).toISOString()
    const today = new Date().toISOString()

    context.transactionStore.items = [
      {
        id: 'trx-today',
        total: 80000,
        grossProfit: 50000,
        status: 'paid',
        createdAt: today,
      },
      {
        id: 'trx-past',
        total: 120000,
        grossProfit: 70000,
        status: 'paid',
        createdAt: yesterday,
      },
    ]

    await context.router.push('/reports')
    await flushPromises()

    const wrapper = mount(ReportsView, {
      global: { plugins: [context.pinia, context.router] },
    })

    // Default: Semua Waktu (80000 + 120000 = 200000)
    expect(wrapper.find('[data-testid="reports-revenue"]').text()).toBe(formatCurrency(200000))

    // Switch to Hari Ini
    const todayChip = wrapper.findAll('button').find((b) => b.text().includes('Hari Ini'))
    expect(todayChip).toBeTruthy()
    await todayChip.trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-testid="reports-revenue"]').text()).toBe(formatCurrency(80000))
  })

  it('modal ringkasan struk dapat dibuka dan menampilkan format cetak', async () => {
    const context = createContext()
    context.transactionStore.items = [
      {
        id: 'trx-1',
        total: 75000,
        grossProfit: 40000,
        status: 'paid',
        paymentMethod: 'cash',
        createdAt: new Date().toISOString(),
      },
    ]

    await context.router.push('/reports')
    await flushPromises()

    const wrapper = mount(ReportsView, {
      global: { plugins: [context.pinia, context.router] },
    })

    const receiptBtn = wrapper.findAll('button').find((b) => b.text().includes('Ringkasan Struk'))
    expect(receiptBtn).toBeTruthy()
    await receiptBtn.trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('Ringkasan Struk Keuangan')
    expect(wrapper.text()).toContain('Kopi Kenangan Senja')
    expect(wrapper.text()).toContain('Salin Teks Laporan')
  })
})
