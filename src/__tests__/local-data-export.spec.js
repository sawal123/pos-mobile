import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createAppRouter } from '@/router'
import {
  EXPORT_PERIODS,
  EXPORT_SCOPES,
  buildExportDataset,
  createExcelWorkbookBytes,
  createPdfDocumentBytes,
  validatePeriodOptions,
} from '@/services/dataExportService'
import { useBusinessStore } from '@/stores/businessStore'
import { useCashStore } from '@/stores/cashStore'
import { useCashierStore } from '@/stores/cashierStore'
import { useCustomerStore } from '@/stores/customerStore'
import { useExpenseStore } from '@/stores/expenseStore'
import { useProductStore } from '@/stores/productStore'
import { useShiftStore } from '@/stores/shiftStore'
import { useTransactionStore } from '@/stores/transactionStore'
import SettingsView from '@/views/settings/SettingsView.vue'

function setupFreeStoreContext() {
  const pinia = createPinia()
  setActivePinia(pinia)
  const router = createAppRouter()

  const businessStore = useBusinessStore()
  const cashierStore = useCashierStore()
  const shiftStore = useShiftStore()
  const productStore = useProductStore()
  const customerStore = useCustomerStore()
  const transactionStore = useTransactionStore()
  const cashStore = useCashStore()
  const expenseStore = useExpenseStore()

  businessStore.setBusiness({
    name: 'Warkop Nusantara',
    type: 'Cafe / UMKM',
    owner: 'Sawal',
    phone: '081234567890',
    outlet: 'Cabang Pusat',
    mode: 'free',
  })
  cashierStore.setPinConfigured(true)
  shiftStore.openShift(100000)

  productStore.products = [
    {
      id: 'm-1',
      name: 'Kopi Susu Gula Aren',
      category: 'Minuman',
      kind: 'product',
      isSellable: true,
      isActive: true,
      sku: 'KSG-01',
      price: 18000,
      cost: 8000,
      stock: 25,
      minStock: 5,
      unit: 'cup',
    },
    {
      id: 's-1',
      name: 'Biji Kopi Arabika Mentah',
      category: 'Bahan Baku',
      kind: 'product',
      isSellable: false,
      isActive: true,
      sku: 'BKA-01',
      price: 0,
      cost: 120000,
      stock: 3,
      minStock: 5,
      unit: 'kg',
    },
    {
      id: 'srv-1',
      name: 'Jasa Seduh Manual',
      category: 'Layanan',
      kind: 'service',
      isSellable: true,
      isActive: true,
      price: 10000,
      cost: 0,
      stock: 0,
      minStock: 0,
      unit: 'kali',
    },
  ]
  productStore.categories = ['Minuman', 'Bahan Baku', 'Layanan']

  customerStore.customers = [
    { id: 'c-1', name: 'Rina Putri', phone: '08111222333', email: 'rina@mail.com' },
  ]

  const todayIso = '2026-11-07T09:30:00.000Z'
  const oldIso = '2026-09-15T10:00:00.000Z'

  transactionStore.items = [
    {
      id: 'tx-today',
      invoiceNumber: 'INV-TODAY-001',
      customer: 'Rina Putri',
      paymentMethod: 'cash',
      paymentStatus: 'paid',
      status: 'paid',
      subtotal: 36000,
      tax: 0,
      total: 36000,
      grossProfit: 20000,
      paidAt: todayIso,
      createdAt: todayIso,
      items: [
        {
          id: 'm-1',
          name: 'Kopi Susu Gula Aren',
          variant_summary: 'Less Sugar',
          qty: 2,
          unit: 'cup',
          price: 18000,
          hppSnapshot: 8000,
          subtotal: 36000,
        },
      ],
    },
    {
      id: 'tx-old',
      invoiceNumber: 'INV-OLD-999',
      customer: 'Walk-in Customer',
      paymentMethod: 'qris',
      paymentStatus: 'paid',
      status: 'paid',
      subtotal: 18000,
      tax: 0,
      total: 18000,
      grossProfit: 10000,
      paidAt: oldIso,
      createdAt: oldIso,
      items: [
        {
          id: 'm-1',
          name: 'Kopi Susu Gula Aren',
          qty: 1,
          unit: 'cup',
          price: 18000,
          hppSnapshot: 8000,
          subtotal: 18000,
        },
      ],
    },
  ]

  cashStore.entries = [
    {
      id: 'cash-1',
      type: 'in',
      amount: 100000,
      category: 'Saldo Awal',
      note: 'Modal laci pagi',
      createdAt: todayIso,
    },
    {
      id: 'cash-old',
      type: 'out',
      amount: 25000,
      category: 'Kas Keluar',
      note: 'Beli es batu bulan lalu',
      createdAt: oldIso,
    },
  ]

  expenseStore.expenses = [
    {
      id: 'exp-1',
      title: 'Beli Cup Plastik',
      category: 'Operasional',
      amount: 45000,
      note: '100 pcs cup',
      createdAt: todayIso,
    },
  ]

  return {
    pinia,
    router,
    stores: {
      businessStore,
      productStore,
      customerStore,
      transactionStore,
      cashStore,
      expenseStore,
    },
  }
}

