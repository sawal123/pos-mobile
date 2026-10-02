import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createAppRouter } from '@/router'
import { apiRequest } from '@/services/cloud/apiClient'
import { _resetTokenStore, saveToken } from '@/services/cloud/tokenRepository'
import { openCheckoutUrl } from '@/services/premium/checkoutLauncher'
import { PAYMENT_STATUS } from '@/services/premium/paymentStatus'
import { listSubscriptionPayments } from '@/services/premium/subscriptionCheckoutService'
import {
  EXPIRING_SOON_THRESHOLD_DAYS,
  REMAINING_TIME_STATE,
  isExpiringSoon,
  remainingTimeUntil,
} from '@/services/subscription/subscriptionPresentation'
import { createMemoryAdapter } from '@/services/database/memoryAdapter'
import { useBusinessStore } from '@/stores/businessStore'
import { useCashStore } from '@/stores/cashStore'
import { useCashierStore } from '@/stores/cashierStore'
import { useCloudSessionStore } from '@/stores/cloudSessionStore'
import { useCustomerStore } from '@/stores/customerStore'
import { usePremiumCheckoutStore } from '@/stores/premiumCheckoutStore'
import { useProductStore } from '@/stores/productStore'
import { useSubscriptionPlanStore } from '@/stores/subscriptionPlanStore'
import { useTransactionStore } from '@/stores/transactionStore'
import MySubscriptionView from '@/views/subscription/MySubscriptionView.vue'
import SettingsView from '@/views/settings/SettingsView.vue'

vi.mock('@/services/cloud/apiClient', () => ({
  apiRequest: vi.fn(),
}))

vi.mock('@/services/premium/checkoutLauncher', () => ({
  openCheckoutUrl: vi.fn(),
}))

const TOKEN = 'prem-m05-token'
const BUSINESS_ID = 10
const NOW = Date.parse('2030-01-10T00:00:00.000Z')
const STARTS_AT = '2030-01-01T00:00:00.000Z'
const EXPIRES_AT = '2030-02-01T00:00:00.000Z'
const SOON_EXPIRES_AT = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString()
const PAST_EXPIRES_AT = '2030-01-01T00:00:00.000Z'

const apiOk = (payload) => ({ ok: true, status: 200, data: { data: payload }, error: null })
const apiErr = (status, code) => ({
  ok: false,
  status,
  data: null,
  error: { status, code, message: code, data: null },
})

function payment(overrides = {}) {
  return {
    id: overrides.id ?? 77,
    plan: 'cloud',
    billing_period: 'monthly',
    currency: 'IDR',
    amount: 49000,
    status: 'paid',
    paid_at: '2030-01-02T03:00:00.000Z',
    subscription: {
      plan: 'cloud',
      status: 'active',
      starts_at: STARTS_AT,
      expires_at: EXPIRES_AT,
    },
    ...overrides,
  }
}

function prepareContext({
  subscription = { plan: 'free' },
  capabilityState = 'verified',
  cloudAccess = false,
  linked = true,
} = {}) {
  const pinia = createPinia()
  setActivePinia(pinia)

  const businessStore = useBusinessStore(pinia)
  businessStore.setBusiness({ name: 'Toko Lokal', type: 'Retail', outlet: 'Utama' })
  useCashierStore(pinia).setPinConfigured(true)

  const cloudStore = useCloudSessionStore(pinia)
  cloudStore.contextCheckedAt = '2030-01-10T08:00:00.000Z'
  if (linked) {
    cloudStore.user = { id: 1, name: 'Uji', email: 'uji@example.com' }
    cloudStore.selectedBusiness = { id: BUSINESS_ID, name: 'Toko Cloud', subscription }
    cloudStore.businesses = [{ id: BUSINESS_ID, name: 'Toko Cloud', subscription, outlets: [] }]
    cloudStore.cloudAccess = cloudAccess
    cloudStore.capabilityState = capabilityState
  }

  return {
    pinia,
    router: createAppRouter(),
    cloudStore,
    checkoutStore: usePremiumCheckoutStore(pinia),
    planStore: useSubscriptionPlanStore(pinia),
  }
}

async function mountMySubscription(context) {
  await saveToken(TOKEN)
  await context.router.push('/subscription/my')
  await flushPromises()
  const wrapper = mount(MySubscriptionView, {
    global: { plugins: [context.pinia, context.router] },
  })
  await flushPromises()
  return wrapper
}

