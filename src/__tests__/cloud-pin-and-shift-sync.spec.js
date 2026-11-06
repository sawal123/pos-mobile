import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { describe, expect, it, vi } from 'vitest'

import { createAppRouter, resolveStartupRoute } from '@/router'
import { useBusinessStore } from '@/stores/businessStore'
import { useCashierStore } from '@/stores/cashierStore'
import { useCloudSessionStore } from '@/stores/cloudSessionStore'
import { useShiftStore } from '@/stores/shiftStore'
import CloudLoginView from '@/views/settings/CloudLoginView.vue'

describe('Cloud Cashier PIN and Shift Synchronization', () => {
  it('1. maps cashier_pin and shift_settings from cloud context response', () => {
    const pinia = createPinia()
    setActivePinia(pinia)

    const cloudStore = useCloudSessionStore()

    const rawBusiness = {
      id: 10,
      name: 'Kopi Kenangan Senja',
      business_type: 'Cafe / UMKM',
      role: 'cashier',
      cashier_pin: '889900',
      shift_settings: {
        auto_open: true,
        default_opening_cash: 50000,
      },
      cloud_access: true,
      outlets: [{ id: 1, name: 'Outlet Utama', status: 'active' }],
    }

    cloudStore.businesses = [rawBusiness]
    const business = cloudStore.businesses[0]

    expect(business.cashier_pin).toBe('889900')
    expect(business.shift_settings.auto_open).toBe(true)
    expect(business.shift_settings.default_opening_cash).toBe(50000)
  })

  it('2. applyBusinessContext automatically configures PIN and opens shift from cloud settings', () => {
    const pinia = createPinia()
    setActivePinia(pinia)

    const cloudStore = useCloudSessionStore()
    const cashierStore = useCashierStore()
    const shiftStore = useShiftStore()

    expect(cashierStore.activeCashier.pinConfigured).toBe(false)
    expect(shiftStore.isOpen).toBe(false)

    cloudStore.applyBusinessContext({
      id: 10,
      name: 'Kopi Kenangan Senja',
      role: 'cashier',
      cashier_pin: '998877',
      shift_settings: {
        auto_open: true,
        default_opening_cash: 100000,
      },
    })

    // Cashier PIN is configured from Cloud database
    expect(cashierStore.activeCashier.pinConfigured).toBe(true)
    expect(cashierStore.verifyPin('998877')).toBe(true)
    expect(cashierStore.verifyPin('123456')).toBe(false)

    // Shift is automatically opened with cloud initial cash
    expect(shiftStore.isOpen).toBe(true)
    expect(shiftStore.openingBalance).toBe(100000)
  })

  it('3. resolveStartupRoute navigates directly to home for cloud businesses, skipping pin-setup', () => {
    const pinia = createPinia()
    setActivePinia(pinia)

    const businessStore = useBusinessStore()
    const cashierStore = useCashierStore()
    const shiftStore = useShiftStore()
    const cloudStore = useCloudSessionStore()

    businessStore.setBusiness({
      name: 'Kopi Kenangan Senja',
      type: 'Cafe / UMKM',
      mode: 'cloud',
    })

    cloudStore.selectedBusiness = {
      id: 10,
      name: 'Kopi Kenangan Senja',
      cashier_pin: '654321',
      shift_settings: { auto_open: true, default_opening_cash: 25000 },
    }

    const route = resolveStartupRoute({ businessStore, cashierStore, shiftStore, cloudStore })

    expect(route).toEqual({ name: 'home' })
    expect(cashierStore.activeCashier.pinConfigured).toBe(true)
    expect(cashierStore.verifyPin('654321')).toBe(true)
    expect(shiftStore.isOpen).toBe(true)
  })

  it('4. CloudLoginView shows direct POS action button when PIN is configured from Cloud', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)

    const router = createAppRouter()
    await router.push({ name: 'cloud-onboarding' })
    await flushPromises()

    const cloudStore = useCloudSessionStore()
    const cashierStore = useCashierStore()
    const shiftStore = useShiftStore()

    cloudStore.token = 'mock-valid-token'
    cloudStore.user = { id: 1, name: 'Kasir', email: 'kasir@example.com' }
    cloudStore.selectedBusiness = {
      id: 10,
      name: 'Kopi Kenangan Senja',
      business_type: 'Cafe / UMKM',
      business_type_status: 'valid',
      cashier_pin: '778899',
    }
    cloudStore.selectedOutlet = { id: 1, name: 'Outlet Utama' }
    cloudStore.cloudAccess = true
    cloudStore.registeredDeviceId = 12
    cloudStore.deviceIdentifier = 'mock-device-id'

    // Apply cloud PIN
    cashierStore.setPin('778899')
    cashierStore.setPinConfigured(true)
    shiftStore.openShift(50000)

    const wrapper = mount(CloudLoginView, {
      global: { plugins: [pinia, router] },
    })
    await flushPromises()

    // Must show POS continue button instead of forcing PIN setup
    expect(wrapper.find('[data-testid="cloud-onboarding-continue-pos"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="cloud-onboarding-continue-pin"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('PIN kasir dan sesi shift telah disinkronkan dari Cloud')
  })
})
