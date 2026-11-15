/**
 * PAIR-01 — kasir device pairing dengan kode verifikasi 4 digit.
 *
 * Kontrak yang dijaga:
 * - kode hanya 4 digit, divalidasi sebelum ada request;
 * - request membawa kode + identitas perangkat (nama, identifier, platform,
 *   versi app, model) — IP & user agent dicatat server;
 * - error server dipetakan ke pesan Indonesia yang bisa ditindaklanjuti;
 * - pairing hanya untuk role kasir; owner/member tidak pernah melihatnya;
 * - setelah pairing, store mengisi registeredDeviceId + deviceContext dari
 *   server (bukan hanya dari response).
 */

import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import DevicePairingModal from '@/components/cloud/DevicePairingModal.vue'
import { apiRequest } from '../services/cloud/apiClient'
import {
  PAIRING_ERROR,
  collectDeviceFacts,
  defaultDeviceName,
  describePairingError,
  isValidPairingCode,
  normalizePairingCode,
  pairDeviceWithCode,
} from '../services/cloud/devicePairingService'
import { createMemoryAdapter } from '../services/database/memoryAdapter'
import { _resetTokenStore, saveToken } from '../services/cloud/tokenRepository'
import { useCloudSessionStore } from '../stores/cloudSessionStore'

vi.mock('../services/cloud/apiClient', () => ({
  apiRequest: vi.fn(),
}))

const DEVICE_IDENTIFIER = '123e4567-e89b-12d3-a456-426614174000'
const MOCK_TOKEN = 'pairing-bearer-token'

enableAutoUnmount(afterEach)

beforeEach(() => {
  setActivePinia(createPinia())
  _resetTokenStore()
  vi.clearAllMocks()
})

function makeOkResponse(data) {
  return { ok: true, status: 200, data: { data }, error: null }
}

function makeErrorResponse(status, code, message) {
  return { ok: false, status, data: null, error: { status, code, message, data: null } }
}

async function prepareStore({ role = 'cashier', registeredDeviceId = null } = {}) {
  const adapter = createMemoryAdapter()
  await adapter.initialize()

  const store = useCloudSessionStore()
  store.setPersistenceAdapter(adapter)
  store.user = { id: 5, name: 'Kasir', email: 'kasir@tokokopi.id' }
  store.selectedBusiness = { id: 10, name: 'Toko Kopi', business_type: 'cafe' }
  store.selectedOutlet = { id: 101, name: 'Outlet Pusat' }
  store.cloudAccess = true
  store.deviceIdentifier = DEVICE_IDENTIFIER
  store.registeredDeviceId = registeredDeviceId
  store.role = role
  store.capabilityState = 'verified'

  return { store, adapter }
}

describe('pairing code helpers', () => {
  it('keeps only 4 digits', () => {
    expect(normalizePairingCode('12ab34')).toBe('1234')
    expect(normalizePairingCode(' 9 8 7 6 5 ')).toBe('9876')
    expect(normalizePairingCode(null)).toBe('')
    expect(normalizePairingCode(4721)).toBe('4721')
  })

  it('accepts only a complete 4-digit code', () => {
    expect(isValidPairingCode('4721')).toBe(true)
    expect(isValidPairingCode('472')).toBe(false)
    expect(isValidPairingCode('abcd')).toBe(false)
    // Extra characters are ignored (paste/typing tolerance), so the first four
    // digits remain the code the cashier meant to type.
    expect(normalizePairingCode('47211')).toBe('4721')
  })

  it('maps server error codes to actionable Indonesian messages', () => {
    expect(describePairingError(PAIRING_ERROR.EXPIRED)).toContain('kedaluwarsa')
    expect(describePairingError(PAIRING_ERROR.ALREADY_USED)).toContain('sudah dipakai')
    expect(describePairingError(PAIRING_ERROR.CASHIER_ONLY)).toContain('owner')
    expect(describePairingError(PAIRING_ERROR.CLOUD_REQUIRED)).toContain('Cloud')
    expect(describePairingError('SOMETHING_ELSE', 'Pesan server')).toBe('Pesan server')
  })

  it('collects the device facts that are sent as pairing evidence', () => {
    const facts = collectDeviceFacts()
    expect(facts.platform).toBeTruthy()
    expect(facts.appVersion).toBeTruthy()
    expect(facts.deviceModel).toBeTruthy()
    expect(defaultDeviceName(facts)).toContain('Kasir')
  })
})

