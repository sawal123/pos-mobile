import { defineStore } from 'pinia'

function createCashEntryId() {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID()
  }

  return `cash-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

function normalizeAmount(value) {
  const amount = Number(value)
  return Number.isFinite(amount) && amount >= 0 ? amount : Number.NaN
}

function isToday(dateString) {
  const date = new Date(dateString)
  const today = new Date()

  return date.getFullYear() === today.getFullYear()
    && date.getMonth() === today.getMonth()
    && date.getDate() === today.getDate()
}

export const useCashStore = defineStore('cash', {
  state: () => ({
    entries: [],
  }),
  getters: {
    cashIn: (state) => state.entries
      .filter((entry) => entry.type === 'in')
      .reduce((sum, entry) => sum + entry.amount, 0),
    cashOut: (state) => state.entries
      .filter((entry) => entry.type === 'out')
      .reduce((sum, entry) => sum + entry.amount, 0),
    balance() {
      return this.cashIn - this.cashOut
    },
    todayCashIn: (state) => state.entries
      .filter((entry) => entry.type === 'in' && isToday(entry.createdAt))
      .reduce((sum, entry) => sum + entry.amount, 0),
    todayCashOut: (state) => state.entries
      .filter((entry) => entry.type === 'out' && isToday(entry.createdAt))
      .reduce((sum, entry) => sum + entry.amount, 0),
  },
  actions: {
    recordEntry(payload) {
      const type = payload.type === 'out' ? 'out' : 'in'
      const amount = normalizeAmount(payload.amount)

      if (Number.isNaN(amount) || amount <= 0) {
        return {
          success: false,
          error: 'Nominal kas harus lebih dari 0.',
        }
      }

      const referenceId = payload.referenceId ?? null

      if (referenceId && this.entries.some((entry) => entry.referenceId === referenceId)) {
        return {
          success: true,
          entry: this.entries.find((entry) => entry.referenceId === referenceId),
          duplicated: true,
        }
      }

      const entry = {
        id: createCashEntryId(),
        type,
        amount,
        category: payload.category ?? (type === 'in' ? 'Kas Masuk' : 'Kas Keluar'),
        note: payload.note ?? '',
        referenceId,
        transactionId: payload.transactionId ?? null,
        createdAt: payload.createdAt ?? new Date().toISOString(),
      }

      this.entries.unshift(entry)

      return {
        success: true,
        entry,
        duplicated: false,
      }
    },
    recordOpeningBalance(amount, referenceId = null) {
      return this.recordEntry({
        type: 'in',
        amount,
        category: 'Saldo Awal',
        note: 'Saldo awal kas',
        referenceId: referenceId ? `opening-${referenceId}` : null,
      })
    },
    recordSalePayment(transaction) {
      if (`${transaction.paymentMethod ?? ''}`.toLowerCase() !== 'cash') {
        return {
          success: true,
          skipped: true,
        }
      }

      return this.recordEntry({
        type: 'in',
        amount: transaction.total,
        category: 'Penjualan Cash',
        note: transaction.invoiceNumber ?? transaction.id,
        referenceId: `sale-${transaction.id}`,
        transactionId: transaction.id ?? null,
        createdAt: transaction.createdAt,
      })
    },
  },
})
