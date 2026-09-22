import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { describe, expect, it } from 'vitest'

import CartSummary from '@/components/pos/CartSummary.vue'
import ReceiptContent from '@/components/receipt/ReceiptContent.vue'
import { createAppRouter } from '@/router'
import { createBackupPayload, restoreBackupPayload, validateBackupPayload } from '@/services/backupService'
import { createMemoryAdapter } from '@/services/database/memoryAdapter'
import { createPersistenceService } from '@/services/database/persistenceService'
import { buildReceiptText } from '@/services/printer/escposReceiptBuilder'
import { useBusinessStore } from '@/stores/businessStore'
import { useCartStore } from '@/stores/cartStore'
import { useCashStore } from '@/stores/cashStore'
import { useCustomerStore } from '@/stores/customerStore'
import { useExpenseStore } from '@/stores/expenseStore'
import { useProductStore } from '@/stores/productStore'
import { useShiftStore } from '@/stores/shiftStore'
import { useTaxStore, isValidTaxRate } from '@/stores/taxStore'
import { useTransactionStore } from '@/stores/transactionStore'
import SettingsView from '@/views/settings/SettingsView.vue'

function context() {
  const pinia = createPinia()
  setActivePinia(pinia)

  return {
    pinia,
    router: createAppRouter(),
    businessStore: useBusinessStore(),
    cartStore: useCartStore(),
    cashStore: useCashStore(),
    customerStore: useCustomerStore(),
    expenseStore: useExpenseStore(),
    productStore: useProductStore(),
    shiftStore: useShiftStore(),
    taxStore: useTaxStore(),
    transactionStore: useTransactionStore(),
  }
}

function seedCart(cartStore) {
  cartStore.addItem({ id: 'item', name: 'Service Oli', price: 45000, stock: 10 })
}

