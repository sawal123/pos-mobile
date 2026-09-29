/**
 * PREM-M01 — Subscription entitlement adapter (UI only).
 *
 * Pure, side-effect-free mapping from the server-provided `subscription`
 * object attached to a business in `GET /api/mobile/context` to the UI
 * entitlement state consumed by the Settings screen.
 *
 * Backend fields actually consumed (never invented):
 *   - `plan`       — the plan identifier (`free`, `pro`, ...)
 *   - `status`     — the subscription state (`active`, `expired`, ...)
 *   - an expiry date when the API provides one (several spellings accepted)
 *
 * Rules
 * -----
 * - Strict fail-closed: **active Premium** requires a *recognised paid plan*
 *   with the explicit status `active`, confirmed by a *verified* context in
 *   this session. An expiry date, when present, must be valid and in the
 *   future.
 * - Any unknown/absent status, unknown plan, unparseable date, failed refresh,
 *   or an unverified (cached / legacy) context resolves to `unverified` — i.e.
 *   "last known data", never a fresh Premium grant.
 * - This module grants no access. Backend entitlement stays the single source
 *   of truth; the UI only reflects it. Nothing here reads or writes
 *   localStorage or any user-manipulable flag.
 * - No I/O, no Pinia, no network: fully unit-testable.
 */

export const ENTITLEMENT_STATUS = Object.freeze({
  LOADING: 'loading',
  FREE: 'free',
  PREMIUM: 'premium',
  EXPIRED: 'expired',
  PENDING: 'pending',
  UNVERIFIED: 'unverified',
  ERROR: 'error',
})

/** Plans the app explicitly recognises as paid. Only these may be Premium. */
export const KNOWN_PAID_PLANS = Object.freeze([
  'cloud',
  'pro',
  'premium',
  'business',
  'enterprise',
  'starter',
  'growth',
  'plus',
  'team',
])

/** Explicit free plans. Everything else is unknown unless listed above. */
const FREE_PLAN_KEYS = Object.freeze(['free', 'none'])

/** The only subscription status that may grant active Premium. */
const ACTIVE_STATUSES = Object.freeze(['active'])

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
  cloud: 'Cloud',
  pro: 'Pro',
  premium: 'Premium',
  business: 'Business',
  enterprise: 'Enterprise',
  starter: 'Starter',
  growth: 'Growth',
  plus: 'Plus',
  team: 'Team',
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

/**
 * Read the first usable expiry date field. Returns whether any date field was
 * present at all (so an invalid value can be distinguished from "no date").
 *
 * @param {object} subscription
 * @returns {{present: boolean, valid: boolean, date: Date|null}}
 */
function readExpiry(subscription) {
  for (const field of DATE_FIELDS) {
    const value = subscription?.[field]
    if (value === undefined || value === null || value === '') continue
    if (typeof value !== 'string') return { present: true, valid: false, date: null }
    const parsed = new Date(value)
    if (Number.isNaN(parsed.getTime())) return { present: true, valid: false, date: null }
    return { present: true, valid: true, date: parsed }
  }
  return { present: false, valid: false, date: null }
}

/**
 * Display label for a plan. Known plans use their curated label; otherwise the
 * raw server value is returned unchanged (nothing is invented).
 *
 * @param {string|null} planKey
 * @returns {string|null}
 */
export function planLabel(planKey) {
  if (!planKey) return null
  return PLAN_LABELS[planKey] ?? planKey
}

function entitlement(status, details = {}) {
  return {
    status,
    isPremium: status === ENTITLEMENT_STATUS.PREMIUM,
    stale: status === ENTITLEMENT_STATUS.UNVERIFIED,
    plan: null,
    planLabel: null,
    expiresAt: null,
    hasSubscriptionData: false,
    ...details,
  }
}

/**
 * Resolve the UI entitlement from a raw subscription object.
 *
 * @param {object} [params]
 * @param {object|null} [params.subscription] Raw server `subscription` payload.
 * @param {boolean} [params.loading] Whether a cloud context fetch is in flight.
 * @param {*} [params.error] Last cloud error, used only when no subscription is known.
 * @param {boolean} [params.verified] Context confirmed in this session.
 * @param {number} [params.now] Injectable clock (tests).
 * @returns {{status: string, isPremium: boolean, stale: boolean, plan: string|null,
 *   planLabel: string|null, expiresAt: string|null, hasSubscriptionData: boolean}}
 */
export function resolveEntitlement({
  subscription = null,
  loading = false,
  error = null,
  verified = false,
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
  const expiry = readExpiry(subscription)
  const details = {
    plan,
    planLabel: planLabel(plan),
    expiresAt: expiry.valid ? expiry.date.toISOString() : null,
    hasSubscriptionData: true,
  }

  // An explicit free plan is always Free.
  if (plan && FREE_PLAN_KEYS.includes(plan)) {
    return entitlement(ENTITLEMENT_STATUS.FREE, details)
  }

  // Expiration always wins over an otherwise-active plan.
  if (expiry.present && !expiry.valid) {
    return entitlement(ENTITLEMENT_STATUS.UNVERIFIED, details)
  }
  if (expiry.valid && expiry.date.getTime() <= now) {
    return entitlement(ENTITLEMENT_STATUS.EXPIRED, details)
  }
  if (rawStatus && EXPIRY_STATUSES.includes(rawStatus)) {
    return entitlement(ENTITLEMENT_STATUS.EXPIRED, details)
  }
  if (rawStatus && PENDING_STATUSES.includes(rawStatus)) {
    return entitlement(ENTITLEMENT_STATUS.PENDING, details)
  }

  // Only a recognised paid plan may ever become Premium.
  const isKnownPaidPlan = plan !== null && KNOWN_PAID_PLANS.includes(plan)
  if (!isKnownPaidPlan) {
    return entitlement(ENTITLEMENT_STATUS.UNVERIFIED, details)
  }

  // Premium requires an explicit, recognised active status.
  const hasActiveStatus = rawStatus !== null && ACTIVE_STATUSES.includes(rawStatus)
  if (!hasActiveStatus) {
    return entitlement(ENTITLEMENT_STATUS.UNVERIFIED, details)
  }

  // A failed refresh or an unverified (cached/legacy) context only exposes the
  // last known data — it never becomes a fresh Premium grant.
  if (error || !verified) {
    return entitlement(ENTITLEMENT_STATUS.UNVERIFIED, details)
  }

  return entitlement(ENTITLEMENT_STATUS.PREMIUM, details)
}
