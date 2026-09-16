import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  listPairedPrinters,
  printReceipt,
  printTestReceipt,
} from '@/services/printer/bluetoothPrinterService'

const PRINTER = { name: 'POS-58', address: 'AA:BB:CC:DD:EE:FF' }
const business = { name: 'Toko ABC', outlet: 'Outlet Utama', phone: '08123456789' }

function createTransaction(overrides = {}) {
  return {
    id: 'trx-1',
    invoiceNumber: 'INV-1',
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

function nativeCapacitor() {
  return { isNativePlatform: () => true }
}

function webCapacitor() {
  return { isNativePlatform: () => false }
}

function createPlugin(overrides = {}) {
  return {
    listPairedDevices: vi.fn().mockResolvedValue({ devices: [] }),
    printRaw: vi.fn().mockResolvedValue({}),
    ...overrides,
  }
}

function createWindow() {
  return { print: vi.fn() }
}

function decodeBase64(value) {
  return globalThis.atob(value)
}

beforeEach(() => {
  vi.restoreAllMocks()
})

describe('P33 bluetooth printer service', () => {
  it('web memakai window.print tepat 1 kali dan tidak memanggil plugin', async () => {
    const windowRef = createWindow()
    const plugin = createPlugin()

    const result = await printReceipt({
      transaction: createTransaction(),
      business,
      printer: PRINTER,
      paperWidth: '58',
      capacitor: webCapacitor(),
      plugin,
      windowRef,
    })

    expect(result).toEqual({ success: true, mode: 'browser' })
    expect(windowRef.print).toHaveBeenCalledTimes(1)
    expect(plugin.printRaw).not.toHaveBeenCalled()
  })

  it('native memanggil printRaw dan tidak memanggil window.print', async () => {
    const windowRef = createWindow()
    const plugin = createPlugin()

    const result = await printReceipt({
      transaction: createTransaction(),
      business,
      printer: PRINTER,
      paperWidth: '58',
      capacitor: nativeCapacitor(),
      plugin,
      windowRef,
    })

    expect(result.success).toBe(true)
    expect(result.mode).toBe('native')
    expect(windowRef.print).not.toHaveBeenCalled()
    expect(plugin.printRaw).toHaveBeenCalledTimes(1)

    const payload = plugin.printRaw.mock.calls[0][0]
    expect(payload.address).toBe('AA:BB:CC:DD:EE:FF')
    expect(payload.timeoutMs).toBe(10000)
    expect(typeof payload.dataBase64).toBe('string')

    const decoded = decodeBase64(payload.dataBase64)
    expect(decoded.charCodeAt(0)).toBe(0x1b)
    expect(decoded.charCodeAt(1)).toBe(0x40)
    expect(decoded).toContain('INV-1')
  })

  it('native tanpa printer terpilih mengembalikan PRINTER_NOT_SELECTED', async () => {
    const plugin = createPlugin()

    const result = await printReceipt({
      transaction: createTransaction(),
      business,
      printer: { name: '', address: '' },
      paperWidth: '58',
      capacitor: nativeCapacitor(),
      plugin,
    })

    expect(result).toMatchObject({ success: false, code: 'PRINTER_NOT_SELECTED' })
    expect(result.message).toBe('Printer Bluetooth belum dipilih.')
    expect(plugin.printRaw).not.toHaveBeenCalled()
  })

  it('permission denied dinormalisasi ke Bahasa Indonesia', async () => {
    const plugin = createPlugin({
      printRaw: vi.fn().mockRejectedValue(
        Object.assign(new Error('BLUETOOTH_PERMISSION_DENIED'), { code: 'BLUETOOTH_PERMISSION_DENIED' }),
      ),
    })

    const result = await printReceipt({
      transaction: createTransaction(),
      business,
      printer: PRINTER,
      capacitor: nativeCapacitor(),
      plugin,
    })

    expect(result).toMatchObject({ success: false, code: 'BLUETOOTH_PERMISSION_DENIED' })
    expect(result.message).toBe('Izin Bluetooth belum diberikan.')
  })

  it('bluetooth disabled dinormalisasi', async () => {
    const plugin = createPlugin({
      printRaw: vi.fn().mockRejectedValue(
        Object.assign(new Error('BLUETOOTH_DISABLED'), { code: 'BLUETOOTH_DISABLED' }),
      ),
    })

    const result = await printReceipt({
      transaction: createTransaction(),
      business,
      printer: PRINTER,
      capacitor: nativeCapacitor(),
      plugin,
    })

    expect(result).toMatchObject({ success: false, code: 'BLUETOOTH_DISABLED' })
    expect(result.message).toBe('Bluetooth belum aktif.')
  })

  it('connect timeout dinormalisasi', async () => {
    const plugin = createPlugin({
      printRaw: vi.fn().mockRejectedValue(
        Object.assign(new Error('PRINTER_CONNECT_TIMEOUT'), { code: 'PRINTER_CONNECT_TIMEOUT' }),
      ),
    })

    const result = await printReceipt({
      transaction: createTransaction(),
      business,
      printer: PRINTER,
      capacitor: nativeCapacitor(),
      plugin,
    })

    expect(result).toMatchObject({ success: false, code: 'PRINTER_CONNECT_TIMEOUT' })
    expect(result.message).toBe('Koneksi ke printer terlalu lama.')
  })

  it('write error dan not paired dinormalisasi', async () => {
    const writePlugin = createPlugin({
      printRaw: vi.fn().mockRejectedValue(
        Object.assign(new Error('PRINTER_WRITE_FAILED'), { code: 'PRINTER_WRITE_FAILED' }),
      ),
    })
    const notPairedPlugin = createPlugin({
      printRaw: vi.fn().mockRejectedValue(
        Object.assign(new Error('PRINTER_NOT_PAIRED'), { code: 'PRINTER_NOT_PAIRED' }),
      ),
    })

    const writeResult = await printReceipt({
      transaction: createTransaction(),
      business,
      printer: PRINTER,
      capacitor: nativeCapacitor(),
      plugin: writePlugin,
    })
    const notPairedResult = await printReceipt({
      transaction: createTransaction(),
      business,
      printer: PRINTER,
      capacitor: nativeCapacitor(),
      plugin: notPairedPlugin,
    })

    expect(writeResult.message).toBe('Gagal mengirim struk ke printer.')
    expect(notPairedResult.message).toBe('Printer tidak lagi terhubung sebagai perangkat paired.')
  })

  it('error tak dikenal tidak membocorkan pesan Java mentah', async () => {
    const plugin = createPlugin({
      printRaw: vi.fn().mockRejectedValue(new Error('java.io.IOException: read failed, socket might closed')),
    })

    const result = await printReceipt({
      transaction: createTransaction(),
      business,
      printer: PRINTER,
      capacitor: nativeCapacitor(),
      plugin,
    })

    expect(result).toMatchObject({ success: false, code: 'PRINTER_UNKNOWN_ERROR' })
    expect(result.message).toBe('Terjadi kesalahan saat mencetak struk.')
    expect(result.message).not.toContain('java.io')
  })

  it('double tap tidak mengirim dua print bersamaan', async () => {
    let resolvePrint
    const plugin = createPlugin({
      printRaw: vi.fn()
        .mockImplementationOnce(() => new Promise((resolve) => {
          resolvePrint = () => resolve({})
        }))
        .mockResolvedValue({}),
    })

    const first = printReceipt({
      transaction: createTransaction(),
      business,
      printer: PRINTER,
      capacitor: nativeCapacitor(),
      plugin,
    })
    const second = await printReceipt({
      transaction: createTransaction(),
      business,
      printer: PRINTER,
      capacitor: nativeCapacitor(),
      plugin,
    })

    expect(second).toMatchObject({ success: false, code: 'PRINTER_BUSY' })
    expect(plugin.printRaw).toHaveBeenCalledTimes(1)

    resolvePrint()
    await expect(first).resolves.toMatchObject({ success: true })

    // A later print is allowed again once the first one finished.
    await printReceipt({
      transaction: createTransaction(),
      business,
      printer: PRINTER,
      capacitor: nativeCapacitor(),
      plugin,
    })
    expect(plugin.printRaw).toHaveBeenCalledTimes(2)
  })

  it('web tidak menghasilkan daftar printer native', async () => {
    const result = await listPairedPrinters({ capacitor: webCapacitor(), plugin: createPlugin() })

    expect(result).toEqual({ success: true, native: false, devices: [] })
  })

  it('native mengurutkan dan membersihkan daftar paired printer', async () => {
    const plugin = createPlugin({
      listPairedDevices: vi.fn().mockResolvedValue({
        devices: [
          { name: 'printer b', address: 'cc:cc:cc:cc:cc:cc' },
          { name: 'Printer A', address: 'bb:bb:bb:bb:bb:bb' },
          { name: 'Printer A', address: 'aa:aa:aa:aa:aa:aa' },
          { name: '', address: '' },
          null,
        ],
      }),
    })

    const result = await listPairedPrinters({ capacitor: nativeCapacitor(), plugin })

    expect(result.success).toBe(true)
    expect(result.native).toBe(true)
    expect(result.devices).toEqual([
      { name: 'Printer A', address: 'AA:AA:AA:AA:AA:AA' },
      { name: 'Printer A', address: 'BB:BB:BB:BB:BB:BB' },
      { name: 'printer b', address: 'CC:CC:CC:CC:CC:CC' },
    ])
  })

  it('daftar printer gagal dinormalisasi tanpa crash', async () => {
    const plugin = createPlugin({
      listPairedDevices: vi.fn().mockRejectedValue(
        Object.assign(new Error('BLUETOOTH_PERMISSION_DENIED'), { code: 'BLUETOOTH_PERMISSION_DENIED' }),
      ),
    })

    const result = await listPairedPrinters({ capacitor: nativeCapacitor(), plugin })

    expect(result).toMatchObject({
      success: false,
      code: 'BLUETOOTH_PERMISSION_DENIED',
      devices: [],
    })
  })

  it('tes print native memakai printer terpilih dan kertas yang dipilih', async () => {
    const plugin = createPlugin()

    const result = await printTestReceipt({
      printer: PRINTER,
      paperWidth: '80',
      business,
      capacitor: nativeCapacitor(),
      plugin,
      now: new Date('2026-09-16T04:05:00.000Z'),
    })

    expect(result).toMatchObject({ success: true, mode: 'native' })

    const payload = plugin.printRaw.mock.calls[0][0]
    const decoded = decodeBase64(payload.dataBase64)

    expect(payload.address).toBe(PRINTER.address)
    expect(decoded).toContain('TEST PRINTER')
    expect(decoded).toContain('80mm')
  })

  it('tes print di web ditolak dengan pesan jelas', async () => {
    const plugin = createPlugin()

    const result = await printTestReceipt({
      printer: PRINTER,
      paperWidth: '58',
      business,
      capacitor: webCapacitor(),
      plugin,
    })

    expect(result.success).toBe(false)
    expect(plugin.printRaw).not.toHaveBeenCalled()
  })
})
