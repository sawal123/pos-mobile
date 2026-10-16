/**
 * Business workspace isolation service.
 *
 * The local persistence layer is a *singleton* database (one active business at
 * a time). To let a device hold several isolated workspaces — the legacy offline
 * workspace plus one workspace per Cloud business/outlet — the active workspace
 * is materialised in the singleton tables while every inactive workspace is kept
 * as a durable, self-contained snapshot.
 *
 * Guarantees:
 *  - The previous workspace is always persisted and verified *before* the target
 *    is applied, so a failed switch can never lose the old data.
 *  - A switch is refused while a sync push is in flight.
 *  - A failed apply rolls the singleton tables back to the previous snapshot.
 *  - Nothing is deleted: switching only swaps which workspace is materialised.
 *
 * This is a service-layer namespacing solution built on the generic key/value
 * storage already present in both adapters. It does not alter the SQLite schema,
 * so existing databases keep working without a migration.
 */

const LOCAL_WORKSPACE_ID = 'local:default'
const REGISTRY_VERSION = 1

export const WORKSPACE_SWITCH_RESULT = Object.freeze({
  OK: 'WORKSPACE_SWITCHED',
  ALREADY_ACTIVE: 'WORKSPACE_ALREADY_ACTIVE',
  STORAGE_UNAVAILABLE: 'WORKSPACE_STORAGE_UNAVAILABLE',
  SYNC_IN_FLIGHT: 'WORKSPACE_SWITCH_SYNC_IN_FLIGHT',
  CAPTURE_FAILED: 'WORKSPACE_CAPTURE_FAILED',
  SNAPSHOT_WRITE_FAILED: 'WORKSPACE_SNAPSHOT_WRITE_FAILED',
  SNAPSHOT_VERIFY_FAILED: 'WORKSPACE_SNAPSHOT_VERIFY_FAILED',
  APPLY_FAILED: 'WORKSPACE_SWITCH_APPLY_FAILED',
  REGISTRY_WRITE_FAILED: 'WORKSPACE_REGISTRY_WRITE_FAILED',
})

export { LOCAL_WORKSPACE_ID }

export function cloudWorkspaceId(businessId, outletId) {
  return `cloud:${businessId}:${outletId}`
}

export function emptyWorkspaceRegistry() {
  return {
    version: REGISTRY_VERSION,
    activeWorkspaceId: LOCAL_WORKSPACE_ID,
    workspaces: {},
  }
}

function cloneValue(value) {
  if (value === undefined) return undefined
  if (typeof globalThis.structuredClone === 'function') {
    try {
      return globalThis.structuredClone(value)
    } catch {
      // fall through
    }
  }
  return JSON.parse(JSON.stringify(value))
}

