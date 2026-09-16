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
  async function runTask(task, label) {
    if (scheduler && typeof scheduler.runSerialized === 'function') {
      return scheduler.runSerialized(task, label)
    }
    return task()
  }

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

    // Every mutation gets a unique outbox row; the push service collapses
    // older snapshots of the same entity row so the server still sees one
    // logical mutation per entity.
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
      await runTask(() => adapter.upsertSyncQueueItem(entry), `sync:${entityType}`)

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
    async enqueueManyUpserts(entries) {
      if (!Array.isArray(entries) || entries.length === 0) {
        return { ok: true, count: 0, entries: [] }
      }

      const now = new Date().toISOString()
      const formattedEntries = []

      for (const item of entries) {
        if (!isValidEntityType(item.entityType)) {
          const error = new Error(`Unsupported sync entity type: ${item.entityType}`)
          return { ok: false, error }
        }

        formattedEntries.push({
          id: item.id || createQueueEntryId(),
          entityType: item.entityType,
          entityId: String(item.entityId),
          operation: SYNC_OPERATIONS.UPSERT,
          payload: clonePayload(item.payload),
          createdAt: item.createdAt || now,
          updatedAt: now,
          attemptCount: 0,
          lastError: null,
        })
      }

      if (typeof adapter.upsertSyncQueueItems !== 'function') {
        const error = new Error('Adapter does not support atomic bulk queue operations.')
        return {
          ok: false,
          code: 'ATOMIC_BULK_QUEUE_UNSUPPORTED',
          error,
        }
      }

      try {
        await runTask(() => adapter.upsertSyncQueueItems(formattedEntries), 'sync:bulk_upsert')

        return {
          ok: true,
          count: formattedEntries.length,
          entries: formattedEntries,
        }
      } catch (error) {
        console.error('Failed to atomically enqueue sync queue items.', error)
        return {
          ok: false,
          error,
        }
      }
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

        await runTask(
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
        await runTask(() => adapter.deleteSyncQueueItem(queueId), 'sync:remove')

        return { ok: true }
      } catch (error) {
        console.error(`Failed to remove sync queue item ${queueId}.`, error)

        return { ok: false, error }
      }
    },
    async removeIfUnchanged(snapshot) {
      try {
        let result = { changes: 0 }
        await runTask(async () => {
          result = await adapter.deleteSyncQueueItemIfUnchanged(snapshot)
        }, 'sync:remove-cas')

        return {
          ok: true,
          removed: (result?.changes ?? 0) > 0,
        }
      } catch (error) {
        console.error(`Failed to conditionally remove sync queue item ${snapshot?.id}.`, error)

        return { ok: false, removed: false, error }
      }
    },
    async markFailedIfUnchanged(snapshot, error) {
      try {
        const normalizedError = normalizeErrorMessage(error)
        let result = { changes: 0 }
        await runTask(async () => {
          result = await adapter.markSyncQueueItemFailedIfUnchanged(snapshot, normalizedError)
        }, 'sync:failed-cas')

        return {
          ok: true,
          updated: (result?.changes ?? 0) > 0,
        }
      } catch (err) {
        console.error(
          `Failed to conditionally mark sync queue item ${snapshot?.id} as failed.`,
          err,
        )

        return { ok: false, updated: false, error: err }
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
