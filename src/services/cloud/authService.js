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
 *
 * Does NOT implement:
 * - 2FA completion flow
 * - Forgot password
 * - Sync push/pull
 */

import { apiRequest } from './apiClient'

const PENDING_REGISTRATION_STORAGE_KEY = 'cloud_pending_registration_v2'
let inMemoryPendingRegistration = null
const registrationKeys = new Map()

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

function payloadFingerprint(payload) {
  return JSON.stringify({
    name: payload.name,
    email: payload.email,
    password: payload.password,
    password_confirmation: payload.password_confirmation,
    business_name: payload.business_name,
  })
}

function getRegistrationKey(payload, explicitKey) {
  if (explicitKey) return explicitKey
  const fingerprint = payloadFingerprint(payload)
  const existing = registrationKeys.get(fingerprint)
  if (existing) return existing
  const key = createIdempotencyKey()
  registrationKeys.set(fingerprint, key)
  return key
}

function responseData(result) {
  return result?.data?.data ?? result?.data ?? null
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

  const result = await apiRequest('/api/v2/auth/register', {
    method: 'POST',
    body: payload,
    idempotencyKey: getRegistrationKey(payload, idempotencyKey),
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

  if (result.status === 202 && (data?.state === 'two_factor_required' || result.error?.code === 'TWO_FACTOR_REQUIRED')) {
    return {
      ok: false,
      state: 'two_factor_required',
      challenge: data,
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
