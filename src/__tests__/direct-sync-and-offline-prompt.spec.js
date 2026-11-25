import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { mount, flushPromises } from '@vue/test-utils'
import { backfillUnsyncedTransactions } from '@/services/sync/syncBackfillService'
import { useBusinessStore } from '@/stores/businessStore'
import { useTransactionStore } from '@/stores/transactionStore'
import { useCloudSessionStore } from '@/stores/cloudSessionStore'
import { useSyncStatusStore } from '@/stores/syncStatusStore'
import { useSyncPushStore } from '@/stores/syncPushStore'
import { useSyncOrchestratorStore } from '@/stores/syncOrchestratorStore'
import OfflineSyncPromptModal from '@/components/sync/OfflineSyncPromptModal.vue'

describe('Direct Sync and Offline Sync Prompt Flow', () => {
  let pinia
  let businessStore
  let transactionStore
  let cloudStore
  let syncStatusStore
  let syncPushStore
  let syncOrchestratorStore

  beforeEach(() => {
    pinia = createPinia()
    setActivePinia(pinia)

    businessStore = useBusinessStore()
    transactionStore = useTransactionStore()
    cloudStore = useCloudSessionStore()
    syncStatusStore = useSyncStatusStore()
    syncPushStore = useSyncPushStore()
    syncOrchestratorStore = useSyncOrchestratorStore()

    // Setup basic stores
    businessStore.name = 'Kopi Nusantara'
    businessStore.type = 'Coffee Shop'
    businessStore.outlet = 'Outlet Utama'
    businessStore.mode = 'free'

    cloudStore.user = { id: 1, email: 'admin@gmail.com' }
    cloudStore.cloudAccess = true
    cloudStore.selectedBusiness = { id: 10, name: 'Kopi Nusantara', business_type: 'Coffee Shop' }
    cloudStore.selectedOutlet = { id: 101, name: 'Outlet Utama' }
    cloudStore.registeredDeviceId = 6
    cloudStore.deviceIdentifier = 'device-uuid-1'
  })

  describe('syncBackfillService', () => {
    it('switches business mode to cloud and backfills unsynced real transactions', async () => {
      const enqueued = []
      const mockQueueService = {
        listPending: vi.fn().mockResolvedValue([]),
        enqueueUpsert: vi.fn().mockImplementation((entityType, entityId, payload) => {
          enqueued.push({ entityType, entityId, payload })
          return Promise.resolve()
        }),
      }

      transactionStore.items = [
        {
          id: '6E794C8F-5819-490A-92FE-AD34A93CD44D',
          total: 135420,
          status: 'paid',
          customer: 'Walk-in Customer',
        },
        {
          id: '09A2C9A9-FE19-4264-98E7-03668669D92E',
          total: 24420,
          status: 'paid',
          customer: 'Walk-in Customer',
        },
        {
          id: 'TRX-1001',
          total: 69000,
          status: 'paid',
        },
      ]

      expect(businessStore.mode).toBe('free')

      const count = await backfillUnsyncedTransactions({
        pinia,
        queueService: mockQueueService,
      })

      expect(count).toBe(2)
      expect(businessStore.mode).toBe('cloud')
      expect(enqueued).toHaveLength(2)
      expect(enqueued[0].entityId).toBe('6E794C8F-5819-490A-92FE-AD34A93CD44D')
      expect(enqueued[1].entityId).toBe('09A2C9A9-FE19-4264-98E7-03668669D92E')
    })

    it('does not re-enqueue transactions that already exist in the queue', async () => {
      const enqueued = []
      const mockQueueService = {
        listPending: vi.fn().mockResolvedValue([
          {
            entityType: 'transaction',
            entityId: '6E794C8F-5819-490A-92FE-AD34A93CD44D',
          },
        ]),
        enqueueUpsert: vi.fn().mockImplementation((entityType, entityId, payload) => {
          enqueued.push({ entityType, entityId, payload })
          return Promise.resolve()
        }),
      }

      transactionStore.items = [
        {
          id: '6E794C8F-5819-490A-92FE-AD34A93CD44D',
          total: 135420,
        },
        {
          id: '09A2C9A9-FE19-4264-98E7-03668669D92E',
          total: 24420,
        },
      ]

      const count = await backfillUnsyncedTransactions({
        pinia,
        queueService: mockQueueService,
      })

      expect(count).toBe(1)
      expect(enqueued).toHaveLength(1)
      expect(enqueued[0].entityId).toBe('09A2C9A9-FE19-4264-98E7-03668669D92E')
    })

    it('re-enqueues offline transactions from adapter and skips serverVersions', async () => {
      const enqueued = []
      const mockQueueService = {
        listPending: vi.fn().mockResolvedValue([]),
        enqueueUpsert: vi.fn().mockImplementation((entityType, entityId, payload) => {
          enqueued.push({ entityType, entityId, payload })
          return Promise.resolve()
        }),
      }

      const mockAdapter = {
        loadSyncServerVersions: vi.fn().mockResolvedValue({
          'sales:synced-uuid-1': { syncVersion: 1 },
        }),
        loadSyncIdentityMap: vi.fn().mockResolvedValue({}),
        loadTransactions: vi.fn().mockResolvedValue([
          { id: 'synced-uuid-1', total: 50000 },
          { id: 'offline-uuid-2', total: 75000 },
        ]),
      }

      transactionStore.items = []
      businessStore.mode = 'cloud'

      const count = await backfillUnsyncedTransactions({
        pinia,
        queueService: mockQueueService,
        adapter: mockAdapter,
      })

      expect(count).toBe(1)
      expect(enqueued).toHaveLength(1)
      expect(enqueued[0].entityId).toBe('offline-uuid-2')
    })
  })

  describe('OfflineSyncPromptModal', () => {
    it('does not show modal when offline or when pending count is 0', async () => {
      businessStore.mode = 'cloud'
      syncStatusStore.online = false
      syncStatusStore.pendingCount = 3

      const wrapper = mount(OfflineSyncPromptModal, {
        global: {
          plugins: [pinia],
          stubs: {
            Teleport: true,
            AppIcon: true,
            BaseButton: true,
          },
        },
      })

      await flushPromises()
      expect(wrapper.find('#offline-sync-prompt-modal').exists()).toBe(false)
    })

    it('shows modal when online with pending offline transactions and allows syncing', async () => {
      businessStore.mode = 'cloud'
      syncStatusStore.online = true
      syncStatusStore.pendingCount = 2
      syncPushStore.pendingCount = 2

      const syncAllSpy = vi.fn().mockResolvedValue({ ok: true, stage: 'completed' })
      syncOrchestratorStore.syncAll = syncAllSpy
      syncPushStore.refreshPendingCount = vi.fn().mockResolvedValue(0)
      syncStatusStore.refresh = vi.fn().mockResolvedValue({ ok: true, pendingCount: 0 })

      const wrapper = mount(OfflineSyncPromptModal, {
        global: {
          plugins: [pinia],
          stubs: {
            Teleport: true,
            AppIcon: true,
            BaseButton: {
              template: '<button :id="$attrs.id" :disabled="$attrs.disabled"><slot /></button>',
            },
          },
        },
      })

      await flushPromises()

      const modal = wrapper.find('#offline-sync-prompt-modal')
      expect(modal.exists()).toBe(true)
      expect(wrapper.text()).toContain('2 transaksi offline')
      expect(wrapper.text()).toContain('Koneksi Internet Pulih')

      // Trigger sync
      await wrapper.find('#offline-sync-now-btn').trigger('click')
      await flushPromises()

      expect(syncAllSpy).toHaveBeenCalledTimes(1)
    })

    it('allows dismissing modal with "Nanti Saja"', async () => {
      businessStore.mode = 'cloud'
      syncStatusStore.online = true
      syncStatusStore.pendingCount = 2
      syncPushStore.pendingCount = 2

      const wrapper = mount(OfflineSyncPromptModal, {
        global: {
          plugins: [pinia],
          stubs: {
            Teleport: true,
            AppIcon: true,
            BaseButton: {
              template: '<button :id="$attrs.id" :disabled="$attrs.disabled"><slot /></button>',
            },
          },
        },
      })

      await flushPromises()

      expect(wrapper.find('#offline-sync-prompt-modal').exists()).toBe(true)

      // Dismiss
      await wrapper.find('#offline-sync-dismiss-btn').trigger('click')
      await flushPromises()

      expect(wrapper.find('#offline-sync-prompt-modal').exists()).toBe(false)
    })

    it('does not pop up when pendingCount increases while already online (e.g. online CRUD)', async () => {
      businessStore.mode = 'cloud'
      syncStatusStore.online = true
      syncStatusStore.pendingCount = 0
      syncPushStore.pendingCount = 0
      syncStatusStore.refresh = vi.fn().mockResolvedValue({ ok: true, pendingCount: 0 })
      syncPushStore.refreshPendingCount = vi.fn().mockResolvedValue(0)

      const wrapper = mount(OfflineSyncPromptModal, {
        global: {
          plugins: [pinia],
          stubs: { Teleport: true, AppIcon: true, BaseButton: true },
        },
      })

      await flushPromises()
      expect(wrapper.find('#offline-sync-prompt-modal').exists()).toBe(false)

      // Online create/edit increases pendingCount momentarily before background push completes
      syncStatusStore.pendingCount = 1
      syncPushStore.pendingCount = 1
      await flushPromises()

      expect(wrapper.find('#offline-sync-prompt-modal').exists()).toBe(false)
    })

    it('only re-opens on offline -> online reconnect and can always be closed via close button', async () => {
      businessStore.mode = 'cloud'
      syncStatusStore.online = true
      syncStatusStore.pendingCount = 0
      syncPushStore.pendingCount = 0
      syncStatusStore.refresh = vi.fn().mockImplementation(async () => ({
        ok: true,
        pendingCount: syncStatusStore.pendingCount,
      }))
      syncPushStore.refreshPendingCount = vi.fn().mockImplementation(async () => syncPushStore.pendingCount)

      const wrapper = mount(OfflineSyncPromptModal, {
        global: {
          plugins: [pinia],
          stubs: {
            Teleport: true,
            AppIcon: true,
            BaseButton: {
              template: '<button :id="$attrs.id" :disabled="$attrs.disabled"><slot /></button>',
            },
          },
        },
      })

      await flushPromises()
      expect(wrapper.find('#offline-sync-prompt-modal').exists()).toBe(false)

      // Drop offline, record mutation, then reconnect -> modal opens with fresh button enabled
      syncStatusStore.online = false
      syncStatusStore.pendingCount = 1
      syncPushStore.pendingCount = 1
      await flushPromises()

      syncStatusStore.online = true
      await flushPromises()

      expect(wrapper.find('#offline-sync-prompt-modal').exists()).toBe(true)
      expect(wrapper.find('#offline-sync-now-btn').attributes('disabled')).toBeUndefined()

      await wrapper.find('[data-testid="offline-sync-close-btn"]').trigger('click')
      await flushPromises()

      expect(wrapper.find('#offline-sync-prompt-modal').exists()).toBe(false)
    })
  })
})
