import { defineStore } from 'pinia'

export const EXPENSE_CATEGORIES = [
  'Operasional',
  'Belanja Stok',
  'Transportasi',
  'Lainnya',
]

function createExpenseId() {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID()
  }

  return `expense-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

function normalizeText(value) {
  return `${value ?? ''}`.trim()
}

function normalizeAmount(value) {
  if (value === null || value === undefined || value === '') {
    return null
  }

  return typeof value === 'number' ? value : Number(value)
}

function validateExpenseInput(payload) {
  const title = normalizeText(payload.title)
  const category = normalizeText(payload.category)
  const note = normalizeText(payload.note)
  const amount = normalizeAmount(payload.amount)
  const errors = {}

  if (!title) {
    errors.title = 'Judul pengeluaran wajib diisi.'
  }

  if (!category) {
    errors.category = 'Kategori pengeluaran wajib dipilih.'
  } else if (!EXPENSE_CATEGORIES.includes(category)) {
    errors.category = 'Kategori pengeluaran tidak valid.'
  }

  if (amount === null) {
    errors.amount = 'Jumlah pengeluaran wajib diisi.'
  } else if (!Number.isFinite(amount) || amount <= 0) {
    errors.amount = 'Jumlah pengeluaran harus angka lebih dari 0.'
  }

  return {
    isValid: Object.keys(errors).length === 0,
    errors,
    values: {
      title,
      category,
      note,
      amount,
    },
  }
}

export const useExpenseStore = defineStore('expense', {
  state: () => ({
    expenses: [],
  }),
  getters: {
    totalExpenses(state) {
      return state.expenses.reduce((sum, expense) => sum + expense.amount, 0)
    },
    sortedExpenses(state) {
      return [...state.expenses].sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      )
    },
  },
  actions: {
    getExpenseById(id) {
      return this.expenses.find((expense) => String(expense.id) === String(id)) ?? null
    },
    createExpense(payload) {
      const { isValid, errors, values } = validateExpenseInput(payload)

      if (!isValid) {
        return {
          success: false,
          errors,
        }
      }

      const expense = {
        id: createExpenseId(),
        ...values,
        createdAt: new Date().toISOString(),
      }

      this.expenses.push(expense)

      return {
        success: true,
        expense,
        errors: {},
      }
    },
    updateExpense(id, payload) {
      const expense = this.getExpenseById(id)

      if (!expense) {
        return {
          success: false,
          errors: {
            form: 'Pengeluaran tidak ditemukan.',
          },
        }
      }

      const { isValid, errors, values } = validateExpenseInput(payload)

      if (!isValid) {
        return {
          success: false,
          errors,
        }
      }

      expense.title = values.title
      expense.category = values.category
      expense.amount = values.amount
      expense.note = values.note

      return {
        success: true,
        expense,
        errors: {},
      }
    },
    deleteExpense(id) {
      const initialLength = this.expenses.length
      this.expenses = this.expenses.filter((expense) => String(expense.id) !== String(id))

      return this.expenses.length !== initialLength
    },
  },
})
