export const EXPIRING_SOON_THRESHOLD_DAYS = 7

const DAY_MS = 24 * 60 * 60 * 1000

export const REMAINING_TIME_STATE = Object.freeze({
  NO_EXPIRY: 'no_expiry',
  INVALID: 'invalid',
  FUTURE: 'future',
  TODAY: 'today',
  PAST: 'past',
})

function parseDate(value) {
  if (value === null || value === undefined || value === '') return null
  if (typeof value !== 'string') return undefined
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? undefined : date
}

function startOfLocalDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
}

export function formatServerDate(value, { locale = 'id-ID' } = {}) {
  const date = parseDate(value)
  if (date === null) return null
  if (date === undefined) return 'Tanggal tidak valid'
  return date.toLocaleDateString(locale, { day: 'numeric', month: 'long', year: 'numeric' })
}

export function formatServerDateTime(value, { locale = 'id-ID' } = {}) {
  const date = parseDate(value)
  if (date === null) return null
  if (date === undefined) return 'Tanggal tidak valid'
  return date.toLocaleString(locale, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function remainingTimeUntil(expiresAt, { now = Date.now() } = {}) {
  const expiry = parseDate(expiresAt)
  if (expiry === null) {
    return {
      state: REMAINING_TIME_STATE.NO_EXPIRY,
      label: 'Tanpa batas waktu',
      days: null,
      expiresAt: null,
    }
  }
  if (expiry === undefined) {
    return {
      state: REMAINING_TIME_STATE.INVALID,
      label: 'Tanggal tidak valid',
      days: null,
      expiresAt: null,
    }
  }

  const current = new Date(now)
  const diffMs = expiry.getTime() - current.getTime()
  const sameLocalDay = startOfLocalDay(expiry) === startOfLocalDay(current)

  if (diffMs <= 0) {
    return {
      state: sameLocalDay ? REMAINING_TIME_STATE.TODAY : REMAINING_TIME_STATE.PAST,
      label: sameLocalDay ? 'Hari ini' : 'Sudah berakhir',
      days: sameLocalDay ? 0 : Math.floor(diffMs / DAY_MS),
      expiresAt: expiry,
    }
  }

  const days = Math.ceil(diffMs / DAY_MS)

  return {
    state: sameLocalDay ? REMAINING_TIME_STATE.TODAY : REMAINING_TIME_STATE.FUTURE,
    label: sameLocalDay ? 'Hari ini' : `${days} hari lagi`,
    days: sameLocalDay ? 0 : days,
    expiresAt: expiry,
  }
}

export function isExpiringSoon(
  expiresAt,
  { now = Date.now(), thresholdDays = EXPIRING_SOON_THRESHOLD_DAYS } = {},
) {
  const remaining = remainingTimeUntil(expiresAt, { now })
  return (
    remaining.state === REMAINING_TIME_STATE.FUTURE &&
    remaining.days !== null &&
    remaining.days <= thresholdDays
  )
}

export function subscriptionStatusLabel(status) {
  switch (status) {
    case 'premium':
      return 'Aktif'
    case 'expired':
      return 'Kedaluwarsa'
    case 'pending':
      return 'Menunggu pembayaran'
    case 'unverified':
      return 'Belum terverifikasi'
    case 'error':
      return 'Tidak diketahui'
    case 'loading':
      return 'Memuat'
    default:
      return 'Free'
  }
}
