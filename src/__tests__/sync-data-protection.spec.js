/**
 * Proteksi data pada layar Sinkronisasi (regresi "data hilang setelah sync"):
 *
 * 1. Tombol destruktif ("Muat ulang dari Cloud") wajib konfirmasi.
 * 2. Bila pemuatan Cloud gagal setelah data dihapus, data lokal dikembalikan.
 * 3. Tarik data disembunyikan untuk paket Free.
 * 4. Push yang gagal karena perangkat belum pernah memuat data Cloud langsung
 *    memicu initial pull (data Cloud tampil tanpa harus menekan Tarik).
 * 5. Pesan teknis berbahasa Inggris tidak lagi muncul ke pengguna.
 */

import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import SyncView from '@/views/sync/SyncView.vue'
import { useBusinessStore } from '@/stores/businessStore'
import { useCashStore } from '@/stores/cashStore'
import { useCashierStore } from '@/stores/cashierStore'
import { useCloudSessionStore } from '@/stores/cloudSessionStore'
import { useCustomerStore } from '@/stores/customerStore'
import { useProductStore } from '@/stores/productStore'
import { useShiftStore } from '@/stores/shiftStore'
import { useSyncAutoSyncStore } from '@/stores/syncAutoSyncStore'
import { useSyncContextGuardStore } from '@/stores/syncContextGuardStore'
import { useSyncOrchestratorStore } from '@/stores/syncOrchestratorStore'
import { useSyncPullStore } from '@/stores/syncPullStore'
import { useSyncPushStore } from '@/stores/syncPushStore'
import { useSyncStatusStore } from '@/stores/syncStatusStore'
import { useTransactionStore } from '@/stores/transactionStore'

const clearLocalCacheMock = vi.fn()
const captureBackupMock = vi.fn()
const restoreBackupMock = vi.fn()
const clearBackupMock = vi.fn()

vi.mock('@/services/localCacheService', () => ({
  clearLocalCache: (...args) => clearLocalCacheMock(...args),
}))

vi.mock('@/services/localSafetyBackup', () => ({
  captureLocalSafetyBackup: (...args) => captureBackupMock(...args),
  restoreLocalSafetyBackup: (...args) => restoreBackupMock(...args),
  clearLocalSafetyBackup: (...args) => clearBackupMock(...args),
  preserveUnsyncedDataAfterPull: vi.fn().mockResolvedValue({ ok: true, preservedCount: 0, preservedIds: [] }),
}))

enableAutoUnmount(afterEach)

const DEVICE_IDENTIFIER = '123e4567-e89b-12d3-a456-426614174000'

function prepareContext({ cloudAccess = true } = {}) {
  const pinia = createPinia()
  setActivePinia(pinia)

  const businessStore = useBusinessStore()
  businessStore.setBusiness({
    name: 'Toko Kopi',
    type: 'Cafe',
    owner: 'Budi',
    phone: '08123456789',
    outlet: 'Cabang Utama',
    mode: cloudAccess ? 'cloud' : 'free',
  })
  useCashierStore().setPinConfigured(true)
  useShiftStore().openShift(100000)

  const cloudStore = useCloudSessionStore()
  cloudStore.user = { id: 1, name: 'Budi', email: 'budi@tokokopi.id' }
  cloudStore.selectedBusiness = { id: 10, name: 'Toko Kopi', business_type: 'cafe' }
  cloudStore.selectedOutlet = { id: 101, name: 'Outlet Pusat' }
  cloudStore.deviceIdentifier = DEVICE_IDENTIFIER
  cloudStore.registeredDeviceId = 55
  cloudStore.cloudAccess = cloudAccess
  cloudStore.capabilityState = 'verified'

  const syncStatusStore = useSyncStatusStore()
  syncStatusStore.online = true

  return {
    pinia,
    cloudStore,
    syncStatusStore,
    syncPullStore: useSyncPullStore(),
    syncPushStore: useSyncPushStore(),
    syncOrchestratorStore: useSyncOrchestratorStore(),
    syncContextGuardStore: useSyncContextGuardStore(),
    syncAutoSyncStore: useSyncAutoSyncStore(),
    productStore: useProductStore(),
    customerStore: useCustomerStore(),
    transactionStore: useTransactionStore(),
    cashStore: useCashStore(),
  }
}

async function mountSyncView(context) {
  const wrapper = mount(SyncView, {
    global: { plugins: [context.pinia] },
    attachTo: document.body,
  })
  await flushPromises()
  return wrapper
}

beforeEach(() => {
  vi.clearAllMocks()
  captureBackupMock.mockResolvedValue({ version: 1, products: [{ id: 'p1' }] })
  restoreBackupMock.mockResolvedValue({ ok: true, restored: true })
})

