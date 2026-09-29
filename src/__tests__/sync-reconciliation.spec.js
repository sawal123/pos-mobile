/**
 * INT-04 — Mobile sync request reconciliation.
 *
 * Verifies the client half of the INT-03 backend contract
 * (`GET /api/sync/requests/{request_id}/status`) against mocks that follow the
 * documented contract. These unit tests do NOT prove the real backend
 * integration — that requires a live `pos_dashboard` instance (LIVE E2E:
 * NOT EXECUTED until INT-03 is merged).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

import { createMemoryAdapter } from '../services/database/memoryAdapter'
import { createSQLiteAdapter } from '../services/database/sqliteAdapter'
import { createPersistenceService } from '../services/database/persistenceService'
import { createSyncQueueService } from '../services/sync/syncQueueService'
import { createSyncIdentityRegistry } from '../services/sync/syncIdentityRegistry'
import { createSyncPushService } from '../services/sync/syncPushService'
import {
  createSyncReconciliationService,
  SYNC_RECONCILIATION_RESULTS,
} from '../services/sync/syncReconciliationService'
import {
  fetchSyncRequestStatus,
  SYNC_REQUEST_STATUS_COMMITTED,
  SYNC_REQUEST_STATUS_NOT_FOUND,
} from '../services/sync/syncRequestStatusTransport'
import {
  CASHIER_SYNC_CONTRACT_VERSION,
  SYNC_PUSH_MODE_CASHIER_SAFE,
  SYNC_PUSH_MODE_FULL,
} from '../services/sync/syncCapabilityPolicy'
import {
  SYNC_UI_ACCESS_DENIED,
  SYNC_UI_CLEANUP_FAILED,
  SYNC_UI_CLEAR,
  SYNC_UI_RECONCILIATION_COMMITTED,
  SYNC_UI_RECONCILIATION_REQUIRED,
  SYNC_UI_RECONCILIATION_WAITING,
  createSyncStatusService,
  deriveSyncUiStatus,
} from '../services/sync/syncStatusService'
import { SYNC_ENTITY_TYPES } from '../services/sync/syncConstants'
import { apiRequest } from '../services/cloud/apiClient'

// ── SQLite functional test double (queue + app_meta only) ────────────────────

const { fakeDb } = vi.hoisted(() => {
  const state = {
    version: 4,
    meta: new Map(),
    queue: [],
    reset() {
      this.version = 4
      this.meta.clear()
      this.queue = []
    },
  }

  const fakeDb = {
    state,
    beginTransaction: vi.fn(async () => {}),
    commitTransaction: vi.fn(async () => {}),
    rollbackTransaction: vi.fn(async () => {}),
    execute: vi.fn(async (sql) => {
      const match = /PRAGMA user_version\s*=\s*(\d+)/.exec(sql)
      if (match) state.version = Number(match[1])
    }),
    run: vi.fn(async (sql, values = []) => {
      const normalized = String(sql).replace(/\s+/g, ' ').trim()

      if (normalized.startsWith('INSERT OR REPLACE INTO app_meta')) {
        state.meta.set(values[0], values[1] === undefined ? null : values[1])
        return { changes: { changes: 1 } }
      }

      if (normalized.startsWith('DELETE FROM app_meta')) {
        const inlineKey = /key\s*=\s*'([^']+)'/.exec(normalized)
        const key = values[0] ?? inlineKey?.[1]
        state.meta.delete(key)
        return { changes: { changes: 1 } }
      }

      if (normalized.startsWith('INSERT INTO sync_queue')) {
        const [id, entityType, entityId, operation, payload, createdAt, updatedAt] = values
        const index = state.queue.findIndex(
          (row) => row.entity_type === entityType && row.entity_id === entityId,
        )
        const row = {
          id,
          entity_type: entityType,
          entity_id: entityId,
          operation,
          payload,
          created_at: createdAt,
          updated_at: updatedAt,
          attempt_count: 0,
          last_error: null,
        }
        if (index === -1) state.queue.push(row)
        else
          state.queue[index] = {
            ...row,
            id: state.queue[index].id,
            created_at: state.queue[index].created_at,
          }
        return { changes: { changes: 1 } }
      }

      if (normalized.startsWith('DELETE FROM sync_queue')) {
        if (normalized.includes('AND updated_at = ?')) {
          const [id, updatedAt, operation, payloadStr] = values
          const before = state.queue.length
          state.queue = state.queue.filter(
            (row) =>
              !(
                row.id === id &&
                row.updated_at === updatedAt &&
                row.operation === operation &&
                (row.payload ?? null) === (payloadStr ?? null)
              ),
          )
          return { changes: { changes: before - state.queue.length } }
        }
        state.queue = state.queue.filter((row) => row.id !== values[0])
        return { changes: { changes: 1 } }
      }

      if (normalized.startsWith('UPDATE sync_queue')) {
        const [error, id, updatedAt, operation, payloadStr] = values
        let changed = 0
        for (const row of state.queue) {
          if (
            row.id === id &&
            row.updated_at === updatedAt &&
            row.operation === operation &&
            (row.payload ?? null) === (payloadStr ?? null)
          ) {
            row.attempt_count += 1
            row.last_error = error
            changed += 1
          }
        }
        return { changes: { changes: changed } }
      }

      return { changes: { changes: 1 } }
    }),
    query: vi.fn(async (sql, values = []) => {
      const normalized = String(sql).replace(/\s+/g, ' ').trim()

      if (normalized.includes('PRAGMA user_version')) {
        return { values: [{ user_version: state.version }] }
      }

      if (normalized.includes('FROM app_meta')) {
        return { values: state.meta.has(values[0]) ? [{ value: state.meta.get(values[0]) }] : [] }
      }

      if (normalized.includes('COUNT(*) AS total FROM sync_queue')) {
        return { values: [{ total: state.queue.length }] }
      }

      if (normalized.includes('FROM sync_queue')) {
        const limit = Number(values[0])
        const rows = state.queue
          .slice()
          .sort((a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0))
          .slice(0, Number.isFinite(limit) ? limit : state.queue.length)
        return { values: rows.map((row) => ({ ...row })) }
      }

      return { values: [] }
    }),
    isDBOpen: async () => ({ result: true }),
    open: async () => {},
    close: async () => {},
    isTransactionActive: async () => ({ result: false }),
  }

  return { fakeDb }
})

vi.mock('@capacitor-community/sqlite', () => {
  class SQLiteConnection {
    async addUpgradeStatement() {}
    async checkConnectionsConsistency() {
      return { result: true }
    }
    async isConnection() {
      return { result: false }
    }
    async createConnection() {
      return fakeDb
    }
    async retrieveConnection() {
      return fakeDb
    }
    async closeConnection() {}
  }

  return { CapacitorSQLite: {}, SQLiteConnection }
})

vi.mock('../services/cloud/apiClient', () => ({
  apiRequest: vi.fn(),
}))

// ── Fixtures ────────────────────────────────────────────────────────────────

const DEVICE_IDENTIFIER = '123e4567-e89b-12d3-a456-426614174000'
const NOW = '2026-09-29T10:00:00.000Z'

function makeCapabilities(pushMode) {
  return {
    pull: true,
    push: pushMode !== 'none',
    push_mode: pushMode,
    allowed_entities: {
      customers: ['upsert'],
      shifts: ['upsert'],
      sales: ['upsert'],
      sale_items: ['upsert'],
      cash_ledger: ['sale_payment'],
      stock_movements: ['sale'],
    },
    denied_entities: ['categories', 'products', 'expenses', 'deletions'],
    contract_version: CASHIER_SYNC_CONTRACT_VERSION,
  }
}

function ownerContext(overrides = {}) {
  return {
    user: { id: 1, name: 'Owner', email: 'owner@example.com' },
    selectedBusiness: { id: 10, name: 'Toko Kopi' },
    selectedOutlet: { id: 101, name: 'Outlet Pusat' },
    cloudAccess: true,
    deviceIdentifier: DEVICE_IDENTIFIER,
    registeredDeviceId: 55,
    role: 'owner',
    syncCapabilities: makeCapabilities(SYNC_PUSH_MODE_FULL),
    ...overrides,
  }
}

function cashierContext(overrides = {}) {
  return ownerContext({
    role: 'cashier',
    syncCapabilities: makeCapabilities(SYNC_PUSH_MODE_CASHIER_SAFE),
    ...overrides,
  })
}

async function enqueueCustomer(queueService) {
  return queueService.enqueueUpsert(SYNC_ENTITY_TYPES.CUSTOMER, 'cust-1', {
    id: 'cust-1',
    name: 'Budi',
    phone: '0812',
    email: null,
  })
}

async function createReconHarness({ adapter = null, token = 'test-token' } = {}) {
  const pinia = createPinia()
  setActivePinia(pinia)

  const activeAdapter = adapter ?? createMemoryAdapter()
  await activeAdapter.initialize()
  await activeAdapter.saveSyncPushBinding({ businessId: 10, boundAt: NOW })

  const scheduler = createPersistenceService({ adapter: activeAdapter, pinia })
  await scheduler.initialize()

  const queueService = createSyncQueueService({ adapter: activeAdapter, scheduler })
  const registry = createSyncIdentityRegistry({ adapter: activeAdapter, scheduler })

  let currentToken = token

  let pushMode = 'ok'
  const pushCalls = []
  const pushTransport = vi.fn(async (args) => {
    pushCalls.push(args)
    if (pushMode === 'network') {
      return {
        ok: false,
        status: 0,
        data: null,
        error: { status: 0, code: 'NETWORK_ERROR', message: 'lost' },
      }
    }
    if (pushMode === 'forbidden') {
      return {
        ok: false,
        status: 403,
        data: { code: 'SYNC_OPERATION_NOT_ALLOWED', violations: [] },
        error: null,
      }
    }
    return {
      ok: true,
      status: 200,
      data: { data: { request_id: args.body.request_id, duplicate: false } },
      error: null,
    }
  })

  let statusMode = 'committed'
  const statusCalls = []
  const statusTransport = vi.fn(async (args) => {
    statusCalls.push(args)
    if (statusMode === 'committed') {
      return {
        ok: true,
        status: 200,
        data: { data: { status: SYNC_REQUEST_STATUS_COMMITTED, processed_at: NOW } },
        error: null,
      }
    }
    if (statusMode === 'not_found') {
      return {
        ok: true,
        status: 200,
        data: { data: { status: SYNC_REQUEST_STATUS_NOT_FOUND, processed_at: null } },
        error: null,
      }
    }
    if (statusMode === 'denied') {
      return {
        ok: false,
        status: 403,
        data: { code: 'BUSINESS_ACCESS_DENIED' },
        error: { status: 403, code: 'BUSINESS_ACCESS_DENIED' },
      }
    }
    if (statusMode === 'server_error') {
      return {
        ok: false,
        status: 500,
        data: null,
        error: { status: 500, code: 'SERVER_ERROR' },
      }
    }
    return {
      ok: false,
      status: 0,
      data: null,
      error: { status: 0, code: 'NETWORK_ERROR' },
    }
  })

  const pushService = createSyncPushService({
    adapter: activeAdapter,
    scheduler,
    queueService,
    registry,
    tokenFetcher: async () => currentToken,
    transport: pushTransport,
  })

  const reconciliationService = createSyncReconciliationService({
    adapter: activeAdapter,
    scheduler,
    queueService,
    registry,
    tokenFetcher: async () => currentToken,
    statusTransport,
  })

  return {
    pinia,
    adapter: activeAdapter,
    scheduler,
    queueService,
    registry,
    pushService,
    reconciliationService,
    pushTransport,
    statusTransport,
    pushCalls,
    statusCalls,
    setPushMode: (mode) => {
      pushMode = mode
    },
    setStatusMode: (mode) => {
      statusMode = mode
    },
    setToken: (value) => {
      currentToken = value
    },
    reconcile: (options = {}) => reconciliationService.reconcile({ context: ownerContext(), ...options }),
  }
}

/**
 * Drive production code into a genuinely `reconciliationRequired` envelope:
 *  1. an owner push whose response is lost (acceptance unknown), then
 *  2. an idempotent retry after a role downgrade that the backend 403s before
 *     it dedupes — which must be treated as reconciliation, not rejection.
 */
