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

function normalizeTransactionItem(item) {
  const qty = Number(item.qty) || 0
  const price = Number(item.price ?? item.unitPrice) || 0
  const hppSnapshot = Number(item.hppSnapshot ?? item.costSnapshot ?? item.cost) || 0

  return {
    ...item,
    qty,
    price,
    unitPrice: price,
    hppSnapshot,
    costSnapshot: hppSnapshot,
    unit: item.unit ?? item.pricingUnit ?? 'pcs',
    kind: item.kind ?? 'product',
    pricingUnit: item.pricingUnit ?? item.unit ?? 'pcs',
    lineSubtotal: price * qty,
    lineCost: hppSnapshot * qty,
  }
}

function calculateGrossProfit(items) {
  return items.reduce((sum, item) => sum + ((item.price * item.qty) - (item.hppSnapshot * item.qty)), 0)
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
      const items = payload.items.map(normalizeTransactionItem)
      const transaction = {
        id: createTransactionId(),
        invoiceNumber: createInvoiceNumber(),
        customer: payload.customer ?? 'Walk-in Customer',
        customerId: payload.customerId ?? null,
        customerSnapshot: payload.customerSnapshot ? { ...payload.customerSnapshot } : null,
        businessSnapshot: payload.businessSnapshot ? { ...payload.businessSnapshot } : null,
        status: 'paid',
        orderStatus: payload.orderStatus ?? null,
        items,
        itemCount: items.reduce((count, item) => count + item.qty, 0),
        subtotal: payload.subtotal,
        tax: payload.tax,
        total: payload.total,
        grossProfit: calculateGrossProfit(items),
        paymentMethod: payload.paymentMethod,
        cashReceived: payload.cashReceived ?? null,
        changeAmount: payload.changeAmount ?? null,
        createdAt: new Date().toISOString(),
      }

      return this.addTransaction(transaction)
    },
    updateOrderStatus(id, status) {
      const allowedStatuses = ['Masuk', 'Diproses', 'Siap Diambil', 'Selesai']
      const transaction = this.items.find((item) => item.id === id)

      if (!transaction || !allowedStatuses.includes(status)) {
        return false
      }

      transaction.orderStatus = status

      if (this.lastTransaction?.id === id) {
        this.lastTransaction = transaction
      }

      return true
    },
    clearLastTransaction() {
      this.lastTransaction = null
    },
  },
})
