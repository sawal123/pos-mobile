/**
 * PR #57 durability revision — SQLite-backed crash recovery.
 *
 * The memory adapter cannot prove crash safety, so this suite runs the real
 * `createSQLiteAdapter` against an in-memory fake of
 * `@capacitor-community/sqlite`. The fake database state survives across adapter
 * instances, so closing and re-creating the adapter is a faithful simulation of
 * a forced app stop followed by a restart (data persisted, connections gone).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

import { createSQLiteAdapter } from '@/services/database/sqliteAdapter'
import { DB_VERSION } from '@/services/database/schema'
import {
  WORKSPACE_SWITCH_PHASE,
  WORKSPACE_RECOVERY_RESULT,
  captureActiveWorkspaceSnapshot,
  cloudWorkspaceId,
  computeWorkspaceChecksum,
  recoverPendingWorkspaceSwitch,
  switchOperationalWorkspace,
} from '@/services/cloud/businessWorkspaceService'

const { fakeDb, nativeState } = vi.hoisted(() => {
  const state = {
    version: 0,
    business: null,
    categories: [],
    products: [],
    customers: [],
    expenses: [],
    transactions: [],
    syncQueue: [],
    meta: new Map(),
    appState: new Map(),
    reset() {
      this.version = 0
      this.business = null
      this.categories = []
      this.products = []
      this.customers = []
      this.expenses = []
      this.transactions = []
      this.syncQueue = []
      this.meta.clear()
      this.appState.clear()
    },
  }

  const keyFromValues = (normalized, values) => {
    if (Array.isArray(values) && values.length > 0) return values[0]
    const match = /key = '([^']+)'/.exec(normalized)
    return match ? match[1] : null
  }

  const fakeDb = {
    beginTransaction: vi.fn(async () => {}),
    commitTransaction: vi.fn(async () => {}),
    rollbackTransaction: vi.fn(async () => {}),
    run: vi.fn(async (sql, values = []) => {
      const normalized = sql.replace(/\s+/g, ' ').trim()

      if (normalized.startsWith('DELETE FROM business')) state.business = null
      else if (normalized.startsWith('DELETE FROM categories')) state.categories = []
      else if (normalized.startsWith('DELETE FROM products')) state.products = []
      else if (normalized.startsWith('DELETE FROM customers')) state.customers = []
      else if (normalized.startsWith('DELETE FROM expenses')) state.expenses = []
      else if (normalized.startsWith('DELETE FROM transactions')) state.transactions = []
      else if (normalized.startsWith('DELETE FROM sync_queue')) state.syncQueue = []
      else if (normalized.startsWith('INSERT INTO business')) {
        state.business = {
          name: values[1], type: values[2], owner: values[3], phone: values[4],
          outlet: values[5], mode: values[6],
        }
      } else if (normalized.startsWith('INSERT INTO categories')) {
        state.categories.push({ name: values[0] })
      } else if (normalized.startsWith('INSERT INTO products')) {
        state.products.push({ id: values[0], name: values[1], category: values[2], is_active: values[14] })
      } else if (normalized.startsWith('INSERT INTO sync_queue')) {
        state.syncQueue.push({
          id: values[0], entity_type: values[1], entity_id: values[2], operation: values[3],
          payload: values[4], created_at: values[5], updated_at: values[6],
          attempt_count: values[7], last_error: values[8],
        })
      } else if (normalized.startsWith('INSERT OR REPLACE INTO app_meta')) {
        state.meta.set(values[0], values[1])
      } else if (normalized.startsWith('INSERT OR REPLACE INTO app_state')) {
        state.appState.set(values[0], values[1])
      } else if (normalized.startsWith('DELETE FROM app_meta')) {
        const key = keyFromValues(normalized, values)
        if (key !== null) state.meta.delete(key)
      }

      return { changes: { changes: 1 } }
    }),
    query: vi.fn(async (sql, values = []) => {
      const normalized = sql.replace(/\s+/g, ' ').trim()

      if (normalized.includes('PRAGMA user_version')) return { values: [{ user_version: state.version }] }
      if (normalized.includes('COUNT(*) AS total FROM sync_queue')) {
        return { values: [{ total: state.syncQueue.length }] }
      }
      if (normalized.includes('FROM app_meta')) {
        return { values: state.meta.has(values[0]) ? [{ value: state.meta.get(values[0]) }] : [] }
      }
      if (normalized.includes('FROM app_state')) {
        return { values: state.appState.has(values[0]) ? [{ value: state.appState.get(values[0]) }] : [] }
      }
      if (normalized.includes('FROM business')) return { values: state.business ? [state.business] : [] }
      if (normalized.includes('FROM categories')) return { values: [...state.categories] }
      if (normalized.includes('FROM products')) return { values: [...state.products] }
      if (normalized.includes('FROM customers')) return { values: [...state.customers] }
      if (normalized.includes('FROM expenses')) return { values: [...state.expenses] }
      if (normalized.includes('FROM transactions')) return { values: [...state.transactions] }
      if (normalized.includes('FROM sync_queue')) return { values: [...state.syncQueue] }
      return { values: [] }
    }),
    execute: vi.fn(async (sql) => {
      const match = /PRAGMA user_version\s*=\s*(\d+)/.exec(sql)
      if (match) state.version = Number(match[1])
    }),
    isDBOpen: async () => ({ result: true }),
    open: async () => {},
    close: async () => {},
  }

  return { fakeDb, nativeState: state }
})

vi.mock('@capacitor-community/sqlite', () => {
  class SQLiteConnection {
    async addUpgradeStatement() {}
    async checkConnectionsConsistency() {
      return { result: true }
    }
    async isConnection() {
      return { result: false }
    }
    async createConnection() {
      return fakeDb
    }
    async retrieveConnection() {
      return fakeDb
    }
    async closeConnection() {}
  }
  return { CapacitorSQLite: {}, SQLiteConnection }
})

const LOCAL_ID = 'local:default'
const cafeTarget = cloudWorkspaceId(72, 8)

function stubScheduler() {
  return { flush: async () => {}, rehydrate: async () => {}, runSerialized: (task) => task() }
}

async function openAdapter() {
  const adapter = createSQLiteAdapter()
  await adapter.initialize()
  return adapter
}

async function forceStopAndRestart(adapter) {
  await adapter.close()
  return openAdapter()
}

beforeEach(() => {
  nativeState.reset()
  fakeDb.run.mockClear()
  fakeDb.query.mockClear()
  setActivePinia(createPinia())
})

describe('SQLite-backed workspace switching', () => {
  it('persists a completed switch and its registry across a restart', async () => {
    let adapter = await openAdapter()
    await adapter.saveBusiness({
      name: 'Temuan', type: 'Laundry', owner: '', phone: '', outlet: 'Outlet Utama', mode: 'free',
    })

    const result = await switchOperationalWorkspace({
      adapter,
      scheduler: stubScheduler(),
      targetWorkspaceId: cafeTarget,
      targetMeta: { name: 'Kopi Nusantara', type: 'Cafe / UMKM', businessId: 72, outletId: 8 },
    })
    expect(result.ok).toBe(true)
    expect(result.code).toBe('WORKSPACE_SWITCHED')

    // Force stop + restart: everything must be durable.
    adapter = await forceStopAndRestart(adapter)
    expect(await adapter.loadWorkspaceSwitchJournal()).toBeNull()
    expect((await adapter.loadWorkspaceRegistry()).activeWorkspaceId).toBe(cafeTarget)
    // Source snapshot survives for a later switch back.
    const source = await adapter.loadWorkspaceSnapshot(LOCAL_ID)
    expect(source.business.name).toBe('Temuan')
  })

  it('recovers a switch interrupted by a forced stop during materialisation', async () => {
    let adapter = await openAdapter()
    await adapter.saveBusiness({
      name: 'Temuan', type: 'Laundry', owner: '', phone: '', outlet: 'Outlet Utama', mode: 'free',
    })
    await adapter.saveProducts(
      [{ id: 'p-local', name: 'Cuci Kiloan', category: 'Kiloan', price: 7000, stock: 2, isActive: true }],
      ['Kiloan'],
    )

    // Durable source snapshot + pre-switch registry, exactly as `begin` writes.
    const sourceSnapshot = await captureActiveWorkspaceSnapshot(adapter)
    await adapter.saveWorkspaceSnapshot(LOCAL_ID, sourceSnapshot)
    const registryBefore = { version: 1, activeWorkspaceId: LOCAL_ID, workspaces: {} }
    await adapter.saveWorkspaceRegistry(registryBefore)

    // The target was partially materialised, then the app was force-stopped
    // before the registry commit: business + products already point at Café.
    await adapter.saveBusiness({
      name: 'Kopi Nusantara', type: 'Cafe / UMKM', owner: '', phone: '', outlet: 'Outlet Pusat', mode: 'free',
    })
    await adapter.saveProducts(
      [{ id: 'p-cafe', name: 'Es Kopi', category: 'Minuman', price: 22000, stock: 5, isActive: true }],
      ['Minuman'],
    )
    await adapter.saveWorkspaceSwitchJournal({
      version: 1,
      operationId: 'op-interrupted',
      phase: WORKSPACE_SWITCH_PHASE.APPLYING,
      phaseHistory: [WORKSPACE_SWITCH_PHASE.PREPARED, WORKSPACE_SWITCH_PHASE.APPLYING],
      sourceWorkspaceId: LOCAL_ID,
      targetWorkspaceId: cafeTarget,
      sourceChecksum: computeWorkspaceChecksum(sourceSnapshot),
      registryBefore,
      targetMeta: { name: 'Kopi Nusantara', type: 'Cafe / UMKM', businessId: 72, outletId: 8 },
    })

    // Force stop + restart, then run the startup recovery pass.
    adapter = await forceStopAndRestart(adapter)
    const recovery = await recoverPendingWorkspaceSwitch({ adapter, scheduler: stubScheduler() })

    expect(recovery.ok).toBe(true)
    expect(recovery.code).toBe(WORKSPACE_RECOVERY_RESULT.ROLLED_BACK)
    // Workspace and registry are consistent again: back to the source.
    expect((await adapter.loadBusiness()).name).toBe('Temuan')
    expect((await adapter.loadProducts()).products.map((p) => p.id)).toEqual(['p-local'])
    expect((await adapter.loadWorkspaceRegistry()).activeWorkspaceId).toBe(LOCAL_ID)
    expect(await adapter.loadWorkspaceSwitchJournal()).toBeNull()
  })

  it('finalises a switch whose registry commit already landed', async () => {
    let adapter = await openAdapter()
    await adapter.saveBusiness({
      name: 'Temuan', type: 'Laundry', owner: '', phone: '', outlet: 'Outlet Utama', mode: 'free',
    })
    const sourceSnapshot = await captureActiveWorkspaceSnapshot(adapter)
    await adapter.saveWorkspaceSnapshot(LOCAL_ID, sourceSnapshot)

    // Committed state: registry already points at Café, tables hold Café.
    await adapter.saveBusiness({
      name: 'Kopi Nusantara', type: 'Cafe / UMKM', owner: '', phone: '', outlet: 'Outlet Pusat', mode: 'free',
    })
    await adapter.saveWorkspaceRegistry({
      version: 1,
      activeWorkspaceId: cafeTarget,
      workspaces: { [cafeTarget]: { id: cafeTarget, kind: 'cloud', name: 'Kopi Nusantara' } },
    })
    // Journal left behind by a crash between commit and clear.
    await adapter.saveWorkspaceSwitchJournal({
      version: 1,
      operationId: 'op-applied',
      phase: WORKSPACE_SWITCH_PHASE.APPLIED,
      phaseHistory: [],
      sourceWorkspaceId: LOCAL_ID,
      targetWorkspaceId: cafeTarget,
      sourceChecksum: computeWorkspaceChecksum(sourceSnapshot),
      registryBefore: { version: 1, activeWorkspaceId: LOCAL_ID, workspaces: {} },
    })

    adapter = await forceStopAndRestart(adapter)
    const recovery = await recoverPendingWorkspaceSwitch({ adapter, scheduler: stubScheduler() })

    expect(recovery.code).toBe(WORKSPACE_RECOVERY_RESULT.FINALIZED_COMMITTED)
    // The committed target is kept, not rolled back.
    expect((await adapter.loadBusiness()).name).toBe('Kopi Nusantara')
    expect((await adapter.loadWorkspaceRegistry()).activeWorkspaceId).toBe(cafeTarget)
    expect(await adapter.loadWorkspaceSwitchJournal()).toBeNull()
  })

  it('fails closed when the source snapshot cannot be verified at recovery', async () => {
    let adapter = await openAdapter()
    await adapter.saveBusiness({
      name: 'Temuan', type: 'Laundry', owner: '', phone: '', outlet: 'Outlet Utama', mode: 'free',
    })
    const sourceSnapshot = await captureActiveWorkspaceSnapshot(adapter)
    await adapter.saveWorkspaceSnapshot(LOCAL_ID, sourceSnapshot)
    await adapter.saveWorkspaceSwitchJournal({
      version: 1,
      operationId: 'op-bad-checksum',
      phase: WORKSPACE_SWITCH_PHASE.APPLYING,
      phaseHistory: [],
      sourceWorkspaceId: LOCAL_ID,
      targetWorkspaceId: cafeTarget,
      sourceChecksum: 'ws-00000000',
      registryBefore: { version: 1, activeWorkspaceId: LOCAL_ID, workspaces: {} },
    })

    adapter = await forceStopAndRestart(adapter)
    const recovery = await recoverPendingWorkspaceSwitch({ adapter, scheduler: stubScheduler() })

    expect(recovery.ok).toBe(false)
    expect(recovery.code).toBe(WORKSPACE_RECOVERY_RESULT.RECOVERY_REQUIRED)
    expect((await adapter.loadWorkspaceSwitchJournal()).phase).toBe(
      WORKSPACE_SWITCH_PHASE.RECOVERY_REQUIRED,
    )
  })

  it('keeps the DB schema version stable after a switch', async () => {
    let adapter = await openAdapter()
    expect(await adapter.getSchemaVersion()).toBe(DB_VERSION)
    await switchOperationalWorkspace({
      adapter,
      scheduler: stubScheduler(),
      targetWorkspaceId: cafeTarget,
    })
    adapter = await forceStopAndRestart(adapter)
    expect(await adapter.getSchemaVersion()).toBe(DB_VERSION)
  })

  it('durably persists, recovers across restarts, and clears the cloud initialization journal in SQLite', async () => {
    let adapter = await openAdapter()
    expect(await adapter.loadCloudInitializationJournal()).toBeNull()

    const journal = {
      version: 1,
      phase: 'initializing',
      businessId: 10,
      outletId: 101,
      deviceIdentifier: 'dev-sqlite-crash-1',
      registeredDeviceId: 55,
      startedAt: '2026-10-18T00:00:00.000Z',
      completedAt: null,
      updatedAt: '2026-10-18T00:00:00.000Z',
    }
    await adapter.saveCloudInitializationJournal(journal)
    expect(await adapter.loadCloudInitializationJournal()).toEqual(journal)

    // Simulate crash and restart
    adapter = await forceStopAndRestart(adapter)
    expect(await adapter.loadCloudInitializationJournal()).toEqual(journal)

    // Clear journal on completion
    await adapter.clearCloudInitializationJournal()
    expect(await adapter.loadCloudInitializationJournal()).toBeNull()

    adapter = await forceStopAndRestart(adapter)
    expect(await adapter.loadCloudInitializationJournal()).toBeNull()
  })
})