async function buildReconciliationRequiredEnvelope(harness) {
  harness.setPushMode('network')
  const lost = await harness.pushService.pushNow({ context: ownerContext() })
  expect(lost.acceptance).toBe('unknown')

  harness.setPushMode('forbidden')
  const denied = await harness.pushService.pushNow({ context: cashierContext() })
  expect(denied.code).toBe('SYNC_RECONCILIATION_REQUIRED')
  expect(denied.acceptance).toBe('unknown')

  const envelope = await harness.adapter.loadSyncPushInflight()
  expect(envelope).not.toBeNull()
  expect(envelope.reconciliationRequired).toBe(true)
  return envelope
}

// ════════════════════════════════════════════════════════════════════════════
// 1. Status transport
// ════════════════════════════════════════════════════════════════════════════

describe('INT-04 — status transport', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('calls the INT-03 contract path with the mobile token and never the query token', async () => {
    apiRequest.mockResolvedValueOnce({
      ok: true,
      status: 200,
      data: { data: { status: SYNC_REQUEST_STATUS_COMMITTED, processed_at: NOW } },
      error: null,
    })

    const res = await fetchSyncRequestStatus({
      token: 'secret-token',
      requestId: 'req-123',
      businessId: 10,
      deviceIdentifier: DEVICE_IDENTIFIER,
    })

    expect(res.ok).toBe(true)
    expect(apiRequest).toHaveBeenCalledTimes(1)
    const [path, options] = apiRequest.mock.calls[0]
    expect(path).toBe(
      `/api/sync/requests/req-123/status?business_id=10&device_identifier=${DEVICE_IDENTIFIER}`,
    )
    expect(options.method).toBe('GET')
    expect(options.token).toBe('secret-token')
    // The token never leaks into the URL.
    expect(path).not.toContain('secret-token')
  })

  it('URL-encodes the request id', async () => {
    apiRequest.mockResolvedValueOnce({ ok: true, status: 200, data: null, error: null })

    await fetchSyncRequestStatus({
      token: 't',
      requestId: 'a/b c',
      businessId: 1,
      deviceIdentifier: 'd',
    })

    expect(apiRequest.mock.calls[0][0]).toContain('/api/sync/requests/a%2Fb%20c/status')
  })
})

