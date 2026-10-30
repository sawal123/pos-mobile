import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createAppRouter } from '@/router'
import { useCashierStore } from '@/stores/cashierStore'
import { useCloudSessionStore } from '@/stores/cloudSessionStore'
import BusinessSetupView from '@/views/onboarding/BusinessSetupView.vue'
import WelcomeView from '@/views/onboarding/WelcomeView.vue'
import CloudLoginView from '@/views/settings/CloudLoginView.vue'

const routerMock = vi.hoisted(() => ({
  push: vi.fn(),
}))

const currentRouteMock = vi.hoisted(() => ({
  name: 'cloud-onboarding',
  path: '/setup/cloud',
  query: {},
}))

vi.mock('vue-router', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    useRouter: () => routerMock,
    useRoute: () => currentRouteMock,
  }
})

describe('Onboarding Account Choice Flow', () => {
  beforeEach(() => {
    routerMock.push.mockClear()
    currentRouteMock.name = 'cloud-onboarding'
    currentRouteMock.path = '/setup/cloud'
    currentRouteMock.query = {}
  })

  describe('WelcomeView', () => {
    it('renders options for both existing account and new business setup', () => {
      const pinia = createPinia()
      setActivePinia(pinia)

      const wrapper = mount(WelcomeView, {
        global: { plugins: [pinia] },
      })

      expect(wrapper.find('[data-testid="welcome-has-account"]').exists()).toBe(true)
      expect(wrapper.find('[data-testid="welcome-new-business"]').exists()).toBe(true)
      expect(wrapper.text()).toContain('Sudah punya akun')
      expect(wrapper.text()).toContain('Belum punya akun')
    })

    it('navigates to cloud-onboarding when user clicks Sudah punya akun', async () => {
      const pinia = createPinia()
      setActivePinia(pinia)

      const wrapper = mount(WelcomeView, {
        global: { plugins: [pinia] },
      })

      await wrapper.find('#welcome-has-account-btn').trigger('click')
      expect(routerMock.push).toHaveBeenCalledWith({ name: 'cloud-onboarding' })
    })

    it('navigates to business-setup when user clicks Belum punya akun', async () => {
      const pinia = createPinia()
      setActivePinia(pinia)

      const wrapper = mount(WelcomeView, {
        global: { plugins: [pinia] },
      })

      await wrapper.find('#welcome-new-business-btn').trigger('click')
      expect(routerMock.push).toHaveBeenCalledWith({ name: 'business-setup' })
    })
  })

  describe('Router Guards & Route Accessibility', () => {
    it('allows accessing /setup/cloud even when business is not setup', async () => {
      const pinia = createPinia()
      setActivePinia(pinia)
      const router = createAppRouter()

      await router.push('/setup/cloud')
      expect(router.currentRoute.value.name).toBe('cloud-onboarding')
      expect(router.currentRoute.value.fullPath).toBe('/setup/cloud')
    })

    it('redirects protected routes to business-setup when business is not setup', async () => {
      const pinia = createPinia()
      setActivePinia(pinia)
      const router = createAppRouter()

      await router.push('/pos')
      expect(router.currentRoute.value.name).toBe('business-setup')
      expect(router.currentRoute.value.fullPath).toBe('/setup/business')
    })
  })

  describe('BusinessSetupView quick-switch to Cloud', () => {
    it('provides a back button and a link to switch to cloud onboarding', async () => {
      const pinia = createPinia()
      setActivePinia(pinia)

      const wrapper = mount(BusinessSetupView, {
        global: { plugins: [pinia] },
      })

      expect(wrapper.find('[data-testid="business-setup-back"]').exists()).toBe(true)
      expect(wrapper.find('[data-testid="business-setup-switch-cloud"]').exists()).toBe(true)

      await wrapper.find('#business-setup-back-btn').trigger('click')
      expect(routerMock.push).toHaveBeenCalledWith({ name: 'welcome' })

      await wrapper.find('#business-setup-switch-cloud-btn').trigger('click')
      expect(routerMock.push).toHaveBeenCalledWith({ name: 'cloud-onboarding' })
    })
  })

  describe('CloudLoginView onboarding mode', () => {
    it('renders onboarding header and back button on login step', () => {
      const pinia = createPinia()
      setActivePinia(pinia)

      const wrapper = mount(CloudLoginView, {
        global: { plugins: [pinia] },
      })

      expect(wrapper.find('[data-testid="cloud-onboarding-back"]').exists()).toBe(true)
      expect(wrapper.text()).toContain('Masuk ke Akun Cloud')
      expect(wrapper.get('[data-testid="cloud-page-header"] h1').text()).toBe('Masuk ke Akun Cloud')
    })

    it('navigates back to welcome when clicking back button', async () => {
      const pinia = createPinia()
      setActivePinia(pinia)

      const wrapper = mount(CloudLoginView, {
        global: { plugins: [pinia] },
      })

      await wrapper.find('#cloud-onboarding-back-btn').trigger('click')
      expect(routerMock.push).toHaveBeenCalledWith({ name: 'welcome' })
    })

    it('displays onboarding next step card to setup PIN when linked', async () => {
      const pinia = createPinia()
      setActivePinia(pinia)

      const cloudStore = useCloudSessionStore()
      const cashierStore = useCashierStore()

      // Simulate linked business state with unconfigured pin
      cloudStore.user = { id: 1, name: 'Owner', email: 'owner@example.com' }
      cloudStore.selectedBusiness = {
        id: 1,
        name: 'Kopi Nusantara',
        business_type: 'Cafe',
        business_type_status: 'valid',
      }
      cloudStore.selectedOutlet = { id: 1, name: 'Outlet Utama' }
      cloudStore.cloudAccess = true
      cloudStore.registeredDeviceId = 6
      cloudStore.deviceIdentifier = 'mock-device-id'
      cashierStore.setPinConfigured(false)

      const wrapper = mount(CloudLoginView, {
        global: { plugins: [pinia] },
      })
      await flushPromises()

      expect(wrapper.find('[data-testid="cloud-onboarding-next"]').exists()).toBe(true)
      expect(wrapper.text()).toContain('Siap mulai berjualan')
      expect(wrapper.get('[data-testid="cloud-page-header"] h1').text()).toBe('Cloud Anda')
      expect(wrapper.find('[data-testid="cloud-google-link-card"]').exists()).toBe(false)
      expect(wrapper.find('[data-testid="email-change-card"]').exists()).toBe(false)
      expect(wrapper.text()).toContain('Kopi Nusantara')

      const continueBtn = wrapper.find('#cloud-onboarding-continue-pin-btn')
      expect(continueBtn.exists()).toBe(true)
      await continueBtn.trigger('click')
      expect(routerMock.push).toHaveBeenCalledWith({ name: 'pin-setup' })
    })
  })
})
