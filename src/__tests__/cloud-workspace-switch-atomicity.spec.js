/**
 * PR #57 final review fixes — fresh-activation atomicity, target snapshot
 * resolution, journal read failure, and Cloud entitlement separation.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

import { _resetTokenStore } from '@/services/cloud/tokenRepository'
import { createMemoryAdapter } from '@/services/database/memoryAdapter'
import {
  LOCAL_WORKSPACE_ID,
  WORKSPACE_RECOVERY_RESULT,
  WORKSPACE_SWITCH_RESULT,
  cloudWorkspaceId,
  isValidWorkspaceSnapshot,
  recoverPendingWorkspaceSwitch,
  resolveActiveWorkspaceId,
  switchOperationalWorkspace,
} from '@/services/cloud/businessWorkspaceService'
import { useBusinessStore } from '@/stores/businessStore'
import { useCloudSessionStore } from '@/stores/cloudSessionStore'

vi.mock('@/services/cloud/apiClient', () => ({ apiRequest: vi.fn() }))

const LOCAL_ID = LOCAL_WORKSPACE_ID
const CAFE = {
  id: 72,
  name: 'Kopi Nusantara',
  business_type: 'Cafe / UMKM',
  business_type_status: 'valid',
  role: null,
  cloud_access: true,
  subscription: { plan: 'premium' },
  outlets: [{ id: 8, name: 'Outlet Pusat', status: 'active' }],
  device_context: null,
}
const LOCAL_BUSINESS = {
  name: 'Temuan',
  type: 'Laundry',
  owner: '',
  phone: '',
  outlet: 'Outlet Utama',
  mode: 'free',
}
const cafeTarget = cloudWorkspaceId(CAFE.id, 8)

function stubScheduler() {
  return { flush: async () => {}, rehydrate: async () => {}, runSerialized: (task) => task() }
}

function wrap(adapter, overrides) {
  return Object.assign({}, adapter, overrides)
}

async function freshAdapter() {
  const adapter = createMemoryAdapter()
  await adapter.initialize()
  return adapter
}

async function seededAdapter() {
  const adapter = await freshAdapter()
  await adapter.saveBusiness(LOCAL_BUSINESS)
  await adapter.saveProducts(
    [{ id: 'p-local', name: 'Cuci Kiloan', category: 'Kiloan', price: 7000, stock: 2, isActive: true }],
    ['Kiloan'],
  )
  return adapter
}

/** A store on a *fresh, empty* device (no local business, no local data). */
async function freshStoreContext(adapter) {
  const pinia = createPinia()
  setActivePinia(pinia)
  const cloudStore = useCloudSessionStore(pinia)
  cloudStore.setPersistenceAdapter(adapter, stubScheduler())
  cloudStore.user = { id: 1, name: 'Owner', email: 'owner@example.com' }
  cloudStore.businesses = [CAFE]
  const businessStore = useBusinessStore(pinia)
  return { pinia, cloudStore, businessStore }
}

async function attemptFreshActivation(adapter, cloudStore) {
  await cloudStore.selectBusiness(CAFE.id)
  await cloudStore.selectOutlet(8)
  return cloudStore.activateOperationalContext()
}

beforeEach(() => {
  _resetTokenStore()
  vi.clearAllMocks()
  setActivePinia(createPinia())
})

// ════════════════════════════════════════════════════════════════════════════
// FIX 1 — fresh workspace activation atomicity
// ════════════════════════════════════════════════════════════════════════════

