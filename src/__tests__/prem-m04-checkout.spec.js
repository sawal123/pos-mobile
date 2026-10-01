/**
 * PREM-M04 — Premium checkout, payment status & authoritative activation.
 *
 * Verifies the mobile side never activates Premium itself: checkout is created
 * server-side, the client only sends business_id/plan/billing_period/idempotency,
 * payment status comes from the backend, and Premium appears only after the
 * authoritative /api/mobile/context reports cloud access.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { mount, flushPromises } from '@vue/test-utils'

import { apiRequest } from '../services/cloud/apiClient'
import { saveToken, getToken, _resetTokenStore } from '../services/cloud/tokenRepository'
import {
  CHECKOUT_ERROR_CODE,
  createSubscriptionCheckout,
  fetchSubscriptionPayment,
} from '../services/premium/subscriptionCheckoutService'
import { openCheckoutUrl } from '../services/premium/checkoutLauncher'
import {
  PAYMENT_STATUS,
  isTerminalPaymentStatus,
  paymentStatusLabel,
} from '../services/premium/paymentStatus'
import { useBusinessStore } from '../stores/businessStore'
import { useCloudSessionStore } from '../stores/cloudSessionStore'
import { useCustomerStore } from '../stores/customerStore'
import { usePremiumCheckoutStore } from '../stores/premiumCheckoutStore'
import { useProductStore } from '../stores/productStore'
import { useSubscriptionPlanStore } from '../stores/subscriptionPlanStore'
import { useSubscriptionStore } from '../stores/subscriptionStore'
import { useTransactionStore } from '../stores/transactionStore'
import { useCashStore } from '../stores/cashStore'
import { createMemoryAdapter } from '../services/database/memoryAdapter'
import PremiumCheckoutView from '../views/subscription/PremiumCheckoutView.vue'
import PremiumPaymentStatusView from '../views/subscription/PremiumPaymentStatusView.vue'

vi.mock('../services/cloud/apiClient', () => ({ apiRequest: vi.fn() }))

vi.mock('../services/premium/checkoutLauncher', () => ({
  openCheckoutUrl: vi.fn(),
}))

const BUSINESS_ID = 10
const TOKEN = 'prem-m04-bearer-token'
const FUTURE = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString()

const apiOk = (payload) => ({ ok: true, status: 200, data: { data: payload }, error: null })
const apiErr = (status, code) => ({
  ok: false,
  status,
  data: null,
  error: { status, code, message: code, data: null },
})

function monthlyOption(overrides = {}) {
  return {
    key: 'cloud::monthly',
    code: 'cloud',
    name: 'Cloud',
    period: 'monthly',
    periodLabel: 'Bulanan',
    currency: 'IDR',
    priceMinor: 49000,
    priceLabel: 'Rp 49.000',
    hasPrice: true,
    available: true,
    purchasable: true,
    ...overrides,
  }
}

function yearlyOption(overrides = {}) {
  return {
    ...monthlyOption(),
    key: 'cloud::yearly',
    period: 'yearly',
    periodLabel: 'Tahunan',
    priceMinor: 490000,
    priceLabel: 'Rp 490.000',
    ...overrides,
  }
}

const CHECKOUT_PAYLOAD = {
  payment_id: 55,
  status: 'pending',
  provider: 'midtrans',
  snap_token: 'snap-token-xyz',
  redirect_url: 'https://app.sandbox.midtrans.com/snap/v2/vtweb/xyz',
}

function paymentPayload(overrides = {}) {
  return {
    id: 55,
    plan: 'cloud',
    billing_period: 'monthly',
    currency: 'IDR',
    amount: 49000,
    status: 'pending',
    paid_at: null,
    subscription: null,
    ...overrides,
  }
}

beforeEach(() => {
  setActivePinia(createPinia())
  _resetTokenStore()
  vi.resetAllMocks()
  openCheckoutUrl.mockResolvedValue({ ok: true, mode: 'window-open' })
})

function setupEnv({ linked = true, option = monthlyOption() } = {}) {
  const pinia = createPinia()
  setActivePinia(pinia)

  const cloudStore = useCloudSessionStore(pinia)
  const planStore = useSubscriptionPlanStore(pinia)
  const subscriptionStore = useSubscriptionStore(pinia)
  const checkoutStore = usePremiumCheckoutStore(pinia)

  cloudStore.user = { id: 1, name: 'Uji', email: 'uji@example.com' }
  cloudStore.selectedBusiness = linked
    ? { id: BUSINESS_ID, name: 'Toko Cloud', subscription: null }
    : null
  cloudStore.businesses = linked
    ? [{ id: BUSINESS_ID, name: 'Toko Cloud', subscription: null, outlets: [] }]
    : []
  cloudStore.cloudAccess = false
  cloudStore.capabilityState = 'verified'

  planStore.options = [option, yearlyOption()]
  planStore.periods = ['monthly', 'yearly']
  planStore.checkoutAvailable = true
  planStore.supportsBothPeriods = true
  planStore.state = 'ready'
  planStore.selectedOptionKey = option.key

  const adapter = createMemoryAdapter()
  checkoutStore.setPersistenceAdapter(adapter)

  return { pinia, cloudStore, planStore, subscriptionStore, checkoutStore, adapter }
}

function seedLocalData(pinia) {
  const businessStore = useBusinessStore(pinia)
  const productStore = useProductStore(pinia)
  const customerStore = useCustomerStore(pinia)
  const transactionStore = useTransactionStore(pinia)
  const cashStore = useCashStore(pinia)

  businessStore.setBusiness({ name: 'Toko Lokal', type: 'Retail' })
  productStore.createProduct({
    name: 'Kopi',
    category: productStore.categories[0],
    price: 15000,
    stock: 5,
  })
  customerStore.createCustomer({ name: 'Budi', phone: '0812' })
  transactionStore.addTransaction({ id: 'trx-1', total: 15000 })
  cashStore.recordEntry({ type: 'in', amount: 15000 })
}

function snapshotLocal(pinia) {
  return JSON.stringify({
    business: useBusinessStore(pinia).name,
    products: useProductStore(pinia).products,
    customers: useCustomerStore(pinia).customers,
    transactions: useTransactionStore(pinia).items,
    cash: useCashStore(pinia).entries,
  })
}

afterEach(() => {
  vi.restoreAllMocks()
})

// ════════════════════════════════════════════════════════════════════════════
// 1. Service — server-authoritative request & fail-closed parsing
// ════════════════════════════════════════════════════════════════════════════

describe('subscriptionCheckoutService', () => {
  it('sends only business_id/plan/billing_period/idempotency_key (no price fields)', async () => {
    apiRequest.mockResolvedValueOnce(apiOk(CHECKOUT_PAYLOAD))

    await createSubscriptionCheckout({
      token: TOKEN,
      businessId: BUSINESS_ID,
      plan: 'cloud',
      billingPeriod: 'monthly',
      idempotencyKey: 'key-1',
    })

    const [path, options] = apiRequest.mock.calls[0]
    expect(path).toBe('/api/mobile/subscription/checkout')
    expect(options.method).toBe('POST')
    expect(Object.keys(options.body).sort()).toEqual(
      ['billing_period', 'business_id', 'idempotency_key', 'plan'].sort(),
    )
    expect(options.body).not.toHaveProperty('amount')
    expect(options.body).not.toHaveProperty('currency')
    expect(options.body).not.toHaveProperty('price_minor')
  })

  it('maps CHECKOUT_UNAVAILABLE and does not synthesise a payment', async () => {
    apiRequest.mockResolvedValueOnce(apiErr(409, 'CHECKOUT_UNAVAILABLE'))
    const res = await createSubscriptionCheckout({
      token: TOKEN,
      businessId: BUSINESS_ID,
      plan: 'cloud',
      billingPeriod: 'monthly',
    })
    expect(res.ok).toBe(false)
    expect(res.code).toBe(CHECKOUT_ERROR_CODE.CHECKOUT_UNAVAILABLE)
    expect(res.payment).toBeUndefined()
  })

  it('fails closed on a malformed checkout response', async () => {
    apiRequest.mockResolvedValueOnce(apiOk({ status: 'pending' })) // no payment_id
    const res = await createSubscriptionCheckout({
      token: TOKEN,
      businessId: BUSINESS_ID,
      plan: 'cloud',
      billingPeriod: 'monthly',
    })
    expect(res.ok).toBe(false)
    expect(res.code).toBe(CHECKOUT_ERROR_CODE.MALFORMED_RESPONSE)
  })

  it('fails closed on a malformed payment response', async () => {
    apiRequest.mockResolvedValueOnce(apiOk({ id: 55, status: 'weird' }))
    const res = await fetchSubscriptionPayment({ token: TOKEN, paymentId: 55 })
    expect(res.ok).toBe(false)
    expect(res.code).toBe(CHECKOUT_ERROR_CODE.MALFORMED_RESPONSE)
  })

  it('maps a 401 to UNAUTHENTICATED', async () => {
    apiRequest.mockResolvedValueOnce(apiErr(401, 'HTTP_401'))
    const res = await fetchSubscriptionPayment({ token: TOKEN, paymentId: 55 })
    expect(res.ok).toBe(false)
    expect(res.code).toBe(CHECKOUT_ERROR_CODE.UNAUTHENTICATED)
  })
})

describe('paymentStatus', () => {
  it('labels every backend status and detects terminal states', () => {
    expect(paymentStatusLabel(PAYMENT_STATUS.PENDING)).toBe('Menunggu pembayaran')
    expect(paymentStatusLabel(PAYMENT_STATUS.PAID)).toBe('Pembayaran berhasil')
    expect(paymentStatusLabel(PAYMENT_STATUS.FAILED)).toBe('Pembayaran gagal')
    expect(paymentStatusLabel(PAYMENT_STATUS.EXPIRED)).toBe('Waktu pembayaran habis')
    expect(paymentStatusLabel(PAYMENT_STATUS.CANCELLED)).toBe('Pembayaran dibatalkan')
    expect(paymentStatusLabel(PAYMENT_STATUS.REFUNDED)).toBe('Pembayaran dikembalikan')

    expect(isTerminalPaymentStatus(PAYMENT_STATUS.PENDING)).toBe(false)
    expect(isTerminalPaymentStatus(PAYMENT_STATUS.PAID)).toBe(true)
  })
})

// ════════════════════════════════════════════════════════════════════════════
// 2. Eligibility & attempt
// ════════════════════════════════════════════════════════════════════════════

describe('checkout eligibility', () => {
  it('requires Cloud authentication (1)', async () => {
    const { cloudStore, checkoutStore } = setupEnv()
    cloudStore.user = null
    const res = checkoutStore.startAttempt(monthlyOption())
    expect(res.ok).toBe(false)
    await expect(checkoutStore.refreshStatus()).resolves.toMatchObject({ ok: false })
  })

  it('requires a linked business (2, 35)', () => {
    const { checkoutStore } = setupEnv({ linked: false })
    expect(checkoutStore.startAttempt(monthlyOption()).ok).toBe(false)
  })

  it('accepts a plan only from the server catalog (3) and both periods (4, 5)', () => {
    const { checkoutStore } = setupEnv()

    expect(checkoutStore.startAttempt(monthlyOption({ code: 'pro' })).code).toBe('INVALID_OPTION')

    expect(checkoutStore.startAttempt(monthlyOption()).ok).toBe(true)
    expect(checkoutStore.attempt.period).toBe('monthly')

    expect(checkoutStore.startAttempt(yearlyOption()).ok).toBe(true)
    expect(checkoutStore.attempt.period).toBe('yearly')
  })

  it('takes the displayed price from the server option (6)', () => {
    const { checkoutStore } = setupEnv({ option: yearlyOption() })
    checkoutStore.startAttempt(yearlyOption())
    expect(checkoutStore.attempt.amount).toBe(490000)
    expect(checkoutStore.attempt.priceLabel).toBe('Rp 490.000')
  })
})

// ════════════════════════════════════════════════════════════════════════════
// 3. Checkout creation, idempotency, business binding
// ════════════════════════════════════════════════════════════════════════════

describe('createCheckout', () => {
  it('binds the linked business_id and never sends price fields (7–10)', async () => {
    await saveToken(TOKEN)
    const { checkoutStore } = setupEnv()
    checkoutStore.startAttempt(monthlyOption())

    apiRequest.mockResolvedValueOnce(apiOk(CHECKOUT_PAYLOAD))
    const res = await checkoutStore.createCheckout()

    expect(res.ok).toBe(true)
    const [, options] = apiRequest.mock.calls[0]
    expect(options.body.business_id).toBe(BUSINESS_ID)
    expect(options.body).not.toHaveProperty('amount')
    expect(options.body).not.toHaveProperty('currency')
    expect(options.body).not.toHaveProperty('price_minor')
  })

  it('blocks a double tap and creates a single checkout (11)', async () => {
    await saveToken(TOKEN)
    const { checkoutStore } = setupEnv()
    checkoutStore.startAttempt(monthlyOption())

    apiRequest.mockResolvedValueOnce(apiOk(CHECKOUT_PAYLOAD))
    const [a, b] = await Promise.all([
      checkoutStore.createCheckout(),
      checkoutStore.createCheckout(),
    ])

    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1)
    expect([a.code, b.code]).toContain('IN_FLIGHT')
    expect(apiRequest.mock.calls).toHaveLength(1)
  })

  it('reuses the same idempotency key when retrying an attempt (12)', async () => {
    await saveToken(TOKEN)
    const { checkoutStore } = setupEnv()
    checkoutStore.startAttempt(monthlyOption())
    const key = checkoutStore.attempt.key

    apiRequest.mockResolvedValueOnce(apiErr(0, 'NETWORK_ERROR'))
    await checkoutStore.createCheckout()

    apiRequest.mockResolvedValueOnce(apiOk(CHECKOUT_PAYLOAD))
    await checkoutStore.createCheckout()

    expect(apiRequest.mock.calls[0][1].body.idempotency_key).toBe(key)
    expect(apiRequest.mock.calls[1][1].body.idempotency_key).toBe(key)
  })

  it('fails closed when the catalog says checkout is unavailable (13, 14)', async () => {
    await saveToken(TOKEN)
    const { checkoutStore } = setupEnv()
    checkoutStore.startAttempt(monthlyOption())

    apiRequest.mockResolvedValueOnce(apiErr(409, 'CHECKOUT_UNAVAILABLE'))
    const res = await checkoutStore.createCheckout()

    expect(res.ok).toBe(false)
    expect(checkoutStore.errorCode).toBe(CHECKOUT_ERROR_CODE.CHECKOUT_UNAVAILABLE)
    expect(checkoutStore.error).toContain('belum tersedia')
    expect(checkoutStore.payment).toBeNull()
  })

  it('persists the checkout safely (no token, no provider payload) (15)', async () => {
    await saveToken(TOKEN)
    const { checkoutStore, adapter } = setupEnv()
    checkoutStore.startAttempt(monthlyOption())

    apiRequest.mockResolvedValueOnce(apiOk(CHECKOUT_PAYLOAD))
    await checkoutStore.createCheckout()

    const record = await adapter.loadPendingSubscriptionPayment()
    expect(record.paymentId).toBe(55)
    expect(record.redirectUrl).toContain('midtrans')
    const serialized = JSON.stringify(record)
    expect(serialized).not.toContain(TOKEN)
    expect(serialized).not.toContain('provider_payload')
    expect(serialized).not.toContain('snap-token-xyz')
  })

  it('opens the payment handoff (16) and never marks paid from returning (17)', async () => {
    await saveToken(TOKEN)
    const { checkoutStore } = setupEnv()
    checkoutStore.startAttempt(monthlyOption())

    apiRequest.mockResolvedValueOnce(apiOk(CHECKOUT_PAYLOAD))
    await checkoutStore.createCheckout()

    const launch = await checkoutStore.launchPayment()
    expect(launch.ok).toBe(true)
    expect(openCheckoutUrl).toHaveBeenCalledWith(CHECKOUT_PAYLOAD.redirect_url)

    // Returning from the payment page is never authoritative.
    expect(checkoutStore.isPaid).toBe(false)
    expect(checkoutStore.status).toBe(PAYMENT_STATUS.PENDING)
  })
})

// ════════════════════════════════════════════════════════════════════════════
// 4. Backend payment status & polling
// ════════════════════════════════════════════════════════════════════════════

describe('payment status', () => {
  async function withPendingAttempt() {
    await saveToken(TOKEN)
    const env = setupEnv()
    env.checkoutStore.startAttempt(monthlyOption())
    apiRequest.mockResolvedValueOnce(apiOk(CHECKOUT_PAYLOAD))
    await env.checkoutStore.createCheckout()
    return env
  }

  for (const [status, label] of [
    ['pending', 'Menunggu pembayaran'],
    ['paid', 'Pembayaran berhasil'],
    ['failed', 'Pembayaran gagal'],
    ['expired', 'Waktu pembayaran habis'],
    ['cancelled', 'Pembayaran dibatalkan'],
    ['refunded', 'Pembayaran dikembalikan'],
  ]) {
    it(`renders backend status "${status}" (18–23)`, async () => {
      const { checkoutStore } = await withPendingAttempt()
      apiRequest.mockResolvedValueOnce(apiOk(paymentPayload({ status })))
      await checkoutStore.refreshStatus()
      expect(checkoutStore.statusLabel).toBe(label)
    })
  }

  it('stops polling on a terminal status (24)', async () => {
    const { checkoutStore } = await withPendingAttempt()
    checkoutStore.startPolling({ intervalMs: 100000 })
    expect(checkoutStore.polling).toBe(true)

    apiRequest.mockResolvedValueOnce(apiOk(paymentPayload({ status: 'failed' })))
    await checkoutStore.refreshStatus()

    expect(checkoutStore.polling).toBe(false)
    expect(checkoutStore.pollingStoppedReason).toBe('terminal')
  })

  it('stops polling when the status view is destroyed (25)', async () => {
    await saveToken(TOKEN)
    const pinia = createPinia()
    setActivePinia(pinia)
    const cloudStore = useCloudSessionStore(pinia)
    cloudStore.user = { id: 1, name: 'Uji', email: 'uji@example.com' }

    const checkoutStore = usePremiumCheckoutStore(pinia)
    const adapter = createMemoryAdapter()
    checkoutStore.setPersistenceAdapter(adapter)
    await adapter.savePendingSubscriptionPayment({
      paymentId: 55,
      status: 'pending',
      redirectUrl: 'https://x',
    })
    await checkoutStore.hydratePending()

    apiRequest.mockResolvedValue(apiOk(paymentPayload({ status: 'pending' })))

    const wrapper = mount(PremiumPaymentStatusView, { global: { plugins: [pinia] } })
    await flushPromises()
    expect(checkoutStore.polling).toBe(true)

    wrapper.unmount()
    expect(checkoutStore.polling).toBe(false)
    expect(checkoutStore.pollingStoppedReason).toBe('unmounted')
  })

  it('network failure does not mark the payment failed (33)', async () => {
    const { checkoutStore } = await withPendingAttempt()
    apiRequest.mockResolvedValueOnce(apiErr(0, 'NETWORK_ERROR'))
    await checkoutStore.refreshStatus()

    expect(checkoutStore.status).toBe(PAYMENT_STATUS.PENDING)
    expect(checkoutStore.errorCode).toBe(CHECKOUT_ERROR_CODE.NETWORK_ERROR)
    expect(checkoutStore.error).toContain('Koneksi internet')
  })
})

// ════════════════════════════════════════════════════════════════════════════
// 5. Authoritative activation
// ════════════════════════════════════════════════════════════════════════════

describe('authoritative activation', () => {
  async function withPendingAttempt() {
    await saveToken(TOKEN)
    const env = setupEnv()
    env.checkoutStore.startAttempt(monthlyOption())
    apiRequest.mockResolvedValueOnce(apiOk(CHECKOUT_PAYLOAD))
    await env.checkoutStore.createCheckout()
    return env
  }

  it('paid triggers a context refresh (26) but not Premium on its own (27)', async () => {
    const { checkoutStore, cloudStore, subscriptionStore } = await withPendingAttempt()
    const spy = vi.spyOn(cloudStore, 'refreshContext').mockResolvedValue({ ok: true })

    apiRequest.mockResolvedValueOnce(apiOk(paymentPayload({ status: 'paid', paid_at: FUTURE })))
    await checkoutStore.refreshStatus()

    expect(spy).toHaveBeenCalled()
    // Context still free → Premium must not be granted locally.
    expect(subscriptionStore.isPremium).toBe(false)
    expect(checkoutStore.activationInProgress).toBe(true)
  })

  it('shows Premium only after the context is authoritative (28, 29)', async () => {
    const { checkoutStore, cloudStore, subscriptionStore } = await withPendingAttempt()

    vi.spyOn(cloudStore, 'refreshContext').mockImplementation(async () => {
      cloudStore.businesses = [
        {
          id: BUSINESS_ID,
          name: 'Toko Cloud',
          subscription: { plan: 'cloud', status: 'active', expires_at: FUTURE },
          outlets: [],
        },
      ]
      cloudStore.cloudAccess = true
      return { ok: true }
    })

    apiRequest.mockResolvedValueOnce(
      apiOk(
        paymentPayload({
          status: 'paid',
          paid_at: new Date().toISOString(),
          subscription: { plan: 'cloud', status: 'active', starts_at: null, expires_at: FUTURE },
        }),
      ),
    )
    await checkoutStore.refreshStatus()

    expect(subscriptionStore.isPremium).toBe(true)
    expect(subscriptionStore.expiresAt).toBe(FUTURE)
    expect(checkoutStore.activationInProgress).toBe(false)
  })
})

// ════════════════════════════════════════════════════════════════════════════
// 6. Restart recovery & offline
// ════════════════════════════════════════════════════════════════════════════

describe('restart recovery', () => {
  it('restores a pending payment without assuming paid and without a new checkout (30, 31)', async () => {
    await saveToken(TOKEN)
    const { checkoutStore, adapter } = setupEnv()
    checkoutStore.startAttempt(monthlyOption())
    apiRequest.mockResolvedValueOnce(apiOk(CHECKOUT_PAYLOAD))
    await checkoutStore.createCheckout()

    const callsBefore = apiRequest.mock.calls.length

    // Simulate restart
    const pinia = createPinia()
    setActivePinia(pinia)
    const store = usePremiumCheckoutStore(pinia)
    store.setPersistenceAdapter(adapter)
    const res = await store.hydratePending()

    expect(res.pending).toBe(true)
    expect(store.pending.paymentId).toBe(55)
    expect(store.isPaid).toBe(false)
    expect(apiRequest.mock.calls.length).toBe(callsBefore) // no new checkout on restart
  })

  it('keeps an offline pending state safe (32)', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const store = usePremiumCheckoutStore(pinia)
    const adapter = createMemoryAdapter()
    store.setPersistenceAdapter(adapter)
    await adapter.savePendingSubscriptionPayment({
      paymentId: 77,
      businessId: BUSINESS_ID,
      status: 'pending',
      redirectUrl: 'https://x',
    })

    const res = await store.hydratePending()
    expect(res.pending).toBe(true)
    expect(store.status).toBe(PAYMENT_STATUS.PENDING)
    expect(apiRequest.mock.calls).toHaveLength(0)
  })
})

// ════════════════════════════════════════════════════════════════════════════
// 7. Auth / membership failures & local-data safety
// ════════════════════════════════════════════════════════════════════════════

describe('auth failures', () => {
  it('a 401 clears the Cloud session only (34)', async () => {
    await saveToken(TOKEN)
    const { checkoutStore, cloudStore } = setupEnv()
    checkoutStore.startAttempt(monthlyOption())

    apiRequest.mockResolvedValueOnce(apiErr(401, 'HTTP_401'))
    await checkoutStore.createCheckout()

    expect(cloudStore.isAuthenticated).toBe(false)
    expect(cloudStore.sessionInvalid).toBe(true)
    expect(await getToken()).toBeNull()
  })

  it('blocks checkout when the linked membership is revoked (35)', async () => {
    await saveToken(TOKEN)
    const { checkoutStore, cloudStore } = setupEnv()
    cloudStore.selectedBusiness = null // revoked
    expect(checkoutStore.startAttempt(monthlyOption()).ok).toBe(false)
    await expect(checkoutStore.createCheckout()).resolves.toMatchObject({ ok: false })
  })
})

describe('local data safety', () => {
  it('never changes local POS data during checkout (38)', async () => {
    await saveToken(TOKEN)
    const { pinia, checkoutStore } = setupEnv()
    seedLocalData(pinia)
    const before = snapshotLocal(pinia)

    checkoutStore.startAttempt(monthlyOption())
    apiRequest.mockResolvedValueOnce(apiOk(CHECKOUT_PAYLOAD))
    await checkoutStore.createCheckout()

    expect(snapshotLocal(pinia)).toBe(before)
  })

  it('never changes local POS data when a payment fails (39)', async () => {
    await saveToken(TOKEN)
    const { pinia, checkoutStore } = setupEnv()
    seedLocalData(pinia)
    const before = snapshotLocal(pinia)

    checkoutStore.startAttempt(monthlyOption())
    apiRequest.mockResolvedValueOnce(apiErr(409, 'CHECKOUT_UNAVAILABLE'))
    await checkoutStore.createCheckout()

    expect(snapshotLocal(pinia)).toBe(before)
  })
})

// ════════════════════════════════════════════════════════════════════════════
// 8. Views
// ════════════════════════════════════════════════════════════════════════════

describe('PremiumCheckoutView', () => {
  it('renders the server price/period/business summary', async () => {
    await saveToken(TOKEN)
    const { pinia } = setupEnv()

    const wrapper = mount(PremiumCheckoutView, { global: { plugins: [pinia] } })
    await flushPromises()

    expect(wrapper.find('[data-testid="checkout-plan"]').text()).toContain('Cloud')
    expect(wrapper.find('[data-testid="checkout-period"]').text()).toBe('Bulanan')
    expect(wrapper.find('[data-testid="checkout-price"]').text()).toBe('Rp 49.000')
    expect(wrapper.find('[data-testid="checkout-business"]').text()).toBe('Toko Cloud')
    expect(wrapper.find('[data-testid="checkout-pay-cta"]').attributes('disabled')).toBeUndefined()
  })
})

describe('PremiumPaymentStatusView', () => {
  it('shows the success state with the server expiry', async () => {
    await saveToken(TOKEN)
    const { pinia, cloudStore } = setupEnv()

    vi.spyOn(cloudStore, 'refreshContext').mockImplementation(async () => {
      cloudStore.businesses = [
        {
          id: BUSINESS_ID,
          name: 'Toko Cloud',
          subscription: { plan: 'cloud', status: 'active', expires_at: FUTURE },
          outlets: [],
        },
      ]
      cloudStore.cloudAccess = true
      return { ok: true }
    })

    const checkoutStore = usePremiumCheckoutStore(pinia)
    const adapter = createMemoryAdapter()
    checkoutStore.setPersistenceAdapter(adapter)
    await adapter.savePendingSubscriptionPayment({ paymentId: 55, status: 'paid' })
    await checkoutStore.hydratePending()

    apiRequest.mockResolvedValueOnce(
      apiOk(
        paymentPayload({
          status: 'paid',
          paid_at: new Date().toISOString(),
          subscription: { plan: 'cloud', status: 'active', starts_at: null, expires_at: FUTURE },
        }),
      ),
    )

    const wrapper = mount(PremiumPaymentStatusView, { global: { plugins: [pinia] } })
    await flushPromises()

    expect(wrapper.find('[data-testid="payment-success"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="success-expires-at"]').exists()).toBe(true)
  })
})
