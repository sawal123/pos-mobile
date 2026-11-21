import { describe, expect, it } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createRouter, createMemoryHistory } from 'vue-router'

import TransactionsView from '@/views/transactions/TransactionsView.vue'
import { useTransactionStore } from '@/stores/transactionStore'
import { toLocalDateString } from '@/utils/formatters'

describe('TransactionsView Component Filters', () => {
  function prepare() {
    const pinia = createPinia()
    setActivePinia(pinia)

    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/transactions', name: 'transactions', component: TransactionsView },
        { path: '/transactions/:id', name: 'transaction-detail', component: { template: '<div>Detail</div>' } },
      ],
    })

    const transactionStore = useTransactionStore()
    const today = new Date()
    const todayStr = toLocalDateString(today)

    const yesterday = new Date()
    yesterday.setDate(yesterday.getDate() - 1)
    const yesterdayStr = toLocalDateString(yesterday)

    // Seed test transactions
    transactionStore.items = [
      {
        id: 'trx-today-cash',
        invoiceNumber: 'INV-001',
        customer: 'Customer A',
        createdAt: `${todayStr}T10:00:00.000Z`,
        paymentMethod: 'cash',
        total: 50000,
        status: 'paid',
        items: [{ name: 'Kopi Susu', qty: 2 }],
      },
      {
        id: 'trx-today-qris',
        invoice_number: 'INV-002',
        customer: 'Customer B',
        created_at: `${todayStr}T11:00:00.000Z`,
        payment_method: 'qris',
        total: 75000,
        status: 'paid',
        items: [{ name: 'Roti Bakar', qty: 1 }],
      },
      {
        id: 'trx-yesterday-cash',
        invoiceNumber: 'INV-003',
        customer: 'Customer C',
        createdAt: `${yesterdayStr}T14:00:00.000Z`,
        paymentMethod: 'cash',
        total: 30000,
        status: 'paid',
        items: [{ name: 'Teh Manis', qty: 3 }],
      },
    ]

    return { pinia, router, transactionStore, todayStr, yesterdayStr }
  }

  it('defaults to Hari Ini filter and displays only today transactions', async () => {
    const { pinia, router } = prepare()
    const wrapper = mount(TransactionsView, {
      global: { plugins: [pinia, router] },
    })
    await flushPromises()

    expect(wrapper.find('[data-testid="filter-date-today"]').classes()).toContain('bg-ink-primary')
    expect(wrapper.text()).toContain('2 Transaksi')
    expect(wrapper.text()).toContain('INV-001')
    expect(wrapper.text()).toContain('INV-002')
    expect(wrapper.text()).not.toContain('INV-003')
  })

  it('filters by payment method properly', async () => {
    const { pinia, router } = prepare()
    const wrapper = mount(TransactionsView, {
      global: { plugins: [pinia, router] },
    })
    await flushPromises()

    // Filter QRIS only
    await wrapper.find('[data-testid="filter-pay-qris"]').trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('1 Transaksi')
    expect(wrapper.text()).toContain('INV-002')
    expect(wrapper.text()).not.toContain('INV-001')

    // Filter Tunai only
    await wrapper.find('[data-testid="filter-pay-cash"]').trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('1 Transaksi')
    expect(wrapper.text()).toContain('INV-001')
  })

  it('navigates dates with flicker buttons (prev / next)', async () => {
    const { pinia, router } = prepare()
    const wrapper = mount(TransactionsView, {
      global: { plugins: [pinia, router] },
    })
    await flushPromises()

    // Click previous day
    await wrapper.find('[data-testid="date-flicker-prev"]').trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('1 Transaksi')
    expect(wrapper.text()).toContain('INV-003')
    expect(wrapper.text()).not.toContain('INV-001')

    // Click next day back to today
    await wrapper.find('[data-testid="date-flicker-next"]').trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('2 Transaksi')
    expect(wrapper.text()).toContain('INV-001')
  })

  it('filters by custom date range and keeps filter state locked across unmount/remount', async () => {
    const { pinia, router, transactionStore, todayStr, yesterdayStr } = prepare()

    const twoDaysAgo = new Date()
    twoDaysAgo.setDate(twoDaysAgo.getDate() - 2)
    const twoDaysAgoStr = toLocalDateString(twoDaysAgo)

    transactionStore.items.push({
      id: 'trx-two-days-ago',
      invoiceNumber: 'INV-004',
      customer: 'Customer D',
      createdAt: `${twoDaysAgoStr}T09:00:00.000Z`,
      paymentMethod: 'cash',
      total: 45000,
      status: 'paid',
      items: [{ name: 'Americano', qty: 1 }],
    })

    const wrapper = mount(TransactionsView, {
      global: { plugins: [pinia, router] },
    })
    await flushPromises()

    // Activate Rentang Tanggal filter
    await wrapper.find('[data-testid="filter-date-range"]').trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-testid="date-range-picker"]').exists()).toBe(true)

    await wrapper.find('[data-testid="date-range-start"]').setValue(yesterdayStr)
    await wrapper.find('[data-testid="date-range-end"]').setValue(todayStr)
    await flushPromises()

    // Should include today + yesterday (3 items), exclude two days ago
    expect(wrapper.text()).toContain('INV-001')
    expect(wrapper.text()).toContain('INV-002')
    expect(wrapper.text()).toContain('INV-003')
    expect(wrapper.text()).not.toContain('INV-004')

    // Simulate navigating to detail and back (unmount & remount)
    wrapper.unmount()

    const remounted = mount(TransactionsView, {
      global: { plugins: [pinia, router] },
    })
    await flushPromises()

    expect(remounted.find('[data-testid="date-range-picker"]').exists()).toBe(true)
    expect(remounted.find('[data-testid="filter-date-range"]').classes()).toContain('bg-ink-primary')
    expect(remounted.text()).toContain('INV-003')
    expect(remounted.text()).not.toContain('INV-004')
  })
})

