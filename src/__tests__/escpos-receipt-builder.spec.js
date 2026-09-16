import { describe, expect, it } from 'vitest'

import {
  buildReceiptBytes,
  buildReceiptText,
  buildTestReceiptText,
  commandsToBytes,
  createReceiptCommands,
  createTestReceiptCommands,
  formatIdr,
  sanitizePrinterText,
  wrapText,
} from '@/services/printer/escposReceiptBuilder'

const ESC = 0x1b
const LF = 0x0a

const business = {
  name: 'Toko ABC',
  outlet: 'Outlet Utama',
  phone: '08123456789',
}

function retailTransaction(overrides = {}) {
  return {
    id: 'trx-1',
    invoiceNumber: 'INV-20260916001',
    customer: 'Budi',
    paymentMethod: 'cash',
    paymentStatus: 'paid',
    createdAt: '2026-09-16T03:30:00.000Z',
    items: [{ name: 'Es Kopi Susu', qty: 2, price: 22000, unit: 'pcs' }],
    subtotal: 44000,
    tax: 4400,
    total: 48400,
    cashReceived: 50000,
    changeAmount: 1600,
    ...overrides,
  }
}

function laundryTransaction(overrides = {}) {
  return {
    id: 'ldr-1',
    orderNumber: 'LDR-20260916-0001',
    customer: 'Sari',
    customerSnapshot: { id: 'c1', name: 'Sari', phone: '08123456789', email: '' },
    orderStatus: 'Masuk',
    paymentStatus: 'unpaid',
    paymentMethod: '',
    createdAt: '2026-09-16T01:00:00.000Z',
    estimatedCompletedAt: '2026-09-18T10:00:00.000Z',
    items: [
      { serviceName: 'Cuci Kering', qty: 2.5, unitPrice: 10000, pricingUnit: 'kg' },
      { serviceName: 'Bed Cover', qty: 2, unitPrice: 15000, pricingUnit: 'pcs' },
    ],
    subtotal: 55000,
    tax: 0,
    total: 55000,
    ...overrides,
  }
}

function textLines(commands) {
  return commands.filter((command) => command.type === 'text').map((command) => command.value)
}

