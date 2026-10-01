/**
 * PREM-M04 — subscription checkout & payment API adapter (isolated).
 *
 * The single module that knows the PREM-D02B mobile contract:
 *
 *   POST /api/mobile/subscription/checkout
 *     body { business_id, plan, billing_period, idempotency_key? }
 *     -> 201 { data: { payment_id, status, provider, snap_token, redirect_url } }
 *
 *   GET  /api/mobile/subscription/payments/{payment}
 *   GET  /api/mobile/subscription/payments?business_id=…
 *
 * Rules enforced here:
 * - the client **never** sends `amount` / `currency` / `price_minor` (the backend
 *   rejects them as `prohibited`); the server is the only price source.
 * - a malformed response (missing payment id, unknown status, wrong shape)
 *   fails closed — no payment object is synthesised.
 * - no token, snap token, redirect URL or provider payload is ever logged.
 */

import { apiRequest } from '@/services/cloud/apiClient'
import { normalizePaymentStatus } from './paymentStatus'

export const CHECKOUT_PATH_ENV = 'VITE_SUBSCRIPTION_CHECKOUT_PATH'
export const PAYMENTS_PATH_ENV = 'VITE_SUBSCRIPTION_PAYMENTS_PATH'

export const DEFAULT_CHECKOUT_PATH = '/api/mobile/subscription/checkout'
export const DEFAULT_PAYMENTS_PATH = '/api/mobile/subscription/payments'

export const CHECKOUT_ERROR_CODE = Object.freeze({
  CHECKOUT_UNAVAILABLE: 'CHECKOUT_UNAVAILABLE',
  BUSINESS_ACCESS_DENIED: 'BUSINESS_ACCESS_DENIED',
  SUBSCRIPTION_PURCHASE_FORBIDDEN: 'SUBSCRIPTION_PURCHASE_FORBIDDEN',
  MOBILE_TOKEN_REQUIRED: 'MOBILE_TOKEN_REQUIRED',
  PAYMENT_NOT_FOUND: 'PAYMENT_NOT_FOUND',
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  MALFORMED_RESPONSE: 'MALFORMED_RESPONSE',
  NETWORK_ERROR: 'NETWORK_ERROR',
  REQUEST_FAILED: 'REQUEST_FAILED',
})

const KNOWN_CODES = new Set(Object.values(CHECKOUT_ERROR_CODE))

export function resolveCheckoutPath(env = import.meta.env) {
  const raw = env?.[CHECKOUT_PATH_ENV]
  return typeof raw === 'string' && raw.trim().length > 0 ? raw.trim() : DEFAULT_CHECKOUT_PATH
}

export function resolvePaymentsPath(env = import.meta.env) {
  const raw = env?.[PAYMENTS_PATH_ENV]
  return typeof raw === 'string' && raw.trim().length > 0 ? raw.trim() : DEFAULT_PAYMENTS_PATH
}

function toIsoOrNull(value) {
  if (typeof value !== 'string' || value.trim().length === 0) return null
  return value
}

function normalizeSubscription(raw) {
  if (raw === null || raw === undefined) return null
  if (typeof raw !== 'object' || Array.isArray(raw)) return undefined // malformed
  return {
    plan: typeof raw.plan === 'string' ? raw.plan : null,
    status: typeof raw.status === 'string' ? raw.status : null,
    startsAt: toIsoOrNull(raw.starts_at),
    expiresAt: toIsoOrNull(raw.expires_at),
  }
}

/**
 * Normalise the payment payload shared by the payments endpoints.
 *
 * @param {*} data
 * @returns {object|null} `null` when the payload is not a usable payment.
 */
export function normalizeSubscriptionPayment(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null

  const id = data.id ?? data.payment_id
  if (id === null || id === undefined || `${id}`.trim() === '') return null

  const status = normalizePaymentStatus(data.status)
  if (status === null) return null

  const subscription = normalizeSubscription(data.subscription)
  if (subscription === undefined) return null

  const amount = Number(data.amount)

  return {
    id,
    plan: typeof data.plan === 'string' ? data.plan : null,
    billingPeriod: typeof data.billing_period === 'string' ? data.billing_period : null,
    currency: typeof data.currency === 'string' ? data.currency : null,
    amount: Number.isFinite(amount) ? amount : null,
    status,
    paidAt: toIsoOrNull(data.paid_at),
    subscription,
  }
}

function mapError(result) {
  const status = Number(result?.status) || 0
  const backendCode = result?.error?.code

  if (status === 0 || backendCode === 'NETWORK_ERROR') {
    return { code: CHECKOUT_ERROR_CODE.NETWORK_ERROR, status }
  }
  if (status === 401) {
    return { code: CHECKOUT_ERROR_CODE.UNAUTHENTICATED, status }
  }
  if (typeof backendCode === 'string' && KNOWN_CODES.has(backendCode)) {
    return { code: backendCode, status }
  }
  return { code: CHECKOUT_ERROR_CODE.REQUEST_FAILED, status }
}

