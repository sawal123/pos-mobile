import { Capacitor } from '@capacitor/core'

import { downloadBackupFile } from '@/services/backupService'
import { isPaidTransaction } from '@/stores/transactionStore'

export const EXPORT_SCOPES = Object.freeze({
  ALL: 'all',
  MASTER: 'master',
  SALES: 'sales',
})

export const EXPORT_PERIODS = Object.freeze({
  TODAY: 'today',
  SEVEN_DAYS: '7days',
  MONTH: 'month',
  ALL_TIME: 'all',
  CUSTOM: 'custom',
})

export const EXPORT_FORMATS = Object.freeze({
  EXCEL: 'excel',
  PDF: 'pdf',
})

const XLSX_MIME_TYPE =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
const PDF_MIME_TYPE = 'application/pdf'
const JSON_MIME_TYPE = 'application/json'

// ── Formatting & Date Utilities ──────────────────────────────────────────────

function formatRupiahText(value) {
  const numeric = Number(value) || 0
  return `Rp ${Math.round(numeric).toLocaleString('id-ID')}`
}

function formatDateTimeId(dateInput) {
  if (!dateInput) return '-'
  const date = dateInput instanceof Date ? dateInput : new Date(dateInput)
  if (Number.isNaN(date.getTime())) return '-'
  return date.toLocaleString('id-ID', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function formatDateOnlyId(ymdString) {
  if (!ymdString || typeof ymdString !== 'string') return '-'
  const parts = ymdString.split('-').map(Number)
  if (parts.length !== 3 || parts.some((n) => Number.isNaN(n))) return ymdString
  const date = new Date(parts[0], parts[1] - 1, parts[2])
  if (Number.isNaN(date.getTime())) return ymdString
  return date.toLocaleDateString('id-ID', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

function formatFileTimestamp(now = new Date()) {
  const pad = (n) => String(n).padStart(2, '0')
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
}

function slugifyFilePart(text, fallback = 'pos') {
  const cleaned = String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32)
  return cleaned || fallback
}

function parseLocalDayBounds(ymd, endOfDay = false) {
  if (!ymd || typeof ymd !== 'string') return null
  const parts = ymd.trim().split('-').map(Number)
  if (parts.length !== 3 || parts.some((n) => Number.isNaN(n))) return null
  const [year, month, day] = parts
  return endOfDay
    ? new Date(year, month - 1, day, 23, 59, 59, 999)
    : new Date(year, month - 1, day, 0, 0, 0, 0)
}

export function validatePeriodOptions({
  scope = EXPORT_SCOPES.ALL,
  period = EXPORT_PERIODS.ALL_TIME,
  startDate = '',
  endDate = '',
} = {}) {
  if (scope === EXPORT_SCOPES.MASTER) {
    return { valid: true, error: '' }
  }

  if (period !== EXPORT_PERIODS.CUSTOM) {
    return { valid: true, error: '' }
  }

  const start = parseLocalDayBounds(startDate, false)
  const end = parseLocalDayBounds(endDate, true)

  if (!start && !end) {
    return {
      valid: false,
      error: 'Silakan pilih tanggal mulai atau tanggal akhir terlebih dahulu.',
    }
  }

  if (start && end && start.getTime() > end.getTime()) {
    return {
      valid: false,
      error: 'Tanggal mulai tidak boleh melebihi tanggal akhir.',
    }
  }

  return { valid: true, error: '' }
}

export function matchesExportPeriod(
  dateString,
  {
    period = EXPORT_PERIODS.ALL_TIME,
    startDate = '',
    endDate = '',
    now = new Date(),
  } = {},
) {
  if (period === EXPORT_PERIODS.ALL_TIME) return true
  if (!dateString) return false

  const date = new Date(dateString)
  if (Number.isNaN(date.getTime())) return false

  if (period === EXPORT_PERIODS.TODAY) {
    return (
      date.getFullYear() === now.getFullYear() &&
      date.getMonth() === now.getMonth() &&
      date.getDate() === now.getDate()
    )
  }

  if (period === EXPORT_PERIODS.SEVEN_DAYS) {
    const startOfWindow = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() - 6,
      0,
      0,
      0,
      0,
    )
    const endOfWindow = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
      23,
      59,
      59,
      999,
    )
    const ts = date.getTime()
    return ts >= startOfWindow.getTime() && ts <= endOfWindow.getTime()
  }

  if (period === EXPORT_PERIODS.MONTH) {
    return (
      date.getFullYear() === now.getFullYear() &&
      date.getMonth() === now.getMonth()
    )
  }

  if (period === EXPORT_PERIODS.CUSTOM) {
    const start = parseLocalDayBounds(startDate, false)
    const end = parseLocalDayBounds(endDate, true)
    const ts = date.getTime()
    if (start && ts < start.getTime()) return false
    if (end && ts > end.getTime()) return false
    return true
  }

  return true
}

export function resolveScopeLabel(scope) {
  switch (scope) {
    case EXPORT_SCOPES.MASTER:
      return 'Data Master (Menu, Stok, Kategori, Pelanggan)'
    case EXPORT_SCOPES.SALES:
      return 'Data Penjualan & Kas (Transaksi, Kas, Pengeluaran)'
    case EXPORT_SCOPES.ALL:
    default:
      return 'Semua Data (Data Master + Penjualan & Kas)'
  }
}

export function resolvePeriodLabel({
  scope = EXPORT_SCOPES.ALL,
  period = EXPORT_PERIODS.ALL_TIME,
  startDate = '',
  endDate = '',
} = {}) {
  if (scope === EXPORT_SCOPES.MASTER) {
    return 'Data Aktif Terkini'
  }

  switch (period) {
    case EXPORT_PERIODS.TODAY:
      return 'Hari Ini'
    case EXPORT_PERIODS.SEVEN_DAYS:
      return '7 Hari Terakhir'
    case EXPORT_PERIODS.MONTH:
      return 'Bulan Ini'
    case EXPORT_PERIODS.CUSTOM: {
      if (startDate && endDate) {
        return `${formatDateOnlyId(startDate)} s/d ${formatDateOnlyId(endDate)}`
      }
      if (startDate) return `Mulai ${formatDateOnlyId(startDate)}`
      if (endDate) return `Sampai ${formatDateOnlyId(endDate)}`
      return 'Rentang Tanggal Kustom'
    }
    case EXPORT_PERIODS.ALL_TIME:
    default:
      return 'Semua Waktu'
  }
}

function formatPaymentMethodLabel(method) {
  const normalized = String(method || '').trim().toLowerCase()
  if (!normalized) return '-'
  if (normalized === 'cash' || normalized === 'tunai') return 'Tunai'
  if (normalized === 'qris') return 'QRIS'
  if (normalized === 'transfer' || normalized === 'bank_transfer') return 'Transfer'
  if (normalized === 'debit' || normalized === 'card') return 'Kartu'
  return String(method)
}

// ── Dataset Builder ──────────────────────────────────────────────────────────

export function buildExportDataset(
  stores,
  {
    scope = EXPORT_SCOPES.ALL,
    period = EXPORT_PERIODS.ALL_TIME,
    startDate = '',
    endDate = '',
    now = new Date(),
  } = {},
) {
  const includeMaster = scope === EXPORT_SCOPES.ALL || scope === EXPORT_SCOPES.MASTER
  const includeSales = scope === EXPORT_SCOPES.ALL || scope === EXPORT_SCOPES.SALES

  const business = {
    name: stores.businessStore?.name || 'Usaha POS',
    outlet: stores.businessStore?.outlet || 'Outlet Utama',
    type: stores.businessStore?.normalizedType || stores.businessStore?.type || '-',
    owner: stores.businessStore?.owner || '-',
    phone: stores.businessStore?.phone || '-',
  }

  const allProducts = Array.isArray(stores.productStore?.products)
    ? stores.productStore.products
    : []
  const allCategories = Array.isArray(stores.productStore?.categories)
    ? stores.productStore.categories
    : []
  const allCustomers = Array.isArray(stores.customerStore?.customers)
    ? stores.customerStore.customers
    : []
  const allTransactions = Array.isArray(stores.transactionStore?.items)
    ? stores.transactionStore.items
    : []
  const allCashEntries = Array.isArray(stores.cashStore?.entries)
    ? stores.cashStore.entries
    : []
  const allExpenses = Array.isArray(stores.expenseStore?.expenses)
    ? stores.expenseStore.expenses
    : []

  // Master Data
  const sellableMenus = includeMaster
    ? allProducts.filter((item) => item.isSellable !== false)
    : []
  const stockItems = includeMaster
    ? allProducts.filter((item) => item.kind !== 'service')
    : []
  const categories = includeMaster ? allCategories : []
  const customers = includeMaster ? allCustomers : []

  // Sales & Cash Data (filtered by period)
  const periodOpts = { period, startDate, endDate, now }
  const filteredTransactions = includeSales
    ? [...allTransactions]
      .filter((tx) => matchesExportPeriod(tx.paidAt || tx.createdAt, periodOpts))
      .sort(
        (a, b) =>
          new Date(b.paidAt || b.createdAt || 0).getTime() -
          new Date(a.paidAt || a.createdAt || 0).getTime(),
      )
    : []

  const filteredCashEntries = includeSales
    ? [...allCashEntries]
      .filter((entry) => matchesExportPeriod(entry.createdAt, periodOpts))
      .sort(
        (a, b) =>
          new Date(b.createdAt || 0).getTime() -
          new Date(a.createdAt || 0).getTime(),
      )
    : []

  const filteredExpenses = includeSales
    ? [...allExpenses]
      .filter((exp) => matchesExportPeriod(exp.createdAt, periodOpts))
      .sort(
        (a, b) =>
          new Date(b.createdAt || 0).getTime() -
          new Date(a.createdAt || 0).getTime(),
      )
    : []

  const soldLineItems = []
  if (includeSales) {
    for (const tx of filteredTransactions) {
      const txItems = Array.isArray(tx.items) ? tx.items : []
      const txTime = formatDateTimeId(tx.paidAt || tx.createdAt)
      const invoice = tx.invoiceNumber || tx.orderNumber || String(tx.id || '-')
      const paid = isPaidTransaction(tx)
      for (const line of txItems) {
        const qty = Number(line.qty ?? line.quantity) || 0
        const price = Number(line.price ?? line.unitPrice) || 0
        const cost = Number(line.hppSnapshot ?? line.costSnapshot ?? line.cost) || 0
        const subtotal = line.subtotal != null ? Number(line.subtotal) : price * qty
        const profit = subtotal - cost * qty
        soldLineItems.push({
          timeText: txTime,
          invoiceNumber: invoice,
          paymentStatus: paid ? 'Lunas' : 'Belum Bayar',
          name: line.name || line.serviceName || '-',
          variant: line.variant_summary || line.variantSummary || '-',
          qty,
          unit: line.unit || line.pricingUnit || 'pcs',
          price,
          cost,
          subtotal,
          profit,
        })
      }
    }
  }

  // Metrics Calculation
  const paidTransactions = filteredTransactions.filter(isPaidTransaction)
  const totalRevenue = paidTransactions.reduce(
    (sum, tx) => sum + (Number(tx.total) || 0),
    0,
  )
  const totalGrossProfit = paidTransactions.reduce(
    (sum, tx) => sum + (Number(tx.grossProfit) || 0),
    0,
  )
  const totalCashIn = filteredCashEntries
    .filter((entry) => entry.type === 'in')
    .reduce((sum, entry) => sum + (Number(entry.amount) || 0), 0)
  const totalCashOut = filteredCashEntries
    .filter((entry) => entry.type === 'out')
    .reduce((sum, entry) => sum + (Number(entry.amount) || 0), 0)
  const totalExpenseAmount = filteredExpenses.reduce(
    (sum, exp) => sum + (Number(exp.amount) || 0),
    0,
  )
  const totalStockValue = stockItems.reduce(
    (sum, item) => sum + (Number(item.stock) || 0) * (Number(item.cost) || 0),
    0,
  )
  const lowStockCount = stockItems.filter(
    (item) => (Number(item.stock) || 0) <= (Number(item.minStock) || 0),
  ).length

  const summaryMetrics = []
  if (includeMaster) {
    summaryMetrics.push(
      { label: 'Total Menu & Layanan Dijual', value: sellableMenus.length, isCurrency: false },
      { label: 'Total Item Persediaan Stok', value: stockItems.length, isCurrency: false },
      { label: 'Item Stok Menipis / Habis', value: lowStockCount, isCurrency: false },
      { label: 'Estimasi Nilai Persediaan Stok', value: totalStockValue, isCurrency: true },
      { label: 'Total Kategori', value: categories.length, isCurrency: false },
      { label: 'Total Pelanggan Terdaftar', value: customers.length, isCurrency: false },
    )
  }
  if (includeSales) {
    summaryMetrics.push(
      { label: 'Total Transaksi', value: filteredTransactions.length, isCurrency: false },
      { label: 'Transaksi Lunas', value: paidTransactions.length, isCurrency: false },
      { label: 'Total Omzet Penjualan (Lunas)', value: totalRevenue, isCurrency: true },
      { label: 'Estimasi Laba Kotor (Lunas)', value: totalGrossProfit, isCurrency: true },
      { label: 'Total Kas Masuk', value: totalCashIn, isCurrency: true },
      { label: 'Total Kas Keluar', value: totalCashOut, isCurrency: true },
      { label: 'Selisih Arus Kas Periode', value: totalCashIn - totalCashOut, isCurrency: true },
      { label: 'Total Pengeluaran Operasional', value: totalExpenseAmount, isCurrency: true },
    )
  }

  // Structured Table Sections (shared by Excel & PDF)
  const sections = []

  if (includeMaster) {
    sections.push({
      key: 'menus',
      sheetName: 'Menu dan Layanan',
      title: 'Daftar Menu & Layanan yang Dijual',
      columns: [
        { header: 'No', width: 6, align: 'right', type: 'number' },
        { header: 'Nama Menu / Layanan', width: 28, align: 'left', type: 'string' },
        { header: 'Jenis', width: 12, align: 'left', type: 'string' },
        { header: 'Kategori', width: 18, align: 'left', type: 'string' },
        { header: 'SKU / Kode', width: 16, align: 'left', type: 'string' },
        { header: 'Harga Jual (Rp)', width: 16, align: 'right', type: 'number' },
        { header: 'HPP / Modal (Rp)', width: 16, align: 'right', type: 'number' },
        { header: 'Satuan', width: 10, align: 'left', type: 'string' },
        { header: 'Status', width: 12, align: 'left', type: 'string' },
      ],
      rows: sellableMenus.map((item, idx) => [
        idx + 1,
        item.name || '-',
        item.kind === 'service' ? 'Layanan/Jasa' : 'Produk',
        item.category || '-',
        item.sku || item.barcode || '-',
        Number(item.price ?? item.unitPrice) || 0,
        Number(item.cost) || 0,
        item.unit || item.pricingUnit || 'pcs',
        item.isActive === false ? 'Nonaktif' : 'Aktif',
      ]),
    })

    sections.push({
      key: 'stock',
      sheetName: 'Persediaan Stok',
      title: 'Daftar Persediaan Stok Barang',
      columns: [
        { header: 'No', width: 6, align: 'right', type: 'number' },
        { header: 'Nama Barang', width: 28, align: 'left', type: 'string' },
        { header: 'Tipe Item', width: 16, align: 'left', type: 'string' },
        { header: 'Kategori', width: 18, align: 'left', type: 'string' },
        { header: 'Stok Saat Ini', width: 14, align: 'right', type: 'number' },
        { header: 'Stok Minimum', width: 14, align: 'right', type: 'number' },
        { header: 'Satuan', width: 10, align: 'left', type: 'string' },
        { header: 'HPP Satuan (Rp)', width: 16, align: 'right', type: 'number' },
        { header: 'Nilai Stok (Rp)', width: 18, align: 'right', type: 'number' },
        { header: 'Kondisi', width: 12, align: 'left', type: 'string' },
      ],
      rows: stockItems.map((item, idx) => {
        const stock = Number(item.stock) || 0
        const minStock = Number(item.minStock) || 0
        const cost = Number(item.cost) || 0
        const statusLabel =
          stock <= 0 ? 'Habis' : stock <= minStock ? 'Menipis' : 'Aman'
        return [
          idx + 1,
          item.name || '-',
          item.isSellable === false ? 'Bahan / Stok' : 'Menu Dijual',
          item.category || '-',
          stock,
          minStock,
          item.unit || 'pcs',
          cost,
          stock * cost,
          statusLabel,
        ]
      }),
    })

    sections.push({
      key: 'customers',
      sheetName: 'Pelanggan',
      title: 'Daftar Pelanggan',
      columns: [
        { header: 'No', width: 6, align: 'right', type: 'number' },
        { header: 'Nama Pelanggan', width: 28, align: 'left', type: 'string' },
        { header: 'No. Telepon', width: 20, align: 'left', type: 'string' },
        { header: 'Email', width: 28, align: 'left', type: 'string' },
      ],
      rows: customers.map((cust, idx) => [
        idx + 1,
        cust.name || '-',
        cust.phone || '-',
        cust.email || '-',
      ]),
    })
  }

  if (includeSales) {
    sections.push({
      key: 'transactions',
      sheetName: 'Penjualan',
      title: 'Riwayat Transaksi Penjualan',
      columns: [
        { header: 'No', width: 6, align: 'right', type: 'number' },
        { header: 'Waktu Transaksi', width: 20, align: 'left', type: 'string' },
        { header: 'No. Invoice', width: 22, align: 'left', type: 'string' },
        { header: 'Pelanggan', width: 20, align: 'left', type: 'string' },
        { header: 'Metode Bayar', width: 14, align: 'left', type: 'string' },
        { header: 'Status', width: 13, align: 'left', type: 'string' },
        { header: 'Qty Item', width: 10, align: 'right', type: 'number' },
        { header: 'Pajak (Rp)', width: 14, align: 'right', type: 'number' },
        { header: 'Total (Rp)', width: 16, align: 'right', type: 'number' },
        { header: 'Laba Kotor (Rp)', width: 16, align: 'right', type: 'number' },
      ],
      rows: filteredTransactions.map((tx, idx) => {
        const items = Array.isArray(tx.items) ? tx.items : []
        const qtyCount = Number.isFinite(tx.itemCount)
          ? tx.itemCount
          : items.reduce((s, it) => s + (Number(it.qty ?? it.quantity) || 0), 0)
        return [
          idx + 1,
          formatDateTimeId(tx.paidAt || tx.createdAt),
          tx.invoiceNumber || tx.orderNumber || String(tx.id || '-'),
          tx.customerSnapshot?.name || tx.customer || 'Pelanggan Umum',
          formatPaymentMethodLabel(tx.paymentMethod),
          isPaidTransaction(tx) ? 'Lunas' : 'Belum Bayar',
          qtyCount,
          Number(tx.tax) || 0,
          Number(tx.total) || 0,
          Number(tx.grossProfit) || 0,
        ]
      }),
    })

    sections.push({
      key: 'sold_items',
      sheetName: 'Item Terjual',
      title: 'Rincian Item Menu / Layanan Terjual',
      columns: [
        { header: 'No', width: 6, align: 'right', type: 'number' },
        { header: 'Waktu', width: 20, align: 'left', type: 'string' },
        { header: 'No. Invoice', width: 22, align: 'left', type: 'string' },
        { header: 'Nama Item', width: 24, align: 'left', type: 'string' },
        { header: 'Varian', width: 20, align: 'left', type: 'string' },
        { header: 'Qty', width: 9, align: 'right', type: 'number' },
        { header: 'Satuan', width: 10, align: 'left', type: 'string' },
        { header: 'Harga (Rp)', width: 15, align: 'right', type: 'number' },
        { header: 'Subtotal (Rp)', width: 16, align: 'right', type: 'number' },
        { header: 'Laba Kotor (Rp)', width: 16, align: 'right', type: 'number' },
      ],
      rows: soldLineItems.map((line, idx) => [
        idx + 1,
        line.timeText,
        line.invoiceNumber,
        line.name,
        line.variant,
        line.qty,
        line.unit,
        line.price,
        line.subtotal,
        line.profit,
      ]),
    })

    sections.push({
      key: 'cash',
      sheetName: 'Arus Kas',
      title: 'Riwayat Arus Kas (Masuk & Keluar)',
      columns: [
        { header: 'No', width: 6, align: 'right', type: 'number' },
        { header: 'Waktu', width: 20, align: 'left', type: 'string' },
        { header: 'Tipe Kas', width: 14, align: 'left', type: 'string' },
        { header: 'Kategori', width: 20, align: 'left', type: 'string' },
        { header: 'Nominal (Rp)', width: 16, align: 'right', type: 'number' },
        { header: 'Keterangan', width: 30, align: 'left', type: 'string' },
      ],
      rows: filteredCashEntries.map((entry, idx) => [
        idx + 1,
        formatDateTimeId(entry.createdAt),
        entry.type === 'out' ? 'Kas Keluar' : 'Kas Masuk',
        entry.category || '-',
        Number(entry.amount) || 0,
        entry.note || '-',
      ]),
    })

    sections.push({
      key: 'expenses',
      sheetName: 'Pengeluaran',
      title: 'Riwayat Pengeluaran Operasional',
      columns: [
        { header: 'No', width: 6, align: 'right', type: 'number' },
        { header: 'Waktu', width: 20, align: 'left', type: 'string' },
        { header: 'Judul Pengeluaran', width: 26, align: 'left', type: 'string' },
        { header: 'Kategori', width: 18, align: 'left', type: 'string' },
        { header: 'Nominal (Rp)', width: 16, align: 'right', type: 'number' },
        { header: 'Catatan', width: 28, align: 'left', type: 'string' },
      ],
      rows: filteredExpenses.map((exp, idx) => [
        idx + 1,
        formatDateTimeId(exp.createdAt),
        exp.title || '-',
        exp.category || '-',
        Number(exp.amount) || 0,
        exp.note || '-',
      ]),
    })
  }

  return {
    scope,
    scopeLabel: resolveScopeLabel(scope),
    period,
    periodLabel: resolvePeriodLabel({ scope, period, startDate, endDate }),
    exportedAt: now.toISOString(),
    exportedAtLabel: formatDateTimeId(now),
    business,
    counts: {
      menus: sellableMenus.length,
      stock: stockItems.length,
      categories: categories.length,
      customers: customers.length,
      transactions: filteredTransactions.length,
      soldItems: soldLineItems.length,
      cashEntries: filteredCashEntries.length,
      expenses: filteredExpenses.length,
    },
    summaryMetrics,
    sections,
  }
}

// ── OpenXML (.xlsx) Multi-Sheet Generator (Zero External Bloat) ──────────────

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let i = 0; i < 256; i++) {
    let c = i
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    }
    table[i] = c >>> 0
  }
  return table
})()

