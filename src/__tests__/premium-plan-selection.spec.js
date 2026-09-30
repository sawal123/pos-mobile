/**
 * PREM-M02 — Premium plan selection tests.
 *
 * Coverage:
 * - Catalog adapter: period/price/feature normalisation, no invented price,
 *   no network call when the endpoint is not configured, 404 → "unavailable",
 *   empty catalog, network failure.
 * - Store lifecycle: loading / ready / empty / unavailable / error + retry,
 *   period + plan selection rules, continue gating.
 * - View: entitlement states, benefit honesty (cloud backup not yet supported),
 *   local guarantees, catalog states, period toggle, Rupiah price straight from
 *   the API, current-plan protection, inert checkout.
 * - PREM-M01 fail-closed entitlement is preserved (unverified never Premium).
 */

import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { apiRequest } from '@/services/cloud/apiClient'
import { _resetTokenStore, saveToken } from '@/services/cloud/tokenRepository'
import {
  PLAN_CATALOG_PATH_ENV,
  PLAN_CATALOG_REASON,
  PLAN_CATALOG_STATUS,
  fetchPlanCatalog,
  formatPlanPrice,
  normalizePlan,
  normalizePlanCatalog,
  normalizePlanPeriod,
  resolvePlanCatalogPath,
} from '@/services/subscription/planCatalogService'
import {
  BENEFIT_AVAILABILITY,
  LOCAL_GUARANTEES,
  PREMIUM_BENEFITS,
} from '@/services/subscription/premiumBenefits'
import { createAppRouter } from '@/router'
import { useBusinessStore } from '@/stores/businessStore'
import { useCashierStore } from '@/stores/cashierStore'
import { useCloudSessionStore } from '@/stores/cloudSessionStore'
import { useSubscriptionPlanStore } from '@/stores/subscriptionPlanStore'
import { useSubscriptionStore } from '@/stores/subscriptionStore'
import SubscriptionView from '@/views/subscription/SubscriptionView.vue'

vi.mock('@/services/cloud/apiClient', () => ({
  apiRequest: vi.fn(),
}))

const CATALOG_PATH = '/api/mobile/subscription/plans'
const FUTURE = '2030-01-01T00:00:00.000Z'

const MONTHLY_PLAN = {
  code: 'cloud',
  name: 'Cloud Bulanan',
  price: 49000,
  period: 'monthly',
  features: ['Sinkronisasi cloud', 'Dashboard web'],
  terms: 'Perpanjangan otomatis belum tersedia.',
}

const YEARLY_PLAN = {
  code: 'cloud',
  name: 'Cloud Tahunan',
  price: 490000,
  period: 'yearly',
  features: ['Sinkronisasi cloud', 'Dashboard web'],
}

function catalogResponse(plans, { checkoutAvailable = false } = {}) {
  return {
    ok: true,
    status: 200,
    data: { data: { plans, checkout_available: checkoutAvailable } },
    error: null,
  }
}

beforeEach(() => {
  setActivePinia(createPinia())
  apiRequest.mockReset()
  _resetTokenStore()
  vi.stubEnv(PLAN_CATALOG_PATH_ENV, CATALOG_PATH)
})

afterEach(() => {
  vi.unstubAllEnvs()
  _resetTokenStore()
})

// ════════════════════════════════════════════════════════════════════════════
// Adapter — pure normalisation
// ════════════════════════════════════════════════════════════════════════════

