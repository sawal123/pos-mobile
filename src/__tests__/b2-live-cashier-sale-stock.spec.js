/**
 * QA-RELEASE B2 — LIVE cashier sale stock movement E2E.
 *
 * Tripwire flipped: the CMD QA B2 harness had this scenario as `it.fails`
 * because `applySaleStockIdempotently` recorded the sale stock movement without
 * `transactionId` (F5/B2-2b → 403 `missing_sale_relation`). With the fix the
 * scenario is a normal, mandatory test — CI only skips it when no live backend
 * is configured.
 *
 * Drives the REAL mobile sync services (local operation journal, push service,
 * durable outbox, identity registry, Pinia stores) against a REAL Laravel
 * backend and the isolated QA database. No HTTP or service mocks.
 *
 * Run (mobile worktree):
 *   B2_E2E_BASE_URL=http://127.0.0.1:18010 \
 *   B2_E2E_EMAIL=cashier-a@example.com B2_E2E_PASSWORD=password \
 *   B2_E2E_DB=pos_qa_b2 \
 *   npx vitest run src/__tests__/b2-live-cashier-sale-stock.spec.js
 *
 * Without B2_E2E_BASE_URL the suite is skipped (no live backend is assumed).
 * The QA database must never be a developer/production database.
 */

// @vitest-environment node

import { execFileSync } from 'node:child_process'
import { describe, it, expect } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

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

const ENV = globalThis.process?.env ?? {}
const BASE = ENV?.B2_E2E_BASE_URL || ''
const EMAIL = ENV?.B2_E2E_EMAIL || 'cashier-a@example.com'
const PASSWORD = ENV?.B2_E2E_PASSWORD || 'password'
const DB = ENV?.B2_E2E_DB || 'pos_qa_b2'
const CASHIER_DEVICE = ENV?.B2_E2E_CASHIER_DEVICE || 'QA-CASHIER-A-DEV-1'
const MYSQL = 'C:\\Program Files\\MariaDB 12.1\\bin\\mysql.exe'
const RUN_E2E = BASE.length > 0

function mysqlScalar(query) {
  return execFileSync(
    MYSQL,
    ['-h', '127.0.0.1', '-P', '3306', '-u', 'root', '-B', '-N', '-D', DB, '-e', query],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
  ).trim()
}

async function api(method, path, { token, body, query } = {}) {
  const url = new URL(BASE + path)
  if (query) for (const [k, v] of Object.entries(query)) url.searchParams.set(k, String(v))
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

async function deviceRuntime() {
  const pinia = createPinia()
  setActivePinia(pinia)
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
    productStore,
    cashStore,
    customerStore,
    transactionStore,
    localOperations,
  }
}

async function bind(runtime, { businessId, outletId, deviceIdentifier, registeredDeviceId }) {
  await runtime.adapter.saveSyncPushBinding({ businessId, boundAt: new Date().toISOString() })
  await runtime.adapter.saveSyncPullBinding({
    businessId,
    outletId,
    deviceIdentifier,
    registeredDeviceId,
    boundAt: new Date().toISOString(),
  })
  await runtime.adapter.saveSyncPullState({ version: 1, cursor: 0, serverSequence: 0 })
  await runtime.adapter.saveSyncBootstrapState({
    version: 1,
    businessId,
    outletId,
    deviceIdentifier,
    registeredDeviceId,
    status: 'staged',
    stagedAt: new Date().toISOString(),
    counts: {},
  })
}

/** Real HTTP push whose response is then discarded (lost-response case). */
function cutAfterCommitTransport(token) {
  return async ({ body }) => {
    const res = await api('POST', '/api/sync/push', { token, body })
    if (res.status >= 200 && res.status < 300) {
      return {
        ok: false,
        status: 0,
        data: null,
        error: { status: 0, code: 'NETWORK_ERROR', message: 'RESPONSE_CUT_AFTER_SERVER_COMMIT' },
      }
    }
    return {
      ok: false,
      status: res.status,
      data: res.data,
      error: { code: res.data?.code ?? `HTTP_${res.status}`, message: res.data?.message ?? '' },
    }
  }
}

function realPushTransport(token) {
  return async ({ body }) => {
    const res = await api('POST', '/api/sync/push', { token, body })
    if (res.status >= 200 && res.status < 300) {
      return { ok: true, status: res.status, data: res.data, error: null }
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
      return { ok: true, status: res.status, data: res.data, error: null }
    }
    return {
      ok: false,
      status: res.status,
      data: res.data,
      error: { code: res.data?.code ?? `HTTP_${res.status}`, message: res.data?.message ?? '' },
    }
  }
}

