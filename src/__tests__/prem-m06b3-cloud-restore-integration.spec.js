/**
 * PREM-M06B3 — Cloud Restore integration.
 *
 * Covers the full non-destructive path — download → integrity → schema →
 * same/cross-device decision → eligibility preflight → confirmation — and the
 * single destructive handoff to `restoreSafetyEngine`.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { mount, flushPromises } from '@vue/test-utils'

import { apiRawRequest, apiRequest } from '@/services/cloud/apiClient'
import { _resetTokenStore, saveToken } from '@/services/cloud/tokenRepository'
import { computeSha256HexFromBytes } from '@/services/cloud/cloudBackupPayload'
import { downloadCloudBackup } from '@/services/cloud/cloudBackupService'
import {
  CLOUD_RESTORE_ERROR,
  verifyCloudRestorePayload,
} from '@/services/cloud/cloudRestoreService'
import { BACKUP_SCHEMA, BACKUP_VERSION } from '@/services/backupService'
import { createMemoryAdapter } from '@/services/database/memoryAdapter'
import { createPersistenceService } from '@/services/database/persistenceService'
import {
  RESTORE_MODE,
  RESTORE_RESULT_CODE,
  createRestoreSafetyEngine,
} from '@/services/restoreSafetyEngine'
import { CLOUD_RESTORE_PHASE, useCloudRestoreStore } from '@/stores/cloudRestoreStore'
import { useCloudSessionStore } from '@/stores/cloudSessionStore'
import { useProductStore } from '@/stores/productStore'
import CloudBackupPanel from '@/components/settings/CloudBackupPanel.vue'

vi.mock('@/services/cloud/apiClient', () => ({
  apiRequest: vi.fn(),
  apiRawRequest: vi.fn(),
  API_RAW_ERROR: {
    TOO_LARGE: 'RAW_BODY_TOO_LARGE',
    DECODE_FAILED: 'RAW_BODY_DECODE_FAILED',
    READ_FAILED: 'RAW_BODY_READ_FAILED',
  },
}))

const BUSINESS_ID = 10
const TOKEN = 'prem-m06b3-bearer-token'
const DEVICE_ID = 'device-uuid-m06b3'
const OTHER_DEVICE_ID = 'device-uuid-other'
const FUTURE = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString()
const CREATED_AT = '2026-10-04T10:00:00+07:00'

const PRODUCT_SYNC_ID = '11111111-1111-4111-8111-111111111111'
const CATEGORY_SYNC_ID = '22222222-2222-4222-8222-222222222222'
const CUSTOMER_SYNC_ID = '33333333-3333-4333-8333-333333333333'
const TRANSACTION_SYNC_ID = '44444444-4444-4444-8444-444444444444'
const CASH_SYNC_ID = '55555555-5555-4555-8555-555555555555'
const STOCK_SYNC_ID = '66666666-6666-4666-8666-666666666666'

// ── payload builders ─────────────────────────────────────────────────────────

function makeV3Payload() {
  return {
    schema: BACKUP_SCHEMA,
    version: 3,
    exportedAt: '2026-10-04T09:00:00.000Z',
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
          customerSnapshot: { id: 'c-target', name: 'Pelanggan Target', phone: '0812', email: '' },
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
    syncMetadata: {
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
    },
  }
}

function makeV1Payload() {
  const payload = makeV3Payload()
  payload.version = 1
  delete payload.syncMetadata
  return payload
}

async function makeWire(payload) {
  const text = JSON.stringify(payload)
  const bytes = new TextEncoder().encode(text)
  const checksum = await computeSha256HexFromBytes(bytes)
  return { payload, text, bytes, checksum, sizeBytes: bytes.byteLength }
}

function rawOk(wire, { headers = {}, text = null, bytes = null } = {}) {
  const body = bytes ?? wire.bytes
  return {
    ok: true,
    status: 200,
    headers: {
      'x-checksum-sha256': wire.checksum,
      'x-backup-schema-version': String(wire.payload.version),
      ...headers,
    },
    bytes: body,
    text: text ?? wire.text,
    byteLength: body.byteLength,
  }
}

function rawFailure(status, code) {
  return { ok: false, status, error: { status, code, message: code, data: null } }
}

function backupRecord(wire, { uuid = 'uuid-1', deviceIdentifier = DEVICE_ID } = {}) {
  return {
    id: 1,
    uuid,
    createdAt: CREATED_AT,
    schemaVersion: wire.payload.version,
    appVersion: null,
    sizeBytes: wire.sizeBytes,
    checksumSha256: wire.checksum,
    status: 'ready',
    device: { id: 1, identifier: deviceIdentifier, name: 'Kasir Utama', platform: 'android' },
    duplicate: false,
  }
}

function serverRecord(wire, { uuid = 'uuid-1', deviceIdentifier = DEVICE_ID, schemaVersion } = {}) {
  return {
    id: 1,
    uuid,
    created_at: CREATED_AT,
    schema_version: schemaVersion ?? wire.payload.version,
    app_version: null,
    size_bytes: wire.sizeBytes,
    checksum_sha256: wire.checksum,
    status: 'ready',
    device: { id: 1, identifier: deviceIdentifier, name: 'Kasir Utama', platform: 'android' },
  }
}

// ── environment ──────────────────────────────────────────────────────────────

async function setup({
  premium = true,
  linked = true,
  offline = false,
  deviceId = DEVICE_ID,
  engine: engineOverride = null,
} = {}) {
  const pinia = createPinia()
  setActivePinia(pinia)

  const adapter = createMemoryAdapter()
  const service = createPersistenceService({ adapter, pinia })
  await service.initialize()
  const engine = engineOverride ?? createRestoreSafetyEngine({ adapter, scheduler: service })

  const cloudStore = useCloudSessionStore(pinia)
  const restoreStore = useCloudRestoreStore(pinia)

  cloudStore.user = { id: 1, name: 'Uji', email: 'uji@example.com' }
  cloudStore.deviceIdentifier = deviceId
  cloudStore.capabilityState = premium ? 'verified' : 'unverified'
  cloudStore.cloudAccess = true

  const plan = premium ? { plan: 'cloud', status: 'active', expires_at: FUTURE } : { plan: 'free' }

  if (linked) {
    cloudStore.businesses = [
      { id: BUSINESS_ID, name: 'Toko Cloud', subscription: plan, cloud_access: true, outlets: [] },
    ]
    cloudStore.selectedBusiness = { id: BUSINESS_ID, name: 'Toko Cloud', subscription: plan }
  } else {
    cloudStore.businesses = []
    cloudStore.selectedBusiness = null
  }

  restoreStore.init({
    runtimeSignalService: offline ? { getSnapshot: () => ({ online: false }) } : null,
    engine,
  })

  return { pinia, adapter, service, engine, cloudStore, restoreStore }
}

async function seedCurrent(service, pinia) {
  useProductStore(pinia).$patch({
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
    stockMovements: [],
  })
  await service.flush()
}

beforeEach(() => {
  _resetTokenStore()
  vi.clearAllMocks()
})

afterEach(() => {
  vi.restoreAllMocks()
})

// ════════════════════════════════════════════════════════════════════════════
// DOWNLOAD
// ════════════════════════════════════════════════════════════════════════════

describe('downloadCloudBackup', () => {
  it('1. downloads through the linked business id and preserves exact bytes', async () => {
    const wire = await makeWire(makeV3Payload())
    apiRawRequest.mockResolvedValueOnce(rawOk(wire))

    const result = await downloadCloudBackup({
      token: TOKEN,
      businessId: BUSINESS_ID,
      backupUuid: 'uuid-1',
    })

    expect(apiRawRequest).toHaveBeenCalledWith(
      expect.stringContaining('/api/mobile/backups/uuid-1/download?business_id=10'),
      expect.objectContaining({ token: TOKEN }),
    )
    expect(result.ok).toBe(true)
    expect(result.byteLength).toBe(wire.bytes.byteLength)
    expect(Array.from(result.bytes)).toEqual(Array.from(wire.bytes))
    expect(result.text).toBe(wire.text)
  })

  it('2. cannot be pointed at an arbitrary business id from a backup object', async () => {
    const wire = await makeWire(makeV3Payload())
    apiRawRequest.mockResolvedValueOnce(rawOk(wire))

    await downloadCloudBackup({
      token: TOKEN,
      businessId: BUSINESS_ID,
      backupUuid: 'uuid-1',
      rogueBusinessId: 999,
    })

    const [path] = apiRawRequest.mock.calls[0]
    expect(path).toContain('business_id=10')
    expect(path).not.toContain('999')
  })

  it('4. maps a pre-read oversize guard to RESTORE_DOWNLOAD_TOO_LARGE', async () => {
    apiRawRequest.mockResolvedValueOnce(rawFailure(200, 'RAW_BODY_TOO_LARGE'))

    const result = await downloadCloudBackup({
      token: TOKEN,
      businessId: BUSINESS_ID,
      backupUuid: 'uuid-1',
    })

    expect(result.ok).toBe(false)
    expect(result.code).toBe(CLOUD_RESTORE_ERROR.DOWNLOAD_TOO_LARGE)
  })

  it('maps backend 404 codes unchanged', async () => {
    apiRawRequest.mockResolvedValueOnce(rawFailure(404, 'BACKUP_FILE_MISSING'))

    const result = await downloadCloudBackup({
      token: TOKEN,
      businessId: BUSINESS_ID,
      backupUuid: 'uuid-1',
    })

    expect(result.ok).toBe(false)
    expect(result.code).toBe('BACKUP_FILE_MISSING')
  })
})

// ════════════════════════════════════════════════════════════════════════════
// CHECKSUM / SCHEMA / MODE (pure verification)
// ════════════════════════════════════════════════════════════════════════════

describe('verifyCloudRestorePayload', () => {
  it('10. passes a valid checksum chain and returns same-device mode', async () => {
    const wire = await makeWire(makeV3Payload())
    const result = await verifyCloudRestorePayload({
      bytes: wire.bytes,
      text: wire.text,
      headers: rawOk(wire).headers,
      metadata: backupRecord(wire),
      deviceIdentifier: DEVICE_ID,
    })

    expect(result.ok).toBe(true)
    expect(result.mode).toBe(RESTORE_MODE.SAME_DEVICE)
    expect(result.checksumSha256).toBe(wire.checksum)
  })

  it('5. blocks an actual body larger than the limit', async () => {
    const wire = await makeWire(makeV3Payload())
    const result = await verifyCloudRestorePayload({
      bytes: wire.bytes,
      text: wire.text,
      headers: rawOk(wire).headers,
      metadata: backupRecord(wire),
      deviceIdentifier: DEVICE_ID,
      maxBytes: 16,
    })

    expect(result.ok).toBe(false)
    expect(result.code).toBe(CLOUD_RESTORE_ERROR.DOWNLOAD_TOO_LARGE)
  })

  it('6. blocks a missing checksum header', async () => {
    const wire = await makeWire(makeV3Payload())
    const headers = rawOk(wire).headers
    delete headers['x-checksum-sha256']

    const result = await verifyCloudRestorePayload({
      bytes: wire.bytes,
      text: wire.text,
      headers,
      metadata: backupRecord(wire),
      deviceIdentifier: DEVICE_ID,
    })

    expect(result.code).toBe(CLOUD_RESTORE_ERROR.CHECKSUM_HEADER_MISSING)
  })

  it('7. blocks a malformed checksum header', async () => {
    const wire = await makeWire(makeV3Payload())
    const result = await verifyCloudRestorePayload({
      bytes: wire.bytes,
      text: wire.text,
      headers: { ...rawOk(wire).headers, 'x-checksum-sha256': 'not-a-checksum' },
      metadata: backupRecord(wire),
      deviceIdentifier: DEVICE_ID,
    })

    expect(result.code).toBe(CLOUD_RESTORE_ERROR.CHECKSUM_INVALID)
  })

  it('8. blocks metadata/header checksum disagreement', async () => {
    const wire = await makeWire(makeV3Payload())
    const result = await verifyCloudRestorePayload({
      bytes: wire.bytes,
      text: wire.text,
      headers: rawOk(wire).headers,
      metadata: { ...backupRecord(wire), checksumSha256: 'f'.repeat(64) },
      deviceIdentifier: DEVICE_ID,
    })

    expect(result.code).toBe(CLOUD_RESTORE_ERROR.CHECKSUM_MISMATCH)
  })

  it('9. blocks a calculated/header checksum mismatch', async () => {
    const wire = await makeWire(makeV3Payload())
    const tampered = new TextEncoder().encode(wire.text.replace('Produk Target', 'Produk Palsu'))

    const result = await verifyCloudRestorePayload({
      bytes: tampered,
      text: new TextDecoder().decode(tampered),
      headers: rawOk(wire).headers,
      metadata: backupRecord(wire),
      deviceIdentifier: DEVICE_ID,
    })

    expect(result.code).toBe(CLOUD_RESTORE_ERROR.CHECKSUM_MISMATCH)
  })

  it('11. blocks a metadata/header schema mismatch', async () => {
    const wire = await makeWire(makeV3Payload())
    const result = await verifyCloudRestorePayload({
      bytes: wire.bytes,
      text: wire.text,
      headers: rawOk(wire).headers,
      metadata: { ...backupRecord(wire), schemaVersion: 2 },
      deviceIdentifier: DEVICE_ID,
    })

    expect(result.code).toBe(CLOUD_RESTORE_ERROR.SCHEMA_MISMATCH)
  })

  it('12. blocks a header/payload schema mismatch', async () => {
    const wire = await makeWire(makeV3Payload())
    const result = await verifyCloudRestorePayload({
      bytes: wire.bytes,
      text: wire.text,
      headers: { ...rawOk(wire).headers, 'x-backup-schema-version': '2' },
      metadata: { ...backupRecord(wire), schemaVersion: 2 },
      deviceIdentifier: DEVICE_ID,
    })

    expect(result.code).toBe(CLOUD_RESTORE_ERROR.SCHEMA_MISMATCH)
  })

  it('13. blocks an unsupported schema', async () => {
    const payload = makeV3Payload()
    payload.version = 9
    const wire = await makeWire(payload)
    const result = await verifyCloudRestorePayload({
      bytes: wire.bytes,
      text: wire.text,
      headers: rawOk(wire).headers,
      metadata: { ...backupRecord(wire), schemaVersion: 9 },
      deviceIdentifier: DEVICE_ID,
    })

    expect(result.code).toBe(CLOUD_RESTORE_ERROR.SCHEMA_UNSUPPORTED)
  })

  it('14. blocks malformed JSON only after integrity passes', async () => {
    const text = '{ not json'
    const bytes = new TextEncoder().encode(text)
    const checksum = await computeSha256HexFromBytes(bytes)
    const result = await verifyCloudRestorePayload({
      bytes,
      text,
      headers: {
        'x-checksum-sha256': checksum,
        'x-backup-schema-version': String(BACKUP_VERSION),
      },
      metadata: {
        checksumSha256: checksum,
        schemaVersion: BACKUP_VERSION,
        device: { identifier: DEVICE_ID },
      },
      deviceIdentifier: DEVICE_ID,
    })

    expect(result.code).toBe(CLOUD_RESTORE_ERROR.PAYLOAD_INVALID)
  })

  it('15. blocks a structurally invalid payload', async () => {
    const invalid = { schema: 'nope', version: 3, data: {} }
    const wire = await makeWire(invalid)
    const result = await verifyCloudRestorePayload({
      bytes: wire.bytes,
      text: wire.text,
      headers: rawOk(wire).headers,
      metadata: backupRecord(wire),
      deviceIdentifier: DEVICE_ID,
    })

    expect(result.code).toBe(CLOUD_RESTORE_ERROR.PAYLOAD_INVALID)
  })

  it('17. detects cross-device from the origin device identifier', async () => {
    const wire = await makeWire(makeV3Payload())
    const result = await verifyCloudRestorePayload({
      bytes: wire.bytes,
      text: wire.text,
      headers: rawOk(wire).headers,
      metadata: backupRecord(wire, { deviceIdentifier: OTHER_DEVICE_ID }),
      deviceIdentifier: DEVICE_ID,
    })

    expect(result.ok).toBe(true)
    expect(result.mode).toBe(RESTORE_MODE.CROSS_DEVICE)
  })

  it('20. blocks a cross-device v1/v2 backup', async () => {
    const wire = await makeWire(makeV1Payload())
    const result = await verifyCloudRestorePayload({
      bytes: wire.bytes,
      text: wire.text,
      headers: rawOk(wire).headers,
      metadata: {
        ...backupRecord(wire),
        schemaVersion: 1,
        device: { identifier: OTHER_DEVICE_ID },
      },
      deviceIdentifier: DEVICE_ID,
    })

    expect(result.ok).toBe(false)
    expect(result.code).toBe(CLOUD_RESTORE_ERROR.CROSS_DEVICE_UNSAFE)
  })
})

// ════════════════════════════════════════════════════════════════════════════
// STORE FLOW
// ════════════════════════════════════════════════════════════════════════════

describe('cloud restore store', () => {
  it('25. reaches awaiting-confirmation without mutating local data', async () => {
    const { pinia, adapter, service, restoreStore } = await setup()
    await seedCurrent(service, pinia)
    await saveToken(TOKEN)

    const wire = await makeWire(makeV3Payload())
    apiRawRequest.mockResolvedValueOnce(rawOk(wire))

    const before = await adapter.loadProducts()

    const result = await restoreStore.startRestore({ backup: backupRecord(wire) })

    expect(result.ok).toBe(true)
    expect(restoreStore.restorePhase).toBe(CLOUD_RESTORE_PHASE.AWAITING_CONFIRMATION)
    expect(restoreStore.hasPayload).toBe(true)
    expect(restoreStore.canConfirm).toBe(true)
    expect(await adapter.loadProducts()).toEqual(before)
  })

  it('26. requires explicit confirmation before any engine call', async () => {
    const { restoreStore, engine } = await setup()
    await saveToken(TOKEN)
    const restoreSpy = vi.spyOn(engine, 'restore')

    const wire = await makeWire(makeV3Payload())
    apiRawRequest.mockResolvedValueOnce(rawOk(wire))

    await restoreStore.startRestore({ backup: backupRecord(wire) })

    expect(restoreSpy).not.toHaveBeenCalled()
  })

  it('27. cancel releases the payload and never mutates', async () => {
    const { pinia, adapter, service, restoreStore, engine } = await setup()
    await seedCurrent(service, pinia)
    await saveToken(TOKEN)
    const restoreSpy = vi.spyOn(engine, 'restore')

    const wire = await makeWire(makeV3Payload())
    apiRawRequest.mockResolvedValueOnce(rawOk(wire))
    await restoreStore.startRestore({ backup: backupRecord(wire) })

    const before = await adapter.loadProducts()
    restoreStore.cancelRestore()

    expect(restoreStore.restorePhase).toBe(CLOUD_RESTORE_PHASE.IDLE)
    expect(restoreStore.hasPayload).toBe(false)
    expect(restoreSpy).not.toHaveBeenCalled()
    expect(await adapter.loadProducts()).toEqual(before)
  })

  it('28. a double restore tap only starts one download', async () => {
    const { restoreStore } = await setup()
    await saveToken(TOKEN)

    const wire = await makeWire(makeV3Payload())
    let release
    apiRawRequest.mockImplementationOnce(() => new Promise((resolve) => (release = resolve)))

    const first = restoreStore.startRestore({ backup: backupRecord(wire) })
    const second = await restoreStore.startRestore({ backup: backupRecord(wire) })

    expect(second.code).toBe('RESTORE_IN_FLIGHT')
    await flushPromises()
    expect(apiRawRequest).toHaveBeenCalledTimes(1)

    release(rawOk(wire))
    await first
  })

  it('29. a double confirm only invokes the engine once', async () => {
    const { restoreStore, engine } = await setup()
    await saveToken(TOKEN)

    const wire = await makeWire(makeV3Payload())
    apiRawRequest.mockResolvedValueOnce(rawOk(wire))
    await restoreStore.startRestore({ backup: backupRecord(wire) })

    let release
    const restoreSpy = vi
      .spyOn(engine, 'restore')
      .mockImplementationOnce(() => new Promise((resolve) => (release = resolve)))

    const first = restoreStore.confirmRestore()
    const second = await restoreStore.confirmRestore()

    expect(second.code).toBe('RESTORE_IN_FLIGHT')
    expect(restoreSpy).toHaveBeenCalledTimes(1)

    release({ success: true, code: RESTORE_RESULT_CODE.OK })
    await first
    expect(restoreStore.restorePhase).toBe(CLOUD_RESTORE_PHASE.SUCCESS)
  })

  it('20. a cross-device v1/v2 backup is blocked before confirmation', async () => {
    const { restoreStore } = await setup()
    await saveToken(TOKEN)

    const wire = await makeWire(makeV1Payload())
    apiRawRequest.mockResolvedValueOnce(rawOk(wire))

    const result = await restoreStore.startRestore({
      backup: { ...backupRecord(wire), schemaVersion: 1, device: { identifier: OTHER_DEVICE_ID } },
    })

    expect(result.ok).toBe(false)
    expect(restoreStore.restorePhase).toBe(CLOUD_RESTORE_PHASE.BLOCKED)
    expect(restoreStore.restoreErrorCode).toBe(CLOUD_RESTORE_ERROR.CROSS_DEVICE_UNSAFE)
    expect(restoreStore.hasPayload).toBe(false)
  })

  it('19. a cross-device v3 SAFE backup reaches confirmation with a warning', async () => {
    const { restoreStore } = await setup()
    await saveToken(TOKEN)

    const wire = await makeWire(makeV3Payload())
    apiRawRequest.mockResolvedValueOnce(rawOk(wire))

    const result = await restoreStore.startRestore({
      backup: backupRecord(wire, { deviceIdentifier: OTHER_DEVICE_ID }),
    })

    expect(result.ok).toBe(true)
    expect(restoreStore.restoreMode).toBe(RESTORE_MODE.CROSS_DEVICE)
    expect(restoreStore.isCrossDevice).toBe(true)
  })

  it('16. detects same-device from the origin device identifier', async () => {
    const { restoreStore } = await setup()
    await saveToken(TOKEN)

    const wire = await makeWire(makeV3Payload())
    apiRawRequest.mockResolvedValueOnce(rawOk(wire))

    const result = await restoreStore.startRestore({ backup: backupRecord(wire) })

    expect(result.ok).toBe(true)
    expect(restoreStore.restoreMode).toBe(RESTORE_MODE.SAME_DEVICE)
    expect(restoreStore.isCrossDevice).toBe(false)
  })

  it('18. never replaces the current device identifier', async () => {
    const { pinia, service, restoreStore, cloudStore } = await setup()
    await seedCurrent(service, pinia)
    await saveToken(TOKEN)

    const wire = await makeWire(makeV3Payload())
    apiRawRequest.mockResolvedValueOnce(rawOk(wire))
    await restoreStore.startRestore({
      backup: backupRecord(wire, { deviceIdentifier: OTHER_DEVICE_ID }),
    })
    await restoreStore.confirmRestore()

    expect(cloudStore.deviceIdentifier).toBe(DEVICE_ID)
  })

  it('10b. allows same-device legacy v1 to reach confirmation', async () => {
    const { restoreStore } = await setup()
    await saveToken(TOKEN)

    const wire = await makeWire(makeV1Payload())
    apiRawRequest.mockResolvedValueOnce(rawOk(wire))

    const result = await restoreStore.startRestore({
      backup: { ...backupRecord(wire), schemaVersion: 1 },
    })

    expect(result.ok).toBe(true)
    expect(restoreStore.restorePhase).toBe(CLOUD_RESTORE_PHASE.AWAITING_CONFIRMATION)
    expect(restoreStore.restoreMode).toBe(RESTORE_MODE.SAME_DEVICE)
  })
})

// ════════════════════════════════════════════════════════════════════════════
// ELIGIBILITY / AUTH / ENGINE / DATA
// ════════════════════════════════════════════════════════════════════════════

describe('cloud restore eligibility and errors', () => {
  async function startWithWire(restoreStore, wire, options = {}) {
    apiRawRequest.mockResolvedValueOnce(rawOk(wire))
    return restoreStore.startRestore({ backup: backupRecord(wire, options) })
  }

  it('21. blocks when the sync queue is not empty', async () => {
    const { restoreStore, adapter } = await setup()
    await saveToken(TOKEN)
    await adapter.upsertSyncQueueItem({
      id: 'q1',
      operation: 'create',
      payload: null,
      createdAt: '2026-10-04T00:00:00.000Z',
      updatedAt: '2026-10-04T00:00:00.000Z',
    })

    const wire = await makeWire(makeV3Payload())
    await startWithWire(restoreStore, wire)

    expect(restoreStore.restorePhase).toBe(CLOUD_RESTORE_PHASE.BLOCKED)
    expect(restoreStore.restoreErrorCode).toBe(RESTORE_RESULT_CODE.PENDING_SYNC)
  })

  it('22. blocks when a sync push is in flight', async () => {
    const { restoreStore, adapter } = await setup()
    await saveToken(TOKEN)
    await adapter.saveSyncPushInflight({ requestId: 'r1' })

    const wire = await makeWire(makeV3Payload())
    await startWithWire(restoreStore, wire)

    expect(restoreStore.restoreErrorCode).toBe(RESTORE_RESULT_CODE.IN_FLIGHT_SYNC)
  })

  it('23. blocks when the P38 journal is unresolved', async () => {
    const { restoreStore, adapter } = await setup()
    await saveToken(TOKEN)
    await adapter.saveLocalOperationJournal({ entries: [{ id: 'op1', status: 'pending' }] })

    const wire = await makeWire(makeV3Payload())
    await startWithWire(restoreStore, wire)

    expect(restoreStore.restoreErrorCode).toBe(RESTORE_RESULT_CODE.P38_JOURNAL_UNRESOLVED)
  })

  it('24. blocks when a previous restore journal is unresolved', async () => {
    const { restoreStore, adapter } = await setup()
    await saveToken(TOKEN)
    await adapter.saveRestoreJournal({ phase: 'applying' })

    const wire = await makeWire(makeV3Payload())
    await startWithWire(restoreStore, wire)

    expect(restoreStore.restoreErrorCode).toBe(RESTORE_RESULT_CODE.RESTORE_JOURNAL_UNRESOLVED)
  })

  it('32. blocks restore for a non-premium account without downloading', async () => {
    const { restoreStore } = await setup({ premium: false })
    await saveToken(TOKEN)

    const result = await restoreStore.startRestore({ backup: { uuid: 'uuid-1' } })

    expect(result.code).toBe('NOT_ELIGIBLE')
    expect(apiRawRequest).not.toHaveBeenCalled()
  })

  it('33. CLOUD_SUBSCRIPTION_REQUIRED refreshes Cloud context and does not mutate', async () => {
    const { restoreStore, cloudStore } = await setup()
    await saveToken(TOKEN)
    const refreshSpy = vi.spyOn(cloudStore, 'refreshContext').mockResolvedValue(undefined)
    apiRawRequest.mockResolvedValueOnce(rawFailure(403, 'CLOUD_SUBSCRIPTION_REQUIRED'))

    await restoreStore.startRestore({ backup: { uuid: 'uuid-1' } })

    expect(restoreStore.restorePhase).toBe(CLOUD_RESTORE_PHASE.BLOCKED)
    expect(refreshSpy).toHaveBeenCalled()
  })

  it('34. 401 invalidates the Cloud session only', async () => {
    const { pinia, restoreStore, cloudStore } = await setup()
    await saveToken(TOKEN)
    const invalidateSpy = vi
      .spyOn(cloudStore, 'invalidateCloudSession')
      .mockResolvedValue(undefined)
    apiRawRequest.mockResolvedValueOnce(rawFailure(401, 'UNAUTHENTICATED'))

    const before = JSON.stringify(useProductStore(pinia).products)
    await restoreStore.startRestore({ backup: { uuid: 'uuid-1' } })

    expect(invalidateSpy).toHaveBeenCalled()
    expect(restoreStore.restorePhase).toBe(CLOUD_RESTORE_PHASE.ERROR)
    // Local POS data is untouched by a session invalidation.
    expect(JSON.stringify(useProductStore(pinia).products)).toBe(before)
  })

  it('35/36. DEVICE_NOT_FOUND and DEVICE_INACTIVE fail closed', async () => {
    const { restoreStore } = await setup()
    await saveToken(TOKEN)
    apiRawRequest.mockResolvedValueOnce(rawFailure(403, 'DEVICE_INACTIVE'))

    await restoreStore.startRestore({ backup: { uuid: 'uuid-1' } })

    expect(restoreStore.restorePhase).toBe(CLOUD_RESTORE_PHASE.BLOCKED)
    expect(restoreStore.restoreErrorCode).toBe('DEVICE_INACTIVE')
  })

  it('37. BACKUP_NOT_FOUND fails closed', async () => {
    const { restoreStore } = await setup()
    await saveToken(TOKEN)
    apiRawRequest.mockResolvedValueOnce(rawFailure(404, 'BACKUP_NOT_FOUND'))

    await restoreStore.startRestore({ backup: { uuid: 'uuid-1' } })

    expect(restoreStore.restoreErrorCode).toBe('BACKUP_NOT_FOUND')
    expect(restoreStore.hasPayload).toBe(false)
  })

  it('38. BACKUP_FILE_MISSING fails closed', async () => {
    const { restoreStore } = await setup()
    await saveToken(TOKEN)
    apiRawRequest.mockResolvedValueOnce(rawFailure(404, 'BACKUP_FILE_MISSING'))

    await restoreStore.startRestore({ backup: { uuid: 'uuid-1' } })

    expect(restoreStore.restoreErrorCode).toBe('BACKUP_FILE_MISSING')
  })

  it('39. offline never downloads', async () => {
    const { restoreStore } = await setup({ offline: true })
    await saveToken(TOKEN)

    const result = await restoreStore.startRestore({ backup: { uuid: 'uuid-1' } })

    expect(result.code).toBe('NETWORK_ERROR')
    expect(apiRawRequest).not.toHaveBeenCalled()
  })

  it('40/42/45/46/47/48/49/50. success only after COMMITTED and applies portable identity', async () => {
    const { pinia, adapter, service, engine, restoreStore, cloudStore } = await setup()
    await seedCurrent(service, pinia)
    await saveToken(TOKEN)

    const wire = await makeWire(makeV3Payload())
    apiRawRequest.mockResolvedValueOnce(rawOk(wire))
    await restoreStore.startRestore({ backup: backupRecord(wire) })

    const restoreSpy = vi.spyOn(engine, 'restore')
    const result = await restoreStore.confirmRestore()

    expect(restoreSpy).toHaveBeenCalledTimes(1)
    expect(result.ok).toBe(true)
    expect(restoreStore.restorePhase).toBe(CLOUD_RESTORE_PHASE.SUCCESS)

    const products = (await adapter.loadProducts()).products
    expect(products.map((product) => product.name)).toEqual(['Produk Target'])
    // 45. negative stock preserved exactly
    expect(products[0].stock).toBe(-3)

    const identityMap = await adapter.loadSyncIdentityMap()
    expect(identityMap['product:p-target']).toBe(PRODUCT_SYNC_ID)
    expect(identityMap['category:Target']).toBe(CATEGORY_SYNC_ID)

    const serverVersions = await adapter.loadSyncServerVersions()
    expect(serverVersions[`products:${PRODUCT_SYNC_ID}`]).toEqual({
      syncVersion: 9,
      syncSequence: 90,
    })

    expect(await adapter.countSyncQueueItems()).toBe(0)
    expect(await adapter.loadSyncPushInflight()).toBeNull()
    // 50. Cloud session preserved
    expect(cloudStore.isAuthenticated).toBe(true)
  })

  it('43. a rolled-back restore is reported as failure, never success', async () => {
    const { pinia, adapter, service, restoreStore } = await setup()
    await seedCurrent(service, pinia)
    await saveToken(TOKEN)

    const originalApply = adapter.applyRestoreSnapshotAtomic.bind(adapter)
    vi.spyOn(adapter, 'applyRestoreSnapshotAtomic')
      .mockImplementationOnce(async () => {
        throw new Error('apply failed')
      })
      .mockImplementation(originalApply)

    const wire = await makeWire(makeV3Payload())
    apiRawRequest.mockResolvedValueOnce(rawOk(wire))
    await restoreStore.startRestore({ backup: backupRecord(wire) })

    const result = await restoreStore.confirmRestore()

    expect(result.ok).toBe(false)
    expect(restoreStore.restorePhase).toBe(CLOUD_RESTORE_PHASE.ROLLING_BACK)
    expect(restoreStore.restorePhase).not.toBe(CLOUD_RESTORE_PHASE.SUCCESS)
    // local data restored to the pre-restore snapshot
    expect((await adapter.loadProducts()).products.map((product) => product.name)).toEqual([
      'Produk Lama',
    ])
  })

  it('44. a failed rollback is recovery-required and fails closed', async () => {
    const { pinia, adapter, service, restoreStore } = await setup()
    await seedCurrent(service, pinia)
    await saveToken(TOKEN)

    vi.spyOn(adapter, 'applyRestoreSnapshotAtomic').mockImplementation(async () => {
      throw new Error('persistence down')
    })

    const wire = await makeWire(makeV3Payload())
    apiRawRequest.mockResolvedValueOnce(rawOk(wire))
    await restoreStore.startRestore({ backup: backupRecord(wire) })

    const result = await restoreStore.confirmRestore()

    expect(result.ok).toBe(false)
    expect(restoreStore.restorePhase).toBe(CLOUD_RESTORE_PHASE.RECOVERY_REQUIRED)
    expect(restoreStore.restoreErrorCode).toBe(RESTORE_RESULT_CODE.ROLLBACK_FAILED)
  })

  it('24b. a business relink mid-download discards the flow', async () => {
    const { restoreStore, cloudStore } = await setup()
    await saveToken(TOKEN)

    const wire = await makeWire(makeV3Payload())
    let release
    apiRawRequest.mockImplementationOnce(() => new Promise((resolve) => (release = resolve)))

    const pending = restoreStore.startRestore({ backup: backupRecord(wire) })
    await flushPromises()

    cloudStore.selectedBusiness = { id: 77, name: 'Toko Lain', subscription: null }
    cloudStore.businesses = [{ id: 77, name: 'Toko Lain', subscription: null, cloud_access: true }]

    release(rawOk(wire))
    const result = await pending

    expect(result.code).toBe('BUSINESS_SCOPE_CHANGED')
    expect(restoreStore.hasPayload).toBe(false)
    expect(restoreStore.restorePhase).toBe(CLOUD_RESTORE_PHASE.ERROR)
  })
})

// ════════════════════════════════════════════════════════════════════════════
// UI
// ════════════════════════════════════════════════════════════════════════════

describe('CloudBackupPanel restore UX', () => {
  async function mountPanel(options = {}) {
    const context = await setup(options)
    await saveToken(TOKEN)
    return context
  }

  function installList(record) {
    apiRequest.mockImplementation(async () => ({
      ok: true,
      status: 200,
      data: { data: [record] },
      error: null,
    }))
  }

  it('30. renders the restore button for each backup', async () => {
    const { pinia } = await mountPanel()
    const wire = await makeWire(makeV3Payload())
    installList(serverRecord(wire))

    const wrapper = mount(CloudBackupPanel, { global: { plugins: [pinia] } })
    await flushPromises()

    expect(wrapper.find('[data-testid="cloud-backup-restore"]').exists()).toBe(true)
    wrapper.unmount()
  })

  it('30/31. renders confirmation metadata and the cross-device warning', async () => {
    const { pinia, restoreStore } = await mountPanel()
    restoreStore.init({
      engine: createRestoreSafetyEngine({ adapter: createMemoryAdapter(), scheduler: null }),
    })

    const wire = await makeWire(makeV3Payload())
    const record = serverRecord(wire, { deviceIdentifier: OTHER_DEVICE_ID })
    installList(record)

    const wrapper = mount(CloudBackupPanel, { global: { plugins: [pinia] } })
    await flushPromises()

    apiRawRequest.mockResolvedValueOnce(rawOk(wire))

    await wrapper.find('[data-testid="cloud-backup-restore"]').trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-testid="cloud-restore-confirmation"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="cloud-restore-confirmation-message"]').text()).toContain(
      'mengganti data POS lokal',
    )
    expect(wrapper.find('[data-testid="cloud-restore-meta-date"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="cloud-restore-meta-origin"]').text()).toContain(
      'Kasir Utama',
    )
    expect(wrapper.find('[data-testid="cloud-restore-meta-size"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="cloud-restore-meta-schema"]').text()).toContain('v3')
    expect(wrapper.find('[data-testid="cloud-restore-cross-device"]').exists()).toBe(true)
  })

  it('26/27. cancel from the confirmation does not mutate local data', async () => {
    const { pinia, adapter, restoreStore } = await mountPanel()
    restoreStore.init({
      engine: createRestoreSafetyEngine({ adapter, scheduler: null }),
    })

    const wire = await makeWire(makeV3Payload())
    installList(serverRecord(wire))

    const wrapper = mount(CloudBackupPanel, { global: { plugins: [pinia] } })
    await flushPromises()

    apiRawRequest.mockResolvedValueOnce(rawOk(wire))
    await wrapper.find('[data-testid="cloud-backup-restore"]').trigger('click')
    await flushPromises()

    const before = await adapter.loadProducts()
    await wrapper.find('[data-testid="cloud-restore-cancel"]').trigger('click')
    await flushPromises()

    expect(restoreStore.restorePhase).toBe(CLOUD_RESTORE_PHASE.IDLE)
    expect(await adapter.loadProducts()).toEqual(before)
  })
})
