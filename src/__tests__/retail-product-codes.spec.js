import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { flushPromises, mount } from '@vue/test-utils'
import { useBusinessStore } from '@/stores/businessStore'
import { useProductStore } from '@/stores/productStore'
import { useCloudSessionStore } from '@/stores/cloudSessionStore'
import { useCartStore } from '@/stores/cartStore'
import { useVariantStore } from '@/stores/variantStore'
import { createMemoryAdapter } from '@/services/database/memoryAdapter'
import { createPersistenceService } from '@/services/database/persistenceService'
import { createSyncChangeTracker } from '@/services/sync/syncTracker'
import { createSyncQueueService } from '@/services/sync/syncQueueService'
import { mapOutboxEntries } from '@/services/sync/contractMapper'
import { createSyncPullService } from '@/services/sync/syncPullService'
import {
  createBackupPayload,
  restoreBackupPayload,
  validateBackupPayload,
} from '@/services/backupService'
import { isValidProductCode, resolveProductCode } from '@/services/products/productCodeService'
import { useCustomerStore } from '@/stores/customerStore'
import { useExpenseStore } from '@/stores/expenseStore'
import { useTransactionStore } from '@/stores/transactionStore'
import { useCashStore } from '@/stores/cashStore'
import { useShiftStore } from '@/stores/shiftStore'
import { createAppRouter } from '@/router'
import { useCashierStore } from '@/stores/cashierStore'
import PosView from '@/views/pos/PosView.vue'
import ProductFormView from '@/views/products/ProductFormView.vue'
import ProductsView from '@/views/products/ProductsView.vue'
import ProductScannerSheet from '@/components/scanner/ProductScannerSheet.vue'
import ProductVariantSheet from '@/components/pos/ProductVariantSheet.vue'

const id = '22222222-2222-4222-8222-222222222222'
const productData = {
  kind: 'product',
  name: 'Beras',
  category: 'Produk',
  sku: 'BRS-01',
  barcode: '0012345678905',
  price: 65000,
  stock: 12,
  isActive: true,
}
const wrappers = []
beforeEach(() => {
  setActivePinia(createPinia())
  useBusinessStore().setBusiness({ name: 'Toko Uji', type: 'Grosir', mode: 'free' })
  useProductStore().applyBusinessTemplate('Grosir')
})
afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount())
})

