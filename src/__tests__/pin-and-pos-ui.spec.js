import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import CategoryPill from '@/components/pos/CategoryPill.vue'
import ProductCard from '@/components/pos/ProductCard.vue'
import { useCartStore } from '@/stores/cartStore'
import { useCashierStore } from '@/stores/cashierStore'
import { useThemeStore } from '@/stores/themeStore'
import CashView from '@/views/cash/CashView.vue'
import PinSetupView from '@/views/onboarding/PinSetupView.vue'
import PosView from '@/views/pos/PosView.vue'

const routerPushMock = vi.hoisted(() => vi.fn())

vi.mock('vue-router', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    useRouter: () => ({
      push: routerPushMock,
    }),
  }
})

describe('PinSetupView, Floating Cart FAB & Theme Cards/Badges', () => {
  beforeEach(() => {
    routerPushMock.mockClear()
    window.localStorage.clear()
    document.documentElement.classList.remove('dark')
  })

  it('PinSetupView mendukung input numpad 6 digit, hapus, lihat PIN, dan simpan ke /shift/open', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const cashierStore = useCashierStore()

    const wrapper = mount(PinSetupView, {
      global: { plugins: [pinia] },
    })

    const saveBtn = wrapper.find('[data-testid="pin-save-btn"]')
    expect(saveBtn.attributes('disabled')).toBeDefined()

    for (const digit of ['1', '2', '3', '4', '5', '6']) {
      await wrapper.find(`[data-testid="pin-key-${digit}"]`).trigger('click')
    }

    expect(saveBtn.attributes('disabled')).toBeUndefined()

    await wrapper.find('[data-testid="pin-visibility-toggle"]').trigger('click')
    expect(wrapper.find('[data-testid="pin-slots"]').text()).toContain('123456')

    await wrapper.find('[data-testid="pin-key-backspace"]').trigger('click')
    expect(saveBtn.attributes('disabled')).toBeDefined()
    await wrapper.find('[data-testid="pin-key-9"]').trigger('click')
    expect(saveBtn.attributes('disabled')).toBeUndefined()

    await saveBtn.trigger('click')
    expect(cashierStore.activeCashier.pinConfigured).toBe(true)
    expect(routerPushMock).toHaveBeenCalledWith('/shift/open')
  })

  it('PosView menampilkan tombol circle ngambang dengan icon keranjang & badge total qty, dan membuka detail saat diklik', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const themeStore = useThemeStore()
    const cartStore = useCartStore()

    themeStore.setTheme('dark')
    cartStore.addItem({
      id: 'prod-1',
      name: 'Kopi Susu',
      category: 'Coffee',
      price: 20000,
      stock: 92,
      unit: 'pcs',
    })
    cartStore.increaseQty('prod-1') // qty = 2
    cartStore.addItem({
      id: 'prod-2',
      name: 'Teh Manis',
      category: 'Non Coffee',
      price: 8000,
      stock: 50,
      unit: 'pcs',
    }) // totalQty = 3

    const posWrapper = mount(PosView, {
      global: { plugins: [pinia] },
    })
    await flushPromises()

    const fabBtn = posWrapper.find('[data-testid="mobile-cart-summary"]')
    expect(fabBtn.exists()).toBe(true)
    expect(fabBtn.classes()).toContain('rounded-full')

    const qtyBadge = posWrapper.find('[data-testid="mobile-cart-qty-badge"]')
    expect(qtyBadge.exists()).toBe(true)
    expect(qtyBadge.text()).toBe('3')

    // Detail sheet hidden before click, opens when FAB clicked
    expect(posWrapper.find('[data-testid="mobile-cart-sheet"]').exists()).toBe(false)
    await fabBtn.trigger('click')
    await flushPromises()
    expect(posWrapper.find('[data-testid="mobile-cart-sheet"]').exists()).toBe(true)

    const pillWrapper = mount(CategoryPill, {
      props: { label: 'Coffee', active: false },
    })
    expect(pillWrapper.classes()).toContain('bg-card')

    const cardWrapper = mount(ProductCard, {
      props: {
        product: {
          id: 'prod-1',
          name: 'Kopi Susu',
          category: 'Coffee',
          price: 20000,
          stock: 92,
          unit: 'pcs',
        },
      },
    })
    expect(cardWrapper.html()).toContain('dark:from-[#1F273E]')
  })

  it('CashView merender semua card dan badge sesuai tema light maupun dark', () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const themeStore = useThemeStore()
    themeStore.setTheme('dark')

    const wrapper = mount(CashView, {
      global: { plugins: [pinia] },
    })

    const cashInCard = wrapper.find('[data-testid="cash-in-summary-card"]')
    const cashOutCard = wrapper.find('[data-testid="cash-out-summary-card"]')
    expect(cashInCard.exists()).toBe(true)
    expect(cashOutCard.exists()).toBe(true)
    expect(cashInCard.html()).toContain('dark:bg-emerald-500/10')
    expect(cashOutCard.html()).toContain('dark:bg-rose-500/10')
  })
})
