/**
 * Cloud business ↔ local workspace separation helpers.
 *
 * Three distinct concepts are intentionally kept apart:
 *   1. Cloud authentication  — the logged-in account identity (owned by the
 *      cloud session store / token repository).
 *   2. Cloud business link   — the Cloud business selected from the membership
 *      list in `GET /api/mobile/context`.
 *   3. Active operational workspace — the cashier workspace currently
 *      materialised in the singleton local database.
 *
 * A local business mismatch is NOT a login failure and NOT a reason to refuse a
 * valid Cloud business. It only means a workspace switch must be confirmed by
 * the user and performed safely. This module therefore classifies the local
 * workspace read-only and builds the confirmation copy; it never mutates data.
 */

export const WORKSPACE_CLASSIFICATION = Object.freeze({
  EMPTY: 'LOCAL_WORKSPACE_EMPTY',
  PROTECTED: 'LOCAL_WORKSPACE_PROTECTED',
  UNAVAILABLE: 'LOCAL_WORKSPACE_UNAVAILABLE',
  READ_FAILED: 'LOCAL_WORKSPACE_READ_FAILED',
})

const REQUIRED_READERS = [
  'loadBusiness',
  'loadProducts',
  'loadCustomers',
  'loadExpenses',
  'loadTransactions',
  'loadCashState',
  'loadShiftState',
  'listSyncQueueItems',
  'loadSyncPushBinding',
  'loadSyncPullBinding',
  'loadSyncPushInflight',
  'loadSyncBootstrapState',
  'loadSyncIdentityMap',
  'loadSyncServerVersions',
  'loadSyncAutoSettings',
]

const CLOUD_FIRST_REQUIRED_READERS = [
  ...REQUIRED_READERS,
  'loadLocalOperationJournal',
  'loadRestoreJournal',
  'loadWorkspaceSwitchJournal',
  'loadSyncConflicts',
  'loadSyncPullState',
]

function isNonEmptyText(value) {
  return typeof value === 'string' && value.trim().length > 0
}

function hasRows(value) {
  return Array.isArray(value) && value.length > 0
}

function hasMeaningfulShift(value) {
  return Boolean(
    value &&
      (value.isOpen === true ||
        value.id ||
        value.shiftNumber ||
        value.status ||
        value.openedAt ||
        value.closedAt),
  )
}

function hasMeaningfulBusiness(value) {
  return Boolean(value && (isNonEmptyText(value.name) || isNonEmptyText(value.type)))
}

function hasPendingLocalOperation(value) {
  if (!value) return false
  const list = Array.isArray(value.entries)
    ? value.entries
    : Array.isArray(value.ops)
      ? value.ops
      : null
  if (!list) return false
  return list.some(
    (entry) =>
      !entry?.status ||
      entry.status === 'pending' ||
      !['completed', 'rolled_back', 'committed'].includes(entry.status),
  )
}

function hasUnfinishedRestore(value) {
  return Boolean(
    value &&
      typeof value === 'object' &&
      !['completed', 'rolled_back', 'committed'].includes(value.phase),
  )
}

function hasUnfinishedWorkspaceSwitch(value) {
  return Boolean(
    value &&
      typeof value === 'object' &&
      !['committed', 'rolled_back'].includes(value.phase),
  )
}

function hasOpenSyncConflict(value) {
  if (!value) return false
  if (Array.isArray(value)) {
    return value.some((c) => !c?.status || c.status === 'open')
  }
  if (Array.isArray(value.conflicts)) {
    return value.conflicts.some((c) => !c?.status || c.status === 'open')
  }
  return false
}

function hasInconsistentPullState(pullState, pullBinding) {
  if (!pullState) return false
  if (
    typeof pullState !== 'object' ||
    pullState.version !== 1 ||
    !Number.isInteger(pullState.cursor) ||
    pullState.cursor < 0 ||
    !Number.isInteger(pullState.serverSequence) ||
    pullState.serverSequence < 0 ||
    typeof pullState.updatedAt !== 'string' ||
    pullState.updatedAt.trim().length === 0 ||
    !pullBinding
  ) {
    return true
  }
  return false
}

export function normalizeBusinessSnapshot(value) {
  return {
    name: typeof value?.name === 'string' ? value.name.trim() : '',
    type: typeof value?.type === 'string' ? value.type.trim() : '',
    outlet: typeof value?.outlet === 'string' ? value.outlet.trim() : '',
  }
}

/**
 * Read every data family capable of tying the singleton local workspace to a
 * business. Missing readers and read failures fail closed (treated as
 * protected/unknown). The result is read-only classification only — callers
 * must never use it to reject a valid Cloud login or business selection.
 */
