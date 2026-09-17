/**
 * P38 — REAL two-device HTTP E2E.
 *
 * Drives the ACTUAL mobile services (createSyncPushService, createSyncPullService,
 * syncTracker, outbox queue, identity registry, Pinia stores, and the durable
 * local operation journal) against a real `php artisan serve` backend on a
 * dedicated TEST database. No HTTP or service mocks.
 *
 * Run with:
 *   P38_E2E_BASE_URL=http://127.0.0.1:18020
 *   P38_E2E_EMAIL=e2e-owner@example.com
 *   P38_E2E_PASSWORD=password
 *   npx vitest run src/__tests__/p38-two-device-e2e.spec.js
 *
 * Without P38_E2E_BASE_URL the suite skips (CI-safe default).
 */

// @vitest-environment node

import { describe, it, expect } from 'vitest'
import { createPinia } from 'pinia'

import { createMemoryAdapter } from '../services/database/memoryAdapter'
import { createLocalOperationService } from '../services/database/localOperationService'
import { createSyncQueueService } from '../services/sync/syncQueueService'
import { createSyncIdentityRegistry } from '../services/sync/syncIdentityRegistry'
import { createSyncPushService } from '../services/sync/syncPushService'
import { createSyncPullService } from '../services/sync/syncPullService'
import { createSyncChangeTracker } from '../services/sync/syncTracker'
import { useBusinessStore } from '../stores/businessStore'
import { useProductStore } from '../stores/productStore'
import { useCashStore } from '../stores/cashStore'
import { useCustomerStore } from '../stores/customerStore'
import { useTransactionStore } from '../stores/transactionStore'
import { useShiftStore } from '../stores/shiftStore'

const BASE_URL = (typeof process !== 'undefined' && process.env?.P38_E2E_BASE_URL) || ''
const EMAIL = (typeof process !== 'undefined' && process.env?.P38_E2E_EMAIL) || 'e2e-owner@example.com'
const PASSWORD = (typeof process !== 'undefined' && process.env?.P38_E2E_PASSWORD) || 'password'
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

async function createDeviceRuntime() {
  const pinia = createPinia()
  const adapter = createMemoryAdapter()
  await adapter.initialize()

  const queueService = createSyncQueueService({ adapter, scheduler: null })
  createSyncChangeTracker({ pinia, queueService })
  const registry = createSyncIdentityRegistry({ adapter, scheduler: null })

  const businessStore = useBusinessStore(pinia)
  const productStore = useProductStore(pinia)
  const cashStore = useCashStore(pinia)
  const customerStore = useCustomerStore(pinia)
  const transactionStore = useTransactionStore(pinia)
  const shiftStore = useShiftStore(pinia)

  businessStore.mode = 'cloud'
  productStore.products = []
  productStore.categories = []
  productStore.stockMovements = []
  cashStore.entries = []
  customerStore.customers = []
  transactionStore.items = []
  shiftStore.$patch({ isOpen: false, openingBalance: 0, openedAt: null, id: null })

  const localOperations = createLocalOperationService({ adapter, scheduler: null, pinia })

  return {
    pinia,
    adapter,
    queueService,
    registry,
    businessStore,
    productStore,
    cashStore,
    customerStore,
    transactionStore,
    localOperations,
  }
}

async function bindDevice(runtime, { businessId, outletId, deviceIdentifier, token, status }) {
  await runtime.adapter.saveSyncPushBinding({
    businessId,
    boundAt: new Date().toISOString(),
  })
  await runtime.adapter.saveSyncPullBinding({
    businessId,
    outletId,
    deviceIdentifier,
    registeredDeviceId: '999',
    boundAt: new Date().toISOString(),
  })
  await runtime.adapter.saveSyncPullState({ version: 1, cursor: 0, serverSequence: 0 })
  await runtime.adapter.saveSyncBootstrapState({
    version: 1,
    businessId,
    outletId,
    deviceIdentifier,
    registeredDeviceId: '999',
    status,
    stagedAt: new Date().toISOString(),
    counts: {},
  })
}

