import { defineStore } from 'pinia'

export const useCashierStore = defineStore('cashier', {
  state: () => ({
    activeCashier: {
      name: 'Kasir Utama',
      pin: '123456',
      pinConfigured: false,
    },
  }),
  actions: {
    setPin(pin) {
      this.activeCashier.pin = String(pin).trim()
      this.activeCashier.pinConfigured = true
    },
    setPinConfigured(value) {
      this.activeCashier.pinConfigured = value
    },
    verifyPin(inputPin) {
      const clean = String(inputPin ?? '').trim()
      if (!this.activeCashier?.pin) {
        return clean === '123456' || clean.length === 6
      }
      return clean === String(this.activeCashier.pin).trim()
    },
  },
})
