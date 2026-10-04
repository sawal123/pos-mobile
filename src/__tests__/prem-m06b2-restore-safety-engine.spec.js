import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'

import { BACKUP_SCHEMA, BACKUP_VERSION, createBackupPayload } from '@/services/backupService'
import { _resetTokenStore, getToken, saveToken } from '@/services/cloud/tokenRepository'
import { createMemoryAdapter } from '@/services/database/memoryAdapter'
import { createPersistenceService } from '@/services/database/persistenceService'
import {
  RESTORE_JOURNAL_PHASE,
  RESTORE_MODE,
  RESTORE_RESULT_CODE,
  RESTORE_STAGE,
  computeRestoreChecksum,
  createRestoreSafetyEngine,
} from '@/services/restoreSafetyEngine'
import { SYNC_ENTITY_TYPES, SYNC_OPERATIONS } from '@/services/sync/syncConstants'
import { useBusinessStore } from '@/stores/businessStore'
import { useCashStore } from '@/stores/cashStore'
import { useCartStore } from '@/stores/cartStore'
import { useCustomerStore } from '@/stores/customerStore'
import { useExpenseStore } from '@/stores/expenseStore'
import { useProductStore } from '@/stores/productStore'
import { useShiftStore } from '@/stores/shiftStore'
import { useTaxStore } from '@/stores/taxStore'
import { useTransactionStore } from '@/stores/transactionStore'

const PRODUCT_SYNC_ID = '11111111-1111-4111-8111-111111111111'
const CATEGORY_SYNC_ID = '22222222-2222-4222-8222-222222222222'
const CUSTOMER_SYNC_ID = '33333333-3333-4333-8333-333333333333'
const TRANSACTION_SYNC_ID = '44444444-4444-4444-8444-444444444444'
const CASH_SYNC_ID = '55555555-5555-4555-8555-555555555555'
const STOCK_SYNC_ID = '66666666-6666-4666-8666-666666666666'

beforeEach(() => {
  _resetTokenStore()
})

async function createContext(adapter = createMemoryAdapter()) {
  const pinia = createPinia()
  setActivePinia(pinia)

  const service = createPersistenceService({ adapter, pinia })
  await service.initialize()

  const stores = {
    businessStore: useBusinessStore(pinia),
    taxStore: useTaxStore(pinia),
    productStore: useProductStore(pinia),
    customerStore: useCustomerStore(pinia),
    expenseStore: useExpenseStore(pinia),
    transactionStore: useTransactionStore(pinia),
    cashStore: useCashStore(pinia),
    cartStore: useCartStore(pinia),
    shiftStore: useShiftStore(pinia),
  }

  const engine = createRestoreSafetyEngine({ adapter, scheduler: service })
  return { adapter, service, stores, engine }
}

function seedCurrentStores(stores) {
  stores.businessStore.setBusiness({
    name: 'Toko Lama',
    type: 'Retail',
    owner: 'Pemilik Lama',
    phone: '080000000000',
    outlet: 'Lama',
    mode: 'cloud',
  })
  stores.taxStore.setSettings({ enabled: true, rate: 11 })
  stores.productStore.$patch({
    categories: ['Lama'],
    products: [
      {
        id: 'p-old',
        name: 'Produk Lama',
        category: 'Lama',
        price: 1000,
        stock: 9,
        imageData: '',
        isActive: true,
      },
    ],
    stockMovements: [
      {
        id: 'sm-old',
        productId: 'p-old',
        type: 'adjustment',
        quantityChange: 9,
        stockBefore: 0,
        stockAfter: 9,
        createdAt: '2026-10-01T01:00:00.000Z',
      },
    ],
  })
  stores.customerStore.$patch({
    customers: [{ id: 'c-old', name: 'Pelanggan Lama', phone: '0801', email: '' }],
  })
  stores.expenseStore.$patch({
    expenses: [
      {
        id: 'e-old',
        title: 'Biaya Lama',
        category: 'Operasional',
        amount: 1000,
        note: '',
        createdAt: '2026-10-01T02:00:00.000Z',
      },
    ],
  })
  stores.transactionStore.$patch({
    items: [
      {
        id: 'trx-old',
        invoiceNumber: 'INV-OLD',
        customer: 'Walk-in Customer',
        customerId: null,
        customerSnapshot: null,
        businessSnapshot: { name: 'Toko Lama', outlet: 'Lama', phone: '080000000000' },
        status: 'paid',
        orderStatus: null,
        paymentStatus: 'paid',
        items: [{ id: 'p-old', name: 'Produk Lama', price: 1000, qty: 1 }],
        itemCount: 1,
        subtotal: 1000,
        tax: 110,
        taxEnabled: true,
        taxRate: 11,
        total: 1110,
        grossProfit: 1000,
        paymentMethod: 'cash',
        cashReceived: 2000,
        changeAmount: 890,
        paidAt: '2026-10-01T03:00:00.000Z',
        createdAt: '2026-10-01T03:00:00.000Z',
        updatedAt: '2026-10-01T03:00:00.000Z',
      },
    ],
    lastTransaction: null,
  })
  stores.cashStore.$patch({
    entries: [
      {
        id: 'cash-old',
        type: 'in',
        amount: 1110,
        category: 'Penjualan',
        note: '',
        transactionId: 'trx-old',
        createdAt: '2026-10-01T03:00:00.000Z',
      },
    ],
  })
}

