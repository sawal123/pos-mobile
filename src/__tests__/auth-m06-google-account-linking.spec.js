import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { flushPromises, mount } from '@vue/test-utils'

const nativeSignIn = vi.hoisted(() => vi.fn())
const nativeCancel = vi.hoisted(() => vi.fn())

vi.mock('../services/cloud/apiClient', () => ({
  apiRequest: vi.fn(),
}))

vi.mock('../services/cloud/googleNativeAuthService', () => ({
  signInWithGoogle: nativeSignIn,
  cancelGoogleSignIn: nativeCancel,
}))

import { apiRequest } from '../services/cloud/apiClient'
import {
  cloudGoogleLogin,
  cloudLinkGoogleAccount,
  cloudReauthenticateForGoogleLink,
  fetchMobileAuthMethods,
} from '../services/cloud/authService'
import { describeGoogleLinkError, describeGoogleLoginError } from '../services/cloud/cloudLoginErrors'
import { getToken, _resetTokenStore, saveToken } from '../services/cloud/tokenRepository'
import { createMemoryAdapter } from '../services/database/memoryAdapter'
import { useCloudSessionStore } from '../stores/cloudSessionStore'
import CloudGoogleLinkCard from '../components/cloud/auth/CloudGoogleLinkCard.vue'
import CloudLoginView from '../views/settings/CloudLoginView.vue'

const USER = { id: 7, name: 'Manual Owner', email: 'owner@example.com' }
const TOKEN = 'existing-sanctum-token'
const GRANT = 'opaque-reauth-grant'
const GOOGLE_ID_TOKEN = 'fresh-google-id-token'
const BUSINESS = { id: 21, name: 'Toko Lama', cloud_access: true, outlets: [] }
const OUTLET = { id: 31, name: 'Outlet Utama', status: 'active' }

const ok = (data, status = 200) => ({ ok: true, status, data: { data }, error: null })
const fail = (status, code) => ({
  ok: false,
  status,
  data: null,
  error: { status, code, message: code, data: null },
})

function authMethods(methods = ['manual'], user = USER) {
  return ok({
    user,
    email_verified: true,
    two_factor_enabled: false,
    authentication_methods: methods,
  })
}

function configureApi({ methods = ['manual'], linkResponse = { provider: 'google', linked: true } } = {}) {
  let currentMethods = methods
  apiRequest.mockImplementation(async (path, options = {}) => {
    if (path === '/api/v2/auth/me') return authMethods(currentMethods)
    if (path === '/api/v2/auth/reauthenticate') {
      return ok({ reauthentication_token: GRANT, expires_in: 300, purpose: 'google_link' })
    }
    if (path === '/api/v2/auth/google/link') {
      currentMethods = ['manual', 'google']
      return ok(linkResponse)
    }
    if (path === '/api/auth/logout') return ok({ message: 'Logged out successfully.' })
    throw new Error(`Unexpected request ${path} ${options.method ?? 'GET'}`)
  })
  return { setMethods: (next) => { currentMethods = next } }
}

function prepareAuthenticatedStore() {
  const store = useCloudSessionStore()
  store.user = { ...USER }
  store.cloudAccess = true
  store.capabilityState = 'verified'
  store.selectedBusiness = { ...BUSINESS, outlets: [OUTLET] }
  store.selectedOutlet = { ...OUTLET }
  return store
}

async function advanceToGooglePicker(wrapper) {
  await wrapper.get('[data-testid="google-link-refresh-methods"]').trigger('click')
  await flushPromises()
  await wrapper.get('[data-testid="google-link-open"]').trigger('click')
  await wrapper.get('[data-testid="google-link-continue"]').trigger('click')
  await wrapper.get('[data-testid="google-link-password"]').setValue('password')
  await wrapper.get('[data-testid="google-link-reauth-form"]').trigger('submit')
  await flushPromises()
  expect(wrapper.get('[data-testid="google-link-picker-step"]').exists()).toBe(true)
}

