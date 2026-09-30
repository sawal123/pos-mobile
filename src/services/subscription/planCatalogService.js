/**
 * PREM-M02 — Premium plan catalog adapter (isolated).
 *
 * Speaks the **authoritative backend contract** shipped by PREM-D01/PREM-D02A:
 *
 *   GET /api/mobile/subscription/plans?business_id={activeBusinessId}
 *
 *   {
 *     "data": {
 *       "business_id": 1,
 *       "plans": [
 *         {
 *           "code": "cloud",
 *           "name": "Cloud",
 *           "billing_periods": [
 *             { "period": "monthly", "currency": "IDR", "price_minor": 123 },
 *             { "period": "yearly",  "currency": "IDR", "price_minor": 1234 }
 *           ],
 *           "benefits": ["Sinkronisasi cloud"],
 *           "available": true,
 *           "purchasable": false
 *         }
 *       ],
 *       "checkout_available": false
 *     }
 *   }
 *
 * One plan carries **all** its billing periods, so a single `cloud` plan with
 * `monthly` + `yearly` is enough to drive the Bulanan/Tahunan choice; the backend
 * never has to send two entries with the same code.
 *
 * Guarantees
 * ----------
 * - **No invented price.** The only price source is the backend's `price_minor`,
 *   taken exactly as sent (no mockup numbers, no conversion). A missing/invalid
 *   price makes the option non-purchasable and the UI honest.
 * - **`business_id` is never hardcoded.** It comes from the active business
 *   context; without one the adapter refuses to call the endpoint.
 * - Read-only: no charging, no background retry, no storage writes.
 *
 * Legacy aliases (`price`, `period`, `features`, `features`-style single-period
 * entries) are still accepted for backward compatibility, but they are strictly
 * subordinate: the canonical fields always win when present.
 */

import { apiRequest } from '@/services/cloud/apiClient'
import { normalizePlanKey } from './entitlementService'

export const PLAN_CATALOG_STATUS = Object.freeze({
  READY: 'ready',
  EMPTY: 'empty',
  UNAVAILABLE: 'unavailable',
  ERROR: 'error',
})

export const PLAN_CATALOG_REASON = Object.freeze({
  NOT_AUTHENTICATED: 'not_authenticated',
  NO_BUSINESS: 'no_business',
  ENDPOINT_MISSING: 'endpoint_missing',
  REQUEST_FAILED: 'request_failed',
})

export const PLAN_PERIOD = Object.freeze({
  MONTHLY: 'monthly',
  YEARLY: 'yearly',
})

/** Canonical period order used for the Bulanan/Tahunan toggle. */
export const PLAN_PERIOD_ORDER = Object.freeze([PLAN_PERIOD.MONTHLY, PLAN_PERIOD.YEARLY])

export const PLAN_PERIOD_LABELS = Object.freeze({
  monthly: 'Bulanan',
  yearly: 'Tahunan',
})

/** Environment override for the catalog endpoint (used by tests / staging). */
export const PLAN_CATALOG_PATH_ENV = 'VITE_SUBSCRIPTION_PLANS_PATH'

/** Authoritative catalog endpoint (PREM-D01). */
export const DEFAULT_PLAN_CATALOG_PATH = '/api/mobile/subscription/plans'

/** Only currency the Premium product is priced in today. */
export const DEFAULT_PLAN_CURRENCY = 'IDR'

const CURRENCY_PREFIXES = Object.freeze({ IDR: 'Rp' })

const PERIOD_ALIASES = Object.freeze({
  monthly: PLAN_PERIOD.MONTHLY,
  month: PLAN_PERIOD.MONTHLY,
  bulanan: PLAN_PERIOD.MONTHLY,
  yearly: PLAN_PERIOD.YEARLY,
  annual: PLAN_PERIOD.YEARLY,
  annually: PLAN_PERIOD.YEARLY,
  year: PLAN_PERIOD.YEARLY,
  tahunan: PLAN_PERIOD.YEARLY,
})

