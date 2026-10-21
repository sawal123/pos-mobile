import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { describe, expect, it } from 'vitest'

import { createAppRouter } from '@/router'
import { useProductStore } from '@/stores/productStore'
import StockView from '@/views/stock/StockView.vue'

function createContext() {
  const pinia = createPinia()
  setActivePinia(pinia)

  const router = createAppRouter()
  const productStore = useProductStore()

  return { pinia, router, productStore }
}

describe('StockView UI/UX Enhancement', () => {
  it('menampilkan metrik stok, filter status, dan produk inventory fisik', async () => {
    const context = createContext()
    context.productStore.products = [
      {
        id: 'p1',
        name: 'Kopi Arabika',
        category: 'Kopi',
        stock: 50,
        minStock: 10,
        unit: 'kg',
        kind: 'product',
        isActive: true,
      },
      {
        id: 'p2',
        name: 'Susu UHT',
        category: 'Bahan Baku',
        stock: 4,
        minStock: 10,
        unit: 'liter',
        kind: 'product',
        isActive: true,
      },
      {
        id: 'p3',
        name: 'Jasa Cuci Setrika',
        category: 'Layanan',
        stock: 0,
        minStock: 0,
        unit: 'kg',
        kind: 'service',
        isActive: true,
      },
    ]

    await context.router.push('/stock')
    await flushPromises()

    const wrapper = mount(StockView, {
      global: { plugins: [context.pinia, context.router] },
    })

    // Header & Hero Metrics
    expect(wrapper.text()).toContain('Stok Produk')
    expect(wrapper.text()).toContain('1 Menipis') // Susu UHT stock (4) <= minStock (10)
    expect(wrapper.text()).toContain('54') // Total stock = 50 + 4 = 54

    // Product items
    expect(wrapper.text()).toContain('Kopi Arabika')
    expect(wrapper.text()).toContain('Susu UHT')
    expect(wrapper.text()).not.toContain('Jasa Cuci Setrika') // services are excluded from stock
  })

  it('memfilter produk berdasarkan pencarian dan status stok', async () => {
    const context = createContext()
    context.productStore.products = [
      {
        id: 'p1',
        name: 'Kopi Arabika',
        category: 'Kopi',
        stock: 50,
        minStock: 10,
        kind: 'product',
      },
      {
        id: 'p2',
        name: 'Sirup Karamel',
        category: 'Bahan Baku',
        stock: 2,
        minStock: 5,
        kind: 'product',
      },
      {
        id: 'p3',
        name: 'Cangkir Kertas',
        category: 'Kemasan',
        stock: 0,
        minStock: 20,
        kind: 'product',
      },
    ]

    await context.router.push('/stock')
    await flushPromises()

    const wrapper = mount(StockView, {
      global: { plugins: [context.pinia, context.router] },
    })

    // Filter "Habis"
    const emptyFilter = wrapper.findAll('button').find((b) => b.text().includes('Habis'))
    expect(emptyFilter).toBeTruthy()
    await emptyFilter.trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('Cangkir Kertas')
    expect(wrapper.text()).not.toContain('Kopi Arabika')
    expect(wrapper.text()).not.toContain('Sirup Karamel')

    // Search query
    const searchInput = wrapper.find('input[type="text"]')
    await searchInput.setValue('Cangkir')
    await flushPromises()

    expect(wrapper.text()).toContain('Cangkir Kertas')
  })

  it('dapat beralih ke tab Riwayat Mutasi dan menampilkan perubahan stok', async () => {
    const context = createContext()
    context.productStore.products = [
      { id: 'p1', name: 'Kopi Arabika', stock: 50, minStock: 10, kind: 'product' },
    ]
    context.productStore.stockMovements = [
      {
        id: 'm1',
        productId: 'p1',
        productName: 'Kopi Arabika',
        category: 'Restock',
        note: 'Beli karung 10kg',
        quantityChange: 10,
        stockBefore: 40,
        stockAfter: 50,
        createdAt: new Date().toISOString(),
      },
    ]

    await context.router.push('/stock')
    await flushPromises()

    const wrapper = mount(StockView, {
      global: { plugins: [context.pinia, context.router] },
    })

    // Click tab "Riwayat Mutasi"
    const movementsTab = wrapper.findAll('button').find((b) => b.text().includes('Riwayat Mutasi'))
    expect(movementsTab).toBeTruthy()
    await movementsTab.trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('Kopi Arabika')
    expect(wrapper.text()).toContain('Beli karung 10kg')
    expect(wrapper.text()).toContain('+10')
    expect(wrapper.text()).toContain('40 → 50')
  })

  it('dapat membuka modal adjustment dan menambah stok produk', async () => {
    const context = createContext()
    context.productStore.products = [
      {
        id: 'p1',
        name: 'Kopi Arabika',
        stock: 50,
        minStock: 10,
        unit: 'kg',
        kind: 'product',
      },
    ]

    await context.router.push('/stock')
    await flushPromises()

    const wrapper = mount(StockView, {
      global: { plugins: [context.pinia, context.router] },
    })

    // Open adjustment modal
    const adjustBtn = wrapper.findAll('button').find((b) => b.text().includes('Adjust Stok'))
    expect(adjustBtn).toBeTruthy()
    await adjustBtn.trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('Target Produk')
    expect(wrapper.text()).toContain('Stok saat ini: 50 kg')

    // Click quick increment +10
    const add10Btn = wrapper.findAll('button').find((b) => b.text() === '+10')
    expect(add10Btn).toBeTruthy()
    await add10Btn.trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('50 → 60 kg (+10)')

    // Submit adjustment
    const saveBtn = wrapper.findAll('button').find((b) => b.text() === 'Simpan Perubahan')
    expect(saveBtn).toBeTruthy()
    await saveBtn.trigger('click')
    await flushPromises()

    expect(context.productStore.products[0].stock).toBe(60)
  })
})
