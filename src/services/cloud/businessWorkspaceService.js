/**
 * Business workspace isolation service.
 *
 * The local persistence layer is a *singleton* database (one active business at
 * a time). To let a device hold several isolated workspaces — the legacy offline
 * workspace plus one workspace per Cloud business/outlet — the active workspace
 * is materialised in the singleton tables while every inactive workspace is kept
 * as a durable, self-contained snapshot.
 *
 * Crash safety
 * ------------
 * A workspace switch is a distributed sequence of durable writes that a forced
 * app close can interrupt at any point. It is therefore guarded by a durable
 * *switching journal* (`workspace_switch_journal_v1`) written before the
 * singleton tables are touched and cleared only after the registry commit. On
 * the next start the journal is inspected and the switch is either finalised or
 * rolled back, so the registry and the materialised data can never disagree.
 *
 * Guarantees:
 *  - The persistence write queue is flushed first; a failed flush aborts the
 *    switch instead of snapshotting an inconsistent state.
 *  - The outgoing workspace is persisted and checksum-verified before the target
 *    is materialised, so a failed switch can never lose the old data.
 *  - A switch is refused while a sync push, a P38 local operation, a restore, or
 *    an auto-sync pass is still running.
 *  - A failed materialisation/commit rolls the singleton tables and the registry
 *    back to the source workspace. A failed rollback is reported as
 *    `WORKSPACE_RECOVERY_REQUIRED` — it is never reported as success.
 *  - Nothing is deleted: switching only swaps which workspace is materialised.
 *
 * This is a service-layer namespacing solution built on the generic key/value
 * storage already present in both adapters. It does not alter the SQLite schema,
 * so existing databases keep working without a migration.
 */

const LOCAL_WORKSPACE_ID = 'local:default'
const REGISTRY_VERSION = 1
const JOURNAL_VERSION = 1

export const WORKSPACE_SWITCH_RESULT = Object.freeze({
  OK: 'WORKSPACE_SWITCHED',
  ALREADY_ACTIVE: 'WORKSPACE_ALREADY_ACTIVE',
  STORAGE_UNAVAILABLE: 'WORKSPACE_STORAGE_UNAVAILABLE',
  SCHEDULER_UNAVAILABLE: 'WORKSPACE_SCHEDULER_UNAVAILABLE',
  REGISTRY_UNREADABLE: 'WORKSPACE_REGISTRY_UNREADABLE',
  FLUSH_FAILED: 'WORKSPACE_FLUSH_FAILED',
  BLOCKED_PENDING_OPERATION: 'WORKSPACE_SWITCH_BLOCKED_PENDING_OPERATION',
  SYNC_IN_FLIGHT: 'WORKSPACE_SWITCH_SYNC_IN_FLIGHT',
  RECOVERY_REQUIRED: 'WORKSPACE_RECOVERY_REQUIRED',
  CAPTURE_FAILED: 'WORKSPACE_CAPTURE_FAILED',
  SNAPSHOT_WRITE_FAILED: 'WORKSPACE_SNAPSHOT_WRITE_FAILED',
  SNAPSHOT_VERIFY_FAILED: 'WORKSPACE_SNAPSHOT_VERIFY_FAILED',
  SNAPSHOT_READ_FAILED: 'WORKSPACE_SNAPSHOT_READ_FAILED',
  JOURNAL_WRITE_FAILED: 'WORKSPACE_JOURNAL_WRITE_FAILED',
  APPLY_FAILED: 'WORKSPACE_SWITCH_APPLY_FAILED',
  REGISTRY_WRITE_FAILED: 'WORKSPACE_REGISTRY_WRITE_FAILED',
  ROLLED_BACK: 'WORKSPACE_ROLLED_BACK',
})

export const WORKSPACE_SWITCH_PHASE = Object.freeze({
  PREPARED: 'prepared',
  APPLYING: 'applying',
  APPLIED: 'applied',
  COMMITTED: 'committed',
  ROLLING_BACK: 'rolling_back',
  ROLLED_BACK: 'rolled_back',
  RECOVERY_REQUIRED: 'recovery_required',
})

