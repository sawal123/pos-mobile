import { defineStore } from 'pinia'

export const useShiftStore = defineStore('shift', {
  state: () => ({
    isOpen: false,
    openingBalance: 0,
    openedAt: null,
    id: null,
    shiftNumber: null,
    status: null,
    closingBalance: null,
    closedAt: null,
    notes: '',
  }),
  actions: {
    openShift(balance) {
      if (this.isOpen) {
        return false
      }

      const now = new Date().toISOString()

      this.id = globalThis.crypto?.randomUUID
        ? globalThis.crypto.randomUUID()
        : `shift-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`

      this.isOpen = true
      this.openingBalance = Number(balance) || 0
      this.openedAt = now
      this.status = 'open'
      this.closingBalance = null
      this.closedAt = null

      return this.id
    },
    closeShift() {
      this.isOpen = false
      this.status = 'closed'
      this.closedAt = new Date().toISOString()
    },
    setShiftSnapshot(snapshot) {
      if (!snapshot || typeof snapshot !== 'object') {
        return
      }

      if (snapshot.id !== undefined) this.id = snapshot.id
      if (snapshot.shiftNumber !== undefined) this.shiftNumber = snapshot.shiftNumber
      if (snapshot.status !== undefined) this.status = snapshot.status
      if (snapshot.openingBalance !== undefined) this.openingBalance = snapshot.openingBalance
      if (snapshot.openedAt !== undefined) this.openedAt = snapshot.openedAt
      if (snapshot.closingBalance !== undefined) this.closingBalance = snapshot.closingBalance
      if (snapshot.closedAt !== undefined) this.closedAt = snapshot.closedAt
      if (snapshot.notes !== undefined) this.notes = snapshot.notes
      if (snapshot.isOpen !== undefined) this.isOpen = snapshot.isOpen
    },
  },
})
