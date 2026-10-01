/**
 * PREM-M04 — stable idempotency keys for one checkout attempt.
 *
 * The backend accepts a free-form `idempotency_key` (max 120 chars) and reuses
 * the matching pending payment, so the mobile client generates the key and keeps
 * it stable for the duration of an attempt. A new attempt (after a terminal or
 * cancelled payment) generates a new key.
 */

export function createIdempotencyKey(prefix = 'prem') {
  const uuid = globalThis.crypto?.randomUUID?.()
  if (typeof uuid === 'string' && uuid.length > 0) {
    return `${prefix}-${uuid}`
  }

  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}
