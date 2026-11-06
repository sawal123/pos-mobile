import { defineStore } from 'pinia'
import { useCloudSessionStore } from './cloudSessionStore.js'

function isCashierRole() {
  try {
    const cloudStore = useCloudSessionStore()
    return cloudStore.role === 'cashier' || cloudStore.isCashierContext === true
  } catch {
    return false
  }
}

/**
 * Validates if a promo is currently active according to its date, weekday, and happy hour schedule.
 */
export function isPromoActive(promo, now = new Date()) {
  if (!promo || promo.status !== 'active') {
    return false
  }

  // 1. Date range check
  const startsAtRaw = promo.startsAt ?? promo.starts_at
  if (startsAtRaw) {
    const startsAt = new Date(startsAtRaw)
    if (now < startsAt) return false
  }
  const endsAtRaw = promo.endsAt ?? promo.ends_at
  if (endsAtRaw) {
    const endsAt = new Date(endsAtRaw)
    if (now > endsAt) return false
  }

  // 2. Weekday check (1 = Senin, 7 = Minggu)
  if (Array.isArray(promo.weekdays) && promo.weekdays.length > 0) {
    const jsDay = now.getDay()
    const currentWeekday = jsDay === 0 ? 7 : jsDay
    if (!promo.weekdays.includes(currentWeekday)) {
      return false
    }
  }

  // 3. Time range check (Happy Hour, HH:MM)
  const startTime = promo.startTime ?? promo.start_time
  const endTime = promo.endTime ?? promo.end_time
  if (startTime || endTime) {
    const hours = String(now.getHours()).padStart(2, '0')
    const minutes = String(now.getMinutes()).padStart(2, '0')
    const currentTimeStr = `${hours}:${minutes}`

    if (startTime && currentTimeStr < startTime) {
      return false
    }
    if (endTime && currentTimeStr > endTime) {
      return false
    }
  }

  return true
}

/**
 * Evaluates the eligible subtotal and calculated discount amount for a given cart.
 */
