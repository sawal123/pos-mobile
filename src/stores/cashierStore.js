import { defineStore } from 'pinia'

export const useCashierStore = defineStore('cashier', {
  state: () => ({
    activeCashier: {
      name: 'Kasir Utama',
      pinConfigured: false,
    },
  }),
  actions: {
    setPinConfigured(value) {
      this.activeCashier.pinConfigured = value
    },
  },
})