function crc32Bytes(bytes) {
  let crc = 0xffffffff
  for (let i = 0; i < bytes.length; i++) {
    crc = CRC32_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}

function concatUint8Arrays(chunks) {
  const totalLength = chunks.reduce((sum, arr) => sum + arr.length, 0)
  const result = new Uint8Array(totalLength)
  let offset = 0
  for (const arr of chunks) {
    result.set(arr, offset)
    offset += arr.length
  }
  return result
}

function toUint8Bytes(input, encoder) {
  if (typeof input === 'string') return encoder.encode(input)
  if (ArrayBuffer.isView(input)) {
    return new Uint8Array(input.buffer, input.byteOffset, input.byteLength)
  }
  return encoder.encode(String(input ?? ''))
}

function createStoredZip(entries) {
  const encoder = new TextEncoder()
  const localChunks = []
  const centralChunks = []
  let localOffset = 0

  for (const entry of entries) {
    const nameBytes = toUint8Bytes(entry.path, encoder)
    const dataBytes = toUint8Bytes(entry.data, encoder)
    const crc = crc32Bytes(dataBytes)
    const size = dataBytes.length

    // Local File Header (30 bytes + name)
    const localHeader = new Uint8Array(30 + nameBytes.length)
    const lv = new DataView(localHeader.buffer)
    lv.setUint32(0, 0x04034b50, true) // signature
    lv.setUint16(4, 20, true) // version needed (2.0)
    lv.setUint16(6, 0x0800, true) // UTF-8 filename flag
    lv.setUint16(8, 0, true) // method: 0 (STORE)
    lv.setUint16(10, 0, true) // mod time
    lv.setUint16(12, 0x21, true) // mod date
    lv.setUint32(14, crc, true)
    lv.setUint32(18, size, true)
    lv.setUint32(22, size, true)
    lv.setUint16(26, nameBytes.length, true)
    lv.setUint16(28, 0, true)
    localHeader.set(nameBytes, 30)

    localChunks.push(localHeader, dataBytes)

    // Central Directory Header (46 bytes + name)
    const centralHeader = new Uint8Array(46 + nameBytes.length)
    const cv = new DataView(centralHeader.buffer)
    cv.setUint32(0, 0x02014b50, true)
    cv.setUint16(4, 20, true)
    cv.setUint16(6, 20, true)
    cv.setUint16(8, 0x0800, true)
    cv.setUint16(10, 0, true)
    cv.setUint16(12, 0, true)
    cv.setUint16(14, 0x21, true)
    cv.setUint32(16, crc, true)
    cv.setUint32(20, size, true)
    cv.setUint32(24, size, true)
    cv.setUint16(28, nameBytes.length, true)
    cv.setUint16(30, 0, true)
    cv.setUint16(32, 0, true)
    cv.setUint16(34, 0, true)
    cv.setUint16(36, 0, true)
    cv.setUint32(38, 0, true)
    cv.setUint32(42, localOffset, true)
    centralHeader.set(nameBytes, 46)

    centralChunks.push(centralHeader)
    localOffset += localHeader.length + dataBytes.length
  }

  const centralDirectory = concatUint8Arrays(centralChunks)
  const eocd = new Uint8Array(22)
  const ev = new DataView(eocd.buffer)
  ev.setUint32(0, 0x06054b50, true)
  ev.setUint16(4, 0, true)
  ev.setUint16(6, 0, true)
  ev.setUint16(8, entries.length, true)
  ev.setUint16(10, entries.length, true)
  ev.setUint32(12, centralDirectory.length, true)
  ev.setUint32(16, localOffset, true)
  ev.setUint16(20, 0, true)

  return concatUint8Arrays([...localChunks, centralDirectory, eocd])
}

function escapeXml(value) {
  return String(value ?? '')
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function sanitizeSheetName(name, index) {
  const cleaned = String(name || `Sheet ${index + 1}`)
    .replace(/[\\/?*:[\]]/g, ' ')
    .replace(/^'+|'+$/g, '')
    .trim()
    .slice(0, 31)
  return cleaned || `Sheet ${index + 1}`
}

function colIndexToLetters(colIndex) {
  let n = colIndex + 1
  let letters = ''
  while (n > 0) {
    const rem = (n - 1) % 26
    letters = String.fromCharCode(65 + rem) + letters
    n = Math.floor((n - 1) / 26)
  }
  return letters
}

function buildXlsxCell(rowNum, colIdx, value, styleId, explicitNumeric = false) {
  const ref = `${colIndexToLetters(colIdx)}${rowNum}`
  if (explicitNumeric && typeof value === 'number' && Number.isFinite(value)) {
    return `<c r="${ref}" s="${styleId}" t="n"><v>${value}</v></c>`
  }
  return `<c r="${ref}" s="${styleId}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(value ?? '')}</t></is></c>`
}

function buildSummaryWorksheetXml(dataset) {
  const rowsXml = []
  let r = 1

  rowsXml.push(
    `<row r="${r}" ht="24" customHeight="1">${buildXlsxCell(r, 0, `LAPORAN & BACKUP DATA LOKAL - ${dataset.business.name.toUpperCase()}`, 1)}</row>`,
  )
  r++
  rowsXml.push(
    `<row r="${r}">${buildXlsxCell(r, 0, `Outlet: ${dataset.business.outlet} | Tipe Usaha: ${dataset.business.type} | Telepon: ${dataset.business.phone}`, 2)}</row>`,
  )
  r++
  rowsXml.push(
    `<row r="${r}">${buildXlsxCell(r, 0, `Cakupan: ${dataset.scopeLabel} | Periode: ${dataset.periodLabel} | Dicetak: ${dataset.exportedAtLabel}`, 2)}</row>`,
  )
  r += 2

  rowsXml.push(
    `<row r="${r}" ht="22" customHeight="1">${buildXlsxCell(r, 0, 'Indikator Ringkasan', 3)}${buildXlsxCell(r, 1, 'Nilai / Jumlah', 3)}</row>`,
  )
  r++

  for (const metric of dataset.summaryMetrics) {
    rowsXml.push(
      `<row r="${r}" ht="19" customHeight="1">${buildXlsxCell(r, 0, metric.label, 6)}${buildXlsxCell(
        r,
        1,
        metric.value,
        metric.isCurrency ? 7 : 6,
        true,
      )}</row>`,
    )
    r++
  }

  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    `<cols><col min="1" max="1" width="38" customWidth="1"/><col min="2" max="2" width="24" customWidth="1"/></cols>` +
    `<sheetData>${rowsXml.join('')}</sheetData>` +
    `</worksheet>`
  )
}

function buildSectionWorksheetXml(dataset, section) {
  const rowsXml = []
  let r = 1

  rowsXml.push(
    `<row r="${r}" ht="22" customHeight="1">${buildXlsxCell(r, 0, `${section.title} - ${dataset.business.name}`, 1)}</row>`,
  )
  r++
  rowsXml.push(
    `<row r="${r}">${buildXlsxCell(r, 0, `Periode: ${dataset.periodLabel} | Total Baris: ${section.rows.length} | Dicetak: ${dataset.exportedAtLabel}`, 2)}</row>`,
  )
  r += 2

  // Header Row
  const headerCells = section.columns
    .map((col, idx) => buildXlsxCell(r, idx, col.header, 3))
    .join('')
  rowsXml.push(`<row r="${r}" ht="22" customHeight="1">${headerCells}</row>`)
  r++

  if (section.rows.length === 0) {
    rowsXml.push(
      `<row r="${r}">${buildXlsxCell(r, 0, 'Belum ada data untuk bagian ini.', 4)}</row>`,
    )
  } else {
    for (const row of section.rows) {
      const cells = section.columns
        .map((col, idx) => {
          const val = row[idx]
          const isNumeric = col.type === 'number' && typeof val === 'number'
          const styleId = isNumeric ? 5 : 4
          return buildXlsxCell(r, idx, val, styleId, isNumeric)
        })
        .join('')
      rowsXml.push(`<row r="${r}" ht="18" customHeight="1">${cells}</row>`)
      r++
    }
  }

  const colsXml = section.columns
    .map(
      (col, idx) =>
        `<col min="${idx + 1}" max="${idx + 1}" width="${Math.max(col.width || 12, 8)}" customWidth="1"/>`,
    )
    .join('')

  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    `<cols>${colsXml}</cols>` +
    `<sheetData>${rowsXml.join('')}</sheetData>` +
    `</worksheet>`
  )
}

