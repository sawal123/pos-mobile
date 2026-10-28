import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { Capacitor } from '@capacitor/core'

import { apiRequest } from '../services/cloud/apiClient'
import {
  clearPendingRegistrationMetadata,
} from '../services/cloud/authService'
import { getToken, _resetTokenStore } from '../services/cloud/tokenRepository'
import { createMemoryAdapter } from '../services/database/memoryAdapter'
import { useCloudSessionStore } from '../stores/cloudSessionStore'

vi.mock('../services/cloud/apiClient', () => ({
  apiRequest: vi.fn(),
}))

const USER_A = { id: 1, name: 'User A', email: 'a@example.com' }
const USER_B = { id: 2, name: 'User B', email: 'b@example.com' }
const TOKEN_A = 'token-a'
const TOKEN_B = 'token-b'

const BUSINESS = {
  id: 10,
  name: 'Toko Cloud',
  cloud_access: true,
  outlets: [{ id: 100, name: 'Outlet Utama', status: 'active' }],
  device_context: null,
}

const ok = (data) => ({ ok: true, status: 200, data: { data }, error: null })

function context(user = USER_A, businesses = []) {
  return ok({ user, businesses })
}

beforeEach(() => {
  setActivePinia(createPinia())
  apiRequest.mockReset()
  _resetTokenStore()
  clearPendingRegistrationMetadata()
  localStorage.clear()
  sessionStorage.clear()
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.doUnmock('@aparajita/capacitor-secure-storage')
})

async function withNativeSecureStorage(secureStorage, callback) {
  vi.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(true)
  vi.doMock('@aparajita/capacitor-secure-storage', () => ({ SecureStorage: secureStorage }))
  return callback()
}

describe('AUTH-M05 session state and safe finalization', () => {
  it('fails closed when manual login has no valid user identity', async () => {
    apiRequest.mockResolvedValueOnce(ok({ token_type: 'Bearer', token: 'token', user: null }))
    const store = useCloudSessionStore()

    const result = await store.login('owner@example.com', 'password')

    expect(result.ok).toBe(false)
    expect(result.error.code).toBe('MALFORMED_LOGIN_SUCCESS')
    expect(store.sessionState).toBe('unauthenticated')
    expect(await getToken()).toBeNull()
  })

  it('represents pending OTP and pending 2FA without creating a session', async () => {
    apiRequest.mockResolvedValueOnce({
      ok: true,
      status: 202,
      data: {
        data: {
          registration_id: 'registration-1',
          state: 'pending_email',
          otp_expires_at: '2099-01-01T00:30:00Z',
        },
      },
      error: null,
    })
    const store = useCloudSessionStore()

    await expect(
      store.register({
        name: 'Owner',
        email: 'owner@example.com',
        password: 'password123',
        password_confirmation: 'password123',
        business_name: 'Toko Baru',
      }),
    ).resolves.toMatchObject({ ok: true, state: 'pending_email' })
    expect(store.sessionState).toBe('pending_email')
    expect(await getToken()).toBeNull()

    apiRequest.mockResolvedValueOnce({
      ok: true,
      status: 202,
      data: {
        data: {
          challenge_id: 'challenge-1',
          expires_at: '2099-01-01T00:30:00Z',
          methods: ['totp'],
        },
        code: 'TWO_FACTOR_REQUIRED',
      },
      error: null,
    })

    const result = await store.login('owner@example.com', 'password123')

    expect(result.state).toBe('two_factor_required')
    expect(store.sessionState).toBe('pending_two_factor')
    expect(store.isAuthenticated).toBe(false)
    expect(await getToken()).toBeNull()
  })

  it('fails closed when Cloud context persistence fails after authentication', async () => {
    apiRequest.mockResolvedValueOnce(ok({ token_type: 'Bearer', token: TOKEN_A, user: USER_A }))
      .mockResolvedValueOnce(context(USER_A, []))
    const adapter = await createMemoryAdapter()
    await adapter.initialize()
    adapter.saveCloudContext = vi.fn().mockRejectedValue(new Error('storage unavailable'))
    const store = useCloudSessionStore()
    store.setPersistenceAdapter(adapter)

    const result = await store.login('a@example.com', 'password')

    expect(result.ok).toBe(false)
    expect(result.error.code).toBe('LOGIN_FAILED')
    expect(store.isAuthenticated).toBe(false)
    expect(await getToken()).toBeNull()
  })

  it('rejects malformed Cloud business context without creating a linked session', async () => {
    apiRequest.mockResolvedValueOnce(ok({ token_type: 'Bearer', token: TOKEN_A, user: USER_A }))
      .mockResolvedValueOnce(context(USER_A, [null]))
    const store = useCloudSessionStore()

    const result = await store.login('a@example.com', 'password')

    expect(result.ok).toBe(false)
    expect(result.error.code).toBe('MALFORMED_CONTEXT')
    expect(store.sessionState).toBe('unauthenticated')
    expect(await getToken()).toBeNull()
  })
})

