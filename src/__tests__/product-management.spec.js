import { createPinia, setActivePinia } from 'pinia'
import { describe, expect, it } from 'vitest'

import { createAppRouter } from '@/router'
import { useBusinessStore } from '@/stores/businessStore'
import { useCashierStore } from '@/stores/cashierStore'
import { useProductStore } from '@/stores/productStore'

function createContext() {
  const pinia = createPinia()
  setActivePinia(pinia)

  return {
    pinia,
    router: createAppRouter(),
    businessStore: useBusinessStore(),
    cashierStore: useCashierStore(),
    productStore: useProductStore(),
  }
}

function makeBusinessReady(businessStore) {
  businessStore.setBusiness({
    name: 'Demo POS Store',
    type: 'Cafe',
    owner: 'Admin',
    phone: '08123456789',
    outlet: 'Outlet Utama',
    mode: 'free',
  })
}

describe('P2 product management', () => {
  it('create product menambah tepat 1 product', () => {
    const { productStore } = createContext()
    const initialCount = productStore.products.length

    const result = productStore.createProduct({
      name: 'Matcha Latte',
      category: 'Minuman',
      price: 28000,
      stock: 12,
      isActive: true,
    })

    expect(result.success).toBe(true)
    expect(productStore.products).toHaveLength(initialCount + 1)
  })

  it('create product menghasilkan ID unik', () => {
    const { productStore } = createContext()

    const firstResult = productStore.createProduct({
      name: 'Latte',
      category: 'Minuman',
      price: 25000,
      stock: 8,
      isActive: true,
    })
    const secondResult = productStore.createProduct({
      name: 'Mocha',
      category: 'Minuman',
      price: 27000,
      stock: 6,
      isActive: true,
    })

    expect(firstResult.product.id).not.toBe(secondResult.product.id)
  })

  it('edit product mengubah product yang benar', () => {
    const { productStore } = createContext()
    const productId = productStore.products[0].id

    const result = productStore.updateProduct(productId, {
      name: 'Es Kopi Susu Gula Aren',
      category: 'Minuman',
      price: 24000,
      stock: 10,
      isActive: true,
    })

    expect(result.success).toBe(true)
    expect(productStore.getProductById(productId)).toMatchObject({
      name: 'Es Kopi Susu Gula Aren',
      price: 24000,
      stock: 10,
    })
    expect(productStore.products[1].name).toBe('Americano')
  })

  it('inactive product tidak masuk filteredProducts', () => {
    const { productStore } = createContext()
    const productId = productStore.products[0].id

    productStore.toggleProductActive(productId)

    expect(productStore.getProductById(productId).isActive).toBe(false)
    expect(productStore.filteredProducts.some((product) => product.id === productId)).toBe(false)
  })

  it('activate product membuat product kembali tersedia', () => {
    const { productStore } = createContext()
    const productId = productStore.products[0].id

    productStore.toggleProductActive(productId)
    productStore.toggleProductActive(productId)

    expect(productStore.getProductById(productId).isActive).toBe(true)
    expect(productStore.filteredProducts.some((product) => product.id === productId)).toBe(true)
  })

  it('delete product menghapus product', () => {
    const { productStore } = createContext()
    const productId = productStore.products[0].id

    const deleted = productStore.deleteProduct(productId)

    expect(deleted).toBe(true)
    expect(productStore.getProductById(productId)).toBeNull()
  })

  it('create category berhasil', () => {
    const { productStore } = createContext()

    const result = productStore.createCategory('Beverages')

    expect(result.success).toBe(true)
    expect(productStore.categories).toContain('Beverages')
  })

  it('duplicate category case-insensitive ditolak', () => {
    const { productStore } = createContext()

    const result = productStore.createCategory('minuman')

    expect(result.success).toBe(false)
    expect(result.error).toBeTruthy()
  })

  it("createCategory('semua') ditolak", () => {
    const { productStore } = createContext()

    const result = productStore.createCategory('semua')

    expect(result.success).toBe(false)
    expect(result.error).toBeTruthy()
  })

  it("createCategory('SEMUA') ditolak", () => {
    const { productStore } = createContext()

    const result = productStore.createCategory('SEMUA')

    expect(result.success).toBe(false)
    expect(result.error).toBeTruthy()
  })

  it('create product dengan category tidak terdaftar ditolak', () => {
    const { productStore } = createContext()

    const result = productStore.createProduct({
      name: 'Latte',
      category: 'Kategori Tidak Ada',
      price: 20000,
      stock: 10,
      isActive: true,
    })

    expect(result.success).toBe(false)
    expect(result.errors.category).toBeTruthy()
    expect(productStore.categories).not.toContain('Kategori Tidak Ada')
  })

  it('create product invalid tidak menambah product', () => {
    const { productStore } = createContext()
    const initialCount = productStore.products.length

    const result = productStore.createProduct({
      name: 'Latte',
      category: 'Kategori Tidak Ada',
      price: 20000,
      stock: 10,
      isActive: true,
    })

    expect(result.success).toBe(false)
    expect(productStore.products).toHaveLength(initialCount)
  })

  it('update product dengan category tidak terdaftar ditolak', () => {
    const { productStore } = createContext()
    const productId = productStore.products[0].id

    const result = productStore.updateProduct(productId, {
      name: 'Es Kopi Susu',
      category: 'Kategori Tidak Ada',
      price: 22000,
      stock: 18,
      isActive: true,
    })

    expect(result.success).toBe(false)
    expect(result.errors.category).toBeTruthy()
    expect(productStore.categories).not.toContain('Kategori Tidak Ada')
  })

  it('update product invalid tidak mengubah product existing', () => {
    const { productStore } = createContext()
    const productId = productStore.products[0].id
    const originalProduct = { ...productStore.getProductById(productId) }

    const result = productStore.updateProduct(productId, {
      name: 'Produk Baru',
      category: 'Kategori Tidak Ada',
      price: 99999,
      stock: 99,
      isActive: false,
    })

    expect(result.success).toBe(false)
    expect(productStore.getProductById(productId)).toEqual(originalProduct)
  })

  it('price kosong ditolak', () => {
    const { productStore } = createContext()

    const result = productStore.createProduct({
      name: 'Latte',
      category: 'Minuman',
      price: '',
      stock: 10,
      isActive: true,
    })

    expect(result.success).toBe(false)
    expect(result.errors.price).toBeTruthy()
  })

  it('stock kosong ditolak', () => {
    const { productStore } = createContext()

    const result = productStore.createProduct({
      name: 'Latte',
      category: 'Minuman',
      price: 20000,
      stock: '',
      isActive: true,
    })

    expect(result.success).toBe(false)
    expect(result.errors.stock).toBeTruthy()
  })

  it('price 0 tetap valid', () => {
    const { productStore } = createContext()

    const result = productStore.createProduct({
      name: 'Air Putih',
      category: 'Minuman',
      price: 0,
      stock: 10,
      isActive: true,
    })

    expect(result.success).toBe(true)
    expect(result.product.price).toBe(0)
  })

  it('stock 0 tetap valid', () => {
    const { productStore } = createContext()

    const result = productStore.createProduct({
      name: 'Menu Habis',
      category: 'Makanan',
      price: 10000,
      stock: 0,
      isActive: true,
    })

    expect(result.success).toBe(true)
    expect(result.product.stock).toBe(0)
  })

  it('edit category mengubah category product terkait', () => {
    const { productStore } = createContext()

    const result = productStore.updateCategory('Minuman', 'Beverages')

    expect(result.success).toBe(true)
    expect(productStore.categories).toContain('Beverages')
    expect(productStore.products.filter((product) => product.category === 'Beverages')).toHaveLength(2)
  })

  it('delete category yang masih digunakan ditolak', () => {
    const { productStore } = createContext()

    const result = productStore.deleteCategory('Minuman')

    expect(result.success).toBe(false)
    expect(result.error).toBeTruthy()
    expect(productStore.categories).toContain('Minuman')
  })

  it('delete category yang tidak digunakan berhasil', () => {
    const { productStore } = createContext()

    productStore.createCategory('Seasonal')
    const result = productStore.deleteCategory('Seasonal')

    expect(result.success).toBe(true)
    expect(productStore.categories).not.toContain('Seasonal')
  })

  it('/products dapat dibuka tanpa shift aktif jika business dan PIN siap', async () => {
    const { router, businessStore, cashierStore } = createContext()

    makeBusinessReady(businessStore)
    cashierStore.setPinConfigured(true)
    await router.push('/products')

    expect(router.currentRoute.value.fullPath).toBe('/products')
  })

  it('/categories dapat dibuka tanpa shift aktif jika business dan PIN siap', async () => {
    const { router, businessStore, cashierStore } = createContext()

    makeBusinessReady(businessStore)
    cashierStore.setPinConfigured(true)
    await router.push('/categories')

    expect(router.currentRoute.value.fullPath).toBe('/categories')
  })
})
