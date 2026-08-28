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

export const TYPE_ACTION_MAP = Object.freeze({
  push: ['PUSH_NOW'],
  pull: ['PULL_NOW'],
  bootstrap: ['BOOTSTRAP'],
  full_sync: ['SYNC_ALL'],
  conflict: ['USE_SERVER', 'KEEP_LOCAL'],
  health: ['CHECK_HEALTH'],
  recovery: [
    'RETRY_INFLIGHT',
    'CONTINUE_PENDING',
    'PREPARE_BOOTSTRAP',
    'CONTINUE_BOOTSTRAP',
  ],
})

const MAX_ACTIVITY_LOG_ENTRIES = 100
const SAFE_CODE_REGEX = /^[A-Za-z0-9_.:-]+$/

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

function isPlainObject(val) {
  return val !== null && typeof val === 'object' && !Array.isArray(val)
}

/**
 * Strict allowlist sanitizer for P19 summary metadata.
 */
function sanitizeSummary(rawSummary) {
  if (!isPlainObject(rawSummary)) {
    return {}
  }

  const sanitized = {}

  // Numeric fields
  const numericKeys = [
    'sent',
    'remaining',
    'blocked',
    'fetched',
    'applied',
    'ignored',
    'pushed',
    'pulled',
    'stagedCount',
    'pending',
    'conflicts',
  ]
  for (const k of numericKeys) {
    if (k in rawSummary) {
      const v = rawSummary[k]
      if (v === null) {
        sanitized[k] = null
      } else if (Number.isFinite(Number(v))) {
        sanitized[k] = Number(v)
      }
    }
  }

  // Boolean fields
  if ('hasInflight' in rawSummary) {
    const v = rawSummary.hasInflight
    if (typeof v === 'boolean') {
      sanitized.hasInflight = v
    } else if (v === null) {
      sanitized.hasInflight = null
    }
  }

  // String fields
  const stringKeys = ['stage', 'healthStatus', 'action', 'cursorBefore', 'cursorAfter']
  for (const k of stringKeys) {
    if (k in rawSummary) {
      const v = rawSummary[k]
      if (v === null) {
        sanitized[k] = null
      } else if (typeof v === 'string' && v.length <= 128) {
        sanitized[k] = v.trim()
      } else if (typeof v === 'number') {
        sanitized[k] = String(v)
      }
    }
  }

  return sanitized
}

/**
 * Validates an existing entry from durable storage.
 */
function isValidStoredEntry(entry) {
  if (!isPlainObject(entry)) return false
  if (typeof entry.id !== 'string' || !entry.id.trim() || entry.id.length > 128) return false
  if (!SYNC_ACTIVITY_TYPES.includes(entry.type)) return false
  const validActions = TYPE_ACTION_MAP[entry.type] || []
  if (!validActions.includes(entry.action)) return false
  if (!SYNC_ACTIVITY_STATUSES.includes(entry.status)) return false
  if (typeof entry.code !== 'string' || !entry.code.trim() || entry.code.length > 128) return false
  if (entry.code.includes('\n') || entry.code.includes('\r')) return false
  if (!isValidDateString(entry.startedAt) || !isValidDateString(entry.finishedAt)) return false
  if (new Date(entry.finishedAt).getTime() < new Date(entry.startedAt).getTime()) return false
  if (!isPlainObject(entry.summary)) return false

  if (entry.businessId !== null && (!Number.isInteger(Number(entry.businessId)) || Number(entry.businessId) <= 0)) {
    return false
  }
  if (entry.outletId !== null && (!Number.isInteger(Number(entry.outletId)) || Number(entry.outletId) <= 0)) {
    return false
  }
  if (entry.registeredDeviceId !== null && (!Number.isInteger(Number(entry.registeredDeviceId)) || Number(entry.registeredDeviceId) <= 0)) {
    return false
  }
  if (entry.deviceIdentifier !== null && (typeof entry.deviceIdentifier !== 'string' || !entry.deviceIdentifier.trim() || entry.deviceIdentifier.length > 128)) {
    return false
  }

  return true
}

/**
 * Creates a P19 Sync Activity Log Service for local audit trail.
 *
 * @param {object} options
 * @param {object} options.adapter Persistence adapter
 * @param {object} [options.scheduler] Serialized persistence scheduler
 * @returns {object}
 */
