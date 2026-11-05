import { defineStore } from 'pinia'

import { useBusinessStore } from '@/stores/businessStore'
import { useCloudSessionStore } from '@/stores/cloudSessionStore'
import {
  canManageProductCodes,
  findProductCodeConflict,
  generateProductCode,
  isValidProductCode,
  normalizeProductCode,
  resolveProductCode,
} from '@/services/products/productCodeService'

import { getBusinessTemplate } from '@/data/businessTemplates'

const DEFAULT_FILTER_CATEGORY = 'Semua'
const DEFAULT_FILTER_CATEGORY_KEY = DEFAULT_FILTER_CATEGORY.toLowerCase()

function normalizeNumber(value, fallback = 0) {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

function normalizeProduct(product) {
  const kind = product.kind ?? (product.pricingUnit ? 'service' : 'product')
  const price = normalizeNumber(product.price ?? product.unitPrice)
  const isSellable =
    product.isSellable !== undefined
      ? Boolean(product.isSellable)
      : product.is_sellable !== undefined
        ? Boolean(product.is_sellable)
        : true

  return {
    ...product,
    kind,
    sku: product.sku ?? '',
    barcode: normalizeProductCode(product.barcode),
    cost: normalizeNumber(product.cost ?? product.hpp ?? product.estimatedCost),
    price,
    unitPrice: price,
    stock: normalizeNumber(product.stock),
    unit: product.unit ?? (kind === 'service' ? (product.pricingUnit ?? 'kg') : 'pcs'),
    minStock: normalizeNumber(product.minStock ?? product.minimumStock),
    pricingUnit: product.pricingUnit ?? (kind === 'service' ? 'kg' : 'pcs'),
    minQuantity: normalizeNumber(product.minQuantity),
    estimatedDuration: product.estimatedDuration ?? '',
    imageData: typeof product.imageData === 'string' ? product.imageData : '',
    isSellable,
    isActive: product.isActive ?? true,
  }
}

function buildInitialCategories(categories, items) {
  return [...new Set([...categories, ...items.map((product) => product.category).filter(Boolean)])]
}

function buildTemplateState(type) {
  const template = getBusinessTemplate(type)
  const normalizedProducts = template.products.map(normalizeProduct)

  return {
    products: normalizedProducts,
    categories: buildInitialCategories(template.categories, normalizedProducts),
  }
}

function normalizeStockMovement(movement) {
  const transactionId = movement.transactionId ?? movement.transaction_id ?? null

  return {
    id: movement.id ?? generateProductId(),
    productId: movement.productId,
    productName: movement.productName ?? '',
    type: movement.type ?? 'adjustment',
    movementType: movement.movementType ?? movement.type ?? 'adjustment',
    quantityChange: normalizeNumber(movement.quantityChange),
    stockBefore: normalizeNumber(movement.stockBefore),
    stockAfter: normalizeNumber(movement.stockAfter),
    referenceId: movement.referenceId ?? null,
    transactionId,
    category: movement.category ?? 'Adjustment',
    note: movement.note ?? '',
    createdAt: movement.createdAt ?? new Date().toISOString(),
  }
}

function recordMovement(movements, movement) {
  movements.unshift(normalizeStockMovement(movement))

  return movements[0]
}

function normalizeName(value) {
  return value.trim()
}

function normalizeCategoryKey(value) {
  return value.trim().toLowerCase()
}

function isBlankValue(value) {
  return value == null || (typeof value === 'string' && !value.trim())
}

function generateProductId() {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID()
  }

  return `product-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function validateProductInput(payload, categories) {
  const errors = {}
  const kind = payload.kind === 'service' ? 'service' : 'product'
  const name = normalizeName(payload.name ?? '')
  const category = normalizeName(payload.category ?? '')
  const price = isBlankValue(payload.price ?? payload.unitPrice)
    ? Number.NaN
    : Number(payload.price ?? payload.unitPrice)
  const cost = isBlankValue(payload.cost ?? payload.hpp) ? 0 : Number(payload.cost ?? payload.hpp)
  const stock =
    kind === 'service' ? 0 : isBlankValue(payload.stock) ? Number.NaN : Number(payload.stock)
  const minStock = isBlankValue(payload.minStock) ? 0 : Number(payload.minStock)
  const minQuantity = isBlankValue(payload.minQuantity) ? 0 : Number(payload.minQuantity)
  const unit = normalizeName(payload.unit ?? 'pcs')
  const pricingUnit = normalizeName(payload.pricingUnit ?? 'kg')
  const isSellable =
    payload.isSellable !== undefined
      ? Boolean(payload.isSellable)
      : payload.is_sellable !== undefined
        ? Boolean(payload.is_sellable)
        : true

  if (!name) {
    errors.name = 'Nama produk wajib diisi.'
  }

  if (!category) {
    errors.category = 'Kategori wajib dipilih.'
  } else if (normalizeCategoryKey(category) === DEFAULT_FILTER_CATEGORY_KEY) {
    errors.category = 'Kategori produk tidak valid.'
  } else if (!categories.includes(category)) {
    errors.category = 'Kategori tidak ditemukan.'
  }

  if (Number.isNaN(price) || price < 0) {
    errors.price =
      kind === 'service'
        ? 'Harga per unit harus berupa angka dan minimal 0.'
        : 'Harga jual harus berupa angka dan minimal 0.'
  }

  if (Number.isNaN(cost) || cost < 0) {
    errors.cost =
      kind === 'service'
        ? 'Estimasi HPP/unit harus berupa angka dan minimal 0.'
        : 'HPP harus berupa angka dan minimal 0.'
  }

  if (Number.isNaN(stock) || stock < 0) {
    errors.stock = 'Stok harus berupa angka dan minimal 0.'
  }

  if (Number.isNaN(minStock) || minStock < 0) {
    errors.minStock = 'Stok minimum harus berupa angka dan minimal 0.'
  }

  if (!unit) {
    errors.unit = 'Satuan wajib diisi.'
  }

  if (kind === 'service' && !['kg', 'pcs'].includes(pricingUnit)) {
    errors.pricingUnit = 'Pricing unit harus kg atau pcs.'
  }

  if (kind === 'service' && (Number.isNaN(minQuantity) || minQuantity < 0)) {
    errors.minQuantity = 'Minimum quantity harus berupa angka dan minimal 0.'
  }

  return {
    errors,
    isValid: Object.keys(errors).length === 0,
    values: {
      kind,
      name,
      category,
      sku: normalizeProductCode(payload.sku ?? ''),
      barcode: normalizeProductCode(payload.barcode ?? ''),
      cost: Number.isNaN(cost) ? 0 : cost,
      price: Number.isNaN(price) ? 0 : price,
      unitPrice: Number.isNaN(price) ? 0 : price,
      stock: Number.isNaN(stock) ? 0 : stock,
      unit,
      minStock: Number.isNaN(minStock) ? 0 : minStock,
      pricingUnit,
      minQuantity: Number.isNaN(minQuantity) ? 0 : minQuantity,
      estimatedDuration: normalizeName(payload.estimatedDuration ?? ''),
      imageData: typeof payload.imageData === 'string' ? payload.imageData : '',
      isSellable,
      isActive: payload.isActive ?? true,
    },
  }
}

function prepareProductCode(payload, products, existing = null) {
  const cloud = useCloudSessionStore()
  const retail = useBusinessStore().normalizedType === 'Grosir / Toko Kelontong'
  const permitted = canManageProductCodes(cloud)
  const next = {
    ...payload,
    barcode: payload.barcode === undefined ? (existing?.barcode ?? '') : payload.barcode,
  }
  const errors = {}
  if (!isValidProductCode(next.barcode, { allowEmpty: true })) {
    errors.barcode = 'Kode harus berupa teks maksimal 255 karakter tanpa karakter kontrol.'
    return { payload: next, errors }
  }
  next.barcode = normalizeProductCode(next.barcode)
  if (
    retail &&
    permitted &&
    !next.barcode &&
    (payload.kind ?? existing?.kind) !== 'service' &&
    (payload.isSellable ?? payload.is_sellable ?? existing?.isSellable ?? existing?.is_sellable) !==
      false
  ) {
    try {
      next.barcode = generateProductCode(products)
    } catch (error) {
      errors.barcode = error.message
    }
  }
  if (
    (next.barcode !== (existing?.barcode ?? '') ||
      normalizeProductCode(next.sku) !== (existing?.sku ?? '')) &&
    !permitted
  ) {
    errors[next.barcode !== (existing?.barcode ?? '') ? 'barcode' : 'sku'] =
      'Hanya pengelola katalog yang dapat membuat atau mengubah kode produk Cloud.'
  }
  if (
    !existing ||
    next.barcode !== (existing.barcode ?? '') ||
    normalizeProductCode(next.sku) !== (existing.sku ?? '')
  ) {
    const conflict = findProductCodeConflict(products, next, existing?.id ?? null)
    if (conflict) {
      const field =
        next.barcode &&
        [conflict.sku, conflict.barcode].map(normalizeProductCode).includes(next.barcode)
          ? 'barcode'
          : 'sku'
      errors[field] = 'Kode barcode atau SKU sudah digunakan produk lain.'
    }
  }
  return { payload: next, errors }
}

function validateCategoryName(name, categories, currentName = null) {
  const trimmedName = normalizeName(name ?? '')

  if (!trimmedName) {
    return {
      isValid: false,
      error: 'Nama kategori wajib diisi.',
      value: trimmedName,
    }
  }

  if (normalizeCategoryKey(trimmedName) === DEFAULT_FILTER_CATEGORY_KEY) {
    return {
      isValid: false,
      error: 'Nama kategori tidak valid.',
      value: trimmedName,
    }
  }

  const currentKey = currentName ? normalizeCategoryKey(currentName) : null
  const duplicate = categories.some((category) => {
    const categoryKey = normalizeCategoryKey(category)

    if (currentKey && categoryKey === currentKey) {
      return false
    }

    return categoryKey === normalizeCategoryKey(trimmedName)
  })

  if (duplicate) {
    return {
      isValid: false,
      error: 'Nama kategori sudah digunakan.',
      value: trimmedName,
    }
  }

  return {
    isValid: true,
    error: '',
    value: trimmedName,
  }
}

export const useProductStore = defineStore('product', {
  state: () => {
    const initialCatalog = buildTemplateState('Cafe / UMKM')

    return {
      products: initialCatalog.products,
      categories: initialCatalog.categories,
      stockMovements: [],
      selectedCategory: DEFAULT_FILTER_CATEGORY,
      searchQuery: '',
    }
  },
  getters: {
    filterCategories(state) {
      return [DEFAULT_FILTER_CATEGORY, ...state.categories]
    },
    filteredProducts() {
      let list = this.products.filter((product) => {
        if (!product.isActive) return false
        const sellable = product.isSellable !== undefined ? product.isSellable : product.is_sellable
        return sellable === undefined || sellable === true || sellable === 1 || sellable === '1'
      })

      if (this.selectedCategory !== DEFAULT_FILTER_CATEGORY) {
        list = list.filter((product) => product.category === this.selectedCategory)
      }

      if (this.searchQuery) {
        const query = this.searchQuery.toLowerCase()
        list = list.filter((product) => product.name.toLowerCase().includes(query))
      }

      return list
    },
    lowStockProducts(state) {
      return state.products.filter(
        (product) =>
          (product.kind ?? 'product') !== 'service' &&
          product.isActive &&
          Number(product.minStock ?? 0) > 0 &&
          Number(product.stock ?? 0) <= Number(product.minStock ?? 0),
      )
    },
  },
  actions: {
    selectCategory(category) {
      this.selectedCategory = this.filterCategories.includes(category)
        ? category
        : DEFAULT_FILTER_CATEGORY
    },
    applyBusinessTemplate(type) {
      const nextCatalog = buildTemplateState(type)

      this.products = nextCatalog.products
      this.categories = nextCatalog.categories
      this.stockMovements = []
      this.selectedCategory = DEFAULT_FILTER_CATEGORY
    },
    setSearchQuery(query) {
      this.searchQuery = query
    },
    getProductById(id) {
      return this.products.find((product) => String(product.id) === String(id)) ?? null
    },
    createProduct(payload) {
      const prepared = prepareProductCode(payload, this.products)
      const validation = validateProductInput(prepared.payload, this.categories)
      const errors = { ...validation.errors, ...prepared.errors }
      const values = validation.values
      const isValid = Object.keys(errors).length === 0

      if (!isValid) {
        return {
          success: false,
          errors,
        }
      }

      const product = {
        id: generateProductId(),
        ...values,
      }

      this.products.push(product)

      return {
        success: true,
        product,
        errors: {},
      }
    },
    updateProduct(id, payload) {
      const existingProduct = this.getProductById(id)

      if (!existingProduct) {
        return {
          success: false,
          errors: {
            form: 'Produk tidak ditemukan.',
          },
        }
      }

      const prepared = prepareProductCode(payload, this.products, existingProduct)
      const validation = validateProductInput(prepared.payload, this.categories)
      const errors = { ...validation.errors, ...prepared.errors }
      const values = validation.values
      const isValid = Object.keys(errors).length === 0

      if (!isValid) {
        return {
          success: false,
          errors,
        }
      }

      const previousStock = normalizeNumber(existingProduct.stock)

      existingProduct.name = values.name
      existingProduct.category = values.category
      existingProduct.kind = values.kind
      existingProduct.sku = values.sku
      existingProduct.barcode = values.barcode
      existingProduct.cost = values.cost
      existingProduct.price = values.price
      existingProduct.unitPrice = values.unitPrice
      existingProduct.stock = values.stock
      existingProduct.unit = values.unit
      existingProduct.minStock = values.minStock
      existingProduct.pricingUnit = values.pricingUnit
      existingProduct.minQuantity = values.minQuantity
      existingProduct.estimatedDuration = values.estimatedDuration
      existingProduct.imageData =
        payload.imageData === undefined ? existingProduct.imageData : values.imageData
      existingProduct.isActive = values.isActive

      // Stock is authoritative: any stock change outside Adjust Stok still
      // records a stock movement so history is never changed silently. The
      // movement funnels through the same canonical path as adjustStock so
      // the sync tracker emits exactly one movement per stock change.
      let recordedMovement = null
      if (values.kind !== 'service' && values.stock !== previousStock) {
        recordedMovement = recordMovement(this.stockMovements, {
          productId: existingProduct.id,
          productName: existingProduct.name,
          type: 'adjustment',
          quantityChange: values.stock - previousStock,
          stockBefore: previousStock,
          stockAfter: values.stock,
          referenceId: null,
          category: 'Adjustment',
          note: 'Perubahan stok dari edit produk',
        })
      }

      return {
        success: true,
        product: existingProduct,
        errors: {},
        movement: recordedMovement,
      }
    },
    resolveScanCode(code) {
      return resolveProductCode(this.products, code)
    },
    ensureProductBarcode(id) {
      const product = this.getProductById(id)
      if (!product) return { success: false, errors: { form: 'Produk tidak ditemukan.' } }
      if (
        useBusinessStore().normalizedType !== 'Grosir / Toko Kelontong' ||
        product.kind === 'service' ||
        product.isSellable === false ||
        product.is_sellable === false
      ) {
        return {
          success: false,
          errors: { form: 'QR produk hanya tersedia untuk barang jual grosir.' },
        }
      }
      if (product.barcode) return { success: true, product }
      if (!canManageProductCodes(useCloudSessionStore())) {
        return { success: false, errors: { form: 'Minta pengelola katalog membuat kode produk.' } }
      }
      return this.updateProduct(id, { ...product, barcode: '' })
    },
    toggleProductActive(id) {
      const product = this.getProductById(id)

      if (!product) {
        return false
      }

      product.isActive = !product.isActive
      return true
    },
    deleteProduct(id) {
      const currentLength = this.products.length
      this.products = this.products.filter((product) => String(product.id) !== String(id))

      return this.products.length !== currentLength
    },
    canFulfillSale(items) {
      for (const item of items) {
        const product = this.getProductById(item.id)

        if (!product) {
          return {
            success: false,
            error: `${item.name ?? 'Item'} tidak ditemukan atau sudah dihapus.`,
            product: null,
          }
        }

        if (product.isActive === false) {
          return {
            success: false,
            error: `${product.name} sedang tidak aktif dan tidak dapat dijual.`,
            product,
          }
        }

        const quantity = Number(item.qty ?? item.quantity)

        if (!Number.isFinite(quantity) || quantity <= 0) {
          return {
            success: false,
            error: `Kuantitas ${product.name} tidak valid.`,
            product,
          }
        }
      }

      return {
        success: true,
        error: '',
      }
    },
    adjustStock(id, payload = {}) {
      const product = this.getProductById(id)

      if (!product) {
        return {
          success: false,
          error: 'Produk tidak ditemukan.',
        }
      }

      if ((product.kind ?? 'product') === 'service') {
        return {
          success: false,
          error: 'Layanan tidak memakai stok.',
        }
      }

      const quantityChange = Number(payload.quantityChange)

      if (!Number.isFinite(quantityChange) || quantityChange === 0) {
        return {
          success: false,
          error: 'Perubahan stok harus berupa angka selain 0.',
        }
      }

      const stockBefore = normalizeNumber(product.stock)
      const stockAfter = stockBefore + quantityChange

      product.stock = stockAfter
      const movement = recordMovement(this.stockMovements, {
        productId: product.id,
        productName: product.name,
        type: payload.type ?? 'adjustment',
        quantityChange,
        stockBefore,
        stockAfter,
        referenceId: payload.referenceId ?? null,
        transactionId: payload.transactionId ?? null,
        category: payload.category ?? 'Adjustment',
        note: payload.note ?? '',
        createdAt: payload.createdAt ?? new Date().toISOString(),
      })

      return {
        success: true,
        product,
        movement,
      }
    },
    recordSaleStock(items, referenceId, transactionId = null) {
      for (const item of items) {
        const prodId = item.productId ?? item.id
        const product = this.getProductById(prodId)

        if (product && (product.kind ?? 'product') !== 'service') {
          this.adjustStock(product.id, {
            quantityChange: -normalizeNumber(item.qty),
            type: 'sale',
            referenceId,
            transactionId: transactionId ?? item.transactionId ?? null,
            category: 'Penjualan',
            note: `Penjualan ${item.name}`,
          })
        }

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
              const ingProd =
                this.getProductById(ingId) ||
                this.products.find((p) => p.syncId === ingId || p.id === ingId)
              if (ingProd) {
                const totalDeduct = ingQty * normalizeNumber(item.qty)
                this.adjustStock(ingProd.id, {
                  quantityChange: -totalDeduct,
                  type: 'sale',
                  referenceId,
                  transactionId: transactionId ?? item.transactionId ?? null,
                  category: 'Penjualan (Varian)',
                  note: `Varian ${variant.name} (${item.name})`,
                })
              }
            }
          }
        }
      }
    },
    createCategory(name) {
      const validation = validateCategoryName(name, this.categories)

      if (!validation.isValid) {
        return {
          success: false,
          error: validation.error,
        }
      }

      this.categories.push(validation.value)

      return {
        success: true,
        category: validation.value,
      }
    },
    updateCategory(currentName, nextName) {
      const index = this.categories.findIndex((category) => category === currentName)

      if (index === -1) {
        return {
          success: false,
          error: 'Kategori tidak ditemukan.',
        }
      }

      const validation = validateCategoryName(nextName, this.categories, currentName)

      if (!validation.isValid) {
        return {
          success: false,
          error: validation.error,
        }
      }

      this.categories.splice(index, 1, validation.value)
      this.products = this.products.map((product) =>
        product.category === currentName ? { ...product, category: validation.value } : product,
      )

      if (this.selectedCategory === currentName) {
        this.selectedCategory = validation.value
      }

      return {
        success: true,
        category: validation.value,
      }
    },
    deleteCategory(name) {
      const isUsed = this.products.some((product) => product.category === name)

      if (isUsed) {
        return {
          success: false,
          error: 'Kategori masih digunakan oleh produk.',
        }
      }

      const currentLength = this.categories.length
      this.categories = this.categories.filter((category) => category !== name)

      if (this.selectedCategory === name) {
        this.selectedCategory = DEFAULT_FILTER_CATEGORY
      }

      return {
        success: this.categories.length !== currentLength,
        error: this.categories.length === currentLength ? 'Kategori tidak ditemukan.' : '',
      }
    },
  },
})