// ════════════════════════════════════════════════════════════════════════════
// 2. Committed recovery
// ════════════════════════════════════════════════════════════════════════════

describe('INT-04 — committed recovery', () => {
  it('confirms committed, cleans the outbox idempotently and never resends', async () => {
    const harness = await createReconHarness()
    await enqueueCustomer(harness.queueService)
    const envelope = await buildReconciliationRequiredEnvelope(harness)
    const pushCallsBefore = harness.pushCalls.length

    harness.setStatusMode('committed')
    const result = await harness.reconcile()

    expect(result.ok).toBe(true)
    expect(result.code).toBe(SYNC_RECONCILIATION_RESULTS.COMMITTED)
    expect(result.acceptance).toBe('accepted')
    expect(result.reconciliationRequired).toBe(false)
    expect(result.processedAt).toBe(NOW)

    // Envelope cleared only after a safe cleanup; outbox fully drained.
    expect(await harness.adapter.loadSyncPushInflight()).toBeNull()
    expect(await harness.queueService.countPending()).toBe(0)

    // Proven-accepted transactions are never resent.
    expect(harness.pushCalls.length).toBe(pushCallsBefore)
    expect(harness.statusCalls).toHaveLength(1)
    expect(harness.statusCalls[0].requestId).toBe(envelope.requestId)
    expect(harness.statusCalls[0].token).toBe('test-token')
  })

  it('preserves a row mutated while the request was in-flight (CAS)', async () => {
    const harness = await createReconHarness()
    await enqueueCustomer(harness.queueService)
    await buildReconciliationRequiredEnvelope(harness)

    // The cashier edits the same customer locally while the request is retained.
    await harness.queueService.enqueueUpsert(SYNC_ENTITY_TYPES.CUSTOMER, 'cust-1', {
      id: 'cust-1',
      name: 'Budi Updated',
      phone: '0813',
      email: null,
    })

    harness.setStatusMode('committed')
    const result = await harness.reconcile()

    expect(result.code).toBe(SYNC_RECONCILIATION_RESULTS.COMMITTED)
    expect(result.removedQueueIds).toHaveLength(0)
    expect(result.preservedQueueIds).toHaveLength(1)
    expect(await harness.adapter.loadSyncPushInflight()).toBeNull()
    expect(await harness.queueService.countPending()).toBe(1)
    const [row] = await harness.queueService.listPending({ limit: 10 })
    expect(row.payload.name).toBe('Budi Updated')
  })

  it('restores fresh sync version metadata for the acknowledged rows', async () => {
    const harness = await createReconHarness()
    await enqueueCustomer(harness.queueService)
    await buildReconciliationRequiredEnvelope(harness)

    harness.setStatusMode('committed')
    await harness.reconcile()

    const versions = (await harness.adapter.loadSyncServerVersions()) || {}
    expect(Object.keys(versions).some((key) => key.startsWith('customers:'))).toBe(true)
  })

  it('keeps the envelope and outbox when the local cleanup fails', async () => {
    const harness = await createReconHarness()
    await enqueueCustomer(harness.queueService)
    await buildReconciliationRequiredEnvelope(harness)

    const originalDelete = harness.adapter.deleteSyncQueueItemIfUnchanged
    harness.adapter.deleteSyncQueueItemIfUnchanged = vi
      .fn()
      .mockRejectedValue(new Error('SQLite disk I/O error'))

    try {
      harness.setStatusMode('committed')
      const result = await harness.reconcile()

      expect(result.ok).toBe(false)
      expect(result.code).toBe(SYNC_RECONCILIATION_RESULTS.CLEANUP_FAILED)
      expect(result.acceptance).toBe('accepted')
      expect(result.cleanupFailedQueueIds).toHaveLength(1)

      const envelope = await harness.adapter.loadSyncPushInflight()
      expect(envelope).not.toBeNull()
      expect(envelope.reconciliationOutcome).toBe('cleanup_failed')
      expect(await harness.queueService.countPending()).toBe(1)
    } finally {
      harness.adapter.deleteSyncQueueItemIfUnchanged = originalDelete
    }
  })
})