describe('dynamic POS tax configuration', () => {
  it('defaults to the existing 11% tax without changing legacy checkout totals', () => {
    const { cartStore, taxStore } = context()
    seedCart(cartStore)

    expect(taxStore.enabled).toBe(true)
    expect(taxStore.rate).toBe(11)
    expect(cartStore.subtotal).toBe(45000)
    expect(cartStore.tax).toBe(4950)
    expect(cartStore.total).toBe(49950)
  })

  it('recomputes open cart totals and rounds only the tax to whole rupiah', () => {
    const { cartStore, taxStore } = context()
    seedCart(cartStore)

    expect(taxStore.setSettings({ enabled: true, rate: 7.5 }).success).toBe(true)
    expect(cartStore.tax).toBe(3375)
    expect(cartStore.total).toBe(48375)

    expect(taxStore.setSettings({ enabled: true, rate: 7.25 }).success).toBe(true)
    expect(cartStore.tax).toBe(3263)
    expect(cartStore.total).toBe(48263)
  })

  it('disables tax without losing the configured rate; enabling restores it', () => {
    const { cartStore, taxStore } = context()
    seedCart(cartStore)
    taxStore.setSettings({ enabled: true, rate: 6.5 })

    expect(taxStore.setSettings({ enabled: false, rate: 6.5 }).success).toBe(true)
    expect(taxStore.rate).toBe(6.5)
    expect(cartStore.tax).toBe(0)
    expect(cartStore.total).toBe(45000)

    taxStore.setSettings({ enabled: true, rate: 6.5 })
    expect(cartStore.tax).toBe(2925)
  })

  it('rejects invalid rates and never mutates stored settings', () => {
    const { taxStore } = context()

    for (const rate of ['', '   ', '12.345', -1, 101, 'abc', Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(isValidTaxRate(rate)).toBe(false)
      expect(taxStore.setSettings({ enabled: true, rate }).success).toBe(false)
    }

    expect(taxStore.rate).toBe(11)
    expect(taxStore.enabled).toBe(true)
    expect(isValidTaxRate('7.25')).toBe(true)
  })

  it('persists tax settings through the existing adapter without a schema migration', async () => {
    const adapter = createMemoryAdapter()
    const first = context()
    const service = createPersistenceService({ pinia: first.pinia, adapter })
    await service.initialize()

    first.taxStore.setSettings({ enabled: false, rate: 8.75 })
    await service.flush()
    await service.close()

    const reopened = context()
    const reopenedService = createPersistenceService({ pinia: reopened.pinia, adapter })
    await reopenedService.initialize()

    expect(reopened.taxStore.$state).toEqual({ enabled: false, rate: 8.75 })
    expect(reopened.cartStore.tax).toBe(0)
    await reopenedService.close()
  })

  it('shows editable tax settings and applies saved changes to cart', async () => {
    const ctx = context()
    seedCart(ctx.cartStore)
    const wrapper = mount(SettingsView, { global: { plugins: [ctx.pinia, ctx.router] } })
    await flushPromises()

    expect(wrapper.find('[data-testid="tax-settings-card"]').exists()).toBe(true)
    const input = wrapper.find('[data-testid="tax-rate-input"]')
    await input.setValue('7.5')
    await wrapper.find('[data-testid="save-tax-settings"]').trigger('click')
    await flushPromises()

    expect(ctx.taxStore.rate).toBe(7.5)
    expect(ctx.cartStore.tax).toBe(3375)
    expect(wrapper.find('[data-testid="tax-feedback"]').text()).toContain('berhasil')

    await wrapper.find('[data-testid="tax-enabled-switch"]').setValue(false)
    await wrapper.find('[data-testid="save-tax-settings"]').trigger('click')
    await flushPromises()

    expect(ctx.taxStore.enabled).toBe(false)
    expect(ctx.cartStore.tax).toBe(0)
    expect(ctx.cartStore.total).toBe(45000)
  })

  it('hides tax from the cart summary when disabled', () => {
    const ctx = context()
    seedCart(ctx.cartStore)
    ctx.taxStore.setSettings({ enabled: false, rate: 11 })

    const wrapper = mount(CartSummary, {
      global: { plugins: [ctx.pinia] },
      props: {
        subtotal: ctx.cartStore.subtotal,
        tax: ctx.cartStore.tax,
        total: ctx.cartStore.total,
        taxEnabled: ctx.taxStore.enabled,
        taxRate: ctx.taxStore.rate,
      },
    })

    expect(wrapper.text()).not.toContain('Pajak')
    expect(wrapper.text()).toContain('45.000')
  })

  it('preserves tax settings in backup, and safely defaults older backups to 11%', () => {
    const ctx = context()
    ctx.transactionStore.$patch({ items: [] })
    ctx.productStore.$patch({ products: [], categories: [] })
    ctx.taxStore.setSettings({ enabled: false, rate: 9.5 })

    const payload = createBackupPayload(ctx)
    expect(payload.data.taxSettings).toEqual({ enabled: false, rate: 9.5 })
    expect(validateBackupPayload(payload).valid).toBe(true)

    const receiver = context()
    expect(restoreBackupPayload(payload, receiver).success).toBe(true)
    expect(receiver.taxStore.$state).toEqual({ enabled: false, rate: 9.5 })

    const legacy = structuredClone(payload)
    delete legacy.data.taxSettings
    expect(validateBackupPayload(legacy).valid).toBe(true)
    expect(restoreBackupPayload(legacy, receiver).success).toBe(true)
    expect(receiver.taxStore.$state).toEqual({ enabled: true, rate: 11 })

    const malformed = structuredClone(payload)
    malformed.data.taxSettings.rate = 150
    expect(validateBackupPayload(malformed).valid).toBe(false)
  })

  it('locks receipt and print labels to historic transaction tax rate', () => {
    const ctx = context()
    const transaction = ctx.transactionStore.createTransaction({
      items: [{ id: 'oil', name: 'Service Oli', price: 10000, qty: 1 }],
      subtotal: 10000,
      tax: 750,
      taxRate: 7.5,
      taxEnabled: true,
      total: 10750,
      paymentMethod: 'cash',
    })

    ctx.taxStore.setSettings({ enabled: true, rate: 11 })

    const receipt = mount(ReceiptContent, {
      props: { transaction, business: { name: 'Toko', outlet: 'Utama' } },
    })
    expect(receipt.text()).toContain('Pajak (7.5%)')
    expect(receipt.text()).not.toContain('Pajak (11%)')

    const print = buildReceiptText({ transaction, business: { name: 'Toko', outlet: 'Utama' }, paperWidth: '58' })
    expect(print).toContain('Pajak (7.5%)')
  })

  it('does not show a tax row on a tax-free receipt or thermal print', () => {
    const transaction = {
      id: 'free-1',
      status: 'paid',
      paymentStatus: 'paid',
      createdAt: '2026-09-23T01:00:00.000Z',
      items: [{ name: 'Service Oli', price: 45000, qty: 1 }],
      subtotal: 45000,
      tax: 0,
      taxRate: 0,
      taxEnabled: false,
      total: 45000,
      paymentMethod: 'cash',
    }
    const receipt = mount(ReceiptContent, { props: { transaction } })
    expect(receipt.text()).not.toContain('Pajak')

    const print = buildReceiptText({ transaction, business: { name: 'Toko' }, paperWidth: '58' })
    expect(print).not.toContain('Pajak')
  })
})
