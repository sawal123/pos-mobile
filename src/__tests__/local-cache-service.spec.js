import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { mount, flushPromises } from '@vue/test-utils'
import { createRouter, createWebHistory } from 'vue-router'

import { createMemoryAdapter } from '@/services/database/memoryAdapter'
import { clearLocalCache } from '@/services/localCacheService'
import { useBusinessStore } from '@/stores/businessStore'
import { useCartStore } from '@/stores/cartStore'
import { useCashStore } from '@/stores/cashStore'
import { useCashierStore } from '@/stores/cashierStore'
import { useCloudSessionStore } from '@/stores/cloudSessionStore'
import { useCustomerStore } from '@/stores/customerStore'
import { useExpenseStore } from '@/stores/expenseStore'
import { useProductStore } from '@/stores/productStore'
import { useShiftStore } from '@/stores/shiftStore'
import { useTransactionStore } from '@/stores/transactionStore'
import { useSyncPullStore } from '@/stores/syncPullStore'
import { useSyncContextGuardStore } from '@/stores/syncContextGuardStore'
import SettingsView from '@/views/settings/SettingsView.vue'
import CloudLoginView from '@/views/settings/CloudLoginView.vue'
import PosView from '@/views/pos/PosView.vue'
import SyncView from '@/views/sync/SyncView.vue'
import LaundryOrderCreateView from '@/views/laundry/LaundryOrderCreateView.vue'
import { createSyncPullService } from '@/services/sync/syncPullService'

vi.mock('@/services/cloud/apiClient', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    apiRequest: vi.fn().mockResolvedValue({ ok: true, status: 200, data: null, error: null }),
  }
})

describe('localCacheService & Cache Invalidation', () => {
  let pinia
  let adapter

  beforeEach(async () => {
    pinia = createPinia()
    setActivePinia(pinia)
    adapter = createMemoryAdapter()
    await adapter.initialize()

    const cloudStore = useCloudSessionStore(pinia)
    cloudStore.setPersistenceAdapter(adapter)
  })

  it('clearLocalCache wipes database tables and resets Pinia stores', async () => {
    const productStore = useProductStore(pinia)
    const transactionStore = useTransactionStore(pinia)
    const customerStore = useCustomerStore(pinia)
    const expenseStore = useExpenseStore(pinia)
    const cashStore = useCashStore(pinia)
    const shiftStore = useShiftStore(pinia)
    const cashierStore = useCashierStore(pinia)
    const cartStore = useCartStore(pinia)

    // Seed data
    productStore.products = [{ id: 'p1', name: 'Ayam Geprek', price: 15000, category: 'Makanan' }]
    productStore.categories = ['Makanan']
    transactionStore.items = [{ id: 't1', total: 15000, createdAt: new Date().toISOString() }]
    customerStore.customers = [{ id: 'c1', name: 'Budi' }]
    expenseStore.expenses = [{ id: 'e1', title: 'Listrik', amount: 50000 }]
    cashStore.entries = [{ id: 'k1', amount: 100000, type: 'in' }]
    shiftStore.isOpen = true
    shiftStore.status = 'open'
    shiftStore.openingBalance = 50000
    cashierStore.activeCashier = { id: 1, name: 'Kasir 1' }
    cartStore.items = [{ id: 'p1', name: 'Ayam Geprek', quantity: 2, price: 15000 }]

    await adapter.saveProducts(productStore.products, productStore.categories, [])
    await adapter.saveTransactions(transactionStore.items)
    await adapter.saveCustomers(customerStore.customers)
    await adapter.saveExpenses(expenseStore.expenses)

    // Run clearLocalCache
    const result = await clearLocalCache({ pinia, adapter, resetBusiness: false })
    expect(result.ok).toBe(true)

    // Verify Pinia stores are empty
    expect(productStore.products).toEqual([])
    expect(productStore.categories).toEqual([])
    expect(transactionStore.items).toEqual([])
    expect(customerStore.customers).toEqual([])
    expect(expenseStore.expenses).toEqual([])
    expect(cashStore.entries).toEqual([])
    expect(shiftStore.isOpen).toBe(false)
    expect(shiftStore.status).toBe('closed')
    expect(cashierStore.activeCashier).toEqual({
      name: 'Kasir 1',
      pinConfigured: true,
    })
    expect(cartStore.items).toEqual([])

    // Verify database adapter is empty
    const loadedProducts = await adapter.loadProducts()
    expect(loadedProducts.products).toEqual([])
    expect(loadedProducts.categories).toEqual([])
    const loadedTx = await adapter.loadTransactions()
    expect(loadedTx).toEqual([])
    const loadedCust = await adapter.loadCustomers()
    expect(loadedCust).toEqual([])
    const loadedExp = await adapter.loadExpenses()
    expect(loadedExp).toEqual([])
  })

  it('clearLocalCache with resetBusiness=true also clears businessStore', async () => {
    const businessStore = useBusinessStore(pinia)
    businessStore.setBusiness({
      name: 'Warung Makan Padang',
      type: 'Restoran',
      owner: 'Pak Sutan',
      outlet: 'Cabang 1',
      mode: 'pro',
    })

    await clearLocalCache({ pinia, adapter, resetBusiness: true })

    expect(businessStore.name).toBe('')
    expect(businessStore.mode).toBe('free')
  })
})

