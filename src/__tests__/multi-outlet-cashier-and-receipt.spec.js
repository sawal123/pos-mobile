import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { mount } from '@vue/test-utils'
import { createRouter, createMemoryHistory } from 'vue-router'

import { buildReceiptText } from '@/services/printer/escposReceiptBuilder'
import { useCloudSessionStore } from '@/stores/cloudSessionStore'
import { useSyncPullStore } from '@/stores/syncPullStore'
import { useSyncPushStore } from '@/stores/syncPushStore'
import { useSyncOrchestratorStore } from '@/stores/syncOrchestratorStore'
import { useTransactionStore } from '@/stores/transactionStore'
import { useCashStore } from '@/stores/cashStore'
import { useBusinessStore } from '@/stores/businessStore'
import TransactionCard from '@/components/transaction/TransactionCard.vue'
import TransactionDetailView from '@/views/transactions/TransactionDetailView.vue'
import { createMemoryAdapter } from '@/services/database/memoryAdapter'
import { apiRequest } from '@/services/cloud/apiClient'
import { _resetTokenStore } from '@/services/cloud/tokenRepository'

vi.mock('@/services/cloud/apiClient', () => ({
  apiRequest: vi.fn(),
}))

function makeOkResponse(data) {
  return { ok: true, status: 200, data: { data }, error: null }
}