describe('AUTH-M05 restart and authorization safety', () => {
  it('quarantines cached Cloud context when the secure token is missing', async () => {
    const adapter = await createMemoryAdapter()
    await adapter.initialize()
    await adapter.saveDeviceIdentifier('stable-device')
    await adapter.saveBusiness({ name: 'Local POS', type: 'retail', mode: 'free' })
    await adapter.saveCloudContext({
      user: USER_A,
      selectedBusiness: BUSINESS,
      cloudAccess: true,
    })

    const store = useCloudSessionStore()
    const result = await store.hydrateFromStorage(adapter)

    expect(result.authenticated).toBe(false)
    expect(store.sessionState).toBe('unauthenticated')
    expect(await adapter.loadCloudContext()).toBeNull()
    expect(await adapter.loadBusiness()).toMatchObject({ name: 'Local POS', mode: 'free' })
    expect(store.deviceIdentifier).toBe('stable-device')
  })

  it('restores cached context as linked_unverified and preserves it for display only', async () => {
    await (await import('../services/cloud/tokenRepository')).saveToken(TOKEN_A)
    const adapter = await createMemoryAdapter()
    await adapter.initialize()
    await adapter.saveCloudContext({
      user: USER_A,
      selectedBusiness: BUSINESS,
      cloudAccess: true,
      role: 'owner',
      syncCapabilities: { push: true },
    })

    const store = useCloudSessionStore()
    const result = await store.hydrateFromStorage(adapter)

    expect(result.authenticated).toBe(true)
    expect(store.sessionState).toBe('linked_unverified')
    expect(store.capabilityState).toBe('unverified')
    expect(apiRequest).not.toHaveBeenCalled()
  })

  it('keeps the session on HTTP 403 while failing Cloud capability closed', async () => {
    await (await import('../services/cloud/tokenRepository')).saveToken(TOKEN_A)
    const store = useCloudSessionStore()
    store.user = USER_A
    store.capabilityState = 'verified'
    apiRequest.mockResolvedValueOnce({
      ok: false,
      status: 403,
      data: null,
      error: { status: 403, code: 'SUBSCRIPTION_EXPIRED', message: 'subscription expired' },
    })

    const result = await store.refreshContext()

    expect(result.ok).toBe(false)
    expect(store.isAuthenticated).toBe(true)
    expect(store.sessionInvalid).toBe(false)
    expect(store.capabilityState).toBe('unverified')
    expect(await getToken()).toBe(TOKEN_A)
  })
})

