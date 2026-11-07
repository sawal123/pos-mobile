import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { describe, expect, it, vi } from 'vitest'

import BottomNavigation from '@/components/layout/BottomNavigation.vue'
import TabletNavRail from '@/components/layout/TabletNavRail.vue'
import { createAppRouter } from '@/router'
import { useBusinessStore } from '@/stores/businessStore'
import { useCashStore } from '@/stores/cashStore'
import { useCashierStore } from '@/stores/cashierStore'
import { useCloudSessionStore } from '@/stores/cloudSessionStore'
import { useCustomerStore } from '@/stores/customerStore'
import { useProductStore } from '@/stores/productStore'
import { useShiftStore } from '@/stores/shiftStore'
import { useSubscriptionStore } from '@/stores/subscriptionStore'
import { useSyncAutoSyncStore } from '@/stores/syncAutoSyncStore'
import { useSyncOrchestratorStore } from '@/stores/syncOrchestratorStore'
import { useSyncPushStore } from '@/stores/syncPushStore'
import { useSyncStatusStore } from '@/stores/syncStatusStore'
import { useTransactionStore } from '@/stores/transactionStore'
import HomeView from '@/views/home/HomeView.vue'
import SettingsView from '@/views/settings/SettingsView.vue'
import SyncView from '@/views/sync/SyncView.vue'

function prepareContext() {
  const pinia = createPinia()
  setActivePinia(pinia)

  const router = createAppRouter()
  const businessStore = useBusinessStore()
  const cashierStore = useCashierStore()
  const shiftStore = useShiftStore()

  businessStore.setBusiness({
    name: 'Toko Kopi Maju',
    type: 'Cafe',
    owner: 'Budi',
    phone: '08123456789',
    outlet: 'Cabang Utama',
    mode: 'free',
  })
  cashierStore.setPinConfigured(true)
  shiftStore.openShift(100000)

  const cloudStore = useCloudSessionStore()
  const syncStatusStore = useSyncStatusStore()
  const syncPushStore = useSyncPushStore()
  const syncAutoSyncStore = useSyncAutoSyncStore()
  const syncOrchestratorStore = useSyncOrchestratorStore()
  const subscriptionStore = useSubscriptionStore()
  const productStore = useProductStore()
  const transactionStore = useTransactionStore()
  const cashStore = useCashStore()
  const customerStore = useCustomerStore()

  return {
    pinia,
    router,
    businessStore,
    shiftStore,
    cloudStore,
    syncStatusStore,
    syncPushStore,
    syncAutoSyncStore,
    syncOrchestratorStore,
    subscriptionStore,
    productStore,
    transactionStore,
    cashStore,
    customerStore,
  }
}

