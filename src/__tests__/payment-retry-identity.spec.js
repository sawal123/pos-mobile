/**
 * Payment retry identity safety.
 *
 * A checkout is a durable operation identified by a STABLE `operationId`. Sharing
 * a business context is never proof that two payments are the same operation, so
 * these tests lock in:
 *
 *  - only the exact operation identity may be resumed (retry of the same checkout);
 *  - an unrelated pending operation is never returned as a new checkout's result,
 *    and cannot be silently ignored either (fail closed);
 *  - an already-committed operation replays instead of creating a second one;
 *  - concurrent submits with the same identity share one commit;
 *  - no duplicate transaction, stock movement or cash entry, ever.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

import { createMemoryAdapter } from '@/services/database/memoryAdapter'
import { createPersistenceService } from '@/services/database/persistenceService'
import {
  LOCAL_OPERATION_TYPES,
  createLocalOperationService,
} from '@/services/database/localOperationService'
import { useCashStore } from '@/stores/cashStore'
import { useProductStore } from '@/stores/productStore'
import { useTransactionStore } from '@/stores/transactionStore'

async function makeRuntime() {
  const pinia = createPinia()
  setActivePinia(pinia)

  const adapter = createMemoryAdapter()
  await adapter.initialize()

  const scheduler = createPersistenceService({ adapter, pinia })
  await scheduler.initialize()

  const productStore = useProductStore(pinia)
  productStore.createCategory('Minuman')
  const created = productStore.createProduct({
    name: 'Es Kopi Susu',
    category: 'Minuman',
    price: 22000,
    stock: 20,
    isActive: true,
  })

  const localOperations = createLocalOperationService({ adapter, scheduler, pinia })
  await scheduler.flush()

  return {
    pinia,
    adapter,
    scheduler,
    productStore,
    product: created.product,
    localOperations,
    transactionStore: useTransactionStore(pinia),
    cashStore: useCashStore(pinia),
  }
}

function makeCheckout(product, overrides = {}) {
  return {
    items: [{ ...product, qty: 1 }],
    subtotal: 22000,
    tax: 0,
    taxEnabled: false,
    taxRate: 0,
    total: 22000,
    businessSnapshot: { name: 'Demo', outlet: 'Outlet Utama', phone: '' },
    customer: 'Walk-in Customer',
    customerId: null,
    customerSnapshot: null,
    paymentMethod: 'cash',
    cashReceived: 22000,
    changeAmount: 0,
    orderStatus: null,
    ...overrides,
  }
}

async function seedPendingSale(
  adapter,
  { operationId, checkout, contextKey = 'local', phase = 'journal_saved', artifacts = {} },
) {
  await adapter.saveLocalOperationJournal({
    version: 1,
    entries: [
      {
        operationId,
        operationType: LOCAL_OPERATION_TYPES.RETAIL_SALE,
        phase,
        status: 'pending',
        contextKey,
        payload: { checkout },
        artifacts,
        attempts: 0,
      },
    ],
  })
}

function saleMovements(productStore, operationId) {
  return productStore.stockMovements.filter(
    (movement) => movement.type === 'sale' && movement.transactionId === operationId,
  )
}

beforeEach(() => {
  vi.restoreAllMocks()
})

// ════════════════════════════════════════════════════════════════════════════
// 1 + 4. An unrelated pending operation is never this checkout's result
// ════════════════════════════════════════════════════════════════════════════

describe('1. a pending transaction is never returned for a different checkout', () => {
  it('fails closed instead of answering a new checkout with pending A', async () => {
    const runtime = await makeRuntime()
    const checkoutA = makeCheckout(runtime.product)
    await seedPendingSale(runtime.adapter, { operationId: 'op-A', checkout: checkoutA })
    await runtime.scheduler.flush()

    const before = runtime.transactionStore.items.length

    await expect(
      runtime.localOperations.commitRetailSale({
        checkout: makeCheckout(runtime.product),
        operationId: 'op-B',
      }),
    ).rejects.toMatchObject({ code: 'PENDING_OPERATION_UNRESOLVED' })

    // A was not returned as B, B was not recorded, nothing was duplicated.
    expect(runtime.transactionStore.items).toHaveLength(before)
    expect(runtime.transactionStore.items.find((t) => t.id === 'op-A')).toBeUndefined()
    expect(runtime.transactionStore.items.find((t) => t.id === 'op-B')).toBeUndefined()
    expect(runtime.cashStore.entries).toHaveLength(0)

    const pending = (await runtime.adapter.loadLocalOperationJournal())?.entries ?? []
    expect(pending.map((entry) => entry.operationId)).toEqual(['op-A'])
  })
})

describe('4. a pending operation from another business context is never used', () => {
  it('does not resume or block on another context and leaves it pending', async () => {
    const runtime = await makeRuntime()
    await seedPendingSale(runtime.adapter, {
      operationId: 'op-other-business',
      checkout: makeCheckout(runtime.product),
      contextKey: 'business:99',
    })
    await runtime.scheduler.flush()

    const before = runtime.transactionStore.items.length

    const sale = await runtime.localOperations.commitRetailSale({
      checkout: makeCheckout(runtime.product),
      operationId: 'op-here',
    })
    await runtime.scheduler.flush()

    // This checkout produced its OWN transaction with its own identity.
    expect(sale.id).toBe('op-here')
    expect(runtime.transactionStore.items).toHaveLength(before + 1)
    expect(runtime.transactionStore.items.find((t) => t.id === 'op-here')).toBeTruthy()
    expect(runtime.transactionStore.items.find((t) => t.id === 'op-other-business')).toBeUndefined()

    // The foreign pending operation is untouched.
    const pending = (await runtime.adapter.loadLocalOperationJournal())?.entries ?? []
    expect(pending.map((entry) => entry.operationId)).toEqual(['op-other-business'])
  })
})

// ════════════════════════════════════════════════════════════════════════════
// 2 + 5 + 6. Retry of the SAME operation stays idempotent
// ════════════════════════════════════════════════════════════════════════════

describe('2. retrying the same operationId is idempotent', () => {
  it('resumes the pending operation and never duplicates transaction, stock or cash', async () => {
    const runtime = await makeRuntime()
    const checkout = makeCheckout(runtime.product)
    await seedPendingSale(runtime.adapter, {
      operationId: 'op-retry',
      checkout,
      phase: 'transaction_applied',
    })
    await runtime.scheduler.flush()

    const before = runtime.transactionStore.items.length

    const first = await runtime.localOperations.commitRetailSale({
      checkout,
      operationId: 'op-retry',
    })
    await runtime.scheduler.flush()
    // A repeated retry (journal already cleared) must replay, not re-create.
    const second = await runtime.localOperations.commitRetailSale({
      checkout,
      operationId: 'op-retry',
    })
    await runtime.scheduler.flush()

    expect(first.id).toBe('op-retry')
    expect(second.id).toBe('op-retry')
    expect(runtime.transactionStore.items).toHaveLength(before + 1)
    expect(runtime.transactionStore.items.filter((t) => t.id === 'op-retry')).toHaveLength(1)
    expect(saleMovements(runtime.productStore, 'op-retry')).toHaveLength(1)
    expect(runtime.cashStore.entries).toHaveLength(1)
    expect((await runtime.adapter.loadLocalOperationJournal())?.entries ?? []).toEqual([])
  })
})

describe('5. a recovered operation does not double-apply stock or cash', () => {
  it('is idempotent when the crash happened after the stock phase', async () => {
    const runtime = await makeRuntime()
    const checkout = makeCheckout(runtime.product)
    const operationId = 'op-after-stock'

    // The transaction AND its stock movement were already applied durably.
    const transaction = runtime.transactionStore.createTransaction({ ...checkout, id: operationId })
    runtime.productStore.adjustStock(runtime.product.id, {
      quantityChange: -1,
      type: 'sale',
      referenceId: transaction.id,
      transactionId: transaction.id,
      category: 'Penjualan',
      note: 'partial',
    })
    await runtime.scheduler.flush()

    const stockAfterPartial = runtime.productStore.getProductById(runtime.product.id).stock
    await seedPendingSale(runtime.adapter, {
      operationId,
      checkout,
      phase: 'stock_applied',
    })
    await runtime.scheduler.flush()

    await runtime.localOperations.commitRetailSale({ checkout, operationId })
    await runtime.scheduler.flush()

    const stockAfterRecovery = runtime.productStore.getProductById(runtime.product.id).stock
    expect(stockAfterRecovery).toBe(stockAfterPartial)
    expect(saleMovements(runtime.productStore, operationId)).toHaveLength(1)
    // Cash is posted exactly once (idempotent by the sale reference).
    expect(runtime.cashStore.entries).toHaveLength(1)
    expect(runtime.transactionStore.items.filter((t) => t.id === operationId)).toHaveLength(1)
  })
})

describe('6. a failure after the transaction write is recoverable', () => {
  it('completes stock and cash on retry with the same identity', async () => {
    const runtime = await makeRuntime()
    const checkout = makeCheckout(runtime.product)
    const operationId = 'op-partial'

    // Transaction written durably, stock + cash not yet applied.
    runtime.transactionStore.createTransaction({ ...checkout, id: operationId })
    await runtime.scheduler.flush()
    await seedPendingSale(runtime.adapter, {
      operationId,
      checkout,
      phase: 'transaction_applied',
    })
    await runtime.scheduler.flush()

    const stockBefore = runtime.productStore.getProductById(runtime.product.id).stock
    expect(saleMovements(runtime.productStore, operationId)).toHaveLength(0)
    expect(runtime.cashStore.entries).toHaveLength(0)

    await runtime.localOperations.commitRetailSale({ checkout, operationId })
    await runtime.scheduler.flush()

    expect(saleMovements(runtime.productStore, operationId)).toHaveLength(1)
    expect(runtime.productStore.getProductById(runtime.product.id).stock).toBe(stockBefore - 1)
    expect(runtime.cashStore.entries).toHaveLength(1)
    expect(runtime.transactionStore.items.filter((t) => t.id === operationId)).toHaveLength(1)
    expect((await runtime.adapter.loadLocalOperationJournal())?.entries ?? []).toEqual([])
  })
})

// ════════════════════════════════════════════════════════════════════════════
// 3. Two identical checkouts are two legitimate transactions
// ════════════════════════════════════════════════════════════════════════════

describe('3. identical checkouts stay two distinct transactions', () => {
  it('never deduplicates by amount or product list', async () => {
    const runtime = await makeRuntime()
    const before = runtime.transactionStore.items.length

    const first = await runtime.localOperations.commitRetailSale({
      checkout: makeCheckout(runtime.product),
      operationId: 'op-1',
    })
    const second = await runtime.localOperations.commitRetailSale({
      checkout: makeCheckout(runtime.product),
      operationId: 'op-2',
    })
    await runtime.scheduler.flush()

    expect(first.id).toBe('op-1')
    expect(second.id).toBe('op-2')
    expect(runtime.transactionStore.items).toHaveLength(before + 2)
    expect(saleMovements(runtime.productStore, 'op-1')).toHaveLength(1)
    expect(saleMovements(runtime.productStore, 'op-2')).toHaveLength(1)
    expect(runtime.cashStore.entries).toHaveLength(2)
  })
})

// ════════════════════════════════════════════════════════════════════════════
// 7. A failing recovery is never a false success
// ════════════════════════════════════════════════════════════════════════════

describe('7. a failing recovery never reports success', () => {
  it('rejects when the resume cannot finish durably', async () => {
    const runtime = await makeRuntime()
    const checkout = makeCheckout(runtime.product)
    const operationId = 'op-failing-recovery'
    await seedPendingSale(runtime.adapter, {
      operationId,
      checkout,
      phase: 'transaction_applied',
    })
    await runtime.scheduler.flush()

    const failingAdapter = Object.assign({}, runtime.adapter, {
      saveLocalOperationJournal: () => {
        throw new Error('journal write failed')
      },
    })
    const failingService = createLocalOperationService({
      adapter: failingAdapter,
      scheduler: runtime.scheduler,
      pinia: runtime.pinia,
    })

    await expect(
      failingService.commitRetailSale({ checkout, operationId }),
    ).rejects.toThrow()

    // The unfinished operation is still pending — nothing claims success.
    expect(
      (await runtime.adapter.loadLocalOperationJournal())?.entries.map((e) => e.operationId),
    ).toEqual([operationId])
  })
})

// ════════════════════════════════════════════════════════════════════════════
// 8. Double submit
// ════════════════════════════════════════════════════════════════════════════

describe('8. a double submit creates exactly one transaction', () => {
  it('shares a single commit for the same operation identity', async () => {
    const runtime = await makeRuntime()
    const checkout = makeCheckout(runtime.product)
    const before = runtime.transactionStore.items.length

    const [a, b] = await Promise.all([
      runtime.localOperations.commitRetailSale({ checkout, operationId: 'op-double' }),
      runtime.localOperations.commitRetailSale({ checkout, operationId: 'op-double' }),
    ])
    await runtime.scheduler.flush()

    expect(a.id).toBe('op-double')
    expect(b.id).toBe('op-double')
    expect(runtime.transactionStore.items).toHaveLength(before + 1)
    expect(saleMovements(runtime.productStore, 'op-double')).toHaveLength(1)
    expect(runtime.cashStore.entries).toHaveLength(1)

    // A sequential repeat is also a replay, not a second sale.
    const replay = await runtime.localOperations.commitRetailSale({
      checkout,
      operationId: 'op-double',
    })
    await runtime.scheduler.flush()

    expect(replay.id).toBe('op-double')
    expect(runtime.transactionStore.items).toHaveLength(before + 1)
    expect(runtime.cashStore.entries).toHaveLength(1)
  })
})

// ════════════════════════════════════════════════════════════════════════════
// 9. The result refers to the requested checkout (PR #58 modal data)
// ════════════════════════════════════════════════════════════════════════════

describe('9. the returned transaction belongs to the requested checkout', () => {
  it('returns the new checkout (not a pending one) with its own totals', async () => {
    const runtime = await makeRuntime()
    const before = runtime.transactionStore.items.length

    const checkout = makeCheckout(runtime.product, { total: 44000, subtotal: 44000 })
    const sale = await runtime.localOperations.commitRetailSale({
      checkout,
      operationId: 'op-modal',
    })
    await runtime.scheduler.flush()

    expect(sale.id).toBe('op-modal')
    expect(sale.total).toBe(44000)
    expect(sale.invoiceNumber).toMatch(/^INV-/)
    expect(sale.cashReceived).toBe(22000)
    expect(runtime.transactionStore.items).toHaveLength(before + 1)
    // The identity the caller passed is the identity that was committed.
    expect(runtime.transactionStore.items[0].id).toBe('op-modal')
  })
})
