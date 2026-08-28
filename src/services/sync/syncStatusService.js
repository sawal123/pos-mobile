export const SYNC_UI_LOCAL = 'SYNC_UI_LOCAL'
export const SYNC_UI_SYNCING = 'SYNC_UI_SYNCING'
export const SYNC_UI_CONFLICT = 'SYNC_UI_CONFLICT'
export const SYNC_UI_RECOVERY_REQUIRED = 'SYNC_UI_RECOVERY_REQUIRED'
export const SYNC_UI_OFFLINE = 'SYNC_UI_OFFLINE'
export const SYNC_UI_PENDING = 'SYNC_UI_PENDING'
export const SYNC_UI_UNKNOWN = 'SYNC_UI_UNKNOWN'
export const SYNC_UI_CLEAR = 'SYNC_UI_CLEAR'

export const SYNC_UI_STATUSES = Object.freeze([
  SYNC_UI_LOCAL,
  SYNC_UI_SYNCING,
  SYNC_UI_CONFLICT,
  SYNC_UI_RECOVERY_REQUIRED,
  SYNC_UI_OFFLINE,
  SYNC_UI_PENDING,
  SYNC_UI_UNKNOWN,
  SYNC_UI_CLEAR,
])

const REQUIRED_CHANGE_KEYS = Object.freeze([
  'categories',
  'products',
  'customers',
  'shifts',
  'sales',
  'sale_items',
  'expenses',
])

/**
 * Pure structural validator for P12 inflight push envelopes.
 *
 * @param {*} value
 * @returns {boolean}
 */
export function isValidInflightEnvelope(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false
  }

  if (value.version !== 1) {
    return false
  }

  if (typeof value.requestId !== 'string' || value.requestId.trim().length === 0) {
    return false
  }

  if (
    typeof value.businessId !== 'number' ||
    !Number.isInteger(value.businessId) ||
    value.businessId <= 0
  ) {
    return false
  }

  if (
    typeof value.outletId !== 'number' ||
    !Number.isInteger(value.outletId) ||
    value.outletId <= 0
  ) {
    return false
  }

  if (
    typeof value.deviceIdentifier !== 'string' ||
    value.deviceIdentifier.trim().length === 0
  ) {
    return false
  }

  if (
    typeof value.registeredDeviceId !== 'number' ||
    !Number.isInteger(value.registeredDeviceId) ||
    value.registeredDeviceId <= 0
  ) {
    return false
  }

  if (typeof value.createdAt !== 'string' || value.createdAt.trim().length === 0) {
    return false
  }

  if (!Array.isArray(value.queueSnapshots) || value.queueSnapshots.length === 0) {
    return false
  }

  for (const item of value.queueSnapshots) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      return false
    }
    if (typeof item.id !== 'string' || item.id.trim().length === 0) {
      return false
    }
    if (typeof item.entityType !== 'string' || item.entityType.trim().length === 0) {
      return false
    }
    if (
      item.entityId === null ||
      item.entityId === undefined ||
      String(item.entityId).trim().length === 0
    ) {
      return false
    }
    if (typeof item.operation !== 'string' || item.operation.trim().length === 0) {
      return false
    }
    if (
      item.updatedAt === null ||
      item.updatedAt === undefined ||
      String(item.updatedAt).trim().length === 0
    ) {
      return false
    }
  }

  if (!value.changes || typeof value.changes !== 'object' || Array.isArray(value.changes)) {
    return false
  }

  for (const key of REQUIRED_CHANGE_KEYS) {
    if (!Array.isArray(value.changes[key])) {
      return false
    }
  }

  return true
}

/**
 * Pure deterministic derivation of UI presentation status from local sync state.
 * Priority:
 * 1. LOCAL
 * 2. SYNCING
 * 3. CONFLICT
 * 4. RECOVERY_REQUIRED
 * 5. OFFLINE
 * 6. PENDING
 * 7. UNKNOWN
 * 8. CLEAR
 */
