import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createAppRouter } from '@/router'
import { createMemoryAdapter } from '@/services/database/memoryAdapter'
import { createPersistenceService } from '@/services/database/persistenceService'
import { usePrinterStore } from '@/stores/printerStore'
import SettingsView from '@/views/settings/SettingsView.vue'

const { listPairedPrintersMock, printTestReceiptMock, printerState } = vi.hoisted(() => ({
  listPairedPrintersMock: vi.fn(),
  printTestReceiptMock: vi.fn(),
  printerState: { native: true },
}))

vi.mock('@/services/printer/bluetoothPrinterService', async (importOriginal) => {
  const actual = await importOriginal()

  return {
    ...actual,
    isNativePrinterPlatform: () => printerState.native,
    listPairedPrinters: (...args) => listPairedPrintersMock(...args),
    printTestReceipt: (...args) => printTestReceiptMock(...args),
  }
})

const PRINTER = { name: 'POS-58', address: 'AA:BB:CC:DD:EE:FF' }

function createContext() {
  const pinia = createPinia()
  setActivePinia(pinia)

  return {
    pinia,
    router: createAppRouter(),
    printerStore: usePrinterStore(),
  }
}

async function mountSettings() {
  const context = createContext()
  const wrapper = mount(SettingsView, {
    global: {
      plugins: [context.pinia, context.router],
    },
  })

  await flushPromises()

  return { wrapper, ...context }
}

beforeEach(() => {
  printerState.native = true
  listPairedPrintersMock.mockReset()
  listPairedPrintersMock.mockImplementation(async () => ({ success: true, native: true, devices: [] }))
  printTestReceiptMock.mockReset()
  printTestReceiptMock.mockImplementation(async () => ({ success: true, mode: 'native' }))
})

describe('P33 printer store', () => {
  it('default tanpa printer dan kertas 58mm', () => {
    const { printerStore } = createContext()

    expect(printerStore.selectedPrinter).toEqual({ name: '', address: '' })
    expect(printerStore.paperWidth).toBe('58')
    expect(printerStore.hasSelectedPrinter).toBe(false)
  })

  it('selectPrinter menyimpan name dan address', () => {
    const { printerStore } = createContext()
    const result = printerStore.selectPrinter(PRINTER)

    expect(result.success).toBe(true)
    expect(printerStore.selectedPrinter).toEqual(PRINTER)
    expect(printerStore.hasSelectedPrinter).toBe(true)
  })

  it('selectPrinter menolak device tanpa address', () => {
    const { printerStore } = createContext()
    const result = printerStore.selectPrinter({ name: 'POS-58', address: '   ' })

    expect(result.success).toBe(false)
    expect(printerStore.hasSelectedPrinter).toBe(false)
  })

  it('setPaperWidth hanya menerima 58 atau 80', () => {
    const { printerStore } = createContext()

    expect(printerStore.setPaperWidth('80').success).toBe(true)
    expect(printerStore.paperWidth).toBe('80')
    expect(printerStore.setPaperWidth('110').success).toBe(false)
    expect(printerStore.paperWidth).toBe('80')
  })

  it('clearPrinter menghapus pilihan', () => {
    const { printerStore } = createContext()
    printerStore.selectPrinter(PRINTER)

    printerStore.clearPrinter()

    expect(printerStore.selectedPrinter).toEqual({ name: '', address: '' })
    expect(printerStore.hasSelectedPrinter).toBe(false)
  })
})

describe('P33 printer persistence', () => {
  it('pilihan printer dan paperWidth bertahan setelah reopen', async () => {
    const adapter = createMemoryAdapter()
    const firstPinia = createPinia()
    setActivePinia(firstPinia)

    const service = createPersistenceService({ adapter, pinia: firstPinia })
    await service.initialize()

    const printerStore = usePrinterStore()
    printerStore.selectPrinter(PRINTER)
    printerStore.setPaperWidth('80')
    await service.flush()
    await service.close()

    const reopenedPinia = createPinia()
    setActivePinia(reopenedPinia)
    const reopenedService = createPersistenceService({ adapter, pinia: reopenedPinia })
    await reopenedService.initialize()

    const reopenedStore = usePrinterStore()

    expect(reopenedStore.selectedPrinter).toEqual(PRINTER)
    expect(reopenedStore.paperWidth).toBe('80')
    expect(reopenedStore.hasSelectedPrinter).toBe(true)
  })
})

