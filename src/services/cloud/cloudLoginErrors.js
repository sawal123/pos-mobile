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

const OTP_MESSAGES = Object.freeze({
  OTP_INVALID: 'Kode OTP salah. Periksa kembali kode yang Anda masukkan.',
  OTP_EXPIRED: 'Kode OTP sudah kedaluwarsa. Kirim ulang kode terbaru.',
  OTP_MAX_ATTEMPTS: 'Batas percobaan OTP tercapai. Kirim ulang kode atau mulai alur registrasi baru.',
  OTP_ALREADY_USED: 'Kode OTP ini sudah digunakan. Gunakan kode terbaru.',
  OTP_REPLACED: 'Kode OTP ini sudah digantikan. Gunakan kode terbaru.',
  OTP_RESEND_COOLDOWN: 'Tunggu sampai waktu kirim ulang tercapai.',
  OTP_RATE_LIMITED: 'Terlalu banyak permintaan. Coba lagi setelah waktu yang ditentukan server.',
  OTP_DELIVERY_FAILED: 'Kode OTP belum dapat dikirim. Coba lagi nanti.',
  AUTH_PROVISIONING_PENDING: 'Akun sedang disiapkan. Jangan masuk sebelum proses selesai.',
  IDEMPOTENCY_KEY_REUSED: 'Permintaan pendaftaran sudah digunakan untuk data berbeda. Mulai registrasi baru.',
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
 * @returns {{kind: string, message: string}}
 */
export function describeRegisterError(error) {
  const status = Number(error?.status) || 0
  const code = typeof error?.code === 'string' ? error.code.toUpperCase() : ''

  if (status === 0 || code === 'NETWORK_ERROR') {
    return { kind: CLOUD_LOGIN_ERROR_KIND.OFFLINE, message: MESSAGES.offline }
  }

  if (status === 422) {
    const errors = error?.data?.errors
    if (errors && typeof errors === 'object') {
      if (errors.email && errors.email.length > 0) {
        return {
          kind: 'validation',
          message: 'Email sudah terdaftar. Silakan gunakan email lain atau masuk ke akun Anda.',
        }
      }
      if (errors.password && errors.password.length > 0) {
        return {
          kind: 'validation',
          message: errors.password[0] || 'Password minimal 8 karakter dan konfirmasi harus cocok.',
        }
      }
      const firstKey = Object.keys(errors)[0]
      if (firstKey && errors[firstKey]?.[0]) {
        return { kind: 'validation', message: errors[firstKey][0] }
      }
    }
    return {
      kind: 'validation',
      message: error?.data?.message || 'Data pendaftaran belum lengkap atau tidak valid.',
    }
  }

  if (status >= 500 || code === 'MISSING_TOKEN') {
    return { kind: CLOUD_LOGIN_ERROR_KIND.SERVER, message: MESSAGES.server }
  }

  if (code === 'IDEMPOTENCY_KEY_REUSED') {
    return { kind: 'idempotency', message: OTP_MESSAGES.IDEMPOTENCY_KEY_REUSED }
  }

  return {
    kind: CLOUD_LOGIN_ERROR_KIND.UNKNOWN,
    message: 'Pendaftaran Cloud gagal. Silakan periksa data Anda dan coba lagi.',
  }
}

/** Map OTP/API failures to safe Indonesian UI copy without exposing raw exceptions. */
export function describeOtpError(error) {
  const status = Number(error?.status) || 0
  const code = typeof error?.code === 'string' ? error.code.toUpperCase() : ''

  if (status === 0 || code === 'NETWORK_ERROR') {
    return { kind: 'offline', message: 'Koneksi internet diperlukan untuk memproses OTP. State Anda tetap tersimpan.' }
  }

  if (status === 429 || code === 'OTP_RATE_LIMITED' || code === 'RATE_LIMITED') {
    return {
      kind: 'rate-limited',
      message: OTP_MESSAGES.OTP_RATE_LIMITED,
      retryAfter: error?.retryAfter ?? error?.data?.retry_after ?? null,
    }
  }

  if (OTP_MESSAGES[code]) return { kind: code.toLowerCase(), message: OTP_MESSAGES[code] }

  if (status === 422) return { kind: 'validation', message: 'Masukkan kode OTP 6 digit.' }
  return { kind: 'unknown', message: 'Verifikasi OTP gagal. Coba lagi.' }
}

/**
 * @param {object|null|undefined} error Raw error from `apiClient`.
 * @returns {boolean}
 */
export function isOfflineError(error) {
  return describeLoginError(error).kind === CLOUD_LOGIN_ERROR_KIND.OFFLINE
}