function seedLocalData(pinia) {
  const productStore = useProductStore(pinia)
  productStore.createProduct({
    name: 'Kopi',
    category: productStore.categories[0],
    price: 10000,
    stock: 3,
  })
  useCustomerStore(pinia).createCustomer({ name: 'Budi', phone: '0812' })
  useTransactionStore(pinia).addTransaction({ id: 'trx-1', total: 10000 })
  useCashStore(pinia).recordEntry({ type: 'in', amount: 10000 })
}

function snapshotLocalData(pinia) {
  return JSON.stringify({
    products: useProductStore(pinia).products,
    customers: useCustomerStore(pinia).customers,
    transactions: useTransactionStore(pinia).items,
    cash: useCashStore(pinia).entries,
  })
}

beforeEach(() => {
  setActivePinia(createPinia())
  _resetTokenStore()
  vi.resetAllMocks()
  apiRequest.mockResolvedValue(apiOk([]))
  openCheckoutUrl.mockResolvedValue({ ok: true, mode: 'window-open' })
})

describe('subscription date presentation', () => {
  it('calculates remaining time only as a presentational value', () => {
    expect(remainingTimeUntil('2030-01-11T00:00:00.000Z', { now: NOW }).label).toBe('1 hari lagi')
    expect(remainingTimeUntil('2030-01-10T00:00:00.000Z', { now: NOW }).label).toBe('Hari ini')
    expect(remainingTimeUntil('2030-01-08T23:59:59.000Z', { now: NOW }).state).toBe(
      REMAINING_TIME_STATE.PAST,
    )
    expect(remainingTimeUntil(null, { now: NOW }).label).toBe('Tanpa batas waktu')
    expect(remainingTimeUntil('not-a-date', { now: NOW }).state).toBe(REMAINING_TIME_STATE.INVALID)
  })

  it('flags expiring soon only for a future date inside the threshold', () => {
    expect(EXPIRING_SOON_THRESHOLD_DAYS).toBe(7)
    expect(isExpiringSoon('2030-01-17T00:00:00.000Z', { now: NOW })).toBe(true)
    expect(isExpiringSoon('2030-01-18T00:00:01.000Z', { now: NOW })).toBe(false)
    expect(isExpiringSoon(PAST_EXPIRES_AT, { now: NOW })).toBe(false)
  })
})

describe('Settings entry point', () => {
  it('opens Langganan Saya for a linked Cloud account', async () => {
    const context = prepareContext()
    const wrapper = mount(SettingsView, { global: { plugins: [context.pinia, context.router] } })
    await flushPromises()

    await wrapper.find('[data-testid="settings-my-subscription-entry"]').trigger('click')
    await flushPromises()

    expect(context.router.currentRoute.value.name).toBe('my-subscription')
  })

  it('keeps the Premium plan route for an unlinked account', async () => {
    const context = prepareContext({ linked: false })
    const wrapper = mount(SettingsView, { global: { plugins: [context.pinia, context.router] } })
    await flushPromises()

    await wrapper.find('[data-testid="subscription-card"]').trigger('click')
    await flushPromises()

    expect(context.router.currentRoute.value.name).toBe('subscription')
  })
})