describe('P33 printer settings UI', () => {
  it('menampilkan status belum memilih printer', async () => {
    const { wrapper } = await mountSettings()

    expect(wrapper.find('[data-testid="printer-settings-card"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="printer-status"]').text()).toBe('Belum memilih printer')
    expect(wrapper.find('[data-testid="printer-address"]').exists()).toBe(false)
  })

  it('menampilkan paired printers dan menyimpan pilihan', async () => {
    listPairedPrintersMock.mockResolvedValue({
      success: true,
      native: true,
      devices: [PRINTER, { name: 'POS-80', address: '11:22:33:44:55:66' }],
    })

    const { wrapper, printerStore } = await mountSettings()

    await wrapper.find('[data-testid="btn-select-printer"]').trigger('click')
    await flushPromises()

    const option = wrapper.find(`[data-testid="printer-device-${PRINTER.address}"]`)
    expect(option.exists()).toBe(true)
    expect(wrapper.find('[data-testid="printer-device-11:22:33:44:55:66"]').exists()).toBe(true)

    await option.trigger('click')
    await flushPromises()

    expect(printerStore.selectedPrinter).toEqual(PRINTER)
    expect(wrapper.find('[data-testid="printer-status"]').text()).toBe('POS-58')
    expect(wrapper.find('[data-testid="printer-address"]').text()).toBe(PRINTER.address)
  })

  it('paper width berubah dari 58 ke 80', async () => {
    const { wrapper, printerStore } = await mountSettings()

    expect(printerStore.paperWidth).toBe('58')

    await wrapper.find('[data-testid="paper-width-80"]').trigger('click')
    await flushPromises()

    expect(printerStore.paperWidth).toBe('80')

    await wrapper.find('[data-testid="paper-width-58"]').trigger('click')
    await flushPromises()

    expect(printerStore.paperWidth).toBe('58')
  })

  it('forget printer mengosongkan pilihan', async () => {
    const { wrapper, printerStore } = await mountSettings()

    printerStore.selectPrinter(PRINTER)
    await flushPromises()

    expect(printerStore.hasSelectedPrinter).toBe(true)

    await wrapper.find('[data-testid="btn-forget-printer"]').trigger('click')
    await flushPromises()

    expect(printerStore.hasSelectedPrinter).toBe(false)
    expect(wrapper.find('[data-testid="printer-status"]').text()).toBe('Belum memilih printer')
  })

  it('menampilkan pesan saat tidak ada paired device', async () => {
    listPairedPrintersMock.mockResolvedValue({ success: true, native: true, devices: [] })

    const { wrapper } = await mountSettings()

    await wrapper.find('[data-testid="btn-select-printer"]').trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-testid="printer-empty-message"]').text()).toContain(
      'Tidak ada printer Bluetooth yang sudah dipairing.',
    )
    expect(wrapper.text()).toContain('Pair printer melalui pengaturan Bluetooth Android terlebih dahulu.')
  })

  it('error permission ditampilkan tanpa crash', async () => {
    listPairedPrintersMock.mockResolvedValue({
      success: false,
      code: 'BLUETOOTH_PERMISSION_DENIED',
      message: 'Izin Bluetooth belum diberikan.',
      devices: [],
    })

    const { wrapper } = await mountSettings()

    await wrapper.find('[data-testid="btn-select-printer"]').trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-testid="printer-feedback"]').text()).toBe('Izin Bluetooth belum diberikan.')
  })

  it('tes print memakai printer terpilih', async () => {
    const { wrapper, printerStore } = await mountSettings()

    printerStore.selectPrinter(PRINTER)
    await flushPromises()

    await wrapper.find('[data-testid="btn-test-print"]').trigger('click')
    await flushPromises()

    expect(printTestReceiptMock).toHaveBeenCalledTimes(1)
    expect(printTestReceiptMock.mock.calls[0][0]).toMatchObject({
      printer: PRINTER,
      paperWidth: '58',
    })
    expect(wrapper.find('[data-testid="printer-feedback"]').text()).toBe(
      'Perintah tes print dikirim ke printer.',
    )
  })

  it('tes print tanpa printer memberi pesan jelas', async () => {
    const { wrapper } = await mountSettings()

    expect(wrapper.find('[data-testid="btn-test-print"]').attributes('disabled')).toBeDefined()

    await wrapper.find('[data-testid="btn-test-print"]').trigger('click')
    await flushPromises()

    expect(printTestReceiptMock).not.toHaveBeenCalled()
  })

  it('tes print dinonaktifkan pada web', async () => {
    printerState.native = false

    const { wrapper, printerStore } = await mountSettings()

    printerStore.selectPrinter(PRINTER)
    await flushPromises()

    expect(wrapper.find('[data-testid="btn-test-print"]').attributes('disabled')).toBeDefined()
    expect(wrapper.text()).toContain('Tes print Bluetooth hanya tersedia di perangkat Android.')
  })
})
