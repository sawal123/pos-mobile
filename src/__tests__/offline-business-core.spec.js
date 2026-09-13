import { createPinia, setActivePinia } from 'pinia'
import { describe, expect, it } from 'vitest'

import { useBusinessStore } from '@/stores/businessStore'
import { useCartStore } from '@/stores/cartStore'
import { useCashStore } from '@/stores/cashStore'
import { useProductStore } from '@/stores/productStore'
import { useTransactionStore } from '@/stores/transactionStore'

function createContext() {
  const pinia = createPinia()
  setActivePinia(pinia)

  return {
    businessStore: useBusinessStore(),
    cartStore: useCartStore(),
    cashStore: useCashStore(),
    productStore: useProductStore(),
    transactionStore: useTransactionStore(),
  }
}

function createRetailProduct(productStore, overrides = {}) {
  return productStore.createProduct({
    name: 'Beras 5kg',
    category: productStore.categories[0],
    sku: 'BR-5',
    cost: 55000,
    price: 65000,
    stock: 10,
    unit: 'pack',
    minStock: 3,
    isActive: true,
    ...overrides,
  }).product
}

describe('offline business core', () => {
  it('legacy restaurant/restoran dibaca sebagai Cafe / UMKM', () => {
    const { businessStore } = createContext()

    businessStore.setBusiness({ name: 'Resto Lama', type: 'restaurant' })

    expect(businessStore.type).toBe('Cafe / UMKM')
    expect(businessStore.normalizedType).toBe('Cafe / UMKM')
  })

  it('CRUD produk offline menyimpan field minimal baru', () => {
    const { productStore } = createContext()
    productStore.applyBusinessTemplate('Grosir / Toko Kelontong')

    const product = createRetailProduct(productStore)

    expect(productStore.getProductById(product.id)).toMatchObject({
      name: 'Beras 5kg',
      sku: 'BR-5',
      cost: 55000,
      price: 65000,
      stock: 10,
      unit: 'pack',
      minStock: 3,
      isActive: true,
    })

    const update = productStore.updateProduct(product.id, {
      ...product,
      name: 'Beras Premium 5kg',
      cost: 57000,
      price: 70000,
      stock: 8,
    })

    expect(update.success).toBe(true)
    expect(productStore.getProductById(product.id).name).toBe('Beras Premium 5kg')
    expect(productStore.deleteProduct(product.id)).toBe(true)
    expect(productStore.getProductById(product.id)).toBeNull()
  })

  it('penjualan mengurangi stok dan menyimpan snapshot HPP transaksi', () => {
    const { cartStore, productStore, transactionStore } = createContext()
    productStore.applyBusinessTemplate('Grosir / Toko Kelontong')
    const product = createRetailProduct(productStore, { cost: 10000, price: 15000, stock: 5 })

    cartStore.addItem(product)
    const transaction = transactionStore.createTransaction({
      items: cartStore.items,
      subtotal: cartStore.subtotal,
      tax: 0,
      total: cartStore.subtotal,
      paymentMethod: 'qris',
    })
    productStore.recordSaleStock(transaction.items, transaction.id)
    productStore.updateProduct(product.id, { ...productStore.getProductById(product.id), cost: 12000, stock: 4 })

    expect(productStore.getProductById(product.id).stock).toBe(4)
    expect(transaction.items[0].hppSnapshot).toBe(10000)
    expect(transaction.grossProfit).toBe(5000)
  })

  it('adjustment stok manual bisa menambah stok kembali dan mencatat riwayat', () => {
    const { productStore } = createContext()
    productStore.applyBusinessTemplate('Grosir / Toko Kelontong')
    const product = createRetailProduct(productStore, { stock: 1, minStock: 2 })

    const result = productStore.adjustStock(product.id, {
      quantityChange: 5,
      note: 'Restock modal',
    })

    expect(result.success).toBe(true)
    expect(productStore.getProductById(product.id).stock).toBe(6)
    expect(productStore.stockMovements[0]).toMatchObject({
      productId: product.id,
      quantityChange: 5,
      stockBefore: 1,
      stockAfter: 6,
    })
  })

  it('indikator stok minimum membaca produk di bawah minimum', () => {
    const { productStore } = createContext()
    productStore.applyBusinessTemplate('Grosir / Toko Kelontong')
    const product = createRetailProduct(productStore, { stock: 2, minStock: 3 })

    expect(productStore.lowStockProducts.map((item) => item.id)).toContain(product.id)
  })

  it('layanan Laundry menerima quantity decimal kg dengan subtotal benar', () => {
    const { cartStore, productStore } = createContext()
    productStore.applyBusinessTemplate('Laundry')
    const service = productStore.createProduct({
      kind: 'service',
      name: 'Cuci Kering',
      category: 'Kiloan',
      pricingUnit: 'kg',
      price: 10000,
      cost: 4000,
      minQuantity: 0,
      estimatedDuration: '2 hari',
      isActive: true,
    }).product

    cartStore.addItem(service)
    cartStore.updateQty(service.id, 3.5)

    expect(cartStore.items[0].qty).toBe(3.5)
    expect(cartStore.subtotal).toBe(35000)
  })

  it('cash sale mencatat kas masuk sekali dan non-cash tidak menambah saldo tunai', () => {
    const { cashStore, transactionStore } = createContext()
    const cashTransaction = transactionStore.createTransaction({
      items: [{ id: 'p-1', name: 'Produk', price: 20000, hppSnapshot: 10000, qty: 1 }],
      subtotal: 20000,
      tax: 0,
      total: 20000,
      paymentMethod: 'cash',
    })
    const qrisTransaction = transactionStore.createTransaction({
      items: [{ id: 'p-2', name: 'Produk QR', price: 30000, hppSnapshot: 12000, qty: 1 }],
      subtotal: 30000,
      tax: 0,
      total: 30000,
      paymentMethod: 'qris',
    })

    cashStore.recordSalePayment(cashTransaction)
    cashStore.recordSalePayment(cashTransaction)
    cashStore.recordSalePayment(qrisTransaction)

    expect(cashStore.entries).toHaveLength(1)
    expect(cashStore.balance).toBe(20000)
  })
})