describe('plan catalog adapter — normalisation', () => {
  it('resolves the configured path only when one is explicitly provided', () => {
    expect(resolvePlanCatalogPath({})).toBeNull()
    expect(resolvePlanCatalogPath({ VITE_SUBSCRIPTION_PLANS_PATH: '   ' })).toBeNull()
    expect(resolvePlanCatalogPath({ VITE_SUBSCRIPTION_PLANS_PATH: ' /api/x ' })).toBe('/api/x')
  })

  it('normalises billing periods and refuses to guess unknown ones', () => {
    expect(normalizePlanPeriod('monthly')).toBe('monthly')
    expect(normalizePlanPeriod('Bulanan')).toBe('monthly')
    expect(normalizePlanPeriod('ANNUAL')).toBe('yearly')
    expect(normalizePlanPeriod('tahunan')).toBe('yearly')
    expect(normalizePlanPeriod('weekly')).toBeNull()
    expect(normalizePlanPeriod(null)).toBeNull()
  })

  it('formats a price in Rupiah using the API value', () => {
    expect(formatPlanPrice(49000)).toBe('Rp 49.000')
    expect(formatPlanPrice(0)).toBe('Rp 0')
  })

  it('normalises a complete plan entry', () => {
    const plan = normalizePlan({
      code: 'Cloud Pro',
      title: 'Paket Pro',
      amount: '149000',
      interval: 'bulanan',
      benefits: ['Sinkronisasi', { name: 'Dashboard' }, ''],
      notes: 'Tanpa refund.',
    })

    expect(plan).toEqual({
      code: 'cloud_pro',
      name: 'Paket Pro',
      price: 149000,
      priceLabel: 'Rp 149.000',
      currency: 'IDR',
      period: 'monthly',
      periodLabel: 'Bulanan',
      features: ['Sinkronisasi', 'Dashboard'],
      terms: 'Tanpa refund.',
      purchasable: true,
    })
  })

  it('never invents a price: an unparseable price is not purchasable', () => {
    const plan = normalizePlan({ code: 'cloud', name: 'Cloud', price: 'Rp 49.000' })

    expect(plan.price).toBeNull()
    expect(plan.priceLabel).toBeNull()
    expect(plan.purchasable).toBe(false)
  })

  it('rejects a negative price and keeps the plan unpurchasable', () => {
    expect(normalizePlan({ code: 'cloud', price: -1 }).purchasable).toBe(false)
  })

  it('drops entries without a usable plan code', () => {
    expect(normalizePlan({ name: 'Tanpa kode' })).toBeNull()
    expect(normalizePlan(null)).toBeNull()
    expect(normalizePlan('cloud')).toBeNull()
  })

  it('falls back to the code when the API sends no name', () => {
    expect(normalizePlan({ code: 'cloud' }).name).toBe('cloud')
  })

  it('normalises a raw array payload and defaults checkout to unavailable', () => {
    const catalog = normalizePlanCatalog([MONTHLY_PLAN, { name: 'rusak' }])

    expect(catalog.plans).toHaveLength(1)
    expect(catalog.checkoutAvailable).toBe(false)
    expect(catalog.supportsBothPeriods).toBe(false)
  })

  it('unwraps a data envelope and reports both periods only when both exist', () => {
    const catalog = normalizePlanCatalog({
      data: { plans: [MONTHLY_PLAN, YEARLY_PLAN], checkout_available: true },
    })

    expect(catalog.plans.map((plan) => plan.code)).toEqual(['cloud', 'cloud'])
    expect(catalog.supportsBothPeriods).toBe(true)
    expect(catalog.checkoutAvailable).toBe(true)
  })

  it('claims only one period when the catalog offers a single one', () => {
    expect(normalizePlanCatalog({ plans: [MONTHLY_PLAN] }).supportsBothPeriods).toBe(false)
  })
})

// ════════════════════════════════════════════════════════════════════════════
// Adapter — fetch behaviour
// ════════════════════════════════════════════════════════════════════════════

