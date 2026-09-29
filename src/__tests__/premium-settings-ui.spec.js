/**
 * PREM-M01 — Settings Free/Premium UI tests.
 *
 * Coverage:
 * - Entitlement resolution: free / premium / expired / pending / unverified / error
 *   (strict fail-closed: active Premium needs a known paid plan + `active` status
 *   + a verified context)
 * - Free user: FREE badge + upgrade CTA, cloud-only feature locked
 * - Premium user: PREMIUM badge + plan detail from real data
 * - Unknown/empty/expired/pending/failed-refresh never shown as active Premium
 * - Cloud access is shown separately from the last sync run
 * - Local backup stays reachable for Free users
 * - Subscription card navigation and locked-feature modal
 * - Business context change never shows the previous entitlement
 */

import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { nextTick } from 'vue'
import { beforeEach, describe, expect, it } from 'vitest'

import { createAppRouter } from '@/router'
import { ENTITLEMENT_STATUS, resolveEntitlement } from '@/services/subscription/entitlementService'
import { useBusinessStore } from '@/stores/businessStore'
import { useCashierStore } from '@/stores/cashierStore'
import { useCloudSessionStore } from '@/stores/cloudSessionStore'
import { useSubscriptionStore } from '@/stores/subscriptionStore'
import SettingsView from '@/views/settings/SettingsView.vue'
import SubscriptionView from '@/views/subscription/SubscriptionView.vue'

const FUTURE = '2030-01-01T00:00:00.000Z'
const PAST = '2000-01-01T00:00:00.000Z'

function prepareContext() {
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

  return {
    pinia,
    router: createAppRouter(),
    businessStore,
    cloudStore: useCloudSessionStore(),
    subscription: useSubscriptionStore(),
  }
}

function setCloudContext(
  context,
  {
    subscription = null,
    businessId = 10,
    authenticated = true,
    capabilityState = 'verified',
    cloudAccess = true,
    error = null,
  } = {},
) {
  const cloud = context.cloudStore
  if (authenticated) {
    cloud.user = { id: 1, name: 'Pengguna Uji', email: 'uji@example.com' }
    cloud.businesses = [{ id: businessId, name: 'Toko A', subscription }]
    cloud.selectedBusiness = { id: businessId, name: 'Toko A', subscription }
    cloud.cloudAccess = cloudAccess
    cloud.capabilityState = capabilityState
  }
  cloud.error = error
}

async function mountSettings(context) {
  await context.router.push('/settings')
  await flushPromises()

  const wrapper = mount(SettingsView, {
    global: { plugins: [context.pinia, context.router] },
  })
  await flushPromises()

  return wrapper
}

beforeEach(() => {
  setActivePinia(createPinia())
})

// ════════════════════════════════════════════════════════════════════════════
// Entitlement resolution (pure)
// ════════════════════════════════════════════════════════════════════════════

