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
import { useCartStore } from '@/stores/cartStore'
import { useCashStore } from '@/stores/cashStore'
import { useCashierStore } from '@/stores/cashierStore'
import { useProductStore } from '@/stores/productStore'
import { useShiftStore } from '@/stores/shiftStore'
import CashView from '@/views/cash/CashView.vue'
import HomeView from '@/views/home/HomeView.vue'
import PosView from '@/views/pos/PosView.vue'
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
  const cartStore = useCartStore()

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
    cartStore,
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

  it('active tab tidak memakai full bg-primary style lama', async () => {
    const context = createContext()
    const wrapper = await mountWithRouter(BottomNavigation, context)
    const activeHome = wrapper.find('[href="/home"]')

    expect(activeHome.classes()).not.toContain('bg-primary')
    expect(activeHome.find('.bg-primary').exists()).toBe(true)
  })

  it('Lainnya tetap membuka sheet', async () => {
    const context = createContext()
    const wrapper = await mountWithRouter(BottomNavigation, context)

    expect(wrapper.text()).not.toContain('Pengeluaran')

    await wrapper.find('button[data-testid="bottom-nav-item"]').trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('Pengeluaran')
    expect(wrapper.text()).toContain('Settings')
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

describe('POS compact transaction view', () => {
  it('POS tidak lagi render hero dan summary non-operasional', async () => {
    const context = createContext()
    const wrapper = await mountWithRouter(PosView, context)

    expect(wrapper.text()).not.toContain('Point Of Sale')
    expect(wrapper.text()).not.toContain('Produk Aktif')
    expect(wrapper.text()).not.toContain('Omzet Hari Ini')
    expect(wrapper.text()).not.toContain('Estimasi Laba Kotor')
    expect(wrapper.text()).not.toContain('Kas Masuk')
    expect(wrapper.text()).not.toContain('Kas Keluar')
    expect(wrapper.text()).not.toContain('Saldo Kas')
    expect(wrapper.text()).not.toContain('Stok Minimum')
    expect(wrapper.text()).not.toContain('Product Browser')
  })

  it('search dan category chips langsung tersedia', async () => {
    const context = createContext()
    const wrapper = await mountWithRouter(PosView, context)

    expect(wrapper.find('input[placeholder="Cari produk..."]').exists()).toBe(true)
    expect(wrapper.findAll('button').map((button) => button.text())).toContain('Semua')
    expect(wrapper.findAll('button').map((button) => button.text())).toContain('Minuman')
  })

  it('product grid mobile menggunakan 2 kolom', async () => {
    const context = createContext()
    const wrapper = await mountWithRouter(PosView, context)

    expect(wrapper.find('[data-testid="pos-product-grid"]').classes()).toContain('grid-cols-2')
  })
})

describe('POS layout sidebar toggle and drawer', () => {
  it('hides static sidebar and shows hamburger button on /pos', async () => {
    const { default: AppLayout } = await import('@/layouts/AppLayout.vue')
    const context = createContext()
    await context.router.push('/pos')
    await flushPromises()

    const wrapper = mount(AppLayout, {
      global: {
        plugins: [context.pinia, context.router],
      },
    })
    await flushPromises()

    // Hamburger button should exist in header
    const hamburgerBtn = wrapper.find('#btn-sidebar-hamburger')
    expect(hamburgerBtn.exists()).toBe(true)

    // Drawer is closed initially
    expect(wrapper.find('.fixed.inset-0.z-50').exists()).toBe(false)

    // Click hamburger button to open drawer
    await hamburgerBtn.trigger('click')
    expect(wrapper.find('.fixed.inset-0.z-50').exists()).toBe(true)

    // Click close button inside drawer
    const closeBtn = wrapper.find('button[title="Tutup Menu"]')
    expect(closeBtn.exists()).toBe(true)
    await closeBtn.trigger('click')

    // Drawer is closed
    expect(wrapper.find('.fixed.inset-0.z-50').exists()).toBe(false)
  })

  it('shows static sidebar and hides hamburger button on /home', async () => {
    const { default: AppLayout } = await import('@/layouts/AppLayout.vue')
    const context = createContext()
    await context.router.push('/home')
    await flushPromises()

    const wrapper = mount(AppLayout, {
      global: {
        plugins: [context.pinia, context.router],
      },
    })
    await flushPromises()

    // Hamburger button should NOT exist on /home
    expect(wrapper.find('#btn-sidebar-hamburger').exists()).toBe(false)

    // Static sidebar exists
    expect(wrapper.find('aside').exists()).toBe(true)
  })

  it('hides static sidebar and shows hamburger button on /payment', async () => {
    const { default: AppLayout } = await import('@/layouts/AppLayout.vue')
    const context = createContext()
    context.cartStore.addItem({ id: 1, name: 'Es Kopi Susu', category: 'Minuman', price: 22000, stock: 10 })
    await context.router.push('/payment')
    await flushPromises()

    const wrapper = mount(AppLayout, {
      global: {
        plugins: [context.pinia, context.router],
      },
    })
    await flushPromises()

    // Hamburger button should exist on /payment
    expect(wrapper.find('#btn-sidebar-hamburger').exists()).toBe(true)
  })
})


