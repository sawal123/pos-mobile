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
  online = true,
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
    detail: 'Semua data tersinkronisasi',
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
    } else if (typeof rawInflight === 'object' && !Array.isArray(rawInflight)) {
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
