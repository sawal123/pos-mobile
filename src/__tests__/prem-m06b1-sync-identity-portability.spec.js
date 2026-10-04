import { describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

import {
  BACKUP_SCHEMA,
  BACKUP_VERSION,
  CROSS_DEVICE_RESTORE_SAFETY,
  classifyCrossDeviceRestoreSafety,
  createBackupPayload,
  createBackupPayloadFromPersistence,
  validateBackupPayload,
  validatePortableSyncMetadata,
} from '@/services/backupService'
import { createMemoryAdapter } from '@/services/database/memoryAdapter'
import { createSyncIdentityRegistry } from '@/services/sync/syncIdentityRegistry'
import { mapOutboxEntries } from '@/services/sync/contractMapper'
import { SYNC_ENTITY_TYPES, SYNC_OPERATIONS } from '@/services/sync/syncConstants'
import { useBusinessStore } from '@/stores/businessStore'
import { useCashStore } from '@/stores/cashStore'
import { useCustomerStore } from '@/stores/customerStore'
import { useExpenseStore } from '@/stores/expenseStore'
import { useProductStore } from '@/stores/productStore'
import { useTransactionStore } from '@/stores/transactionStore'

const PRODUCT_SYNC_ID = '11111111-1111-4111-8111-111111111111'
const CATEGORY_SYNC_ID = '22222222-2222-4222-8222-222222222222'
const CUSTOMER_SYNC_ID = '33333333-3333-4333-8333-333333333333'
const TRANSACTION_SYNC_ID = '44444444-4444-4444-8444-444444444444'
const SALE_ITEM_SYNC_ID = '55555555-5555-4555-8555-555555555555'
const CASH_SYNC_ID = '66666666-6666-4666-8666-666666666666'
const STOCK_SYNC_ID = '77777777-7777-4777-8777-777777777777'
const EXPENSE_SYNC_ID = '88888888-8888-4888-8888-888888888888'

function makeContext() {
  const pinia = createPinia()
  setActivePinia(pinia)

  const businessStore = useBusinessStore(pinia)
  const productStore = useProductStore(pinia)
  const customerStore = useCustomerStore(pinia)
  const expenseStore = useExpenseStore(pinia)
  const transactionStore = useTransactionStore(pinia)
  const cashStore = useCashStore(pinia)

  businessStore.setBusiness({
    name: 'Toko Portable',
    type: 'Cafe',
    owner: 'Sari',
    phone: '081111111111',
    outlet: 'Pusat',
    mode: 'cloud',
  })

  productStore.$patch({
    categories: ['Minuman'],
    products: [
      {
        id: 'p-portable',
        name: 'Kopi Portable',
        category: 'Minuman',
        price: 15000,
        stock: -3,
        isActive: true,
      },
    ],
    stockMovements: [
      {
        id: 'sm-portable',
        productId: 'p-portable',
        type: 'sale',
        quantityChange: -5,
        stockBefore: 2,
        stockAfter: -3,
        transactionId: 'trx-portable',
        createdAt: '2026-10-02T08:00:00.000Z',
      },
    ],
  })

  customerStore.$patch({
    customers: [
      { id: 'c-portable', name: 'Nadia', phone: '081222222222', email: 'nadia@example.com' },
    ],
  })

  expenseStore.$patch({
    expenses: [
      {
        id: 'e-portable',
        title: 'Gas',
        category: 'Operasional',
        amount: 90000,
        note: '',
        createdAt: '2026-10-02T07:00:00.000Z',
      },
    ],
  })

  transactionStore.$patch({
    items: [
      {
        id: 'trx-portable',
        invoiceNumber: 'INV-PORTABLE',
        customer: 'Nadia',
        customerId: 'c-portable',
        customerSnapshot: {
          id: 'c-portable',
          name: 'Nadia',
          phone: '081222222222',
          email: 'nadia@example.com',
        },
        businessSnapshot: { name: 'Toko Portable', outlet: 'Pusat', phone: '081111111111' },
        status: 'paid',
        paymentStatus: 'paid',
        items: [{ id: 'p-portable', name: 'Kopi Portable', price: 15000, qty: 1 }],
        itemCount: 1,
        subtotal: 15000,
        tax: 0,
        total: 15000,
        grossProfit: 5000,
        paymentMethod: 'cash',
        cashReceived: 20000,
        changeAmount: 5000,
        paidAt: '2026-10-02T08:00:00.000Z',
        createdAt: '2026-10-02T08:00:00.000Z',
      },
    ],
  })

  cashStore.$patch({
    entries: [
      {
        id: 'cash-portable',
        type: 'in',
        amount: 15000,
        category: 'Penjualan',
        note: '',
        transactionId: 'trx-portable',
        createdAt: '2026-10-02T08:00:00.000Z',
      },
    ],
  })

  return {
    businessStore,
    productStore,
    customerStore,
    expenseStore,
    transactionStore,
    cashStore,
  }
}

function portableMetadata(overrides = {}) {
  return {
    identityMap: {
      'category:Minuman': CATEGORY_SYNC_ID,
      'product:p-portable': PRODUCT_SYNC_ID,
      'customer:c-portable': CUSTOMER_SYNC_ID,
      'expense:e-portable': EXPENSE_SYNC_ID,
      'transaction:trx-portable': TRANSACTION_SYNC_ID,
      'sale_item:trx-portable:0:p-portable': SALE_ITEM_SYNC_ID,
      'cash_entry:cash-portable': CASH_SYNC_ID,
      'stock_movement:sm-portable': STOCK_SYNC_ID,
      ...overrides.identityMap,
    },
    serverVersions: {
      [`categories:${CATEGORY_SYNC_ID}`]: { syncVersion: 2, syncSequence: 20 },
      [`products:${PRODUCT_SYNC_ID}`]: { syncVersion: 9, syncSequence: 90 },
      [`customers:${CUSTOMER_SYNC_ID}`]: { syncVersion: 3, syncSequence: 30 },
      [`expenses:${EXPENSE_SYNC_ID}`]: { syncVersion: 4, syncSequence: 40 },
      [`sales:${TRANSACTION_SYNC_ID}`]: { syncVersion: 5, syncSequence: 50 },
      [`sale_items:${SALE_ITEM_SYNC_ID}`]: { syncVersion: 6, syncSequence: 60 },
      [`cash_ledger:${CASH_SYNC_ID}`]: { syncVersion: 7, syncSequence: 70 },
      [`stock_movements:${STOCK_SYNC_ID}`]: { syncVersion: 8, syncSequence: 80 },
      ...overrides.serverVersions,
    },
  }
}

function makePortableBackup(overrides = {}) {
  return createBackupPayload({
    ...makeContext(),
    syncMetadata: portableMetadata(overrides),
  })
}

describe('PREM-M06B1 sync identity portability', () => {
  it('serializes backup v3 with portable sync metadata and unchanged domain data', () => {
    const backup = makePortableBackup()

    expect(backup.schema).toBe(BACKUP_SCHEMA)
    expect(backup.version).toBe(BACKUP_VERSION)
    expect(BACKUP_VERSION).toBe(3)
    expect(backup.data.products.products[0].stock).toBe(-3)
    expect(backup.data.stockMovements[0].stockBefore).toBe(2)
    expect(backup.data.stockMovements[0].stockAfter).toBe(-3)
    expect(backup.data.stockMovements[0].quantityChange).toBe(-5)
    expect(backup.syncMetadata.identityMap['product:p-portable']).toBe(PRODUCT_SYNC_ID)
    expect(backup.syncMetadata.serverVersions[`products:${PRODUCT_SYNC_ID}`].syncVersion).toBe(9)
    expect(validateBackupPayload(backup).valid).toBe(true)
    expect(validatePortableSyncMetadata(backup).valid).toBe(true)
  })

  it('excludes device identity, Cloud session, queue, in-flight envelope and P38 journal', async () => {
    const adapter = createMemoryAdapter()
    await adapter.initialize()
    await adapter.saveBusiness({
      name: 'Toko Portable',
      type: 'Cafe',
      owner: 'Sari',
      phone: '081111111111',
      outlet: 'Pusat',
      mode: 'cloud',
    })
    await adapter.saveTaxState({ enabled: false, rate: 11 })
    await adapter.saveProducts(
      [
        {
          id: 'p-portable',
          name: 'Kopi Portable',
          category: 'Minuman',
          price: 15000,
          stock: -3,
          isActive: true,
        },
      ],
      ['Minuman'],
      [],
    )
    await adapter.saveCustomers([])
    await adapter.saveExpenses([])
    await adapter.saveTransactions([])
    await adapter.saveCashState({ entries: [] })
    await adapter.saveDeviceIdentifier('DEVICE-SHOULD-NOT-BE-BACKED-UP')
    await adapter.saveCloudContext({ token: 'TOKEN-SHOULD-NOT-BE-BACKED-UP' })
    await adapter.upsertSyncQueueItem({
      id: 'QUEUE-SHOULD-NOT-BE-BACKED-UP',
      entityType: SYNC_ENTITY_TYPES.PRODUCT,
      entityId: 'p-portable',
      operation: SYNC_OPERATIONS.UPSERT,
      payload: { id: 'p-portable' },
      createdAt: '2026-10-02T00:00:00.000Z',
      updatedAt: '2026-10-02T00:00:00.000Z',
    })
    await adapter.saveSyncPushInflight({ requestId: 'REQUEST-SHOULD-NOT-BE-BACKED-UP' })
    await adapter.saveLocalOperationJournal({
      entries: [{ operationId: 'P38-SHOULD-NOT-BE-BACKED-UP' }],
    })
    await adapter.saveSyncIdentityMap({ 'product:p-portable': PRODUCT_SYNC_ID })
    await adapter.saveSyncServerVersions({
      [`products:${PRODUCT_SYNC_ID}`]: { syncVersion: 9, syncSequence: 90 },
      'shifts:99999999-9999-4999-8999-999999999999': { syncVersion: 1, syncSequence: 1 },
    })

    const backup = await createBackupPayloadFromPersistence({ adapter })
    const serialized = JSON.stringify(backup)

    expect(serialized).not.toContain('DEVICE-SHOULD-NOT-BE-BACKED-UP')
    expect(serialized).not.toContain('TOKEN-SHOULD-NOT-BE-BACKED-UP')
    expect(serialized).not.toContain('QUEUE-SHOULD-NOT-BE-BACKED-UP')
    expect(serialized).not.toContain('REQUEST-SHOULD-NOT-BE-BACKED-UP')
    expect(serialized).not.toContain('P38-SHOULD-NOT-BE-BACKED-UP')
    expect(backup.syncMetadata.identityMap).toEqual({ 'product:p-portable': PRODUCT_SYNC_ID })
    expect(backup.syncMetadata.serverVersions).toEqual({
      [`products:${PRODUCT_SYNC_ID}`]: { syncVersion: 9, syncSequence: 90 },
    })
  })

  it('fails closed for old snapshots that lack portable identity metadata', () => {
    const backup = makePortableBackup()
    delete backup.syncMetadata
    backup.version = 2

    expect(validateBackupPayload(backup).valid).toBe(true)
    expect(classifyCrossDeviceRestoreSafety(backup)).toMatchObject({
      safeForCrossDeviceRestore: false,
      reason: CROSS_DEVICE_RESTORE_SAFETY.UNSUPPORTED_BACKUP_VERSION,
    })
  })

  it('rejects duplicate, dangling, malformed identity and dangling versions', () => {
    const duplicate = makePortableBackup()
    duplicate.data.products.products.push({
      id: 'p-duplicate',
      name: 'Duplikat',
      category: 'Minuman',
      price: 1000,
      stock: 1,
      isActive: true,
    })
    duplicate.syncMetadata.identityMap['product:p-duplicate'] = PRODUCT_SYNC_ID
    expect(validatePortableSyncMetadata(duplicate).code).toBe(
      CROSS_DEVICE_RESTORE_SAFETY.SYNC_IDENTITY_MALFORMED,
    )

    const danglingIdentity = makePortableBackup()
    danglingIdentity.syncMetadata.identityMap['product:p-missing'] =
      '99999999-9999-4999-8999-999999999999'
    expect(validatePortableSyncMetadata(danglingIdentity).code).toBe(
      CROSS_DEVICE_RESTORE_SAFETY.SYNC_IDENTITY_DANGLING,
    )

    const malformedIdentity = makePortableBackup()
    malformedIdentity.syncMetadata.identityMap['product:p-portable'] = 'not-a-uuid'
    expect(validatePortableSyncMetadata(malformedIdentity).code).toBe(
      CROSS_DEVICE_RESTORE_SAFETY.SYNC_IDENTITY_MALFORMED,
    )

    const danglingVersion = makePortableBackup()
    danglingVersion.syncMetadata.serverVersions['products:99999999-9999-4999-8999-999999999999'] = {
      syncVersion: 1,
      syncSequence: 1,
    }
    expect(validatePortableSyncMetadata(danglingVersion).code).toBe(
      CROSS_DEVICE_RESTORE_SAFETY.SYNC_VERSION_DANGLING,
    )

    const malformedVersion = makePortableBackup()
    malformedVersion.syncMetadata.serverVersions[`products:${PRODUCT_SYNC_ID}`] = {
      syncVersion: -1,
    }
    expect(validatePortableSyncMetadata(malformedVersion).code).toBe(
      CROSS_DEVICE_RESTORE_SAFETY.SYNC_VERSION_MALFORMED,
    )
  })

  it('uses imported portable product mapping for the next edit instead of generating a new identity', async () => {
    const adapter = createMemoryAdapter()
    await adapter.initialize()
    await adapter.saveSyncIdentityMap({ 'product:p-portable': PRODUCT_SYNC_ID })
    await adapter.saveSyncServerVersions({
      [`products:${PRODUCT_SYNC_ID}`]: { syncVersion: 9, syncSequence: 90 },
    })

    const registry = createSyncIdentityRegistry({ adapter })
    const mapped = await mapOutboxEntries(
      [
        {
          id: 'queue-edit-product',
          entityType: SYNC_ENTITY_TYPES.PRODUCT,
          entityId: 'p-portable',
          operation: SYNC_OPERATIONS.UPSERT,
          payload: {
            id: 'p-portable',
            name: 'Kopi Portable Edit',
            category: 'Minuman',
            price: 16000,
            stock: -3,
            isActive: true,
          },
        },
      ],
      { adapter, registry },
    )

    expect(mapped.blocked).toEqual([])
    expect(mapped.changes.products).toHaveLength(1)
    expect(mapped.changes.products[0].sync_id).toBe(PRODUCT_SYNC_ID)
    expect(mapped.changes.products[0].base_sync_version).toBe(9)

    const identityMap = await adapter.loadSyncIdentityMap()
    expect(identityMap['product:p-portable']).toBe(PRODUCT_SYNC_ID)
    expect(Object.keys(identityMap).filter((key) => key.startsWith('product:'))).toEqual([
      'product:p-portable',
    ])
  })
})
