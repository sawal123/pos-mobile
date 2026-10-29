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
  cloudForgotPassword,
  cloudResetPassword,
  cloudRequestEmailChange,
  cloudVerifyEmailChange,
} from '../services/cloud/authService'
import {
  describeForgotPasswordError,
  describeResetPasswordError,
  describeEmailChangeError,
} from '../services/cloud/cloudLoginErrors'
import * as tokenRepository from '../services/cloud/tokenRepository'
import { getToken, _resetTokenStore, saveToken } from '../services/cloud/tokenRepository'
import { createMemoryAdapter } from '../services/database/memoryAdapter'
import { useBusinessStore } from '../stores/businessStore'
import { useCashStore } from '../stores/cashStore'
import { useCloudSessionStore } from '../stores/cloudSessionStore'
import { useCustomerStore } from '../stores/customerStore'
import { useExpenseStore } from '../stores/expenseStore'
import { useProductStore } from '../stores/productStore'
import { useShiftStore } from '../stores/shiftStore'
import { useSyncPushStore } from '../stores/syncPushStore'
import { useTransactionStore } from '../stores/transactionStore'
import CloudEmailChangeCard from '../components/cloud/auth/CloudEmailChangeCard.vue'
import CloudForgotPasswordForm from '../components/cloud/auth/CloudForgotPasswordForm.vue'
import CloudResetPasswordForm from '../components/cloud/auth/CloudResetPasswordForm.vue'
import CloudLoginView from '../views/settings/CloudLoginView.vue'

const USER_A = { id: 10, name: 'Pemilik Toko A', email: 'owner-a@example.com' }
const USER_B = { id: 20, name: 'Pemilik Toko B', email: 'owner-b@example.com' }
const TOKEN_A = 'sanctum-token-user-a'
const TOKEN_B = 'sanctum-token-user-b'
const GOOGLE_ID_TOKEN = 'fresh-google-id-token-m07'
const CHANGE_ID = '8f14e45f-ceea-467a-9a38-123456789abc'
const BUSINESS_A = { id: 101, name: 'Toko Offline A', cloud_access: true, outlets: [] }
const OUTLET_A = { id: 201, name: 'Outlet Utama A', status: 'active' }

const ok = (data, status = 200) => ({ ok: true, status, data: { data }, error: null })
const okTopLevel = (body, status = 200) => ({ ok: true, status, data: body, error: null })
const fail = (status, code, extra = {}) => ({
  ok: false,
  status,
  data: null,
  error: {
    status,
    code,
    message: extra.message ?? code,
    data: extra.data ?? null,
    retryAfter: extra.retryAfter ?? null,
  },
})