describe('Multi-Outlet: Cashier Scoping & Branch Receipt Header', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    _resetTokenStore()
    vi.clearAllMocks()
  })

  describe('1. Branch Receipt Header (escposReceiptBuilder)', () => {
    const transaction = {
      id: 'trx-001',
      invoiceNumber: 'INV-20261119-001',
      customer: 'Pelanggan Walk-in',
      paymentMethod: 'cash',
      paymentStatus: 'paid',
      createdAt: '2026-11-19T10:00:00.000Z',
      items: [{ name: 'Americano', qty: 1, price: 18000, unit: 'cup' }],
      subtotal: 18000,
      tax: 0,
      total: 18000,
      cashReceived: 20000,
      changeAmount: 2000,
    }

    const business = {
      name: 'Temuan Space',
      outlet: 'Temuan Space Laksana',
      phone: '0811111111',
    }

    const receiptSettings = {
      address: 'Jl. Bisnis Pusat No. 1, Jakarta',
      footer: 'Terima kasih telah berkunjung!',
    }

    it('memprioritaskan alamat dan nomor telepon outlet jika tersedia', () => {
      const outlet = {
        name: 'Cabang USU',
        address: 'Jl. Dr. Mansyur / Kampus USU',
        phone: '0822656565',
      }

      const text = buildReceiptText({
        transaction,
        business,
        paperWidth: '58',
        receiptSettings,
        outlet,
      })

      // Must print branch name, branch address, and branch phone
      expect(text).toContain('Cabang USU')
      expect(text).toContain('Jl. Dr. Mansyur / Kampus USU')
      expect(text).toContain('0822656565')
      // Should not print the business-level address when outlet address is provided
      expect(text).not.toContain('Jl. Bisnis Pusat No. 1')
    })

    it('fallback ke receiptSettings.address dan business.phone jika outlet tidak memiliki address/phone spesifik', () => {
      const outlet = {
        name: 'Cabang Kemang',
        address: null,
        phone: null,
      }

      const text = buildReceiptText({
        transaction,
        business,
        paperWidth: '58',
        receiptSettings,
        outlet,
      })

      expect(text).toContain('Cabang Kemang')
      expect(text).toContain('Jl. Bisnis Pusat No. 1, Jakarta')
      expect(text).toContain('0811111111')
    })
  })

  describe('2. Mapping Outlet Address, Phone, and Receipt Settings in cloudSessionStore', () => {
    it('memetakan receipt_settings, outlet address, dan outlet phone dari payload context', async () => {
      const store = useCloudSessionStore()
      const adapter = createMemoryAdapter()
      store.setPersistenceAdapter(adapter)
      store.deviceIdentifier = 'test-dev-uuid-001'

      const rawBusiness = {
        id: 10,
        name: 'Temuan Space',
        business_type: 'Cafe',
        role: 'cashier',
        cloud_access: true,
        receipt_settings: {
          address: 'Alamat Toko Pusat',
          footer: 'Footer Nota',
        },
        outlets: [
          {
            id: 2,
            name: 'Cabang USU',
            code: 'USU-01',
            address: 'Jl. Dr. Mansyur / Kampus USU',
            phone: '0822656565',
            is_primary: false,
            status: 'active',
            cloud_access: true,
          },
        ],
      }

      apiRequest.mockResolvedValueOnce(
        makeOkResponse({
          token_type: 'Bearer',
          token: 'token-cashier-123',
          user: { id: 5, name: 'Kasir Satu', email: 'kasir@toko.com' },
        }),
      )
      apiRequest.mockResolvedValueOnce(
        makeOkResponse({
          businesses: [rawBusiness],
        }),
      )

      const loginRes = await store.login('kasir@toko.com', 'secret')
      expect(loginRes.ok).toBe(true)

      const mappedBiz = store.businesses[0]
      expect(mappedBiz.receipt_settings).toEqual({
        address: 'Alamat Toko Pusat',
        footer: 'Footer Nota',
      })

      const mappedOutlet = mappedBiz.outlets[0]
      expect(mappedOutlet.address).toBe('Jl. Dr. Mansyur / Kampus USU')
      expect(mappedOutlet.phone).toBe('0822656565')
      expect(mappedOutlet.code).toBe('USU-01')

      // Select business & outlet
      await store.selectBusiness(10)
      const selRes = await store.selectOutlet(2)
      expect(selRes.ok).toBe(true)
      expect(store.selectedOutlet.address).toBe('Jl. Dr. Mansyur / Kampus USU')
      expect(store.selectedOutlet.phone).toBe('0822656565')
    })

    it('menolak selectOutlet jika cabang pending payment dan mematikan isOperationalCloudAccess jika cloud_access cabang false', async () => {
      const store = useCloudSessionStore()
      const adapter = createMemoryAdapter()
      store.setPersistenceAdapter(adapter)
      store.deviceIdentifier = 'test-dev-uuid-002'

      const rawBusiness = {
        id: 10,
        name: 'Temuan Space',
        business_type: 'Cafe',
        role: 'owner',
        cloud_access: true,
        outlets: [
          {
            id: 100,
            name: 'Cabang Utama',
            status: 'active',
            cloud_access: true,
          },
          {
            id: 101,
            name: 'Cabang Kemang Pending',
            code: 'KMG-01',
            status: 'pending_payment',
            cloud_access: false,
          },
        ],
      }

      apiRequest.mockResolvedValueOnce(
        makeOkResponse({
          token_type: 'Bearer',
          token: 'token-owner-123',
          user: { id: 1, name: 'Owner Toko', email: 'owner@toko.com' },
        }),
      )
      apiRequest.mockResolvedValueOnce(
        makeOkResponse({
          businesses: [rawBusiness],
        }),
      )

      await store.login('owner@toko.com', 'secret')
      await store.selectBusiness(10)

      // Memilih cabang pending payment ditolak
      const selPending = await store.selectOutlet(101)
      expect(selPending.ok).toBe(false)
      expect(store.error).toContain('Langganan Cloud untuk cabang ini belum aktif')

      // Memilih cabang aktif berhasil
      const selActive = await store.selectOutlet(100)
      expect(selActive.ok).toBe(true)
      expect(store.selectedOutlet.cloud_access).toBe(true)

      // Jika di kemudian hari cloud_access cabang bernilai false, isOperationalCloudAccess otomatis false
      store.selectedOutlet = {
        ...store.selectedOutlet,
        cloud_access: false,
      }
      expect(store.isOperationalCloudAccess).toBe(false)
    })
  })

  describe('3. OUTLET_ACCESS_DENIED Error Handling in Sync Stores', () => {
    it('syncPullStore memetakan OUTLET_ACCESS_DENIED ke pesan ramah kasir', async () => {
      const pullStore = useSyncPullStore()
      const mockPullService = {
        pullNow: vi.fn().mockResolvedValue({
          ok: false,
          code: 'OUTLET_ACCESS_DENIED',
          message: 'Server rejected branch access.',
          error: { code: 'OUTLET_ACCESS_DENIED' },
        }),
      }

      pullStore.init({ pullService: mockPullService })
      const res = await pullStore.pullNow({ refreshContext: false })

      expect(res.ok).toBe(false)
      expect(pullStore.lastError).toBe(
        'Akun kasir ini hanya memiliki akses untuk cabang yang ditugaskan. Perangkat ini terdaftar di cabang berbeda.',
      )
    })

    it('syncPushStore memetakan OUTLET_ACCESS_DENIED ke pesan ramah kasir', async () => {
      const pushStore = useSyncPushStore()
      const mockPushService = {
        pushNow: vi.fn().mockResolvedValue({
          ok: false,
          code: 'OUTLET_ACCESS_DENIED',
          message: 'Server rejected branch access.',
          error: { code: 'OUTLET_ACCESS_DENIED' },
        }),
        queueService: { countPending: vi.fn().mockResolvedValue(0) },
      }

      pushStore.init({ pushService: mockPushService })
      const res = await pushStore.pushNow({ refreshContext: false })

      expect(res.ok).toBe(false)
      expect(pushStore.lastError).toBe(
        'Akun kasir ini hanya memiliki akses untuk cabang yang ditugaskan. Perangkat ini terdaftar di cabang berbeda.',
      )
    })

    it('syncOrchestratorStore memetakan OUTLET_ACCESS_DENIED ke pesan ramah kasir', async () => {
      const orchStore = useSyncOrchestratorStore()
      const mockOrchestrator = {
        syncAll: vi.fn().mockResolvedValue({
          ok: false,
          code: 'OUTLET_ACCESS_DENIED',
          stage: 'pull',
          message: 'Server rejected branch access.',
          error: { code: 'OUTLET_ACCESS_DENIED' },
        }),
      }

      orchStore.init({ orchestratorService: mockOrchestrator })
      const res = await orchStore.syncAll()

      expect(res.ok).toBe(false)
      expect(orchStore.lastError).toBe(
        'Akun kasir ini hanya memiliki akses untuk cabang yang ditugaskan. Perangkat ini terdaftar di cabang berbeda.',
      )
    })
  })

  describe('4. Cashier Outlet Lock Isolation in cloudSessionStore', () => {
    it('menolak kasir yang mencoba memilih cabang di luar cabang yang ditugaskan', async () => {
      const store = useCloudSessionStore()
      const adapter = createMemoryAdapter()
      store.setPersistenceAdapter(adapter)

      store.businesses = [
        {
          id: 10,
          name: 'Toko Kopi Sejahtera',
          role: 'cashier',
          cloud_access: true,
          outlets: [
            { id: 101, name: 'Cabang Diponegoro', status: 'active', cloud_access: true },
          ],
        },
      ]
      store.selectedBusiness = store.businesses[0]
      store.role = 'cashier'

      // Attempting to select an unassigned outlet ID 999 must be rejected
      const rejected = await store.selectOutlet(999)
      expect(rejected.ok).toBe(false)
      expect(rejected.code).toBe('OUTLET_ACCESS_DENIED')
      expect(rejected.error).toBe('Akun kasir ini hanya memiliki akses untuk cabang yang ditugaskan.')

      // Selecting the assigned outlet 101 succeeds
      const allowed = await store.selectOutlet(101)
      expect(allowed.ok).toBe(true)
      expect(store.selectedOutlet.id).toBe(101)
    })
  })

  describe('5. Bayar Nanti (Unpaid / Tempo) Transaction Handling', () => {
    it('membuat transaksi unpaid dengan payment_status unpaid, paid_at null, dan tidak menambah buku kas', () => {
      const transactionStore = useTransactionStore()
      const cashStore = useCashStore()

      const initialCashEntries = cashStore.entries.length

      const tx = transactionStore.createTransaction({
        paymentMethod: 'unpaid',
        paymentStatus: 'unpaid',
        status: 'unpaid',
        total: 50000,
        subtotal: 50000,
        items: [{ id: 'p1', name: 'Kopi Susu', price: 25000, qty: 2 }],
      })

      expect(tx.paymentMethod).toBe('unpaid')
      expect(tx.paymentStatus).toBe('unpaid')
      expect(tx.status).toBe('unpaid')
      expect(tx.paidAt).toBeNull()
      expect(tx.cashReceived).toBe(0)
      expect(tx.orderStatus).toBe('Proses')

      // Record sale payment should skip non-cash automatically
      const cashResult = cashStore.recordSalePayment(tx)
      expect(cashResult.skipped).toBe(true)
      expect(cashStore.entries.length).toBe(initialCashEntries)
    })

    it('mendukung pelunasan pembayaran (settleTransactionPayment) dan mencatat ke kas jika metode tunai', () => {
      const transactionStore = useTransactionStore()
      const cashStore = useCashStore()

      const tx = transactionStore.createTransaction({
        paymentMethod: 'unpaid',
        paymentStatus: 'unpaid',
        status: 'unpaid',
        total: 30000,
        subtotal: 30000,
        items: [{ id: 'p1', name: 'Snack', price: 15000, qty: 2 }],
      })

      const initialCount = cashStore.entries.length

      const settlement = transactionStore.settleTransactionPayment({
        transactionId: tx.id,
        paymentMethod: 'cash',
        cashReceived: 50000,
        changeAmount: 20000,
        cashStore,
      })

      expect(settlement.success).toBe(true)
      expect(tx.paymentStatus).toBe('paid')
      expect(tx.status).toBe('paid')
      expect(tx.paymentMethod).toBe('cash')
      expect(tx.cashReceived).toBe(50000)
      expect(tx.changeAmount).toBe(20000)
      expect(tx.paidAt).toBeTruthy()
      expect(tx.orderStatus).toBe('Siap')

      // Cash store must record entry
      expect(cashStore.entries.length).toBe(initialCount + 1)
      expect(cashStore.entries[0].amount).toBe(30000)
      expect(cashStore.entries[0].type).toBe('in')
    })
  })

  describe('6. Penyelarasan Status Pesanan & Pembayaran (Card & Detail View)', () => {
    it('TransactionCard menampilkan badge status pesanan (Proses, Siap, Batal) dan status pembayaran (Belum Lunas, Lunas, Refund)', () => {
      const pinia = createPinia()
      setActivePinia(pinia)

      const unpaidTx = {
        id: 'trx-unpaid',
        invoiceNumber: 'INV-UNPAID-01',
        customer: 'Andi Tempo',
        total: 50000,
        paymentMethod: 'unpaid',
        paymentStatus: 'unpaid',
        orderStatus: 'Proses',
        items: [{ name: 'Item A', qty: 1, price: 50000 }],
        createdAt: '2026-11-19T10:00:00Z',
      }

      const wrapper = mount(TransactionCard, {
        props: { transaction: unpaidTx },
        global: { plugins: [pinia] },
      })

      const orderBadge = wrapper.find('[data-testid="order-status-badge"]')
      const paymentBadge = wrapper.find('[data-testid="payment-status-badge"]')

      expect(orderBadge.exists()).toBe(true)
      expect(orderBadge.text()).toBe('Proses')
      expect(paymentBadge.exists()).toBe(true)
      expect(paymentBadge.text()).toBe('Belum Lunas')
    })

    it('TransactionDetailView menampilkan opsi status pesanan Proses, Siap, Batal untuk bisnis retail/cafe', async () => {
      const pinia = createPinia()
      setActivePinia(pinia)
      const businessStore = useBusinessStore(pinia)
      const transactionStore = useTransactionStore(pinia)

      businessStore.setBusiness({
        name: 'Cafe Bahagia',
        type: 'Cafe / Restoran',
        mode: 'free',
      })

      const tx = transactionStore.addTransaction({
        id: 'trx-cafe-detail',
        invoiceNumber: 'INV-CF-01',
        customer: 'Citra',
        total: 45000,
        paymentMethod: 'unpaid',
        paymentStatus: 'unpaid',
        status: 'unpaid',
        orderStatus: 'Proses',
        items: [{ id: 'p1', name: 'Latte', price: 45000, qty: 1 }],
        createdAt: '2026-11-19T10:00:00Z',
      })

      const router = createRouter({
        history: createMemoryHistory(),
        routes: [
          { path: '/transactions/:id', component: TransactionDetailView },
          { path: '/transactions', component: { template: '<div>List</div>' } },
        ],
      })
      await router.push(`/transactions/${tx.id}`)

      const wrapper = mount(TransactionDetailView, {
        global: { plugins: [pinia, router] },
      })

      // Must show retail order status section and unpaid settlement section
      expect(wrapper.find('[data-testid="retail-order-status-section"]').exists()).toBe(true)
      expect(wrapper.find('[data-testid="unpaid-settlement-section"]').exists()).toBe(true)
      // Must not show laundry order status section
      expect(wrapper.find('[data-testid="laundry-order-status-section"]').exists()).toBe(false)
      expect(wrapper.text()).not.toContain('Status Order Laundry')

      // Settle action in detail view
      const settleBtn = wrapper.find('[data-testid="btn-open-settle-modal"]')
      expect(settleBtn.exists()).toBe(true)
      await settleBtn.trigger('click')

      const modal = wrapper.find('[data-testid="settlement-modal"]')
      expect(modal.exists()).toBe(true)

      const confirmBtn = wrapper.find('[data-testid="btn-confirm-settlement"]')
      await confirmBtn.trigger('click')

      // After settlement: payment status is Lunas
      expect(tx.paymentStatus).toBe('paid')
      expect(wrapper.find('[data-testid="unpaid-settlement-section"]').exists()).toBe(false)
    })
  })
})
