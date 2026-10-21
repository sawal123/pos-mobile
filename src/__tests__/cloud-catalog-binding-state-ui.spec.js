import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { mount, flushPromises } from '@vue/test-utils'
import CloudLoginView from '@/views/settings/CloudLoginView.vue'
import { useCloudSessionStore } from '@/stores/cloudSessionStore'
import { useSyncContextGuardStore } from '@/stores/syncContextGuardStore'
import { useSyncBootstrapStore } from '@/stores/syncBootstrapStore'
import { useBusinessStore } from '@/stores/businessStore'

vi.mock('vue-router', () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
  }),
}))

function setupTestCloudContext(cloudStore) {
  cloudStore.user = { id: 1, name: 'Admin', email: 'admin@gmail.com' }
  cloudStore.selectedBusiness = {
    id: 1,
    name: 'Kopi Nusantara',
    business_type: 'Cafe / UMKM',
    business_type_raw: 'cafe',
    business_type_status: 'valid',
    subscription: { plan: 'cloud', status: 'active' },
  }
  cloudStore.selectedOutlet = { id: 1, name: 'Outlet Utama' }
  cloudStore.cloudAccess = true
  cloudStore.registeredDeviceId = 6
  cloudStore.deviceIdentifier = '07cd8ac9-1597-4e23-95d2-c856942bd4a6'
}