describe('AUTH-M05 P1 secure storage failure handling', () => {
  function prepareLinkedStore() {
    const store = useCloudSessionStore()
    store.user = USER_A
    store.cloudAccess = true
    store.capabilityState = 'verified'
    return store
  }

  it('clears local authorization on HTTP 401 when secure token read during removal throws', async () => {
    const secureStorage = {
      get: vi.fn()
        .mockResolvedValueOnce(TOKEN_A)
        .mockRejectedValueOnce(new Error('secure read failed')),
      remove: vi.fn().mockResolvedValue(undefined),
    }

    await withNativeSecureStorage(secureStorage, async () => {
      const store = prepareLinkedStore()
      apiRequest.mockResolvedValueOnce({
        ok: false,
        status: 401,
        data: null,
        error: { status: 401, code: 'HTTP_401', message: 'Unauthenticated' },
      })

      const result = await store.refreshContext()

      expect(result.code).toBe('TOKEN_REMOVAL_FAILED')
      expect(store.isAuthenticated).toBe(false)
      expect(store.cloudAccess).toBe(false)
      expect(store.capabilityState).toBe('unknown')
      expect(store.sessionInvalid).toBe(true)
      expect(store.sessionState).toBe('session_invalid')
      await expect(store.ensureVerifiedContext()).resolves.toMatchObject({
        ok: false,
        code: 'NOT_AUTHENTICATED',
      })
    })
  })

  it('clears local authorization on HTTP 401 when secure token removal throws', async () => {
    const secureStorage = {
      get: vi.fn().mockResolvedValue(TOKEN_A),
      remove: vi.fn().mockRejectedValue(new Error('secure remove failed')),
    }

    await withNativeSecureStorage(secureStorage, async () => {
      const store = prepareLinkedStore()
      apiRequest.mockResolvedValueOnce({
        ok: false,
        status: 401,
        data: null,
        error: { status: 401, code: 'HTTP_401', message: 'Unauthenticated' },
      })

      const result = await store.refreshContext()

      expect(result.code).toBe('TOKEN_REMOVAL_FAILED')
      expect(store.isAuthenticated).toBe(false)
      expect(store.cloudAccess).toBe(false)
      expect(store.sessionInvalid).toBe(true)
      expect(store.canPerformCloudPush).toBe(false)
    })
  })

  it('does not clear a newer session when token ownership changed', async () => {
    const secureStorage = {
      get: vi.fn().mockResolvedValueOnce(TOKEN_B).mockResolvedValueOnce(TOKEN_B),
      remove: vi.fn().mockResolvedValue(undefined),
    }

    await withNativeSecureStorage(secureStorage, async () => {
      const store = useCloudSessionStore()
      store.user = USER_B
      store.cloudAccess = true
      store.capabilityState = 'verified'

      const result = await store.invalidateCloudSession({ token: TOKEN_A })

      expect(result.code).toBe('TOKEN_OWNERSHIP_CHANGED')
      expect(store.user).toMatchObject(USER_B)
      expect(store.isAuthenticated).toBe(true)
      expect(store.sessionInvalid).toBe(false)
      expect(secureStorage.remove).not.toHaveBeenCalled()
    })
  })

  it('returns TOKEN_REMOVAL_FAILED and disables Cloud authorization when logout token read throws', async () => {
    const adapter = await createMemoryAdapter()
    await adapter.initialize()
    await adapter.saveDeviceIdentifier('stable-device')
    await adapter.saveBusiness({ name: 'Local POS', type: 'retail', mode: 'cloud' })
    const secureStorage = {
      get: vi.fn().mockRejectedValue(new Error('secure read failed')),
      remove: vi.fn().mockResolvedValue(undefined),
    }

    await withNativeSecureStorage(secureStorage, async () => {
      const store = prepareLinkedStore()
      store.setPersistenceAdapter(adapter)
      store.deviceIdentifier = 'stable-device'
      const result = await store.logout()

      expect(result).toMatchObject({ ok: false, code: 'TOKEN_REMOVAL_FAILED' })
      expect(store.isAuthenticated).toBe(false)
      expect(store.cloudAccess).toBe(false)
      expect(store.sessionInvalid).toBe(true)
      expect(store.isOperationalCloudAccess).toBe(false)
      expect(store.deviceIdentifier).toBe('stable-device')
      expect(await adapter.loadBusiness()).toMatchObject({ name: 'Local POS' })
    })
  })

  it('returns TOKEN_REMOVAL_FAILED and disables Cloud authorization when logout removal throws', async () => {
    const adapter = await createMemoryAdapter()
    await adapter.initialize()
    await adapter.saveBusiness({ name: 'Local POS', type: 'retail', mode: 'cloud' })
    const secureStorage = {
      get: vi.fn().mockResolvedValue(TOKEN_A),
      remove: vi.fn().mockRejectedValue(new Error('secure remove failed')),
    }

    await withNativeSecureStorage(secureStorage, async () => {
      const store = prepareLinkedStore()
      store.setPersistenceAdapter(adapter)
      apiRequest.mockResolvedValueOnce({ ok: true, status: 204, data: null, error: null })

      const result = await store.logout()

      expect(result).toMatchObject({
        ok: false,
        code: 'TOKEN_REMOVAL_FAILED',
        serverRevocation: 'succeeded',
      })
      expect(store.isAuthenticated).toBe(false)
      expect(store.sessionInvalid).toBe(true)
      expect(store.isOperationalCloudAccess).toBe(false)
      expect(await adapter.loadBusiness()).toMatchObject({ name: 'Local POS' })
    })
  })

  it('reports server revocation failure separately after safe local logout', async () => {
    const secureStorage = {
      get: vi.fn().mockResolvedValue(TOKEN_A),
      remove: vi.fn().mockResolvedValue(undefined),
    }

    await withNativeSecureStorage(secureStorage, async () => {
      const store = prepareLinkedStore()
      apiRequest.mockResolvedValueOnce({
        ok: false,
        status: 0,
        data: null,
        error: { code: 'NETWORK_ERROR', message: 'offline' },
      })

      const result = await store.logout()

      expect(result).toMatchObject({
        ok: true,
        code: 'LOGGED_OUT',
        serverRevocation: 'failed',
      })
      expect(store.isAuthenticated).toBe(false)
      expect(store.sessionInvalid).toBe(false)
      expect(store.isOperationalCloudAccess).toBe(false)
    })
  })
})

