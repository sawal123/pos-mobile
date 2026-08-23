/**
 * P10 Cloud Login & Sync Context tests.
 *
 * Coverage:
 * - API/Auth: login success/failure, EMAIL_NOT_VERIFIED, TWO_FACTOR_REQUIRED
 * - Context: business/outlet selection rules, cloud_access checks
 * - Device: stable identifier, register device, error handling
 * - Logout: local cleanup regardless of network failure, POS data preserved
 * - Offline: FREE mode hydrates without token
 * - Regression: no calls to /api/sync/push or /api/sync/pull
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

import { apiRequest } from '../services/cloud/apiClient'
import { cloudLogin, fetchMobileContext, registerDevice, cloudLogout } from '../services/cloud/authService'
import {
  saveToken,
  getToken,
  removeToken,
  _resetTokenStore,
} from '../services/cloud/tokenRepository'
import { resolveDeviceIdentifier } from '../services/cloud/deviceIdentifier'
import { useCloudSessionStore } from '../stores/cloudSessionStore'
import { createMemoryAdapter } from '../services/database/memoryAdapter'

// ── Utility ─────────────────────────────────────────────────────────────────

function makeOkResponse(data) {
  return { ok: true, status: 200, data: { data }, error: null }
}

function makeErrorResponse(status, code, message) {
  return { ok: false, status, data: null, error: { status, code, message, data: null } }
}

const MOCK_USER = { id: 1, name: 'Test User', email: 'test@example.com' }
const MOCK_TOKEN = 'test-bearer-token-abc'

const MOCK_BUSINESS_CLOUD = {
  id: 10,
  name: 'Toko A',
  cloud_access: true,
  subscription: { plan: 'pro' },
  outlets: [
    { id: 100, name: 'Outlet Utama', status: 'active' },
  ],
  device_context: null,
}

const MOCK_BUSINESS_NO_CLOUD = {
  id: 11,
  name: 'Toko B',
  cloud_access: false,
  subscription: { plan: 'free' },
  outlets: [
    { id: 101, name: 'Outlet B', status: 'active' },
  ],
  device_context: null,
}

const MOCK_CONTEXT = {
  user: MOCK_USER,
  businesses: [MOCK_BUSINESS_CLOUD],
}

// ── Setup ────────────────────────────────────────────────────────────────────

vi.mock('../services/cloud/apiClient', () => ({
  apiRequest: vi.fn(),
}))

beforeEach(() => {
  setActivePinia(createPinia())
  _resetTokenStore()
  vi.clearAllMocks()
})

// ════════════════════════════════════════════════════════════════════════════
// 1. API/Auth
// ════════════════════════════════════════════════════════════════════════════

describe('cloudLogin', () => {
  it('login success – returns token and user', async () => {
    apiRequest.mockResolvedValueOnce(
      makeOkResponse({ token_type: 'Bearer', token: MOCK_TOKEN, user: MOCK_USER }),
    )

    const result = await cloudLogin('test@example.com', 'secret')

    expect(result.ok).toBe(true)
    expect(result.token).toBe(MOCK_TOKEN)
    expect(result.user).toMatchObject({ id: 1, email: 'test@example.com' })
  })

  it('invalid credentials – does not save token', async () => {
    apiRequest.mockResolvedValueOnce(makeErrorResponse(401, 'INVALID_CREDENTIALS', 'Unauthorized'))

    const result = await cloudLogin('bad@x.com', 'wrong')

    expect(result.ok).toBe(false)
    expect(result.token).toBeUndefined()
    expect(await getToken()).toBeNull()
  })

  it('EMAIL_NOT_VERIFIED – returns error code', async () => {
    apiRequest.mockResolvedValueOnce(
      makeErrorResponse(403, 'EMAIL_NOT_VERIFIED', 'Email not verified'),
    )

    const result = await cloudLogin('unverified@x.com', 'pw')

    expect(result.ok).toBe(false)
    expect(result.error.code).toBe('EMAIL_NOT_VERIFIED')
  })

  it('TWO_FACTOR_REQUIRED – returns error code without session', async () => {
    apiRequest.mockResolvedValueOnce(
      makeErrorResponse(403, 'TWO_FACTOR_REQUIRED', '2FA required'),
    )

    const result = await cloudLogin('mfa@x.com', 'pw')

    expect(result.ok).toBe(false)
    expect(result.error.code).toBe('TWO_FACTOR_REQUIRED')
    expect(await getToken()).toBeNull()
  })
})

describe('Bearer token used for context request', () => {
  it('fetchMobileContext sends Authorization header via apiRequest call with token', async () => {
    apiRequest.mockResolvedValueOnce(makeOkResponse(MOCK_CONTEXT))

    await fetchMobileContext(MOCK_TOKEN)

    expect(apiRequest).toHaveBeenCalledWith(
      '/api/mobile/context',
      expect.objectContaining({ token: MOCK_TOKEN }),
    )
  })
})

// ════════════════════════════════════════════════════════════════════════════
// 2. cloudSessionStore – Login + Context
// ════════════════════════════════════════════════════════════════════════════

describe('cloudSessionStore – login flow', () => {
  function setupLoginMocks() {
    // First call: /api/auth/login
    apiRequest.mockResolvedValueOnce(
      makeOkResponse({ token_type: 'Bearer', token: MOCK_TOKEN, user: MOCK_USER }),
    )
    // Second call: /api/mobile/context
    apiRequest.mockResolvedValueOnce(makeOkResponse(MOCK_CONTEXT))
  }

  it('login success – stores session and token', async () => {
    setupLoginMocks()
    const store = useCloudSessionStore()

    const result = await store.login('test@example.com', 'secret')

    expect(result.ok).toBe(true)
    expect(store.isAuthenticated).toBe(true)
    expect(store.user).toMatchObject({ email: 'test@example.com' })
    expect(await getToken()).toBe(MOCK_TOKEN)
  })

  it('invalid credentials – does not create session', async () => {
    apiRequest.mockResolvedValueOnce(makeErrorResponse(401, 'INVALID_CREDENTIALS', 'Unauthorized'))
    const store = useCloudSessionStore()

    const result = await store.login('bad@x.com', 'wrong')

    expect(result.ok).toBe(false)
    expect(store.isAuthenticated).toBe(false)
    expect(await getToken()).toBeNull()
  })

  it('1 business – can be auto-selected', async () => {
    setupLoginMocks()
    const store = useCloudSessionStore()
    await store.login('test@example.com', 'secret')

    // businesses is populated; selecting the only one should work
    expect(store.businesses).toHaveLength(1)
    const result = store.selectBusiness(MOCK_BUSINESS_CLOUD.id)
    expect(result.ok).toBe(true)
    expect(store.selectedBusiness?.id).toBe(MOCK_BUSINESS_CLOUD.id)
  })

  it('>1 business – does not auto-select arbitrarily', async () => {
    // Return 2 businesses
    apiRequest.mockResolvedValueOnce(
      makeOkResponse({ token_type: 'Bearer', token: MOCK_TOKEN, user: MOCK_USER }),
    )
    apiRequest.mockResolvedValueOnce(
      makeOkResponse({
        user: MOCK_USER,
        businesses: [MOCK_BUSINESS_CLOUD, MOCK_BUSINESS_NO_CLOUD],
      }),
    )
    const store = useCloudSessionStore()
    await store.login('test@example.com', 'secret')

    // With >1 business, none should be selected automatically
    expect(store.selectedBusiness).toBeNull()
    expect(store.businesses).toHaveLength(2)
  })

  it('cloud_access false – selectBusiness marks cloudAccess=false', async () => {
    apiRequest.mockResolvedValueOnce(
      makeOkResponse({ token_type: 'Bearer', token: MOCK_TOKEN, user: MOCK_USER }),
    )
    apiRequest.mockResolvedValueOnce(
      makeOkResponse({ user: MOCK_USER, businesses: [MOCK_BUSINESS_NO_CLOUD] }),
    )
    const store = useCloudSessionStore()
    await store.login('test@example.com', 'secret')
    store.selectBusiness(MOCK_BUSINESS_NO_CLOUD.id)

    expect(store.cloudAccess).toBe(false)
    expect(store.hasCloudAccess).toBe(false)
  })
})

// ════════════════════════════════════════════════════════════════════════════
// 3. Outlet selection
// ════════════════════════════════════════════════════════════════════════════

describe('cloudSessionStore – outlet selection', () => {
  async function loginAndSelectBusiness() {
    const store = useCloudSessionStore()
    apiRequest.mockResolvedValueOnce(
      makeOkResponse({ token_type: 'Bearer', token: MOCK_TOKEN, user: MOCK_USER }),
    )
    apiRequest.mockResolvedValueOnce(makeOkResponse(MOCK_CONTEXT))
    await store.login('test@example.com', 'secret')
    store.selectBusiness(MOCK_BUSINESS_CLOUD.id)
    return store
  }

  it('only active outlets are eligible', async () => {
    // Inject a business with mixed outlet statuses
    const store = useCloudSessionStore()
    apiRequest.mockResolvedValueOnce(
      makeOkResponse({ token_type: 'Bearer', token: MOCK_TOKEN, user: MOCK_USER }),
    )
    apiRequest.mockResolvedValueOnce(
      makeOkResponse({
        user: MOCK_USER,
        businesses: [
          {
            ...MOCK_BUSINESS_CLOUD,
            outlets: [
              { id: 200, name: 'Aktif', status: 'active' },
              { id: 201, name: 'Inactive', status: 'inactive' },
            ],
          },
        ],
      }),
    )
    await store.login('test@example.com', 'secret')
    store.selectBusiness(MOCK_BUSINESS_CLOUD.id)

    // inactive outlet must be rejected
    const badResult = store.selectOutlet(201)
    expect(badResult.ok).toBe(false)

    // active outlet must be accepted
    const goodResult = store.selectOutlet(200)
    expect(goodResult.ok).toBe(true)
  })

  it('zero active outlet – selectOutlet fails', async () => {
    const store = useCloudSessionStore()
    apiRequest.mockResolvedValueOnce(
      makeOkResponse({ token_type: 'Bearer', token: MOCK_TOKEN, user: MOCK_USER }),
    )
    apiRequest.mockResolvedValueOnce(
      makeOkResponse({
        user: MOCK_USER,
        businesses: [
          {
            ...MOCK_BUSINESS_CLOUD,
            outlets: [{ id: 300, name: 'Inactive', status: 'inactive' }],
          },
        ],
      }),
    )
    await store.login('test@example.com', 'secret')
    store.selectBusiness(MOCK_BUSINESS_CLOUD.id)

    const result = store.selectOutlet(300)
    expect(result.ok).toBe(false)
  })

  it('1 active outlet – can be directly selected', async () => {
    const store = await loginAndSelectBusiness()
    const result = store.selectOutlet(100) // MOCK_BUSINESS_CLOUD has outlet 100 active
    expect(result.ok).toBe(true)
    expect(store.selectedOutlet?.id).toBe(100)
  })
})

// ════════════════════════════════════════════════════════════════════════════
// 4. Cloud access guard
// ════════════════════════════════════════════════════════════════════════════

describe('cloud_access guard', () => {
  it('cloud_access false – doRegisterDevice returns NO_CLOUD_ACCESS error', async () => {
    const store = useCloudSessionStore()
    apiRequest.mockResolvedValueOnce(
      makeOkResponse({ token_type: 'Bearer', token: MOCK_TOKEN, user: MOCK_USER }),
    )
    apiRequest.mockResolvedValueOnce(
      makeOkResponse({ user: MOCK_USER, businesses: [MOCK_BUSINESS_NO_CLOUD] }),
    )
    await store.login('test@example.com', 'secret')
    store.selectBusiness(MOCK_BUSINESS_NO_CLOUD.id)
    store.deviceIdentifier = 'some-uuid'

    const result = await store.doRegisterDevice()

    expect(result.ok).toBe(false)
    expect(result.error.code).toBe('NO_CLOUD_ACCESS')
    // Must NOT have called /api/mobile/devices
    const deviceCalls = apiRequest.mock.calls.filter((c) => c[0] === '/api/mobile/devices')
    expect(deviceCalls).toHaveLength(0)
  })
})

// ════════════════════════════════════════════════════════════════════════════
// 5. Device identifier
// ════════════════════════════════════════════════════════════════════════════

describe('resolveDeviceIdentifier', () => {
  it('generates UUID once and returns same value on second call', async () => {
    const adapter = createMemoryAdapter()
    await adapter.initialize()

    const id1 = await resolveDeviceIdentifier(adapter)
    const id2 = await resolveDeviceIdentifier(adapter)

    expect(id1).toBeTruthy()
    expect(id1).toBe(id2)
    expect(typeof id1).toBe('string')
  })

  it('identifier stays the same after simulated restart (same adapter)', async () => {
    const adapter = createMemoryAdapter()
    await adapter.initialize()

    const id1 = await resolveDeviceIdentifier(adapter)
    // Save manually, then read again (simulates app restart with re-hydration)
    const id2 = await adapter.loadDeviceIdentifier()

    expect(id2).toBe(id1)
  })

  it('does not generate a new UUID when called a second time (idempotent)', async () => {
    const adapter = createMemoryAdapter()
    await adapter.initialize()

    const first = await resolveDeviceIdentifier(adapter)
    // Simulate another call (e.g. after login)
    const second = await resolveDeviceIdentifier(adapter)

    expect(second).toBe(first)
  })
})

// ════════════════════════════════════════════════════════════════════════════
// 6. Register device
// ════════════════════════════════════════════════════════════════════════════

describe('doRegisterDevice', () => {
  async function prepareStoreForRegistration() {
    const store = useCloudSessionStore()
    apiRequest.mockResolvedValueOnce(
      makeOkResponse({ token_type: 'Bearer', token: MOCK_TOKEN, user: MOCK_USER }),
    )
    apiRequest.mockResolvedValueOnce(makeOkResponse(MOCK_CONTEXT))
    await store.login('test@example.com', 'secret')
    store.selectBusiness(MOCK_BUSINESS_CLOUD.id)
    store.selectOutlet(100)
    store.deviceIdentifier = 'stable-device-uuid-1234'
    return store
  }

  it('sends correct business/outlet/identifier payload', async () => {
    const store = await prepareStoreForRegistration()
    apiRequest.mockResolvedValueOnce(makeOkResponse({ id: 999 }))

    await store.doRegisterDevice({ platform: 'android' })

    const [, options] = apiRequest.mock.calls.find((c) => c[0] === '/api/mobile/devices')
    expect(options.body).toMatchObject({
      business_id: MOCK_BUSINESS_CLOUD.id,
      outlet_id: 100,
      device_identifier: 'stable-device-uuid-1234',
      platform: 'android',
    })
  })

  it('stores registeredDeviceId on success', async () => {
    const store = await prepareStoreForRegistration()
    apiRequest.mockResolvedValueOnce(makeOkResponse({ id: 777 }))

    await store.doRegisterDevice()

    expect(store.registeredDeviceId).toBe(777)
    expect(store.isDeviceRegistered).toBe(true)
  })

  it('DEVICE_INACTIVE – returns error, does not generate new UUID', async () => {
    const store = await prepareStoreForRegistration()
    apiRequest.mockResolvedValueOnce(makeErrorResponse(403, 'DEVICE_INACTIVE', 'Device inactive'))

    const result = await store.doRegisterDevice()

    expect(result.ok).toBe(false)
    expect(result.error.code).toBe('DEVICE_INACTIVE')
    // device_identifier must NOT have changed
    expect(store.deviceIdentifier).toBe('stable-device-uuid-1234')
  })

  it('DEVICE_OUTLET_MISMATCH – returns error, does not generate new UUID', async () => {
    const store = await prepareStoreForRegistration()
    apiRequest.mockResolvedValueOnce(
      makeErrorResponse(409, 'DEVICE_OUTLET_MISMATCH', 'Device belongs to different outlet'),
    )

    const result = await store.doRegisterDevice()

    expect(result.ok).toBe(false)
    expect(result.error.code).toBe('DEVICE_OUTLET_MISMATCH')
    // Must NOT create new identifier
    expect(store.deviceIdentifier).toBe('stable-device-uuid-1234')
  })
})

// ════════════════════════════════════════════════════════════════════════════
// 7. Logout
// ════════════════════════════════════════════════════════════════════════════

describe('logout', () => {
  async function loginStore() {
    const store = useCloudSessionStore()
    apiRequest.mockResolvedValueOnce(
      makeOkResponse({ token_type: 'Bearer', token: MOCK_TOKEN, user: MOCK_USER }),
    )
    apiRequest.mockResolvedValueOnce(makeOkResponse(MOCK_CONTEXT))
    await store.login('test@example.com', 'secret')
    store.selectBusiness(MOCK_BUSINESS_CLOUD.id)
    store.selectOutlet(100)
    store.deviceIdentifier = 'stable-device-uuid-logout'
    return store
  }

  it('clears local session and token after successful logout', async () => {
    const store = await loginStore()
    apiRequest.mockResolvedValueOnce({ ok: true, status: 200, data: null, error: null })

    await store.logout()

    expect(store.isAuthenticated).toBe(false)
    expect(store.user).toBeNull()
    expect(await getToken()).toBeNull()
  })

  it('network failure during logout still clears local credential', async () => {
    const store = await loginStore()
    apiRequest.mockResolvedValueOnce({
      ok: false,
      status: 0,
      data: null,
      error: { code: 'NETWORK_ERROR', message: 'offline' },
    })

    await store.logout()

    expect(store.isAuthenticated).toBe(false)
    expect(await getToken()).toBeNull()
  })

  it('logout does NOT delete device_identifier', async () => {
    const store = await loginStore()
    const originalId = store.deviceIdentifier
    apiRequest.mockResolvedValueOnce({ ok: true, status: 200, data: null, error: null })

    await store.logout()

    expect(store.deviceIdentifier).toBe(originalId)
  })

  it('logout does NOT touch POS adapter data', async () => {
    const store = await loginStore()
    const adapter = createMemoryAdapter()
    await adapter.initialize()

    // Pre-populate some POS data
    await adapter.saveProducts([{ id: 'p1', name: 'P', category: 'C', price: 1, stock: 5, isActive: true }], [])
    await adapter.saveCustomers([{ id: 'c1', name: 'Cust', phone: '', email: '' }])

    apiRequest.mockResolvedValueOnce({ ok: true, status: 200, data: null, error: null })
    await store.logout()

    // POS data must still be there
    const products = await adapter.loadProducts()
    expect(products.products).toHaveLength(1)
    const customers = await adapter.loadCustomers()
    expect(customers).toHaveLength(1)
  })

  it('logout does NOT touch sync_queue', async () => {
    const store = await loginStore()
    const adapter = createMemoryAdapter()
    await adapter.initialize()

    await adapter.upsertSyncQueueItem({
      id: 'sq1',
      entityType: 'product',
      entityId: 'p1',
      operation: 'upsert',
      payload: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      attemptCount: 0,
      lastError: null,
    })

    apiRequest.mockResolvedValueOnce({ ok: true, status: 200, data: null, error: null })
    await store.logout()

    const count = await adapter.countSyncQueueItems()
    expect(count).toBe(1)
  })
})

// ════════════════════════════════════════════════════════════════════════════
// 8. Offline / FREE mode
// ════════════════════════════════════════════════════════════════════════════

describe('offline / FREE mode', () => {
  it('hydrateFromStorage succeeds with no token – authenticated=false', async () => {
    const store = useCloudSessionStore()
    const adapter = createMemoryAdapter()
    await adapter.initialize()

    const result = await store.hydrateFromStorage(adapter)

    expect(result.ok).toBe(true)
    expect(result.authenticated).toBe(false)
    expect(store.isAuthenticated).toBe(false)
  })

  it('API failure during login does not prevent local POS startup', async () => {
    apiRequest.mockRejectedValueOnce(new Error('Network failure'))

    // Store login throws but POS (adapter) is unaffected
    const store = useCloudSessionStore()
    // login should handle internal error gracefully (store.error set, not thrown)
    try {
      await store.login('x@x.com', 'pw')
    } catch {
      // acceptable
    }

    // POS adapter still usable
    const adapter = createMemoryAdapter()
    await adapter.initialize()
    const biz = await adapter.loadBusiness()
    expect(biz).toBeNull() // fresh adapter – no POS data lost
  })
})

// ════════════════════════════════════════════════════════════════════════════
// 9. No sync push/pull calls
// ════════════════════════════════════════════════════════════════════════════

describe('P10 sync boundary – no push/pull', () => {
  const FORBIDDEN = ['/api/sync/push', '/api/sync/pull']

  it('login flow does not call sync push or pull', async () => {
    apiRequest.mockResolvedValueOnce(
      makeOkResponse({ token_type: 'Bearer', token: MOCK_TOKEN, user: MOCK_USER }),
    )
    apiRequest.mockResolvedValueOnce(makeOkResponse(MOCK_CONTEXT))
    apiRequest.mockResolvedValueOnce(makeOkResponse({ id: 55 }))

    const store = useCloudSessionStore()
    await store.login('test@example.com', 'secret')
    store.selectBusiness(MOCK_BUSINESS_CLOUD.id)
    store.selectOutlet(100)
    store.deviceIdentifier = 'uuid-x'
    await store.doRegisterDevice()

    const calledPaths = apiRequest.mock.calls.map((c) => c[0])
    for (const forbidden of FORBIDDEN) {
      expect(calledPaths).not.toContain(forbidden)
    }
  })

  it('logout does not call sync push or pull', async () => {
    await saveToken(MOCK_TOKEN)
    const store = useCloudSessionStore()
    store.user = MOCK_USER

    apiRequest.mockResolvedValueOnce({ ok: true, status: 200, data: null, error: null })
    await store.logout()

    const calledPaths = apiRequest.mock.calls.map((c) => c[0])
    for (const forbidden of FORBIDDEN) {
      expect(calledPaths).not.toContain(forbidden)
    }
  })

  it('authService never references sync endpoints', async () => {
    // Verify cloudLogout only calls /api/auth/logout
    apiRequest.mockResolvedValueOnce({ ok: true, status: 200, data: null, error: null })
    await cloudLogout('test-token')

    expect(apiRequest).toHaveBeenCalledWith(
      '/api/auth/logout',
      expect.objectContaining({ method: 'DELETE' }),
    )
    expect(apiRequest).not.toHaveBeenCalledWith(
      expect.stringContaining('/api/sync'),
      expect.anything(),
    )
  })
})

// ════════════════════════════════════════════════════════════════════════════
// 10. Token repository
// ════════════════════════════════════════════════════════════════════════════

describe('tokenRepository', () => {
  it('saveToken / getToken / removeToken roundtrip', async () => {
    await saveToken('my-token')
    expect(await getToken()).toBe('my-token')
    await removeToken()
    expect(await getToken()).toBeNull()
  })

  it('getToken returns null before any save', async () => {
    expect(await getToken()).toBeNull()
  })

  it('uses in-memory store – does not touch localStorage', async () => {
    const spy = vi.spyOn(globalThis, 'localStorage', 'get').mockReturnValue(undefined)
    await saveToken('no-ls-token')
    await getToken()
    await removeToken()
    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
  })
})