// ════════════════════════════════════════════════════════════════════════════
// 3. not_found recovery
// ════════════════════════════════════════════════════════════════════════════

describe('INT-04 — not_found recovery', () => {
  it('never deletes data and keeps the same request id', async () => {
    const harness = await createReconHarness()
    await enqueueCustomer(harness.queueService)
    const envelope = await buildReconciliationRequiredEnvelope(harness)

    harness.setStatusMode('not_found')
    const result = await harness.reconcile()

    expect(result.ok).toBe(true)
    expect(result.code).toBe(SYNC_RECONCILIATION_RESULTS.NOT_FOUND)
    expect(result.acceptance).toBe('unknown')
    expect(result.resolved).toBe(false)
    expect(result.recheckAvailable).toBe(true)
    expect(result.interventionRequired).toBe(true)

    const after = await harness.adapter.loadSyncPushInflight()
    expect(after).not.toBeNull()
    expect(after.requestId).toBe(envelope.requestId)
    expect(after.reconciliationRequired).toBe(true)
    expect(after.reconciliationOutcome).toBe('not_found')
    expect(await harness.queueService.countPending()).toBe(1)
  })

  it('does not auto-generate a new request id on the next reconcile', async () => {
    const harness = await createReconHarness()
    await enqueueCustomer(harness.queueService)
    const envelope = await buildReconciliationRequiredEnvelope(harness)

    harness.setStatusMode('not_found')
    await harness.reconcile()
    const second = await harness.reconcile()

    expect(second.requestId).toBe(envelope.requestId)
    expect(harness.statusCalls.map((c) => c.requestId)).toEqual([
      envelope.requestId,
      envelope.requestId,
    ])
  })
})