describe('P33 ESC/POS receipt builder', () => {
  it('setiap baris 58mm maksimal 32 karakter', () => {
    const commands = createReceiptCommands({
      transaction: laundryTransaction(),
      business,
      paperWidth: '58',
    })

    for (const line of textLines(commands)) {
      expect(line.length).toBeLessThanOrEqual(32)
    }
  })

  it('setiap baris 80mm maksimal 48 karakter', () => {
    const commands = createReceiptCommands({
      transaction: laundryTransaction(),
      business,
      paperWidth: '80',
    })

    for (const line of textLines(commands)) {
      expect(line.length).toBeLessThanOrEqual(48)
    }
  })

  it('header center berisi nama toko, outlet, dan telepon', () => {
    const commands = createReceiptCommands({
      transaction: retailTransaction(),
      business,
      paperWidth: '58',
    })

    expect(commands[0]).toEqual({ type: 'init' })
    expect(commands[1]).toEqual({ type: 'align', value: 'center' })

    const lines = textLines(commands)
    const centerIndex = commands.findIndex((command) => command.type === 'align' && command.value === 'center')
    const leftIndex = commands.findIndex((command) => command.type === 'align' && command.value === 'left')

    expect(centerIndex).toBeGreaterThanOrEqual(0)
    expect(lines.indexOf('Toko ABC')).toBeGreaterThanOrEqual(0)
    expect(lines.indexOf('Outlet Utama')).toBeGreaterThanOrEqual(0)
    expect(lines.indexOf('08123456789')).toBeGreaterThanOrEqual(0)
    // Header lines come before the receipt switches back to left alignment.
    expect(lines.indexOf('08123456789')).toBeLessThan(leftIndex)
  })

  it('retail menampilkan invoice, tanggal, customer, dan metode pembayaran', () => {
    const text = buildReceiptText({
      transaction: retailTransaction(),
      business,
      paperWidth: '58',
    })

    expect(text).toContain('Invoice: INV-20260916001')
    expect(text).toContain('Tanggal: 16/09/2026')
    expect(text).toContain('Customer: Budi')
    expect(text).toContain('Metode Pembayaran: Cash')
  })

  it('retail item menampilkan nama, qty x harga, dan subtotal baris', () => {
    const text = buildReceiptText({
      transaction: retailTransaction(),
      business,
      paperWidth: '58',
    })

    expect(text).toContain('Es Kopi Susu')
    expect(text).toContain('2 pcs x Rp 22.000')
    expect(text).toContain('Rp 44.000')
  })

  it('retail tidak mencetak HPP', () => {
    const text = buildReceiptText({
      transaction: retailTransaction({
        items: [{ name: 'Es Kopi Susu', qty: 2, price: 22000, unit: 'pcs', hppSnapshot: 9000 }],
      }),
      business,
      paperWidth: '58',
    })

    expect(text).not.toContain('HPP')
    expect(text).not.toContain('9000')
  })

  it('Laundry menampilkan nomor order, status order, dan status pembayaran', () => {
    const text = buildReceiptText({
      transaction: laundryTransaction(),
      business,
      paperWidth: '58',
    })

    expect(text).toContain('No. Order: LDR-20260916-0001')
    expect(text).toContain('Status Order: Masuk')
    expect(text).toContain('Status Pembayaran: BELUM DIBAYAR')
    expect(text).toContain('Customer: Sari')
    expect(text).toContain('Nomor HP: 08123456789')
  })

  it('Laundry kg decimal dicetak dengan satuan dan subtotal benar', () => {
    const text = buildReceiptText({
      transaction: laundryTransaction(),
      business,
      paperWidth: '58',
    })

    expect(text).toContain('Cuci Kering')
    expect(text).toContain('2.5 kg x Rp 10.000')
    expect(text).toContain('Rp 25.000')
  })

  it('Laundry pcs dicetak sebagai bilangan bulat', () => {
    const text = buildReceiptText({
      transaction: laundryTransaction(),
      business,
      paperWidth: '58',
    })

    expect(text).toContain('Bed Cover')
    expect(text).toContain('2 pcs x Rp 15.000')
    expect(text).toContain('Rp 30.000')
  })

  it('Laundry paid menampilkan metode pembayaran dan estimasi selesai', () => {
    const text = buildReceiptText({
      transaction: laundryTransaction({ paymentStatus: 'paid', paymentMethod: 'cash' }),
      business,
      paperWidth: '58',
    })

    expect(text).toContain('Status Pembayaran: LUNAS')
    expect(text).toContain('Metode Pembayaran: Cash')
    expect(text).toContain('Estimasi Selesai: 18/09/2026')
  })

  it('Laundry unpaid tidak menampilkan metode pembayaran', () => {
    const text = buildReceiptText({
      transaction: laundryTransaction(),
      business,
      paperWidth: '58',
    })

    expect(text).not.toContain('Metode Pembayaran')
  })

  it('cash menampilkan uang diterima dan kembalian', () => {
    const text = buildReceiptText({
      transaction: retailTransaction(),
      business,
      paperWidth: '58',
    })

    expect(text).toContain('Uang Diterima')
    expect(text).toContain('Rp 50.000')
    expect(text).toContain('Kembalian')
    expect(text).toContain('Rp 1.600')
  })

  it('QRIS tidak menampilkan uang diterima atau kembalian', () => {
    const text = buildReceiptText({
      transaction: retailTransaction({
        paymentMethod: 'qris',
        cashReceived: null,
        changeAmount: null,
      }),
      business,
      paperWidth: '58',
    })

    expect(text).toContain('Metode Pembayaran: QRIS')
    expect(text).not.toContain('Uang Diterima')
    expect(text).not.toContain('Kembalian')
  })

  it('total, subtotal, dan pajak dicetak', () => {
    const text = buildReceiptText({
      transaction: retailTransaction(),
      business,
      paperWidth: '58',
    })

    expect(text).toContain('Subtotal')
    expect(text).toMatch(/Rp 44\.000/)
    expect(text).toContain('Pajak')
    expect(text).toMatch(/Rp 4\.400/)
    expect(text).toContain('TOTAL')
    expect(text).toMatch(/Rp 48\.400/)
  })

  it('separator mengikuti lebar kertas', () => {
    const width58 = createReceiptCommands({
      transaction: retailTransaction(),
      business,
      paperWidth: '58',
    })
    const width80 = createReceiptCommands({
      transaction: retailTransaction(),
      business,
      paperWidth: '80',
    })

    expect(textLines(width58)).toContain('-'.repeat(32))
    expect(textLines(width80)).toContain('-'.repeat(48))
  })

  it('nama produk panjang dibungkus tanpa terpotong', () => {
    const longName = 'Kopi Susu Gula Aren Spesial Kemasan Botol Besar'
    const text = buildReceiptText({
      transaction: retailTransaction({
        items: [{ name: longName, qty: 1, price: 25000, unit: 'pcs' }],
      }),
      business,
      paperWidth: '58',
    })

    expect(text).toContain('Kopi Susu Gula Aren Spesial')

    for (const line of text.split('\n')) {
      expect(line.length).toBeLessThanOrEqual(32)
    }
  })

  it('karakter yang tidak didukung menjadi ? dan tidak membuat crash', () => {
    const text = buildReceiptText({
      transaction: retailTransaction({
        customer: 'Pelanggan \u{1F600} Spesial',
        items: [{ name: 'Café Latte', qty: 1, price: 25000, unit: 'pcs' }],
      }),
      business,
      paperWidth: '58',
    })

    expect(text).toContain('Customer: Pelanggan ? Spesial')
    expect(text).toContain('Caf? Latte')
    expect(text).not.toContain('\u{1F600}')

    expect(() => buildReceiptBytes({
      transaction: retailTransaction({
        items: [{ name: 'Ünïcödé 商品', qty: 1, price: 1000, unit: 'pcs' }],
      }),
      business,
      paperWidth: '58',
    })).not.toThrow()
  })

  it('bytes dimulai dengan ESC @ dan tanpa perintah cut', () => {
    const bytes = buildReceiptBytes({
      transaction: retailTransaction(),
      business,
      paperWidth: '58',
    })

    expect(bytes[0]).toBe(ESC)
    expect(bytes[1]).toBe(0x40)
    expect(bytes[bytes.length - 1]).toBe(LF)

    // ESC/POS cut (GS V) must not be sent by default.
    for (let index = 0; index < bytes.length - 1; index += 1) {
      const isCut = bytes[index] === 0x1d && bytes[index + 1] === 0x56
      expect(isCut).toBe(false)
    }
  })

  it('feed penutup dikirim sebagai baris kosong', () => {
    const commands = createReceiptCommands({
      transaction: retailTransaction(),
      business,
      paperWidth: '58',
    })
    const last = commands[commands.length - 1]

    expect(last.type).toBe('feed')
    expect(last.lines).toBeGreaterThanOrEqual(2)
    expect(last.lines).toBeLessThanOrEqual(4)
  })

  it('bold dipakai untuk header dan total lalu dimatikan', () => {
    const commands = createReceiptCommands({
      transaction: retailTransaction(),
      business,
      paperWidth: '58',
    })
    const boldStates = commands
      .filter((command) => command.type === 'bold')
      .map((command) => command.value)

    expect(boldStates[0]).toBe(true)
    expect(boldStates[boldStates.length - 1]).toBe(false)
  })

  it('commandsToBytes mengubah teks menjadi ASCII dengan newline', () => {
    const bytes = commandsToBytes([
      { type: 'init' },
      { type: 'text', value: 'AB' },
      { type: 'feed', lines: 1 },
    ])

    expect(Array.from(bytes)).toEqual([ESC, 0x40, 65, 66, LF, LF])
  })

  it('test receipt memuat penanda tes print', () => {
    const text = buildTestReceiptText({ business, paperWidth: '80', now: new Date('2026-09-16T04:05:00.000Z') })

    expect(text).toContain('Toko ABC')
    expect(text).toContain('TEST PRINTER')
    expect(text).toContain('Printer Bluetooth berhasil terhubung.')
    expect(text).toContain('80mm')
    expect(text).toContain('POS OFFLINE')

    const commands = createTestReceiptCommands({ business, paperWidth: '80' })

    for (const line of textLines(commands)) {
      expect(line.length).toBeLessThanOrEqual(48)
    }
  })

  it('format dan sanitasi helper aman untuk nilai tidak valid', () => {
    expect(formatIdr(15000)).toBe('Rp 15.000')
    expect(formatIdr('bukan-angka')).toBe('Rp 0')
    expect(formatIdr(null)).toBe('Rp 0')
    expect(sanitizePrinterText('  a\tb\nc  ')).toBe('a b c')
    expect(wrapText('', 32)).toEqual([''])
    expect(wrapText('abcdefghij', 3)).toEqual(['abc', 'def', 'ghi', 'j'])
  })
})
