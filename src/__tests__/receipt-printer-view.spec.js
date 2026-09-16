import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createAppRouter } from '@/router'
import { useBusinessStore } from '@/stores/businessStore'
import { useCashierStore } from '@/stores/cashierStore'
import { usePrinterStore } from '@/stores/printerStore'
import { useTransactionStore } from '@/stores/transactionStore'
import ReceiptView from '@/views/transactions/ReceiptView.vue'

const { printReceiptMock, printerState } = vi.hoisted(() => ({
  printReceiptMock: vi.fn(),
  printerState: { native: false },
}))

vi.mock('@/services/printer/bluetoothPrinterService', async (importOriginal) => {
  const actual = await importOriginal()

  return {
    ...actual,
    isNativePrinterPlatform: () => printerState.native,
    printReceipt: (...args) => printReceiptMock(...args),
  }
})

const PRINTER = { name: 'POS-58', address: 'AA:BB:CC:DD:EE:FF' }

function createContext() {
  const pinia = createPinia()
  setActivePinia(pinia)

  return {
    pinia,
    router: createAppRouter(),
    businessStore: useBusinessStore(),
    cashierStore: useCashierStore(),
    printerStore: usePrinterStore(),
    transactionStore: useTransactionStore(),
  }
}

async function mountReceiptView() {
  const context = createContext()

  context.businessStore.setBusiness({
    name: 'Toko ABC',
    type: 'Cafe',
    owner: 'Admin',
    phone: '08123456789',
    outlet: 'Outlet Utama',
    mode: 'free',
  })
  context.cashierStore.setPinConfigured(true)
  context.transactionStore.addTransaction({
    id: 'trx-print-1',
    invoiceNumber: 'INV-PRINT-001',
    customer: 'Budi',
    items: [{ id: 1, name: 'Es Kopi Susu', price: 22000, qty: 1 }],
    subtotal: 22000,
    tax: 0,
    total: 22000,
    paymentMethod: 'cash',
    cashReceived: 50000,
    changeAmount: 28000,
    createdAt: '2026-09-16T03:30:00.000Z',
  })

  await context.router.push('/transactions/trx-print-1/receipt')
  await flushPromises()

  const wrapper = mount(ReceiptView, {
    global: {
      plugins: [context.pinia, context.router],
    },
  })

  return { wrapper, ...context }
}

beforeEach(() => {
  printerState.native = false
  printReceiptMock.mockReset()
  printReceiptMock.mockImplementation(async () => ({ success: true, mode: 'browser' }))
})

describe('P33 receipt view printing', () => {
  it('web tetap memakai jalur cetak browser', async () => {
    const { wrapper } = await mountReceiptView()

    await wrapper.find('[data-testid="btn-print-receipt"]').trigger('click')
    await flushPromises()

    expect(printReceiptMock).toHaveBeenCalledTimes(1)
    expect(wrapper.find('[data-testid="print-error"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="print-feedback"]').exists()).toBe(false)
  })

  it('native tanpa printer menampilkan pesan dan tautan Atur Printer', async () => {
    printerState.native = true

    const { wrapper, router } = await mountReceiptView()
    const pushSpy = vi.spyOn(router, 'push')

    await wrapper.find('[data-testid="btn-print-receipt"]').trigger('click')
    await flushPromises()

    expect(printReceiptMock).not.toHaveBeenCalled()
    expect(wrapper.find('[data-testid="print-error"]').text()).toContain(
      'Printer Bluetooth belum dipilih.',
    )

    await wrapper.find('[data-testid="link-configure-printer"]').trigger('click')

    expect(pushSpy).toHaveBeenCalledWith('/settings')
  })

  it('native dengan printer mengirim struk dan menampilkan feedback sukses', async () => {
    printerState.native = true
    printReceiptMock.mockImplementation(async () => ({ success: true, mode: 'native' }))

    const { wrapper, printerStore } = await mountReceiptView()

    printerStore.selectPrinter(PRINTER)
    printerStore.setPaperWidth('80')
    await flushPromises()

    await wrapper.find('[data-testid="btn-print-receipt"]').trigger('click')
    await flushPromises()

    expect(printReceiptMock).toHaveBeenCalledTimes(1)
    expect(printReceiptMock.mock.calls[0][0]).toMatchObject({
      printer: PRINTER,
      paperWidth: '80',
    })
    expect(wrapper.find('[data-testid="print-feedback"]').text()).toBe(
      'Struk berhasil dikirim ke printer.',
    )
  })

  it('native gagal menampilkan pesan error ternormalisasi', async () => {
    printerState.native = true
    printReceiptMock.mockImplementation(async () => ({
      success: false,
      code: 'PRINTER_CONNECT_FAILED',
      message: 'Tidak dapat terhubung ke printer.',
    }))

    const { wrapper, printerStore } = await mountReceiptView()

    printerStore.selectPrinter(PRINTER)
    await flushPromises()

    await wrapper.find('[data-testid="btn-print-receipt"]').trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-testid="print-error"]').text()).toContain(
      'Tidak dapat terhubung ke printer.',
    )
    expect(wrapper.find('[data-testid="print-feedback"]').exists()).toBe(false)
  })

  it('double tap tidak mengirim dua print bersamaan', async () => {
    printerState.native = true

    let resolvePrint
    printReceiptMock.mockImplementation(() => new Promise((resolve) => {
      resolvePrint = () => resolve({ success: true, mode: 'native' })
    }))

    const { wrapper, printerStore } = await mountReceiptView()

    printerStore.selectPrinter(PRINTER)
    await flushPromises()

    const printButton = wrapper.find('[data-testid="btn-print-receipt"]')

    await printButton.trigger('click')
    expect(printButton.text()).toBe('Mencetak...')
    expect(printButton.attributes('disabled')).toBeDefined()

    await printButton.trigger('click')
    expect(printReceiptMock).toHaveBeenCalledTimes(1)

    resolvePrint()
    await flushPromises()

    expect(wrapper.find('[data-testid="btn-print-receipt"]').text()).toBe('Print')
  })
})
