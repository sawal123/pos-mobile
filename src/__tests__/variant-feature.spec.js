import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { mount, flushPromises } from '@vue/test-utils'
import ProductVariantSheet from '@/components/pos/ProductVariantSheet.vue'
import ProductsView from '@/views/products/ProductsView.vue'
import ProductFormView from '@/views/products/ProductFormView.vue'
import { createAppRouter } from '@/router'
import { useBusinessStore } from '@/stores/businessStore'
import { useCashierStore } from '@/stores/cashierStore'
import { useVariantStore } from '@/stores/variantStore'
import { useCartStore } from '@/stores/cartStore'
import { useProductStore } from '@/stores/productStore'
import { createMemoryAdapter } from '@/services/database/memoryAdapter'
import { createPersistenceService } from '@/services/database/persistenceService'
import { mapOutboxEntries } from '@/services/sync/contractMapper'
import { createSyncPullService } from '@/services/sync/syncPullService'
import { createSyncQueueService } from '@/services/sync/syncQueueService'
import { createSyncIdentityRegistry } from '@/services/sync/syncIdentityRegistry'

describe('Product Variants Feature - Mobile POS', () => {
  let pinia
  let variantStore
  let cartStore
  let productStore
  let memoryAdapter

  beforeEach(async () => {
    pinia = createPinia()
    setActivePinia(pinia)

    memoryAdapter = createMemoryAdapter()
    await memoryAdapter.initialize()

    createPersistenceService({ adapter: memoryAdapter, pinia })

    variantStore = useVariantStore()
    cartStore = useCartStore()
    productStore = useProductStore()
  })

  it('1. variantStore filters active groups and associates with products', () => {
    variantStore.setGroups([
      {
        id: 'group-sugar',
        syncId: 'sync-sugar',
        name: 'Level Gula',
        selectionType: 'single',
        isRequired: true,
        sortOrder: 1,
        status: 'active',
        options: [
          { id: 'opt-no-sugar', name: 'No Sugar', priceAdjustment: 0 },
          { id: 'opt-less-sugar', name: 'Less Sugar', priceAdjustment: 0 },
        ],
      },
      {
        id: 'group-topping',
        syncId: 'sync-topping',
        name: 'Topping',
        selectionType: 'multiple',
        isRequired: false,
        sortOrder: 2,
        status: 'active',
        options: [
          { id: 'opt-boba', name: 'Boba', priceAdjustment: 3000 },
          { id: 'opt-jelly', name: 'Grass Jelly', priceAdjustment: 2000 },
        ],
      },
      {
        id: 'group-deleted',
        syncId: 'sync-deleted',
        name: 'Deleted Group',
        status: 'deleted',
        options: [],
      },
    ])

    const productWithVariants = {
      id: 'prod-latte',
      name: 'Iced Latte',
      price: 20000,
      variantGroupIds: ['group-sugar', 'group-topping', 'group-deleted'],
    }

    const productWithoutVariants = {
      id: 'prod-croissant',
      name: 'Croissant',
      price: 15000,
      variantGroupIds: [],
    }

    expect(variantStore.hasVariants(productWithVariants)).toBe(true)
    expect(variantStore.hasVariants(productWithoutVariants)).toBe(false)

    const groups = variantStore.getProductVariantGroups(productWithVariants)
    expect(groups).toHaveLength(2)
    expect(groups[0].name).toBe('Level Gula')
    expect(groups[1].name).toBe('Topping')
  })

  it('2. cartStore adds item with variants, adjusts price, and builds summary', () => {
    const product = {
      id: 'prod-latte',
      name: 'Iced Latte',
      price: 20000,
      cost: 8000,
    }

    const selectedOptions = [
      { id: 'opt-less-sugar', name: 'Less Sugar', priceAdjustment: 0, costAdjustment: 0 },
      { id: 'opt-boba', name: 'Boba', priceAdjustment: 3000, costAdjustment: 1000 },
    ]

    cartStore.addItem(product, selectedOptions)

    expect(cartStore.items).toHaveLength(1)
    const cartItem = cartStore.items[0]

    expect(cartItem.id).toBe('prod-latte::opt-boba-opt-less-sugar')
    expect(cartItem.price).toBe(23000)
    expect(cartItem.costSnapshot).toBe(9000)
    expect(cartItem.variant_summary).toContain('Less Sugar')
    expect(cartItem.variant_summary).toContain('Boba (+Rp 3.000)')
    expect(cartItem.variants_snapshot).toHaveLength(2)

    // Adding same product with different variant creates a separate line
    const differentOptions = [
      { id: 'opt-no-sugar', name: 'No Sugar', priceAdjustment: 0, costAdjustment: 0 },
    ]
    cartStore.addItem(product, differentOptions)

    expect(cartStore.items).toHaveLength(2)
    expect(cartStore.items[1].id).toBe('prod-latte::opt-no-sugar')
    expect(cartStore.items[1].price).toBe(20000)

    // Adding same product with same variant increments quantity
    cartStore.addItem(product, selectedOptions)
    expect(cartStore.items).toHaveLength(2)
    expect(cartStore.items[0].qty).toBe(2)
  })

  it('3. productStore deducts both product and variant ingredient stocks on sale', () => {
    // 1. Setup products: sellable drink + raw ingredient
    productStore.products = [
      {
        id: 'prod-espresso',
        syncId: 'sync-prod-espresso',
        name: 'Espresso',
        kind: 'product',
        price: 20000,
        stock: 50,
      },
      {
        id: 'prod-ing-milk',
        syncId: 'sync-prod-milk',
        name: 'Fresh Milk',
        kind: 'product',
        price: 0,
        stock: 1000, // 1000 ml
        unit: 'ml',
      },
    ]

    // 2. Transaction items containing variant with ingredient deduction
    const transactionItems = [
      {
        id: 'prod-espresso::extra-milk',
        productId: 'prod-espresso',
        name: 'Espresso',
        price: 25000,
        qty: 2,
        variants_snapshot: [
          {
            name: 'Extra Fresh Milk',
            ingredient_product_id: 'prod-ing-milk',
            ingredient_quantity: 150, // 150ml per cup
          },
        ],
      },
    ]

    // 3. Record sale stock
    productStore.recordSaleStock(transactionItems, 'INV-TEST-001')

    // 4. Assert stock deduction
    const espresso = productStore.getProductById('prod-espresso')
    const milk = productStore.getProductById('prod-ing-milk')

    // Espresso: 50 - 2 = 48
    expect(espresso.stock).toBe(48)
    // Milk: 1000 - (150 * 2) = 700
    expect(milk.stock).toBe(700)

    // Verify stock movements were recorded
    expect(productStore.stockMovements).toHaveLength(2)
    const milkMovement = productStore.stockMovements.find((m) => m.productId === 'prod-ing-milk')
    expect(milkMovement).toBeDefined()
    expect(milkMovement.quantityChange).toBe(-300)
    expect(milkMovement.type).toBe('sale')
    expect(milkMovement.category).toBe('Penjualan (Varian)')
  })

  it('4. contractMapper includes variant_summary and variants_snapshot in sale_items change payload', async () => {
    const outboxEntries = [
      {
        id: 'queue-trx-1',
        entityType: 'transaction',
        entityId: 'trx-1',
        operation: 'upsert',
        payload: {
          id: 'trx-1',
          invoiceNumber: 'INV-001',
          status: 'paid',
          subtotal: 25000,
          total: 25000,
          createdAt: new Date().toISOString(),
          items: [
            {
              id: 'prod-1::opt-1',
              productId: 'prod-1',
              name: 'Americano',
              price: 25000,
              qty: 1,
              variant_summary: 'Less Sugar',
              variants_snapshot: [{ name: 'Less Sugar', price_adjustment: 0 }],
            },
          ],
        },
      },
    ]

    const mapped = await mapOutboxEntries(outboxEntries, { adapter: memoryAdapter })
    expect(mapped.blocked).toHaveLength(0)
    expect(mapped.changes.sale_items).toHaveLength(1)

    const saleItem = mapped.changes.sale_items[0]
    expect(saleItem.variant_summary).toBe('Less Sugar')
    expect(saleItem.variants_snapshot).toEqual([{ name: 'Less Sugar', price_adjustment: 0 }])
  })

  it('5. ProductVariantSheet renders options, updates dynamic total, and emits confirm', async () => {
    const product = {
      id: 'prod-latte',
      name: 'Iced Latte',
      price: 20000,
    }

    const variantGroups = [
      {
        id: 'group-sugar',
        name: 'Level Gula',
        selectionType: 'single',
        isRequired: true,
        options: [
          { id: 'opt-normal', name: 'Normal Sugar', priceAdjustment: 0, isDefault: true },
          { id: 'opt-less', name: 'Less Sugar', priceAdjustment: 0, isDefault: false },
        ],
      },
      {
        id: 'group-topping',
        name: 'Topping',
        selectionType: 'multiple',
        isRequired: false,
        maxSelection: 2,
        options: [
          { id: 'opt-boba', name: 'Boba', priceAdjustment: 3000, isDefault: false },
          { id: 'opt-pudding', name: 'Egg Pudding', priceAdjustment: 4000, isDefault: false },
        ],
      },
    ]

    const wrapper = mount(ProductVariantSheet, {
      props: {
        open: true,
        product,
        variantGroups,
      },
    })

    expect(wrapper.text()).toContain('Iced Latte')
    expect(wrapper.text()).toContain('Level Gula')
    expect(wrapper.text()).toContain('Topping')
    expect(wrapper.text()).toContain('3.000')

    // Initial total is 20.000 (normal sugar default is 0)
    expect(wrapper.text()).toContain('20.000')

    // Click Boba topping button
    const buttons = wrapper.findAll('button')
    const bobaButton = buttons.find((b) => b.text().includes('Boba'))
    expect(bobaButton).toBeDefined()
    await bobaButton.trigger('click')

    // Total becomes 20.000 + 3.000 = 23.000
    expect(wrapper.text()).toContain('23.000')

    // Click confirm button
    const confirmButton = wrapper.find('[data-testid="confirm-variant-button"]')
    expect(confirmButton.attributes('disabled')).toBeUndefined()
    await confirmButton.trigger('click')

    expect(wrapper.emitted('confirm')).toHaveLength(1)
    const emittedPayload = wrapper.emitted('confirm')[0][0]
    expect(emittedPayload.product.id).toBe('prod-latte')
    expect(emittedPayload.selectedOptions).toHaveLength(2) // Normal Sugar + Boba
    expect(emittedPayload.selectedOptions.some((o) => o.id === 'opt-normal')).toBe(true)
    expect(emittedPayload.selectedOptions.some((o) => o.id === 'opt-boba')).toBe(true)
  })

  it('6. syncPullService pulls variant_groups and associates them with product', async () => {
    const catUuid = '00000000-0000-4000-8000-000000000000'
    const vgUuid = '11111111-1111-4111-8111-111111111111'
    const prodUuid = '22222222-2222-4222-8222-222222222222'

    const transport = async () => ({
      ok: true,
      status: 200,
      data: {
        data: {
          records: [
            {
              entity: 'categories',
              sync_sequence: 5,
              data: {
                sync_id: catUuid,
                sync_version: 1,
                name: 'Coffee',
                status: 'active',
              },
            },
            {
              entity: 'variant_groups',
              sync_sequence: 10,
              data: {
                sync_id: vgUuid,
                sync_version: 1,
                name: 'Suhu Minuman',
                selection_type: 'single',
                is_required: true,
                min_selection: 1,
                max_selection: 1,
                sort_order: 1,
                status: 'active',
                options: [
                  {
                    sync_id: '33333333-3333-4333-8333-333333333333',
                    sync_version: 1,
                    name: 'Ice',
                    price_adjustment: 2000,
                    cost_adjustment: 500,
                    ingredient_product_sync_id: null,
                    ingredient_quantity: 0,
                    is_default: true,
                    sort_order: 1,
                    status: 'active',
                  },
                ],
              },
            },
            {
              entity: 'products',
              sync_sequence: 20,
              data: {
                sync_id: prodUuid,
                sync_version: 1,
                category_sync_id: catUuid,
                name: 'Americano',
                sku: 'AME-01',
                price: 18000,
                kind: 'product',
                is_sellable: true,
                cost: 5000,
                stock: 20,
                unit: 'cup',
                status: 'active',
                variant_group_sync_ids: [vgUuid],
              },
            },
          ],
          next_cursor: 20,
          server_sequence: 20,
          has_more: false,
        },
      },
    })

    const queueService = createSyncQueueService({ adapter: memoryAdapter })
    const registry = createSyncIdentityRegistry({ adapter: memoryAdapter })
    await registry.bindSyncId('business', '1', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')
    await memoryAdapter.saveSyncPushBinding({
      businessId: 1,
      deviceIdentifier: '123e4567-e89b-12d3-a456-426614174000',
      registeredDeviceId: 55,
      boundAt: new Date().toISOString(),
    })

    const pullService = createSyncPullService({
      adapter: memoryAdapter,
      queueService,
      registry,
      pinia,
      tokenFetcher: async () => 'test-token',
      transport,
    })

    const context = {
      user: { id: 1, email: 'owner@pos.test' },
      selectedBusiness: { id: 1, name: 'Warung Kopi' },
      selectedOutlet: { id: 1, name: 'Main' },
      cloudAccess: true,
      deviceIdentifier: '123e4567-e89b-12d3-a456-426614174000',
      registeredDeviceId: 55,
    }

    const result = await pullService.pullNow({ context })
    expect(result.ok).toBe(true)
    expect(result.applied).toBe(3)

    expect(variantStore.groups).toHaveLength(1)
    expect(variantStore.groups[0].name).toBe('Suhu Minuman')
    expect(variantStore.groups[0].options).toHaveLength(1)
    expect(variantStore.groups[0].options[0].name).toBe('Ice')

    const product = productStore.products.find((p) => p.id === prodUuid)
    expect(product).toBeDefined()
    expect(product.variantGroupIds).toEqual([vgUuid])
    expect(variantStore.hasVariants(product)).toBe(true)
  })

  it('7. ProductsView shows locked Varian button and opens Upgrade ke Paket Cloud modal when not on Cloud', async () => {
    const businessStore = useBusinessStore()
    const cashierStore = useCashierStore()
    businessStore.setBusiness({
      name: 'Kedai Kopi Lokal',
      type: 'Cafe',
      owner: 'Owner',
      phone: '08123456789',
      outlet: 'Utama',
      mode: 'free',
    })
    cashierStore.setPinConfigured(true)

    const router = createAppRouter()
    await router.push('/products')
    await router.isReady()

    const wrapper = mount(ProductsView, {
      global: {
        plugins: [pinia, router],
        stubs: {
          teleport: true,
        },
      },
    })

    const variantBtn = wrapper.find('[data-testid="products-variants-btn"]')
    expect(variantBtn.exists()).toBe(true)
    expect(variantBtn.text()).toContain('Varian')

    await variantBtn.trigger('click')

    const lockModal = wrapper.find('[data-testid="variant-cloud-lock-modal"]')
    expect(lockModal.exists()).toBe(true)
    expect(lockModal.text()).toContain('Penambahan Varian Menu Terkunci')
    expect(lockModal.text()).toContain('upgrade ke Paket Cloud')

    const upgradeBtn = wrapper.find('[data-testid="variant-lock-upgrade-btn"]')
    expect(upgradeBtn.exists()).toBe(true)
    await upgradeBtn.trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.name).toBe('subscription')
  })

  it('8. ProductFormView shows locked Varian Menu section with lock icon and Upgrade ke Paket Cloud CTA when not on Cloud', async () => {
    const businessStore = useBusinessStore()
    const cashierStore = useCashierStore()
    businessStore.setBusiness({
      name: 'Kedai Kopi Lokal',
      type: 'Cafe',
      owner: 'Owner',
      phone: '08123456789',
      outlet: 'Utama',
      mode: 'free',
    })
    cashierStore.setPinConfigured(true)

    const router = createAppRouter()
    await router.push('/products/create')
    await router.isReady()

    const wrapper = mount(ProductFormView, {
      global: {
        plugins: [pinia, router],
        stubs: {
          teleport: true,
        },
      },
    })

    const lockedSection = wrapper.find('[data-testid="product-form-variants-locked"]')
    expect(lockedSection.exists()).toBe(true)
    expect(lockedSection.text()).toContain('Penambahan Varian Menu Terkunci')
    expect(lockedSection.text()).toContain('upgrade ke Paket Cloud')

    const lockedAddBtn = wrapper.find('[data-testid="btn-locked-add-variant"]')
    expect(lockedAddBtn.exists()).toBe(true)
    await lockedAddBtn.trigger('click')
    expect(wrapper.find('[data-testid="variant-cloud-lock-modal"]').exists()).toBe(true)

    const upgradeBtn = wrapper.find('[data-testid="btn-upgrade-cloud-variant"]')
    expect(upgradeBtn.exists()).toBe(true)
    await upgradeBtn.trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.name).toBe('subscription')
  })
})
