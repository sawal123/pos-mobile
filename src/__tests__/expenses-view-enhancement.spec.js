import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { describe, expect, it } from 'vitest'

import { createAppRouter } from '@/router'
import { useExpenseStore } from '@/stores/expenseStore'
import { formatCurrency } from '@/utils/formatters'
import ExpensesView from '@/views/expenses/ExpensesView.vue'
import ExpenseFormView from '@/views/expenses/ExpenseFormView.vue'

function createContext() {
  const pinia = createPinia()
  setActivePinia(pinia)

  const router = createAppRouter()
  const expenseStore = useExpenseStore()

  return { pinia, router, expenseStore }
}

describe('ExpensesView UI/UX Enhancement', () => {
  it('menampilkan total pengeluaran, daftar beban usaha, dan kategori chips', async () => {
    const context = createContext()
    context.expenseStore.expenses = [
      {
        id: 'exp-1',
        title: 'Beli Kopi Arabika',
        category: 'Belanja Stok',
        amount: 50000,
        note: 'Stok biji kopi',
        createdAt: new Date().toISOString(),
      },
      {
        id: 'exp-2',
        title: 'Bensin Kurir',
        category: 'Transportasi',
        amount: 20000,
        note: 'Antar pesanan',
        createdAt: new Date().toISOString(),
      },
    ]

    await context.router.push('/expenses')
    await flushPromises()

    const wrapper = mount(ExpensesView, {
      global: { plugins: [context.pinia, context.router] },
    })

    // Header & Summary
    expect(wrapper.text()).toContain('Riwayat Pengeluaran')
    expect(wrapper.text()).toContain(formatCurrency(70000))
    expect(wrapper.text()).toContain('2 transaksi biaya')

    // Expense Items
    expect(wrapper.text()).toContain('Beli Kopi Arabika')
    expect(wrapper.text()).toContain('-' + formatCurrency(50000))
    expect(wrapper.text()).toContain('Bensin Kurir')
    expect(wrapper.text()).toContain('-' + formatCurrency(20000))
  })

  it('memfilter daftar pengeluaran berdasarkan pencarian teks dan kategori', async () => {
    const context = createContext()
    context.expenseStore.expenses = [
      {
        id: 'exp-1',
        title: 'Beli Kopi Arabika',
        category: 'Belanja Stok',
        amount: 50000,
        createdAt: new Date().toISOString(),
      },
      {
        id: 'exp-2',
        title: 'Bayar Listrik',
        category: 'Operasional',
        amount: 150000,
        createdAt: new Date().toISOString(),
      },
    ]

    await context.router.push('/expenses')
    await flushPromises()

    const wrapper = mount(ExpensesView, {
      global: { plugins: [context.pinia, context.router] },
    })

    // Filter category Operasional
    const operasionalChip = wrapper.findAll('button').find((b) => b.text().includes('Operasional'))
    expect(operasionalChip).toBeTruthy()
    await operasionalChip.trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('Bayar Listrik')
    expect(wrapper.text()).not.toContain('Beli Kopi Arabika')

    // Search query
    const searchInput = wrapper.find('input[type="text"]')
    await searchInput.setValue('Listrik')
    await flushPromises()

    expect(wrapper.text()).toContain('Bayar Listrik')
  })

  it('membuka modal konfirmasi hapus dan menghapus pengeluaran', async () => {
    const context = createContext()
    context.expenseStore.expenses = [
      {
        id: 'exp-1',
        title: 'Beli Sabun Cuci',
        category: 'Operasional',
        amount: 15000,
        createdAt: new Date().toISOString(),
      },
    ]

    await context.router.push('/expenses')
    await flushPromises()

    const wrapper = mount(ExpensesView, {
      global: { plugins: [context.pinia, context.router] },
    })

    const deleteBtn = wrapper.findAll('button').find((b) => b.text().includes('Hapus'))
    expect(deleteBtn).toBeTruthy()
    await deleteBtn.trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('Hapus Catatan Pengeluaran')
    expect(wrapper.text()).toContain('Beli Sabun Cuci')

    // Confirm delete inside modal
    const confirmBtn = wrapper.find('[data-testid="confirm-delete-expense-btn"]')
    expect(confirmBtn.exists()).toBe(true)
    await confirmBtn.trigger('click')
    await flushPromises()

    expect(context.expenseStore.expenses).toHaveLength(0)
  })

  it('ExpenseFormView dapat memilih kategori melalui chips dan menambah nominal dengan tombol cepat', async () => {
    const context = createContext()
    await context.router.push('/expenses/create')
    await flushPromises()

    const wrapper = mount(ExpenseFormView, {
      global: { plugins: [context.pinia, context.router] },
    })

    expect(wrapper.text()).toContain('Catat Pengeluaran Baru')

    // Select category via chip
    const operasionalBtn = wrapper.findAll('button').find((b) => b.text() === 'Operasional')
    expect(operasionalBtn).toBeTruthy()
    await operasionalBtn.trigger('click')
    await flushPromises()

    // Add quick amount +50.000
    const add50kBtn = wrapper.findAll('button').find((b) => b.text().includes('50.000'))
    expect(add50kBtn).toBeTruthy()
    await add50kBtn.trigger('click')
    await flushPromises()

    const amountInput = wrapper.find('input[type="number"]')
    expect(amountInput.element.value).toBe('50000')
  })
})
