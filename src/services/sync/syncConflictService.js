import { createSyncQueueService } from './syncQueueService'
import { createSyncIdentityRegistry } from './syncIdentityRegistry'

/**
 * Creates a P15 Sync Conflict Service.
 * Manages manual conflict resolution for 409 SYNC_CONFLICT responses.
 *
 * @param {object} options
 * @param {object} options.adapter Persistence adapter (SQLite / Memory)
 * @param {object} [options.scheduler] Persistence serializer / scheduler
 * @param {object} [options.queueService] SyncQueueService instance
 * @param {object} [options.registry] Durable sync identity registry instance
 * @returns {object}
 */
export function createSyncConflictService({
  adapter,
  scheduler = null,
  queueService = null,
  registry = null,
} = {}) {
  const activeQueueService = queueService ?? createSyncQueueService({ adapter, scheduler })
  const activeRegistry = registry ?? createSyncIdentityRegistry({ adapter, scheduler })

  /**
   * Loads the full durable conflicts state.
   */
  async function listConflicts() {
    if (!adapter || typeof adapter.loadSyncConflicts !== 'function') {
      return { version: 1, conflicts: [] }
    }
    const state = await adapter.loadSyncConflicts()
    return {
      version: 1,
      conflicts: Array.isArray(state?.conflicts) ? state.conflicts : [],
    }
  }

  /**
   * Lists all open conflicts.
   */
  async function listOpenConflicts() {
    const full = await listConflicts()
    return full.conflicts.filter((c) => c.status === 'open')
  }

  /**
   * Counts open conflicts.
   */
  async function countOpenConflicts() {
    const open = await listOpenConflicts()
    return open.length
  }

  /**
   * Manual Resolution — USE SERVER:
   * Discards the local pending mutation via CAS and marks conflict resolved.
   * Does NOT auto-pull.
   *
   * @param {string} conflictId
   * @returns {Promise<object>}
   */
  async function useServer(conflictId) {
    if (!adapter || typeof adapter.loadSyncConflicts !== 'function') {
      return { ok: false, code: 'ADAPTER_UNSUPPORTED', message: 'Adapter does not support conflicts' }
    }

    const state = (await adapter.loadSyncConflicts()) || { version: 1, conflicts: [] }
    const conflicts = Array.isArray(state.conflicts) ? state.conflicts : []
    const conflict = conflicts.find((c) => c.id === conflictId && c.status === 'open')

    if (!conflict) {
      return {
        ok: false,
        code: 'CONFLICT_NOT_FOUND',
        message: 'Conflict not found or already resolved.',
      }
    }

    let casRemoved = false

    if (conflict.queueSnapshot) {
      // Attempt CAS queue removal with the recorded snapshot
      const casResult = await activeQueueService.removeIfUnchanged(conflict.queueSnapshot)

      if (!casResult.ok) {
        return {
          ok: false,
          code: 'SYNC_CONFLICT_QUEUE_ERROR',
          message: 'Storage error while conditionally removing queue item.',
        }
      }

      if (!casResult.removed) {
        // Check if item exists with modified data in queue
        const totalPending = await activeQueueService.countPending()
        const pendingItems = totalPending > 0 ? await activeQueueService.listPending({ limit: totalPending }) : []
        const existingInQueue = pendingItems.find((p) => p.id === conflict.queueId)

        if (existingInQueue) {
          return {
            ok: false,
            code: 'SYNC_CONFLICT_LOCAL_CHANGED',
            message: 'Local data has changed since conflict was recorded.',
          }
        }
        // If not in queue, it was already removed earlier
      } else {
        casRemoved = true
      }
    }

    // Mark conflict as resolved
    conflict.status = 'resolved'
    conflict.resolvedAt = new Date().toISOString()
    conflict.resolution = 'use_server'

    try {
      await adapter.saveSyncConflicts({
        version: 1,
        conflicts,
      })
    } catch (saveErr) {
      // Fail-safe atomic rollback: re-insert the removed snapshot so local mutation is never lost
      if (casRemoved && conflict.queueSnapshot && typeof adapter.upsertSyncQueueItems === 'function') {
        try {
          await adapter.upsertSyncQueueItems([conflict.queueSnapshot])
        } catch {
          // best-effort rollback
        }
      }
      return {
        ok: false,
        code: 'SYNC_CONFLICT_PERSIST_FAILED',
        message: 'Failed to persist durable sync conflict resolution.',
      }
    }

    return {
      ok: true,
      code: 'SYNC_CONFLICT_RESOLVED',
      message: 'Konflik selesai. Gunakan Tarik Data Cloud untuk mengambil versi server.',
    }
  }

  /**
   * Manual Resolution — KEEP LOCAL:
   * Updates sync_server_versions_v1 with serverSyncVersion in flat P13 format so next push uses it as base_sync_version.
   * Preserves local queue item and marks conflict resolved.
   * Does NOT auto-push.
   *
   * @param {string} conflictId
   * @returns {Promise<object>}
   */
  async function keepLocal(conflictId) {
    if (!adapter || typeof adapter.loadSyncConflicts !== 'function') {
      return { ok: false, code: 'ADAPTER_UNSUPPORTED', message: 'Adapter does not support conflicts' }
    }

    const state = (await adapter.loadSyncConflicts()) || { version: 1, conflicts: [] }
    const conflicts = Array.isArray(state.conflicts) ? state.conflicts : []
    const conflict = conflicts.find((c) => c.id === conflictId && c.status === 'open')

    if (!conflict) {
      return {
        ok: false,
        code: 'CONFLICT_NOT_FOUND',
        message: 'Conflict not found or already resolved.',
      }
    }

    // Update server versions map with flat P13 format `${serverEntity}:${syncId}`
    if (typeof adapter.loadSyncServerVersions === 'function' && typeof adapter.saveSyncServerVersions === 'function') {
      const serverVersions = (await adapter.loadSyncServerVersions()) || {}
      const flatKey = `${conflict.serverEntity}:${conflict.syncId}`
      if (serverVersions[flatKey] && typeof serverVersions[flatKey] === 'object') {
        serverVersions[flatKey].syncVersion = Number(conflict.serverSyncVersion)
      } else {
        serverVersions[flatKey] = {
          syncVersion: Number(conflict.serverSyncVersion),
        }
      }
      // Also write nested if parent key exists for full compatibility
      if (serverVersions[conflict.serverEntity] && typeof serverVersions[conflict.serverEntity] === 'object') {
        serverVersions[conflict.serverEntity][conflict.syncId] = Number(conflict.serverSyncVersion)
      }
      await adapter.saveSyncServerVersions(serverVersions)
    }

    // Mark conflict resolved
    conflict.status = 'resolved'
    conflict.resolvedAt = new Date().toISOString()
    conflict.resolution = 'keep_local'

    await adapter.saveSyncConflicts({
      version: 1,
      conflicts,
    })

    return {
      ok: true,
      code: 'SYNC_CONFLICT_RESOLVED',
      message: 'Konflik selesai. Gunakan Sync Sekarang untuk mengirim ulang data lokal.',
    }
  }

  return {
    listConflicts,
    listOpenConflicts,
    countOpenConflicts,
    useServer,
    keepLocal,
    queueService: activeQueueService,
    registry: activeRegistry,
  }
}
