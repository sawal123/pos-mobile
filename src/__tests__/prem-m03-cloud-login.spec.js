/**
 * PREM-M03 — Cloud Login & Tautkan Bisnis.
 *
 * Covers the M03 delta on top of the P10 cloud session foundation:
 * - link confirmation is explicit (never auto-linked)
 * - local link metadata persists and is restored on restart
 * - offline / invalid-credential / server error surfaces are friendly
 * - 401 clears the Cloud session only (local POS data untouched)
 * - revoked membership invalidates the link
 * - malformed context fails closed
 * - disconnect ("Putuskan Cloud") never destroys local data
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { mount, flushPromises } from '@vue/test-utils'

import { apiRequest } from '../services/cloud/apiClient'
import { getToken, _resetTokenStore } from '../services/cloud/tokenRepository'
import { CLOUD_LOGIN_ERROR_KIND, describeLoginError } from '../services/cloud/cloudLoginErrors'
import { useCloudSessionStore } from '../stores/cloudSessionStore'
import { useBusinessStore } from '../stores/businessStore'
import { useProductStore } from '../stores/productStore'
import { useCustomerStore } from '../stores/customerStore'
import { useTransactionStore } from '../stores/transactionStore'
import { useCashStore } from '../stores/cashStore'
import { createMemoryAdapter } from '../services/database/memoryAdapter'
import CloudLoginView from '../views/settings/CloudLoginView.vue'
import SettingsView from '../views/settings/SettingsView.vue'

vi.mock('../services/cloud/apiClient', () => ({
  apiRequest: vi.fn(),
}))

const ok = (data) => ({ ok: true, status: 200, data: { data }, error: null })
const err = (status, code, message = 'error') => ({
  ok: false,
  status,
  data: null,
  error: { status, code, message, data: null },
})

const USER = { id: 1, name: 'Test User', email: 'test@example.com' }
const TOKEN = 'test-bearer-token-prem-m03'

const BIZ_CLOUD = {
  id: 10,
  name: 'Toko Cloud',
  cloud_access: true,
  subscription: { plan: 'pro', status: 'active' },
  outlets: [{ id: 100, name: 'Outlet Utama', status: 'active' }],
  device_context: null,
}

// cloud_access=false keeps the flow on the "linked / done" step without a
// device-registration request, which keeps the component tests deterministic.
const BIZ_LOCAL_ONLY = {
  id: 20,
  name: 'Toko Tanpa Cloud',
  cloud_access: false,
  subscription: { plan: 'free', status: 'active' },
  outlets: [{ id: 200, name: 'Outlet', status: 'active' }],
  device_context: null,
}

const BIZ_B = {
  id: 21,
  name: 'Toko Kedua',
  cloud_access: false,
  subscription: { plan: 'free', status: 'active' },
  outlets: [{ id: 210, name: 'Outlet', status: 'active' }],
  device_context: null,
}

beforeEach(() => {
  setActivePinia(createPinia())
  _resetTokenStore()
  vi.clearAllMocks()
})

function seedLocalData(pinia) {
  const businessStore = useBusinessStore(pinia)
  const productStore = useProductStore(pinia)
  const customerStore = useCustomerStore(pinia)
  const transactionStore = useTransactionStore(pinia)
  const cashStore = useCashStore(pinia)

  businessStore.setBusiness({ name: 'Toko Lokal', type: 'Retail', owner: 'Pemilik', phone: '0800' })
  productStore.createProduct({
    name: 'Kopi Lokal',
    category: productStore.categories[0],
    price: 15000,
    stock: 10,
  })
  customerStore.createCustomer({ name: 'Budi', phone: '081234567' })
  transactionStore.addTransaction({
    id: 'trx-lokal-1',
    total: 15000,
    createdAt: new Date().toISOString(),
  })
  cashStore.recordEntry({ type: 'in', amount: 15000 })

  return { businessStore, productStore, customerStore, transactionStore, cashStore }
}

function snapshotLocalData(pinia) {
  const businessStore = useBusinessStore(pinia)
  const productStore = useProductStore(pinia)
  const customerStore = useCustomerStore(pinia)
  const transactionStore = useTransactionStore(pinia)
  const cashStore = useCashStore(pinia)

  return JSON.stringify({
    business: {
      name: businessStore.name,
      type: businessStore.type,
      outlet: businessStore.outlet,
    },
    products: productStore.products,
    customers: customerStore.customers,
    transactions: transactionStore.items,
    cash: cashStore.entries,
  })
}

async function mountLinkedStore(pinia, adapter, business = BIZ_CLOUD) {
  const store = useCloudSessionStore(pinia)
  store.setPersistenceAdapter(adapter)

  apiRequest
    .mockResolvedValueOnce(ok({ token: TOKEN, user: USER }))
    .mockResolvedValueOnce(ok({ user: USER, businesses: [business] }))

  await store.login(USER.email, 'secret')
  await store.selectBusiness(business.id)
  return store
}

// ════════════════════════════════════════════════════════════════════════════
// 1. Login error classification (§2, §3)
// ════════════════════════════════════════════════════════════════════════════

describe('cloudLoginErrors — login state classification', () => {
  it('classifies offline / invalid credentials / server errors', () => {
    expect(describeLoginError({ status: 0, code: 'NETWORK_ERROR' }).kind).toBe(
      CLOUD_LOGIN_ERROR_KIND.OFFLINE,
    )
    expect(describeLoginError({ status: 401, code: 'HTTP_401' }).kind).toBe(
      CLOUD_LOGIN_ERROR_KIND.INVALID_CREDENTIALS,
    )
    expect(describeLoginError({ status: 500, code: 'HTTP_500' }).kind).toBe(
      CLOUD_LOGIN_ERROR_KIND.SERVER,
    )
    expect(describeLoginError({ status: 403, code: 'EMAIL_NOT_VERIFIED' }).kind).toBe(
      CLOUD_LOGIN_ERROR_KIND.UNVERIFIED,
    )
    expect(describeLoginError({ status: 403, code: 'TWO_FACTOR_REQUIRED' }).kind).toBe(
      CLOUD_LOGIN_ERROR_KIND.TWO_FACTOR,
    )
  })

  it('offline message asks for an internet connection', () => {
    const { message } = describeLoginError({ status: 0, code: 'NETWORK_ERROR' })
    expect(message).toContain('Koneksi internet diperlukan')
  })
})

// ════════════════════════════════════════════════════════════════════════════
// 2. Offline / network login failure (§3, §6)
// ════════════════════════════════════════════════════════════════════════════

describe('offline login failure', () => {
  it('does not authenticate, saves no token, and leaves local data intact', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const adapter = createMemoryAdapter()
    await adapter.initialize()

    seedLocalData(pinia)
    const before = snapshotLocalData(pinia)

    const store = useCloudSessionStore(pinia)
    store.setPersistenceAdapter(adapter)

    apiRequest.mockResolvedValueOnce(err(0, 'NETWORK_ERROR', 'Failed to fetch'))

    const res = await store.login(USER.email, 'secret')

    expect(res.ok).toBe(false)
    expect(describeLoginError(res.error).kind).toBe(CLOUD_LOGIN_ERROR_KIND.OFFLINE)
    expect(await getToken()).toBeNull()
    expect(store.isAuthenticated).toBe(false)
    expect(snapshotLocalData(pinia)).toBe(before)
  })

  it('renders the offline message in the login form', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)

    apiRequest.mockResolvedValueOnce(err(0, 'NETWORK_ERROR', 'Failed to fetch'))

    const wrapper = mount(CloudLoginView, { global: { plugins: [pinia] } })
    await wrapper.find('#cloud-email input').setValue(USER.email)
    await wrapper.find('#cloud-password input').setValue('secret')
    await wrapper.find('#cloud-login-btn').trigger('click')
    await flushPromises()

    expect(wrapper.find('#cloud-login-error').text()).toContain('Koneksi internet diperlukan')
  })
})

// ════════════════════════════════════════════════════════════════════════════
// 3. Explicit linking (§6, §7)
// ════════════════════════════════════════════════════════════════════════════

describe('explicit linking', () => {
  it('single business requires confirmation before linking', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)

    apiRequest
      .mockResolvedValueOnce(ok({ token: TOKEN, user: USER }))
      .mockResolvedValueOnce(ok({ user: USER, businesses: [BIZ_LOCAL_ONLY] }))

    const wrapper = mount(CloudLoginView, { global: { plugins: [pinia] } })
    const store = useCloudSessionStore(pinia)

    await wrapper.find('#cloud-email input').setValue(USER.email)
    await wrapper.find('#cloud-password input').setValue('secret')
    await wrapper.find('#cloud-login-btn').trigger('click')
    await flushPromises()

    // Confirmation screen, NOT auto-linked
    expect(wrapper.find('#cloud-confirm-link').exists()).toBe(true)
    expect(wrapper.find('#cloud-logged-in').exists()).toBe(false)
    expect(store.isLinked).toBe(false)

    await wrapper.find('#cloud-confirm-link-btn').trigger('click')
    await flushPromises()

    expect(store.isLinked).toBe(true)
    expect(store.selectedBusiness.id).toBe(BIZ_LOCAL_ONLY.id)
    expect(wrapper.find('#cloud-logged-in').exists()).toBe(true)
  })

  it('multiple businesses show a picker, then a confirmation', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)

    apiRequest
      .mockResolvedValueOnce(ok({ token: TOKEN, user: USER }))
      .mockResolvedValueOnce(ok({ user: USER, businesses: [BIZ_LOCAL_ONLY, BIZ_B] }))

    const wrapper = mount(CloudLoginView, { global: { plugins: [pinia] } })
    const store = useCloudSessionStore(pinia)

    await wrapper.find('#cloud-email input').setValue(USER.email)
    await wrapper.find('#cloud-password input').setValue('secret')
    await wrapper.find('#cloud-login-btn').trigger('click')
    await flushPromises()

    expect(wrapper.find('#cloud-select-business').exists()).toBe(true)
    expect(store.isLinked).toBe(false)

    await wrapper.find(`#cloud-business-${BIZ_B.id}`).trigger('click')
    await flushPromises()

    expect(wrapper.find('#cloud-confirm-link').exists()).toBe(true)
    expect(store.isLinked).toBe(false)

    await wrapper.find('#cloud-confirm-link-btn').trigger('click')
    await flushPromises()

    expect(store.selectedBusiness.id).toBe(BIZ_B.id)
    expect(store.isLinked).toBe(true)
  })

  it('confirmation screen shows local business, cloud account and cloud business', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)

    const businessStore = useBusinessStore(pinia)
    businessStore.setBusiness({ name: 'Temuan Space', type: 'Retail' })

    apiRequest
      .mockResolvedValueOnce(ok({ token: TOKEN, user: USER }))
      .mockResolvedValueOnce(ok({ user: USER, businesses: [BIZ_LOCAL_ONLY] }))

    const wrapper = mount(CloudLoginView, { global: { plugins: [pinia] } })
    await wrapper.find('#cloud-email input').setValue(USER.email)
    await wrapper.find('#cloud-password input').setValue('secret')
    await wrapper.find('#cloud-login-btn').trigger('click')
    await flushPromises()

    const text = wrapper.find('#cloud-confirm-link').text()
    expect(text).toContain('Temuan Space')
    expect(text).toContain(USER.email)
    expect(text).toContain(BIZ_LOCAL_ONLY.name)
  })

  it('rejects an arbitrary business id not present in the membership list', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const adapter = createMemoryAdapter()
    await adapter.initialize()

    const store = useCloudSessionStore(pinia)
    store.setPersistenceAdapter(adapter)

    apiRequest
      .mockResolvedValueOnce(ok({ token: TOKEN, user: USER }))
      .mockResolvedValueOnce(ok({ user: USER, businesses: [BIZ_LOCAL_ONLY] }))

    await store.login(USER.email, 'secret')

    const res = await store.selectBusiness(999999)

    expect(res.ok).toBe(false)
    expect(store.selectedBusiness).toBeNull()
    expect(store.isLinked).toBe(false)
  })
})

// ════════════════════════════════════════════════════════════════════════════
// 4. Link persistence & restart (§8, §12)
// ════════════════════════════════════════════════════════════════════════════

describe('link persistence', () => {
  it('persists link metadata (never the token or password) and restores it', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const adapter = createMemoryAdapter()
    await adapter.initialize()

    await mountLinkedStore(pinia, adapter)

    const ctx = (await adapter.loadCloudContext()) ?? {}
    expect(ctx.selectedBusiness.id).toBe(BIZ_CLOUD.id)
    expect(typeof ctx.linkedAt).toBe('string')
    expect(JSON.stringify(ctx)).not.toContain(TOKEN)
    expect(JSON.stringify(ctx)).not.toContain('secret')

    // Simulate restart with a fresh Pinia but the same token + adapter
    const restartPinia = createPinia()
    setActivePinia(restartPinia)
    const restartStore = useCloudSessionStore(restartPinia)

    const res = await restartStore.hydrateFromStorage(adapter)

    expect(res.ok).toBe(true)
    expect(res.authenticated).toBe(true)
    expect(restartStore.isLinked).toBe(true)
    expect(restartStore.selectedBusiness.id).toBe(BIZ_CLOUD.id)
    expect(typeof restartStore.linkedAt).toBe('string')
    // A restored cache is never authoritative
    expect(restartStore.capabilityState).not.toBe('verified')
  })

  it('keeps contextCheckedAt for display after restart', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const adapter = createMemoryAdapter()
    await adapter.initialize()

    const store = await mountLinkedStore(pinia, adapter)
    const checkedAt = store.contextCheckedAt
    expect(typeof checkedAt).toBe('string')

    const restartPinia = createPinia()
    setActivePinia(restartPinia)
    const restartStore = useCloudSessionStore(restartPinia)
    await restartStore.hydrateFromStorage(adapter)

    expect(restartStore.contextCheckedAt).toBe(checkedAt)
  })
})

// ════════════════════════════════════════════════════════════════════════════
// 5. Invalid token / 401 (§13, §15)
// ════════════════════════════════════════════════════════════════════════════

describe('invalid token handling', () => {
  it('401 on refresh clears the Cloud session only and keeps local data', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const adapter = createMemoryAdapter()
    await adapter.initialize()

    seedLocalData(pinia)
    const before = snapshotLocalData(pinia)

    const store = await mountLinkedStore(pinia, adapter)

    apiRequest.mockResolvedValueOnce(err(401, 'HTTP_401', 'Unauthenticated'))
    const res = await store.refreshContext()

    expect(res.ok).toBe(false)
    expect(res.code).toBe('TOKEN_INVALID')
    expect(await getToken()).toBeNull()
    expect(store.isAuthenticated).toBe(false)
    expect(store.isLinked).toBe(false)
    expect(store.sessionInvalid).toBe(true)
    expect(store.capabilityState).toBe('unknown')
    // Local POS data is untouched
    expect(snapshotLocalData(pinia)).toBe(before)
  })

  it('does not loop: after a 401 the store is unauthenticated and skips refresh', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const adapter = createMemoryAdapter()
    await adapter.initialize()

    const store = await mountLinkedStore(pinia, adapter)
    apiRequest.mockResolvedValueOnce(err(401, 'HTTP_401'))

    await store.refreshContext()
    const callsAfterFirst = apiRequest.mock.calls.length

    const second = await store.refreshContext()

    expect(second.code).toBe('NOT_AUTHENTICATED')
    expect(apiRequest.mock.calls.length).toBe(callsAfterFirst)
  })
})

// ════════════════════════════════════════════════════════════════════════════
// 6. Membership revoked & malformed context (§14, §15)
// ════════════════════════════════════════════════════════════════════════════

describe('membership revoked', () => {
  it('invalidates the link when the linked business disappears from context', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const adapter = createMemoryAdapter()
    await adapter.initialize()

    const store = await mountLinkedStore(pinia, adapter)
    expect(store.isLinked).toBe(true)

    apiRequest.mockResolvedValueOnce(ok({ user: USER, businesses: [] }))
    const res = await store.refreshContext()

    expect(res.ok).toBe(false)
    expect(res.code).toBe('BUSINESS_ACCESS_REVOKED')
    expect(store.isLinked).toBe(false)
    expect(store.capabilityState).toBe('revoked')
    // Token still valid; only the dependent link state is dropped
    expect(await getToken()).toBe(TOKEN)
  })
})

describe('malformed context', () => {
  it('fails closed on login when businesses is not an array', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const adapter = createMemoryAdapter()
    await adapter.initialize()

    const store = useCloudSessionStore(pinia)
    store.setPersistenceAdapter(adapter)

    apiRequest
      .mockResolvedValueOnce(ok({ token: TOKEN, user: USER }))
      .mockResolvedValueOnce(ok({ user: USER, businesses: { not: 'an array' } }))

    const res = await store.login(USER.email, 'secret')

    expect(res.ok).toBe(false)
    expect(res.error.code).toBe('MALFORMED_CONTEXT')
    expect(await getToken()).toBeNull()
    expect(store.isAuthenticated).toBe(false)
    expect(store.isLinked).toBe(false)
  })

  it('fails closed on refresh without granting Cloud access', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const adapter = createMemoryAdapter()
    await adapter.initialize()

    const store = await mountLinkedStore(pinia, adapter)

    apiRequest.mockResolvedValueOnce(ok({ user: USER, businesses: 'nope' }))
    const res = await store.refreshContext()

    expect(res.ok).toBe(false)
    expect(res.code).toBe('MALFORMED_CONTEXT')
    expect(store.capabilityState).not.toBe('verified')
  })
})

// ════════════════════════════════════════════════════════════════════════════
// 7. Disconnect ("Putuskan Cloud") (§11, §9)
// ════════════════════════════════════════════════════════════════════════════

describe('disconnect', () => {
  it('clears the Cloud session and link but never local data', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const adapter = createMemoryAdapter()
    await adapter.initialize()

    seedLocalData(pinia)
    const before = snapshotLocalData(pinia)

    const store = await mountLinkedStore(pinia, adapter)
    expect(store.isLinked).toBe(true)

    apiRequest.mockResolvedValueOnce(ok(null))
    const res = await store.logout()

    expect(res.ok).toBe(true)
    expect(await getToken()).toBeNull()
    expect(store.isAuthenticated).toBe(false)
    expect(store.isLinked).toBe(false)
    expect(store.selectedBusiness).toBeNull()
    expect(store.linkedAt).toBeNull()

    const ctx = await adapter.loadCloudContext()
    expect(ctx).toBeNull()

    expect(snapshotLocalData(pinia)).toBe(before)
  })

  it('requires confirmation in the UI before disconnecting', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const adapter = createMemoryAdapter()
    await adapter.initialize()

    const store = await mountLinkedStore(pinia, adapter)

    const wrapper = mount(CloudLoginView, { global: { plugins: [pinia] } })
    await flushPromises()

    expect(wrapper.find('#cloud-logged-in').exists()).toBe(true)
    expect(wrapper.find('[data-testid="cloud-disconnect-modal"]').exists()).toBe(false)

    await wrapper.find('#cloud-disconnect-btn').trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-testid="cloud-disconnect-modal"]').exists()).toBe(true)
    // Still linked until the user confirms
    expect(store.isLinked).toBe(true)

    apiRequest.mockResolvedValueOnce(ok(null))
    await wrapper.find('#cloud-disconnect-confirm').trigger('click')
    await flushPromises()

    expect(store.isLinked).toBe(false)
  })
})

// ════════════════════════════════════════════════════════════════════════════
// 8. Settings integration (§10)
// ════════════════════════════════════════════════════════════════════════════

describe('settings cloud account card', () => {
  it('shows "Belum terhubung" and a login entry when unlinked', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)

    const wrapper = mount(SettingsView, { global: { plugins: [pinia] } })
    await flushPromises()

    expect(wrapper.find('[data-testid="cloud-account-status"]').text()).toContain('Belum terhubung')
    expect(wrapper.find('[data-testid="cloud-login-entry"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="cloud-disconnect"]').exists()).toBe(false)
  })

  it('shows the linked account, business and subscription when connected', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const adapter = createMemoryAdapter()
    await adapter.initialize()

    await mountLinkedStore(pinia, adapter, BIZ_CLOUD)

    const wrapper = mount(SettingsView, { global: { plugins: [pinia] } })
    await flushPromises()

    expect(wrapper.find('[data-testid="cloud-account-status"]').text()).toContain('Terhubung')
    expect(wrapper.find('[data-testid="cloud-account-email"]').text()).toContain(USER.email)
    expect(wrapper.find('[data-testid="cloud-account-business"]').text()).toContain(BIZ_CLOUD.name)
    expect(wrapper.find('[data-testid="cloud-disconnect"]').exists()).toBe(true)
  })
})
