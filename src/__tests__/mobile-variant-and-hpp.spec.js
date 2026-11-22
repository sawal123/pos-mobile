import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { mount, flushPromises } from '@vue/test-utils'
import VariantManagerModal from '@/components/products/VariantManagerModal.vue'
import IngredientManagerModal from '@/components/products/IngredientManagerModal.vue'
import ProductFormView from '@/views/products/ProductFormView.vue'
import { createAppRouter } from '@/router'
import { useBusinessStore } from '@/stores/businessStore'
import { useCashierStore } from '@/stores/cashierStore'
import { useCloudSessionStore } from '@/stores/cloudSessionStore'
import { useSubscriptionStore } from '@/stores/subscriptionStore'
import { useVariantStore } from '@/stores/variantStore'
import { useIngredientStore } from '@/stores/ingredientStore'
import { useProductStore } from '@/stores/productStore'
import { createMemoryAdapter } from '@/services/database/memoryAdapter'
import { createPersistenceService } from '@/services/database/persistenceService'

describe('Mobile POS Variant & HPP/Ingredient Feature', () => {
  let pinia
  let memoryAdapter
  let variantStore
  let ingredientStore
  let productStore
  let cloudStore

  beforeEach(async () => {
    pinia = createPinia()
    setActivePinia(pinia)

    memoryAdapter = createMemoryAdapter()
    await memoryAdapter.initialize()

    createPersistenceService({ adapter: memoryAdapter, pinia })

    variantStore = useVariantStore()
    ingredientStore = useIngredientStore()
    productStore = useProductStore()
    cloudStore = useCloudSessionStore()

    // Enable Cloud context for these tests
    cloudStore.user = { id: 1, email: 'owner@cafe.test' }
    cloudStore.cloudAccess = true
    cloudStore.token = 'test-token'
  })

  it('1. VariantManagerModal allows creating and saving variant groups in mobile POS', async () => {
    const wrapper = mount(VariantManagerModal, {
      props: { open: true },
      global: { plugins: [pinia] },
    })

    expect(wrapper.find('[data-testid="variant-manager-list"]').exists()).toBe(true)

    // Click "+ Tambah Varian"
    const addBtn = wrapper.find('[data-testid="btn-add-variant-group"]')
    expect(addBtn.exists()).toBe(true)
    await addBtn.trigger('click')

    expect(wrapper.find('[data-testid="variant-manager-form"]').exists()).toBe(true)

    // Fill form
    const inputs = wrapper.findAll('input[type="text"]')
    // First text input is group name
    await inputs[0].setValue('Ukuran Cup')

    // Option inputs (2 options default)
    await inputs[1].setValue('Regular')
    await inputs[2].setValue('Large')

    const numberInputs = wrapper.findAll('input[type="number"]')
    await numberInputs[1].setValue(5000) // Large +Rp 5.000

    // Save
    const saveBtn = wrapper.find('[data-testid="btn-save-variant-group"]')
    await saveBtn.trigger('click')

    // Verify stored in variantStore
    expect(variantStore.groups).toHaveLength(1)
    const savedGroup = variantStore.groups[0]
    expect(savedGroup.name).toBe('Ukuran Cup')
    expect(savedGroup.options).toHaveLength(2)
    expect(savedGroup.options[0].name).toBe('Regular')
    expect(savedGroup.options[1].name).toBe('Large')
    expect(savedGroup.options[1].priceAdjustment).toBe(5000)
  })

  it('2. IngredientManagerModal allows creating raw materials and restocking', async () => {
    const wrapper = mount(IngredientManagerModal, {
      props: { open: true },
      global: { plugins: [pinia] },
    })

    expect(wrapper.find('[data-testid="ingredient-manager-container"]').exists()).toBe(true)

    // Click "+ Tambah Bahan"
    const addBtn = wrapper.find('[data-testid="btn-add-ingredient"]')
    expect(addBtn.exists()).toBe(true)
    await addBtn.trigger('click')

    expect(wrapper.find('[data-testid="ingredient-form"]').exists()).toBe(true)

    // Fill new ingredient
    const nameInput = wrapper.find('input[placeholder*="Biji Kopi"]')
    await nameInput.setValue('Biji Kopi Gayo')

    const numberInputs = wrapper.findAll('input[type="number"]')
    await numberInputs[0].setValue(180) // Cost per unit (Rp 180 / gram)
    await numberInputs[1].setValue(1000) // Initial stock (1000 gram)
    await numberInputs[2].setValue(200) // Min stock (200 gram)

    // Save
    await wrapper.find('[data-testid="btn-save-ingredient"]').trigger('click')

    expect(ingredientStore.ingredients).toHaveLength(1)
    const ing = ingredientStore.ingredients[0]
    expect(ing.name).toBe('Biji Kopi Gayo')
    expect(ing.costPerUnit).toBe(180)
    expect(ing.stock).toBe(1000)

    // Restock 500 gram
    ingredientStore.adjustStock(ing.id, {
      quantityChange: 500,
      type: 'in',
      category: 'Restock',
      note: 'Beli tambahan kopi',
    })

    expect(ingredientStore.getIngredientById(ing.id).stock).toBe(1500)
    expect(ingredientStore.movements).toHaveLength(2)
  })

  it('3. ProductFormView allows configuring variants and calculating HPP from recipe in mobile', async () => {
    const businessStore = useBusinessStore()
    const cashierStore = useCashierStore()
    businessStore.setBusiness({
      name: 'Cafe Nusantara',
      type: 'Cafe',
      owner: 'Owner',
      phone: '08123456789',
      outlet: 'Utama',
      mode: 'cloud',
    })
    cashierStore.setPinConfigured(true)

    // Seed 1 variant group and 2 ingredients
    variantStore.setGroups([
      {
        id: 'vg-cup',
        syncId: 'sync-vg-cup',
        name: 'Ukuran Cup',
        selectionType: 'single',
        isRequired: true,
        options: [
          { id: 'opt-reg', name: 'Reguler', priceAdjustment: 0 },
          { id: 'opt-lrg', name: 'Large', priceAdjustment: 5000 },
        ],
      },
    ])

    const kopi = ingredientStore.saveIngredient({
      name: 'Biji Kopi Espresso',
      unit: 'gram',
      costPerUnit: 180,
      stock: 2000,
    })
    const susu = ingredientStore.saveIngredient({
      name: 'Susu UHT',
      unit: 'ml',
      costPerUnit: 22,
      stock: 5000,
    })

    const router = createAppRouter()
    await router.push('/products/create')
    await router.isReady()

    const wrapper = mount(ProductFormView, {
      global: {
        plugins: [pinia, router],
        stubs: { teleport: true },
      },
    })

    // Cloud Active Sections must be visible
    expect(wrapper.find('[data-testid="product-form-variants-cloud"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="product-form-hpp-cloud"]').exists()).toBe(true)

    // Toggle variant group for this product
    const variantCard = wrapper.find('[data-testid="product-form-variants-cloud"] .cursor-pointer')
    expect(variantCard.exists()).toBe(true)
    await variantCard.trigger('click')

    // Add first recipe item
    const addRecipeBtn = wrapper.find('[data-testid="btn-add-first-recipe-item"]')
    expect(addRecipeBtn.exists()).toBe(true)
    await addRecipeBtn.trigger('click')

    // Select Kopi (18 gram)
    const selects = wrapper.findAll('[data-testid="product-form-hpp-cloud"] select')
    await selects[0].setValue(kopi.id)

    const qtyInputs = wrapper.findAll('[data-testid="product-form-hpp-cloud"] input[type="number"]')
    await qtyInputs[0].setValue(18) // 18 gram * 180 = Rp 3.240

    // Add second recipe item (Susu 120 ml)
    await wrapper.find('[data-testid="btn-add-recipe-row"]').trigger('click')
    const selectsUpdated = wrapper.findAll('[data-testid="product-form-hpp-cloud"] select')
    await selectsUpdated[1].setValue(susu.id)

    const qtyInputsUpdated = wrapper.findAll('[data-testid="product-form-hpp-cloud"] input[type="number"]')
    await qtyInputsUpdated[1].setValue(120) // 120 ml * 22 = Rp 2.640

    // Total Recipe Cost should be: 3240 + 2640 = 5880
    expect(wrapper.find('[data-testid="total-recipe-cost"]').text()).toContain('5.880')

    // Click "Gunakan Sebagai HPP"
    const applyHppBtn = wrapper.find('[data-testid="btn-apply-recipe-hpp"]')
    expect(applyHppBtn.exists()).toBe(true)
    await applyHppBtn.trigger('click')

    // Fill product basic info and submit
    const nameInput = wrapper.find('input[placeholder*="Kopi Susu Aren"]')
    await nameInput.setValue('Kopi Susu Spesial')

    const priceInput = wrapper.find('input[placeholder="0"]')
    await priceInput.setValue(20000)

    await wrapper.find('form').trigger('submit.prevent')
    await flushPromises()

    // Assert product was created with cost, variantGroupIds, and recipe
    const createdProduct = productStore.products.find((p) => p.name === 'Kopi Susu Spesial')
    expect(createdProduct).toBeDefined()
    expect(createdProduct.cost).toBe(5880)
    expect(createdProduct.variantGroupIds).toContain('vg-cup')

    // Recipe should be saved in ingredientStore
    const savedRecipe = ingredientStore.getRecipe(createdProduct.id)
    expect(savedRecipe).toHaveLength(2)
    expect(savedRecipe[0].ingredientId).toBe(kopi.id)
    expect(savedRecipe[0].quantity).toBe(18)
    expect(savedRecipe[1].ingredientId).toBe(susu.id)
    expect(savedRecipe[1].quantity).toBe(120)
  })

  it('4. Sale stock deduction automatically deducts product recipe ingredients in real-time', () => {
    // 1. Setup raw ingredients
    const bijiKopi = ingredientStore.saveIngredient({
      id: 'ing-biji',
      name: 'Biji Kopi',
      unit: 'gram',
      costPerUnit: 150,
      stock: 1000,
    })
    const susu = ingredientStore.saveIngredient({
      id: 'ing-susu',
      name: 'Susu',
      unit: 'ml',
      costPerUnit: 20,
      stock: 2000,
    })

    // 2. Setup product with recipe
    const product = {
      id: 'prod-latte-1',
      name: 'Caffe Latte',
      kind: 'product',
      price: 25000,
      cost: 5700,
      stock: 100,
    }
    productStore.products = [product]

    ingredientStore.setProductRecipe('prod-latte-1', [
      { ingredientId: 'ing-biji', quantity: 18, unit: 'gram' },
      { ingredientId: 'ing-susu', quantity: 150, unit: 'ml' },
    ])

    // 3. Simulate sale of 2 cups of Caffe Latte
    const saleItems = [
      {
        id: 'prod-latte-1',
        productId: 'prod-latte-1',
        name: 'Caffe Latte',
        price: 25000,
        qty: 2,
      },
    ]

    productStore.recordSaleStock(saleItems, 'INV-SALE-001')

    // Main product stock: 100 - 2 = 98
    expect(productStore.getProductById('prod-latte-1').stock).toBe(98)

    // Biji Kopi: 1000 - (18 * 2) = 964
    expect(ingredientStore.getIngredientById('ing-biji').stock).toBe(964)

    // Susu: 2000 - (150 * 2) = 1700
    expect(ingredientStore.getIngredientById('ing-susu').stock).toBe(1700)

    // Ingredient movements should be recorded
    const movements = ingredientStore.movements.filter((m) => m.referenceId === 'INV-SALE-001')
    expect(movements).toHaveLength(2)
  })
})