export const WORKSPACE_RECOVERY_RESULT = Object.freeze({
  NO_RECOVERY_NEEDED: 'WORKSPACE_NO_RECOVERY_NEEDED',
  FINALIZED_COMMITTED: 'WORKSPACE_RECOVERY_FINALIZED_COMMITTED',
  ABORTED_PREPARED: 'WORKSPACE_RECOVERY_ABORTED_PREPARED',
  ROLLED_BACK: 'WORKSPACE_RECOVERY_ROLLED_BACK',
  RECOVERY_REQUIRED: 'WORKSPACE_RECOVERY_REQUIRED',
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

function makeOperationId() {
  const random =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`
  return `workspace-switch-${random}`
}

function isFinalPhase(phase) {
  return [WORKSPACE_SWITCH_PHASE.COMMITTED, WORKSPACE_SWITCH_PHASE.ROLLED_BACK].includes(phase)
}

/**
 * Lenient registry read used by the UI. Never throws: a missing or malformed
 * registry yields the empty default so display code keeps working.
 *
 * Do NOT use this to decide whether a switch is safe — use
 * {@link readWorkspaceRegistryStrict} for that, which distinguishes "no registry
 * yet" from "registry unreadable".
 */
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

/**
 * Strict registry read. A read failure or a malformed registry is reported as
 * `REGISTRY_UNREADABLE` (fail closed) so an interrupted or corrupted registry is
 * never mistaken for "the device is empty" — which would make a switch overwrite
 * a healthy workspace snapshot.
 *
 * @returns {Promise<{ok: boolean, code?: string, registry?: object, empty?: boolean}>}
 */
export async function readWorkspaceRegistryStrict(adapter) {
  if (!adapter || typeof adapter.loadWorkspaceRegistry !== 'function') {
    return { ok: false, code: WORKSPACE_SWITCH_RESULT.STORAGE_UNAVAILABLE }
  }

  let raw
  try {
    raw = await adapter.loadWorkspaceRegistry()
  } catch {
    return { ok: false, code: WORKSPACE_SWITCH_RESULT.REGISTRY_UNREADABLE }
  }

  if (raw === null || raw === undefined) {
    return { ok: true, registry: emptyWorkspaceRegistry(), empty: true }
  }

  if (
    typeof raw !== 'object' ||
    raw.version !== REGISTRY_VERSION ||
    typeof raw.workspaces !== 'object' ||
    raw.workspaces === null
  ) {
    return { ok: false, code: WORKSPACE_SWITCH_RESULT.REGISTRY_UNREADABLE }
  }

  return { ok: true, registry: raw, empty: false }
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
      typeof adapter.saveWorkspaceRegistry === 'function' &&
      typeof adapter.loadWorkspaceRegistry === 'function' &&
      typeof adapter.saveWorkspaceSwitchJournal === 'function' &&
      typeof adapter.loadWorkspaceSwitchJournal === 'function' &&
      typeof adapter.clearWorkspaceSwitchJournal === 'function',
  )
}

function supportsScheduler(scheduler) {
  return Boolean(scheduler && typeof scheduler.flush === 'function' && typeof scheduler.rehydrate === 'function')
}

async function writeJournal(adapter, journal, phase, patch = {}) {
  const next = {
    ...journal,
    ...patch,
    phase,
    updatedAt: new Date().toISOString(),
    phaseHistory: [...(journal.phaseHistory ?? []), phase],
  }
  await adapter.saveWorkspaceSwitchJournal(next)
  return next
}

function hasPendingLocalJournal(journal) {
  return Array.isArray(journal?.entries) && journal.entries.some((entry) => entry?.status === 'pending')
}

/**
 * Durable operations that must not be in progress while the singleton workspace
 * is swapped. A pending operation from workspace A could otherwise be recovered
 * later against workspace B's context.
 *
 * @returns {Promise<string[]>} blocking reason codes (empty when clear).
 */
export async function evaluateWorkspaceSwitchBlockers({ adapter, autoSyncRunning = false } = {}) {
  const blockers = []

  if (adapter && typeof adapter.loadSyncPushInflight === 'function') {
    try {
      if (await adapter.loadSyncPushInflight()) blockers.push('sync_inflight')
    } catch {
      blockers.push('sync_inflight_unknown')
    }
  }

  if (adapter && typeof adapter.loadRestoreJournal === 'function') {
    try {
      const journal = await adapter.loadRestoreJournal()
      if (journal && !isFinalPhase(journal.phase)) blockers.push('restore_journal_pending')
    } catch {
      blockers.push('restore_journal_unknown')
    }
  }

  if (adapter && typeof adapter.loadLocalOperationJournal === 'function') {
    try {
      if (hasPendingLocalJournal(await adapter.loadLocalOperationJournal())) {
        blockers.push('local_operation_pending')
      }
    } catch {
      blockers.push('local_operation_unknown')
    }
  }

  if (autoSyncRunning) blockers.push('auto_sync_running')

  return blockers
}

/**
 * Restore the singleton tables and the registry to the source workspace.
 *
 * Returns `ok: false` with `RECOVERY_REQUIRED` whenever any step of the undo
 * fails — a failed recovery is never reported as a successful rollback.
 */
async function performRollback({ adapter, scheduler, journal, hooks }) {
  let current = journal
  try {
    current = await writeJournal(adapter, journal, WORKSPACE_SWITCH_PHASE.ROLLING_BACK)

    const sourceSnapshot = await adapter.loadWorkspaceSnapshot(journal.sourceWorkspaceId)
    if (!sourceSnapshot || computeWorkspaceChecksum(sourceSnapshot) !== journal.sourceChecksum) {
      throw new Error('Source workspace snapshot is missing or does not match its checksum.')
    }

    await applyWorkspaceSnapshot(adapter, sourceSnapshot)
    if (typeof hooks?.restoreContext === 'function') {
      await hooks.restoreContext()
    }
    await scheduler.rehydrate()
    await adapter.saveWorkspaceRegistry(journal.registryBefore)
    await adapter.clearWorkspaceSwitchJournal()

    return { ok: true, code: WORKSPACE_SWITCH_RESULT.ROLLED_BACK }
  } catch {
    try {
      await writeJournal(adapter, current, WORKSPACE_SWITCH_PHASE.RECOVERY_REQUIRED)
    } catch {
      // The journal may already be unreadable; nothing further can be persisted.
    }
    return { ok: false, code: WORKSPACE_SWITCH_RESULT.RECOVERY_REQUIRED }
  }
}

/**
 * Safely switch the active operational workspace.
 *
 * @param {object} options
 * @param {object} options.adapter Persistence adapter.
 * @param {object} options.scheduler Persistence service (flush/rehydrate). Required.
 * @param {string} options.targetWorkspaceId Destination workspace id.
 * @param {object|null} [options.targetMeta] Registry metadata for the target.
 * @param {boolean} [options.autoSyncRunning] Whether a foreground auto-sync pass is running.
 * @param {object|null} [options.hooks] Store-side steps (identity + Cloud context).
 * @returns {Promise<object>}
 */
export async function switchOperationalWorkspace({
  adapter,
  scheduler = null,
  targetWorkspaceId,
  targetMeta = null,
  autoSyncRunning = false,
  hooks = null,
} = {}) {
  if (!supportsWorkspaceStorage(adapter) || !targetWorkspaceId) {
    return {
      ok: false,
      code: WORKSPACE_SWITCH_RESULT.STORAGE_UNAVAILABLE,
      message: 'Penyimpanan ruang kerja terpisah tidak tersedia.',
    }
  }

  // Task 1: the write queue must be flushable, otherwise state consistency
  // cannot be guaranteed — fail closed instead of snapshotting a moving target.
  if (!supportsScheduler(scheduler)) {
    return {
      ok: false,
      code: WORKSPACE_SWITCH_RESULT.SCHEDULER_UNAVAILABLE,
      message:
        'Penyimpanan lokal belum siap menjamin konsistensi data. Perpindahan bisnis dibatalkan.',
    }
  }

  let pendingJournal
  try {
    pendingJournal = await adapter.loadWorkspaceSwitchJournal()
  } catch {
    pendingJournal = null
  }
  if (pendingJournal && !isFinalPhase(pendingJournal.phase)) {
    return {
      ok: false,
      code: WORKSPACE_SWITCH_RESULT.RECOVERY_REQUIRED,
      message: 'Perpindahan bisnis sebelumnya belum selesai dipulihkan. Jalankan pemulihan terlebih dahulu.',
    }
  }

  const registryRead = await readWorkspaceRegistryStrict(adapter)
  if (!registryRead.ok) {
    return {
      ok: false,
      code: registryRead.code,
      message: 'Status ruang kerja lokal tidak dapat dipastikan. Perpindahan dibatalkan demi keamanan data.',
    }
  }

  const registry = registryRead.registry
  const previousWorkspaceId = registry.activeWorkspaceId ?? LOCAL_WORKSPACE_ID

  if (previousWorkspaceId === targetWorkspaceId) {
    return {
      ok: true,
      code: WORKSPACE_SWITCH_RESULT.ALREADY_ACTIVE,
      activeWorkspaceId: targetWorkspaceId,
      previousWorkspaceId,
      registry,
    }
  }

  // Task 4: never swap the workspace under a running durable operation.
  const blockers = await evaluateWorkspaceSwitchBlockers({ adapter, autoSyncRunning })
  if (blockers.length > 0) {
    const syncBlocked = blockers.some((code) => code === 'sync_inflight' || code === 'sync_inflight_unknown')
    return {
      ok: false,
      code: syncBlocked
        ? WORKSPACE_SWITCH_RESULT.SYNC_IN_FLIGHT
        : WORKSPACE_SWITCH_RESULT.BLOCKED_PENDING_OPERATION,
      blockers,
      message:
        'Ada operasi yang belum selesai. Tunggu hingga seluruh perubahan tersimpan sebelum beralih bisnis.',
    }
  }

  // Task 1: a failed flush aborts the switch (nothing has been touched yet).
  try {
    await scheduler.flush()
  } catch {
    return {
      ok: false,
      code: WORKSPACE_SWITCH_RESULT.FLUSH_FAILED,
      message:
        'Gagal memastikan seluruh perubahan tersimpan. Perpindahan bisnis dibatalkan dan data lama tidak diubah.',
    }
  }

  let sourceSnapshot
  try {
    sourceSnapshot = await captureActiveWorkspaceSnapshot(adapter)
  } catch {
    return {
      ok: false,
      code: WORKSPACE_SWITCH_RESULT.CAPTURE_FAILED,
      message: 'Gagal membaca ruang kerja saat ini. Perpindahan dibatalkan.',
    }
  }

  // Persist the outgoing workspace durably BEFORE touching the singleton tables.
  try {
    await adapter.saveWorkspaceSnapshot(previousWorkspaceId, sourceSnapshot)
  } catch {
    return {
      ok: false,
      code: WORKSPACE_SWITCH_RESULT.SNAPSHOT_WRITE_FAILED,
      message:
        'Gagal menyimpan data ruang kerja lama secara aman. Perpindahan dibatalkan dan data lama tidak diubah.',
    }
  }

  // Verify durability so a failed write can never masquerade as a safe switch.
  let readBack
  try {
    readBack = await adapter.loadWorkspaceSnapshot(previousWorkspaceId)
  } catch {
    return {
      ok: false,
      code: WORKSPACE_SWITCH_RESULT.SNAPSHOT_VERIFY_FAILED,
      message:
        'Verifikasi penyimpanan data ruang kerja lama gagal. Perpindahan dibatalkan dan data lama tidak diubah.',
    }
  }
  if (!readBack || computeWorkspaceChecksum(readBack) !== computeWorkspaceChecksum(sourceSnapshot)) {
    return {
      ok: false,
      code: WORKSPACE_SWITCH_RESULT.SNAPSHOT_VERIFY_FAILED,
      message:
        'Verifikasi penyimpanan data ruang kerja lama gagal. Perpindahan dibatalkan dan data lama tidak diubah.',
    }
  }

  let targetSnapshot
  try {
    targetSnapshot =
      (await adapter.loadWorkspaceSnapshot(targetWorkspaceId)) ?? buildEmptyWorkspaceSnapshot()
  } catch {
    return {
      ok: false,
      code: WORKSPACE_SWITCH_RESULT.SNAPSHOT_READ_FAILED,
      message: 'Gagal membaca ruang kerja tujuan. Perpindahan dibatalkan dan data lama tidak diubah.',
    }
  }

  const journal = {
    version: JOURNAL_VERSION,
    operationId: makeOperationId(),
    phase: WORKSPACE_SWITCH_PHASE.PREPARED,
    phaseHistory: [],
    sourceWorkspaceId: previousWorkspaceId,
    targetWorkspaceId,
    sourceChecksum: computeWorkspaceChecksum(sourceSnapshot),
    targetChecksum: computeWorkspaceChecksum(targetSnapshot),
    registryBefore: registry,
    targetMeta,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }

  let current
  try {
    current = await writeJournal(adapter, journal, WORKSPACE_SWITCH_PHASE.PREPARED)
    current = await writeJournal(adapter, current, WORKSPACE_SWITCH_PHASE.APPLYING)
  } catch {
    return {
      ok: false,
      code: WORKSPACE_SWITCH_RESULT.JOURNAL_WRITE_FAILED,
      message: 'Gagal mencatat jurnal perpindahan. Perpindahan dibatalkan dan data lama tidak diubah.',
    }
  }

  // 4. materialise target, 5. rehydrate Pinia, 6. update business identity,
  // 7. persist Cloud context.
  try {
    await applyWorkspaceSnapshot(adapter, targetSnapshot)
    await scheduler.rehydrate()
    if (typeof hooks?.onTargetMaterialised === 'function') {
      await hooks.onTargetMaterialised({ targetMeta, targetSnapshot })
    }
    if (typeof hooks?.onPersistCloudContext === 'function') {
      await hooks.onPersistCloudContext()
    }
  } catch {
    const rollback = await performRollback({ adapter, scheduler, journal: current, hooks })
    return {
      ok: false,
      code: WORKSPACE_SWITCH_RESULT.APPLY_FAILED,
      rollback,
      message: rollback.ok
        ? 'Perpindahan ruang kerja gagal. Ruang kerja sebelumnya berhasil dipulihkan.'
        : 'Perpindahan ruang kerja gagal dan pemulihan otomatis tidak selesai. Diperlukan pemulihan manual.',
    }
  }

  try {
    current = await writeJournal(adapter, current, WORKSPACE_SWITCH_PHASE.APPLIED)
  } catch {
    const rollback = await performRollback({ adapter, scheduler, journal: current, hooks })
    return {
      ok: false,
      code: WORKSPACE_SWITCH_RESULT.JOURNAL_WRITE_FAILED,
      rollback,
      message: rollback.ok
        ? 'Perpindahan ruang kerja gagal. Ruang kerja sebelumnya berhasil dipulihkan.'
        : 'Perpindahan ruang kerja gagal dan pemulihan otomatis tidak selesai. Diperlukan pemulihan manual.',
    }
  }

  // 8. commit the registry active workspace LAST.
  const nextRegistry = {
    version: REGISTRY_VERSION,
    activeWorkspaceId: targetWorkspaceId,
    workspaces: {
      ...registry.workspaces,
      [previousWorkspaceId]: buildWorkspaceEntry(
        previousWorkspaceId,
        sourceSnapshot,
        registry.workspaces?.[previousWorkspaceId] ?? null,
      ),
      [targetWorkspaceId]: buildWorkspaceEntry(targetWorkspaceId, targetSnapshot, targetMeta),
    },
  }

  try {
    await adapter.saveWorkspaceRegistry(nextRegistry)
  } catch {
    const rollback = await performRollback({ adapter, scheduler, journal: current, hooks })
    return {
      ok: false,
      code: WORKSPACE_SWITCH_RESULT.REGISTRY_WRITE_FAILED,
      rollback,
      message: rollback.ok
        ? 'Gagal mencatat perpindahan ruang kerja. Ruang kerja sebelumnya berhasil dipulihkan.'
        : 'Gagal mencatat perpindahan ruang kerja dan pemulihan otomatis tidak selesai. Diperlukan pemulihan manual.',
    }
  }

  try {
    current = await writeJournal(adapter, current, WORKSPACE_SWITCH_PHASE.COMMITTED)
    await adapter.clearWorkspaceSwitchJournal()
  } catch {
    // The commit is already durable in the registry. A leftover journal is
    // reconciled on the next start by `recoverPendingWorkspaceSwitch`.
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

/**
 * Startup crash recovery for an interrupted workspace switch.
 *
 * The journal is durable, so a forced app close mid-switch is always detected.
 * The registry is reconciled with the journal: a switch whose registry commit
 * already landed is finalised, anything else is rolled back to the source
 * workspace. A failed recovery is reported so the caller can block risky
 * operations.
 *
 * @returns {Promise<object>}
 */
export async function recoverPendingWorkspaceSwitch({ adapter, scheduler = null, hooks = null } = {}) {
  if (!supportsWorkspaceStorage(adapter)) {
    return { ok: true, code: WORKSPACE_RECOVERY_RESULT.NO_RECOVERY_NEEDED }
  }

  let journal
  try {
    journal = await adapter.loadWorkspaceSwitchJournal()
  } catch {
    return {
      ok: false,
      code: WORKSPACE_RECOVERY_RESULT.RECOVERY_REQUIRED,
      message: 'Jurnal perpindahan ruang kerja tidak dapat dibaca. Diperlukan pemulihan manual.',
    }
  }

  if (!journal) {
    return { ok: true, code: WORKSPACE_RECOVERY_RESULT.NO_RECOVERY_NEEDED }
  }

  // A switch that never started materialising is safe to abort.
  if (journal.phase === WORKSPACE_SWITCH_PHASE.PREPARED) {
    await adapter.clearWorkspaceSwitchJournal()
    return { ok: true, code: WORKSPACE_RECOVERY_RESULT.ABORTED_PREPARED }
  }

  if (isFinalPhase(journal.phase)) {
    await adapter.clearWorkspaceSwitchJournal()
    return { ok: true, code: WORKSPACE_RECOVERY_RESULT.FINALIZED_COMMITTED }
  }

  // APPLIED: the singleton tables hold the target. Whether that is the committed
  // state is decided by the registry, never assumed.
  if (journal.phase === WORKSPACE_SWITCH_PHASE.APPLIED) {
    const registryRead = await readWorkspaceRegistryStrict(adapter)
    if (!registryRead.ok) {
      return {
        ok: false,
        code: WORKSPACE_RECOVERY_RESULT.RECOVERY_REQUIRED,
        message: 'Status registry ruang kerja tidak pasti. Diperlukan pemulihan manual.',
      }
    }
    if (registryRead.registry.activeWorkspaceId === journal.targetWorkspaceId) {
      await adapter.clearWorkspaceSwitchJournal()
      return { ok: true, code: WORKSPACE_RECOVERY_RESULT.FINALIZED_COMMITTED }
    }
    // Registry never committed: undo the materialisation.
  }

  // APPLYING / ROLLING_BACK / (APPLIED without a matching registry) -> roll back.
  if (!supportsScheduler(scheduler)) {
    return {
      ok: false,
      code: WORKSPACE_RECOVERY_RESULT.RECOVERY_REQUIRED,
      message: 'Penyimpanan belum siap untuk memulihkan perpindahan ruang kerja yang terhenti.',
    }
  }

  const rollback = await performRollback({ adapter, scheduler, journal, hooks })
  if (!rollback.ok) {
    return {
      ok: false,
      code: WORKSPACE_RECOVERY_RESULT.RECOVERY_REQUIRED,
      message: 'Pemulihan otomatis perpindahan ruang kerja gagal. Diperlukan pemulihan manual.',
    }
  }

  return { ok: true, code: WORKSPACE_RECOVERY_RESULT.ROLLED_BACK }
}
