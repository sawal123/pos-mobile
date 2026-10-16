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
 * - in-flight protection is evaluated BEFORE any store mutation: a queue
 *   snapshot referenced by the in-flight envelope is never rewritten and the
 *   store movement is left untouched (deferred recovery);
 * - never creates a replacement movement and never touches stock;
 * - never changes an existing movement id (in place repair only);
 * - only repairs a movement whose relation is provable by an exact id match;
 * - the queue payload is persisted BEFORE the store is mutated, so a queue
 *   write failure can never leave the store looking repaired;
 * - the item scan ceiling is sized from the real queue count, and a truncated
 *   scan never treats a missing row as "already repaired" (it defers);
 * - ambiguous movements are left untouched and reported for manual recovery.
 *
 * @param {object} params
 * @param {object} params.adapter
 * @param {object} [params.scheduler]
 * @param {object} params.productStore
 * @param {object} params.transactionStore
 * @returns {Promise<{
 *   repairedMovementIds: string[],
 *   repairedQueueIds: string[],
 *   deferredMovementIds: string[],
 *   deferredQueueIds: string[],
 *   failedMovementIds: string[],
 *   failedQueueIds: string[],
 *   manualRecoveryRequiredIds: string[],
 * }>}
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
    deferredMovementIds: [],
    deferredQueueIds: [],
    failedMovementIds: [],
    failedQueueIds: [],
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

  // Size the scan from the real queue count so the 5.000-item ceiling can never
  // hide a row. If the count is unavailable and the scan returns a full page, a
  // missing row is ambiguous and must be deferred, never recorded as repaired.
  const totalQueue =
    typeof adapter.countSyncQueueItems === 'function' ? await adapter.countSyncQueueItems() : null
  const hasTotal = typeof totalQueue === 'number' && Number.isFinite(totalQueue)
  const queueLimit = hasTotal ? Math.max(totalQueue, 1) : LEGACY_QUEUE_SCAN_LIMIT

  const queueItems =
    typeof adapter.listSyncQueueItems === 'function'
      ? await adapter.listSyncQueueItems({ limit: queueLimit })
      : []

  const queueScanTruncated =
    typeof adapter.listSyncQueueItems === 'function' &&
    queueItems.length >= queueLimit &&
    (!hasTotal || queueItems.length < totalQueue)

  const findQueueRow = (movementId) =>
    queueItems.find(
      (item) =>
        item.entityType === SYNC_ENTITY_TYPES.STOCK_MOVEMENT &&
        String(item.entityId) === String(movementId),
    )

  for (const movement of candidates) {
    const saleId = resolveLegacySaleId(movement, transactionStore)
    if (!saleId) {
      // The relation cannot be proven: keep the data untouched for manual recovery.
      report.manualRecoveryRequiredIds.push(movement.id)
      continue
    }

    const queueRow = findQueueRow(movement.id)

    // 1. In-flight protection is checked BEFORE touching the store: a snapshot
    //    that may already have reached the server is never rewritten, and the
    //    movement is left untouched too (deferred recovery).
    if (queueRow && protectedQueueIds.has(queueRow.id)) {
      report.deferredMovementIds.push(movement.id)
      report.deferredQueueIds.push(queueRow.id)
      continue
    }

    // 2. A missing row is only "no queue row" when the scan was exhaustive.
    if (!queueRow && queueScanTruncated) {
      report.deferredMovementIds.push(movement.id)
      continue
    }

    // 3. Persist the queue payload FIRST. On failure the store is not mutated,
    //    so a later retry / restart can still repair it safely.
    if (queueRow) {
      try {
        await runSerialized(() =>
          adapter.upsertSyncQueueItem({
            ...queueRow,
            payload: { ...(queueRow.payload ?? {}), transactionId: saleId },
            attemptCount: 0,
            lastError: null,
            updatedAt: new Date().toISOString(),
          }),
        )
      } catch {
        report.failedMovementIds.push(movement.id)
        report.failedQueueIds.push(queueRow.id)
        continue
      }

      report.repairedQueueIds.push(queueRow.id)
    }

    // 4. In-place store repair: same movement id, stock untouched.
    movement.transactionId = saleId
    report.repairedMovementIds.push(movement.id)
  }

  return report
}

