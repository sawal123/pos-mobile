import { defineStore } from 'pinia'
import { useTaxStore } from '@/stores/taxStore'
import { usePromoStore } from '@/stores/promoStore'
import { useCustomerStore } from '@/stores/customerStore'
import { normalizeCustomerPhone } from '@/utils/customerPhone'

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
    customerPhone: '',
    customerId: null,
    appliedPromo: null,
    manualDiscountType: 'fixed', // 'fixed' | 'percent'
    manualDiscountValue: 0,
  }),
  getters: {
    customerPhoneMatch: (state) => useCustomerStore().lookupByPhone(state.customerPhone),
    selectedCustomer(state) {
      if (state.customerId === null) return this.customerPhoneMatch.customer
      const customer = useCustomerStore().getCustomerById(state.customerId)
      return customer &&
        normalizeCustomerPhone(customer.phone) === normalizeCustomerPhone(state.customerPhone)
        ? customer
        : null
    },
    subtotal: (state) => state.items.reduce((sum, item) => sum + itemPrice(item) * itemQuantity(item), 0),
    discount(state) {
      if (state.appliedPromo) {
        const promoStore = usePromoStore()
        return promoStore.calculateDiscount(state.appliedPromo, state.items)
      }

      const rawValue = Number(state.manualDiscountValue) || 0
      if (rawValue <= 0 || this.subtotal <= 0) {
        return 0
      }

      if (state.manualDiscountType === 'percent') {
        const clampedPercent = Math.min(100, Math.max(0, rawValue))
        return Math.min(this.subtotal, Math.round((this.subtotal * clampedPercent) / 100))
      }

      return Math.min(this.subtotal, Math.round(Math.max(0, rawValue)))
    },
    discountLabel(state) {
      if (state.appliedPromo?.name) {
        return state.appliedPromo.name
      }
      const rawValue = Number(state.manualDiscountValue) || 0
      if (rawValue > 0) {
        return state.manualDiscountType === 'percent'
          ? `Diskon ${Math.min(100, rawValue)}%`
          : 'Diskon Manual'
      }
      return ''
    },
    taxableSubtotal() {
      return Math.max(0, this.subtotal - this.discount)
    },
    tax() {
      const taxStore = useTaxStore()
      return Math.round(this.taxableSubtotal * taxStore.effectiveRate / 100)
    },
    total() {
      return this.taxableSubtotal + this.tax
    },
  },
  actions: {
    setCustomerPhone(phone) {
      this.customerId = null
      this.customerPhone = String(phone ?? '')
    },
    selectCustomer(customer) {
      const stored = useCustomerStore().getCustomerById(customer?.id)
      this.customerId = stored?.id ?? null
      this.customerPhone = stored?.phone ?? ''
    },
    clearCustomer() {
      this.customerPhone = ''
      this.customerId = null
    },
    applyPromo(promo) {
      this.appliedPromo = promo ?? null
      if (promo) {
        this.manualDiscountValue = 0
      }
    },
    setManualDiscount({ type = 'fixed', value = 0 } = {}) {
      const normalizedType = type === 'percent' ? 'percent' : 'fixed'
      const numeric = Number(value)
      const cleanValue = Number.isFinite(numeric) && numeric > 0
        ? (normalizedType === 'percent' ? Math.min(100, numeric) : Math.round(numeric))
        : 0

      this.appliedPromo = null
      this.manualDiscountType = normalizedType
      this.manualDiscountValue = cleanValue
    },
    removePromo() {
      this.appliedPromo = null
      this.manualDiscountValue = 0
    },
    clearDiscount() {
      this.removePromo()
    },
    addItem(product, selectedOptions = []) {
      const optionsArray = Array.isArray(selectedOptions) ? selectedOptions : []
      const variantPriceAdj = optionsArray.reduce(
        (sum, opt) => sum + (Number(opt.priceAdjustment ?? opt.price_adjustment) || 0),
        0,
      )
      const variantCostAdj = optionsArray.reduce(
        (sum, opt) => sum + (Number(opt.costAdjustment ?? opt.cost_adjustment) || 0),
        0,
      )

      const variantKey = optionsArray
        .map((opt) => String(opt.id ?? opt.syncId ?? opt.name))
        .sort()
        .join('-')

      const lineId = variantKey ? `${product.id}::${variantKey}` : product.id

      const existingItem = this.items.find(
        (item) => item.id === lineId || String(item.id) === String(lineId),
      )
      const nextQty = (existingItem?.qty ?? 0) + 1

      if (existingItem) {
        existingItem.qty = nextQty
        return true
      }

      const summaryParts = optionsArray.map((opt) => {
        const adj = Number(opt.priceAdjustment ?? opt.price_adjustment) || 0
        if (adj > 0) {
          return `${opt.name} (+Rp ${adj.toLocaleString('id-ID')})`
        } else if (adj < 0) {
          return `${opt.name} (-Rp ${Math.abs(adj).toLocaleString('id-ID')})`
        }
        return opt.name
      })
      const variantSummary = summaryParts.join(', ')

      const variantsSnapshot = optionsArray.map((opt) => ({
        id: opt.id ?? opt.syncId,
        sync_id: opt.syncId ?? opt.sync_id ?? opt.id,
        name: opt.name,
        price_adjustment: Number(opt.priceAdjustment ?? opt.price_adjustment ?? 0),
        cost_adjustment: Number(opt.costAdjustment ?? opt.cost_adjustment ?? 0),
        ingredient_product_id: opt.ingredientProductId ?? opt.ingredient_product_id ?? null,
        ingredient_product_sync_id: opt.ingredientProductSyncId ?? opt.ingredient_product_sync_id ?? null,
        ingredient_quantity: Number(opt.ingredientQuantity ?? opt.ingredient_quantity ?? 0),
      }))

      const basePrice = Number(product.price ?? product.unitPrice) || 0
      const baseCost = Number(product.cost) || 0
      const finalPrice = Math.max(0, basePrice + variantPriceAdj)
      const finalCost = Math.max(0, baseCost + variantCostAdj)

      this.items.push({
        ...product,
        id: lineId,
        productId: product.id,
        price: finalPrice,
        unitPrice: finalPrice,
        costSnapshot: finalCost,
        hppSnapshot: finalCost,
        selectedOptions: optionsArray,
        variant_summary: variantSummary,
        variantSummary,
        variants_snapshot: variantsSnapshot,
        variantsSnapshot,
        qty: Number(product.minQuantity) > 0 ? Number(product.minQuantity) : 1,
      })

      return true
    },
    increaseQty(id) {
      const item = this.items.find((entry) => entry.id === id || String(entry.id) === String(id))

      if (item) {
        item.qty += 1
      }
    },
    decreaseQty(id) {
      const item = this.items.find((entry) => entry.id === id || String(entry.id) === String(id))

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
      const item = this.items.find((entry) => entry.id === id || String(entry.id) === String(id))

      if (!item) {
        return
      }

      const nextQuantity = normalizeQuantity(quantity, item)

      if (nextQuantity <= 0) {
        this.removeItem(id)
        return
      }

      item.qty = nextQuantity
    },
    removeItem(id) {
      this.items = this.items.filter((item) => item.id !== id && String(item.id) !== String(id))
      if (!this.items.length) this.clearCustomer()
    },
    clearCart() {
      this.items = []
      this.clearCustomer()
      this.appliedPromo = null
      this.manualDiscountType = 'fixed'
      this.manualDiscountValue = 0
    },
  },
})
