import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'

import HomeSalesChart from '@/components/home/HomeSalesChart.vue'
import { createAppRouter } from '@/router'
import { useBusinessStore } from '@/stores/businessStore'
import { useCashStore } from '@/stores/cashStore'
import { useProductStore } from '@/stores/productStore'
import { useShiftStore } from '@/stores/shiftStore'
import { useTransactionStore } from '@/stores/transactionStore'
import { formatCurrency } from '@/utils/formatters'
import HomeView from '@/views/home/HomeView.vue'

function setupTestContext(businessType = 'Cafe / UMKM') {
  const pinia = createPinia()
  setActivePinia(pinia)

  const router = createAppRouter()
  const businessStore = useBusinessStore()
  const shiftStore = useShiftStore()
  const cashStore = useCashStore()
  const productStore = useProductStore()
  const transactionStore = useTransactionStore()

  businessStore.setBusiness({
    name: 'Minimalist Cafe',
    type: businessType,
    owner: 'Owner Test',
    phone: '08123456789',
    outlet: 'Outlet Utama',
    mode: 'free',
  })

  shiftStore.openShift(100000)

  // Clear any seed data
  transactionStore.items = []

  return {
    pinia,
    router,
    businessStore,
    shiftStore,
    cashStore,
    productStore,
    transactionStore,
  }
}

describe('HomeSalesChart Component', () => {
  let ctx

  beforeEach(() => {
    ctx = setupTestContext()
  })

  it('renders default empty state gracefully with Rp 0', () => {
    const wrapper = mount(HomeSalesChart, {
      global: { plugins: [ctx.pinia] },
    })

    expect(wrapper.find('[data-testid="home-sales-chart"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="chart-selected-amount"]').text()).toBe(formatCurrency(0))
    expect(wrapper.find('[data-testid="chart-total-amount"]').text()).toBe(formatCurrency(0))
    expect(wrapper.findAll('circle').length).toBeGreaterThan(0)
  })

  it('aggregates only paid transactions for the sales chart', async () => {
    const now = new Date()
    const todayIso = now.toISOString()

    const yesterday = new Date(now)
    yesterday.setDate(now.getDate() - 1)
    const yesterdayIso = yesterday.toISOString()

    // 1 paid transaction today: Rp 50.000
    // 1 unpaid transaction today: Rp 75.000 (should be excluded)
    // 1 paid transaction yesterday: Rp 30.000
    ctx.transactionStore.items = [
      {
        id: 'tx-1',
        total: 50000,
        status: 'paid',
        paymentStatus: 'paid',
        paidAt: todayIso,
        createdAt: todayIso,
      },
      {
        id: 'tx-2',
        total: 75000,
        status: 'pending',
        paymentStatus: 'unpaid',
        createdAt: todayIso,
      },
      {
        id: 'tx-3',
        total: 30000,
        status: 'paid',
        paymentStatus: 'paid',
        paidAt: yesterdayIso,
        createdAt: yesterdayIso,
      },
    ]

    const wrapper = mount(HomeSalesChart, {
      global: { plugins: [ctx.pinia] },
    })
    await flushPromises()

    // Total 7d should be 50.000 + 30.000 = 80.000 (unpaid 75.000 ignored)
    expect(wrapper.find('[data-testid="chart-total-amount"]').text()).toBe(formatCurrency(80000))
    // Default selected point is today: 50.000
    expect(wrapper.find('[data-testid="chart-selected-amount"]').text()).toBe(formatCurrency(50000))
  })

  it('allows switching between 7 Hari and 30 Hari periods', async () => {
    const now = new Date()
    const todayIso = now.toISOString()

    const twentyDaysAgo = new Date(now)
    twentyDaysAgo.setDate(now.getDate() - 20)
    const twentyDaysAgoIso = twentyDaysAgo.toISOString()

    ctx.transactionStore.items = [
      {
        id: 'tx-recent',
        total: 40000,
        status: 'paid',
        paymentStatus: 'paid',
        paidAt: todayIso,
        createdAt: todayIso,
      },
      {
        id: 'tx-old',
        total: 60000,
        status: 'paid',
        paymentStatus: 'paid',
        paidAt: twentyDaysAgoIso,
        createdAt: twentyDaysAgoIso,
      },
    ]

    const wrapper = mount(HomeSalesChart, {
      global: { plugins: [ctx.pinia] },
    })
    await flushPromises()

    // 7 Hari active by default: should only include recent transaction (40.000)
    expect(wrapper.find('[data-testid="chart-total-amount"]').text()).toBe(formatCurrency(40000))

    // Switch to 30 Hari
    const btn30d = wrapper.find('[data-testid="chart-period-30d"]')
    await btn30d.trigger('click')
    await flushPromises()

    // 30 Hari active: should include both transactions (40.000 + 60.000 = 100.000)
    expect(wrapper.find('[data-testid="chart-total-amount"]').text()).toBe(formatCurrency(100000))

    // Switch back to 7 Hari
    const btn7d = wrapper.find('[data-testid="chart-period-7d"]')
    await btn7d.trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-testid="chart-total-amount"]').text()).toBe(formatCurrency(40000))
  })

  it('updates selected point date and amount when tapping on a point', async () => {
    const now = new Date()
    const yesterday = new Date(now)
    yesterday.setDate(now.getDate() - 1)

    ctx.transactionStore.items = [
      {
        id: 'tx-today',
        total: 25000,
        status: 'paid',
        paymentStatus: 'paid',
        paidAt: now.toISOString(),
        createdAt: now.toISOString(),
      },
      {
        id: 'tx-yesterday',
        total: 90000,
        status: 'paid',
        paymentStatus: 'paid',
        paidAt: yesterday.toISOString(),
        createdAt: yesterday.toISOString(),
      },
    ]

    const wrapper = mount(HomeSalesChart, {
      global: { plugins: [ctx.pinia] },
    })
    await flushPromises()

    // Today is point index 6 in 7-day view
    expect(wrapper.find('[data-testid="chart-selected-amount"]').text()).toBe(formatCurrency(25000))

    // Yesterday is point index 5 in 7-day view
    const yesterdayTarget = wrapper.find('[data-testid="chart-point-5"]')
    expect(yesterdayTarget.exists()).toBe(true)
    await yesterdayTarget.trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-testid="chart-selected-amount"]').text()).toBe(formatCurrency(90000))
  })
})

