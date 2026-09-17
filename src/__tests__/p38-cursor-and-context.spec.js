// src/__tests__/p38-cursor-and-context.spec.js
//
// P38: pull cursor durability / deterministic replay, pending-outbox
// protection, and business context isolation.

import { describe, it, expect, beforeEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

import { createMemoryAdapter } from '@/services/database/memoryAdapter'
import { createSyncQueueService } from '@/services/sync/syncQueueService'
import { createSyncIdentityRegistry } from '@/services/sync/syncIdentityRegistry'
import { createSyncPullService } from '@/services/sync/syncPullService'
import { createSyncPushService } from '@/services/sync/syncPushService'
import { SYNC_ENTITY_TYPES } from '@/services/sync/syncConstants'
import { useCashStore } from '@/stores/cashStore'
import { useProductStore } from '@/stores/productStore'
import { useTransactionStore } from '@/stores/transactionStore'

const BUSINESS_ID = 4242
const OUTLET_ID = 77
const DEVICE_ID = '123e4567-e89b-12d3-a456-426614174000'
const CASH_SYNC_ID = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa'

function makeContext(overrides = {}) {
  return {
    user: { id: 1 },
    selectedBusiness: { id: BUSINESS_ID },
    selectedOutlet: { id: OUTLET_ID },
    cloudAccess: true,
    deviceIdentifier: DEVICE_ID,
    registeredDeviceId: '999',
    ...overrides,
  }
}

function cashRecord(syncId = CASH_SYNC_ID, sequence = 1) {
  return {
    entity: 'cash_ledger',
    sync_sequence: sequence,
    data: {
      sync_id: syncId,
      sync_version: 1,
      type: 'in',
      amount: 50000,
      category: 'Penjualan Cash',
      note: 'INV-P38',
      reference_id: 'sale-p38-1',
      occurred_at: '2026-09-17T10:00:00.000Z',
    },
  }
}

function pullResponse(records, nextCursor = 10) {
  return {
    ok: true,
    status: 200,
    data: {
      data: {
        records,
        next_cursor: nextCursor,
        server_sequence: nextCursor,
        has_more: false,
      },
    },
  }
}

async function createRuntime({ pullTransport } = {}) {
  const pinia = createPinia()
  setActivePinia(pinia)

  const baseAdapter = createMemoryAdapter()
  await baseAdapter.initialize()

  let cursorSaveFailures = 0
  const adapter = new Proxy(baseAdapter, {
    get(target, prop) {
      if (prop === 'saveSyncPullState') {
        return async (state) => {
          if (cursorSaveFailures > 0) {
            cursorSaveFailures -= 1
            throw new Error('SIMULATED_CURSOR_SAVE_FAILURE')
          }
          return target.saveSyncPullState(state)
        }
      }

      const value = target[prop]
      return typeof value === 'function' ? value.bind(target) : value
    },
  })

  await adapter.saveSyncPushBinding({ businessId: BUSINESS_ID, boundAt: new Date().toISOString() })
  await adapter.saveSyncPullBinding({
    businessId: BUSINESS_ID,
    outletId: OUTLET_ID,
    deviceIdentifier: DEVICE_ID,
    registeredDeviceId: '999',
    boundAt: new Date().toISOString(),
  })
  await adapter.saveSyncPullState({ version: 1, cursor: 0, serverSequence: 0 })

  const queueService = createSyncQueueService({ adapter, scheduler: null })
  const registry = createSyncIdentityRegistry({ adapter, scheduler: null })

  const cashStore = useCashStore(pinia)
  const productStore = useProductStore(pinia)
  const transactionStore = useTransactionStore(pinia)
  cashStore.entries = []
  productStore.products = []
  productStore.categories = []
  productStore.stockMovements = []
  transactionStore.items = []

  const pullService = createSyncPullService({
    adapter,
    queueService,
    registry,
    pinia,
    tokenFetcher: async () => 'test-token',
    transport: pullTransport,
  })

  return {
    pinia,
    adapter,
    queueService,
    registry,
    pullService,
    cashStore,
    productStore,
    transactionStore,
    armCursorFailure(count = 1) {
      cursorSaveFailures = count
    },
  }
}

describe('P38 pull cursor durability and replay', () => {
  let transportImpl

  beforeEach(() => {
    transportImpl = async () => pullResponse([cashRecord()])
  })

  it('replays idempotently when the cursor save fails and advances afterwards', async () => {
    const runtime = await createRuntime({
      pullTransport: () => transportImpl(),
    })
    runtime.armCursorFailure(1)

    const first = await runtime.pullService.pullNow({ context: makeContext() })
    expect(first.ok).toBe(false)
    expect(first.code).toBe('SYNC_PULL_CURSOR_PERSIST_FAILED')

    // Records were applied, but the durable cursor must not pretend the batch
    // is complete.
    expect(runtime.cashStore.entries).toHaveLength(1)
    const stateAfterFailure = await runtime.adapter.loadSyncPullState()
    expect(Number(stateAfterFailure.cursor)).toBe(0)

    // Restart the pull service over the same durable storage and pull again:
    // the same record replays and resolves by sync_id, never duplicating.
    const replayService = createSyncPullService({
      adapter: runtime.adapter,
      queueService: runtime.queueService,
      registry: runtime.registry,
      pinia: runtime.pinia,
      tokenFetcher: async () => 'test-token',
      transport: () => transportImpl(),
    })

    const second = await replayService.pullNow({ context: makeContext() })
    expect(second.ok).toBe(true)

    expect(runtime.cashStore.entries).toHaveLength(1)
    expect(runtime.cashStore.balance).toBe(50000)

    const stateAfterReplay = await runtime.adapter.loadSyncPullState()
    expect(Number(stateAfterReplay.cursor)).toBe(10)
  })

  it('never advances the cursor past a batch blocked by a pending local mutation', async () => {
    const runtime = await createRuntime({ pullTransport: () => transportImpl() })

    // A local cash mutation for the same entity is still pending in the outbox.
    await runtime.queueService.enqueueUpsert(SYNC_ENTITY_TYPES.CASH_ENTRY, 'cash-local-p38', {
      id: 'cash-local-p38',
      type: 'in',
      amount: 12000,
      referenceId: 'sale-local-p38',
      createdAt: '2026-09-17T11:00:00.000Z',
    })

    const syncId = await runtime.registry.resolveSyncId(
      SYNC_ENTITY_TYPES.CASH_ENTRY,
      'cash-local-p38',
    )

    transportImpl = async () => pullResponse([cashRecord(syncId, 5)])

    const result = await runtime.pullService.pullNow({ context: makeContext() })
    expect(result.ok).toBe(false)
    expect(result.code).toBe('LOCAL_PENDING_SYNC_CONFLICT')

    // The remote change is not applied over the pending local mutation, and
    // the cursor stays put so the batch can be replayed deterministically.
    expect(runtime.cashStore.entries).toHaveLength(0)
    expect((await runtime.adapter.listSyncQueueItems()).length).toBeGreaterThan(0)
    const state = await runtime.adapter.loadSyncPullState()
    expect(Number(state.cursor)).toBe(0)
  })
})

describe('P38 context isolation', () => {
  it('refuses to push a business A outbox as business B', async () => {
    let transportCalls = 0
    const transport = async () => {
      transportCalls += 1
      return { ok: true, status: 200, data: { data: { request_id: 'x', duplicate: false } } }
    }

    const runtime = await createRuntime({ pullTransport: async () => pullResponse([]) })
    await runtime.queueService.enqueueUpsert(SYNC_ENTITY_TYPES.CUSTOMER, 'cust-p38', {
      id: 'cust-p38',
      name: 'Pelanggan A',
    })

    const pushService = createSyncPushService({
      adapter: runtime.adapter,
      queueService: runtime.queueService,
      registry: runtime.registry,
      tokenFetcher: async () => 'test-token',
      transport,
      cloudStore: null,
    })

    const result = await pushService.pushNow({
      context: makeContext({ selectedBusiness: { id: 999999 } }),
    })

    expect(result.ok).toBe(false)
    expect(result.code).toBe('SYNC_BUSINESS_BINDING_MISMATCH')
    // Nothing left the device and the queue was preserved.
    expect(transportCalls).toBe(0)
    expect((await runtime.adapter.listSyncQueueItems()).length).toBeGreaterThan(0)
  })

  it('refuses to pull another business cursor/context', async () => {
    const runtime = await createRuntime({ pullTransport: async () => pullResponse([]) })

    const result = await runtime.pullService.pullNow({
      context: makeContext({ selectedBusiness: { id: 5555 } }),
    })

    expect(result.ok).toBe(false)
    expect(result.code).toBe('SYNC_BUSINESS_BINDING_MISMATCH')
  })
})