describe('SyncView — Pusat Sinkronisasi Page', () => {
  it('renders online connection status and offline storage stats', async () => {
    const context = prepareContext()
    context.syncStatusStore.online = true
    context.syncStatusStore.pendingCount = 3
    context.transactionStore.items = [{ id: 'tx-1' }, { id: 'tx-2' }]
    context.productStore.products = [{ id: 'p-1' }]

    const wrapper = mount(SyncView, {
      global: {
        plugins: [context.pinia, context.router],
      },
    })
    await flushPromises()

    expect(wrapper.find('[data-testid="connection-status-badge"]').text()).toContain('Online')
    expect(wrapper.find('[data-testid="pending-data-badge"]').text()).toContain('3 Data Pending')
    expect(wrapper.find('[data-testid="local-data-summary-card"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="local-tx-count"]').text()).toBe('2')
    expect(wrapper.find('[data-testid="local-product-count"]').text()).toBe('1')
  })

  it('renders offline state when device is disconnected', async () => {
    const context = prepareContext()
    context.syncStatusStore.online = false

    const wrapper = mount(SyncView, {
      global: {
        plugins: [context.pinia, context.router],
      },
    })
    await flushPromises()

    expect(wrapper.find('[data-testid="connection-status-badge"]').text()).toContain('Offline')
  })

  it('does not render login or logout buttons in SyncView and directs account auth to Settings', async () => {
    const context = prepareContext()
    context.cloudStore.user = null
    context.cloudStore.selectedBusiness = null

    const wrapper = mount(SyncView, {
      global: {
        plugins: [context.pinia, context.router],
      },
    })
    await flushPromises()

    expect(wrapper.find('[data-testid="cloud-link-badge"]').text()).toContain('Belum Tertaut')
    expect(wrapper.find('[data-testid="btn-login-cloud"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="btn-manage-cloud"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="btn-disconnect-cloud"]').exists()).toBe(false)

    const settingsBtn = wrapper.find('[data-testid="btn-sync-open-settings"]')
    expect(settingsBtn.exists()).toBe(true)

    await settingsBtn.trigger('click')
    await flushPromises()
    expect(context.router.currentRoute.value.name).toBe('settings')
    expect(context.router.currentRoute.value.query.section).toBe('cloud')
  })

  it('shows linked cloud details without logout button when user is authenticated', async () => {
    const context = prepareContext()
    context.cloudStore.user = { id: 10, email: 'owner@tokokopi.id', name: 'Budi' }
    context.cloudStore.selectedBusiness = { id: 1, name: 'Toko Kopi Cloud' }
    context.cloudStore.selectedOutlet = { id: 2, name: 'Outlet Utama Cloud' }

    const wrapper = mount(SyncView, {
      global: {
        plugins: [context.pinia, context.router],
      },
    })
    await flushPromises()

    expect(wrapper.find('[data-testid="cloud-link-badge"]').text()).toContain('Tertaut')
    expect(wrapper.find('[data-testid="cloud-user-email"]').text()).toBe('owner@tokokopi.id')
    expect(wrapper.find('[data-testid="cloud-business-name"]').text()).toBe('Toko Kopi Cloud')
    expect(wrapper.find('[data-testid="cloud-outlet-name"]').text()).toBe('Outlet Utama Cloud')
    expect(wrapper.find('[data-testid="btn-disconnect-cloud"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="btn-sync-open-settings"]').exists()).toBe(true)
  })

  it('triggers manual sync on button click', async () => {
    const context = prepareContext()
    context.syncStatusStore.online = true
    const syncAllSpy = vi.fn().mockResolvedValue({ ok: true, syncedCount: 2 })
    context.syncOrchestratorStore.syncAll = syncAllSpy

    const wrapper = mount(SyncView, {
      global: {
        plugins: [context.pinia, context.router],
      },
    })
    await flushPromises()

    const syncBtn = wrapper.find('[data-testid="btn-sync-now"]')
    expect(syncBtn.exists()).toBe(true)

    await syncBtn.trigger('click')
    await flushPromises()

    expect(syncAllSpy).toHaveBeenCalled()
    expect(wrapper.find('[data-testid="sync-feedback-banner"]').text()).toContain('berhasil')
  })

  it('toggles auto-sync preference when auto-sync switch is toggled', async () => {
    const context = prepareContext()
    context.syncAutoSyncStore.enabled = false
    const setEnabledSpy = vi.fn().mockImplementation(async (val) => {
      context.syncAutoSyncStore.enabled = val
      return { ok: true }
    })
    context.syncAutoSyncStore.setEnabled = setEnabledSpy

    const wrapper = mount(SyncView, {
      global: {
        plugins: [context.pinia, context.router],
      },
    })
    await flushPromises()

    const switchInput = wrapper.find('[data-testid="auto-sync-switch"]')
    expect(switchInput.exists()).toBe(true)

    await switchInput.trigger('click')
    await switchInput.trigger('change')
    await flushPromises()

    expect(setEnabledSpy).toHaveBeenCalled()
  })
})

