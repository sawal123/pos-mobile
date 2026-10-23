import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { describe, expect, it } from 'vitest'

import { createAppRouter } from '@/router'
import { useBusinessStore } from '@/stores/businessStore'
import { useCashStore } from '@/stores/cashStore'
import { useCashierStore } from '@/stores/cashierStore'
import { useShiftStore } from '@/stores/shiftStore'
import { useTransactionStore } from '@/stores/transactionStore'
import CloseShiftView from '@/views/shift/CloseShiftView.vue'
import OpenShiftView from '@/views/shift/OpenShiftView.vue'
import ShiftView from '@/views/shift/ShiftView.vue'

function prepareContext() {
  const pinia = createPinia()
  setActivePinia(pinia)

  const router = createAppRouter()
  const businessStore = useBusinessStore()
  const cashierStore = useCashierStore()
  const shiftStore = useShiftStore()
  const cashStore = useCashStore()
  const transactionStore = useTransactionStore()

  businessStore.setBusiness({
    name: 'Kopi Nusantara',
    type: 'Cafe / UMKM',
    owner: 'Budi',
    phone: '08123456789',
    outlet: 'Outlet Utama',
    mode: 'free',
  })
  cashierStore.setPinConfigured(true)

  return {
    pinia,
    router,
    businessStore,
    cashierStore,
    shiftStore,
    cashStore,
    transactionStore,
  }
}

describe('ShiftView — Manajemen Shift UI/UX', () => {
  it('renders active shift metrics when shift is open', async () => {
    const context = prepareContext()
    context.shiftStore.isOpen = true
    context.shiftStore.openingBalance = 150000
    context.shiftStore.openedAt = new Date().toISOString()

    context.transactionStore.items = [
      {
        id: 'tx-1',
        total: 50000,
        paymentMethod: 'cash',
        status: 'paid',
        paymentStatus: 'paid',
        createdAt: new Date().toISOString(),
      },
      {
        id: 'tx-2',
        total: 75000,
        paymentMethod: 'qris',
        status: 'paid',
        paymentStatus: 'paid',
        createdAt: new Date().toISOString(),
      },
    ]

    const wrapper = mount(ShiftView, {
      global: { plugins: [context.pinia, context.router] },
    })
    await flushPromises()

    expect(wrapper.find('[data-testid="shift-status-badge"]').text()).toContain('Shift Aktif')
    expect(wrapper.find('[data-testid="expected-cash-drawer"]').text()).toContain('200.000') // 150k + 50k cash
    expect(wrapper.find('[data-testid="metric-opening-balance"]').text()).toContain('150.000')
    expect(wrapper.find('[data-testid="metric-cash-sales"]').text()).toContain('50.000')
    expect(wrapper.find('[data-testid="metric-non-cash-sales"]').text()).toContain('75.000')
    expect(wrapper.find('[data-testid="shift-total-omzet"]').text()).toContain('125.000')
  })

  it('renders closed shift state with quick opening preset when shift is not open', async () => {
    const context = prepareContext()
    context.shiftStore.isOpen = false

    const wrapper = mount(ShiftView, {
      global: { plugins: [context.pinia, context.router] },
    })
    await flushPromises()

    expect(wrapper.find('[data-testid="shift-status-badge"]').text()).toContain('Shift Tutup')
    expect(wrapper.find('[data-testid="shift-closed-hero"]').exists()).toBe(true)

    const openBtn = wrapper.find('[data-testid="btn-open-shift"]')
    expect(openBtn.exists()).toBe(true)

    await openBtn.trigger('click')
    await flushPromises()

    expect(context.shiftStore.isOpen).toBe(true)
    expect(context.shiftStore.openingBalance).toBe(100000)
  })

  it('opens close-shift modal, computes selisih, and closes shift', async () => {
    const context = prepareContext()
    context.shiftStore.isOpen = true
    context.shiftStore.openingBalance = 100000
    context.shiftStore.openedAt = new Date().toISOString()

    const wrapper = mount(ShiftView, {
      global: { plugins: [context.pinia, context.router] },
    })
    await flushPromises()

    const triggerBtn = wrapper.find('[data-testid="btn-trigger-close-shift"]')
    await triggerBtn.trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-testid="modal-close-shift"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="close-expected-cash"]').text()).toContain('100.000')

    // Expect initial selisih banner to be pas
    expect(wrapper.find('[data-testid="cash-difference-banner"]').text()).toContain('Rp 0')

    const confirmBtn = wrapper.find('[data-testid="btn-confirm-close"]')
    await confirmBtn.trigger('click')
    await flushPromises()

    expect(context.shiftStore.isOpen).toBe(false)
    expect(wrapper.find('[data-testid="modal-close-summary"]').exists()).toBe(true)
  })

  it('records quick cash mutation in drawer', async () => {
    const context = prepareContext()
    context.shiftStore.isOpen = true
    context.shiftStore.openingBalance = 100000
    context.shiftStore.openedAt = new Date().toISOString()

    const wrapper = mount(ShiftView, {
      global: { plugins: [context.pinia, context.router] },
    })
    await flushPromises()

    await wrapper.find('[data-testid="btn-quick-mutation"]').trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-testid="modal-quick-mutation"]').exists()).toBe(true)

    const amountInput = wrapper.find('[data-testid="input-mutation-amount"] input')
    await amountInput.setValue('25000')

    await wrapper.find('[data-testid="btn-submit-mutation"]').trigger('click')
    await flushPromises()

    expect(context.cashStore.entries.length).toBeGreaterThan(0)
    expect(wrapper.find('[data-testid="expected-cash-drawer"]').text()).toContain('125.000')
  })
})

describe('OpenShiftView & CloseShiftView UI/UX', () => {
  it('OpenShiftView opens shift and routes to home', async () => {
    const context = prepareContext()
    context.shiftStore.isOpen = false

    const wrapper = mount(OpenShiftView, {
      global: { plugins: [context.pinia, context.router] },
    })
    await flushPromises()

    expect(wrapper.find('[data-testid="open-shift-card"]').exists()).toBe(true)

    await wrapper.find('[data-testid="btn-confirm-open-shift"]').trigger('click')
    await flushPromises()

    expect(context.shiftStore.isOpen).toBe(true)
    expect(context.router.currentRoute.value.path).toBe('/home')
  })

  it('CloseShiftView confirms cash count and closes shift', async () => {
    const context = prepareContext()
    context.shiftStore.isOpen = true
    context.shiftStore.openingBalance = 100000
    context.shiftStore.openedAt = new Date().toISOString()

    const wrapper = mount(CloseShiftView, {
      global: { plugins: [context.pinia, context.router] },
    })
    await flushPromises()

    expect(wrapper.find('[data-testid="close-shift-card"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="close-expected-amount"]').text()).toContain('100.000')

    await wrapper.find('[data-testid="btn-execute-close"]').trigger('click')
    await flushPromises()

    expect(context.shiftStore.isOpen).toBe(false)
  })
})
