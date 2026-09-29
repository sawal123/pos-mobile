import { getActivePinia } from 'pinia'

import { useCashStore } from '@/stores/cashStore'
import { useCloudSessionStore } from '@/stores/cloudSessionStore'
import { useProductStore } from '@/stores/productStore'
import { useTransactionStore } from '@/stores/transactionStore'

import { SYNC_ENTITY_TYPES } from '@/services/sync/syncConstants'

import { createOperationJournal } from './operationJournalService'

export const LOCAL_OPERATION_TYPES = {
  RETAIL_SALE: 'retail_sale',
  LAUNDRY_SETTLEMENT: 'laundry_settlement',
}

export const LOCAL_OPERATION_PHASES = {
  JOURNAL_SAVED: 'journal_saved',
  TRANSACTION_APPLIED: 'transaction_applied',
  STOCK_APPLIED: 'stock_applied',
  CASH_APPLIED: 'cash_applied',
}

export const LOCAL_OPERATION_RECOVERY_STATUSES = {
  RECOVERED: 'recovered',
  CONTEXT_MISMATCH: 'context_mismatch',
}

export function createOperationId() {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID()
  }

  return `op-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

function cloneValue(value) {
  if (value === undefined || value === null) {
    return value
  }

  return JSON.parse(JSON.stringify(value))
}

/**
 * Applies any stock movement still missing for a committed sale, exactly once.
 *
 * Stock is derived from the transaction itself, and each movement is keyed by
 * the sale reference, so a crash between the transaction and the movement (or
 * a double recovery pass) can never deduct twice.
 */
export function applySaleStockIdempotently(productStore, transaction) {
  const expected = new Map()

  for (const item of transaction?.items ?? []) {
    const product = productStore.getProductById(item.id)
    if (!product || (product.kind ?? 'product') === 'service') {
      continue
    }

    const key = String(product.id)
    expected.set(key, (expected.get(key) ?? 0) + Number(item.qty ?? 0))
  }

  if (expected.size === 0) {
    return []
  }

  const applied = new Map()
  for (const movement of productStore.stockMovements ?? []) {
    if (String(movement.referenceId ?? '') !== String(transaction.id)) continue
    if (movement.type !== 'sale') continue

    const key = String(movement.productId)
    applied.set(key, (applied.get(key) ?? 0) + Math.abs(Number(movement.quantityChange) || 0))
  }

  const recorded = []
  for (const [productId, quantity] of expected) {
    const missing = quantity - (applied.get(productId) ?? 0)
    if (missing <= 0) {
      continue
    }

    const result = productStore.adjustStock(productId, {
      quantityChange: -missing,
      type: 'sale',
      referenceId: transaction.id,
      // The backend requires the sale relation for a cashier. `contractMapper`
      // only derives `sale_sync_id` from `transactionId`, so it must be carried
      // explicitly (never inferred from the human `referenceId`).
      transactionId: transaction.id,
      category: 'Penjualan',
      note: `Penjualan ${productStore.getProductById(productId)?.name ?? ''}`.trim(),
    })

    if (result?.success) {
      recorded.push(result.movement?.id ?? null)
    }
  }

  return recorded
}

const LEGACY_QUEUE_SCAN_LIMIT = 5000

function isSaleStockMovement(movement) {
  const type = movement?.movementType ?? movement?.type
  return type != null && String(type).trim().toLowerCase() === 'sale'
}

function hasSaleRelation(movement) {
  const transactionId = movement?.transactionId
  return transactionId !== null && transactionId !== undefined && String(transactionId).trim() !== ''
}

/**
 * Deterministically resolves the sale id a legacy stock movement belongs to.
 *
 * Only an exact `movement.referenceId === transaction.id` match is accepted —
 * never the human note, the amount or the timestamp. Returns null when the
 * relation cannot be proven locally.
 */
function resolveLegacySaleId(movement, transactionStore) {
  const referenceId = movement?.referenceId
  if (referenceId === null || referenceId === undefined || String(referenceId).trim() === '') {
    return null
  }

  const ref = String(referenceId).trim()
  const transaction = (transactionStore?.items ?? []).find((item) => String(item.id) === ref)

  return transaction ? String(transaction.id) : null
}

/**
 * Repairs the missing sale relation (`transactionId`) of stock movements that
 * were created before the cashier fix, so the backend no longer rejects them
 * with `missing_sale_relation`.
 *
 * Safety rules:
 * - never creates a replacement movement and never touches stock;
 * - never changes an existing movement id (in place repair only);
 * - only repairs a movement whose relation is provable by an exact id match;
 * - never modifies a queue snapshot that may already have been accepted by the
 *   server — any queue row referenced by the in-flight envelope is skipped;
 * - ambiguous movements are left untouched and reported for manual recovery.
 *
 * @param {object} params
 * @param {object} params.adapter
 * @param {object} [params.scheduler]
 * @param {object} params.productStore
 * @param {object} params.transactionStore
 * @returns {Promise<{repairedMovementIds: string[], repairedQueueIds: string[], skippedInflightQueueIds: string[], manualRecoveryRequiredIds: string[]}>}
 */
export async function repairLegacySaleStockMovementLinks({
  adapter = null,
  scheduler = null,
  productStore = null,
  transactionStore = null,
} = {}) {
  const report = {
    repairedMovementIds: [],
    repairedQueueIds: [],
    skippedInflightQueueIds: [],
    manualRecoveryRequiredIds: [],
  }

  if (!adapter || !productStore || !transactionStore) {
    return report
  }

  const movements = Array.isArray(productStore.stockMovements) ? productStore.stockMovements : []
  const candidates = movements.filter(
    (movement) => isSaleStockMovement(movement) && !hasSaleRelation(movement),
  )

  if (candidates.length === 0) {
    return report
  }

  const runSerialized = async (task) => {
    if (scheduler && typeof scheduler.runSerialized === 'function') {
      return scheduler.runSerialized(task, 'legacy:repair-sale-stock')
    }
    return task()
  }

  const inflight =
    typeof adapter.loadSyncPushInflight === 'function' ? await adapter.loadSyncPushInflight() : null
  const protectedQueueIds = new Set()
  for (const snapshot of [
    ...(Array.isArray(inflight?.queueSnapshots) ? inflight.queueSnapshots : []),
    ...(Array.isArray(inflight?.supersededSnapshots) ? inflight.supersededSnapshots : []),
  ]) {
    if (snapshot?.id) protectedQueueIds.add(snapshot.id)
  }

  const queueItems =
    typeof adapter.listSyncQueueItems === 'function'
      ? await adapter.listSyncQueueItems({ limit: LEGACY_QUEUE_SCAN_LIMIT })
      : []

  for (const movement of candidates) {
    const saleId = resolveLegacySaleId(movement, transactionStore)
    if (!saleId) {
      // The relation cannot be proven: keep the data untouched for manual recovery.
      report.manualRecoveryRequiredIds.push(movement.id)
      continue
    }

    // In-place repair: same movement id, stock untouched.
    movement.transactionId = saleId
    report.repairedMovementIds.push(movement.id)

    const queueRow = queueItems.find(
      (item) =>
        item.entityType === SYNC_ENTITY_TYPES.STOCK_MOVEMENT &&
        String(item.entityId) === String(movement.id),
    )
    if (!queueRow) continue

    if (protectedQueueIds.has(queueRow.id)) {
      // The envelope may already have reached the server: never rewrite its snapshot.
      report.skippedInflightQueueIds.push(queueRow.id)
      continue
    }

    await runSerialized(() =>
      adapter.upsertSyncQueueItem({
        ...queueRow,
        payload: { ...(queueRow.payload ?? {}), transactionId: saleId },
        attemptCount: 0,
        lastError: null,
        updatedAt: new Date().toISOString(),
      }),
    )
    report.repairedQueueIds.push(queueRow.id)
  }

  return report
}

export function createLocalOperationService({ adapter = null, scheduler = null, pinia = null } = {}) {
  const journal = createOperationJournal({ adapter })

  function activePinia() {
    return pinia ?? getActivePinia()
  }

  async function flush() {
    if (scheduler && typeof scheduler.flush === 'function') {
      await scheduler.flush()
    }
  }

  function resolveContext() {
    const active = activePinia()
    const cloudStore = active ? useCloudSessionStore(active) : null
    const businessId = cloudStore?.selectedBusiness?.id ?? null
    const outletId = cloudStore?.selectedOutlet?.id ?? null

    return {
      businessId,
      outletId,
      contextKey: businessId != null ? `business:${businessId}` : 'local',
    }
  }

  /**
   * Commits a retail (cash or non-cash) sale as one durable logical operation.
   *
   * The order is fixed by design: durable journal -> transaction -> stock
   * movements -> cash ledger -> journal cleared. A crash at any boundary is
   * recovered idempotently, so the operation is never applied twice and never
   * left half-applied.
   */
  async function commitRetailSale({ checkout, operationId = createOperationId() }) {
    const active = activePinia()
    const transactionStore = useTransactionStore(active)
    const productStore = useProductStore(active)
    const cashStore = useCashStore(active)
    const context = resolveContext()

    await journal.begin({
      operationId,
      operationType: LOCAL_OPERATION_TYPES.RETAIL_SALE,
      phase: LOCAL_OPERATION_PHASES.JOURNAL_SAVED,
      contextKey: context.contextKey,
      businessId: context.businessId,
      outletId: context.outletId,
      payload: { checkout: cloneValue(checkout) },
    })

    const transaction = transactionStore.createTransaction({
      ...checkout,
      id: operationId,
    })

    await journal.recordPhase(operationId, LOCAL_OPERATION_PHASES.TRANSACTION_APPLIED, {
      transactionId: transaction.id,
    })
    await flush()

    applySaleStockIdempotently(productStore, transaction)
    await journal.recordPhase(operationId, LOCAL_OPERATION_PHASES.STOCK_APPLIED)
    await flush()

    cashStore.recordSalePayment(transaction)
    await journal.recordPhase(operationId, LOCAL_OPERATION_PHASES.CASH_APPLIED)
    await flush()

    await journal.commit(operationId)

    return transaction
  }

  /**
   * Commits a laundry settlement (payment of an existing unpaid order) as one
   * durable logical operation.
   */
  async function settleLaundryOrder({
    orderId,
    paymentMethod = 'cash',
    cashReceived = null,
    changeAmount = null,
    operationId = createOperationId(),
  }) {
    const active = activePinia()
    const transactionStore = useTransactionStore(active)
    const cashStore = useCashStore(active)
    const context = resolveContext()

    await journal.begin({
      operationId,
      operationType: LOCAL_OPERATION_TYPES.LAUNDRY_SETTLEMENT,
      phase: LOCAL_OPERATION_PHASES.JOURNAL_SAVED,
      contextKey: context.contextKey,
      businessId: context.businessId,
      outletId: context.outletId,
      payload: { orderId, paymentMethod, cashReceived, changeAmount },
    })

    const result = transactionStore.settleLaundryOrderPayment({
      orderId,
      paymentMethod,
      cashReceived,
      changeAmount,
      cashStore,
    })

    if (!result?.success) {
      // The settlement never happened: drop the journal so the next attempt
      // starts clean instead of replaying a rejected operation forever.
      await journal.commit(operationId)
      return result
    }

    await journal.recordPhase(operationId, LOCAL_OPERATION_PHASES.CASH_APPLIED)
    await flush()
    await journal.commit(operationId)

    return result
  }

  async function recoverRetailSale(entry) {
    const active = activePinia()
    const transactionStore = useTransactionStore(active)
    const productStore = useProductStore(active)
    const cashStore = useCashStore(active)

    let transaction = transactionStore.items.find(
      (item) => String(item.id) === String(entry.operationId),
    )

    if (!transaction) {
      transaction = transactionStore.createTransaction({
        ...(entry.payload?.checkout ?? {}),
        id: entry.operationId,
      })
      await flush()
    }

    applySaleStockIdempotently(productStore, transaction)
    await flush()

    cashStore.recordSalePayment(transaction)
    await flush()

    return transaction
  }

  async function recoverLaundrySettlement(entry) {
    const active = activePinia()
    const transactionStore = useTransactionStore(active)
    const cashStore = useCashStore(active)
    const payload = entry.payload ?? {}

    const order = transactionStore.items.find((item) => String(item.id) === String(payload.orderId))
    if (!order) {
      return null
    }

    const result = transactionStore.settleLaundryOrderPayment({
      orderId: payload.orderId,
      paymentMethod: payload.paymentMethod ?? 'cash',
      cashReceived: payload.cashReceived ?? null,
      changeAmount: payload.changeAmount ?? null,
      cashStore,
    })

    await flush()

    return result
  }

  /**
   * Idempotent restart recovery for every pending journal entry.
   *
   * Entries belonging to another business/outlet context are never applied:
   * they stay durable and are reported as a context mismatch instead.
   */
  async function recoverPendingOperations() {
    const pending = await journal.listPending()
    const results = []

    for (const entry of pending) {
      const context = resolveContext()

      if (entry.contextKey && entry.contextKey !== context.contextKey) {
        results.push({
          operationId: entry.operationId,
          operationType: entry.operationType,
          status: LOCAL_OPERATION_RECOVERY_STATUSES.CONTEXT_MISMATCH,
        })
        continue
      }

      await journal.markAttempt(entry.operationId)

      if (entry.operationType === LOCAL_OPERATION_TYPES.RETAIL_SALE) {
        await recoverRetailSale(entry)
      } else if (entry.operationType === LOCAL_OPERATION_TYPES.LAUNDRY_SETTLEMENT) {
        await recoverLaundrySettlement(entry)
      }

      await flush()
      await journal.commit(entry.operationId)

      results.push({
        operationId: entry.operationId,
        operationType: entry.operationType,
        status: LOCAL_OPERATION_RECOVERY_STATUSES.RECOVERED,
      })
    }

    return results
  }

  async function repairLegacySaleStockMovementLinksNow() {
    const active = activePinia()
    const productStore = active ? useProductStore(active) : null
    const transactionStore = active ? useTransactionStore(active) : null

    return repairLegacySaleStockMovementLinks({
      adapter,
      scheduler,
      productStore,
      transactionStore,
    })
  }

  return {
    journal,
    commitRetailSale,
    settleLaundryOrder,
    recoverPendingOperations,
    repairLegacySaleStockMovementLinks: repairLegacySaleStockMovementLinksNow,
    resolveContext,
  }
}

let activeLocalOperationService = null
const fallbackServices = new WeakMap()

export function setActiveLocalOperationService(service) {
  activeLocalOperationService = service
}

export function getActiveLocalOperationService() {
  return activeLocalOperationService
}

/**
 * Resolves the active local operation service. Before bootstrap wires the
 * durable one (or in isolated tests) a service without a journal is created
 * for the active Pinia so the POS commit path keeps working.
 */
export function resolveLocalOperationService(pinia = null) {
  if (activeLocalOperationService) {
    return activeLocalOperationService
  }

  const active = pinia ?? getActivePinia()
  if (!active) {
    return createLocalOperationService({})
  }

  if (!fallbackServices.has(active)) {
    fallbackServices.set(active, createLocalOperationService({ pinia: active }))
  }

  return fallbackServices.get(active)
}
