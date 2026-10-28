/**
 * Cloud authentication service.
 *
 * Handles:
 * - POST /api/v2/auth/login
 * - GET  /api/auth/me
 * - DELETE /api/auth/logout
 * - GET  /api/mobile/context
 * - POST /api/mobile/devices
 * - POST /api/v2/auth/register
 * - POST /api/v2/auth/otp/verify
 * - POST /api/v2/auth/otp/resend
 * - POST /api/v2/auth/google
 *
 * Does NOT implement:
 * - 2FA completion flow
 * - Forgot password
 * - Sync push/pull
 */

import { apiRequest } from './apiClient'

const PENDING_REGISTRATION_STORAGE_KEY = 'cloud_pending_registration_v2'
const REGISTRATION_KEY_TTL_MS = 15 * 60 * 1000
let inMemoryPendingRegistration = null
const registrationKeys = new Map()
let registrationFingerprintSecret = null

function createIdempotencyKey() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID()

  const bytes = new Uint8Array(16)
  globalThis.crypto?.getRandomValues?.(bytes)
  if (bytes.some((byte) => byte !== 0)) {
    bytes[6] = (bytes[6] & 0x0f) | 0x40
    bytes[8] = (bytes[8] & 0x3f) | 0x80
    const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
  }

  throw new Error('Secure random source unavailable')
}

function getRegistrationFingerprintSecret() {
  if (registrationFingerprintSecret) return registrationFingerprintSecret
  if (!globalThis.crypto?.getRandomValues) {
    throw new Error('Secure random source unavailable')
  }
  registrationFingerprintSecret = new Uint8Array(32)
  globalThis.crypto.getRandomValues(registrationFingerprintSecret)
  return registrationFingerprintSecret
}