describe('entitlement resolution', () => {
  it('no subscription fails closed to Free', () => {
    const result = resolveEntitlement({ subscription: null })
    expect(result.status).toBe(ENTITLEMENT_STATUS.FREE)
    expect(result.isPremium).toBe(false)
  })

  it('a free plan is Free, not Premium', () => {
    const result = resolveEntitlement({ subscription: { plan: 'free' }, verified: true })
    expect(result.status).toBe(ENTITLEMENT_STATUS.FREE)
    expect(result.isPremium).toBe(false)
  })

  it('a known paid plan with status active in a verified context is Premium', () => {
    const result = resolveEntitlement({
      subscription: { plan: 'pro', status: 'active' },
      verified: true,
    })
    expect(result.status).toBe(ENTITLEMENT_STATUS.PREMIUM)
    expect(result.isPremium).toBe(true)
    expect(result.planLabel).toBe('Pro')
  })

  it('an active paid plan is NOT Premium when the context is unverified', () => {
    const result = resolveEntitlement({
      subscription: { plan: 'pro', status: 'active' },
      verified: false,
    })
    expect(result.status).toBe(ENTITLEMENT_STATUS.UNVERIFIED)
    expect(result.isPremium).toBe(false)
    expect(result.stale).toBe(true)
  })

  it('an unknown (missing) status is unverified, never Premium', () => {
    const result = resolveEntitlement({ subscription: { plan: 'pro' }, verified: true })
    expect(result.status).toBe(ENTITLEMENT_STATUS.UNVERIFIED)
    expect(result.isPremium).toBe(false)
  })

  it('an empty status is unverified, never Premium', () => {
    const result = resolveEntitlement({
      subscription: { plan: 'pro', status: '   ' },
      verified: true,
    })
    expect(result.status).toBe(ENTITLEMENT_STATUS.UNVERIFIED)
    expect(result.isPremium).toBe(false)
  })

  it('an unrecognised plan is unverified, never Premium', () => {
    const result = resolveEntitlement({
      subscription: { plan: 'mystery-tier', status: 'active' },
      verified: true,
    })
    expect(result.status).toBe(ENTITLEMENT_STATUS.UNVERIFIED)
    expect(result.isPremium).toBe(false)
  })

  it('an expired status is never Premium', () => {
    expect(
      resolveEntitlement({ subscription: { plan: 'pro', status: 'expired' }, verified: true }).status,
    ).toBe(ENTITLEMENT_STATUS.EXPIRED)
  })

  it('a past expiry date overrides an active paid plan', () => {
    const result = resolveEntitlement({
      subscription: { plan: 'pro', status: 'active', ends_at: PAST },
      verified: true,
    })
    expect(result.status).toBe(ENTITLEMENT_STATUS.EXPIRED)
    expect(result.isPremium).toBe(false)
  })

  it('an unparseable expiry date is unverified', () => {
    const result = resolveEntitlement({
      subscription: { plan: 'pro', status: 'active', ends_at: 'not-a-date' },
      verified: true,
    })
    expect(result.status).toBe(ENTITLEMENT_STATUS.UNVERIFIED)
    expect(result.isPremium).toBe(false)
  })

  it('a pending status is never Premium', () => {
    expect(
      resolveEntitlement({ subscription: { plan: 'pro', status: 'pending' }, verified: true }).status,
    ).toBe(ENTITLEMENT_STATUS.PENDING)
  })

  it('loading is distinct and not Premium', () => {
    expect(resolveEntitlement({ subscription: null, loading: true }).status).toBe(
      ENTITLEMENT_STATUS.LOADING,
    )
  })

  it('a failed refresh with no prior data is an error', () => {
    const result = resolveEntitlement({ subscription: null, error: 'boom' })
    expect(result.status).toBe(ENTITLEMENT_STATUS.ERROR)
    expect(result.isPremium).toBe(false)
  })

  it('a failed refresh keeps the last known plan but never grants Premium', () => {
    const result = resolveEntitlement({
      subscription: { plan: 'pro', status: 'active' },
      verified: true,
      error: 'refresh failed',
    })
    expect(result.status).toBe(ENTITLEMENT_STATUS.UNVERIFIED)
    expect(result.isPremium).toBe(false)
    expect(result.planLabel).toBe('Pro')
  })
})

// ════════════════════════════════════════════════════════════════════════════
// Free user
// ════════════════════════════════════════════════════════════════════════════