describe('plan catalog adapter — fetch', () => {
  it('never calls the API when no endpoint is configured', async () => {
    vi.stubEnv(PLAN_CATALOG_PATH_ENV, '')

    const result = await fetchPlanCatalog()

    expect(result.status).toBe(PLAN_CATALOG_STATUS.UNAVAILABLE)
    expect(result.reason).toBe(PLAN_CATALOG_REASON.NOT_CONFIGURED)
    expect(result.requested).toBe(false)
    expect(result.plans).toEqual([])
    expect(apiRequest).not.toHaveBeenCalled()
  })

  it('treats a missing route as "not offered yet" instead of a failure', async () => {
    apiRequest.mockResolvedValueOnce({
      ok: false,
      status: 404,
      data: null,
      error: { status: 404, code: 'HTTP_404', message: 'Not Found', data: null },
    })

    const result = await fetchPlanCatalog({ path: CATALOG_PATH, token: 't' })

    expect(result.status).toBe(PLAN_CATALOG_STATUS.UNAVAILABLE)
    expect(result.reason).toBe(PLAN_CATALOG_REASON.ENDPOINT_MISSING)
  })

  it('reports a network failure as an error, keeping no plans', async () => {
    apiRequest.mockResolvedValueOnce({
      ok: false,
      status: 0,
      data: null,
      error: { status: 0, code: 'NETWORK_ERROR', message: 'offline', data: null },
    })

    const result = await fetchPlanCatalog({ path: CATALOG_PATH, token: 't' })

    expect(result.status).toBe(PLAN_CATALOG_STATUS.ERROR)
    expect(result.error.message).toBe('offline')
    expect(result.plans).toEqual([])
  })

  it('reports an empty catalog distinctly from unavailable', async () => {
    apiRequest.mockResolvedValueOnce(catalogResponse([]))

    const result = await fetchPlanCatalog({ path: CATALOG_PATH, token: 't' })

    expect(result.status).toBe(PLAN_CATALOG_STATUS.EMPTY)
    expect(result.plans).toEqual([])
  })

  it('returns ready plans with the checkout capability from the contract', async () => {
    apiRequest.mockResolvedValueOnce(catalogResponse([MONTHLY_PLAN], { checkoutAvailable: true }))

    const result = await fetchPlanCatalog({ path: CATALOG_PATH, token: 't' })

    expect(result.status).toBe(PLAN_CATALOG_STATUS.READY)
    expect(result.checkoutAvailable).toBe(true)
    expect(result.plans[0].priceLabel).toBe('Rp 49.000')
  })

  it('survives a thrown transport error', async () => {
    apiRequest.mockRejectedValueOnce(new Error('boom'))

    const result = await fetchPlanCatalog({ path: CATALOG_PATH, token: 't' })

    expect(result.status).toBe(PLAN_CATALOG_STATUS.ERROR)
    expect(result.error.message).toBe('boom')
  })
})

// ════════════════════════════════════════════════════════════════════════════
// Store
// ════════════════════════════════════════════════════════════════════════════

function prepareStore({ subscription = null, authenticated = true, cloudAccess = true } = {}) {
  const pinia = createPinia()
  setActivePinia(pinia)

  const cloudStore = useCloudSessionStore()
  if (authenticated) {
    cloudStore.user = { id: 1, name: 'Uji', email: 'uji@example.com' }
    cloudStore.businesses = [{ id: 10, name: 'Toko A', subscription }]
    cloudStore.selectedBusiness = { id: 10, name: 'Toko A', subscription }
    cloudStore.cloudAccess = cloudAccess
    cloudStore.capabilityState = 'verified'
  }

  return {
    pinia,
    cloudStore,
    subscription: useSubscriptionStore(),
    plans: useSubscriptionPlanStore(),
  }
}

