/**
 * Kasir device pairing (kode verifikasi 4 digit).
 *
 * Alur yang disepakati dengan backend:
 *  1. Pemilik membuat kode di Dashboard → Perangkat → Kode Kasir.
 *  2. Kode 4 digit berlaku 30 menit, hanya untuk role kasir, hanya paket Cloud.
 *  3. Kasir menginput kode di aplikasi; aplikasi mengirim kode + identitas
 *     perangkat (nama, identifier stabil, platform, versi app, model) dan
 *     server mencatat IP + user agent dari request.
 *  4. Server membalas device yang sudah terpasang (beserta outlet), lalu
 *     aplikasi me-refresh context agar `device_context` terisi.
 *
 * Owner/member tidak memakai alur ini: perangkat mereka dikelola dari
 * Dashboard dan di-bind otomatis oleh server saat sync pertama.
 */

import { apiRequest } from './apiClient'
import { getToken } from './tokenRepository'
import { APP_VERSION } from '@/constants/appInfo'

export const PAIRING_CODE_LENGTH = 4

export const PAIRING_ERROR = Object.freeze({
  INVALID_CODE: 'PAIRING_CODE_INVALID',
  ALREADY_USED: 'PAIRING_CODE_ALREADY_USED',
  EXPIRED: 'PAIRING_CODE_EXPIRED',
  REVOKED: 'PAIRING_CODE_REVOKED',
  RATE_LIMITED: 'PAIRING_RATE_LIMITED',
  CASHIER_ONLY: 'PAIRING_CASHIER_ONLY',
  CLOUD_REQUIRED: 'CLOUD_SUBSCRIPTION_REQUIRED',
  DEVICE_INACTIVE: 'DEVICE_INACTIVE',
  DEVICE_OUTLET_MISMATCH: 'DEVICE_OUTLET_MISMATCH',
  DEVICE_LIMIT: 'CLOUD_DEVICE_LIMIT_REACHED',
  NETWORK: 'NETWORK_ERROR',
})

const ERROR_MESSAGES = {
  [PAIRING_ERROR.INVALID_CODE]: 'Kode pairing salah atau sudah tidak berlaku.',
  [PAIRING_ERROR.ALREADY_USED]: 'Kode ini sudah dipakai. Minta kode baru dari pemilik.',
  [PAIRING_ERROR.EXPIRED]:
    'Kode sudah kedaluwarsa (berlaku 30 menit). Minta kode baru dari pemilik.',
  [PAIRING_ERROR.REVOKED]: 'Kode sudah dibatalkan pemilik. Minta kode baru.',
  [PAIRING_ERROR.RATE_LIMITED]: 'Terlalu banyak percobaan. Tunggu beberapa menit lalu coba lagi.',
  [PAIRING_ERROR.CASHIER_ONLY]:
    'Pairing hanya untuk akun kasir. Perangkat owner tidak perlu pairing.',
  [PAIRING_ERROR.CLOUD_REQUIRED]: 'Paket Cloud tidak aktif. Pairing perangkat tidak tersedia.',
  [PAIRING_ERROR.DEVICE_INACTIVE]:
    'Perangkat ini dinonaktifkan. Minta pemilik mengaktifkannya di Dashboard.',
  [PAIRING_ERROR.DEVICE_OUTLET_MISMATCH]:
    'Perangkat ini terdaftar di outlet lain. Minta pemilik memindahkannya lewat Dashboard.',
  [PAIRING_ERROR.DEVICE_LIMIT]:
    'Batas perangkat Cloud tercapai. Nonaktifkan perangkat lain di Dashboard terlebih dahulu.',
  [PAIRING_ERROR.NETWORK]: 'Tidak dapat menghubungi server. Periksa koneksi internet.',
}

/**
 * Keep only the digits of a typed code and cap it at 4 digits.
 *
 * @param {unknown} value
 * @returns {string}
 */
export function normalizePairingCode(value) {
  const digits = String(value ?? '').replace(/\D+/g, '')
  return digits.slice(0, PAIRING_CODE_LENGTH)
}

/**
 * Whether a code can be submitted.
 *
 * @param {unknown} value
 * @returns {boolean}
 */
export function isValidPairingCode(value) {
  return normalizePairingCode(value).length === PAIRING_CODE_LENGTH
}

/**
 * Human-readable message for a failed pairing attempt.
 *
 * @param {string|null|undefined} code
 * @param {string} [fallback]
 * @returns {string}
 */
