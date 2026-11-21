import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import CartCustomerInput from '@/components/pos/CartCustomerInput.vue'
import DevicePairingModal from '@/components/cloud/DevicePairingModal.vue'
import { createAppRouter } from '@/router'
import { apiRequest } from '@/services/cloud/apiClient'
import {
  PAIRING_ERROR,
  describePairingError,
  pairDeviceWithCode,
} from '@/services/cloud/devicePairingService'
import { createMemoryAdapter } from '@/services/database/memoryAdapter'
import { MIGRATIONS } from '@/services/database/schema'
import {
  createShiftReceiptCommands,
  buildShiftReceiptText,
} from '@/services/printer/escposReceiptBuilder'
import { mapOutboxEntries } from '@/services/sync/contractMapper'
import { createSyncPullService } from '@/services/sync/syncPullService'
import { useBusinessStore } from '@/stores/businessStore'
import { useCartStore } from '@/stores/cartStore'
import { useCashStore } from '@/stores/cashStore'
import { useCashierStore } from '@/stores/cashierStore'
import { useCloudSessionStore } from '@/stores/cloudSessionStore'
import { useProductStore } from '@/stores/productStore'
import { useShiftStore } from '@/stores/shiftStore'
import { useTableStore } from '@/stores/tableStore'
import { useTransactionStore } from '@/stores/transactionStore'
import CloseShiftView from '@/views/shift/CloseShiftView.vue'
import ShiftView from '@/views/shift/ShiftView.vue'
import ReceiptView from '@/views/transactions/ReceiptView.vue'

vi.mock('@/services/cloud/apiClient', () => ({
  apiRequest: vi.fn(),
}))

enableAutoUnmount(afterEach)