beforeEach(() => {
  setActivePinia(createPinia())
  apiRequest.mockReset()
  nativeSignIn.mockReset()
  nativeCancel.mockReset().mockResolvedValue(undefined)
  _resetTokenStore()
  localStorage.clear()
  sessionStorage.clear()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('AUTH-M06 service contracts', () => {
  it('fetches and validates v2 authentication methods without replacing the session token', async () => {
    apiRequest.mockResolvedValueOnce(authMethods(['manual', 'google']))

    await expect(fetchMobileAuthMethods(TOKEN)).resolves.toMatchObject({
      ok: true,
      user: USER,
      authenticationMethods: ['manual', 'google'],
    })
    expect(apiRequest).toHaveBeenCalledWith('/api/v2/auth/me', { token: TOKEN })
  })

  it('rejects malformed reauthentication responses and never treats the grant as a bearer token', async () => {
    apiRequest.mockResolvedValueOnce(ok({ reauthentication_token: GRANT, expires_in: 300, purpose: 'wrong' }))

    await expect(cloudReauthenticateForGoogleLink(TOKEN, 'password')).resolves.toMatchObject({
      ok: false,
      error: { code: 'MALFORMED_REAUTHENTICATION_RESPONSE' },
    })
    expect(apiRequest).toHaveBeenCalledWith('/api/v2/auth/reauthenticate', {
      method: 'POST',
      body: { password: 'password' },
      token: TOKEN,
    })
  })

  it('sends the existing Sanctum token and accepts linked:false as idempotent success', async () => {
    apiRequest.mockResolvedValueOnce(ok({ provider: 'google', linked: false }))

    await expect(
      cloudLinkGoogleAccount(TOKEN, GRANT, GOOGLE_ID_TOKEN, 'android'),
    ).resolves.toMatchObject({ ok: true, provider: 'google', linked: false })
    expect(apiRequest).toHaveBeenCalledWith('/api/v2/auth/google/link', {
      method: 'POST',
      body: {
        reauthentication_token: GRANT,
        id_token: GOOGLE_ID_TOKEN,
        client_platform: 'android',
      },
      token: TOKEN,
    })
  })

  it('rejects a non-200 link response instead of treating it as success', async () => {
    apiRequest.mockResolvedValueOnce(ok({ provider: 'google', linked: true }, 202))

    await expect(
      cloudLinkGoogleAccount(TOKEN, GRANT, GOOGLE_ID_TOKEN, 'android'),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: 'MALFORMED_GOOGLE_LINK_RESPONSE' },
    })
  })

  it('does not convert ACCOUNT_LINK_REQUIRED into a new login session', async () => {
    apiRequest.mockResolvedValueOnce(fail(409, 'ACCOUNT_LINK_REQUIRED'))

    await expect(cloudGoogleLogin(GOOGLE_ID_TOKEN)).resolves.toMatchObject({
      ok: false,
      error: { status: 409, code: 'ACCOUNT_LINK_REQUIRED' },
    })
    expect(await getToken()).toBeNull()
  })

  it('maps sensitive linking failures to safe Indonesian messages', () => {
    expect(describeGoogleLoginError({ status: 409, code: 'ACCOUNT_LINK_REQUIRED' }).kind).toBe(
      'account-link-required',
    )
    expect(describeGoogleLinkError({ status: 409, code: 'IDENTITY_ALREADY_LINKED' }).message).toContain(
      'akun lain',
    )
    expect(describeGoogleLinkError({ status: 0, code: 'NETWORK_ERROR' }).kind).toBe('uncertain')
  })
})