describe('dataExportService — Dataset, Excel (.xlsx), and PDF (.pdf)', () => {
  const fixedNow = new Date('2026-11-07T11:00:00.000Z')

  it('separates Master Data vs Sales & Cash Data and applies date period filter accurately', () => {
    const { stores } = setupFreeStoreContext()

    // 1. Master only
    const masterDataset = buildExportDataset(stores, {
      scope: EXPORT_SCOPES.MASTER,
      now: fixedNow,
    })
    expect(masterDataset.counts.menus).toBe(2) // Kopi Susu + Jasa Seduh (excludes raw stock Biji Kopi)
    expect(masterDataset.counts.stock).toBe(2) // Kopi Susu + Biji Kopi (excludes service Jasa Seduh)
    expect(masterDataset.counts.customers).toBe(1)
    expect(masterDataset.counts.transactions).toBe(0)
    expect(masterDataset.sections.map((s) => s.key)).toEqual(['menus', 'stock', 'customers'])

    // 2. Sales & Cash filtered to TODAY
    const todaySalesDataset = buildExportDataset(stores, {
      scope: EXPORT_SCOPES.SALES,
      period: EXPORT_PERIODS.TODAY,
      now: fixedNow,
    })
    expect(todaySalesDataset.counts.menus).toBe(0)
    expect(todaySalesDataset.counts.transactions).toBe(1)
    expect(todaySalesDataset.counts.cashEntries).toBe(1)
    expect(todaySalesDataset.counts.expenses).toBe(1)
    expect(todaySalesDataset.sections.map((s) => s.key)).toEqual([
      'transactions',
      'sold_items',
      'cash',
      'expenses',
    ])

    // 3. Sales & Cash ALL TIME includes old September transaction & cash entry
    const allSalesDataset = buildExportDataset(stores, {
      scope: EXPORT_SCOPES.SALES,
      period: EXPORT_PERIODS.ALL_TIME,
      now: fixedNow,
    })
    expect(allSalesDataset.counts.transactions).toBe(2)
    expect(allSalesDataset.counts.cashEntries).toBe(2)

    // 4. Custom date validation
    expect(
      validatePeriodOptions({
        scope: EXPORT_SCOPES.SALES,
        period: EXPORT_PERIODS.CUSTOM,
        startDate: '2026-11-10',
        endDate: '2026-11-01',
      }).valid,
    ).toBe(false)
  })

  it('generates a valid OpenXML .xlsx ZIP workbook with multiple sheets', () => {
    const { stores } = setupFreeStoreContext()
    const dataset = buildExportDataset(stores, {
      scope: EXPORT_SCOPES.ALL,
      period: EXPORT_PERIODS.ALL_TIME,
      now: fixedNow,
    })

    const xlsxBytes = createExcelWorkbookBytes(dataset)
    expect(xlsxBytes).toBeInstanceOf(Uint8Array)
    // PK\x03\x04 local header magic bytes
    expect(xlsxBytes[0]).toBe(0x50)
    expect(xlsxBytes[1]).toBe(0x4b)
    expect(xlsxBytes[2]).toBe(0x03)
    expect(xlsxBytes[3]).toBe(0x04)

    const rawText = new TextDecoder().decode(xlsxBytes)
    expect(rawText).toContain('[Content_Types].xml')
    expect(rawText).toContain('xl/workbook.xml')
    expect(rawText).toContain('Ringkasan')
    expect(rawText).toContain('Menu dan Layanan')
    expect(rawText).toContain('Persediaan Stok')
    expect(rawText).toContain('Penjualan')
    expect(rawText).toContain('Arus Kas')
    expect(rawText).toContain('Kopi Susu Gula Aren')
    expect(rawText).toContain('INV-TODAY-001')
  })

  it('generates a valid multi-page %PDF-1.4 document', () => {
    const { stores } = setupFreeStoreContext()
    // Add 45 extra transactions to force multi-page pagination
    for (let i = 1; i <= 45; i++) {
      stores.transactionStore.items.push({
        id: `tx-bulk-${i}`,
        invoiceNumber: `INV-BULK-${i}`,
        customer: `Pelanggan ${i}`,
        paymentMethod: 'cash',
        paymentStatus: 'paid',
        status: 'paid',
        total: 15000,
        grossProfit: 7000,
        paidAt: '2026-11-07T08:00:00.000Z',
        createdAt: '2026-11-07T08:00:00.000Z',
        items: [],
      })
    }

    const dataset = buildExportDataset(stores, {
      scope: EXPORT_SCOPES.ALL,
      period: EXPORT_PERIODS.TODAY,
      now: fixedNow,
    })

    const pdfBytes = createPdfDocumentBytes(dataset)
    const pdfText = new TextDecoder('latin1').decode(pdfBytes)

    expect(pdfText.startsWith('%PDF-1.4')).toBe(true)
    expect(pdfText.trimEnd().endsWith('%%EOF')).toBe(true)
    expect(pdfText).toContain('WARKOP NUSANTARA')
    expect(pdfText).toContain('INV-TODAY-001')
    expect(pdfText).toContain('Halaman 1 dari ')
    expect(pdfText).toContain('Halaman 2 dari ')
  })
})

