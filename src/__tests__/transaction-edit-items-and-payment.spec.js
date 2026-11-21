import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'

import { createAppRouter } from '@/router'
import { useBusinessStore } from '@/stores/businessStore'
import { useCashStore } from '@/stores/cashStore'
import { useProductStore } from '@/stores/productStore'
import { useTransactionStore } from '@/stores/transactionStore'
import TransactionDetailView from '@/views/transactions/TransactionDetailView.vue'

describe('Edit Menu Pesanan & Edit Status / Pembayaran Transaksi', () => {
  let pinia
  let router
  let businessStore
  let cashStore
  let productStore
  let transactionStore

  beforeEach(() => {
    pinia = createPinia()
    setActivePinia(pinia)
    router = createAppRouter()
    businessStore = useBusinessStore()
    cashStore = useCashStore()
    productStore = useProductStore()
    transactionStore = useTransactionStore()

    businessStore.setBusiness({
      name: 'Temuan Space',
      type: 'Cafe / UMKM',
      owner: 'Owner',
      phone: '0822656565',
      outlet: 'Temuan Space Laksana',
      mode: 'cloud',
    })
  })

  it('bisa menambah dan mengurangi kuantitas menu saat pesanan berstatus Proses', () => {
    const p1 = {
      id: 'prod-1',
      name: 'Kopi Susu Regal',
      category: 'Coffee',
      price: 15000,
      cost: 7000,
      stock: 20,
      kind: 'product',
    }
    const p2 = {
      id: 'prod-2',
      name: 'Matcha Latte',
      category: 'Non-Coffee',
      price: 20000,
      cost: 9000,
      stock: 15,
      kind: 'product',
    }
    productStore.products.push(p1, p2)

    const initialStockP1 = p1.stock
    const initialStockP2 = p2.stock

    const tx = transactionStore.addTransaction({
      id: 'trx-edit-items-1',
      invoiceNumber: 'INV-20261119-001',
      customer: 'Budi Santoso',
      orderStatus: 'Proses',
      paymentStatus: 'paid',
      paymentMethod: 'cash',
      items: [
        {
          id: p1.id,
          productId: p1.id,
          name: p1.name,
          price: 15000,
          qty: 2,
          subtotal: 30000,
        },
      ],
      itemCount: 2,
      subtotal: 30000,
      tax: 0,
      discount: 0,
      total: 30000,
      cashReceived: 50000,
      changeAmount: 20000,
      createdAt: '2026-11-19T10:00:00Z',
    })

    // Kurangi kuantitas p1 dari 2 menjadi 1, dan tambahkan p2 sebanyak 2
    const updatedItems = [
      {
        id: p1.id,
        productId: p1.id,
        name: p1.name,
        price: 15000,
        qty: 1,
        subtotal: 15000,
      },
      {
        id: p2.id,
        productId: p2.id,
        name: p2.name,
        price: 20000,
        qty: 2,
        subtotal: 40000,
      },
    ]

    const res = transactionStore.updateTransactionItems({
      transactionId: tx.id,
      items: updatedItems,
      productStore,
      cashStore,
    })

    expect(res.success).toBe(true)
    expect(tx.items.length).toBe(2)
    expect(tx.itemCount).toBe(3) // 1 + 2
    expect(tx.subtotal).toBe(55000) // 15.000 + 40.000
    expect(tx.total).toBe(55000)

    // Stock verification: p1 dikurangi 1 (kembali 1), p2 bertambah 2 (berkurang 2)
    if (typeof initialStockP1 === 'number') {
      expect(productStore.getProductById(p1.id).stock).toBe(initialStockP1 + 1)
    }
    if (typeof initialStockP2 === 'number') {
      expect(productStore.getProductById(p2.id).stock).toBe(initialStockP2 - 2)
    }
  })

  it('dapat mengubah status pesanan dan metode pembayaran pada transaksi', () => {
    const tx = transactionStore.addTransaction({
      id: 'trx-edit-payment-1',
      invoiceNumber: 'INV-20261119-002',
      customer: 'Walk-in Customer',
      orderStatus: 'Proses',
      paymentStatus: 'unpaid',
      paymentMethod: 'unpaid',
      total: 35000,
      cashReceived: 0,
      changeAmount: 0,
      createdAt: '2026-11-19T10:30:00Z',
    })

    // Ubah status ke Siap dan pembayaran ke Tunai (Cash) Lunas
    const res = transactionStore.updateTransactionPayment({
      transactionId: tx.id,
      orderStatus: 'Siap',
      paymentStatus: 'paid',
      paymentMethod: 'cash',
      cashReceived: 50000,
      changeAmount: 15000,
      cashStore,
      productStore,
    })

    expect(res.success).toBe(true)
    expect(tx.orderStatus).toBe('Siap')
    expect(tx.paymentStatus).toBe('paid')
    expect(tx.paymentMethod).toBe('cash')
    expect(tx.cashReceived).toBe(50000)
    expect(tx.changeAmount).toBe(15000)
    expect(tx.pay_later).toBe(false)
  })

  it('dapat mengubah transaksi lunas menjadi Refund', () => {
    const tx = transactionStore.addTransaction({
      id: 'trx-edit-refund-1',
      invoiceNumber: 'INV-20261119-003',
      customer: 'Pelanggan Meja 4',
      orderStatus: 'Proses',
      paymentStatus: 'paid',
      paymentMethod: 'cash',
      total: 25000,
      cashReceived: 25000,
      changeAmount: 0,
      createdAt: '2026-11-19T11:00:00Z',
    })

    const res = transactionStore.updateTransactionPayment({
      transactionId: tx.id,
      orderStatus: 'Batal',
      paymentStatus: 'refund',
      cashStore,
      productStore,
    })

    expect(res.success).toBe(true)
    expect(tx.orderStatus).toBe('Batal')
    expect(tx.paymentStatus).toBe('refund')
    expect(tx.status).toBe('refunded')
  })

  it('menampilkan tombol "Edit Menu" pada TransactionDetailView saat order status Proses', async () => {
    const tx = transactionStore.addTransaction({
      id: 'trx-view-test-1',
      invoiceNumber: 'INV-20261119-VIEW1',
      customer: 'Ani Suryani',
      orderStatus: 'Proses',
      paymentStatus: 'paid',
      paymentMethod: 'cash',
      items: [
        {
          id: 'p-1',
          name: 'Kopi Susu',
          price: 18000,
          qty: 1,
          subtotal: 18000,
        },
      ],
      itemCount: 1,
      subtotal: 18000,
      total: 18000,
      cashReceived: 18000,
      changeAmount: 0,
      createdAt: '2026-11-19T11:15:00Z',
    })

    await router.push(`/transactions/${tx.id}`)
    await flushPromises()

    const wrapper = mount(TransactionDetailView, {
      global: {
        plugins: [pinia, router],
      },
    })

    // Tombol Edit Menu harus muncul karena status Proses
    const btnEditItems = wrapper.find('[data-testid="btn-open-edit-items"]')
    expect(btnEditItems.exists()).toBe(true)

    // Tombol Ubah Pembayaran juga harus muncul
    const btnEditPayment = wrapper.find('[data-testid="btn-open-edit-payment"]')
    expect(btnEditPayment.exists()).toBe(true)

    // Klik Edit Menu membuka modal
    await btnEditItems.trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-testid="edit-items-modal"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="editable-item-row"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('Edit Menu Pesanan')

    // Klik tombol tambah kuantitas di baris item
    const btnIncrement = wrapper.find('[data-testid="btn-increment-0"]')
    await btnIncrement.trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-testid="qty-val-0"]').text()).toBe('2')

    // Klik simpan perubahan
    const btnSave = wrapper.find('[data-testid="btn-save-edited-items"]')
    await btnSave.trigger('click')
    await flushPromises()

    // Transaction store harus terupdate
    expect(tx.items[0].qty).toBe(2)
    expect(tx.total).toBe(36000)
  })

  it('membuka modal edit status & pembayaran dan menyimpan perubahannya', async () => {
    const tx = transactionStore.addTransaction({
      id: 'trx-view-test-2',
      invoiceNumber: 'INV-20261119-VIEW2',
      customer: 'Deni',
      orderStatus: 'Proses',
      paymentStatus: 'paid',
      paymentMethod: 'cash',
      items: [
        {
          id: 'p-1',
          name: 'Teh Manis',
          price: 10000,
          qty: 1,
          subtotal: 10000,
        },
      ],
      total: 10000,
      cashReceived: 10000,
      changeAmount: 0,
      createdAt: '2026-11-19T11:30:00Z',
    })

    await router.push(`/transactions/${tx.id}`)
    await flushPromises()

    const wrapper = mount(TransactionDetailView, {
      global: {
        plugins: [pinia, router],
      },
    })

    const btnEditPayment = wrapper.find('[data-testid="btn-open-edit-payment"]')
    await btnEditPayment.trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-testid="edit-payment-modal"]').exists()).toBe(true)

    // Pilih status pesanan 'Siap'
    const btnSiap = wrapper.find('[data-testid="btn-select-order-status-siap"]')
    await btnSiap.trigger('click')

    // Pilih metode QRIS
    const btnQris = wrapper.find('[data-testid="btn-select-payment-method-qris"]')
    await btnQris.trigger('click')

    // Simpan
    const btnSavePayment = wrapper.find('[data-testid="btn-save-edited-payment"]')
    await btnSavePayment.trigger('click')
    await flushPromises()

    expect(tx.orderStatus).toBe('Siap')
    expect(tx.paymentMethod).toBe('qris')
  })
})
