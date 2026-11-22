import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { usePaymentMethodStore } from '@/stores/paymentMethodStore'
import { useCloudSessionStore } from '@/stores/cloudSessionStore'
import { useTransactionStore } from '@/stores/transactionStore'
import { useCashStore } from '@/stores/cashStore'
import { createMemoryAdapter } from '@/services/database/memoryAdapter'
import { createPersistenceService } from '@/services/database/persistenceService'
import { mapOutboxEntries } from '@/services/sync/contractMapper'

describe('Cloud Payment Methods Sync & Multi-Outlet Support', () => {
  let pinia

  beforeEach(() => {
    localStorage.clear()
    pinia = createPinia()
    setActivePinia(pinia)
  })

  it('1. paymentMethodStore menyediakan fallback offline dan filter per outlet', () => {
    const store = usePaymentMethodStore()
    expect(store.methods.length).toBeGreaterThanOrEqual(4)
    expect(store.isCashMethod('cash')).toBe(true)
    expect(store.isCashMethod('tunai')).toBe(true)
    expect(store.isCashMethod('qris')).toBe(false)
    expect(store.getMethodName('cash')).toBe('Tunai')
    expect(store.getMethodName('unpaid')).toBe('Bayar Nanti')

    // Set custom methods from cloud payload
    const cloudPayload = [
      {
        id: 1,
        name: 'Tunai',
        code: 'cash',
        category: 'cash',
        is_cash: true,
        sort_order: 1,
        description: 'Pembayaran tunai di laci kasir',
        enabled_outlet_ids: [1, 2],
      },
      {
        id: 5,
        name: 'GoPay',
        code: 'gopay',
        category: 'ewallet',
        is_cash: false,
        sort_order: 5,
        description: 'QR GoPay Merchant',
        enabled_outlet_ids: [1],
      },
      {
        id: 8,
        name: 'ShopeePay',
        code: 'shopeepay',
        category: 'ewallet',
        is_cash: false,
        sort_order: 8,
        description: 'QR ShopeePay Merchant',
        enabled_outlet_ids: [2],
      },
    ]

    store.setMethods(cloudPayload)
    expect(store.isCashMethod('gopay')).toBe(false)
    expect(store.getMethodName('gopay')).toBe('GoPay')

    // Outlet 1 should have Tunai and GoPay
    const outlet1Methods = store.getMethodsForOutlet(1)
    expect(outlet1Methods.map((m) => m.code)).toEqual(['cash', 'gopay'])

    // Outlet 2 should have Tunai and ShopeePay
    const outlet2Methods = store.getMethodsForOutlet(2)
    expect(outlet2Methods.map((m) => m.code)).toEqual(['cash', 'shopeepay'])
  })

  it('2. cloudSessionStore meng-hidrasi payment_methods saat applyBusinessContext', () => {
    const cloudStore = useCloudSessionStore()
    const paymentStore = usePaymentMethodStore()

    const businessPayload = {
      id: 'biz_01',
      name: 'Temuan Space',
      role: 'owner',
      payment_methods: [
        {
          id: 1,
          name: 'Tunai Kasir',
          code: 'cash',
          category: 'cash',
          is_cash: true,
          sort_order: 1,
          enabled_outlet_ids: [10],
        },
        {
          id: 20,
          name: 'DANA Merchant',
          code: 'dana',
          category: 'ewallet',
          is_cash: false,
          sort_order: 2,
          enabled_outlet_ids: [10],
        },
      ],
    }

    cloudStore.applyBusinessContext(businessPayload)

    expect(paymentStore.methods.some((m) => m.code === 'dana')).toBe(true)
    expect(paymentStore.isCashMethod('dana')).toBe(false)
    expect(paymentStore.getMethodName('dana')).toBe('DANA Merchant')

    const outlet10Methods = paymentStore.getMethodsForOutlet(10)
    expect(outlet10Methods.map((m) => m.code)).toContain('dana')
    expect(outlet10Methods.map((m) => m.code)).toContain('cash')
  })

  it('3. persistenceService dan memoryAdapter menyimpan dan memuat payment_methods', async () => {
    const adapter = createMemoryAdapter()
    const service = createPersistenceService({ adapter, pinia })
    await service.initialize()

    const paymentStore = usePaymentMethodStore()
    paymentStore.setMethods([
      {
        id: 1,
        name: 'Tunai',
        code: 'cash',
        category: 'cash',
        is_cash: true,
        sort_order: 1,
        enabled_outlet_ids: [],
      },
      {
        id: 9,
        name: 'OVO',
        code: 'ovo',
        category: 'ewallet',
        is_cash: false,
        sort_order: 9,
        enabled_outlet_ids: [1],
      },
    ])

    // Wait for watchers
    await new Promise((r) => setTimeout(r, 100))

    const loadedFromAdapter = await adapter.loadPaymentMethods()
    expect(loadedFromAdapter.some((m) => m.code === 'ovo')).toBe(true)
  })

  it('4. transactionStore updatePaymentMethod dan voidTransaction menyesuaikan cash ledger dengan isCashMethod', () => {
    const txStore = useTransactionStore()
    const cashStore = useCashStore()
    const paymentStore = usePaymentMethodStore()

    paymentStore.setMethods([
      { id: 'cash', name: 'Tunai', code: 'cash', is_cash: true, sort_order: 1 },
      { id: 'gopay', name: 'GoPay', code: 'gopay', is_cash: false, sort_order: 2 },
    ])

    // Initial paid cash transaction
    const initialTx = {
      id: 'tx_test_01',
      invoiceNumber: 'INV-001',
      total: 50000,
      paymentMethod: 'cash',
      paymentStatus: 'paid',
      status: 'paid',
      orderStatus: 'Siap',
      items: [{ id: 'p1', name: 'Kopi', qty: 1, price: 50000 }],
    }
    txStore.items = [initialTx]

    // Switch payment from Cash to GoPay: should record cash OUT
    const res = txStore.updatePaymentMethod('tx_test_01', 'gopay')
    expect(res.success).toBe(true)
    expect(initialTx.paymentMethod).toBe('gopay')

    const outEntry = cashStore.entries.find((e) => e.type === 'out' && e.transactionId === 'tx_test_01')
    expect(outEntry).toBeDefined()
    expect(outEntry.amount).toBe(50000)

    // Switch payment back from GoPay to Cash: should record cash IN
    const res2 = txStore.updatePaymentMethod('tx_test_01', 'cash')
    expect(res2.success).toBe(true)
    expect(initialTx.paymentMethod).toBe('cash')

    const inEntry = cashStore.entries.find((e) => e.type === 'in' && e.transactionId === 'tx_test_01')
    expect(inEntry).toBeDefined()

    // Void transaction: should record cash OUT
    const voidRes = txStore.voidTransaction('tx_test_01', 'Salah input')
    expect(voidRes.success).toBe(true)
    expect(initialTx.status).toBe('cancelled')

    const voidEntry = cashStore.entries.find((e) => e.type === 'out' && e.category === 'Void Penjualan')
    expect(voidEntry).toBeDefined()
    expect(voidEntry.amount).toBe(50000)
  })

  it('5. contractMapper memetakan custom payment_method tanpa pembatasan ke sync payload', async () => {
    const memoryAdapter = createMemoryAdapter()
    const entries = [
      {
        id: 'q_sale_01',
        entityType: 'transaction',
        entityId: 'tx_01',
        operation: 'upsert',
        payload: {
          id: 'tx_01',
          subtotal: 20000,
          total: 20000,
          paymentMethod: 'gopay',
          paymentStatus: 'paid',
          status: 'paid',
          createdAt: '2026-11-22T08:00:00.000Z',
          items: [{ id: 'p1', name: 'Latte', price: 20000, qty: 1, subtotal: 20000 }],
        },
      },
    ]

    const result = await mapOutboxEntries(entries, { adapter: memoryAdapter })
    expect(result.changes.sales).toHaveLength(1)
    expect(result.changes.sales[0].payment_method).toBe('gopay')
    expect(result.changes.sales[0].payment_status).toBe('paid')
  })
})
