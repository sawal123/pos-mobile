import { createPinia, setActivePinia } from 'pinia'
import { describe, expect, it } from 'vitest'

import { createAppRouter, resolveStartupRoute } from '@/router'
import { useBusinessStore } from '@/stores/businessStore'
import { useCashierStore } from '@/stores/cashierStore'
import { useShiftStore } from '@/stores/shiftStore'

function createContext() {
  const pinia = createPinia()
  setActivePinia(pinia)

  return {
    pinia,
    router: createAppRouter(),
    businessStore: useBusinessStore(),
    cashierStore: useCashierStore(),
    shiftStore: useShiftStore(),
  }
}

function makeBusinessReady(businessStore) {
  businessStore.setBusiness({
    name: 'Demo POS Store',
    type: 'Cafe',
    owner: 'Admin',
    phone: '08123456789',
    outlet: 'Outlet Utama',
    mode: 'free',
  })
}

describe('P26 startup routing (BUG-P26-01)', () => {
  it('fresh user: root resolves to splash', async () => {
    const { router } = createContext()

    await router.push('/')

    expect(router.currentRoute.value.name).toBe('splash')
    expect(router.currentRoute.value.fullPath).toBe('/splash')
  })

  it('business not set up: root resolves to splash', async () => {
    const { router } = createContext()

    await router.push('/')

    expect(router.currentRoute.value.name).toBe('splash')
  })

  it('business set up but pin not configured: root resolves to pin-setup', async () => {
    const { router, businessStore } = createContext()

    makeBusinessReady(businessStore)
    await router.push('/')

    expect(router.currentRoute.value.name).toBe('pin-setup')
    expect(router.currentRoute.value.fullPath).toBe('/setup/pin')
  })

  it('business and pin ready but shift closed: root resolves to open-shift', async () => {
    const { router, businessStore, cashierStore } = createContext()

    makeBusinessReady(businessStore)
    cashierStore.setPinConfigured(true)
    await router.push('/')

    expect(router.currentRoute.value.name).toBe('open-shift')
    expect(router.currentRoute.value.fullPath).toBe('/shift/open')
  })

  it('business, pin, and shift ready: root resolves to home', async () => {
    const { router, businessStore, cashierStore, shiftStore } = createContext()

    makeBusinessReady(businessStore)
    cashierStore.setPinConfigured(true)
    shiftStore.openShift(100000)
    await router.push('/')

    expect(router.currentRoute.value.name).toBe('home')
    expect(router.currentRoute.value.fullPath).toBe('/home')
  })

  it('direct protected route guards still work after startup routing', async () => {
    const { router } = createContext()

    await router.push('/pos')

    expect(router.currentRoute.value.fullPath).toBe('/setup/business')
  })
})

describe('resolveStartupRoute', () => {
  it('returns splash for fresh user', () => {
    const { businessStore, cashierStore, shiftStore } = createContext()

    expect(resolveStartupRoute({ businessStore, cashierStore, shiftStore })).toEqual({
      name: 'splash',
    })
  })

  it('returns pin-setup when business ready but pin not configured', () => {
    const { businessStore, cashierStore, shiftStore } = createContext()

    makeBusinessReady(businessStore)

    expect(resolveStartupRoute({ businessStore, cashierStore, shiftStore })).toEqual({
      name: 'pin-setup',
    })
  })

  it('returns open-shift when pin ready but shift closed', () => {
    const { businessStore, cashierStore, shiftStore } = createContext()

    makeBusinessReady(businessStore)
    cashierStore.setPinConfigured(true)

    expect(resolveStartupRoute({ businessStore, cashierStore, shiftStore })).toEqual({
      name: 'open-shift',
    })
  })

  it('returns home when business, pin, and shift are ready', () => {
    const { businessStore, cashierStore, shiftStore } = createContext()

    makeBusinessReady(businessStore)
    cashierStore.setPinConfigured(true)
    shiftStore.openShift(100000)

    expect(resolveStartupRoute({ businessStore, cashierStore, shiftStore })).toEqual({
      name: 'home',
    })
  })
})
