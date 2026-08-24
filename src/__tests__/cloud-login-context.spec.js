/**
 * P10 Cloud Login & Sync Context tests.
 *
 * Coverage:
 * - 1. Native secure token persistence (in-memory fallback, native Keystore/Keychain integration)
 * - 2. Cloud context persistence & lifecycle hydration (TEST A)
 * - 3. Logout clears persisted context (TEST B & TEST C)
 * - 4. Zero-business UI reachable & tested (TEST D)
 * - 5. Native token store contract & boundary isolation (TEST E)
 * - 6. Stable device identifier durability & error tolerance
 * - 7. Offline / FREE mode isolation
 * - 8. Strict sync boundary assertions (no /api/sync/push or /api/sync/pull)
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { mount, flushPromises } from '@vue/test-utils'
import { Capacitor } from '@capacitor/core'

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
import CloudLoginView from '../views/settings/CloudLoginView.vue'

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
// 2. Cloud Context Persistence & Hydration Lifecycle (TEST A)
// ════════════════════════════════════════════════════════════════════════════

describe('TEST A — Cloud context persistence & restart hydration', () => {
  it('persists cloud context throughout lifecycle and restores on simulated restart', async () => {
    const adapter = createMemoryAdapter()
    await adapter.initialize()

    // 1. Initial login + context
    apiRequest.mockResolvedValueOnce(
      makeOkResponse({ token_type: 'Bearer', token: MOCK_TOKEN, user: MOCK_USER }),
    )
    apiRequest.mockResolvedValueOnce(makeOkResponse(MOCK_CONTEXT))
    apiRequest.mockResolvedValueOnce(makeOkResponse({ id: 888 }))

    const store = useCloudSessionStore()
    store.setPersistenceAdapter(adapter)
    store.deviceIdentifier = 'stable-device-uuid-test-a'
    await adapter.saveDeviceIdentifier('stable-device-uuid-test-a')

    const loginRes = await store.login('test@example.com', 'secret')
    expect(loginRes.ok).toBe(true)

    // Context after login persisted
    let persistedCtx = await adapter.loadCloudContext()
    expect(persistedCtx).not.toBeNull()
    expect(persistedCtx.user).toMatchObject({ id: 1, email: 'test@example.com' })

    // 2. Select business
    await store.selectBusiness(MOCK_BUSINESS_CLOUD.id)
    persistedCtx = await adapter.loadCloudContext()
    expect(persistedCtx.selectedBusiness).toMatchObject({ id: 10, name: 'Toko A' })
    expect(persistedCtx.cloudAccess).toBe(true)

    // 3. Select outlet
    await store.selectOutlet(100)
    persistedCtx = await adapter.loadCloudContext()
    expect(persistedCtx.selectedOutlet).toMatchObject({ id: 100, name: 'Outlet Utama' })

    // 4. Register device
    const regRes = await store.doRegisterDevice({ platform: 'android' })
    expect(regRes.ok).toBe(true)
    persistedCtx = await adapter.loadCloudContext()
    expect(persistedCtx.registeredDeviceId).toBe(888)

    // 5. Simulate App Restart: new Pinia, new store instance, same adapter
    const newPinia = createPinia()
    setActivePinia(newPinia)
    const restartStore = useCloudSessionStore(newPinia)

    expect(restartStore.isAuthenticated).toBe(false)
    expect(restartStore.user).toBeNull()

    // Hydrate
    const hydrationRes = await restartStore.hydrateFromStorage(adapter)
    expect(hydrationRes.ok).toBe(true)
    expect(hydrationRes.authenticated).toBe(true)

    // Assert restored state
    expect(restartStore.user).toMatchObject({ id: 1, email: 'test@example.com' })
    expect(restartStore.selectedBusiness).toMatchObject({ id: 10, name: 'Toko A' })
    expect(restartStore.selectedOutlet).toMatchObject({ id: 100, name: 'Outlet Utama' })
    expect(restartStore.cloudAccess).toBe(true)
    expect(restartStore.registeredDeviceId).toBe(888)
    expect(restartStore.deviceIdentifier).toBe('stable-device-uuid-test-a')

    // Strict check: no sync endpoints called during login, hydration, or lifecycle
    const calledPaths = apiRequest.mock.calls.map((c) => c[0])
    expect(calledPaths).not.toContain('/api/sync/push')
    expect(calledPaths).not.toContain('/api/sync/pull')
  })
})

// ════════════════════════════════════════════════════════════════════════════
// 3. Logout Lifecycle (TEST B & TEST C)
// ════════════════════════════════════════════════════════════════════════════

describe('TEST B — Logout clears persisted context and leaves POS data intact', () => {
  it('logout cleans token, persisted context, and Pinia without touching POS data', async () => {
    const adapter = createMemoryAdapter()
    await adapter.initialize()

    // Pre-populate POS products, customers, transactions, and sync_queue
    await adapter.saveProducts(
      [{ id: 'p1', name: 'Kopi', category: 'Minuman', price: 15000, stock: 10, isActive: true }],
      ['Minuman'],
    )
    await adapter.saveCustomers([{ id: 'c1', name: 'Budi', phone: '0812', email: 'budi@x.com' }])
    await adapter.saveTransactions([{ id: 'tx1', total: 15000, createdAt: new Date().toISOString() }])
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
    await adapter.saveDeviceIdentifier('stable-device-uuid-logout')

    // Simulate active session
    await saveToken(MOCK_TOKEN)
    const store = useCloudSessionStore()
    store.setPersistenceAdapter(adapter)
    store.user = MOCK_USER
    store.selectedBusiness = { id: 10, name: 'Toko A' }
    store.selectedOutlet = { id: 100, name: 'Outlet Utama' }
    store.cloudAccess = true
    store.registeredDeviceId = 777
    store.deviceIdentifier = 'stable-device-uuid-logout'
    await store.persistCloudContext()

    // Mock logout API response
    apiRequest.mockResolvedValueOnce({ ok: true, status: 200, data: null, error: null })

    // Execute logout
    await store.logout()

    // Assert Pinia state cleared
    expect(store.isAuthenticated).toBe(false)
    expect(store.user).toBeNull()
    expect(store.selectedBusiness).toBeNull()
    expect(store.selectedOutlet).toBeNull()
    expect(store.registeredDeviceId).toBeNull()

    // Assert token removed
    expect(await getToken()).toBeNull()

    // Assert persisted cloud context is cleared
    const persistedCtx = await adapter.loadCloudContext()
    expect(persistedCtx).toBeNull()

    // Simulate restart after logout
    const newPinia = createPinia()
    setActivePinia(newPinia)
    const freshStore = useCloudSessionStore(newPinia)
    const hydRes = await freshStore.hydrateFromStorage(adapter)
    expect(hydRes.authenticated).toBe(false)
    expect(freshStore.user).toBeNull()

    // POS DATA MUST REMAIN INTACT
    expect(freshStore.deviceIdentifier).toBe('stable-device-uuid-logout')
    const products = await adapter.loadProducts()
    expect(products.products).toHaveLength(1)
    const customers = await adapter.loadCustomers()
    expect(customers).toHaveLength(1)
    const txs = await adapter.loadTransactions()
    expect(txs).toHaveLength(1)
    const queueCount = await adapter.countSyncQueueItems()
    expect(queueCount).toBe(1)
  })
})

describe('TEST C — Logout network failure still clears local credentials & context', () => {
  it('clears token, context, and Pinia session even if network is offline', async () => {
    const adapter = createMemoryAdapter()
    await adapter.initialize()
    await adapter.saveDeviceIdentifier('stable-device-uuid-c')

    await saveToken(MOCK_TOKEN)
    const store = useCloudSessionStore()
    store.setPersistenceAdapter(adapter)
    store.user = MOCK_USER
    store.selectedBusiness = { id: 10, name: 'Toko A' }
    store.selectedOutlet = { id: 100, name: 'Outlet Utama' }
    store.cloudAccess = true
    store.deviceIdentifier = 'stable-device-uuid-c'
    await store.persistCloudContext()

    // Mock network failure on logout
    apiRequest.mockResolvedValueOnce({
      ok: false,
      status: 0,
      data: null,
      error: { code: 'NETWORK_ERROR', message: 'No internet connection' },
    })

    const logoutRes = await store.logout()
    expect(logoutRes.ok).toBe(true)

    // Token and context must still be cleaned locally
    expect(await getToken()).toBeNull()
    expect(await adapter.loadCloudContext()).toBeNull()
    expect(store.isAuthenticated).toBe(false)
    expect(store.deviceIdentifier).toBe('stable-device-uuid-c')
  })
})

// ════════════════════════════════════════════════════════════════════════════
// 4. Zero Business UI (TEST D)
// ════════════════════════════════════════════════════════════════════════════

describe('TEST D — Zero business UI handling', () => {
  it('displays zero-business notice and prevents outlet/device registration when user has 0 businesses', async () => {
    apiRequest.mockResolvedValueOnce(
      makeOkResponse({ token_type: 'Bearer', token: MOCK_TOKEN, user: MOCK_USER }),
    )
    apiRequest.mockResolvedValueOnce(
      makeOkResponse({
        user: MOCK_USER,
        businesses: [], // ZERO businesses
      }),
    )

    const wrapper = mount(CloudLoginView)

    // Fill form and trigger login
    await wrapper.find('#cloud-email input').setValue('test@example.com')
    await wrapper.find('#cloud-password input').setValue('secret')
    await wrapper.find('#cloud-login-btn').trigger('click')

    // Wait for Vue reactivity & async login
    await flushPromises()

    // Assert zero-business card is rendered and reachable
    const zeroBizCard = wrapper.find('#cloud-no-business')
    expect(zeroBizCard.exists()).toBe(true)
    expect(zeroBizCard.text()).toContain('Akun Anda belum memiliki Business')

    // Normal logged-in card with empty business must NOT be shown
    expect(wrapper.find('#cloud-logged-in').exists()).toBe(false)

    // Device registration must NOT have been called
    const devCalls = apiRequest.mock.calls.filter((c) => c[0] === '/api/mobile/devices')
    expect(devCalls).toHaveLength(0)
  })

  it('regression: hydrated logged-in state renders correctly without false zero-business notice or network calls', async () => {
    // 1. Buat adapter
    const adapter = createMemoryAdapter()
    await adapter.initialize()

    // 2. Simpan stable device_identifier
    await adapter.saveDeviceIdentifier('stable-device-uuid-hydrated-ui')

    // 3. Simpan cloud_context
    await adapter.saveCloudContext({
      user: MOCK_USER,
      selectedBusiness: { id: 10, name: 'Toko A' },
      selectedOutlet: { id: 100, name: 'Outlet Utama' },
      cloudAccess: true,
      registeredDeviceId: 888,
    })

    // 4. Simpan token melalui token repository
    await saveToken(MOCK_TOKEN)

    // 5. Buat Pinia baru
    const pinia = createPinia()
    setActivePinia(pinia)

    // 6. Buat cloud store baru
    const store = useCloudSessionStore(pinia)

    // 7. Jalankan hydration
    const hydRes = await store.hydrateFromStorage(adapter)
    expect(hydRes.ok).toBe(true)
    expect(hydRes.authenticated).toBe(true)

    // 8. Mount CloudLoginView
    const wrapper = mount(CloudLoginView, {
      global: {
        plugins: [pinia],
      },
    })

    // 9. Tunggu Vue lifecycle / flushPromises
    await flushPromises()

    // Assert: #cloud-no-business TIDAK ada
    expect(wrapper.find('#cloud-no-business').exists()).toBe(false)

    // Assert: #cloud-logged-in ada
    const loggedInCard = wrapper.find('#cloud-logged-in')
    expect(loggedInCard.exists()).toBe(true)

    // Assert: data hasil hydration tampil
    expect(loggedInCard.text()).toContain(MOCK_USER.email)
    expect(loggedInCard.text()).toContain('Toko A')
    expect(loggedInCard.text()).toContain('Outlet Utama')
    expect(loggedInCard.text()).toContain('Aktif')
    expect(loggedInCard.text()).toContain('Terdaftar')

    // Assert: tidak ada network request (offline-only hydration)
    const calledPaths = apiRequest.mock.calls.map((c) => c[0])
    expect(calledPaths).not.toContain('/api/mobile/context')
    expect(calledPaths).not.toContain('/api/sync/push')
    expect(calledPaths).not.toContain('/api/sync/pull')
  })

  it('regression: genuine zero-business state survives restart/hydration and keeps zero-business notice visible', async () => {
    const adapter = createMemoryAdapter()
    await adapter.initialize()
    await adapter.saveDeviceIdentifier('stable-device-uuid-zero-biz')

    // 1. Login with 0 businesses
    apiRequest.mockResolvedValueOnce(
      makeOkResponse({ token_type: 'Bearer', token: MOCK_TOKEN, user: MOCK_USER }),
    )
    apiRequest.mockResolvedValueOnce(
      makeOkResponse({
        user: MOCK_USER,
        businesses: [], // ZERO businesses
      }),
    )

    const initialPinia = createPinia()
    setActivePinia(initialPinia)
    const initialStore = useCloudSessionStore(initialPinia)
    initialStore.setPersistenceAdapter(adapter)

    const loginRes = await initialStore.login('test@example.com', 'secret')
    expect(loginRes.ok).toBe(true)
    expect(initialStore.hasResolvedZeroBusiness).toBe(true)

    // Context persisted in adapter with hasResolvedZeroBusiness: true
    const persistedCtx = await adapter.loadCloudContext()
    expect(persistedCtx.hasResolvedZeroBusiness).toBe(true)
    expect(persistedCtx.selectedBusiness).toBeNull()

    // 2. Simulate restart: new Pinia, new store, hydrate from adapter
    const restartPinia = createPinia()
    setActivePinia(restartPinia)
    const restartStore = useCloudSessionStore(restartPinia)

    const hydRes = await restartStore.hydrateFromStorage(adapter)
    expect(hydRes.ok).toBe(true)
    expect(hydRes.authenticated).toBe(true)
    expect(restartStore.hasResolvedZeroBusiness).toBe(true)
    expect(restartStore.selectedBusiness).toBeNull()

    // 3. Mount CloudLoginView with hydrated store
    const wrapper = mount(CloudLoginView, {
      global: {
        plugins: [restartPinia],
      },
    })
    await flushPromises()

    // Assert: #cloud-no-business tetap tampil
    const zeroBizCard = wrapper.find('#cloud-no-business')
    expect(zeroBizCard.exists()).toBe(true)
    expect(zeroBizCard.text()).toContain('Akun Anda belum memiliki Business')

    // Assert: #cloud-logged-in TIDAK tampil
    expect(wrapper.find('#cloud-logged-in').exists()).toBe(false)

    // Assert: tidak ada network request tambahan selama restart/hydration
    const restartCalledPaths = apiRequest.mock.calls.slice(2).map((c) => c[0])
    expect(restartCalledPaths).not.toContain('/api/mobile/context')
    expect(restartCalledPaths).not.toContain('/api/sync/push')
    expect(restartCalledPaths).not.toContain('/api/sync/pull')
  })
})

// ════════════════════════════════════════════════════════════════════════════
// 5. Native Token Store Contract (TEST E)
// ════════════════════════════════════════════════════════════════════════════

describe('TEST E — Token repository contract & native isolation', () => {
  it('browser/Vitest: uses in-memory store and never calls localStorage', async () => {
    const lsSpy = vi.spyOn(globalThis, 'localStorage', 'get').mockReturnValue(undefined)

    await saveToken('token-123')
    expect(await getToken()).toBe('token-123')
    await removeToken()
    expect(await getToken()).toBeNull()

    expect(lsSpy).not.toHaveBeenCalled()
    lsSpy.mockRestore()
  })

  it('native environment: detects platform and delegates to secure storage plugin', async () => {
    const isNativeSpy = vi.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(true)

    // Mock the dynamic import of @aparajita/capacitor-secure-storage
    const secureStorageMock = {
      set: vi.fn().mockResolvedValue(undefined),
      get: vi.fn().mockResolvedValue('native-secure-token'),
      remove: vi.fn().mockResolvedValue(true),
    }

    vi.doMock('@aparajita/capacitor-secure-storage', () => ({
      SecureStorage: secureStorageMock,
    }))

    await saveToken('native-token-abc')
    expect(secureStorageMock.set).toHaveBeenCalledWith('cloud_bearer_token', 'native-token-abc')

    const read = await getToken()
    expect(secureStorageMock.get).toHaveBeenCalledWith('cloud_bearer_token')
    expect(read).toBe('native-secure-token')

    await removeToken()
    expect(secureStorageMock.remove).toHaveBeenCalledWith('cloud_bearer_token')

    isNativeSpy.mockRestore()
    vi.doUnmock('@aparajita/capacitor-secure-storage')
  })
})

// ════════════════════════════════════════════════════════════════════════════
// 6. Stable Device Identifier
// ════════════════════════════════════════════════════════════════════════════

describe('resolveDeviceIdentifier', () => {
  it('generates UUID once and returns same value on subsequent calls', async () => {
    const adapter = createMemoryAdapter()
    await adapter.initialize()

    const id1 = await resolveDeviceIdentifier(adapter)
    const id2 = await resolveDeviceIdentifier(adapter)

    expect(id1).toBeTruthy()
    expect(id1).toBe(id2)
    expect(typeof id1).toBe('string')
  })

  it('DEVICE_INACTIVE & DEVICE_OUTLET_MISMATCH do not regenerate identifier', async () => {
    const store = useCloudSessionStore()
    apiRequest.mockResolvedValueOnce(
      makeOkResponse({ token_type: 'Bearer', token: MOCK_TOKEN, user: MOCK_USER }),
    )
    apiRequest.mockResolvedValueOnce(makeOkResponse(MOCK_CONTEXT))
    await store.login('test@example.com', 'secret')
    await store.selectBusiness(MOCK_BUSINESS_CLOUD.id)
    await store.selectOutlet(100)
    store.deviceIdentifier = 'fixed-uuid-999'

    // Error 1: DEVICE_INACTIVE
    apiRequest.mockResolvedValueOnce(makeErrorResponse(403, 'DEVICE_INACTIVE', 'Device inactive'))
    let res = await store.doRegisterDevice()
    expect(res.ok).toBe(false)
    expect(store.deviceIdentifier).toBe('fixed-uuid-999')

    // Error 2: DEVICE_OUTLET_MISMATCH
    apiRequest.mockResolvedValueOnce(
      makeErrorResponse(409, 'DEVICE_OUTLET_MISMATCH', 'Outlet mismatch'),
    )
    res = await store.doRegisterDevice()
    expect(res.ok).toBe(false)
    expect(store.deviceIdentifier).toBe('fixed-uuid-999')
  })
})

// ════════════════════════════════════════════════════════════════════════════
// 7. Outlet Selection & Cloud Access Guard
// ════════════════════════════════════════════════════════════════════════════

describe('Outlet selection & cloud access rules', () => {
  it('rejects inactive outlets and requires active status', async () => {
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
              { id: 201, name: 'Active Outlet', status: 'active' },
              { id: 202, name: 'Inactive Outlet', status: 'inactive' },
            ],
          },
        ],
      }),
    )

    await store.login('test@example.com', 'secret')
    await store.selectBusiness(MOCK_BUSINESS_CLOUD.id)

    const bad = await store.selectOutlet(202)
    expect(bad.ok).toBe(false)

    const good = await store.selectOutlet(201)
    expect(good.ok).toBe(true)
    expect(store.selectedOutlet?.id).toBe(201)
  })

  it('cloud_access = false stops device registration and leaves local POS functional', async () => {
    const store = useCloudSessionStore()
    apiRequest.mockResolvedValueOnce(
      makeOkResponse({ token_type: 'Bearer', token: MOCK_TOKEN, user: MOCK_USER }),
    )
    apiRequest.mockResolvedValueOnce(
      makeOkResponse({ user: MOCK_USER, businesses: [MOCK_BUSINESS_NO_CLOUD] }),
    )

    await store.login('test@example.com', 'secret')
    await store.selectBusiness(MOCK_BUSINESS_NO_CLOUD.id)
    store.deviceIdentifier = 'dev-uuid'

    const reg = await store.doRegisterDevice()
    expect(reg.ok).toBe(false)
    expect(reg.error.code).toBe('NO_CLOUD_ACCESS')

    // Verify /api/mobile/devices was never called
    const devCalls = apiRequest.mock.calls.filter((c) => c[0] === '/api/mobile/devices')
    expect(devCalls).toHaveLength(0)
  })
})

// ════════════════════════════════════════════════════════════════════════════
// 8. Strict Sync Isolation Assertions
// ════════════════════════════════════════════════════════════════════════════

describe('Strict Sync Isolation Assertions', () => {
  it('never calls /api/sync/push or /api/sync/pull across all auth flows', async () => {
    apiRequest.mockResolvedValueOnce(
      makeOkResponse({ token_type: 'Bearer', token: MOCK_TOKEN, user: MOCK_USER }),
    )
    apiRequest.mockResolvedValueOnce(makeOkResponse(MOCK_CONTEXT))
    apiRequest.mockResolvedValueOnce(makeOkResponse({ id: 99 }))

    const store = useCloudSessionStore()
    await store.login('test@example.com', 'secret')
    await store.selectBusiness(MOCK_BUSINESS_CLOUD.id)
    await store.selectOutlet(100)
    store.deviceIdentifier = 'dev-uuid'
    await store.doRegisterDevice()

    const allCalledEndpoints = apiRequest.mock.calls.map((c) => c[0])
    expect(allCalledEndpoints).not.toContain('/api/sync/push')
    expect(allCalledEndpoints).not.toContain('/api/sync/pull')
  })
})