const PLAN_CODE_FIELDS = Object.freeze(['code', 'plan', 'key', 'slug', 'id'])
const PLAN_NAME_FIELDS = Object.freeze(['name', 'title', 'label'])
const PLAN_BENEFIT_FIELDS = Object.freeze(['benefits', 'features', 'feature_list'])
const PLAN_TERM_FIELDS = Object.freeze(['terms', 'term', 'notes', 'note'])
const PERIOD_PRICE_FIELDS = Object.freeze(['price_minor', 'price', 'amount', 'price_idr'])
const PERIOD_CURRENCY_FIELDS = Object.freeze(['currency', 'currency_code'])
const PLAN_PERIOD_FIELDS = Object.freeze(['period', 'interval', 'billing_period'])

function firstDefined(source, fields) {
  for (const field of fields) {
    const value = source[field]
    if (value !== undefined && value !== null && value !== '') return value
  }
  return null
}

function unwrapPayload(payload) {
  if (payload === null || payload === undefined) return null
  if (Array.isArray(payload)) return { plans: payload }
  if (typeof payload !== 'object') return null
  return payload?.data !== undefined && payload.data !== null && typeof payload.data === 'object'
    ? payload.data
    : payload
}

/**
 * Catalog endpoint, overridable through the environment. The backend path is a
 * shipped contract, so this always resolves to a usable path.
 *
 * @param {Record<string, any>} [env]
 * @returns {string}
 */
export function resolvePlanCatalogPath(env = import.meta.env) {
  const raw = env?.[PLAN_CATALOG_PATH_ENV]
  if (typeof raw === 'string' && raw.trim().length > 0) return raw.trim()
  return DEFAULT_PLAN_CATALOG_PATH
}

/**
 * Append the active `business_id` to the catalog path, preserving any query the
 * path already carries. The id is encoded, never interpolated raw.
 *
 * @param {string} path
 * @param {number|string} businessId
 * @returns {string}
 */
export function buildPlanCatalogPath(path, businessId) {
  const base = String(path ?? '').trim()
  const separator = base.includes('?') ? '&' : '?'
  return `${base}${separator}business_id=${encodeURIComponent(String(businessId))}`
}

/**
 * Normalise a raw billing period. Unknown values resolve to `null` so the UI
 * never claims a period the API did not state.
 *
 * @param {*} raw
 * @returns {'monthly'|'yearly'|null}
 */
export function normalizePlanPeriod(raw) {
  if (typeof raw !== 'string') return null
  const key = raw
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_')
  return PERIOD_ALIASES[key] ?? null
}

/**
 * Accept a number or a plain numeric string. Anything else (including
 * unparseable "Rp ..." strings) is rejected instead of being guessed.
 *
 * @param {*} raw
 * @returns {number|null}
 */
function parseAmount(raw) {
  if (typeof raw === 'number') {
    return Number.isFinite(raw) && raw >= 0 ? raw : null
  }

  if (typeof raw === 'string') {
    const trimmed = raw.trim()
    if (trimmed === '' || !/^\d+(\.\d+)?$/.test(trimmed)) return null
    const parsed = Number(trimmed)
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null
  }

  return null
}

/**
 * Currency label for a validated amount. `price_minor` is rendered exactly as
 * the backend sent it — no conversion, no derived production price. IDR uses the
 * Rupiah prefix; any other currency keeps its ISO code verbatim.
 *
 * @param {number} amount
 * @param {string} currency
 * @returns {string}
 */
export function formatPlanPrice(amount, currency = DEFAULT_PLAN_CURRENCY) {
  const digits = Number(amount).toLocaleString('id-ID')
  return `${CURRENCY_PREFIXES[currency] ?? currency} ${digits}`
}

function normalizeBenefitList(raw) {
  if (!Array.isArray(raw)) return []
  return raw
    .map((benefit) => {
      if (typeof benefit === 'string') return benefit.trim()
      if (benefit && typeof benefit === 'object' && typeof benefit.name === 'string') {
        return benefit.name.trim()
      }
      if (benefit && typeof benefit === 'object' && typeof benefit.title === 'string') {
        return benefit.title.trim()
      }
      return ''
    })
    .filter((benefit) => benefit.length > 0)
}

