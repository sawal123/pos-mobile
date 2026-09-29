/**
 * FIX — Cashier sale stock movement transactionId & legacy recovery.
 *
 * A retail sale must link its stock movement to the sale through the canonical
 * `transactionId`, so `contractMapper` derives `sale_sync_id`. Without it a
 * cashier push is rejected by the backend (`missing_sale_relation`) or blocked
 * by the capability policy (`CASHIER_MANUAL_STOCK_DENIED`).
 */

import { describe, it, expect } from 'vitest'

import { createMemoryAdapter } from '@/services/database/memoryAdapter'
import { createLocalOperationService } from '@/services/database/localOperationService'
import { createSyncIdentityRegistry, isUuid } from '@/services/sync/syncIdentityRegistry'
import { mapOutboxEntries } from '@/services/sync/contractMapper'
import {
  classifyOutboxEntryForPolicy,
  resolveSyncPushPolicy,
} from '@/services/sync/syncCapabilityPolicy'
import { SYNC_ENTITY_TYPES, SYNC_OPERATIONS } from '@/services/sync/syncConstants'
import { useProductStore } from '@/stores/productStore'
import { useTransactionStore } from '@/stores/transactionStore'
import { useCashStore } from '@/stores/cashStore'
import {
  createRestartableScenario,
  restartAppScenario,
  setupBoundCloudState,
} from './helpers/syncRestartHarness'

const SIMULATED_CRASH = 'SIMULATED_PROCESS_DEATH'