/**
 * Create (or reuse, via idempotency) a Midtrans checkout.
 *
 * @param {object} params
 * @param {string|null} params.token
 * @param {number|string} params.businessId
 * @param {string} params.plan
 * @param {'monthly'|'yearly'} params.billingPeriod
 * @param {string|null} [params.idempotencyKey]
 * @param {string} [params.path]
 * @returns {Promise<{ok: boolean, payment?: object, code?: string, status?: number}>}
 */
export async function createSubscriptionCheckout({
  token = null,
  businessId,
  plan,
  billingPeriod,
  idempotencyKey = null,
  path = resolveCheckoutPath(),
} = {}) {
  // Exactly the fields the backend accepts. Price fields are never sent.
  const body = {
    business_id: businessId,
    plan,
    billing_period: billingPeriod,
  }

  if (typeof idempotencyKey === 'string' && idempotencyKey.trim().length > 0) {
    body.idempotency_key = idempotencyKey.trim()
  }

  let result
  try {
    result = await apiRequest(path, { method: 'POST', body, token })
  } catch (err) {
    return { ok: false, code: CHECKOUT_ERROR_CODE.NETWORK_ERROR, status: 0, error: err }
  }

  if (!result?.ok) {
    return { ok: false, ...mapError(result), error: result?.error ?? null }
  }

  const data = result.data?.data ?? null

  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return { ok: false, code: CHECKOUT_ERROR_CODE.MALFORMED_RESPONSE, status: result.status }
  }

  const id = data.payment_id
  if (id === null || id === undefined || `${id}`.trim() === '') {
    return { ok: false, code: CHECKOUT_ERROR_CODE.MALFORMED_RESPONSE, status: result.status }
  }

  const status = normalizePaymentStatus(data.status)
  if (status === null) {
    return { ok: false, code: CHECKOUT_ERROR_CODE.MALFORMED_RESPONSE, status: result.status }
  }

  return {
    ok: true,
    payment: {
      id,
      status,
      provider: typeof data.provider === 'string' ? data.provider : null,
      snapToken: typeof data.snap_token === 'string' ? data.snap_token : null,
      redirectUrl: typeof data.redirect_url === 'string' ? data.redirect_url : null,
    },
  }
}

/**
 * Fetch one payment's authoritative status.
 *
 * @param {object} params
 * @param {string|null} params.token
 * @param {number|string} params.paymentId
 * @param {string} [params.path]
 * @returns {Promise<{ok: boolean, payment?: object, code?: string, status?: number}>}
 */
export async function fetchSubscriptionPayment({
  token = null,
  paymentId,
  path = resolvePaymentsPath(),
} = {}) {
  if (paymentId === null || paymentId === undefined || `${paymentId}`.trim() === '') {
    return { ok: false, code: CHECKOUT_ERROR_CODE.MALFORMED_RESPONSE, status: 0 }
  }

  const base = String(path).replace(/\/+$/, '')
  const requestPath = `${base}/${encodeURIComponent(String(paymentId))}`

  let result
  try {
    result = await apiRequest(requestPath, { token })
  } catch (err) {
    return { ok: false, code: CHECKOUT_ERROR_CODE.NETWORK_ERROR, status: 0, error: err }
  }

  if (!result?.ok) {
    return { ok: false, ...mapError(result), error: result?.error ?? null }
  }

  const payment = normalizeSubscriptionPayment(result.data?.data ?? null)
  if (payment === null) {
    return { ok: false, code: CHECKOUT_ERROR_CODE.MALFORMED_RESPONSE, status: result.status }
  }

  return { ok: true, payment }
}

/**
 * List recent payments for a business (recovery / duplicate guard).
 *
 * @param {object} params
 * @param {string|null} params.token
 * @param {number|string} params.businessId
 * @param {string} [params.path]
 * @returns {Promise<{ok: boolean, payments?: object[], code?: string, status?: number}>}
 */
export async function listSubscriptionPayments({
  token = null,
  businessId,
  path = resolvePaymentsPath(),
} = {}) {
  if (businessId === null || businessId === undefined || `${businessId}`.trim() === '') {
    return { ok: false, code: CHECKOUT_ERROR_CODE.MALFORMED_RESPONSE, status: 0 }
  }

  const base = String(path).replace(/\/+$/, '')
  const separator = base.includes('?') ? '&' : '?'
  const requestPath = `${base}${separator}business_id=${encodeURIComponent(String(businessId))}`

  let result
  try {
    result = await apiRequest(requestPath, { token })
  } catch (err) {
    return { ok: false, code: CHECKOUT_ERROR_CODE.NETWORK_ERROR, status: 0, error: err }
  }

  if (!result?.ok) {
    return { ok: false, ...mapError(result), error: result?.error ?? null }
  }

  const data = result.data?.data
  if (!Array.isArray(data)) {
    return { ok: false, code: CHECKOUT_ERROR_CODE.MALFORMED_RESPONSE, status: result.status }
  }

  const payments = data
    .map((item) => normalizeSubscriptionPayment(item))
    .filter((item) => item !== null)

  return { ok: true, payments }
}
