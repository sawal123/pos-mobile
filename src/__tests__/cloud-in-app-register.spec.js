import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { mount, flushPromises } from '@vue/test-utils'

import { apiRequest } from '../services/cloud/apiClient'
import { cloudRegister } from '../services/cloud/authService'
import { describeRegisterError } from '../services/cloud/cloudLoginErrors'
import { useCloudSessionStore } from '../stores/cloudSessionStore'
import { _resetTokenStore, getToken } from '../services/cloud/tokenRepository'
import CloudLoginView from '../views/settings/CloudLoginView.vue'

vi.mock('../services/cloud/apiClient', () => ({
  apiRequest: vi.fn(),
  resolveBaseUrl: vi.fn(() => 'https://pos.eradig.my.id'),
}))

const ok = (data) => ({ ok: true, status: 200, data: { data }, error: null })
const err = (status, code, message = 'error', data = null) => ({
  ok: false,
  status,
  data,
  error: { status, code, message, data },
})

describe('In-App Cloud Registration', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    _resetTokenStore()
    vi.clearAllMocks()
  })

  describe('authService.cloudRegister', () => {
    it('posts to /api/auth/register with user and business payload', async () => {
      apiRequest.mockResolvedValueOnce(
        ok({
          token: 'token-reg-123',
          user: { id: 5, name: 'Budi Santoso', email: 'budi@example.com' },
        }),
      )

      const result = await cloudRegister({
        name: 'Budi Santoso',
        email: 'budi@example.com',
        password: 'password123',
        password_confirmation: 'password123',
        business_name: 'Toko Budi',
      })

      expect(apiRequest).toHaveBeenCalledWith('/api/auth/register', {
        method: 'POST',
        body: {
          name: 'Budi Santoso',
          email: 'budi@example.com',
          password: 'password123',
          password_confirmation: 'password123',
          business_name: 'Toko Budi',
        },
      })
      expect(result.ok).toBe(true)
      expect(result.token).toBe('token-reg-123')
      expect(result.user.name).toBe('Budi Santoso')
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
    it('registers, saves token, and loads context on success', async () => {
      const store = useCloudSessionStore()
      apiRequest
        .mockResolvedValueOnce(
          ok({
            token: 'reg-jwt-token',
            user: { id: 99, name: 'Owner Toko', email: 'owner@toko.com' },
          }),
        )
        .mockResolvedValueOnce(
          ok({
            user: { id: 99, name: 'Owner Toko', email: 'owner@toko.com' },
            businesses: [
              {
                id: 10,
                name: 'Toko Baru',
                cloud_access: true,
                subscription: { plan: 'free', status: 'active' },
                outlets: [{ id: 101, name: 'Outlet Utama', status: 'active' }],
              },
            ],
          }),
        )

      const res = await store.register({
        name: 'Owner Toko',
        email: 'owner@toko.com',
        password: 'password123',
        password_confirmation: 'password123',
        business_name: 'Toko Baru',
      })

      expect(res.ok).toBe(true)
      expect(res.businesses).toHaveLength(1)
      expect(store.isAuthenticated).toBe(true)
      expect(store.user.name).toBe('Owner Toko')
      expect(await getToken()).toBe('reg-jwt-token')
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
