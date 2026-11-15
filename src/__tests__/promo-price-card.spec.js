import { describe, it, expect, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import ProductCard from '@/components/pos/ProductCard.vue'
import { useProductStore } from '@/stores/productStore'
import { useCartStore } from '@/stores/cartStore'
import { formatCurrency } from '@/utils/formatters'

describe('Promo Price & Card Menu Discount Badge', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
  })

  it('calculates and displays discount badge (e.g. -20%) on card menu when promo price is set', () => {
    const product = {
      id: 'prod-promo-1',
      name: 'Kopi Susu Gula Aren',
      category: 'Minuman',
      price: 20000,
      promoPrice: 16000, // 20% discount
      cost: 8000,
      stock: 25,
      unit: 'cup',
      isActive: true,
      kind: 'product',
    }

    const wrapper = mount(ProductCard, {
      props: { product },
    })

    const badge = wrapper.find('[data-testid="promo-discount-badge"]')
    expect(badge.exists()).toBe(true)
    expect(badge.text()).toContain('-20%')

    // Price section shows strikethrough original price and active promo price
    expect(wrapper.text()).toContain(formatCurrency(16000))
    expect(wrapper.text()).toContain(formatCurrency(20000))
  })

  it('does not display promo discount badge when promo price is not set or zero', () => {
    const product = {
      id: 'prod-reg-1',
      name: 'Americano Ice',
      category: 'Minuman',
      price: 15000,
      promoPrice: null,
      cost: 5000,
      stock: 10,
      unit: 'cup',
      isActive: true,
      kind: 'product',
    }

    const wrapper = mount(ProductCard, {
      props: { product },
    })

    const badge = wrapper.find('[data-testid="promo-discount-badge"]')
    expect(badge.exists()).toBe(false)
    expect(wrapper.text()).toContain(formatCurrency(15000))
  })

  it('uses promo price as effective unit price when added to cart', () => {
    const cartStore = useCartStore()
    const productWithPromo = {
      id: 'prod-promo-2',
      name: 'Matcha Latte Promo',
      price: 25000,
      promoPrice: 20000, // -20%
      cost: 10000,
      stock: 15,
      unit: 'cup',
      isActive: true,
      kind: 'product',
    }

    cartStore.addItem(productWithPromo)

    expect(cartStore.items).toHaveLength(1)
    expect(cartStore.items[0].price).toBe(20000)
    expect(cartStore.subtotal).toBe(20000)
  })

  it('validates promo price in productStore', () => {
    const productStore = useProductStore()

    // 1. Promo price >= price should produce validation error
    const invalidResult = productStore.createProduct({
      name: 'Invalid Promo Product',
      category: productStore.categories[0],
      price: 20000,
      promoPrice: 25000, // Greater than price!
      cost: 10000,
      stock: 10,
      unit: 'pcs',
    })

    expect(invalidResult.success).toBe(false)
    expect(invalidResult.errors.promoPrice).toBe('Harga promo harus lebih kecil dari harga jual.')

    // 2. Valid promo price creates product successfully
    const validResult = productStore.createProduct({
      name: 'Valid Promo Product',
      category: productStore.categories[0],
      price: 20000,
      promoPrice: 16000,
      cost: 10000,
      stock: 10,
      unit: 'pcs',
    })

    expect(validResult.success).toBe(true)
    expect(validResult.product.promoPrice).toBe(16000)
  })
})
