/**
 * Pure classifier for Cloud Login failures (PREM-M03).
 *
 * Maps the raw error object produced by `apiClient` into a stable `kind` plus
 * a curated, user-facing message. It never echoes server text verbatim so a
 * password or token can never leak into the UI, and it has no IO.
 */

export const CLOUD_LOGIN_ERROR_KIND = Object.freeze({
  OFFLINE: 'offline',
  INVALID_CREDENTIALS: 'invalid-credentials',
  UNVERIFIED: 'unverified',
  TWO_FACTOR: 'two-factor',
  SERVER: 'server',
  UNKNOWN: 'unknown',
})

const MESSAGES = Object.freeze({
  offline: 'Koneksi internet diperlukan untuk masuk ke Cloud.',
  invalidCredentials: 'Email atau password salah.',
  unverified: 'Email akun Cloud belum diverifikasi. Verifikasi melalui Dashboard sebelum masuk.',
  twoFactor: 'Akun Cloud memerlukan verifikasi dua faktor. Selesaikan melalui Dashboard.',
  server: 'Server Cloud sedang bermasalah. Coba lagi nanti.',
  unknown: 'Login Cloud gagal. Periksa data Anda lalu coba lagi.',
})

/**
 * @param {object|null|undefined} error Raw error from `apiClient`.
 * @returns {{kind: string, message: string}}
 */
export function describeLoginError(error) {
  const status = Number(error?.status) || 0
  const code = typeof error?.code === 'string' ? error.code.toUpperCase() : ''

  if (status === 0 || code === 'NETWORK_ERROR') {
    return { kind: CLOUD_LOGIN_ERROR_KIND.OFFLINE, message: MESSAGES.offline }
  }

  if (status === 401 || code === 'INVALID_CREDENTIALS' || code === 'UNAUTHENTICATED') {
    return {
      kind: CLOUD_LOGIN_ERROR_KIND.INVALID_CREDENTIALS,
      message: MESSAGES.invalidCredentials,
    }
  }

  if (code === 'EMAIL_NOT_VERIFIED' || code === 'EMAIL_UNVERIFIED') {
    return { kind: CLOUD_LOGIN_ERROR_KIND.UNVERIFIED, message: MESSAGES.unverified }
  }

  if (code === 'TWO_FACTOR_REQUIRED' || code === 'TWO_FACTOR_REQUIRED_CHALLENGE') {
    return { kind: CLOUD_LOGIN_ERROR_KIND.TWO_FACTOR, message: MESSAGES.twoFactor }
  }

  if (status >= 500 || code === 'MISSING_TOKEN') {
    return { kind: CLOUD_LOGIN_ERROR_KIND.SERVER, message: MESSAGES.server }
  }

  return { kind: CLOUD_LOGIN_ERROR_KIND.UNKNOWN, message: MESSAGES.unknown }
}

/**
 * @param {object|null|undefined} error Raw error from `apiClient`.
 * @returns {boolean}
 */
export function isOfflineError(error) {
  return describeLoginError(error).kind === CLOUD_LOGIN_ERROR_KIND.OFFLINE
}