describe('MySubscriptionView subscription states', () => {
  it('renders a linked Free state and upgrade CTA', async () => {
    const context = prepareContext({ subscription: { plan: 'free' } })
    const wrapper = await mountMySubscription(context)

    expect(wrapper.find('[data-testid="my-subscription-status"]').text()).toBe('Free')
    expect(wrapper.find('[data-testid="my-subscription-plan"]').text()).toBe('Free')
    expect(wrapper.find('[data-testid="free-state-copy"]').text()).toContain('Fitur lokal')
    expect(wrapper.find('[data-testid="renewal-cta"]').text()).toBe('Upgrade ke Premium')
  })

  it('renders active Cloud using starts_at and expires_at from the server', async () => {
    const context = prepareContext({
      subscription: {
        plan: 'cloud',
        status: 'active',
        starts_at: STARTS_AT,
        expires_at: EXPIRES_AT,
      },
      cloudAccess: true,
    })
    const wrapper = await mountMySubscription(context)

    expect(wrapper.find('[data-testid="my-subscription-status"]').text()).toBe('Aktif')
    expect(wrapper.find('[data-testid="my-subscription-plan"]').text()).toBe('Cloud')
    expect(wrapper.find('[data-testid="my-subscription-starts-at"]').text()).toContain('2030')
    expect(wrapper.find('[data-testid="my-subscription-expires-at"]').text()).toContain('2030')
    expect(wrapper.find('[data-testid="my-subscription-business"]').text()).toBe('Toko Cloud')
    expect(wrapper.find('[data-testid="my-subscription-checked-at"]').text()).toContain('2030')
  })

  it('shows expiring soon without changing the active status', async () => {
    const context = prepareContext({
      subscription: {
        plan: 'cloud',
        status: 'active',
        starts_at: STARTS_AT,
        expires_at: SOON_EXPIRES_AT,
      },
      cloudAccess: true,
    })
    const wrapper = await mountMySubscription(context)

    expect(wrapper.find('[data-testid="my-subscription-status"]').text()).toBe('Aktif')
    expect(wrapper.find('[data-testid="expiring-soon-note"]').text()).toContain('Akan berakhir')
  })

  it('renders expired and null expiry safely', async () => {
    const expired = prepareContext({
      subscription: { plan: 'cloud', status: 'expired', expires_at: PAST_EXPIRES_AT },
    })
    const expiredWrapper = await mountMySubscription(expired)
    expect(expiredWrapper.find('[data-testid="my-subscription-status"]').text()).toBe('Kedaluwarsa')

    const noExpiry = prepareContext({
      subscription: { plan: 'cloud', status: 'active', starts_at: STARTS_AT, expires_at: null },
      cloudAccess: true,
    })
    const noExpiryWrapper = await mountMySubscription(noExpiry)
    expect(noExpiryWrapper.find('[data-testid="my-subscription-remaining"]').text()).toBe(
      'Tanpa batas waktu',
    )
  })
})

describe('MySubscriptionView payment panels', () => {
  it('shows a pending payment and does not create checkout automatically', async () => {
    const context = prepareContext({ subscription: { plan: 'free' } })
    const adapter = createMemoryAdapter()
    context.checkoutStore.setPersistenceAdapter(adapter)
    await adapter.savePendingSubscriptionPayment({
      paymentId: 77,
      businessId: BUSINESS_ID,
      plan: 'cloud',
      billingPeriod: 'monthly',
      currency: 'IDR',
      amount: 49000,
      status: PAYMENT_STATUS.PENDING,
      redirectUrl: 'https://pay.example.test/77',
    })

    const wrapper = await mountMySubscription(context)

    expect(wrapper.find('[data-testid="pending-payment-panel"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="pending-payment-period"]').text()).toBe('Bulanan')
    expect(apiRequest.mock.calls.some((call) => call[0].includes('/checkout'))).toBe(false)

    await wrapper.find('[data-testid="continue-pending-payment"]').trigger('click')
    expect(openCheckoutUrl).toHaveBeenCalledWith('https://pay.example.test/77')
  })

  it('shows paid activation pending without granting Premium locally', async () => {
    const context = prepareContext({ subscription: { plan: 'free' } })
    context.checkoutStore.payment = payment({ status: 'paid' })

    const wrapper = await mountMySubscription(context)

    expect(wrapper.find('[data-testid="activation-pending-panel"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="my-subscription-status"]').text()).toBe('Free')
  })

  it('keeps failed/expired/cancelled/refunded payment status separate from subscription status', async () => {
    for (const status of ['failed', 'expired', 'cancelled', 'refunded']) {
      const context = prepareContext({
        subscription: {
          plan: 'cloud',
          status: 'active',
          starts_at: STARTS_AT,
          expires_at: EXPIRES_AT,
        },
        cloudAccess: true,
      })
      apiRequest.mockResolvedValue(apiOk([payment({ id: status, status })]))
      const wrapper = await mountMySubscription(context)

      expect(wrapper.find('[data-testid="terminal-payment-status"]').text()).toBe(
        status === 'expired'
          ? 'Waktu pembayaran habis'
          : status === 'cancelled'
            ? 'Pembayaran dibatalkan'
            : status === 'refunded'
              ? 'Pembayaran dikembalikan'
              : 'Pembayaran gagal',
      )
      expect(wrapper.find('[data-testid="my-subscription-status"]').text()).toBe('Aktif')
    }
  })
})

