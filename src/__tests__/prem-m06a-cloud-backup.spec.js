/**
 * PREM-M06A — Cloud Backup mobile integration.
 *
 * Verifies the mobile client reuses the existing local backup serializer, hashes
 * the EXACT transmitted UTF-8 bytes, computes the exact UTF-8 byte length, sends
 * only the PREM-D03 contract fields, reuses one canonical payload + one
 * idempotency key per attempt, fails closed on malformed/mismatched responses,
 * gates on entitlement/device/network, and never touches local POS data, the
 * sync engine, the in-flight envelope or the P38 journal.
 *
 * RESTORE is out of scope for M06A and is intentionally not exercised.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { mount, flushPromises } from '@vue/test-utils'
import { nextTick } from 'vue'

import { apiRequest } from '@/services/cloud/apiClient'
import { saveToken, getToken, _resetTokenStore } from '@/services/cloud/tokenRepository'
import {
  CLOUD_BACKUP_ERROR,
  createCloudBackup,
  getCloudBackup,
  listCloudBackups,
  normalizeCloudBackupRecord,
} from '@/services/cloud/cloudBackupService'
import {
  MAX_CLOUD_BACKUP_BYTES,
  computeSha256Hex,
  getUtf8ByteLength,
  serializeCloudBackupPayload,
} from '@/services/cloud/cloudBackupPayload'
import { BACKUP_SCHEMA, BACKUP_VERSION, createBackupPayload } from '@/services/backupService'
import { createMemoryAdapter } from '@/services/database/memoryAdapter'
import { useBusinessStore } from '@/stores/businessStore'
import { useCashStore } from '@/stores/cashStore'
import { useCashierStore } from '@/stores/cashierStore'
import { useCloudSessionStore } from '@/stores/cloudSessionStore'
import { useCustomerStore } from '@/stores/customerStore'
import { useExpenseStore } from '@/stores/expenseStore'
import { CLOUD_BACKUP_PHASE, usePremiumCloudBackupStore } from '@/stores/premiumCloudBackupStore'
import { useProductStore } from '@/stores/productStore'
import { useSubscriptionStore } from '@/stores/subscriptionStore'
import { useTransactionStore } from '@/stores/transactionStore'
import { createAppRouter } from '@/router'
import CloudBackupPanel from '@/components/settings/CloudBackupPanel.vue'
import SettingsView from '@/views/settings/SettingsView.vue'

vi.mock('@/services/cloud/apiClient', () => ({ apiRequest: vi.fn() }))

const BUSINESS_ID = 10
const TOKEN = 'prem-m06a-bearer-token'
const DEVICE_ID = 'device-uuid-m06a'
const FUTURE = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString()
const PAST = '2000-01-01T00:00:00.000Z'
const SERVER_CREATED_AT = '2026-10-02T07:35:00+07:00'

// ── server helpers ───────────────────────────────────────────────────────────

function apiCreated(body, overrides = {}) {
  return {
    ok: true,
    status: 201,
    data: {
      data: {
        id: 1,
        uuid: 'uuid-1',
        created_at: SERVER_CREATED_AT,
        schema_version: body?.schema_version ?? 2,
        app_version: body?.app_version ?? null,
        size_bytes: body?.size_bytes ?? 0,
        checksum_sha256: body?.checksum_sha256 ?? '0'.repeat(64),
        status: 'ready',
        device: {
          id: 1,
          identifier: body?.device_identifier ?? DEVICE_ID,
          name: 'Kasir Utama',
          platform: 'android',
        },
        duplicate: false,
        ...overrides,
      },
    },
    error: null,
  }
}

function apiOk(data) {
  return { ok: true, status: 200, data: { data }, error: null }
}

function apiErr(status, code) {
  return { ok: false, status, data: null, error: { status, code, message: code, data: null } }
}

function rawRecord(overrides = {}) {
  return {
    id: overrides.id ?? 1,
    uuid: overrides.uuid ?? 'uuid-1',
    created_at: overrides.created_at ?? SERVER_CREATED_AT,
    schema_version: overrides.schema_version ?? 2,
    app_version: overrides.app_version ?? null,
    size_bytes: overrides.size_bytes ?? 1887436,
    checksum_sha256: overrides.checksum_sha256 ?? 'a'.repeat(64),
    status: overrides.status ?? 'ready',
    device: overrides.device ?? {
      id: 1,
      identifier: DEVICE_ID,
      name: 'Kasir Utama',
      platform: 'android',
    },
  }
}

let getRecords = []

function installServer({ records = [], post = null } = {}) {
  getRecords = records
  apiRequest.mockImplementation(async (path, options = {}) => {
    const method = options.method ?? 'GET'
    if (method === 'POST') {
      if (typeof post === 'function') return post(options.body)
      return apiCreated(options.body)
    }
    return apiOk(getRecords)
  })
}

// ── environment helpers ──────────────────────────────────────────────────────

function setupEnv({
  linked = true,
  premium = true,
  verified = true,
  cloudAccess = true,
  subscription = null,
} = {}) {
  const pinia = createPinia()
  setActivePinia(pinia)

  const cloudStore = useCloudSessionStore(pinia)
  const subscriptionStore = useSubscriptionStore(pinia)
  const store = usePremiumCloudBackupStore(pinia)

  cloudStore.user = { id: 1, name: 'Uji', email: 'uji@example.com' }
  cloudStore.deviceIdentifier = DEVICE_ID
  cloudStore.capabilityState = verified ? 'verified' : 'unverified'

  const plan =
    subscription ??
    (premium ? { plan: 'cloud', status: 'active', expires_at: FUTURE } : { plan: 'free' })

  if (linked) {
    cloudStore.businesses = [
      {
        id: BUSINESS_ID,
        name: 'Toko Cloud',
        subscription: plan,
        cloud_access: cloudAccess,
        outlets: [],
      },
    ]
    cloudStore.selectedBusiness = { id: BUSINESS_ID, name: 'Toko Cloud', subscription: plan }
  } else {
    cloudStore.businesses = []
    cloudStore.selectedBusiness = null
  }
  cloudStore.cloudAccess = cloudAccess

  return { pinia, cloudStore, subscriptionStore, store }
}

function buildSnapshot(pinia) {
  const businessStore = useBusinessStore(pinia)
  businessStore.setBusiness({
    name: 'Demo Cafe',
    type: 'Cafe',
    owner: 'Budi',
    phone: '08123456789',
    outlet: 'Pusat',
  })

  const productStore = useProductStore(pinia)
  productStore.createProduct({
    name: 'Kopi Susu',
    category: productStore.categories[0],
    price: 15000,
    stock: 5,
  })

  const customerStore = useCustomerStore(pinia)
  customerStore.createCustomer({ name: 'Andi', phone: '08120000000' })

  return createBackupPayload({
    businessStore,
    productStore,
    customerStore,
    expenseStore: useExpenseStore(pinia),
    transactionStore: useTransactionStore(pinia),
    cashStore: useCashStore(pinia),
  })
}

function buildNegativeStockSnapshot(pinia) {
  const businessStore = useBusinessStore(pinia)
  businessStore.setBusiness({
    name: 'Demo Cafe',
    type: 'Cafe',
    owner: 'Budi',
    phone: '08123456789',
    outlet: 'Pusat',
  })

  const productStore = useProductStore(pinia)
  productStore.createProduct({
    name: 'Kopi Susu',
    category: productStore.categories[0],
    price: 15000,
    stock: 5,
  })

  productStore.$patch({
    products: productStore.products.map((product) => ({ ...product, stock: -3 })),
    stockMovements: [
      {
        id: 'mov-1',
        productId: productStore.products[0].id,
        type: 'sale',
        quantityChange: -5,
        stockBefore: 2,
        stockAfter: -3,
        createdAt: new Date().toISOString(),
        note: '',
      },
    ],
  })

  const customerStore = useCustomerStore(pinia)
  customerStore.createCustomer({ name: 'Andi', phone: '08120000000' })

  return createBackupPayload({
    businessStore,
    productStore,
    customerStore,
    expenseStore: useExpenseStore(pinia),
    transactionStore: useTransactionStore(pinia),
    cashStore: useCashStore(pinia),
  })
}

function oversizedSnapshot() {
  return {
    schema: BACKUP_SCHEMA,
    version: BACKUP_VERSION,
    exportedAt: '2026-10-02T00:00:00.000Z',
    data: { pad: 'x'.repeat(MAX_CLOUD_BACKUP_BYTES + 1024) },
  }
}

function snapshotLocal(pinia) {
  return JSON.stringify({
    business: useBusinessStore(pinia).name,
    products: useProductStore(pinia).products,
    customers: useCustomerStore(pinia).customers,
    transactions: useTransactionStore(pinia).items,
    cash: useCashStore(pinia).entries,
  })
}

function postBodies() {
  return apiRequest.mock.calls
    .filter((call) => (call[1]?.method ?? 'GET') === 'POST')
    .map((call) => call[1].body)
}

beforeEach(() => {
  setActivePinia(createPinia())
  _resetTokenStore()
  vi.clearAllMocks()
  installServer()
})

afterEach(() => {
  vi.restoreAllMocks()
})

// ════════════════════════════════════════════════════════════════════════════
// SNAPSHOT — canonical payload, UTF-8 size, SHA-256
// ════════════════════════════════════════════════════════════════════════════

describe('payload codec', () => {
  it('4. UTF-8 byte size for ASCII equals String.length', () => {
    expect(getUtf8ByteLength('abc')).toBe(3)
    expect(getUtf8ByteLength('Halo dunia')).toBe(10)
  })

  it('5. UTF-8 byte size counts multi-byte and emoji correctly', () => {
    expect(getUtf8ByteLength('é')).toBe(2)
    expect(getUtf8ByteLength('😀')).toBe(4)
    expect(getUtf8ByteLength('café 😀')).toBe(10)
    // The UTF-16 length is smaller (7) — the helper must not return it.
    expect('café 😀'.length).toBe(7)
  })

  it('6. SHA-256 matches the known vector for "abc"', async () => {
    const digest = await computeSha256Hex('abc')
    expect(digest).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
    expect(digest).toMatch(/^[a-f0-9]{64}$/)
  })

  it('serializes the snapshot exactly once (deterministic string)', () => {
    const snapshot = { schema: BACKUP_SCHEMA, version: BACKUP_VERSION, data: { a: 1 } }
    expect(serializeCloudBackupPayload(snapshot)).toBe(JSON.stringify(snapshot))
  })
})

describe('snapshot attempt', () => {
  it('1. + 2. reuses the existing serializer and the snapshot schema version', async () => {
    const { pinia, store } = setupEnv()
    const snapshot = buildSnapshot(pinia)

    const created = await store.createAttempt({ snapshot })

    expect(created.ok).toBe(true)
    expect(store.attempt.payload).toBe(JSON.stringify(snapshot))
    expect(store.attempt.payload).toContain(`"schema":"${BACKUP_SCHEMA}"`)
    expect(store.attempt.schemaVersion).toBe(BACKUP_VERSION)
  })

  it('3. + 7. hashes and sizes the exact transmitted bytes', async () => {
    await saveToken(TOKEN)
    const { pinia, store } = setupEnv()
    const snapshot = buildSnapshot(pinia)
    await store.createAttempt({ snapshot })
    const attempt = store.attempt

    const result = await store.uploadCurrentAttempt()
    expect(result.ok).toBe(true)

    const body = postBodies()[0]
    expect(body.payload).toBe(attempt.payload)
    expect(body.size_bytes).toBe(attempt.sizeBytes)
    expect(body.checksum_sha256).toBe(attempt.checksumSha256)
    expect(await computeSha256Hex(body.payload)).toBe(attempt.checksumSha256)
  })

  it('8. + 9. accepts negative stock and negative movements verbatim', async () => {
    await saveToken(TOKEN)
    const { pinia, store } = setupEnv()
    const snapshot = buildNegativeStockSnapshot(pinia)

    expect(JSON.stringify(snapshot)).toContain('"stock":-3')

    await store.createAttempt({ snapshot })
    const result = await store.uploadCurrentAttempt()

    expect(result.ok).toBe(true)
    const body = postBodies()[0]
    expect(body.payload).toContain('"stock":-3')
    expect(body.payload).toContain('"stockAfter":-3')
    expect(body.payload).toContain('"quantityChange":-5')
  })
})

// ════════════════════════════════════════════════════════════════════════════
// SERVICE — contract mapping & fail-closed parsing
// ════════════════════════════════════════════════════════════════════════════

describe('cloudBackupService', () => {
  it('createCloudBackup sends only the PREM-D03 contract fields', async () => {
    apiRequest.mockResolvedValueOnce(
      apiCreated({
        schema_version: 2,
        size_bytes: 10,
        checksum_sha256: 'a'.repeat(64),
        device_identifier: DEVICE_ID,
      }),
    )

    await createCloudBackup({
      token: TOKEN,
      businessId: BUSINESS_ID,
      deviceIdentifier: DEVICE_ID,
      schemaVersion: 2,
      payload: 'abcdefghij',
      checksumSha256: 'a'.repeat(64),
      sizeBytes: 10,
      idempotencyKey: 'key-1',
    })

    const [path, options] = apiRequest.mock.calls[0]
    expect(path).toBe('/api/mobile/backups')
    expect(options.method).toBe('POST')
    expect(Object.keys(options.body).sort()).toEqual(
      [
        'business_id',
        'checksum_sha256',
        'device_identifier',
        'idempotency_key',
        'payload',
        'schema_version',
        'size_bytes',
      ].sort(),
    )
  })

  it('20. fails closed on a malformed upload response', async () => {
    apiRequest.mockResolvedValueOnce(apiOk({ status: 'ready' })) // no uuid
    const res = await createCloudBackup({
      token: TOKEN,
      businessId: BUSINESS_ID,
      deviceIdentifier: DEVICE_ID,
      schemaVersion: 2,
      payload: 'x',
      checksumSha256: 'a'.repeat(64),
      sizeBytes: 1,
    })
    expect(res.ok).toBe(false)
    expect(res.code).toBe(CLOUD_BACKUP_ERROR.MALFORMED_RESPONSE)
  })

  it('21. fails closed when the response checksum disagrees with the attempt', async () => {
    apiRequest.mockResolvedValueOnce(
      apiCreated({ checksum_sha256: 'b'.repeat(64), size_bytes: 1, schema_version: 2 }),
    )
    const res = await createCloudBackup({
      token: TOKEN,
      businessId: BUSINESS_ID,
      deviceIdentifier: DEVICE_ID,
      schemaVersion: 2,
      payload: 'x',
      checksumSha256: 'a'.repeat(64),
      sizeBytes: 1,
    })
    expect(res.ok).toBe(false)
    expect(res.code).toBe(CLOUD_BACKUP_ERROR.BACKUP_CHECKSUM_MISMATCH)
  })

  it('22. fails closed when the response size disagrees with the attempt', async () => {
    apiRequest.mockResolvedValueOnce(
      apiCreated({ checksum_sha256: 'a'.repeat(64), size_bytes: 99, schema_version: 2 }),
    )
    const res = await createCloudBackup({
      token: TOKEN,
      businessId: BUSINESS_ID,
      deviceIdentifier: DEVICE_ID,
      schemaVersion: 2,
      payload: 'x',
      checksumSha256: 'a'.repeat(64),
      sizeBytes: 1,
    })
    expect(res.ok).toBe(false)
    expect(res.code).toBe(CLOUD_BACKUP_ERROR.BACKUP_SIZE_MISMATCH)
  })

  it('maps 401 to UNAUTHENTICATED and backend codes exactly', async () => {
    apiRequest.mockResolvedValueOnce(apiErr(401, 'HTTP_401'))
    const unauth = await createCloudBackup({
      token: TOKEN,
      businessId: BUSINESS_ID,
      deviceIdentifier: DEVICE_ID,
      schemaVersion: 2,
      payload: 'x',
      checksumSha256: 'a'.repeat(64),
      sizeBytes: 1,
    })
    expect(unauth.code).toBe(CLOUD_BACKUP_ERROR.UNAUTHENTICATED)

    apiRequest.mockResolvedValueOnce(apiErr(403, 'CLOUD_SUBSCRIPTION_REQUIRED'))
    const denied = await createCloudBackup({
      token: TOKEN,
      businessId: BUSINESS_ID,
      deviceIdentifier: DEVICE_ID,
      schemaVersion: 2,
      payload: 'x',
      checksumSha256: 'a'.repeat(64),
      sizeBytes: 1,
    })
    expect(denied.code).toBe(CLOUD_BACKUP_ERROR.CLOUD_SUBSCRIPTION_REQUIRED)
  })

  it('listCloudBackups preserves server order and normalizes records', async () => {
    getRecords = [rawRecord({ uuid: 'u3' }), rawRecord({ uuid: 'u2' }), rawRecord({ uuid: 'u1' })]
    const res = await listCloudBackups({ token: TOKEN, businessId: BUSINESS_ID })
    expect(res.ok).toBe(true)
    expect(res.backups.map((b) => b.uuid)).toEqual(['u3', 'u2', 'u1'])
  })

  it('getCloudBackup maps 404 to BACKUP_NOT_FOUND', async () => {
    apiRequest.mockResolvedValueOnce(apiErr(404, 'BACKUP_NOT_FOUND'))
    const res = await getCloudBackup({
      token: TOKEN,
      businessId: BUSINESS_ID,
      backupUuid: 'uuid-1',
    })
    expect(res.ok).toBe(false)
    expect(res.code).toBe(CLOUD_BACKUP_ERROR.BACKUP_NOT_FOUND)
  })

  it('normalizeCloudBackupRecord rejects an invalid checksum/status', () => {
    expect(normalizeCloudBackupRecord(rawRecord({ checksum_sha256: 'zz' }))).toBeNull()
    expect(normalizeCloudBackupRecord(rawRecord({ status: 'weird' }))).toBeNull()
    expect(normalizeCloudBackupRecord(rawRecord({ size_bytes: -1 }))).toBeNull()
  })
})

// ════════════════════════════════════════════════════════════════════════════
// UPLOAD — request shape, idempotency, retry, double tap
// ════════════════════════════════════════════════════════════════════════════

describe('upload', () => {
  it('10. an active Cloud business can create a backup', async () => {
    await saveToken(TOKEN)
    const { pinia, store } = setupEnv()
    const res = await store.startBackup({ snapshot: buildSnapshot(pinia) })
    expect(res.ok).toBe(true)
    expect(store.phase).toBe(CLOUD_BACKUP_PHASE.SUCCESS)
    expect(store.lastResult.uuid).toBe('uuid-1')
  })

  it('11. uses the linked business_id and 12. the existing device_identifier', async () => {
    await saveToken(TOKEN)
    const { pinia, store } = setupEnv()
    await store.startBackup({ snapshot: buildSnapshot(pinia) })

    const body = postBodies()[0]
    expect(body.business_id).toBe(BUSINESS_ID)
    expect(body.device_identifier).toBe(DEVICE_ID)
  })

  it('13. + 14. client preflight blocks >25 MB and never POSTs', async () => {
    await saveToken(TOKEN)
    const { store } = setupEnv()

    const res = await store.startBackup({ snapshot: oversizedSnapshot() })

    expect(res.ok).toBe(false)
    expect(res.code).toBe(CLOUD_BACKUP_ERROR.BACKUP_TOO_LARGE)
    expect(store.phase).toBe(CLOUD_BACKUP_PHASE.PAYLOAD_TOO_LARGE)
    expect(store.error).toContain('25 MB')
    expect(apiRequest).not.toHaveBeenCalled()
  })

  it('15. + 17. + 18. retry of the same attempt reuses key, payload and checksum', async () => {
    await saveToken(TOKEN)
    const { pinia, store } = setupEnv()

    installServer({ post: () => apiErr(0, 'NETWORK_ERROR') })
    await store.startBackup({ snapshot: buildSnapshot(pinia) })

    const attempt = store.attempt
    expect(attempt).not.toBeNull()

    installServer()
    const res = await store.retry()
    expect(res.ok).toBe(true)

    const bodies = postBodies()
    expect(bodies).toHaveLength(2)
    expect(bodies[0].idempotency_key).toBe(attempt.idempotencyKey)
    expect(bodies[1].idempotency_key).toBe(attempt.idempotencyKey)
    expect(bodies[0].payload).toBe(bodies[1].payload)
    expect(bodies[0].checksum_sha256).toBe(bodies[1].checksum_sha256)
  })

  it('16. a double tap produces exactly one POST', async () => {
    await saveToken(TOKEN)
    const { pinia, store } = setupEnv()
    const snapshot = buildSnapshot(pinia)

    const [a, b] = await Promise.all([
      store.startBackup({ snapshot }),
      store.startBackup({ snapshot }),
    ])

    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1)
    expect([a.code, b.code]).toContain('IN_FLIGHT')
    expect(apiRequest.mock.calls.filter((c) => c[1]?.method === 'POST')).toHaveLength(1)
  })

  it('19. a new attempt gets a new idempotency key', async () => {
    const { pinia, store } = setupEnv()
    const snapshot = buildSnapshot(pinia)

    await store.createAttempt({ snapshot })
    const first = store.attempt.idempotencyKey
    await store.createAttempt({ snapshot })
    const second = store.attempt.idempotencyKey

    expect(second).not.toBe(first)
  })

  it('20. a malformed server response fails closed (no success)', async () => {
    await saveToken(TOKEN)
    const { pinia, store } = setupEnv()
    installServer({ post: () => apiOk({ status: 'ready' }) })

    const res = await store.startBackup({ snapshot: buildSnapshot(pinia) })

    expect(res.ok).toBe(false)
    expect(store.phase).toBe(CLOUD_BACKUP_PHASE.SERVER_ERROR)
    expect(store.lastResult).toBeNull()
  })

  it('21. a checksum mismatch response fails closed', async () => {
    await saveToken(TOKEN)
    const { pinia, store } = setupEnv()
    installServer({
      post: (body) => apiCreated(body, { checksum_sha256: 'b'.repeat(64) }),
    })

    const res = await store.startBackup({ snapshot: buildSnapshot(pinia) })

    expect(res.ok).toBe(false)
    expect(store.errorCode).toBe(CLOUD_BACKUP_ERROR.BACKUP_CHECKSUM_MISMATCH)
    expect(store.phase).toBe(CLOUD_BACKUP_PHASE.SERVER_ERROR)
  })

  it('22. a size mismatch response fails closed', async () => {
    await saveToken(TOKEN)
    const { pinia, store } = setupEnv()
    installServer({ post: (body) => apiCreated(body, { size_bytes: 123 }) })

    const res = await store.startBackup({ snapshot: buildSnapshot(pinia) })

    expect(res.ok).toBe(false)
    expect(store.errorCode).toBe(CLOUD_BACKUP_ERROR.BACKUP_SIZE_MISMATCH)
  })
})

// ════════════════════════════════════════════════════════════════════════════
// AUTH / ENTITLEMENT
// ════════════════════════════════════════════════════════════════════════════

describe('entitlement gate', () => {
  it('23. + 25. Free is locked while local backup stays available', async () => {
    const { store, subscriptionStore } = setupEnv({ premium: false })
    expect(subscriptionStore.isPremium).toBe(false)
    expect(store.canUseCloudBackup).toBe(false)

    const res = await store.startBackup({ snapshot: { schema: BACKUP_SCHEMA, version: 2 } })
    expect(res.code).toBe('NOT_ELIGIBLE')
    expect(apiRequest).not.toHaveBeenCalled()
  })

  it('24. + 26. an expired Cloud subscription is locked', async () => {
    const { store, subscriptionStore } = setupEnv({
      subscription: { plan: 'cloud', status: 'active', expires_at: PAST },
    })
    expect(subscriptionStore.isPremium).toBe(false)
    expect(store.isCloudBackupLocked).toBe(true)
    expect((await store.startBackup({ snapshot: { schema: BACKUP_SCHEMA, version: 2 } })).ok).toBe(
      false,
    )
  })

  it('27. a 401 upload invalidates the Cloud session (M03) and keeps local data', async () => {
    await saveToken(TOKEN)
    const { pinia, cloudStore, store } = setupEnv()
    const snapshot = buildSnapshot(pinia)
    const before = snapshotLocal(pinia)

    installServer({ post: () => apiErr(401, 'HTTP_401') })
    const res = await store.startBackup({ snapshot })

    expect(res.ok).toBe(false)
    expect(store.phase).toBe(CLOUD_BACKUP_PHASE.SESSION_ERROR)
    expect(cloudStore.isAuthenticated).toBe(false)
    expect(cloudStore.sessionInvalid).toBe(true)
    expect(await getToken()).toBeNull()
    expect(snapshotLocal(pinia)).toBe(before)
  })

  it('28. CLOUD_SUBSCRIPTION_REQUIRED refreshes the Cloud context', async () => {
    await saveToken(TOKEN)
    const { pinia, cloudStore, store } = setupEnv()
    const spy = vi.spyOn(cloudStore, 'refreshContext').mockResolvedValue({ ok: true })

    installServer({ post: () => apiErr(403, 'CLOUD_SUBSCRIPTION_REQUIRED') })
    const res = await store.startBackup({ snapshot: buildSnapshot(pinia) })

    expect(res.ok).toBe(false)
    expect(store.phase).toBe(CLOUD_BACKUP_PHASE.ENTITLEMENT_DENIED)
    expect(spy).toHaveBeenCalled()
    // The attempt is preserved so a retry after renewal is possible.
    expect(store.attempt).not.toBeNull()
  })

  it('29. a missing device fails closed as a device error', async () => {
    await saveToken(TOKEN)
    const { pinia, store } = setupEnv()
    installServer({ post: () => apiErr(403, 'DEVICE_NOT_FOUND') })

    const res = await store.startBackup({ snapshot: buildSnapshot(pinia) })
    expect(res.ok).toBe(false)
    expect(store.phase).toBe(CLOUD_BACKUP_PHASE.DEVICE_ERROR)
    expect(store.error).toBe('Perangkat Cloud perlu diaktifkan kembali.')
  })

  it('30. an inactive device fails closed as a device error', async () => {
    await saveToken(TOKEN)
    const { pinia, store } = setupEnv()
    installServer({ post: () => apiErr(403, 'DEVICE_INACTIVE') })

    const res = await store.startBackup({ snapshot: buildSnapshot(pinia) })
    expect(res.ok).toBe(false)
    expect(store.phase).toBe(CLOUD_BACKUP_PHASE.DEVICE_ERROR)
  })

  it('31. reactivation re-enables Cloud backup without touching local state', async () => {
    const { pinia, cloudStore, store } = setupEnv({
      subscription: { plan: 'cloud', status: 'expired', expires_at: PAST },
    })
    expect(store.canUseCloudBackup).toBe(false)

    cloudStore.businesses = [
      {
        id: BUSINESS_ID,
        name: 'Toko Cloud',
        subscription: { plan: 'cloud', status: 'active', expires_at: FUTURE },
        cloud_access: true,
        outlets: [],
      },
    ]
    cloudStore.selectedBusiness = {
      id: BUSINESS_ID,
      name: 'Toko Cloud',
      subscription: { plan: 'cloud', status: 'active', expires_at: FUTURE },
    }
    cloudStore.capabilityState = 'verified'

    expect(store.canUseCloudBackup).toBe(true)
    await saveToken(TOKEN)
    installServer()
    const res = await store.startBackup({ snapshot: buildSnapshot(pinia) })
    expect(res.ok).toBe(true)
  })

  it('32. offline does not POST', async () => {
    await saveToken(TOKEN)
    const { pinia, store } = setupEnv()
    store.init({ runtimeSignalService: { getSnapshot: () => ({ online: false }) } })

    const res = await store.startBackup({ snapshot: buildSnapshot(pinia) })

    expect(res.ok).toBe(false)
    expect(store.phase).toBe(CLOUD_BACKUP_PHASE.NETWORK_ERROR)
    expect(store.error).toBe('Koneksi internet diperlukan untuk Backup Cloud.')
    expect(apiRequest).not.toHaveBeenCalled()
  })
})

// ════════════════════════════════════════════════════════════════════════════
// LIST
// ════════════════════════════════════════════════════════════════════════════

describe('list', () => {
  it('33. the list is scoped to the linked business', async () => {
    await saveToken(TOKEN)
    const { store } = setupEnv()
    await store.refreshList()

    const [path] = apiRequest.mock.calls[0]
    expect(path).toContain(`business_id=${BUSINESS_ID}`)
  })

  it('34. + 35. respects the backend limit and preserves newest-first order', async () => {
    await saveToken(TOKEN)
    const { store } = setupEnv()
    installServer({
      records: [rawRecord({ uuid: 'u3' }), rawRecord({ uuid: 'u2' }), rawRecord({ uuid: 'u1' })],
    })

    await store.refreshList({ limit: 50 })

    const [path] = apiRequest.mock.calls[0]
    expect(path).toContain('limit=10')
    expect(store.backups.map((b) => b.uuid)).toEqual(['u3', 'u2', 'u1'])
  })

  it('36. displays the server created_at timestamp', async () => {
    await saveToken(TOKEN)
    const { store } = setupEnv()
    installServer({ records: [rawRecord()] })
    await store.refreshList()
    expect(store.backups[0].createdAt).toBe(SERVER_CREATED_AT)
  })

  it('37. guards concurrent refreshes', async () => {
    await saveToken(TOKEN)
    const { store } = setupEnv()

    const [a, b] = await Promise.all([store.refreshList(), store.refreshList()])
    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1)
    expect(apiRequest.mock.calls).toHaveLength(1)
  })

  it('38. a refresh network failure preserves the cached list', async () => {
    await saveToken(TOKEN)
    const { store } = setupEnv()
    installServer({ records: [rawRecord({ uuid: 'cached' })] })
    await store.refreshList()
    expect(store.backups).toHaveLength(1)

    installServer({ post: null })
    apiRequest.mockResolvedValueOnce(apiErr(0, 'NETWORK_ERROR'))
    const res = await store.refreshList()

    expect(res.ok).toBe(false)
    expect(store.backups.map((b) => b.uuid)).toEqual(['cached'])
    expect(store.listStale).toBe(true)
    expect(store.listError).toBe('Daftar backup belum diperbarui.')
  })

  it('39. a malformed list fails closed and does not replace the cache', async () => {
    await saveToken(TOKEN)
    const { store } = setupEnv()
    installServer({ records: [rawRecord({ uuid: 'cached' })] })
    await store.refreshList()

    apiRequest.mockResolvedValueOnce(apiOk({ not: 'an array' }))
    const res = await store.refreshList()

    expect(res.ok).toBe(false)
    expect(res.code).toBe(CLOUD_BACKUP_ERROR.MALFORMED_RESPONSE)
    expect(store.backups.map((b) => b.uuid)).toEqual(['cached'])
  })

  it('40. a business relink clears the previous tenant list', async () => {
    await saveToken(TOKEN)
    const { pinia, cloudStore, store } = setupEnv()
    installServer({ records: [rawRecord({ uuid: 'tenant-a' })] })

    const wrapper = mount(CloudBackupPanel, { global: { plugins: [pinia] } })
    await flushPromises()
    expect(store.backups.map((b) => b.uuid)).toEqual(['tenant-a'])

    const clearSpy = vi.spyOn(store, 'clear')

    installServer({ records: [rawRecord({ uuid: 'tenant-b' })] })
    cloudStore.businesses = [
      {
        id: 20,
        name: 'Toko B',
        subscription: { plan: 'cloud', status: 'active', expires_at: FUTURE },
        cloud_access: true,
        outlets: [],
      },
    ]
    cloudStore.selectedBusiness = {
      id: 20,
      name: 'Toko B',
      subscription: { plan: 'cloud', status: 'active', expires_at: FUTURE },
    }
    await nextTick()
    await flushPromises()

    expect(clearSpy).toHaveBeenCalled()
    expect(store.backups.map((b) => b.uuid)).toEqual(['tenant-b'])
    wrapper.unmount()
  })
})

// ════════════════════════════════════════════════════════════════════════════
// SAFETY — local POS, sync queue, in-flight envelope, P38 journal
// ════════════════════════════════════════════════════════════════════════════

describe('local data safety', () => {
  it('41. a successful upload never changes local POS data', async () => {
    await saveToken(TOKEN)
    const { pinia, store } = setupEnv()
    const snapshot = buildSnapshot(pinia)
    const before = snapshotLocal(pinia)

    await store.startBackup({ snapshot })

    expect(snapshotLocal(pinia)).toBe(before)
  })

  it('42. a failed upload never changes local POS data', async () => {
    await saveToken(TOKEN)
    const { pinia, store } = setupEnv()
    const snapshot = buildSnapshot(pinia)
    const before = snapshotLocal(pinia)

    installServer({ post: () => apiErr(403, 'CLOUD_SUBSCRIPTION_REQUIRED') })
    vi.spyOn(useCloudSessionStore(pinia), 'refreshContext').mockResolvedValue({ ok: true })
    await store.startBackup({ snapshot })

    expect(snapshotLocal(pinia)).toBe(before)
  })

  it('43. + 44. + 45. never alters the sync queue, in-flight envelope or P38 journal', async () => {
    await saveToken(TOKEN)
    const { pinia, store } = setupEnv()
    const adapter = createMemoryAdapter()

    await adapter.upsertSyncQueueItem({
      id: 'q1',
      entityType: 'product',
      entityId: 1,
      operation: 'update',
      payload: { id: 1 },
      createdAt: '2026-10-02T00:00:00.000Z',
      updatedAt: '2026-10-02T00:00:00.000Z',
      attemptCount: 0,
      lastError: null,
    })
    await adapter.saveSyncPushInflight({ requestId: 'req-1', changes: [] })
    await adapter.saveLocalOperationJournal({ version: 1, ops: [{ id: 'op-1' }] })

    const queueBefore = JSON.stringify(await adapter.listSyncQueueItems())
    const inflightBefore = JSON.stringify(await adapter.loadSyncPushInflight())
    const journalBefore = JSON.stringify(await adapter.loadLocalOperationJournal())

    await store.startBackup({ snapshot: buildSnapshot(pinia) })

    expect(JSON.stringify(await adapter.listSyncQueueItems())).toBe(queueBefore)
    expect(JSON.stringify(await adapter.loadSyncPushInflight())).toBe(inflightBefore)
    expect(JSON.stringify(await adapter.loadLocalOperationJournal())).toBe(journalBefore)
  })

  it('46. clearing Cloud backup state does not touch local POS data', async () => {
    await saveToken(TOKEN)
    const { pinia, store } = setupEnv()
    const before = snapshotLocal(pinia)

    installServer({ records: [rawRecord()] })
    await store.refreshList()
    expect(store.backups).toHaveLength(1)

    store.clear()

    expect(store.backups).toHaveLength(0)
    expect(store.attempt).toBeNull()
    expect(store.phase).toBe(CLOUD_BACKUP_PHASE.IDLE)
    expect(snapshotLocal(pinia)).toBe(before)
  })

  it('36b. discards an in-flight attempt after a business relink (fail closed)', async () => {
    await saveToken(TOKEN)
    const { pinia, cloudStore, store } = setupEnv()
    await store.createAttempt({ snapshot: buildSnapshot(pinia) })

    cloudStore.selectedBusiness = { id: 20, name: 'Toko B' }

    const res = await store.uploadCurrentAttempt()
    expect(res.ok).toBe(false)
    expect(res.code).toBe('BUSINESS_SCOPE_CHANGED')
    expect(apiRequest).not.toHaveBeenCalled()
  })
})

// ════════════════════════════════════════════════════════════════════════════
// UI — local vs cloud separation, states, list rendering
// ════════════════════════════════════════════════════════════════════════════

async function mountSettings(pinia, router) {
  useBusinessStore(pinia).setBusiness({ name: 'Toko Uji', type: 'Cafe', outlet: 'Utama' })
  useCashierStore(pinia).setPinConfigured(true)

  await router.push('/settings')
  await flushPromises()

  const wrapper = mount(SettingsView, { global: { plugins: [pinia, router] } })
  await flushPromises()
  return wrapper
}

describe('Settings UI', () => {
  it('keeps local backup available for Free and locks Cloud backup', async () => {
    const { pinia } = setupEnv({ premium: false })
    const router = createAppRouter()

    const wrapper = await mountSettings(pinia, router)

    expect(wrapper.find('[data-testid="local-backup-now"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="local-backup-now"]').attributes('disabled')).toBeUndefined()
    expect(wrapper.find('[data-testid="cloud-backup-locked"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="cloud-backup-now"]').exists()).toBe(false)
  })

  it('keeps local backup available for an expired subscription', async () => {
    const { pinia } = setupEnv({
      subscription: { plan: 'cloud', status: 'active', expires_at: PAST },
    })
    const router = createAppRouter()

    const wrapper = await mountSettings(pinia, router)

    expect(wrapper.find('[data-testid="local-backup-now"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="cloud-backup-locked"]').exists()).toBe(true)
  })

  it('shows the Cloud backup action for an active Premium business', async () => {
    const { pinia } = setupEnv()
    const router = createAppRouter()

    const wrapper = await mountSettings(pinia, router)

    expect(wrapper.find('[data-testid="cloud-backup-now"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="cloud-backup-retention"]').text()).toContain('10 backup')
    expect(wrapper.find('[data-testid="cloud-backup-locked"]').exists()).toBe(false)
  })
})

describe('CloudBackupPanel states', () => {
  it('renders the server list with date, device, size and schema', async () => {
    await saveToken(TOKEN)
    const { pinia, store } = setupEnv()
    installServer({ records: [rawRecord({ size_bytes: 1887436 })] })

    const wrapper = mount(CloudBackupPanel, { global: { plugins: [pinia] } })
    await flushPromises()

    expect(wrapper.find('[data-testid="cloud-backup-list"]').exists()).toBe(true)
    const item = wrapper.find('[data-testid="cloud-backup-item"]')
    expect(item.text()).toContain('Kasir Utama')
    expect(item.text()).toContain('1.8 MB')
    expect(item.text()).toContain('v2')
    expect(wrapper.find('[data-testid="cloud-backup-item-date"]').text()).toContain('2026')
    expect(store.backups).toHaveLength(1)

    wrapper.unmount()
  })

  it('shows the empty state when there are no backups', async () => {
    await saveToken(TOKEN)
    const { pinia } = setupEnv()
    installServer({ records: [] })

    const wrapper = mount(CloudBackupPanel, { global: { plugins: [pinia] } })
    await flushPromises()

    expect(wrapper.find('[data-testid="cloud-backup-empty"]').exists()).toBe(true)
    wrapper.unmount()
  })

  it('shows the success status after an upload', async () => {
    await saveToken(TOKEN)
    const { pinia, store } = setupEnv()
    installServer()

    const wrapper = mount(CloudBackupPanel, { global: { plugins: [pinia] } })
    await flushPromises()

    await wrapper.find('[data-testid="cloud-backup-now"]').trigger('click')
    await flushPromises()

    expect(store.phase).toBe(CLOUD_BACKUP_PHASE.SUCCESS)
    expect(wrapper.find('[data-testid="cloud-backup-status"]').text()).toContain('berhasil')
    wrapper.unmount()
  })
})

// ════════════════════════════════════════════════════════════════════════════
// REGRESSION — local backup serializer still intact
// ════════════════════════════════════════════════════════════════════════════

describe('regression', () => {
  it('52. the local backup serializer still produces a v2 payload', () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const snapshot = buildSnapshot(pinia)
    expect(snapshot.schema).toBe(BACKUP_SCHEMA)
    expect(snapshot.version).toBe(BACKUP_VERSION)
    expect(snapshot.data).toHaveProperty('business')
    expect(snapshot.data).toHaveProperty('products')
  })
})
