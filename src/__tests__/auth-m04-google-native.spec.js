import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

const nativeGooglePlugin = vi.hoisted(() => ({
  initialize: vi.fn(),
  signIn: vi.fn(),
}))
const capacitorApi = vi.hoisted(() => ({
  getPlatform: vi.fn(() => 'android'),
  isNativePlatform: vi.fn(() => false),
}))

vi.mock('@capacitor/core', () => ({
  Capacitor: capacitorApi,
  registerPlugin: vi.fn(() => nativeGooglePlugin),
}))

vi.mock('@/services/cloud/apiClient', () => ({
  apiRequest: vi.fn(),
}))

import { apiRequest } from '@/services/cloud/apiClient'
import {
  cloudGoogleLogin,
} from '@/services/cloud/authService'
import {
  _resetGoogleNativeAuthForTests,
  signInWithGoogle,
} from '@/services/cloud/googleNativeAuthService'
import { useCloudSessionStore } from '@/stores/cloudSessionStore'
import { _resetTokenStore, getToken } from '@/services/cloud/tokenRepository'

const WEB_CLIENT_ID = '1234567890-authm04.apps.googleusercontent.com'
const GOOGLE_ID_TOKEN = 'google-id-token-memory-only'
const SANCTUM_TOKEN = 'sanctum-token-after-exchange'
const USER = { id: 7, name: 'Google User', email: 'google@example.com' }

function googleSuccessResponse() {
  return {
    ok: true,
    status: 200,
    data: {
      message: 'Login Google berhasil.',
      data: { token_type: 'Bearer', token: SANCTUM_TOKEN, user: USER },
    },
    error: null,
  }
}

function contextResponse() {
  return {
    ok: true,
    status: 200,
    data: { data: { user: USER, businesses: [] } },
    error: null,
  }
}

beforeEach(() => {
  setActivePinia(createPinia())
  capacitorApi.getPlatform.mockReturnValue('android')
  nativeGooglePlugin.initialize.mockReset().mockResolvedValue(undefined)
  nativeGooglePlugin.signIn.mockReset()
  apiRequest.mockReset()
  _resetGoogleNativeAuthForTests()
  _resetTokenStore()
  localStorage.clear()
  sessionStorage.clear()
})

describe('AUTH-M04 native Google provider adapter', () => {
  it('rejects unsupported web without invoking a native provider', async () => {
    capacitorApi.getPlatform.mockReturnValue('web')

    await expect(signInWithGoogle({ webClientId: WEB_CLIENT_ID })).resolves.toMatchObject({
      ok: false,
      state: 'unsupported_platform',
    })
    expect(nativeGooglePlugin.initialize).not.toHaveBeenCalled()
    expect(nativeGooglePlugin.signIn).not.toHaveBeenCalled()
  })

  it('fails closed when the public Web Client ID is missing or malformed', async () => {
    await expect(signInWithGoogle({ webClientId: '' })).resolves.toMatchObject({
      ok: false,
      state: 'not_configured',
      code: 'CONFIGURATION_INVALID',
    })
    expect(nativeGooglePlugin.initialize).not.toHaveBeenCalled()
  })

  it('initializes once, returns a fresh ID token, and never persists it', async () => {
    nativeGooglePlugin.signIn.mockResolvedValue({ idToken: GOOGLE_ID_TOKEN })

    const first = await signInWithGoogle({ webClientId: WEB_CLIENT_ID })
    const second = await signInWithGoogle({ webClientId: WEB_CLIENT_ID })

    expect(first).toEqual({ ok: true, state: 'success', idToken: GOOGLE_ID_TOKEN })
    expect(second).toEqual({ ok: true, state: 'success', idToken: GOOGLE_ID_TOKEN })
    expect(nativeGooglePlugin.initialize).toHaveBeenCalledTimes(1)
    expect(nativeGooglePlugin.signIn).toHaveBeenCalledTimes(2)
    expect(localStorage.length).toBe(0)
    expect(sessionStorage.length).toBe(0)
  })

  it('maps cancel and provider-unavailable results without treating them as auth failures', async () => {
    nativeGooglePlugin.signIn.mockRejectedValueOnce({ code: 'USER_CANCELLED' })
    await expect(signInWithGoogle({ webClientId: WEB_CLIENT_ID })).resolves.toMatchObject({
      ok: false,
      state: 'cancelled',
      code: 'USER_CANCELLED',
    })

    nativeGooglePlugin.signIn.mockRejectedValueOnce({ code: 'PROVIDER_UNAVAILABLE' })
    await expect(signInWithGoogle({ webClientId: WEB_CLIENT_ID })).resolves.toMatchObject({
      ok: false,
      state: 'provider_unavailable',
    })
  })

  it('blocks a second click while the first native operation is active', async () => {
    let resolveSignIn
    nativeGooglePlugin.signIn.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveSignIn = resolve
      }),
    )

    const first = signInWithGoogle({ webClientId: WEB_CLIENT_ID })
    await Promise.resolve()
    const second = await signInWithGoogle({ webClientId: WEB_CLIENT_ID })
    expect(second).toMatchObject({ ok: false, code: 'REQUEST_IN_PROGRESS' })

    resolveSignIn({ idToken: GOOGLE_ID_TOKEN })
    await expect(first).resolves.toMatchObject({ ok: true, state: 'success' })
  })
})

