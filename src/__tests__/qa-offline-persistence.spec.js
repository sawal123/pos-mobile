import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  createBackupPayload,
  restoreBackupPayload,
  validateBackupPayload,
} from '@/services/backupService'
import { createMemoryAdapter } from '@/services/database/memoryAdapter'
import { createPersistenceService } from '@/services/database/persistenceService'
import { DB_VERSION } from '@/services/database/schema'
import { deserializeTransactionRows } from '@/services/database/sqliteAdapter'
import { useBusinessStore } from '@/stores/businessStore'
import { useCartStore } from '@/stores/cartStore'
import { useCashStore } from '@/stores/cashStore'
import { useCashierStore } from '@/stores/cashierStore'
import { useCustomerStore } from '@/stores/customerStore'
import { useExpenseStore } from '@/stores/expenseStore'
import { useProductStore } from '@/stores/productStore'
import { useShiftStore } from '@/stores/shiftStore'
import { useTaxStore } from '@/stores/taxStore'
import { useTransactionStore } from '@/stores/transactionStore'

function createQAContext(adapter = createMemoryAdapter()) {
  const pinia = createPinia()
  setActivePinia(pinia)

  const service = createPersistenceService({ adapter, pinia })

  return {
    pinia,
    adapter,
    service,
    businessStore: useBusinessStore(pinia),
    cartStore: useCartStore(pinia),
    cashStore: useCashStore(pinia),
    cashierStore: useCashierStore(pinia),
    customerStore: useCustomerStore(pinia),
    expenseStore: useExpenseStore(pinia),
    productStore: useProductStore(pinia),
    shiftStore: useShiftStore(pinia),
    taxStore: useTaxStore(pinia),
    transactionStore: useTransactionStore(pinia),
  }
}