function cloudContext({ businessId, outletId, deviceIdentifier, token }) {
  return {
    user: { id: 1 },
    selectedBusiness: { id: businessId },
    selectedOutlet: { id: outletId },
    cloudAccess: true,
    deviceIdentifier,
    registeredDeviceId: '999',
    token,
  }
}

function makeServices(runtime, token) {
  const pushService = createSyncPushService({
    adapter: runtime.adapter,
    queueService: runtime.queueService,
    registry: runtime.registry,
    scheduler: null,
    tokenFetcher: async () => token,
    transport: realPushTransport(token),
  })

  const pullService = createSyncPullService({
    adapter: runtime.adapter,
    queueService: runtime.queueService,
    registry: runtime.registry,
    pinia: runtime.pinia,
    tokenFetcher: async () => token,
    transport: realPullTransport(token),
  })

  return { pushService, pullService }
}

async function pushUntilDrained(pushService, context, maxAttempts = 5) {
  let last = null

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    last = await pushService.pushNow({ context })
    if (last.ok && (last.remaining ?? 0) === 0) {
      return last
    }
  }

  return last
}

async function pullUntilSettled(pullService, context, maxPages = 10) {
  let last = null

  for (let page = 0; page < maxPages; page += 1) {
    last = await pullService.pullNow({ context })
    if (!last.ok) return last
    if (!last.hasMore) return last
  }

  return last
}