describe('Cloud Catalog Binding State UI', () => {
  let pinia

  beforeEach(() => {
    pinia = createPinia()
    setActivePinia(pinia)
    useBusinessStore(pinia).mode = 'cloud'
  })

  it('renders "Muat Data Cloud" on a fresh workspace even when auto_sync is enabled (guard status safe, sources [auto_sync])', async () => {
    const cloudStore = useCloudSessionStore()
    setupTestCloudContext(cloudStore)

    const guardStore = useSyncContextGuardStore()
    guardStore.status = 'safe'
    guardStore.sources = ['auto_sync']
    guardStore.issues = []
    vi.spyOn(guardStore, 'check').mockResolvedValue({
      ok: true,
      status: 'safe',
      sources: ['auto_sync'],
    })

    const wrapper = mount(CloudLoginView, {
      global: {
        plugins: [pinia],
        stubs: {
          AppIcon: true,
          BaseButton: {
            template: '<button :disabled="disabled"><slot /></button>',
            props: ['disabled', 'loading', 'variant', 'size'],
          },
          BaseInput: true,
          BaseCard: { template: '<div><slot /></div>' },
          BaseModal: true,
        },
      },
    })
    await flushPromises()

    // "Muat Data Cloud" block and button must appear
    const initNotice = wrapper.find('#cloud-initialization-notice')
    expect(initNotice.exists()).toBe(true)

    const initBtn = wrapper.find('#cloud-initialize-btn')
    expect(initBtn.exists()).toBe(true)
    expect(initBtn.attributes('disabled')).toBeUndefined()

    // Regular pull and sync-all must be disabled until initial cloud pull completes
    const pullBtn = wrapper.find('#pull-now-btn')
    expect(pullBtn.attributes('disabled')).toBeDefined()

    const syncAllBtn = wrapper.find('#sync-all-btn')
    expect(syncAllBtn.attributes('disabled')).toBeDefined()
  })

  it('renders "Muat Data Cloud" on a fresh workspace when bootstrap was staged with zero data', async () => {
    const cloudStore = useCloudSessionStore()
    setupTestCloudContext(cloudStore)

    const guardStore = useSyncContextGuardStore()
    guardStore.status = 'unbound'
    guardStore.sources = []
    guardStore.issues = []
    vi.spyOn(guardStore, 'check').mockResolvedValue({
      ok: true,
      status: 'unbound',
      sources: [],
    })

    const bootstrapStore = useSyncBootstrapStore()
    bootstrapStore.bootstrapState = {
      version: 1,
      status: 'staged',
      businessId: 1,
      outletId: 1,
      deviceIdentifier: '07cd8ac9-1597-4e23-95d2-c856942bd4a6',
      registeredDeviceId: 6,
      stagedAt: new Date().toISOString(),
      counts: {
        categories: 0,
        products: 0,
        customers: 0,
        expenses: 0,
        transactions: 0,
        shifts: 0,
        cash: 0,
      },
    }

    const wrapper = mount(CloudLoginView, {
      global: {
        plugins: [pinia],
        stubs: {
          AppIcon: true,
          BaseButton: {
            template: '<button :disabled="disabled"><slot /></button>',
            props: ['disabled', 'loading', 'variant', 'size'],
          },
          BaseInput: true,
          BaseCard: { template: '<div><slot /></div>' },
          BaseModal: true,
        },
      },
    })
    await flushPromises()

    const initNotice = wrapper.find('#cloud-initialization-notice')
    expect(initNotice.exists()).toBe(true)

    const initBtn = wrapper.find('#cloud-initialize-btn')
    expect(initBtn.exists()).toBe(true)
    expect(initBtn.attributes('disabled')).toBeUndefined()
  })

  it('renders push-only notice and enables "Tarik" for push-only workspace (sources [push_binding])', async () => {
    const cloudStore = useCloudSessionStore()
    setupTestCloudContext(cloudStore)

    const guardStore = useSyncContextGuardStore()
    guardStore.status = 'safe'
    guardStore.sources = ['push_binding', 'auto_sync']
    guardStore.issues = []
    vi.spyOn(guardStore, 'check').mockResolvedValue({
      ok: true,
      status: 'safe',
      sources: ['push_binding', 'auto_sync'],
    })

    const wrapper = mount(CloudLoginView, {
      global: {
        plugins: [pinia],
        stubs: {
          AppIcon: true,
          BaseButton: {
            template: '<button :disabled="disabled"><slot /></button>',
            props: ['disabled', 'loading', 'variant', 'size'],
          },
          BaseInput: true,
          BaseCard: { template: '<div><slot /></div>' },
          BaseModal: true,
        },
      },
    })
    await flushPromises()

    // Push-only notice must appear
    const pushOnlyNotice = wrapper.find('#cloud-push-only-notice')
    expect(pushOnlyNotice.exists()).toBe(true)

    // "Muat Data Cloud" must NOT appear
    const initNotice = wrapper.find('#cloud-initialization-notice')
    expect(initNotice.exists()).toBe(false)

    // "Tarik" button must be enabled
    const pullBtn = wrapper.find('#pull-now-btn')
    expect(pullBtn.attributes('disabled')).toBeUndefined()
  })

  it('hides "Muat Data Cloud" and enables "Tarik" on bound workspace (sources [pull_binding])', async () => {
    const cloudStore = useCloudSessionStore()
    setupTestCloudContext(cloudStore)

    const guardStore = useSyncContextGuardStore()
    guardStore.status = 'safe'
    guardStore.sources = ['pull_binding', 'push_binding', 'auto_sync']
    guardStore.issues = []
    vi.spyOn(guardStore, 'check').mockResolvedValue({
      ok: true,
      status: 'safe',
      sources: ['pull_binding', 'push_binding', 'auto_sync'],
    })

    const wrapper = mount(CloudLoginView, {
      global: {
        plugins: [pinia],
        stubs: {
          AppIcon: true,
          BaseButton: {
            template: '<button :disabled="disabled"><slot /></button>',
            props: ['disabled', 'loading', 'variant', 'size'],
          },
          BaseInput: true,
          BaseCard: { template: '<div><slot /></div>' },
          BaseModal: true,
        },
      },
    })
    await flushPromises()

    // "Muat Data Cloud" must NOT appear
    const initNotice = wrapper.find('#cloud-initialization-notice')
    expect(initNotice.exists()).toBe(false)

    // Both "Tarik" and "Sync Semua" must be enabled
    const pullBtn = wrapper.find('#pull-now-btn')
    expect(pullBtn.attributes('disabled')).toBeUndefined()

    const syncAllBtn = wrapper.find('#sync-all-btn')
    expect(syncAllBtn.attributes('disabled')).toBeUndefined()
  })
})