// ════════════════════════════════════════════════════════════════════════════
// 4. Device / business mismatch
// ════════════════════════════════════════════════════════════════════════════

describe('INT-04 — device / business mismatch', () => {
  it('refuses to reconcile against a different business without any HTTP call', async () => {
    const harness = await createReconHarness()
    await enqueueCustomer(harness.queueService)
    await buildReconciliationRequiredEnvelope(harness)

    const result = await harness.reconcile({
      context: ownerContext({ selectedBusiness: { id: 999, name: 'Other' } }),
    })

    expect(result.ok).toBe(false)
    expect(result.code).toBe(SYNC_RECONCILIATION_RESULTS.CONTEXT_MISMATCH)
    expect(harness.statusCalls).toHaveLength(0)
    expect(await harness.adapter.loadSyncPushInflight()).not.toBeNull()
  })

  it('refuses to reconcile against a different device', async () => {
    const harness = await createReconHarness()
    await enqueueCustomer(harness.queueService)
    await buildReconciliationRequiredEnvelope(harness)

    const result = await harness.reconcile({
      context: ownerContext({ deviceIdentifier: 'other-device-uuid' }),
    })

    expect(result.code).toBe(SYNC_RECONCILIATION_RESULTS.CONTEXT_MISMATCH)
    expect(harness.statusCalls).toHaveLength(0)
  })
})

// ════════════════════════════════════════════════════════════════════════════
// 5. Access denied / unreachable
// ════════════════════════════════════════════════════════════════════════════