async function seedCurrentState(context) {
  seedCurrentStores(context.stores)
  await context.service.flush()
  await context.adapter.saveSyncIdentityMap({ 'product:p-old': PRODUCT_SYNC_ID })
  await context.adapter.saveSyncServerVersions({
    [`products:${PRODUCT_SYNC_ID}`]: { syncVersion: 1, syncSequence: 10 },
  })
}

function makeTargetBackup({ version = BACKUP_VERSION } = {}) {
  const payload = {
    schema: BACKUP_SCHEMA,
    version,
    exportedAt: '2026-10-04T10:00:00.000Z',
    data: {
      business: {
        name: 'Toko Target',
        type: 'Cafe',
        owner: 'Pemilik Target',
        phone: '081111111111',
        outlet: 'Pusat',
      },
      taxSettings: { enabled: false, rate: 11 },
      products: {
        categories: ['Target'],
        products: [
          {
            id: 'p-target',
            name: 'Produk Target',
            category: 'Target',
            price: 15000,
            stock: -3,
            isActive: true,
          },
        ],
      },
      stockMovements: [
        {
          id: 'sm-target',
          productId: 'p-target',
          type: 'sale',
          quantityChange: -5,
          stockBefore: 2,
          stockAfter: -3,
          transactionId: 'trx-target',
          createdAt: '2026-10-04T08:00:00.000Z',
        },
      ],
      cash: [
        {
          id: 'cash-target',
          type: 'in',
          amount: 15000,
          category: 'Penjualan',
          note: '',
          transactionId: 'trx-target',
          createdAt: '2026-10-04T08:00:00.000Z',
        },
      ],
      customers: [{ id: 'c-target', name: 'Pelanggan Target', phone: '0812', email: '' }],
      expenses: [],
      transactions: [
        {
          id: 'trx-target',
          invoiceNumber: 'INV-TARGET',
          customer: 'Pelanggan Target',
          customerId: 'c-target',
          customerSnapshot: {
            id: 'c-target',
            name: 'Pelanggan Target',
            phone: '0812',
            email: '',
          },
          businessSnapshot: { name: 'Toko Target', outlet: 'Pusat', phone: '081111111111' },
          status: 'paid',
          paymentStatus: 'paid',
          items: [{ id: 'p-target', name: 'Produk Target', price: 15000, qty: 1 }],
          itemCount: 1,
          subtotal: 15000,
          tax: 0,
          taxEnabled: false,
          taxRate: null,
          total: 15000,
          grossProfit: 5000,
          paymentMethod: 'cash',
          cashReceived: 15000,
          changeAmount: 0,
          paidAt: '2026-10-04T08:00:00.000Z',
          createdAt: '2026-10-04T08:00:00.000Z',
        },
      ],
    },
  }

  if (version === BACKUP_VERSION) {
    payload.syncMetadata = {
      version: 1,
      identityMap: {
        'category:Target': CATEGORY_SYNC_ID,
        'product:p-target': PRODUCT_SYNC_ID,
        'customer:c-target': CUSTOMER_SYNC_ID,
        'transaction:trx-target': TRANSACTION_SYNC_ID,
        'cash_entry:cash-target': CASH_SYNC_ID,
        'stock_movement:sm-target': STOCK_SYNC_ID,
      },
      serverVersions: {
        [`categories:${CATEGORY_SYNC_ID}`]: { syncVersion: 2, syncSequence: 20 },
        [`products:${PRODUCT_SYNC_ID}`]: { syncVersion: 9, syncSequence: 90 },
        [`customers:${CUSTOMER_SYNC_ID}`]: { syncVersion: 3, syncSequence: 30 },
        [`sales:${TRANSACTION_SYNC_ID}`]: { syncVersion: 4, syncSequence: 40 },
        [`cash_ledger:${CASH_SYNC_ID}`]: { syncVersion: 5, syncSequence: 50 },
        [`stock_movements:${STOCK_SYNC_ID}`]: { syncVersion: 6, syncSequence: 60 },
      },
    }
  }

  return payload
}

