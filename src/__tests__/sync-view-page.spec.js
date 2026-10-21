import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { describe, expect, it, vi } from 'vitest'

import { createAppRouter } from '@/router'
import { useBusinessStore } from '@/stores/businessStore'
import { useCashStore } from '@/stores/cashStore'
import { useCashierStore } from '@/stores/cashierStore'
import { useCloudSessionStore } from '@/stores/cloudSessionStore'
import { useCustomerStore } from '@/stores/customerStore'
import { useProductStore } from '@/stores/productStore'
import { useSubscriptionStore } from '@/stores/subscriptionStore'
import { useSyncAutoSyncStore } from '@/stores/syncAutoSyncStore'
import { useSyncOrchestratorStore } from '@/stores/syncOrchestratorStore'
import { useSyncPushStore } from '@/stores/syncPushStore'
import { useSyncStatusStore } from '@/stores/syncStatusStore'
import { useTransactionStore } from '@/stores/transactionStore'
import SyncView from '@/views/sync/SyncView.vue'

function prepareContext() {
  const pinia = createPinia()
  setActivePinia(pinia)

  const router = createAppRouter()
  const businessStore = useBusinessStore()
  const cashierStore = useCashierStore()

  businessStore.setBusiness({
    name: 'Toko Kopi Maju',
    type: 'Cafe',
    owner: 'Budi',
    phone: '08123456789',
    outlet: 'Cabang Utama',
    mode: 'free',
  })
  cashierStore.setPinConfigured(true)

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

  it('shows unlinked cloud state and provides connect button', async () => {
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
    const connectBtn = wrapper.find('[data-testid="btn-login-cloud"]')
    expect(connectBtn.exists()).toBe(true)

    await connectBtn.trigger('click')
    await flushPromises()
    expect(context.router.currentRoute.value.path).toBe('/cloud')
  })

  it('shows linked cloud details when user is authenticated', async () => {
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