function normalizeTerms(raw) {
  if (typeof raw === 'string') {
    const trimmed = raw.trim()
    return trimmed.length > 0 ? trimmed : null
  }
  if (Array.isArray(raw)) {
    const joined = normalizeBenefitList(raw)
    return joined.length > 0 ? joined.join(' ') : null
  }
  return null
}

/**
 * One priced billing period of a plan. Returns `null` for a period the product
 * does not support, so an unknown period can never reach the UI.
 *
 * @param {object} raw
 * @returns {object|null}
 */
function normalizeBillingPeriod(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null

  const period = normalizePlanPeriod(firstDefined(raw, PLAN_PERIOD_FIELDS))
  if (!period) return null

  const currencyRaw = firstDefined(raw, PERIOD_CURRENCY_FIELDS)
  const currency =
    typeof currencyRaw === 'string' && currencyRaw.trim().length > 0
      ? currencyRaw.trim()
      : DEFAULT_PLAN_CURRENCY

  // Canonical `price_minor`, or a legacy single-period price when absent.
  const priceMinor = parseAmount(firstDefined(raw, PERIOD_PRICE_FIELDS))

  return {
    period,
    periodLabel: PLAN_PERIOD_LABELS[period],
    currency,
    priceMinor,
    priceLabel: priceMinor === null ? null : formatPlanPrice(priceMinor, currency),
    hasPrice: priceMinor !== null,
  }
}

function billingPeriodsOf(raw) {
  const canonical = Array.isArray(raw.billing_periods) ? raw.billing_periods : []
  const periods = canonical.map(normalizeBillingPeriod).filter((period) => period !== null)

  if (periods.length > 0) return dedupePeriods(periods)

  // Legacy shape: a single flat `period` (+ price) on the plan itself.
  const legacy = normalizeBillingPeriod(raw)

  return legacy ? [legacy] : []
}

function dedupePeriods(periods) {
  const seen = new Set()
  const unique = periods.filter((period) => {
    if (seen.has(period.period)) return false
    seen.add(period.period)
    return true
  })

  return unique.sort(
    (a, b) => PLAN_PERIOD_ORDER.indexOf(a.period) - PLAN_PERIOD_ORDER.indexOf(b.period),
  )
}

/**
 * Normalise one catalog plan. Returns `null` when the entry has no usable plan
 * code — a plan that cannot be identified can never be selected or purchased.
 *
 * @param {object} raw
 * @returns {object|null}
 */
export function normalizePlan(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null

  const code = normalizePlanKey(firstDefined(raw, PLAN_CODE_FIELDS))
  if (!code) return null

  const rawName = firstDefined(raw, PLAN_NAME_FIELDS)

  return {
    code,
    name: typeof rawName === 'string' && rawName.trim().length > 0 ? rawName.trim() : code,
    /** Backend gate, taken verbatim. A local price check is applied on top. */
    purchasable: raw.purchasable === true,
    /** `available: false` means the backend does not offer the plan right now. */
    available: raw.available !== false,
    benefits: normalizeBenefitList(firstDefined(raw, PLAN_BENEFIT_FIELDS)),
    terms: normalizeTerms(firstDefined(raw, PLAN_TERM_FIELDS)),
    billingPeriods: billingPeriodsOf(raw),
  }
}

/**
 * Flatten one plan into one selectable option per priced billing period, so the
 * UI can offer Bulanan/Tahunan from a single plan entry.
 *
 * @param {object} plan
 * @returns {object[]}
 */
function optionsOf(plan) {
  return plan.billingPeriods.map((period) => ({
    key: `${plan.code}::${period.period}`,
    code: plan.code,
    name: plan.name,
    period: period.period,
    periodLabel: period.periodLabel,
    currency: period.currency,
    priceMinor: period.priceMinor,
    priceLabel: period.priceLabel,
    hasPrice: period.hasPrice,
    benefits: plan.benefits,
    terms: plan.terms,
    available: plan.available,
    purchasable: plan.purchasable,
  }))
}