describe('MySubscriptionView renewal and history', () => {
  it('routes renewal to plan selection with renewal mode enabled', async () => {
    const context = prepareContext({
      subscription: { plan: 'cloud', status: 'active', expires_at: EXPIRES_AT },
      cloudAccess: true,
    })
    const wrapper = await mountMySubscription(context)

    await wrapper.find('[data-testid="renewal-cta"]').trigger('click')
    await flushPromises()

    expect(context.router.currentRoute.value.name).toBe('subscription')
    expect(context.router.currentRoute.value.query.renew).toBe('1')
    expect(context.planStore.renewalMode).toBe(true)
  })

  it('loads payment history only for the linked business and clears on relink', async () => {
    const context = prepareContext()
    apiRequest.mockResolvedValue(apiOk([payment({ id: 1 })]))
    const wrapper = await mountMySubscription(context)

    expect(apiRequest.mock.calls[0][0]).toContain(`business_id=${BUSINESS_ID}`)
    expect(wrapper.find('[data-testid="history-payment-1"]').exists()).toBe(true)

    context.cloudStore.selectedBusiness = {
      id: 20,
      name: 'Toko Lain',
      subscription: { plan: 'free' },
    }
    await flushPromises()

    expect(wrapper.find('[data-testid="history-payment-1"]').exists()).toBe(false)
  })

  it('fails closed on malformed history responses', async () => {
    await saveToken(TOKEN)
    apiRequest.mockResolvedValue(apiOk([{ id: 1, status: 'weird' }]))

    const result = await listSubscriptionPayments({ token: TOKEN, businessId: BUSINESS_ID })

    expect(result.ok).toBe(false)
    expect(result.code).toBe('MALFORMED_RESPONSE')
  })
})

describe('MySubscriptionView refresh, offline and auth failures', () => {
  it('guards duplicate refresh requests', async () => {
    const context = prepareContext()
    const wrapper = await mountMySubscription(context)
    let resolveRefresh
    vi.spyOn(context.cloudStore, 'refreshContext').mockReturnValue(
      new Promise((resolve) => {
        resolveRefresh = resolve
      }),
    )

    const first = wrapper.vm.refreshAll()
    const second = wrapper.vm.refreshAll()
    expect(await second).toMatchObject({ code: 'IN_FLIGHT' })

    resolveRefresh({ ok: true })
    await first
  })

  it('does not start checkout while offline', async () => {
    const descriptor = Object.getOwnPropertyDescriptor(window.navigator, 'onLine')
    Object.defineProperty(window.navigator, 'onLine', { value: false, configurable: true })
    const context = prepareContext()
    const wrapper = await mountMySubscription(context)

    await wrapper.find('[data-testid="renewal-cta"]').trigger('click')

    expect(context.router.currentRoute.value.name).toBe('my-subscription')
    expect(wrapper.find('[data-testid="subscription-action-notice"]').text()).toContain(
      'Koneksi internet',
    )
    expect(apiRequest.mock.calls.some((call) => call[0].includes('/checkout'))).toBe(false)

    if (descriptor) Object.defineProperty(window.navigator, 'onLine', descriptor)
  })

  it('uses M03 behavior for 401 and fail-closes 403 history', async () => {
    const unauthorized = prepareContext()
    apiRequest.mockResolvedValue(apiErr(401, 'HTTP_401'))
    const unauthorizedWrapper = await mountMySubscription(unauthorized)

    expect(unauthorized.cloudStore.sessionInvalid).toBe(true)
    expect(unauthorizedWrapper.find('[data-testid="session-invalid"]').exists()).toBe(true)

    const forbidden = prepareContext()
    apiRequest.mockResolvedValue(apiErr(403, 'BUSINESS_ACCESS_DENIED'))
    const forbiddenWrapper = await mountMySubscription(forbidden)
    expect(forbiddenWrapper.find('[data-testid="history-error"]').text()).toContain('ditolak')
  })

  it('shows revoked membership and keeps local POS data untouched', async () => {
    const context = prepareContext({
      subscription: { plan: 'cloud', status: 'active', expires_at: EXPIRES_AT },
      capabilityState: 'revoked',
    })
    seedLocalData(context.pinia)
    const before = snapshotLocalData(context.pinia)

    const wrapper = await mountMySubscription(context)

    expect(wrapper.find('[data-testid="membership-revoked"]').exists()).toBe(true)
    expect(snapshotLocalData(context.pinia)).toBe(before)
  })
})
