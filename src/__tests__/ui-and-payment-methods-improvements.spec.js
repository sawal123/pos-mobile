import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import CartSummary from '@/components/pos/CartSummary.vue'
import PaymentSuccessModal from '@/components/payment/PaymentSuccessModal.vue'
import ReceiptContent from '@/components/receipt/ReceiptContent.vue'
import TransactionCard from '@/components/transaction/TransactionCard.vue'
import { useCartStore } from '@/stores/cartStore'
import { usePaymentMethodStore } from '@/stores/paymentMethodStore'
import { useTransactionStore } from '@/stores/transactionStore'
import PaymentMethodsView from '@/views/payment/PaymentMethodsView.vue'
import PaymentView from '@/views/payment/PaymentView.vue'
import PinSetupView from '@/views/onboarding/PinSetupView.vue'
import ProductFormView from '@/views/products/ProductFormView.vue'
import TransactionDetailView from '@/views/transactions/TransactionDetailView.vue'

const routerPushMock = vi.hoisted(() => vi.fn())
const routeParamsMock = vi.hoisted(() => ({ value: {} }))

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
      params: routeParamsMock.value,
    }),
  }
})

describe('UI Improvements & Master Payment Methods', () => {
  beforeEach(() => {
    routerPushMock.mockClear()
    routeParamsMock.value = {}
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

  it('7. PaymentView menampilkan nominal dan kembalian di Ringkasan Pembayaran dan membuka modal keypad saat dipilih/diklik', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)

    const cartStore = useCartStore()
    cartStore.addItem({ id: 'p1', name: 'Es Kopi', price: 20000 })

    const wrapper = mount(PaymentView, {
      global: { plugins: [pinia] },
    })

    // Cash summary section exists in Ringkasan Pembayaran
    const cashSummary = wrapper.find('[data-testid="cash-summary-section"]')
    expect(cashSummary.exists()).toBe(true)
    expect(cashSummary.text()).toContain('Uang Diterima')
    expect(cashSummary.text()).toContain('Kembalian')

    // Trigger keypad modal button
    const keypadBtn = cashSummary.find('[data-testid="btn-open-cash-modal"]')
    expect(keypadBtn.exists()).toBe(true)
    await keypadBtn.trigger('click')

    // Modal keypad is open
    expect(wrapper.text()).toContain('Kalkulator Pembayaran Tunai')
  })

  it('8. PaymentSuccessModal tombol Selesai & Tandai Siap mengubah orderStatus menjadi Siap', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)

    const trxStore = useTransactionStore()
    const trx = trxStore.addTransaction({
      id: 'trx-siap-test',
      invoiceNumber: 'INV-TEST-SIAP',
      total: 20000,
      paymentMethod: 'cash',
      paymentStatus: 'paid',
      orderStatus: 'Proses',
      createdAt: new Date().toISOString(),
      items: [{ id: 1, name: 'Kopi', price: 20000, qty: 1 }],
    })

    const wrapper = mount(PaymentSuccessModal, {
      props: {
        open: true,
        summary: trx,
      },
      global: { plugins: [pinia] },
    })

    const readyBtn = wrapper.find('[data-testid="success-complete-ready"]')
    expect(readyBtn.exists()).toBe(true)
    expect(readyBtn.text()).toContain('Selesai & Tandai Siap')

    await readyBtn.trigger('click')
    expect(wrapper.emitted('complete-ready')).toBeTruthy()

    // Status update in store
    trxStore.updateOrderStatus(trx.id, 'Siap')
    expect(trxStore.items.find((it) => it.id === trx.id).orderStatus).toBe('Siap')
  })

  it('9. TransactionDetailView tombol Lunasi Pembayaran diganti "Lunasi" dan Status Pesanan memiliki icon', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)

    const trxStore = useTransactionStore()
    const unpaidTrx = trxStore.addTransaction({
      id: 'trx-unpaid-tempo',
      invoiceNumber: 'INV-TEMPO-01',
      total: 54000,
      paymentMethod: 'unpaid',
      paymentStatus: 'unpaid',
      orderStatus: 'Proses',
      createdAt: new Date().toISOString(),
      items: [{ id: 1, name: 'Makanan', price: 54000, qty: 1 }],
    })

    routeParamsMock.value = { id: unpaidTrx.id }

    // Mount TransactionDetailView with mock route for this transaction
    const wrapper = mount(TransactionDetailView, {
      global: {
        plugins: [pinia],
      },
    })

    // Settle button shows "Lunasi" instead of "Lunasi Pembayaran"
    const settleBtn = wrapper.find('[data-testid="btn-open-settle-modal"]')
    expect(settleBtn.exists()).toBe(true)
    expect(settleBtn.text()).toBe('Lunasi')
    expect(settleBtn.text()).not.toContain('Lunasi Pembayaran')

    // Order status buttons have icons (SVG inside)
    const statusSection = wrapper.find('[data-testid="retail-order-status-section"]')
    expect(statusSection.exists()).toBe(true)
    const statusBtns = statusSection.findAll('button')
    expect(statusBtns).toHaveLength(3)
    for (const btn of statusBtns) {
      expect(btn.find('svg').exists()).toBe(true)
    }
  })
})