describe('AUTH-M05 stale session ownership', () => {
  it('does not let an old login rollback remove a newer account token', async () => {
    let resolveOldContext
    let loginCount = 0
    apiRequest.mockImplementation((path, options = {}) => {
      if (path === '/api/v2/auth/login') {
        loginCount += 1
        const user = loginCount === 1 ? USER_A : USER_B
        const token = loginCount === 1 ? TOKEN_A : TOKEN_B
        return Promise.resolve(ok({ token_type: 'Bearer', token, user }))
      }
      if (path === '/api/mobile/context' && options.token === TOKEN_A) {
        return new Promise((resolve) => {
          resolveOldContext = resolve
        })
      }
      if (path === '/api/mobile/context' && options.token === TOKEN_B) {
        return Promise.resolve(context(USER_B, []))
      }
      if (path === '/api/auth/logout') {
        return Promise.resolve({ ok: true, status: 204, data: null, error: null })
      }
      return Promise.reject(new Error(`unexpected ${path}`))
    })

    const store = useCloudSessionStore()
    const oldLogin = store.login('a@example.com', 'password')
    await vi.waitFor(() => expect(resolveOldContext).toBeTypeOf('function'))

    await expect(store.logout()).resolves.toMatchObject({ ok: true })
    const newLogin = await store.login('b@example.com', 'password')
    expect(newLogin.ok).toBe(true)
    expect(await getToken()).toBe(TOKEN_B)

    resolveOldContext(context(USER_A, []))
    await expect(oldLogin).resolves.toMatchObject({ state: 'stale_operation' })

    expect(await getToken()).toBe(TOKEN_B)
    expect(store.user).toMatchObject(USER_B)
  })
})
