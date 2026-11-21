import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { describe, expect, it, vi } from 'vitest'
import { createRouter, createWebHistory } from 'vue-router'

import AppHeader from '@/components/layout/AppHeader.vue'
import { useBusinessStore } from '@/stores/businessStore'
import { useCloudSessionStore } from '@/stores/cloudSessionStore'
import { useProductStore } from '@/stores/productStore'
import { useSyncPushStore } from '@/stores/syncPushStore'
import { useSyncStatusStore } from '@/stores/syncStatusStore'
import { useTransactionStore } from '@/stores/transactionStore'
import ProductsView from '@/views/products/ProductsView.vue'
import TransactionDetailView from '@/views/transactions/TransactionDetailView.vue'

function createTestRouter() {
  return createRouter({
    history: createWebHistory(),
    routes: [
      { path: '/', name: 'home', component: { template: '<div>Home</div>' } },
      { path: '/pos', name: 'pos', component: { template: '<div>POS</div>' } },
      { path: '/products', name: 'products', component: { template: '<div>Products</div>' } },
      { path: '/transactions', name: 'transactions', component: { template: '<div>Transactions</div>' } },
      { path: '/transactions/:id', name: 'transaction-detail', component: { template: '<div>Detail</div>' } },
      { path: '/sync', name: 'sync', component: { template: '<div>Sync</div>' } },
    ],
  })
}

describe('Header UI & Notification Bell & Direct Auto-Sync', () => {
  it('AppHeader merender background glossy navy gelap dengan teks kontras dan tombol lonceng', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const router = createTestRouter()
    await router.push('/')

    const businessStore = useBusinessStore()
    businessStore.name = 'Temuan Space'
    businessStore.outlet = 'USU'
    businessStore.mode = 'cloud'

    const cloudStore = useCloudSessionStore()
    cloudStore.user = { id: 'u1', name: 'Owner' }
    cloudStore.selectedBusiness = { id: 'b1', name: 'Temuan Space' }
    cloudStore.selectedOutlet = { id: 'o1', name: 'USU' }

    const wrapper = mount(AppHeader, {
      global: { plugins: [pinia, router] },
    })
    await flushPromises()

    const header = wrapper.find('[data-testid="app-header"]')
    expect(header.exists()).toBe(true)
    // Cek header putih bersih matching sidebar
    expect(header.classes().some((c) => c.includes('bg-white'))).toBe(true)

    // Cek tombol lonceng
    const bellBtn = wrapper.find('[data-testid="header-notification-bell"]')
    expect(bellBtn.exists()).toBe(true)

    // Teks kontras
    expect(wrapper.text()).toContain('Temuan Space')
    expect(wrapper.text()).toContain('USU')
  })

  it('menampilkan badge angka pada icon lonceng saat ada data pending sync dan membuka modal notifikasi', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const router = createTestRouter()
    await router.push('/')

    const syncPushStore = useSyncPushStore()
    syncPushStore.pendingCount = 3

    const wrapper = mount(AppHeader, {
      global: { plugins: [pinia, router] },
    })
    await flushPromises()

    const badge = wrapper.find('[data-testid="notification-bell-badge"]')
    expect(badge.exists()).toBe(true)
    expect(badge.text()).toBe('3')

    // Klik tombol lonceng untuk membuka modal
    await wrapper.find('[data-testid="header-notification-bell"]').trigger('click')
    await flushPromises()

    const modal = document.querySelector('[data-testid="notification-center-modal"]')
    expect(modal).not.toBeNull()
    expect(modal.textContent).toContain('Pusat Notifikasi & Status')
    expect(modal.textContent).toContain('3 Data Menunggu Sinkronisasi')
  })

  it('mengubah status pesanan menjadi Siap memicu auto-push langsung saat online', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const router = createTestRouter()

    const businessStore = useBusinessStore()
    businessStore.mode = 'cloud'

    const syncPushStore = useSyncPushStore()
    const pushSpy = vi.spyOn(syncPushStore, 'pushIfOnline').mockResolvedValue({ ok: true })

    const transactionStore = useTransactionStore()
    const tx = transactionStore.createTransaction({
      customer: 'Budi',
      subtotal: 18000,
      total: 18000,
      paymentMethod: 'cash',
      status: 'paid',
      orderStatus: 'Proses',
      items: [{ id: 'p1', name: 'Kopi Susu', qty: 1, price: 18000, subtotal: 18000 }],
    })

    await router.push(`/transactions/${tx.id}`)
    await flushPromises()

    const wrapper = mount(TransactionDetailView, {
      global: { plugins: [pinia, router] },
    })
    await flushPromises()

    // Cari tombol status 'Siap' dan klik
    const readyBtn = wrapper.findAll('button').find((b) => b.text().trim() === 'Siap')
    expect(readyBtn).toBeDefined()
    await readyBtn.trigger('click')
    await flushPromises()

    // Verifikasi status lokal berubah dan pushIfOnline dipanggil
    expect(transactionStore.items.find((t) => t.id === tx.id).orderStatus).toBe('Siap')
    expect(pushSpy).toHaveBeenCalled()
  })

  it('toggle produk aktif / nonaktif memicu auto-push langsung saat online', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const router = createTestRouter()
    await router.push('/products')

    const businessStore = useBusinessStore()
    businessStore.mode = 'cloud'

    const syncPushStore = useSyncPushStore()
    const pushSpy = vi.spyOn(syncPushStore, 'pushIfOnline').mockResolvedValue({ ok: true })

    const productStore = useProductStore()
    productStore.products = []
    const created = productStore.createProduct({
      name: 'Americano Ice',
      category: 'Minuman',
      price: 18000,
      stock: 10,
      isActive: true,
    })

    const wrapper = mount(ProductsView, {
      global: { plugins: [pinia, router] },
    })
    await flushPromises()

    // Cari tombol toggle status pada kartu produk
    const toggleBtn = wrapper.find('[aria-label="Menu aktif di POS"]')
    expect(toggleBtn.exists()).toBe(true)
    await toggleBtn.trigger('click')
    await flushPromises()

    expect(productStore.getProductById(created.product.id).isActive).toBe(false)
    expect(pushSpy).toHaveBeenCalled()
  })
})