describe('AUTH-M06 authenticated linking lifecycle', () => {
  it('keeps the linking card and reauthentication modal mounted while the parent store is loading', async () => {
    const store = prepareAuthenticatedStore()
    await saveToken(TOKEN)
    let authMethodCall = 0
    let resolveMethods
    let resolveReauth
    let resolveLink
    apiRequest.mockImplementation((path) => {
      if (path === '/api/v2/auth/me') {
        authMethodCall += 1
        if (authMethodCall === 1) {
          return new Promise((resolve) => { resolveMethods = resolve })
        }
        return Promise.resolve(authMethods(['manual', 'google']))
      }
      if (path === '/api/v2/auth/reauthenticate') {
        return new Promise((resolve) => { resolveReauth = resolve })
      }
      if (path === '/api/v2/auth/google/link') {
        return new Promise((resolve) => { resolveLink = resolve })
      }
      throw new Error(`Unexpected request ${path}`)
    })
    nativeSignIn.mockResolvedValue({ ok: true, state: 'success', idToken: GOOGLE_ID_TOKEN })

    const wrapper = mount(CloudLoginView)
    await wrapper.get('[data-testid="google-link-refresh-methods"]').trigger('click')
    await vi.waitFor(() => expect(resolveMethods).toBeTypeOf('function'))
    expect(store.loading).toBe(true)
    expect(wrapper.get('[data-testid="cloud-google-link-card"]').exists()).toBe(true)

    resolveMethods(authMethods(['manual']))
    await flushPromises()
    await wrapper.get('[data-testid="google-link-open"]').trigger('click')
    await wrapper.get('[data-testid="google-link-continue"]').trigger('click')
    await wrapper.get('[data-testid="google-link-password"]').setValue('password')
    await wrapper.get('[data-testid="google-link-reauth-form"]').trigger('submit')
    await vi.waitFor(() => expect(resolveReauth).toBeTypeOf('function'))
    expect(store.loading).toBe(true)
    expect(wrapper.get('[data-testid="google-link-reauth-form"]').exists()).toBe(true)

    resolveReauth(ok({ reauthentication_token: GRANT, expires_in: 300, purpose: 'google_link' }))
    await flushPromises()
    expect(wrapper.get('[data-testid="google-link-picker-step"]').exists()).toBe(true)

    await wrapper.get('[data-testid="google-link-picker-button"]').trigger('click')
    await vi.waitFor(() => expect(resolveLink).toBeTypeOf('function'))
    await wrapper.get('[data-testid="google-link-picker-button"]').trigger('click')
    expect(apiRequest.mock.calls.filter(([path]) => path === '/api/v2/auth/google/link')).toHaveLength(1)
    expect(wrapper.get('[data-testid="cloud-google-link-card"]').exists()).toBe(true)

    resolveLink(ok({ provider: 'google', linked: true }))
    await flushPromises()
    expect(wrapper.get('[data-testid="google-link-success"]').text()).toContain('berhasil')
  })

  it('resets account-specific linking UI and re-verifies the new account after an identity switch', async () => {
    const accountB = { id: 8, name: 'New Owner', email: 'new@example.com' }
    const store = prepareAuthenticatedStore()
    await saveToken(TOKEN)
    let resolveReauth
    let methodCall = 0
    apiRequest.mockImplementation((path) => {
      if (path === '/api/v2/auth/me') {
        methodCall += 1
        return Promise.resolve(methodCall === 1
          ? authMethods(['manual'], USER)
          : authMethods(['manual'], accountB))
      }
      if (path === '/api/v2/auth/reauthenticate') {
        return new Promise((resolve) => { resolveReauth = resolve })
      }
      throw new Error(`Unexpected request ${path}`)
    })

    const wrapper = mount(CloudGoogleLinkCard)
    await wrapper.get('[data-testid="google-link-refresh-methods"]').trigger('click')
    await flushPromises()
    await wrapper.get('[data-testid="google-link-open"]').trigger('click')
    await wrapper.get('[data-testid="google-link-continue"]').trigger('click')
    await wrapper.get('[data-testid="google-link-password"]').setValue('password')
    await wrapper.get('[data-testid="google-link-reauth-form"]').trigger('submit')
    await vi.waitFor(() => expect(resolveReauth).toBeTypeOf('function'))

    store.user = accountB
    await saveToken('account-b-token')
    await flushPromises()

    expect(wrapper.get('[data-testid="cloud-google-link-card"]').text()).toContain('New Owner')
    expect(wrapper.find('[data-testid="google-link-reauth-form"]').exists()).toBe(false)
    expect(wrapper.get('[data-testid="google-link-open"]').exists()).toBe(true)
    expect(methodCall).toBe(2)
    expect(await getToken()).toBe('account-b-token')

    resolveReauth(ok({ reauthentication_token: GRANT, expires_in: 300, purpose: 'google_link' }))
    await flushPromises()
    expect(wrapper.get('[data-testid="google-link-open"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="google-link-picker-step"]').exists()).toBe(false)
    expect(store.user).toMatchObject(accountB)
    expect(store.selectedBusiness).toMatchObject({
      id: BUSINESS.id,
      name: BUSINESS.name,
      cloud_access: BUSINESS.cloud_access,
    })
  })

  it('restarts verification after an expired grant response without unmounting the parent flow', async () => {
    const store = prepareAuthenticatedStore()
    await saveToken(TOKEN)
    let reauthCalls = 0
    let linkCalls = 0
    apiRequest.mockImplementation(async (path) => {
      if (path === '/api/v2/auth/me') return authMethods(['manual'])
      if (path === '/api/v2/auth/reauthenticate') {
        reauthCalls += 1
        return ok({
          reauthentication_token: `${GRANT}-${reauthCalls}`,
          expires_in: 300,
          purpose: 'google_link',
        })
      }
      if (path === '/api/v2/auth/google/link') {
        linkCalls += 1
        return linkCalls === 1
          ? fail(409, 'REAUTHENTICATION_EXPIRED')
          : ok({ provider: 'google', linked: true })
      }
      throw new Error(`Unexpected request ${path}`)
    })
    nativeSignIn
      .mockResolvedValueOnce({ ok: true, state: 'success', idToken: GOOGLE_ID_TOKEN })
      .mockResolvedValueOnce({ ok: true, state: 'success', idToken: 'fresh-google-id-token-2' })

    const wrapper = mount(CloudLoginView)
    await advanceToGooglePicker(wrapper)
    await wrapper.get('[data-testid="google-link-picker-button"]').trigger('click')
    await flushPromises()

    expect(wrapper.get('[data-testid="cloud-google-link-card"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="google-link-picker-step"]').exists()).toBe(false)
    expect(wrapper.get('[data-testid="google-link-open"]').exists()).toBe(true)
    expect(wrapper.get('[data-testid="google-link-error"]').text()).toContain('Verifikasi ulang')
    expect(linkCalls).toBe(1)
    expect(nativeSignIn).toHaveBeenCalledTimes(1)
    expect(await getToken()).toBe(TOKEN)
    expect(store.selectedBusiness).toMatchObject({ id: BUSINESS.id, name: BUSINESS.name })

    // Recovery is explicit: reauthentication happens before a new picker call.
    await wrapper.get('[data-testid="google-link-open"]').trigger('click')
    await wrapper.get('[data-testid="google-link-continue"]').trigger('click')
    await wrapper.get('[data-testid="google-link-password"]').setValue('password')
    await wrapper.get('[data-testid="google-link-reauth-form"]').trigger('submit')
    await flushPromises()
    expect(reauthCalls).toBe(2)
    expect(nativeSignIn).toHaveBeenCalledTimes(1)
    expect(wrapper.get('[data-testid="google-link-picker-step"]').exists()).toBe(true)

    await wrapper.get('[data-testid="google-link-picker-button"]').trigger('click')
    await flushPromises()
    expect(nativeSignIn).toHaveBeenCalledTimes(2)
    expect(linkCalls).toBe(2)
    expect(wrapper.get('[data-testid="google-link-success"]').text()).toContain('berhasil')
  })

  it.each(['REAUTHENTICATION_ALREADY_USED', 'REAUTHENTICATION_REQUIRED'])(
    'treats %s as an invalid grant and never reopens the picker automatically',
    async (invalidGrantCode) => {
      const store = prepareAuthenticatedStore()
      await saveToken(TOKEN)
      apiRequest.mockImplementation(async (path) => {
        if (path === '/api/v2/auth/me') return authMethods(['manual'])
        if (path === '/api/v2/auth/reauthenticate') {
          return ok({ reauthentication_token: GRANT, expires_in: 300, purpose: 'google_link' })
        }
        if (path === '/api/v2/auth/google/link') return fail(409, invalidGrantCode)
        throw new Error(`Unexpected request ${path}`)
      })
      nativeSignIn.mockResolvedValue({ ok: true, state: 'success', idToken: GOOGLE_ID_TOKEN })

      const wrapper = mount(CloudGoogleLinkCard)
      await advanceToGooglePicker(wrapper)
      await wrapper.get('[data-testid="google-link-picker-button"]').trigger('click')
      await flushPromises()

      expect(wrapper.find('[data-testid="google-link-picker-step"]').exists()).toBe(false)
      expect(wrapper.get('[data-testid="google-link-open"]').exists()).toBe(true)
      expect(wrapper.get('[data-testid="google-link-error"]').text()).toContain('Verifikasi ulang')
      expect(nativeSignIn).toHaveBeenCalledTimes(1)
      expect(apiRequest.mock.calls.filter(([path]) => path === '/api/v2/auth/google/link')).toHaveLength(1)
      expect(store.isAuthenticated).toBe(true)
      expect(await getToken()).toBe(TOKEN)
    },
  )

  it('shows an explicit manual-account CTA after a Google collision without creating a session', async () => {
    apiRequest.mockResolvedValueOnce(fail(409, 'ACCOUNT_LINK_REQUIRED'))
    nativeSignIn.mockResolvedValue({ ok: true, state: 'success', idToken: GOOGLE_ID_TOKEN })

    const wrapper = mount(CloudLoginView)
    await wrapper.get('[data-testid="cloud-google-button"]').trigger('click')
    await flushPromises()

    expect(wrapper.get('[data-testid="google-link-manual-handoff"]').text()).toContain(
      'Masuk ke Akun Lama',
    )
    expect(wrapper.get('[data-testid="google-link-manual-login"]').exists()).toBe(true)
    expect(useCloudSessionStore().isAuthenticated).toBe(false)
    expect(await getToken()).toBeNull()
  })

  it('requires explicit confirmation, reauthentication, and a fresh native Google assertion', async () => {
    const api = configureApi()
    const store = prepareAuthenticatedStore()
    await saveToken(TOKEN)
    const adapter = await createMemoryAdapter()
    await adapter.initialize()
    await adapter.saveBusiness({ name: 'POS offline', type: 'retail', mode: 'cloud' })
    await adapter.upsertSyncQueueItem({
      id: 'sale-1',
      entityType: 'transaction',
      entityId: 'sale-1',
      operation: 'upsert',
      payload: { total: 100 },
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    })
    store.setPersistenceAdapter(adapter)

    nativeSignIn.mockResolvedValue({ ok: true, state: 'success', idToken: GOOGLE_ID_TOKEN })
    const wrapper = mount(CloudGoogleLinkCard)
    await flushPromises()
    await wrapper.get('[data-testid="google-link-refresh-methods"]').trigger('click')
    await flushPromises()

    expect(wrapper.get('[data-testid="google-link-open"]').exists()).toBe(true)
    await wrapper.get('[data-testid="google-link-open"]').trigger('click')
    expect(apiRequest.mock.calls.some(([path]) => path === '/api/v2/auth/reauthenticate')).toBe(false)

    await wrapper.get('[data-testid="google-link-continue"]').trigger('click')
    await wrapper.get('[data-testid="google-link-password"]').setValue('password')
    await wrapper.get('[data-testid="google-link-reauth-form"]').trigger('submit')
    await flushPromises()
    expect(wrapper.get('[data-testid="google-link-picker-step"]').exists()).toBe(true)

    await wrapper.get('[data-testid="google-link-picker-button"]').trigger('click')
    await flushPromises()

    expect(apiRequest.mock.calls.filter(([path]) => path === '/api/v2/auth/google/link')).toHaveLength(1)
    expect(apiRequest.mock.calls.some(([path]) => path === '/api/v2/auth/google')).toBe(false)
    expect(apiRequest.mock.calls.find(([path]) => path === '/api/v2/auth/google/link')[1].token).toBe(TOKEN)
    expect(await getToken()).toBe(TOKEN)
    expect(store.selectedBusiness).toMatchObject({
      id: BUSINESS.id,
      name: BUSINESS.name,
      cloud_access: BUSINESS.cloud_access,
    })
    expect(store.selectedOutlet).toMatchObject(OUTLET)
    expect(await adapter.loadBusiness()).toMatchObject({ name: 'POS offline' })
    expect(await adapter.countSyncQueueItems()).toBe(1)
    expect(wrapper.get('[data-testid="google-link-success"]').text()).toContain('berhasil')
    expect(localStorage.length).toBe(0)
    expect(sessionStorage.length).toBe(0)
    expect(api.setMethods).toBeTypeOf('function')
  })

  it('does not offer manual linking for a verified Google-only account', async () => {
    configureApi({ methods: ['google'] })
    const store = prepareAuthenticatedStore()
    await saveToken(TOKEN)
    const wrapper = mount(CloudGoogleLinkCard)
    await wrapper.get('[data-testid="google-link-refresh-methods"]').trigger('click')
    await flushPromises()

    expect(wrapper.get('[data-testid="google-linked-status"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="google-link-open"]').exists()).toBe(false)
    expect(store.isAuthenticated).toBe(true)
  })

  it('accepts TOTP only after the backend explicitly requires it', async () => {
    configureApi()
    apiRequest.mockImplementationOnce(async (path) => {
      if (path === '/api/v2/auth/me') return authMethods(['manual'])
      throw new Error(`Unexpected initial request ${path}`)
    })
    const store = prepareAuthenticatedStore()
    await saveToken(TOKEN)
    apiRequest.mockImplementation(async (path) => {
      if (path === '/api/v2/auth/me') return authMethods(['manual'])
      if (path === '/api/v2/auth/reauthenticate') {
        if (apiRequest.mock.calls.filter(([p]) => p === '/api/v2/auth/reauthenticate').length === 1) {
          return fail(403, 'TWO_FACTOR_REQUIRED')
        }
        return ok({ reauthentication_token: GRANT, expires_in: 300, purpose: 'google_link' })
      }
      throw new Error(`Unexpected request ${path}`)
    })
    const wrapper = mount(CloudGoogleLinkCard)
    await flushPromises()
    await wrapper.get('[data-testid="google-link-refresh-methods"]').trigger('click')
    await flushPromises()
    await wrapper.get('[data-testid="google-link-open"]').trigger('click')
    await wrapper.get('[data-testid="google-link-continue"]').trigger('click')
    await wrapper.get('[data-testid="google-link-password"]').setValue('password')
    await wrapper.get('[data-testid="google-link-reauth-form"]').trigger('submit')
    await flushPromises()
    expect(wrapper.get('[data-testid="google-link-totp"]').exists()).toBe(true)

    await wrapper.get('[data-testid="google-link-totp"]').setValue('123456')
    await wrapper.get('[data-testid="google-link-reauth-form"]').trigger('submit')
    await flushPromises()
    expect(wrapper.get('[data-testid="google-link-picker-step"]').exists()).toBe(true)
    expect(store.isAuthenticated).toBe(true)
  })

  it('cancels native selection without logout or local data mutation', async () => {
    configureApi()
    const store = prepareAuthenticatedStore()
    await saveToken(TOKEN)
    nativeSignIn.mockResolvedValue({ ok: false, state: 'cancelled', code: 'USER_CANCELLED' })
    const wrapper = mount(CloudGoogleLinkCard)
    await flushPromises()
    await wrapper.get('[data-testid="google-link-refresh-methods"]').trigger('click')
    await flushPromises()
    await wrapper.get('[data-testid="google-link-open"]').trigger('click')
    await wrapper.get('[data-testid="google-link-continue"]').trigger('click')
    await wrapper.get('[data-testid="google-link-password"]').setValue('password')
    await wrapper.get('[data-testid="google-link-reauth-form"]').trigger('submit')
    await flushPromises()
    await wrapper.get('[data-testid="google-link-picker-button"]').trigger('click')
    await flushPromises()

    expect(store.isAuthenticated).toBe(true)
    expect(await getToken()).toBe(TOKEN)
    expect(nativeSignIn).toHaveBeenCalledTimes(1)
  })

  it('does not replay a grant after an uncertain link request when status cannot be verified', async () => {
    let authMethodCall = 0
    const store = prepareAuthenticatedStore()
    await saveToken(TOKEN)
    apiRequest.mockImplementation(async (path) => {
      if (path === '/api/v2/auth/me') {
        authMethodCall += 1
        return authMethodCall === 1 ? authMethods(['manual']) : fail(0, 'NETWORK_ERROR')
      }
      if (path === '/api/v2/auth/reauthenticate') {
        return ok({ reauthentication_token: GRANT, expires_in: 300, purpose: 'google_link' })
      }
      if (path === '/api/v2/auth/google/link') return fail(0, 'NETWORK_ERROR')
      throw new Error(`Unexpected request ${path}`)
    })

    await store.refreshAuthenticationMethods()
    await expect(store.reauthenticateForGoogleLink('password')).resolves.toMatchObject({ ok: true })
    const result = await store.linkGoogleAccount(GOOGLE_ID_TOKEN)

    expect(result).toMatchObject({ ok: false, code: 'LINK_STATUS_UNVERIFIED', uncertain: true })
    expect(apiRequest.mock.calls.filter(([path]) => path === '/api/v2/auth/google/link')).toHaveLength(1)
    expect(store.isAuthenticated).toBe(true)
  })

  it('preserves the existing bearer session when auth methods refresh returns another user', async () => {
    const store = prepareAuthenticatedStore()
    await saveToken(TOKEN)
    apiRequest.mockResolvedValueOnce(ok({
      user: { id: 999, name: 'Other', email: 'other@example.com' },
      email_verified: true,
      two_factor_enabled: false,
      authentication_methods: ['manual', 'google'],
    }))

    const result = await store.refreshAuthenticationMethods()
    expect(result).toMatchObject({ ok: false, error: { code: 'SESSION_CHANGED' } })
    expect(store.user).toMatchObject(USER)
    expect(await getToken()).toBe(TOKEN)
  })

  it('discards an expired in-memory grant without calling the link endpoint', async () => {
    const now = Date.now()
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(now)
    const store = prepareAuthenticatedStore()
    await saveToken(TOKEN)
    apiRequest
      .mockResolvedValueOnce(ok({
        user: USER,
        email_verified: true,
        two_factor_enabled: false,
        authentication_methods: ['manual'],
      }))
      .mockResolvedValueOnce(ok({
        reauthentication_token: GRANT,
        expires_in: 300,
        purpose: 'google_link',
      }))

    await store.refreshAuthenticationMethods()
    await expect(store.reauthenticateForGoogleLink('password')).resolves.toMatchObject({ ok: true })
    nowSpy.mockReturnValue(now + 301_000)
    const result = await store.linkGoogleAccount(GOOGLE_ID_TOKEN)

    expect(result).toMatchObject({ ok: false, error: { code: 'REAUTHENTICATION_EXPIRED' } })
    expect(apiRequest.mock.calls.some(([path]) => path === '/api/v2/auth/google/link')).toBe(false)
    nowSpy.mockRestore()
  })

  it('invalidates the pending link operation when logout supersedes reauthentication', async () => {
    const store = prepareAuthenticatedStore()
    await saveToken(TOKEN)
    let resolveReauth
    apiRequest.mockImplementation((path) => {
      if (path === '/api/v2/auth/reauthenticate') {
        return new Promise((resolve) => { resolveReauth = resolve })
      }
      if (path === '/api/auth/logout') return Promise.resolve(ok({ message: 'Logged out successfully.' }))
      throw new Error(`Unexpected request ${path}`)
    })

    const reauth = store.reauthenticateForGoogleLink('password')
    await vi.waitFor(() => expect(resolveReauth).toBeTypeOf('function'))
    const logout = store.logout()
    resolveReauth(ok({ reauthentication_token: GRANT, expires_in: 300, purpose: 'google_link' }))

    await expect(reauth).resolves.toMatchObject({ state: 'stale_operation' })
    await expect(logout).resolves.toMatchObject({ ok: true })
    expect(store.isAuthenticated).toBe(false)
    expect(await getToken()).toBeNull()
  })
})
