/**
 * PREM-M01 — Subscription entitlement adapter (UI only).
 *
 * Pure, side-effect-free mapping from the server-provided `subscription`
 * object attached to a business in `GET /api/mobile/context` to the UI
 * entitlement state consumed by the Settings screen.
 *
 * Rules
 * -----
 * - Fail closed: Premium is only reported for an explicit non-free plan that is
 *   neither expired nor pending. Anything unknown is treated as Free.
 * - Never an authority: this module grants no access. Backend entitlement stays
 *   the single source of truth; the UI only reflects it. Nothing here reads or
 *   writes localStorage or any user-manipulable flag.
 * - No I/O, no Pinia, no network: fully unit-testable.
 */

export const ENTITLEMENT_STATUS = Object.freeze({
  LOADING: 'loading',
  FREE: 'free',
  PREMIUM: 'premium',
  EXPIRED: 'expired',
  PENDING: 'pending',
  ERROR: 'error',
})

/** Only these plan keys are treated as Free; every other plan is a paid tier. */
const FREE_PLAN_KEYS = Object.freeze(['free', 'none'])

const EXPIRY_STATUSES = Object.freeze([
  'expired',
  'ended',
  'terminated',
  'cancelled',
  'canceled',
  'revoked',
])

const PENDING_STATUSES = Object.freeze([
  'pending',
  'past_due',
  'unpaid',
  'incomplete',
  'incomplete_expired',
  'awaiting_payment',
  'processing',
  'suspended',
  'on_hold',
])

const PLAN_LABELS = Object.freeze({
  pro: 'Pro',
  premium: 'Premium',
  business: 'Business',
  enterprise: 'Enterprise',
  starter: 'Starter',
  growth: 'Growth',
  plus: 'Plus',
})

const DATE_FIELDS = Object.freeze([
  'ends_at',
  'endsAt',
  'expires_at',
  'expiresAt',
  'expired_at',
  'expiredAt',
  'expiry_date',
  'end_date',
  'valid_until',
  'current_period_end',
])

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function normalizeKey(value) {
  if (typeof value !== 'string') return null
  const trimmed = value.trim().toLowerCase()
  return trimmed.length > 0 ? trimmed : null
}

/**
 * Normalise a raw plan key (`Pro`, `pro plan`, `premium`...).
 *
 * @param {*} raw
 * @returns {string|null}
 */
export function normalizePlanKey(raw) {
  const key = normalizeKey(raw)
  return key ? key.replace(/[\s-]+/g, '_') : null
}

function readExpiryDate(subscription) {
  for (const field of DATE_FIELDS) {
    const value = subscription?.[field]
    if (typeof value !== 'string' || value.trim() === '') continue
    const parsed = new Date(value)
    if (!Number.isNaN(parsed.getTime())) return parsed
  }
  return null
}

/**
 * Human readable label for a plan key.
 *
 * @param {string|null} planKey
 * @returns {string}
 */
export function planLabel(planKey) {
  if (!planKey) return 'Free'
  if (PLAN_LABELS[planKey]) return PLAN_LABELS[planKey]
  return planKey
    .split('_')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

function entitlement(status, details = {}) {
  return {
    status,
    isPremium: status === ENTITLEMENT_STATUS.PREMIUM,
    plan: null,
    planLabel: 'Free',
    expiresAt: null,
    ...details,
  }
}

/**
 * Resolve the UI entitlement from a raw subscription object.
 *
 * Precedence: an explicit expiration (date in the past or an expiry status)
 * always wins over an otherwise-active paid plan, so an expired or pending
 * subscription is never surfaced as active Premium.
 *
 * @param {object} [params]
 * @param {object|null} [params.subscription] Raw server `subscription` payload.
 * @param {boolean} [params.loading] Whether a cloud context fetch is in flight.
 * @param {*} [params.error] Last cloud error, used only when no subscription is known.
 * @param {number} [params.now] Injectable clock (tests).
 * @returns {{status: string, isPremium: boolean, plan: string|null, planLabel: string, expiresAt: string|null}}
 */
export function resolveEntitlement({
  subscription = null,
  loading = false,
  error = null,
  now = Date.now(),
} = {}) {
  if (!isPlainObject(subscription)) {
    if (error) return entitlement(ENTITLEMENT_STATUS.ERROR)
    if (loading) return entitlement(ENTITLEMENT_STATUS.LOADING)
    return entitlement(ENTITLEMENT_STATUS.FREE)
  }

  const plan = normalizePlanKey(
    subscription.plan ??
      subscription.plan_name ??
      subscription.tier ??
      subscription.name ??
      subscription.code,
  )
  const rawStatus = normalizeKey(
    subscription.status ?? subscription.state ?? subscription.subscription_status,
  )
  const expiryDate = readExpiryDate(subscription)
  const details = {
    plan,
    planLabel: planLabel(plan),
    expiresAt: expiryDate ? expiryDate.toISOString() : null,
  }

  if (expiryDate && expiryDate.getTime() <= now) {
    return entitlement(ENTITLEMENT_STATUS.EXPIRED, details)
  }

  if (rawStatus && EXPIRY_STATUSES.includes(rawStatus)) {
    return entitlement(ENTITLEMENT_STATUS.EXPIRED, details)
  }

  if (rawStatus && PENDING_STATUSES.includes(rawStatus)) {
    return entitlement(ENTITLEMENT_STATUS.PENDING, details)
  }

  const isPaidPlan = plan !== null && !FREE_PLAN_KEYS.includes(plan)

  if (!isPaidPlan) {
    return entitlement(ENTITLEMENT_STATUS.FREE, details)
  }

  return entitlement(ENTITLEMENT_STATUS.PREMIUM, details)
}