describe('AUTH-M04 Google token exchange', () => {
  it('posts the fresh ID token to the v2 Android exchange endpoint', async () => {
    apiRequest.mockResolvedValueOnce(googleSuccessResponse())

    const result = await cloudGoogleLogin(GOOGLE_ID_TOKEN, 'android')

    expect(result).toEqual({ ok: true, token: SANCTUM_TOKEN, user: USER })
    expect(apiRequest).toHaveBeenCalledWith('/api/v2/auth/google', {
      method: 'POST',
      body: { id_token: GOOGLE_ID_TOKEN, client_platform: 'android' },
    })
  })

  it('rejects malformed HTTP 200 success payloads', async () => {
    apiRequest.mockResolvedValueOnce({
      ok: true,
      status: 200,
      data: { data: { token_type: 'Bearer', token: SANCTUM_TOKEN, user: null } },
      error: null,
    })

    await expect(cloudGoogleLogin(GOOGLE_ID_TOKEN)).resolves.toMatchObject({
      ok: false,
      error: { code: 'MALFORMED_GOOGLE_SUCCESS' },
    })
  })

  it('returns a validated backend-shaped 202 challenge without a token', async () => {
    apiRequest.mockResolvedValueOnce({
      ok: false,
      status: 202,
      data: null,
      error: {
        status: 202,
        code: 'TWO_FACTOR_REQUIRED',
        message: 'Verifikasi dua langkah diperlukan.',
        data: {
          code: 'TWO_FACTOR_REQUIRED',
          data: {
            challenge_id: 'google-challenge-1',
            expires_at: '2099-01-01T00:30:00+07:00',
            methods: ['totp', 'recovery_code'],
          },
        },
      },
    })

    await expect(cloudGoogleLogin(GOOGLE_ID_TOKEN)).resolves.toMatchObject({
      ok: false,
      state: 'two_factor_required',
      challenge: { challenge_id: 'google-challenge-1' },
    })
    expect(await getToken()).toBeNull()
  })

  it.each([
    ['ACCOUNT_LINK_REQUIRED', 409],
    ['IDENTITY_CONFLICT', 409],
    ['GOOGLE_TOKEN_INVALID', 401],
    ['GOOGLE_EMAIL_UNVERIFIED', 403],
    ['GOOGLE_PROVISIONING_FAILED', 503],
  ])('passes backend %s through without creating a session', async (code, status) => {
    apiRequest.mockResolvedValueOnce({
      ok: false,
      status,
      data: null,
      error: { status, code, message: 'safe server message', data: null },
    })

    const result = await cloudGoogleLogin(GOOGLE_ID_TOKEN)
    expect(result).toMatchObject({ ok: false, error: { status, code } })
    expect(await getToken()).toBeNull()
  })
})

describe('AUTH-M04 Cloud session handoff', () => {
  it('stores Sanctum only after HTTP 200 and loads context through the existing path', async () => {
    apiRequest.mockResolvedValueOnce(googleSuccessResponse()).mockResolvedValueOnce(contextResponse())
    const store = useCloudSessionStore()

    const result = await store.loginWithGoogle(GOOGLE_ID_TOKEN)

    expect(result.ok).toBe(true)
    expect(await getToken()).toBe(SANCTUM_TOKEN)
    expect(apiRequest.mock.calls.map(([path]) => path)).toEqual([
      '/api/v2/auth/google',
      '/api/mobile/context',
    ])
    expect(apiRequest.mock.calls[1][1]).toEqual(expect.objectContaining({ token: SANCTUM_TOKEN }))
    expect(localStorage.length).toBe(0)
    expect(sessionStorage.length).toBe(0)
  })

  it('does not store a token or fetch context for pending 2FA', async () => {
    apiRequest.mockResolvedValueOnce({
      ok: true,
      status: 202,
      data: {
        code: 'TWO_FACTOR_REQUIRED',
        data: {
          challenge_id: 'challenge-2',
          expires_at: '2099-01-01T00:30:00Z',
          methods: ['totp'],
        },
      },
      error: null,
    })
    const store = useCloudSessionStore()

    const result = await store.loginWithGoogle(GOOGLE_ID_TOKEN)

    expect(result.state).toBe('two_factor_required')
    expect(store.isAuthenticated).toBe(false)
    expect(await getToken()).toBeNull()
    expect(apiRequest).toHaveBeenCalledTimes(1)
  })

  it('does not silently replace an existing Cloud session', async () => {
    const store = useCloudSessionStore()
    store.user = USER

    const result = await store.loginWithGoogle(GOOGLE_ID_TOKEN)

    expect(result.error.code).toBe('SESSION_ALREADY_ACTIVE')
    expect(apiRequest).not.toHaveBeenCalled()
  })
})