describe('SettingsView — Free User Backup & Export (Excel, PDF, and System JSON)', () => {
  let createObjectURLSpy
  let revokeObjectURLSpy
  let anchorClickSpy
  let downloadedFiles

  beforeEach(() => {
    downloadedFiles = []
    createObjectURLSpy = vi
      .spyOn(URL, 'createObjectURL')
      .mockImplementation((blob) => {
        downloadedFiles.push({ blob, type: blob?.type, size: blob?.size })
        return 'blob:pos-export-test'
      })
    revokeObjectURLSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    anchorClickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(function () {
        if (downloadedFiles.length > 0) {
          downloadedFiles[downloadedFiles.length - 1].download = this.download
        }
      })
  })

  afterEach(() => {
    createObjectURLSpy.mockRestore()
    revokeObjectURLSpy.mockRestore()
    anchorClickSpy.mockRestore()
  })

  it('allows Free unauthenticated user to choose scope, filter period, and download Excel, PDF, and JSON backup', async () => {
    const { pinia, router } = setupFreeStoreContext()
    await router.push({ name: 'settings', query: { section: 'data' } })
    await flushPromises()

    const wrapper = mount(SettingsView, {
      attachTo: document.body,
      global: { plugins: [pinia, router] },
    })
    await flushPromises()

    const panel = wrapper.find('[data-testid="local-export-panel"]')
    expect(panel.exists()).toBe(true)
    expect(panel.isVisible()).toBe(true)

    // 1. Switch to Data Master -> period filter hides, Download Excel (.xlsx)
    await wrapper.find('[data-testid="export-scope-master"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-testid="export-period-filter"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="export-preview-summary"]').text()).toContain('2 Menu')

    await wrapper.find('[data-testid="btn-export-excel"]').trigger('click')
    await flushPromises()

    expect(downloadedFiles).toHaveLength(1)
    expect(downloadedFiles[0].download).toMatch(/^nexapos-warkop-nusantara-data-master-.*\.xlsx$/)
    expect(wrapper.find('[data-testid="local-export-feedback"]').text()).toContain('.xlsx')

    // 2. Switch to Data Penjualan & Kas -> period filter shows, test Custom Date & Download PDF (.pdf)
    await wrapper.find('[data-testid="export-scope-sales"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-testid="export-period-filter"]').exists()).toBe(true)

    await wrapper.find('[data-testid="export-period-custom"]').trigger('click')
    await flushPromises()
    await wrapper.find('[data-testid="export-start-date"]').setValue('2026-09-01')
    await wrapper.find('[data-testid="export-end-date"]').setValue('2026-09-30')
    await flushPromises()

    expect(wrapper.find('[data-testid="export-preview-summary"]').text()).toContain('1 Transaksi')

    await wrapper.find('[data-testid="btn-export-pdf"]').trigger('click')
    await flushPromises()

    expect(downloadedFiles).toHaveLength(2)
    expect(downloadedFiles[1].download).toMatch(/^nexapos-warkop-nusantara-penjualan-kas-.*\.pdf$/)
    expect(wrapper.find('[data-testid="local-export-feedback"]').text()).toContain('.pdf')

    // 3. System Backup (.json) for Restore still works alongside Excel/PDF
    await wrapper.find('[data-testid="local-backup-now"]').trigger('click')
    await flushPromises()

    expect(downloadedFiles).toHaveLength(3)
    expect(downloadedFiles[2].download).toMatch(/^pos-mobile-backup-.*\.json$/)

    wrapper.unmount()
  })
})

