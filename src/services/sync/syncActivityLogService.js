export const SYNC_ACTIVITY_TYPES = Object.freeze([
  'push',
  'pull',
  'bootstrap',
  'full_sync',
  'conflict',
  'health',
  'recovery',
])

export const SYNC_ACTIVITY_STATUSES = Object.freeze([
  'success',
  'failed',
  'blocked',
  'attention',
])

export const SYNC_ACTIVITY_ACTIONS = Object.freeze({
  PUSH_NOW: 'PUSH_NOW',
  PULL_NOW: 'PULL_NOW',
  BOOTSTRAP: 'BOOTSTRAP',
  SYNC_ALL: 'SYNC_ALL',
  USE_SERVER: 'USE_SERVER',
  KEEP_LOCAL: 'KEEP_LOCAL',
  CHECK_HEALTH: 'CHECK_HEALTH',
  RETRY_INFLIGHT: 'RETRY_INFLIGHT',
  CONTINUE_PENDING: 'CONTINUE_PENDING',
  PREPARE_BOOTSTRAP: 'PREPARE_BOOTSTRAP',
  CONTINUE_BOOTSTRAP: 'CONTINUE_BOOTSTRAP',
})

const MAX_ACTIVITY_LOG_ENTRIES = 100

function generateId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return 'act-' + Date.now() + '-' + Math.random().toString(36).slice(2, 9)
}

function isValidDateString(val) {
  if (typeof val !== 'string' || !val.trim()) return false
  const time = new Date(val).getTime()
  return Number.isFinite(time)
}

function sanitizeSummary(rawSummary) {
  if (!rawSummary || typeof rawSummary !== 'object' || Array.isArray(rawSummary)) {
    return {}
  }
  const FORBIDDEN_KEYS = new Set([
    'token',
    'password',
    'authorization',
    'credentials',
    'user',
    'products',
    'transactions',
    'items',
    'records',
    'sale_items',
    'expenses',
    'customers',
    'queueSnapshot',
    'conflictQueueSnapshot',
    'serverPayload',
    'rawPayload',
  ])

  const sanitized = {}
  for (const [k, v] of Object.entries(rawSummary)) {
    if (FORBIDDEN_KEYS.has(k)) continue
    // Only permit primitive scalar values or small metadata objects
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean' || v === null) {
      sanitized[k] = v
    }
  }
  return sanitized
}

/**
 * Creates a P19 Sync Activity Log Service for local audit trail.
 *
 * @param {object} options
 * @param {object} options.adapter Persistence adapter
 * @returns {object}
 */