describe('pairDeviceWithCode request', () => {
  it('never calls the API for an incomplete code', async () => {
    const result = await pairDeviceWithCode({
      code: '47',
      businessId: 10,
      deviceIdentifier: DEVICE_IDENTIFIER,
      token: MOCK_TOKEN,
    })

    expect(result.ok).toBe(false)
    expect(result.error.code).toBe(PAIRING_ERROR.INVALID_CODE)
    expect(apiRequest).not.toHaveBeenCalled()
  })

  it('posts the code plus device identity to /api/mobile/devices/pair', async () => {
    apiRequest.mockResolvedValueOnce(
      makeOkResponse({
        id: 77,
        identifier: DEVICE_IDENTIFIER,
        outlet_id: 101,
        status: 'active',
        name: 'Kasir Depan',
        platform: 'web',
        outlet: { id: 101, name: 'Outlet Pusat' },
      }),
    )

    const result = await pairDeviceWithCode({
      code: '47-21',
      deviceName: 'Kasir Depan',
      businessId: 10,
      deviceIdentifier: DEVICE_IDENTIFIER,
      token: MOCK_TOKEN,
    })

    expect(result.ok).toBe(true)
    expect(result.device.id).toBe(77)

    const [path, options] = apiRequest.mock.calls[0]
    expect(path).toBe('/api/mobile/devices/pair')
    expect(options.method).toBe('POST')
    expect(options.token).toBe(MOCK_TOKEN)
    expect(options.body).toMatchObject({
      business_id: 10,
      code: '4721',
      device_identifier: DEVICE_IDENTIFIER,
      name: 'Kasir Depan',
    })
    expect(options.body.app_version).toBeTruthy()
    expect(options.body.platform).toBeTruthy()
    expect(options.body.device_model).toBeTruthy()
  })

  it('surfaces an expired code without leaking the server wording', async () => {
    apiRequest.mockResolvedValueOnce(
      makeErrorResponse(410, PAIRING_ERROR.EXPIRED, 'Kode pairing sudah kedaluwarsa.'),
    )

    const result = await pairDeviceWithCode({
      code: '4721',
      businessId: 10,
      deviceIdentifier: DEVICE_IDENTIFIER,
      token: MOCK_TOKEN,
    })

    expect(result.ok).toBe(false)
    expect(result.error.code).toBe(PAIRING_ERROR.EXPIRED)
    expect(result.error.message).toContain('30 menit')
    expect(result.error.status).toBe(410)
  })
})

describe('cloud store pairing actions', () => {
  it('rejects pairing for a non-cashier role without a network call', async () => {
    const { store } = await prepareStore({ role: 'owner' })

    const result = await store.pairDeviceWithCode({ code: '4721' })

    expect(result.ok).toBe(false)
    expect(result.code).toBe('PAIRING_CASHIER_ONLY')
    expect(apiRequest).not.toHaveBeenCalled()
  })

  it('binds the device from the server response and persists it', async () => {
    const { store, adapter } = await prepareStore()
    saveToken(MOCK_TOKEN)

    apiRequest.mockResolvedValueOnce(
      makeOkResponse({
        id: 88,
        identifier: DEVICE_IDENTIFIER,
        outlet_id: 101,
        status: 'active',
        name: 'Kasir Depan',
        platform: 'android',
        outlet: { id: 101, name: 'Outlet Pusat' },
      }),
    )

    const result = await store.pairDeviceWithCode({ code: '4721', deviceName: 'Kasir Depan' })

    expect(result.ok).toBe(true)
    expect(store.registeredDeviceId).toBe(88)
    expect(store.deviceContext).toMatchObject({ id: 88, outlet_id: 101, status: 'active' })
    expect(store.selectedOutlet).toEqual({ id: 101, name: 'Outlet Pusat' })

    const persisted = await adapter.loadCloudContext()
    expect(persisted.registeredDeviceId).toBe(88)
  })

  it('does not claim readiness for a cashier without a pairing code', async () => {
    const { store } = await prepareStore()

    expect(store.syncReadiness.ready).toBe(false)
    expect(store.syncReadiness.missing).toContain('device_registration')
  })

  it('does not require pairing metadata for an owner', async () => {
    const { store } = await prepareStore({ role: 'owner' })
    store.operationalContext = { status: 'active', cloudBusinessId: 10, outletId: 101 }

    expect(store.syncReadiness.ready).toBe(true)
    expect(store.syncReadiness.missing).not.toContain('device_registration')
  })
})