describe('INT-04 — access denied and unreachable', () => {
  it('reports access denied and keeps the envelope on 403', async () => {
    const harness = await createReconHarness()
    await enqueueCustomer(harness.queueService)
    await buildReconciliationRequiredEnvelope(harness)

    harness.setStatusMode('denied')
    const result = await harness.reconcile()

    expect(result.ok).toBe(false)
    expect(result.code).toBe(SYNC_RECONCILIATION_RESULTS.ACCESS_DENIED)
    expect(result.revoked).toBe(true)
    expect(await harness.adapter.loadSyncPushInflight()).not.toBeNull()
    expect(await harness.queueService.countPending()).toBe(1)
  })

  it('reports waiting-for-connection on a network failure', async () => {
    const harness = await createReconHarness()
    await enqueueCustomer(harness.queueService)
    await buildReconciliationRequiredEnvelope(harness)

    harness.setStatusMode('network')
    const result = await harness.reconcile()

    expect(result.code).toBe(SYNC_RECONCILIATION_RESULTS.UNREACHABLE)
    expect(result.pendingConnection).toBe(true)
    expect(await harness.adapter.loadSyncPushInflight()).not.toBeNull()
  })

  it('does not delete anything on a 5xx', async () => {
    const harness = await createReconHarness()
    await enqueueCustomer(harness.queueService)
    await buildReconciliationRequiredEnvelope(harness)

    harness.setStatusMode('server_error')
    const result = await harness.reconcile()

    expect(result.code).toBe(SYNC_RECONCILIATION_RESULTS.UNREACHABLE)
    expect(await harness.adapter.loadSyncPushInflight()).not.toBeNull()
    expect(await harness.queueService.countPending()).toBe(1)
  })

  it('treats a missing token as waiting-for-connection without deleting data', async () => {
    const harness = await createReconHarness()
    await enqueueCustomer(harness.queueService)
    await buildReconciliationRequiredEnvelope(harness)

    harness.setToken(null)
    const result = await harness.reconcile()

    expect(result.code).toBe(SYNC_RECONCILIATION_RESULTS.UNREACHABLE)
    expect(result.pendingConnection).toBe(true)
    expect(harness.statusCalls).toHaveLength(0)
    expect(await harness.adapter.loadSyncPushInflight()).not.toBeNull()
  })
})

// ════════════════════════════════════════════════════════════════════════════
// 6. Role downgrade / no retry storm
// ════════════════════════════════════════════════════════════════════════════

describe('INT-04 — role downgrade (member -> cashier)', () => {
  it('requires reconciliation instead of re-planning while the first outcome is unknown', async () => {
    const harness = await createReconHarness()
    await enqueueCustomer(harness.queueService)
    const envelope = await buildReconciliationRequiredEnvelope(harness)

    // A further push must be short-circuited and must not resend.
    harness.setPushMode('ok')
    const third = await harness.pushService.pushNow({ context: cashierContext() })

    expect(third.code).toBe('SYNC_RECONCILIATION_REQUIRED')
    expect(third.reconciliationRequired).toBe(true)
    expect(harness.pushCalls).toHaveLength(2)
    const after = await harness.adapter.loadSyncPushInflight()
    expect(after.requestId).toBe(envelope.requestId)
  })
})

describe('INT-04 — no retry storm', () => {
  it('returns IN_PROGRESS for a concurrent reconcile and issues a single status call per attempt', async () => {
    const harness = await createReconHarness()
    await enqueueCustomer(harness.queueService)
    await buildReconciliationRequiredEnvelope(harness)

    const first = harness.reconcile()
    const second = harness.reconcile()

    const secondResult = await second
    expect(secondResult.code).toBe(SYNC_RECONCILIATION_RESULTS.IN_PROGRESS)

    await first
    expect(harness.statusCalls).toHaveLength(1)
  })

  it('is a no-op when there is no reconciliation-required envelope', async () => {
    const harness = await createReconHarness()
    const result = await harness.reconcile()

    expect(result.ok).toBe(true)
    expect(result.code).toBe(SYNC_RECONCILIATION_RESULTS.NOT_REQUIRED)
    expect(harness.statusCalls).toHaveLength(0)
  })
})

// ════════════════════════════════════════════════════════════════════════════
// 7. Restart while reconciliation is pending
// ════════════════════════════════════════════════════════════════════════════

describe('INT-04 — restart while reconciliation is pending', () => {
  it('reconciles the durable envelope through a fresh app graph', async () => {
    const durableAdapter = createMemoryAdapter()
    const first = await createReconHarness({ adapter: durableAdapter })
    await enqueueCustomer(first.queueService)
    const envelope = await buildReconciliationRequiredEnvelope(first)
    await first.scheduler.close()

    // Fresh graph over the SAME durable adapter — only durable state survives.
    const second = await createReconHarness({ adapter: durableAdapter })
    second.setStatusMode('committed')
    const result = await second.reconcile()

    expect(result.code).toBe(SYNC_RECONCILIATION_RESULTS.COMMITTED)
    expect(result.requestId).toBe(envelope.requestId)
    expect(await second.adapter.loadSyncPushInflight()).toBeNull()
    expect(await second.queueService.countPending()).toBe(0)
  })
})