describe('HomeView Minimalist Layout Integration', () => {
  let ctx

  beforeEach(() => {
    ctx = setupTestContext()
  })

  it('renders store header, hero omzet, quick stats chips, sales chart, and operational menu', async () => {
    await ctx.router.push('/home')
    await flushPromises()

    const wrapper = mount(HomeView, {
      global: { plugins: [ctx.pinia, ctx.router] },
    })

    // Store profile
    expect(wrapper.text()).toContain('Minimalist Cafe')
    expect(wrapper.text()).toContain('Outlet Utama')
    expect(wrapper.text()).toContain('Shift Aktif')

    // Hero Omzet
    expect(wrapper.find('[data-testid="today-revenue"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="today-transaction-count"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="today-cash-balance"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="today-low-stock-count"]').exists()).toBe(true)

    // Sales chart integrated
    expect(wrapper.findComponent(HomeSalesChart).exists()).toBe(true)

    // Operational menu
    expect(wrapper.text()).toContain('Menu Operasional')
    expect(wrapper.find('[data-testid="home-menu-pos"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="home-menu-transactions"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="home-menu-cash"]').exists()).toBe(true)
  })

  it('renders laundry order status shortcuts in Laundry mode', async () => {
    const laundryCtx = setupTestContext('Laundry')
    await laundryCtx.router.push('/home')
    await flushPromises()

    const wrapper = mount(HomeView, {
      global: { plugins: [laundryCtx.pinia, laundryCtx.router] },
    })

    expect(wrapper.find('[data-testid="laundry-status-summaries"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="laundry-summary-Masuk"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="laundry-summary-Diproses"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="laundry-summary-Siap Diambil"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="laundry-summary-Selesai"]').exists()).toBe(true)
  })
})
