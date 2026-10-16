/**
 * PR #57 durability revision — workspace switching failure & crash-safety.
 *
 * These tests exercise every durable boundary of a workspace switch and assert
 * that no failure can lose data, produce a registry/data mismatch, or report a
 * successful rollback when the recovery actually failed.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

import { _resetTokenStore } from '@/services/cloud/tokenRepository'
import { createMemoryAdapter } from '@/services/database/memoryAdapter'
import {
  WORKSPACE_SWITCH_PHASE,
  WORKSPACE_SWITCH_RESULT,
  WORKSPACE_RECOVERY_RESULT,
  buildEmptyWorkspaceSnapshot,
  captureActiveWorkspaceSnapshot,
  cloudWorkspaceId,
  computeWorkspaceChecksum,
  readWorkspaceRegistryStrict,
  recoverPendingWorkspaceSwitch,
  switchOperationalWorkspace,
} from '@/services/cloud/businessWorkspaceService'
import { useBusinessStore } from '@/stores/businessStore'
import { useCloudSessionStore } from '@/stores/cloudSessionStore'

vi.mock('@/services/cloud/apiClient', () => ({ apiRequest: vi.fn() }))

const LOCAL_ID = 'local:default'
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
const LAUNDRY_CLOUD = {
  id: 81,
  name: 'Laundry Bersih Wangi',
  business_type: 'Laundry',
  business_type_status: 'valid',
  role: null,
  cloud_access: true,
  subscription: { plan: 'premium' },
  outlets: [{ id: 9, name: 'Outlet Laundry', status: 'active' }],
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
const laundryTarget = cloudWorkspaceId(LAUNDRY_CLOUD.id, 9)

function createStubScheduler(overrides = {}) {
  return {
    flush: async () => {},
    rehydrate: async () => {},
    runSerialized: (task) => task(),
    ...overrides,
  }
}

async function makeAdapter(seed = true) {
  const adapter = createMemoryAdapter()
  await adapter.initialize()
  if (seed) {
    await adapter.saveBusiness(LOCAL_BUSINESS)
    await adapter.saveProducts(
      [{ id: 'p-local', name: 'Cuci Kiloan', category: 'Kiloan', price: 7000, stock: 2, isActive: true }],
      ['Kiloan'],
    )
  }
  return adapter
}

function wrapAdapter(adapter, overrides) {
  return Object.assign({}, adapter, overrides)
}

beforeEach(() => {
  _resetTokenStore()
  vi.clearAllMocks()
  setActivePinia(createPinia())
})

// ════════════════════════════════════════════════════════════════════════════
// 1. Persistence flush fails
// ════════════════════════════════════════════════════════════════════════════

describe('1. flush failure aborts the switch', () => {
  it('does not snapshot or materialise and keeps the workspace active', async () => {
    const adapter = await makeAdapter()
    const scheduler = createStubScheduler({
      flush: async () => {
        throw new Error('write queue failed')
      },
    })

    const result = await switchOperationalWorkspace({
      adapter,
      scheduler,
      targetWorkspaceId: cafeTarget,
    })

    expect(result.ok).toBe(false)
    expect(result.code).toBe(WORKSPACE_SWITCH_RESULT.FLUSH_FAILED)
    // Source untouched, no target snapshot created, no journal left behind.
    expect((await adapter.loadBusiness()).name).toBe('Temuan')
    expect(await adapter.loadWorkspaceSnapshot(cafeTarget)).toBeNull()
    expect(await adapter.loadWorkspaceSwitchJournal()).toBeNull()
    // The registry was never touched (no commit happened).
    expect(await adapter.loadWorkspaceRegistry()).toBeNull()
  })

  it('fails closed when no scheduler is available', async () => {
    const adapter = await makeAdapter()
    const result = await switchOperationalWorkspace({ adapter, targetWorkspaceId: cafeTarget })
    expect(result.code).toBe(WORKSPACE_SWITCH_RESULT.SCHEDULER_UNAVAILABLE)
    expect((await adapter.loadBusiness()).name).toBe('Temuan')
  })
})

// ════════════════════════════════════════════════════════════════════════════
// 2. Snapshot save fails
// ════════════════════════════════════════════════════════════════════════════

describe('2. source snapshot save failure', () => {
  it('aborts and preserves the source data', async () => {
    const adapter = await makeAdapter()
    const failing = wrapAdapter(adapter, {
      saveWorkspaceSnapshot: () => {
        throw new Error('disk full')
      },
    })

    const result = await switchOperationalWorkspace({
      adapter: failing,
      scheduler: createStubScheduler(),
      targetWorkspaceId: cafeTarget,
    })

    expect(result.code).toBe(WORKSPACE_SWITCH_RESULT.SNAPSHOT_WRITE_FAILED)
    expect((await adapter.loadBusiness()).name).toBe('Temuan')
    expect((await adapter.loadProducts()).products.map((p) => p.id)).toEqual(['p-local'])
  })
})

// ════════════════════════════════════════════════════════════════════════════
// 3. Snapshot read-back fails
// ════════════════════════════════════════════════════════════════════════════

describe('3. source snapshot read-back failure', () => {
  it('aborts before any materialisation', async () => {
    const adapter = await makeAdapter()
    const failing = wrapAdapter(adapter, {
      loadWorkspaceSnapshot: () => {
        throw new Error('read error')
      },
    })

    const result = await switchOperationalWorkspace({
      adapter: failing,
      scheduler: createStubScheduler(),
      targetWorkspaceId: cafeTarget,
    })

    expect(result.code).toBe(WORKSPACE_SWITCH_RESULT.SNAPSHOT_VERIFY_FAILED)
    expect((await adapter.loadBusiness()).name).toBe('Temuan')
    expect(await adapter.loadWorkspaceSwitchJournal()).toBeNull()
  })
})

// ════════════════════════════════════════════════════════════════════════════
// 4. Materialisation interrupted on a partial write
// ════════════════════════════════════════════════════════════════════════════

describe('4. partial materialisation', () => {
  it('rolls back to the source workspace when the target write is interrupted', async () => {
    const adapter = await makeAdapter()
    let failOnce = true
    const flaky = wrapAdapter(adapter, {
      saveCustomers: async (customers) => {
        if (failOnce) {
          failOnce = false
          throw new Error('partial write interrupted')
        }
        return adapter.saveCustomers(customers)
      },
    })

    const result = await switchOperationalWorkspace({
      adapter: flaky,
      scheduler: createStubScheduler(),
      targetWorkspaceId: cafeTarget,
    })

    expect(result.ok).toBe(false)
    expect(result.code).toBe(WORKSPACE_SWITCH_RESULT.APPLY_FAILED)
    expect(result.rollback).toMatchObject({ ok: true })
    // Source restored, registry unchanged, journal cleared.
    expect((await adapter.loadBusiness()).name).toBe('Temuan')
    expect((await adapter.loadProducts()).products.map((p) => p.id)).toEqual(['p-local'])
    expect((await adapter.loadWorkspaceRegistry()).activeWorkspaceId).toBe(LOCAL_ID)
    expect(await adapter.loadWorkspaceSwitchJournal()).toBeNull()
  })
})

// ════════════════════════════════════════════════════════════════════════════
// 5. Registry commit fails
// ════════════════════════════════════════════════════════════════════════════

describe('5. registry commit failure', () => {
  it('rolls back the materialised target and restores the source', async () => {
    const adapter = await makeAdapter()
    // The registry commit fails once; the rollback's registry restore succeeds.
    let failOnce = true
    const failing = wrapAdapter(adapter, {
      saveWorkspaceRegistry: async (registry) => {
        if (failOnce) {
          failOnce = false
          throw new Error('registry write failed')
        }
        return adapter.saveWorkspaceRegistry(registry)
      },
    })

    const result = await switchOperationalWorkspace({
      adapter: failing,
      scheduler: createStubScheduler(),
      targetWorkspaceId: cafeTarget,
    })

    expect(result.code).toBe(WORKSPACE_SWITCH_RESULT.REGISTRY_WRITE_FAILED)
    expect(result.rollback).toMatchObject({ ok: true })
    expect((await adapter.loadBusiness()).name).toBe('Temuan')
    expect(await adapter.loadWorkspaceSwitchJournal()).toBeNull()
  })
})

// ════════════════════════════════════════════════════════════════════════════
// 6. Cloud context persistence fails after materialisation
// ════════════════════════════════════════════════════════════════════════════

describe('6. Cloud context persistence failure after materialisation', () => {
  it('rolls back the workspace and keeps the Cloud link intact', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const adapter = await makeAdapter()
    const failing = wrapAdapter(adapter, {
      saveCloudContext: () => {
        throw new Error('cloud context write failed')
      },
    })
    const cloudStore = useCloudSessionStore(pinia)
    cloudStore.setPersistenceAdapter(failing, createStubScheduler())
    const businessStore = useBusinessStore(pinia)
    businessStore.setBusiness(LOCAL_BUSINESS)
    cloudStore.user = { id: 1, name: 'Owner', email: 'owner@example.com' }
    cloudStore.businesses = [CAFE]

    await cloudStore.selectBusiness(CAFE.id)
    await cloudStore.selectOutlet(8)
    const result = await cloudStore.confirmBusinessSwitch()

    expect(result.ok).toBe(false)
    expect(result.code).toBe(WORKSPACE_SWITCH_RESULT.APPLY_FAILED)
    // Workspace rolled back to the local business...
    expect(businessStore.name).toBe('Temuan')
    expect((await adapter.loadBusiness()).name).toBe('Temuan')
    expect((await adapter.loadProducts()).products.map((p) => p.id)).toEqual(['p-local'])
    // ...but the Cloud account stays linked and entitled.
    expect(cloudStore.isLinked).toBe(true)
    expect(cloudStore.cloudAccess).toBe(true)
    expect(cloudStore.workspaceRecoveryRequired).toBe(false)
  })
})

// ════════════════════════════════════════════════════════════════════════════
// 7. Rollback fails
// ════════════════════════════════════════════════════════════════════════════

describe('7. failed rollback is never reported as success', () => {
  it('reports recovery-required and blocks risky operations', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const adapter = await makeAdapter()
    const failing = wrapAdapter(adapter, {
      saveCustomers: () => {
        throw new Error('disk permanently full')
      },
    })
    const cloudStore = useCloudSessionStore(pinia)
    cloudStore.setPersistenceAdapter(failing, createStubScheduler())
    const businessStore = useBusinessStore(pinia)
    businessStore.setBusiness(LOCAL_BUSINESS)
    cloudStore.user = { id: 1, name: 'Owner', email: 'owner@example.com' }
    cloudStore.businesses = [CAFE]

    await cloudStore.selectBusiness(CAFE.id)
    await cloudStore.selectOutlet(8)
    const result = await cloudStore.confirmBusinessSwitch()

    expect(result.ok).toBe(false)
    expect(result.rollback).toMatchObject({ ok: false })
    expect(result.rollback.code).toBe(WORKSPACE_SWITCH_RESULT.RECOVERY_REQUIRED)
    expect(cloudStore.workspaceRecoveryRequired).toBe(true)
    // Tenant data + sync stay blocked while the workspace is inconsistent.
    expect(cloudStore.isOperationalCloudAccess).toBe(false)
    // No data was deleted.
    const journal = await adapter.loadWorkspaceSwitchJournal()
    expect(journal.phase).toBe(WORKSPACE_SWITCH_PHASE.RECOVERY_REQUIRED)
  })
})

// ════════════════════════════════════════════════════════════════════════════
// 8. Crash recovery (journal pending at startup)
// ════════════════════════════════════════════════════════════════════════════

describe('8. restart with a pending switching journal', () => {
  async function seedInterruptedSwitch(adapter, phase) {
    const sourceSnapshot = await captureActiveWorkspaceSnapshot(adapter)
    await adapter.saveWorkspaceSnapshot(LOCAL_ID, sourceSnapshot)
    const registryBefore = {
      version: 1,
      activeWorkspaceId: LOCAL_ID,
      workspaces: { [LOCAL_ID]: { id: LOCAL_ID, kind: 'local', name: 'Temuan' } },
    }
    await adapter.saveWorkspaceRegistry(registryBefore)
    // Simulate the interrupted materialisation: target business already written.
    await adapter.saveBusiness({ ...LOCAL_BUSINESS, name: 'Kopi Nusantara', type: 'Cafe / UMKM' })
    await adapter.saveWorkspaceSwitchJournal({
      version: 1,
      operationId: 'op-crash',
      phase,
      phaseHistory: [],
      sourceWorkspaceId: LOCAL_ID,
      targetWorkspaceId: cafeTarget,
      sourceChecksum: computeWorkspaceChecksum(sourceSnapshot),
      registryBefore,
      targetMeta: { name: 'Kopi Nusantara', type: 'Cafe / UMKM', businessId: 72, outletId: 8 },
    })
  }

  it('rolls back an APPLYING switch and restores the source workspace', async () => {
    const adapter = await makeAdapter()
    await seedInterruptedSwitch(adapter, WORKSPACE_SWITCH_PHASE.APPLYING)

    const result = await recoverPendingWorkspaceSwitch({
      adapter,
      scheduler: createStubScheduler(),
    })

    expect(result.ok).toBe(true)
    expect(result.code).toBe(WORKSPACE_RECOVERY_RESULT.ROLLED_BACK)
    expect((await adapter.loadBusiness()).name).toBe('Temuan')
    expect((await adapter.loadWorkspaceRegistry()).activeWorkspaceId).toBe(LOCAL_ID)
    expect(await adapter.loadWorkspaceSwitchJournal()).toBeNull()
  })

  it('finalises an APPLIED switch when the registry already committed', async () => {
    const adapter = await makeAdapter()
    await seedInterruptedSwitch(adapter, WORKSPACE_SWITCH_PHASE.APPLIED)
    const registry = await adapter.loadWorkspaceRegistry()
    registry.activeWorkspaceId = cafeTarget
    registry.workspaces[cafeTarget] = { id: cafeTarget, kind: 'cloud', name: 'Kopi Nusantara' }
    await adapter.saveWorkspaceRegistry(registry)

    const result = await recoverPendingWorkspaceSwitch({
      adapter,
      scheduler: createStubScheduler(),
    })

    expect(result.ok).toBe(true)
    expect(result.code).toBe(WORKSPACE_RECOVERY_RESULT.FINALIZED_COMMITTED)
    // The committed target is kept, not rolled back.
    expect((await adapter.loadBusiness()).name).toBe('Kopi Nusantara')
    expect(await adapter.loadWorkspaceSwitchJournal()).toBeNull()
  })

  it('aborts a PREPARED journal without touching data', async () => {
    const adapter = await makeAdapter()
    await seedInterruptedSwitch(adapter, WORKSPACE_SWITCH_PHASE.PREPARED)

    const result = await recoverPendingWorkspaceSwitch({
      adapter,
      scheduler: createStubScheduler(),
    })

    expect(result.code).toBe(WORKSPACE_RECOVERY_RESULT.ABORTED_PREPARED)
    expect(await adapter.loadWorkspaceSwitchJournal()).toBeNull()
  })

  it('refuses to run when a source snapshot checksum is missing/mismatched', async () => {
    const adapter = await makeAdapter()
    await seedInterruptedSwitch(adapter, WORKSPACE_SWITCH_PHASE.APPLYING)
    const journal = await adapter.loadWorkspaceSwitchJournal()
    journal.sourceChecksum = 'ws-deadbeef'
    await adapter.saveWorkspaceSwitchJournal(journal)

    const result = await recoverPendingWorkspaceSwitch({
      adapter,
      scheduler: createStubScheduler(),
    })

    expect(result.ok).toBe(false)
    expect(result.code).toBe(WORKSPACE_RECOVERY_RESULT.RECOVERY_REQUIRED)
  })
})

// ════════════════════════════════════════════════════════════════════════════
// 9. Registry invalid / unreadable
// ════════════════════════════════════════════════════════════════════════════

describe('9. unreadable registry is fail-closed', () => {
  it('never treats an unreadable registry as an empty device', async () => {
    const adapter = await makeAdapter()
    await adapter.saveWorkspaceRegistry('not-an-object')

    const strict = await readWorkspaceRegistryStrict(adapter)
    expect(strict.ok).toBe(false)
    expect(strict.code).toBe(WORKSPACE_SWITCH_RESULT.REGISTRY_UNREADABLE)

    const result = await switchOperationalWorkspace({
      adapter,
      scheduler: createStubScheduler(),
      targetWorkspaceId: cafeTarget,
    })
    expect(result.code).toBe(WORKSPACE_SWITCH_RESULT.REGISTRY_UNREADABLE)
    // The healthy source data and its snapshot were not overwritten.
    expect((await adapter.loadBusiness()).name).toBe('Temuan')
  })

  it('blocks activation in the store when the registry is unreadable', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const adapter = await makeAdapter()
    await adapter.saveWorkspaceRegistry({ version: 99, workspaces: {} })
    const cloudStore = useCloudSessionStore(pinia)
    cloudStore.setPersistenceAdapter(adapter, createStubScheduler())
    const businessStore = useBusinessStore(pinia)
    businessStore.setBusiness(LOCAL_BUSINESS)
    cloudStore.user = { id: 1, name: 'Owner', email: 'owner@example.com' }
    cloudStore.businesses = [CAFE]

    await cloudStore.selectBusiness(CAFE.id)
    await cloudStore.selectOutlet(8)
    const result = await cloudStore.confirmBusinessSwitch()

    expect(result.code).toBe(WORKSPACE_SWITCH_RESULT.REGISTRY_UNREADABLE)
    expect(businessStore.name).toBe('Temuan')
  })
})

// ════════════════════════════════════════════════════════════════════════════
// 10. Pending local operation journal before switching
// ════════════════════════════════════════════════════════════════════════════

describe('10. pending operation journal blocks the switch', () => {
  it('holds the switch without cancelling the Cloud login', async () => {
    const adapter = await makeAdapter()
    await adapter.saveLocalOperationJournal({
      version: 1,
      entries: [{ operationId: 'op-1', status: 'pending', operationType: 'retail_sale' }],
    })

    const result = await switchOperationalWorkspace({
      adapter,
      scheduler: createStubScheduler(),
      targetWorkspaceId: cafeTarget,
    })

    expect(result.code).toBe(WORKSPACE_SWITCH_RESULT.BLOCKED_PENDING_OPERATION)
    expect(result.blockers).toContain('local_operation_pending')
    expect((await adapter.loadBusiness()).name).toBe('Temuan')
    expect(await adapter.loadWorkspaceSwitchJournal()).toBeNull()
  })

  it('also blocks on an unresolved restore journal', async () => {
    const adapter = await makeAdapter()
    await adapter.saveRestoreJournal({ phase: 'applying' })

    const result = await switchOperationalWorkspace({
      adapter,
      scheduler: createStubScheduler(),
      targetWorkspaceId: cafeTarget,
    })

    expect(result.code).toBe(WORKSPACE_SWITCH_RESULT.BLOCKED_PENDING_OPERATION)
    expect(result.blockers).toContain('restore_journal_pending')
  })
})

// ════════════════════════════════════════════════════════════════════════════
// 11. Sync running while a switch is requested
// ════════════════════════════════════════════════════════════════════════════

describe('11. running sync blocks the switch', () => {
  it('blocks on an in-flight push envelope', async () => {
    const adapter = await makeAdapter()
    await adapter.saveSyncPushInflight({ version: 1, requestId: 'req-1', businessId: 72 })

    const result = await switchOperationalWorkspace({
      adapter,
      scheduler: createStubScheduler(),
      targetWorkspaceId: cafeTarget,
    })

    expect(result.code).toBe(WORKSPACE_SWITCH_RESULT.SYNC_IN_FLIGHT)
    expect(result.blockers).toContain('sync_inflight')
  })

  it('blocks on a running auto-sync pass', async () => {
    const adapter = await makeAdapter()
    const result = await switchOperationalWorkspace({
      adapter,
      scheduler: createStubScheduler(),
      targetWorkspaceId: cafeTarget,
      autoSyncRunning: true,
    })

    expect(result.code).toBe(WORKSPACE_SWITCH_RESULT.BLOCKED_PENDING_OPERATION)
    expect(result.blockers).toContain('auto_sync_running')
  })
})

// ════════════════════════════════════════════════════════════════════════════
// 12. Café → Laundry → Café keeps data + tenant sync metadata
// ════════════════════════════════════════════════════════════════════════════

describe('12. round-trip preserves data and tenant metadata', () => {
  it('keeps each workspace data + sync binding isolated across a full cycle', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const adapter = await makeAdapter()
    const cloudStore = useCloudSessionStore(pinia)
    cloudStore.setPersistenceAdapter(adapter, createStubScheduler())
    const businessStore = useBusinessStore(pinia)
    businessStore.setBusiness(LOCAL_BUSINESS)
    cloudStore.user = { id: 1, name: 'Owner', email: 'owner@example.com' }
    cloudStore.businesses = [CAFE, LAUNDRY_CLOUD]

    // Local Laundry → Café (confirmation).
    await cloudStore.selectBusiness(CAFE.id)
    await cloudStore.selectOutlet(8)
    await cloudStore.confirmBusinessSwitch()
    await adapter.saveProducts(
      [{ id: 'p-cafe', name: 'Es Kopi', category: 'Minuman', price: 22000, stock: 5, isActive: true }],
      ['Minuman'],
    )
    await adapter.saveSyncPushBinding({ businessId: CAFE.id, boundAt: new Date().toISOString() })
    await adapter.saveSyncServerVersions({ 'products:p-cafe': 3 })

    // Café → Laundry (confirmation). Tenant metadata must not leak.
    await cloudStore.selectBusiness(LAUNDRY_CLOUD.id)
    await cloudStore.selectOutlet(9)
    await cloudStore.confirmBusinessSwitch()
    expect(await adapter.loadSyncPushBinding()).toBeNull()
    expect(await adapter.loadSyncServerVersions()).toBeNull()
    expect((await adapter.loadProducts()).products).toEqual([])
    await adapter.saveProducts(
      [{ id: 'p-laundry', name: 'Cuci Express', category: 'Express', price: 12000, stock: 0, isActive: true }],
      ['Express'],
    )
    await adapter.saveSyncPushBinding({ businessId: LAUNDRY_CLOUD.id, boundAt: new Date().toISOString() })

    // Laundry → Café. Café data + tenant metadata restored exactly.
    await cloudStore.selectBusiness(CAFE.id)
    await cloudStore.selectOutlet(8)
    await cloudStore.confirmBusinessSwitch()
    expect((await adapter.loadProducts()).products.map((p) => p.id)).toEqual(['p-cafe'])
    expect((await adapter.loadSyncPushBinding()).businessId).toBe(CAFE.id)
    expect(await adapter.loadSyncServerVersions()).toEqual({ 'products:p-cafe': 3 })
    expect(businessStore.name).toBe('Kopi Nusantara')

    // The original offline Laundry workspace is still preserved separately.
    const localSnapshot = await adapter.loadWorkspaceSnapshot(LOCAL_ID)
    expect(localSnapshot.business.name).toBe('Temuan')
    expect(localSnapshot.products.map((p) => p.id)).toEqual(['p-local'])
  })
})

// A sanity guard for the empty snapshot helper used by fresh Cloud workspaces.
describe('empty workspace snapshot is self-consistent', () => {
  it('round-trips through the checksum', async () => {
    const empty = buildEmptyWorkspaceSnapshot()
    expect(computeWorkspaceChecksum(empty)).toBe(computeWorkspaceChecksum(buildEmptyWorkspaceSnapshot()))
  })
})
