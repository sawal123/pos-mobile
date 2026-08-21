import { defineStore } from 'pinia'

import { transactions } from '@/data/transactions'

function createTransactionId() {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID()
  }

  return `trx-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

function createInvoiceNumber() {
  const timestamp = new Date().toISOString().replace(/\D/g, '').slice(0, 14)
  return `INV-${timestamp}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`
}

export const useTransactionStore = defineStore('transaction', {
  state: () => ({
    items: transactions,
    lastTransaction: null,
  }),
  actions: {
    addTransaction(transaction) {
      this.items = [transaction, ...this.items]
      this.lastTransaction = transaction
      return transaction
    },
    createTransaction(payload) {
      const transaction = {
        id: createTransactionId(),
        invoiceNumber: createInvoiceNumber(),
        customer: payload.customer ?? 'Walk-in Customer',
        customerId: payload.customerId ?? null,
        customerSnapshot: payload.customerSnapshot ? { ...payload.customerSnapshot } : null,
        businessSnapshot: payload.businessSnapshot ? { ...payload.businessSnapshot } : null,
        status: 'paid',
        items: payload.items.map((item) => ({ ...item })),
        itemCount: payload.items.reduce((count, item) => count + item.qty, 0),
        subtotal: payload.subtotal,
        tax: payload.tax,
        total: payload.total,
        paymentMethod: payload.paymentMethod,
        cashReceived: payload.cashReceived ?? null,
        changeAmount: payload.changeAmount ?? null,
        createdAt: new Date().toISOString(),
      }

      return this.addTransaction(transaction)
    },
    clearLastTransaction() {
      this.lastTransaction = null
    },
  },
})