describe('retail product codes', () => {
  it('keeps a separate barcode with leading zeroes and stable generated codes after editing', () => {
    const store = useProductStore()
    const first = store.createProduct(productData)
    expect(first.product).toMatchObject({ sku: 'BRS-01', barcode: '0012345678905' })
    const generated = store.createProduct({
      ...productData,
      name: 'Gula',
      sku: 'GL-01',
      barcode: '',
    })
    expect(generated.product.barcode).toMatch(/^NXP-[a-f0-9-]{36}$/)
    const before = generated.product.barcode
    store.updateProduct(generated.product.id, {
      ...generated.product,
      name: 'Gula Pasir',
      price: 18000,
    })
    expect(store.ensureProductBarcode(generated.product.id).product.barcode).toBe(before)
    expect(store.resolveScanCode(` ${first.product.barcode} `).product.id).toBe(first.product.id)
  })

  it('rejects cross-field collisions on create and edit, while excluding the same product', () => {
    const store = useProductStore()
    const first = store.createProduct(productData).product
    expect(store.createProduct({ ...productData, sku: 'NEW', barcode: first.sku }).success).toBe(
      false,
    )
    expect(
      store.createProduct({ ...productData, sku: first.barcode, barcode: 'OTHER' }).success,
    ).toBe(false)
    const second = store.createProduct({ ...productData, sku: 'S2', barcode: 'B2' }).product
    expect(store.updateProduct(second.id, { ...second, barcode: first.barcode }).success).toBe(
      false,
    )
    expect(store.updateProduct(first.id, { ...first, barcode: first.sku }).success).toBe(true)
  })

  it('does not pick the first ambiguous imported code or sell inactive/unsellable/out-of-stock products', () => {
    expect(
      resolveProductCode(
        [
          { ...productData, id: 1 },
          { ...productData, id: 2 },
        ],
        productData.barcode,
      ).error,
    ).toContain('beberapa produk')
    for (const patch of [
      { isActive: false },
      { isSellable: false },
      { kind: 'service' },
      { stock: 0 },
    ]) {
      expect(
        resolveProductCode([{ ...productData, id, ...patch }], productData.barcode).success,
      ).toBe(false)
    }
    expect(resolveProductCode([{ ...productData, id }], '12345678905').success).toBe(false)
    expect(isValidProductCode('abc\nxyz')).toBe(false)
    expect(isValidProductCode('x'.repeat(256))).toBe(false)
    expect(isValidProductCode(1234)).toBe(false)
  })

  it('generates nothing during hydration or for Cafe/Laundry and refuses linked cashier mutations', () => {
    const store = useProductStore()
    for (const type of ['Cafe', 'Laundry']) {
      useBusinessStore().setBusiness({ type })
      expect(store.createProduct({ ...productData, sku: type, barcode: '' }).product.barcode).toBe(
        '',
      )
    }
    useBusinessStore().setBusiness({ type: 'Grosir' })
    const cloud = useCloudSessionStore()
    cloud.user = { id: 1 }
    cloud.selectedBusiness = { id: 10 }
    cloud.role = 'cashier'
    cloud.capabilityState = 'verified'
    cloud.syncCapabilities = {
      push_mode: 'cashier_safe',
      push: true,
      contract_version: 'cashier_sync_v1',
    }
    store.products = [{ ...productData, id, barcode: '' }]
    expect(store.ensureProductBarcode(id).success).toBe(false)
    expect(store.updateProduct(id, { ...productData, barcode: 'NEW' }).success).toBe(false)
    expect(store.products[0].barcode).toBe('')
  })

  it('persists a generated code, queues it through updateProduct, and restores it from backup', async () => {
    const store = useProductStore()
    store.products = [{ ...productData, id, barcode: '' }]
    useBusinessStore().mode = 'cloud'
    const adapter = createMemoryAdapter()
    const service = createPersistenceService({ adapter })
    await service.initialize()
    const queue = createSyncQueueService({ adapter, scheduler: service })
    const tracker = createSyncChangeTracker({ queueService: queue })
    const generated = store.ensureProductBarcode(id)
    expect(generated.success).toBe(true)
    await service.flush()
    expect((await adapter.loadProducts()).products[0].barcode).toBe(generated.product.barcode)
    const pending = await queue.listPending()
    expect(pending).toHaveLength(1)
    expect(pending[0].payload.barcode).toBe(generated.product.barcode)
    const stores = {
      businessStore: useBusinessStore(),
      productStore: store,
      customerStore: useCustomerStore(),
      expenseStore: useExpenseStore(),
      transactionStore: useTransactionStore(),
      cashStore: useCashStore(),
      shiftStore: useShiftStore(),
      cartStore: useCartStore(),
    }
    const backup = createBackupPayload(stores)
    expect(validateBackupPayload(backup).valid).toBe(true)
    store.products = []
    restoreBackupPayload(backup, stores)
    expect(store.products[0].barcode).toBe(generated.product.barcode)
    const reloaded = await adapter.loadProducts()
    expect(reloaded.products[0].barcode).toBe(generated.product.barcode)
    tracker.dispose()
    await service.close()
  })
})

describe('barcode sync contract', () => {
  it('sends code separately from generated sync SKU; gates the new action by capability', async () => {
    const adapter = createMemoryAdapter()
    await adapter.initialize()
    const entry = {
      id: 'q1',
      entityType: 'product',
      entityId: id,
      operation: 'upsert',
      payload: { ...productData, id },
    }
    const legacy = await mapOutboxEntries([entry], { adapter })
    expect(legacy.changes.products[0].barcode).toBe(productData.barcode)
    expect(legacy.changes.products[0].sku).not.toBe(productData.barcode)
    expect(legacy.changes.products[0]).not.toHaveProperty('barcode_action')
    const modern = await mapOutboxEntries([entry], {
      adapter,
      catalogCapabilities: { product_barcode_v1: true },
    })
    expect(modern.changes.products[0].barcode_action).toBe('set')
    const blank = await mapOutboxEntries(
      [{ ...entry, payload: { ...entry.payload, barcode: '' } }],
      { adapter },
    )
    expect(blank.changes.products[0]).not.toHaveProperty('barcode')
    const invalid = await mapOutboxEntries(
      [{ ...entry, payload: { ...entry.payload, barcode: 123 } }],
      { adapter },
    )
    expect(invalid.blocked[0].code).toBe('INVALID_PRODUCT_BARCODE')
  })

  it('pulls code separately, preserves it for a missing legacy field, and accepts explicit null', async () => {
    const adapter = createMemoryAdapter()
    await adapter.initialize()
    const store = useProductStore()
    store.products = [{ ...productData, id }]
    const context = {
      user: { id: 1 },
      selectedBusiness: { id: 10 },
      selectedOutlet: { id: 101 },
      cloudAccess: true,
      deviceIdentifier: '11111111-1111-4111-8111-111111111111',
      registeredDeviceId: 55,
    }
    await adapter.saveSyncPushBinding({
      businessId: 10,
      deviceIdentifier: context.deviceIdentifier,
      registeredDeviceId: 55,
      boundAt: new Date().toISOString(),
    })
    let version = 0
    let barcode = '00000999'
    const service = createSyncPullService({
      adapter,
      tokenFetcher: async () => 'test',
      transport: async () => {
        version++
        const data = {
          ...productData,
          sync_id: id,
          sync_version: version,
          sku: 'SERVER-SKU',
          status: 'active',
        }
        delete data.barcode
        if (barcode !== undefined) data.barcode = barcode
        return {
          ok: true,
          status: 200,
          data: {
            data: {
              records: [{ entity: 'products', sync_sequence: version, data }],
              next_cursor: version,
              server_sequence: version,
              has_more: false,
            },
          },
        }
      },
    })
    expect(await service.pullNow({ context })).toMatchObject({ ok: true })
    expect(store.getProductById(id)).toMatchObject({ sku: 'SERVER-SKU', barcode: '00000999' })
    barcode = undefined
    expect(await service.pullNow({ context })).toMatchObject({ ok: true })
    expect(store.getProductById(id).barcode).toBe('00000999')
    barcode = null
    expect(await service.pullNow({ context })).toMatchObject({ ok: true })
    expect(store.getProductById(id).barcode).toBe('')
  })
})

