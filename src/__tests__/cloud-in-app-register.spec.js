import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { mount } from '@vue/test-utils'

import { apiRequest } from '../services/cloud/apiClient'
import { clearPendingRegistrationMetadata, cloudRegister } from '../services/cloud/authService'
import { describeRegisterError } from '../services/cloud/cloudLoginErrors'
import { useCloudSessionStore } from '../stores/cloudSessionStore'
import { _resetTokenStore, getToken } from '../services/cloud/tokenRepository'
import CloudLoginView from '../views/settings/CloudLoginView.vue'

vi.mock('../services/cloud/apiClient', () => ({
  apiRequest: vi.fn(),
}))

const pending = (registrationId = 'registration-123') => ({
  ok: true,
  status: 202,
  data: {
    message: 'Jika alamat email dapat digunakan, instruksi verifikasi telah dikirim.',
    data: {
      registration_id: registrationId,
      state: 'pending_email',
      otp_expires_at: '2099-01-01T00:30:00Z',
      resend_available_at: '2099-01-01T00:01:00Z',
    },
  },
  error: null,
})

describe('In-App Cloud Registration', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    _resetTokenStore()
    clearPendingRegistrationMetadata()
    vi.clearAllMocks()
  })

  describe('authService.cloudRegister', () => {
    it('posts to /api/v2/auth/register with user and business payload', async () => {
      apiRequest.mockResolvedValueOnce(pending())

      const result = await cloudRegister({
        name: 'Budi Santoso',
        email: 'budi@example.com',
        password: 'password123',
        password_confirmation: 'password123',
        business_name: 'Toko Budi',
      })

      expect(apiRequest).toHaveBeenCalledWith('/api/v2/auth/register', {
        method: 'POST',
        body: {
          name: 'Budi Santoso',
          email: 'budi@example.com',
          password: 'password123',
          password_confirmation: 'password123',
          business_name: 'Toko Budi',
        },
        idempotencyKey: expect.any(String),
      })
      expect(apiRequest.mock.calls[0][1].idempotencyKey).toMatch(/^[0-9a-f-]{36}$/i)
      expect(result).toMatchObject({ ok: true, state: 'pending_email' })
      expect(result.token).toBeUndefined()
    })
  })

  describe('cloudLoginErrors.describeRegisterError', () => {
    it('maps network errors to offline message', () => {
      expect(describeRegisterError({ status: 0, code: 'NETWORK_ERROR' }).kind).toBe('offline')
    })

    it('maps 422 duplicate email validation error cleanly', () => {
      const error = describeRegisterError({
        status: 422,
        data: {
          errors: {
            email: ['The email has already been taken.'],
          },
        },
      })
      expect(error.kind).toBe('validation')
      expect(error.message).toContain('Email sudah terdaftar')
    })
  })

  describe('cloudSessionStore.register', () => {
    it('keeps registration pending without token or Cloud context', async () => {
      const store = useCloudSessionStore()
      apiRequest.mockResolvedValueOnce(pending('registration-456'))

      const res = await store.register({
        name: 'Owner Toko',
        email: 'owner@toko.com',
        password: 'password123',
        password_confirmation: 'password123',
        business_name: 'Toko Baru',
      })

      expect(res).toMatchObject({ ok: true, state: 'pending_email' })
      expect(store.isAuthenticated).toBe(false)
      expect(await getToken()).toBeNull()
      expect(apiRequest.mock.calls.map(([path]) => path)).not.toContain('/api/mobile/context')
    })
  })

  describe('CloudLoginView in-app registration UI', () => {
    it('switches between login and register tabs', async () => {
      const wrapper = mount(CloudLoginView)

      expect(wrapper.find('#cloud-email').exists()).toBe(true)
      expect(wrapper.find('#cloud-register-name').exists()).toBe(false)

      await wrapper.find('#cloud-tab-register').trigger('click')

      expect(wrapper.find('#cloud-register-name').exists()).toBe(true)
      expect(wrapper.find('#cloud-register-email').exists()).toBe(true)
      expect(wrapper.find('#cloud-register-password').exists()).toBe(true)
      expect(wrapper.find('#cloud-register-password-confirmation').exists()).toBe(true)

      await wrapper.find('#cloud-tab-login').trigger('click')
      expect(wrapper.find('#cloud-email').exists()).toBe(true)
    })
  })
})