describe.runIf(RUN_E2E)('B2 LIVE cashier sale stock movement (real services + real Laravel)', () => {
  it('syncs a sale-linked stock movement and never duplicates it on a repeated request_id', async () => {
    // ── 0. Real cashier login + context + device ─────────────────────────────
    const login = await api('POST', '/api/auth/login', {
      body: { email: EMAIL, password: PASSWORD },
    })
    expect(login.status, JSON.stringify(login.data)).toBe(200)
    const token = login.data.data.token

    const ctx = await api('GET', '/api/mobile/context', {
      token,
      query: { device_identifier: CASHIER_DEVICE },
    })
    expect(ctx.status, JSON.stringify(ctx.data)).toBe(200)
    const biz = ctx.data.data.businesses[0]
    const businessId = biz.id
    const outletId = biz.outlets[0].id
    const registeredDeviceId = String(biz.device_context.id)
    expect(biz.sync_capabilities.push_mode).toBe('cashier_safe')

    const context = {
      user: { id: 1 },
      selectedBusiness: { id: businessId },
      selectedOutlet: { id: outletId },
      cloudAccess: true,
      deviceIdentifier: CASHIER_DEVICE,
      registeredDeviceId,
    }

    const runtime = await deviceRuntime()
    await bind(runtime, { businessId, outletId, deviceIdentifier: CASHIER_DEVICE, registeredDeviceId })

    // ── 1. Pull physical products from Laravel ───────────────────────────────
    const pullService = createSyncPullService({
      adapter: runtime.adapter,
      queueService: runtime.queueService,
      registry: runtime.registry,
      pinia: runtime.pinia,
      scheduler: null,
      tokenFetcher: async () => token,
      transport: realPullTransport(token),
    })
    const pulled = await pullService.pullNow({ context })
    expect(pulled.ok, JSON.stringify(pulled)).toBe(true)

    const product = runtime.productStore.products.find((p) => (p.kind ?? 'product') === 'product')
    expect(product, 'a physical product must be available after pull').toBeTruthy()

    // ── 2. Offline sale through the production commit path ───────────────────
    const sale = await runtime.localOperations.commitRetailSale({
      checkout: {
        items: [
          { id: product.id, name: product.name, price: 15000, qty: 1, hppSnapshot: Number(product.cost) || 0 },
        ],
        subtotal: 15000,
        tax: 0,
        total: 15000,
        customer: 'Walk-in Customer',
        paymentMethod: 'cash',
        cashReceived: 20000,
        changeAmount: 5000,
      },
    })
    expect(sale).toBeTruthy()

    const movement = runtime.productStore.stockMovements.find(
      (m) => m.type === 'sale' && m.productId === product.id,
    )
    expect(movement.transactionId, 'the local movement must carry the sale relation').toBe(sale.id)

    // ── 3. First push: server commits, client loses the response ─────────────
    const lostPush = createSyncPushService({
      adapter: runtime.adapter,
      queueService: runtime.queueService,
      registry: runtime.registry,
      scheduler: null,
      tokenFetcher: async () => token,
      transport: cutAfterCommitTransport(token),
    })
    const first = await lostPush.pushNow({ context })
    expect(first.ok).toBe(false)
    expect(first.acceptance).toBe('unknown')

    const inflight = await runtime.adapter.loadSyncPushInflight()
    expect(inflight).not.toBeNull()
    const requestId = inflight.requestId

    // ── 4. Repeat with the SAME request_id: server dedupes, HTTP 200 ─────────
    const retryPush = createSyncPushService({
      adapter: runtime.adapter,
      queueService: runtime.queueService,
      registry: runtime.registry,
      scheduler: null,
      tokenFetcher: async () => token,
      transport: realPushTransport(token),
    })
    const second = await retryPush.pushNow({ context })
    expect(second.ok, JSON.stringify({ code: second.code, error: second.error })).toBe(true)
    expect(second.requestId).toBe(requestId)
    expect(second.duplicate).toBe(true)
    expect(await runtime.queueService.countPending()).toBe(0)
    expect(await runtime.adapter.loadSyncPushInflight()).toBeNull()

    // ── 5. Verify the server rows exist exactly once, with the sale link ─────
    const salesCount = Number(
      mysqlScalar(`SELECT COUNT(*) FROM sales WHERE business_id=${businessId} AND sync_id='${sale.id}'`),
    )
    expect(salesCount, 'the sale must be stored exactly once').toBe(1)

    const saleItemsCount = Number(
      mysqlScalar(
        `SELECT COUNT(*) FROM sale_items WHERE business_id=${businessId} AND sale_id=(SELECT id FROM sales WHERE sync_id='${sale.id}' LIMIT 1)`,
      ),
    )
    expect(saleItemsCount, 'the sale item must be stored exactly once').toBe(1)

    const movementCount = Number(
      mysqlScalar(
        `SELECT COUNT(*) FROM stock_movements WHERE business_id=${businessId} AND sale_sync_id='${sale.id}'`,
      ),
    )
    expect(movementCount, 'the stock movement must carry its sale link exactly once').toBe(1)

    const cashCount = Number(
      mysqlScalar(
        `SELECT COUNT(*) FROM cash_ledger WHERE business_id=${businessId} AND sale_sync_id='${sale.id}'`,
      ),
    )
    expect(cashCount, 'the cash sale must produce exactly one linked ledger row').toBe(1)

    const requestCount = Number(
      mysqlScalar(`SELECT COUNT(*) FROM sync_requests WHERE request_id='${requestId}'`),
    )
    expect(requestCount, 'the request must be recorded exactly once').toBe(1)
  }, 180000)
})