describe('Settings — Free state', () => {
  it('shows the FREE badge and the upgrade CTA', async () => {
    const context = prepareContext()
    setCloudContext(context, { subscription: { plan: 'free' } })

    const wrapper = await mountSettings(context)

    expect(wrapper.find('[data-testid="subscription-badge"]').text()).toBe('FREE')
    expect(wrapper.find('[data-testid="subscription-subtitle"]').text()).toContain(
      'Upgrade ke Premium',
    )
  })

  it('shows FREE when there is no cloud account at all', async () => {
    const context = prepareContext()
    const wrapper = await mountSettings(context)

    expect(wrapper.find('[data-testid="subscription-badge"]').text()).toBe('FREE')
  })

  it('locks the cloud-only sync feature with a Premium hint', async () => {
    const context = prepareContext()
    setCloudContext(context, { subscription: { plan: 'free' } })
    const wrapper = await mountSettings(context)

    const sync = wrapper.find('[data-testid="settings-menu-sync"]')
    expect(sync.attributes('aria-haspopup')).toBe('dialog')
    expect(sync.text()).toContain('Memerlukan Premium')
  })

  it('keeps the local backup menu reachable (not locked)', async () => {
    const context = prepareContext()
    setCloudContext(context, { subscription: { plan: 'free' } })
    const wrapper = await mountSettings(context)

    const backup = wrapper.find('[data-testid="settings-menu-backup"]')
    expect(backup.exists()).toBe(true)
    expect(backup.attributes('aria-haspopup')).toBeUndefined()
  })

  it('opens the locked-feature modal and routes to the subscription page', async () => {
    const context = prepareContext()
    setCloudContext(context, { subscription: { plan: 'free' } })
    const wrapper = await mountSettings(context)

    expect(wrapper.find('[data-testid="locked-feature-modal"]').exists()).toBe(false)

    await wrapper.find('[data-testid="settings-menu-sync"]').trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-testid="locked-feature-modal"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="locked-feature-message"]').text()).toContain('Premium')

    await wrapper.find('[data-testid="locked-feature-cta"]').trigger('click')
    await flushPromises()

    expect(context.router.currentRoute.value.name).toBe('subscription')
  })

  it('navigates to the subscription page when the plan card is pressed', async () => {
    const context = prepareContext()
    setCloudContext(context, { subscription: { plan: 'free' } })
    const wrapper = await mountSettings(context)

    await wrapper.find('[data-testid="subscription-card"]').trigger('click')
    await flushPromises()

    expect(context.router.currentRoute.value.name).toBe('subscription')
  })
})

// ════════════════════════════════════════════════════════════════════════════
// Premium user
// ════════════════════════════════════════════════════════════════════════════

describe('Settings — Premium state', () => {
  it('shows the PREMIUM badge with plan detail', async () => {
    const context = prepareContext()
    setCloudContext(context, {
      subscription: { plan: 'pro', status: 'active', ends_at: FUTURE },
    })

    const wrapper = await mountSettings(context)

    expect(wrapper.find('[data-testid="subscription-badge"]').text()).toBe('PREMIUM')
    expect(wrapper.find('[data-testid="subscription-plan"]').text()).toContain('Pro')
    expect(wrapper.find('[data-testid="subscription-expiry"]').text()).toContain('2030')
  })

  it('shows cloud access separately from the last sync and never claims an active sync', async () => {
    const context = prepareContext()
    setCloudContext(context, {
      subscription: { plan: 'pro', status: 'active', ends_at: FUTURE },
      cloudAccess: true,
    })

    const wrapper = await mountSettings(context)

    expect(wrapper.find('[data-testid="cloud-access-status"]').text()).toContain('Aktif')
    expect(wrapper.find('[data-testid="last-sync-status"]').text()).toContain('Belum ada riwayat')
    expect(wrapper.text()).not.toContain('Sinkronisasi cloud aktif')
  })

  it('reports cloud access as inactive when cloud_access is false, even for Premium', async () => {
    const context = prepareContext()
    setCloudContext(context, {
      subscription: { plan: 'pro', status: 'active' },
      cloudAccess: false,
    })

    const wrapper = await mountSettings(context)

    expect(wrapper.find('[data-testid="subscription-badge"]').text()).toBe('PREMIUM')
    expect(wrapper.find('[data-testid="cloud-access-status"]').text()).toContain('Tidak aktif')
  })

  it('unlocks the sync feature and routes to the cloud page', async () => {
    const context = prepareContext()
    setCloudContext(context, { subscription: { plan: 'pro', status: 'active' } })
    const wrapper = await mountSettings(context)

    const sync = wrapper.find('[data-testid="settings-menu-sync"]')
    expect(sync.attributes('aria-haspopup')).toBeUndefined()
    expect(sync.text()).toContain('Sinkronkan data')

    await sync.trigger('click')
    await flushPromises()

    expect(context.router.currentRoute.value.name).toBe('cloud')
  })
})

// ════════════════════════════════════════════════════════════════════════════
// Non-active subscription states
// ════════════════════════════════════════════════════════════════════════════

