import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { RouterLink } from 'vue-router'
import { describe, expect, it } from 'vitest'

import BottomNavigation from '@/components/layout/BottomNavigation.vue'
import {
  BOTTOM_NAV_LIMIT,
  getBottomNavItems,
  getOperationalMenuItems,
  getProductMenuLabel,
} from '@/navigation/operationalMenu'
import { createAppRouter } from '@/router'
import { useBusinessStore } from '@/stores/businessStore'
import { useCashStore } from '@/stores/cashStore'
import { useCashierStore } from '@/stores/cashierStore'
import { useProductStore } from '@/stores/productStore'
import { useShiftStore } from '@/stores/shiftStore'
import CashView from '@/views/cash/CashView.vue'
import HomeView from '@/views/home/HomeView.vue'
import SettingsView from '@/views/settings/SettingsView.vue'
import StockView from '@/views/stock/StockView.vue'

function createContext(type = 'Cafe / UMKM') {
  const pinia = createPinia()
  setActivePinia(pinia)

  const router = createAppRouter()
  const businessStore = useBusinessStore()
  const cashierStore = useCashierStore()
  const shiftStore = useShiftStore()
  const productStore = useProductStore()
  const cashStore = useCashStore()

  businessStore.setBusiness({
    name: 'Demo POS Store',
    type,
    owner: 'Admin',
    phone: '08123456789',
    outlet: 'Outlet Utama',
    mode: 'free',
  })
  cashierStore.setPinConfigured(true)
  shiftStore.openShift(100000)

  return {
    pinia,
    router,
    businessStore,
    cashierStore,
    shiftStore,
    productStore,
    cashStore,
  }
}

async function mountWithRouter(component, context) {
  await context.router.push('/home')
  await flushPromises()

  return mount(component, {
    global: {
      plugins: [context.pinia, context.router],
    },
  })
}

describe('home menu navigation', () => {
  it('Home menampilkan seluruh menu operasional', async () => {
    const context = createContext()
    const wrapper = await mountWithRouter(HomeView, context)

    for (const item of getOperationalMenuItems(context.businessStore.normalizedType)) {
      expect(wrapper.text()).toContain(item.title)
      expect(wrapper.find(`[data-testid="home-menu-${item.key}"]`).exists()).toBe(true)
    }
  })

  it('setiap tile menuju route yang benar', async () => {
    const context = createContext()
    const wrapper = await mountWithRouter(HomeView, context)

    for (const item of getOperationalMenuItems(context.businessStore.normalizedType)) {
      expect(wrapper.find(`[data-testid="home-menu-${item.key}"]`).attributes('href')).toBe(item.to)
    }
  })

  it('Laundry menggunakan label Layanan', async () => {
    const context = createContext('Laundry')
    const wrapper = await mountWithRouter(HomeView, context)

    expect(getProductMenuLabel(context.businessStore.normalizedType)).toBe('Layanan')
    expect(wrapper.find('[data-testid="home-menu-products"]').text()).toContain('Layanan')
  })

  it('Cafe dan Grosir menggunakan label Produk', () => {
    expect(getProductMenuLabel('Cafe / UMKM')).toBe('Produk')
    expect(getProductMenuLabel('Grosir / Toko Kelontong')).toBe('Produk')
  })

  it('Kas tidak lagi terdapat di Settings', async () => {
    const context = createContext()
    const wrapper = await mountWithRouter(SettingsView, context)

    expect(wrapper.text()).not.toContain('Kas Offline')
    expect(wrapper.text()).not.toContain('Catat Kas')
    expect(wrapper.text()).not.toContain('Saldo Kas Tunai')
  })

  it('/cash menampilkan cash ledger', async () => {
    const context = createContext()
    context.cashStore.recordEntry({
      type: 'in',
      amount: 50000,
      category: 'Modal',
      note: 'Tambahan modal',
    })

    const wrapper = await mountWithRouter(CashView, context)

    expect(wrapper.text()).toContain('Ledger kas operasional')
    expect(wrapper.text()).toContain('Riwayat Kas')
    expect(wrapper.text()).toContain('Modal')
    expect(wrapper.text()).toContain('Tambahan modal')
  })

  it('/stock hanya menampilkan inventory product', async () => {
    const context = createContext()
    context.productStore.products = [
      {
        id: 'product-1',
        name: 'Air Mineral',
        category: 'Minuman',
        kind: 'product',
        stock: 8,
        unit: 'pcs',
        minStock: 3,
        isActive: true,
      },
      {
        id: 'service-1',
        name: 'Cuci Kering',
        category: 'Kiloan',
        kind: 'service',
        stock: 0,
        unit: 'kg',
        minStock: 0,
        pricingUnit: 'kg',
        isActive: true,
      },
    ]

    const wrapper = await mountWithRouter(StockView, context)

    expect(wrapper.text()).toContain('Air Mineral')
    expect(wrapper.text()).not.toContain('Cuci Kering')
  })

  it('bottom navigation maksimal 5 item dan semuanya punya icon', async () => {
    const context = createContext()
    const wrapper = await mountWithRouter(BottomNavigation, context)

    expect(getBottomNavItems()).toHaveLength(BOTTOM_NAV_LIMIT)
    expect(wrapper.findAll('[data-testid="bottom-nav-item"]')).toHaveLength(BOTTOM_NAV_LIMIT)
    expect(wrapper.findAllComponents(RouterLink)).toHaveLength(BOTTOM_NAV_LIMIT - 1)
    expect(wrapper.findAll('svg')).toHaveLength(BOTTOM_NAV_LIMIT)
  })

  it('navigation tetap aman ketika shift belum dibuka', async () => {
    const context = createContext()
    context.shiftStore.closeShift()

    await context.router.push('/home')
    await flushPromises()

    expect(context.router.currentRoute.value.fullPath).toBe('/shift/open')

    await context.router.push('/cash')
    await flushPromises()

    expect(context.router.currentRoute.value.fullPath).toBe('/shift/open')
  })
})