function createDeferred() {
  let resolve
  let reject
  const promise = new Promise((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function futureIso(seconds = 300) {
  return new Date(Date.now() + seconds * 1000).toISOString()
}

function pastIso(seconds = 60) {
  return new Date(Date.now() - seconds * 1000).toISOString()
}

function seedOfflinePosData() {
  const businessStore = useBusinessStore()
  const productStore = useProductStore()
  const customerStore = useCustomerStore()
  const expenseStore = useExpenseStore()
  const cashStore = useCashStore()
  const shiftStore = useShiftStore()
  const transactionStore = useTransactionStore()
  const syncPushStore = useSyncPushStore()

  businessStore.name = 'Warung Lokal Tetap Aman'
  businessStore.mode = 'cloud'
  productStore.products = [{ id: 'prod-1', name: 'Kopi Susu', price: 18000, stock: 25 }]
  productStore.categories = [{ id: 'cat-1', name: 'Minuman' }]
  customerStore.customers = [{ id: 'cust-1', name: 'Pelanggan Setia' }]
  expenseStore.expenses = [{ id: 'exp-1', description: 'Es Batu', amount: 15000 }]
  cashStore.entries = [{ id: 'cash-1', type: 'in', amount: 50000 }]
  shiftStore.currentShift = { id: 'shift-1', openingCash: 100000 }
  transactionStore.transactions = [{ id: 'trx-1', total: 18000, items: [{ id: 'prod-1', qty: 1 }] }]
  syncPushStore.pendingCount = 3

  return {
    snapshot: () => ({
      businessName: businessStore.name,
      products: JSON.parse(JSON.stringify(productStore.products)),
      categories: JSON.parse(JSON.stringify(productStore.categories)),
      customers: JSON.parse(JSON.stringify(customerStore.customers)),
      expenses: JSON.parse(JSON.stringify(expenseStore.expenses)),
      cash: JSON.parse(JSON.stringify(cashStore.entries)),
      shift: JSON.parse(JSON.stringify(shiftStore.currentShift)),
      transactions: JSON.parse(JSON.stringify(transactionStore.transactions)),
      pendingSyncCount: syncPushStore.pendingCount,
    }),
  }
}

async function prepareAuthenticatedSession(user = USER_A, token = TOKEN_A) {
  const adapter = createMemoryAdapter()
  const store = useCloudSessionStore()
  store.setPersistenceAdapter(adapter)
  await saveToken(token)
  store.user = { ...user }
  store.cloudAccess = true
  store.capabilityState = 'verified'
  store.selectedBusiness = { ...BUSINESS_A, outlets: [OUTLET_A] }
  store.selectedOutlet = { ...OUTLET_A }
  await store.persistCloudContext(adapter)
  return { store, adapter }
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

describe('AUTH-M07 Password Recovery service & store contracts', () => {
  it('returns the exact same generic 202 presentation for valid, unknown, and Google-only emails without creating a token', async () => {
    const serverGeneric = {
      message: 'Jika akun memenuhi syarat, instruksi pemulihan telah dikirim.',
    }
    apiRequest
      .mockResolvedValueOnce(okTopLevel(serverGeneric, 202))
      .mockResolvedValueOnce(okTopLevel(serverGeneric, 202))
      .mockResolvedValueOnce(okTopLevel(serverGeneric, 202))

    const r1 = await cloudForgotPassword('owner-a@example.com')
    const r2 = await cloudForgotPassword('unknown-person@example.com')
    const r3 = await cloudForgotPassword('google-only@example.com')

    expect(r1).toEqual(r2)
    expect(r2).toEqual(r3)
    expect(r1).toMatchObject({
      ok: true,
      message:
        'Jika akun memenuhi syarat, instruksi pemulihan akan dikirim ke alamat email tersebut. Periksa kotak masuk dan folder spam.',
    })
    expect(await getToken()).toBeNull()
  })

  it('fails closed if forgot-password returns a non-202 status or an unexpected token', async () => {
    apiRequest.mockResolvedValueOnce(okTopLevel({ message: 'OK' }, 200))
    await expect(cloudForgotPassword('owner-a@example.com')).resolves.toMatchObject({
      ok: false,
      error: { code: 'INVALID_FORGOT_PASSWORD_RESPONSE' },
    })

    apiRequest.mockResolvedValueOnce(okTopLevel({ token: 'unexpected-bearer-token' }, 202))
    await expect(cloudForgotPassword('owner-a@example.com')).resolves.toMatchObject({
      ok: false,
      error: { code: 'INVALID_FORGOT_PASSWORD_RESPONSE' },
    })
    expect(await getToken()).toBeNull()
  })

  it('classifies forgot-password validation, rate-limit (429 Retry-After), and network errors safely', () => {
    expect(describeForgotPasswordError(fail(422, 'HTTP_422').error)).toEqual({
      kind: 'validation',
      message: 'Alamat email tidak valid.',
    })
    expect(
      describeForgotPasswordError(
        fail(429, 'PASSWORD_RESET_RATE_LIMITED', { retryAfter: '60' }).error,
      ),
    ).toEqual({
      kind: 'rate-limited',
      message: 'Permintaan terlalu sering. Tunggu sebentar sebelum mencoba lagi.',
      retryAfter: '60',
    })
    expect(describeForgotPasswordError(fail(0, 'NETWORK_ERROR').error)).toEqual({
      kind: 'offline',
      message: 'Koneksi internet diperlukan untuk memproses permintaan.',
    })
  })

  it('completes password reset on HTTP 200 without creating a session or saving any token', async () => {
    apiRequest.mockResolvedValueOnce(
      okTopLevel({ message: 'Password berhasil diubah. Silakan masuk kembali.' }, 200),
    )

    const result = await cloudResetPassword({
      email: 'owner-a@example.com',
      token: 'valid-broker-token',
      password: 'NewStrongPassword123!',
      password_confirmation: 'NewStrongPassword123!',
    })

    expect(result).toEqual({
      ok: true,
      message: 'Password berhasil diubah. Silakan masuk kembali.',
    })
    expect(await getToken()).toBeNull()
  })

  it('handles PASSWORD_RESET_INVALID, PASSWORD_RESET_EXPIRED, and password mismatch without leaking secrets', async () => {
    const mismatch = await cloudResetPassword({
      email: 'owner-a@example.com',
      token: 'secret-reset-token-999',
      password: 'NewStrongPassword123!',
      password_confirmation: 'DifferentPassword123!',
    })
    expect(mismatch.ok).toBe(false)
    expect(describeResetPasswordError(mismatch.error).message).toBe(
      'Konfirmasi password tidak cocok.',
    )
    expect(apiRequest).not.toHaveBeenCalled()

    const invalidErr = fail(422, 'PASSWORD_RESET_INVALID', {
      message: 'Secret token secret-reset-token-999 failed',
    })
    const describedInvalid = describeResetPasswordError(invalidErr.error)
    expect(describedInvalid).toEqual({
      kind: 'invalid-token',
      message: 'Token pemulihan tidak valid atau tidak dapat digunakan.',
    })
    expect(describedInvalid.message).not.toContain('secret-reset-token-999')

    const expiredErr = fail(410, 'PASSWORD_RESET_EXPIRED')
    expect(describeResetPasswordError(expiredErr.error)).toEqual({
      kind: 'expired-token',
      message: 'Token kedaluwarsa; mulai permintaan pemulihan baru.',
    })
  })

  it('invalidates active local session when resetting the same account email, but preserves a different account session and all offline POS data', async () => {
    const pos = seedOfflinePosData()
    const beforePos = pos.snapshot()

    // Case 1: Active session is USER_A, reset is for USER_A -> invalidate local session safely
    const { store } = await prepareAuthenticatedSession(USER_A, TOKEN_A)
    apiRequest.mockResolvedValueOnce(
      okTopLevel({ message: 'Password berhasil diubah. Silakan masuk kembali.' }, 200),
    )

    const sameAccountReset = await store.resetPassword({
      email: 'OWNER-A@example.com',
      token: 'valid-token-a',
      password: 'NewPassword123!',
      password_confirmation: 'NewPassword123!',
    })

    expect(sameAccountReset).toMatchObject({ ok: true, sessionInvalidated: true })
    expect(store.isAuthenticated).toBe(false)
    expect(await getToken()).toBeNull()
    expect(pos.snapshot()).toEqual(beforePos)

    // Case 2: Active session is USER_B, reset is for USER_A -> preserve USER_B session & token
    await prepareAuthenticatedSession(USER_B, TOKEN_B)
    apiRequest.mockResolvedValueOnce(
      okTopLevel({ message: 'Password berhasil diubah. Silakan masuk kembali.' }, 200),
    )

    const otherAccountReset = await store.resetPassword({
      email: 'owner-a@example.com',
      token: 'valid-token-a-2',
      password: 'NewPassword123!',
      password_confirmation: 'NewPassword123!',
    })

    expect(otherAccountReset).toMatchObject({ ok: true, sessionInvalidated: false })
    expect(store.isAuthenticated).toBe(true)
    expect(store.user?.email).toBe(USER_B.email)
    expect(await getToken()).toBe(TOKEN_B)
    expect(pos.snapshot()).toEqual(beforePos)
  })
})

describe('AUTH-M07 Verified Email Change service & store contracts', () => {
  it('requests email change with manual password proof (and manual + Google linked policy) while keeping user.email unchanged on 202', async () => {
    const { store } = await prepareAuthenticatedSession(USER_A, TOKEN_A)
    const otpExpiresAt = futureIso(300)
    const resendAvailableAt = futureIso(60)

    apiRequest.mockResolvedValueOnce(
      ok(
        {
          change_id: CHANGE_ID,
          state: 'pending_verification',
          otp_expires_at: otpExpiresAt,
          resend_available_at: resendAvailableAt,
        },
        202,
      ),
    )

    const result = await store.requestEmailChange({
      newEmail: 'new-owner-a@example.com',
      currentPassword: 'CurrentPassword123!',
    })

    expect(result).toEqual({
      ok: true,
      changeId: CHANGE_ID,
      state: 'pending_verification',
      otpExpiresAt,
      resendAvailableAt,
    })
    expect(apiRequest).toHaveBeenCalledWith('/api/v2/auth/email/change/request', {
      method: 'POST',
      body: {
        new_email: 'new-owner-a@example.com',
        current_password: 'CurrentPassword123!',
      },
      token: TOKEN_A,
    })
    // Mandatory: email must NOT change on 202
    expect(store.user?.email).toBe(USER_A.email)
    expect(store.isAuthenticated).toBe(true)
    expect(await getToken()).toBe(TOKEN_A)
  })

  it('supports fresh Google proof on eligible Google-only accounts and includes TOTP when confirmed 2FA is active', async () => {
    const { store } = await prepareAuthenticatedSession(USER_A, TOKEN_A)
    const otpExpiresAt = futureIso(300)
    const resendAvailableAt = futureIso(60)

    apiRequest.mockResolvedValueOnce(
      ok(
        {
          change_id: CHANGE_ID,
          state: 'pending_verification',
          otp_expires_at: otpExpiresAt,
          resend_available_at: resendAvailableAt,
        },
        202,
      ),
    )

    const result = await store.requestEmailChange({
      newEmail: 'google-new@example.com',
      idToken: GOOGLE_ID_TOKEN,
      clientPlatform: 'android',
      totpCode: '654321',
    })

    expect(result.ok).toBe(true)
    expect(apiRequest).toHaveBeenCalledWith('/api/v2/auth/email/change/request', {
      method: 'POST',
      body: {
        new_email: 'google-new@example.com',
        id_token: GOOGLE_ID_TOKEN,
        client_platform: 'android',
        totp_code: '654321',
      },
      token: TOKEN_A,
    })
  })

  it('distinguishes HTTP 401 INVALID_CREDENTIALS from session-invalid 401 and keeps the Sanctum session alive', async () => {
    const { store } = await prepareAuthenticatedSession(USER_A, TOKEN_A)

    apiRequest.mockResolvedValueOnce(fail(401, 'INVALID_CREDENTIALS'))

    const result = await store.requestEmailChange({
      newEmail: 'new-owner-a@example.com',
      currentPassword: 'WrongPassword!',
    })

    expect(result.ok).toBe(false)
    expect(result.sessionInvalidated).toBeUndefined()
    expect(store.isAuthenticated).toBe(true)
    expect(store.sessionInvalid).toBe(false)
    expect(await getToken()).toBe(TOKEN_A)
    expect(describeEmailChangeError(result.error)).toEqual({
      kind: 'invalid-credentials',
      message: 'Password saat ini salah.',
    })
  })

  it('maps all email-change error codes to safe Indonesian messages', () => {
    expect(describeEmailChangeError(fail(403, 'REAUTHENTICATION_REQUIRED').error)).toEqual({
      kind: 'reauthentication',
      message: 'Bukti kepemilikan akun belum sah.',
    })
    expect(describeEmailChangeError(fail(403, 'TWO_FACTOR_REQUIRED').error)).toEqual({
      kind: 'two-factor',
      message: 'Masukkan kode autentikator 6 digit untuk melanjutkan.',
    })
    expect(describeEmailChangeError(fail(403, 'MOBILE_ABILITY_REQUIRED').error)).toEqual({
      kind: 'forbidden',
      message: 'Token tidak memiliki izin yang diperlukan.',
    })
    expect(describeEmailChangeError(fail(409, 'EMAIL_ALREADY_USED').error)).toEqual({
      kind: 'email-taken',
      message: 'Email baru sudah digunakan oleh akun lain.',
    })
    expect(describeEmailChangeError(fail(409, 'EMAIL_CHANGE_PENDING').error)).toEqual({
      kind: 'pending',
      message: 'Ada permintaan perubahan email aktif yang masih menunggu verifikasi.',
    })
    expect(describeEmailChangeError(fail(409, 'EMAIL_CHANGE_CONFLICT').error)).toEqual({
      kind: 'conflict',
      message: 'Perubahan email tidak dapat dilanjutkan.',
    })
    expect(describeEmailChangeError(fail(410, 'EMAIL_CHANGE_EXPIRED').error)).toEqual({
      kind: 'expired',
      message: 'Kode verifikasi sudah kedaluwarsa. Mulai permintaan baru.',
    })
    expect(describeEmailChangeError(fail(422, 'EMAIL_CHANGE_INVALID_OTP').error)).toEqual({
      kind: 'invalid-otp',
      message: 'Kode OTP salah, sudah digunakan, atau terkunci.',
    })
    expect(
      describeEmailChangeError(fail(429, 'OTP_RATE_LIMITED', { retryAfter: '45' }).error),
    ).toEqual({
      kind: 'rate-limited',
      message: 'Permintaan terlalu sering. Tunggu sebentar sebelum mencoba lagi.',
      retryAfter: '45',
    })
  })

  it('fails closed on malformed request or verify responses', async () => {
    apiRequest.mockResolvedValueOnce(
      ok({ change_id: CHANGE_ID, state: 'pending_verification', otp_expires_at: 'invalid-date' }, 202),
    )
    await expect(
      cloudRequestEmailChange(TOKEN_A, {
        newEmail: 'new@example.com',
        currentPassword: 'Password123!',
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: 'pending_verification' },
    })

    apiRequest.mockResolvedValueOnce(
      ok({ state: 'verified', reauthentication_required: false }, 200),
    )
    await expect(
      cloudVerifyEmailChange(TOKEN_A, { changeId: CHANGE_ID, code: '123456' }),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: 'verified' },
    })
  })

  it('revokes local Cloud authorization on HTTP 200 OTP verification without calling API logout or touching offline POS data', async () => {
    const pos = seedOfflinePosData()
    const beforePos = pos.snapshot()
    const { store } = await prepareAuthenticatedSession(USER_A, TOKEN_A)

    apiRequest
      .mockResolvedValueOnce(
        ok(
          {
            change_id: CHANGE_ID,
            state: 'pending_verification',
            otp_expires_at: futureIso(300),
            resend_available_at: futureIso(60),
          },
          202,
        ),
      )
      .mockResolvedValueOnce(
        ok(
          {
            state: 'verified',
            reauthentication_required: true,
          },
          200,
        ),
      )

    await store.requestEmailChange({
      newEmail: 'verified-new@example.com',
      currentPassword: 'CurrentPassword123!',
    })
    expect(store.user?.email).toBe(USER_A.email)

    const verifyResult = await store.verifyEmailChange({ code: '123456' })
    expect(verifyResult).toEqual({
      ok: true,
      state: 'verified',
      reauthenticationRequired: true,
      sessionRevoked: true,
      storageFailure: false,
      message: 'Email berhasil diperbarui. Silakan masuk kembali.',
    })
    expect(store.isAuthenticated).toBe(false)
    expect(store.sessionInvalid).toBe(true)
    expect(await getToken()).toBeNull()
    expect(apiRequest).not.toHaveBeenCalledWith('/api/auth/logout', expect.anything())
    expect(pos.snapshot()).toEqual(beforePos)
  })
})

describe('AUTH-M07 Lifecycle, Race, and Unknown Outcome safety', () => {
  it('prevents cross-account verification and preserves Account B when Account A switches to Account B mid-flow', async () => {
    const { store } = await prepareAuthenticatedSession(USER_A, TOKEN_A)

    apiRequest.mockResolvedValueOnce(
      ok(
        {
          change_id: CHANGE_ID,
          state: 'pending_verification',
          otp_expires_at: futureIso(300),
          resend_available_at: futureIso(60),
        },
        202,
      ),
    )

    await store.requestEmailChange({
      newEmail: 'user-a-new@example.com',
      currentPassword: 'PasswordA123!',
    })

    // Simulate switch from Account A to Account B
    await saveToken(TOKEN_B)
    store.user = { ...USER_B }

    const verifyAttempt = await store.verifyEmailChange({
      changeId: CHANGE_ID,
      code: '123456',
    })

    expect(verifyAttempt.ok).toBe(false)
    expect(verifyAttempt.state).toBe('stale_operation')
    // Account B's token and email are untouched, and verify endpoint was never called with Account B's token
    expect(await getToken()).toBe(TOKEN_B)
    expect(store.user?.email).toBe(USER_B.email)
    expect(apiRequest).toHaveBeenCalledTimes(1)
  })

  it('discards stale email-change request response if user logs out while request is in-flight', async () => {
    const { store } = await prepareAuthenticatedSession(USER_A, TOKEN_A)
    const deferredRequest = createDeferred()

    apiRequest.mockImplementation((path) => {
      if (path === '/api/v2/auth/email/change/request') return deferredRequest.promise
      if (path === '/api/auth/logout') return Promise.resolve(ok({ message: 'Logged out' }))
      throw new Error(`Unexpected ${path}`)
    })

    const requestPromise = store.requestEmailChange({
      newEmail: 'stale-new@example.com',
      currentPassword: 'Password123!',
    })
    await flushPromises()

    await store.logout()
    expect(store.isAuthenticated).toBe(false)

    deferredRequest.resolve(
      ok(
        {
          change_id: CHANGE_ID,
          state: 'pending_verification',
          otp_expires_at: futureIso(300),
          resend_available_at: futureIso(60),
        },
        202,
      ),
    )

    const result = await requestPromise
    expect(result.state).toBe('stale_operation')
    expect(store.isAuthenticated).toBe(false)
  })

  it('handles verification network timeout by checking session read-only and revoking locally on 401 without claiming email changed', async () => {
    const { store } = await prepareAuthenticatedSession(USER_A, TOKEN_A)

    apiRequest
      .mockResolvedValueOnce(
        ok(
          {
            change_id: CHANGE_ID,
            state: 'pending_verification',
            otp_expires_at: futureIso(300),
            resend_available_at: futureIso(60),
          },
          202,
        ),
      )
      // Verify times out / network error after server-side commit
      .mockResolvedValueOnce(fail(0, 'NETWORK_ERROR'))
      // Read-only /api/v2/auth/me returns 401 because server revoked all sessions
      .mockResolvedValueOnce(fail(401, 'UNAUTHENTICATED'))

    await store.requestEmailChange({
      newEmail: 'uncertain@example.com',
      currentPassword: 'Password123!',
    })

    const verifyResult = await store.verifyEmailChange({ code: '123456' })
    expect(verifyResult).toMatchObject({
      ok: false,
      uncertain: true,
      sessionRevoked: true,
      code: 'EMAIL_CHANGE_UNCERTAIN',
    })
    expect(store.isAuthenticated).toBe(false)
    expect(store.sessionInvalid).toBe(true)
    expect(await getToken()).toBeNull()
  })

  it('handles secure token removal exception safely during email-change session revocation', async () => {
    const { store } = await prepareAuthenticatedSession(USER_A, TOKEN_A)

    apiRequest
      .mockResolvedValueOnce(
        ok(
          {
            change_id: CHANGE_ID,
            state: 'pending_verification',
            otp_expires_at: futureIso(300),
            resend_available_at: futureIso(60),
          },
          202,
        ),
      )
      .mockResolvedValueOnce(
        ok({ state: 'verified', reauthentication_required: true }, 200),
      )

    await store.requestEmailChange({
      newEmail: 'new@example.com',
      currentPassword: 'Password123!',
    })

    vi.spyOn(tokenRepository, 'removeTokenIfMatchesDetailed').mockRejectedValueOnce(
      new Error('Keystore locked'),
    )

    const verifyResult = await store.verifyEmailChange({ code: '123456' })
    expect(verifyResult).toMatchObject({
      ok: true,
      storageFailure: true,
    })
    expect(store.isAuthenticated).toBe(false)
    expect(store.sessionInvalid).toBe(true)
    expect(store.error).toContain('belum dapat dicabut dengan aman')
  })
})

describe('AUTH-M07 UI & Full CloudLoginView Integration Flows', () => {
  it('completes the full Forgot Password -> Generic Confirmation -> Reset Password -> Login flow in CloudLoginView', async () => {
    const pos = seedOfflinePosData()
    const beforePos = pos.snapshot()

    let loginBodyAfterReset = null
    apiRequest.mockImplementation(async (path, options = {}) => {
      if (path === '/api/v2/auth/password/forgot') {
        return okTopLevel(
          { message: 'Jika akun memenuhi syarat, instruksi pemulihan telah dikirim.' },
          202,
        )
      }
      if (path === '/api/v2/auth/password/reset') {
        return okTopLevel(
          { message: 'Password berhasil diubah. Silakan masuk kembali.' },
          200,
        )
      }
      if (path === '/api/v2/auth/login') {
        loginBodyAfterReset = options.body
        return ok({
          token_type: 'Bearer',
          token: 'fresh-login-token-after-reset',
          user: USER_A,
        })
      }
      if (path === '/api/mobile/context') {
        return ok({
          user: USER_A,
          businesses: [{ ...BUSINESS_A, outlets: [OUTLET_A] }],
        })
      }
      throw new Error(`Unexpected request ${path}`)
    })

    const wrapper = mount(CloudLoginView)

    // 1. Open Forgot Password from Login form
    await wrapper.get('[data-testid="forgot-password-link"]').trigger('click')
    expect(wrapper.find('[data-testid="forgot-password-form"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="forgot-google-guidance"]').exists()).toBe(true)

    // 2. Submit email for recovery
    await wrapper.get('[data-testid="forgot-email-input"]').setValue('owner-a@example.com')
    await wrapper.get('[data-testid="forgot-submit-btn"]').trigger('click')
    await flushPromises()

    expect(wrapper.get('[data-testid="forgot-success-message"]').text()).toContain(
      'Jika akun memenuhi syarat, instruksi pemulihan akan dikirim ke alamat email tersebut.',
    )

    // 3. Proceed to Reset Password form
    await wrapper.get('[data-testid="forgot-go-to-reset"]').trigger('click')
    expect(wrapper.find('[data-testid="reset-password-form"]').exists()).toBe(true)

    await wrapper.get('[data-testid="reset-token-input"]').setValue('official-broker-token')
    await wrapper.get('[data-testid="reset-password-input"]').setValue('NewStrongPassword123!')
    await wrapper
      .get('[data-testid="reset-password-confirm-input"]')
      .setValue('NewStrongPassword123!')
    await wrapper.get('[data-testid="reset-submit-btn"]').trigger('click')
    await flushPromises()

    expect(wrapper.get('[data-testid="reset-success-message"]').text()).toContain(
      'Password berhasil diubah. Silakan masuk kembali.',
    )
    // No automatic login after reset
    expect(await getToken()).toBeNull()

    // 4. Return to Login and sign in with new credentials
    await wrapper.get('[data-testid="reset-back-to-login"]').trigger('click')
    expect(wrapper.find('[data-testid="cloud-login-form"]').exists()).toBe(true)

    await wrapper.get('#login-password').setValue('NewStrongPassword123!')
    await wrapper.get('[data-testid="cloud-login-form"] form').trigger('submit')
    await flushPromises()

    expect(loginBodyAfterReset).toEqual({
      email: 'owner-a@example.com',
      password: 'NewStrongPassword123!',
    })
    expect(await getToken()).toBe('fresh-login-token-after-reset')
    expect(pos.snapshot()).toEqual(beforePos)
  })

  it('completes the full Verified Email Change -> Proof -> OTP -> Session Cleared -> Login Required flow in CloudLoginView', async () => {
    const pos = seedOfflinePosData()
    const beforePos = pos.snapshot()
    const { store } = await prepareAuthenticatedSession(USER_A, TOKEN_A)

    apiRequest.mockImplementation(async (path, options = {}) => {
      if (path === '/api/v2/auth/me') {
        return ok({
          user: USER_A,
          email_verified: true,
          two_factor_enabled: false,
          authentication_methods: ['manual', 'google'],
        })
      }
      if (path === '/api/v2/auth/email/change/request') {
        if (options.body.current_password === 'WrongPass') {
          return fail(401, 'INVALID_CREDENTIALS')
        }
        if (!options.body.totp_code) {
          return fail(403, 'TWO_FACTOR_REQUIRED')
        }
        return ok(
          {
            change_id: CHANGE_ID,
            state: 'pending_verification',
            otp_expires_at: futureIso(300),
            resend_available_at: futureIso(60),
          },
          202,
        )
      }
      if (path === '/api/v2/auth/email/change/verify') {
        if (options.body.code === '000000') {
          return fail(422, 'EMAIL_CHANGE_INVALID_OTP')
        }
        return ok(
          {
            state: 'verified',
            reauthentication_required: true,
          },
          200,
        )
      }
      throw new Error(`Unexpected request ${path}`)
    })

    const wrapper = mount(CloudLoginView)

    // 1. Open Email Change form in authenticated CloudLoginView
    const card = wrapper.get('[data-testid="email-change-card"]')
    expect(card.get('[data-testid="email-change-current-email"]').text()).toContain(USER_A.email)

    await card.get('[data-testid="email-change-open"]').trigger('click')
    await flushPromises()

    // 2. Enter new email & wrong password first -> 401 INVALID_CREDENTIALS must NOT drop session
    await wrapper.get('[data-testid="email-change-email-input"]').setValue('updated-a@example.com')
    await wrapper.get('[data-testid="email-change-password-input"]').setValue('WrongPass')
    await wrapper.get('[data-testid="email-change-submit"]').trigger('click')
    await flushPromises()

    expect(wrapper.get('[data-testid="email-change-error"]').text()).toBe(
      'Password saat ini salah.',
    )
    expect(store.isAuthenticated).toBe(true)

    // 3. Submit correct password -> server requests TWO_FACTOR_REQUIRED -> TOTP field appears
    await wrapper.get('[data-testid="email-change-password-input"]').setValue('CorrectPass123!')
    await wrapper.get('[data-testid="email-change-submit"]').trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-testid="email-change-totp-input"]').exists()).toBe(true)

    // 4. Submit password + TOTP -> 202 pending_verification
    await wrapper.get('[data-testid="email-change-password-input"]').setValue('CorrectPass123!')
    await wrapper.get('[data-testid="email-change-totp-input"]').setValue('123456')
    await wrapper.get('[data-testid="email-change-submit"]').trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-testid="email-change-otp-step"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="email-change-no-resend-notice"]').exists()).toBe(true)
    // Email remains unchanged before OTP verification
    expect(store.user?.email).toBe(USER_A.email)

    // 5. Wrong OTP -> error shown, still on OTP step
    await wrapper.get('[data-testid="email-change-otp-input"]').setValue('000000')
    await wrapper.get('[data-testid="email-change-verify"]').trigger('click')
    await flushPromises()
    expect(wrapper.get('[data-testid="email-change-error"]').text()).toBe(
      'Kode OTP salah, sudah digunakan, atau terkunci.',
    )
    expect(store.user?.email).toBe(USER_A.email)

    // 6. Valid OTP -> HTTP 200 -> session revoked locally, login required
    await wrapper.get('[data-testid="email-change-otp-input"]').setValue('654321')
    await wrapper.get('[data-testid="email-change-verify"]').trigger('click')
    await flushPromises()

    expect(store.isAuthenticated).toBe(false)
    expect(await getToken()).toBeNull()
    expect(wrapper.get('[data-testid="email-change-success"]').text()).toContain(
      'Email berhasil diperbarui. Silakan masuk kembali.',
    )
    expect(wrapper.find('[data-testid="cloud-login-form"]').exists()).toBe(true)

    let reloginEmail = null
    // 7. Login again with the updated email
    apiRequest.mockImplementation(async (path, options = {}) => {
      if (path === '/api/v2/auth/login') {
        reloginEmail = options.body.email
        return ok({
          token_type: 'Bearer',
          token: 'new-email-sanctum-token',
          user: { ...USER_A, email: 'updated-a@example.com' },
        })
      }
      if (path.startsWith('/api/mobile/context')) {
        return ok({
          user: { ...USER_A, email: 'updated-a@example.com' },
          businesses: [{ ...BUSINESS_A, outlets: [OUTLET_A] }],
        })
      }
      throw new Error(`Unexpected request ${path}`)
    })

    await wrapper.get('[data-testid="email-change-login-again"]').trigger('click')
    await wrapper.get('#login-email').setValue('updated-a@example.com')
    await wrapper.get('#login-password').setValue('CorrectPass123!')
    await wrapper.get('[data-testid="cloud-login-form"] form').trigger('submit')
    await flushPromises()

    expect(reloginEmail).toBe('updated-a@example.com')
    expect(store.isAuthenticated).toBe(true)
    expect(store.user?.email).toBe('updated-a@example.com')
    expect(await getToken()).toBe('new-email-sanctum-token')
    expect(pos.snapshot()).toEqual(beforePos)
  })

  it('rejects wrong Google identity proof without automatically falling back to another proof method, and prevents duplicate parallel requests', async () => {
    const { store } = await prepareAuthenticatedSession(USER_A, TOKEN_A)
    const deferred = createDeferred()

    nativeSignIn.mockResolvedValueOnce({ ok: true, state: 'success', idToken: 'wrong-sub-token' })
    apiRequest.mockImplementation((path) => {
      if (path === '/api/v2/auth/me') {
        return Promise.resolve(
          ok({
            user: USER_A,
            email_verified: true,
            two_factor_enabled: false,
            authentication_methods: ['google'],
          }),
        )
      }
      if (path === '/api/v2/auth/email/change/request') {
        return deferred.promise
      }
      throw new Error(`Unexpected ${path}`)
    })

    const wrapper = mount(CloudEmailChangeCard)
    await wrapper.get('[data-testid="email-change-open"]').trigger('click')
    await flushPromises()

    await wrapper.get('[data-testid="email-change-email-input"]').setValue('new-g@example.com')
    const clickPromise = wrapper.get('[data-testid="email-change-google-proof"]').trigger('click')
    await flushPromises()

    // Concurrent store call while in-flight is rejected with REQUEST_IN_PROGRESS
    const duplicate = await store.requestEmailChange({
      newEmail: 'parallel@example.com',
      currentPassword: 'Password123!',
    })
    expect(duplicate).toMatchObject({
      ok: false,
      error: { code: 'REQUEST_IN_PROGRESS' },
    })

    deferred.resolve(fail(403, 'REAUTHENTICATION_REQUIRED'))
    await clickPromise
    await flushPromises()

    expect(wrapper.get('[data-testid="email-change-error"]').text()).toBe(
      'Bukti kepemilikan akun belum sah.',
    )
    // Only 1 request to /api/v2/auth/email/change/request (no automatic retry)
    const requestCalls = apiRequest.mock.calls.filter(
      ([path]) => path === '/api/v2/auth/email/change/request',
    )
    expect(requestCalls).toHaveLength(1)

    // Cancel returns cleanly to idle
    await wrapper.get('[data-testid="email-change-cancel"]').trigger('click')
    expect(wrapper.find('[data-testid="email-change-form-step"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="email-change-open"]').exists()).toBe(true)
  })

  it('allows returning to offline POS from password recovery without requiring Cloud login', async () => {
    const wrapper = mount(CloudLoginView)
    await wrapper.get('[data-testid="forgot-password-link"]').trigger('click')
    expect(wrapper.find('[data-testid="forgot-password-form"]').exists()).toBe(true)

    await wrapper.get('[data-testid="forgot-offline-pos"]').trigger('click')
    expect(wrapper.find('[data-testid="cloud-login-form"]').exists()).toBe(true)
  })

  it('supports native Google proof on Google-only accounts and handlesexpired OTP & unmount cleanup', async () => {
    await prepareAuthenticatedSession(USER_A, TOKEN_A)
    nativeSignIn.mockResolvedValueOnce({ ok: true, state: 'success', idToken: GOOGLE_ID_TOKEN })

    let googleEmailChangeBody = null
    apiRequest.mockImplementation(async (path, options = {}) => {
      if (path === '/api/v2/auth/me') {
        return ok({
          user: USER_A,
          email_verified: true,
          two_factor_enabled: false,
          authentication_methods: ['google'],
        })
      }
      if (path === '/api/v2/auth/email/change/request') {
        googleEmailChangeBody = options.body
        return ok(
          {
            change_id: CHANGE_ID,
            state: 'pending_verification',
            otp_expires_at: pastIso(5),
            resend_available_at: futureIso(60),
          },
          202,
        )
      }
      throw new Error(`Unexpected request ${path}`)
    })

    const wrapper = mount(CloudEmailChangeCard)
    await wrapper.get('[data-testid="email-change-open"]').trigger('click')
    await flushPromises()

    // Automatically defaults to Google proof when auth/me reports ['google'] only
    await wrapper
      .get('[data-testid="email-change-email-input"]')
      .setValue('google-updated@example.com')
    await wrapper.get('[data-testid="email-change-google-proof"]').trigger('click')
    await flushPromises()

    expect(googleEmailChangeBody).toEqual({
      new_email: 'google-updated@example.com',
      id_token: GOOGLE_ID_TOKEN,
      client_platform: 'android',
    })
    expect(wrapper.find('[data-testid="email-change-otp-step"]').exists()).toBe(true)
    expect(wrapper.get('[data-testid="email-change-countdown"]').text()).toBe('Kedaluwarsa')

    // Expired OTP blocks verification and prompts for a new request
    await wrapper.get('[data-testid="email-change-otp-input"]').setValue('123456')
    await wrapper.get('[data-testid="email-change-verify"]').trigger('click')
    expect(wrapper.get('[data-testid="email-change-error"]').text()).toContain('kedaluwarsa')

    wrapper.unmount()
    expect(nativeCancel).toHaveBeenCalled()
  })

  it('validates isolated CloudForgotPasswordForm and CloudResetPasswordForm inputs without calling the API', async () => {
    const forgotWrapper = mount(CloudForgotPasswordForm)
    await forgotWrapper.get('[data-testid="forgot-email-input"]').setValue('invalid-email')
    await forgotWrapper.get('[data-testid="forgot-submit-btn"]').trigger('click')
    expect(forgotWrapper.get('[data-testid="forgot-email-error"]').text()).toContain('tidak valid')
    expect(forgotWrapper.emitted('submit')).toBeUndefined()

    const resetWrapper = mount(CloudResetPasswordForm)
    await resetWrapper.get('[data-testid="reset-email-input"]').setValue('owner-a@example.com')
    await resetWrapper.get('[data-testid="reset-token-input"]').setValue('')
    await resetWrapper.get('[data-testid="reset-password-input"]').setValue('short')
    await resetWrapper.get('[data-testid="reset-password-confirm-input"]').setValue('mismatch')
    await resetWrapper.get('[data-testid="reset-submit-btn"]').trigger('click')

    expect(resetWrapper.get('[data-testid="reset-token-error"]').text()).toContain('wajib diisi')
    expect(resetWrapper.get('[data-testid="reset-password-error"]').text()).toContain('minimal 8')
    expect(resetWrapper.get('[data-testid="reset-password-confirm-error"]').text()).toContain(
      'tidak cocok',
    )
    expect(resetWrapper.emitted('submit')).toBeUndefined()
  })
})