function buildStylesXml() {
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    `<numFmts count="1"><numFmt numFmtId="164" formatCode="#,##0"/></numFmts>` +
    `<fonts count="5">` +
    `<font><sz val="11"/><color rgb="FF18181B"/><name val="Calibri"/></font>` +
    `<font><b/><sz val="13"/><color rgb="FF312E81"/><name val="Calibri"/></font>` +
    `<font><sz val="10"/><color rgb="FF52525B"/><name val="Calibri"/></font>` +
    `<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>` +
    `<font><b/><sz val="11"/><color rgb="FF18181B"/><name val="Calibri"/></font>` +
    `</fonts>` +
    `<fills count="4">` +
    `<fill><patternFill patternType="none"/></fill>` +
    `<fill><patternFill patternType="gray125"/></fill>` +
    `<fill><patternFill patternType="solid"><fgColor rgb="FF4945D6"/><bgColor indexed="64"/></patternFill></fill>` +
    `<fill><patternFill patternType="solid"><fgColor rgb="FFF4F4F8"/><bgColor indexed="64"/></patternFill></fill>` +
    `</fills>` +
    `<borders count="2">` +
    `<border><left/><right/><top/><bottom/><diagonal/></border>` +
    `<border>` +
    `<left style="thin"><color rgb="FFE4E4E7"/></left>` +
    `<right style="thin"><color rgb="FFE4E4E7"/></right>` +
    `<top style="thin"><color rgb="FFE4E4E7"/></top>` +
    `<bottom style="thin"><color rgb="FFE4E4E7"/></bottom>` +
    `<diagonal/>` +
    `</border>` +
    `</borders>` +
    `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
    `<cellXfs count="8">` +
    `<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>` +
    `<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>` +
    `<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>` +
    `<xf numFmtId="0" fontId="3" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/>` +
    `<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1"/>` +
    `<xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"/>` +
    `<xf numFmtId="0" fontId="4" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/>` +
    `<xf numFmtId="164" fontId="4" fillId="3" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1"/>` +
    `</cellXfs>` +
    `</styleSheet>`
  )
}

