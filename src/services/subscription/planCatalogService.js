/**
 * PREM-M02 — Premium plan catalog adapter (isolated).
 *
 * The Laravel backend does **not** expose a plan catalog or a checkout endpoint
 * yet (`routes/api.php` only serves `/api/auth/*`, `/api/mobile/context`,
 * `/api/mobile/devices` and `/api/sync/*`). This module is the single place that
 * knows about the *proposed* catalog contract, so the rest of the app never
 * depends on an endpoint that does not exist.
 *
 * Guarantees
 * ----------
 * - **No invented endpoint is ever called.** The path must be configured
 *   explicitly (`VITE_SUBSCRIPTION_PLANS_PATH`). When it is absent the adapter
 *   resolves to `unavailable` without performing any network request.
 * - **No invented price.** A plan without a usable numeric price is still listed
 *   but is explicitly *not purchasable*.
 * - Read-only: this service never charges, never retries in the background and
 *   never writes to local storage.
 *
 * Required backend contract (handoff to PREM-D01) is documented in
 * `docs/premium/PREM_M02_PLAN_SELECTION.md`.
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
  NOT_CONFIGURED: 'not_configured',
  NOT_AUTHENTICATED: 'not_authenticated',
  ENDPOINT_MISSING: 'endpoint_missing',
  REQUEST_FAILED: 'request_failed',
})

export const PLAN_PERIOD = Object.freeze({
  MONTHLY: 'monthly',
  YEARLY: 'yearly',
})

export const PLAN_PERIOD_LABELS = Object.freeze({
  monthly: 'Bulanan',
  yearly: 'Tahunan',
})

/** Environment variable that must be set once PREM-D01 ships the endpoint. */
export const PLAN_CATALOG_PATH_ENV = 'VITE_SUBSCRIPTION_PLANS_PATH'

/**
 * Proposed endpoint for the plan catalog (PREM-D01). Only used when explicitly
 * configured through `PLAN_CATALOG_PATH_ENV`; never assumed.
 */
export const PROPOSED_PLAN_CATALOG_PATH = '/api/mobile/subscription/plans'

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
const PLAN_PRICE_FIELDS = Object.freeze(['price', 'amount', 'price_idr', 'amount_idr'])
const PLAN_PERIOD_FIELDS = Object.freeze(['period', 'interval', 'billing_period'])
const PLAN_FEATURE_FIELDS = Object.freeze(['features', 'benefits', 'feature_list'])
const PLAN_TERM_FIELDS = Object.freeze(['terms', 'term', 'notes', 'note'])

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
 * Configured catalog path, or `null` when the backend has not shipped one yet.
 *
 * @param {Record<string, any>} [env]
 * @returns {string|null}
 */