describe('Settings — inactive subscription states', () => {
  it('shows EXPIRED instead of Premium for an expired plan', async () => {
    const context = prepareContext()
    setCloudContext(context, { subscription: { plan: 'pro', status: 'expired' } })
    const wrapper = await mountSettings(context)

    const badge = wrapper.find('[data-testid="subscription-badge"]').text()
    expect(badge).toBe('EXPIRED')
    expect(wrapper.find('[data-testid="subscription-plan"]').exists()).toBe(false)
  })

  it('shows a pending state for an unfinished payment', async () => {
    const context = prepareContext()
    setCloudContext(context, { subscription: { plan: 'pro', status: 'pending' } })
    const wrapper = await mountSettings(context)

    expect(wrapper.find('[data-testid="subscription-badge"]').text()).toBe('MENUNGGU')
  })

  it('shows an unverified state for an unknown status and keeps the last known plan', async () => {
    const context = prepareContext()
    setCloudContext(context, { subscription: { plan: 'pro' } })
    const wrapper = await mountSettings(context)

    const badge = wrapper.find('[data-testid="subscription-badge"]').text()
    expect(badge).toBe('BELUM TERVERIFIKASI')
    expect(badge).not.toBe('PREMIUM')
    expect(wrapper.find('[data-testid="settings-menu-sync"]').attributes('aria-haspopup')).toBe(
      'dialog',
    )
    expect(wrapper.find('[data-testid="subscription-last-known-plan"]').text()).toContain('Pro')
  })

  it('shows an unverified state when a cached context has not been refreshed', async () => {
    const context = prepareContext()
    setCloudContext(context, {
      subscription: { plan: 'pro', status: 'active' },
      capabilityState: 'unverified',
    })
    const wrapper = await mountSettings(context)

    expect(wrapper.find('[data-testid="subscription-badge"]').text()).toBe('BELUM TERVERIFIKASI')
  })

  it('shows the unverified state with last known data after a refresh failure', async () => {
    const context = prepareContext()
    setCloudContext(context, {
      subscription: { plan: 'pro', status: 'active' },
      error: 'Gagal memperbarui context cloud.',
    })
    const wrapper = await mountSettings(context)

    expect(wrapper.find('[data-testid="subscription-badge"]').text()).toBe('BELUM TERVERIFIKASI')
    expect(wrapper.find('[data-testid="subscription-last-known-plan"]').text()).toContain('Pro')
    expect(wrapper.find('[data-testid="settings-menu-sync"]').attributes('aria-haspopup')).toBe(
      'dialog',
    )
  })

  it('shows an unknown state when there is nothing to go on', async () => {
    const context = prepareContext()
    setCloudContext(context, { authenticated: false })
    context.cloudStore.user = { id: 1, name: 'Uji', email: 'uji@example.com' }
    context.cloudStore.error = 'Gagal memperbarui context cloud.'

    const wrapper = await mountSettings(context)

    expect(wrapper.find('[data-testid="subscription-badge"]').text()).toBe('TIDAK DIKETAHUI')
  })
})

// ════════════════════════════════════════════════════════════════════════════
// Business context isolation
// ════════════════════════════════════════════════════════════════════════════

describe('Settings — business context isolation', () => {
  it('never shows the previous business entitlement after a context change', async () => {
    const context = prepareContext()
    setCloudContext(context, {
      subscription: { plan: 'pro', status: 'active' },
      businessId: 10,
    })

    const wrapper = await mountSettings(context)
    expect(wrapper.find('[data-testid="subscription-badge"]').text()).toBe('PREMIUM')

    context.cloudStore.businesses = [
      { id: 20, name: 'Toko B', subscription: { plan: 'free' } },
    ]
    context.cloudStore.selectedBusiness = {
      id: 20,
      name: 'Toko B',
      subscription: { plan: 'free' },
    }
    await nextTick()

    expect(wrapper.find('[data-testid="subscription-badge"]').text()).toBe('FREE')
  })
})

// ════════════════════════════════════════════════════════════════════════════
// Subscription placeholder view
// ════════════════════════════════════════════════════════════════════════════

describe('Subscription placeholder view', () => {
  it('renders as an explicit PREM-M02 placeholder', async () => {
    const context = prepareContext()
    await context.router.push('/subscription')
    await flushPromises()

    const wrapper = mount(SubscriptionView, {
      global: { plugins: [context.pinia, context.router] },
    })

    expect(wrapper.find('[data-testid="subscription-placeholder"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="subscription-placeholder-note"]').text()).toContain('PREM-M02')
  })
})
