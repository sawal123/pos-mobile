import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { useCloudSessionStore } from '@/stores/cloudSessionStore'
import { usePromoStore } from '@/stores/promoStore'
import { useProductStore } from '@/stores/productStore'
import { useCustomerStore } from '@/stores/customerStore'
import SettingsView from '@/views/settings/SettingsView.vue'
import PromosView from '@/views/promos/PromosView.vue'
import ProductsView from '@/views/products/ProductsView.vue'
import CustomersView from '@/views/customers/CustomersView.vue'

describe('Cashier Role Restrictions in Mobile', () => {
  let pinia
  let cloudStore
  let promoStore
  let productStore
  let customerStore

  beforeEach(() => {
    pinia = createPinia()
    setActivePinia(pinia)

    cloudStore = useCloudSessionStore()
    promoStore = usePromoStore()
    productStore = useProductStore()
    customerStore = useCustomerStore()
  })

  describe('1. Promo Store & PromosView for Cashier', () => {
    it('blocks cashier from creating, toggling, or removing promos', () => {
      // Mock cashier context
      cloudStore.role = 'cashier'

      // Prepopulate an existing promo
      promoStore.setPromos([
        {
          id: 'promo-1',
          syncId: 'promo-1',
          name: 'Diskon 10%',
          discountType: 'percentage',
          discountValue: 10,
          status: 'active',
        },
      ])

      // 1. Cannot create
      expect(() => {
        promoStore.createPromo({
          name: 'Promo Baru',
          discountType: 'fixed',
          discountValue: 5000,
        })
      }).toThrow(/Kasir tidak diizinkan/i)

      // 2. Cannot toggle
      const toggleResult = promoStore.togglePromoStatus('promo-1')
      expect(toggleResult).toBeNull()
      expect(promoStore.promos[0].status).toBe('active')

      // 3. Cannot remove
      promoStore.removePromo('promo-1')
      expect(promoStore.promos).toHaveLength(1)
    })

    it('allows owner/member to create, toggle, and remove promos', () => {
      cloudStore.role = 'owner'

      const created = promoStore.createPromo({
        name: 'Diskon Owner',
        discountType: 'fixed',
        discountValue: 5000,
        status: 'active',
      })
      expect(created.name).toBe('Diskon Owner')
      expect(promoStore.promos).toHaveLength(1)

      const nextStatus = promoStore.togglePromoStatus(created.id)
      expect(nextStatus).toBe('inactive')

      promoStore.removePromo(created.id)
      expect(promoStore.promos).toHaveLength(0)
    })

    it('hides create button, toggle button, and delete button in PromosView for cashier', async () => {
      cloudStore.role = 'cashier'
      promoStore.setPromos([
        {
          id: 'promo-1',
          syncId: 'promo-1',
          name: 'Promo Test',
          discountType: 'percentage',
          discountValue: 10,
          status: 'active',
        },
      ])

      const router = createRouter({
        history: createMemoryHistory(),
        routes: [{ path: '/promos', component: PromosView }],
      })

      const wrapper = mount(PromosView, {
        global: {
          plugins: [pinia, router],
          stubs: {
            PromoCreateModal: true,
            BaseCard: { template: '<div><slot /></div>' },
            BaseButton: { template: '<button><slot /></button>' },
            BaseBadge: { template: '<span><slot /></span>' },
          },
        },
      })

      expect(wrapper.vm.isCashier).toBe(true)
      // Header Create button is hidden
      expect(wrapper.find('button[class*="shadow-sm"]').exists()).toBe(false)
      // Card actions (toggle & delete) are hidden
      expect(wrapper.text()).not.toContain('Nonaktifkan')
      expect(wrapper.find('button[title="Hapus Promo"]').exists()).toBe(false)
    })
  })

  describe('2. Product Store & ProductsView for Cashier', () => {
    it('blocks cashier from CRUD on products and categories in productStore', () => {
      cloudStore.role = 'cashier'

      productStore.products = [
        {
          id: 'p-1',
          name: 'Kopi Susu',
          price: 15000,
          category: 'Kopi',
          isActive: true,
        },
      ]
      productStore.categories = ['Kopi', 'Makanan']

      // 1. Cannot create product
      const createRes = productStore.createProduct({
        name: 'Teh Manis',
        price: 5000,
        category: 'Kopi',
      })
      expect(createRes.success).toBe(false)
      expect(createRes.errors.form).toMatch(/Kasir tidak diizinkan/i)

      // 2. Cannot update product
      const updateRes = productStore.updateProduct('p-1', {
        name: 'Kopi Susu Gula Aren',
        price: 18000,
      })
      expect(updateRes.success).toBe(false)
      expect(updateRes.errors.form).toMatch(/Kasir tidak diizinkan/i)

      // 3. Cannot delete product
      const delRes = productStore.deleteProduct('p-1')
      expect(delRes).toBe(false)
      expect(productStore.products).toHaveLength(1)

      // 4. Cannot create category
      const catCreateRes = productStore.createCategory('Snack')
      expect(catCreateRes.success).toBe(false)
      expect(catCreateRes.error).toMatch(/Kasir tidak diizinkan/i)

      // 5. Cannot update category
      const catUpdateRes = productStore.updateCategory('Kopi', 'Espresso')
      expect(catUpdateRes.success).toBe(false)
      expect(catUpdateRes.error).toMatch(/Kasir tidak diizinkan/i)

      // 6. Cannot delete category
      const catDelRes = productStore.deleteCategory('Makanan')
      expect(catDelRes.success).toBe(false)
      expect(catDelRes.error).toMatch(/Kasir tidak diizinkan/i)
    })

    it('hides edit and delete buttons in ProductsView for cashier', async () => {
      cloudStore.role = 'cashier'
      productStore.products = [
        {
          id: 'p-1',
          name: 'Kopi Susu',
          price: 15000,
          category: 'Kopi',
          isActive: true,
        },
      ]

      const router = createRouter({
        history: createMemoryHistory(),
        routes: [{ path: '/products', component: ProductsView }],
      })

      const wrapper = mount(ProductsView, {
        global: {
          plugins: [pinia, router],
          stubs: {
            AppIcon: true,
            BaseButton: { template: '<button><slot /></button>' },
            BaseModal: true,
            ProductQrModal: true,
          },
        },
      })

      expect(wrapper.vm.isCashier).toBe(true)
      // Edit button is hidden
      expect(wrapper.find('button[title="Edit produk"]').exists()).toBe(false)
      // Delete button is hidden
      expect(wrapper.find('button[title="Hapus produk"]').exists()).toBe(false)
    })
  })

  describe('3. Customer Store & CustomersView for Cashier', () => {
    it('allows cashier to create and update customers, but blocks deletion', () => {
      cloudStore.role = 'cashier'

      // 1. Cashier CAN create customer
      const createRes = customerStore.createCustomer({
        name: 'Budi Santoso',
        phone: '081234567890',
        email: 'budi@example.com',
      })
      expect(createRes.success).toBe(true)
      expect(createRes.customer.name).toBe('Budi Santoso')
      expect(customerStore.customers).toHaveLength(1)

      const customerId = createRes.customer.id

      // 2. Cashier CAN update customer
      const updateRes = customerStore.updateCustomer(customerId, {
        name: 'Budi Santoso Updated',
        phone: '081234567890',
      })
      expect(updateRes.success).toBe(true)
      expect(updateRes.customer.name).toBe('Budi Santoso Updated')

      // 3. Cashier CANNOT delete customer
      const deleteRes = customerStore.deleteCustomer(customerId)
      expect(deleteRes).toBe(false)
      expect(customerStore.customers).toHaveLength(1)
    })

    it('allows owner to delete customer', () => {
      cloudStore.role = 'owner'

      const createRes = customerStore.createCustomer({
        name: 'Dewi Lestari',
        phone: '081298765432',
      })
      const customerId = createRes.customer.id
      expect(customerStore.customers).toHaveLength(1)

      const deleteRes = customerStore.deleteCustomer(customerId)
      expect(deleteRes).toBe(true)
      expect(customerStore.customers).toHaveLength(0)
    })

    it('hides delete button in CustomersView for cashier, but keeps Edit button visible', async () => {
      cloudStore.role = 'cashier'
      customerStore.customers = [
        {
          id: 'c-1',
          name: 'Pelanggan Setia',
          phone: '081234567890',
        },
      ]

      const router = createRouter({
        history: createMemoryHistory(),
        routes: [{ path: '/customers', component: CustomersView }],
      })

      const wrapper = mount(CustomersView, {
        global: {
          plugins: [pinia, router],
          stubs: {
            AppIcon: true,
            BaseBadge: true,
            BaseButton: { template: '<button><slot /></button>' },
            BaseModal: true,
          },
        },
      })

      expect(wrapper.vm.isCashier).toBe(true)
      // Edit button remains visible
      expect(wrapper.text()).toContain('Edit')
      // Delete button is hidden
      expect(wrapper.text()).not.toContain('Delete')
    })
  })

  describe('4. SettingsView Subscription Hiding for Cashier', () => {
    it('hides subscription card and details in SettingsView when cashier', async () => {
      cloudStore.role = 'cashier'

      const router = createRouter({
        history: createMemoryHistory(),
        routes: [{ path: '/settings', component: SettingsView }],
      })

      const wrapper = mount(SettingsView, {
        global: {
          plugins: [pinia, router],
          stubs: {
            AppIcon: true,
            BaseButton: { template: '<button><slot /></button>' },
            BaseCard: { template: '<div><slot /></div>' },
            BaseModal: true,
            CloudBackupPanel: true,
          },
        },
      })

      expect(wrapper.vm.isCashier).toBe(true)
      // Subscription card is not rendered
      expect(wrapper.find('[data-testid="subscription-card"]').exists()).toBe(false)
      expect(wrapper.find('[data-testid="subscription-skeleton"]').exists()).toBe(false)
      expect(wrapper.find('[data-testid="cloud-account-subscription"]').exists()).toBe(false)
    })

    it('shows subscription card in SettingsView for owner', async () => {
      cloudStore.role = 'owner'

      const router = createRouter({
        history: createMemoryHistory(),
        routes: [{ path: '/settings', component: SettingsView }],
      })

      const wrapper = mount(SettingsView, {
        global: {
          plugins: [pinia, router],
          stubs: {
            AppIcon: true,
            BaseButton: { template: '<button><slot /></button>' },
            BaseCard: { template: '<div><slot /></div>' },
            BaseModal: true,
            CloudBackupPanel: true,
          },
        },
      })

      expect(wrapper.vm.isCashier).toBe(false)
      // Subscription card is rendered for owner
      expect(wrapper.find('[data-testid="subscription-card"]').exists()).toBe(true)
    })
  })
})