describe('destructive "Muat ulang dari Cloud" is guarded', () => {
  it('asks for confirmation instead of wiping immediately', async () => {
    const context = prepareContext()
    const wrapper = await mountSyncView(context)

    const button = wrapper.find('[data-testid="btn-manual-clear-cache"]')
    expect(button.exists()).toBe(true)
    expect(button.text()).toContain('Muat ulang dari Cloud')

    await button.trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-testid="clear-cloud-confirm"]').exists()).toBe(true)
    expect(clearLocalCacheMock).not.toHaveBeenCalled()
  })

  it('cancel keeps local data untouched', async () => {
    const context = prepareContext()
    const wrapper = await mountSyncView(context)

    await wrapper.find('[data-testid="btn-manual-clear-cache"]').trigger('click')
    await flushPromises()

    await wrapper.find('[data-testid="btn-cancel-clear-and-pull"]').trigger('click')
    await flushPromises()

    expect(clearLocalCacheMock).not.toHaveBeenCalled()
    expect(restoreBackupMock).not.toHaveBeenCalled()
  })

  it('restores the local snapshot when the Cloud reload fails', async () => {
    const context = prepareContext()
    context.syncPullStore.pullNow = vi
      .fn()
      .mockResolvedValue({ ok: false, code: 'PRECONDITION_FAILED', message: 'Prasyarat gagal.' })

    const wrapper = await mountSyncView(context)

    await wrapper.find('[data-testid="btn-manual-clear-cache"]').trigger('click')
    await flushPromises()
    await wrapper.find('[data-testid="btn-confirm-clear-and-pull"]').trigger('click')
    await flushPromises()

    expect(clearLocalCacheMock).toHaveBeenCalled()
    expect(captureBackupMock).toHaveBeenCalled()
    expect(restoreBackupMock).toHaveBeenCalledWith(
      expect.objectContaining({ products: [{ id: 'p1' }] }),
      expect.objectContaining({}),
    )

    const banner = wrapper.find('[data-testid="sync-feedback-banner"]').text()
    expect(banner).toContain('dikembalikan')
    expect(clearBackupMock).not.toHaveBeenCalled()
  })

  it('drops the snapshot after a successful reload', async () => {
    const context = prepareContext()
    context.syncPullStore.pullNow = vi.fn().mockResolvedValue({ ok: true, applied: 7 })

    const wrapper = await mountSyncView(context)

    await wrapper.find('[data-testid="btn-manual-clear-cache"]').trigger('click')
    await flushPromises()
    await wrapper.find('[data-testid="btn-confirm-clear-and-pull"]').trigger('click')
    await flushPromises()

    expect(restoreBackupMock).not.toHaveBeenCalled()
    expect(clearBackupMock).toHaveBeenCalled()
    expect(wrapper.find('[data-testid="sync-feedback-banner"]').text()).toContain(
      'berhasil dimuat ulang',
    )
  })
})

describe('Free plan', () => {
  it('hides "Tarik" and "Muat ulang dari Cloud"', async () => {
    const context = prepareContext({ cloudAccess: false })
    const wrapper = await mountSyncView(context)

    expect(wrapper.find('[data-testid="btn-pull-cloud"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="btn-manual-clear-cache"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="sync-free-plan-note"]').exists()).toBe(true)
  })
})

describe('cloud data appears without pressing "Tarik"', () => {
  it('runs the initial pull automatically when the device is not bound yet', async () => {
    const context = prepareContext()
    context.syncOrchestratorStore.syncAll = vi
      .fn()
      .mockResolvedValue({ ok: false, code: 'SYNC_BUSINESS_NOT_BOUND', message: 'belum terhubung' })

    const pullSpy = vi.fn().mockResolvedValue({ ok: true, applied: 12 })
    context.syncPullStore.pullNow = pullSpy

    const wrapper = await mountSyncView(context)

    await wrapper.find('[data-testid="btn-sync-now"]').trigger('click')
    await flushPromises()

    expect(pullSpy).toHaveBeenCalledWith({ initialCloudRead: true })
    expect(wrapper.find('[data-testid="sync-feedback-banner"]').text()).toContain(
      'berhasil dimuat ke perangkat',
    )
  })

  it('shows a busy notice (not an error) when an initial pull is already running', async () => {
    const context = prepareContext()
    context.syncPullStore.pullNow = vi.fn().mockResolvedValue({
      ok: false,
      code: 'INITIAL_PULL_ALREADY_IN_PROGRESS',
      message: 'Data Cloud sedang dimuat. Tunggu prosesnya selesai lalu coba lagi.',
    })

    const wrapper = await mountSyncView(context)
    await wrapper.find('[data-testid="btn-pull-cloud"]').trigger('click')
    await flushPromises()

    const banner = wrapper.find('[data-testid="sync-feedback-banner"]')
    expect(banner.text()).toContain('sedang dimuat')
    expect(banner.text()).not.toContain('Initial Cloud pull')
  })
})
