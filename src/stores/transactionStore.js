import { defineStore } from 'pinia'

import { transactions } from '@/data/transactions'

export const useTransactionStore = defineStore('transaction', {
  state: () => ({
    items: transactions,
  }),
  actions: {
    addTransaction(transaction) {
      this.items = [transaction, ...this.items]
    },
  },
})