export function createSyncActivityLogService({ adapter, scheduler } = {}) {
  let localQueue = Promise.resolve()

  function runSerialized(task, label = 'sync_activity_log') {
    if (scheduler && typeof scheduler.runSerialized === 'function') {
      return scheduler.runSerialized(task, label)
    }
    const next = localQueue.then(() => task(), () => task())
    localQueue = next
    return next
  }

  function hasReadCapability() {
    return Boolean(
      adapter &&
        (typeof adapter.loadSyncActivityLog === 'function' ||
          typeof adapter.readMetaValue === 'function'),
    )
  }

  function hasWriteCapability() {
    return Boolean(
      adapter &&
        (typeof adapter.saveSyncActivityLog === 'function' ||
          typeof adapter.writeMetaValue === 'function'),
    )
  }

  function hasClearCapability() {
    return Boolean(
      adapter &&
        (typeof adapter.clearSyncActivityLog === 'function' || hasWriteCapability()),
    )
  }

  async function readDurableState() {
    if (typeof adapter.loadSyncActivityLog === 'function') {
      return await adapter.loadSyncActivityLog()
    }
    if (typeof adapter.readMetaValue === 'function') {
      return await adapter.readMetaValue('sync_activity_log_v1', null)
    }
    throw new Error('Adapter does not support read capability.')
  }

  async function writeDurableState(state) {
    if (typeof adapter.saveSyncActivityLog === 'function') {
      return await adapter.saveSyncActivityLog(state)
    }
    if (typeof adapter.writeMetaValue === 'function') {
      return await adapter.writeMetaValue('sync_activity_log_v1', state)
    }
    throw new Error('Adapter does not support write capability.')
  }

  async function deleteDurableState() {
    if (typeof adapter.clearSyncActivityLog === 'function') {
      return await adapter.clearSyncActivityLog()
    }
    if (typeof adapter.saveSyncActivityLog === 'function') {
      return await adapter.saveSyncActivityLog({ version: 1, entries: [] })
    }
    if (typeof adapter.writeMetaValue === 'function') {
      return await adapter.writeMetaValue('sync_activity_log_v1', { version: 1, entries: [] })
    }
    throw new Error('Adapter does not support clear capability.')
  }

  /**
   * Records a sync activity entry into durable local storage.
   *
   * @param {object} rawEntry
   * @returns {Promise<object>}
   */
  async function record(rawEntry = {}) {
    if (!hasReadCapability() || !hasWriteCapability()) {
      return {
        ok: false,
        code: 'SYNC_ACTIVITY_LOG_ADAPTER_UNSUPPORTED',
        message: 'Persistence adapter tidak mendukung pencatatan activity log.',
      }
    }

    if (!isPlainObject(rawEntry)) {
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

    // 1. Strict Validation (Fail Closed)
    if (typeof id !== 'string' || !id.trim() || id.length > 128) {
      return {
        ok: false,
        code: 'SYNC_ACTIVITY_LOG_INVALID_ENTRY',
        message: 'ID activity log tidak valid.',
      }
    }

    if (!type || !SYNC_ACTIVITY_TYPES.includes(type)) {
      return {
        ok: false,
        code: 'SYNC_ACTIVITY_LOG_INVALID_ENTRY',
        message: `Type '${type}' tidak valid.`,
      }
    }

    const validActions = TYPE_ACTION_MAP[type] || []
    if (typeof action !== 'string' || !validActions.includes(action.trim())) {
      return {
        ok: false,
        code: 'SYNC_ACTIVITY_LOG_INVALID_ENTRY',
        message: `Action '${action}' tidak valid untuk type '${type}'.`,
      }
    }

    if (!status || !SYNC_ACTIVITY_STATUSES.includes(status)) {
      return {
        ok: false,
        code: 'SYNC_ACTIVITY_LOG_INVALID_ENTRY',
        message: `Status '${status}' tidak valid.`,
      }
    }

    if (
      typeof code !== 'string' ||
      !code.trim() ||
      code.length > 128 ||
      code.includes('\n') ||
      code.includes('\r') ||
      !SAFE_CODE_REGEX.test(code.trim())
    ) {
      return {
        ok: false,
        code: 'SYNC_ACTIVITY_LOG_INVALID_ENTRY',
        message: 'Code activity log tidak valid.',
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
    if (deviceIdentifier !== null && (typeof deviceIdentifier !== 'string' || !deviceIdentifier.trim() || deviceIdentifier.length > 128)) {
      return {
        ok: false,
        code: 'SYNC_ACTIVITY_LOG_INVALID_ENTRY',
        message: 'deviceIdentifier tidak valid.',
      }
    }

    const cleanEntry = {
      id: String(id).trim(),
      type,
      action: String(action).trim(),
      status,
      code: String(code).trim(),
      startedAt,
      finishedAt,
      businessId: businessId != null ? Number(businessId) : null,
      outletId: outletId != null ? Number(outletId) : null,
      deviceIdentifier: deviceIdentifier != null ? String(deviceIdentifier).trim() : null,
      registeredDeviceId: registeredDeviceId != null ? Number(registeredDeviceId) : null,
      summary: sanitizeSummary(summary),
    }

    // 2. Serialized critical section: Read -> Validate -> Dedupe -> Append -> Slice -> Save
    return runSerialized(async () => {
      let logState
      try {
        logState = await readDurableState()
      } catch (err) {
        return {
          ok: false,
          code: 'SYNC_ACTIVITY_LOG_PERSIST_FAILED',
          message: err.message || 'Gagal membaca activity log.',
        }
      }

      if (logState !== null && logState !== undefined) {
        if (!isPlainObject(logState) || logState.version !== 1 || !Array.isArray(logState.entries)) {
          return {
            ok: false,
            code: 'SYNC_ACTIVITY_LOG_STATE_INVALID',
            message: 'Durable activity log state rusak atau tidak sesuai skema v1.',
          }
        }

        // Validate all existing entries
        for (const existing of logState.entries) {
          if (!isValidStoredEntry(existing)) {
            return {
              ok: false,
              code: 'SYNC_ACTIVITY_LOG_STATE_INVALID',
              message: 'Ditemukan entri riwayat yang rusak pada storage.',
            }
          }
        }
      }

      const existingEntries = Array.isArray(logState?.entries) ? logState.entries : []
      // Dedupe by id, newest entry at top
      const nextEntries = [
        cleanEntry,
        ...existingEntries.filter((e) => e.id !== cleanEntry.id),
      ].slice(0, MAX_ACTIVITY_LOG_ENTRIES)

      const nextState = {
        version: 1,
        entries: nextEntries,
      }

      try {
        await writeDurableState(nextState)
        return {
          ok: true,
          code: 'SYNC_ACTIVITY_LOG_RECORDED',
          entry: cleanEntry,
        }
      } catch (err) {
        return {
          ok: false,
          code: 'SYNC_ACTIVITY_LOG_PERSIST_FAILED',
          message: err.message || 'Gagal menyimpan activity log.',
        }
      }
    }, 'sync_activity_log_record')
  }

  /**
   * Lists recent activity log entries (newest first).
   *
   * @param {object} [options]
   * @param {number} [options.limit=20]
   * @returns {Promise<Array>}
   */
  async function listRecent({ limit = 20 } = {}) {
    if (!hasReadCapability()) {
      throw new Error('Persistence adapter tidak mendukung pembacaan activity log.')
    }

    return runSerialized(async () => {
      const logState = await readDurableState()

      if (logState === null || logState === undefined) {
        return []
      }

      if (!isPlainObject(logState) || logState.version !== 1 || !Array.isArray(logState.entries)) {
        throw new Error('Durable activity log state rusak atau tidak sesuai skema v1.')
      }

      for (const existing of logState.entries) {
        if (!isValidStoredEntry(existing)) {
          throw new Error('Ditemukan entri riwayat yang rusak pada storage.')
        }
      }

      const effectiveLimit = Math.max(1, Math.min(Number(limit) || 20, MAX_ACTIVITY_LOG_ENTRIES))
      return logState.entries.slice(0, effectiveLimit)
    }, 'sync_activity_log_list')
  }

  /**
   * Clears activity log history without modifying sync queue, conflicts, or bindings.
   * Can be used to reset a corrupt activity log.
   *
   * @returns {Promise<object>}
   */
  async function clearHistory() {
    if (!hasClearCapability()) {
      return {
        ok: false,
        code: 'SYNC_ACTIVITY_LOG_ADAPTER_UNSUPPORTED',
        message: 'Persistence adapter tidak mendukung penghapusan activity log.',
      }
    }

    return runSerialized(async () => {
      try {
        await deleteDurableState()
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
    }, 'sync_activity_log_clear')
  }

  return {
    record,
    listRecent,
    clearHistory,
  }
}
