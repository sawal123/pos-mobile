import { defineStore } from 'pinia'

function generateId(prefix = 'ing') {
  if (globalThis.crypto?.randomUUID) {
    return `${prefix}-${globalThis.crypto.randomUUID()}`
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`
}

export const useIngredientStore = defineStore('ingredient', {
  state: () => ({
    ingredients: [],
    recipes: {}, // { [productId]: [{ ingredientId, quantity }] }
    movements: [],
  }),

  getters: {
    activeIngredients: (state) =>
      state.ingredients.filter((i) => i.status !== 'deleted'),

    getIngredientById: (state) => (id) => {
      if (!id) return null
      const target = String(id).toLowerCase()
      return (
        state.ingredients.find(
          (i) =>
            i.status !== 'deleted' &&
            (String(i.id).toLowerCase() === target ||
              (i.syncId && String(i.syncId).toLowerCase() === target)),
        ) || null
      )
    },

    getRecipe: (state) => (productId) => {
      if (!productId) return []
      const target = String(productId).toLowerCase()
      const rawList =
        state.recipes[productId] ||
        state.recipes[target] ||
        []

      if (!Array.isArray(rawList)) return []

      return rawList.map((item) => {
        const ing = state.ingredients.find(
          (i) =>
            i.status !== 'deleted' &&
            (String(i.id).toLowerCase() === String(item.ingredientId).toLowerCase() ||
              (i.syncId && String(i.syncId).toLowerCase() === String(item.ingredientId).toLowerCase())),
        )
        const costPerUnit = Number(ing?.costPerUnit ?? item.costPerUnit ?? 0)
        const quantity = Number(item.quantity ?? 0)
        return {
          ingredientId: item.ingredientId,
          name: ing?.name ?? item.name ?? 'Bahan',
          unit: ing?.unit ?? item.unit ?? 'pcs',
          costPerUnit,
          quantity,
          subtotalCost: Math.round(costPerUnit * quantity),
        }
      })
    },

    calculateRecipeCost: () => (recipeItems) => {
      if (!Array.isArray(recipeItems)) return 0
      return recipeItems.reduce((sum, item) => {
        const cost = Number(item.costPerUnit ?? 0)
        const qty = Number(item.quantity ?? 0)
        return sum + Math.round(cost * qty)
      }, 0)
    },

    lowStockCount: (state) =>
      state.ingredients.filter(
        (i) => i.status !== 'deleted' && Number(i.minStock || 0) > 0 && Number(i.stock || 0) <= Number(i.minStock || 0),
      ).length,

    outOfStockCount: (state) =>
      state.ingredients.filter((i) => i.status !== 'deleted' && Number(i.stock || 0) <= 0).length,
  },

  actions: {
    setIngredients(list) {
      this.ingredients = Array.isArray(list) ? list : []
    },

    setRecipes(recipesMap) {
      this.recipes = recipesMap && typeof recipesMap === 'object' ? recipesMap : {}
    },

    setMovements(movementsList) {
      this.movements = Array.isArray(movementsList) ? movementsList : []
    },

    saveIngredient(payload) {
      const now = new Date().toISOString()
      const existing = payload.id ? this.getIngredientById(payload.id) : null

      const item = {
        id: existing?.id ?? payload.id ?? generateId('ing'),
        syncId: existing?.syncId ?? payload.syncId ?? null,
        name: (payload.name ?? '').trim(),
        unit: (payload.unit ?? 'gram').trim().toLowerCase(),
        costPerUnit: Math.max(0, Number(payload.costPerUnit ?? 0)),
        stock: Number(payload.stock ?? 0),
        minStock: Math.max(0, Number(payload.minStock ?? 0)),
        category: (payload.category ?? 'Bahan Baku').trim(),
        status: payload.status ?? 'active',
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      }

      const idx = this.ingredients.findIndex(
        (i) => String(i.id).toLowerCase() === String(item.id).toLowerCase(),
      )

      if (idx !== -1) {
        const previousStock = Number(this.ingredients[idx].stock ?? 0)
        this.ingredients[idx] = { ...this.ingredients[idx], ...item }

        // If stock changed directly in edit, record movement
        if (item.stock !== previousStock) {
          this.recordMovement({
            ingredientId: item.id,
            ingredientName: item.name,
            type: 'adjustment',
            quantityChange: item.stock - previousStock,
            stockBefore: previousStock,
            stockAfter: item.stock,
            category: 'Koreksi Stok',
            note: 'Penyesuaian stok saat edit bahan',
          })
        }
      } else {
        this.ingredients.push(item)
        if (item.stock > 0) {
          this.recordMovement({
            ingredientId: item.id,
            ingredientName: item.name,
            type: 'in',
            quantityChange: item.stock,
            stockBefore: 0,
            stockAfter: item.stock,
            category: 'Stok Awal',
            note: 'Input persediaan bahan baru',
          })
        }
      }

      return item
    },

    deleteIngredient(id) {
      const target = String(id).toLowerCase()
      const idx = this.ingredients.findIndex(
        (i) =>
          String(i.id).toLowerCase() === target ||
          (i.syncId && String(i.syncId).toLowerCase() === target),
      )
      if (idx !== -1) {
        this.ingredients[idx].status = 'deleted'
        this.ingredients[idx].updatedAt = new Date().toISOString()
      }
    },

    adjustStock(id, { quantityChange, type = 'adjustment', category = 'Adjustment', note = '', referenceId = null, transactionId = null }) {
      const ing = this.getIngredientById(id)
      if (!ing) return null

      const delta = Number(quantityChange || 0)
      const stockBefore = Number(ing.stock || 0)
      const stockAfter = Math.max(0, stockBefore + delta)

      ing.stock = stockAfter
      ing.updatedAt = new Date().toISOString()

      return this.recordMovement({
        ingredientId: ing.id,
        ingredientName: ing.name,
        type,
        quantityChange: delta,
        stockBefore,
        stockAfter,
        category,
        note,
        referenceId,
        transactionId,
      })
    },

    recordMovement(movement) {
      const entry = {
        id: generateId('mov-ing'),
        timestamp: new Date().toISOString(),
        ...movement,
      }
      this.movements.unshift(entry)
      if (this.movements.length > 500) {
        this.movements = this.movements.slice(0, 500)
      }
      return entry
    },

    setProductRecipe(productId, recipeItems) {
      if (!productId) return
      const target = String(productId).toLowerCase()
      const cleaned = (Array.isArray(recipeItems) ? recipeItems : [])
        .filter((r) => r.ingredientId && Number(r.quantity) > 0)
        .map((r) => ({
          ingredientId: r.ingredientId,
          quantity: Number(r.quantity),
          unit: r.unit ?? 'pcs',
          costPerUnit: Number(r.costPerUnit ?? 0),
        }))

      this.recipes[target] = cleaned
      this.recipes[productId] = cleaned
    },

    deleteProductRecipe(productId) {
      if (!productId) return
      delete this.recipes[productId]
      delete this.recipes[String(productId).toLowerCase()]
    },

    deductIngredientsForSale(saleItems, referenceId, transactionId = null) {
      if (!Array.isArray(saleItems)) return

      for (const item of saleItems) {
        const prodId = item.productId ?? item.id
        const itemQty = Number(item.qty ?? 1)
        if (itemQty <= 0) continue

        // 1. Deduct recipe ingredients for base product
        const recipe = this.getRecipe(prodId)
        for (const ing of recipe) {
          const needed = ing.quantity * itemQty
          this.adjustStock(ing.ingredientId, {
            quantityChange: -needed,
            type: 'sale',
            category: 'Penjualan (Resep)',
            note: `Resep ${item.name} (${needed} ${ing.unit})`,
            referenceId,
            transactionId,
          })
        }

        // 2. Deduct variant ingredients if any
        const variants =
          item.variants_snapshot ?? item.variantsSnapshot ?? item.selectedOptions ?? []
        if (Array.isArray(variants)) {
          for (const variant of variants) {
            const ingId =
              variant.ingredient_product_id ??
              variant.ingredientProductId ??
              variant.ingredient_product_sync_id ??
              variant.ingredientProductSyncId
            const ingQty = Number(variant.ingredient_quantity ?? variant.ingredientQuantity ?? 0)

            if (ingId && ingQty > 0) {
              const needed = ingQty * itemQty
              this.adjustStock(ingId, {
                quantityChange: -needed,
                type: 'sale',
                category: 'Penjualan (Varian)',
                note: `Varian ${variant.name} (${item.name})`,
                referenceId,
                transactionId,
              })
            }
          }
        }
      }
    },

    seedDefaultIngredientsIfEmpty() {
      if (this.ingredients.length > 0) return

      const defaults = [
        { name: 'Biji Kopi Espresso Blend', unit: 'gram', costPerUnit: 180, stock: 2000, minStock: 250, category: 'Kopi' },
        { name: 'Susu UHT Fresh Milk', unit: 'ml', costPerUnit: 22, stock: 5000, minStock: 1000, category: 'Dairy' },
        { name: 'Gula Aren Cair', unit: 'ml', costPerUnit: 35, stock: 2000, minStock: 300, category: 'Sirup & Pemanis' },
        { name: 'Paper Cup Hot 8oz', unit: 'pcs', costPerUnit: 600, stock: 150, minStock: 30, category: 'Kemasan' },
        { name: 'Plastic Cup Ice 16oz + Tutup', unit: 'pcs', costPerUnit: 750, stock: 200, minStock: 50, category: 'Kemasan' },
      ]

      for (const item of defaults) {
        this.saveIngredient(item)
      }
    },
  },
})