describe('FIX 1 — fresh activation atomicity', () => {
  it('1. does not advance the registry when the registry write fails', async () => {
    const adapter = await freshAdapter()
    // The registry commit fails once; the rollback's registry restore succeeds.
    let failOnce = true
    const failing = wrap(adapter, {
      saveWorkspaceRegistry: async (registry) => {
        if (failOnce) {
          failOnce = false
          throw new Error('registry write failed')
        }
        return adapter.saveWorkspaceRegistry(registry)
      },
    })
    const { cloudStore, businessStore } = await freshStoreContext(failing)

    const result = await attemptFreshActivation(failing, cloudStore)

    expect(result.ok).toBe(false)
    expect(result.code).toBe(WORKSPACE_SWITCH_RESULT.REGISTRY_WRITE_FAILED)
    expect(result.rollback).toMatchObject({ ok: true })
    // Workspace + registry stay on the previous (local) workspace.
    expect(businessStore.name).toBe('')
    expect(cloudStore.activeWorkspaceId).toBe(LOCAL_ID)
    expect(cloudStore.operationalContext?.status).not.toBe('active')
    expect(await resolveActiveWorkspaceId(adapter)).toBe(LOCAL_ID)
  })

  it('2. does not advance the registry when the business identity write fails', async () => {
    const adapter = await freshAdapter()
    const failing = wrap(adapter, {
      saveBusiness: async (data) => {
        if (data?.name === CAFE.name) {
          throw new Error('identity write failed')
        }
        return adapter.saveBusiness(data)
      },
    })
    const { cloudStore, businessStore } = await freshStoreContext(failing)

    const result = await attemptFreshActivation(failing, cloudStore)

    expect(result.ok).toBe(false)
    expect(result.code).toBe(WORKSPACE_SWITCH_RESULT.APPLY_FAILED)
    expect(result.rollback).toMatchObject({ ok: true })
    expect(businessStore.name).toBe('')
    expect(cloudStore.activeWorkspaceId).toBe(LOCAL_ID)
    expect(await resolveActiveWorkspaceId(adapter)).toBe(LOCAL_ID)
  })

  it('3. does not advance the registry when Cloud context persistence fails', async () => {
    const adapter = await freshAdapter()
    const failing = wrap(adapter, {
      saveCloudContext: () => {
        throw new Error('cloud context write failed')
      },
    })
    const { cloudStore, businessStore } = await freshStoreContext(failing)

    const result = await attemptFreshActivation(failing, cloudStore)

    expect(result.ok).toBe(false)
    expect(result.code).toBe(WORKSPACE_SWITCH_RESULT.APPLY_FAILED)
    expect(result.rollback).toMatchObject({ ok: true })
    expect(businessStore.name).toBe('')
    expect(cloudStore.activeWorkspaceId).toBe(LOCAL_ID)
    expect(cloudStore.operationalContext?.status).not.toBe('active')
    expect(await resolveActiveWorkspaceId(adapter)).toBe(LOCAL_ID)
  })
})

// ════════════════════════════════════════════════════════════════════════════
// FIX 2 — missing / corrupt target snapshot
// ════════════════════════════════════════════════════════════════════════════

describe('FIX 2 — target snapshot resolution', () => {
  it('4. fails closed when a registered target has no snapshot', async () => {
    const adapter = await seededAdapter()
    await adapter.saveWorkspaceRegistry({
      version: 1,
      activeWorkspaceId: LOCAL_ID,
      workspaces: { [cafeTarget]: { id: cafeTarget, kind: 'cloud', name: 'Kopi Nusantara' } },
    })

    const result = await switchOperationalWorkspace({
      adapter,
      scheduler: stubScheduler(),
      targetWorkspaceId: cafeTarget,
    })

    expect(result.ok).toBe(false)
    expect(result.code).toBe(WORKSPACE_SWITCH_RESULT.TARGET_SNAPSHOT_MISSING)
    // Source data + registry untouched, no journal written.
    expect((await adapter.loadBusiness()).name).toBe('Temuan')
    expect((await adapter.loadProducts()).products.map((p) => p.id)).toEqual(['p-local'])
    expect((await adapter.loadWorkspaceRegistry()).activeWorkspaceId).toBe(LOCAL_ID)
    expect(await adapter.loadWorkspaceSwitchJournal()).toBeNull()
  })

  it('5. fails closed when the target snapshot is corrupt', async () => {
    const adapter = await seededAdapter()
    await adapter.saveWorkspaceRegistry({
      version: 1,
      activeWorkspaceId: LOCAL_ID,
      workspaces: { [cafeTarget]: { id: cafeTarget, kind: 'cloud', name: 'Kopi Nusantara' } },
    })
    await adapter.saveWorkspaceSnapshot(cafeTarget, { version: 1 })

    const result = await switchOperationalWorkspace({
      adapter,
      scheduler: stubScheduler(),
      targetWorkspaceId: cafeTarget,
    })

    expect(result.ok).toBe(false)
    expect(result.code).toBe(WORKSPACE_SWITCH_RESULT.TARGET_SNAPSHOT_INVALID)
    expect((await adapter.loadBusiness()).name).toBe('Temuan')
    expect(await adapter.loadWorkspaceSwitchJournal()).toBeNull()
  })

  it('still allows a genuinely new target to start empty', async () => {
    const adapter = await seededAdapter()
    const result = await switchOperationalWorkspace({
      adapter,
      scheduler: stubScheduler(),
      targetWorkspaceId: cafeTarget,
    })

    expect(result.ok).toBe(true)
    expect((await adapter.loadProducts()).products).toEqual([])
  })

  it('validates snapshot shape structurally', () => {
    expect(isValidWorkspaceSnapshot({ version: 1, business: { name: 'x' } })).toBe(true)
    expect(isValidWorkspaceSnapshot({ version: 1 })).toBe(false)
    expect(isValidWorkspaceSnapshot('nope')).toBe(false)
    expect(isValidWorkspaceSnapshot(null)).toBe(false)
    expect(isValidWorkspaceSnapshot({ version: 2, business: {} })).toBe(false)
    expect(isValidWorkspaceSnapshot({ version: 1, business: {}, products: 'x' })).toBe(false)
  })
})

