import { defineStore } from 'pinia'

function itemPrice(item) {
  return Number(item.price ?? item.unitPrice) || 0
}

function itemQuantity(item) {
  return Number(item.qty) || 0
}

function normalizeQuantity(value, item) {
  const quantity = Number(value)

  if (!Number.isFinite(quantity) || quantity <= 0) {
    return 0
  }

  if ((item.kind ?? 'product') === 'service' && item.pricingUnit === 'kg') {
    return Math.round(quantity * 100) / 100
  }

  return Math.floor(quantity)
}

export const useCartStore = defineStore('cart', {
  state: () => ({
    items: [],
  }),
  getters: {
    subtotal: (state) => state.items.reduce((sum, item) => sum + itemPrice(item) * itemQuantity(item), 0),
    tax: (state) => Math.round(state.items.reduce((sum, item) => sum + itemPrice(item) * itemQuantity(item), 0) * 0.11),
    total() {
      return this.subtotal + this.tax
    },
  },
  actions: {
    addItem(product) {
      const existingItem = this.items.find((item) => item.id === product.id)
      const nextQty = (existingItem?.qty ?? 0) + 1

      if ((product.kind ?? 'product') !== 'service' && nextQty > Number(product.stock ?? 0)) {
        return false
      }

      if (existingItem) {
        existingItem.qty = nextQty
        return true
      }

      this.items.push({
        ...product,
        price: Number(product.price ?? product.unitPrice) || 0,
        unitPrice: Number(product.price ?? product.unitPrice) || 0,
        costSnapshot: Number(product.cost ?? 0) || 0,
        hppSnapshot: Number(product.cost ?? 0) || 0,
        qty: Number(product.minQuantity) > 0 ? Number(product.minQuantity) : 1,
      })

      return true
    },
    increaseQty(id) {
      const item = this.items.find((entry) => entry.id === id)

      if (item) {
        if ((item.kind ?? 'product') !== 'service' && item.qty + 1 > Number(item.stock ?? 0)) {
          return
        }

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
    updateQty(id, quantity) {
      const item = this.items.find((entry) => entry.id === id)

      if (!item) {
        return
      }

      const nextQuantity = normalizeQuantity(quantity, item)

      if (nextQuantity <= 0) {
        this.removeItem(id)
        return
      }

      if ((item.kind ?? 'product') !== 'service' && nextQuantity > Number(item.stock ?? 0)) {
        item.qty = Number(item.stock ?? 0)
        return
      }

      item.qty = nextQuantity
    },
    removeItem(id) {
      this.items = this.items.filter((item) => item.id !== id)
    },
    clearCart() {
      this.items = []
    },
  },
})