export function createSyncActivityLogService({ adapter } = {}) {
  if (!adapter) {
    throw new Error('Adapter is required for createSyncActivityLogService.')
  }

  /**
   * Records a sync activity entry into durable local storage.
   *
   * @param {object} rawEntry
   * @returns {Promise<object>}
   */
  async function record(rawEntry = {}) {
    if (!rawEntry || typeof rawEntry !== 'object' || Array.isArray(rawEntry)) {
      return {
        ok: false,
        code: 'SYNC_ACTIVITY_LOG_INVALID_ENTRY',
        message: 'Entry activity log harus berupa object valid.',
      }
    }

    const {
      id = generateId(),
      type,
      action,
      status,
      code,
      startedAt,
      finishedAt,
      businessId = null,
      outletId = null,
      deviceIdentifier = null,
      registeredDeviceId = null,
      summary = {},
    } = rawEntry

    // 1. Validation (Fail Closed)
    if (!type || !SYNC_ACTIVITY_TYPES.includes(type)) {
      return {
        ok: false,
        code: 'SYNC_ACTIVITY_LOG_INVALID_ENTRY',
        message: `Type '${type}' tidak valid.`,
      }
    }

    if (typeof action !== 'string' || !action.trim()) {
      return {
        ok: false,
        code: 'SYNC_ACTIVITY_LOG_INVALID_ENTRY',
        message: 'Action activity log tidak boleh kosong.',
      }
    }

    if (!status || !SYNC_ACTIVITY_STATUSES.includes(status)) {
      return {
        ok: false,
        code: 'SYNC_ACTIVITY_LOG_INVALID_ENTRY',
        message: `Status '${status}' tidak valid.`,
      }
    }

    if (typeof code !== 'string' || !code.trim()) {
      return {
        ok: false,
        code: 'SYNC_ACTIVITY_LOG_INVALID_ENTRY',
        message: 'Code activity log tidak boleh kosong.',
      }
    }

    if (!isValidDateString(startedAt) || !isValidDateString(finishedAt)) {
      return {
        ok: false,
        code: 'SYNC_ACTIVITY_LOG_INVALID_ENTRY',
        message: 'Format timestamp startedAt/finishedAt tidak valid.',
      }
    }

    if (new Date(finishedAt).getTime() < new Date(startedAt).getTime()) {
      return {
        ok: false,
        code: 'SYNC_ACTIVITY_LOG_INVALID_ENTRY',
        message: 'finishedAt tidak boleh mendahului startedAt.',
      }
    }

    // Context validation if provided
    if (businessId !== null && (!Number.isInteger(Number(businessId)) || Number(businessId) <= 0)) {
      return {
        ok: false,
        code: 'SYNC_ACTIVITY_LOG_INVALID_ENTRY',
        message: 'businessId tidak valid.',
      }
    }
    if (outletId !== null && (!Number.isInteger(Number(outletId)) || Number(outletId) <= 0)) {
      return {
        ok: false,
        code: 'SYNC_ACTIVITY_LOG_INVALID_ENTRY',
        message: 'outletId tidak valid.',
      }
    }
    if (registeredDeviceId !== null && (!Number.isInteger(Number(registeredDeviceId)) || Number(registeredDeviceId) <= 0)) {
      return {
        ok: false,
        code: 'SYNC_ACTIVITY_LOG_INVALID_ENTRY',
        message: 'registeredDeviceId tidak valid.',
      }
    }

    const cleanEntry = {
      id: String(id),
      type,
      action: String(action).trim(),
      status,
      code: String(code).trim(),
      startedAt,
      finishedAt,
      businessId: businessId != null ? Number(businessId) : null,
      outletId: outletId != null ? Number(outletId) : null,
      deviceIdentifier: deviceIdentifier != null ? String(deviceIdentifier) : null,
      registeredDeviceId: registeredDeviceId != null ? Number(registeredDeviceId) : null,
      summary: sanitizeSummary(summary),
    }

    // 2. Persist to adapter
    try {
      let logState = null
      if (typeof adapter.loadSyncActivityLog === 'function') {
        logState = await adapter.loadSyncActivityLog()
      } else if (typeof adapter.readMetaValue === 'function') {
        logState = await adapter.readMetaValue('sync_activity_log_v1', null)
      }

      const existingEntries = Array.isArray(logState?.entries) ? logState.entries : []
      const nextEntries = [cleanEntry, ...existingEntries].slice(0, MAX_ACTIVITY_LOG_ENTRIES)

      const nextState = {
        version: 1,
        entries: nextEntries,
      }

      if (typeof adapter.saveSyncActivityLog === 'function') {
        await adapter.saveSyncActivityLog(nextState)
      } else if (typeof adapter.writeMetaValue === 'function') {
        await adapter.writeMetaValue('sync_activity_log_v1', nextState)
      }

      return {
        ok: true,
        code: 'SYNC_ACTIVITY_LOG_RECORDED',
        entry: cleanEntry,
      }
    } catch (err) {
      return {
        ok: false,
        code: 'SYNC_ACTIVITY_LOG_PERSIST_FAILED',
        message: err.message || 'Gagal menyimpan riwayat aktivitas sinkronisasi.',
      }
    }
  }

  /**
   * Lists recent activity log entries (newest first).
   *
   * @param {object} [options]
   * @param {number} [options.limit=20]
   * @returns {Promise<Array>}
   */
  async function listRecent({ limit = 20 } = {}) {
    try {
      let logState = null
      if (typeof adapter.loadSyncActivityLog === 'function') {
        logState = await adapter.loadSyncActivityLog()
      } else if (typeof adapter.readMetaValue === 'function') {
        logState = await adapter.readMetaValue('sync_activity_log_v1', null)
      }

      const entries = Array.isArray(logState?.entries) ? logState.entries : []
      const effectiveLimit = Math.max(1, Math.min(Number(limit) || 20, MAX_ACTIVITY_LOG_ENTRIES))
      return entries.slice(0, effectiveLimit)
    } catch {
      return []
    }
  }

  /**
   * Clears activity log history without modifying sync queue, conflicts, or bindings.
   *
   * @returns {Promise<object>}
   */
  async function clearHistory() {
    try {
      if (typeof adapter.clearSyncActivityLog === 'function') {
        await adapter.clearSyncActivityLog()
      } else if (typeof adapter.saveSyncActivityLog === 'function') {
        await adapter.saveSyncActivityLog({ version: 1, entries: [] })
      } else if (typeof adapter.writeMetaValue === 'function') {
        await adapter.writeMetaValue('sync_activity_log_v1', { version: 1, entries: [] })
      }

      return {
        ok: true,
        code: 'SYNC_ACTIVITY_LOG_CLEARED',
        message: 'Riwayat aktivitas sinkronisasi berhasil dihapus.',
      }
    } catch (err) {
      return {
        ok: false,
        code: 'SYNC_ACTIVITY_LOG_PERSIST_FAILED',
        message: err.message || 'Gagal menghapus riwayat aktivitas sinkronisasi.',
      }
    }
  }

  return {
    record,
    listRecent,
    clearHistory,
  }
}
