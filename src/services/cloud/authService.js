/**
 * Cloud authentication service.
 *
 * Handles:
 * - POST /api/auth/login
 * - GET  /api/auth/me
 * - DELETE /api/auth/logout
 * - GET  /api/mobile/context
 * - POST /api/mobile/devices
 *
 * Does NOT implement:
 * - 2FA flow
 * - Registration
 * - Forgot password
 * - Sync push/pull
 */

import { apiRequest } from './apiClient'

/**
 * Login with email + password.
 * Only saves the returned token after a confirmed success response.
 *
 * @param {string} email
 * @param {string} password
 * @returns {Promise<{ok: boolean, token?: string, user?: object, error?: object}>}
 */
export async function cloudLogin(email, password) {
  const result = await apiRequest('/api/auth/login', {
    method: 'POST',
    body: { email, password },
  })

  if (!result.ok) {
    return { ok: false, error: result.error }
  }

  const token = result.data?.data?.token
  const user = result.data?.data?.user

  if (!token) {
    return {
      ok: false,
      error: { status: 0, code: 'MISSING_TOKEN', message: 'Token not returned by server', data: null },
    }
  }

  return { ok: true, token, user }
}

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
 * Fetch mobile context (business / outlet / subscription data).
 *
 * @param {string} token
 * @returns {Promise<{ok: boolean, data?: object, error?: object}>}
 */
export async function fetchMobileContext(token) {
  const result = await apiRequest('/api/mobile/context', { token })

  if (!result.ok) {
    return { ok: false, error: result.error }
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
