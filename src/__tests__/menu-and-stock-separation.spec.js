import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { describe, expect, it } from 'vitest'

import { createAppRouter } from '@/router'
import { useBusinessStore } from '@/stores/businessStore'
import { useProductStore } from '@/stores/productStore'
import ProductsView from '@/views/products/ProductsView.vue'
import StockView from '@/views/stock/StockView.vue'

function createTestContext() {
  const pinia = createPinia()
  setActivePinia(pinia)

  const router = createAppRouter()
  const businessStore = useBusinessStore()
  const productStore = useProductStore()

  businessStore.setBusiness({
    name: 'Warung Kopi Nusantara',
    type: 'Cafe / UMKM',
    owner: 'Owner',
    phone: '08123456789',
    outlet: 'Outlet Utama',
    mode: 'free',
  })

  productStore.products = [
    {
      id: 'p1',
      name: 'Kopi Susu Gula Aren',
      category: 'Minuman',
      price: 18000,
      cost: 8000,
      stock: 45,
      minStock: 10,
      unit: 'cup',
      isSellable: true,
      isActive: true,
      kind: 'product',
    },
    {
      id: 'p2',
      name: 'Roti Bakar Cokelat',
      category: 'Makanan',
      price: 15000,
      cost: 7000,
      stock: 20,
      minStock: 5,
      unit: 'porsi',
      isSellable: true,
      isActive: true,
      kind: 'product',
    },
    {
      id: 'p3',
      name: 'Biji Kopi Robusta Mentah 1kg (Persediaan)',
      category: 'Bahan Baku',
      price: 0,
      cost: 75000,
      stock: 15,
      minStock: 5,
      unit: 'kg',
      isSellable: false, // Bahan baku persediaan / non-sellable
      isActive: true,
      kind: 'product',
    },
  ]

  return { pinia, router, businessStore, productStore }
}

describe('Menu Yang Dijual vs Persediaan Stok Separation', () => {
  it('halaman Produk menampilkan Menu Dijual dan TIDAK menampilkan badge persediaan/stok pada kartu produk', async () => {
    const context = createTestContext()
    await context.router.push('/products')
    await flushPromises()

    const wrapper = mount(ProductsView, {
      global: { plugins: [context.pinia, context.router] },
    })

    // Header & Navigation tabs
    expect(wrapper.text()).toContain('Menu & Produk Dijual')
    expect(wrapper.text()).toContain('Persediaan Stok')

    // Sellable products are shown
    expect(wrapper.text()).toContain('Kopi Susu Gula Aren')
    expect(wrapper.text()).toContain('Roti Bakar Cokelat')

    // Non-sellable raw material / persediaan is excluded from Menu Dijual
    expect(wrapper.text()).not.toContain('Biji Kopi Robusta Mentah 1kg (Persediaan)')

    // IMPORTANT: Badge "Stok: 45" or "Stok: 20" must NOT appear in the menu cards
    expect(wrapper.text()).not.toContain('Stok: 45')
    expect(wrapper.text()).not.toContain('Stok: 20')
  })

  it('halaman Stok menampilkan seluruh persediaan fisik dan fitur adjustment stok', async () => {
    const context = createTestContext()
    await context.router.push('/stock')
    await flushPromises()

    const wrapper = mount(StockView, {
      global: { plugins: [context.pinia, context.router] },
    })

    // Header & Navigation switch to Menu Dijual
    expect(wrapper.text()).toContain('Persediaan & Stok Produk')
    expect(wrapper.text()).toContain('Menu Dijual')

    // Stock page displays all physical goods including supplies
    expect(wrapper.text()).toContain('Kopi Susu Gula Aren')
    expect(wrapper.text()).toContain('Biji Kopi Robusta Mentah 1kg (Persediaan)')

    // Stock units are displayed
    expect(wrapper.text()).toContain('45')
    expect(wrapper.text()).toContain('15')
    expect(wrapper.text()).toContain('Adjust Stok')
  })
})
