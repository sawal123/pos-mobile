/**
 * PREM-M02 — Premium plan catalog alignment with the authoritative backend
 * contract (PREM-D01 / PREM-D02A).
 *
 * Coverage:
 * - Canonical backend payload: one `cloud` plan carrying `billing_periods`
 *   (`period` / `currency` / `price_minor`), `benefits`, `available`,
 *   `purchasable`, plus top-level `checkout_available`.
 * - `price_minor` is rendered exactly as sent (IDR formatting, no mockup price).
 * - `business_id` always comes from the active business context.
 * - Monthly-only, yearly-only and monthly+yearly (toggle) catalogs.
 * - Invalid billing periods are ignored; a missing price fails closed.
 * - Both gates (`purchasable` + `checkout_available`) guard the CTA.
 * - Legacy `price` / `period` / `features` aliases stay supported but never
 *   beat the canonical contract.
 * - PREM-M01 entitlement stays fail-closed.
 */

import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import planCatalogSource from '@/services/subscription/planCatalogService.js?raw'
import { apiRequest } from '@/services/cloud/apiClient'
import { _resetTokenStore, saveToken } from '@/services/cloud/tokenRepository'
import {
  DEFAULT_PLAN_CATALOG_PATH,
  PLAN_CATALOG_PATH_ENV,
  PLAN_CATALOG_REASON,
  PLAN_CATALOG_STATUS,
  buildPlanCatalogPath,
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

const BUSINESS_ID = 10
const FUTURE = '2030-01-01T00:00:00.000Z'

/** Canonical backend plan: one `cloud` plan carrying both billing periods. */
function canonicalCloudPlan(overrides = {}) {
  return {
    code: 'cloud',
    name: 'Cloud',
    billing_periods: [
      { period: 'monthly', currency: 'IDR', price_minor: 49000 },
      { period: 'yearly', currency: 'IDR', price_minor: 490000 },
    ],
    benefits: ['Sinkronisasi cloud', 'Dashboard web'],
    available: true,
    purchasable: false,
    ...overrides,
  }
}

function catalogResponse(plans, { checkoutAvailable = false, businessId = BUSINESS_ID } = {}) {
  return {
    ok: true,
    status: 200,
    data: { data: { business_id: businessId, plans, checkout_available: checkoutAvailable } },
    error: null,
  }
}

beforeEach(() => {
  setActivePinia(createPinia())
  apiRequest.mockReset()
  _resetTokenStore()
})

afterEach(() => {
  vi.unstubAllEnvs()
  _resetTokenStore()
})

// ════════════════════════════════════════════════════════════════════════════
// Adapter — endpoint & business scoping
// ════════════════════════════════════════════════════════════════════════════

describe('plan catalog adapter — endpoint and business scoping', () => {
  it('defaults to the authoritative backend catalog endpoint', () => {
    expect(resolvePlanCatalogPath({})).toBe(DEFAULT_PLAN_CATALOG_PATH)
    expect(DEFAULT_PLAN_CATALOG_PATH).toBe('/api/mobile/subscription/plans')
  })

  it('lets the environment override the endpoint without changing the contract', () => {
    expect(resolvePlanCatalogPath({ [PLAN_CATALOG_PATH_ENV]: ' /api/staging/plans ' })).toBe(
      '/api/staging/plans',
    )
  })

  it('appends the active business id to the query string', () => {
    expect(buildPlanCatalogPath(DEFAULT_PLAN_CATALOG_PATH, BUSINESS_ID)).toBe(
      `${DEFAULT_PLAN_CATALOG_PATH}?business_id=${BUSINESS_ID}`,
    )
    expect(buildPlanCatalogPath('/api/plans?locale=id', 7)).toBe(
      '/api/plans?locale=id&business_id=7',
    )
  })

  it('never calls the endpoint without a business id', async () => {
    const result = await fetchPlanCatalog({ token: 'token', businessId: null })

    expect(result.status).toBe(PLAN_CATALOG_STATUS.UNAVAILABLE)
    expect(result.reason).toBe(PLAN_CATALOG_REASON.NO_BUSINESS)
    expect(apiRequest).not.toHaveBeenCalled()
  })

  it('requests the catalog with the given business_id', async () => {
    apiRequest.mockResolvedValueOnce(catalogResponse([canonicalCloudPlan()]))

    await fetchPlanCatalog({ token: 'token', businessId: BUSINESS_ID })

    expect(apiRequest).toHaveBeenCalledTimes(1)
    expect(apiRequest.mock.calls[0][0]).toBe(
      `${DEFAULT_PLAN_CATALOG_PATH}?business_id=${BUSINESS_ID}`,
    )
    expect(apiRequest.mock.calls[0][1]).toEqual({ token: 'token' })
  })

  it('reports a missing route as "not deployed" instead of a failure', async () => {
    apiRequest.mockResolvedValueOnce({
      ok: false,
      status: 404,
      data: null,
      error: { status: 404, code: 'HTTP_404', message: 'Not Found', data: null },
    })

    const result = await fetchPlanCatalog({ token: 'token', businessId: BUSINESS_ID })

    expect(result.status).toBe(PLAN_CATALOG_STATUS.UNAVAILABLE)
    expect(result.reason).toBe(PLAN_CATALOG_REASON.ENDPOINT_MISSING)
  })

  it('reports a server/network failure as an error', async () => {
    apiRequest.mockResolvedValueOnce({
      ok: false,
      status: 500,
      data: null,
      error: { status: 500, code: 'HTTP_500', message: 'Server error', data: null },
    })

    const result = await fetchPlanCatalog({ token: 'token', businessId: BUSINESS_ID })

    expect(result.status).toBe(PLAN_CATALOG_STATUS.ERROR)
    expect(result.error.message).toBe('Server error')
    expect(result.options).toEqual([])
  })

  it('survives a thrown transport error', async () => {
    apiRequest.mockRejectedValueOnce(new Error('boom'))

    const result = await fetchPlanCatalog({ token: 'token', businessId: BUSINESS_ID })

    expect(result.status).toBe(PLAN_CATALOG_STATUS.ERROR)
    expect(result.error.message).toBe('boom')
  })
})

// ════════════════════════════════════════════════════════════════════════════
// Adapter — canonical normalisation
// ════════════════════════════════════════════════════════════════════════════

describe('plan catalog adapter — canonical contract', () => {
  it('understands one cloud plan that carries monthly and yearly periods', () => {
    const catalog = normalizePlanCatalog(catalogResponse([canonicalCloudPlan()]).data)

    expect(catalog.plans).toHaveLength(1)
    expect(catalog.plans[0].code).toBe('cloud')
    expect(catalog.options).toHaveLength(2)
    expect(catalog.options.map((option) => option.period)).toEqual(['monthly', 'yearly'])
    expect(catalog.periods).toEqual(['monthly', 'yearly'])
    expect(catalog.supportsBothPeriods).toBe(true)
  })

  it('uses price_minor exactly as sent for the IDR label', () => {
    const catalog = normalizePlanCatalog(catalogResponse([canonicalCloudPlan()]).data)
    const [monthly, yearly] = catalog.options

    expect(monthly.priceMinor).toBe(49000)
    expect(monthly.priceLabel).toBe('Rp 49.000')
    expect(monthly.currency).toBe('IDR')
    expect(monthly.hasPrice).toBe(true)
    expect(monthly.periodLabel).toBe('Bulanan')
    expect(yearly.priceMinor).toBe(490000)
    expect(yearly.priceLabel).toBe('Rp 490.000')
    expect(yearly.periodLabel).toBe('Tahunan')
  })

  it('formats arbitrary backend amounts without inventing a price', () => {
    expect(formatPlanPrice(123456)).toBe('Rp 123.456')
    expect(formatPlanPrice(0)).toBe('Rp 0')
    expect(formatPlanPrice(2500, 'USD')).toBe('USD 2.500')
  })

  it('keeps the backend purchasable flag verbatim', () => {
    expect(normalizePlan(canonicalCloudPlan()).purchasable).toBe(false)
    expect(normalizePlan(canonicalCloudPlan({ purchasable: true })).purchasable).toBe(true)
  })

  it('reads benefits from the canonical field', () => {
    const plan = normalizePlan(canonicalCloudPlan())

    expect(plan.benefits).toEqual(['Sinkronisasi cloud', 'Dashboard web'])
    expect(plan.available).toBe(true)
  })

  it('supports a monthly-only catalog', () => {
    const catalog = normalizePlanCatalog(
      catalogResponse([
        canonicalCloudPlan({
          billing_periods: [{ period: 'monthly', currency: 'IDR', price_minor: 49000 }],
        }),
      ]).data,
    )

    expect(catalog.periods).toEqual(['monthly'])
    expect(catalog.supportsBothPeriods).toBe(false)
    expect(catalog.options[0].priceLabel).toBe('Rp 49.000')
  })

  it('supports a yearly-only catalog', () => {
    const catalog = normalizePlanCatalog(
      catalogResponse([
        canonicalCloudPlan({
          billing_periods: [{ period: 'yearly', currency: 'IDR', price_minor: 490000 }],
        }),
      ]).data,
    )

    expect(catalog.periods).toEqual(['yearly'])
    expect(catalog.supportsBothPeriods).toBe(false)
    expect(catalog.options[0].periodLabel).toBe('Tahunan')
  })

  it('ignores an unsupported billing period instead of passing it through', () => {
    const catalog = normalizePlanCatalog(
      catalogResponse([
        canonicalCloudPlan({
          billing_periods: [
            { period: 'weekly', currency: 'IDR', price_minor: 15000 },
            { period: 'monthly', currency: 'IDR', price_minor: 49000 },
          ],
        }),
      ]).data,
    )

    expect(catalog.periods).toEqual(['monthly'])
    expect(catalog.options).toHaveLength(1)
    expect(normalizePlanPeriod('weekly')).toBeNull()
  })

  it('drops a period without a usable price (fail-closed, no invented price)', () => {
    const catalog = normalizePlanCatalog(
      catalogResponse([
        canonicalCloudPlan({
          billing_periods: [
            { period: 'monthly', currency: 'IDR', price_minor: null },
            { period: 'yearly', currency: 'IDR', price_minor: 'Rp 490.000' },
          ],
        }),
      ]).data,
    )

    expect(catalog.options).toEqual([])
    expect(catalog.checkoutAvailable).toBe(false)
  })

  it('keeps a plan with no priced period out of the selectable options', () => {
    const plan = normalizePlan(canonicalCloudPlan({ billing_periods: [] }))

    expect(plan.billingPeriods).toEqual([])
    expect(
      normalizePlanCatalog(catalogResponse([canonicalCloudPlan({ billing_periods: [] })]).data)
        .options,
    ).toEqual([])
  })

  it('treats available: false as "not offered" while keeping the plan record', () => {
    const catalog = normalizePlanCatalog(
      catalogResponse([canonicalCloudPlan({ available: false })]).data,
    )

    expect(catalog.plans).toHaveLength(1)
    expect(catalog.options).toEqual([])
    expect(catalog.periods).toEqual([])
  })

  it('drops a plan without a usable code and de-duplicates by code', () => {
    const catalog = normalizePlanCatalog(
      catalogResponse([
        { name: 'Tanpa kode' },
        canonicalCloudPlan(),
        canonicalCloudPlan({ name: 'Cloud duplikat' }),
      ]).data,
    )

    expect(catalog.plans).toHaveLength(1)
    expect(catalog.plans[0].name).toBe('Cloud')
  })

  it('reports an empty catalog distinctly from unavailable', async () => {
    apiRequest.mockResolvedValueOnce(catalogResponse([]))

    const result = await fetchPlanCatalog({ token: 'token', businessId: BUSINESS_ID })

    expect(result.status).toBe(PLAN_CATALOG_STATUS.EMPTY)
    expect(result.options).toEqual([])
    expect(result.checkoutAvailable).toBe(false)
  })

  it('carries the top-level checkout_available flag', async () => {
    apiRequest.mockResolvedValueOnce(
      catalogResponse([canonicalCloudPlan()], { checkoutAvailable: true }),
    )

    const result = await fetchPlanCatalog({ token: 'token', businessId: BUSINESS_ID })

    expect(result.status).toBe(PLAN_CATALOG_STATUS.READY)
    expect(result.checkoutAvailable).toBe(true)
  })

  it('still accepts the legacy shape when the canonical fields are absent', () => {
    const plan = normalizePlan({
      code: 'cloud',
      name: 'Cloud',
      price: 49000,
      period: 'monthly',
      features: ['Sinkronisasi cloud'],
    })

    expect(plan.billingPeriods).toEqual([
      {
        period: 'monthly',
        periodLabel: 'Bulanan',
        currency: 'IDR',
        priceMinor: 49000,
        priceLabel: 'Rp 49.000',
        hasPrice: true,
      },
    ])
    expect(plan.benefits).toEqual(['Sinkronisasi cloud'])
  })

  it('never lets a legacy alias override the canonical contract', () => {
    const plan = normalizePlan({
      code: 'cloud',
      name: 'Cloud',
      billing_periods: [{ period: 'yearly', currency: 'IDR', price_minor: 490000 }],
      benefits: ['Manfaat kanonik'],
      purchasable: false,
      available: true,
      // Legacy leftovers that must be ignored:
      price: 12345,
      period: 'monthly',
      features: ['Manfaat legacy'],
    })

    expect(plan.billingPeriods).toHaveLength(1)
    expect(plan.billingPeriods[0].period).toBe('yearly')
    expect(plan.billingPeriods[0].priceMinor).toBe(490000)
    expect(plan.benefits).toEqual(['Manfaat kanonik'])
  })

  it('contains no mockup price anywhere in the adapter', () => {
    expect(planCatalogSource).not.toContain('49000')
    expect(planCatalogSource).not.toContain('490000')
  })
})

// ════════════════════════════════════════════════════════════════════════════
// Store
// ════════════════════════════════════════════════════════════════════════════

function prepareStore({
  subscription = null,
  authenticated = true,
  businessId = BUSINESS_ID,
} = {}) {
  const pinia = createPinia()
  setActivePinia(pinia)

  const cloudStore = useCloudSessionStore()
  if (authenticated) {
    cloudStore.user = { id: 1, name: 'Uji', email: 'uji@example.com' }
    cloudStore.businesses = [{ id: businessId, name: 'Toko A', subscription }]
    cloudStore.selectedBusiness = { id: businessId, name: 'Toko A', subscription }
    cloudStore.cloudAccess = true
    cloudStore.capabilityState = 'verified'
  }

  return {
    pinia,
    cloudStore,
    subscription: useSubscriptionStore(),
    plans: useSubscriptionPlanStore(),
  }
}

describe('subscription plan store — canonical catalog', () => {
  it('starts idle with nothing loaded', () => {
    const context = prepareStore()

    expect(context.plans.isIdle).toBe(true)
    expect(context.plans.options).toEqual([])
    expect(context.plans.canContinue).toBe(false)
  })

  it('loads one cloud plan with both periods from the active business', async () => {
    await saveToken('token')
    apiRequest.mockResolvedValueOnce(catalogResponse([canonicalCloudPlan()]))
    const context = prepareStore()

    await context.plans.loadCatalog()

    expect(context.plans.isReady).toBe(true)
    expect(context.plans.supportsBothPeriods).toBe(true)
    expect(context.plans.availablePeriods).toEqual(['monthly', 'yearly'])
    expect(context.plans.selectedPeriod).toBe('monthly')
    expect(context.plans.visibleOptions).toHaveLength(1)
    expect(context.plans.visibleOptions[0].period).toBe('monthly')
    // The active business id is the one sent to the backend.
    expect(apiRequest.mock.calls[0][0]).toContain(`business_id=${BUSINESS_ID}`)
  })

  it('never requests a catalog without an active business', async () => {
    await saveToken('token')
    const context = prepareStore({ businessId: null })
    context.cloudStore.selectedBusiness = null
    context.cloudStore.businesses = []

    const result = await context.plans.loadCatalog()

    expect(result.reason).toBe(PLAN_CATALOG_REASON.NO_BUSINESS)
    expect(context.plans.isUnavailable).toBe(true)
    expect(apiRequest).not.toHaveBeenCalled()
  })

  it('does not request a catalog without a cloud session or token', async () => {
    const anonymous = prepareStore({ authenticated: false })
    expect((await anonymous.plans.loadCatalog()).reason).toBe(PLAN_CATALOG_REASON.NOT_AUTHENTICATED)
    expect(apiRequest).not.toHaveBeenCalled()

    const noToken = prepareStore()
    expect((await noToken.plans.loadCatalog()).reason).toBe(PLAN_CATALOG_REASON.NOT_AUTHENTICATED)
    expect(apiRequest).not.toHaveBeenCalled()
  })

  it('exposes a loading flag while the request is in flight', async () => {
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

    resolveRequest(catalogResponse([canonicalCloudPlan()]))
    await pending

    expect(context.plans.isLoading).toBe(false)
    expect(context.plans.isReady).toBe(true)
  })

  it('reports the empty catalog the backend returns while pricing is undecided', async () => {
    await saveToken('token')
    apiRequest.mockResolvedValueOnce(catalogResponse([]))
    const context = prepareStore()

    await context.plans.loadCatalog()

    expect(context.plans.isEmpty).toBe(true)
    expect(context.plans.options).toEqual([])
    expect(context.plans.checkoutAvailable).toBe(false)
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

    apiRequest.mockResolvedValueOnce(catalogResponse([canonicalCloudPlan()]))
    await context.plans.retry()

    expect(context.plans.hasError).toBe(false)
    expect(context.plans.isReady).toBe(true)
  })

  it('carries the selection across the period toggle for the same plan', async () => {
    await saveToken('token')
    apiRequest.mockResolvedValueOnce(
      catalogResponse([canonicalCloudPlan({ purchasable: true })], { checkoutAvailable: true }),
    )
    const context = prepareStore()

    await context.plans.loadCatalog()
    expect(context.plans.selectOption('cloud::monthly')).toBe(true)
    expect(context.plans.selectedOption.periodLabel).toBe('Bulanan')

    expect(context.plans.selectPeriod('yearly')).toBe(true)
    expect(context.plans.selectedOptionKey).toBe('cloud::yearly')
    expect(context.plans.selectedOption.periodLabel).toBe('Tahunan')
    expect(context.plans.selectedOption.priceLabel).toBe('Rp 490.000')
  })

  it('ignores a period the catalog does not offer', async () => {
    await saveToken('token')
    apiRequest.mockResolvedValueOnce(
      catalogResponse([
        canonicalCloudPlan({
          billing_periods: [{ period: 'monthly', currency: 'IDR', price_minor: 49000 }],
        }),
      ]),
    )
    const context = prepareStore()

    await context.plans.loadCatalog()

    expect(context.plans.selectPeriod('yearly')).toBe(false)
    expect(context.plans.selectedPeriod).toBeNull()
    expect(context.plans.visibleOptions).toHaveLength(1)
  })

  it('refuses to select an option that the active period filters out', async () => {
    await saveToken('token')
    apiRequest.mockResolvedValueOnce(
      catalogResponse([canonicalCloudPlan({ purchasable: true })], { checkoutAvailable: true }),
    )
    const context = prepareStore()

    await context.plans.loadCatalog()

    expect(context.plans.selectOption('cloud::yearly')).toBe(false)
    expect(context.plans.selectedOptionKey).toBeNull()
  })

  it('fails closed when a period has no price even if the backend says purchasable', async () => {
    await saveToken('token')
    apiRequest.mockResolvedValueOnce(
      catalogResponse(
        [
          canonicalCloudPlan({
            purchasable: true,
            billing_periods: [{ period: 'monthly', currency: 'IDR', price_minor: null }],
          }),
        ],
        { checkoutAvailable: true },
      ),
    )
    const context = prepareStore()

    await context.plans.loadCatalog()

    expect(context.plans.options).toEqual([])
    expect(context.plans.canContinue).toBe(false)
  })

  it('keeps the CTA inert while the backend reports purchasable: false', async () => {
    await saveToken('token')
    apiRequest.mockResolvedValueOnce(
      catalogResponse([canonicalCloudPlan({ purchasable: false })], { checkoutAvailable: true }),
    )
    const context = prepareStore()

    await context.plans.loadCatalog()
    context.plans.selectOption('cloud::monthly')

    expect(context.plans.selectedOption).not.toBeNull()
    expect(context.plans.canContinue).toBe(false)
    expect(context.plans.selectionNotPurchasable).toBe(true)
  })

  it('keeps the CTA inert while the backend reports checkout_available: false', async () => {
    await saveToken('token')
    apiRequest.mockResolvedValueOnce(
      catalogResponse([canonicalCloudPlan({ purchasable: true })], { checkoutAvailable: false }),
    )
    const context = prepareStore()

    await context.plans.loadCatalog()
    context.plans.selectOption('cloud::monthly')

    expect(context.plans.canContinue).toBe(false)
    expect(context.plans.checkoutBlocked).toBe(true)
  })

  it('enables the CTA only when both gates and a priced period agree', async () => {
    await saveToken('token')
    apiRequest.mockResolvedValueOnce(
      catalogResponse([canonicalCloudPlan({ purchasable: true })], { checkoutAvailable: true }),
    )
    const context = prepareStore()

    await context.plans.loadCatalog()
    context.plans.selectOption('cloud::monthly')

    expect(context.plans.canContinue).toBe(true)
    expect(context.plans.checkoutBlocked).toBe(false)
    expect(context.plans.selectionNotPurchasable).toBe(false)
  })

  it('never offers the plan the business already owns', async () => {
    await saveToken('token')
    apiRequest.mockResolvedValueOnce(
      catalogResponse([canonicalCloudPlan({ purchasable: true })], { checkoutAvailable: true }),
    )
    const context = prepareStore({
      subscription: { plan: 'cloud', status: 'active', expires_at: FUTURE },
    })

    await context.plans.loadCatalog()

    expect(context.subscription.isPremium).toBe(true)
    expect(context.plans.isCurrentPlan(context.plans.visibleOptions[0])).toBe(true)
    expect(context.plans.isSelectable(context.plans.visibleOptions[0])).toBe(false)
    expect(context.plans.canContinue).toBe(false)
  })

  it('clears a stale selection when the catalog turns empty', async () => {
    await saveToken('token')
    apiRequest.mockResolvedValueOnce(catalogResponse([canonicalCloudPlan({ purchasable: true })]))
    const context = prepareStore()

    await context.plans.loadCatalog()
    context.plans.selectOption('cloud::monthly')

    apiRequest.mockResolvedValueOnce(catalogResponse([]))
    await context.plans.retry()

    expect(context.plans.selectedOption).toBeNull()
    expect(context.plans.canContinue).toBe(false)
  })

  it('resets to idle', async () => {
    await saveToken('token')
    apiRequest.mockResolvedValueOnce(catalogResponse([canonicalCloudPlan({ purchasable: true })]))
    const context = prepareStore()

    await context.plans.loadCatalog()
    context.plans.selectOption('cloud::monthly')
    context.plans.reset()

    expect(context.plans.isIdle).toBe(true)
    expect(context.plans.options).toEqual([])
    expect(context.plans.selectedOptionKey).toBeNull()
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
    // Cloud backup/restore have no backend implementation yet.
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
  businessId = BUSINESS_ID,
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
    cloudStore.businesses = [{ id: businessId, name: 'Toko A', subscription }]
    cloudStore.selectedBusiness = { id: businessId, name: 'Toko A', subscription }
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
  })
})

describe('SubscriptionView — canonical catalog', () => {
  it('renders the backend price, benefits and period for one cloud plan', async () => {
    await saveToken('token')
    apiRequest.mockResolvedValue(catalogResponse([canonicalCloudPlan()]))
    const context = prepareViewContext({ subscription: { plan: 'free' } })

    const wrapper = await mountView(context)

    expect(wrapper.find('[data-testid="plan-name-cloud"]').text()).toBe('Cloud')
    expect(wrapper.find('[data-testid="plan-price-cloud"]').text()).toBe('Rp 49.000')
    expect(wrapper.find('[data-testid="plan-period-cloud"]').text()).toContain('Bulanan')
    expect(wrapper.find('[data-testid="plan-benefits-cloud"]').text()).toContain(
      'Sinkronisasi cloud',
    )
    // The yearly amount must not leak while the monthly period is active.
    expect(wrapper.find('[data-testid="plan-card-cloud"]').text()).not.toContain('Rp 490.000')
  })

  it('renders whatever price_minor the backend sends (no mockup constant)', async () => {
    await saveToken('token')
    apiRequest.mockResolvedValue(
      catalogResponse([
        canonicalCloudPlan({
          billing_periods: [{ period: 'monthly', currency: 'IDR', price_minor: 123456 }],
        }),
      ]),
    )
    const context = prepareViewContext({ subscription: { plan: 'free' } })

    const wrapper = await mountView(context)

    expect(wrapper.find('[data-testid="plan-price-cloud"]').text()).toBe('Rp 123.456')
  })

  it('shows the Bulanan/Tahunan toggle only when both periods exist', async () => {
    await saveToken('token')
    apiRequest.mockResolvedValue(catalogResponse([canonicalCloudPlan()]))
    const context = prepareViewContext({ subscription: { plan: 'free' } })

    const wrapper = await mountView(context)

    expect(wrapper.find('[data-testid="period-toggle"]').exists()).toBe(true)

    await wrapper.find('[data-testid="period-option-yearly"]').trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-testid="plan-price-cloud"]').text()).toBe('Rp 490.000')
    expect(wrapper.find('[data-testid="plan-period-cloud"]').text()).toContain('Tahunan')
  })

  it('hides the toggle for a monthly-only catalog', async () => {
    await saveToken('token')
    apiRequest.mockResolvedValue(
      catalogResponse([
        canonicalCloudPlan({
          billing_periods: [{ period: 'monthly', currency: 'IDR', price_minor: 49000 }],
        }),
      ]),
    )
    const context = prepareViewContext({ subscription: { plan: 'free' } })

    const wrapper = await mountView(context)

    expect(wrapper.find('[data-testid="period-toggle"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="plan-price-cloud"]').text()).toBe('Rp 49.000')
  })

  it('hides the toggle for a yearly-only catalog', async () => {
    await saveToken('token')
    apiRequest.mockResolvedValue(
      catalogResponse([
        canonicalCloudPlan({
          billing_periods: [{ period: 'yearly', currency: 'IDR', price_minor: 490000 }],
        }),
      ]),
    )
    const context = prepareViewContext({ subscription: { plan: 'free' } })

    const wrapper = await mountView(context)

    expect(wrapper.find('[data-testid="period-toggle"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="plan-price-cloud"]').text()).toBe('Rp 490.000')
  })

  it('never renders an unsupported billing period', async () => {
    await saveToken('token')
    apiRequest.mockResolvedValue(
      catalogResponse([
        canonicalCloudPlan({
          billing_periods: [
            { period: 'weekly', currency: 'IDR', price_minor: 15000 },
            { period: 'monthly', currency: 'IDR', price_minor: 49000 },
          ],
        }),
      ]),
    )
    const context = prepareViewContext({ subscription: { plan: 'free' } })

    const wrapper = await mountView(context)

    expect(wrapper.text()).not.toContain('Rp 15.000')
    expect(wrapper.find('[data-testid="period-option-weekly"]').exists()).toBe(false)
  })

  it('shows an honest empty state while pricing is undecided', async () => {
    await saveToken('token')
    apiRequest.mockResolvedValue(catalogResponse([]))
    const context = prepareViewContext({ subscription: { plan: 'free' } })

    const wrapper = await mountView(context)

    expect(wrapper.find('[data-testid="plan-catalog-empty"]').exists()).toBe(true)
    // No invented price may appear anywhere.
    expect(wrapper.text()).not.toContain('Rp ')
    expect(wrapper.find('[data-testid="continue-cta"]').attributes('disabled')).toBeDefined()
  })

  it('keeps the CTA inert while checkout_available is false', async () => {
    await saveToken('token')
    apiRequest.mockResolvedValue(
      catalogResponse([canonicalCloudPlan({ purchasable: true })], { checkoutAvailable: false }),
    )
    const context = prepareViewContext({ subscription: { plan: 'free' } })

    const wrapper = await mountView(context)

    expect(wrapper.find('[data-testid="continue-cta"]').text()).toContain('Checkout belum tersedia')
    expect(wrapper.find('[data-testid="continue-cta"]').attributes('disabled')).toBeDefined()
    expect(wrapper.find('[data-testid="checkout-unavailable-note"]').text()).toContain(
      'tidak memproses pembayaran',
    )
  })

  it('keeps the CTA inert and the option unselectable while purchasable is false', async () => {
    await saveToken('token')
    apiRequest.mockResolvedValue(
      catalogResponse([canonicalCloudPlan({ purchasable: false })], { checkoutAvailable: true }),
    )
    const context = prepareViewContext({ subscription: { plan: 'free' } })

    const wrapper = await mountView(context)

    const select = wrapper.find('[data-testid="plan-select-cloud"]')
    expect(select.attributes('disabled')).toBeDefined()

    await select.trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-testid="selected-plan-empty"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="continue-cta"]').attributes('disabled')).toBeDefined()
  })

  it('activates the continue action only when both gates and the price agree', async () => {
    await saveToken('token')
    apiRequest.mockResolvedValue(
      catalogResponse([canonicalCloudPlan({ purchasable: true })], { checkoutAvailable: true }),
    )
    const context = prepareViewContext({ subscription: { plan: 'free' } })

    const wrapper = await mountView(context)

    await wrapper.find('[data-testid="plan-select-cloud"]').trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-testid="selected-plan-name"]').text()).toBe('Cloud')
    expect(wrapper.find('[data-testid="selected-plan-price"]').text()).toContain('Rp 49.000')

    const cta = wrapper.find('[data-testid="continue-cta"]')
    expect(cta.text()).toBe('Lanjutkan')
    expect(cta.attributes('disabled')).toBeUndefined()

    await cta.trigger('click')
    await flushPromises()

    // Even when the backend offers checkout, the app never charges.
    expect(wrapper.find('[data-testid="checkout-notice"]').text()).toContain(
      'tidak memproses pembayaran',
    )
  })

  it('protects the plan the business already owns', async () => {
    await saveToken('token')
    apiRequest.mockResolvedValue(
      catalogResponse([canonicalCloudPlan({ purchasable: true })], { checkoutAvailable: true }),
    )
    const context = prepareViewContext({
      subscription: { plan: 'cloud', status: 'active', expires_at: FUTURE },
    })

    const wrapper = await mountView(context)

    expect(wrapper.find('[data-testid="subscription-badge"]').text()).toBe('PREMIUM')
    expect(wrapper.find('[data-testid="plan-current-cloud"]').text()).toContain(
      'Paket Anda saat ini',
    )
    expect(wrapper.find('[data-testid="plan-select-cloud"]').attributes('disabled')).toBeDefined()
    expect(wrapper.find('[data-testid="plan-unpurchasable-cloud"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="continue-cta"]').attributes('disabled')).toBeDefined()
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

    resolveRequest(catalogResponse([canonicalCloudPlan()]))
    await flushPromises()

    expect(wrapper.find('[data-testid="plan-catalog-loading"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="plan-card-cloud"]').exists()).toBe(true)
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

    apiRequest.mockResolvedValueOnce(catalogResponse([canonicalCloudPlan()]))
    await wrapper.find('[data-testid="plan-catalog-retry"]').trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-testid="plan-catalog-error"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="plan-card-cloud"]').exists()).toBe(true)
  })

  it('asks for an active business when none is selected', async () => {
    await saveToken('token')
    const context = prepareViewContext({ subscription: { plan: 'free' }, businessId: null })
    context.cloudStore.selectedBusiness = null
    context.cloudStore.businesses = []

    const wrapper = await mountView(context)

    expect(wrapper.find('[data-testid="plan-catalog-unavailable"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="plan-catalog-hint"]').text()).toContain('bisnis aktif')
    expect(apiRequest).not.toHaveBeenCalled()
  })
})
