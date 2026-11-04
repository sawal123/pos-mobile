import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { mount } from '@vue/test-utils'
import { useCashierStore } from '@/stores/cashierStore'
import { usePromoStore } from '@/stores/promoStore'
import PinConfirmationModal from '@/components/auth/PinConfirmationModal.vue'
import PromoCreateModal from '@/components/promos/PromoCreateModal.vue'
import PromosView from '@/views/promos/PromosView.vue'
import { createRouter, createMemoryHistory } from 'vue-router'

describe('Mobile Promo Feature & Cashier PIN Confirmation', () => {
  let pinia
  let cashierStore
  let promoStore
  let router

  beforeEach(() => {
    pinia = createPinia()
    setActivePinia(pinia)

    cashierStore = useCashierStore()
    promoStore = usePromoStore()

    router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/', component: { template: '<div>Home</div>' } },
        { path: '/home', component: { template: '<div>Home</div>' } },
        { path: '/promos', component: PromosView },
      ],
    })
  })

  it('1. CashierStore correctly manages and verifies cashier PIN', () => {
    // Default PIN
    expect(cashierStore.verifyPin('123456')).toBe(true)
    expect(cashierStore.verifyPin('999999')).toBe(false)

    // Custom PIN setup
    cashierStore.setPin('654321')
    expect(cashierStore.activeCashier.pin).toBe('654321')
    expect(cashierStore.activeCashier.pinConfigured).toBe(true)
    expect(cashierStore.verifyPin('654321')).toBe(true)
    expect(cashierStore.verifyPin('123456')).toBe(false)
  })

  it('2. PromoStore can create, toggle, and remove promos', () => {
    expect(promoStore.promos.length).toBe(0)

    const created = promoStore.createPromo({
      name: 'Diskon 10rb Akhir Pekan',
      code: 'WEEKEND10',
      discountType: 'fixed',
      discountValue: 10000,
      minPurchase: 50000,
      status: 'active',
    })

    expect(created.id).toBeDefined()
    expect(created.name).toBe('Diskon 10rb Akhir Pekan')
    expect(created.code).toBe('WEEKEND10')
    expect(promoStore.promos.length).toBe(1)

    // Toggle status to inactive
    const toggled = promoStore.togglePromoStatus(created.id)
    expect(toggled).toBe('inactive')
    expect(promoStore.promos[0].status).toBe('inactive')

    // Toggle status back to active
    const toggledBack = promoStore.togglePromoStatus(created.id)
    expect(toggledBack).toBe('active')
    expect(promoStore.promos[0].status).toBe('active')

    // Remove promo
    promoStore.removePromo(created.id)
    expect(promoStore.promos.length).toBe(0)
  })

  it('3. PinConfirmationModal validates PIN and emits confirmed on valid PIN', async () => {
    cashierStore.setPin('888888')

    const wrapper = mount(PinConfirmationModal, {
      props: {
        open: true,
      },
      global: {
        plugins: [pinia],
      },
    })

    // Keypad numbers
    const buttons = wrapper.findAll('[data-testid="pin-confirm-keypad"] button')
    const btn8 = buttons.find((b) => b.text().trim() === '8')
    expect(btn8).toBeDefined()

    // Enter wrong PIN (888889) -> 5 times 8, 1 time 9
    for (let i = 0; i < 5; i++) {
      await btn8.trigger('click')
    }
    const btn9 = buttons.find((b) => b.text().trim() === '9')
    await btn9.trigger('click')

    expect(wrapper.text()).toContain('PIN salah')
    expect(wrapper.emitted('confirmed')).toBeUndefined()

    // Enter correct PIN (888888)
    for (let i = 0; i < 6; i++) {
      await btn8.trigger('click')
    }

    expect(wrapper.emitted('confirmed')).toBeTruthy()
    expect(wrapper.emitted('confirmed').length).toBe(1)
  })

  it('4. PromoCreateModal requires valid form and PIN confirmation before creating promo', async () => {
    cashierStore.setPin('111222')

    const wrapper = mount(PromoCreateModal, {
      props: {
        open: true,
      },
      global: {
        plugins: [pinia],
      },
    })

    // Try submit empty form
    const submitBtn = wrapper.find('[data-testid="submit-promo-btn"]')
    await submitBtn.trigger('click')

    expect(wrapper.text()).toContain('Nama promo wajib diisi')
    expect(promoStore.promos.length).toBe(0)

    // Fill form
    const inputs = wrapper.findAll('input')
    const nameInput = inputs[0]
    await nameInput.setValue('Promo Kopi Susu Mantap')

    const discountInput = wrapper.find('input[type="number"]')
    await discountInput.setValue('5000')

    // Proceed -> opens PIN modal
    await submitBtn.trigger('click')
    expect(wrapper.findComponent(PinConfirmationModal).exists()).toBe(true)

    // Trigger confirmed event from PinConfirmationModal
    const pinModal = wrapper.findComponent(PinConfirmationModal)
    pinModal.vm.$emit('confirmed')
    await wrapper.vm.$nextTick()

    expect(promoStore.promos.length).toBe(1)
    expect(promoStore.promos[0].name).toBe('Promo Kopi Susu Mantap')
    expect(promoStore.promos[0].discountValue).toBe(5000)
    expect(wrapper.emitted('saved')).toBeTruthy()
  })

  it('5. PromosView displays promos list, search filtering, and tabs', async () => {
    promoStore.createPromo({
      name: 'Diskon Latte 50%',
      code: 'LATTE50',
      discountType: 'percent',
      discountValue: 50,
      status: 'active',
    })
    promoStore.createPromo({
      name: 'Voucher Nonaktif',
      code: 'EXPIRED1',
      discountType: 'fixed',
      discountValue: 1000,
      status: 'inactive',
    })

    const wrapper = mount(PromosView, {
      global: {
        plugins: [pinia, router],
      },
    })

    expect(wrapper.text()).toContain('Promo & Diskon')
    expect(wrapper.text()).toContain('Diskon Latte 50%')
    expect(wrapper.text()).toContain('Voucher Nonaktif')

    // Search filter
    const searchInput = wrapper.find('input[placeholder*="Cari"]')
    await searchInput.setValue('LATTE50')
    await wrapper.vm.$nextTick()

    expect(wrapper.text()).toContain('Diskon Latte 50%')
    expect(wrapper.text()).not.toContain('Voucher Nonaktif')
  })
})
