import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import BottomNavigation from '@/components/layout/BottomNavigation.vue'
import { getBottomNavItems, getOperationalMenuItems } from '@/navigation/operationalMenu'
import { createAppRouter } from '@/router'
import { createBackupPayload, restoreBackupPayload, validateBackupPayload } from '@/services/backupService'
import { createMemoryAdapter } from '@/services/database/memoryAdapter'
import { useBusinessStore } from '@/stores/businessStore'
import { useCashStore } from '@/stores/cashStore'
import { useCashierStore } from '@/stores/cashierStore'
import { useCustomerStore } from '@/stores/customerStore'
import { useExpenseStore } from '@/stores/expenseStore'
import { useProductStore } from '@/stores/productStore'
import { useShiftStore } from '@/stores/shiftStore'
import {
  ORDER_LIFECYCLE,
  createLaundryOrderNumber,
  useTransactionStore,
} from '@/stores/transactionStore'
import HomeView from '@/views/home/HomeView.vue'
import LaundryOrderCreateView from '@/views/laundry/LaundryOrderCreateView.vue'
import LaundryOrderDetailView from '@/views/laundry/LaundryOrderDetailView.vue'
import LaundryOrdersView from '@/views/laundry/LaundryOrdersView.vue'

function setupTestContext(businessType = 'Laundry') {
  const pinia = createPinia()
  setActivePinia(pinia)

  const router = createAppRouter()
  const businessStore = useBusinessStore()
  const cashierStore = useCashierStore()
  const shiftStore = useShiftStore()
  const customerStore = useCustomerStore()
  const expenseStore = useExpenseStore()
  const productStore = useProductStore()
  const cashStore = useCashStore()
  const transactionStore = useTransactionStore()

  businessStore.setBusiness({
    name: 'Berkah Laundry',
    type: businessType,
    owner: 'Owner Test',
    phone: '081234567890',
    outlet: 'Outlet Laundry',
    mode: 'free',
  })

  cashierStore.setPinConfigured(true)
  shiftStore.openShift(100000)

  // Clear seed/mock transactions to have a clean state
  transactionStore.items = []

  return {
    pinia,
    router,
    businessStore,
    cashierStore,
    shiftStore,
    customerStore,
    expenseStore,
    productStore,
    cashStore,
    transactionStore,
  }
}

