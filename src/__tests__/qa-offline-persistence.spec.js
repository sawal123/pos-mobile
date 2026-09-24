import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  createBackupPayload,
  restoreBackupPayload,
  validateBackupPayload,
} from '@/services/backupService'
import { createLocalOperationService } from '@/services/database/localOperationService'
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
  const localOperations = createLocalOperationService({ adapter, pinia, scheduler: service })

  return {
    pinia,
    adapter,
    service,
    localOperations,
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

  describe('1. PERBAIKAN STOK NEGATIF & INVENTORY RULES', () => {
    it('penjualan 5 unit dari stok awal 2 menghasilkan stok -3 dengan tepat satu stock movement', async () => {
      const ctx = createQAContext()
      await ctx.service.initialize()

      const created = ctx.productStore.createProduct({
        name: 'Beras Ramos 5kg',
        category: ctx.productStore.categories[0],
        cost: 60000,
        price: 75000,
        stock: 2,
        minStock: 3,
        unit: 'karung',
        isActive: true,
      })
      const product = created.product

      // Validasi canFulfillSale mengizinkan stok negatif untuk kebutuhan offline
      const validation = ctx.productStore.canFulfillSale([
        { id: product.id, name: product.name, qty: 5 },
      ])
      expect(validation.success).toBe(true)

      // Jalankan penjualan 5 unit
      ctx.productStore.recordSaleStock([{ id: product.id, name: product.name, qty: 5 }], 'sale-negative-1')

      // Hasil stok harus -3
      expect(ctx.productStore.getProductById(product.id).stock).toBe(-3)

      // Tepat satu stock movement dicatat
      expect(ctx.productStore.stockMovements).toHaveLength(1)
      expect(ctx.productStore.stockMovements[0]).toMatchObject({
        productId: product.id,
        quantityChange: -5,
        stockBefore: 2,
        stockAfter: -3,
        type: 'sale',
      })
    })

    it('penyesuaian manual dari stok 0 menjadi -4', async () => {
      const ctx = createQAContext()
      await ctx.service.initialize()

      const created = ctx.productStore.createProduct({
        name: 'Minyak Curah 1L',
        category: ctx.productStore.categories[0],
        cost: 14000,
        price: 18000,
        stock: 0,
        minStock: 5,
        unit: 'liter',
        isActive: true,
      })
      const product = created.product

      // adjustStock dari 0 ke -4
      const res = ctx.productStore.adjustStock(product.id, {
        quantityChange: -4,
        note: 'Koreksi stok opname minus fisik',
      })
      expect(res.success).toBe(true)
      expect(ctx.productStore.getProductById(product.id).stock).toBe(-4)

      expect(ctx.productStore.stockMovements).toHaveLength(1)
      expect(ctx.productStore.stockMovements[0]).toMatchObject({
        productId: product.id,
        quantityChange: -4,
        stockBefore: 0,
        stockAfter: -4,
        type: 'adjustment',
      })
    })

    it('tetap menolak kuantitas tidak valid, produk tidak aktif, dan produk tidak ditemukan', async () => {
      const ctx = createQAContext()
      await ctx.service.initialize()

      const created = ctx.productStore.createProduct({
        name: 'Kopi Bubuk',
        category: ctx.productStore.categories[0],
        cost: 5000,
        price: 10000,
        stock: 10,
        isActive: true,
      })
      const product = created.product

      // 1. Kuantitas tidak valid (0 atau negatif)
      const zeroQty = ctx.productStore.canFulfillSale([{ id: product.id, name: product.name, qty: 0 }])
      expect(zeroQty.success).toBe(false)
      expect(zeroQty.error).toContain('tidak valid')

      const negQty = ctx.productStore.canFulfillSale([{ id: product.id, name: product.name, qty: -2 }])
      expect(negQty.success).toBe(false)
      expect(negQty.error).toContain('tidak valid')

      const nanQty = ctx.productStore.canFulfillSale([{ id: product.id, name: product.name, qty: 'abc' }])
      expect(nanQty.success).toBe(false)
      expect(nanQty.error).toContain('tidak valid')

      // 2. Produk tidak aktif
      ctx.productStore.toggleProductActive(product.id)
      const inactiveSale = ctx.productStore.canFulfillSale([{ id: product.id, name: product.name, qty: 1 }])
      expect(inactiveSale.success).toBe(false)
      expect(inactiveSale.error).toContain('tidak aktif')

      // 3. Produk tidak ditemukan
      const notFoundSale = ctx.productStore.canFulfillSale([{ id: 'non-existent-id', name: 'Barang Hantu', qty: 1 }])
      expect(notFoundSale.success).toBe(false)
      expect(notFoundSale.error).toContain('tidak ditemukan')
    })

    it('layanan laundry tidak boleh memakai atau mengurangi stok', async () => {
      const ctx = createQAContext()
      await ctx.service.initialize()
      ctx.productStore.applyBusinessTemplate('Laundry')

      const service = ctx.productStore.createProduct({
        kind: 'service',
        name: 'Cuci Kering Kiloan',
        category: 'Kiloan',
        pricingUnit: 'kg',
        price: 8000,
        cost: 3000,
        minQuantity: 1,
        isActive: true,
      }).product

      // adjustStock pada layanan harus ditolak
      const adjustRes = ctx.productStore.adjustStock(service.id, { quantityChange: -5 })
      expect(adjustRes.success).toBe(false)
      expect(adjustRes.error).toContain('Layanan tidak memakai stok')

      // recordSaleStock pada layanan diabaikan
      ctx.productStore.recordSaleStock([{ id: service.id, name: service.name, qty: 5 }], 'sale-laundry-1')
      expect(ctx.productStore.stockMovements).toHaveLength(0)
    })
  })

  describe('2. PERSISTENSI SHIFT LENGKAP & RESTART RECOVERY', () => {
    it('memulihkan shift yang masih terbuka (id, shiftNumber, status, openingBalance, notes, openedAt) tanpa duplikasi saldo awal', async () => {
      const adapter = createMemoryAdapter()
      const ctx1 = createQAContext(adapter)
      await ctx1.service.initialize()

      // Buka shift dengan metadata lengkap
      const shiftId = ctx1.shiftStore.openShift(250000)
      ctx1.shiftStore.shiftNumber = 'SHIFT-2026-001'
      ctx1.shiftStore.notes = 'Shift Pagi Kasir Utama'
      const openedAt = ctx1.shiftStore.openedAt

      // Catat saldo awal kas
      ctx1.cashStore.recordOpeningBalance(250000, shiftId)
      expect(ctx1.cashStore.balance).toBe(250000)

      await ctx1.service.flush()
      await ctx1.service.close()

      // RESTART APLIKASI saat shift masih buka
      const nextPinia = createPinia()
      setActivePinia(nextPinia)
      const ctx2 = createQAContext(adapter)
      await ctx2.service.initialize()

      // Verifikasi seluruh properti shift terbuka tetap utuh
      expect(ctx2.shiftStore.isOpen).toBe(true)
      expect(ctx2.shiftStore.id).toBe(shiftId)
      expect(ctx2.shiftStore.shiftNumber).toBe('SHIFT-2026-001')
      expect(ctx2.shiftStore.status).toBe('open')
      expect(ctx2.shiftStore.openingBalance).toBe(250000)
      expect(ctx2.shiftStore.closingBalance).toBeNull()
      expect(ctx2.shiftStore.openedAt).toBe(openedAt)
      expect(ctx2.shiftStore.closedAt).toBeNull()
      expect(ctx2.shiftStore.notes).toBe('Shift Pagi Kasir Utama')

      // Verifikasi tidak ada duplikasi saldo awal kas
      expect(ctx2.cashStore.entries).toHaveLength(1)
      expect(ctx2.cashStore.balance).toBe(250000)

      // Menjalankan recordOpeningBalance ulang dengan referenceId sama bersifat idempoten
      const dupOpen = ctx2.cashStore.recordOpeningBalance(250000, shiftId)
      expect(dupOpen.duplicated).toBe(true)
      expect(ctx2.cashStore.entries).toHaveLength(1)
      expect(ctx2.cashStore.balance).toBe(250000)

      // Membuka shift baru saat masih buka harus ditolak
      expect(ctx2.shiftStore.openShift(100000)).toBe(false)

      await ctx2.service.close()
    })

    it('memulihkan shift yang sudah ditutup (closingBalance, closedAt, status closed) secara presisi setelah restart', async () => {
      const adapter = createMemoryAdapter()
      const ctx1 = createQAContext(adapter)
      await ctx1.service.initialize()

      const shiftId = ctx1.shiftStore.openShift(200000)
      ctx1.shiftStore.shiftNumber = 'SHIFT-2026-002'
      ctx1.shiftStore.notes = 'Shift Siang'
      const openedAt = ctx1.shiftStore.openedAt
      ctx1.cashStore.recordOpeningBalance(200000, shiftId)

      // Tutup shift
      ctx1.shiftStore.closingBalance = 350000
      ctx1.shiftStore.closeShift()
      ctx1.shiftStore.notes = 'Shift Siang selesai tepat waktu'
      const closedAt = ctx1.shiftStore.closedAt

      expect(ctx1.shiftStore.isOpen).toBe(false)
      expect(ctx1.shiftStore.status).toBe('closed')

      await ctx1.service.flush()
      await ctx1.service.close()

      // RESTART APLIKASI setelah shift ditutup
      const nextPinia = createPinia()
      setActivePinia(nextPinia)
      const ctx2 = createQAContext(adapter)
      await ctx2.service.initialize()

      // Verifikasi status closed dan metadata penutupan tersimpan
      expect(ctx2.shiftStore.isOpen).toBe(false)
      expect(ctx2.shiftStore.id).toBe(shiftId)
      expect(ctx2.shiftStore.shiftNumber).toBe('SHIFT-2026-002')
      expect(ctx2.shiftStore.status).toBe('closed')
      expect(ctx2.shiftStore.openingBalance).toBe(200000)
      expect(ctx2.shiftStore.closingBalance).toBe(350000)
      expect(ctx2.shiftStore.openedAt).toBe(openedAt)
      expect(ctx2.shiftStore.closedAt).toBe(closedAt)
      expect(ctx2.shiftStore.notes).toBe('Shift Siang selesai tepat waktu')

      await ctx2.service.close()
    })
  })

  describe('3. PENGUJIAN TRANSAKSI SEBENARNYA DENGAN LOCAL OPERATION SERVICE', () => {
    it('commitRetailSale memproses transaksi durabel dan tidak menggandakan stok/kas/transaksi setelah restart', async () => {
      const adapter = createMemoryAdapter()
      const ctx1 = createQAContext(adapter)
      await ctx1.service.initialize()

      const initialTrxCount = ctx1.transactionStore.items.length

      const prod = ctx1.productStore.createProduct({
        name: 'Gula Aren Organik',
        category: ctx1.productStore.categories[0],
        cost: 15000,
        price: 25000,
        stock: 2, // Stok awal 2
        unit: 'pouch',
        isActive: true,
      }).product

      // Buka shift
      const shiftId = ctx1.shiftStore.openShift(100000)
      ctx1.cashStore.recordOpeningBalance(100000, shiftId)

      // Siapkan keranjang: beli 5 unit (sehingga stok menjadi 2 - 5 = -3)
      ctx1.cartStore.addItem(prod)
      ctx1.cartStore.updateQty(prod.id, 5)

      expect(ctx1.cartStore.items[0].qty).toBe(5)
      expect(ctx1.cartStore.subtotal).toBe(125000)

      // Jalankan transaksi melalui localOperationService sebenarnya
      const committedTrx = await ctx1.localOperations.commitRetailSale({
        checkout: {
          items: ctx1.cartStore.items,
          subtotal: ctx1.cartStore.subtotal,
          tax: 0,
          taxEnabled: false,
          taxRate: null,
          total: 125000,
          businessSnapshot: {
            name: ctx1.businessStore.name,
            outlet: ctx1.businessStore.outlet,
            phone: ctx1.businessStore.phone,
          },
          customer: 'Pelanggan Setia',
          customerId: null,
          customerSnapshot: null,
          paymentMethod: 'cash',
          cashReceived: 150000,
          changeAmount: 25000,
        },
      })

      expect(committedTrx).toBeTruthy()
      expect(committedTrx.id).toBeTruthy()

      // Stok berkurang dari 2 menjadi -3
      expect(ctx1.productStore.getProductById(prod.id).stock).toBe(-3)
      expect(ctx1.productStore.stockMovements).toHaveLength(1)
      expect(ctx1.productStore.stockMovements[0]).toMatchObject({
        productId: prod.id,
        quantityChange: -5,
        stockBefore: 2,
        stockAfter: -3,
        type: 'sale',
      })

      // Kas bertambah dari 100.000 + 125.000 = 225.000
      expect(ctx1.cashStore.balance).toBe(225000)
      expect(ctx1.transactionStore.items).toHaveLength(initialTrxCount + 1)

      await ctx1.service.flush()
      await ctx1.service.close()

      // RESTART APLIKASI
      const nextPinia = createPinia()
      setActivePinia(nextPinia)
      const ctx2 = createQAContext(adapter)
      await ctx2.service.initialize()
      await ctx2.localOperations.recoverPendingOperations()

      // Verifikasi TIDAK ADA DUPLIKASI SETELAH RESTART:
      // 1. Transaksi tidak bertambah lagi
      expect(ctx2.transactionStore.items).toHaveLength(initialTrxCount + 1)
      expect(ctx2.transactionStore.items.some((t) => t.id === committedTrx.id)).toBe(true)

      // 2. Stok tetap -3 (TIDAK terpotong lagi menjadi -8)
      expect(ctx2.productStore.getProductById(prod.id).stock).toBe(-3)

      // 3. Stock movements tetap 1 (TIDAK terduplikasi)
      expect(ctx2.productStore.stockMovements).toHaveLength(1)

      // 4. Cash ledger tetap 2 entri (opening balance + sale) dan saldo tetap 225000
      expect(ctx2.cashStore.entries).toHaveLength(2)
      expect(ctx2.cashStore.balance).toBe(225000)

      await ctx2.service.close()
    })
  })

  describe('4. PENGUJIAN MODE FREE OFFLINE', () => {
    it('menjalankan seluruh operasional POS tanpa koneksi cloud, login, atau bearer token', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch')
      const ctx = createQAContext()
      await ctx.service.initialize()

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

      ctx.cashierStore.setPinConfigured(true)
      expect(ctx.cashierStore.activeCashier.pinConfigured).toBe(true)

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

      const shiftId = ctx.shiftStore.openShift(100000)
      expect(shiftId).toBeTruthy()
      expect(ctx.shiftStore.isOpen).toBe(true)
      ctx.cashStore.recordOpeningBalance(100000, shiftId)
      expect(ctx.cashStore.balance).toBe(100000)

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

      expect(ctx.productStore.getProductById(productId).stock).toBe(49)
      expect(ctx.cashStore.balance).toBe(100000 + total)

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

      ctx.shiftStore.closeShift()
      expect(ctx.shiftStore.isOpen).toBe(false)
      expect(ctx.shiftStore.status).toBe('closed')

      expect(ctx.transactionStore.items.length).toBeGreaterThanOrEqual(1)
      expect(ctx.transactionStore.items[0].id).toBe(trx.id)

      expect(fetchSpy).not.toHaveBeenCalled()
    })
  })

  describe('5. TRANSAKSI OFFLINE & SNAPSHOT INTEGRITY', () => {
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

      ctx.cartStore.addItem(product)
      ctx.cartStore.updateQty(product.id, 3)

      expect(ctx.cartStore.items[0].qty).toBe(3)
      expect(ctx.cartStore.items[0].price).toBe(18000)
      expect(ctx.cartStore.items[0].hppSnapshot).toBe(7000)

      const subtotal = 18000 * 3
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

      expect(trx.grossProfit).toBe(33000)
      expect(trx.items[0].hppSnapshot).toBe(7000)
      expect(trx.items[0].price).toBe(18000)
      expect(trx.items[0].lineCost).toBe(21000)
      expect(trx.items[0].lineSubtotal).toBe(54000)

      ctx.productStore.updateProduct(product.id, {
        ...ctx.productStore.getProductById(product.id),
        price: 25000,
        cost: 12000,
      })

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
      ctx.cartStore.updateQty(coffee.id, 2)
      ctx.cartStore.addItem(food)
      ctx.cartStore.updateQty(food.id, 1)

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

      ctx.cartStore.addItem(kiloanService)
      ctx.cartStore.updateQty(kiloanService.id, 2.5)
      ctx.cartStore.addItem(satuanService)
      ctx.cartStore.updateQty(satuanService.id, 1)

      expect(ctx.cartStore.items[0].qty).toBe(2.5)
      expect(ctx.cartStore.subtotal).toBe(60000)

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
      expect(laundryOrder.grossProfit).toBe((25000 - (4000 * 2.5)) + (35000 - 15000))

      expect(ctx.cashStore.entries).toHaveLength(0)

      expect(ctx.transactionStore.advanceOrderStatus(laundryOrder.id)).toBe(true)
      expect(laundryOrder.orderStatus).toBe('Diproses')

      expect(ctx.transactionStore.advanceOrderStatus(laundryOrder.id)).toBe(true)
      expect(laundryOrder.orderStatus).toBe('Siap Diambil')

      expect(ctx.transactionStore.advanceOrderStatus(laundryOrder.id)).toBe(true)
      expect(laundryOrder.orderStatus).toBe('Selesai')

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

      const item1 = ctx.productStore.createProduct({
        name: 'Minyak Goreng 2L',
        category: 'Sembako',
        sku: 'MYK-2L',
        cost: 28000,
        price: 33000,
        stock: 24,
        minStock: 6,
        unit: 'pouch',
        isActive: true,
      }).product

      const item2 = ctx.productStore.createProduct({
        name: 'Terigu Segitiga 1kg',
        category: 'Sembako',
        sku: 'TRG-1K',
        cost: 10500,
        price: 13000,
        stock: 30,
        minStock: 5,
        unit: 'pack',
        isActive: true,
      }).product

      ctx.cartStore.addItem(item1)
      ctx.cartStore.updateQty(item1.id, 4)
      ctx.cartStore.addItem(item2)
      ctx.cartStore.updateQty(item2.id, 5)

      const subtotal = (33000 * 4) + (13000 * 5)
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

      ctx.productStore.updateProduct(item1.id, {
        ...ctx.productStore.getProductById(item1.id),
        price: 35000,
      })
      expect(ctx.productStore.getProductById(item1.id).price).toBe(35000)
      expect(trx.items.find((i) => i.id === item1.id).price).toBe(33000)
    })
  })

  describe('7. KAS DAN SHIFT', () => {
    it('mengelola siklus shift lengkap, mutasi kas, pengeluaran, serta mencegah duplikasi ledger', async () => {
      const ctx = createQAContext()
      await ctx.service.initialize()

      const shiftId = ctx.shiftStore.openShift(150000)
      expect(shiftId).toBeTruthy()
      expect(ctx.shiftStore.isOpen).toBe(true)
      expect(ctx.shiftStore.status).toBe('open')
      expect(ctx.shiftStore.openingBalance).toBe(150000)

      ctx.cashStore.recordOpeningBalance(150000, shiftId)
      expect(ctx.cashStore.balance).toBe(150000)

      const dupOpen = ctx.cashStore.recordOpeningBalance(150000, shiftId)
      expect(dupOpen.duplicated).toBe(true)
      expect(ctx.cashStore.balance).toBe(150000)

      const cashTrx = ctx.transactionStore.createTransaction({
        items: [{ id: 'p1', name: 'Barang A', price: 50000, qty: 1 }],
        subtotal: 50000,
        tax: 0,
        total: 50000,
        paymentMethod: 'cash',
      })
      ctx.cashStore.recordSalePayment(cashTrx)
      expect(ctx.cashStore.balance).toBe(200000)

      const dupSale = ctx.cashStore.recordSalePayment(cashTrx)
      expect(dupSale.duplicated).toBe(true)
      expect(ctx.cashStore.balance).toBe(200000)

      const qrisTrx = ctx.transactionStore.createTransaction({
        items: [{ id: 'p2', name: 'Barang B', price: 75000, qty: 1 }],
        subtotal: 75000,
        tax: 0,
        total: 75000,
        paymentMethod: 'qris',
      })
      const qrisRes = ctx.cashStore.recordSalePayment(qrisTrx)
      expect(qrisRes.skipped).toBe(true)
      expect(ctx.cashStore.balance).toBe(200000)

      ctx.cashStore.recordEntry({
        type: 'in',
        amount: 25000,
        category: 'Kas Masuk',
        note: 'Tambah uang kembalian pecahan kecil',
      })
      expect(ctx.cashStore.balance).toBe(225000)

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

      ctx.shiftStore.closeShift()
      expect(ctx.shiftStore.isOpen).toBe(false)
      expect(ctx.shiftStore.status).toBe('closed')
      expect(ctx.shiftStore.closedAt).toBeTruthy()

      expect(ctx.cashStore.cashIn).toBe(150000 + 50000 + 25000)
      expect(ctx.cashStore.cashOut).toBe(20000)
      expect(ctx.cashStore.balance).toBe(205000)
    })
  })

  describe('8. DESERIALISASI SQLITE NATIVE & BACKUP RESTORE', () => {
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

      const trx1 = ctx.transactionStore.createTransaction({
        items: [{ id: prod.id, name: prod.name, price: 20000, hppSnapshot: 15000, qty: 2 }],
        subtotal: 40000,
        tax: 4400,
        taxEnabled: true,
        taxRate: 11,
        total: 44400,
        paymentMethod: 'cash',
      })

      const trx2 = ctx.transactionStore.createTransaction({
        items: [{ id: prod.id, name: prod.name, price: 20000, hppSnapshot: 15000, qty: 1 }],
        subtotal: 20000,
        tax: 0,
        taxEnabled: false,
        taxRate: null,
        total: 20000,
        paymentMethod: 'qris',
      })

      const backup = createBackupPayload(ctx)
      expect(backup.schema).toBe('pos-mobile-backup')
      expect(backup.version).toBe(2)
      expect(backup.data.transactions.some((t) => t.id === trx1.id)).toBe(true)
      expect(backup.data.transactions.some((t) => t.id === trx2.id)).toBe(true)

      const val = validateBackupPayload(backup)
      expect(val.valid).toBe(true)
      expect(val.error).toBe('')

      ctx.shiftStore.openShift(50000)
      const openShiftRestore = restoreBackupPayload(backup, ctx)
      expect(openShiftRestore.success).toBe(false)
      expect(openShiftRestore.error).toContain('Tutup shift terlebih dahulu')

      ctx.shiftStore.closeShift()
      const validRestore = restoreBackupPayload(backup, ctx)
      expect(validRestore.success).toBe(true)

      expect(ctx.businessStore.name).toBe('Toko Kelontong Bersama')
      expect(ctx.transactionStore.items.some((t) => t.id === trx1.id && t.taxRate === 11)).toBe(true)
      expect(ctx.transactionStore.items.some((t) => t.id === trx2.id && t.taxRate === null)).toBe(true)
      expect(ctx.productStore.getProductById(prod.id)).toBeTruthy()
    })
  })

  describe('9. BATASAN SINKRONISASI OFFLINE', () => {
    it('operasi offline dalam mode Free tidak memicu sync cloud dan tidak menunggu server', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch')
      const ctx = createQAContext()
      await ctx.service.initialize()

      ctx.businessStore.setBusiness({
        name: 'Offline Only Store',
        type: 'Cafe / UMKM',
        mode: 'free',
      })

      const trx = ctx.transactionStore.createTransaction({
        items: [{ id: 'item-1', name: 'Es Teh', price: 5000, qty: 2 }],
        subtotal: 10000,
        tax: 0,
        total: 10000,
        paymentMethod: 'cash',
      })

      expect(trx.id).toBeTruthy()
      expect(fetchSpy).not.toHaveBeenCalled()
    })
  })
})