describe('SettingsView Hapus Data Cache & Disconnect confirmation', () => {
  let pinia
  let router
  let adapter

  beforeEach(async () => {
    pinia = createPinia()
    setActivePinia(pinia)
    adapter = createMemoryAdapter()
    await adapter.initialize()

    const cloudStore = useCloudSessionStore(pinia)
    cloudStore.setPersistenceAdapter(adapter)

    router = createRouter({
      history: createWebHistory(),
      routes: [
        { path: '/', name: 'home', component: { template: '<div>Home</div>' } },
        { path: '/settings', name: 'settings', component: SettingsView },
        { path: '/cloud', name: 'cloud', component: CloudLoginView },
      ],
    })
  })

  it('shows Hapus Data Cache card and modal confirmation in SettingsView', async () => {
    const productStore = useProductStore(pinia)
    productStore.products = [{ id: 'p1', name: 'Es Teh', price: 5000, category: 'Minuman' }]
    await adapter.saveProducts(productStore.products, ['Minuman'], [])

    const wrapper = mount(SettingsView, {
      global: { plugins: [pinia, router] },
    })
    await flushPromises()

    // Assert cache section card exists
    expect(wrapper.find('[data-testid="cache-settings-card"]').exists()).toBe(true)
    const clearBtn = wrapper.find('[data-testid="btn-clear-cache"]')
    expect(clearBtn.exists()).toBe(true)

    // Modal is initially hidden
    expect(wrapper.find('[data-testid="clear-cache-modal"]').exists()).toBe(false)

    // Click button to show modal
    await clearBtn.trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-testid="clear-cache-modal"]').exists()).toBe(true)

    // Confirm clear cache
    const confirmBtn = wrapper.find('[data-testid="btn-confirm-clear-cache"]')
    expect(confirmBtn.exists()).toBe(true)
    await confirmBtn.trigger('click')
    await flushPromises()

    // Data should now be cleared
    expect(productStore.products).toEqual([])
    expect(wrapper.find('[data-testid="settings-feedback"]').text()).toContain('Data cache')
  })

  it('disconnects cloud and clears cache with confirmation in SettingsView', async () => {
    const cloudStore = useCloudSessionStore(pinia)
    cloudStore.user = { id: 1, email: 'owner@resto.com', name: 'Owner' }
    cloudStore.selectedBusiness = { id: 10, name: 'Resto Enak', business_type: 'Cafe / UMKM' }
    cloudStore.cloudAccess = true

    const productStore = useProductStore(pinia)
    productStore.products = [{ id: 'p1', name: 'Rendang', price: 25000 }]
    await adapter.saveProducts(productStore.products, [], [])

    const wrapper = mount(SettingsView, {
      global: { plugins: [pinia, router] },
    })
    await flushPromises()

    // Disconnect button exists when connected
    const disconnectBtn = wrapper.find('[data-testid="cloud-disconnect"]')
    expect(disconnectBtn.exists()).toBe(true)

    // Click disconnect button to open confirmation modal
    await disconnectBtn.trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-testid="settings-disconnect-modal"]').exists()).toBe(true)

    // Confirm disconnect
    const confirmDisconnectBtn = wrapper.find('[data-testid="settings-disconnect-confirm"]')
    await confirmDisconnectBtn.trigger('click')
    await flushPromises()

    // Cloud should be unlinked and cache cleared
    expect(cloudStore.isLinked).toBe(false)
    expect(productStore.products).toEqual([])
  })
})

