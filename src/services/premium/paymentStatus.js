/**
 * PREM-M04 — subscription payment status vocabulary (pure, no IO).
 *
 * Mirrors the internal statuses of the backend `SubscriptionPayment` model.
 * The client never invents a status: an unknown/missing value is treated as
 * malformed and fails closed by the checkout service.
 */

export const PAYMENT_STATUS = Object.freeze({
  PENDING: 'pending',
  PAID: 'paid',
  FAILED: 'failed',
  EXPIRED: 'expired',
  CANCELLED: 'cancelled',
  REFUNDED: 'refunded',
})

/** Statuses after which polling must stop (backend `finalStatuses()`). */
export const TERMINAL_PAYMENT_STATUSES = Object.freeze([
  PAYMENT_STATUS.PAID,
  PAYMENT_STATUS.FAILED,
  PAYMENT_STATUS.EXPIRED,
  PAYMENT_STATUS.CANCELLED,
  PAYMENT_STATUS.REFUNDED,
])

const STATUS_SET = new Set(Object.values(PAYMENT_STATUS))

const LABELS = Object.freeze({
  pending: 'Menunggu pembayaran',
  paid: 'Pembayaran berhasil',
  failed: 'Pembayaran gagal',
  expired: 'Waktu pembayaran habis',
  cancelled: 'Pembayaran dibatalkan',
  refunded: 'Pembayaran dikembalikan',
})

const TONES = Object.freeze({
  pending: 'warning',
  paid: 'success',
  failed: 'danger',
  expired: 'danger',
  cancelled: 'danger',
  refunded: 'muted',
})

/**
 * Normalise a raw status. Returns `null` for anything the backend did not
 * explicitly state, so a malformed payload can fail closed.
 *
 * @param {*} raw
 * @returns {'pending'|'paid'|'failed'|'expired'|'cancelled'|'refunded'|null}
 */
export function normalizePaymentStatus(raw) {
  if (typeof raw !== 'string') return null
  const key = raw.trim().toLowerCase()
  return STATUS_SET.has(key) ? key : null
}

/**
 * @param {string|null} status
 * @returns {boolean}
 */
export function isTerminalPaymentStatus(status) {
  return TERMINAL_PAYMENT_STATUSES.includes(status)
}

/**
 * @param {string|null} status
 * @returns {string}
 */
export function paymentStatusLabel(status) {
  return LABELS[status] ?? 'Status pembayaran tidak diketahui'
}

/**
 * @param {string|null} status
 * @returns {'warning'|'success'|'danger'|'muted'}
 */
export function paymentStatusTone(status) {
  return TONES[status] ?? 'muted'
}