// ════════════════════════════════════════════════════════════════════════════
// 8. Owner/member backward compatibility and free offline mode
// ════════════════════════════════════════════════════════════════════════════

describe('INT-04 — owner/member backward compatibility', () => {
  it('keeps the normal owner push acknowledgment unchanged', async () => {
    const harness = await createReconHarness()
    await enqueueCustomer(harness.queueService)

    const result = await harness.pushService.pushNow({ context: ownerContext() })

    expect(result.ok).toBe(true)
    expect(await harness.adapter.loadSyncPushInflight()).toBeNull()
    expect(await harness.queueService.countPending()).toBe(0)
  })

  it('does not reconcile for a plain in-flight envelope (normal retry path)', async () => {
    const harness = await createReconHarness()
    await enqueueCustomer(harness.queueService)
    harness.setPushMode('network')
    await harness.pushService.pushNow({ context: ownerContext() })

    const envelope = await harness.adapter.loadSyncPushInflight()
    expect(envelope.reconciliationRequired).toBeUndefined()

    const result = await harness.reconcile()
    expect(result.code).toBe(SYNC_RECONCILIATION_RESULTS.NOT_REQUIRED)
  })

  it('never writes the bearer token into durable storage', async () => {
    const harness = await createReconHarness()
    await enqueueCustomer(harness.queueService)
    await buildReconciliationRequiredEnvelope(harness)

    const envelope = await harness.adapter.loadSyncPushInflight()
    expect(JSON.stringify(envelope)).not.toContain('test-token')
  })
})

// ════════════════════════════════════════════════════════════════════════════
// 9. Cashier capability-safe outbox
// ════════════════════════════════════════════════════════════════════════════

describe('INT-04 — cashier capability-safe outbox', () => {
  it('never sends a role-restricted entity while reconciling', async () => {
    const harness = await createReconHarness()
    await harness.queueService.enqueueUpsert(SYNC_ENTITY_TYPES.PRODUCT, 'local-product', {
      id: 'local-product',
      name: 'Produk Baru',
      category: 'Minuman',
      price: 1000,
      isActive: true,
    })
    await harness.queueService.enqueueUpsert(SYNC_ENTITY_TYPES.CUSTOMER, 'cust-1', {
      id: 'cust-1',
      name: 'Budi',
      phone: '0812',
      email: null,
    })

    const result = await harness.pushService.pushNow({ context: cashierContext() })

    expect(result.ok).toBe(true)
    expect(result.restricted.map((r) => r.entityType)).toContain(SYNC_ENTITY_TYPES.PRODUCT)
    expect(harness.pushCalls[0].body.changes.products).toEqual([])
    expect(await harness.queueService.countPending()).toBe(1)
  })
})

// ════════════════════════════════════════════════════════════════════════════
// 10. Sync status granular states
// ════════════════════════════════════════════════════════════════════════════