describe('6 Core Feature Layers in pos-mobile', () => {
  let pinia
  let router

  beforeEach(() => {
    pinia = createPinia()
    setActivePinia(pinia)
    router = createAppRouter()

    const businessStore = useBusinessStore()
    const cashierStore = useCashierStore()
    businessStore.setBusiness({
      name: 'Kopi Nusantara',
      type: 'Cafe',
      owner: 'Budi',
      phone: '08123456789',
      outlet: 'Outlet Utama',
      mode: 'free',
    })
    cashierStore.setPinConfigured(true)

    vi.clearAllMocks()
  })

  describe('Layer 1: Fitur Nomor Meja (Table Management & Dine-In)', () => {
    it('defines Migration v6 with dining_tables and table_number column in sales', () => {
      const v6Statements = MIGRATIONS[6]
      expect(v6Statements).toBeDefined()
      expect(v6Statements).toContain('CREATE TABLE IF NOT EXISTS dining_tables')
      expect(v6Statements).toContain('ALTER TABLE sales ADD COLUMN table_number')
    })

    it('manages dining tables in tableStore and supports tableNumber in cartStore', () => {
      const tableStore = useTableStore()
      const cartStore = useCartStore()

      tableStore.setTables([
        { id: 'tbl-1', name: 'Meja 01', capacity: 4, status: 'available' },
        { id: 'tbl-2', name: 'VIP 1', capacity: 8, status: 'inactive' },
      ])

      expect(tableStore.tables.length).toBe(2)
      expect(tableStore.availableTables.length).toBe(1)
      expect(tableStore.availableTables[0].name).toBe('Meja 01')

      cartStore.setTableNumber('Meja 01')
      expect(cartStore.tableNumber).toBe('Meja 01')

      cartStore.clearCart()
      expect(cartStore.tableNumber).toBe('')
    })

    it('maps table_number in sync contract push mapper', async () => {
      const adapter = createMemoryAdapter()
      await adapter.initialize()

      const payload = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        subtotal: 50000,
        tax: 0,
        total: 50000,
        paymentMethod: 'cash',
        createdAt: new Date().toISOString(),
        tableNumber: 'Meja 05',
        items: [
          {
            id: 'it-1',
            productId: 'p-1',
            name: 'Item 1',
            qty: 1,
            price: 50000,
            subtotal: 50000,
          },
        ],
      }

      const result = await mapOutboxEntries(
        [
          {
            id: 'q-1',
            entityType: 'transaction',
            entityId: '123e4567-e89b-12d3-a456-426614174000',
            operation: 'upsert',
            payload,
          },
        ],
        { adapter },
      )

      if (result.blocked.length) console.log('MAP BLOCKED:', result.blocked)
      expect(result.changes.sales.length).toBe(1)
      expect(result.changes.sales[0].table_number).toBe('Meja 05')
    })

    it('pulls dining_tables and updates business table_management_enabled in syncPullService', async () => {
      const adapter = createMemoryAdapter()
      await adapter.initialize()

      await adapter.saveSyncPushBinding({
        businessId: 1,
        deviceIdentifier: '123e4567-e89b-12d3-a456-426614174000',
        registeredDeviceId: 55,
        boundAt: new Date().toISOString(),
      })

      const businessStore = useBusinessStore()
      const tableStore = useTableStore()

      const tableUuid = '11111111-1111-4111-8111-111111111111'
      const pullService = createSyncPullService({
        adapter,
        pinia,
        tokenFetcher: async () => 'test-token',
        transport: vi.fn().mockResolvedValue({
          ok: true,
          data: {
            data: {
              records: [
                {
                  entity: 'dining_tables',
                  sync_sequence: 1,
                  data: {
                    sync_id: tableUuid,
                    sync_version: 1,
                    name: 'Meja A1',
                    capacity: 2,
                    status: 'available',
                    sort_order: 1,
                  },
                },
              ],
              next_cursor: 1,
              server_sequence: 1,
              has_more: false,
            },
            table_management_enabled: true,
          },
        }),
      })

      const context = {
        user: { id: 1, email: 'owner@pos.test' },
        selectedBusiness: { id: 1, name: 'Warung Kopi' },
        selectedOutlet: { id: 1, name: 'Main' },
        cloudAccess: true,
        deviceIdentifier: '123e4567-e89b-12d3-a456-426614174000',
        registeredDeviceId: 55,
        role: 'owner',
      }

      const result = await pullService.pullNow({ context })
      expect(result.ok).toBe(true)
      expect(businessStore.tableManagementEnabled).toBe(true)
      expect(tableStore.tables.some((t) => t.id === tableUuid)).toBe(true)
    })
  })

  describe('Layer 2: Nama Pelanggan Bebas (Ad-Hoc Guest Name)', () => {
    it('manages ad-hoc guest customerName in cartStore', () => {
      const cartStore = useCartStore()
      cartStore.setCustomerName('Kak Dimas')
      expect(cartStore.customerName).toBe('Kak Dimas')
      expect(cartStore.customerId).toBeNull()

      cartStore.clearCart()
      expect(cartStore.customerName).toBe('')
    })

    it('provides flexible guest name input tab in CartCustomerInput component', async () => {
      const cartStore = useCartStore()
      const wrapper = mount(CartCustomerInput, {
        props: { inputId: 'cart-customer' },
        global: { plugins: [pinia] },
      })

      const guestTabBtn = wrapper.find('[data-testid="tab-customer-name"]')
      expect(guestTabBtn.exists()).toBe(true)

      await guestTabBtn.trigger('click')
      await flushPromises()

      const guestInput = wrapper.find('[data-testid="cart-customer-name"]')
      expect(guestInput.exists()).toBe(true)

      await guestInput.setValue('Kak Sarah')
      expect(cartStore.customerName).toBe('Kak Sarah')
    })
  })

  describe('Layer 3: Pembatalan Transaksi Selesai (Void) & Perubahan Metode Bayar', () => {
    it('updatePaymentMethod modifies transaction payment method and adjusts cash ledger', () => {
      const txStore = useTransactionStore()
      const cashStore = useCashStore()

      // Create initial cash transaction
      const tx = txStore.createTransaction({
        id: 'tx-test-1',
        total: 100000,
        paymentMethod: 'cash',
        status: 'completed',
        items: [],
      })
      cashStore.recordSalePayment(tx)

      const initialCashIn = cashStore.cashIn
      expect(initialCashIn).toBeGreaterThanOrEqual(100000)

      // Change from cash to QRIS
      const res = txStore.updatePaymentMethod('tx-test-1', 'qris')
      expect(res.success).toBe(true)

      const updatedTx = txStore.items.find((it) => it.id === 'tx-test-1')
      expect(updatedTx.paymentMethod).toBe('qris')
      // Cash ledger should record an 'out' adjustment
      expect(cashStore.cashOut).toBeGreaterThanOrEqual(100000)
    })

    it('voidTransaction cancels transaction, records reason, and restores stock', () => {
      const txStore = useTransactionStore()
      const productStore = useProductStore()
      const cashStore = useCashStore()

      productStore.products = [
        { id: 'p-1', name: 'Kopi Susu', stock: 10, trackStock: true, price: 20000 },
      ]

      const tx = txStore.createTransaction({
        id: 'tx-void-test',
        total: 20000,
        paymentMethod: 'cash',
        status: 'completed',
        items: [{ productId: 'p-1', qty: 2, price: 20000 }],
      })
      cashStore.recordSalePayment(tx)

      const voidRes = txStore.voidTransaction('tx-void-test', 'Pelanggan membatalkan pesanan')
      expect(voidRes.success).toBe(true)

      const voidedTx = txStore.items.find((it) => it.id === 'tx-void-test')
      expect(voidedTx.status).toBe('cancelled')
      expect(voidedTx.voidReason).toBe('Pelanggan membatalkan pesanan')
      expect(voidedTx.cancelledAt).toBeDefined()

      // Stock should have been restored by 2
      const prod = productStore.products.find((p) => p.id === 'p-1')
      expect(prod.stock).toBe(12)
    })

    it('ReceiptView provides interactive modals for changing payment method and voiding', async () => {
      const txStore = useTransactionStore()
      const tx = txStore.createTransaction({
        id: 'tx-receipt-test',
        total: 50000,
        paymentMethod: 'cash',
        status: 'completed',
        items: [],
      })

      await router.push(`/transactions/${tx.id}/receipt`)
      await router.isReady()

      const wrapper = mount(ReceiptView, {
        global: { plugins: [pinia, router] },
      })
      await flushPromises()

      // Change payment modal
      const changePayBtn = wrapper.find('[data-testid="btn-change-payment-method"]')
      expect(changePayBtn.exists()).toBe(true)
      await changePayBtn.trigger('click')
      await flushPromises()

      const edcBtn = wrapper.find('[data-testid="btn-select-payment-edc"]')
      expect(edcBtn.exists()).toBe(true)
      await edcBtn.trigger('click')

      await wrapper.find('[data-testid="btn-confirm-change-payment"]').trigger('click')
      await flushPromises()

      expect(txStore.items.find((it) => it.id === tx.id).paymentMethod).toBe('edc')

      // Void modal
      const voidBtn = wrapper.find('[data-testid="btn-void-transaction"]')
      expect(voidBtn.exists()).toBe(true)
      await voidBtn.trigger('click')
      await flushPromises()

      const voidReasonInput = wrapper.find('[data-testid="input-void-reason"]')
      expect(voidReasonInput.exists()).toBe(true)
      await voidReasonInput.setValue('Pesanan dibatalkan tamu')

      await wrapper.find('[data-testid="btn-confirm-void"]').trigger('click')
      await flushPromises()

      expect(txStore.items.find((it) => it.id === tx.id).status).toBe('cancelled')
      expect(wrapper.find('[data-testid="badge-void-notice"]').exists()).toBe(true)
    })
  })

  describe('Layer 4: Multi-Outlet Pricing & Ketersediaan Cabang', () => {
    it('syncPullService applies outlet_price and respects is_available_in_outlet', async () => {
      const adapter = createMemoryAdapter()
      await adapter.initialize()

      await adapter.saveSyncPushBinding({
        businessId: 1,
        deviceIdentifier: '123e4567-e89b-12d3-a456-426614174000',
        registeredDeviceId: 55,
        boundAt: new Date().toISOString(),
      })

      const productStore = useProductStore()

      const prod1Uuid = '22222222-2222-4222-8222-222222222222'
      const prod2Uuid = '33333333-3333-4333-8333-333333333333'

      const pullService = createSyncPullService({
        adapter,
        pinia,
        tokenFetcher: async () => 'test-token',
        transport: vi.fn().mockResolvedValue({
          ok: true,
          data: {
            data: {
              records: [
                {
                  entity: 'products',
                  sync_sequence: 1,
                  data: {
                    sync_id: prod1Uuid,
                    sync_version: 1,
                    name: 'Americano Cabang',
                    price: 25000,
                    outlet_price: 30000,
                    is_available_in_outlet: 1,
                    status: 'active',
                  },
                },
                {
                  entity: 'products',
                  sync_sequence: 2,
                  data: {
                    sync_id: prod2Uuid,
                    sync_version: 1,
                    name: 'Menu Rahasia Nonaktif Cabang',
                    price: 20000,
                    outlet_price: 20000,
                    is_available_in_outlet: 0,
                    status: 'active',
                  },
                },
              ],
              next_cursor: 2,
              server_sequence: 2,
              has_more: false,
            },
          },
        }),
      })

      const context = {
        user: { id: 1, email: 'owner@pos.test' },
        selectedBusiness: { id: 1, name: 'Warung Kopi' },
        selectedOutlet: { id: 1, name: 'Main' },
        cloudAccess: true,
        deviceIdentifier: '123e4567-e89b-12d3-a456-426614174000',
        registeredDeviceId: 55,
        role: 'owner',
      }

      const res = await pullService.pullNow({ context })
      expect(res.ok).toBe(true)

      const prod1 = productStore.products.find((p) => p.id === prod1Uuid)
      expect(prod1).toBeDefined()
      expect(prod1.price).toBe(30000)

      const prod2 = productStore.products.find((p) => p.id === prod2Uuid)
      expect(prod2).toBeDefined()
      expect(prod2.isActive).toBe(false)

      // In filtered catalog, inactive outlet products should not be visible
      const catalogIds = productStore.filteredProducts.map((p) => p.id)
      expect(catalogIds).toContain(prod1Uuid)
      expect(catalogIds).not.toContain(prod2Uuid)
    })
  })

  describe('Layer 5: Penyesuaian Rekonsiliasi Tutup Shift (Discrepancy)', () => {
    it('CloseShiftView displays formula and enforces notes when discrepancy exists', async () => {
      const shiftStore = useShiftStore()
      const cashierStore = useCashierStore()

      shiftStore.isOpen = true
      shiftStore.openingBalance = 100000
      shiftStore.openedAt = new Date().toISOString()
      cashierStore.activeCashier = { id: 1, name: 'Budi' }

      const wrapper = mount(CloseShiftView, {
        global: { plugins: [pinia, router] },
      })
      await flushPromises()

      // Formula display
      expect(wrapper.find('[data-testid="reconciliation-formula"]').text()).toContain(
        'Estimasi Kas = Kas Awal + Penjualan Tunai + Kas Masuk - Kas Keluar',
      )

      // Enter physical cash that produces a discrepancy (e.g. 90.000 vs expected 100.000)
      const input = wrapper.find('[data-testid="input-physical-cash"] input')
      await input.setValue('90000')
      await flushPromises()

      const closeBtn = wrapper.find('[data-testid="btn-execute-close"]')
      expect(closeBtn.attributes('disabled')).toBeDefined()
      expect(wrapper.find('[data-testid="error-notes-required"]').exists()).toBe(true)

      // Fill reason notes
      const notesInput = wrapper.find('[data-testid="input-close-shift-notes"]')
      await notesInput.setValue('Selisih Rp 10.000 karena kasir salah kembalian')
      await flushPromises()

      expect(closeBtn.attributes('disabled')).toBeUndefined()

      await closeBtn.trigger('click')
      await flushPromises()

      expect(shiftStore.isOpen).toBe(false)
      expect(shiftStore.notes).toBe('Selisih Rp 10.000 karena kasir salah kembalian')
      expect(wrapper.find('[data-testid="btn-print-shift-receipt"]').exists()).toBe(true)
    })

    it('ESC/POS shift receipt outputs full financial reconciliation with discrepancy', () => {
      const commands = createShiftReceiptCommands({
        shiftSummary: {
          cashier: 'Budi',
          openedAt: '2026-11-20T08:00:00.000Z',
          closedAt: '2026-11-20T16:00:00.000Z',
          openingBalance: 100000,
          cashSales: 500000,
          nonCashSales: 200000,
          totalOmzet: 700000,
          totalTransactions: 15,
          manualCashIn: 50000,
          manualCashOut: 20000,
          expectedCash: 630000,
          actualCash: 620000,
          difference: -10000,
          notes: 'Selisih kembalian',
        },
      })

      const text = buildShiftReceiptText({
        shiftSummary: {
          cashier: 'Budi',
          openingBalance: 100000,
          cashSales: 500000,
          nonCashSales: 200000,
          totalOmzet: 700000,
          manualCashIn: 50000,
          manualCashOut: 20000,
          expectedCash: 630000,
          actualCash: 620000,
          difference: -10000,
          notes: 'Selisih kembalian',
        },
      })

      expect(text).toContain('REKAP TUTUP SHIFT (Z-REPORT)')
      expect(text).toContain('RINGKASAN KAS')
      expect(text).toContain('Saldo Awal')
      expect(text).toContain('Estimasi Kas Laci')
      expect(text).toContain('Uang Fisik Aktual')
      expect(text).toContain('Selisih Kas')
      expect(text).toContain('Catatan / Alasan Selisih:')
    })
  })

  describe('Layer 6: Batas Kuota Perangkat pada Layar Pairing (DEVICE_LIMIT_EXCEEDED)', () => {
    it('describes DEVICE_LIMIT_EXCEEDED with educational Indonesian message', () => {
      const msg = describePairingError(PAIRING_ERROR.DEVICE_LIMIT_EXCEEDED)
      expect(msg).toContain('Batas perangkat terhubung untuk bisnis ini telah mencapai batas maksimal')
      expect(msg).toContain('menambah batas perangkat di dashboard')
    })

    it('handles HTTP 403 DEVICE_LIMIT_EXCEEDED in devicePairingService', async () => {
      apiRequest.mockResolvedValueOnce({
        ok: false,
        status: 403,
        error: {
          code: 'DEVICE_LIMIT_EXCEEDED',
          message: 'Device quota full',
        },
      })

      const res = await pairDeviceWithCode({
        code: '1234',
        deviceName: 'Kasir 1',
        businessId: 10,
        deviceIdentifier: 'dev-12345',
        token: 'test-token',
      })

      expect(res.ok).toBe(false)
      expect(res.error.code).toBe(PAIRING_ERROR.DEVICE_LIMIT_EXCEEDED)
      expect(res.error.message).toContain('Batas perangkat terhubung untuk bisnis ini telah mencapai batas maksimal')
    })

    it('shows educational error message in DevicePairingModal when limit is exceeded', async () => {
      const cloudStore = useCloudSessionStore()
      cloudStore.deviceIdentifier = 'mock-dev-id'
      cloudStore.pairDeviceWithCode = vi.fn().mockResolvedValue({
        ok: false,
        code: 'DEVICE_LIMIT_EXCEEDED',
        status: 403,
        message: 'Batas perangkat terhubung untuk bisnis ini telah mencapai batas maksimal. Silakan minta pemilik bisnis menambah batas perangkat di dashboard.',
      })

      const wrapper = mount(DevicePairingModal, {
        props: { open: true, businessName: 'Toko Kopi' },
        global: { plugins: [pinia] },
      })
      await flushPromises()

      const input = wrapper.find('[data-testid="pairing-code-input"]')
      await input.setValue('8888')

      const submitBtn = wrapper.find('[data-testid="pairing-submit"]')
      await submitBtn.trigger('submit')
      await flushPromises()

      const errorAlert = wrapper.find('[data-testid="pairing-error"]')
      expect(errorAlert.exists()).toBe(true)
      expect(errorAlert.text()).toContain('Batas perangkat terhubung untuk bisnis ini telah mencapai batas maksimal')
    })
  })
})
