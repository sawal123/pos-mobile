import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

import { getToken } from '@/services/cloud/tokenRepository'
import { openCheckoutUrl } from '@/services/premium/checkoutLauncher'
import { createIdempotencyKey } from '@/services/premium/idempotency'
import {
  PAYMENT_STATUS,
  isTerminalPaymentStatus,
  normalizePaymentStatus,
  paymentStatusLabel,
  paymentStatusTone,
} from '@/services/premium/paymentStatus'
import {
  CHECKOUT_ERROR_CODE,
  createSubscriptionCheckout,
  fetchSubscriptionPayment,
} from '@/services/premium/subscriptionCheckoutService'
import { useCloudSessionStore } from './cloudSessionStore'
import { useSubscriptionStore } from './subscriptionStore'

/**
 * PREM-M04 — Premium checkout & payment lifecycle store.
 *
 * Owns the client-side payment *presentation* only. It never activates Premium:
 * the single source of entitlement stays the authoritative `/api/mobile/context`
 * read through `subscriptionStore`. Checkout is created server-side (server
 * authoritative price); the mobile client supplies only `business_id`, `plan`,
 * `billing_period` and a stable `idempotency_key`.
 */

export const CHECKOUT_PHASE = Object.freeze({
  IDLE: 'idle',
  CREATING: 'creating',
  READY: 'ready',
  PENDING: 'pending',
  PAID: 'paid',
  FAILED: 'failed',
  EXPIRED: 'expired',
  CANCELLED: 'cancelled',
  REFUNDED: 'refunded',
  ERROR: 'error',
})

export const CANONICAL_PLAN = 'cloud'
export const CHECKOUT_BILLING_PERIODS = Object.freeze(['monthly', 'yearly'])

const DEFAULT_POLL_INTERVAL_MS = 5000
const DEFAULT_POLL_MAX_ATTEMPTS = 60
const ACTIVATION_MAX_ATTEMPTS = 5

const PENDING_FIELDS = [
  'paymentId',
  'businessId',
  'plan',
  'billingPeriod',
  'currency',
  'amount',
  'status',
  'redirectUrl',
  'idempotencyKey',
  'createdAt',
  'expiresAt',
  'checkedAt',
]

function messageForCode(code) {
  switch (code) {
    case CHECKOUT_ERROR_CODE.CHECKOUT_UNAVAILABLE:
      return 'Pembayaran Premium belum tersedia.'
    case CHECKOUT_ERROR_CODE.BUSINESS_ACCESS_DENIED:
      return 'Akses bisnis ditolak untuk pembelian ini.'
    case CHECKOUT_ERROR_CODE.SUBSCRIPTION_PURCHASE_FORBIDDEN:
      return 'Peran Anda tidak diizinkan membeli langganan untuk bisnis ini.'
    case CHECKOUT_ERROR_CODE.MOBILE_TOKEN_REQUIRED:
    case CHECKOUT_ERROR_CODE.UNAUTHENTICATED:
      return 'Sesi Cloud tidak valid. Silakan masuk kembali.'
    case CHECKOUT_ERROR_CODE.MALFORMED_RESPONSE:
      return 'Respons pembayaran dari server tidak valid.'
    case CHECKOUT_ERROR_CODE.NETWORK_ERROR:
      return 'Koneksi internet diperlukan untuk memproses pembayaran.'
    default:
      return 'Pembayaran tidak dapat diproses saat ini.'
  }
}

function launchMessageForCode(code) {
  switch (code) {
    case 'CHECKOUT_URL_MISSING':
      return 'Halaman pembayaran tidak tersedia. Perbarui status pembayaran.'
    case 'CHECKOUT_URL_MALFORMED':
    case 'CHECKOUT_URL_PROTOCOL':
    case 'CHECKOUT_URL_INSECURE':
      return 'Tautan pembayaran tidak valid. Pembayaran tidak dilanjutkan.'
    case 'BROWSER_OPEN_FAILED':
      return 'Halaman pembayaran gagal dibuka. Coba lagi.'
    default:
      return 'Halaman pembayaran tidak dapat dibuka saat ini.'
  }
}

function pickPendingFields(record) {
  const out = {}
  for (const key of PENDING_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(record, key)) out[key] = record[key]
  }
  return out
}