export function createLocalOperationService({ adapter = null, scheduler = null, pinia = null } = {}) {
  const journal = createOperationJournal({ adapter })

  /**
   * In-flight sale commits by operation identity. A second call with the same
   * `operationId` (double-submit, retried transport) shares the first commit
   * instead of starting a parallel one.
   */
  const inFlightOperations = new Map()

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
   * Resumes the checkout the caller is retrying — and ONLY that one.
   *
   * Identity must be *proven* by the exact `operationId` the caller is retrying
   * with. A pending operation that merely shares the business context is a
   * different checkout and is never treated as this one. Every step is
   * idempotent, so resuming twice — or after the operation already completed —
   * never duplicates a transaction, a stock deduction or a cash entry.
   *
   * @param {string|null} operationId The checkout's stable operation identity.
   * @returns {Promise<object|null>} The resumed transaction, or null.
   */
  async function resumePendingRetailSale(operationId) {
    if (!operationId) {
      return null
    }

    const pending = await journal.listPending()
    const context = resolveContext()

    const entry = pending.find(
      (item) =>
        item.operationType === LOCAL_OPERATION_TYPES.RETAIL_SALE &&
        String(item.operationId) === String(operationId) &&
        // A pending operation from another business context is never resumed
        // here; it belongs to its own recovery path.
        (!item.contextKey || item.contextKey === context.contextKey),
    )

    if (!entry) {
      return null
    }

    await journal.markAttempt(entry.operationId)
    const transaction = await recoverRetailSale(entry)
    await flush()
    await journal.commit(entry.operationId)

    return transaction
  }

  /**
   * A pending retail sale for the current context that is NOT the operation the
   * caller asked for (the exact-identity resume already ran and found nothing).
   *
   * Its identity is unproven for this checkout, so it must never be returned as
   * this checkout's result — and its local state cannot be assumed consistent.
   * The caller fails closed until it is resolved.
   *
   * @returns {Promise<object|null>}
   */
  async function findUnresolvedPendingRetailSale() {
    const pending = await journal.listPending()
    const context = resolveContext()

    return (
      pending.find(
        (item) =>
          item.operationType === LOCAL_OPERATION_TYPES.RETAIL_SALE &&
          (!item.contextKey || item.contextKey === context.contextKey),
      ) ?? null
    )
  }

  /**
   * Commits a retail (cash or non-cash) sale as ONE durable logical operation,
   * identified by the caller's stable `operationId`.
   *
   * The returned transaction always refers to the checkout the caller asked for:
   * a retry of the same operation resumes it, an already-committed operation is
   * replayed, and an unrelated pending operation fails closed instead of being
   * returned as this checkout's result. Concurrent calls with the same identity
   * share one commit.
   *
   * @param {object} options
   * @param {object} options.checkout
   * @param {string} [options.operationId] Stable identity for this checkout.
   * @returns {Promise<object>} The committed transaction.
   */
  function commitRetailSale({ checkout, operationId = createOperationId() }) {
    const key = String(operationId)
    const inFlight = inFlightOperations.get(key)

    if (inFlight) {
      // Another call with the same identity is already committing: share it so a
      // double-submit can never produce a second transaction.
      return inFlight
    }

    const run = commitRetailSaleOnce({ checkout, operationId }).finally(() => {
      inFlightOperations.delete(key)
    })

    inFlightOperations.set(key, run)
    return run
  }

  async function commitRetailSaleOnce({ checkout, operationId }) {
    const active = activePinia()
    const transactionStore = useTransactionStore(active)
    const productStore = useProductStore(active)
    const cashStore = useCashStore(active)
    const context = resolveContext()

    // 1. Retry of the SAME checkout. Identity is proven by the exact operationId
    //    the caller supplied; a pending operation that merely shares the business
    //    context is a different checkout. A pending entry means the operation is
    //    INCOMPLETE (transaction/stock/cash may be partially applied), so it must
    //    be resumed before anything else can replay it.
    const resumed = await resumePendingRetailSale(operationId)
    if (resumed) {
      return resumed
    }

    // 2. Idempotency by operationId: with no pending entry, an existing
    //    transaction with this identity means the operation already completed
    //    (e.g. a caller retried after a transport/UI hiccup). Replay it — never
    //    create a second one.
    const alreadyCommitted = transactionStore.items.find(
      (item) => String(item.id) === String(operationId),
    )
    if (alreadyCommitted) {
      return alreadyCommitted
    }

    // 3. An unrelated pending sale for this context cannot be resolved from here:
    //    its identity is unproven for this checkout and its local state may be
    //    half-applied. Fail closed — never return the wrong transaction, never
    //    report a false success — and require the pending operation to be
    //    resolved (its own retry identity, or the startup recovery pass) first.
    const unresolved = await findUnresolvedPendingRetailSale()
    if (unresolved) {
      const error = new Error(
        'Masih ada transaksi yang belum selesai pada konteks ini. Selesaikan atau periksa operasi tertunda tersebut sebelum melakukan pembayaran baru.',
      )
      error.code = 'PENDING_OPERATION_UNRESOLVED'
      error.pendingOperationId = unresolved.operationId
      throw error
    }

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
    resumePendingRetailSale,
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