export async function inspectLocalBusinessWorkspace({ adapter, runtime = null } = {}) {
  if (!adapter || REQUIRED_READERS.some((key) => typeof adapter[key] !== 'function')) {
    return {
      ok: false,
      occupied: false,
      code: WORKSPACE_CLASSIFICATION.UNAVAILABLE,
      safeToActivate: false,
      reasons: ['workspace_reader_unavailable'],
      localBusiness: normalizeBusinessSnapshot(runtime?.business),
    }
  }

  try {
    const [
      storedBusiness,
      storedProducts,
      storedCustomers,
      storedExpenses,
      storedTransactions,
      storedCash,
      storedShift,
      syncQueue,
      pushBinding,
      pullBinding,
      inflight,
      bootstrap,
      identityMap,
      serverVersions,
      autoSettings,
    ] = await Promise.all([
      adapter.loadBusiness(),
      adapter.loadProducts(),
      adapter.loadCustomers(),
      adapter.loadExpenses(),
      adapter.loadTransactions(),
      adapter.loadCashState(),
      adapter.loadShiftState(),
      adapter.listSyncQueueItems({ limit: 1 }),
      adapter.loadSyncPushBinding(),
      adapter.loadSyncPullBinding(),
      adapter.loadSyncPushInflight(),
      adapter.loadSyncBootstrapState(),
      adapter.loadSyncIdentityMap(),
      adapter.loadSyncServerVersions(),
      adapter.loadSyncAutoSettings(),
    ])

    const reasons = []
    const localBusiness = normalizeBusinessSnapshot(
      hasMeaningfulBusiness(runtime?.business) ? runtime.business : storedBusiness,
    )
    if (hasMeaningfulBusiness(storedBusiness) || hasMeaningfulBusiness(runtime?.business)) {
      reasons.push('business_metadata')
    }

    const products = storedProducts?.products ?? []
    const categories = storedProducts?.categories ?? []
    const stockMovements = storedProducts?.stockMovements ?? []
    if (hasRows(products) || hasRows(categories) || hasRows(stockMovements)) reasons.push('catalog_or_stock')
    if (hasRows(storedCustomers)) reasons.push('customers')
    if (hasRows(storedExpenses)) reasons.push('expenses')
    if (hasRows(storedTransactions)) reasons.push('transactions')
    if (hasRows(storedCash?.entries)) reasons.push('cash')
    if (hasMeaningfulShift(storedShift)) reasons.push('shift')
    if (hasRows(syncQueue)) reasons.push('sync_queue')

    if (pushBinding || pullBinding || inflight || bootstrap || identityMap || serverVersions || autoSettings) {
      reasons.push('sync_metadata')
    }

    const occupied = reasons.length > 0

    return {
      ok: true,
      occupied,
      code: occupied ? WORKSPACE_CLASSIFICATION.PROTECTED : WORKSPACE_CLASSIFICATION.EMPTY,
      safeToActivate: !occupied,
      reasons,
      localBusiness,
    }
  } catch {
    return {
      ok: false,
      occupied: false,
      code: WORKSPACE_CLASSIFICATION.READ_FAILED,
      safeToActivate: false,
      reasons: ['workspace_read_failed'],
      localBusiness: normalizeBusinessSnapshot(runtime?.business),
    }
  }
}

/**
 * Read-only safety check used by the Cloud-first download flow.
 *
 * A newly materialised Cloud workspace deliberately has business metadata: the
 * workspace switch writes the selected business identity before any catalogue
 * data is downloaded. That identity must not be mistaken for offline data.
 * Every other operational or sync artifact remains a hard stop, so this helper
 * cannot be used to merge or overwrite an existing workspace.
 */
