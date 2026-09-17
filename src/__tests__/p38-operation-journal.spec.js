// src/__tests__/p38-operation-journal.spec.js
//
// P38: durable local operation journal, crash-window recovery, and Free mode.

import { describe, it, expect, beforeEach, vi } from 'vitest'

import { createLocalOperationService } from '@/services/database/localOperationService'
import { createMemoryAdapter } from '@/services/database/memoryAdapter'
import { OPERATION_JOURNAL_VERSION } from '@/services/database/operationJournalService'
import { useCashStore } from '@/stores/cashStore'
import { useProductStore } from '@/stores/productStore'
import { useTransactionStore } from '@/stores/transactionStore'
import {
  createRestartableScenario,
  restartAppScenario,
  setupBoundCloudState,
} from './helpers/syncRestartHarness'

vi.mock('@/services/cloud/apiClient', () => ({
  apiRequest: async () => ({ ok: false, status: 500, error: 'offline' }),
}))

const SIMULATED_CRASH = 'SIMULATED_PROCESS_DEATH'

/**
 * Test-only crash injection. Wraps the durable adapter and simulates a process
 * death immediately before or after the Nth journal write, so every phase
 * boundary of an operation can be interrupted for real.
 */
function createCrashInjectingAdapter(base, fault = null) {
  let journalWrites = 0
  let armed = Boolean(fault)

  return new Proxy(base, {
    get(target, prop) {
      if (prop === 'saveLocalOperationJournal') {
        return async (journal) => {
          journalWrites += 1
          const index = journalWrites

          if (armed && fault.index === index && fault.when === 'before') {
            armed = false
            throw new Error(SIMULATED_CRASH)
          }

          await target.saveLocalOperationJournal(journal)

          if (armed && fault.index === index && fault.when === 'after') {
            armed = false
            throw new Error(SIMULATED_CRASH)
          }
        }
      }

      const value = target[prop]
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
}

function makeRuntime(scenario) {
  return {
    productStore: useProductStore(scenario.pinia),
    transactionStore: useTransactionStore(scenario.pinia),
    cashStore: useCashStore(scenario.pinia),
  }
}

async function buildCloudScenario({ fault = null, productStock = 10 } = {}) {
  const adapter = createCrashInjectingAdapter(createMemoryAdapter(), fault)

  const scenario = await createRestartableScenario({
    businessMode: 'cloud',
    initialOnline: false,
    adapter,
  })

  await setupBoundCloudState(scenario)

  const runtime = makeRuntime(scenario)
  await runtime.productStore.createCategory('Minuman')
  const created = await runtime.productStore.createProduct({
    name: 'Kopi Latte',
    category: 'Minuman',
    price: 20000,
    cost: 8000,
    stock: productStock,
  })

  await scenario.scheduler.flush()

  return { scenario, runtime, product: created.product }
}

function makeCheckout(product, { quantity = 2, paymentMethod = 'cash' } = {}) {
  const subtotal = Number(product.price) * quantity

  return {
    items: [
      {
        id: product.id,
        name: product.name,
        price: Number(product.price),
        qty: quantity,
        hppSnapshot: Number(product.cost),
      },
    ],
    subtotal,
    tax: 0,
    total: subtotal,
    customer: 'Walk-in Customer',
    customerId: null,
    customerSnapshot: null,
    paymentMethod,
    cashReceived: paymentMethod === 'cash' ? subtotal : null,
    changeAmount: paymentMethod === 'cash' ? 0 : null,
    orderStatus: null,
  }
}

async function recoverAfterRestart(scenario) {
  const restarted = await restartAppScenario(scenario, { online: false })
  const localOperations = createLocalOperationService({
    adapter: restarted.adapter,
    scheduler: restarted.scheduler,
    pinia: restarted.pinia,
  })

  const results = await localOperations.recoverPendingOperations()

  return { restarted, localOperations, results }
}

async function pendingJournalEntries(adapter) {
  const state = await adapter.loadLocalOperationJournal()
  return state?.entries ?? []
}

describe('P38 local operation journal and crash recovery', () => {
  beforeEach(() => {
    vi.useRealTimers()
  })

  it('commits a retail cash sale as one logical operation and clears the journal', async () => {
    const { scenario, runtime, product } = await buildCloudScenario()

    const localOperations = createLocalOperationService({
      adapter: scenario.adapter,
      scheduler: scenario.scheduler,
      pinia: scenario.pinia,
    })

    await localOperations.commitRetailSale({ checkout: makeCheckout(product) })
    await scenario.scheduler.flush()

    expect(runtime.transactionStore.items).toHaveLength(1)
    expect(runtime.cashStore.entries).toHaveLength(1)
    expect(runtime.cashStore.entries[0].amount).toBe(40000)
    expect(runtime.productStore.stockMovements).toHaveLength(1)
    expect(runtime.productStore.products.find((p) => p.id === product.id).stock).toBe(8)
    expect(await pendingJournalEntries(scenario.adapter)).toHaveLength(0)

    await scenario.cleanup()
  })

  it('records a durable pending journal entry before the first mutation', async () => {
    const { scenario, runtime, product } = await buildCloudScenario({
      fault: { index: 1, when: 'after' },
    })

    const localOperations = createLocalOperationService({
      adapter: scenario.adapter,
      scheduler: scenario.scheduler,
      pinia: scenario.pinia,
    })

    await expect(
      localOperations.commitRetailSale({ checkout: makeCheckout(product) }),
    ).rejects.toThrow(SIMULATED_CRASH)

    // Journal durably saved, domain untouched: nothing half-applied.
    const entries = await pendingJournalEntries(scenario.adapter)
    expect(entries).toHaveLength(1)
    expect(entries[0].status).toBe('pending')
    expect(entries[0].operationType).toBe('retail_sale')

    runtime.transactionStore.items = []
    await scenario.cleanup()
  })

  it('recovers a retail cash sale interrupted at every phase to the exact normal-commit state', async () => {
    // Journal writes for a retail sale: 1 begin, 2 transaction, 3 stock,
    // 4 cash, 5 commit.
    for (const phase of [1, 2, 3, 4, 5]) {
      const { scenario, product } = await buildCloudScenario({
        fault: { index: phase, when: 'after' },
      })

      const localOperations = createLocalOperationService({
        adapter: scenario.adapter,
        scheduler: scenario.scheduler,
        pinia: scenario.pinia,
      })

      try {
        await localOperations.commitRetailSale({ checkout: makeCheckout(product) })
      } catch (error) {
        expect(error.message).toBe(SIMULATED_CRASH)
      }

      const { restarted, results } = await recoverAfterRestart(scenario)

      expect(results.every((r) => r.status === 'recovered' || r.status === 'context_mismatch')).toBe(true)

      const runtime = makeRuntime(restarted)

      // Exactly one logical operation, whichever phase was interrupted.
      expect(runtime.transactionStore.items).toHaveLength(1)
      expect(runtime.cashStore.entries).toHaveLength(1)
      expect(runtime.productStore.stockMovements).toHaveLength(1)
      expect(runtime.productStore.products.find((p) => p.id === product.id).stock).toBe(8)

      // Journal is cleared once every domain store is durable.
      expect(await pendingJournalEntries(restarted.adapter)).toHaveLength(0)

      await restarted.cleanup()
    }
  })

  it('recovers a retail non-cash sale with stock deducted and no physical cash', async () => {
    for (const phase of [1, 2, 3, 4, 5]) {
      const { scenario, product } = await buildCloudScenario({
        fault: { index: phase, when: 'after' },
      })

      const localOperations = createLocalOperationService({
        adapter: scenario.adapter,
        scheduler: scenario.scheduler,
        pinia: scenario.pinia,
      })

      try {
        await localOperations.commitRetailSale({
          checkout: makeCheckout(product, { paymentMethod: 'qris' }),
        })
      } catch {
        // simulated crash
      }

      const { restarted } = await recoverAfterRestart(scenario)
      const runtime = makeRuntime(restarted)

      expect(runtime.transactionStore.items).toHaveLength(1)
      expect(runtime.transactionStore.items[0].paymentMethod).toBe('qris')
      expect(runtime.productStore.stockMovements).toHaveLength(1)
      expect(runtime.productStore.products.find((p) => p.id === product.id).stock).toBe(8)
      expect(runtime.cashStore.entries).toHaveLength(0)

      await restarted.cleanup()
    }
  })

  it('recovers a laundry settlement to paid exactly once with one cash entry', async () => {
    for (const phase of [1, 2, 3]) {
      const { scenario, runtime, product } = await buildCloudScenario({
        fault: { index: phase, when: 'after' },
      })

      const order = runtime.transactionStore.createLaundryOrder({
        customer: 'Pelanggan',
        items: [{ id: product.id, name: product.name, price: 25000, qty: 1 }],
        subtotal: 25000,
        total: 25000,
        paymentStatus: 'unpaid',
        paymentMethod: '',
      })

      await scenario.scheduler.flush()

      const localOperations = createLocalOperationService({
        adapter: scenario.adapter,
        scheduler: scenario.scheduler,
        pinia: scenario.pinia,
      })

      try {
        await localOperations.settleLaundryOrder({
          orderId: order.id,
          paymentMethod: 'cash',
          cashReceived: 25000,
          changeAmount: 0,
        })
      } catch {
        // simulated crash
      }

      const { restarted } = await recoverAfterRestart(scenario)
      const recovered = makeRuntime(restarted)

      const settled = recovered.transactionStore.items.find((t) => t.id === order.id)
      expect(settled.paymentStatus).toBe('paid')
      expect(recovered.cashStore.entries).toHaveLength(1)
      expect(recovered.cashStore.entries[0].referenceId).toBe(`sale-${order.id}`)
      expect(recovered.cashStore.entries[0].amount).toBe(25000)

      await restarted.cleanup()
    }
  })

  it('keeps the outbox free of duplicate rows across crash recovery', async () => {
    const { scenario, product } = await buildCloudScenario({
      fault: { index: 3, when: 'after' },
    })

    const localOperations = createLocalOperationService({
      adapter: scenario.adapter,
      scheduler: scenario.scheduler,
      pinia: scenario.pinia,
    })

    try {
      await localOperations.commitRetailSale({ checkout: makeCheckout(product) })
    } catch {
      // simulated crash after stock was recorded
    }

    const { restarted } = await recoverAfterRestart(scenario)
    await restarted.scheduler.flush()

    const queue = await restarted.adapter.listSyncQueueItems()
    const keys = queue.map((item) => `${item.entityType}:${item.entityId}`)
    expect(new Set(keys).size).toBe(keys.length)

    const runtime = makeRuntime(restarted)
    expect(runtime.transactionStore.items).toHaveLength(1)
    expect(runtime.cashStore.entries).toHaveLength(1)

    await restarted.cleanup()
  })

  it('keeps local crash durability in Free mode without any cloud session', async () => {
    const adapter = createCrashInjectingAdapter(createMemoryAdapter(), { index: 2, when: 'after' })

    let scenario = await createRestartableScenario({
      businessMode: 'free',
      initialOnline: false,
      adapter,
    })

    const runtime = makeRuntime(scenario)
    await runtime.productStore.createCategory('Minuman')
    const created = await runtime.productStore.createProduct({
      name: 'Teh Manis',
      category: 'Minuman',
      price: 5000,
      stock: 10,
    })
    await scenario.scheduler.flush()

    const localOperations = createLocalOperationService({
      adapter: scenario.adapter,
      scheduler: scenario.scheduler,
      pinia: scenario.pinia,
    })

    try {
      await localOperations.commitRetailSale({
        checkout: makeCheckout(created.product, { quantity: 1 }),
      })
    } catch {
      // simulated crash
    }

    const { restarted, results } = await recoverAfterRestart(scenario)
    const recovered = makeRuntime(restarted)

    expect(results.some((r) => r.status === 'recovered')).toBe(true)
    expect(recovered.transactionStore.items).toHaveLength(1)
    expect(recovered.cashStore.entries).toHaveLength(1)
    expect(recovered.productStore.stockMovements).toHaveLength(1)
    expect(recovered.productStore.products.find((p) => p.id === created.product.id).stock).toBe(9)

    // Free mode never produces a cloud outbox.
    const queue = await restarted.adapter.listSyncQueueItems()
    expect(queue.filter((item) => item.entityType === 'transaction')).toHaveLength(0)

    await restarted.cleanup()
  })

  it('never applies a pending journal of another business context', async () => {
    const { scenario, product } = await buildCloudScenario({
      fault: { index: 2, when: 'after' },
    })

    const localOperations = createLocalOperationService({
      adapter: scenario.adapter,
      scheduler: scenario.scheduler,
      pinia: scenario.pinia,
    })

    try {
      await localOperations.commitRetailSale({ checkout: makeCheckout(product) })
    } catch {
      // simulated crash
    }

    const entries = await pendingJournalEntries(scenario.adapter)
    expect(entries).toHaveLength(1)
    expect(entries[0].contextKey).toMatch(/^business:/)

    // Simulate switching to a different business before recovery runs.
    scenario.cloudStore.selectedBusiness = { id: 999999, name: 'Business Lain' }

    const before = makeRuntime(scenario)
    const transactionsBefore = before.transactionStore.items.length
    const cashBefore = before.cashStore.entries.length
    const movementsBefore = before.productStore.stockMovements.length

    const results = await localOperations.recoverPendingOperations()

    expect(results[0].status).toBe('context_mismatch')
    // The journal stays durable and nothing leaked into the new context.
    expect(await pendingJournalEntries(scenario.adapter)).toHaveLength(1)

    const runtime = makeRuntime(scenario)
    expect(runtime.transactionStore.items).toHaveLength(transactionsBefore)
    expect(runtime.cashStore.entries).toHaveLength(cashBefore)
    expect(runtime.productStore.stockMovements).toHaveLength(movementsBefore)

    await scenario.cleanup()
  })

  it('exposes a stable journal version envelope', async () => {
    const { scenario } = await buildCloudScenario()
    await scenario.adapter.saveLocalOperationJournal({ version: OPERATION_JOURNAL_VERSION, entries: [] })
    const state = await scenario.adapter.loadLocalOperationJournal()
    expect(state.version).toBe(OPERATION_JOURNAL_VERSION)
    await scenario.cleanup()
  })
})