export const usePremiumCheckoutStore = defineStore('premiumCheckout', () => {
  // ── State ──────────────────────────────────────────────────────────────────
  const phase = ref(CHECKOUT_PHASE.IDLE)
  /** The current attempt: display price is kept here only, never sent to API. */
  const attempt = ref(null)
  /** Authoritative payment payload fetched from the backend. */
  const payment = ref(null)
  /** Persisted pending metadata for restart recovery. */
  const pending = ref(null)
  const error = ref(null)
  const errorCode = ref(null)
  const polling = ref(false)
  const pollingAttempts = ref(0)
  const pollingStoppedReason = ref(null)
  const lastCheckedAt = ref(null)
  const activationPending = ref(false)

  let _adapter = null
  let _runtime = null
  let _pollTimer = null
  let _pollMax = DEFAULT_POLL_MAX_ATTEMPTS

  // ── Computed ───────────────────────────────────────────────────────────────
  const status = computed(() => payment.value?.status ?? pending.value?.status ?? null)
  const statusLabel = computed(() => paymentStatusLabel(status.value))
  const statusTone = computed(() => paymentStatusTone(status.value))
  const isTerminal = computed(() => isTerminalPaymentStatus(status.value))
  const isCreating = computed(() => phase.value === CHECKOUT_PHASE.CREATING)
  const isPaid = computed(() => status.value === PAYMENT_STATUS.PAID)
  const hasPending = computed(() => pending.value !== null)
  const activationInProgress = computed(() => activationPending.value === true)
  const canResumePayment = computed(
    () =>
      status.value === PAYMENT_STATUS.PENDING &&
      typeof (payment.value?.redirectUrl ?? pending.value?.redirectUrl) === 'string',
  )

  // ── Helpers ────────────────────────────────────────────────────────────────
  function setPersistenceAdapter(adapter) {
    _adapter = adapter
  }

  function init({ runtimeSignalService = null } = {}) {
    _runtime = runtimeSignalService ?? null
  }

  function isOnline() {
    if (!_runtime || typeof _runtime.getSnapshot !== 'function') return true
    return _runtime.getSnapshot()?.online === true
  }

  function isForeground() {
    if (!_runtime || typeof _runtime.getSnapshot !== 'function') return true
    return _runtime.getSnapshot()?.foreground === true
  }

  async function safeToken() {
    try {
      return await getToken()
    } catch {
      return null
    }
  }

  function setPhaseFromStatus(value) {
    const normalized = normalizePaymentStatus(value)
    phase.value = normalized ?? CHECKOUT_PHASE.ERROR
  }

  async function persistPending() {
    if (!_adapter) return
    try {
      if (pending.value) {
        await _adapter.savePendingSubscriptionPayment(pending.value)
      } else {
        await _adapter.clearPendingSubscriptionPayment()
      }
    } catch {
      // non-blocking – pending recovery is best effort
    }
  }

  function normalizePendingRecord(record) {
    if (!record || typeof record !== 'object' || Array.isArray(record)) return null
    const id = record.paymentId ?? record.id
    if (id === null || id === undefined || `${id}`.trim() === '') return null
    const status = normalizePaymentStatus(record.status) ?? PAYMENT_STATUS.PENDING
    return { ...pickPendingFields(record), paymentId: id, status }
  }

  // ── Actions ────────────────────────────────────────────────────────────────
  async function hydratePending() {
    if (!_adapter) return { ok: false, code: 'NO_ADAPTER' }
    let record = null
    try {
      record = await _adapter.loadPendingSubscriptionPayment()
    } catch {
      // ignore – treated as no pending payment below
    }
    const normalized = normalizePendingRecord(record)
    pending.value = normalized
    if (normalized) {
      // Never assume paid from a cached record.
      setPhaseFromStatus(normalized.status)
    }
    return { ok: true, pending: normalized !== null }
  }

  /**
   * Start a checkout attempt from the server catalog option.
   * `amount`/`priceLabel` are display-only and are never sent to the backend.
   */
  function startAttempt(option) {
    const cloudStore = useCloudSessionStore()
    const businessId = cloudStore.selectedBusiness?.id ?? null

    if (!cloudStore.isAuthenticated || !cloudStore.isLinked || businessId === null) {
      return { ok: false, code: 'NOT_ELIGIBLE' }
    }
    if (!option || option.code !== CANONICAL_PLAN) {
      return { ok: false, code: 'INVALID_OPTION' }
    }
    if (!CHECKOUT_BILLING_PERIODS.includes(option.period) || option.hasPrice !== true) {
      return { ok: false, code: 'INVALID_OPTION' }
    }

    attempt.value = {
      key: createIdempotencyKey(),
      businessId,
      plan: option.code,
      period: option.period,
      currency: option.currency ?? null,
      amount: option.priceMinor ?? null,
      priceLabel: option.priceLabel ?? null,
    }
    phase.value = CHECKOUT_PHASE.IDLE
    error.value = null
    errorCode.value = null
    activationPending.value = false
    return { ok: true, attempt: attempt.value }
  }

  async function setPendingFromPayment(paymentLike) {
    pending.value = {
      paymentId: paymentLike.id,
      businessId: attempt.value?.businessId ?? null,
      plan: attempt.value?.plan ?? null,
      billingPeriod: attempt.value?.period ?? null,
      currency: attempt.value?.currency ?? null,
      amount: paymentLike.amount ?? attempt.value?.amount ?? null,
      status: paymentLike.status ?? PAYMENT_STATUS.PENDING,
      redirectUrl: paymentLike.redirectUrl ?? null,
      idempotencyKey: attempt.value?.key ?? null,
      createdAt: new Date().toISOString(),
      expiresAt: null,
      checkedAt: new Date().toISOString(),
    }
    await persistPending()
  }

  async function updatePendingFromPayment(paymentLike) {
    if (!pending.value) return
    pending.value = {
      ...pending.value,
      paymentId: paymentLike.id ?? pending.value.paymentId,
      status: paymentLike.status ?? pending.value.status,
      checkedAt: new Date().toISOString(),
    }
    await persistPending()
  }

  /**
   * Create the checkout. Double taps are blocked while a request is in flight,
   * and the stable idempotency key makes a retry of the same attempt a no-op.
   */
  async function createCheckout() {
    if (phase.value === CHECKOUT_PHASE.CREATING) {
      return { ok: false, code: 'IN_FLIGHT' }
    }
    if (!attempt.value) {
      return { ok: false, code: 'NO_ATTEMPT' }
    }

    const cloudStore = useCloudSessionStore()
    if (!cloudStore.isAuthenticated) return { ok: false, code: 'NOT_AUTHENTICATED' }
    if (!cloudStore.isLinked) return { ok: false, code: 'NO_BUSINESS' }

    // Reserve the attempt synchronously so a double tap cannot start two requests.
    phase.value = CHECKOUT_PHASE.CREATING
    error.value = null
    errorCode.value = null

    const token = await safeToken()
    if (!token) {
      phase.value = CHECKOUT_PHASE.ERROR
      errorCode.value = CHECKOUT_ERROR_CODE.UNAUTHENTICATED
      error.value = messageForCode(CHECKOUT_ERROR_CODE.UNAUTHENTICATED)
      return { ok: false, code: 'NOT_AUTHENTICATED' }
    }

    const result = await createSubscriptionCheckout({
      token,
      businessId: attempt.value.businessId,
      plan: attempt.value.plan,
      billingPeriod: attempt.value.period,
      idempotencyKey: attempt.value.key,
    })

    if (!result.ok) {
      if (result.code === CHECKOUT_ERROR_CODE.UNAUTHENTICATED) {
        stopPolling('unauthenticated')
        await cloudStore.invalidateCloudSession()
      }
      errorCode.value = result.code
      error.value = messageForCode(result.code)
      phase.value = CHECKOUT_PHASE.ERROR
      return { ok: false, code: result.code }
    }

    payment.value = { ...result.payment }
    activationPending.value = false
    setPhaseFromStatus(result.payment.status)
    await setPendingFromPayment(result.payment)

    return { ok: true, payment: result.payment }
  }

  async function launchPayment() {
    const url = payment.value?.redirectUrl ?? pending.value?.redirectUrl ?? null
    const result = await openCheckoutUrl(url)

    if (!result.ok) {
      // Opening the payment page failed. Never change the payment state and never
      // create a new checkout — the pending payment stays recoverable.
      errorCode.value = result.code
      error.value = launchMessageForCode(result.code)
      return result
    }

    error.value = null
    errorCode.value = null
    return result
  }

  /**
   * Refresh the payment status from the backend. The backend is the only
   * authority: returning from the payment page never marks a payment paid.
   */
  async function refreshStatus() {
    const paymentId = payment.value?.id ?? pending.value?.paymentId ?? null
    if (paymentId === null) return { ok: false, code: 'NO_PAYMENT' }

    const cloudStore = useCloudSessionStore()
    if (!cloudStore.isAuthenticated) return { ok: false, code: 'NOT_AUTHENTICATED' }

    const token = await safeToken()
    if (!token) return { ok: false, code: 'NOT_AUTHENTICATED' }

    const result = await fetchSubscriptionPayment({ token, paymentId })
    lastCheckedAt.value = new Date().toISOString()

    if (!result.ok) {
      if (result.code === CHECKOUT_ERROR_CODE.UNAUTHENTICATED) {
        stopPolling('unauthenticated')
        await cloudStore.invalidateCloudSession()
      }
      errorCode.value = result.code
      error.value = messageForCode(result.code)
      return { ok: false, code: result.code }
    }

    payment.value = result.payment
    error.value = null
    errorCode.value = null
    setPhaseFromStatus(result.payment.status)
    await updatePendingFromPayment(result.payment)

    if (result.payment.status === PAYMENT_STATUS.PAID) {
      const subscriptionStore = useSubscriptionStore()
      if (!subscriptionStore.hasCloudAccess) {
        await completeActivation()
      }
    }

    if (isTerminalPaymentStatus(result.payment.status)) {
      stopPolling('terminal')
    }

    return { ok: true, payment: result.payment }
  }

  /**
   * After a paid payment, re-read the authoritative context (bounded). Premium is
   * only shown once the server context confirms cloud access — never set locally.
   */
  async function completeActivation() {
    activationPending.value = true
    const cloudStore = useCloudSessionStore()
    const subscriptionStore = useSubscriptionStore()

    for (let i = 0; i < ACTIVATION_MAX_ATTEMPTS; i += 1) {
      const result = await cloudStore.refreshContext()
      if (result?.code === 'TOKEN_INVALID') {
        activationPending.value = false
        return { ok: false, code: 'TOKEN_INVALID' }
      }
      if (result?.ok && subscriptionStore.hasCloudAccess) {
        activationPending.value = false
        return { ok: true }
      }
    }

    return { ok: false, code: 'ACTIVATION_PENDING' }
  }

  function startPolling({
    intervalMs = DEFAULT_POLL_INTERVAL_MS,
    maxAttempts = DEFAULT_POLL_MAX_ATTEMPTS,
  } = {}) {
    stopPolling('restart')

    if (isTerminalPaymentStatus(status.value)) {
      return { ok: false, code: 'TERMINAL' }
    }
    if (!isOnline()) {
      pollingStoppedReason.value = 'offline'
      return { ok: false, code: 'OFFLINE' }
    }

    polling.value = true
    pollingAttempts.value = 0
    _pollMax = maxAttempts

    _pollTimer = setInterval(async () => {
      if (!polling.value) return
      if (!isOnline()) {
        stopPolling('offline')
        return
      }
      if (!isForeground()) {
        stopPolling('background')
        return
      }

      pollingAttempts.value += 1
      await refreshStatus()

      if (isTerminalPaymentStatus(status.value)) {
        stopPolling('terminal')
        return
      }
      if (pollingAttempts.value >= _pollMax) {
        stopPolling('exhausted')
      }
    }, intervalMs)

    return { ok: true }
  }

  function stopPolling(reason = 'stopped') {
    if (_pollTimer) {
      clearInterval(_pollTimer)
      _pollTimer = null
    }
    const wasPolling = polling.value
    polling.value = false
    pollingStoppedReason.value = reason
    return { ok: true, wasPolling, reason }
  }

  async function clearPending() {
    pending.value = null
    await persistPending()
  }

  /** A fresh attempt after a terminal/cancelled payment or a reset. */
  function resetAttempt() {
    stopPolling('reset')
    attempt.value = null
    payment.value = null
    phase.value = CHECKOUT_PHASE.IDLE
    error.value = null
    errorCode.value = null
    activationPending.value = false
  }

  async function reset() {
    resetAttempt()
    await clearPending()
  }

  return {
    // state
    phase,
    attempt,
    payment,
    pending,
    error,
    errorCode,
    polling,
    pollingAttempts,
    pollingStoppedReason,
    lastCheckedAt,
    activationPending,
    // computed
    status,
    statusLabel,
    statusTone,
    isTerminal,
    isCreating,
    isPaid,
    hasPending,
    activationInProgress,
    canResumePayment,
    // actions
    setPersistenceAdapter,
    init,
    hydratePending,
    startAttempt,
    createCheckout,
    launchPayment,
    refreshStatus,
    completeActivation,
    startPolling,
    stopPolling,
    clearPending,
    resetAttempt,
    reset,
  }
})
