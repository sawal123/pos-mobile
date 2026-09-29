/**
 * PREM-M01 — Settings Free/Premium UI tests.
 *
 * Coverage:
 * - Entitlement resolution: free / premium / expired / pending / error (fail closed)
 * - Free user: FREE badge + upgrade CTA, cloud-only feature locked
 * - Premium user: PREMIUM badge + plan detail from real data
 * - Expired/pending/error never shown as active Premium
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

function setCloudContext(context, { subscription = null, businessId = 10, authenticated = true, error = null } = {}) {
  const cloud = context.cloudStore
  if (authenticated) {
    cloud.user = { id: 1, name: 'Pengguna Uji', email: 'uji@example.com' }
    cloud.businesses = [{ id: businessId, name: 'Toko A', subscription }]
    cloud.selectedBusiness = { id: businessId, name: 'Toko A', subscription }
    cloud.cloudAccess = subscription !== null
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
    expect(resolveEntitlement({ subscription: { plan: 'free' } }).isPremium).toBe(false)
  })

  it('a paid plan is Premium', () => {
    const result = resolveEntitlement({ subscription: { plan: 'pro' } })
    expect(result.status).toBe(ENTITLEMENT_STATUS.PREMIUM)
    expect(result.isPremium).toBe(true)
    expect(result.planLabel).toBe('Pro')
  })

  it('an expired status is never Premium', () => {
    expect(resolveEntitlement({ subscription: { plan: 'pro', status: 'expired' } }).status).toBe(
      ENTITLEMENT_STATUS.EXPIRED,
    )
  })

  it('a pending status is never Premium', () => {
    expect(resolveEntitlement({ subscription: { plan: 'pro', status: 'pending' } }).status).toBe(
      ENTITLEMENT_STATUS.PENDING,
    )
  })

  it('a past expiry date overrides an active paid plan', () => {
    const result = resolveEntitlement({
      subscription: { plan: 'pro', status: 'active', ends_at: '2000-01-01T00:00:00.000Z' },
    })
    expect(result.status).toBe(ENTITLEMENT_STATUS.EXPIRED)
    expect(result.isPremium).toBe(false)
  })

  it('loading and error states are distinct and not Premium', () => {
    expect(resolveEntitlement({ subscription: null, loading: true }).status).toBe(
      ENTITLEMENT_STATUS.LOADING,
    )
    const errored = resolveEntitlement({ subscription: null, error: 'boom' })
    expect(errored.status).toBe(ENTITLEMENT_STATUS.ERROR)
    expect(errored.isPremium).toBe(false)
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
    expect(wrapper.find('[data-testid="subscription-card"]').exists()).toBe(true)
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
  it('shows the PREMIUM badge with plan detail and real sync status', async () => {
    const context = prepareContext()
    setCloudContext(context, {
      subscription: { plan: 'pro', status: 'active', ends_at: '2030-01-01T00:00:00.000Z' },
    })

    const wrapper = await mountSettings(context)

    expect(wrapper.find('[data-testid="subscription-badge"]').text()).toBe('PREMIUM')
    expect(wrapper.find('[data-testid="subscription-plan"]').text()).toContain('Pro')
    expect(wrapper.find('[data-testid="subscription-expiry"]').text()).toContain('2030')
    expect(wrapper.find('[data-testid="subscription-sync-status"]').text()).toContain('aktif')
  })

  it('does not claim sync is active when the cloud is not connected', async () => {
    const context = prepareContext()
    setCloudContext(context, { subscription: { plan: 'pro' } })
    context.cloudStore.cloudAccess = false

    const wrapper = await mountSettings(context)

    expect(wrapper.find('[data-testid="subscription-badge"]').text()).toBe('PREMIUM')
    expect(wrapper.find('[data-testid="subscription-sync-status"]').text()).toContain(
      'Belum terhubung',
    )
  })

  it('unlocks the sync feature and routes to the cloud page', async () => {
    const context = prepareContext()
    setCloudContext(context, { subscription: { plan: 'pro' } })
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
    expect(badge).not.toBe('PREMIUM')
    expect(wrapper.find('[data-testid="subscription-plan"]').exists()).toBe(false)
  })

  it('shows a pending state for an unfinished payment', async () => {
    const context = prepareContext()
    setCloudContext(context, { subscription: { plan: 'pro', status: 'pending' } })
    const wrapper = await mountSettings(context)

    expect(wrapper.find('[data-testid="subscription-badge"]').text()).toBe('MENUNGGU')
  })

  it('shows an unknown state when the status cannot be resolved', async () => {
    const context = prepareContext()
    setCloudContext(context, { authenticated: false })
    context.cloudStore.user = { id: 1, name: 'Uji', email: 'uji@example.com' }
    context.cloudStore.error = 'Gagal memperbarui context cloud.'

    const wrapper = await mountSettings(context)

    expect(wrapper.find('[data-testid="subscription-badge"]').text()).toBe('TIDAK DIKETAHUI')
    expect(wrapper.find('[data-testid="subscription-badge"]').text()).not.toBe('PREMIUM')
  })
})

// ════════════════════════════════════════════════════════════════════════════
// Business context isolation
// ════════════════════════════════════════════════════════════════════════════

describe('Settings — business context isolation', () => {
  it('never shows the previous business entitlement after a context change', async () => {
    const context = prepareContext()
    setCloudContext(context, { subscription: { plan: 'pro' }, businessId: 10 })

    const wrapper = await mountSettings(context)
    expect(wrapper.find('[data-testid="subscription-badge"]').text()).toBe('PREMIUM')

    context.cloudStore.businesses = [{ id: 20, name: 'Toko B', subscription: { plan: 'free' } }]
    context.cloudStore.selectedBusiness = { id: 20, name: 'Toko B', subscription: { plan: 'free' } }
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
