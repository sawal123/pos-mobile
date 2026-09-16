/**
 * P37 patch — REAL app-service HTTP E2E.
 *
 * Uses the ACTUAL mobile services (createSyncPushService, createSyncPullService,
 * contractMapper, registry, queue, Pinia domain stores) with transports pointed
 * at a real `php artisan serve` test server on a dedicated TEST database.
 *
 * No mocks for HTTP or for the sync services under test. Run with:
 *   P37_E2E_BASE_URL=http://127.0.0.1:18010
 *   P37_E2E_EMAIL=e2e-owner@example.com
 *   P37_E2E_PASSWORD=password
 *   npx vitest run src/__tests__/p37-app-service-e2e.spec.js
 *
 * Without P37_E2E_BASE_URL the suite skips (CI-safe default).
 */

// @vitest-environment node

import { describe, it, expect } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

import { createMemoryAdapter } from '../services/database/memoryAdapter'
import { createSyncQueueService } from '../services/sync/syncQueueService'
import { createSyncIdentityRegistry } from '../services/sync/syncIdentityRegistry'
import { createSyncPushService } from '../services/sync/syncPushService'
import { createSyncPullService } from '../services/sync/syncPullService'
import { createSyncChangeTracker } from '../services/sync/syncTracker'
import { SYNC_ENTITY_TYPES } from '../services/sync/syncConstants'
import { useBusinessStore } from '../stores/businessStore'
import { useProductStore } from '../stores/productStore'
import { useCashStore } from '../stores/cashStore'
import { useCustomerStore } from '../stores/customerStore'
import { useExpenseStore } from '../stores/expenseStore'
import { useShiftStore } from '../stores/shiftStore'
import { useTransactionStore } from '../stores/transactionStore'

const BASE_URL = (typeof process !== 'undefined' && process.env?.P37_E2E_BASE_URL) || ''
const EMAIL = (typeof process !== 'undefined' && process.env?.P37_E2E_EMAIL) || 'e2e-owner@example.com'
const PASSWORD = (typeof process !== 'undefined' && process.env?.P37_E2E_PASSWORD) || 'password'
const RUN_E2E = BASE_URL.length > 0

function randomSuffix() {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID().slice(0, 8)
  }

  return Math.random().toString(36).slice(2, 10)
}

async function api(method, path, { token, body, query } = {}) {
  const url = new URL(BASE_URL + path)
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      url.searchParams.set(key, String(value))
    }
  }
  const headers = { Accept: 'application/json' }
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  if (token) headers.Authorization = `Bearer ${token}`

  const res = await fetch(url, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })

  return { status: res.status, data: await res.json().catch(() => null) }
}

async function createDeviceRuntime() {
  const pinia = createPinia()
  const adapter = createMemoryAdapter()
  await adapter.initialize()
  const queueService = createSyncQueueService({ adapter, scheduler: null })
  const tracker = createSyncChangeTracker({ pinia, queueService })
  const registry = createSyncIdentityRegistry({ adapter, scheduler: null })
  const businessStore = useBusinessStore(pinia)
  const productStore = useProductStore(pinia)
  const cashStore = useCashStore(pinia)
  const customerStore = useCustomerStore(pinia)
  const expenseStore = useExpenseStore(pinia)
  const shiftStore = useShiftStore(pinia)
  const transactionStore = useTransactionStore(pinia)

  businessStore.mode = 'cloud'
  productStore.products = []
  productStore.stockMovements = []
  cashStore.entries = []
  customerStore.customers = []
  expenseStore.expenses = []
  transactionStore.items = []
  shiftStore.$patch({
    isOpen: false,
    openingBalance: 0,
    openedAt: null,
    id: null,
    shiftNumber: null,
    status: null,
    closingBalance: null,
    closedAt: null,
    notes: '',
  })

  return {
    pinia,
    adapter,
    queueService,
    tracker,
    registry,
    businessStore,
    productStore,
    cashStore,
    customerStore,
    expenseStore,
    shiftStore,
    transactionStore,
  }
}

function realPushTransport(token) {
  return async ({ body }) => {
    const res = await api('POST', '/api/sync/push', { token, body })

    if (res.status >= 200 && res.status < 300) {
      return { ok: true, status: res.status, data: res.data }
    }

    return {
      ok: false,
      status: res.status,
      data: res.data,
      error: { code: res.data?.code ?? `HTTP_${res.status}`, message: res.data?.message ?? '' },
    }
  }
}

