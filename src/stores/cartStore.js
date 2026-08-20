import { defineStore } from 'pinia'

export const useCartStore = defineStore('cart', {
  state: () => ({
    items: [],
  }),
  getters: {
    subtotal: (state) => state.items.reduce((sum, item) => sum + item.price * item.qty, 0),
    tax: (state) => Math.round(state.items.reduce((sum, item) => sum + item.price * item.qty, 0) * 0.11),
    total() {
      return this.subtotal + this.tax
    },
  },
  actions: {
    addItem(product) {
      const existingItem = this.items.find((item) => item.id === product.id)

      if (existingItem) {
        existingItem.qty += 1
        return
      }

      this.items.push({ ...product, qty: 1 })
    },
    increaseQty(id) {
      const item = this.items.find((entry) => entry.id === id)

      if (item) {
        item.qty += 1
      }
    },
    decreaseQty(id) {
      const item = this.items.find((entry) => entry.id === id)

      if (!item) {
        return
      }

      if (item.qty <= 1) {
        this.removeItem(id)
        return
      }

      item.qty -= 1
    },
    removeItem(id) {
      this.items = this.items.filter((item) => item.id !== id)
    },
    clearCart() {
      this.items = []
    },
  },
})