describe('subscription plan store', () => {
  it('starts idle with nothing loaded', () => {
    const context = prepareStore()

    expect(context.plans.isIdle).toBe(true)
    expect(context.plans.plans).toEqual([])
    expect(context.plans.canContinue).toBe(false)
  })

  it('skips the request entirely when the endpoint is not configured', async () => {
    vi.stubEnv(PLAN_CATALOG_PATH_ENV, '')
    const context = prepareStore()

    const result = await context.plans.loadCatalog()

    expect(result.status).toBe(PLAN_CATALOG_STATUS.UNAVAILABLE)
    expect(result.reason).toBe(PLAN_CATALOG_REASON.NOT_CONFIGURED)
    expect(context.plans.isUnavailable).toBe(true)
    expect(apiRequest).not.toHaveBeenCalled()
  })

  it('does not request a catalog without a cloud session', async () => {
    const context = prepareStore({ authenticated: false })

    const result = await context.plans.loadCatalog()

    expect(result.reason).toBe(PLAN_CATALOG_REASON.NOT_AUTHENTICATED)
    expect(context.plans.isUnavailable).toBe(true)
    expect(apiRequest).not.toHaveBeenCalled()
  })

  it('does not request a catalog without a stored token', async () => {
    const context = prepareStore()

    const result = await context.plans.loadCatalog()

    expect(result.reason).toBe(PLAN_CATALOG_REASON.NOT_AUTHENTICATED)
    expect(apiRequest).not.toHaveBeenCalled()
  })

  it('loads both periods and defaults to the first period in catalog order', async () => {
    await saveToken('token')
    apiRequest.mockResolvedValueOnce(catalogResponse([MONTHLY_PLAN, YEARLY_PLAN]))
    const context = prepareStore()

    await context.plans.loadCatalog()

    expect(context.plans.isReady).toBe(true)
    expect(context.plans.supportsBothPeriods).toBe(true)
    expect(context.plans.selectedPeriod).toBe('monthly')
    expect(context.plans.visiblePlans).toHaveLength(1)
  })

  it('shows every plan when the catalog offers a single period', async () => {
    await saveToken('token')
    apiRequest.mockResolvedValueOnce(catalogResponse([MONTHLY_PLAN]))
    const context = prepareStore()

    await context.plans.loadCatalog()

    expect(context.plans.supportsBothPeriods).toBe(false)
    expect(context.plans.selectedPeriod).toBeNull()
    expect(context.plans.visiblePlans).toHaveLength(1)
  })

  it('exposes a loading flag while a request is in flight', async () => {
    await saveToken('token')
    let resolveRequest
    apiRequest.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveRequest = resolve
      }),
    )
    const context = prepareStore()

    const pending = context.plans.loadCatalog()
    expect(context.plans.isLoading).toBe(true)

    resolveRequest(catalogResponse([MONTHLY_PLAN]))
    await pending

    expect(context.plans.isLoading).toBe(false)
    expect(context.plans.isReady).toBe(true)
  })

  it('reports an empty catalog', async () => {
    await saveToken('token')
    apiRequest.mockResolvedValueOnce(catalogResponse([]))
    const context = prepareStore()

    await context.plans.loadCatalog()

    expect(context.plans.isEmpty).toBe(true)
    expect(context.plans.plans).toEqual([])
  })

  it('surfaces an error and recovers on retry', async () => {
    await saveToken('token')
    apiRequest.mockResolvedValueOnce({
      ok: false,
      status: 500,
      data: null,
      error: { status: 500, code: 'HTTP_500', message: 'Server error', data: null },
    })
    const context = prepareStore()

    await context.plans.loadCatalog()
    expect(context.plans.hasError).toBe(true)
    expect(context.plans.error).toBe('Server error')

    apiRequest.mockResolvedValueOnce(catalogResponse([MONTHLY_PLAN]))
    await context.plans.retry()

    expect(context.plans.hasError).toBe(false)
    expect(context.plans.isReady).toBe(true)
    expect(context.plans.plans).toHaveLength(1)
  })

  it('selects a plan and gates the continue action on the contract', async () => {
    await saveToken('token')
    apiRequest.mockResolvedValueOnce(catalogResponse([MONTHLY_PLAN]))
    const context = prepareStore()

    await context.plans.loadCatalog()
    expect(context.plans.canContinue).toBe(false)

    expect(context.plans.selectPlan('cloud')).toBe(true)
    expect(context.plans.selectedPlan.code).toBe('cloud')
    // No checkout endpoint in the contract → the CTA must stay inert.
    expect(context.plans.canContinue).toBe(false)
    expect(context.plans.checkoutBlocked).toBe(true)
  })

  it('enables the continue action only with a checkout-capable contract', async () => {
    await saveToken('token')
    apiRequest.mockResolvedValueOnce(catalogResponse([MONTHLY_PLAN], { checkoutAvailable: true }))
    const context = prepareStore()

    await context.plans.loadCatalog()
    context.plans.selectPlan('cloud')

    expect(context.plans.canContinue).toBe(true)
    expect(context.plans.checkoutBlocked).toBe(false)
  })

  it('never enables continue for a plan the business already owns', async () => {
    await saveToken('token')
    apiRequest.mockResolvedValueOnce(catalogResponse([MONTHLY_PLAN], { checkoutAvailable: true }))
    const context = prepareStore({
      subscription: { plan: 'cloud', status: 'active', expires_at: FUTURE },
    })

    await context.plans.loadCatalog()
    context.plans.selectPlan('cloud')

    expect(context.subscription.isPremium).toBe(true)
    expect(context.plans.isCurrentPlan(context.plans.selectedPlan)).toBe(true)
    expect(context.plans.canContinue).toBe(false)
  })

  it('never enables continue for a plan without a confirmed price', async () => {
    await saveToken('token')
    apiRequest.mockResolvedValueOnce(
      catalogResponse([{ code: 'cloud', name: 'Cloud' }], { checkoutAvailable: true }),
    )
    const context = prepareStore()

    await context.plans.loadCatalog()
    context.plans.selectPlan('cloud')

    expect(context.plans.selectedPlan.purchasable).toBe(false)
    expect(context.plans.canContinue).toBe(false)
  })

  it('drops a selection that does not match the newly selected period', async () => {
    await saveToken('token')
    apiRequest.mockResolvedValueOnce(catalogResponse([MONTHLY_PLAN, YEARLY_PLAN]))
    const context = prepareStore()

    await context.plans.loadCatalog()
    context.plans.selectPlan('cloud')
    expect(context.plans.selectedPlanCode).toBe('cloud')

    expect(context.plans.selectPeriod('yearly')).toBe(true)
    expect(context.plans.selectedPlanCode).toBeNull()
  })

  it('ignores a period the catalog does not offer', async () => {
    await saveToken('token')
    apiRequest.mockResolvedValueOnce(catalogResponse([MONTHLY_PLAN]))
    const context = prepareStore()

    await context.plans.loadCatalog()

    expect(context.plans.selectPeriod('yearly')).toBe(false)
    expect(context.plans.selectedPeriod).toBeNull()
  })

  it('refuses to select a plan hidden by the active period', async () => {
    await saveToken('token')
    apiRequest.mockResolvedValueOnce(catalogResponse([YEARLY_PLAN]))
    const context = prepareStore()

    await context.plans.loadCatalog()

    expect(context.plans.selectPlan('cloud')).toBe(true)
    expect(context.plans.selectPlan('tidak-ada')).toBe(false)
    expect(context.plans.selectedPlanCode).toBeNull()
  })

  it('clears a stale selection when the catalog becomes empty', async () => {
    await saveToken('token')
    apiRequest.mockResolvedValueOnce(catalogResponse([MONTHLY_PLAN]))
    const context = prepareStore()

    await context.plans.loadCatalog()
    context.plans.selectPlan('cloud')

    apiRequest.mockResolvedValueOnce(catalogResponse([]))
    await context.plans.retry()

    expect(context.plans.selectedPlan).toBeNull()
    expect(context.plans.canContinue).toBe(false)
  })

  it('resets to idle', async () => {
    await saveToken('token')
    apiRequest.mockResolvedValueOnce(catalogResponse([MONTHLY_PLAN]))
    const context = prepareStore()

    await context.plans.loadCatalog()
    context.plans.selectPlan('cloud')
    context.plans.reset()

    expect(context.plans.isIdle).toBe(true)
    expect(context.plans.plans).toEqual([])
    expect(context.plans.selectedPlanCode).toBeNull()
  })
})

