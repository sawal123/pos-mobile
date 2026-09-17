/**
 * P38 durable local operation journal.
 *
 * The journal is the crash-recovery record for a multi-store local operation
 * (retail sale, laundry settlement). It is written to durable storage BEFORE
 * the first irreversible mutation and cleared only after every domain store
 * and the outbox are durable. A process death anywhere in between therefore
 * leaves a pending entry that is recovered idempotently on the next start.
 *
 * The journal never touches the network and never requires a cloud session,
 * so Free mode keeps the same local crash durability.
 */

export const OPERATION_JOURNAL_VERSION = 1

function emptyState() {
  return { version: OPERATION_JOURNAL_VERSION, entries: [], updatedAt: null }
}

function normalizeState(state) {
  if (!state || typeof state !== 'object' || !Array.isArray(state.entries)) {
    return emptyState()
  }

  return {
    version: OPERATION_JOURNAL_VERSION,
    entries: state.entries.filter((entry) => entry && typeof entry === 'object' && entry.operationId),
    updatedAt: state.updatedAt ?? null,
  }
}

export function createOperationJournal({ adapter = null } = {}) {
  let writeQueue = Promise.resolve()

  const isEnabled = typeof adapter?.loadLocalOperationJournal === 'function'
    && typeof adapter?.saveLocalOperationJournal === 'function'

  function serialize(task) {
    const run = writeQueue.catch(() => {}).then(task)
    writeQueue = run.catch(() => {})
    return run
  }

  async function loadState() {
    if (!isEnabled) {
      return emptyState()
    }

    return normalizeState(await adapter.loadLocalOperationJournal())
  }

  async function saveState(state) {
    if (!isEnabled) {
      return
    }

    await adapter.saveLocalOperationJournal(state)
  }

  /**
   * Durably records a new pending operation before any mutation happens.
   *
   * @param {object} entry
   * @returns {Promise<object>} the persisted entry
   */
  async function begin(entry) {
    const record = {
      operationId: String(entry.operationId),
      operationType: String(entry.operationType),
      phase: entry.phase ?? 'journal_saved',
      status: 'pending',
      contextKey: entry.contextKey ?? 'local',
      businessId: entry.businessId ?? null,
      outletId: entry.outletId ?? null,
      createdAt: entry.createdAt ?? new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      payload: entry.payload ?? {},
      artifacts: entry.artifacts ?? {},
      attempts: 0,
    }

    await serialize(async () => {
      const state = await loadState()
      const nextEntries = state.entries.filter((item) => item.operationId !== record.operationId)
      nextEntries.push(record)
      await saveState({ version: OPERATION_JOURNAL_VERSION, entries: nextEntries, updatedAt: new Date().toISOString() })
    })

    return record
  }

  /**
   * Durable phase checkpoint. Used by recovery diagnostics and by the
   * crash-injection harness to interrupt the operation at a known boundary.
   */
  async function recordPhase(operationId, phase, artifacts = null, extra = null) {
    return await serialize(async () => {
      const state = await loadState()
      const index = state.entries.findIndex((item) => item.operationId === operationId)
      if (index === -1) {
        return null
      }

      const current = state.entries[index]
      const nextEntry = {
        ...current,
        phase,
        updatedAt: new Date().toISOString(),
        artifacts: artifacts ? { ...current.artifacts, ...artifacts } : current.artifacts,
        ...(extra ? { recovery: { ...(current.recovery ?? {}), ...extra } } : {}),
      }

      const nextEntries = [...state.entries]
      nextEntries[index] = nextEntry
      await saveState({ version: OPERATION_JOURNAL_VERSION, entries: nextEntries, updatedAt: new Date().toISOString() })

      return nextEntry
    })
  }

  /**
   * Clears the entry only after every domain store and the outbox are durable.
   */
  async function commit(operationId) {
    return await serialize(async () => {
      const state = await loadState()
      const nextEntries = state.entries.filter((item) => item.operationId !== operationId)
      if (nextEntries.length === state.entries.length) {
        return false
      }

      await saveState({ version: OPERATION_JOURNAL_VERSION, entries: nextEntries, updatedAt: new Date().toISOString() })
      return true
    })
  }

  async function listPending() {
    const state = await loadState()
    return state.entries.filter((entry) => entry.status === 'pending')
  }

  async function markAttempt(operationId) {
    return await serialize(async () => {
      const state = await loadState()
      const index = state.entries.findIndex((item) => item.operationId === operationId)
      if (index === -1) {
        return null
      }

      const nextEntries = [...state.entries]
      nextEntries[index] = {
        ...nextEntries[index],
        attempts: Number(nextEntries[index].attempts ?? 0) + 1,
        lastAttemptAt: new Date().toISOString(),
      }
      await saveState({ version: OPERATION_JOURNAL_VERSION, entries: nextEntries, updatedAt: new Date().toISOString() })

      return nextEntries[index]
    })
  }

  return {
    isEnabled,
    begin,
    recordPhase,
    commit,
    listPending,
    markAttempt,
    loadState,
  }
}
