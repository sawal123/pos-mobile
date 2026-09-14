import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { describe, expect, it } from 'vitest'

import ProductCard from '@/components/pos/ProductCard.vue'
import { createAppRouter } from '@/router'
import { useBusinessStore } from '@/stores/businessStore'
import { useCashierStore } from '@/stores/cashierStore'
import { useProductStore } from '@/stores/productStore'
import { useShiftStore } from '@/stores/shiftStore'
import ProductFormView from '@/views/products/ProductFormView.vue'

const IMAGE_DATA = 'data:image/webp;base64,abc123'

function createContext(type = 'Cafe / UMKM') {
  const pinia = createPinia()
  setActivePinia(pinia)

  const router = createAppRouter()
  const businessStore = useBusinessStore()
  const cashierStore = useCashierStore()
  const shiftStore = useShiftStore()
  const productStore = useProductStore()

  businessStore.setBusiness({
    name: 'Demo POS Store',
    type,
    owner: 'Admin',
    phone: '08123456789',
    outlet: 'Outlet Utama',
    mode: 'free',
  })
  cashierStore.setPinConfigured(true)
  shiftStore.openShift(100000)

  return { pinia, router, businessStore, productStore }
}

function getButtonByText(wrapper, label) {
  return wrapper.findAll('button').find((button) => button.text().includes(label))
}

describe('product image support', () => {
  it('ProductCard render imageData jika ada', () => {
    const wrapper = mount(ProductCard, {
      props: {
        product: {
          id: 'p-1',
          name: 'Kopi Susu',
          category: 'Minuman',
          kind: 'product',
          price: 22000,
          stock: 5,
          imageData: IMAGE_DATA,
        },
      },
    })

    expect(wrapper.find('[data-testid="product-card-image"]').attributes('src')).toBe(IMAGE_DATA)
    expect(wrapper.find('[data-testid="product-card-fallback"]').exists()).toBe(false)
  })

  it('ProductCard render fallback jika image kosong', () => {
    const wrapper = mount(ProductCard, {
      props: {
        product: {
          id: 'p-1',
          name: 'Kopi Susu',
          category: 'Minuman',
          kind: 'product',
          price: 22000,
          stock: 5,
          imageData: '',
        },
      },
    })

    expect(wrapper.find('[data-testid="product-card-image"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="product-card-fallback"]').exists()).toBe(true)
  })

  it('create product dapat menyimpan imageData', () => {
    const { productStore } = createContext()

    const result = productStore.createProduct({
      name: 'Matcha Latte',
      category: 'Minuman',
      price: 28000,
      stock: 12,
      imageData: IMAGE_DATA,
      isActive: true,
    })

    expect(result.success).toBe(true)
    expect(result.product.imageData).toBe(IMAGE_DATA)
  })

  it('edit product mempertahankan imageData ketika payload lama tidak mengirim gambar', () => {
    const { productStore } = createContext()
    const created = productStore.createProduct({
      name: 'Matcha Latte',
      category: 'Minuman',
      price: 28000,
      stock: 12,
      imageData: IMAGE_DATA,
      isActive: true,
    }).product

    productStore.updateProduct(created.id, {
      name: 'Matcha Latte Large',
      category: 'Minuman',
      price: 32000,
      stock: 12,
      isActive: true,
    })

    expect(productStore.getProductById(created.id).imageData).toBe(IMAGE_DATA)
  })

  it('remove image bekerja dari ProductForm', async () => {
    const context = createContext()
    const created = context.productStore.createProduct({
      name: 'Matcha Latte',
      category: 'Minuman',
      price: 28000,
      stock: 12,
      imageData: IMAGE_DATA,
      isActive: true,
    }).product

    await context.router.push(`/products/${created.id}/edit`)
    await flushPromises()

    const wrapper = mount(ProductFormView, {
      global: {
        plugins: [context.pinia, context.router],
      },
    })

    expect(wrapper.find('[data-testid="product-image-preview"]').exists()).toBe(true)

    await getButtonByText(wrapper, 'Hapus Gambar').trigger('click')
    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(context.productStore.getProductById(created.id).imageData).toBe('')
  })

  it('Laundry service image aman', () => {
    const { productStore } = createContext('Laundry')
    productStore.applyBusinessTemplate('Laundry')

    const result = productStore.createProduct({
      kind: 'service',
      name: 'Cuci Kering',
      category: 'Kiloan',
      pricingUnit: 'kg',
      price: 10000,
      cost: 4000,
      imageData: IMAGE_DATA,
      isActive: true,
    })

    expect(result.success).toBe(true)
    expect(result.product.imageData).toBe(IMAGE_DATA)
  })
})