export function evaluatePromoDiscount(promo, cartItems = [], customer = null) {
  if (!promo || !Array.isArray(cartItems) || cartItems.length === 0) {
    return 0
  }

  // 1. Total cart subtotal
  const totalSubtotal = cartItems.reduce((sum, item) => {
    const price = Number(item.price ?? item.unitPrice ?? 0)
    const qty = Number(item.qty) || 0
    return sum + price * qty
  }, 0)

  // 2. Check minimum purchase
  const minPurchase = Number(promo.minPurchase ?? promo.min_purchase ?? 0)
  if (totalSubtotal < minPurchase) {
    return 0
  }

  // 3. Calculate eligible amount according to scope
  const scope = promo.scope ?? 'all'
  let eligibleAmount = 0
  let eligibleQuantity = 0

  if (scope === 'all') {
    eligibleAmount = totalSubtotal
    eligibleQuantity = cartItems.reduce((sum, item) => sum + (Number(item.qty) || 0), 0)
  } else if (scope === 'customer') {
    if (!customer) {
      return 0
    }

    const targets = Array.isArray(promo.targets) ? promo.targets : []
    const customerTargets = targets.filter(
      (t) => (t.target_type ?? t.targetType ?? t.type) === 'customer'
    )

    if (customerTargets.length > 0) {
      const targetCustomerIds = new Set(
        customerTargets.map((t) =>
          String(t.target_sync_id ?? t.targetSyncId ?? t.target_id ?? t.targetId ?? t.value ?? '').toLowerCase()
        )
      )

      const custId = String(customer.id ?? customer.syncId ?? customer.sync_id ?? '').toLowerCase()
      const custPhone = String(customer.phone ?? '').toLowerCase()
      const matches = (custId && targetCustomerIds.has(custId)) || (custPhone && targetCustomerIds.has(custPhone))

      if (!matches) {
        return 0
      }
    }

    eligibleAmount = totalSubtotal
    eligibleQuantity = cartItems.reduce((sum, item) => sum + (Number(item.qty) || 0), 0)
  } else if (scope === 'product' || scope === 'item') {
    const targets = Array.isArray(promo.targets) ? promo.targets : []
    const targetSyncIds = new Set(
      targets
        .filter((t) => (t.target_type ?? t.targetType) === 'product' || (t.target_type ?? t.targetType) === 'item')
        .map((t) => String(t.target_sync_id ?? t.targetSyncId ?? t.target_id ?? t.targetId).toLowerCase()),
    )

    const matchingItems = cartItems.filter((item) => {
      const id = String(item.id ?? '').toLowerCase()
      const prodId = String(item.productId ?? item.product_id ?? '').toLowerCase()
      const syncId = String(item.syncId ?? item.sync_id ?? '').toLowerCase()
      return targetSyncIds.has(id) || (prodId && targetSyncIds.has(prodId)) || (syncId && targetSyncIds.has(syncId))
    })

    eligibleAmount = matchingItems.reduce((sum, item) => {
      const price = Number(item.price ?? item.unitPrice ?? 0)
      const qty = Number(item.qty) || 0
      return sum + price * qty
    }, 0)
    eligibleQuantity = matchingItems.reduce((sum, item) => sum + (Number(item.qty) || 0), 0)
  } else if (scope === 'category') {
    const targets = Array.isArray(promo.targets) ? promo.targets : []
    const targetCategories = new Set(
      targets
        .filter((t) => (t.target_type ?? t.targetType) === 'category')
        .map((t) => String(t.target_sync_id ?? t.targetSyncId ?? t.target_id ?? t.targetId ?? t.name).toLowerCase()),
    )

    const matchingItems = cartItems.filter((item) => {
      const category = String(item.category ?? '').toLowerCase()
      return targetCategories.has(category)
    })

    eligibleAmount = matchingItems.reduce((sum, item) => {
      const price = Number(item.price ?? item.unitPrice ?? 0)
      const qty = Number(item.qty) || 0
      return sum + price * qty
    }, 0)
    eligibleQuantity = matchingItems.reduce((sum, item) => sum + (Number(item.qty) || 0), 0)
  }

  if (eligibleAmount <= 0) {
    return 0
  }

  // 4. Calculate discount based on discount_type
  const discountType = promo.discountType ?? promo.discount_type ?? promo.type
  const discountValue = Number(promo.discountValue ?? promo.discount_value ?? 0)
  let discount = 0

  if (discountType === 'percent') {
    // discountValue is in basis points (1000 = 10.00%, 10000 = 100%)
    discount = Math.round((eligibleAmount * discountValue) / 10000)
    const maxDiscount = promo.maxDiscount !== undefined && promo.maxDiscount !== null
      ? Number(promo.maxDiscount)
      : (promo.max_discount !== undefined && promo.max_discount !== null ? Number(promo.max_discount) : null)

    if (maxDiscount !== null && maxDiscount > 0) {
      discount = Math.min(discount, maxDiscount)
    }
  } else if (discountType === 'fixed') {
    discount = Math.min(eligibleAmount, discountValue)
  } else if (discountType === 'price_override') {
    // Override target unit price to discountValue for matching items
    const targetOverrideTotal = Math.round(eligibleQuantity * discountValue)
    discount = Math.max(0, eligibleAmount - targetOverrideTotal)
  }

  return Math.max(0, Math.round(discount))
}