/**
 * Test-only crash injection: simulates a process death immediately before or
 * after the Nth durable journal write.
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

async function buildCloudScenario({ fault = null, productStock = 20 } = {}) {
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

function makeLocalOperations(scenario) {
  return createLocalOperationService({
    adapter: scenario.adapter,
    scheduler: scenario.scheduler,
    pinia: scenario.pinia,
  })
}

async function removeQueuedMasterEntities(scenario) {
  const queue = await scenario.adapter.listSyncQueueItems({ limit: 5000 })
  for (const item of queue) {
    if (
      item.entityType === SYNC_ENTITY_TYPES.PRODUCT ||
      item.entityType === SYNC_ENTITY_TYPES.CATEGORY
    ) {
      await scenario.adapter.deleteSyncQueueItem(item.id)
    }
  }
}

// ════════════════════════════════════════════════════════════════════════════
// A. Normal retail sale
// ════════════════════════════════════════════════════════════════════════════

describe('FIX cashier sale stock movement — normal retail sale', () => {
  it('A. deducts stock once and links the single movement to the sale', async () => {
    const { scenario, runtime, product } = await buildCloudScenario({ productStock: 20 })
    const localOperations = makeLocalOperations(scenario)

    const sale = await localOperations.commitRetailSale({
      checkout: makeCheckout(product, { quantity: 2 }),
    })
    await scenario.scheduler.flush()

    const current = runtime.productStore.products.find((p) => p.id === product.id)
    expect(current.stock).toBe(18)

    const movements = runtime.productStore.stockMovements.filter((m) => m.type === 'sale')
    expect(movements).toHaveLength(1)
    expect(movements[0].transactionId).toBe(sale.id)
    expect(movements[0].referenceId).toBe(sale.id)

    const queue = await scenario.adapter.listSyncQueueItems({ limit: 5000 })
    const registry = createSyncIdentityRegistry({ adapter: scenario.adapter })
    const mapped = await mapOutboxEntries(queue, { registry, adapter: scenario.adapter })

    expect(mapped.changes.stock_movements).toHaveLength(1)
    const movementChange = mapped.changes.stock_movements[0]
    expect(isUuid(movementChange.sale_sync_id)).toBe(true)
    expect(movementChange.sale_sync_id).toBe(mapped.changes.sales[0].sync_id)

    await scenario.cleanup()
  })
})

// ════════════════════════════════════════════════════════════════════════════
// B. Cashier sync
// ════════════════════════════════════════════════════════════════════════════

describe('FIX cashier sale stock movement — cashier sync', () => {
  it('B. pushes the sale movement with a correct sale_sync_id and no product mutation', async () => {
    const { scenario, runtime, product } = await buildCloudScenario({ productStock: 20 })
    const localOperations = makeLocalOperations(scenario)

    // The product is already known on the server (pulled), so it must not be a
    // local push candidate for a cashier.
    await removeQueuedMasterEntities(scenario)

    const sale = await localOperations.commitRetailSale({
      checkout: makeCheckout(product, { quantity: 2 }),
    })
    await scenario.scheduler.flush()

    const queue = await scenario.adapter.listSyncQueueItems({ limit: 5000 })
    const registry = createSyncIdentityRegistry({ adapter: scenario.adapter })
    const mapped = await mapOutboxEntries(queue, { registry, adapter: scenario.adapter })

    const movementChange = mapped.changes.stock_movements[0]
    expect(isUuid(movementChange.sale_sync_id)).toBe(true)
    expect(movementChange.sale_sync_id).toBe(mapped.changes.sales[0].sync_id)
    expect(movementChange.movement_type).toBe('sale')
    expect(mapped.changes.products).toHaveLength(0)

    // Capability policy: the sale movement is allowed (no missing relation),
    // while product mutations stay restricted for a cashier.
    const cashierPolicy = resolveSyncPushPolicy({ role: 'cashier' })
    const movement = runtime.productStore.stockMovements.find(
      (m) => m.type === 'sale' && m.productId === product.id,
    )
    expect(
      classifyOutboxEntryForPolicy(
        {
          entityType: SYNC_ENTITY_TYPES.STOCK_MOVEMENT,
          operation: SYNC_OPERATIONS.UPSERT,
          payload: movement,
        },
        cashierPolicy,
      ).action,
    ).toBe('allow')

    expect(
      classifyOutboxEntryForPolicy(
        {
          entityType: SYNC_ENTITY_TYPES.PRODUCT,
          operation: SYNC_OPERATIONS.UPSERT,
          payload: { id: product.id, name: product.name },
        },
        cashierPolicy,
      ).action,
    ).toBe('restrict')

    expect(sale.id).toBeTruthy()
    await scenario.cleanup()
  })
})

// ════════════════════════════════════════════════════════════════════════════
// C. Negative stock
// ════════════════════════════════════════════════════════════════════════════

describe('FIX cashier sale stock movement — negative stock', () => {
  it('C. allows negative stock with the sale relation and no double deduction', async () => {
    const { scenario, runtime, product } = await buildCloudScenario({ productStock: 1 })
    const localOperations = makeLocalOperations(scenario)

    const sale = await localOperations.commitRetailSale({
      checkout: makeCheckout(product, { quantity: 3 }),
    })
    await scenario.scheduler.flush()

    const current = runtime.productStore.products.find((p) => p.id === product.id)
    expect(current.stock).toBe(-2)

    const movements = runtime.productStore.stockMovements.filter((m) => m.type === 'sale')
    expect(movements).toHaveLength(1)
    expect(movements[0].quantityChange).toBe(-3)
    expect(movements[0].transactionId).toBe(sale.id)

    await scenario.cleanup()
  })
})

// ════════════════════════════════════════════════════════════════════════════
// D. Crash recovery
// ════════════════════════════════════════════════════════════════════════════

describe('FIX cashier sale stock movement — crash recovery', () => {
  it('D. recovers twice without duplicating the movement or the deduction', async () => {
    // Crash after the stock phase (journal write #3) was recorded.
    const { scenario, product } = await buildCloudScenario({
      fault: { index: 3, when: 'after' },
      productStock: 20,
    })

    const localOperations = makeLocalOperations(scenario)
    try {
      await localOperations.commitRetailSale({ checkout: makeCheckout(product, { quantity: 2 }) })
    } catch (error) {
      expect(error.message).toBe(SIMULATED_CRASH)
    }

    const restarted = await restartAppScenario(scenario, { online: false })
    const recoveredOps = createLocalOperationService({
      adapter: restarted.adapter,
      scheduler: restarted.scheduler,
      pinia: restarted.pinia,
    })

    // Run recovery twice — must stay idempotent.
    await recoveredOps.recoverPendingOperations()
    await recoveredOps.recoverPendingOperations()
    await restarted.scheduler.flush()

    const runtime = makeRuntime(restarted)
    const saleMovements = runtime.productStore.stockMovements.filter((m) => m.type === 'sale')
    expect(saleMovements).toHaveLength(1)
    expect(runtime.productStore.products.find((p) => p.id === product.id).stock).toBe(18)

    const sale = runtime.transactionStore.items[0]
    expect(sale).toBeTruthy()
    expect(saleMovements[0].transactionId).toBe(sale.id)

    await restarted.cleanup()
  })
})

// ════════════════════════════════════════════════════════════════════════════
// E. Legacy queue
// ════════════════════════════════════════════════════════════════════════════

describe('FIX cashier sale stock movement — legacy recovery', () => {
  async function buildLegacyState() {
    const { scenario, runtime, product } = await buildCloudScenario({ productStock: 20 })
    const sale = runtime.transactionStore.createTransaction(
      makeCheckout(product, { quantity: 2 }),
    )
    await scenario.scheduler.flush()

    // Legacy movement: relation only through referenceId, transactionId missing.
    const legacy = runtime.productStore.adjustStock(product.id, {
      quantityChange: -2,
      type: 'sale',
      referenceId: sale.id,
      category: 'Penjualan',
      note: 'legacy',
    })

    // Ambiguous movement: type sale but no provable local transaction.
    const ambiguous = runtime.productStore.adjustStock(product.id, {
      quantityChange: -1,
      type: 'sale',
      referenceId: 'missing-sale-id',
      category: 'Penjualan',
      note: 'legacy',
    })

    await scenario.scheduler.flush()

    return { scenario, runtime, product, sale, legacy, ambiguous }
  }

  it('E. repairs a provable relation in place and leaves ambiguous movements untouched', async () => {
    const { scenario, runtime, product, sale, legacy, ambiguous } = await buildLegacyState()
    const localOperations = makeLocalOperations(scenario)

    const stockBefore = runtime.productStore.products.find((p) => p.id === product.id).stock
    const legacyId = legacy.movement.id
    const ambiguousId = ambiguous.movement.id

    const report = await localOperations.repairLegacySaleStockMovementLinks()
    await scenario.scheduler.flush()

    // Only the provable movement is repaired; the ambiguous one is reported.
    expect(report.repairedMovementIds).toContain(legacyId)
    expect(report.manualRecoveryRequiredIds).toContain(ambiguousId)
    expect(report.repairedMovementIds).not.toContain(ambiguousId)

    // Same movement id, same stock — no replacement, no second deduction.
    const repaired = runtime.productStore.stockMovements.find((m) => m.id === legacyId)
    expect(repaired.id).toBe(legacyId)
    expect(repaired.transactionId).toBe(sale.id)
    expect(runtime.productStore.products.find((p) => p.id === product.id).stock).toBe(stockBefore)

    // Ambiguous movement is never modified.
    const untouched = runtime.productStore.stockMovements.find((m) => m.id === ambiguousId)
    expect(untouched.transactionId ?? null).toBe(null)

    // The durable queue payload now carries the canonical transactionId.
    const queue = await scenario.adapter.listSyncQueueItems({ limit: 5000 })
    const legacyRow = queue.find(
      (q) => q.entityType === SYNC_ENTITY_TYPES.STOCK_MOVEMENT && q.entityId === legacyId,
    )
    expect(legacyRow.payload.transactionId).toBe(sale.id)

    const ambiguousRow = queue.find(
      (q) => q.entityType === SYNC_ENTITY_TYPES.STOCK_MOVEMENT && q.entityId === ambiguousId,
    )
    expect(ambiguousRow.payload.transactionId ?? null).toBe(null)
    expect(ambiguousRow.payload.id).toBe(ambiguousId)

    await scenario.cleanup()
  })

  it('E. never rewrites a queue snapshot referenced by an in-flight envelope', async () => {
    const { scenario, runtime, legacy } = await buildLegacyState()
    const localOperations = makeLocalOperations(scenario)

    const queueBefore = await scenario.adapter.listSyncQueueItems({ limit: 5000 })
    const legacyRow = queueBefore.find(
      (q) => q.entityType === SYNC_ENTITY_TYPES.STOCK_MOVEMENT && q.entityId === legacy.movement.id,
    )

    // Simulate an envelope that may already have reached the server.
    await scenario.adapter.saveSyncPushInflight({
      version: 1,
      requestId: 'req-inflight-legacy',
      queueSnapshots: [{ id: legacyRow.id }],
    })

    const report = await localOperations.repairLegacySaleStockMovementLinks()

    expect(report.skippedInflightQueueIds).toContain(legacyRow.id)
    const queueAfter = await scenario.adapter.listSyncQueueItems({ limit: 5000 })
    const untouchedRow = queueAfter.find((q) => q.id === legacyRow.id)
    expect(untouchedRow.payload.transactionId ?? null).toBe(null)

    await scenario.cleanup()
  })
})

// ════════════════════════════════════════════════════════════════════════════
// F. Backward compatibility
// ════════════════════════════════════════════════════════════════════════════

describe('FIX cashier sale stock movement — backward compatibility', () => {
  it('F. owners and members keep full push access to the sale movement', async () => {
    const ownerPolicy = resolveSyncPushPolicy({ role: 'owner' })
    const memberPolicy = resolveSyncPushPolicy({ role: 'member' })

    const movementEntry = {
      entityType: SYNC_ENTITY_TYPES.STOCK_MOVEMENT,
      operation: SYNC_OPERATIONS.UPSERT,
      payload: { id: 'm-1', type: 'sale', quantityChange: -2, transactionId: 'sale-1' },
    }

    expect(ownerPolicy.pushMode).toBe('full')
    expect(memberPolicy.pushMode).toBe('full')
    expect(classifyOutboxEntryForPolicy(movementEntry, ownerPolicy).action).toBe('allow')
    expect(classifyOutboxEntryForPolicy(movementEntry, memberPolicy).action).toBe('allow')
  })

  it('F. service products create no stock movement and adjustments stay link-free', async () => {
    const { scenario, runtime, product } = await buildCloudScenario({ productStock: 20 })
    const localOperations = makeLocalOperations(scenario)

    await runtime.productStore.createCategory('Layanan')
    const createdService = await runtime.productStore.createProduct({
      name: 'Cuci Kering',
      category: 'Layanan',
      price: 5000,
      kind: 'service',
      stock: 0,
    })
    await scenario.scheduler.flush()

    expect(createdService.success).toBe(true)
    await localOperations.commitRetailSale({
      checkout: makeCheckout(createdService.product, { quantity: 1 }),
    })
    await scenario.scheduler.flush()

    const serviceMovements = runtime.productStore.stockMovements.filter(
      (m) => m.productId === createdService.product.id,
    )
    expect(serviceMovements).toHaveLength(0)

    // A normal adjustment is never forced to carry a sale relation and is never
    // touched by the legacy repair.
    const adjustment = runtime.productStore.adjustStock(product.id, {
      quantityChange: 5,
      type: 'adjustment',
      category: 'Adjustment',
    })
    await scenario.scheduler.flush()

    expect(adjustment.movement.transactionId ?? null).toBe(null)

    const report = await localOperations.repairLegacySaleStockMovementLinks()
    expect(report.repairedMovementIds).not.toContain(adjustment.movement.id)
    expect(report.manualRecoveryRequiredIds).not.toContain(adjustment.movement.id)

    await scenario.cleanup()
  })
})
