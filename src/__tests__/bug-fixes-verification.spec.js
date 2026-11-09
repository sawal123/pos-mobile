import { describe, expect, it } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createRouter, createMemoryHistory } from 'vue-router'

import BottomNavigation from '@/components/layout/BottomNavigation.vue'
import { useBusinessStore } from '@/stores/businessStore'
import { useCloudSessionStore } from '@/stores/cloudSessionStore'
import { useSubscriptionStore } from '@/stores/subscriptionStore'
import { resolveSyncAccess } from '@/composables/useSyncAccess'

describe('BottomNavigation and Sync Access Bug Fixes', () => {
  function setupContext() {
    const pinia = createPinia()
    setActivePinia(pinia)

    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/', name: 'root', component: { template: '<div>Root</div>' } },
        { path: '/home', name: 'home', component: { template: '<div>Home</div>' } },
        { path: '/pos', name: 'pos', component: { template: '<div>POS</div>' } },
        { path: '/transactions', name: 'transactions', component: { template: '<div>Transactions</div>' } },
        { path: '/cash', name: 'cash', component: { template: '<div>Cash</div>' } },
        { path: '/products', name: 'products', component: { template: '<div>Products</div>' } },
        { path: '/stock', name: 'stock', component: { template: '<div>Stock</div>' } },
        { path: '/customers', name: 'customers', component: { template: '<div>Customers</div>' } },
        { path: '/promos', name: 'promos', component: { template: '<div>Promos</div>' } },
        { path: '/expenses', name: 'expenses', component: { template: '<div>Expenses</div>' } },
        { path: '/shift', name: 'shift', component: { template: '<div>Shift</div>' } },
        { path: '/reports', name: 'reports', component: { template: '<div>Reports</div>' } },
        { path: '/sync', name: 'sync', component: { template: '<div>Sync</div>' } },
        { path: '/settings', name: 'settings', component: { template: '<div>Settings</div>' } },
      ],
    })

    const businessStore = useBusinessStore()
    businessStore.name = 'Net Kasir'
    businessStore.type = 'Cafe / UMKM'

    const cloudStore = useCloudSessionStore()
    const subscriptionStore = useSubscriptionStore()

    return { pinia, router, businessStore, cloudStore, subscriptionStore }
  }

  it('Bug 1: clicking an item in Lainnya sheet navigates to the target page, not /', async () => {
    const { pinia, router } = setupContext()
    await router.push('/home')
    await flushPromises()

    const wrapper = mount(BottomNavigation, {
      global: { plugins: [pinia, router] },
    })
    await flushPromises()

    // Open sheet
    await wrapper.find('button[data-testid="bottom-nav-item"]').trigger('click')
    await flushPromises()

    // Click "Produk"
    const productItem = wrapper.find('[data-testid="more-menu-products"]')
    expect(productItem.exists()).toBe(true)
    await productItem.trigger('click')
    await flushPromises()

    expect(router.currentRoute.value.path).toBe('/products')
  })

  it('Bug 2: sync remains unlocked on app restart when account is cloud, even before capability refresh', () => {
    const { cloudStore, subscriptionStore, businessStore } = setupContext()

    // User is logged into Cloud
    cloudStore.user = { id: 1, name: 'Owner', email: 'owner@netkasir.id' }
    cloudStore.selectedBusiness = {
      id: 101,
      name: 'Net Kasir Cafe',
      business_type: 'cafe',
      subscription: { plan: 'cloud', status: 'active' },
    }
    // Simulate cold start: capabilityState is 'unverified' and subscriptionStore.isPremium is false
    cloudStore.capabilityState = 'unverified'
    businessStore.mode = 'cloud'

    const access = resolveSyncAccess({ cloudStore, subscriptionStore, businessStore })
    expect(access.isAuthenticated).toBe(true)
    expect(access.isSyncLocked).toBe(false)
    expect(access.isSyncUnlocked).toBe(true)
  })

  it('Bug 2: sync remains unlocked on app restart when cloud session is linked without explicit subscription row', () => {
    const { cloudStore, subscriptionStore, businessStore } = setupContext()

    cloudStore.user = { id: 1, name: 'Owner', email: 'owner@netkasir.id' }
    cloudStore.selectedBusiness = {
      id: 101,
      name: 'Net Kasir Cafe',
      business_type: 'cafe',
      subscription: null, // No explicit subscription object
    }
    cloudStore.cloudAccess = true
    cloudStore.capabilityState = 'unverified'
    businessStore.mode = 'cloud'

    const access = resolveSyncAccess({ cloudStore, subscriptionStore, businessStore })
    expect(access.isAuthenticated).toBe(true)
    expect(access.isSyncLocked).toBe(false)
    expect(access.isSyncUnlocked).toBe(true)
  })
})