describe('Sinkronisasi Menu Lock & Settings Login/Logout Centralization', () => {
  it('locks Sinkronisasi in Home, BottomNavigation, and TabletNavRail when unauthenticated & Free', async () => {
    const context = prepareContext()
    await context.router.push('/home')
    await flushPromises()

    // 1. HomeView operational menu tile
    const homeWrapper = mount(HomeView, {
      global: { plugins: [context.pinia, context.router] },
    })
    await flushPromises()

    expect(homeWrapper.find('[data-testid="home-menu-sync-lock"]').exists()).toBe(true)
    await homeWrapper.find('[data-testid="home-menu-sync"]').trigger('click')
    await flushPromises()

    expect(context.router.currentRoute.value.name).toBe('home')
    expect(homeWrapper.find('[data-testid="sync-locked-modal"]').exists()).toBe(true)
    expect(homeWrapper.find('[data-testid="sync-locked-message"]').text()).toContain('Pengaturan')

    await homeWrapper.find('[data-testid="sync-locked-go-settings-btn"]').trigger('click')
    await flushPromises()
    expect(context.router.currentRoute.value.name).toBe('settings')
    expect(context.router.currentRoute.value.query.section).toBe('cloud')

    // 2. BottomNavigation ("Lainnya") sheet
    await context.router.push('/home')
    await flushPromises()
    const navWrapper = mount(BottomNavigation, {
      global: { plugins: [context.pinia, context.router] },
    })
    await flushPromises()

    await navWrapper.find('button[data-testid="bottom-nav-item"]').trigger('click')
    await flushPromises()
    expect(navWrapper.find('[data-testid="more-menu-sync-lock"]').exists()).toBe(true)

    await navWrapper.find('[data-testid="more-menu-sync"]').trigger('click')
    await flushPromises()
    expect(context.router.currentRoute.value.name).toBe('home')
    expect(navWrapper.find('[data-testid="sync-locked-modal"]').exists()).toBe(true)

    // 3. TabletNavRail
    const railWrapper = mount(TabletNavRail, {
      global: { plugins: [context.pinia, context.router] },
    })
    await flushPromises()
    expect(railWrapper.find('[data-testid="rail-menu-sync-lock"]').exists()).toBe(true)

    await railWrapper.find('[data-testid="rail-menu-sync"]').trigger('click')
    await flushPromises()
    expect(context.router.currentRoute.value.name).toBe('home')
    expect(railWrapper.find('[data-testid="sync-locked-modal"]').exists()).toBe(true)
  })

  it('keeps Sinkronisasi locked when logged in on Free plan and redirects /sync to Settings', async () => {
    const context = prepareContext()
    context.cloudStore.user = { id: 1, name: 'Budi', email: 'budi@tokokopi.id' }
    context.cloudStore.businesses = [{ id: 10, name: 'Toko Kopi', subscription: { plan: 'free' } }]
    context.cloudStore.selectedBusiness = {
      id: 10,
      name: 'Toko Kopi',
      subscription: { plan: 'free' },
    }
    context.cloudStore.capabilityState = 'verified'

    // Direct navigation to /sync redirects to /settings?section=cloud
    await context.router.push('/sync')
    await flushPromises()
    expect(context.router.currentRoute.value.name).toBe('settings')
    expect(context.router.currentRoute.value.query.section).toBe('cloud')

    // Settings auto-opens Akun Cloud section and displays Login/Logout controls
    const settingsWrapper = mount(SettingsView, {
      global: { plugins: [context.pinia, context.router] },
    })
    await flushPromises()

    expect(settingsWrapper.find('[data-testid="cloud-account-card"]').isVisible()).toBe(true)
    expect(settingsWrapper.find('[data-testid="cloud-disconnect"]').exists()).toBe(true)
    expect(
      settingsWrapper.find('[data-testid="settings-menu-sync"]').attributes('aria-haspopup'),
    ).toBe('dialog')
  })

  it('unlocks Sinkronisasi when logged in with active Cloud/Premium plan', async () => {
    const context = prepareContext()
    context.cloudStore.user = { id: 1, name: 'Budi', email: 'budi@tokokopi.id' }
    const activeSub = { plan: 'pro', status: 'active' }
    context.cloudStore.businesses = [{ id: 10, name: 'Toko Kopi', subscription: activeSub }]
    context.cloudStore.selectedBusiness = { id: 10, name: 'Toko Kopi', subscription: activeSub }
    context.cloudStore.cloudAccess = true
    context.cloudStore.capabilityState = 'verified'

    await context.router.push('/home')
    await flushPromises()

    const homeWrapper = mount(HomeView, {
      global: { plugins: [context.pinia, context.router] },
    })
    await flushPromises()

    expect(homeWrapper.find('[data-testid="home-menu-sync-lock"]').exists()).toBe(false)

    await homeWrapper.find('[data-testid="home-menu-sync"]').trigger('click')
    await flushPromises()

    expect(context.router.currentRoute.value.name).toBe('sync')
  })
})