export function createExcelWorkbookBytes(dataset) {
  const sheetEntries = [
    {
      name: sanitizeSheetName('Ringkasan', 0),
      xml: buildSummaryWorksheetXml(dataset),
    },
    ...dataset.sections.map((section, idx) => ({
      name: sanitizeSheetName(section.sheetName, idx + 1),
      xml: buildSectionWorksheetXml(dataset, section),
    })),
  ]

  const contentTypesOverrides = sheetEntries
    .map(
      (_, i) =>
        `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
    )
    .join('')

  const contentTypesXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
    `<Default Extension="xml" ContentType="application/xml"/>` +
    `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
    `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>` +
    contentTypesOverrides +
    `</Types>`

  const rootRelsXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>` +
    `</Relationships>`

  const workbookSheetsXml = sheetEntries
    .map(
      (s, i) =>
        `<sheet name="${escapeXml(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`,
    )
    .join('')

  const workbookXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
    `<sheets>${workbookSheetsXml}</sheets>` +
    `</workbook>`

  const workbookRelsItems = sheetEntries
    .map(
      (_, i) =>
        `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`,
    )
    .join('')

  const stylesRelId = `rId${sheetEntries.length + 1}`
  const workbookRelsXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    workbookRelsItems +
    `<Relationship Id="${stylesRelId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
    `</Relationships>`

  const zipEntries = [
    { path: '[Content_Types].xml', data: contentTypesXml },
    { path: '_rels/.rels', data: rootRelsXml },
    { path: 'xl/workbook.xml', data: workbookXml },
    { path: 'xl/_rels/workbook.xml.rels', data: workbookRelsXml },
    { path: 'xl/styles.xml', data: buildStylesXml() },
    ...sheetEntries.map((s, i) => ({
      path: `xl/worksheets/sheet${i + 1}.xml`,
      data: s.xml,
    })),
  ]

  return createStoredZip(zipEntries)
}

// ── Multi-Page Vector PDF 1.4 Generator ──────────────────────────────────────

function sanitizePdfText(input) {
  return String(input ?? '')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2022\u00B7]/g, '*')
    .replace(/[\u2192]/g, '->')
    .replace(/[^\x20-\x7E\xA0-\xFF]/g, '')
}

function escapePdfLiteral(text) {
  return sanitizePdfText(text)
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)')
}

function estimatePdfTextWidth(text, fontSize) {
  return sanitizePdfText(text).length * fontSize * 0.51
}

function truncatePdfText(text, maxWidthPt, fontSize) {
  const clean = sanitizePdfText(text)
  if (maxWidthPt <= 0) return ''
  const maxChars = Math.max(1, Math.floor(maxWidthPt / (fontSize * 0.51)))
  if (clean.length <= maxChars) return clean
  if (maxChars <= 3) return clean.slice(0, maxChars)
  return `${clean.slice(0, maxChars - 2)}..`
}

export function createPdfDocumentBytes(dataset) {
  const PAGE_W = 842
  const PAGE_H = 595
  const MARGIN_X = 32
  const USABLE_W = PAGE_W - MARGIN_X * 2
  const BOTTOM_LIMIT = 44

  const pages = []
  let currentCommands = []
  let cursorY = PAGE_H - 32

  function startNewPage(isFirstPage = false) {
    if (!isFirstPage) {
      pages.push(currentCommands)
      currentCommands = []
    }

    if (isFirstPage) {
      // Branded Indigo Header Banner
      currentCommands.push(
        `0.286 0.271 0.839 rg`,
        `${MARGIN_X} ${PAGE_H - 86} ${USABLE_W} 58 re f`,
        `1 1 1 rg`,
        `BT /F2 14 Tf ${MARGIN_X + 16} ${PAGE_H - 50} Td (${escapePdfLiteral(
          `LAPORAN & BACKUP DATA LOKAL - ${dataset.business.name.toUpperCase()}`,
        )}) Tj ET`,
        `BT /F1 9 Tf ${MARGIN_X + 16} ${PAGE_H - 66} Td (${escapePdfLiteral(
          `Outlet: ${dataset.business.outlet}  |  Tipe: ${dataset.business.type}  |  Telp: ${dataset.business.phone}`,
        )}) Tj ET`,
        `BT /F1 8.5 Tf ${MARGIN_X + 16} ${PAGE_H - 79} Td (${escapePdfLiteral(
          `Cakupan: ${dataset.scopeLabel}   |   Periode: ${dataset.periodLabel}   |   Dicetak: ${dataset.exportedAtLabel}`,
        )}) Tj ET`,
      )
      cursorY = PAGE_H - 102
    } else {
      // Compact Continuation Header
      currentCommands.push(
        `0.957 0.961 0.973 rg`,
        `${MARGIN_X} ${PAGE_H - 50} ${USABLE_W} 22 re f`,
        `0.19 0.18 0.50 rg`,
        `BT /F2 9 Tf ${MARGIN_X + 10} ${PAGE_H - 42} Td (${escapePdfLiteral(
          `${dataset.business.name} - ${dataset.scopeLabel} (${dataset.periodLabel})`,
        )}) Tj ET`,
      )
      cursorY = PAGE_H - 64
    }
  }

  startNewPage(true)

  // Render Summary Metrics Cards (4 per row)
  if (dataset.summaryMetrics.length > 0) {
    const cols = 4
    const gap = 8
    const cardW = (USABLE_W - gap * (cols - 1)) / cols
    const cardH = 34

    for (let i = 0; i < dataset.summaryMetrics.length; i++) {
      const col = i % cols
      if (col === 0 && i > 0) {
        cursorY -= cardH + 7
      }
      if (col === 0 && cursorY - cardH < BOTTOM_LIMIT) {
        startNewPage(false)
      }

      const metric = dataset.summaryMetrics[i]
      const x = MARGIN_X + col * (cardW + gap)
      const y = cursorY - cardH
      const valText = metric.isCurrency
        ? formatRupiahText(metric.value)
        : String(metric.value)

      currentCommands.push(
        `0.973 0.980 0.988 rg`,
        `0.886 0.910 0.941 RG 0.6 w`,
        `${x.toFixed(1)} ${y.toFixed(1)} ${cardW.toFixed(1)} ${cardH} re B`,
        `0.39 0.45 0.55 rg`,
        `BT /F1 7.5 Tf ${(x + 8).toFixed(1)} ${(y + 21).toFixed(1)} Td (${escapePdfLiteral(
          truncatePdfText(metric.label, cardW - 16, 7.5),
        )}) Tj ET`,
        `0.09 0.09 0.11 rg`,
        `BT /F2 10 Tf ${(x + 8).toFixed(1)} ${(y + 8).toFixed(1)} Td (${escapePdfLiteral(
          truncatePdfText(valText, cardW - 16, 10),
        )}) Tj ET`,
      )
    }

    cursorY -= cardH + 16
  }

  // Helper to draw a section table header
  function drawTableHeader(section, colWidths, isContinuation = false) {
    const titleLabel = isContinuation
      ? `${section.title} (Lanjutan)`
      : `${section.title} (${section.rows.length} Data)`

    currentCommands.push(
      `0.12 0.11 0.30 rg`,
      `BT /F2 10.5 Tf ${MARGIN_X} ${(cursorY - 11).toFixed(1)} Td (${escapePdfLiteral(
        titleLabel,
      )}) Tj ET`,
    )
    cursorY -= 16

    const headerH = 19
    const headerY = cursorY - headerH
    currentCommands.push(
      `0.286 0.271 0.839 rg`,
      `${MARGIN_X} ${headerY.toFixed(1)} ${USABLE_W} ${headerH} re f`,
      `1 1 1 rg`,
    )

    let colX = MARGIN_X
    section.columns.forEach((col, idx) => {
      const w = colWidths[idx]
      const text = truncatePdfText(col.header, w - 10, 8)
      const textW = estimatePdfTextWidth(text, 8)
      const tx =
        col.align === 'right' ? Math.max(colX + 4, colX + w - 5 - textW) : colX + 5
      currentCommands.push(
        `BT /F2 8 Tf ${tx.toFixed(1)} ${(headerY + 6).toFixed(1)} Td (${escapePdfLiteral(
          text,
        )}) Tj ET`,
      )
      colX += w
    })

    cursorY -= headerH
  }

  // Render Each Table Section
  for (const section of dataset.sections) {
    const totalWeight = section.columns.reduce((s, c) => s + (c.width || 12), 0)
    const colWidths = section.columns.map(
      (c) => ((c.width || 12) / totalWeight) * USABLE_W,
    )

    if (cursorY - 56 < BOTTOM_LIMIT) {
      startNewPage(false)
    }

    drawTableHeader(section, colWidths, false)

    const rowH = 16
    if (section.rows.length === 0) {
      const rowY = cursorY - rowH
      currentCommands.push(
        `0.973 0.980 0.988 rg`,
        `${MARGIN_X} ${rowY.toFixed(1)} ${USABLE_W} ${rowH} re f`,
        `0.45 0.45 0.50 rg`,
        `BT /F1 8 Tf ${MARGIN_X + 6} ${(rowY + 5).toFixed(1)} Td (Belum ada data pada bagian ini.) Tj ET`,
      )
      cursorY -= rowH + 14
      continue
    }

    for (let rIdx = 0; rIdx < section.rows.length; rIdx++) {
      if (cursorY - rowH < BOTTOM_LIMIT) {
        startNewPage(false)
        drawTableHeader(section, colWidths, true)
      }

      const row = section.rows[rIdx]
      const rowY = cursorY - rowH

      if (rIdx % 2 === 1) {
        currentCommands.push(
          `0.969 0.976 0.988 rg`,
          `${MARGIN_X} ${rowY.toFixed(1)} ${USABLE_W} ${rowH} re f`,
        )
      }

      currentCommands.push(
        `0.89 0.91 0.94 RG 0.4 w`,
        `${MARGIN_X} ${rowY.toFixed(1)} m ${MARGIN_X + USABLE_W} ${rowY.toFixed(1)} l S`,
        `0.12 0.14 0.18 rg`,
      )

      let colX = MARGIN_X
      section.columns.forEach((col, cIdx) => {
        const w = colWidths[cIdx]
        const rawVal = row[cIdx]
        const formatted =
          col.type === 'number' && typeof rawVal === 'number'
            ? Math.round(rawVal).toLocaleString('id-ID')
            : String(rawVal ?? '-')
        const text = truncatePdfText(formatted, w - 10, 7.8)
        const textW = estimatePdfTextWidth(text, 7.8)
        const tx =
          col.align === 'right' ? Math.max(colX + 4, colX + w - 5 - textW) : colX + 5

        currentCommands.push(
          `BT /F1 7.8 Tf ${tx.toFixed(1)} ${(rowY + 4.8).toFixed(1)} Td (${escapePdfLiteral(
            text,
          )}) Tj ET`,
        )
        colX += w
      })

      cursorY -= rowH
    }

    cursorY -= 14
  }

  pages.push(currentCommands)

  // Add Footers to All Pages & Assemble PDF Objects
  const totalPages = pages.length
  const encoder = new TextEncoder()
  const chunks = []
  let byteOffset = 0

  function pushBytes(arrOrString) {
    const bytes = toUint8Bytes(arrOrString, encoder)
    chunks.push(bytes)
    byteOffset += bytes.length
  }

  // PDF Binary Header
  pushBytes(
    new Uint8Array([
      0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a, 0x25, 0xe2, 0xe3,
      0xcf, 0xd3, 0x0a,
    ]),
  )

  // Object IDs:
  // 1: Catalog
  // 2: Pages
  // 3: Font Helvetica (/F1)
  // 4: Font Helvetica-Bold (/F2)
  // For page i (0..totalPages-1):
  //   pageObjId = 5 + i * 2
  //   contentObjId = 6 + i * 2
  const maxObjId = 4 + totalPages * 2
  const offsets = new Array(maxObjId + 1).fill(0)

  function writeObj(id, bodyStr) {
    offsets[id] = byteOffset
    pushBytes(`${id} 0 obj\n${bodyStr}\nendobj\n`)
  }

  const kidsRefs = pages.map((_, i) => `${5 + i * 2} 0 R`).join(' ')

  writeObj(1, `<< /Type /Catalog /Pages 2 0 R >>`)
  writeObj(2, `<< /Type /Pages /Count ${totalPages} /Kids [ ${kidsRefs} ] >>`)
  writeObj(
    3,
    `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>`,
  )
  writeObj(
    4,
    `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>`,
  )

  pages.forEach((cmds, idx) => {
    const pageNum = idx + 1
    const pageObjId = 5 + idx * 2
    const contentObjId = 6 + idx * 2

    const footerRight = `Halaman ${pageNum} dari ${totalPages}`
    const rightW = estimatePdfTextWidth(footerRight, 8)
    const fullCmds = [
      ...cmds,
      `0.85 0.87 0.91 RG 0.5 w`,
      `${MARGIN_X} 28 m ${MARGIN_X + USABLE_W} 28 l S`,
      `0.45 0.47 0.53 rg`,
      `BT /F1 8 Tf ${MARGIN_X} 16 Td (${escapePdfLiteral(
        `Net Kasir Offline POS - ${dataset.business.name} (${dataset.business.outlet})`,
      )}) Tj ET`,
      `BT /F1 8 Tf ${(MARGIN_X + USABLE_W - rightW).toFixed(1)} 16 Td (${escapePdfLiteral(
        footerRight,
      )}) Tj ET`,
    ]

    const streamStr = fullCmds.join('\n')
    const streamBytes = encoder.encode(streamStr)

    writeObj(
      pageObjId,
      `<< /Type /Page /Parent 2 0 R /MediaBox [ 0 0 ${PAGE_W} ${PAGE_H} ] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentObjId} 0 R >>`,
    )

    offsets[contentObjId] = byteOffset
    pushBytes(`${contentObjId} 0 obj\n<< /Length ${streamBytes.length} >>\nstream\n`)
    pushBytes(streamBytes)
    pushBytes(`\nendstream\nendobj\n`)
  })

  const xrefOffset = byteOffset
  let xrefStr = `xref\n0 ${maxObjId + 1}\n0000000000 65535 f \n`
  for (let id = 1; id <= maxObjId; id++) {
    xrefStr += `${String(offsets[id]).padStart(10, '0')} 00000 n \n`
  }
  pushBytes(xrefStr)
  pushBytes(
    `trailer\n<< /Size ${maxObjId + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`,
  )

  return concatUint8Arrays(chunks)
}

// ── Cross-Platform File Save / Share (Browser + Capacitor Android) ───────────

function uint8ToBase64(bytes) {
  let binary = ''
  const chunkSize = 0x8000
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const slice = bytes.subarray(i, i + chunkSize)
    binary += String.fromCharCode(...slice)
  }
  return btoa(binary)
}

export async function saveOrShareFile({
  bytes,
  filename,
  mimeType,
  dialogTitle = 'Simpan atau Bagikan File',
}) {
  if (Capacitor.isNativePlatform()) {
    const [{ Filesystem, Directory }, { Share }] = await Promise.all([
      import('@capacitor/filesystem'),
      import('@capacitor/share'),
    ])
    const base64Data = uint8ToBase64(bytes)
    const { uri } = await Filesystem.writeFile({
      path: filename,
      data: base64Data,
      directory: Directory.Cache,
    })
    await Share.share({
      title: filename,
      files: [uri],
      dialogTitle,
    })
    return { filename, mode: 'native-share' }
  }

  const blob = new Blob([bytes], { type: mimeType })
  const objectUrl = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = objectUrl
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(objectUrl)
  return { filename, mode: 'browser-download' }
}

export async function saveOrShareJsonBackup(payload) {
  if (!Capacitor.isNativePlatform()) {
    const filename = downloadBackupFile(payload)
    return { filename, mode: 'browser-download' }
  }

  const filename = `pos-mobile-backup-${formatFileTimestamp()}.json`
  const encoder = new TextEncoder()
  const bytes = encoder.encode(JSON.stringify(payload, null, 2))
  return saveOrShareFile({
    bytes,
    filename,
    mimeType: JSON_MIME_TYPE,
    dialogTitle: 'Simpan atau Bagikan File Backup POS (.json)',
  })
}

export async function exportLocalPosData({
  stores,
  scope = EXPORT_SCOPES.ALL,
  period = EXPORT_PERIODS.ALL_TIME,
  startDate = '',
  endDate = '',
  format = EXPORT_FORMATS.EXCEL,
  now = new Date(),
} = {}) {
  const validation = validatePeriodOptions({ scope, period, startDate, endDate })
  if (!validation.valid) {
    return {
      success: false,
      error: validation.error,
    }
  }

  const dataset = buildExportDataset(stores, {
    scope,
    period,
    startDate,
    endDate,
    now,
  })

  const storeSlug = slugifyFilePart(dataset.business.name, 'nexapos')
  const scopeSlug =
    scope === EXPORT_SCOPES.MASTER
      ? 'data-master'
      : scope === EXPORT_SCOPES.SALES
        ? 'penjualan-kas'
        : 'semua-data'
  const stamp = formatFileTimestamp(now)

  const isPdf = format === EXPORT_FORMATS.PDF
  const ext = isPdf ? 'pdf' : 'xlsx'
  const mimeType = isPdf ? PDF_MIME_TYPE : XLSX_MIME_TYPE
  const filename = `nexapos-${storeSlug}-${scopeSlug}-${stamp}.${ext}`

  const bytes = isPdf
    ? createPdfDocumentBytes(dataset)
    : createExcelWorkbookBytes(dataset)

  const saved = await saveOrShareFile({
    bytes,
    filename,
    mimeType,
    dialogTitle: `Simpan / Bagikan Laporan ${isPdf ? 'PDF' : 'Excel'}`,
  })

  return {
    success: true,
    filename: saved.filename,
    mode: saved.mode,
    format,
    dataset,
    byteLength: bytes.length,
  }
}