function generatePromoSyncId() {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID()
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

export const usePromoStore = defineStore('promo', {
  state: () => ({
    promos: [],
    appliedPromoId: null,
  }),

  getters: {
    activePromos: (state) => {
      const now = new Date()
      return state.promos.filter((p) => isPromoActive(p, now))
    },
    appliedPromo: (state) => {
      if (!state.appliedPromoId) return null
      return (
        state.promos.find(
          (p) => String(p.id) === String(state.appliedPromoId) || String(p.syncId) === String(state.appliedPromoId),
        ) ?? null
      )
    },
  },

  actions: {
    setPromos(promosList) {
      this.promos = Array.isArray(promosList) ? promosList : []
    },

    createPromo(promoData) {
      if (isCashierRole()) {
        throw new Error('Kasir tidak diizinkan menambah promo.')
      }
      const syncId = generatePromoSyncId()
      const newPromo = {
        id: syncId,
        syncId,
        syncVersion: 1,
        name: String(promoData.name ?? '').trim(),
        code: promoData.code ? String(promoData.code).trim().toUpperCase() : null,
        discountType: promoData.discountType ?? 'fixed',
        discountValue: Number(promoData.discountValue ?? 0),
        scope: promoData.scope ?? 'all',
        minPurchase: Number(promoData.minPurchase ?? 0),
        maxDiscount:
          promoData.maxDiscount !== undefined &&
          promoData.maxDiscount !== null &&
          promoData.maxDiscount !== ''
            ? Number(promoData.maxDiscount)
            : null,
        weekdays: Array.isArray(promoData.weekdays) ? promoData.weekdays : null,
        startsAt: promoData.startsAt ?? null,
        endsAt: promoData.endsAt ?? null,
        startTime: promoData.startTime ?? null,
        endTime: promoData.endTime ?? null,
        isStackable: Boolean(promoData.isStackable),
        status: promoData.status ?? 'active',
        targets: Array.isArray(promoData.targets) ? promoData.targets : [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }
      this.upsertPromo(newPromo)
      return newPromo
    },

    togglePromoStatus(promoId) {
      if (isCashierRole()) {
        return null
      }
      const targetId = String(promoId)
      const index = this.promos.findIndex(
        (p) => String(p.id) === targetId || String(p.syncId) === targetId,
      )
      if (index >= 0) {
        const nextStatus = this.promos[index].status === 'active' ? 'inactive' : 'active'
        this.promos[index] = {
          ...this.promos[index],
          status: nextStatus,
          updatedAt: new Date().toISOString(),
        }
        if (nextStatus === 'inactive' && String(this.appliedPromoId) === targetId) {
          this.appliedPromoId = null
        }
        return nextStatus
      }
      return null
    },

    upsertPromo(promo) {
      if (!promo) return
      const promoId = String(promo.id ?? promo.syncId)
      const index = this.promos.findIndex(
        (p) => String(p.id) === promoId || String(p.syncId) === promoId,
      )

      if (index >= 0) {
        this.promos[index] = { ...this.promos[index], ...promo }
      } else {
        this.promos.push(promo)
      }
    },

    removePromo(promoId) {
      if (isCashierRole()) {
        return
      }
      const targetId = String(promoId)
      this.promos = this.promos.filter(
        (p) => String(p.id) !== targetId && String(p.syncId) !== targetId,
      )
      if (String(this.appliedPromoId) === targetId) {
        this.appliedPromoId = null
      }
    },

    applyPromo(promoOrId) {
      if (!promoOrId) {
        this.appliedPromoId = null
        return
      }

      const id = typeof promoOrId === 'object' ? (promoOrId.id ?? promoOrId.syncId) : promoOrId
      this.appliedPromoId = String(id)
    },

    clearAppliedPromo() {
      this.appliedPromoId = null
    },

    findPromoByCode(code) {
      if (!code || typeof code !== 'string') return null
      const cleanCode = code.trim().toUpperCase()
      const now = new Date()
      return (
        this.promos.find(
          (p) =>
            p.code &&
            p.code.trim().toUpperCase() === cleanCode &&
            isPromoActive(p, now),
        ) ?? null
      )
    },

    calculateDiscount(promo, cartItems, customer = null) {
      return evaluatePromoDiscount(promo, cartItems, customer)
    },
  },
})
