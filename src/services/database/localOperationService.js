import { getActivePinia } from 'pinia'

import { useCashStore } from '@/stores/cashStore'
import { useCloudSessionStore } from '@/stores/cloudSessionStore'
import { useProductStore } from '@/stores/productStore'
import { useTransactionStore } from '@/stores/transactionStore'

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
      category: 'Penjualan',
      note: `Penjualan ${productStore.getProductById(productId)?.name ?? ''}`.trim(),
    })

    if (result?.success) {
      recorded.push(result.movement?.id ?? null)
    }
  }

  return recorded
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

  return {
    journal,
    commitRetailSale,
    settleLaundryOrder,
    recoverPendingOperations,
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