export async function inspectCloudFirstWorkspace({ adapter, scheduler = null } = {}) {
  if (!adapter || CLOUD_FIRST_REQUIRED_READERS.some((key) => typeof adapter[key] !== 'function')) {
    return {
      ok: false,
      safeToInitialize: false,
      code: WORKSPACE_CLASSIFICATION.UNAVAILABLE,
      reasons: ['workspace_reader_unavailable'],
    }
  }

  if (scheduler && typeof scheduler.flush === 'function') {
    try {
      await scheduler.flush()
    } catch {
      return {
        ok: false,
        safeToInitialize: false,
        code: WORKSPACE_CLASSIFICATION.READ_FAILED,
        reasons: ['persistence_operation_pending'],
      }
    }
  }

  try {
    const [
      storedProducts,
      storedCustomers,
      storedExpenses,
      storedTransactions,
      storedCash,
      storedShift,
      syncQueue,
      pushBinding,
      pullBinding,
      inflight,
      bootstrap,
      identityMap,
      serverVersions,
      autoSettings,
      localOperationJournal,
      restoreJournal,
      workspaceSwitchJournal,
      conflicts,
      pullState,
    ] = await Promise.all([
      adapter.loadProducts(),
      adapter.loadCustomers(),
      adapter.loadExpenses(),
      adapter.loadTransactions(),
      adapter.loadCashState(),
      adapter.loadShiftState(),
      adapter.listSyncQueueItems({ limit: 1 }),
      adapter.loadSyncPushBinding(),
      adapter.loadSyncPullBinding(),
      adapter.loadSyncPushInflight(),
      adapter.loadSyncBootstrapState(),
      adapter.loadSyncIdentityMap(),
      adapter.loadSyncServerVersions(),
      adapter.loadSyncAutoSettings(),
      adapter.loadLocalOperationJournal(),
      adapter.loadRestoreJournal(),
      adapter.loadWorkspaceSwitchJournal(),
      adapter.loadSyncConflicts(),
      adapter.loadSyncPullState(),
    ])

    const reasons = []
    const products = storedProducts?.products ?? []
    const categories = storedProducts?.categories ?? []
    const stockMovements = storedProducts?.stockMovements ?? []
    if (hasRows(products) || hasRows(categories) || hasRows(stockMovements)) reasons.push('catalog_or_stock')
    if (hasRows(storedCustomers)) reasons.push('customers')
    if (hasRows(storedExpenses)) reasons.push('expenses')
    if (hasRows(storedTransactions)) reasons.push('transactions')
    if (hasRows(storedCash?.entries)) reasons.push('cash')
    if (hasMeaningfulShift(storedShift)) reasons.push('shift')
    if (hasRows(syncQueue)) reasons.push('sync_queue')
    if (pushBinding || pullBinding || inflight || bootstrap || identityMap || serverVersions || autoSettings) {
      reasons.push('sync_metadata')
    }
    if (hasPendingLocalOperation(localOperationJournal)) reasons.push('local_operation_pending')
    if (hasUnfinishedRestore(restoreJournal)) reasons.push('restore_journal_pending')
    if (hasUnfinishedWorkspaceSwitch(workspaceSwitchJournal)) reasons.push('workspace_switch_pending')
    if (hasOpenSyncConflict(conflicts)) reasons.push('sync_conflict_pending')
    if (hasInconsistentPullState(pullState, pullBinding)) {
      reasons.push('inconsistent_pull_state')
    } else if (pullState) {
      reasons.push('pull_state_present')
    }

    return {
      ok: true,
      safeToInitialize: reasons.length === 0,
      code:
        reasons.length === 0
          ? WORKSPACE_CLASSIFICATION.EMPTY
          : WORKSPACE_CLASSIFICATION.PROTECTED,
      reasons,
    }
  } catch {
    return {
      ok: false,
      safeToInitialize: false,
      code: WORKSPACE_CLASSIFICATION.READ_FAILED,
      reasons: ['workspace_read_failed'],
    }
  }
}

export function formatBusinessTypeForMismatch(type) {
  if (type === 'Cafe / UMKM') return 'Cafe'
  if (type === 'Grosir / Toko Kelontong') return 'Grosir'
  if (type === 'Laundry') return 'Laundry'
  return 'Tidak diketahui'
}

/**
 * Build the "Beralih Bisnis?" confirmation copy shown when the selected Cloud
 * business differs from the active local workspace. This is a confirmation —
 * never an error banner.
 */
export function buildBusinessSwitchConfirmation({ localBusiness, cloudBusiness } = {}) {
  const localName = localBusiness?.name || 'Bisnis lokal'
  const localType = formatBusinessTypeForMismatch(localBusiness?.type)
  const cloudName = cloudBusiness?.name || 'Bisnis Cloud'
  const cloudType = formatBusinessTypeForMismatch(cloudBusiness?.business_type)

  return {
    title: 'Beralih Bisnis?',
    message:
      `Anda sedang menggunakan ${localName} (${localType}) dan akan beralih ke ${cloudName} (${cloudType}).\n\n` +
      'Data lokal bisnis sebelumnya akan disimpan secara terpisah dan tidak digabungkan dengan bisnis baru.\n\n' +
      'Apakah Anda ingin melanjutkan?',
    confirmLabel: 'Simpan & Beralih',
    cancelLabel: 'Batal',
    localName,
    localType,
    cloudName,
    cloudType,
  }
}

/**
 * Legacy mismatch copy retained for compatibility with any historical caller.
 */
export function buildBusinessMismatchMessage({ localBusiness, cloudBusiness } = {}) {
  const localName = localBusiness?.name || 'Bisnis lokal'
  const localType = localBusiness?.type || 'Tidak diketahui'
  const cloudName = cloudBusiness?.name || 'Bisnis Cloud'
  const cloudType = formatBusinessTypeForMismatch(cloudBusiness?.business_type)

  return `Bisnis lokal saat ini adalah ${localName} (${localType}), sedangkan bisnis Cloud yang dipilih adalah ${cloudName} (${cloudType}). Data kedua bisnis tidak boleh digabungkan. Gunakan ruang kerja bisnis terpisah sebelum mengaktifkan bisnis Cloud ini.`
}