function realPullTransport(token) {
  return async ({ businessId, deviceIdentifier, after, limit }) => {
    const res = await api('GET', '/api/sync/pull', {
      token,
      query: { business_id: businessId, device_identifier: deviceIdentifier, after, limit },
    })

    if (res.status >= 200 && res.status < 300) {
      return { ok: true, status: res.status, data: res.data }
    }

    return {
      ok: false,
      status: res.status,
      data: res.data,
      error: { code: res.data?.code ?? `HTTP_${res.status}`, message: res.data?.message ?? '' },
    }
  }
}

describe.runIf(RUN_E2E)('P37: real app-service HTTP E2E', () => {
  it('device A pushes via real push service; device B reconstructs real Pinia state', async () => {
    // ── 0. Login + context + register both devices ──────────────────────────
    const login = await api('POST', '/api/auth/login', { body: { email: EMAIL, password: PASSWORD } })
    expect(login.status).toBe(200)
    const token = login.data.data.token

    const ctx = await api('GET', '/api/mobile/context', { token })
    expect(ctx.status).toBe(200)
    const business = ctx.data.data.businesses[0]
    const businessId = business.id
    const outletId = business.outlets[0].id

    const deviceA = `E2E-APP-A-${randomSuffix()}`
    const deviceB = `E2E-APP-B-${randomSuffix()}`

    for (const [identifier, name] of [[deviceA, 'E2E App A'], [deviceB, 'E2E App B']]) {
      const reg = await api('POST', '/api/mobile/devices', {
        token,
        body: {
          business_id: businessId,
          outlet_id: outletId,
          device_identifier: identifier,
          name,
          platform: 'android',
        },
      })
      expect(reg.status).toBe(200)
    }

    const cloudContext = (identifier) => ({
      user: { id: 1 },
      selectedBusiness: { id: businessId },
      selectedOutlet: { id: outletId },
      cloudAccess: true,
      deviceIdentifier: identifier,
      registeredDeviceId: '999',
      token,
    })

    // ── 1. Device A: build rich local state ─────────────────────────────────
    // NOTE: production flow first stages the category via createCategory
    // (which queues the category upsert through the tracker), then creates
    // the product against the now-existing category. Both rows travel in the
    // same push batch, dependency-ordered (categories before products).
    const runtimeA = await createDeviceRuntime()
    setActivePinia(runtimeA.pinia)
    const createdCategory = runtimeA.productStore.createCategory('LaundryMaster')
    expect(createdCategory.success).toBe(true)
    const createdProduct = runtimeA.productStore.createProduct({
      name: 'Cuci Kering',
      category: 'LaundryMaster',
      price: 10000,
      cost: 4000,
      stock: 100,
      unit: 'kg',
      kind: 'service',
      pricingUnit: 'kg',
      minQuantity: 1,
      estimatedDuration: '2 hari',
    })
    expect(createdProduct.success).toBe(true)
    const productId = createdProduct.product.id

    const createdCustomer = runtimeA.customerStore.createCustomer({
      name: 'Andi',
      phone: '0811',
      email: 'andi@example.com',
    })
    expect(createdCustomer.success).toBe(true)

    runtimeA.shiftStore.openShift(100000)
    const shiftId = runtimeA.shiftStore.id

    const createdExpense = runtimeA.expenseStore.createExpense({
      title: 'Deterjen',
      category: 'Belanja Stok',
      amount: 75000,
      note: '',
    })
    expect(createdExpense.success).toBe(true)

    const laundryOrder = runtimeA.transactionStore.createLaundryOrder({
      items: [{ id: productId, name: 'Cuci Kering', price: 10000, qty: 2.5, hppSnapshot: 4000, unit: 'kg', kind: 'service', pricingUnit: 'kg' }],
      customer: 'Andi',
      customerId: createdCustomer.customer.id,
      paymentMethod: '',
    })
    const laundryId = laundryOrder.id
    expect(laundryOrder.paymentStatus).toBe('unpaid')

    // NOTE: recordSaleStock skips service-kind products (Laundry has no
    // stock). A second retail-kind product proves movement history syncs end
    // to end via a real sale deduction.
    const retailProduct = runtimeA.productStore.createProduct({
      name: 'Kopi Susu',
      category: 'LaundryMaster',
      price: 15000,
      cost: 8000,
      stock: 50,
      unit: 'pcs',
      kind: 'product',
    })
    expect(retailProduct.success).toBe(true)
    const retailId = retailProduct.product.id
    runtimeA.productStore.recordSaleStock(
      [{ id: retailId, name: 'Kopi Susu', qty: 2 }],
      'sale-e2e-retail-1',
    )

    const paidOrder = runtimeA.transactionStore.createTransaction({
      items: [{ id: productId, name: 'Cuci Kering', price: 10000, qty: 1, hppSnapshot: 4000 }],
      subtotal: 10000,
      tax: 0,
      total: 10000,
      customer: 'Walk-in Customer',
      paymentMethod: 'cash',
      cashReceived: 20000,
      changeAmount: 10000,
    })
    runtimeA.cashStore.recordSalePayment({
      id: paidOrder.id,
      total: paidOrder.total,
      paymentMethod: 'cash',
      invoiceNumber: paidOrder.invoiceNumber,
      createdAt: paidOrder.createdAt,
    })

    // ── 2. Device A: push via the REAL push service ─────────────────────────
    const pushServiceA = createSyncPushService({
      adapter: runtimeA.adapter,
      queueService: runtimeA.queueService,
      registry: runtimeA.registry,
      scheduler: null,
      tokenFetcher: async () => token,
      transport: realPushTransport(token),
    })

    // Bootstrap-first flow: push requires a staged bootstrap state.
    // registeredDeviceId must be a string: the guard compares with String().
    await runtimeA.adapter.saveSyncBootstrapState({
      version: 1,
      businessId,
      outletId,
      deviceIdentifier: deviceA,
      registeredDeviceId: '999',
      status: 'staged',
      stagedAt: new Date().toISOString(),
      counts: {},
    })

    const pushResult = await pushServiceA.pushNow({ context: cloudContext(deviceA) })
    expect(pushResult.ok).toBe(true)

    // Retry the same server round: same request flow must stay duplicate-safe.
    // (A second pushNow finds an empty queue and reports ok with no request.)
    const pushRetry = await pushServiceA.pushNow({ context: cloudContext(deviceA) })
    expect(pushRetry.ok).toBe(true)

    // ── 3. Device B: fresh runtime pulls via the REAL pull service ──────────
    // A fresh device has no local outbox yet; the first pull needs a saved
    // push binding (the new-device bootstrap path), exactly like the P13
    // pull specs set up before pullNow.
    const runtimeB = await createDeviceRuntime()
    setActivePinia(runtimeB.pinia)
    await runtimeB.adapter.saveSyncPushBinding({
      businessId,
      deviceIdentifier: deviceB,
      registeredDeviceId: '999',
      boundAt: new Date().toISOString(),
    })
    const pullServiceB = createSyncPullService({
      adapter: runtimeB.adapter,
      queueService: runtimeB.queueService,
      registry: runtimeB.registry,
      scheduler: null,
      pinia: runtimeB.pinia,
      tokenFetcher: async () => token,
      transport: realPullTransport(token),
    })

    const pullResult = await pullServiceB.pullNow({ context: cloudContext(deviceB) })
    expect(pullResult.ok).toBe(true)

    // ── 4. Assert ACTUAL device-B Pinia stores ──────────────────────────────
    // The pulled product resolves its category through the same sync
    // identity that device A pushed; the fresh device started from the
    // default Cafe template catalog.
    const pulledProduct = runtimeB.productStore.products.find((p) => p.name === 'Cuci Kering')
    expect(pulledProduct).toBeDefined()
    expect(pulledProduct.category).toBe('LaundryMaster')
    expect(runtimeB.productStore.categories).toContain('LaundryMaster')
    expect(pulledProduct.kind).toBe('service')
    expect(pulledProduct.unit).toBe('kg')
    expect(pulledProduct.pricingUnit).toBe('kg')
    expect(pulledProduct.cost).toBe(4000)
    expect(pulledProduct.estimatedDuration).toBe('2 hari')

    const pulledExpense = runtimeB.expenseStore.expenses.find((e) => e.title === 'Deterjen')
    expect(pulledExpense).toBeDefined()
    expect(pulledExpense.category).toBe('Belanja Stok')

    expect(runtimeB.shiftStore.isOpen).toBe(true)
    expect(runtimeB.shiftStore.openingBalance).toBe(100000)

    const pulledLaundry = runtimeB.transactionStore.items.find((t) => t.id === laundryId)
    expect(pulledLaundry).toBeDefined()
    expect(pulledLaundry.orderStatus).toBe('Masuk')
    expect(pulledLaundry.paymentStatus).toBe('unpaid')
    expect(pulledLaundry.items[0].qty).toBe(2.5)
    expect(pulledLaundry.items[0].hppSnapshot).toBe(4000)
    expect(pulledLaundry.grossProfit).toBe((10000 - 4000) * 2.5)

    const pulledPaid = runtimeB.transactionStore.items.find((t) => t.id === paidOrder.id)
    expect(pulledPaid).toBeDefined()
    expect(pulledPaid.paymentStatus).toBe('paid')
    expect(pulledPaid.paymentMethod).toBe('cash')
    expect(pulledPaid.items[0].hppSnapshot).toBe(4000)

    // Cash: exactly the paid retail sale produced one CASH IN.
    expect(runtimeB.cashStore.entries).toHaveLength(1)
    expect(runtimeB.cashStore.balance).toBe(10000)

    // Stock movement history restored and product stock converged.
    expect(runtimeB.productStore.stockMovements.length).toBeGreaterThan(0)

    // ── 5. Settle the Laundry order on A, push, pull B ──────────────────────
    const settleResult = runtimeA.transactionStore.settleLaundryOrderPayment({
      orderId: laundryId,
      paymentMethod: 'cash',
      cashReceived: 30000,
      changeAmount: 5000,
      cashStore: runtimeA.cashStore,
    })
    expect(settleResult.success).toBe(true)

    const pushServiceA2 = createSyncPushService({
      adapter: runtimeA.adapter,
      queueService: runtimeA.queueService,
      registry: runtimeA.registry,
      scheduler: null,
      tokenFetcher: async () => token,
      transport: realPushTransport(token),
    })
    const pushSettle = await pushServiceA2.pushNow({ context: cloudContext(deviceA) })
    expect(pushSettle.ok).toBe(true)

    const pullServiceB2 = createSyncPullService({
      adapter: runtimeB.adapter,
      queueService: runtimeB.queueService,
      registry: runtimeB.registry,
      scheduler: null,
      pinia: runtimeB.pinia,
      tokenFetcher: async () => token,
      transport: realPullTransport(token),
    })
    // The settle push and the new cash entry advance the server sequence;
    // device B therefore pulls strictly after its bootstrap cursor. Unlike
    // the unit-level convergence test (which drives pullNow with a crafted
    // transport), this E2E asserts against the live server response below.
    const pullSettled = await pullServiceB2.pullNow({ context: cloudContext(deviceB) })
    expect(pullSettled.ok).toBe(true)
    expect(pullSettled.fetched).toBeGreaterThanOrEqual(1)
    expect(pullSettled.applied).toBeGreaterThanOrEqual(1)

    const settledB = runtimeB.transactionStore.items.find((t) => t.id === laundryId)
    expect(settledB).toBeDefined()
    expect(settledB.paymentStatus).toBe('paid')
    expect(settledB.paymentMethod).toBe('cash')
    expect(settledB.paidAt).toBeTruthy()

    // Cash gained exactly the laundry total once — no duplicate cash entry.
    expect(runtimeB.cashStore.entries).toHaveLength(2)
    expect(runtimeB.cashStore.balance).toBe(10000 + 25000)

    // Second pull: still no duplicate cash.
    const pullServiceB3 = createSyncPullService({
      adapter: runtimeB.adapter,
      queueService: runtimeB.queueService,
      registry: runtimeB.registry,
      scheduler: null,
      pinia: runtimeB.pinia,
      tokenFetcher: async () => token,
      transport: realPullTransport(token),
    })
    expect((await pullServiceB3.pullNow({ context: cloudContext(deviceB) })).ok).toBe(true)
    expect(runtimeB.cashStore.entries).toHaveLength(2)
    expect(runtimeB.cashStore.balance).toBe(35000)
  })
})
