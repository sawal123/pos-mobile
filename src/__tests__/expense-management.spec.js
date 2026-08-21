import { createPinia, setActivePinia } from 'pinia'
import { describe, expect, it } from 'vitest'

import { createAppRouter } from '@/router'
import { useBusinessStore } from '@/stores/businessStore'
import { useCashierStore } from '@/stores/cashierStore'
import { useExpenseStore } from '@/stores/expenseStore'
import { useShiftStore } from '@/stores/shiftStore'
import { useTransactionStore } from '@/stores/transactionStore'

function createContext() {
  const pinia = createPinia()
  setActivePinia(pinia)

  return {
    pinia,
    router: createAppRouter(),
    businessStore: useBusinessStore(),
    cashierStore: useCashierStore(),
    expenseStore: useExpenseStore(),
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

const validExpense = {
  title: 'Beli Tissue',
  category: 'Operasional',
  amount: 25000,
  note: 'Keperluan kasir',
}

describe('P5 expense management', () => {
  it('create expense menambah tepat 1 expense', () => {
    const { expenseStore } = createContext()
    const initialCount = expenseStore.expenses.length

    const result = expenseStore.createExpense(validExpense)

    expect(result.success).toBe(true)
    expect(expenseStore.expenses).toHaveLength(initialCount + 1)
  })

  it('create expense menghasilkan ID unik', () => {
    const { expenseStore } = createContext()

    const first = expenseStore.createExpense({ ...validExpense, title: 'Expense A' })
    const second = expenseStore.createExpense({ ...validExpense, title: 'Expense B' })

    expect(first.expense.id).not.toBe(second.expense.id)
  })

  it('createdAt tersimpan', () => {
    const { expenseStore } = createContext()

    const result = expenseStore.createExpense(validExpense)

    expect(result.success).toBe(true)
    expect(result.expense.createdAt).toBeTruthy()
    expect(Number.isNaN(new Date(result.expense.createdAt).getTime())).toBe(false)
  })

  it('title kosong ditolak', () => {
    const { expenseStore } = createContext()
    const initialCount = expenseStore.expenses.length

    const result = expenseStore.createExpense({ ...validExpense, title: '' })

    expect(result.success).toBe(false)
    expect(result.errors.title).toBeTruthy()
    expect(expenseStore.expenses).toHaveLength(initialCount)
  })

  it('title whitespace-only ditolak', () => {
    const { expenseStore } = createContext()

    const result = expenseStore.createExpense({ ...validExpense, title: '   ' })

    expect(result.success).toBe(false)
    expect(result.errors.title).toBeTruthy()
    expect(expenseStore.expenses).toHaveLength(0)
  })

  it('category kosong ditolak', () => {
    const { expenseStore } = createContext()

    const result = expenseStore.createExpense({ ...validExpense, category: '' })

    expect(result.success).toBe(false)
    expect(result.errors.category).toBeTruthy()
    expect(expenseStore.expenses).toHaveLength(0)
  })

  it('category tidak terdaftar ditolak', () => {
    const { expenseStore } = createContext()

    const result = expenseStore.createExpense({ ...validExpense, category: 'Minuman' })

    expect(result.success).toBe(false)
    expect(result.errors.category).toBeTruthy()
    expect(expenseStore.expenses).toHaveLength(0)
  })

  it('amount kosong ditolak', () => {
    const { expenseStore } = createContext()

    const emptyString = expenseStore.createExpense({ ...validExpense, amount: '' })
    const nullValue = expenseStore.createExpense({ ...validExpense, amount: null })

    expect(emptyString.success).toBe(false)
    expect(emptyString.errors.amount).toBeTruthy()
    expect(nullValue.success).toBe(false)
    expect(nullValue.errors.amount).toBeTruthy()
    expect(expenseStore.expenses).toHaveLength(0)
  })

  it('amount 0 ditolak', () => {
    const { expenseStore } = createContext()

    const result = expenseStore.createExpense({ ...validExpense, amount: 0 })

    expect(result.success).toBe(false)
    expect(result.errors.amount).toBeTruthy()
    expect(expenseStore.expenses).toHaveLength(0)
  })

  it('amount negatif ditolak', () => {
    const { expenseStore } = createContext()

    const result = expenseStore.createExpense({ ...validExpense, amount: -1000 })

    expect(result.success).toBe(false)
    expect(result.errors.amount).toBeTruthy()
    expect(expenseStore.expenses).toHaveLength(0)
  })

  it('Infinity ditolak', () => {
    const { expenseStore } = createContext()

    const result = expenseStore.createExpense({ ...validExpense, amount: Number.POSITIVE_INFINITY })

    expect(result.success).toBe(false)
    expect(result.errors.amount).toBeTruthy()
    expect(expenseStore.expenses).toHaveLength(0)
  })

  it('-Infinity ditolak', () => {
    const { expenseStore } = createContext()

    const result = expenseStore.createExpense({ ...validExpense, amount: Number.NEGATIVE_INFINITY })

    expect(result.success).toBe(false)
    expect(result.errors.amount).toBeTruthy()
    expect(expenseStore.expenses).toHaveLength(0)
  })

  it('1e309 ditolak', () => {
    const { expenseStore } = createContext()

    const result = expenseStore.createExpense({ ...validExpense, amount: 1e309 })

    expect(result.success).toBe(false)
    expect(result.errors.amount).toBeTruthy()
    expect(expenseStore.expenses).toHaveLength(0)
  })

  it('NaN ditolak', () => {
    const { expenseStore } = createContext()

    const result = expenseStore.createExpense({ ...validExpense, amount: Number.NaN })

    expect(result.success).toBe(false)
    expect(result.errors.amount).toBeTruthy()
    expect(expenseStore.expenses).toHaveLength(0)
  })

  it('amount valid disimpan sebagai Number', () => {
    const { expenseStore } = createContext()

    const result = expenseStore.createExpense(validExpense)

    expect(result.success).toBe(true)
    expect(typeof result.expense.amount).toBe('number')
    expect(result.expense.amount).toBe(25000)
  })

  it('amount string numeric disimpan sebagai Number', () => {
    const { expenseStore } = createContext()

    const result = expenseStore.createExpense({ ...validExpense, amount: '25000' })

    expect(result.success).toBe(true)
    expect(typeof result.expense.amount).toBe('number')
    expect(result.expense.amount).toBe(25000)
  })

  it('note di-trim', () => {
    const { expenseStore } = createContext()

    const result = expenseStore.createExpense({ ...validExpense, note: '  Keperluan kasir  ' })

    expect(result.success).toBe(true)
    expect(result.expense.note).toBe('Keperluan kasir')
  })

  it('update expense mengubah record yang benar', () => {
    const { expenseStore } = createContext()
    const created = expenseStore.createExpense(validExpense)

    const result = expenseStore.updateExpense(created.expense.id, {
      title: 'Beli Kertas',
      category: 'Belanja Stok',
      amount: 30000,
      note: 'Untuk struk',
    })

    expect(result.success).toBe(true)
    expect(expenseStore.getExpenseById(created.expense.id)).toMatchObject({
      title: 'Beli Kertas',
      category: 'Belanja Stok',
      amount: 30000,
      note: 'Untuk struk',
    })
    expect(expenseStore.expenses).toHaveLength(1)
  })

  it('update tidak mengubah ID', () => {
    const { expenseStore } = createContext()
    const created = expenseStore.createExpense(validExpense)

    const result = expenseStore.updateExpense(created.expense.id, {
      ...validExpense,
      title: 'Beli Kertas',
      amount: 30000,
    })

    expect(result.success).toBe(true)
    expect(result.expense.id).toBe(created.expense.id)
  })

  it('update tidak mengubah createdAt', () => {
    const { expenseStore } = createContext()
    const created = expenseStore.createExpense(validExpense)

    const result = expenseStore.updateExpense(created.expense.id, {
      ...validExpense,
      title: 'Beli Kertas',
      amount: 30000,
    })

    expect(result.success).toBe(true)
    expect(result.expense.createdAt).toBe(created.expense.createdAt)
  })

  it('update ID tidak ditemukan ditolak', () => {
    const { expenseStore } = createContext()
    const initialCount = expenseStore.expenses.length

    const result = expenseStore.updateExpense('missing-id', validExpense)

    expect(result.success).toBe(false)
    expect(result.errors.form).toBeTruthy()
    expect(expenseStore.expenses).toHaveLength(initialCount)
  })

  it('invalid update tidak mengubah existing expense', () => {
    const { expenseStore } = createContext()
    const created = expenseStore.createExpense(validExpense)
    const original = { ...expenseStore.getExpenseById(created.expense.id) }

    const result = expenseStore.updateExpense(created.expense.id, {
      ...validExpense,
      title: 'Beli Kertas',
      amount: 0,
    })

    expect(result.success).toBe(false)
    expect(result.errors.amount).toBeTruthy()
    expect(expenseStore.getExpenseById(created.expense.id)).toEqual(original)
    expect(expenseStore.expenses).toHaveLength(1)
  })

  it('delete expense berhasil', () => {
    const { expenseStore } = createContext()
    const created = expenseStore.createExpense(validExpense)

    const deleted = expenseStore.deleteExpense(created.expense.id)

    expect(deleted).toBe(true)
    expect(expenseStore.getExpenseById(created.expense.id)).toBeNull()
    expect(expenseStore.expenses).toHaveLength(0)
  })

  it('totalExpenses dihitung dengan benar', () => {
    const { expenseStore } = createContext()

    expenseStore.createExpense({ ...validExpense, amount: 25000 })
    expenseStore.createExpense({ ...validExpense, title: 'Beli Kertas', amount: 30000 })
    expenseStore.createExpense({ ...validExpense, title: 'Bensin', amount: 15000 })

    expect(expenseStore.totalExpenses).toBe(70000)
  })

  it('membuat expense tidak mengubah transaction', () => {
    const { expenseStore, transactionStore } = createContext()
    const transactionCount = transactionStore.items.length

    expenseStore.createExpense(validExpense)
    expenseStore.updateExpense(expenseStore.expenses[0].id, { ...validExpense, amount: 30000 })
    expenseStore.deleteExpense(expenseStore.expenses[0].id)

    expect(transactionStore.items).toHaveLength(transactionCount)
    expect(transactionStore.lastTransaction).toBeNull()
  })

  it('/expenses dapat diakses dengan shift closed jika Business + PIN ready', async () => {
    const { router, businessStore, cashierStore } = createContext()

    makeBusinessReady(businessStore)
    cashierStore.setPinConfigured(true)
    await router.push('/expenses')

    expect(router.currentRoute.value.fullPath).toBe('/expenses')
  })

  it('/expenses/create dapat diakses dengan shift closed', async () => {
    const { router, businessStore, cashierStore } = createContext()

    makeBusinessReady(businessStore)
    cashierStore.setPinConfigured(true)
    await router.push('/expenses/create')

    expect(router.currentRoute.value.fullPath).toBe('/expenses/create')
  })

  it('/expenses/:id/edit dapat diakses dengan shift closed', async () => {
    const { router, businessStore, cashierStore, expenseStore } = createContext()
    const created = expenseStore.createExpense(validExpense)

    makeBusinessReady(businessStore)
    cashierStore.setPinConfigured(true)
    await router.push(`/expenses/${created.expense.id}/edit`)

    expect(router.currentRoute.value.fullPath).toBe(`/expenses/${created.expense.id}/edit`)
  })

  it('/pos tetap membutuhkan active shift', async () => {
    const { router, businessStore, cashierStore } = createContext()

    makeBusinessReady(businessStore)
    cashierStore.setPinConfigured(true)
    await router.push('/pos')

    expect(router.currentRoute.value.fullPath).toBe('/shift/open')
  })
})
