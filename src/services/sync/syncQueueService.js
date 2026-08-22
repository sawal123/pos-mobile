import { SYNC_ENTITY_TYPES, SYNC_OPERATIONS, SYNC_QUEUE_DEFAULT_LIMIT } from './syncConstants'

// Normalize any error shape into a plain string before it is persisted so an
// Error/number/null is never stored as-is (and never bound to SQLite as an
// object). Mirrors the same guard used by the SQLite adapter.
function normalizeErrorMessage(error) {
  if (error === null || error === undefined) {
    return ''
  }

  if (error instanceof Error) {
    return error.message
  }

  return String(error)
}

function createQueueEntryId() {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID()
  }

  return `sync-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

// Normalize to a plain JSON-compatible snapshot so reactive Pinia proxies can
// never leak into the durable outbox or break structuredClone/JSON adapters.
function clonePayload(payload) {
  if (payload === null || payload === undefined) {
    return null
  }

  return JSON.parse(JSON.stringify(payload))
}

function isValidEntityType(entityType) {
  return Object.values(SYNC_ENTITY_TYPES).includes(entityType)
}

function isValidOperation(operation) {
  return Object.values(SYNC_OPERATIONS).includes(operation)
}

/**
 * Durable local sync outbox. Every mutation write is serialized through the
 * injected scheduler (the P8 PersistenceService write queue) so sync writes can
 * never run concurrently with local persistence transactions on the same
 * SQLite connection.
 *
 * P9 only stores operations locally. Nothing is sent to any server.
 */
export function createSyncQueueService({ adapter, scheduler }) {
  async function enqueue(entityType, entityId, operation, payload) {
    if (!isValidEntityType(entityType)) {
      const error = new Error(`Unsupported sync entity type: ${entityType}`)
      console.error('Failed to enqueue sync operation.', error)
      return { ok: false, error }
    }

    if (!isValidOperation(operation)) {
      const error = new Error(`Unsupported sync operation: ${operation}`)
      console.error('Failed to enqueue sync operation.', error)
      return { ok: false, error }
    }

    const now = new Date().toISOString()
    const entry = {
      id: createQueueEntryId(),
      entityType,
      entityId: String(entityId),
      operation,
      payload: clonePayload(payload),
      createdAt: now,
      updatedAt: now,
      attemptCount: 0,
      lastError: null,
    }

    try {
      await scheduler.runSerialized(() => adapter.upsertSyncQueueItem(entry), `sync:${entityType}`)

      return {
        ok: true,
        entry,
      }
    } catch (error) {
      console.error(`Failed to enqueue sync ${entityType} ${operation} for ${entityId}.`, error)

      return {
        ok: false,
        error,
      }
    }
  }

  return {
    async enqueueUpsert(entityType, entityId, payload) {
      return enqueue(entityType, entityId, SYNC_OPERATIONS.UPSERT, payload)
    },
    async enqueueDelete(entityType, entityId) {
      return enqueue(entityType, entityId, SYNC_OPERATIONS.DELETE, null)
    },
    async listPending(options) {
      return adapter.listSyncQueueItems({
        limit: options?.limit ?? SYNC_QUEUE_DEFAULT_LIMIT,
      })
    },
    async countPending() {
      return adapter.countSyncQueueItems()
    },
    async markFailed(queueId, error) {
      try {
        // Normalize before persisting so an Error/number/null is always stored
        // as a plain string and never bound to SQLite as an object.
        const normalizedError = normalizeErrorMessage(error)

        await scheduler.runSerialized(
          () => adapter.markSyncQueueItemFailed(queueId, normalizedError),
          'sync:failed',
        )

        return { ok: true }
      } catch (err) {
        console.error(`Failed to mark sync queue item ${queueId} as failed.`, err)

        return { ok: false, error: err }
      }
    },
    async remove(queueId) {
      try {
        await scheduler.runSerialized(() => adapter.deleteSyncQueueItem(queueId), 'sync:remove')

        return { ok: true }
      } catch (error) {
        console.error(`Failed to remove sync queue item ${queueId}.`, error)

        return { ok: false, error }
      }
    },
    async flush() {
      if (scheduler && typeof scheduler.flush === 'function') {
        await scheduler.flush()
      }
    },
    dispose() {},
  }
}
