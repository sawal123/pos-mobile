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

/** Curated Indonesian messages for native Google provider and exchange errors. */
export function describeGoogleLoginError(error) {
  const status = Number(error?.status) || 0
  const code = typeof error?.code === 'string' ? error.code.toUpperCase() : ''

  if (code === 'USER_CANCELLED') {
    return { kind: 'cancelled', message: '' }
  }
  if (code === 'UNSUPPORTED_PLATFORM') {
    return { kind: 'unsupported', message: 'Google Sign-In native hanya tersedia di aplikasi Android.' }
  }
  if (code === 'CONFIGURATION_INVALID' || code === 'GOOGLE_AUTH_NOT_CONFIGURED') {
    return { kind: 'not-configured', message: 'Konfigurasi Google Sign-In belum siap.' }
  }
  if (code === 'PROVIDER_UNAVAILABLE') {
    return { kind: 'provider-unavailable', message: 'Google Sign-In tidak tersedia di perangkat ini.' }
  }
  if (code === 'ACCOUNT_LINK_REQUIRED') {
    return {
      kind: 'account-link-required',
      message:
        'Akun dengan email ini sudah terdaftar. Masuk dengan email dan password terlebih dahulu untuk menghubungkan akun Google.',
    }
  }
  if (code === 'IDENTITY_CONFLICT') {
    return { kind: 'identity-conflict', message: 'Identitas Google tidak dapat dihubungkan dengan aman ke akun ini.' }
  }
  if (status === 202 || code === 'TWO_FACTOR_REQUIRED') {
    return { kind: 'two-factor', message: 'Akun memerlukan verifikasi dua langkah. Selesaikan verifikasi melalui alur yang tersedia.' }
  }
  if (status === 401 || code === 'GOOGLE_TOKEN_INVALID' || code === 'GOOGLE_TOKEN_EXPIRED' || code === 'GOOGLE_AUDIENCE_INVALID') {
    return { kind: 'invalid-token', message: 'Verifikasi Google gagal. Coba masuk dengan Google kembali.' }
  }
  if (code === 'GOOGLE_EMAIL_UNVERIFIED' || code === 'EMAIL_NOT_VERIFIED') {
    return { kind: 'unverified', message: 'Email Google belum terverifikasi.' }
  }
  if (code === 'AUTH_PROVISIONING_PENDING') {
    return { kind: 'provisioning', message: 'Penyiapan akun Cloud belum selesai. Coba lagi nanti.' }
  }
  if (status === 429) {
    return { kind: 'rate-limited', message: 'Terlalu banyak percobaan. Tunggu sebentar sebelum mencoba lagi.' }
  }
  if (code === 'GOOGLE_PROVISIONING_FAILED') {
    return { kind: 'provisioning-failed', message: 'Penyiapan akun Google gagal. Periksa status akun sebelum mencoba lagi.' }
  }
  if (status === 503) {
    return { kind: 'server', message: 'Login Google belum tersedia. Coba lagi nanti.' }
  }
  if (status === 0 || code === 'NETWORK_ERROR') {
    return { kind: 'network-uncertain', message: 'Permintaan login Google belum dapat dipastikan. Mulai proses baru secara eksplisit dengan akun Google.' }
  }
  return { kind: 'unknown', message: 'Login Google gagal. Coba lagi dengan akun Google.' }
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
