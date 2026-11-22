import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import CartSummary from '@/components/pos/CartSummary.vue'
import ReceiptContent from '@/components/receipt/ReceiptContent.vue'
import TransactionCard from '@/components/transaction/TransactionCard.vue'
import { useCartStore } from '@/stores/cartStore'
import { usePaymentMethodStore } from '@/stores/paymentMethodStore'
import PaymentMethodsView from '@/views/payment/PaymentMethodsView.vue'
import PaymentView from '@/views/payment/PaymentView.vue'
import PinSetupView from '@/views/onboarding/PinSetupView.vue'
import ProductFormView from '@/views/products/ProductFormView.vue'

const routerPushMock = vi.hoisted(() => vi.fn())

vi.mock('vue-router', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    useRouter: () => ({
      push: routerPushMock,
      replace: vi.fn(),
    }),
    useRoute: () => ({
      query: {},
      params: {},
    }),
  }
})

describe('UI Improvements & Master Payment Methods', () => {
  beforeEach(() => {
    routerPushMock.mockClear()
    localStorage.clear()
  })

  it('1. PinSetupView tidak memunculkan virtual soft keyboard (inputmode="none", readonly)', () => {
    const pinia = createPinia()
    setActivePinia(pinia)

    const wrapper = mount(PinSetupView, {
      global: { plugins: [pinia] },
    })

    const input = wrapper.find('[data-testid="pin-input"]')
    expect(input.exists()).toBe(true)
    expect(input.attributes('inputmode')).toBe('none')
    expect(input.attributes('readonly')).toBeDefined()
    expect(input.attributes('tabindex')).toBe('-1')
  })

  it('2. PaymentView menampilkan nama pelanggan (ad-hoc / member) di label dan bottom bar sebelum simpan transaksi', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)

    const cartStore = useCartStore()
    cartStore.setCustomerName('Hendra')
    cartStore.addItem({ id: 'p1', name: 'Es Kopi Susu', price: 22000 })

    const wrapper = mount(PaymentView, {
      global: { plugins: [pinia] },
    })

    // Selected customer label shows "Hendra"
    const label = wrapper.find('[data-testid="selected-customer-label"]')
    expect(label.exists()).toBe(true)
    expect(label.text()).toContain('Hendra')

    // Mobile CTA contains customer name "Hendra"
    const ctaCust = wrapper.find('[data-testid="mobile-cta-customer"]')
    expect(ctaCust.exists()).toBe(true)
    expect(ctaCust.text()).toContain('Hendra')
  })

  it('3. TransactionCard tombol tambah pesanan berlabel "+ Pesanan"', () => {
    const pinia = createPinia()
    setActivePinia(pinia)

    const trx = {
      id: 'trx-123',
      invoiceNumber: 'INV-123',
      customer: 'Hendra',
      total: 22000,
      paymentMethod: 'cash',
      paymentStatus: 'paid',
      orderStatus: 'proses',
      createdAt: '2026-11-22T00:00:00Z',
      items: [{ name: 'Es Kopi Susu', qty: 1, price: 22000 }],
    }

    const wrapper = mount(TransactionCard, {
      props: { transaction: trx },
      global: { plugins: [pinia] },
    })

    const btn = wrapper.find('[data-testid="btn-card-add-items"]')
    expect(btn.exists()).toBe(true)
    expect(btn.text()).toContain('Pesanan')
    expect(btn.text()).not.toContain('Tambah Pesanan')
  })

  it('4. Switch Tampilkan di POS pada ProductFormView tidak memiliki icon centang di dalam bulatan knob', () => {
    const pinia = createPinia()
    setActivePinia(pinia)

    const wrapper = mount(ProductFormView, {
      global: { plugins: [pinia] },
    })

    const switchBtn = wrapper.find('button[role="switch"]')
    expect(switchBtn.exists()).toBe(true)
    // Checkmark SVG inside the switch button does not exist
    expect(switchBtn.find('svg').exists()).toBe(false)
  })

  it('5. CartSummary dan ReceiptContent menampilkan Diskon Rp 0 jika tidak ada diskon', () => {
    const pinia = createPinia()
    setActivePinia(pinia)

    // CartSummary with allowPromoSelect = false and discount = 0
    const summaryWrapper = mount(CartSummary, {
      props: {
        subtotal: 22000,
        discount: 0,
        total: 22000,
        allowPromoSelect: false,
      },
      global: { plugins: [pinia] },
    })

    expect(summaryWrapper.find('[data-testid="cart-summary-zero-discount"]').exists()).toBe(true)
    expect(summaryWrapper.find('[data-testid="cart-summary-zero-discount"]').text()).toContain('Rp 0')

    // ReceiptContent with discount = 0
    const receiptWrapper = mount(ReceiptContent, {
      props: {
        transaction: {
          id: 'trx-1',
          invoiceNumber: 'INV-001',
          subtotal: 22000,
          discount: 0,
          total: 22000,
          paymentMethod: 'cash',
          paymentStatus: 'paid',
          createdAt: '2026-11-22T00:00:00Z',
          items: [{ name: 'Kopi', qty: 1, price: 22000 }],
        },
      },
      global: { plugins: [pinia] },
    })

    expect(receiptWrapper.find('[data-testid="receipt-zero-discount-row"]').exists()).toBe(true)
    expect(receiptWrapper.find('[data-testid="receipt-zero-discount-row"]').text()).toContain('Rp 0')
  })

  it('6. PaymentMethodStore & PaymentMethodsView mendukung CRUD master metode pembayaran', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)

    const paymentStore = usePaymentMethodStore()
    expect(paymentStore.allMethods.length).toBeGreaterThanOrEqual(4)

    // Add new custom method
    const res = paymentStore.addMethod({
      name: 'Transfer BCA Outlet',
      type: 'transfer',
      accountNumber: '1234567890',
      accountHolder: 'Temuan Space',
      description: 'Transfer ke rekening BCA cabang',
    })
    expect(res.success).toBe(true)

    // Find added method
    const found = paymentStore.allMethods.find((m) => m.name === 'Transfer BCA Outlet')
    expect(found).toBeDefined()
    expect(found.accountNumber).toBe('1234567890')

    // Toggle active
    paymentStore.toggleMethodActive(found.id)
    expect(found.isActive).toBe(false)
    paymentStore.toggleMethodActive(found.id)
    expect(found.isActive).toBe(true)

    // Render PaymentMethodsView
    const wrapper = mount(PaymentMethodsView, {
      global: { plugins: [pinia] },
    })

    expect(wrapper.find(`[data-testid="payment-method-row-${found.id}"]`).exists()).toBe(true)
    expect(wrapper.text()).toContain('Transfer BCA Outlet')
  })
})