describe('CloudLoginView Disconnect & Cache Wipe', () => {
  let pinia
  let adapter

  beforeEach(async () => {
    pinia = createPinia()
    setActivePinia(pinia)
    adapter = createMemoryAdapter()
    await adapter.initialize()

    const cloudStore = useCloudSessionStore(pinia)
    cloudStore.setPersistenceAdapter(adapter)
  })

  it('clears local cache when cloud is disconnected from CloudLoginView', async () => {
    const cloudStore = useCloudSessionStore(pinia)
    cloudStore.user = { id: 1, email: 'owner@coffee.com', name: 'Coffee Owner' }
    cloudStore.selectedBusiness = { id: 99, name: 'Kopi Senja', business_type: 'Cafe / UMKM' }
    cloudStore.cloudAccess = true

    const productStore = useProductStore(pinia)
    productStore.products = [{ id: 'p10', name: 'Kopi Susu Gula Aren', price: 18000 }]
    await adapter.saveProducts(productStore.products, [], [])

    const wrapper = mount(CloudLoginView, {
      global: { plugins: [pinia] },
    })
    await flushPromises()

    // Disconnect button
    const disconnectBtn = wrapper.find('#cloud-disconnect-btn')
    expect(disconnectBtn.exists()).toBe(true)

    // Open confirmation
    await disconnectBtn.trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-testid="cloud-disconnect-modal"]').exists()).toBe(true)

    // Confirm disconnect
    await wrapper.find('#cloud-disconnect-confirm').trigger('click')
    await flushPromises()

    // Verify unlinked and local products cleared
    expect(cloudStore.isLinked).toBe(false)
    expect(productStore.products).toEqual([])
  })
})

