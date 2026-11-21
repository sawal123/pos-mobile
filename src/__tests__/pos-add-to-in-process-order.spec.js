import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'

import { useCartStore } from '@/stores/cartStore'
import { useTransactionStore } from '@/stores/transactionStore'
import { useProductStore } from '@/stores/productStore'
import { useBusinessStore } from '@/stores/businessStore'
import { useCashierStore } from '@/stores/cashierStore'
import { useTaxStore } from '@/stores/taxStore'

import PosView from '@/views/pos/PosView.vue'
import ActiveOrdersSheet from '@/components/pos/ActiveOrdersSheet.vue'
import CartSummary from '@/components/pos/CartSummary.vue'
import MobileCartSheet from '@/components/pos/MobileCartSheet.vue'

function createTestRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', redirect: '/pos' },
      { path: '/pos', name: 'pos', component: PosView },
      { path: '/payment', name: 'payment', component: { template: '<div>Payment</div>' } },
      { path: '/transactions', name: 'transactions', component: { template: '<div>Transactions</div>' } },
      { path: '/transactions/:id', name: 'transaction-detail', component: { template: '<div>Detail</div>' } },
      { path: '/transactions/:id/receipt', name: 'transaction-receipt', component: { template: '<div>Receipt</div>' } },
    ],
  })
}