// ════════════════════════════════════════════════════════════════════════════
// Benefit catalog honesty
// ════════════════════════════════════════════════════════════════════════════

describe('premium benefits', () => {
  it('lists the four required benefits', () => {
    expect(PREMIUM_BENEFITS.map((benefit) => benefit.key)).toEqual([
      'cloud_sync',
      'cloud_backup',
      'web_dashboard',
      'business_monitoring',
    ])
  })

  it('only marks benefits the backend supports as available', () => {
    const byKey = Object.fromEntries(PREMIUM_BENEFITS.map((b) => [b.key, b]))

    expect(byKey.cloud_sync.availability).toBe(BENEFIT_AVAILABILITY.AVAILABLE)
    expect(byKey.web_dashboard.availability).toBe(BENEFIT_AVAILABILITY.AVAILABLE)
    expect(byKey.business_monitoring.availability).toBe(BENEFIT_AVAILABILITY.AVAILABLE)
    // No cloud backup capability exists in the backend yet.
    expect(byKey.cloud_backup.availability).toBe(BENEFIT_AVAILABILITY.NOT_AVAILABLE)
  })

  it('keeps offline POS and local backup out of the Premium paywall', () => {
    const text = LOCAL_GUARANTEES.join(' ').toLowerCase()
    expect(text).toContain('offline')
    expect(text).toContain('backup')
  })
})

// ════════════════════════════════════════════════════════════════════════════
// View
// ════════════════════════════════════════════════════════════════════════════

