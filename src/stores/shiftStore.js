import { defineStore } from 'pinia'

export const useShiftStore = defineStore('shift', {
  state: () => ({
    isOpen: false,
    openingBalance: 0,
    openedAt: null,
  }),
  actions: {
    openShift(balance) {
      this.isOpen = true
      this.openingBalance = Number(balance) || 0
      this.openedAt = new Date().toISOString()
    },
    closeShift() {
      this.isOpen = false
    },
  },
})