describe('Fitur Tambah Pesanan pada Pesanan Berstatus Proses di Kasir', () => {
  let router
  let pinia

  beforeEach(async () => {
    pinia = createPinia()
    setActivePinia(pinia)
    router = createTestRouter()
    await router.push('/pos')
    await router.isReady()

    const businessStore = useBusinessStore()
    businessStore.setBusiness({
      id: 'biz-test',
      name: 'Kafe Kopi Uji',
      business_type: 'F&B',
      table_management_enabled: true,
    })

    const cashierStore = useCashierStore()
    cashierStore.setPinConfigured(true)

    const taxStore = useTaxStore()
    taxStore.setSettings({ enabled: false, rate: 0 })
  })

  describe('1. Cart Store - Order Editing & Attachment Actions', () => {
    it('loadOrderForEditing mengisi items, nomor meja, dan tamu ke cart', () => {
      const cartStore = useCartStore()
      const tx = {
        id: 'tx-100',
        invoiceNumber: 'INV-100',
        orderStatus: 'Proses',
        tableNumber: 'Meja 05',
        customer: 'Kak Dimas',
        customerSnapshot: { id: null, name: 'Kak Dimas', phone: '08123456789' },
        items: [
          { id: 'item-1', productId: 'prod-1', name: 'Kopi Susu', price: 18000, qty: 2 },
        ],
      }

      cartStore.loadOrderForEditing(tx)

      expect(cartStore.isEditingOrder).toBe(true)
      expect(cartStore.editingTransactionId).toBe('tx-100')
      expect(cartStore.editingTransactionInvoice).toBe('INV-100')
      expect(cartStore.tableNumber).toBe('Meja 05')
      expect(cartStore.customerName).toBe('Kak Dimas')
      expect(cartStore.items.length).toBe(1)
      expect(cartStore.items[0].name).toBe('Kopi Susu')
      expect(cartStore.items[0].qty).toBe(2)
      expect(cartStore.items[0].price).toBe(18000)
    })

    it('attachToActiveOrder menggabungkan item keranjang saat ini dengan pesanan berjalan', () => {
      const cartStore = useCartStore()
      // Misal kasir sudah memasukkan 1 Donat ke keranjang
      cartStore.addItem({ id: 'prod-2', name: 'Donat Coklat', price: 12000 })

      const tx = {
        id: 'tx-200',
        invoiceNumber: 'INV-200',
        orderStatus: 'Proses',
        tableNumber: 'VIP 1',
        customer: 'Kak Sarah',
        items: [
          { id: 'prod-1', productId: 'prod-1', name: 'Kopi Hitam', price: 15000, qty: 1 },
          { id: 'prod-2', productId: 'prod-2', name: 'Donat Coklat', price: 12000, qty: 1 },
        ],
      }

      cartStore.attachToActiveOrder(tx)

      expect(cartStore.isEditingOrder).toBe(true)
      expect(cartStore.editingTransactionId).toBe('tx-200')
      // Donat Coklat seharusnya diakumulasi qty-nya (1 dari tx + 1 dari cart = 2)
      const donat = cartStore.items.find((it) => it.productId === 'prod-2' || it.id === 'prod-2')
      expect(donat).toBeDefined()
      expect(donat.qty).toBe(2)
      // Kopi Hitam tetap ada
      const kopi = cartStore.items.find((it) => it.productId === 'prod-1' || it.id === 'prod-1')
      expect(kopi).toBeDefined()
      expect(kopi.qty).toBe(1)
    })

    it('cancelEditingOrder membersihkan status editing tanpa mengubah transaksi', () => {
      const cartStore = useCartStore()
      cartStore.loadOrderForEditing({
        id: 'tx-300',
        invoiceNumber: 'INV-300',
        orderStatus: 'Proses',
        items: [{ id: 'prod-1', name: 'Es Teh', price: 5000, qty: 2 }],
      })

      expect(cartStore.isEditingOrder).toBe(true)
      cartStore.cancelEditingOrder()

      expect(cartStore.isEditingOrder).toBe(false)
      expect(cartStore.editingTransactionId).toBeNull()
      expect(cartStore.items.length).toBe(0)
    })
  })

  describe('2. ActiveOrdersSheet - Tombol Tambah Pesanan', () => {
    it('menampilkan tombol "+ Tambah Pesanan" pada pesanan berstatus Proses atau Belum Lunas', async () => {
      const transactionStore = useTransactionStore()
      transactionStore.items = [
        {
          id: 'tx-proses',
          invoiceNumber: 'INV-PRS',
          orderStatus: 'Proses',
          paymentStatus: 'paid',
          createdAt: new Date().toISOString(),
          total: 35000,
          items: [{ name: 'Kopi Susu', qty: 1, price: 35000 }],
        },
        {
          id: 'tx-unpaid',
          invoiceNumber: 'INV-UNP',
          orderStatus: 'Siap',
          paymentStatus: 'unpaid',
          createdAt: new Date().toISOString(),
          total: 20000,
          items: [{ name: 'Roti Bakar', qty: 1, price: 20000 }],
        },
      ]

      const wrapper = mount(ActiveOrdersSheet, {
        props: { open: true },
        global: { plugins: [pinia, router] },
      })

      const addButtons = wrapper.findAll('[data-testid="btn-add-items-to-order"]')
      expect(addButtons.length).toBe(2)

      // Klik tombol tambah pesanan pada transaksi pertama
      await addButtons[0].trigger('click')
      expect(wrapper.emitted('add-to-order')).toBeTruthy()
      expect(wrapper.emitted('add-to-order')[0][0].id).toBe('tx-proses')
      expect(wrapper.emitted('close')).toBeTruthy()
    })
  })

  describe('3. PosView - Mode Tambah Pesanan di Halaman Kasir', () => {
    it('menampilkan banner editing, menambah item baru, dan menyimpan tambahan pesanan', async () => {
      const productStore = useProductStore()
      const transactionStore = useTransactionStore()
      const cartStore = useCartStore()

      productStore.products = [
        { id: 'p-kopi', name: 'Kopi Tubruk', price: 10000, stock: 20 },
        { id: 'p-kentang', name: 'Kentang Goreng', price: 15000, stock: 15 },
      ]

      const initialTx = {
        id: 'tx-live-1',
        invoiceNumber: 'INV-2026-LIVE',
        orderStatus: 'Proses',
        paymentStatus: 'unpaid',
        status: 'unpaid',
        tableNumber: '04',
        customer: 'Kak Rian',
        createdAt: new Date().toISOString(),
        items: [
          {
            id: 'p-kopi',
            productId: 'p-kopi',
            name: 'Kopi Tubruk',
            price: 10000,
            unitPrice: 10000,
            qty: 1,
            subtotal: 10000,
          },
        ],
        subtotal: 10000,
        tax: 0,
        discount: 0,
        total: 10000,
      }
      transactionStore.items = [initialTx]

      const wrapper = mount(PosView, {
        global: { plugins: [pinia, router] },
      })

      // 1. Kasir memuat pesanan untuk menambah menu
      cartStore.loadOrderForEditing(initialTx)
      await wrapper.vm.$nextTick()

      // Banner mode tambah pesanan harus muncul
      const banner = wrapper.find('[data-testid="editing-order-banner"]')
      expect(banner.exists()).toBe(true)
      expect(banner.text()).toContain('INV-2026-LIVE')
      expect(banner.text()).toContain('Meja 04')

      // 2. Kasir menambah 1 Kentang Goreng dari katalog POS
      wrapper.vm.handleProductAdd(productStore.products[1])
      await wrapper.vm.$nextTick()

      expect(cartStore.items.length).toBe(2)
      expect(cartStore.total).toBe(25000)

      // 3. Kasir menekan tombol "Simpan Tambahan"
      const saveBtn = wrapper.find('[data-testid="btn-save-order-addition"]')
      expect(saveBtn.exists()).toBe(true)
      await saveBtn.trigger('click')

      // Periksa transaksi di store telah diperbarui
      const updatedTx = transactionStore.items.find((t) => t.id === 'tx-live-1')
      expect(updatedTx.items.length).toBe(2)
      expect(updatedTx.total).toBe(25000)

      // Periksa stok produk kentang telah terpotong (dari 15 menjadi 14)
      const kentang = productStore.products.find((p) => p.id === 'p-kentang')
      expect(kentang.stock).toBe(14)

      // Status editing cart telah dibersihkan
      expect(cartStore.isEditingOrder).toBe(false)
      expect(cartStore.items.length).toBe(0)
    })

    it('kasir dapat membatalkan mode tambah pesanan tanpa mengubah transaksi asli', async () => {
      const transactionStore = useTransactionStore()
      const cartStore = useCartStore()

      const initialTx = {
        id: 'tx-live-2',
        invoiceNumber: 'INV-LIVE-2',
        orderStatus: 'Proses',
        paymentStatus: 'unpaid',
        items: [{ id: 'p-1', productId: 'p-1', name: 'Item Asli', price: 10000, qty: 1 }],
        total: 10000,
      }
      transactionStore.items = [initialTx]

      const wrapper = mount(PosView, {
        global: { plugins: [pinia, router] },
      })

      cartStore.loadOrderForEditing(initialTx)
      await wrapper.vm.$nextTick()

      // Kasir menambah item sembarang ke cart
      cartStore.items.push({ id: 'p-extra', name: 'Item Extra', price: 5000, qty: 1 })
      await wrapper.vm.$nextTick()

      // Kasir menekan Batal
      const cancelBtn = wrapper.find('[data-testid="btn-cancel-edit-order"]')
      expect(cancelBtn.exists()).toBe(true)
      await cancelBtn.trigger('click')

      // Transaksi asli tidak berubah
      const tx = transactionStore.items.find((t) => t.id === 'tx-live-2')
      expect(tx.items.length).toBe(1)
      expect(tx.total).toBe(10000)
      expect(cartStore.isEditingOrder).toBe(false)
    })
  })

  describe('4. CartSummary & MobileCartSheet - Komponen Pendukung Tambah Pesanan', () => {
    it('CartSummary menampilkan dropdown gabung pesanan dan indikator mode edit', async () => {
      const transactionStore = useTransactionStore()
      const cartStore = useCartStore()

      transactionStore.items = [
        {
          id: 'tx-active',
          invoiceNumber: 'INV-ACT-1',
          orderStatus: 'Proses',
          tableNumber: 'Meja 02',
          items: [{ id: 'p-1', name: 'Teh Hangat', price: 4000, qty: 1 }],
        },
      ]

      cartStore.items = [{ id: 'p-2', name: 'Pisang Goreng', price: 10000, qty: 1 }]

      const wrapper = mount(CartSummary, {
        props: {
          subtotal: 10000,
          total: 10000,
          disabled: false,
        },
        global: { plugins: [pinia, router] },
      })

      // Ketika belum mode edit, dropdown gabung pesanan harus ada
      const attachSection = wrapper.find('[data-testid="attach-to-order-section"]')
      expect(attachSection.exists()).toBe(true)

      const select = wrapper.find('[data-testid="select-attach-to-active-order"]')
      await select.setValue('tx-active')
      await select.trigger('change')

      // CartStore sekarang beralih ke mode edit untuk tx-active
      expect(cartStore.isEditingOrder).toBe(true)
      expect(cartStore.editingTransactionId).toBe('tx-active')

      await wrapper.vm.$nextTick()
      const indicator = wrapper.find('[data-testid="cart-editing-order-indicator"]')
      expect(indicator.exists()).toBe(true)
      expect(indicator.text()).toContain('INV-ACT-1')
    })

    it('MobileCartSheet menampilkan tombol "Simpan Tambahan" saat mode edit', async () => {
      const cartStore = useCartStore()
      cartStore.loadOrderForEditing({
        id: 'tx-mob-1',
        invoiceNumber: 'INV-MOB',
        orderStatus: 'Proses',
        items: [{ id: 'p-1', name: 'Es Coklat', price: 12000, qty: 1 }],
      })

      const wrapper = mount(MobileCartSheet, {
        props: { open: true },
        global: { plugins: [pinia, router] },
      })

      expect(wrapper.find('[data-testid="mobile-editing-order-banner"]').exists()).toBe(true)
      const saveBtn = wrapper.find('[data-testid="mobile-cart-save-order"]')
      expect(saveBtn.exists()).toBe(true)
      expect(saveBtn.text()).toContain('Simpan Tambahan')

      const cancelBtn = wrapper.find('[data-testid="mobile-cart-cancel-edit"]')
      expect(cancelBtn.exists()).toBe(true)
    })
  })
})