function prepareViewContext({
  subscription = null,
  authenticated = true,
  capabilityState = 'verified',
  cloudAccess = true,
  loading = false,
} = {}) {
  const pinia = createPinia()
  setActivePinia(pinia)

  const businessStore = useBusinessStore()
  businessStore.setBusiness({
    name: 'Toko Uji',
    type: 'Cafe',
    owner: 'Budi',
    phone: '08123456789',
    outlet: 'Outlet Utama',
    mode: 'free',
  })
  useCashierStore().setPinConfigured(true)

  const cloudStore = useCloudSessionStore()
  cloudStore.loading = loading
  if (authenticated) {
    cloudStore.user = { id: 1, name: 'Uji', email: 'uji@example.com' }
    cloudStore.businesses = [{ id: 10, name: 'Toko A', subscription }]
    cloudStore.selectedBusiness = { id: 10, name: 'Toko A', subscription }
    cloudStore.cloudAccess = cloudAccess
    cloudStore.capabilityState = capabilityState
  }

  return {
    pinia,
    router: createAppRouter(),
    cloudStore,
    planStore: useSubscriptionPlanStore(),
  }
}

async function mountView(context) {
  await context.router.push('/subscription')
  await flushPromises()

  const wrapper = mount(SubscriptionView, {
    global: { plugins: [context.pinia, context.router] },
  })
  await flushPromises()

  return wrapper
}

describe('SubscriptionView — status', () => {
  it('shows the FREE badge and keeps local guarantees visible', async () => {
    await saveToken('token')
    apiRequest.mockResolvedValue(catalogResponse([]))
    const context = prepareViewContext({ subscription: { plan: 'free' } })

    const wrapper = await mountView(context)

    expect(wrapper.find('[data-testid="subscription-badge"]').text()).toBe('FREE')
    expect(wrapper.find('[data-testid="local-guarantees"]').text()).toContain('offline')
  })

  it('shows the plan and validity for an active Premium subscription', async () => {
    await saveToken('token')
    apiRequest.mockResolvedValue(catalogResponse([]))
    const context = prepareViewContext({
      subscription: { plan: 'cloud', status: 'active', expires_at: FUTURE },
    })

    const wrapper = await mountView(context)

    expect(wrapper.find('[data-testid="subscription-badge"]').text()).toBe('PREMIUM')
    expect(wrapper.find('[data-testid="subscription-plan"]').text()).toContain('Cloud')
    expect(wrapper.find('[data-testid="subscription-expiry"]').text()).toContain('2030')
  })

  it('never presents an unverified context as Premium (PREM-M01 fail-closed)', async () => {
    await saveToken('token')
    apiRequest.mockResolvedValue(catalogResponse([]))
    const context = prepareViewContext({
      subscription: { plan: 'cloud', status: 'active' },
      capabilityState: 'unverified',
    })

    const wrapper = await mountView(context)

    expect(wrapper.find('[data-testid="subscription-badge"]').text()).toBe('BELUM TERVERIFIKASI')
    expect(wrapper.find('[data-testid="subscription-plan"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="subscription-last-known-plan"]').text()).toContain('Cloud')
  })

  it('shows EXPIRED for an expired subscription', async () => {
    await saveToken('token')
    apiRequest.mockResolvedValue(catalogResponse([]))
    const context = prepareViewContext({ subscription: { plan: 'cloud', status: 'expired' } })

    const wrapper = await mountView(context)

    expect(wrapper.find('[data-testid="subscription-badge"]').text()).toBe('EXPIRED')
  })

  it('shows a skeleton while the cloud context is loading', async () => {
    await saveToken('token')
    apiRequest.mockResolvedValue(catalogResponse([]))
    const context = prepareViewContext({ authenticated: false, loading: true })

    const wrapper = await mountView(context)

    expect(wrapper.find('[data-testid="subscription-skeleton"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="subscription-status-card"]').exists()).toBe(false)
  })
})