export function deriveSyncUiStatus({
  cloudAvailable = false,
  syncing = false,
  online = false,
  pendingCount = 0,
  openConflictCount = 0,
  hasInflight = false,
  readError = false,
} = {}) {
  if (!cloudAvailable) {
    return {
      status: SYNC_UI_LOCAL,
      label: 'Lokal',
      detail: 'Mode lokal / Free Mode',
    }
  }

  if (syncing) {
    return {
      status: SYNC_UI_SYNCING,
      label: 'Menyinkronkan…',
      detail: 'Sedang menyinkronkan data dengan cloud',
    }
  }

  if (typeof openConflictCount === 'number' && openConflictCount > 0) {
    return {
      status: SYNC_UI_CONFLICT,
      label: 'Konflik',
      detail: `${openConflictCount} konflik perlu diperiksa`,
    }
  }

  if (hasInflight === true) {
    return {
      status: SYNC_UI_RECOVERY_REQUIRED,
      label: 'Perlu Pemulihan',
      detail: 'Ada pengiriman data menggantung yang perlu dipulihkan',
    }
  }

  if (online === false) {
    return {
      status: SYNC_UI_OFFLINE,
      label: 'Offline',
      detail: 'Tidak ada koneksi internet',
    }
  }

  if (typeof pendingCount === 'number' && pendingCount > 0) {
    return {
      status: SYNC_UI_PENDING,
      label: `${pendingCount} menunggu`,
      detail: `${pendingCount} perubahan lokal menunggu sinkronisasi`,
    }
  }

  if (readError === true) {
    return {
      status: SYNC_UI_UNKNOWN,
      label: 'Status tidak tersedia',
      detail: 'Gagal membaca status lokal',
    }
  }

  return {
    status: SYNC_UI_CLEAR,
    label: 'Siap',
    detail: 'Tidak ada antrean sinkronisasi lokal',
  }
}

/**
 * Creates the read-only P21 Sync Status Service.
 * Does NOT execute network calls, mutations, push, pull, or health diagnosis.
 */
export function createSyncStatusService({
  queueService,
  conflictService,
  adapter,
} = {}) {
  /**
   * Reads current local sync metrics from database without modifying sync state.
   *
   * @returns {Promise<object>}
   */
  async function readLocalStatus() {
    if (!queueService || typeof queueService.countPending !== 'function') {
      return {
        ok: false,
        code: 'SYNC_STATUS_READ_FAILED',
        message: 'Queue service reader tidak tersedia.',
      }
    }

    if (!conflictService || typeof conflictService.countOpenConflicts !== 'function') {
      return {
        ok: false,
        code: 'SYNC_STATUS_READ_FAILED',
        message: 'Conflict service reader tidak tersedia.',
      }
    }

    if (!adapter || typeof adapter.loadSyncPushInflight !== 'function') {
      return {
        ok: false,
        code: 'SYNC_STATUS_READ_FAILED',
        message: 'Adapter inflight reader tidak tersedia.',
      }
    }

    let pendingCount
    let openConflictCount
    let rawInflight

    try {
      pendingCount = await queueService.countPending()
      openConflictCount = await conflictService.countOpenConflicts()
      rawInflight = await adapter.loadSyncPushInflight()
    } catch (err) {
      return {
        ok: false,
        code: 'SYNC_STATUS_READ_FAILED',
        message: err.message || 'Gagal membaca status sync lokal.',
      }
    }

    if (
      typeof pendingCount !== 'number' ||
      !Number.isInteger(pendingCount) ||
      pendingCount < 0
    ) {
      return {
        ok: false,
        code: 'SYNC_STATUS_READ_FAILED',
        message: 'Nilai pendingCount tidak valid.',
      }
    }

    if (
      typeof openConflictCount !== 'number' ||
      !Number.isInteger(openConflictCount) ||
      openConflictCount < 0
    ) {
      return {
        ok: false,
        code: 'SYNC_STATUS_READ_FAILED',
        message: 'Nilai openConflictCount tidak valid.',
      }
    }

    let hasInflight = false
    if (rawInflight === null || rawInflight === undefined) {
      hasInflight = false
    } else if (isValidInflightEnvelope(rawInflight)) {
      hasInflight = true
    } else {
      return {
        ok: false,
        code: 'SYNC_STATUS_READ_FAILED',
        message: 'Nilai inflight tidak valid.',
      }
    }

    return {
      ok: true,
      code: 'SYNC_STATUS_READ_OK',
      pendingCount,
      openConflictCount,
      hasInflight,
      checkedAt: new Date().toISOString(),
    }
  }

  return {
    readLocalStatus,
  }
}
