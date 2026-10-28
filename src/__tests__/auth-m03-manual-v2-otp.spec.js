import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

import { apiRequest } from '@/services/cloud/apiClient'
import { cloudRegister } from '@/services/cloud/authService'
import { useCloudSessionStore } from '@/stores/cloudSessionStore'
import CloudEmailOtpView from '@/components/cloud/auth/CloudEmailOtpView.vue'
import CloudRegisterForm from '@/components/cloud/auth/CloudRegisterForm.vue'
import { _resetTokenStore, getToken } from '@/services/cloud/tokenRepository'

vi.mock('@/services/cloud/apiClient', () => ({ apiRequest: vi.fn() }))

const pendingResponse = (registrationId = 'registration-1') => ({
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

describe('AUTH-M03 manual v2 registration and OTP', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    _resetTokenStore()
    vi.clearAllMocks()
  })

  it('uses v2 registration and a stable idempotency key for identical retries', async () => {
    apiRequest.mockResolvedValue(pendingResponse())
    const payload = {
      name: 'Budi Santoso',
      email: 'budi@example.com',
      password: 'StrongPassword123!',
      password_confirmation: 'StrongPassword123!',
      business_name: 'Toko Berkah',
    }

    await cloudRegister(payload)
    await cloudRegister(payload)

    expect(apiRequest).toHaveBeenNthCalledWith(
      1,
      '/api/v2/auth/register',
      expect.objectContaining({
        method: 'POST',
        body: payload,
        idempotencyKey: expect.stringMatching(/^[0-9a-f-]{36}$/i),
      }),
    )
    expect(apiRequest.mock.calls[0][1].idempotencyKey).toBe(apiRequest.mock.calls[1][1].idempotencyKey)
  })

  it('keeps pending registration unauthenticated and never fetches context', async () => {
    apiRequest.mockResolvedValueOnce(pendingResponse())
    const store = useCloudSessionStore()

    const result = await store.register({
      name: 'Budi Santoso',
      email: 'budi@example.com',
      password: 'StrongPassword123!',
      password_confirmation: 'StrongPassword123!',
      business_name: 'Toko Berkah',
    })

    expect(result.state).toBe('pending_email')
    expect(store.isAuthenticated).toBe(false)
    expect(await getToken()).toBeNull()
    expect(apiRequest.mock.calls.map(([path]) => path)).not.toContain('/api/mobile/context')
  })

  it('fails closed on HTTP 202 two-factor response', async () => {
    apiRequest.mockResolvedValueOnce({
      ok: true,
      status: 202,
      data: { data: { state: 'two_factor_required', challenge_id: 'challenge-1' } },
      error: null,
    })
    const store = useCloudSessionStore()

    const result = await store.login('budi@example.com', 'StrongPassword123!')

    expect(result.state).toBe('two_factor_required')
    expect(store.isAuthenticated).toBe(false)
    expect(await getToken()).toBeNull()
    expect(apiRequest).toHaveBeenCalledTimes(1)
  })

  it('accepts only six numeric OTP digits and emits a verify request', async () => {
    const wrapper = mount(CloudEmailOtpView, {
      props: {
        registrationId: 'registration-1',
        email: 'bu***@example.com',
        otpExpiresAt: '2099-01-01T00:30:00Z',
        resendAvailableAt: '2099-01-01T00:01:00Z',
      },
    })

    const input = wrapper.find('#cloud-otp-code')
    await input.setValue('12a34567')
    expect(input.element.value).toBe('123456')
    await wrapper.find('form').trigger('submit.prevent')

    expect(wrapper.emitted('verify')).toEqual([[{ registrationId: 'registration-1', code: '123456' }]])
  })

  it('requires business_name in the reusable registration UI', async () => {
    const wrapper = mount(CloudRegisterForm)
    await wrapper.find('#register-name').setValue('Budi')
    await wrapper.find('#register-email').setValue('budi@example.com')
    await wrapper.find('#register-password').setValue('StrongPassword123!')
    await wrapper.find('#register-password-confirmation').setValue('StrongPassword123!')
    await wrapper.find('form').trigger('submit.prevent')

    expect(wrapper.find('[data-testid="register-business-error"]').text()).toContain('wajib diisi')
    expect(wrapper.emitted('submit')).toBeUndefined()
  })
})