describe('Laundry Transaction and Order Flow', () => {
  let ctx

  beforeEach(() => {
    ctx = setupTestContext('Laundry')
  })

  describe('1. Routing based on business type', () => {
    it('retail business (Cafe / UMKM) routes to POS', async () => {
      const retailCtx = setupTestContext('Cafe / UMKM')
      await retailCtx.router.push('/pos')
      await flushPromises()

      expect(retailCtx.router.currentRoute.value.name).toBe('pos')

      // Trying to access laundry routes redirects retail to pos
      await retailCtx.router.push('/laundry/orders')
      await flushPromises()
      expect(retailCtx.router.currentRoute.value.name).toBe('pos')

      const menuItems = getOperationalMenuItems('Cafe / UMKM')
      const posItem = menuItems.find((item) => item.key === 'pos')
      expect(posItem.to).toBe('/pos')
      expect(posItem.title).toBe('POS')

      const navItems = getBottomNavItems('Cafe / UMKM')
      const bottomPos = navItems.find((item) => item.key === 'pos')
      expect(bottomPos.to).toBe('/pos')
      expect(bottomPos.label).toBe('POS')
    })

    it('retail business (Grosir / Toko Kelontong) routes to POS', async () => {
      const grosirCtx = setupTestContext('Grosir / Toko Kelontong')
      await grosirCtx.router.push('/pos')
      await flushPromises()

      expect(grosirCtx.router.currentRoute.value.name).toBe('pos')

      const menuItems = getOperationalMenuItems('Grosir / Toko Kelontong')
      const posItem = menuItems.find((item) => item.key === 'pos')
      expect(posItem.to).toBe('/pos')
    })

    it('Laundry routes /pos to /laundry/orders and operational menu points to /laundry/orders', async () => {
      await ctx.router.push('/pos')
      await flushPromises()

      expect(ctx.router.currentRoute.value.name).toBe('laundry-orders')
      expect(ctx.router.currentRoute.value.path).toBe('/laundry/orders')

      const menuItems = getOperationalMenuItems('Laundry')
      const posItem = menuItems.find((item) => item.key === 'pos')
      expect(posItem.to).toBe('/laundry/orders')
      expect(posItem.title).toBe('Order Laundry')

      const navItems = getBottomNavItems('Laundry')
      const bottomPos = navItems.find((item) => item.key === 'pos')
      expect(bottomPos.to).toBe('/laundry/orders')
      expect(bottomPos.label).toBe('Order')
    })
  })

  describe('2. Customer management in laundry order', () => {
    it('customer wajib diisi nama dan nomor HP saat membuat order', async () => {
      await ctx.router.push('/laundry/orders/create')
      await flushPromises()

      const wrapper = mount(LaundryOrderCreateView, {
        global: { plugins: [ctx.pinia, ctx.router] },
      })

      // Try submitting without customer info
      const submitBtn = wrapper.find('[data-testid="btn-submit-order"]')
      await submitBtn.trigger('click')
      await flushPromises()

      expect(wrapper.text()).toContain('Nama pelanggan wajib diisi')
      expect(wrapper.text()).toContain('Nomor HP pelanggan wajib diisi')
      expect(ctx.transactionStore.items.length).toBe(0)
    })

    it('reuse existing customer berdasarkan nomor HP tanpa duplikasi', () => {
      // Existing customer created earlier
      ctx.customerStore.createCustomer({
        name: 'Budi Santoso',
        phone: '08123456789',
      })
      expect(ctx.customerStore.customers.length).toBe(1)
      const existingId = ctx.customerStore.customers[0].id

      // Searching / creating with same phone
      const res = ctx.customerStore.findOrCreateCustomer({
        name: 'Budi Santoso',
        phone: '08123456789',
      })

      expect(res.isNew).toBe(false)
      expect(res.customer.id).toBe(existingId)
      expect(ctx.customerStore.customers.length).toBe(1)
    })

    it('buat customer baru jika nomor HP belum terdaftar', () => {
      expect(ctx.customerStore.customers.length).toBe(0)

      const res = ctx.customerStore.findOrCreateCustomer({
        name: 'Siti Aminah',
        phone: '08987654321',
      })

      expect(res.isNew).toBe(true)
      expect(res.customer.name).toBe('Siti Aminah')
      expect(ctx.customerStore.customers.length).toBe(1)
    })
  })

  describe('3 & 4. Service selection, decimal quantity for kg, integer for pcs, and HPP snapshot', () => {
    beforeEach(() => {
      ctx.productStore.products = [
        {
          id: 'srv-1',
          name: 'Cuci + Setrika',
          kind: 'service',
          pricingUnit: 'kg',
          unit: 'kg',
          price: 10000,
          cost: 4000,
          minQuantity: 0,
          isActive: true,
        },
        {
          id: 'srv-2',
          name: 'Sprei',
          kind: 'service',
          pricingUnit: 'pcs',
          unit: 'pcs',
          price: 15000,
          cost: 6000,
          minQuantity: 2,
          isActive: true,
        },
        {
          id: 'srv-inactive',
          name: 'Dry Clean Jas',
          kind: 'service',
          pricingUnit: 'pcs',
          unit: 'pcs',
          price: 50000,
          cost: 20000,
          isActive: false,
        },
      ]
    })

    it('hanya menampilkan service Laundry yang aktif', async () => {
      await ctx.router.push('/laundry/orders/create')
      await flushPromises()

      const wrapper = mount(LaundryOrderCreateView, {
        global: { plugins: [ctx.pinia, ctx.router] },
      })

      expect(wrapper.text()).toContain('Cuci + Setrika')
      expect(wrapper.text()).toContain('Sprei')
      expect(wrapper.text()).not.toContain('Dry Clean Jas')
    })

    it('kg menerima decimal dan pcs menolak decimal serta menghitung subtotal & total benar', () => {
      const order = ctx.transactionStore.createLaundryOrder({
        customer: 'Andi',
        items: [
          {
            serviceId: 'srv-1',
            name: 'Cuci + Setrika',
            pricingUnit: 'kg',
            qty: 3.5,
            price: 10000,
            cost: 4000,
          },
          {
            serviceId: 'srv-2',
            name: 'Sprei',
            pricingUnit: 'pcs',
            qty: 2,
            price: 15000,
            cost: 6000,
          },
        ],
      })

      expect(order.items[0].qty).toBe(3.5)
      expect(order.items[0].subtotal).toBe(35000)
      expect(order.items[1].qty).toBe(2)
      expect(order.items[1].subtotal).toBe(30000)
      expect(order.total).toBe(65000)
      expect(order.grossProfit).toBe((35000 - 3.5 * 4000) + (30000 - 2 * 6000))
    })

    it('validasi decimal pada pcs dan decimal valid pada kg di create order view', async () => {
      await ctx.router.push('/laundry/orders/create')
      await flushPromises()

      const wrapper = mount(LaundryOrderCreateView, {
        global: { plugins: [ctx.pinia, ctx.router] },
      })

      // Select both services
      await wrapper.find('[data-testid="service-card-srv-1"]').trigger('click')
      await wrapper.find('[data-testid="service-card-srv-2"]').trigger('click')
      await flushPromises()

      expect(wrapper.findAll('[data-testid^="selected-item-"]').length).toBe(2)

      // Set valid decimal 3.75 for kg
      const kgInput = wrapper.find('[data-testid="selected-item-srv-1"] input[data-testid="input-item-qty"]')
      await kgInput.setValue('3.75')
      await flushPromises()

      // Set invalid decimal 1.5 for pcs
      const pcsInput = wrapper.find('[data-testid="selected-item-srv-2"] input[data-testid="input-item-qty"]')
      await pcsInput.setValue('1.5')
      await flushPromises()

      expect(wrapper.text()).toContain('Layanan satuan (pcs) harus berupa angka bulat')

      // Fix pcs to integer 2
      await pcsInput.setValue('2')
      await flushPromises()

      expect(wrapper.text()).not.toContain('Layanan satuan (pcs) harus berupa angka bulat')
    })

    it('minimumQuantity dihormati', async () => {
      await ctx.router.push('/laundry/orders/create')
      await flushPromises()

      const wrapper = mount(LaundryOrderCreateView, {
        global: { plugins: [ctx.pinia, ctx.router] },
      })

      // srv-2 has minQuantity = 2
      await wrapper.find('[data-testid="service-card-srv-2"]').trigger('click')
      await flushPromises()

      const pcsInput = wrapper.find('[data-testid="selected-item-srv-2"] input[data-testid="input-item-qty"]')
      // Set to 1 (below minimum 2)
      await pcsInput.setValue('1')
      await flushPromises()

      expect(wrapper.text()).toContain('Minimal order 2 pcs')
    })

    it('HPP snapshot tidak berubah saat harga master service diubah setelah order dibuat', () => {
      const order = ctx.transactionStore.createLaundryOrder({
        customer: 'Rina',
        items: [
          {
            serviceId: 'srv-1',
            name: 'Cuci + Setrika',
            pricingUnit: 'kg',
            qty: 2.5,
            price: 10000,
            cost: 4000,
          },
        ],
      })

      expect(order.items[0].costSnapshot).toBe(4000)
      expect(order.items[0].unitPrice).toBe(10000)

      // Master service is updated later
      const masterService = ctx.productStore.products.find((p) => p.id === 'srv-1')
      masterService.price = 15000
      masterService.cost = 7000

      // Order snapshot remains intact
      expect(order.items[0].costSnapshot).toBe(4000)
      expect(order.items[0].unitPrice).toBe(10000)
      expect(order.items[0].subtotal).toBe(25000)
    })
  })

  describe('5. Order information & unique order number', () => {
    it('nomor order unik dan human-readable LDR-YYYYMMDD-XXXX', () => {
      const date = new Date(2026, 8, 14) // 2026-09-14
      const orderNumber1 = createLaundryOrderNumber([], date)
      expect(orderNumber1).toBe('LDR-20260914-0001')

      const orderNumber2 = createLaundryOrderNumber([{ orderNumber: 'LDR-20260914-0001' }], date)
      expect(orderNumber2).toBe('LDR-20260914-0002')

      const orderNumber3 = createLaundryOrderNumber(
        [{ orderNumber: 'LDR-20260914-0001' }, { orderNumber: 'LDR-20260914-0002' }],
        date,
      )
      expect(orderNumber3).toBe('LDR-20260914-0003')
    })

    it('order menyimpan seluruh payload mandatory', () => {
      const order = ctx.transactionStore.createLaundryOrder({
        customerId: 'cust-123',
        customer: 'Dewi',
        customerSnapshot: { id: 'cust-123', name: 'Dewi', phone: '081222333444' },
        businessSnapshot: { name: 'Berkah Laundry', outlet: 'Outlet 1' },
        items: [
          { serviceId: 's1', name: 'Cuci Kering', qty: 2, price: 8000, cost: 3000, pricingUnit: 'kg' },
        ],
        subtotal: 16000,
        total: 16000,
        estimatedCompletedAt: '2026-09-16T15:00:00.000Z',
        note: 'Pewangi lavender',
      })

      expect(order.id).toBeTruthy()
      expect(order.orderNumber).toMatch(/^LDR-\d{8}-\d{4}$/)
      expect(order.customerId).toBe('cust-123')
      expect(order.customerSnapshot).toEqual({ id: 'cust-123', name: 'Dewi', phone: '081222333444', email: '' })
      expect(order.businessSnapshot).toEqual({ name: 'Berkah Laundry', outlet: 'Outlet 1' })
      expect(order.items.length).toBe(1)
      expect(order.subtotal).toBe(16000)
      expect(order.total).toBe(16000)
      expect(order.grossProfit).toBe(16000 - 6000)
      expect(order.orderStatus).toBe('Masuk')
      expect(order.paymentStatus).toBe('unpaid')
      expect(order.estimatedCompletedAt).toBe('2026-09-16T15:00:00.000Z')
      expect(order.note).toBe('Pewangi lavender')
      expect(order.createdAt).toBeTruthy()
      expect(order.updatedAt).toBeTruthy()
    })
  })

  describe('6. Estimasi selesai', () => {
    it('order menyimpan datetime aktual estimatedCompletedAt bukan sekedar string', () => {
      const testIso = '2026-09-16T17:30:00.000Z'
      const order = ctx.transactionStore.createLaundryOrder({
        customer: 'Fajar',
        items: [{ serviceId: 's1', name: 'Setrika', qty: 1, price: 5000 }],
        estimatedCompletedAt: testIso,
      })

      expect(order.estimatedCompletedAt).toBe(testIso)
      expect(Number.isNaN(new Date(order.estimatedCompletedAt).getTime())).toBe(false)
    })
  })

  describe('7. Status order lifecycle', () => {
    it('default status Masuk dan maju sesuai lifecycle Masuk -> Diproses -> Siap Diambil -> Selesai', () => {
      const order = ctx.transactionStore.createLaundryOrder({
        customer: 'Hendra',
        items: [{ serviceId: 's1', name: 'Cuci', qty: 1, price: 10000 }],
      })

      expect(order.orderStatus).toBe('Masuk')
      const initialUpdatedAt = order.updatedAt

      // Advance to Diproses
      const adv1 = ctx.transactionStore.advanceOrderStatus(order.id)
      expect(adv1).toBe(true)
      expect(order.orderStatus).toBe('Diproses')
      expect(order.updatedAt >= initialUpdatedAt).toBe(true)

      // Advance to Siap Diambil
      const adv2 = ctx.transactionStore.advanceOrderStatus(order.id)
      expect(adv2).toBe(true)
      expect(order.orderStatus).toBe('Siap Diambil')

      // Advance to Selesai
      const adv3 = ctx.transactionStore.advanceOrderStatus(order.id)
      expect(adv3).toBe(true)
      expect(order.orderStatus).toBe('Selesai')

      // Selesai cannot advance further
      const adv4 = ctx.transactionStore.advanceOrderStatus(order.id)
      expect(adv4).toBe(false)
      expect(order.orderStatus).toBe('Selesai')
    })

    it('strict lifecycle: hanya menerima status sama (idempotent) atau step berikutnya (currentIndex + 1)', () => {
      const order = ctx.transactionStore.createLaundryOrder({
        customer: 'Kiki',
        items: [{ serviceId: 's1', name: 'Cuci', qty: 1, price: 10000 }],
      })
      expect(order.orderStatus).toBe('Masuk')
      const initialUpdatedAt = order.updatedAt

      // Same status: allowed (idempotent / no-op), updatedAt tidak berubah
      const sameStatus = ctx.transactionStore.updateOrderStatus(order.id, 'Masuk')
      expect(sameStatus).toBe(true)
      expect(order.orderStatus).toBe('Masuk')
      expect(order.updatedAt).toBe(initialUpdatedAt)

      // Ditolak: Masuk -> Siap Diambil (skip maju)
      expect(ctx.transactionStore.updateOrderStatus(order.id, 'Siap Diambil')).toBe(false)
      expect(order.orderStatus).toBe('Masuk')

      // Ditolak: Masuk -> Selesai (skip maju)
      expect(ctx.transactionStore.updateOrderStatus(order.id, 'Selesai')).toBe(false)
      expect(order.orderStatus).toBe('Masuk')

      // Sukses: Masuk -> Diproses
      expect(ctx.transactionStore.updateOrderStatus(order.id, 'Diproses')).toBe(true)
      expect(order.orderStatus).toBe('Diproses')

      // Ditolak: Diproses -> Selesai (skip maju)
      expect(ctx.transactionStore.updateOrderStatus(order.id, 'Selesai')).toBe(false)
      expect(order.orderStatus).toBe('Diproses')

      // Ditolak: backward Diproses -> Masuk
      expect(ctx.transactionStore.updateOrderStatus(order.id, 'Masuk')).toBe(false)
      expect(order.orderStatus).toBe('Diproses')

      // Sukses: Diproses -> Siap Diambil
      expect(ctx.transactionStore.updateOrderStatus(order.id, 'Siap Diambil')).toBe(true)
      expect(order.orderStatus).toBe('Siap Diambil')

      // Ditolak: backward Siap Diambil -> Masuk
      expect(ctx.transactionStore.updateOrderStatus(order.id, 'Masuk')).toBe(false)

      // Ditolak: backward Siap Diambil -> Diproses
      expect(ctx.transactionStore.updateOrderStatus(order.id, 'Diproses')).toBe(false)
      expect(order.orderStatus).toBe('Siap Diambil')

      // Sukses: Siap Diambil -> Selesai
      expect(ctx.transactionStore.updateOrderStatus(order.id, 'Selesai')).toBe(true)
      expect(order.orderStatus).toBe('Selesai')

      // Ditolak: backward Selesai -> Diproses
      expect(ctx.transactionStore.updateOrderStatus(order.id, 'Diproses')).toBe(false)
      expect(order.orderStatus).toBe('Selesai')
    })
  })

  describe('8. Payment status: Bayar Nanti vs Bayar Sekarang, idempotent payment', () => {
    it('Bayar Nanti membuat order unpaid dan tidak menambah kas entry', () => {
      const initialBalance = ctx.cashStore.balance
      const initialEntriesCount = ctx.cashStore.entries.length

      const order = ctx.transactionStore.createLaundryOrder({
        customer: 'Maya',
        paymentStatus: 'unpaid',
        items: [{ serviceId: 's1', name: 'Cuci', qty: 1, price: 20000, cost: 5000 }],
        total: 20000,
      })

      expect(order.paymentStatus).toBe('unpaid')
      expect(ctx.cashStore.balance).toBe(initialBalance)
      expect(ctx.cashStore.entries.length).toBe(initialEntriesCount)
    })

    it('settleLaundryOrderPayment: unpaid + cash success -> paid dan tepat 1 cash entry', () => {
      const order = ctx.transactionStore.createLaundryOrder({
        customer: 'Nina',
        paymentStatus: 'unpaid',
        items: [{ serviceId: 's1', name: 'Cuci', qty: 1, price: 50000, cost: 10000 }],
        total: 50000,
      })

      const initialEntriesCount = ctx.cashStore.entries.length
      const initialBalance = ctx.cashStore.balance

      const res = ctx.transactionStore.settleLaundryOrderPayment({
        orderId: order.id,
        paymentMethod: 'cash',
        cashReceived: 60000,
        changeAmount: 10000,
        cashStore: ctx.cashStore,
      })

      expect(res.success).toBe(true)
      expect(res.duplicated).toBe(false)
      expect(order.paymentStatus).toBe('paid')
      expect(order.status).toBe('paid')
      expect(order.paymentMethod).toBe('cash')
      expect(order.cashReceived).toBe(60000)
      expect(order.changeAmount).toBe(10000)

      expect(ctx.cashStore.entries.length).toBe(initialEntriesCount + 1)
      expect(ctx.cashStore.balance).toBe(initialBalance + 50000)
      expect(ctx.cashStore.entries.filter((e) => e.referenceId === `sale-${order.id}`).length).toBe(1)
    })

    it('settleLaundryOrderPayment: retry pada order yang sudah paid bersifat idempotent', () => {
      const order = ctx.transactionStore.createLaundryOrder({
        customer: 'Rudi',
        paymentStatus: 'unpaid',
        items: [{ serviceId: 's1', name: 'Cuci', qty: 1, price: 35000, cost: 10000 }],
        total: 35000,
      })

      const initialBalance = ctx.cashStore.balance

      // First settlement
      const res1 = ctx.transactionStore.settleLaundryOrderPayment({
        orderId: order.id,
        paymentMethod: 'cash',
        cashReceived: 50000,
        changeAmount: 15000,
        cashStore: ctx.cashStore,
      })
      expect(res1.success).toBe(true)
      expect(res1.duplicated).toBe(false)
      expect(order.paymentStatus).toBe('paid')
      expect(ctx.cashStore.balance).toBe(initialBalance + 35000)
      expect(ctx.cashStore.entries.filter((e) => e.referenceId === `sale-${order.id}`).length).toBe(1)

      // Retry settlement
      const res2 = ctx.transactionStore.settleLaundryOrderPayment({
        orderId: order.id,
        paymentMethod: 'cash',
        cashReceived: 50000,
        changeAmount: 15000,
        cashStore: ctx.cashStore,
      })
      expect(res2.success).toBe(true)
      expect(res2.duplicated).toBe(true)
      expect(ctx.cashStore.balance).toBe(initialBalance + 35000)
      expect(ctx.cashStore.entries.filter((e) => e.referenceId === `sale-${order.id}`).length).toBe(1)
    })

    it('settleLaundryOrderPayment: QRIS dan Card menjadi paid tanpa membuat cash entry', () => {
      const orderQris = ctx.transactionStore.createLaundryOrder({
        customer: 'Deni',
        paymentStatus: 'unpaid',
        items: [{ serviceId: 's1', name: 'Cuci', qty: 1, price: 25000 }],
        total: 25000,
      })

      const orderCard = ctx.transactionStore.createLaundryOrder({
        customer: 'Sari',
        paymentStatus: 'unpaid',
        items: [{ serviceId: 's1', name: 'Cuci', qty: 1, price: 40000 }],
        total: 40000,
      })

      const initialCashEntries = ctx.cashStore.entries.length

      // QRIS
      const resQris = ctx.transactionStore.settleLaundryOrderPayment({
        orderId: orderQris.id,
        paymentMethod: 'qris',
        cashStore: ctx.cashStore,
      })
      expect(resQris.success).toBe(true)
      expect(orderQris.paymentStatus).toBe('paid')
      expect(orderQris.paymentMethod).toBe('qris')
      expect(ctx.cashStore.entries.length).toBe(initialCashEntries)

      // Card
      const resCard = ctx.transactionStore.settleLaundryOrderPayment({
        orderId: orderCard.id,
        paymentMethod: 'card',
        cashStore: ctx.cashStore,
      })
      expect(resCard.success).toBe(true)
      expect(orderCard.paymentStatus).toBe('paid')
      expect(orderCard.paymentMethod).toBe('card')
      expect(ctx.cashStore.entries.length).toBe(initialCashEntries)
    })

    it('settleLaundryOrderPayment: kegagalan cashStore mempertahankan status unpaid dan retry berhasil', () => {
      const order = ctx.transactionStore.createLaundryOrder({
        customer: 'Toni',
        paymentStatus: 'unpaid',
        items: [{ serviceId: 's1', name: 'Cuci', qty: 1, price: 30000 }],
        total: 30000,
      })

      // Mock cashStore failure
      const failingCashStore = {
        recordSalePayment: vi.fn().mockReturnValue({
          success: false,
          error: 'simulated failure',
        }),
      }

      const failRes = ctx.transactionStore.settleLaundryOrderPayment({
        orderId: order.id,
        paymentMethod: 'cash',
        cashReceived: 50000,
        cashStore: failingCashStore,
      })

      expect(failRes.success).toBe(false)
      expect(failRes.error).toBe('simulated failure')
      expect(order.paymentStatus).toBe('unpaid')
      expect(order.status).toBe('unpaid')

      // Retry with normal cashStore succeeds
      const retryRes = ctx.transactionStore.settleLaundryOrderPayment({
        orderId: order.id,
        paymentMethod: 'cash',
        cashReceived: 50000,
        changeAmount: 20000,
        cashStore: ctx.cashStore,
      })

      expect(retryRes.success).toBe(true)
      expect(order.paymentStatus).toBe('paid')
      expect(order.status).toBe('paid')
      expect(order.paymentMethod).toBe('cash')
      expect(ctx.cashStore.entries.filter((e) => e.referenceId === `sale-${order.id}`).length).toBe(1)
    })
  })

  describe('9. List order laundry search & filter', () => {
    beforeEach(() => {
      ctx.transactionStore.items = [
        {
          id: 'ord-1',
          orderNumber: 'LDR-20260914-0001',
          customer: 'Ahmad Dahlan',
          customerSnapshot: { phone: '0811111111' },
          orderStatus: 'Masuk',
          paymentStatus: 'unpaid',
          total: 25000,
          createdAt: '2026-09-14T08:00:00.000Z',
          items: [{ name: 'Cuci Kering', qty: 2.5, unit: 'kg', price: 10000, subtotal: 25000 }],
        },
        {
          id: 'ord-2',
          orderNumber: 'LDR-20260914-0002',
          customer: 'Bunga Citra',
          customerSnapshot: { phone: '0822222222' },
          orderStatus: 'Diproses',
          paymentStatus: 'paid',
          total: 50000,
          createdAt: '2026-09-14T09:00:00.000Z',
          items: [{ name: 'Bed Cover', qty: 1, unit: 'pcs', price: 50000, subtotal: 50000 }],
        },
        {
          id: 'ord-3',
          orderNumber: 'LDR-20260914-0003',
          customer: 'Cahyo Utomo',
          customerSnapshot: { phone: '0833333333' },
          orderStatus: 'Siap Diambil',
          paymentStatus: 'unpaid',
          total: 30000,
          createdAt: '2026-09-14T10:00:00.000Z',
          items: [{ name: 'Cuci Setrika', qty: 3, unit: 'kg', price: 10000, subtotal: 30000 }],
        },
        {
          id: 'ord-4',
          orderNumber: 'LDR-20260914-0004',
          customer: 'Dina Mariana',
          customerSnapshot: { phone: '0844444444' },
          orderStatus: 'Selesai',
          paymentStatus: 'paid',
          total: 40000,
          createdAt: '2026-09-14T11:00:00.000Z',
          items: [{ name: 'Express', qty: 2, unit: 'kg', price: 20000, subtotal: 40000 }],
        },
      ]
    })

    it('menampilkan daftar order dengan nomor order, customer, total, dan badge status', async () => {
      await ctx.router.push('/laundry/orders')
      await flushPromises()

      const wrapper = mount(LaundryOrdersView, {
        global: { plugins: [ctx.pinia, ctx.router] },
      })

      expect(wrapper.text()).toContain('LDR-20260914-0001')
      expect(wrapper.text()).toContain('Ahmad Dahlan')
      expect(wrapper.text()).toContain('0811111111')
      expect(wrapper.text()).toContain('LDR-20260914-0004')
      expect(wrapper.findAll('[data-testid^="order-card-"]').length).toBe(4)
    })

    it('filter berdasarkan lifecycle status', async () => {
      await ctx.router.push('/laundry/orders')
      await flushPromises()

      const wrapper = mount(LaundryOrdersView, {
        global: { plugins: [ctx.pinia, ctx.router] },
      })

      // Filter Diproses
      await wrapper.find('[data-testid="filter-status-Diproses"]').trigger('click')
      await flushPromises()

      expect(wrapper.text()).toContain('Bunga Citra')
      expect(wrapper.text()).not.toContain('Ahmad Dahlan')
      expect(wrapper.text()).not.toContain('Cahyo Utomo')
      expect(wrapper.findAll('[data-testid^="order-card-"]').length).toBe(1)
    })

    it('search order berdasarkan nomor order, nama customer, atau nomor HP', async () => {
      await ctx.router.push('/laundry/orders')
      await flushPromises()

      const wrapper = mount(LaundryOrdersView, {
        global: { plugins: [ctx.pinia, ctx.router] },
      })

      const searchInput = wrapper.find('[data-testid="search-order-input"] input')

      // Search by Order Number
      await searchInput.setValue('0003')
      await flushPromises()
      expect(wrapper.text()).toContain('Cahyo Utomo')
      expect(wrapper.text()).not.toContain('Ahmad Dahlan')

      // Search by Phone
      await searchInput.setValue('0822222222')
      await flushPromises()
      expect(wrapper.text()).toContain('Bunga Citra')
      expect(wrapper.text()).not.toContain('Cahyo Utomo')

      // Search by Name
      await searchInput.setValue('Dina')
      await flushPromises()
      expect(wrapper.text()).toContain('Dina Mariana')
    })
  })

  describe('10. Detail order view', () => {
    it('menampilkan detail order, status action button, dan tombol Bayar Sekarang untuk unpaid', async () => {
      ctx.transactionStore.items = [
        {
          id: 'ord-test-detail',
          orderNumber: 'LDR-20260914-9999',
          customer: 'Eko Prasetyo',
          customerSnapshot: { phone: '0855555555' },
          orderStatus: 'Masuk',
          paymentStatus: 'unpaid',
          total: 45000,
          subtotal: 45000,
          createdAt: '2026-09-14T08:00:00.000Z',
          estimatedCompletedAt: '2026-09-16T12:00:00.000Z',
          note: 'Jangan campur baju putih',
          items: [
            { name: 'Cuci Setrika', qty: 3, unit: 'kg', price: 15000, subtotal: 45000 },
          ],
        },
      ]

      await ctx.router.push('/laundry/orders/ord-test-detail')
      await flushPromises()

      const wrapper = mount(LaundryOrderDetailView, {
        global: { plugins: [ctx.pinia, ctx.router] },
      })

      expect(wrapper.find('[data-testid="detail-order-number"]').text()).toContain('LDR-20260914-9999')
      expect(wrapper.find('[data-testid="detail-customer-name"]').text()).toContain('Eko Prasetyo')
      expect(wrapper.find('[data-testid="detail-customer-phone"]').text()).toContain('0855555555')
      expect(wrapper.find('[data-testid="detail-order-note"]').text()).toContain('Jangan campur baju putih')
      expect(wrapper.find('[data-testid="btn-pay-now"]').exists()).toBe(true)
      expect(wrapper.find('[data-testid="btn-advance-status"]').text()).toContain('Mulai Proses')

      // Advance status from Masuk to Diproses
      await wrapper.find('[data-testid="btn-advance-status"]').trigger('click')
      await flushPromises()

      expect(wrapper.find('[data-testid="btn-advance-status"]').text()).toContain('Tandai Siap Diambil')
      expect(ctx.transactionStore.items[0].orderStatus).toBe('Diproses')
    })
  })

  describe('11. Home Laundry summary', () => {
    it('Home Laundry menampilkan status Masuk, Diproses, Siap Diambil, Selesai dan tidak menampilkan low stock', async () => {
      ctx.transactionStore.items = [
        { id: '1', orderStatus: 'Masuk', createdAt: new Date().toISOString() },
        { id: '2', orderStatus: 'Diproses', createdAt: new Date().toISOString() },
        { id: '3', orderStatus: 'Siap Diambil', createdAt: new Date().toISOString() },
        { id: '4', orderStatus: 'Selesai', createdAt: new Date().toISOString() },
      ]

      await ctx.router.push('/home')
      await flushPromises()

      const wrapper = mount(HomeView, {
        global: { plugins: [ctx.pinia, ctx.router] },
      })

      expect(wrapper.text()).toContain('Masuk')
      expect(wrapper.text()).toContain('Diproses')
      expect(wrapper.text()).toContain('Siap Diambil')
      expect(wrapper.text()).toContain('Selesai')
      expect(wrapper.text()).not.toContain('Stok Minimum')

      // Links navigate to /laundry/orders with corresponding filter query
      expect(wrapper.find('[data-testid="laundry-summary-Masuk"]').attributes('href')).toBe('/laundry/orders?status=Masuk')
      expect(wrapper.find('[data-testid="laundry-summary-Diproses"]').attributes('href')).toBe('/laundry/orders?status=Diproses')
      expect(wrapper.find('[data-testid="laundry-summary-Siap Diambil"]').attributes('href')).toBe('/laundry/orders?status=Siap+Diambil')
    })
  })

  describe('12. Persistence and Backup/Restore', () => {
    it('order laundry tersimpan di memoryAdapter / sqliteAdapter JSON payload', async () => {
      const adapter = createMemoryAdapter()
      const laundryTx = {
        id: 'tx-ldr-1',
        orderNumber: 'LDR-20260914-0001',
        invoiceNumber: 'LDR-20260914-0001',
        customer: 'Bapak Joko',
        customerId: 'c-1',
        orderStatus: 'Diproses',
        paymentStatus: 'unpaid',
        items: [{ name: 'Cuci Kering', qty: 4.5, price: 10000, subtotal: 45000 }],
        subtotal: 45000,
        total: 45000,
        estimatedCompletedAt: '2026-09-16T10:00:00.000Z',
        note: 'Antar jika selesai',
        createdAt: '2026-09-14T08:00:00.000Z',
        updatedAt: '2026-09-14T09:00:00.000Z',
      }

      await adapter.saveTransactions([laundryTx])
      const loaded = await adapter.loadTransactions()

      expect(loaded.length).toBe(1)
      expect(loaded[0].orderNumber).toBe('LDR-20260914-0001')
      expect(loaded[0].orderStatus).toBe('Diproses')
      expect(loaded[0].paymentStatus).toBe('unpaid')
      expect(loaded[0].items[0].qty).toBe(4.5)
      expect(loaded[0].estimatedCompletedAt).toBe('2026-09-16T10:00:00.000Z')
      expect(loaded[0].note).toBe('Antar jika selesai')
    })

    it('backup dan restore membawa field Laundry (orderNumber, orderStatus, paymentStatus, estimatedCompletedAt, note)', () => {
      ctx.shiftStore.closeShift()

      ctx.transactionStore.items = [
        {
          id: 'tx-backup-1',
          orderNumber: 'LDR-20260914-7777',
          invoiceNumber: 'LDR-20260914-7777',
          customer: 'Bu Rini',
          customerId: 'c-7',
          orderStatus: 'Siap Diambil',
          paymentStatus: 'unpaid',
          paymentMethod: 'unpaid',
          items: [{ name: 'Gordyn', qty: 3, price: 20000, subtotal: 60000 }],
          subtotal: 60000,
          tax: 0,
          total: 60000,
          grossProfit: 30000,
          estimatedCompletedAt: '2026-09-16T10:00:00.000Z',
          note: 'Wangi mawar',
          createdAt: '2026-09-14T08:00:00.000Z',
          updatedAt: '2026-09-14T12:00:00.000Z',
        },
      ]

      const payload = createBackupPayload({
        businessStore: ctx.businessStore,
        productStore: ctx.productStore,
        customerStore: ctx.customerStore,
        expenseStore: ctx.expenseStore,
        transactionStore: ctx.transactionStore,
        cashStore: ctx.cashStore,
      })

      const validation = validateBackupPayload(payload)
      expect(validation.valid).toBe(true)

      // Clear transactions
      ctx.transactionStore.items = []

      // Restore
      const restoreResult = restoreBackupPayload(payload, {
        businessStore: ctx.businessStore,
        productStore: ctx.productStore,
        customerStore: ctx.customerStore,
        expenseStore: ctx.expenseStore,
        transactionStore: ctx.transactionStore,
        cashStore: ctx.cashStore,
        shiftStore: ctx.shiftStore,
      })

      expect(restoreResult.success).toBe(true)
      expect(ctx.transactionStore.items.length).toBe(1)
      const restored = ctx.transactionStore.items[0]
      expect(restored.orderNumber).toBe('LDR-20260914-7777')
      expect(restored.orderStatus).toBe('Siap Diambil')
      expect(restored.paymentStatus).toBe('unpaid')
      expect(restored.estimatedCompletedAt).toBe('2026-09-16T10:00:00.000Z')
      expect(restored.note).toBe('Wangi mawar')
    })
  })

  describe('13. Retail regression', () => {
    it('Cafe POS retail flow tetap berjalan, stok berkurang, cash bertambah 1x', () => {
      const cafeCtx = setupTestContext('Cafe / UMKM')
      cafeCtx.productStore.products = [
        { id: 'p1', name: 'Kopi Susu', kind: 'product', price: 15000, cost: 7000, stock: 10, unit: 'pcs', minStock: 2, isActive: true },
      ]

      const initialStock = cafeCtx.productStore.products[0].stock
      const initialCash = cafeCtx.cashStore.balance

      // Sale occurs
      const transaction = cafeCtx.transactionStore.createTransaction({
        items: [{ id: 'p1', name: 'Kopi Susu', qty: 2, price: 15000, cost: 7000 }],
        subtotal: 30000,
        tax: 0,
        total: 30000,
        paymentMethod: 'cash',
      })

      cafeCtx.productStore.recordSaleStock(transaction.items, transaction.id)
      cafeCtx.cashStore.recordSalePayment(transaction)

      expect(cafeCtx.productStore.products[0].stock).toBe(initialStock - 2)
      expect(cafeCtx.cashStore.balance).toBe(initialCash + 30000)
    })
  })
})
