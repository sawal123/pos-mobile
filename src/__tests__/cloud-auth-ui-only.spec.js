import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

import CloudGoogleButton from '@/components/cloud/auth/CloudGoogleButton.vue'
import CloudAuthDivider from '@/components/cloud/auth/CloudAuthDivider.vue'
import CloudLoginForm from '@/components/cloud/auth/CloudLoginForm.vue'
import CloudRegisterForm from '@/components/cloud/auth/CloudRegisterForm.vue'
import CloudAuthCard from '@/components/cloud/auth/CloudAuthCard.vue'
import CloudOtpPreviewModal from '@/components/cloud/auth/CloudOtpPreviewModal.vue'
import { useCloudSessionStore } from '@/stores/cloudSessionStore'
import * as apiClient from '@/services/cloud/apiClient'

vi.mock('@/services/cloud/apiClient', () => ({
  apiRequest: vi.fn(),
}))

describe('AUTH-M02: Cloud Authentication UI-Only Components', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  describe('CloudGoogleButton.vue', () => {
    it('renders with label and Google icon', () => {
      const wrapper = mount(CloudGoogleButton, {
        props: { label: 'Lanjutkan dengan Google' },
      })

      expect(wrapper.text()).toContain('Lanjutkan dengan Google')
      expect(wrapper.find('svg').exists()).toBe(true)
      expect(wrapper.find('button').attributes('type')).toBe('button')
    })

    it('emits click event when clicked and not disabled', async () => {
      const wrapper = mount(CloudGoogleButton)
      await wrapper.find('button').trigger('click')

      expect(wrapper.emitted('click')).toHaveLength(1)
    })

    it('does not emit click when disabled or loading', async () => {
      const wrapper = mount(CloudGoogleButton, {
        props: { disabled: true },
      })
      await wrapper.find('button').trigger('click')
      expect(wrapper.emitted('click')).toBeUndefined()

      const loadingWrapper = mount(CloudGoogleButton, {
        props: { loading: true },
      })
      await loadingWrapper.find('button').trigger('click')
      expect(loadingWrapper.emitted('click')).toBeUndefined()
    })
  })

  describe('CloudAuthDivider.vue', () => {
    it('renders default and custom divider labels', () => {
      const defaultWrapper = mount(CloudAuthDivider)
      expect(defaultWrapper.text()).toContain('atau')

      const customWrapper = mount(CloudAuthDivider, {
        props: { label: 'atau daftar dengan' },
      })
      expect(customWrapper.text()).toContain('atau daftar dengan')
    })
  })

  describe('CloudLoginForm.vue', () => {
    it('renders header, email and password inputs, submit and google buttons', () => {
      const wrapper = mount(CloudLoginForm)

      expect(wrapper.find('h2').text()).toContain('Masuk ke Akun Cloud')
      expect(wrapper.find('#login-email').exists()).toBe(true)
      expect(wrapper.find('#login-password').exists()).toBe(true)
      expect(wrapper.find('[data-testid="login-submit-button"]').exists()).toBe(true)
      expect(wrapper.findComponent(CloudGoogleButton).exists()).toBe(true)
      expect(wrapper.find('[data-testid="switch-to-register-link"]').exists()).toBe(true)
    })

    it('toggles password visibility between password and text', async () => {
      const wrapper = mount(CloudLoginForm)
      const passwordInput = wrapper.find('#login-password')
      const toggleBtn = wrapper.find('[data-testid="toggle-login-password-visibility"]')

      expect(passwordInput.attributes('type')).toBe('password')

      await toggleBtn.trigger('click')
      expect(passwordInput.attributes('type')).toBe('text')

      await toggleBtn.trigger('click')
      expect(passwordInput.attributes('type')).toBe('password')
    })

    it('validates email format on blur', async () => {
      const wrapper = mount(CloudLoginForm)
      const emailInput = wrapper.find('#login-email')

      await emailInput.setValue('invalid-email')
      await emailInput.trigger('blur')

      expect(wrapper.find('[data-testid="login-email-error"]').exists()).toBe(true)
      expect(wrapper.find('[data-testid="login-email-error"]').text()).toContain('Format email tidak valid')

      await emailInput.setValue('user@example.com')
      expect(wrapper.find('[data-testid="login-email-error"]').exists()).toBe(false)
    })

    it('emits submit event with credentials locally and does NOT call backend or mutate session store', async () => {
      const sessionStore = useCloudSessionStore()
      const initialIsLoggedIn = sessionStore.isLoggedIn

      const wrapper = mount(CloudLoginForm)
      await wrapper.find('#login-email').setValue('user@example.com')
      await wrapper.find('#login-password').setValue('secret123')
      await wrapper.find('form').trigger('submit.prevent')

      expect(wrapper.emitted('submit')).toHaveLength(1)
      expect(wrapper.emitted('submit')[0][0]).toEqual({
        email: 'user@example.com',
        password: 'secret123',
      })

      // Strictly verify no network/backend call was made
      expect(apiClient.apiRequest).not.toHaveBeenCalled()

      // Strictly verify no store session mutation occurred
      expect(sessionStore.isLoggedIn).toBe(initialIsLoggedIn)
    })

    it('renders error message banner when errorMessage prop is provided', () => {
      const wrapper = mount(CloudLoginForm, {
        props: { errorMessage: 'Kredensial tidak valid' },
      })

      expect(wrapper.find('[data-testid="login-error-banner"]').exists()).toBe(true)
      expect(wrapper.find('[data-testid="login-error-banner"]').text()).toContain('Kredensial tidak valid')
    })

    it('opens informational modal on Lupa Password click without server request', async () => {
      const wrapper = mount(CloudLoginForm)
      const forgotLink = wrapper.find('[data-testid="forgot-password-link"]')

      await forgotLink.trigger('click')
      expect(wrapper.emitted('forgot-password')).toHaveLength(1)
      expect(wrapper.find('[data-testid="forgot-password-modal"]').exists()).toBe(true)
      expect(apiClient.apiRequest).not.toHaveBeenCalled()
    })
  })

  describe('CloudRegisterForm.vue', () => {
    it('renders header, inputs for name, business, email, password, and confirmation', () => {
      const wrapper = mount(CloudRegisterForm)

      expect(wrapper.find('h2').text()).toContain('Buat Akun Cloud')
      expect(wrapper.find('#register-name').exists()).toBe(true)
      expect(wrapper.find('#register-business').exists()).toBe(true)
      expect(wrapper.find('#register-email').exists()).toBe(true)
      expect(wrapper.find('#register-password').exists()).toBe(true)
      expect(wrapper.find('#register-password-confirmation').exists()).toBe(true)
      expect(wrapper.find('[data-testid="register-step-pill"]').exists()).toBe(true)
    })

    it('validates required fields, password length, and password match', async () => {
      const wrapper = mount(CloudRegisterForm)

      // Name required
      const nameInput = wrapper.find('#register-name')
      await nameInput.trigger('blur')
      expect(wrapper.find('[data-testid="register-name-error"]').text()).toContain('Nama lengkap wajib diisi')

      // Password min 8 chars
      const passInput = wrapper.find('#register-password')
      await passInput.setValue('short')
      await passInput.trigger('blur')
      expect(wrapper.find('[data-testid="register-password-error"]').text()).toContain('minimal 8 karakter')

      // Confirmation match
      const confirmInput = wrapper.find('#register-password-confirmation')
      await passInput.setValue('password123')
      await confirmInput.setValue('password999')
      await confirmInput.trigger('blur')
      expect(wrapper.find('[data-testid="register-password-confirmation-error"]').text()).toContain('tidak cocok')

      await confirmInput.setValue('password123')
      expect(wrapper.find('[data-testid="register-password-confirmation-error"]').exists()).toBe(false)
    })

    it('toggles password and confirmation visibility', async () => {
      const wrapper = mount(CloudRegisterForm)
      const passInput = wrapper.find('#register-password')
      const confirmInput = wrapper.find('#register-password-confirmation')

      await wrapper.find('[data-testid="toggle-register-password-visibility"]').trigger('click')
      expect(passInput.attributes('type')).toBe('text')

      await wrapper.find('[data-testid="toggle-register-password-confirmation-visibility"]').trigger('click')
      expect(confirmInput.attributes('type')).toBe('text')
    })

    it('displays next step notice and emits submit locally on valid form without backend call', async () => {
      const sessionStore = useCloudSessionStore()
      const initialIsLoggedIn = sessionStore.isLoggedIn

      const wrapper = mount(CloudRegisterForm)
      await wrapper.find('#register-name').setValue('Budi Santoso')
      await wrapper.find('#register-business').setValue('Toko Berkah')
      await wrapper.find('#register-email').setValue('budi@example.com')
      await wrapper.find('#register-password').setValue('rahasia123')
      await wrapper.find('#register-password-confirmation').setValue('rahasia123')

      await wrapper.find('form').trigger('submit.prevent')

      expect(wrapper.emitted('submit')).toHaveLength(1)
      expect(wrapper.emitted('submit')[0][0]).toEqual({
        name: 'Budi Santoso',
        businessName: 'Toko Berkah',
        email: 'budi@example.com',
        password: 'rahasia123',
        passwordConfirmation: 'rahasia123',
      })

      // Next step notice is shown
      expect(wrapper.find('[data-testid="register-next-step-notice"]').exists()).toBe(true)
      expect(wrapper.find('[data-testid="register-next-step-notice"]').text()).toContain('Tahap selanjutnya: Verifikasi Email')

      // No network calls made
      expect(apiClient.apiRequest).not.toHaveBeenCalled()

      // No session store changes
      expect(sessionStore.isLoggedIn).toBe(initialIsLoggedIn)
    })
  })

  describe('CloudAuthCard.vue', () => {
    it('switches between Login and Register tabs', async () => {
      const wrapper = mount(CloudAuthCard, {
        props: { modelValue: 'login' },
      })

      expect(wrapper.findComponent(CloudLoginForm).exists()).toBe(true)
      expect(wrapper.findComponent(CloudRegisterForm).exists()).toBe(false)

      // Click register tab
      await wrapper.find('[data-testid="auth-tab-register"]').trigger('click')

      expect(wrapper.emitted('update:modelValue')[0]).toEqual(['register'])
      expect(wrapper.emitted('tab-change')[0]).toEqual(['register'])
    })

    it('forwards child form events to parent', async () => {
      const wrapper = mount(CloudAuthCard, {
        props: { modelValue: 'login' },
      })

      const loginForm = wrapper.findComponent(CloudLoginForm)
      loginForm.vm.$emit('submit', { email: 'test@example.com', password: 'pass' })
      expect(wrapper.emitted('login-submit')).toHaveLength(1)

      loginForm.vm.$emit('google-click')
      expect(wrapper.emitted('google-click')).toHaveLength(1)
    })
  })

  describe('CloudOtpPreviewModal.vue', () => {
    it('renders 6-digit placeholder boxes and notice for AUTH-M03 handoff', () => {
      const wrapper = mount(CloudOtpPreviewModal, {
        props: {
          modelValue: true,
          email: 'budi@example.com',
        },
      })

      expect(wrapper.text()).toContain('Verifikasi Alamat Email')
      expect(wrapper.text()).toContain('budi@example.com')
      expect(wrapper.find('[data-testid="otp-boxes-preview"]').exists()).toBe(true)
      expect(wrapper.find('[data-testid="otp-boxes-preview"]').findAll('div')).toHaveLength(6)
      expect(wrapper.text()).toContain('Handoff ke AUTH-M03')
    })
  })

  describe('CloudAuthPreviewView.vue and Dev Route Isolation', () => {
    it('verifies /dev/cloud-auth-preview is isolated to dev environments', async () => {
      const routerModule = await import('@/router/index')
      const router = routerModule.createAppRouter()
      const devRoute = router.getRoutes().find((r) => r.name === 'dev-cloud-auth-preview')

      if (import.meta.env.DEV) {
        expect(devRoute).toBeDefined()
        expect(devRoute.path).toBe('/dev/cloud-auth-preview')
      } else {
        expect(devRoute).toBeUndefined()
      }
    })
  })
})