describe.runIf(RUN_E2E)('P38: real two-device integrity E2E', () => {
  it('converges concurrent offline sales on delta-authoritative server stock', async () => {
    // ── 0. Login, cloud context, register two devices ────────────────────────
    const login = await api('POST', '/api/auth/login', { body: { email: EMAIL, password: PASSWORD } })
    expect(login.status).toBe(200)
    const token = login.data.data.token

    const ctx = await api('GET', '/api/mobile/context', { token })
    expect(ctx.status).toBe(200)
    const businessId = ctx.data.data.businesses[0].id
    const outletId = ctx.data.data.businesses[0].outlets[0].id

    const deviceA = `E2E-P38-A-${randomSuffix()}`
    const deviceB = `E2E-P38-B-${randomSuffix()}`

    for (const [identifier, name] of [[deviceA, 'P38 App A'], [deviceB, 'P38 App B']]) {
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

    const contextA = cloudContext({ businessId, outletId, deviceIdentifier: deviceA, token })
    const contextB = cloudContext({ businessId, outletId, deviceIdentifier: deviceB, token })

    // ── 1. Device A creates the shared retail product (stock 10) and pushes ──
    const runtimeA = await createDeviceRuntime()
    await bindDevice(runtimeA, {
      businessId,
      outletId,
      deviceIdentifier: deviceA,
      token,
      status: 'staged',
    })

    const categoryName = `P38Retail-${randomSuffix()}`
    const category = runtimeA.productStore.createCategory(categoryName)
    expect(category.success).toBe(true)
    const created = runtimeA.productStore.createProduct({
      name: `Kopi P38 ${randomSuffix()}`,
      category: categoryName,
      price: 15000,
      cost: 8000,
      stock: 10,
      unit: 'pcs',
      kind: 'product',
    })
    expect(created.success).toBe(true)
    const productId = created.product.id

    const servicesA = makeServices(runtimeA, token)
    expect((await pushUntilDrained(servicesA.pushService, contextA)).ok).toBe(true)

    // ── 2. Device B bootstraps: fresh pull converges to stock 10 ─────────────
    const runtimeB = await createDeviceRuntime()
    await bindDevice(runtimeB, {
      businessId,
      outletId,
      deviceIdentifier: deviceB,
      token,
      status: 'completed',
    })

    const servicesB = makeServices(runtimeB, token)
    expect((await pullUntilSettled(servicesB.pullService, contextB)).ok).toBe(true)

    const productOnB = runtimeB.productStore.products.find(
      (p) => p.name === created.product.name,
    )
    expect(productOnB).toBeDefined()
    expect(Number(productOnB.stock)).toBe(10)

    // Device A also re-pulls so both devices share the same base cursor.
    expect((await pullUntilSettled(servicesA.pullService, contextA)).ok).toBe(true)

    // ── 3. OFFLINE: A sells 3 (cash), B sells 4 (non-cash) ──────────────────
    const sellA = runtimeA.localOperations.commitRetailSale({
      checkout: {
        items: [{ id: productId, name: created.product.name, price: 15000, qty: 3, hppSnapshot: 8000 }],
        subtotal: 45000,
        tax: 0,
        total: 45000,
        customer: 'Walk-in Customer',
        paymentMethod: 'cash',
        cashReceived: 45000,
        changeAmount: 0,
      },
    })

    const sellB = runtimeB.localOperations.commitRetailSale({
      checkout: {
        items: [{ id: productOnB.id, name: productOnB.name, price: 15000, qty: 4, hppSnapshot: 8000 }],
        subtotal: 60000,
        tax: 0,
        total: 60000,
        customer: 'Walk-in Customer',
        paymentMethod: 'qris',
        cashReceived: null,
        changeAmount: null,
      },
    })

    await Promise.all([sellA, sellB])

    expect(runtimeA.transactionStore.items).toHaveLength(1)
    expect(runtimeB.transactionStore.items).toHaveLength(1)
    expect(Number(runtimeA.productStore.products.find((p) => p.id === productId).stock)).toBe(7)
    expect(Number(runtimeB.productStore.products.find((p) => p.id === productOnB.id).stock)).toBe(6)

    // ── 4. RECONNECT: near-concurrent push from both devices ────────────────
    const [pushA, pushB] = await Promise.all([
      pushUntilDrained(servicesA.pushService, contextA),
      pushUntilDrained(servicesB.pushService, contextB),
    ])

    expect(pushA.ok, JSON.stringify(pushA)).toBe(true)
    expect(pushB.ok, JSON.stringify(pushB)).toBe(true)

    // ── 5. CONVERGE: both devices pull until settled ────────────────────────
    expect((await pullUntilSettled(servicesA.pullService, contextA)).ok).toBe(true)
    expect((await pullUntilSettled(servicesB.pullService, contextB)).ok).toBe(true)

    // Delta-authoritative server stock: 10 - 3 - 4 = 3 (never 6 or 7).
    const stockA = Number(runtimeA.productStore.products.find((p) => p.id === productId).stock)
    const stockB = Number(runtimeB.productStore.products.find((p) => p.id === productOnB.id).stock)
    expect(stockA).toBe(3)
    expect(stockB).toBe(3)

    // Two logical sales, two stock movements, cash only for the cash sale.
    expect(runtimeA.transactionStore.items).toHaveLength(2)
    expect(runtimeA.productStore.stockMovements).toHaveLength(2)
    expect(runtimeA.cashStore.entries).toHaveLength(1)

    expect(runtimeB.transactionStore.items).toHaveLength(2)
    expect(runtimeB.productStore.stockMovements).toHaveLength(2)
    expect(runtimeB.cashStore.entries).toHaveLength(1)

    // No duplicate queue rows for the same logical entity.
    const queueA = await runtimeA.adapter.listSyncQueueItems()
    const keysA = queueA.map((item) => `${item.entityType}:${item.entityId}`)
    expect(new Set(keysA).size).toBe(keysA.length)
  }, 180000)

  it('keeps a stale laundry lifecycle push from regressing the server order', async () => {
    const login = await api('POST', '/api/auth/login', { body: { email: EMAIL, password: PASSWORD } })
    const token = login.data.data.token

    const ctx = await api('GET', '/api/mobile/context', { token })
    const businessId = ctx.data.data.businesses[0].id
    const outletId = ctx.data.data.businesses[0].outlets[0].id

    const deviceA = `E2E-P38-LA-${randomSuffix()}`
    const deviceB = `E2E-P38-LB-${randomSuffix()}`
    const deviceC = `E2E-P38-LC-${randomSuffix()}`

    for (const identifier of [deviceA, deviceB, deviceC]) {
      await api('POST', '/api/mobile/devices', {
        token,
        body: {
          business_id: businessId,
          outlet_id: outletId,
          device_identifier: identifier,
          name: identifier,
          platform: 'android',
        },
      })
    }

    const contextA = cloudContext({ businessId, outletId, deviceIdentifier: deviceA, token })
    const contextB = cloudContext({ businessId, outletId, deviceIdentifier: deviceB, token })
    const contextC = cloudContext({ businessId, outletId, deviceIdentifier: deviceC, token })

    // ── A creates the laundry order (Masuk) and pushes v1 ────────────────────
    const runtimeA = await createDeviceRuntime()
    await bindDevice(runtimeA, { businessId, outletId, deviceIdentifier: deviceA, token, status: 'staged' })

    const laundryCategory = `P38Laundry-${randomSuffix()}`
    runtimeA.productStore.createCategory(laundryCategory)
    const service = runtimeA.productStore.createProduct({
      name: `Cuci ${randomSuffix()}`,
      category: laundryCategory,
      price: 10000,
      kind: 'service',
      pricingUnit: 'kg',
      unit: 'kg',
      stock: 0,
    })
    const orderNumber = `LDR-P38-${randomSuffix()}`
    const order = runtimeA.transactionStore.createLaundryOrder({
      orderNumber,
      items: [{ id: service.product.id, name: service.product.name, price: 10000, qty: 2, kind: 'service' }],
      subtotal: 20000,
      total: 20000,
      paymentStatus: 'unpaid',
      paymentMethod: '',
    })

    const servicesA = makeServices(runtimeA, token)
    expect((await pushUntilDrained(servicesA.pushService, contextA)).ok).toBe(true)

    // ── B pulls the Masuk snapshot (its stale view) ─────────────────────────
    const runtimeB = await createDeviceRuntime()
    await bindDevice(runtimeB, { businessId, outletId, deviceIdentifier: deviceB, token, status: 'completed' })
    const servicesB = makeServices(runtimeB, token)
    expect((await pullUntilSettled(servicesB.pullService, contextB)).ok).toBe(true)

    const findOrder = (runtime) => runtime.transactionStore.items.find(
      (t) => t.orderNumber === orderNumber || t.invoiceNumber === orderNumber,
    ) ?? runtime.transactionStore.items[0]

    const pulledOrder = findOrder(runtimeB)
    expect(pulledOrder).toBeDefined()
    expect(pulledOrder.orderStatus).toBe('Masuk')

    // ── A advances Masuk -> Diproses and pushes v2 ──────────────────────────
    expect(runtimeA.transactionStore.updateOrderStatus(order.id, 'Diproses')).toBe(true)
    expect((await pushUntilDrained(servicesA.pushService, contextA)).ok).toBe(true)

    // ── Stale B pushes its old lifecycle state with base version 1 ──────────
    const saleSyncId = (await runtimeB.registry.peekSyncId('transaction', pulledOrder.id)) ?? pulledOrder.id

    const stalePush = await api('POST', '/api/sync/push', {
      token,
      body: {
        business_id: businessId,
        device_identifier: deviceB,
        request_id: globalThis.crypto?.randomUUID?.() ?? `req-${randomSuffix()}`,
        changes: {
          sales: [
            {
              sync_id: saleSyncId,
              base_sync_version: 1,
              transaction_number: orderNumber,
              status: 'unpaid',
              subtotal: 20000,
              total_amount: 20000,
              payment_status: 'unpaid',
              order_status: 'Masuk',
              sold_at: '2026-09-17T09:00:00.000Z',
            },
          ],
        },
      },
    })

    expect(stalePush.status).toBe(409)
    expect(stalePush.data?.code).toBe('SYNC_CONFLICT')

    // ── Server never regressed; B's local data is untouched ────────────────
    const runtimeC = await createDeviceRuntime()
    await bindDevice(runtimeC, { businessId, outletId, deviceIdentifier: deviceC, token, status: 'completed' })
    const servicesC = makeServices(runtimeC, token)
    expect((await pullUntilSettled(servicesC.pullService, contextC)).ok).toBe(true)

    const convergedOrder = findOrder(runtimeC)
    expect(convergedOrder).toBeDefined()
    expect(convergedOrder.orderStatus).toBe('Diproses')

    // B still holds its own row: nothing was silently discarded locally.
    expect(findOrder(runtimeB)).toBeDefined()
  }, 180000)
})