describe('INT-04 — sync status granular states', () => {
  it('distinguishes every acceptance outcome', () => {
    const base = { cloudAvailable: true, syncing: false, hasInflight: true, online: true }

    expect(deriveSyncUiStatus({ ...base, acceptance: 'accepted' }).status).toBe(
      SYNC_UI_RECONCILIATION_COMMITTED,
    )
    expect(
      deriveSyncUiStatus({ ...base, acceptance: 'unknown', reconciliationRequired: true }).status,
    ).toBe(SYNC_UI_RECONCILIATION_REQUIRED)
    expect(deriveSyncUiStatus({ ...base, online: false }).status).toBe(
      SYNC_UI_RECONCILIATION_WAITING,
    )
    expect(deriveSyncUiStatus({ ...base, reconciliationOutcome: 'access_denied' }).status).toBe(
      SYNC_UI_ACCESS_DENIED,
    )
    expect(deriveSyncUiStatus({ ...base, reconciliationOutcome: 'cleanup_failed' }).status).toBe(
      SYNC_UI_CLEANUP_FAILED,
    )
  })

  it('never reports CLEAR while an envelope or queue is outstanding', () => {
    const withEnvelope = deriveSyncUiStatus({
      cloudAvailable: true,
      syncing: false,
      hasInflight: true,
      online: true,
      pendingCount: 0,
    })
    expect(withEnvelope.status).not.toBe(SYNC_UI_CLEAR)

    const withQueue = deriveSyncUiStatus({
      cloudAvailable: true,
      syncing: false,
      hasInflight: false,
      online: true,
      pendingCount: 2,
    })
    expect(withQueue.status).not.toBe(SYNC_UI_CLEAR)
  })

  it('exposes the acceptance outcome through readLocalStatus without mutating storage', async () => {
    const adapter = createMemoryAdapter()
    await adapter.initialize()
    const queueService = { countPending: vi.fn().mockResolvedValue(1) }
    const conflictService = { countOpenConflicts: vi.fn().mockResolvedValue(0) }
    const statusService = createSyncStatusService({ queueService, conflictService, adapter })

    await adapter.saveSyncPushInflight({
      version: 1,
      requestId: 'req-1',
      businessId: 10,
      outletId: 101,
      deviceIdentifier: DEVICE_IDENTIFIER,
      registeredDeviceId: 55,
      createdAt: NOW,
      acceptance: 'accepted',
      reconciliationRequired: true,
      reconciliationOutcome: 'cleanup_failed',
      queueSnapshots: [
        {
          id: 'q-1',
          entityType: 'customer',
          entityId: 'cust-1',
          operation: 'upsert',
          payload: { id: 'cust-1' },
          updatedAt: NOW,
        },
      ],
      changes: {
        categories: [],
        products: [],
        customers: [],
        sales: [],
        sale_items: [],
        shifts: [],
        expenses: [],
      },
    })

    const res = await statusService.readLocalStatus()

    expect(res.ok).toBe(true)
    expect(res.hasInflight).toBe(true)
    expect(res.acceptance).toBe('accepted')
    expect(res.reconciliationRequired).toBe(true)
    expect(res.reconciliationOutcome).toBe('cleanup_failed')
    // Reader is side-effect free.
    expect(await adapter.loadSyncPushInflight()).not.toBeNull()
  })
})

// ════════════════════════════════════════════════════════════════════════════
// 11. SQLite / memory parity
// ════════════════════════════════════════════════════════════════════════════

describe('INT-04 — SQLite / memory parity', () => {
  beforeEach(() => {
    fakeDb.state.reset()
  })

  async function runCommittedScenario(adapter) {
    const harness = await createReconHarness({ adapter })
    await enqueueCustomer(harness.queueService)
    await buildReconciliationRequiredEnvelope(harness)
    harness.setStatusMode('committed')
    const result = await harness.reconcile()
    return {
      code: result.code,
      removed: result.removedQueueIds.length,
      remaining: result.remaining,
      envelope: await harness.adapter.loadSyncPushInflight(),
      pending: await harness.queueService.countPending(),
    }
  }

  async function runNotFoundScenario(adapter) {
    const harness = await createReconHarness({ adapter })
    await enqueueCustomer(harness.queueService)
    await buildReconciliationRequiredEnvelope(harness)
    harness.setStatusMode('not_found')
    const result = await harness.reconcile()
    return {
      code: result.code,
      remaining: result.remaining,
      envelope: await harness.adapter.loadSyncPushInflight(),
      pending: await harness.queueService.countPending(),
    }
  }

  it('produces identical committed/not_found outcomes on both adapters', async () => {
    const memoryCommitted = await runCommittedScenario(createMemoryAdapter())
    const sqliteCommitted = await runCommittedScenario(createSQLiteAdapter())

    expect(sqliteCommitted.code).toBe(memoryCommitted.code)
    expect(sqliteCommitted.removed).toBe(memoryCommitted.removed)
    expect(sqliteCommitted.remaining).toBe(memoryCommitted.remaining)
    expect(sqliteCommitted.pending).toBe(memoryCommitted.pending)
    expect(sqliteCommitted.envelope).toBeNull()
    expect(memoryCommitted.envelope).toBeNull()

    fakeDb.state.reset()

    const memoryNotFound = await runNotFoundScenario(createMemoryAdapter())
    const sqliteNotFound = await runNotFoundScenario(createSQLiteAdapter())

    expect(sqliteNotFound.code).toBe(memoryNotFound.code)
    expect(sqliteNotFound.pending).toBe(memoryNotFound.pending)
    expect(sqliteNotFound.envelope).not.toBeNull()
    expect(memoryNotFound.envelope).not.toBeNull()
    expect(typeof sqliteNotFound.envelope.requestId).toBe('string')
    expect(typeof memoryNotFound.envelope.requestId).toBe('string')
  })
})