describe('Auto Pull on Fresh Workspace & POS Catalog Preload', () => {
  let pinia
  let adapter

  beforeEach(async () => {
    pinia = createPinia()
    setActivePinia(pinia)
    adapter = createMemoryAdapter()
    await adapter.initialize()

    const cloudStore = useCloudSessionStore(pinia)
    cloudStore.setPersistenceAdapter(adapter)
  })

  it('allows clicking Tarik on fresh workspace and passes initialCloudRead: true', async () => {
    const cloudStore = useCloudSessionStore(pinia)
    cloudStore.token = 'test-token'
    cloudStore.user = { id: 1, email: 'admin@gmail.com', name: 'Admin' }
    cloudStore.selectedBusiness = { id: 10, name: 'Admin Business' }
    cloudStore.selectedOutlet = { id: 101, name: 'Outlet Utama' }
    cloudStore.cloudAccess = true
    cloudStore.deviceIdentifier = 'dev-1234'
    cloudStore.registeredDeviceId = 77
    cloudStore.businesses = [
      {
        id: 10,
        name: 'Admin Business',
        cloud_access: true,
        outlets: [{ id: 101, name: 'Outlet Utama', status: 'active' }],
      },
    ]

    const pullStore = useSyncPullStore(pinia)
    const spyPullNow = vi.spyOn(pullStore, 'pullNow').mockResolvedValue({
      ok: true,
      applied: 3,
      remaining: 0,
    })

    const guardStore = useSyncContextGuardStore(pinia)
    guardStore.init({
      contextGuardService: {
        inspect: vi.fn().mockResolvedValue({
          ok: true,
          status: 'unbound',
          code: 'SYNC_CONTEXT_UNBOUND',
        }),
      },
    })

    const wrapper = mount(CloudLoginView, {
      global: { plugins: [pinia] },
    })
    await flushPromises()

    const pullBtn = wrapper.find('#cloud-initialize-btn')
    expect(pullBtn.exists()).toBe(true)
    expect(pullBtn.attributes('disabled')).toBeUndefined()

    await pullBtn.trigger('click')
    await flushPromises()

    expect(spyPullNow).toHaveBeenCalledWith(
      expect.objectContaining({ initialCloudRead: true }),
    )
  })

  it('automatically triggers ensureCatalogLoaded when PosView mounts with empty products', async () => {
    const cloudStore = useCloudSessionStore(pinia)
    cloudStore.token = 'test-token'
    cloudStore.user = { id: 1, email: 'admin@gmail.com' }
    cloudStore.selectedBusiness = { id: 10, name: 'Admin Business' }
    cloudStore.selectedOutlet = { id: 101, name: 'Outlet Utama' }
    cloudStore.cloudAccess = true

    const productStore = useProductStore(pinia)
    productStore.products = []

    const pullStore = useSyncPullStore(pinia)
    const spyEnsure = vi.spyOn(pullStore, 'ensureCatalogLoaded').mockResolvedValue({ ok: true })

    const router = createRouter({
      history: createWebHistory(),
      routes: [{ path: '/', component: PosView }],
    })

    mount(PosView, {
      global: { plugins: [pinia, router] },
    })
    await flushPromises()

    expect(spyEnsure).toHaveBeenCalled()
  })

  it('automatically checks the Cloud binding when the local template is still present', async () => {
    const cloudStore = useCloudSessionStore(pinia)
    cloudStore.token = 'test-token'
    cloudStore.user = { id: 1, email: 'admin@gmail.com' }
    cloudStore.selectedBusiness = { id: 10, name: 'Admin Business' }
    cloudStore.selectedOutlet = { id: 101, name: 'Outlet Utama' }
    cloudStore.cloudAccess = true

    const productStore = useProductStore(pinia)
    expect(productStore.products.length).toBeGreaterThan(0)

    const pullStore = useSyncPullStore(pinia)
    const spyEnsure = vi.spyOn(pullStore, 'ensureCatalogLoaded').mockResolvedValue({ ok: true })

    const router = createRouter({
      history: createWebHistory(),
      routes: [{ path: '/', component: PosView }],
    })

    mount(PosView, {
      global: { plugins: [pinia, router] },
    })
    await flushPromises()

    expect(spyEnsure).toHaveBeenCalled()
  })

  it('resolves productStore and normalizes unitPrice when createSyncPullService is initialized without explicit pinia, and avoids duplicate products on repeated pulls', async () => {
    const cloudStore = useCloudSessionStore(pinia)
    cloudStore.user = { id: 1, email: 'admin@gmail.com', name: 'Admin' }
    cloudStore.selectedBusiness = { id: 10, name: 'Admin Business', business_type: 'Cafe / UMKM' }
    cloudStore.selectedOutlet = { id: 101, name: 'Outlet Utama' }
    cloudStore.cloudAccess = true
    cloudStore.capabilityState = 'verified'
    cloudStore.role = 'owner'
    cloudStore.syncCapabilities = { push_mode: 'full' }
    cloudStore.deviceIdentifier = '33333333-3333-4333-8333-333333333333'
    cloudStore.registeredDeviceId = 77

    const catUuid = '11111111-1111-4111-8111-111111111111'
    const prodUuid = '22222222-2222-4222-8222-222222222222'

    const transport = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        data: {
          records: [
            {
              entity: 'categories',
              sync_sequence: 1,
              data: { sync_id: catUuid, sync_version: 1, name: 'Minuman' },
            },
            {
              entity: 'products',
              sync_sequence: 2,
              data: {
                sync_id: prodUuid,
                sync_version: 1,
                category_sync_id: catUuid,
                name: 'Es Kopi Susu',
                price: 18000,
                stock: 15,
                is_active: 1,
              },
            },
          ],
          next_cursor: 2,
          server_sequence: 2,
          has_more: false,
        },
      },
    })

    // Initialize pullService WITHOUT passing `pinia`
    const pullService = createSyncPullService({
      adapter,
      cloudStore,
      tokenFetcher: async () => 'test-token',
      transport,
    })

    const productStore = useProductStore(pinia)
    productStore.products = []
    productStore.categories = []

    const pullStore = useSyncPullStore(pinia)
    pullStore.init({ pullService, adapter })

    // 1st pull (initialCloudRead via ensureCatalogLoaded on fresh workspace)
    const firstPull = await pullStore.ensureCatalogLoaded()
    expect(firstPull.ok).toBe(true)

    expect(productStore.categories).toContain('Minuman')
    expect(productStore.products).toHaveLength(1)
    expect(productStore.products[0]).toMatchObject({
      id: prodUuid,
      name: 'Es Kopi Susu',
      category: 'Minuman',
      price: 18000,
      unitPrice: 18000,
      stock: 15,
      isActive: true,
    })

    const persisted = await adapter.loadProducts()
    expect(persisted.products).toHaveLength(1)
    expect(persisted.categories).toContain('Minuman')

    // 2nd pull (repeated pull via force=true uses initialCloudRead: false and does not duplicate)
    const secondPull = await pullStore.ensureCatalogLoaded({ force: true })
    expect(secondPull.ok).toBe(true)
    expect(productStore.products).toHaveLength(1)
  })

  it('ensureCatalogLoaded on a push-only workspace pulls normally with initialCloudRead: false without deleting local transactions or sync queue', async () => {
    const cloudStore = useCloudSessionStore(pinia)
    cloudStore.user = { id: 1, email: 'admin@gmail.com' }
    cloudStore.selectedBusiness = { id: 10, name: 'Admin Business' }
    cloudStore.selectedOutlet = { id: 101, name: 'Outlet Utama' }
    cloudStore.cloudAccess = true

    await adapter.saveSyncPushBinding({
      businessId: 10,
      outletId: 101,
      deviceIdentifier: '33333333-3333-4333-8333-333333333333',
      registeredDeviceId: 77,
      boundAt: new Date().toISOString(),
    })
    await adapter.saveTransactions([{ id: 'trx-1', total: 20000, createdAt: new Date().toISOString() }])
    await adapter.upsertSyncQueueItem({
      id: 'q-1',
      entityType: 'transaction',
      entityId: 'trx-1',
      operation: 'upsert',
      payload: { id: 'trx-1', total: 20000 },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })

    const productStore = useProductStore(pinia)
    productStore.products = []
    productStore.categories = []

    const pullService = {
      pullNow: vi.fn().mockResolvedValue({ ok: true, applied: 2 }),
    }
    const pullStore = useSyncPullStore(pinia)
    pullStore.init({ pullService, adapter })

    await pullStore.ensureCatalogLoaded()

    expect(pullService.pullNow).toHaveBeenCalledWith(
      expect.objectContaining({ initialCloudRead: false }),
    )
    expect(await adapter.loadTransactions()).toHaveLength(1)
    expect(await adapter.countSyncQueueItems()).toBe(1)
  })

  it('SyncView handlePullNow uses initialCloudRead: false when workspace is already bound and preserves workspaceRegistry on clearLocalCache(resetBusiness: false)', async () => {
    const cloudStore = useCloudSessionStore(pinia)
    cloudStore.user = { id: 1, email: 'admin@gmail.com' }
    cloudStore.selectedBusiness = { id: 10, name: 'Admin Business' }
    cloudStore.selectedOutlet = { id: 101, name: 'Outlet Utama' }
    cloudStore.cloudAccess = true
    cloudStore.deviceIdentifier = 'dev-1234'
    cloudStore.registeredDeviceId = 77

    await adapter.saveWorkspaceRegistry({
      version: 1,
      activeWorkspaceId: 'cloud:10:101',
      workspaces: {
        'local:default': { business: { name: 'Toko Lokal', mode: 'free' } },
      },
    })

    await clearLocalCache({ pinia, adapter, resetBusiness: false })
    const regAfterClear = await adapter.loadWorkspaceRegistry()
    expect(regAfterClear.activeWorkspaceId).toBe('cloud:10:101')
    expect(regAfterClear.workspaces['local:default']).toBeDefined()

    const guardStore = useSyncContextGuardStore(pinia)
    guardStore.init({
      contextGuardService: {
        inspect: vi.fn().mockResolvedValue({
          ok: true,
          status: 'safe',
          code: 'SYNC_CONTEXT_SAFE',
          sources: ['pull_binding'],
        }),
      },
    })

    const pullStore = useSyncPullStore(pinia)
    const spyPullNow = vi.spyOn(pullStore, 'pullNow').mockResolvedValue({ ok: true, applied: 1 })

    const router = createRouter({
      history: createWebHistory(),
      routes: [{ path: '/', component: SyncView }],
    })

    const wrapper = mount(SyncView, {
      global: { plugins: [pinia, router] },
    })
    await flushPromises()

    const pullBtn = wrapper.find('[data-testid="btn-pull-cloud"]')
    expect(pullBtn.exists()).toBe(true)
    await pullBtn.trigger('click')
    await flushPromises()

    expect(spyPullNow).toHaveBeenCalledWith({ initialCloudRead: false })
  })

  it('automatically triggers ensureCatalogLoaded when LaundryOrderCreateView mounts with empty products', async () => {
    const cloudStore = useCloudSessionStore(pinia)
    cloudStore.user = { id: 1, email: 'admin@gmail.com' }
    cloudStore.selectedBusiness = { id: 10, name: 'Laundry Cloud', business_type: 'Laundry' }
    cloudStore.selectedOutlet = { id: 101, name: 'Outlet Utama' }
    cloudStore.cloudAccess = true

    const productStore = useProductStore(pinia)
    productStore.products = []

    const pullStore = useSyncPullStore(pinia)
    const spyEnsure = vi.spyOn(pullStore, 'ensureCatalogLoaded').mockResolvedValue({ ok: true })

    const router = createRouter({
      history: createWebHistory(),
      routes: [{ path: '/', component: LaundryOrderCreateView }],
    })

    mount(LaundryOrderCreateView, {
      global: { plugins: [pinia, router] },
    })
    await flushPromises()

    expect(spyEnsure).toHaveBeenCalled()
  })
})