describe('ensureDeviceBinding', () => {
  it('never self-registers a cashier device', async () => {
    const { store } = await prepareStore()
    store.doRegisterDevice = vi.fn()

    const result = await store.ensureDeviceBinding()

    expect(result.ok).toBe(false)
    expect(result.code).toBe('DEVICE_NOT_REGISTERED')
    expect(store.doRegisterDevice).not.toHaveBeenCalled()
  })

  it('is a no-op when the owner device is already bound', async () => {
    const { store } = await prepareStore({ role: 'owner', registeredDeviceId: 55 })
    store.doRegisterDevice = vi.fn()

    const result = await store.ensureDeviceBinding()

    expect(result.ok).toBe(true)
    expect(result.alreadyBound).toBe(true)
    expect(store.doRegisterDevice).not.toHaveBeenCalled()
  })

  it('binds an owner device silently through the dashboard-managed endpoint', async () => {
    const { store } = await prepareStore({ role: 'owner' })
    saveToken(MOCK_TOKEN)

    apiRequest.mockResolvedValueOnce(
      makeOkResponse({
        id: 66,
        identifier: DEVICE_IDENTIFIER,
        outlet_id: 101,
        status: 'active',
        name: 'POS Mobile',
        platform: 'web',
      }),
    )

    const result = await store.ensureDeviceBinding()

    expect(result.ok).toBe(true)
    expect(store.registeredDeviceId).toBe(66)
    expect(apiRequest).toHaveBeenCalledWith(
      '/api/mobile/devices',
      expect.objectContaining({ method: 'POST' }),
    )
  })
})

describe('DevicePairingModal', () => {
  async function mountModal() {
    const pinia = createPinia()
    setActivePinia(pinia)
    const store = useCloudSessionStore()
    store.user = { id: 5, name: 'Kasir', email: 'kasir@tokokopi.id' }
    store.selectedBusiness = { id: 10, name: 'Toko Kopi' }
    store.deviceIdentifier = DEVICE_IDENTIFIER

    const wrapper = mount(DevicePairingModal, {
      props: { open: true, businessName: 'Toko Kopi' },
      global: { plugins: [pinia] },
      attachTo: document.body,
    })
    await flushPromises()

    return { wrapper, store }
  }

  it('only enables submit for a complete 4-digit code', async () => {
    const { wrapper } = await mountModal()

    const submit = wrapper.find('[data-testid="pairing-submit"]')
    expect(submit.attributes('disabled')).toBeDefined()

    await wrapper.find('[data-testid="pairing-code-input"]').setValue('47')
    expect(wrapper.find('[data-testid="pairing-submit"]').attributes('disabled')).toBeDefined()

    await wrapper.find('[data-testid="pairing-code-input"]').setValue('4721')
    expect(wrapper.find('[data-testid="pairing-submit"]').attributes('disabled')).toBeUndefined()
  })

  it('shows the real reason when the code is rejected', async () => {
    const { wrapper, store } = await mountModal()
    store.pairDeviceWithCode = vi.fn().mockResolvedValue({
      ok: false,
      code: 'PAIRING_CODE_EXPIRED',
      message: 'Kode sudah kedaluwarsa (berlaku 30 menit). Minta kode baru dari pemilik.',
    })

    await wrapper.find('[data-testid="pairing-code-input"]').setValue('4721')
    await wrapper.find('[data-testid="device-pairing-form"]').trigger('submit')
    await flushPromises()

    expect(wrapper.find('[data-testid="pairing-error"]').text()).toContain('kedaluwarsa')
  })

  it('emits "paired" after a successful pairing', async () => {
    const { wrapper, store } = await mountModal()
    const pairSpy = vi.fn().mockResolvedValue({
      ok: true,
      code: 'PAIRED',
      device: { id: 88, outlet_id: 101, name: 'Kasir Depan' },
    })
    store.pairDeviceWithCode = pairSpy

    await wrapper.find('[data-testid="pairing-code-input"]').setValue('4721')
    await wrapper.find('[data-testid="device-pairing-form"]').trigger('submit')
    await flushPromises()

    expect(pairSpy).toHaveBeenCalledWith({ code: '4721', deviceName: expect.any(String) })
    expect(wrapper.emitted('paired')).toBeTruthy()
    expect(wrapper.emitted('paired')[0][0]).toMatchObject({ id: 88 })
  })
})