export function resolvePlanCatalogPath(env = import.meta.env) {
  const raw = env?.[PLAN_CATALOG_PATH_ENV]
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim()
  return trimmed.length > 0 ? trimmed : null
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
function parsePrice(raw) {
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
 * Rupiah label for a validated numeric price.
 *
 * @param {number} price
 * @returns {string}
 */
export function formatPlanPrice(price) {
  return `Rp ${price.toLocaleString('id-ID')}`
}

function normalizeFeatures(raw) {
  if (!Array.isArray(raw)) return []
  return raw
    .map((feature) => {
      if (typeof feature === 'string') return feature.trim()
      if (feature && typeof feature === 'object' && typeof feature.name === 'string') {
        return feature.name.trim()
      }
      if (feature && typeof feature === 'object' && typeof feature.title === 'string') {
        return feature.title.trim()
      }
      return ''
    })
    .filter((feature) => feature.length > 0)
}

function normalizeTerms(raw) {
  if (typeof raw === 'string') {
    const trimmed = raw.trim()
    return trimmed.length > 0 ? trimmed : null
  }
  if (Array.isArray(raw)) {
    const joined = normalizeFeatures(raw)
    return joined.length > 0 ? joined.join(' ') : null
  }
  return null
}

/**
 * Normalise one catalog entry. Returns `null` when the entry has no usable plan
 * code — a nameless/unkeyable plan can never be selected or purchased.
 *
 * @param {object} raw
 * @returns {object|null}
 */
export function normalizePlan(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null

  const code = normalizePlanKey(firstDefined(raw, PLAN_CODE_FIELDS))
  if (!code) return null

  const price = parsePrice(firstDefined(raw, PLAN_PRICE_FIELDS))
  const period = normalizePlanPeriod(firstDefined(raw, PLAN_PERIOD_FIELDS))
  const rawName = firstDefined(raw, PLAN_NAME_FIELDS)

  return {
    code,
    name: typeof rawName === 'string' && rawName.trim().length > 0 ? rawName.trim() : code,
    price,
    priceLabel: price === null ? null : formatPlanPrice(price),
    currency: typeof raw.currency === 'string' && raw.currency.trim() ? raw.currency.trim() : 'IDR',
    period,
    periodLabel: period ? PLAN_PERIOD_LABELS[period] : null,
    features: normalizeFeatures(firstDefined(raw, PLAN_FEATURE_FIELDS)),
    terms: normalizeTerms(firstDefined(raw, PLAN_TERM_FIELDS)),
    /** A price the API actually returned is the only way to be purchasable. */
    purchasable: price !== null,
  }
}

/**
 * Normalise a full catalog response.
 *
 * @param {*} payload
 * @returns {{plans: object[], checkoutAvailable: boolean, supportsBothPeriods: boolean}}
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

  const normalized = rawPlans.map(normalizePlan).filter((plan) => plan !== null)

  // Keep the first entry per (code, period) so a duplicate never renders twice.
  const seen = new Set()
  const plans = normalized.filter((plan) => {
    const key = `${plan.code}|${plan.period ?? ''}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })

  const checkoutAvailable =
    source?.checkout_available === true || source?.checkout?.available === true

  return {
    plans,
    checkoutAvailable,
    supportsBothPeriods:
      plans.some((plan) => plan.period === PLAN_PERIOD.MONTHLY) &&
      plans.some((plan) => plan.period === PLAN_PERIOD.YEARLY),
  }
}

function unavailable(reason) {
  return {
    ok: true,
    requested: false,
    status: PLAN_CATALOG_STATUS.UNAVAILABLE,
    reason,
    plans: [],
    checkoutAvailable: false,
    supportsBothPeriods: false,
    error: null,
  }
}

/**
 * Fetch and normalise the plan catalog.
 *
 * @param {object} [options]
 * @param {string|null} [options.path] Explicit path; defaults to the configured one.
 * @param {string|null} [options.token] Bearer token.
 * @returns {Promise<object>}
 */
export async function fetchPlanCatalog({ path = resolvePlanCatalogPath(), token = null } = {}) {
  // No configured endpoint → the backend simply does not offer a catalog yet.
  if (typeof path !== 'string' || path.trim().length === 0) {
    return unavailable(PLAN_CATALOG_REASON.NOT_CONFIGURED)
  }

  let result

  try {
    result = await apiRequest(path.trim(), { token })
  } catch (err) {
    return {
      ok: false,
      requested: true,
      status: PLAN_CATALOG_STATUS.ERROR,
      reason: PLAN_CATALOG_REASON.REQUEST_FAILED,
      plans: [],
      checkoutAvailable: false,
      supportsBothPeriods: false,
      error: { message: err instanceof Error ? err.message : 'Katalog paket gagal dimuat.' },
    }
  }

  if (!result?.ok) {
    const status = result?.error?.status ?? 0
    // A missing route means the catalog does not exist yet — not a broken app.
    const missing = status === 404 || status === 405 || status === 501

    if (missing) return unavailable(PLAN_CATALOG_REASON.ENDPOINT_MISSING)

    return {
      ok: false,
      requested: true,
      status: PLAN_CATALOG_STATUS.ERROR,
      reason: PLAN_CATALOG_REASON.REQUEST_FAILED,
      plans: [],
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
    status: catalog.plans.length > 0 ? PLAN_CATALOG_STATUS.READY : PLAN_CATALOG_STATUS.EMPTY,
    reason: null,
    ...catalog,
    error: null,
  }
}