function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`
  }
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

export function computeWorkspaceChecksum(value) {
  const text = stableStringify(value)
  let hash = 5381
  for (let index = 0; index < text.length; index += 1) {
    hash = (hash * 33) ^ text.charCodeAt(index)
  }
  return `ws-${(hash >>> 0).toString(16).padStart(8, '0')}`
}

export async function loadWorkspaceRegistry(adapter) {
  if (!adapter || typeof adapter.loadWorkspaceRegistry !== 'function') {
    return emptyWorkspaceRegistry()
  }
  try {
    const registry = await adapter.loadWorkspaceRegistry()
    if (registry && registry.version === REGISTRY_VERSION && typeof registry.workspaces === 'object') {
      return registry
    }
  } catch {
    // fall through to the empty registry
  }
  return emptyWorkspaceRegistry()
}

export async function resolveActiveWorkspaceId(adapter) {
  const registry = await loadWorkspaceRegistry(adapter)
  return registry.activeWorkspaceId ?? LOCAL_WORKSPACE_ID
}

/**
 * A fresh, empty local workspace: a blank business identity and no operational
 * or sync data. Used when a Cloud workspace is opened for the first time.
 */
export function buildEmptyWorkspaceSnapshot() {
  return {
    version: 1,
    business: {
      name: '',
      type: '',
      owner: '',
      phone: '',
      outlet: 'Outlet Utama',
      mode: 'free',
    },
    tax: null,
    products: [],
    categories: [],
    stockMovements: [],
    customers: [],
    expenses: [],
    transactions: [],
    cashier: null,
    cash: null,
    shift: null,
    syncQueue: [],
    sync: {
      identityMap: null,
      pushBinding: null,
      pushInflight: null,
      pullBinding: null,
      pullState: null,
      serverVersions: null,
      bootstrap: null,
      conflicts: null,
      autoSettings: null,
    },
  }
}

/**
 * Read the full contents of the currently materialised workspace from the
 * singleton adapter, including every sync metadata family.
 */
export async function captureActiveWorkspaceSnapshot(adapter) {
  const [business, tax, productsBundle, customers, expenses, transactions, cashier, cash, shift, syncQueue] =
    await Promise.all([
      adapter.loadBusiness(),
      adapter.loadTaxState(),
      adapter.loadProducts(),
      adapter.loadCustomers(),
      adapter.loadExpenses(),
      adapter.loadTransactions(),
      adapter.loadCashierState(),
      adapter.loadCashState(),
      adapter.loadShiftState(),
      adapter.listSyncQueueItems({ limit: 1000000 }),
    ])

  const [identityMap, pushBinding, pushInflight, pullBinding, pullState, serverVersions, bootstrap, conflicts, autoSettings] =
    await Promise.all([
      adapter.loadSyncIdentityMap?.() ?? null,
      adapter.loadSyncPushBinding?.() ?? null,
      adapter.loadSyncPushInflight?.() ?? null,
      adapter.loadSyncPullBinding?.() ?? null,
      adapter.loadSyncPullState?.() ?? null,
      adapter.loadSyncServerVersions?.() ?? null,
      adapter.loadSyncBootstrapState?.() ?? null,
      adapter.loadSyncConflicts?.() ?? null,
      adapter.loadSyncAutoSettings?.() ?? null,
    ])

  return {
    version: 1,
    business: business ?? { name: '', type: '', owner: '', phone: '', outlet: 'Outlet Utama', mode: 'free' },
    tax: tax ?? null,
    products: productsBundle?.products ?? [],
    categories: productsBundle?.categories ?? [],
    stockMovements: productsBundle?.stockMovements ?? [],
    customers: customers ?? [],
    expenses: expenses ?? [],
    transactions: transactions ?? [],
    cashier: cashier ?? null,
    cash: cash ?? null,
    shift: shift ?? null,
    syncQueue: syncQueue ?? [],
    sync: {
      identityMap: identityMap ?? null,
      pushBinding: pushBinding ?? null,
      pushInflight: pushInflight ?? null,
      pullBinding: pullBinding ?? null,
      pullState: pullState ?? null,
      serverVersions: serverVersions ?? null,
      bootstrap: bootstrap ?? null,
      conflicts: conflicts ?? null,
      autoSettings: autoSettings ?? null,
    },
  }
}

/**
 * Materialise a workspace snapshot into the singleton local database.
 * Every call is optional-guarded so a partial adapter implementation fails
 * loudly (throwing) rather than silently leaving mixed data.
 */
export async function applyWorkspaceSnapshot(adapter, snapshot) {
  const data = snapshot ?? buildEmptyWorkspaceSnapshot()

  await adapter.saveBusiness(cloneValue(data.business))
  await adapter.saveTaxState(cloneValue(data.tax))
  await adapter.saveProducts(
    cloneValue(data.products ?? []),
    cloneValue(data.categories ?? []),
    cloneValue(data.stockMovements ?? []),
  )
  await adapter.saveCustomers(cloneValue(data.customers ?? []))
  await adapter.saveExpenses(cloneValue(data.expenses ?? []))
  await adapter.saveTransactions(cloneValue(data.transactions ?? []))
  await adapter.saveCashierState(cloneValue(data.cashier))
  await adapter.saveCashState(cloneValue(data.cash))
  await adapter.saveShiftState(cloneValue(data.shift))

  if (typeof adapter.replaceSyncQueueItems === 'function') {
    await adapter.replaceSyncQueueItems(cloneValue(data.syncQueue ?? []))
  }

  const sync = data.sync ?? {}

  if (typeof adapter.saveSyncIdentityMap === 'function') await adapter.saveSyncIdentityMap(cloneValue(sync.identityMap))
  if (typeof adapter.saveSyncPushBinding === 'function') await adapter.saveSyncPushBinding(cloneValue(sync.pushBinding))
  if (typeof adapter.saveSyncPullBinding === 'function') await adapter.saveSyncPullBinding(cloneValue(sync.pullBinding))
  if (typeof adapter.clearSyncPushInflight === 'function') await adapter.clearSyncPushInflight()
  if (sync.pushInflight && typeof adapter.saveSyncPushInflight === 'function') {
    await adapter.saveSyncPushInflight(cloneValue(sync.pushInflight))
  }
  if (typeof adapter.saveSyncPullState === 'function') await adapter.saveSyncPullState(cloneValue(sync.pullState))
  if (typeof adapter.saveSyncServerVersions === 'function') await adapter.saveSyncServerVersions(cloneValue(sync.serverVersions))
  if (typeof adapter.saveSyncBootstrapState === 'function') await adapter.saveSyncBootstrapState(cloneValue(sync.bootstrap))
  if (typeof adapter.saveSyncConflicts === 'function') await adapter.saveSyncConflicts(cloneValue(sync.conflicts))
  if (typeof adapter.saveSyncAutoSettings === 'function') await adapter.saveSyncAutoSettings(cloneValue(sync.autoSettings))

  return { ok: true }
}

function buildWorkspaceEntry(workspaceId, snapshot, meta = null) {
  const business = snapshot?.business ?? {}
  return {
    id: workspaceId,
    kind: workspaceId.startsWith('cloud:') ? 'cloud' : 'local',
    name: meta?.name ?? business.name ?? '',
    type: meta?.type ?? business.type ?? '',
    businessId: meta?.businessId ?? null,
    outletId: meta?.outletId ?? null,
    updatedAt: new Date().toISOString(),
  }
}

function supportsWorkspaceStorage(adapter) {
  return Boolean(
    adapter &&
      typeof adapter.saveWorkspaceSnapshot === 'function' &&
      typeof adapter.loadWorkspaceSnapshot === 'function' &&
      typeof adapter.saveWorkspaceRegistry === 'function',
  )
}

/**
 * Safely switch the active operational workspace.
 *
 * @param {object} options
 * @param {object} options.adapter Persistence adapter.
 * @param {object|null} [options.scheduler] Persistence service (flush/rehydrate).
 * @param {string} options.targetWorkspaceId Destination workspace id.
 * @param {object|null} [options.targetMeta] Registry metadata for the target.
 * @returns {Promise<object>}
 */
export async function switchOperationalWorkspace({
  adapter,
  scheduler = null,
  targetWorkspaceId,
  targetMeta = null,
} = {}) {
  if (!supportsWorkspaceStorage(adapter) || !targetWorkspaceId) {
    return {
      ok: false,
      code: WORKSPACE_SWITCH_RESULT.STORAGE_UNAVAILABLE,
      message: 'Penyimpanan ruang kerja terpisah tidak tersedia.',
    }
  }

  const inflight =
    typeof adapter.loadSyncPushInflight === 'function' ? await adapter.loadSyncPushInflight() : null
  if (inflight) {
    return {
      ok: false,
      code: WORKSPACE_SWITCH_RESULT.SYNC_IN_FLIGHT,
      message:
        'Sinkronisasi sedang berjalan. Tunggu hingga selesai sebelum beralih bisnis agar data tidak tercampur.',
    }
  }

  if (typeof scheduler?.flush === 'function') {
    try {
      await scheduler.flush()
    } catch {
      // A failed flush does not force a switch failure; the snapshot captured
      // below still reflects the durable state.
    }
  }

  const registry = await loadWorkspaceRegistry(adapter)
  const previousWorkspaceId = registry.activeWorkspaceId ?? LOCAL_WORKSPACE_ID

  if (previousWorkspaceId === targetWorkspaceId) {
    return {
      ok: true,
      code: WORKSPACE_SWITCH_RESULT.ALREADY_ACTIVE,
      activeWorkspaceId: targetWorkspaceId,
      previousWorkspaceId,
    }
  }

  let currentSnapshot
  try {
    currentSnapshot = await captureActiveWorkspaceSnapshot(adapter)
  } catch {
    return {
      ok: false,
      code: WORKSPACE_SWITCH_RESULT.CAPTURE_FAILED,
      message: 'Gagal membaca ruang kerja saat ini. Perpindahan dibatalkan.',
    }
  }

  // Persist the outgoing workspace durably BEFORE touching the singleton tables.
  try {
    await adapter.saveWorkspaceSnapshot(previousWorkspaceId, currentSnapshot)
  } catch {
    return {
      ok: false,
      code: WORKSPACE_SWITCH_RESULT.SNAPSHOT_WRITE_FAILED,
      message:
        'Gagal menyimpan data ruang kerja lama secara aman. Perpindahan dibatalkan dan data lama tidak diubah.',
    }
  }

  // Verify durability so a failed write can never masquerade as a safe switch.
  const readBack = await adapter.loadWorkspaceSnapshot(previousWorkspaceId)
  if (!readBack || computeWorkspaceChecksum(readBack) !== computeWorkspaceChecksum(currentSnapshot)) {
    return {
      ok: false,
      code: WORKSPACE_SWITCH_RESULT.SNAPSHOT_VERIFY_FAILED,
      message:
        'Verifikasi penyimpanan data ruang kerja lama gagal. Perpindahan dibatalkan dan data lama tidak diubah.',
    }
  }

  const targetSnapshot =
    (await adapter.loadWorkspaceSnapshot(targetWorkspaceId)) ?? buildEmptyWorkspaceSnapshot()

  try {
    await applyWorkspaceSnapshot(adapter, targetSnapshot)
    if (typeof scheduler?.rehydrate === 'function') {
      await scheduler.rehydrate()
    }
  } catch {
    try {
      await applyWorkspaceSnapshot(adapter, currentSnapshot)
      if (typeof scheduler?.rehydrate === 'function') {
        await scheduler.rehydrate()
      }
    } catch {
      // The snapshot of the previous workspace is durable; a later recovery can
      // re-materialise it. Never delete anything.
    }
    return {
      ok: false,
      code: WORKSPACE_SWITCH_RESULT.APPLY_FAILED,
      message: 'Perpindahan ruang kerja gagal. Ruang kerja sebelumnya dipertahankan.',
    }
  }

  const nextRegistry = {
    version: REGISTRY_VERSION,
    activeWorkspaceId: targetWorkspaceId,
    workspaces: {
      ...registry.workspaces,
      [previousWorkspaceId]: buildWorkspaceEntry(
        previousWorkspaceId,
        currentSnapshot,
        registry.workspaces?.[previousWorkspaceId] ?? null,
      ),
      [targetWorkspaceId]: buildWorkspaceEntry(targetWorkspaceId, targetSnapshot, targetMeta),
    },
  }

  try {
    await adapter.saveWorkspaceRegistry(nextRegistry)
  } catch {
    // Registry write failed after the target was materialised: roll back so the
    // device keeps a single, consistent workspace.
    try {
      await applyWorkspaceSnapshot(adapter, currentSnapshot)
      if (typeof scheduler?.rehydrate === 'function') {
        await scheduler.rehydrate()
      }
    } catch {
      // previous snapshot remains durable
    }
    return {
      ok: false,
      code: WORKSPACE_SWITCH_RESULT.REGISTRY_WRITE_FAILED,
      message: 'Gagal mencatat perpindahan ruang kerja. Ruang kerja sebelumnya dipertahankan.',
    }
  }

  return {
    ok: true,
    code: WORKSPACE_SWITCH_RESULT.OK,
    activeWorkspaceId: targetWorkspaceId,
    previousWorkspaceId,
    registry: nextRegistry,
    snapshot: targetSnapshot,
  }
}
