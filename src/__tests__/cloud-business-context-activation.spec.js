/**
 * PR #57 revision — dynamic Cloud business switching & local workspace
 * isolation regression suite.
 *
 * The previous conservative guard refused a valid Cloud business whenever any
 * local operational data existed. That conflated three separate concepts:
 * Cloud authentication, Cloud business linking, and the active operational
 * workspace. These tests lock in the corrected behaviour:
 *
 *  - local data never blocks Cloud login or a valid business selection;
 *  - a differing local workspace yields a confirmation, not an error;
 *  - switching preserves the old workspace durably and isolates tenant data;
 *  - Cloud Sync / tenant access stay blocked unless the workspace is aligned.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { mount, flushPromises } from '@vue/test-utils'

import { _resetTokenStore } from '@/services/cloud/tokenRepository'
import { createMemoryAdapter } from '@/services/database/memoryAdapter'
import {
  buildBusinessSwitchConfirmation,
  inspectCloudFirstWorkspace,
  inspectLocalBusinessWorkspace,
  WORKSPACE_CLASSIFICATION,
} from '@/services/cloud/businessContextActivation'
import {
  LOCAL_WORKSPACE_ID,
  WORKSPACE_SWITCH_RESULT,
  cloudWorkspaceId,
  switchOperationalWorkspace,
} from '@/services/cloud/businessWorkspaceService'
import { useBusinessStore } from '@/stores/businessStore'
import { useCloudSessionStore } from '@/stores/cloudSessionStore'
import CloudLoginView from '@/views/settings/CloudLoginView.vue'

vi.mock('@/services/cloud/apiClient', () => ({ apiRequest: vi.fn() }))
import { apiRequest } from '@/services/cloud/apiClient'

// ── Fixtures ────────────────────────────────────────────────────────────────

const CAFE = {
  id: 72,
  name: 'Kopi Nusantara',
  business_type: 'Cafe / UMKM',
  business_type_raw: 'cafe',
  business_type_status: 'valid',
  role: null,
  cloud_access: true,
  subscription: { plan: 'premium' },
  outlets: [{ id: 8, name: 'Outlet Pusat', status: 'active' }],
  device_context: null,
}

const LAUNDRY_CLOUD = {
  id: 81,
  name: 'Laundry Bersih Wangi',
  business_type: 'Laundry',
  business_type_raw: 'laundry',
  business_type_status: 'valid',
  role: null,
  cloud_access: true,
  subscription: { plan: 'premium' },
  outlets: [{ id: 9, name: 'Outlet Laundry', status: 'active' }],
  device_context: null,
}

const LOCAL_LAUNDRY = {
  name: 'Temuan',
  type: 'Laundry',
  owner: '',
  phone: '',
  outlet: 'Outlet Utama',
  mode: 'free',
}

const ok = (data) => ({ ok: true, status: 200, data: { data }, error: null })

// A workspace switch now requires a persistence scheduler that can flush the
// write queue and rehydrate the Pinia stores (fail-closed otherwise).
function createStubScheduler() {
  return {
    flush: async () => {},
    rehydrate: async () => {},
    runSerialized: (task) => task(),
  }
}

async function makeContext() {
  const pinia = createPinia()
  setActivePinia(pinia)
  const adapter = createMemoryAdapter()
  await adapter.initialize()
  const cloudStore = useCloudSessionStore(pinia)
  cloudStore.setPersistenceAdapter(adapter, createStubScheduler())
  cloudStore.user = { id: 1, name: 'Owner', email: 'owner@example.com' }
  return { pinia, adapter, cloudStore, businessStore: useBusinessStore(pinia) }
}

async function seedLocalLaundry(adapter, businessStore) {
  await adapter.saveBusiness(LOCAL_LAUNDRY)
  await adapter.saveProducts(
    [{ id: 'p-lokal', name: 'Cuci Kiloan', category: 'Kiloan', price: 7000, stock: 0, isActive: true }],
    ['Kiloan'],
  )
  businessStore.setBusiness(LOCAL_LAUNDRY)
}

beforeEach(() => {
  _resetTokenStore()
  vi.clearAllMocks()
})

// ════════════════════════════════════════════════════════════════════════════
// 1. Local Laundry → login Cloud Café succeeds
// ════════════════════════════════════════════════════════════════════════════

describe('1. local Laundry data does not block Cloud Café login', () => {
  it('authenticates and links a Café business while Laundry data is present', async () => {
    const { adapter, cloudStore, businessStore } = await makeContext()
    await seedLocalLaundry(adapter, businessStore)

    apiRequest
      .mockResolvedValueOnce(ok({ token: 'tok', user: { id: 1, name: 'Owner', email: 'owner@example.com' } }))
      .mockResolvedValueOnce(ok({ user: { id: 1 }, businesses: [CAFE] }))

    const login = await cloudStore.login('owner@example.com', 'secret')
    expect(login.ok).toBe(true)
    expect(cloudStore.isAuthenticated).toBe(true)
    expect(cloudStore.businesses).toHaveLength(1)

    const select = await cloudStore.selectBusiness(CAFE.id)
    expect(select.ok).toBe(true)
    expect(cloudStore.isLinked).toBe(true)
    // Server entitlement is intact — never flipped off by the local mismatch.
    expect(cloudStore.cloudAccess).toBe(true)
    expect(cloudStore.hasCloudAccess).toBe(true)
    // Local identity is untouched by mere selection.
    expect(businessStore.name).toBe('Temuan')
  })
})

// ════════════════════════════════════════════════════════════════════════════
// 2. Cloud business selection succeeds although the local workspace differs
// ════════════════════════════════════════════════════════════════════════════

describe('2. Cloud business selection succeeds despite a different local workspace', () => {
  it('links the business and only flags a pending switch', async () => {
    const { adapter, cloudStore, businessStore } = await makeContext()
    await seedLocalLaundry(adapter, businessStore)
    cloudStore.businesses = [CAFE, LAUNDRY_CLOUD]

    const result = await cloudStore.selectBusiness(LAUNDRY_CLOUD.id)

    expect(result.ok).toBe(true)
    expect(result.switchRequired).toBe(true)
    expect(cloudStore.selectedBusiness.id).toBe(LAUNDRY_CLOUD.id)
    expect(cloudStore.isLinked).toBe(true)
    // No red error is produced for a mere switch requirement.
    expect(cloudStore.error).toBeNull()
    expect(cloudStore.operationalContext.status).toBe('switch_pending')
  })
})

// ════════════════════════════════════════════════════════════════════════════
// 3. Mismatch shows a confirmation modal, not a login rejection
// ════════════════════════════════════════════════════════════════════════════

describe('3. mismatch produces a confirmation prompt', () => {
  it('builds the "Beralih Bisnis?" copy with the exact wording', () => {
    const confirmation = buildBusinessSwitchConfirmation({
      localBusiness: { name: 'Temuan', type: 'Laundry' },
      cloudBusiness: CAFE,
    })

    expect(confirmation.title).toBe('Beralih Bisnis?')
    expect(confirmation.confirmLabel).toBe('Simpan & Beralih')
    expect(confirmation.cancelLabel).toBe('Batal')
    expect(confirmation.message).toContain('Anda sedang menggunakan Temuan (Laundry)')
    expect(confirmation.message).toContain('Kopi Nusantara (Cafe)')
    expect(confirmation.message).toContain('disimpan secara terpisah')
    expect(confirmation.message).toContain('Apakah Anda ingin melanjutkan?')
  })

  it('exposes the confirmation through the store when activation is attempted', async () => {
    const { adapter, cloudStore, businessStore } = await makeContext()
    await seedLocalLaundry(adapter, businessStore)
    cloudStore.businesses = [CAFE]

    await cloudStore.selectBusiness(CAFE.id)
    await cloudStore.selectOutlet(8)

    const activation = await cloudStore.activateOperationalContext()

    expect(activation.ok).toBe(false)
    expect(activation.code).toBe('BUSINESS_SWITCH_CONFIRMATION_REQUIRED')
    expect(cloudStore.pendingSwitch).not.toBeNull()
    expect(cloudStore.pendingSwitch.confirmation.title).toBe('Beralih Bisnis?')
    // Selection is preserved and no error is raised.
    expect(cloudStore.selectedBusiness.id).toBe(CAFE.id)
    expect(cloudStore.cloudAccess).toBe(true)
  })
})

// ════════════════════════════════════════════════════════════════════════════
// 4. Cancel keeps the old workspace
// ════════════════════════════════════════════════════════════════════════════

describe('4. cancel keeps the previous workspace', () => {
  it('keeps local data and the local identity on cancel', async () => {
    const { adapter, cloudStore, businessStore } = await makeContext()
    await seedLocalLaundry(adapter, businessStore)
    cloudStore.businesses = [CAFE]

    await cloudStore.selectBusiness(CAFE.id)
    await cloudStore.selectOutlet(8)
    await cloudStore.activateOperationalContext()

    const cancel = cloudStore.cancelBusinessSwitch()

    expect(cancel.code).toBe('BUSINESS_SWITCH_DECLINED')
    expect(cloudStore.pendingSwitch).toBeNull()
    expect(cloudStore.operationalContext.status).toBe('switch_declined')
    expect(businessStore.name).toBe('Temuan')
    const products = await adapter.loadProducts()
    expect(products.products.map((p) => p.id)).toEqual(['p-lokal'])
    // Cloud Sync stays blocked because the workspace is not aligned.
    expect(cloudStore.isOperationalCloudAccess).toBe(false)
  })
})

// ════════════════════════════════════════════════════════════════════════════
// 5. "Simpan & Beralih" activates Café with isolated data
// ════════════════════════════════════════════════════════════════════════════

describe('5. confirm switches to the Café workspace with isolated data', () => {
  it('materialises a fresh Café workspace and preserves the old one separately', async () => {
    const { adapter, cloudStore, businessStore } = await makeContext()
    await seedLocalLaundry(adapter, businessStore)
    cloudStore.businesses = [CAFE]

    await cloudStore.selectBusiness(CAFE.id)
    await cloudStore.selectOutlet(8)
    await cloudStore.activateOperationalContext()

    const confirmed = await cloudStore.confirmBusinessSwitch()

    expect(confirmed.ok).toBe(true)
    expect(confirmed.code).toBe('OPERATIONAL_CONTEXT_ACTIVATED')
    expect(businessStore.name).toBe('Kopi Nusantara')
    expect(businessStore.normalizedType).toBe('Cafe / UMKM')
    expect(cloudStore.operationalContext.status).toBe('active')
    expect(cloudStore.isWorkspaceAligned).toBe(true)
    expect(cloudStore.isOperationalCloudAccess).toBe(true)

    // The Café workspace starts empty — no Laundry products leaked in.
    const activeProducts = await adapter.loadProducts()
    expect(activeProducts.products).toEqual([])

    // The old Laundry workspace is preserved under its own identity.
    const savedLocal = await adapter.loadWorkspaceSnapshot(LOCAL_WORKSPACE_ID)
    expect(savedLocal).not.toBeNull()
    expect(savedLocal.business.name).toBe('Temuan')
    expect(savedLocal.products.map((p) => p.id)).toEqual(['p-lokal'])

    expect(cloudStore.activeWorkspaceId).toBe(cloudWorkspaceId(CAFE.id, 8))
  })
})

// ════════════════════════════════════════════════════════════════════════════
// 6. Café → Laundry → Café shows each workspace's own data
// ════════════════════════════════════════════════════════════════════════════

describe('6. Café → Laundry → Café round-trip keeps each workspace isolated', () => {
  it('restores the correct data for each business', async () => {
    const { adapter, cloudStore, businessStore } = await makeContext()
    cloudStore.businesses = [CAFE, LAUNDRY_CLOUD]

    // Activate Café (fresh device — no confirmation needed).
    await cloudStore.selectBusiness(CAFE.id)
    await cloudStore.selectOutlet(8)
    await cloudStore.activateOperationalContext()
    await adapter.saveProducts(
      [{ id: 'p-cafe', name: 'Es Kopi', category: 'Minuman', price: 22000, stock: 5, isActive: true }],
      ['Minuman'],
    )

    // Switch to Laundry (confirmation required because Café holds data).
    await cloudStore.selectBusiness(LAUNDRY_CLOUD.id)
    await cloudStore.selectOutlet(9)
    const p1 = await cloudStore.activateOperationalContext()
    expect(p1.code).toBe('BUSINESS_SWITCH_CONFIRMATION_REQUIRED')
    await cloudStore.confirmBusinessSwitch()
    expect((await adapter.loadProducts()).products).toEqual([])
    await adapter.saveProducts(
      [{ id: 'p-laundry', name: 'Cuci Express', category: 'Express', price: 12000, stock: 0, isActive: true }],
      ['Express'],
    )

    // Switch back to Café.
    await cloudStore.selectBusiness(CAFE.id)
    await cloudStore.selectOutlet(8)
    await cloudStore.confirmBusinessSwitch()

    const cafeProducts = await adapter.loadProducts()
    expect(cafeProducts.products.map((p) => p.id)).toEqual(['p-cafe'])
    expect(businessStore.name).toBe('Kopi Nusantara')

    // ...and Laundry is still isolated in its own workspace.
    await cloudStore.selectBusiness(LAUNDRY_CLOUD.id)
    await cloudStore.selectOutlet(9)
    await cloudStore.confirmBusinessSwitch()
    const laundryProducts = await adapter.loadProducts()
    expect(laundryProducts.products.map((p) => p.id)).toEqual(['p-laundry'])
  })
})

// ════════════════════════════════════════════════════════════════════════════
// 7. Restart keeps the correct workspace and data
// ════════════════════════════════════════════════════════════════════════════

describe('7. restart retains the active workspace identity', () => {
  it('resolves the same active workspace id after a restart', async () => {
    const { adapter, cloudStore, businessStore } = await makeContext()
    await seedLocalLaundry(adapter, businessStore)
    cloudStore.businesses = [CAFE]

    await cloudStore.selectBusiness(CAFE.id)
    await cloudStore.selectOutlet(8)
    await cloudStore.confirmBusinessSwitch()

    const restarted = await makeContext()
    // Same adapter (simulating the same device database).
    restarted.cloudStore.setPersistenceAdapter(adapter, createStubScheduler())
    restarted.cloudStore.user = { id: 1, name: 'Owner', email: 'owner@example.com' }
    restarted.adapter.saveWorkspaceRegistry(await adapter.loadWorkspaceRegistry())

    const { resolveActiveWorkspaceId } = await import('@/services/cloud/businessWorkspaceService')
    expect(await resolveActiveWorkspaceId(adapter)).toBe(cloudWorkspaceId(CAFE.id, 8))

    // The active (materialised) business record matches the Café workspace.
    const persistedBusiness = await adapter.loadBusiness()
    expect(persistedBusiness.name).toBe('Kopi Nusantara')

    // The Laundry workspace remains durably available.
    const localSnapshot = await adapter.loadWorkspaceSnapshot(LOCAL_WORKSPACE_ID)
    expect(localSnapshot.business.name).toBe('Temuan')
  })
})

// ════════════════════════════════════════════════════════════════════════════
// 8. Failing to persist the old workspace does not delete data
// ════════════════════════════════════════════════════════════════════════════

describe('8. a failed old-workspace save preserves the data', () => {
  it('refuses the switch and leaves the singleton workspace untouched', async () => {
    const adapter = createMemoryAdapter()
    await adapter.initialize()
    await adapter.saveProducts(
      [{ id: 'p-lokal', name: 'Cuci Kiloan', category: 'Kiloan', price: 7000, stock: 0, isActive: true }],
      ['Kiloan'],
    )
    await adapter.saveBusiness(LOCAL_LAUNDRY)

    const failing = Object.assign({}, adapter, {
      saveWorkspaceSnapshot: () => {
        throw new Error('disk full')
      },
    })

    const result = await switchOperationalWorkspace({
      adapter: failing,
      scheduler: createStubScheduler(),
      targetWorkspaceId: cloudWorkspaceId(CAFE.id, 8),
    })

    expect(result.ok).toBe(false)
    expect(result.code).toBe(WORKSPACE_SWITCH_RESULT.SNAPSHOT_WRITE_FAILED)
    // Nothing was deleted or overwritten.
    expect((await adapter.loadProducts()).products.map((p) => p.id)).toEqual(['p-lokal'])
    expect((await adapter.loadBusiness()).name).toBe('Temuan')
  })
})

// ════════════════════════════════════════════════════════════════════════════
// 9. Tenant A sync metadata is never sent to tenant B
// ════════════════════════════════════════════════════════════════════════════

describe('9. per-workspace sync metadata isolation', () => {
  it('never carries tenant A sync binding into tenant B', async () => {
    const adapter = createMemoryAdapter()
    await adapter.initialize()

    const workspaceA = cloudWorkspaceId(1, 10)
    const workspaceB = cloudWorkspaceId(2, 20)

    await switchOperationalWorkspace({ adapter, scheduler: createStubScheduler(), targetWorkspaceId: workspaceA })
    await adapter.saveSyncPushBinding({ businessId: 1, boundAt: new Date().toISOString() })

    await switchOperationalWorkspace({ adapter, scheduler: createStubScheduler(), targetWorkspaceId: workspaceB })
    // Tenant B starts with no tenant A binding.
    expect(await adapter.loadSyncPushBinding()).toBeNull()

    await switchOperationalWorkspace({ adapter, scheduler: createStubScheduler(), targetWorkspaceId: workspaceA })
    const restored = await adapter.loadSyncPushBinding()
    expect(restored.businessId).toBe(1)
  })
})

// ════════════════════════════════════════════════════════════════════════════
// 10. Activation never weakens premium, role, or device registration
// ════════════════════════════════════════════════════════════════════════════

describe('10. activation preserves premium / role / device protections', () => {
  it('keeps cashier role, capability contract and device rules intact', async () => {
    const { adapter, cloudStore, businessStore } = await makeContext()
    await seedLocalLaundry(adapter, businessStore)

    const cashierCafe = {
      ...CAFE,
      role: 'cashier',
      sync_capabilities: null,
      device_context: { id: 555, outlet_id: 8, status: 'active', identifier: 'dev-1' },
    }
    cloudStore.businesses = [cashierCafe]
    cloudStore.role = 'cashier'
    cloudStore.capabilityState = 'verified'

    await cloudStore.selectBusiness(CAFE.id)
    await cloudStore.selectOutlet(8)
    // Simulate a cashier whose context was already verified.
    cloudStore.role = 'cashier'
    cloudStore.capabilityState = 'verified'

    await cloudStore.confirmBusinessSwitch()

    expect(cloudStore.pushPolicy.role).toBe('cashier')
    expect(cloudStore.isCashierContext).toBe(true)
    expect(cloudStore.canPerformCloudPush).toBe(true)
    // A cashier may never self-register a device, even after switching.
    const reg = await cloudStore.doRegisterDevice({ platform: 'android' })
    expect(reg.ok).toBe(false)
    expect(reg.error.code).toBe('CASHIER_DEVICE_REGISTRATION_FORBIDDEN')
  })
})

// ════════════════════════════════════════════════════════════════════════════
// 11. Offline data remains usable after the related workspace is restored
// ════════════════════════════════════════════════════════════════════════════

describe('11. offline workspace data survives a switch away and back', () => {
  it('re-materialises the original offline data intact', async () => {
    const adapter = createMemoryAdapter()
    await adapter.initialize()
    await adapter.saveBusiness(LOCAL_LAUNDRY)
    await adapter.saveProducts(
      [{ id: 'p-lokal', name: 'Cuci Kiloan', category: 'Kiloan', price: 7000, stock: 3, isActive: true }],
      ['Kiloan'],
    )

    await switchOperationalWorkspace({ adapter, scheduler: createStubScheduler(), targetWorkspaceId: cloudWorkspaceId(CAFE.id, 8) })
    // Cloud workspace is empty on first open.
    expect((await adapter.loadProducts()).products).toEqual([])

    await switchOperationalWorkspace({ adapter, scheduler: createStubScheduler(), targetWorkspaceId: LOCAL_WORKSPACE_ID })
    const restored = await adapter.loadProducts()
    expect(restored.products.map((p) => p.id)).toEqual(['p-lokal'])
    expect((await adapter.loadBusiness()).name).toBe('Temuan')
  })
})

// ════════════════════════════════════════════════════════════════════════════
// 12. An unknown Cloud business_type never silently becomes Café
// ════════════════════════════════════════════════════════════════════════════

describe('12. unknown Cloud business_type is handled without a silent Café fallback', () => {
  it('keeps the type unknown and blocks activation', async () => {
    const { adapter, cloudStore, businessStore } = await makeContext()
    await seedLocalLaundry(adapter, businessStore)

    const unknown = {
      ...CAFE,
      business_type: null,
      business_type_status: 'unknown',
    }
    cloudStore.businesses = [unknown]

    const result = await cloudStore.selectBusiness(CAFE.id)
    expect(result.ok).toBe(true)
    expect(cloudStore.selectedBusiness.business_type).toBeNull()
    expect(cloudStore.operationalContext.status).toBe('unknown_type')

    await cloudStore.selectOutlet(8)
    const activation = await cloudStore.activateOperationalContext()
    expect(activation.code).toBe('CLOUD_BUSINESS_TYPE_UNKNOWN')
    // No silent Café identity was applied to the local workspace.
    expect(businessStore.name).toBe('Temuan')
    // Tenant operations stay blocked, but the server entitlement is preserved.
    expect(cloudStore.isOperationalCloudAccess).toBe(false)
    expect(cloudStore.cloudAccess).toBe(true)
    expect(cloudStore.hasCloudAccess).toBe(true)
  })

  it('classifies an unreadable workspace as unavailable (fail closed)', async () => {
    const report = await inspectLocalBusinessWorkspace({ adapter: null })
    expect(report.ok).toBe(false)
    expect(report.code).toBe(WORKSPACE_CLASSIFICATION.UNAVAILABLE)
  })
})

describe('13. Cloud-first workspace safety journals', () => {
  it('blocks initial Cloud reads while recovery, conflict, or operation journals are pending', async () => {
    const cases = [
      {
        reason: 'local_operation_pending',
        write: (adapter) =>
          adapter.saveLocalOperationJournal({ version: 1, entries: [{ status: 'pending' }] }),
      },
      {
        reason: 'restore_journal_pending',
        write: (adapter) => adapter.saveRestoreJournal({ version: 1, phase: 'applying' }),
      },
      {
        reason: 'workspace_switch_pending',
        write: (adapter) => adapter.saveWorkspaceSwitchJournal({ version: 1, phase: 'applying' }),
      },
      {
        reason: 'sync_conflict_pending',
        write: (adapter) =>
          adapter.saveSyncConflicts({ version: 1, conflicts: [{ id: 'c-1', status: 'open' }] }),
      },
      {
        reason: 'inconsistent_pull_state',
        write: (adapter) =>
          adapter.saveSyncPullState({ version: 1, cursor: -1, serverSequence: 0, updatedAt: '2026-01-01' }),
      },
    ]

    for (const scenario of cases) {
      const adapter = createMemoryAdapter()
      await adapter.initialize()
      await scenario.write(adapter)

      const report = await inspectCloudFirstWorkspace({ adapter })
      expect(report.ok).toBe(true)
      expect(report.safeToInitialize).toBe(false)
      expect(report.reasons).toContain(scenario.reason)
    }
  })

  it('fails closed when persistence flush fails during Cloud-first inspection', async () => {
    const adapter = createMemoryAdapter()
    await adapter.initialize()
    const failingScheduler = {
      flush: vi.fn().mockRejectedValue(new Error('disk write failed')),
    }

    const report = await inspectCloudFirstWorkspace({ adapter, scheduler: failingScheduler })
    expect(report).toMatchObject({
      ok: false,
      safeToInitialize: false,
      code: WORKSPACE_CLASSIFICATION.READ_FAILED,
      reasons: ['persistence_operation_pending'],
    })
  })

  it('fails closed when a Cloud-first journal reader is unavailable', async () => {
    const adapter = createMemoryAdapter()
    await adapter.initialize()
    const { loadRestoreJournal, ...withoutRestoreReader } = adapter

    const report = await inspectCloudFirstWorkspace({ adapter: withoutRestoreReader })
    expect(report).toMatchObject({
      ok: false,
      safeToInitialize: false,
      code: WORKSPACE_CLASSIFICATION.UNAVAILABLE,
    })
    expect(loadRestoreJournal).toBeTypeOf('function')
  })

  it('differentiates valid Auto Sync preference from operational sync metadata', async () => {
    const validContext = {
      businessId: 10,
      outletId: 20,
      registeredDeviceId: 77,
      deviceIdentifier: 'dev-123',
    }

    // 1. Workspace kosong tanpa preferensi -> safe
    const adapter1 = createMemoryAdapter()
    await adapter1.initialize()
    await adapter1.saveCloudContext({
      selectedBusiness: { id: 10 },
      selectedOutlet: { id: 20 },
      registeredDeviceId: 77,
      deviceIdentifier: 'dev-123',
    })
    const report1 = await inspectCloudFirstWorkspace({ adapter: adapter1 })
    expect(report1.ok).toBe(true)
    expect(report1.safeToInitialize).toBe(true)
    expect(report1.reasons).toEqual([])

    // 2. Workspace kosong dengan Auto Sync enabled yang valid -> safe
    const adapter2 = createMemoryAdapter()
    await adapter2.initialize()
    await adapter2.saveCloudContext({
      selectedBusiness: { id: 10 },
      selectedOutlet: { id: 20 },
      registeredDeviceId: 77,
      deviceIdentifier: 'dev-123',
    })
    await adapter2.saveSyncAutoSettings({
      version: 1,
      enabled: true,
      context: validContext,
      updatedAt: '2026-10-18T00:00:00.000Z',
    })
    const report2 = await inspectCloudFirstWorkspace({ adapter: adapter2 })
    expect(report2.ok).toBe(true)
    expect(report2.safeToInitialize).toBe(true)
    expect(report2.reasons).toEqual([])

    // 3. Workspace kosong dengan Auto Sync disabled yang valid -> safe
    const adapter3 = createMemoryAdapter()
    await adapter3.initialize()
    await adapter3.saveCloudContext({
      selectedBusiness: { id: 10 },
      selectedOutlet: { id: 20 },
      registeredDeviceId: 77,
      deviceIdentifier: 'dev-123',
    })
    await adapter3.saveSyncAutoSettings({
      version: 1,
      enabled: false,
      context: validContext,
      updatedAt: '2026-10-18T00:00:00.000Z',
    })
    const report3 = await inspectCloudFirstWorkspace({ adapter: adapter3 })
    expect(report3.ok).toBe(true)
    expect(report3.safeToInitialize).toBe(true)

    // 4. Preferensi dari bisnis lain -> diblokir
    const adapter4 = createMemoryAdapter()
    await adapter4.initialize()
    await adapter4.saveCloudContext({
      selectedBusiness: { id: 10 },
      selectedOutlet: { id: 20 },
      registeredDeviceId: 77,
      deviceIdentifier: 'dev-123',
    })
    await adapter4.saveSyncAutoSettings({
      version: 1,
      enabled: true,
      context: { ...validContext, businessId: 999 },
      updatedAt: '2026-10-18T00:00:00.000Z',
    })
    const report4 = await inspectCloudFirstWorkspace({ adapter: adapter4 })
    expect(report4.ok).toBe(true)
    expect(report4.safeToInitialize).toBe(false)
    expect(report4.reasons).toContain('auto_sync_context_mismatch')

    // 5. Preferensi corrupt -> fail-closed
    const adapter5 = createMemoryAdapter()
    await adapter5.initialize()
    await adapter5.saveCloudContext({
      selectedBusiness: { id: 10 },
      selectedOutlet: { id: 20 },
      registeredDeviceId: 77,
      deviceIdentifier: 'dev-123',
    })
    await adapter5.saveSyncAutoSettings({
      version: 99,
      enabled: 'yes',
      context: 'corrupt',
    })
    const report5 = await inspectCloudFirstWorkspace({ adapter: adapter5 })
    expect(report5.ok).toBe(true)
    expect(report5.safeToInitialize).toBe(false)
    expect(report5.reasons).toContain('auto_sync_settings_invalid')

    // 6. Data transaksi atau outbox pending tetap memblokir initial pull
    const adapter6 = createMemoryAdapter()
    await adapter6.initialize()
    await adapter6.saveCloudContext({
      selectedBusiness: { id: 10 },
      selectedOutlet: { id: 20 },
      registeredDeviceId: 77,
      deviceIdentifier: 'dev-123',
    })
    await adapter6.saveSyncAutoSettings({
      version: 1,
      enabled: true,
      context: validContext,
      updatedAt: '2026-10-18T00:00:00.000Z',
    })
    await adapter6.saveTransactions([{ id: 'trx-1', total: 10000 }])
    const report6 = await inspectCloudFirstWorkspace({ adapter: adapter6 })
    expect(report6.ok).toBe(true)
    expect(report6.safeToInitialize).toBe(false)
    expect(report6.reasons).toContain('transactions')
  })
})

// ════════════════════════════════════════════════════════════════════════════
// UI: the switch modal renders and drives cancel / confirm
// ════════════════════════════════════════════════════════════════════════════

describe('UI — business switch confirmation modal', () => {
  async function mountLoginWithLocalLaundry() {
    const pinia = createPinia()
    setActivePinia(pinia)
    const adapter = createMemoryAdapter()
    await adapter.initialize()
    const cloudStore = useCloudSessionStore(pinia)
    cloudStore.setPersistenceAdapter(adapter, createStubScheduler())
    const businessStore = useBusinessStore(pinia)
    await seedLocalLaundry(adapter, businessStore)

    apiRequest
      .mockResolvedValueOnce(ok({ token: 'tok', user: { id: 1, name: 'Owner', email: 'owner@example.com' } }))
      .mockResolvedValueOnce(ok({ user: { id: 1 }, businesses: [CAFE] }))
      .mockResolvedValue(ok({ id: 900 }))

    const wrapper = mount(CloudLoginView, { global: { plugins: [pinia] } })
    await wrapper.find('#cloud-email input').setValue('owner@example.com')
    await wrapper.find('#cloud-password input').setValue('secret')
    await wrapper.find('#cloud-login-btn').trigger('click')
    await flushPromises()
    await wrapper.find('#cloud-confirm-link-btn').trigger('click')
    await flushPromises()

    return { wrapper, cloudStore, businessStore }
  }

  it('shows the confirmation modal instead of a red error', async () => {
    const { wrapper } = await mountLoginWithLocalLaundry()

    expect(wrapper.find('[data-testid="business-switch-modal"]').exists()).toBe(true)
    expect(wrapper.find('#business-switch-message').text()).toContain('Temuan (Laundry)')
    expect(wrapper.find('#business-switch-message').text()).toContain('Kopi Nusantara (Cafe)')
  })

  it('cancel keeps the old workspace', async () => {
    const { wrapper, businessStore } = await mountLoginWithLocalLaundry()

    await wrapper.find('#business-switch-cancel').trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-testid="business-switch-modal"]').exists()).toBe(false)
    expect(businessStore.name).toBe('Temuan')
  })

  it('confirm activates the Café workspace', async () => {
    const { wrapper, businessStore, cloudStore } = await mountLoginWithLocalLaundry()

    await wrapper.find('#business-switch-confirm').trigger('click')
    await flushPromises()

    expect(businessStore.name).toBe('Kopi Nusantara')
    expect(cloudStore.operationalContext.status).toBe('active')
  })
})