/**
 * Normalise a full catalog response into canonical plans, the flattened
 * selectable options, and the periods that are genuinely offered.
 *
 * @param {*} payload
 * @returns {{plans: object[], options: object[], periods: string[],
 *   supportsBothPeriods: boolean, checkoutAvailable: boolean}}
 */
export function normalizePlanCatalog(payload) {
  const source = unwrapPayload(payload)

  const rawPlans = Array.isArray(source)
    ? source
    : Array.isArray(source?.plans)
      ? source.plans
      : Array.isArray(source?.catalog)
        ? source.catalog
        : Array.isArray(source?.items)
          ? source.items
          : []

  const seenCodes = new Set()
  const plans = rawPlans.map(normalizePlan).filter((plan) => {
    if (plan === null) return false
    if (seenCodes.has(plan.code)) return false
    seenCodes.add(plan.code)
    return true
  })

  const options = plans
    .filter((plan) => plan.available)
    .flatMap(optionsOf)
    .filter((option) => option.hasPrice)

  const periods = PLAN_PERIOD_ORDER.filter((period) =>
    options.some((option) => option.period === period),
  )

  return {
    plans,
    options,
    periods: [...periods],
    supportsBothPeriods: periods.length > 1,
    checkoutAvailable: source?.checkout_available === true || source?.checkout?.available === true,
  }
}

function unavailable(reason) {
  return {
    ok: true,
    requested: false,
    status: PLAN_CATALOG_STATUS.UNAVAILABLE,
    reason,
    plans: [],
    options: [],
    periods: [],
    checkoutAvailable: false,
    supportsBothPeriods: false,
    error: null,
  }
}

/**
 * Fetch and normalise the plan catalog for the active business.
 *
 * @param {object} [options]
 * @param {string|null} [options.path] Override the catalog endpoint.
 * @param {string|null} [options.token] Bearer token.
 * @param {number|string|null} [options.businessId] Active business id.
 * @returns {Promise<object>}
 */
export async function fetchPlanCatalog({
  path = resolvePlanCatalogPath(),
  token = null,
  businessId = null,
} = {}) {
  // The backend contract requires `business_id`; never guess one.
  if (businessId === null || businessId === undefined || `${businessId}`.trim() === '') {
    return unavailable(PLAN_CATALOG_REASON.NO_BUSINESS)
  }

  const requestPath = buildPlanCatalogPath(path, businessId)

  let result

  try {
    result = await apiRequest(requestPath, { token })
  } catch (err) {
    return {
      ok: false,
      requested: true,
      status: PLAN_CATALOG_STATUS.ERROR,
      reason: PLAN_CATALOG_REASON.REQUEST_FAILED,
      plans: [],
      options: [],
      periods: [],
      checkoutAvailable: false,
      supportsBothPeriods: false,
      error: { message: err instanceof Error ? err.message : 'Katalog paket gagal dimuat.' },
    }
  }

  if (!result?.ok) {
    const status = result?.error?.status ?? 0
    // A missing route means the catalog is not deployed yet — not a broken app.
    const missing = status === 404 || status === 405 || status === 501

    if (missing) return unavailable(PLAN_CATALOG_REASON.ENDPOINT_MISSING)

    return {
      ok: false,
      requested: true,
      status: PLAN_CATALOG_STATUS.ERROR,
      reason: PLAN_CATALOG_REASON.REQUEST_FAILED,
      plans: [],
      options: [],
      periods: [],
      checkoutAvailable: false,
      supportsBothPeriods: false,
      error: result?.error ?? {
        status,
        code: 'CATALOG_REQUEST_FAILED',
        message: 'Katalog paket gagal dimuat.',
      },
    }
  }

  const catalog = normalizePlanCatalog(result.data)

  return {
    ok: true,
    requested: true,
    path: requestPath,
    status: catalog.options.length > 0 ? PLAN_CATALOG_STATUS.READY : PLAN_CATALOG_STATUS.EMPTY,
    reason: null,
    ...catalog,
    error: null,
  }
}
