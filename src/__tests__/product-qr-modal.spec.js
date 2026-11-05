import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { flushPromises, mount } from '@vue/test-utils'
import { useBusinessStore } from '@/stores/businessStore'
import { useProductStore } from '@/stores/productStore'
import { useCloudSessionStore } from '@/stores/cloudSessionStore'
import ProductQrModal from '@/components/products/ProductQrModal.vue'
import { createProductQrDataUrl, downloadProductLabel } from '@/services/products/productQrService'

vi.mock('@/services/products/productQrService', () => ({
  createProductQrDataUrl: vi.fn(async () => 'data:image/png;base64,cXI='),
  downloadProductLabel: vi.fn(async () => 'Label PNG siap.'),
}))
const wrappers = []
beforeEach(() => {
  vi.clearAllMocks()
  setActivePinia(createPinia())
  useBusinessStore().setBusiness({ name: 'Toko Uji', type: 'Grosir', mode: 'free' })
  useProductStore().applyBusinessTemplate('Grosir')
  useProductStore().products = [
    {
      id: 'p1',
      name: 'Beras',
      category: 'Produk',
      sku: 'BRS-01',
      barcode: '',
      price: 65000,
      stock: 12,
      isActive: true,
      kind: 'product',
    },
  ]
})
afterEach(() => wrappers.splice(0).forEach((wrapper) => wrapper.unmount()))

function openQr() {
  const product = useProductStore().products[0]
  const wrapper = mount(ProductQrModal, { props: { open: true, product } })
  wrappers.push(wrapper)
  return wrapper
}

describe('product QR user flow', () => {
  it('assigns only on explicit action, keeps the code stable and exports the current label', async () => {
    const wrapper = openQr()
    expect(useProductStore().products[0].barcode).toBe('')
    expect(createProductQrDataUrl).not.toHaveBeenCalled()
    await wrapper.get('[data-testid="generate-product-qr"]').trigger('click')
    await flushPromises()
    const code = useProductStore().products[0].barcode
    expect(code).toMatch(/^NXP-/)
    expect(wrapper.get('[data-testid="product-qr-code"]').text()).toBe(code)
    expect(wrapper.find('[data-testid="product-qr-image"]').exists()).toBe(true)
    await wrapper.setProps({ open: false })
    await wrapper.setProps({ open: true })
    await flushPromises()
    expect(useProductStore().products[0].barcode).toBe(code)
    await wrapper.get('[data-testid="download-product-qr"]').trigger('click')
    await flushPromises()
    expect(downloadProductLabel).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Beras', barcode: code }),
    )
  })

  it('does not show a QR when persistence cannot confirm the saved code', async () => {
    const cloud = useCloudSessionStore()
    cloud.setPersistenceAdapter(
      { loadProducts: async () => ({ products: [] }) },
      { flush: async () => {} },
    )
    const wrapper = openQr()
    await wrapper.get('[data-testid="generate-product-qr"]').trigger('click')
    await flushPromises()
    expect(createProductQrDataUrl).not.toHaveBeenCalled()
    expect(wrapper.find('[data-testid="product-qr-image"]').exists()).toBe(false)
    expect(wrapper.get('[role="alert"]').text()).toContain('belum tersimpan')
  })

  it('lets a linked cashier view an existing code but never generate a missing one', async () => {
    const cloud = useCloudSessionStore()
    cloud.user = { id: 1 }
    cloud.selectedBusiness = { id: 10 }
    cloud.role = 'cashier'
    const wrapper = openQr()
    expect(wrapper.find('[data-testid="generate-product-qr"]').exists()).toBe(false)
    useProductStore().products[0].barcode = '001234'
    await flushPromises()
    expect(wrapper.find('[data-testid="product-qr-image"]').exists()).toBe(true)
  })
})