describe('SubscriptionView — benefits', () => {
  it('renders every benefit with its availability', async () => {
    await saveToken('token')
    apiRequest.mockResolvedValue(catalogResponse([]))
    const context = prepareViewContext({ subscription: { plan: 'free' } })

    const wrapper = await mountView(context)

    expect(wrapper.find('[data-testid="premium-benefit-cloud_sync"]').text()).toContain(
      'Sinkronisasi cloud',
    )
    expect(wrapper.find('[data-testid="benefit-status-cloud_sync"]').text()).toBe('Tersedia')
    expect(wrapper.find('[data-testid="benefit-status-cloud_backup"]').text()).toBe(
      'Belum tersedia',
    )
    expect(wrapper.find('[data-testid="benefit-status-web_dashboard"]').text()).toBe('Tersedia')
    expect(wrapper.find('[data-testid="benefit-status-business_monitoring"]').text()).toBe(
      'Tersedia',
    )
  })
})

describe('SubscriptionView — catalog states', () => {
  it('shows an explicit "not available" state when no endpoint is configured', async () => {
    vi.stubEnv(PLAN_CATALOG_PATH_ENV, '')
    await saveToken('token')
    const context = prepareViewContext({ subscription: { plan: 'free' } })

    const wrapper = await mountView(context)

    expect(wrapper.find('[data-testid="plan-catalog-unavailable"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="plan-catalog-hint"]').text()).toContain('belum tersedia')
    expect(apiRequest).not.toHaveBeenCalled()
    // Nothing is charged and no price is fabricated.
    expect(wrapper.find('[data-testid="continue-cta"]').attributes('disabled')).toBeDefined()
    expect(wrapper.text()).not.toContain('Rp ')
  })

  it('shows the loading skeleton while the catalog is in flight', async () => {
    await saveToken('token')
    let resolveRequest
    apiRequest.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveRequest = resolve
      }),
    )
    const context = prepareViewContext({ subscription: { plan: 'free' } })

    const wrapper = await mountView(context)

    expect(wrapper.find('[data-testid="plan-catalog-loading"]').exists()).toBe(true)

    resolveRequest(catalogResponse([MONTHLY_PLAN]))
    await flushPromises()

    expect(wrapper.find('[data-testid="plan-catalog-loading"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="plan-card-cloud"]').exists()).toBe(true)
  })

  it('shows an empty state when the API returns no plans', async () => {
    await saveToken('token')
    apiRequest.mockResolvedValue(catalogResponse([]))
    const context = prepareViewContext({ subscription: { plan: 'free' } })

    const wrapper = await mountView(context)

    expect(wrapper.find('[data-testid="plan-catalog-empty"]').exists()).toBe(true)
  })

  it('shows an error state and retries through the API', async () => {
    await saveToken('token')
    apiRequest.mockResolvedValueOnce({
      ok: false,
      status: 500,
      data: null,
      error: { status: 500, code: 'HTTP_500', message: 'Server error', data: null },
    })
    const context = prepareViewContext({ subscription: { plan: 'free' } })

    const wrapper = await mountView(context)
    expect(wrapper.find('[data-testid="plan-catalog-error"]').text()).toContain('Server error')

    apiRequest.mockResolvedValueOnce(catalogResponse([MONTHLY_PLAN]))
    await wrapper.find('[data-testid="plan-catalog-retry"]').trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-testid="plan-catalog-error"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="plan-card-cloud"]').exists()).toBe(true)
  })

  it('renders plan details, Rupiah price, features and terms from the API', async () => {
    await saveToken('token')
    apiRequest.mockResolvedValue(catalogResponse([MONTHLY_PLAN]))
    const context = prepareViewContext({ subscription: { plan: 'free' } })

    const wrapper = await mountView(context)

    expect(wrapper.find('[data-testid="plan-name-cloud"]').text()).toBe('Cloud Bulanan')
    expect(wrapper.find('[data-testid="plan-price-cloud"]').text()).toBe('Rp 49.000')
    expect(wrapper.find('[data-testid="plan-period-cloud"]').text()).toContain('Bulanan')
    expect(wrapper.find('[data-testid="plan-features-cloud"]').text()).toContain(
      'Sinkronisasi cloud',
    )
    expect(wrapper.find('[data-testid="plan-terms-cloud"]').text()).toContain('Perpanjangan')
    // The yearly price never leaks in while the monthly period is active.
    expect(wrapper.find('[data-testid="plan-card-cloud"]').text()).not.toContain('Rp 490.000')
  })

  it('shows the period toggle only when both periods exist, and filters plans', async () => {
    await saveToken('token')
    apiRequest.mockResolvedValue(catalogResponse([MONTHLY_PLAN, YEARLY_PLAN]))
    const context = prepareViewContext({ subscription: { plan: 'free' } })

    const wrapper = await mountView(context)

    expect(wrapper.find('[data-testid="period-toggle"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="plan-price-cloud"]').text()).toBe('Rp 49.000')

    await wrapper.find('[data-testid="period-option-yearly"]').trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-testid="plan-price-cloud"]').text()).toBe('Rp 490.000')
    expect(wrapper.find('[data-testid="plan-period-cloud"]').text()).toContain('Tahunan')
  })

  it('hides the period toggle for a single-period catalog', async () => {
    await saveToken('token')
    apiRequest.mockResolvedValue(catalogResponse([MONTHLY_PLAN]))
    const context = prepareViewContext({ subscription: { plan: 'free' } })

    const wrapper = await mountView(context)

    expect(wrapper.find('[data-testid="period-toggle"]').exists()).toBe(false)
  })

  it('keeps the checkout inert while the contract offers no checkout', async () => {
    await saveToken('token')
    apiRequest.mockResolvedValue(catalogResponse([MONTHLY_PLAN]))
    const context = prepareViewContext({ subscription: { plan: 'free' } })

    const wrapper = await mountView(context)
    await wrapper.find('[data-testid="plan-select-cloud"]').trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-testid="selected-plan-name"]').text()).toBe('Cloud Bulanan')
    expect(wrapper.find('[data-testid="continue-cta"]').text()).toContain('Checkout belum tersedia')
    expect(wrapper.find('[data-testid="continue-cta"]').attributes('disabled')).toBeDefined()
    expect(wrapper.find('[data-testid="checkout-unavailable-note"]').text()).toContain(
      'tidak memproses pembayaran',
    )
  })

  it('activates the continue action only for a valid plan with checkout support', async () => {
    await saveToken('token')
    apiRequest.mockResolvedValue(catalogResponse([MONTHLY_PLAN], { checkoutAvailable: true }))
    const context = prepareViewContext({ subscription: { plan: 'free' } })

    const wrapper = await mountView(context)

    expect(wrapper.find('[data-testid="continue-cta"]').attributes('disabled')).toBeDefined()

    await wrapper.find('[data-testid="plan-select-cloud"]').trigger('click')
    await flushPromises()

    const cta = wrapper.find('[data-testid="continue-cta"]')
    expect(cta.text()).toBe('Lanjutkan')
    expect(cta.attributes('disabled')).toBeUndefined()

    await cta.trigger('click')
    await flushPromises()

    // No payment is processed in-app, even when the contract allows checkout.
    expect(wrapper.find('[data-testid="checkout-notice"]').text()).toContain(
      'tidak memproses pembayaran',
    )
  })

  it('never offers a double purchase for the active plan', async () => {
    await saveToken('token')
    apiRequest.mockResolvedValue(catalogResponse([MONTHLY_PLAN], { checkoutAvailable: true }))
    const context = prepareViewContext({
      subscription: { plan: 'cloud', status: 'active', expires_at: FUTURE },
    })

    const wrapper = await mountView(context)

    expect(wrapper.find('[data-testid="plan-current-cloud"]').text()).toContain(
      'Paket Anda saat ini',
    )
    expect(wrapper.find('[data-testid="plan-select-cloud"]').attributes('disabled')).toBeDefined()
    expect(wrapper.find('[data-testid="selected-plan-empty"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="continue-cta"]').attributes('disabled')).toBeDefined()
  })

  it('marks a plan without a confirmed price as not selectable', async () => {
    await saveToken('token')
    apiRequest.mockResolvedValue(catalogResponse([{ code: 'cloud', name: 'Cloud' }]))
    const context = prepareViewContext({ subscription: { plan: 'free' } })

    const wrapper = await mountView(context)

    expect(wrapper.find('[data-testid="plan-price-cloud"]').text()).toBe('Harga belum tersedia')
    expect(wrapper.find('[data-testid="plan-unpurchasable-cloud"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="plan-select-cloud"]').attributes('disabled')).toBeDefined()
  })
})
