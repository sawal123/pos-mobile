import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { describe, expect, it, vi } from 'vitest'

import ProductCard from '@/components/pos/ProductCard.vue'
import { createAppRouter } from '@/router'
import { createMemoryAdapter } from '@/services/database/memoryAdapter'
import { createSyncPullService } from '@/services/sync/syncPullService'
import { useBusinessStore } from '@/stores/businessStore'
import { useCashierStore } from '@/stores/cashierStore'
import { useCloudSessionStore } from '@/stores/cloudSessionStore'
import { useProductStore } from '@/stores/productStore'
import { useShiftStore } from '@/stores/shiftStore'
import { useSyncPullStore } from '@/stores/syncPullStore'
import ProductFormView from '@/views/products/ProductFormView.vue'

const IMAGE_DATA = 'data:image/webp;base64,abc123'
const REMOTE_IMAGE_URL =
  'https://pos.eradig.my.id/storage/menu/GNh11hHl1qP9iydjhgfn9JjH0YZXRm7Ib3qliZns.jpg'

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

  it('ProductCard merender URL Cloud image dan fallback ke icon saat @error', async () => {
    const wrapper = mount(ProductCard, {
      props: {
        product: {
          id: 'p-cloud-1',
          name: 'Americano',
          category: 'Black Coffee',
          kind: 'product',
          price: 18000,
          stock: 999,
          imageData: REMOTE_IMAGE_URL,
        },
      },
    })

    const img = wrapper.find('[data-testid="product-card-image"]')
    expect(img.exists()).toBe(true)
    expect(img.attributes('src')).toBe(REMOTE_IMAGE_URL)

    await img.trigger('error')
    expect(wrapper.find('[data-testid="product-card-image"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="product-card-fallback"]').exists()).toBe(true)
  })

  it('sync pull menyimpan image_url Cloud ke imageData productStore dan backfill otomatis jika produk lama belum punya gambar', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)

    const adapter = createMemoryAdapter()
    await adapter.initialize()

    const cloudStore = useCloudSessionStore(pinia)
    cloudStore.user = { id: 1, email: 'owner@temuanspace.id', name: 'Owner' }
    cloudStore.selectedBusiness = { id: 10, name: 'Temuan Space', business_type: 'Cafe / UMKM' }
    cloudStore.selectedOutlet = { id: 101, name: 'Temuan Space Laksana' }
    cloudStore.cloudAccess = true
    cloudStore.capabilityState = 'verified'
    cloudStore.role = 'owner'
    cloudStore.syncCapabilities = { push_mode: 'full' }
    cloudStore.deviceIdentifier = '33333333-3333-4333-8333-333333333333'
    cloudStore.registeredDeviceId = 77
    cloudStore.ensureVerifiedContext = vi.fn().mockResolvedValue({ ok: true })

    const catUuid = '11111111-1111-4111-8111-111111111111'
    const prodUuid = '22222222-2222-4222-8222-222222222222'

    // Simulasikan perangkat yang sudah menyelesaikan sync awal sebelum dukungan gambar ada
    await adapter.saveSyncPushBinding({
      businessId: 10,
      outletId: 101,
      deviceIdentifier: '33333333-3333-4333-8333-333333333333',
      registeredDeviceId: 77,
    })
    await adapter.saveSyncPullBinding({
      businessId: 10,
      outletId: 101,
      deviceIdentifier: '33333333-3333-4333-8333-333333333333',
      registeredDeviceId: 77,
      status: 'completed',
    })
    await adapter.saveSyncPullState({ version: 1, cursor: 500, serverSequence: 500 })

    const productStore = useProductStore(pinia)
    productStore.$patch({
      categories: ['Black Coffee'],
      products: [
        {
          id: prodUuid,
          name: 'Americano',
          category: 'Black Coffee',
          price: 18000,
          unitPrice: 18000,
          stock: 999,
          imageData: '',
          isActive: true,
        },
      ],
    })

    const transport = vi.fn(async ({ after }) => {
      if (after >= 500) {
        return {
          ok: true,
          status: 200,
          data: {
            data: {
              records: [],
              next_cursor: 500,
              server_sequence: 500,
              has_more: false,
            },
          },
        }
      }
      return {
        ok: true,
        status: 200,
        data: {
          data: {
            records: [
              {
                entity: 'categories',
                sync_sequence: 1,
                data: { sync_id: catUuid, sync_version: 1, name: 'Black Coffee' },
              },
              {
                entity: 'products',
                sync_sequence: 2,
                data: {
                  sync_id: prodUuid,
                  sync_version: 1,
                  category_sync_id: catUuid,
                  name: 'Americano',
                  image_url: REMOTE_IMAGE_URL,
                  price: 18000,
                  stock: 999,
                  is_active: 1,
                },
              },
            ],
            next_cursor: 500,
            server_sequence: 500,
            has_more: false,
          },
        },
      }
    })

    const pullService = createSyncPullService({
      adapter,
      cloudStore,
      tokenFetcher: async () => 'test-token',
      transport,
    })

    const syncPullStore = useSyncPullStore(pinia)
    syncPullStore.init({ pullService, adapter })

    const res = await syncPullStore.ensureCatalogLoaded()
    expect(res.ok).toBe(true)
    expect(transport).toHaveBeenCalledWith(expect.objectContaining({ after: 500 }))
    expect(transport).toHaveBeenCalledWith(expect.objectContaining({ after: 0 }))
    expect(productStore.products[0].imageData).toBe(REMOTE_IMAGE_URL)

    const persisted = await adapter.loadProducts()
    expect(persisted.products[0].imageData).toBe(REMOTE_IMAGE_URL)
  })
})