async function mountRetailView(component = PosView, path = '/pos') {
  useCashierStore().setPinConfigured(true)
  const router = createAppRouter()
  await router.push(path)
  const wrapper = mount(component, {
    global: {
      plugins: [router],
      stubs: { ProductScannerSheet: true, ProductQrModal: true, ProductVariantSheet: true },
    },
  })
  wrappers.push(wrapper)
  await flushPromises()
  return wrapper
}

describe('retail scanner UI integration', () => {
  it('adds by exact code despite filters, increments a repeated scan and leaves stock untouched', async () => {
    const products = useProductStore()
    products.products = [{ ...productData, id }]
    products.setSearchQuery('no matches')
    const wrapper = await mountRetailView()
    for (let index = 0; index < 2; index++) {
      await wrapper.get('[data-testid="pos-scan-button"]').trigger('click')
      wrapper.findComponent(ProductScannerSheet).vm.$emit('scanned', productData.barcode)
      await flushPromises()
    }
    expect(useCartStore().items).toHaveLength(1)
    expect(useCartStore().items[0].qty).toBe(2)
    expect(useCartStore().total).toBeGreaterThanOrEqual(130000)
    expect(products.products[0].stock).toBe(12)
  })

  it('requires variant confirmation and cancels a scanner on business change', async () => {
    useProductStore().products = [{ ...productData, id, variantGroupIds: ['g1'] }]
    useVariantStore().groups = [{ id: 'g1', status: 'active', options: [] }]
    const wrapper = await mountRetailView()
    await wrapper.get('[data-testid="pos-scan-button"]').trigger('click')
    wrapper.findComponent(ProductScannerSheet).vm.$emit('scanned', productData.barcode)
    await flushPromises()
    expect(useCartStore().items).toHaveLength(0)
    expect(wrapper.findComponent(ProductVariantSheet).props('open')).toBe(true)
    wrapper.findComponent(ProductVariantSheet).vm.$emit('close')
    await flushPromises()
    expect(useCartStore().items).toHaveLength(0)
    await wrapper.get('[data-testid="pos-scan-button"]').trigger('click')
    useBusinessStore().setBusiness({ type: 'Cafe' })
    await flushPromises()
    expect(wrapper.findComponent(ProductScannerSheet).props('open')).toBe(false)
    expect(wrapper.find('[data-testid="pos-scan-button"]').exists()).toBe(false)
  })

  it('fills the product form without saving or adding a cart item, and exposes QR on the catalog', async () => {
    const wrapper = await mountRetailView(ProductFormView, '/products/create')
    await wrapper.get('[data-testid="product-barcode-scan"]').trigger('click')
    wrapper.findComponent(ProductScannerSheet).vm.$emit('scanned', '0012345')
    await flushPromises()
    expect(wrapper.get('[data-testid="product-barcode-input"]').element.value).toBe('0012345')
    expect(useProductStore().products).toHaveLength(0)
    expect(useCartStore().items).toHaveLength(0)
    useProductStore().products = [{ ...productData, id }]
    const catalog = await mountRetailView(ProductsView, '/products')
    expect(catalog.find(`[data-testid="product-qr-${id}"]`).exists()).toBe(true)
    useBusinessStore().setBusiness({ type: 'Laundry' })
    await flushPromises()
    expect(catalog.find(`[data-testid="product-qr-${id}"]`).exists()).toBe(false)
  })
})