async function keyedPayloadDigest(payload) {
  if (!globalThis.crypto?.subtle || typeof TextEncoder === 'undefined') {
    throw new Error('Secure digest unavailable')
  }
  const cryptoKey = await globalThis.crypto.subtle.importKey(
    'raw',
    getRegistrationFingerprintSecret(),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const canonicalPayload = JSON.stringify({
    name: payload.name,
    email: payload.email,
    password: payload.password,
    password_confirmation: payload.password_confirmation,
    business_name: payload.business_name,
  })
  const digest = await globalThis.crypto.subtle.sign(
    'HMAC',
    cryptoKey,
    new TextEncoder().encode(canonicalPayload),
  )
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

function clearExpiredRegistrationKeys() {
  const now = Date.now()
  for (const [digest, entry] of registrationKeys) {
    if (entry.expiresAt <= now) registrationKeys.delete(digest)
  }
}

async function getRegistrationKey(payload, explicitKey) {
  if (explicitKey) return explicitKey
  clearExpiredRegistrationKeys()
  const digest = await keyedPayloadDigest(payload)
  const existing = registrationKeys.get(digest)
  if (existing && existing.expiresAt > Date.now()) return existing.key
  const key = createIdempotencyKey()
  registrationKeys.set(digest, { key, expiresAt: Date.now() + REGISTRATION_KEY_TTL_MS })
  return key
}

export function clearRegistrationAttemptCache() {
  registrationKeys.clear()
  registrationFingerprintSecret = null
}

function responseData(result) {
  return (
    result?.data?.data ??
    result?.data ??
    result?.error?.data?.data ??
    result?.error?.data ??
    null
  )
}

function maskEmail(email) {
  const [local, domain] = String(email ?? '').split('@')
  if (!local || !domain) return ''
  const visible = local.length <= 2 ? local.slice(0, 1) : local.slice(0, 2)
  return `${visible}${'*'.repeat(Math.max(1, local.length - visible.length))}@${domain}`
}

export function savePendingRegistrationMetadata(metadata) {
  const safe = {
    registrationId: metadata.registrationId,
    maskedEmail: metadata.maskedEmail || maskEmail(metadata.email),
    otpExpiresAt: metadata.otpExpiresAt ?? null,
    resendAvailableAt: metadata.resendAvailableAt ?? null,
  }
  inMemoryPendingRegistration = safe
  try {
    globalThis.localStorage?.setItem(PENDING_REGISTRATION_STORAGE_KEY, JSON.stringify(safe))
  } catch {
    // Storage may be unavailable in private or native webviews.
  }
  return safe
}

export function getPendingRegistrationMetadata() {
  if (inMemoryPendingRegistration) return inMemoryPendingRegistration
  try {
    const raw = globalThis.localStorage?.getItem(PENDING_REGISTRATION_STORAGE_KEY)
    if (raw) inMemoryPendingRegistration = JSON.parse(raw)
  } catch {
    inMemoryPendingRegistration = null
  }
  return inMemoryPendingRegistration
}

export function clearPendingRegistrationMetadata() {
  inMemoryPendingRegistration = null
  clearRegistrationAttemptCache()
  try {
    globalThis.localStorage?.removeItem(PENDING_REGISTRATION_STORAGE_KEY)
  } catch {
    // Best effort only.
  }
}

/**
 * Register a new Cloud account. The v2 endpoint intentionally returns a pending
 * email-verification state and never creates a local Cloud session.
 *
 * @param {object} payload
 * @param {string} payload.name
 * @param {string} payload.email
 * @param {string} payload.password
 * @param {string} [payload.password_confirmation]
 * @param {string} payload.business_name
 * @param {object} [options]
 * @returns {Promise<{ok: boolean, state?: string, registration?: object, error?: object}>}
 */
export async function cloudRegister({
  name,
  email,
  password,
  password_confirmation,
  business_name,
}, { idempotencyKey } = {}) {
  const payload = {
    name,
    email,
    password,
    password_confirmation: password_confirmation || password,
    business_name,
  }

  let registrationKey
  try {
    registrationKey = await getRegistrationKey(payload, idempotencyKey)
  } catch {
    return {
      ok: false,
      error: {
        status: 0,
        code: 'SECURE_RANDOM_UNAVAILABLE',
        message: 'Registrasi tidak dapat diproses dengan aman pada perangkat ini.',
        data: null,
      },
    }
  }

  const result = await apiRequest('/api/v2/auth/register', {
    method: 'POST',
    body: payload,
    idempotencyKey: registrationKey,
  })

  if (!result.ok) {
    return { ok: false, error: result.error }
  }

  const data = responseData(result)
  if (result.status !== 202 || !data?.registration_id || data.state !== 'pending_email') {
    return {
      ok: false,
      error: {
        status: result.status,
        code: data?.state || 'INVALID_REGISTRATION_RESPONSE',
        message: 'Respons pendaftaran tidak dapat diproses.',
        data: result.data ?? null,
      },
    }
  }

  return {
    ok: true,
    state: 'pending_email',
    registration: {
      registrationId: data.registration_id,
      maskedEmail: maskEmail(email),
      otpExpiresAt: data.otp_expires_at ?? null,
      resendAvailableAt: data.resend_available_at ?? null,
    },
  }
}

/**
 * Login with email + password using the v2 contract.
 * Only saves the returned token after a confirmed success response.
 *
 * @param {string} email
 * @param {string} password
 * @returns {Promise<{ok: boolean, token?: string, user?: object, error?: object}>}
 */
export async function cloudLogin(email, password) {
  const result = await apiRequest('/api/v2/auth/login', {
    method: 'POST',
    body: { email, password },
  })

  const data = responseData(result)

  const responseCode = String(result.data?.code ?? result.error?.code ?? '').toUpperCase()
  if (
    result.status === 202 &&
    (responseCode === 'TWO_FACTOR_REQUIRED' || data?.state === 'two_factor_required')
  ) {
    const challenge = data
    const validChallenge =
      typeof challenge?.challenge_id === 'string' &&
      challenge.challenge_id.length > 0 &&
      typeof challenge?.expires_at === 'string' &&
      Number.isFinite(Date.parse(challenge.expires_at)) &&
      Array.isArray(challenge?.methods) &&
      challenge.methods.length > 0 &&
      challenge.methods.every((method) => typeof method === 'string' && method.length > 0)

    if (!validChallenge) {
      return {
        ok: false,
        error: {
          status: 202,
          code: 'MALFORMED_TWO_FACTOR_CHALLENGE',
          message: 'Respons verifikasi dua langkah tidak valid.',
          data: null,
        },
      }
    }

    return {
      ok: false,
      state: 'two_factor_required',
      challenge,
      error: {
        status: 202,
        code: 'TWO_FACTOR_REQUIRED',
        message: 'Verifikasi dua faktor diperlukan.',
        data: result.data ?? null,
      },
    }
  }

  if (!result.ok) {
    return { ok: false, error: result.error }
  }

  const token = data?.token
  const user = data?.user

  if (!token) {
    return {
      ok: false,
      error: {
        status: 0,
        code: 'MISSING_TOKEN',
        message: 'Token not returned by server',
        data: null,
      },
    }
  }

  return { ok: true, token, user }
}

function isValidGoogleUser(user) {
  return (
    user &&
    (typeof user.id === 'string' || typeof user.id === 'number') &&
    String(user.id).trim() !== '' &&
    typeof user.name === 'string' &&
    user.name.trim() !== '' &&
    typeof user.email === 'string' &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(user.email)
  )
}

function parseTwoFactorChallenge(result) {
  const data = responseData(result)
  const challenge = data
  const validChallenge =
    typeof challenge?.challenge_id === 'string' &&
    challenge.challenge_id.trim() !== '' &&
    typeof challenge?.expires_at === 'string' &&
    Number.isFinite(Date.parse(challenge.expires_at)) &&
    Array.isArray(challenge?.methods) &&
    challenge.methods.length > 0 &&
    challenge.methods.every((method) => typeof method === 'string' && method.trim() !== '')

  if (!validChallenge) {
    return {
      ok: false,
      error: {
        status: 202,
        code: 'MALFORMED_TWO_FACTOR_CHALLENGE',
        message: 'Respons verifikasi dua langkah tidak valid.',
        data: null,
      },
    }
  }

  return {
    ok: false,
    state: 'two_factor_required',
    challenge,
    error: {
      status: 202,
      code: 'TWO_FACTOR_REQUIRED',
      message: 'Verifikasi dua faktor diperlukan.',
      data: result.data ?? null,
    },
  }
}

/**
 * Exchange one fresh Android Google ID token for a Cloud Sanctum token.
 * The assertion is never saved here; the caller owns it only for this request.
 */
export async function cloudGoogleLogin(idToken, platform = 'android') {
  if (typeof idToken !== 'string' || idToken.trim() === '') {
    return {
      ok: false,
      error: {
        status: 0,
        code: 'GOOGLE_ID_TOKEN_MISSING',
        message: 'Kredensial Google tidak tersedia.',
        data: null,
      },
    }
  }

  const clientPlatform = platform === 'android' ? 'android' : null
  if (!clientPlatform) {
    return {
      ok: false,
      error: {
        status: 0,
        code: 'UNSUPPORTED_PLATFORM',
        message: 'Login Google hanya tersedia pada aplikasi Android.',
        data: null,
      },
    }
  }

  const result = await apiRequest('/api/v2/auth/google', {
    method: 'POST',
    body: { id_token: idToken, client_platform: clientPlatform },
  })

  const responseCode = String(result?.data?.code ?? result?.error?.code ?? '').toUpperCase()
  if (result.status === 202 && responseCode === 'TWO_FACTOR_REQUIRED') {
    return parseTwoFactorChallenge(result)
  }

  if (!result.ok) return { ok: false, error: result.error }

  const data = responseData(result)
  const tokenType = data?.token_type
  const token = data?.token
  const user = data?.user

  if (
    result.status !== 200 ||
    tokenType !== 'Bearer' ||
    typeof token !== 'string' ||
    token.trim() === '' ||
    !isValidGoogleUser(user)
  ) {
    return {
      ok: false,
      error: {
        status: result.status,
        code: 'MALFORMED_GOOGLE_SUCCESS',
        message: 'Respons login Google tidak valid.',
        data: null,
      },
    }
  }

  return { ok: true, token, user }
}

function parseOtpRegistration(result, fallbackEmail = '', fallbackRegistrationId = null) {
  if (!result.ok) return { ok: false, error: result.error }
  const data = responseData(result)
  return {
    ok: true,
    state: data?.state ?? 'pending_email',
    registration: {
      registrationId: data?.registration_id ?? fallbackRegistrationId,
      maskedEmail: data?.masked_email || maskEmail(fallbackEmail),
      otpExpiresAt: data?.otp_expires_at ?? null,
      resendAvailableAt: data?.resend_available_at ?? null,
    },
  }
}

/** Verify a registration OTP. This endpoint never returns a Sanctum token. */
export async function cloudVerifyOtp(registrationId, code) {
  const result = await apiRequest('/api/v2/auth/otp/verify', {
    method: 'POST',
    body: { registration_id: registrationId, code },
  })

  if (!result.ok) return { ok: false, error: result.error }
  const data = responseData(result)
  if (result.status !== 200 || data?.state !== 'verified') {
    return {
      ok: false,
      error: {
        status: result.status,
        code: data?.state || 'INVALID_OTP_RESPONSE',
        message: 'Verifikasi email belum selesai.',
        data: result.data ?? null,
      },
    }
  }
  return { ok: true, state: 'verified', provisioning: data.provisioning ?? null }
}

/** Request a fresh OTP. Server timestamps are returned to the UI unchanged. */
export async function cloudResendOtp(registrationId, email = '') {
  const result = await apiRequest('/api/v2/auth/otp/resend', {
    method: 'POST',
    body: { registration_id: registrationId },
  })

  return parseOtpRegistration(result, email, registrationId)
}

export const verifyCloudOtp = cloudVerifyOtp
export const resendCloudOtp = cloudResendOtp

/**
 * Fetch authenticated user info.
 *
 * @param {string} token
 * @returns {Promise<{ok: boolean, user?: object, error?: object}>}
 */
export async function fetchMe(token) {
  const result = await apiRequest('/api/auth/me', { token })

  if (!result.ok) {
    return { ok: false, error: result.error }
  }

  return { ok: true, user: result.data?.data ?? result.data }
}

/**
 * Fetch mobile context (business / outlet / subscription / role /
 * sync_capabilities data).
 *
 * INT-02: passing the stable `device_identifier` lets the backend return a
 * `device_context` for owner-pre-registered cashier devices. The request is
 * otherwise unchanged, so a legacy backend simply ignores the query parameter.
 *
 * @param {string} token
 * @param {object} [options]
 * @param {string|null} [options.deviceIdentifier]
 * @returns {Promise<{ok: boolean, data?: object, error?: object}>}
 */
export async function fetchMobileContext(token, { deviceIdentifier = null } = {}) {
  const query =
    typeof deviceIdentifier === 'string' && deviceIdentifier.trim().length > 0
      ? `?device_identifier=${encodeURIComponent(deviceIdentifier.trim())}`
      : ''

  const result = await apiRequest(`/api/mobile/context${query}`, { token })

  if (!result || result.ok !== true) {
    return {
      ok: false,
      error: result?.error ?? {
        status: 0,
        code: 'CONTEXT_REQUEST_FAILED',
        message: 'Mobile context request failed',
        data: null,
      },
    }
  }

  return { ok: true, data: result.data?.data ?? result.data }
}

/**
 * Register or resolve device on the server.
 *
 * @param {string} token
 * @param {object} payload
 * @param {number} payload.business_id
 * @param {number} payload.outlet_id
 * @param {string} payload.device_identifier
 * @param {string} payload.name
 * @param {'android'|'ios'|null} payload.platform
 * @returns {Promise<{ok: boolean, device?: object, error?: object}>}
 */
export async function registerDevice(token, payload) {
  const result = await apiRequest('/api/mobile/devices', {
    method: 'POST',
    body: payload,
    token,
  })

  if (!result.ok) {
    return { ok: false, error: result.error }
  }

  return { ok: true, device: result.data?.data ?? result.data }
}

/**
 * Logout from cloud.
 * Best-effort: caller must clean up local session regardless of network result.
 *
 * @param {string} token
 * @returns {Promise<{ok: boolean, networkError?: boolean}>}
 */
export async function cloudLogout(token) {
  const result = await apiRequest('/api/auth/logout', {
    method: 'DELETE',
    token,
  })

  if (!result.ok && result.error?.code === 'NETWORK_ERROR') {
    return { ok: false, networkError: true }
  }

  return { ok: result.ok }
}
