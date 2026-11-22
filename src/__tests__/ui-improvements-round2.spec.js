import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createRouter, createMemoryHistory } from 'vue-router'

import ProductCard from '@/components/pos/ProductCard.vue'
import ActiveOrdersSheet from '@/components/pos/ActiveOrdersSheet.vue'
import TransactionCard from '@/components/transaction/TransactionCard.vue'
import SyncPendingDetailsModal from '@/components/sync/SyncPendingDetailsModal.vue'
import { useTransactionStore } from '@/stores/transactionStore'
import { useSyncPushStore } from '@/stores/syncPushStore'
import { useThemeStore, applyThemeClass } from '@/stores/themeStore'

describe('UI Improvements Round 2 (User Feedback)', () => {
  let pinia
  let router

  beforeEach(() => {
    pinia = createPinia()
    setActivePinia(pinia)
    router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/', component: { template: '<div>Home</div>' } },
        { path: '/pos', component: { template: '<div>POS</div>' } },
        { path: '/transactions', component: { template: '<div>Transactions</div>' } },
        { path: '/transactions/:id', component: { template: '<div>Detail</div>' } },
      ],
    })
  })

  describe('1. Dark Theme Status Bar Integration', () => {
    it('applies dark theme class and calls syncNativeStatusBar', () => {
      const themeStore = useThemeStore()
      themeStore.setTheme('dark')
      expect(themeStore.isDark).toBe(true)

      const docMock = {
        documentElement: {
          classList: { toggle: vi.fn() },
          dataset: {},
          style: {},
        },
        querySelector: vi.fn().mockReturnValue({ setAttribute: vi.fn() }),
      }

      applyThemeClass('dark', docMock)
      expect(docMock.documentElement.classList.toggle).toHaveBeenCalledWith('dark', true)
      expect(docMock.documentElement.dataset.theme).toBe('dark')
    })
  })

  describe('2. ProductCard - Click Card to Add to Cart', () => {
    it('emits "add" when clicking anywhere on the product card', async () => {
      const product = {
        id: 'prod-1',
        name: 'Cappuccino Latte',
        price: 25000,
        stock: 10,
        category: 'Coffee',
      }

      const wrapper = mount(ProductCard, {
        props: { product },
      })

      // Click on the root article element
      await wrapper.find('[data-testid="pos-product-card"]').trigger('click')
      expect(wrapper.emitted('add')).toBeTruthy()
      expect(wrapper.emitted('add')[0][0]).toEqual(product)
    })

    it('does not emit "add" if product is out of stock', async () => {
      const product = {
        id: 'prod-oos',
        name: 'Croissant',
        price: 18000,
        stock: 0,
        kind: 'product',
      }

      const wrapper = mount(ProductCard, {
        props: { product },
      })

      await wrapper.find('[data-testid="pos-product-card"]').trigger('click')
      expect(wrapper.emitted('add')).toBeFalsy()
    })
  })

  describe('3. ActiveOrdersSheet & TransactionCard - Tambah Pesanan Visibility', () => {
    it('displays single Tambah Pesanan button in action row of ActiveOrdersSheet (no duplicate in header)', () => {
      const transactionStore = useTransactionStore()
      transactionStore.items = [
        {
          id: 'tx-live',
          invoiceNumber: 'INV-2026-LIVE',
          orderStatus: 'Proses',
          paymentStatus: 'unpaid',
          createdAt: new Date().toISOString(),
          total: 50000,
          items: [
            { name: 'Kopi 1', qty: 1, price: 10000 },
            { name: 'Kopi 2', qty: 1, price: 10000 },
            { name: 'Kopi 3', qty: 1, price: 10000 },
            { name: 'Kopi 4', qty: 1, price: 10000 },
            { name: 'Kopi 5', qty: 1, price: 10000 },
          ],
        },
      ]

      const wrapper = mount(ActiveOrdersSheet, {
        props: { open: true },
        global: { plugins: [pinia, router] },
      })

      // Duplicate button in header is removed
      const headerAddBtn = wrapper.find('[data-testid="btn-add-items-to-order-header"]')
      expect(headerAddBtn.exists()).toBe(false)

      // Single button in action section exists
      const actionAddBtn = wrapper.find('[data-testid="btn-add-items-to-order"]')
      expect(actionAddBtn.exists()).toBe(true)
      expect(actionAddBtn.text()).toContain('Pesanan')
    })

    it('displays direct Tambah Pesanan button on TransactionCard for in-process orders', async () => {
      const transaction = {
        id: 'tx-in-process',
        invoiceNumber: 'INV-LIVE-01',
        orderStatus: 'Proses',
        paymentStatus: 'unpaid',
        createdAt: new Date().toISOString(),
        total: 25000,
        items: [{ name: 'Espresso', qty: 1, price: 25000 }],
      }

      const wrapper = mount(TransactionCard, {
        props: { transaction },
        global: { plugins: [router] },
      })

      const addBtn = wrapper.find('[data-testid="btn-card-add-items"]')
      expect(addBtn.exists()).toBe(true)
      expect(addBtn.text()).toContain('Pesanan')
    })
  })

  describe('4. Transaction Store - Sort Order State & Filtering', () => {
    it('defaults sortOrder to "newest" in uiFilters', () => {
      const transactionStore = useTransactionStore()
      expect(transactionStore.uiFilters.sortOrder).toBe('newest')
    })
  })

  describe('5. Sync Pending Details Modal', () => {
    it('renders pending items with entity type, invoice, and error details', async () => {
      const syncPushStore = useSyncPushStore()
      syncPushStore.listPendingItems = vi.fn().mockResolvedValue([
        {
          id: 'queue-1',
          entityType: 'sale',
          entityId: 'sale-123',
          operation: 'upsert',
          payload: {
            invoiceNumber: 'INV-PENDING-001',
            customer: 'Kak Budi',
            total: 45000,
            items: [{ name: 'Kopi Susu', qty: 2 }],
          },
          createdAt: new Date().toISOString(),
          attemptCount: 2,
          lastError: 'HTTP 403: Batas kuota perangkat tercapai',
        },
      ])

      const wrapper = mount(SyncPendingDetailsModal, {
        props: { modelValue: true },
        global: { plugins: [pinia] },
      })

      await wrapper.vm.$nextTick()
      // Wait for async loadPendingItems
      await new Promise((r) => setTimeout(r, 20))

      expect(wrapper.text()).toContain('INV-PENDING-001')
      expect(wrapper.text()).toContain('Kak Budi')
      expect(wrapper.text()).toContain('Batas kuota perangkat tercapai')
      expect(wrapper.text()).toContain('Transaksi Penjualan')
    })
  })
})
