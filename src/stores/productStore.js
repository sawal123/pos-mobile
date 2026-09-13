import { defineStore } from 'pinia'

import { getBusinessTemplate } from '@/data/businessTemplates'

const DEFAULT_FILTER_CATEGORY = 'Semua'
const DEFAULT_FILTER_CATEGORY_KEY = DEFAULT_FILTER_CATEGORY.toLowerCase()

function normalizeProduct(product) {
  return {
    ...product,
    price: Number(product.price) || 0,
    stock: Number(product.stock) || 0,
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
  const name = normalizeName(payload.name ?? '')
  const category = normalizeName(payload.category ?? '')
  const price = isBlankValue(payload.price) ? Number.NaN : Number(payload.price)
  const stock = isBlankValue(payload.stock) ? Number.NaN : Number(payload.stock)

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
    errors.price = 'Harga harus berupa angka dan minimal 0.'
  }

  if (Number.isNaN(stock) || stock < 0) {
    errors.stock = 'Stok harus berupa angka dan minimal 0.'
  }

  return {
    errors,
    isValid: Object.keys(errors).length === 0,
    values: {
      name,
      category,
      price: Number.isNaN(price) ? 0 : price,
      stock: Number.isNaN(stock) ? 0 : stock,
      isActive: payload.isActive ?? true,
    },
  }
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
    const initialCatalog = buildTemplateState('Cafe')

    return {
      products: initialCatalog.products,
      categories: initialCatalog.categories,
      selectedCategory: DEFAULT_FILTER_CATEGORY,
      searchQuery: '',
    }
  },
  getters: {
    filterCategories(state) {
      return [DEFAULT_FILTER_CATEGORY, ...state.categories]
    },
    filteredProducts() {
      let list = this.products.filter((product) => product.isActive)

      if (this.selectedCategory !== DEFAULT_FILTER_CATEGORY) {
        list = list.filter((product) => product.category === this.selectedCategory)
      }

      if (this.searchQuery) {
        const query = this.searchQuery.toLowerCase()
        list = list.filter((product) => product.name.toLowerCase().includes(query))
      }

      return list
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
      this.selectedCategory = DEFAULT_FILTER_CATEGORY
    },
    setSearchQuery(query) {
      this.searchQuery = query
    },
    getProductById(id) {
      return this.products.find((product) => String(product.id) === String(id)) ?? null
    },
    createProduct(payload) {
      const { errors, isValid, values } = validateProductInput(payload, this.categories)

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

      const { errors, isValid, values } = validateProductInput(payload, this.categories)

      if (!isValid) {
        return {
          success: false,
          errors,
        }
      }

      existingProduct.name = values.name
      existingProduct.category = values.category
      existingProduct.price = values.price
      existingProduct.stock = values.stock
      existingProduct.isActive = values.isActive

      return {
        success: true,
        product: existingProduct,
        errors: {},
      }
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
      this.products = this.products.map((product) => (
        product.category === currentName
          ? { ...product, category: validation.value }
          : product
      ))

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