// ════════════════════════════════════════════════════════════════════════════
// FIX 3 — journal read failure
// ════════════════════════════════════════════════════════════════════════════

describe('FIX 3 — journal read failure is not treated as "no journal"', () => {
  it('6a. aborts the switch when the journal cannot be read', async () => {
    const adapter = await seededAdapter()
    const failing = wrap(adapter, {
      loadWorkspaceSwitchJournal: () => {
        throw new Error('journal read failed')
      },
    })

    const result = await switchOperationalWorkspace({
      adapter: failing,
      scheduler: stubScheduler(),
      targetWorkspaceId: cafeTarget,
    })

    expect(result.ok).toBe(false)
    expect(result.code).toBe(WORKSPACE_SWITCH_RESULT.JOURNAL_READ_FAILED)
    // Nothing changed: source intact, no target snapshot, no journal.
    expect((await adapter.loadBusiness()).name).toBe('Temuan')
    expect(await adapter.loadWorkspaceSnapshot(cafeTarget)).toBeNull()
    expect(await adapter.loadWorkspaceSwitchJournal()).toBeNull()
  })

  it('6b. requires recovery when the journal cannot be read at startup', async () => {
    const adapter = await seededAdapter()
    const failing = wrap(adapter, {
      loadWorkspaceSwitchJournal: () => {
        throw new Error('journal read failed')
      },
    })

    const result = await recoverPendingWorkspaceSwitch({
      adapter: failing,
      scheduler: stubScheduler(),
    })

    expect(result.ok).toBe(false)
    expect(result.code).toBe(WORKSPACE_RECOVERY_RESULT.RECOVERY_REQUIRED)
    expect((await adapter.loadBusiness()).name).toBe('Temuan')
  })
})

// ════════════════════════════════════════════════════════════════════════════
// FIX 4 — Cloud entitlement separation
// ════════════════════════════════════════════════════════════════════════════

describe('FIX 4 — entitlement is never derived from the business type', () => {
  it('7. keeps the server entitlement for an explicit unknown business_type', async () => {
    const adapter = await seededAdapter()
    const { cloudStore, businessStore } = await freshStoreContext(adapter)
    cloudStore.businesses = [{ ...CAFE, business_type: null, business_type_status: 'unknown' }]
    businessStore.setBusiness(LOCAL_BUSINESS)

    const selection = await cloudStore.selectBusiness(CAFE.id)
    expect(selection.ok).toBe(true)
    // Entitlement stays exactly as the backend reported it.
    expect(cloudStore.cloudAccess).toBe(true)
    expect(cloudStore.hasCloudAccess).toBe(true)
    // ...but tenant operations stay blocked for the unknown type.
    expect(cloudStore.operationalContext.status).toBe('unknown_type')
    expect(cloudStore.isOperationalCloudAccess).toBe(false)

    await cloudStore.selectOutlet(8)
    const activation = await cloudStore.activateOperationalContext()
    expect(activation.code).toBe('CLOUD_BUSINESS_TYPE_UNKNOWN')
    expect(cloudStore.cloudAccess).toBe(true)
    expect(cloudStore.isOperationalCloudAccess).toBe(false)
    // The local workspace identity is untouched.
    expect(businessStore.name).toBe('Temuan')
  })

  it('preserves the legacy tolerant link when the backend omits business_type', async () => {
    const adapter = await seededAdapter()
    const { cloudStore } = await freshStoreContext(adapter)
    // A pre-INT-01 payload carries no business_type property at all -> 'legacy'.
    cloudStore.businesses = [
      { id: 90, name: 'Toko Legacy', cloud_access: true, outlets: [], role: null },
    ]

    await cloudStore.selectBusiness(90)

    expect(cloudStore.selectedBusiness.business_type_status).toBe('legacy')
    expect(cloudStore.cloudAccess).toBe(true)
    expect(cloudStore.isOperationalCloudAccess).toBe(true)
  })
})
