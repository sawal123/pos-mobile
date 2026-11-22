import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { mount } from '@vue/test-utils'
import { usePromoStore, isPromoActive } from '@/stores/promoStore'
import { useProductStore } from '@/stores/productStore'
import { useCartStore } from '@/stores/cartStore'
import PromoCreateModal from '@/components/promos/PromoCreateModal.vue'
import PromosView from '@/views/promos/PromosView.vue'
import { createRouter, createWebHistory } from 'vue-router'

describe('Promo Quota, Product Scope, and Editing', () => {
  let router

  beforeEach(() => {
    setActivePinia(createPinia())
    router = createRouter({
      history: createWebHistory(),
      routes: [
        { path: '/', component: { template: '<div>Home</div>' } },
        { path: '/promos', component: PromosView },
      ],
    })
  })

  describe('1. Usage Quota Limit (Batas Maksimal Penggunaan Promo)', () => {
    it('isPromoActive returns true when usageCount is less than usageLimitTotal', () => {
      const promo = {
        id: 'promo-1',
        name: 'Voucher 10rb',
        discountType: 'fixed',
        discountValue: 10000,
        usageLimitTotal: 5,
        usageCount: 2,
        status: 'active',
      }
      expect(isPromoActive(promo)).toBe(true)
    })

    it('isPromoActive returns false when usageCount reaches or exceeds usageLimitTotal', () => {
      const promo = {
        id: 'promo-1',
        name: 'Voucher 10rb',
        discountType: 'fixed',
        discountValue: 10000,
        usageLimitTotal: 5,
        usageCount: 5,
        status: 'active',
      }
      expect(isPromoActive(promo)).toBe(false)

      const exceededPromo = { ...promo, usageCount: 6 }
      expect(isPromoActive(exceededPromo)).toBe(false)
    })

    it('incrementPromoUsage increases usageCount and persists', () => {
      const promoStore = usePromoStore()
      promoStore.setPromos([
        {
          id: 'promo-quota',
          name: 'Flash Sale',
          code: 'FLASH',
          discountType: 'percent',
          discountValue: 10,
          usageLimitTotal: 2,
          usageCount: 0,
          status: 'active',
        },
      ])

      expect(promoStore.activePromos.length).toBe(1)
      expect(promoStore.findPromoByCode('FLASH')).not.toBeNull()

      // First use
      promoStore.incrementPromoUsage('promo-quota')
      expect(promoStore.promos[0].usageCount).toBe(1)
      expect(promoStore.activePromos.length).toBe(1)

      // Second use -> reaches limit (2/2)
      promoStore.incrementPromoUsage('promo-quota')
      expect(promoStore.promos[0].usageCount).toBe(2)
      expect(promoStore.activePromos.length).toBe(0)
      expect(promoStore.findPromoByCode('FLASH')).toBeNull()
    })
  })

  describe('2. Scope Menu Tertentu (Specific Products Scope)', () => {
    it('calculates discount exclusively for selected products in the cart', () => {
      const promoStore = usePromoStore()
      const cartStore = useCartStore()

      const promoMenuKhusus = {
        id: 'promo-kopi',
        name: 'Diskon Kopi 50%',
        discountType: 'percent',
        discountValue: 50,
        scope: 'product',
        targets: [
          { target_type: 'product', target_sync_id: 'prod-kopi', name: 'Es Kopi Susu' },
        ],
        status: 'active',
      }

      // Cart with 1 Es Kopi Susu (Rp 20.000) and 1 Roti Bakar (Rp 15.000)
      const cartItems = [
        { id: 'prod-kopi', name: 'Es Kopi Susu', price: 20000, qty: 1 },
        { id: 'prod-roti', name: 'Roti Bakar', price: 15000, qty: 1 },
      ]

      const discount = promoStore.calculateDiscount(promoMenuKhusus, cartItems)
      // 50% discount should only apply to Es Kopi Susu (50% of 20,000 = 10,000)
      expect(discount).toBe(10000)

      // Cart with ONLY Roti Bakar (Rp 15.000)
      const cartWithoutKopi = [
        { id: 'prod-roti', name: 'Roti Bakar', price: 15000, qty: 2 },
      ]
      const zeroDiscount = promoStore.calculateDiscount(promoMenuKhusus, cartWithoutKopi)
      expect(zeroDiscount).toBe(0)
    })
  })

  describe('3. Edit Promo & Edit Menu Pilihan (Update Promo)', () => {
    it('updatePromo modifies promo fields and preserves consistency', () => {
      const promoStore = usePromoStore()
      const initial = promoStore.createPromo({
        name: 'Promo Awal',
        code: 'AWAL10',
        discountType: 'fixed',
        discountValue: 5000,
        scope: 'all',
        usageLimitTotal: 10,
      })

      expect(initial.name).toBe('Promo Awal')
      expect(initial.discountValue).toBe(5000)

      const updated = promoStore.updatePromo(initial.id, {
        name: 'Promo Diperbarui',
        discountValue: 8000,
        scope: 'product',
        targets: [
          { target_type: 'product', target_sync_id: 'prod-1', name: 'Menu 1' },
          { target_type: 'product', target_sync_id: 'prod-2', name: 'Menu 2' },
        ],
        usageLimitTotal: 25,
      })

      expect(updated.name).toBe('Promo Diperbarui')
      expect(updated.discountValue).toBe(8000)
      expect(updated.scope).toBe('product')
      expect(updated.targets.length).toBe(2)
      expect(updated.usageLimitTotal).toBe(25)

      // In store list
      expect(promoStore.promos[0].name).toBe('Promo Diperbarui')
      expect(promoStore.promos[0].discountValue).toBe(8000)
    })

    it('PromoCreateModal renders in edit mode and updates promo on PIN confirmation', async () => {
      const promoStore = usePromoStore()
      const productStore = useProductStore()

      productStore.products = [
        { id: 'prod-1', syncId: 'prod-1', name: 'Kopi Tubruk', category: 'Minuman', price: 15000 },
        { id: 'prod-2', syncId: 'prod-2', name: 'Teh Manis', category: 'Minuman', price: 8000 },
      ]

      const existingPromo = promoStore.createPromo({
        name: 'Promo Minuman',
        discountType: 'percent',
        discountValue: 20,
        scope: 'product',
        targets: [
          { target_type: 'product', target_sync_id: 'prod-1', target_id: 'prod-1', name: 'Kopi Tubruk' },
        ],
        usageLimitTotal: 50,
      })

      const wrapper = mount(PromoCreateModal, {
        props: {
          open: true,
          promo: existingPromo,
        },
      })

      // Check title displays "Edit Promo"
      expect(wrapper.text()).toContain('Edit Promo')

      // Check input fields are pre-filled
      const nameInput = wrapper.find('input[placeholder*="Diskon Kopi Senja"]')
      expect(nameInput.element.value).toBe('Promo Minuman')

      const usageLimitInput = wrapper.find('[data-testid="input-promo-usage-limit"]')
      expect(usageLimitInput.element.value).toBe('50')

      // Check scope button "Menu Tertentu" is selected
      const productScopeBtn = wrapper.find('[data-testid="scope-product"]')
      expect(productScopeBtn.classes()).toContain('border-primary')

      // Modify name and usage limit
      await nameInput.setValue('Promo Minuman Segar')
      await usageLimitInput.setValue('100')

      // Submit
      const submitBtn = wrapper.find('[data-testid="submit-promo-btn"]')
      await submitBtn.trigger('click')

      // Find PinConfirmationModal and confirm
      const pinModal = wrapper.findComponent({ name: 'PinConfirmationModal' })
      expect(pinModal.exists()).toBe(true)
      pinModal.vm.$emit('confirmed')

      // Verify updated in promoStore
      expect(promoStore.promos[0].name).toBe('Promo Minuman Segar')
      expect(promoStore.promos[0].usageLimitTotal).toBe(100)
    })
  })

  describe('4. PromosView Integration & UI Badges', () => {
    it('displays quota info, quota exhausted badge, and edit button', async () => {
      const promoStore = usePromoStore()
      promoStore.setPromos([
        {
          id: 'p-exhausted',
          name: 'Promo Habis',
          discountType: 'fixed',
          discountValue: 5000,
          scope: 'product',
          targets: [{ target_type: 'product', target_sync_id: 'prod-1' }],
          usageLimitTotal: 10,
          usageCount: 10,
          status: 'active',
        },
        {
          id: 'p-active',
          name: 'Promo Berjalan',
          discountType: 'percent',
          discountValue: 15,
          scope: 'all',
          usageLimitTotal: 50,
          usageCount: 5,
          status: 'active',
        },
      ])

      const wrapper = mount(PromosView, {
        global: {
          plugins: [router],
        },
      })

      await router.isReady()

      // Card 1: Quota Habis badge
      expect(wrapper.text()).toContain('Kuota Habis')
      expect(wrapper.text()).toContain('Menu tertentu (1 menu)')

      // Card 2: Quota progress
      expect(wrapper.text()).toContain('Kuota: 5 / 50')

      // Edit buttons exist
      const editButtons = wrapper.findAll('[data-testid="btn-edit-promo"]')
      expect(editButtons.length).toBe(2)

      // Clicking edit button opens modal with promo
      await editButtons[0].trigger('click')
      const modal = wrapper.findComponent(PromoCreateModal)
      expect(modal.props('open')).toBe(true)
      expect(modal.props('promo').id).toBe('p-exhausted')
    })
  })
})