async function durableDomainSnapshot(adapter) {
  return {
    business: await adapter.loadBusiness(),
    tax: await adapter.loadTaxState(),
    products: await adapter.loadProducts(),
    customers: await adapter.loadCustomers(),
    expenses: await adapter.loadExpenses(),
    transactions: await adapter.loadTransactions(),
    cash: await adapter.loadCashState(),
    identityMap: await adapter.loadSyncIdentityMap(),
    serverVersions: await adapter.loadSyncServerVersions(),
    queueCount: await adapter.countSyncQueueItems(),
    inflight: await adapter.loadSyncPushInflight(),
  }
}

describe('PREM-M06B2 restore safety engine', () => {
  it('allows an idle same-device restore candidate and blocks ambiguous state', async () => {
    const context = await createContext()
    await seedCurrentState(context)

    await expect(
      context.engine.checkRestoreEligibility({
        payload: makeTargetBackup(),
        mode: RESTORE_MODE.SAME_DEVICE,
      }),
    ).resolves.toMatchObject({ eligible: true, code: RESTORE_RESULT_CODE.ELIGIBLE })

    await context.adapter.upsertSyncQueueItem({
      id: 'queue-1',
      entityType: SYNC_ENTITY_TYPES.PRODUCT,
      entityId: 'p-old',
      operation: SYNC_OPERATIONS.UPSERT,
      payload: { id: 'p-old' },
      createdAt: '2026-10-04T01:00:00.000Z',
      updatedAt: '2026-10-04T01:00:00.000Z',
    })
    await expect(
      context.engine.checkRestoreEligibility({ payload: makeTargetBackup() }),
    ).resolves.toMatchObject({ eligible: false, code: RESTORE_RESULT_CODE.PENDING_SYNC })
  })

  it('blocks in-flight sync, unresolved P38 journal, unresolved restore journal, invalid snapshot and cross-device legacy backup', async () => {
    for (const arrange of [
      async (ctx) => {
        await ctx.adapter.saveSyncPushInflight({ requestId: 'req-1' })
        return RESTORE_RESULT_CODE.IN_FLIGHT_SYNC
      },
      async (ctx) => {
        await ctx.adapter.saveLocalOperationJournal({
          version: 1,
          entries: [{ operationId: 'op-1', status: 'pending' }],
        })
        return RESTORE_RESULT_CODE.P38_JOURNAL_UNRESOLVED
      },
      async (ctx) => {
        await ctx.adapter.saveRestoreJournal({ version: 1, phase: RESTORE_JOURNAL_PHASE.APPLYING })
        return RESTORE_RESULT_CODE.RESTORE_JOURNAL_UNRESOLVED
      },
    ]) {
      const context = await createContext()
      await seedCurrentState(context)
      const expectedCode = await arrange(context)
      await expect(
        context.engine.checkRestoreEligibility({ payload: makeTargetBackup() }),
      ).resolves.toMatchObject({
        eligible: false,
        code: expectedCode,
      })
    }

    const context = await createContext()
    await seedCurrentState(context)
    await expect(
      context.engine.checkRestoreEligibility({ payload: { nope: true } }),
    ).resolves.toMatchObject({ eligible: false, code: RESTORE_RESULT_CODE.INVALID_SNAPSHOT })

    await expect(
      context.engine.checkRestoreEligibility({
        payload: makeTargetBackup({ version: 2 }),
        mode: RESTORE_MODE.CROSS_DEVICE,
      }),
    ).resolves.toMatchObject({ eligible: false, code: RESTORE_RESULT_CODE.CROSS_DEVICE_UNSAFE })

    await expect(
      context.engine.checkRestoreEligibility({
        payload: makeTargetBackup(),
        mode: RESTORE_MODE.CROSS_DEVICE,
      }),
    ).resolves.toMatchObject({ eligible: true, code: RESTORE_RESULT_CODE.ELIGIBLE })
  })

  it('requires explicit confirmation before destructive restore', async () => {
    const context = await createContext()
    await seedCurrentState(context)
    const before = await durableDomainSnapshot(context.adapter)

    const result = await context.engine.restore({ payload: makeTargetBackup(), confirmed: false })

    expect(result).toMatchObject({
      success: false,
      code: RESTORE_RESULT_CODE.CONFIRMATION_REQUIRED,
    })
    expect(await durableDomainSnapshot(context.adapter)).toEqual(before)
  })

  it('persists safety snapshot before mutation, writes journal phases, restores v3 metadata and preserves device/session/transport state', async () => {
    const context = await createContext()
    await seedCurrentState(context)
    await context.adapter.saveDeviceIdentifier('device-before')
    await context.adapter.saveCloudContext({ selectedBusinessId: 7, email: 'owner@example.com' })
    await context.adapter.savePendingSubscriptionPayment({
      paymentId: 'pay-before',
      status: 'pending',
    })
    await saveToken('token-before')

    const observedPhases = []
    const result = await context.engine.restore({
      payload: makeTargetBackup(),
      confirmed: true,
      failureInjection: async (stage) => {
        if (
          [
            RESTORE_STAGE.JOURNAL_PREPARED,
            RESTORE_STAGE.JOURNAL_APPLYING,
            RESTORE_STAGE.VERIFY,
            RESTORE_STAGE.JOURNAL_COMMITTED,
          ].includes(stage)
        ) {
          observedPhases.push((await context.adapter.loadRestoreJournal())?.phase)
        }
      },
    })

    expect(result).toMatchObject({ success: true, code: RESTORE_RESULT_CODE.OK })
    expect(observedPhases).toEqual([
      RESTORE_JOURNAL_PHASE.PREPARED,
      RESTORE_JOURNAL_PHASE.APPLYING,
      RESTORE_JOURNAL_PHASE.VERIFYING,
      RESTORE_JOURNAL_PHASE.COMMITTED,
    ])

    const after = await durableDomainSnapshot(context.adapter)
    expect(after.business).toMatchObject({ name: 'Toko Target', mode: 'cloud' })
    expect(after.products.products).toHaveLength(1)
    expect(after.products.products[0]).toMatchObject({ id: 'p-target', stock: -3 })
    expect(after.products.stockMovements[0]).toMatchObject({
      id: 'sm-target',
      stockBefore: 2,
      stockAfter: -3,
      quantityChange: -5,
    })
    expect(after.transactions[0].id).toBe('trx-target')
    expect(after.identityMap).toMatchObject({ 'product:p-target': PRODUCT_SYNC_ID })
    expect(after.serverVersions[`products:${PRODUCT_SYNC_ID}`]).toMatchObject({
      syncVersion: 9,
      syncSequence: 90,
    })
    expect(await context.adapter.loadDeviceIdentifier()).toBe('device-before')
    expect(await context.adapter.loadCloudContext()).toEqual({
      selectedBusinessId: 7,
      email: 'owner@example.com',
    })
    expect(await context.adapter.loadPendingSubscriptionPayment()).toEqual({
      paymentId: 'pay-before',
      status: 'pending',
    })
    expect(await getToken()).toBe('token-before')
    expect(after.queueCount).toBe(0)
    expect(after.inflight).toBe(null)
    expect(await context.adapter.loadRestoreJournal()).toBe(null)
  })

  it('keeps pending queue intact when eligibility blocks restore', async () => {
    const context = await createContext()
    await seedCurrentState(context)
    await context.adapter.upsertSyncQueueItem({
      id: 'queue-preserved',
      entityType: SYNC_ENTITY_TYPES.PRODUCT,
      entityId: 'p-old',
      operation: SYNC_OPERATIONS.UPSERT,
      payload: { id: 'p-old' },
      createdAt: '2026-10-04T01:00:00.000Z',
      updatedAt: '2026-10-04T01:00:00.000Z',
    })

    const result = await context.engine.restore({ payload: makeTargetBackup(), confirmed: true })

    expect(result.code).toBe(RESTORE_RESULT_CODE.PENDING_SYNC)
    expect(await context.adapter.countSyncQueueItems()).toBe(1)
  })

  it.each([
    RESTORE_STAGE.DOMAIN_APPLY,
    RESTORE_STAGE.IDENTITY_MAP_APPLY,
    RESTORE_STAGE.SERVER_VERSIONS_APPLY,
    RESTORE_STAGE.VERIFY,
  ])('rolls back exactly when %s fails after destructive apply starts', async (stage) => {
    const context = await createContext()
    await seedCurrentState(context)
    const before = await durableDomainSnapshot(context.adapter)

    const result = await context.engine.restore({
      payload: makeTargetBackup(),
      confirmed: true,
      failureInjection: { failAt: stage },
    })

    expect(result.success).toBe(false)
    expect([
      RESTORE_RESULT_CODE.APPLY_FAILED_ROLLED_BACK,
      RESTORE_RESULT_CODE.VERIFY_FAILED_ROLLED_BACK,
    ]).toContain(result.code)
    expect(await durableDomainSnapshot(context.adapter)).toEqual(before)
    expect(await context.adapter.loadRestoreJournal()).toBe(null)
  })

  it('marks recovery_required and keeps journal when rollback fails', async () => {
    const context = await createContext()
    await seedCurrentState(context)

    const result = await context.engine.restore({
      payload: makeTargetBackup(),
      confirmed: true,
      failureInjection: {
        failAt: [RESTORE_STAGE.DOMAIN_APPLY, RESTORE_STAGE.ROLLBACK_APPLY],
      },
    })

    expect(result).toMatchObject({
      success: false,
      code: RESTORE_RESULT_CODE.ROLLBACK_FAILED,
    })
    expect(await context.adapter.loadRestoreJournal()).toMatchObject({
      phase: RESTORE_JOURNAL_PHASE.RECOVERY_REQUIRED,
    })
  })

  it('recovers interrupted applying/verifying/rolling_back journals from durable safety snapshot', async () => {
    for (const phase of [
      RESTORE_JOURNAL_PHASE.APPLYING,
      RESTORE_JOURNAL_PHASE.VERIFYING,
      RESTORE_JOURNAL_PHASE.ROLLING_BACK,
    ]) {
      const context = await createContext()
      await seedCurrentState(context)
      const safetyPayload = createBackupPayload({
        ...context.stores,
        syncMetadata: {
          identityMap: await context.adapter.loadSyncIdentityMap(),
          serverVersions: await context.adapter.loadSyncServerVersions(),
        },
      })
      await context.engine.restore({ payload: makeTargetBackup(), confirmed: true })
      await context.adapter.saveRestoreJournal({
        version: 1,
        operationId: `restore-${phase}`,
        phase,
        safetyPayload,
        safetyChecksum: computeRestoreChecksum(safetyPayload),
        phaseHistory: [phase],
      })

      const next = await createContext(context.adapter)
      const recovery = await next.engine.recoverPendingRestore()

      expect(recovery.ok).toBe(true)
      expect((await next.adapter.loadBusiness()).name).toBe('Toko Lama')
      expect((await next.adapter.loadProducts()).products[0].id).toBe('p-old')
      expect(await next.adapter.loadRestoreJournal()).toBe(null)
    }
  })

  it('aborts prepared recovery without rollback and finalizes committed recovery without rollback', async () => {
    const prepared = await createContext()
    await seedCurrentState(prepared)
    await prepared.adapter.saveRestoreJournal({
      version: 1,
      operationId: 'restore-prepared',
      phase: RESTORE_JOURNAL_PHASE.PREPARED,
    })
    await expect(prepared.engine.recoverPendingRestore()).resolves.toMatchObject({
      ok: true,
      code: RESTORE_RESULT_CODE.RECOVERY_ABORTED_PREPARED,
    })
    expect((await prepared.adapter.loadBusiness()).name).toBe('Toko Lama')

    const committed = await createContext()
    await seedCurrentState(committed)
    await committed.engine.restore({ payload: makeTargetBackup(), confirmed: true })
    await committed.adapter.saveRestoreJournal({
      version: 1,
      operationId: 'restore-committed',
      phase: RESTORE_JOURNAL_PHASE.COMMITTED,
    })
    await expect(committed.engine.recoverPendingRestore()).resolves.toMatchObject({
      ok: true,
      code: RESTORE_RESULT_CODE.RECOVERY_FINALIZED_COMMITTED,
    })
    expect((await committed.adapter.loadBusiness()).name).toBe('Toko Target')
  })

  it('supports legacy v1/v2 local restore in same-device mode without requiring portable metadata', async () => {
    for (const version of [1, 2]) {
      const context = await createContext()
      await seedCurrentState(context)
      const result = await context.engine.restore({
        payload: makeTargetBackup({ version }),
        mode: RESTORE_MODE.SAME_DEVICE,
        confirmed: true,
      })

      expect(result).toMatchObject({ success: true, code: RESTORE_RESULT_CODE.OK })
      expect((await context.adapter.loadProducts()).products[0].id).toBe('p-target')
    }
  })
})
