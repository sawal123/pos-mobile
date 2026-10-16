/**
 * Mobile cart controls + payment CTA + payment success modal.
 *
 * Covers the Android cashier UX fixes:
 *  - the cart can be opened as a bottom sheet and edited (qty +/-, remove);
 *  - the payment CTA is reachable on mobile with the amount due;
 *  - a success modal is shown only after the transaction is committed.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

import { createAppRouter } from '@/router'
import { resolveLocalOperationService } from '@/services/database/localOperationService'
import { useBusinessStore } from '@/stores/businessStore'
import { useCartStore } from '@/stores/cartStore'
import { useCashStore } from '@/stores/cashStore'
import { useCashierStore } from '@/stores/cashierStore'
import { useProductStore } from '@/stores/productStore'
import { useShiftStore } from '@/stores/shiftStore'
import { useTransactionStore } from '@/stores/transactionStore'
import { formatCurrency } from '@/utils/formatters'
import MobileCartSheet from '@/components/pos/MobileCartSheet.vue'
import PosView from '@/views/pos/PosView.vue'
import PaymentView from '@/views/payment/PaymentView.vue'

const PRODUCT = { id: 1, name: 'Es Kopi Susu', category: 'Minuman', price: 22000, stock: 10 }

function prepareStores() {
  const pinia = createPinia()
  setActivePinia(pinia)

  const businessStore = useBusinessStore(pinia)
  const cashierStore = useCashierStore(pinia)
  const shiftStore = useShiftStore(pinia)

  businessStore.setBusiness({
    name: 'Demo POS Store',
    type: 'Cafe',
    owner: 'Admin',
    phone: '08123456789',
    outlet: 'Outlet Utama',
    mode: 'free',
  })
  cashierStore.setPinConfigured(true)
  shiftStore.openShift(100000)

  return {
    pinia,
    businessStore,
    cashierStore,
    shiftStore,
    cartStore: useCartStore(pinia),
    productStore: useProductStore(pinia),
    transactionStore: useTransactionStore(pinia),
    cashStore: useCashStore(pinia),
  }
}

function createPosContext() {
  const stores = prepareStores()
  return { ...stores, router: createAppRouter() }
}

function mountSheet(options = {}) {
  const stores = prepareStores()
  const wrapper = mount(MobileCartSheet, {
    props: { open: true },
    global: { plugins: [stores.pinia] },
    ...options,
  })
  return { wrapper, ...stores }
}

async function mountPos() {
  const context = createPosContext()
  await context.router.push('/pos')
  await flushPromises()

  const wrapper = mount(PosView, {
    global: { plugins: [context.pinia, context.router] },
  })

  return { wrapper, ...context }
}

async function mountPayment({
  price = 22000,
  stock = 10,
  qty = 1,
} = {}) {
  const context = createPosContext()
  const created = context.productStore.createProduct({
    name: 'Es Kopi Susu',
    category: context.productStore.categories[0] ?? 'Minuman',
    price,
    stock,
    isActive: true,
  })
  context.cartStore.addItem(created.product)
  if (qty > 1) {
    context.cartStore.updateQty(created.product.id, qty)
  }

  await context.router.push('/payment')
  await flushPromises()

  const wrapper = mount(PaymentView, {
    global: { plugins: [context.pinia, context.router] },
  })

  return { wrapper, ...context, product: created.product }
}

function getButtonByText(wrapper, label) {
  return wrapper.findAll('button').find((button) => button.text().includes(label))
}

function sheetButton(wrapper, testid) {
  return wrapper.find(`[data-testid="mobile-cart-sheet"] [data-testid="${testid}"]`)
}

async function pay(wrapper) {
  await wrapper.find('[data-testid="mobile-submit-payment"]').trigger('click')
  await flushPromises()
}

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  vi.restoreAllMocks()
})

// ════════════════════════════════════════════════════════════════════════════
// Mobile cart bottom sheet
// ════════════════════════════════════════════════════════════════════════════

describe('Mobile cart bottom sheet', () => {
  it('1. opens from the floating checkout bar', async () => {
    const { wrapper, cartStore } = await mountPos()
    cartStore.addItem(PRODUCT)
    await flushPromises()

    expect(wrapper.find('[data-testid="mobile-cart-sheet"]').exists()).toBe(false)

    await wrapper.find('[data-testid="mobile-cart-summary"]').trigger('click')
    await flushPromises()

    const sheet = wrapper.find('[data-testid="mobile-cart-sheet"]')
    expect(sheet.exists()).toBe(true)
    expect(sheet.text()).toContain('Es Kopi Susu')
  })

  it('2. plus increases the qty', async () => {
    const { wrapper, cartStore } = mountSheet()
    cartStore.addItem(PRODUCT)
    await flushPromises()

    await sheetButton(wrapper, 'cart-item-increase-1').trigger('click')
    await flushPromises()

    expect(cartStore.items[0].qty).toBe(2)
  })

  it('3. minus decreases the qty', async () => {
    const { wrapper, cartStore } = mountSheet()
    cartStore.addItem(PRODUCT)
    cartStore.increaseQty(1)
    cartStore.increaseQty(1)
    await flushPromises()
    expect(cartStore.items[0].qty).toBe(3)

    await sheetButton(wrapper, 'cart-item-decrease-1').trigger('click')
    await flushPromises()

    expect(cartStore.items[0].qty).toBe(2)
  })

  it('4. the explicit Hapus button removes the product', async () => {
    const { wrapper, cartStore } = mountSheet()
    cartStore.addItem(PRODUCT)
    cartStore.addItem({ ...PRODUCT, id: 2, name: 'Americano' })
    await flushPromises()

    await sheetButton(wrapper, 'cart-item-remove-1').trigger('click')
    await flushPromises()

    expect(cartStore.items.map((item) => item.id)).toEqual([2])
  })

  it('5. subtotal, tax and total update reactively', async () => {
    const { wrapper, cartStore } = mountSheet()
    cartStore.addItem(PRODUCT)
    await flushPromises()

    expect(wrapper.find('[data-testid="mobile-cart-total"]').text()).toBe(formatCurrency(24420))

    await sheetButton(wrapper, 'cart-item-increase-1').trigger('click')
    await flushPromises()

    // 2 x 22.000 + 11% tax
    expect(cartStore.subtotal).toBe(44000)
    expect(cartStore.tax).toBe(4840)
    expect(wrapper.find('[data-testid="mobile-cart-total"]').text()).toBe(formatCurrency(48840))
  })

  it('6. an empty cart hides the floating checkout bar', async () => {
    const { wrapper, cartStore } = await mountPos()

    expect(wrapper.find('[data-testid="mobile-cart-summary"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="mobile-checkout-btn"]').exists()).toBe(false)

    cartStore.addItem(PRODUCT)
    await flushPromises()
    expect(wrapper.find('[data-testid="mobile-cart-summary"]').exists()).toBe(true)

    cartStore.clearCart()
    await flushPromises()
    expect(wrapper.find('[data-testid="mobile-cart-summary"]').exists()).toBe(false)
  })

  it('7. mobile and desktop read the same cart state', async () => {
    const { wrapper, cartStore } = await mountPos()
    cartStore.addItem(PRODUCT)
    await flushPromises()

    await wrapper.find('[data-testid="mobile-cart-summary"]').trigger('click')
    await flushPromises()
    await sheetButton(wrapper, 'cart-item-increase-1').trigger('click')
    await flushPromises()

    expect(cartStore.items[0].qty).toBe(2)
    // The first number input belongs to the (desktop) cart panel and must mirror it.
    expect(wrapper.findAll('input[type="number"]')[0].element.value).toBe('2')
  })

  it('8a. pcs qty stays an integer and never auto-deletes at the minimum', async () => {
    const { wrapper, cartStore } = mountSheet()
    cartStore.addItem(PRODUCT)
    await flushPromises()

    const decrease = sheetButton(wrapper, 'cart-item-decrease-1')
    expect(decrease.attributes('disabled')).toBeDefined()

    // Pressing a disabled minus must not remove the line.
    await decrease.trigger('click')
    await flushPromises()
    expect(cartStore.items).toHaveLength(1)
    expect(cartStore.items[0].qty).toBe(1)

    await sheetButton(wrapper, 'cart-item-increase-1').trigger('click')
    await flushPromises()
    expect(cartStore.items[0].qty).toBe(2)
  })

  it('8b. laundry-by-kg keeps fractional quantities', async () => {
    const { wrapper, cartStore } = mountSheet()
    const laundryKg = {
      id: 'kg-1',
      name: 'Cuci Kiloan',
      kind: 'service',
      pricingUnit: 'kg',
      price: 7000,
      stock: 50,
      minQuantity: 0.1,
    }
    cartStore.addItem(laundryKg)
    await flushPromises()

    expect(cartStore.items[0].qty).toBe(0.1)

    await sheetButton(wrapper, 'cart-item-increase-kg-1').trigger('click')
    await flushPromises()
    expect(cartStore.items[0].qty).toBeCloseTo(0.2, 5)

    await sheetButton(wrapper, 'cart-item-decrease-kg-1').trigger('click')
    await flushPromises()
    expect(cartStore.items[0].qty).toBeCloseTo(0.1, 5)

    // At the fractional minimum the minus is disabled, remove stays explicit.
    expect(sheetButton(wrapper, 'cart-item-decrease-kg-1').attributes('disabled')).toBeDefined()
    expect(cartStore.items).toHaveLength(1)
  })

  it('9. the sheet is a scrollable overlay that can be closed without changing data', async () => {
    const { wrapper, cartStore } = mountSheet()
    cartStore.addItem(PRODUCT)
    cartStore.addItem({ ...PRODUCT, id: 2, name: 'Americano' })
    await flushPromises()

    // Overlay sits above the bottom navigation (z-50) and the list scrolls.
    const overlay = wrapper.find('.fixed')
    expect(overlay.classes()).toContain('z-50')
    expect(overlay.classes()).toContain('inset-0')
    expect(wrapper.find('[data-testid="mobile-cart-list"]').classes()).toContain('overflow-y-auto')

    const before = cartStore.items.map((item) => ({ ...item }))
    await getButtonByText(wrapper, 'Tutup').trigger('click')
    await flushPromises()

    // Closing emits `close` (the parent PosView flips `open`) and changes nothing.
    expect(wrapper.emitted('close')).toBeTruthy()
    expect(cartStore.items).toEqual(before)

    await wrapper.setProps({ open: false })
    expect(wrapper.find('[data-testid="mobile-cart-sheet"]').exists()).toBe(false)
  })

  it('9b. removing the last line closes the sheet', async () => {
    const { wrapper, cartStore } = mountSheet()
    cartStore.addItem(PRODUCT)
    await flushPromises()

    await sheetButton(wrapper, 'cart-item-remove-1').trigger('click')
    await flushPromises()

    expect(cartStore.items).toHaveLength(0)
    // The sheet requests to close itself once the cart is empty.
    expect(wrapper.emitted('close')).toBeTruthy()
  })
})

// ════════════════════════════════════════════════════════════════════════════
// Mobile payment CTA + success modal
// ════════════════════════════════════════════════════════════════════════════

describe('Mobile payment CTA', () => {
  it('10. is visible with the amount due and only one submit is active per breakpoint', async () => {
    const { wrapper, cartStore } = await mountPayment()

    // Satisfy the cash validation so the CTA is actionable.
    await getButtonByText(wrapper, 'Uang Pas').trigger('click')
    await flushPromises()

    const cta = wrapper.find('[data-testid="mobile-payment-cta"]')
    expect(cta.exists()).toBe(true)
    expect(cta.classes()).toContain('md:hidden')
    expect(wrapper.find('[data-testid="mobile-payment-total"]').text()).toBe(
      formatCurrency(cartStore.total),
    )
    // Above the bottom navigation + Android safe area.
    expect(cta.classes().join(' ')).toContain('safe-area-inset-bottom')

    expect(wrapper.find('[data-testid="mobile-submit-payment"]').attributes('disabled')).toBeUndefined()
    // The desktop CTA wrapper is hidden on mobile, so both are never visible
    // (and therefore never both active) at the same breakpoint.
    expect(
      wrapper.find('[data-testid="desktop-submit-payment"]').element.closest('div.hidden'),
    ).not.toBeNull()
  })

  it('10b. the submit is disabled while the payment data is invalid', async () => {
    const { wrapper } = await mountPayment()

    // Cash is the default method and the amount received is still empty.
    expect(wrapper.find('[data-testid="mobile-submit-payment"]').attributes('disabled')).toBeDefined()
  })
})

describe('Payment success modal', () => {
  it('11 + 12. a valid payment creates exactly one transaction and only then shows the modal', async () => {
    const { wrapper, transactionStore, cartStore } = await mountPayment()
    const initialCount = transactionStore.items.length

    expect(wrapper.find('[data-testid="payment-success-modal"]').exists()).toBe(false)

    await getButtonByText(wrapper, 'Uang Pas').trigger('click')
    await flushPromises()
    await pay(wrapper)

    expect(transactionStore.items).toHaveLength(initialCount + 1)
    expect(wrapper.find('[data-testid="payment-success-modal"]').exists()).toBe(true)
    expect(cartStore.items).toHaveLength(0)
  })

  it('13a. a failed stock validation shows an error, no modal and keeps the cart', async () => {
    const { wrapper, cartStore, transactionStore, productStore, product } = await mountPayment()
    const initialCount = transactionStore.items.length

    productStore.deleteProduct(product.id)
    await flushPromises()

    await getButtonByText(wrapper, 'QRIS').trigger('click')
    await flushPromises()
    await pay(wrapper)

    expect(wrapper.text()).toContain('tidak ditemukan')
    expect(wrapper.find('[data-testid="payment-success-modal"]').exists()).toBe(false)
    expect(transactionStore.items).toHaveLength(initialCount)
    expect(cartStore.items).toHaveLength(1)
  })

  it('13b. a commit failure shows an error, no modal, keeps the cart and resets loading', async () => {
    const { wrapper, cartStore, transactionStore } = await mountPayment()
    const initialCount = transactionStore.items.length
    const service = resolveLocalOperationService()
    vi.spyOn(service, 'commitRetailSale').mockRejectedValueOnce(new Error('commit gagal'))

    await getButtonByText(wrapper, 'QRIS').trigger('click')
    await flushPromises()
    await pay(wrapper)

    expect(wrapper.text()).toContain('commit gagal')
    expect(wrapper.find('[data-testid="payment-success-modal"]').exists()).toBe(false)
    expect(transactionStore.items).toHaveLength(initialCount)
    expect(cartStore.items).toHaveLength(1)
    // Loading state is reset so the cashier can retry.
    expect(wrapper.find('[data-testid="mobile-submit-payment"]').attributes('disabled')).toBeUndefined()
  })

  it('14. a double tap never creates two transactions', async () => {
    const { wrapper, transactionStore } = await mountPayment()
    const initialCount = transactionStore.items.length

    await getButtonByText(wrapper, 'Uang Pas').trigger('click')
    await flushPromises()

    const submit = wrapper.find('[data-testid="mobile-submit-payment"]')
    await Promise.all([submit.trigger('click'), submit.trigger('click')])
    await flushPromises()

    expect(transactionStore.items).toHaveLength(initialCount + 1)
  })

  it('15. shows the invoice, total, cash received and change of the stored transaction', async () => {
    const { wrapper, transactionStore } = await mountPayment()

    await getButtonByText(wrapper, 'Uang Pas').trigger('click')
    await flushPromises()
    await pay(wrapper)

    const stored = transactionStore.lastTransaction
    expect(stored.total).toBe(24420)
    expect(wrapper.find('[data-testid="success-invoice"]').text()).toBe(stored.invoiceNumber)
    expect(wrapper.find('[data-testid="success-total"]').text()).toBe(formatCurrency(stored.total))
    expect(wrapper.find('[data-testid="success-method"]').text()).toBe('Cash')
    expect(wrapper.find('[data-testid="success-cash-received"]').text()).toBe(
      formatCurrency(stored.cashReceived),
    )
    expect(wrapper.find('[data-testid="success-change"]').text()).toBe(
      formatCurrency(stored.changeAmount),
    )
  })

  it('15b. shows the correct change for an overpayment', async () => {
    const { wrapper, transactionStore } = await mountPayment()

    await wrapper.findComponent({ name: 'BaseInput' }).vm.$emit('update:modelValue', '50000')
    await flushPromises()
    await pay(wrapper)

    expect(transactionStore.lastTransaction.changeAmount).toBe(25580)
    expect(wrapper.find('[data-testid="success-change"]').text()).toBe(formatCurrency(25580))
  })

  it('16 + 18. "Transaksi Baru" replaces the payment route and returns to /pos with an empty cart', async () => {
    const { wrapper, router, cartStore, transactionStore } = await mountPayment()
    const initialCount = transactionStore.items.length

    await getButtonByText(wrapper, 'Uang Pas').trigger('click')
    await flushPromises()
    await pay(wrapper)

    const replaceSpy = vi.spyOn(router, 'replace')
    await wrapper.find('[data-testid="success-new-transaction"]').trigger('click')
    await flushPromises()

    expect(replaceSpy).toHaveBeenCalledWith('/pos')
    expect(router.currentRoute.value.fullPath).toBe('/pos')
    expect(cartStore.items).toHaveLength(0)
    expect(transactionStore.items).toHaveLength(initialCount + 1)
  })

  it('17. "Lihat Struk" opens the just-completed transaction', async () => {
    const { wrapper, router, transactionStore } = await mountPayment()

    await getButtonByText(wrapper, 'Uang Pas').trigger('click')
    await flushPromises()
    await pay(wrapper)

    const id = transactionStore.lastTransaction.id
    await wrapper.find('[data-testid="success-view-receipt"]').trigger('click')
    await flushPromises()

    expect(router.currentRoute.value.fullPath).toBe(`/transactions/${id}/receipt`)
  })

  it('18b. the success flow never leaves an extra payment entry in history', async () => {
    const { wrapper, transactionStore, router } = await mountPayment()
    const initialCount = transactionStore.items.length

    await getButtonByText(wrapper, 'Uang Pas').trigger('click')
    await flushPromises()
    await pay(wrapper)

    // No automatic navigation happened, so the cashier decides.
    expect(router.currentRoute.value.fullPath).toBe('/payment')

    // Re-triggering the (now hidden) submit must be a no-op: no duplicate payment
    // would ever be produced by a stray re-entry such as a hardware back tap.
    await wrapper.find('[data-testid="desktop-submit-payment"]').trigger('click')
    await flushPromises()

    expect(transactionStore.items).toHaveLength(initialCount + 1)
    expect(router.currentRoute.value.fullPath).toBe('/payment')
  })

  it('19. stock, cash ledger and the transaction snapshot stay consistent', async () => {
    const { wrapper, productStore, cashStore, transactionStore, product } = await mountPayment()
    const stockBefore = productStore.getProductById(product.id).stock
    const movementsBefore = productStore.stockMovements.length
    const cashBefore = cashStore.entries.length

    await getButtonByText(wrapper, 'Uang Pas').trigger('click')
    await flushPromises()
    await pay(wrapper)

    const stored = transactionStore.lastTransaction
    expect(productStore.getProductById(product.id).stock).toBe(stockBefore - 1)
    expect(productStore.stockMovements.length).toBe(movementsBefore + 1)
    expect(cashStore.entries.length).toBe(cashBefore + 1)
    expect(cashStore.entries[0].amount).toBe(stored.total)
    expect(stored.items).toHaveLength(1)
    expect(stored.items[0]).toMatchObject({ qty: 1, price: 22000, lineSubtotal: 22000 })
    expect(stored.subtotal).toBe(22000)
    expect(stored.total).toBe(24420)
  })
})