export function describePairingError(code, fallback = '') {
  if (code && ERROR_MESSAGES[code]) return ERROR_MESSAGES[code]
  return fallback || 'Pairing perangkat gagal. Coba lagi.'
}

/**
 * Facts sent to the server as pairing evidence (name, app version, platform).
 * IP address and user agent are recorded server-side from the request itself.
 *
 * @returns {{platform: string|null, appVersion: string, deviceModel: string, locale: string|null, timezone: string|null, screen: string|null}}
 */
export function collectDeviceFacts() {
  const nav = typeof navigator !== 'undefined' ? navigator : null
  const win = typeof window !== 'undefined' ? window : null

  let timezone = null
  try {
    timezone = new Intl.DateTimeFormat().resolvedOptions().timeZone ?? null
  } catch {
    // Keep null when the runtime has no Intl support.
  }

  const screen =
    win && win.screen && Number.isFinite(win.screen.width) && Number.isFinite(win.screen.height)
      ? `${win.screen.width}x${win.screen.height}`
      : null

  return {
    platform: resolvePlatform(),
    appVersion: APP_VERSION,
    deviceModel: nav?.userAgentData?.platform || nav?.platform || 'unknown',
    locale: nav?.language ?? null,
    timezone,
    screen,
  }
}

function resolvePlatform() {
  try {
    const platform = globalThis.Capacitor?.getPlatform?.()
    if (platform === 'android' || platform === 'ios') return platform
  } catch {
    // browser / test environment
  }
  return 'web'
}

/**
 * Suggested device name shown in the pairing form.
 *
 * @param {object|null} facts
 * @returns {string}
 */
export function defaultDeviceName(facts = null) {
  const data = facts ?? collectDeviceFacts()
  const model = data.deviceModel && data.deviceModel !== 'unknown' ? data.deviceModel : ''
  return model ? `Kasir ${model}` : 'Kasir Mobile'
}

/**
 * Redeem a pairing code for this device.
 *
 * @param {object} options
 * @param {string} options.code 4-digit code from the dashboard.
 * @param {string} [options.deviceName]
 * @param {number|string} [options.businessId]
 * @param {string} [options.deviceIdentifier]
 * @param {string} [options.token]
 * @returns {Promise<{ok: boolean, device: object|null, error: {code: string, message: string, status?: number}|null}>}
 */
export async function pairDeviceWithCode({
  code,
  deviceName,
  businessId,
  deviceIdentifier,
  token = null,
} = {}) {
  const normalizedCode = normalizePairingCode(code)

  if (normalizedCode.length !== PAIRING_CODE_LENGTH) {
    return {
      ok: false,
      device: null,
      error: {
        code: PAIRING_ERROR.INVALID_CODE,
        message: `Kode pairing harus ${PAIRING_CODE_LENGTH} digit angka.`,
      },
    }
  }

  if (!businessId) {
    return {
      ok: false,
      device: null,
      error: {
        code: 'BUSINESS_REQUIRED',
        message: 'Pilih bisnis Cloud terlebih dahulu.',
      },
    }
  }

  if (!deviceIdentifier) {
    return {
      ok: false,
      device: null,
      error: {
        code: 'DEVICE_IDENTIFIER_REQUIRED',
        message: 'Identitas perangkat belum siap. Buka ulang aplikasi lalu coba lagi.',
      },
    }
  }

  let bearer = token
  if (!bearer) {
    try {
      bearer = await getToken()
    } catch {
      bearer = null
    }
  }

  if (!bearer) {
    return {
      ok: false,
      device: null,
      error: {
        code: 'NOT_AUTHENTICATED',
        message: 'Sesi Cloud sudah berakhir. Masuk kembali lalu coba pairing lagi.',
      },
    }
  }

  const facts = collectDeviceFacts()

  const response = await apiRequest('/api/mobile/devices/pair', {
    method: 'POST',
    token: bearer,
    body: {
      business_id: Number(businessId),
      code: normalizedCode,
      device_identifier: deviceIdentifier,
      name: (deviceName && deviceName.trim()) || defaultDeviceName(facts),
      platform: facts.platform,
      app_version: facts.appVersion,
      device_model: facts.deviceModel,
    },
  })

  if (!response.ok) {
    const errorCode = response.error?.code ?? 'PAIRING_FAILED'
    return {
      ok: false,
      device: null,
      error: {
        code: errorCode,
        message: describePairingError(errorCode, response.error?.message ?? ''),
        status: response.status,
        details: response.error?.data ?? null,
      },
    }
  }

  return {
    ok: true,
    device: response.data?.data ?? null,
    error: null,
  }
}