describe('QA-01 / P2 — Offline Transaction & SQLite Persistence', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  describe('3. PENGUJIAN MODE FREE OFFLINE', () => {
    it('menjalankan seluruh operasional POS tanpa koneksi cloud, login, atau bearer token', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch')
      const ctx = createQAContext()
      await ctx.service.initialize()

      // 1. Setup Bisnis lokal mode Free
      ctx.businessStore.setBusiness({
        name: 'Warung Mandiri Offline',
        type: 'Cafe / UMKM',
        owner: 'Sawal',
        phone: '081234567890',
        outlet: 'Outlet Utama',
        mode: 'free',
      })
      expect(ctx.businessStore.mode).toBe('free')
      expect(ctx.businessStore.isSetup).toBe(true)

      // 2. Setup PIN Kasir
      ctx.cashierStore.setPinConfigured(true)
      expect(ctx.cashierStore.activeCashier.pinConfigured).toBe(true)

      // 3. Tambah & Edit Produk + Kategori
      const catRes = ctx.productStore.createCategory('Kopi')
      expect(catRes.success).toBe(true)

      const prodRes = ctx.productStore.createProduct({
        name: 'Kopi Tubruk',
        category: 'Kopi',
        sku: 'KPB-01',
        cost: 4000,
        price: 10000,
        stock: 50,
        minStock: 10,
        unit: 'cangkir',
        isActive: true,
      })
      expect(prodRes.success).toBe(true)
      const productId = prodRes.product.id

      // 4. Buka shift kas
      const shiftId = ctx.shiftStore.openShift(100000)
      expect(shiftId).toBeTruthy()
      expect(ctx.shiftStore.isOpen).toBe(true)
      ctx.cashStore.recordOpeningBalance(100000, shiftId)
      expect(ctx.cashStore.balance).toBe(100000)

      // 5. Transaksi penjualan offline
      ctx.cartStore.addItem(ctx.productStore.getProductById(productId))
      expect(ctx.cartStore.items).toHaveLength(1)

      const taxRate = ctx.taxStore.effectiveRate
      const subtotal = ctx.cartStore.subtotal
      const tax = ctx.cartStore.tax
      const total = ctx.cartStore.total

      const trx = ctx.transactionStore.createTransaction({
        items: ctx.cartStore.items,
        subtotal,
        tax,
        taxEnabled: ctx.taxStore.enabled,
        taxRate,
        total,
        paymentMethod: 'cash',
        cashReceived: 20000,
        changeAmount: 20000 - total,
      })
      expect(trx.id).toBeTruthy()
      ctx.productStore.recordSaleStock(trx.items, trx.id)
      ctx.cashStore.recordSalePayment(trx)
      ctx.cartStore.clearCart()

      // Stok berkurang
      expect(ctx.productStore.getProductById(productId).stock).toBe(49)
      // Kas bertambah
      expect(ctx.cashStore.balance).toBe(100000 + total)

      // 6. Catat pengeluaran & mutasi kas manual
      const expRes = ctx.expenseStore.createExpense({
        title: 'Beli Es Batu',
        category: 'Operasional',
        amount: 15000,
        note: 'Kebutuhan es batu',
      })
      expect(expRes.success).toBe(true)
      ctx.cashStore.recordEntry({
        type: 'out',
        amount: 15000,
        category: 'Pengeluaran',
        note: 'Beli Es Batu',
      })
      expect(ctx.cashStore.balance).toBe(100000 + total - 15000)

      // 7. Tutup shift
      ctx.shiftStore.closeShift()
      expect(ctx.shiftStore.isOpen).toBe(false)
      expect(ctx.shiftStore.status).toBe('closed')

      // 8. Riwayat transaksi tersedia
      expect(ctx.transactionStore.items.length).toBeGreaterThanOrEqual(1)
      expect(ctx.transactionStore.items[0].id).toBe(trx.id)

      // Seluruh operasi tidak menyentuh network
      expect(fetchSpy).not.toHaveBeenCalled()
    })
  })

  describe('4. TRANSAKSI OFFLINE & SNAPSHOT INTEGRITY', () => {
    it('menggunakan snapshot harga dan HPP saat checkout yang tidak terpengaruh perubahan master produk', async () => {
      const ctx = createQAContext()
      await ctx.service.initialize()

      const created = ctx.productStore.createProduct({
        name: 'Es Kopi Gula Aren',
        category: ctx.productStore.categories[0],
        cost: 7000,
        price: 18000,
        stock: 20,
        unit: 'cup',
        isActive: true,
      })
      const product = created.product

      // Checkout flow: Tambah ke cart -> ubah kuantitas (3) -> Checkout
      ctx.cartStore.addItem(product)
      ctx.cartStore.updateQty(product.id, 3)

      expect(ctx.cartStore.items[0].qty).toBe(3)
      expect(ctx.cartStore.items[0].price).toBe(18000)
      expect(ctx.cartStore.items[0].hppSnapshot).toBe(7000)

      const subtotal = 18000 * 3 // 54000
      ctx.taxStore.setSettings({ enabled: false, rate: 0 })

      const trx = ctx.transactionStore.createTransaction({
        items: ctx.cartStore.items,
        subtotal,
        tax: 0,
        taxEnabled: false,
        taxRate: null,
        total: subtotal,
        paymentMethod: 'cash',
        cashReceived: 60000,
        changeAmount: 6000,
      })
      ctx.productStore.recordSaleStock(trx.items, trx.id)

      // Verifikasi gross profit = (18000 - 7000) * 3 = 33000
      expect(trx.grossProfit).toBe(33000)
      expect(trx.items[0].hppSnapshot).toBe(7000)
      expect(trx.items[0].price).toBe(18000)
      expect(trx.items[0].lineCost).toBe(21000)
      expect(trx.items[0].lineSubtotal).toBe(54000)

      // Sekarang ubah harga & HPP master produk di masa depan
      ctx.productStore.updateProduct(product.id, {
        ...ctx.productStore.getProductById(product.id),
        price: 25000,
        cost: 12000,
      })

      // Transaksi yang sudah selesai TIDAK boleh terpengaruh
      const savedTrx = ctx.transactionStore.items.find((item) => item.id === trx.id)
      expect(savedTrx.items[0].price).toBe(18000)
      expect(savedTrx.items[0].hppSnapshot).toBe(7000)
      expect(savedTrx.grossProfit).toBe(33000)
      expect(savedTrx.total).toBe(54000)
    })

    it('menghitung pajak aktif dan non-aktif secara konsisten serta menyimpan taxEnabled & taxRate', async () => {
      const ctx = createQAContext()
      await ctx.service.initialize()

      const prod = ctx.productStore.createProduct({
        name: 'Mie Ayam',
        category: ctx.productStore.categories[0],
        cost: 8000,
        price: 20000,
        stock: 10,
        unit: 'porsi',
        isActive: true,
      }).product

      // 1. Pajak aktif 11%
      ctx.taxStore.setSettings({ enabled: true, rate: 11 })
      ctx.cartStore.addItem(prod)

      expect(ctx.cartStore.subtotal).toBe(20000)
      expect(ctx.cartStore.tax).toBe(2200)
      expect(ctx.cartStore.total).toBe(22200)

      const trxTaxActive = ctx.transactionStore.createTransaction({
        items: ctx.cartStore.items,
        subtotal: ctx.cartStore.subtotal,
        tax: ctx.cartStore.tax,
        taxEnabled: true,
        taxRate: 11,
        total: ctx.cartStore.total,
        paymentMethod: 'qris',
      })
      expect(trxTaxActive.taxEnabled).toBe(true)
      expect(trxTaxActive.taxRate).toBe(11)
      expect(trxTaxActive.tax).toBe(2200)
      expect(trxTaxActive.total).toBe(22200)

      ctx.cartStore.clearCart()

      // 2. Pajak nonaktif
      ctx.taxStore.setSettings({ enabled: false, rate: 11 })
      ctx.cartStore.addItem(prod)

      expect(ctx.cartStore.subtotal).toBe(20000)
      expect(ctx.cartStore.tax).toBe(0)
      expect(ctx.cartStore.total).toBe(20000)

      const trxTaxInactive = ctx.transactionStore.createTransaction({
        items: ctx.cartStore.items,
        subtotal: ctx.cartStore.subtotal,
        tax: 0,
        taxEnabled: false,
        taxRate: null,
        total: 20000,
        paymentMethod: 'cash',
        cashReceived: 20000,
        changeAmount: 0,
      })
      expect(trxTaxInactive.taxEnabled).toBe(false)
      expect(trxTaxInactive.taxRate).toBeNull()
      expect(trxTaxInactive.tax).toBe(0)
      expect(trxTaxInactive.total).toBe(20000)
    })
  })

  describe('5. STOK DAN INVENTORY', () => {
    it('mendukung penambahan, pengurangan, penyesuaian stok manual, batas stok minimum, dan stok nol', async () => {
      const ctx = createQAContext()
      await ctx.service.initialize()

      const created = ctx.productStore.createProduct({
        name: 'Gula Pasir 1kg',
        category: ctx.productStore.categories[0],
        cost: 12000,
        price: 16000,
        stock: 5,
        minStock: 3,
        unit: 'kg',
        isActive: true,
      })
      const product = created.product

      // 1. Penjualan mengurangi stok
      ctx.productStore.recordSaleStock([{ id: product.id, name: product.name, qty: 2 }], 'sale-1')
      expect(ctx.productStore.getProductById(product.id).stock).toBe(3)
      expect(ctx.productStore.stockMovements[0]).toMatchObject({
        productId: product.id,
        quantityChange: -2,
        stockBefore: 5,
        stockAfter: 3,
        type: 'sale',
      })

      // 2. Batas stok minimum: stock (3) <= minStock (3) terdeteksi low stock
      expect(ctx.productStore.lowStockProducts.map((p) => p.id)).toContain(product.id)

      // 3. Penambahan stok manual (+10)
      const resAdd = ctx.productStore.adjustStock(product.id, {
        quantityChange: 10,
        note: 'Restock supplier',
      })
      expect(resAdd.success).toBe(true)
      expect(ctx.productStore.getProductById(product.id).stock).toBe(13)
      expect(ctx.productStore.lowStockProducts.map((p) => p.id)).not.toContain(product.id)

      // 4. Pengurangan stok manual (-8)
      const resSub = ctx.productStore.adjustStock(product.id, {
        quantityChange: -8,
        note: 'Barang rusak/pecah',
      })
      expect(resSub.success).toBe(true)
      expect(ctx.productStore.getProductById(product.id).stock).toBe(5)

      // 5. Penyesuaian ke stok nol
      const resZero = ctx.productStore.adjustStock(product.id, {
        quantityChange: -5,
        note: 'Habis terjual offline',
      })
      expect(resZero.success).toBe(true)
      expect(ctx.productStore.getProductById(product.id).stock).toBe(0)
      expect(ctx.productStore.lowStockProducts.map((p) => p.id)).toContain(product.id)
    })

    it('mendukung keberadaan produk dengan stok negatif tanpa error dan dapat dipulihkan', async () => {
      const ctx = createQAContext()
      await ctx.service.initialize()

      // Buat produk dengan stok awal 0 lalu diset negatif (misal dari sinkronisasi atau penyesuaian data)
      const created = ctx.productStore.createProduct({
        name: 'Item Stok Negatif',
        category: ctx.productStore.categories[0],
        cost: 5000,
        price: 8000,
        stock: 0,
        minStock: 2,
        unit: 'pcs',
        isActive: true,
      })
      const product = created.product

      // Langsung set nilai stok negatif (diperbolehkan proyek)
      product.stock = -4

      // Tidak ada validasi yang melarang atau memecahkan getter
      expect(product.stock).toBe(-4)
      expect(ctx.productStore.lowStockProducts.map((p) => p.id)).toContain(product.id)

      // Simpan melalui persistence adapter
      await ctx.service.flush()

      // Buat runtime baru dan hydrate kembali
      const newPinia = createPinia()
      setActivePinia(newPinia)
      const restartService = createPersistenceService({ adapter: ctx.adapter, pinia: newPinia })
      await restartService.initialize()

      const restartedProductStore = useProductStore(newPinia)
      const reloadedProduct = restartedProductStore.getProductById(product.id)
      expect(reloadedProduct).toBeTruthy()
      expect(reloadedProduct.stock).toBe(-4)
      expect(restartedProductStore.lowStockProducts.map((p) => p.id)).toContain(product.id)
    })

    it('restart dan hydration tidak menyebabkan pengurangan stok berulang', async () => {
      const ctx = createQAContext()
      await ctx.service.initialize()

      const created = ctx.productStore.createProduct({
        name: 'Teh Botol',
        category: ctx.productStore.categories[0],
        cost: 2500,
        price: 4000,
        stock: 20,
        minStock: 5,
        unit: 'botol',
        isActive: true,
      })
      const product = created.product

      // Transaksi 5 botol -> stok sisa 15
      ctx.cartStore.addItem(product)
      ctx.cartStore.updateQty(product.id, 5)

      const initialTrxCount = ctx.transactionStore.items.length

      const trx = ctx.transactionStore.createTransaction({
        items: ctx.cartStore.items,
        subtotal: 20000,
        tax: 0,
        taxEnabled: false,
        taxRate: null,
        total: 20000,
        paymentMethod: 'cash',
        cashReceived: 20000,
        changeAmount: 0,
      })
      ctx.productStore.recordSaleStock(trx.items, trx.id)
      await ctx.service.flush()

      expect(ctx.productStore.getProductById(product.id).stock).toBe(15)
      expect(ctx.productStore.stockMovements).toHaveLength(1)
      expect(ctx.transactionStore.items).toHaveLength(initialTrxCount + 1)

      // Restart simulasi
      await ctx.service.close()

      const nextPinia = createPinia()
      setActivePinia(nextPinia)
      const nextService = createPersistenceService({ adapter: ctx.adapter, pinia: nextPinia })
      await nextService.initialize()

      const nextProductStore = useProductStore(nextPinia)
      const nextTrxStore = useTransactionStore(nextPinia)

      // Stok HARUS tetap 15, TIDAK berkurang lagi menjadi 10
      expect(nextProductStore.getProductById(product.id).stock).toBe(15)
      expect(nextProductStore.stockMovements).toHaveLength(1)
      expect(nextTrxStore.items).toHaveLength(initialTrxCount + 1)
      expect(nextTrxStore.items[0].id).toBe(trx.id)

      await nextService.close()
    })
  })

  describe('6. PENGUJIAN TIGA JENIS BISNIS', () => {
    it('Bisnis 1: Cafe / UMKM (F&B, variasi kuantitas, pajak, HPP, cash payment)', async () => {
      const ctx = createQAContext()
      await ctx.service.initialize()
      ctx.productStore.applyBusinessTemplate('Cafe / UMKM')

      const coffee = ctx.productStore.products.find((p) => p.name.includes('Kopi') || p.category.includes('Minuman'))
        ?? ctx.productStore.createProduct({
          name: 'Cappuccino Blend',
          category: 'Minuman',
          cost: 8000,
          price: 22000,
          stock: 30,
          unit: 'cup',
          isActive: true,
        }).product

      const food = ctx.productStore.products.find((p) => p.category.includes('Makanan'))
        ?? ctx.productStore.createProduct({
          name: 'Croissant Butter',
          category: 'Makanan',
          cost: 10000,
          price: 25000,
          stock: 15,
          unit: 'pcs',
          isActive: true,
        }).product

      ctx.taxStore.setSettings({ enabled: true, rate: 10 })
      ctx.cartStore.addItem(coffee)
      ctx.cartStore.updateQty(coffee.id, 2) // 44000
      ctx.cartStore.addItem(food)
      ctx.cartStore.updateQty(food.id, 1) // 25000

      const expectedSubtotal = (coffee.price * 2) + (food.price * 1)
      const expectedTax = Math.round(expectedSubtotal * 0.1)
      const expectedTotal = expectedSubtotal + expectedTax

      expect(ctx.cartStore.subtotal).toBe(expectedSubtotal)
      expect(ctx.cartStore.tax).toBe(expectedTax)
      expect(ctx.cartStore.total).toBe(expectedTotal)

      const trx = ctx.transactionStore.createTransaction({
        items: ctx.cartStore.items,
        subtotal: expectedSubtotal,
        tax: expectedTax,
        taxEnabled: true,
        taxRate: 10,
        total: expectedTotal,
        paymentMethod: 'cash',
        cashReceived: expectedTotal + 10000,
        changeAmount: 10000,
      })
      ctx.productStore.recordSaleStock(trx.items, trx.id)
      ctx.cashStore.recordSalePayment(trx)

      expect(trx.changeAmount).toBe(10000)
      expect(trx.items).toHaveLength(2)
      expect(ctx.cashStore.balance).toBe(expectedTotal)
    })

    it('Bisnis 2: Laundry (layanan kiloan desimal 2.5 kg, satuan, HPP, status lifecycle, unpaid order, pelunasan)', async () => {
      const ctx = createQAContext()
      await ctx.service.initialize()
      ctx.productStore.applyBusinessTemplate('Laundry')

      // 1. Layanan Kiloan
      const kiloanService = ctx.productStore.createProduct({
        kind: 'service',
        name: 'Cuci Komplit Reguler',
        category: 'Kiloan',
        pricingUnit: 'kg',
        price: 10000,
        cost: 4000,
        minQuantity: 1,
        estimatedDuration: '2 Hari',
        isActive: true,
      }).product

      // 2. Layanan Satuan
      const satuanService = ctx.productStore.createProduct({
        kind: 'service',
        name: 'Cuci Bedcover Besar',
        category: 'Satuan',
        pricingUnit: 'pcs',
        price: 35000,
        cost: 15000,
        minQuantity: 1,
        estimatedDuration: '3 Hari',
        isActive: true,
      }).product

      // Keranjang: 2.5 kg Cuci Komplit (2.5 * 10.000 = 25.000) + 1 Bedcover (35.000)
      ctx.cartStore.addItem(kiloanService)
      ctx.cartStore.updateQty(kiloanService.id, 2.5)
      ctx.cartStore.addItem(satuanService)
      ctx.cartStore.updateQty(satuanService.id, 1)

      expect(ctx.cartStore.items[0].qty).toBe(2.5)
      expect(ctx.cartStore.subtotal).toBe(60000) // 25000 + 35000

      // Order laundry masuk belum bayar (unpaid)
      const laundryOrder = ctx.transactionStore.createLaundryOrder({
        customer: 'Ibu Ratna',
        customerSnapshot: { name: 'Ibu Ratna', phone: '0812345678' },
        items: ctx.cartStore.items,
        subtotal: 60000,
        tax: 0,
        total: 60000,
        paymentStatus: 'unpaid',
        orderStatus: 'Masuk',
      })

      expect(laundryOrder.orderStatus).toBe('Masuk')
      expect(laundryOrder.paymentStatus).toBe('unpaid')
      expect(laundryOrder.items[0].qty).toBe(2.5)
      expect(laundryOrder.grossProfit).toBe((25000 - (4000 * 2.5)) + (35000 - 15000)) // 15000 + 20000 = 35000

      // Order belum dibayar tidak mencatat kas masuk
      expect(ctx.cashStore.entries).toHaveLength(0)

      // 3. Status pengerjaan lifecycle: Masuk -> Diproses -> Siap Diambil -> Selesai
      expect(ctx.transactionStore.advanceOrderStatus(laundryOrder.id)).toBe(true)
      expect(laundryOrder.orderStatus).toBe('Diproses')

      expect(ctx.transactionStore.advanceOrderStatus(laundryOrder.id)).toBe(true)
      expect(laundryOrder.orderStatus).toBe('Siap Diambil')

      expect(ctx.transactionStore.advanceOrderStatus(laundryOrder.id)).toBe(true)
      expect(laundryOrder.orderStatus).toBe('Selesai')

      // 4. Pelunasan transaksi setelah layanan selesai
      const settleRes = ctx.transactionStore.settleLaundryOrderPayment({
        orderId: laundryOrder.id,
        paymentMethod: 'cash',
        cashReceived: 100000,
        changeAmount: 40000,
        cashStore: ctx.cashStore,
      })

      expect(settleRes.success).toBe(true)
      expect(laundryOrder.paymentStatus).toBe('paid')
      expect(laundryOrder.cashReceived).toBe(100000)
      expect(laundryOrder.changeAmount).toBe(40000)
      expect(ctx.cashStore.balance).toBe(60000)

      // Pelunasan ulang bersifat idempoten (tidak menambah cash lagi)
      const idempotentRes = ctx.transactionStore.settleLaundryOrderPayment({
        orderId: laundryOrder.id,
        paymentMethod: 'cash',
        cashStore: ctx.cashStore,
      })
      expect(idempotentRes.success).toBe(true)
      expect(idempotentRes.duplicated).toBe(true)
      expect(ctx.cashStore.entries).toHaveLength(1)
      expect(ctx.cashStore.balance).toBe(60000)
    })

    it('Bisnis 3: Grosir / Toko Kelontong (katalog, SKU, HPP, multi-item, mutasi stok, perubahan harga)', async () => {
      const ctx = createQAContext()
      await ctx.service.initialize()
      ctx.productStore.applyBusinessTemplate('Grosir / Toko Kelontong')
      ctx.productStore.createCategory('Sembako')

      const item1Res = ctx.productStore.createProduct({
        name: 'Minyak Goreng 2L',
        category: 'Sembako',
        sku: 'MYK-2L',
        cost: 28000,
        price: 33000,
        stock: 24,
        minStock: 6,
        unit: 'pouch',
        isActive: true,
      })
      expect(item1Res.success).toBe(true)
      const item1 = item1Res.product

      const item2Res = ctx.productStore.createProduct({
        name: 'Terigu Segitiga 1kg',
        category: 'Sembako',
        sku: 'TRG-1K',
        cost: 10500,
        price: 13000,
        stock: 30,
        minStock: 5,
        unit: 'pack',
        isActive: true,
      })
      expect(item2Res.success).toBe(true)
      const item2 = item2Res.product

      // Checkout multi-item
      ctx.cartStore.addItem(item1)
      ctx.cartStore.updateQty(item1.id, 4) // 4 * 33000 = 132000
      ctx.cartStore.addItem(item2)
      ctx.cartStore.updateQty(item2.id, 5) // 5 * 13000 = 65000

      const subtotal = 132000 + 65000 // 197000
      const trx = ctx.transactionStore.createTransaction({
        items: ctx.cartStore.items,
        subtotal,
        tax: 0,
        taxEnabled: false,
        taxRate: null,
        total: subtotal,
        paymentMethod: 'cash',
        cashReceived: 200000,
        changeAmount: 3000,
      })
      ctx.productStore.recordSaleStock(trx.items, trx.id)

      expect(ctx.productStore.getProductById(item1.id).stock).toBe(20)
      expect(ctx.productStore.getProductById(item2.id).stock).toBe(25)
      expect(ctx.productStore.stockMovements).toHaveLength(2)

      // Ubah harga produk di toko
      ctx.productStore.updateProduct(item1.id, {
        ...ctx.productStore.getProductById(item1.id),
        price: 35000,
      })
      expect(ctx.productStore.getProductById(item1.id).price).toBe(35000)

      // Transaksi sebelumnya tetap menggunakan snapshot 33000
      expect(trx.items.find((i) => i.id === item1.id).price).toBe(33000)
    })
  })

  describe('7. KAS DAN SHIFT', () => {
    it('mengelola siklus shift lengkap, mutasi kas, pengeluaran, serta mencegah duplikasi ledger', async () => {
      const ctx = createQAContext()
      await ctx.service.initialize()

      // 1. Buka shift
      const shiftId = ctx.shiftStore.openShift(150000)
      expect(shiftId).toBeTruthy()
      expect(ctx.shiftStore.isOpen).toBe(true)
      expect(ctx.shiftStore.status).toBe('open')
      expect(ctx.shiftStore.openingBalance).toBe(150000)

      ctx.cashStore.recordOpeningBalance(150000, shiftId)
      expect(ctx.cashStore.balance).toBe(150000)

      // Membuka ulang saldo awal dengan referenceId sama tidak duplikat
      const dupOpen = ctx.cashStore.recordOpeningBalance(150000, shiftId)
      expect(dupOpen.duplicated).toBe(true)
      expect(ctx.cashStore.balance).toBe(150000)

      // 2. Penjualan Tunai
      const cashTrx = ctx.transactionStore.createTransaction({
        items: [{ id: 'p1', name: 'Barang A', price: 50000, qty: 1 }],
        subtotal: 50000,
        tax: 0,
        total: 50000,
        paymentMethod: 'cash',
      })
      ctx.cashStore.recordSalePayment(cashTrx)
      expect(ctx.cashStore.balance).toBe(200000)

      // Rekam ulang pembayaran transaksi sama tidak menambah kas lagi
      const dupSale = ctx.cashStore.recordSalePayment(cashTrx)
      expect(dupSale.duplicated).toBe(true)
      expect(ctx.cashStore.balance).toBe(200000)

      // 3. Penjualan Non-Tunai (QRIS / Transfer)
      const qrisTrx = ctx.transactionStore.createTransaction({
        items: [{ id: 'p2', name: 'Barang B', price: 75000, qty: 1 }],
        subtotal: 75000,
        tax: 0,
        total: 75000,
        paymentMethod: 'qris',
      })
      const qrisRes = ctx.cashStore.recordSalePayment(qrisTrx)
      expect(qrisRes.skipped).toBe(true)
      // Saldo kas fisik TIDAK bertambah
      expect(ctx.cashStore.balance).toBe(200000)

      // 4. Kas Masuk Manual
      ctx.cashStore.recordEntry({
        type: 'in',
        amount: 25000,
        category: 'Kas Masuk',
        note: 'Tambah uang kembalian pecahan kecil',
      })
      expect(ctx.cashStore.balance).toBe(225000)

      // 5. Kas Keluar Manual & Pengeluaran
      const expRes = ctx.expenseStore.createExpense({
        title: 'Beli Galon',
        category: 'Operasional',
        amount: 20000,
        note: 'Air minum',
      })
      expect(expRes.success).toBe(true)
      ctx.cashStore.recordEntry({
        type: 'out',
        amount: 20000,
        category: 'Pengeluaran',
        note: 'Beli Galon',
      })
      expect(ctx.cashStore.balance).toBe(205000)

      // 6. Tutup shift
      ctx.shiftStore.closeShift()
      expect(ctx.shiftStore.isOpen).toBe(false)
      expect(ctx.shiftStore.status).toBe('closed')
      expect(ctx.shiftStore.closedAt).toBeTruthy()

      // Riwayat kas akurat
      expect(ctx.cashStore.cashIn).toBe(150000 + 50000 + 25000) // 225000
      expect(ctx.cashStore.cashOut).toBe(20000)
      expect(ctx.cashStore.balance).toBe(205000)
    })
  })

  describe('8. PERSISTENSI DAN RESTART', () => {
    it('memulihkan seluruh state aplikasi (bisnis, PIN, produk, stok, transaksi, kas, shift, pajak) setelah restart tanpa template re-applied', async () => {
      const adapter = createMemoryAdapter()
      const ctx1 = createQAContext(adapter)
      await ctx1.service.initialize()

      // Set up dataset
      ctx1.businessStore.setBusiness({
        name: 'Kopi Kenangan Senja',
        type: 'Cafe / UMKM',
        owner: 'Siti',
        phone: '081299998888',
        outlet: 'Cabang 1',
        mode: 'free',
      })
      ctx1.cashierStore.setPinConfigured(true)
      ctx1.taxStore.setSettings({ enabled: true, rate: 12 })

      const prod = ctx1.productStore.createProduct({
        name: 'Signature Latte',
        category: ctx1.productStore.categories[0],
        cost: 9000,
        price: 24000,
        stock: 15,
        minStock: 4,
        unit: 'cup',
        isActive: true,
      }).product

      const shiftId = ctx1.shiftStore.openShift(100000)
      ctx1.cashStore.recordOpeningBalance(100000, shiftId)

      const trx = ctx1.transactionStore.createTransaction({
        items: [{ ...prod, qty: 2, price: 24000, hppSnapshot: 9000, subtotal: 48000 }],
        subtotal: 48000,
        tax: 5760,
        taxEnabled: true,
        taxRate: 12,
        total: 53760,
        paymentMethod: 'cash',
        cashReceived: 60000,
        changeAmount: 6240,
      })
      ctx1.productStore.recordSaleStock(trx.items, trx.id)
      ctx1.cashStore.recordSalePayment(trx)

      ctx1.expenseStore.createExpense({
        title: 'Sewa Tempat Harian',
        category: 'Operasional',
        amount: 30000,
        note: 'Kantin',
      })

      await ctx1.service.flush()
      await ctx1.service.close()

      // SIMULASI RESTART APLIKASI
      const nextPinia = createPinia()
      setActivePinia(nextPinia)
      const ctx2 = createQAContext(adapter)
      const initResult = await ctx2.service.initialize()

      expect(initResult.firstRun).toBe(false)
      expect(initResult.schemaVersion).toBe(DB_VERSION)

      // Verifikasi Business Profile
      expect(ctx2.businessStore.name).toBe('Kopi Kenangan Senja')
      expect(ctx2.businessStore.type).toBe('Cafe / UMKM')
      expect(ctx2.businessStore.outlet).toBe('Cabang 1')
      expect(ctx2.businessStore.mode).toBe('free')

      // Verifikasi Cashier PIN
      expect(ctx2.cashierStore.activeCashier.pinConfigured).toBe(true)

      // Verifikasi Tax Settings
      expect(ctx2.taxStore.enabled).toBe(true)
      expect(ctx2.taxStore.rate).toBe(12)

      // Verifikasi Produk & Stok
      const reloadedProd = ctx2.productStore.getProductById(prod.id)
      expect(reloadedProd).toBeTruthy()
      expect(reloadedProd.name).toBe('Signature Latte')
      expect(reloadedProd.cost).toBe(9000)
      expect(reloadedProd.price).toBe(24000)
      expect(reloadedProd.stock).toBe(13) // 15 - 2 = 13 (tidak duplikat berkurang)
      expect(ctx2.productStore.stockMovements).toHaveLength(1)

      // Verifikasi Transaksi
      const reloadedTrx = ctx2.transactionStore.items.find((item) => item.id === trx.id)
      expect(reloadedTrx).toBeTruthy()
      expect(reloadedTrx.total).toBe(53760)
      expect(reloadedTrx.taxRate).toBe(12)
      expect(reloadedTrx.items[0].hppSnapshot).toBe(9000)

      // Verifikasi Kas
      expect(ctx2.cashStore.entries).toHaveLength(2) // Opening + Sale
      expect(ctx2.cashStore.balance).toBe(100000 + 53760)

      // Verifikasi Shift
      expect(ctx2.shiftStore.isOpen).toBe(true)
      expect(ctx2.shiftStore.openingBalance).toBe(100000)
      expect(ctx2.shiftStore.id).toBe(shiftId)

      // Verifikasi Expense
      expect(ctx2.expenseStore.expenses).toHaveLength(1)
      expect(ctx2.expenseStore.expenses[0].title).toBe('Sewa Tempat Harian')

      await ctx2.service.close()
    })

    it('mendukung deserialisasi baris transaksi SQLite native secara aman', () => {
      const rows = [
        {
          id: 'trx-1',
          payload: JSON.stringify({
            id: 'trx-1',
            invoiceNumber: 'INV-001',
            total: 50000,
            taxRate: 11,
            items: [{ id: 'p1', name: 'Item A', qty: 1, price: 50000, hppSnapshot: 20000 }],
          }),
          created_at: '2026-09-24T10:00:00.000Z',
        },
        {
          id: 'corrupt-row',
          payload: 'INVALID JSON NOT A STRING OBJECT',
          created_at: '2026-09-24T10:05:00.000Z',
        },
      ]

      const deserialized = deserializeTransactionRows(rows)
      expect(deserialized).toHaveLength(1)
      expect(deserialized[0].id).toBe('trx-1')
      expect(deserialized[0].items[0].hppSnapshot).toBe(20000)
    })
  })

  describe('9. BACKUP DAN RESTORE', () => {
    it('membuat payload backup v2 dan merestore kembali dataset QA dengan integritas penuh', async () => {
      const ctx = createQAContext()
      await ctx.service.initialize()

      ctx.businessStore.setBusiness({
        name: 'Toko Kelontong Bersama',
        type: 'Grosir / Toko Kelontong',
        owner: 'Budi',
        phone: '081122334455',
        outlet: 'Toko Pusat',
        mode: 'free',
      })
      ctx.taxStore.setSettings({ enabled: true, rate: 11 })

      const prod = ctx.productStore.createProduct({
        name: 'Kecap Manis 600ml',
        category: ctx.productStore.categories[0],
        cost: 15000,
        price: 20000,
        stock: 12,
        minStock: 2,
        unit: 'botol',
        isActive: true,
      }).product

      // Transaksi 1: taxRate numerik (11)
      const trx1 = ctx.transactionStore.createTransaction({
        items: [{ id: prod.id, name: prod.name, price: 20000, hppSnapshot: 15000, qty: 2 }],
        subtotal: 40000,
        tax: 4400,
        taxEnabled: true,
        taxRate: 11,
        total: 44400,
        paymentMethod: 'cash',
      })

      // Transaksi 2: taxRate null (tax nonaktif)
      const trx2 = ctx.transactionStore.createTransaction({
        items: [{ id: prod.id, name: prod.name, price: 20000, hppSnapshot: 15000, qty: 1 }],
        subtotal: 20000,
        tax: 0,
        taxEnabled: false,
        taxRate: null,
        total: 20000,
        paymentMethod: 'qris',
      })

      // Buat backup payload
      const backup = createBackupPayload(ctx)
      expect(backup.schema).toBe('pos-mobile-backup')
      expect(backup.version).toBe(2)
      expect(backup.data.transactions.some((t) => t.id === trx1.id)).toBe(true)
      expect(backup.data.transactions.some((t) => t.id === trx2.id)).toBe(true)

      // Validasi backup
      const val = validateBackupPayload(backup)
      expect(val.valid).toBe(true)
      expect(val.error).toBe('')

      // Pastikan restore dicegah saat shift sedang buka
      ctx.shiftStore.openShift(50000)
      const openShiftRestore = restoreBackupPayload(backup, ctx)
      expect(openShiftRestore.success).toBe(false)
      expect(openShiftRestore.error).toContain('Tutup shift terlebih dahulu')

      // Tutup shift lalu jalankan restore
      ctx.shiftStore.closeShift()
      const validRestore = restoreBackupPayload(backup, ctx)
      expect(validRestore.success).toBe(true)

      // Verifikasi hasil restore
      expect(ctx.businessStore.name).toBe('Toko Kelontong Bersama')
      expect(ctx.transactionStore.items.some((t) => t.id === trx1.id && t.taxRate === 11)).toBe(true)
      expect(ctx.transactionStore.items.some((t) => t.id === trx2.id && t.taxRate === null)).toBe(true)
      expect(ctx.productStore.getProductById(prod.id)).toBeTruthy()
    })
  })

  describe('10. BATASAN SINKRONISASI OFFLINE', () => {
    it('operasi offline dalam mode Free tidak memicu sync cloud dan tidak menunggu server', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch')
      const ctx = createQAContext()
      await ctx.service.initialize()

      // Mode free
      ctx.businessStore.setBusiness({
        name: 'Offline Only Store',
        type: 'Cafe / UMKM',
        mode: 'free',
      })

      // Buat transaksi
      const trx = ctx.transactionStore.createTransaction({
        items: [{ id: 'item-1', name: 'Es Teh', price: 5000, qty: 2 }],
        subtotal: 10000,
        tax: 0,
        total: 10000,
        paymentMethod: 'cash',
      })

      // Transaksi selesai secara instan dan sinkron tanpa pending network promise
      expect(trx.id).toBeTruthy()
      expect(fetchSpy).not.toHaveBeenCalled()
    })
  })
})
