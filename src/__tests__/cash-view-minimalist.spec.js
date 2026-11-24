import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { describe, expect, it, vi } from 'vitest'

import { createAppRouter } from '@/router'
import { createSyncChangeTracker } from '@/services/sync/syncTracker'
import { useBusinessStore } from '@/stores/businessStore'
import { useCashierStore } from '@/stores/cashierStore'
import { useCashStore } from '@/stores/cashStore'
import { useCloudSessionStore } from '@/stores/cloudSessionStore'
import { formatCurrency } from '@/utils/formatters'
import CashView from '@/views/cash/CashView.vue'

function setupContext() {
  const pinia = createPinia()
  setActivePinia(pinia)
  const router = createAppRouter()
  const businessStore = useBusinessStore()
  const cashierStore = useCashierStore()
  const cashStore = useCashStore()
  const cloudStore = useCloudSessionStore()

  businessStore.setBusiness({
    name: 'Kopi Nusantara',
    type: 'Cafe',
    owner: 'Owner',
    phone: '08123456789',
    outlet: 'Outlet Utama',
    mode: 'cloud',
  })
  cashierStore.setPinConfigured(true)

  return { pinia, router, businessStore, cashierStore, cashStore, cloudStore }
}

describe('CashView Minimalist UI', () => {
  it('menampilkan ringkasan saldo berjalan, kas masuk, dan kas keluar dalam 1 hero card minimalis', async () => {
    const { pinia, router, cashStore } = setupContext()

    cashStore.recordEntry({
      type: 'in',
      amount: 100000,
      category: 'Modal Awal',
      note: 'Modal kasir',
    })
    cashStore.recordEntry({
      type: 'out',
      amount: 25000,
      category: 'Bahan Baku',
      note: 'Beli es batu',
    })

    await router.push('/cash')
    await flushPromises()

    const wrapper = mount(CashView, {
      global: { plugins: [pinia, router] },
    })

    // Saldo berjalan (100.000 - 25.000 = 75.000)
    expect(wrapper.text()).toContain('Saldo Berjalan')
    expect(wrapper.text()).toContain(formatCurrency(75000))

    // Kas Masuk Hari Ini (100.000)
    expect(wrapper.text()).toContain('Kas Masuk Hari Ini')
    expect(wrapper.text()).toContain(formatCurrency(100000))

    // Kas Keluar Hari Ini (25.000)
    expect(wrapper.text()).toContain('Kas Keluar Hari Ini')
    expect(wrapper.text()).toContain(formatCurrency(25000))

    // Riwayat Kas list
    expect(wrapper.text()).toContain('Riwayat Kas')
    expect(wrapper.text()).toContain('Modal Awal')
    expect(wrapper.text()).toContain('Beli es batu')
  })

  it('dapat membuka modal pencatatan kas dan mencatat transaksi kas baru', async () => {
    const { pinia, router, cashStore } = setupContext()

    await router.push('/cash')
    await flushPromises()

    const wrapper = mount(CashView, {
      global: { plugins: [pinia, router] },
    })

    // Click "+ Kas Masuk" button
    const kasMasukBtn = wrapper.findAll('button').find((b) => b.text().includes('Kas Masuk'))
    expect(kasMasukBtn).toBeDefined()
    await kasMasukBtn.trigger('click')

    // Form inputs
    const nominalInput = wrapper.find('input[type="number"]')
    expect(nominalInput.exists()).toBe(true)
    await nominalInput.setValue('50000')

    // Submit
    const submitBtn = wrapper.findAll('button').find((b) => b.text().includes('Catat Kas Masuk'))
    expect(submitBtn).toBeDefined()
    await submitBtn.trigger('click')
    await flushPromises()

    // Verifikasi transaksi masuk ke cashStore
    expect(cashStore.entries.length).toBe(1)
    expect(cashStore.entries[0].amount).toBe(50000)
    expect(cashStore.entries[0].type).toBe('in')
    expect(wrapper.text()).toContain('Transaksi kas berhasil dicatat.')
  })

  it('dapat memfilter riwayat kas berdasarkan Kas Masuk dan Kas Keluar', async () => {
    const { pinia, router, cashStore } = setupContext()

    cashStore.recordEntry({
      type: 'in',
      amount: 40000,
      category: 'Setoran Tambahan',
    })
    cashStore.recordEntry({
      type: 'out',
      amount: 15000,
      category: 'Listrik & Air',
    })

    await router.push('/cash')
    await flushPromises()

    const wrapper = mount(CashView, {
      global: { plugins: [pinia, router] },
    })

    // Initially both appear in ledger
    expect(wrapper.text()).toContain('Setoran Tambahan')
    expect(wrapper.text()).toContain('Listrik & Air')

    // Filter to Kas Keluar only
    const kasKeluarFilterBtn = wrapper.findAll('button').find((b) => b.text().trim() === 'Kas Keluar')
    await kasKeluarFilterBtn.trigger('click')

    expect(wrapper.text()).toContain('Listrik & Air')
    expect(wrapper.text()).not.toContain('Setoran Tambahan')
  })

  it('menyembunyikan tombol entry kas dan menampilkan banner kunci ketika role kasir login', async () => {
    const { pinia, router, cloudStore } = setupContext()
    cloudStore.role = 'cashier'

    await router.push('/cash')
    await flushPromises()

    const wrapper = mount(CashView, {
      global: { plugins: [pinia, router] },
    })

    // Tombol Masuk / Keluar tidak ada
    expect(wrapper.find('[data-testid="cash-in-action-btn"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="cash-out-action-btn"]').exists()).toBe(false)

    // FAB tombol catat kas tidak ada
    expect(wrapper.find('[data-testid="cash-open-modal"]').exists()).toBe(false)

    // Banner kunci tampil
    const lockedBanner = wrapper.find('[data-testid="cashier-entry-locked-banner"]')
    expect(lockedBanner.exists()).toBe(true)
    expect(lockedBanner.text()).toContain('Peran Kasir hanya dapat melihat ringkasan kas')
  })

  it('mencegah role kasir membuka modal atau mencatat kas manual', async () => {
    const { pinia, router, cashStore, cloudStore } = setupContext()
    cloudStore.role = 'cashier'

    await router.push('/cash')
    await flushPromises()

    const wrapper = mount(CashView, {
      global: { plugins: [pinia, router] },
    })

    // Panggil openRecordModal langsung dari vm
    wrapper.vm.openRecordModal('in')
    expect(wrapper.vm.showRecordSheet).toBe(false)

    // Panggil handleManualCash langsung dari vm
    wrapper.vm.cashForm = { type: 'in', amount: '50000', category: 'Modal', note: '' }
    wrapper.vm.handleManualCash()
    expect(wrapper.vm.cashError).toContain('Peran Kasir tidak diizinkan')
    expect(cashStore.entries.length).toBe(0)
  })

  it('tidak mengantrekan entry kas manual ke sync outbox saat role kasir', async () => {
    const { pinia, businessStore, cashStore, cloudStore } = setupContext()
    businessStore.mode = 'cloud'
    cloudStore.role = 'cashier'

    const enqueued = []
    const queueService = {
      enqueueUpsert: vi.fn(async (type, id, payload) => {
        enqueued.push({ type, id, payload })
      }),
      enqueueDelete: vi.fn(async () => {}),
    }

    createSyncChangeTracker({
      pinia,
      queueService,
      stores: { businessStore, cashStore, cloudSessionStore: cloudStore },
    })

    // Catat kas manual / opening balance tanpa transactionId
    cashStore.recordOpeningBalance(150000, 'shift-1')
    expect(enqueued.length).toBe(0)

    // Catat kas pembayaran penjualan (dengan transactionId)
    cashStore.recordSalePayment({
      id: 'tx-123',
      total: 50000,
      paymentMethod: 'cash',
      invoiceNumber: 'INV-001',
      createdAt: new Date().toISOString(),
    })
    expect(enqueued.length).toBe(1)
    expect(enqueued[0].type).toBe('cash_entry')
    expect(enqueued[0].payload.transactionId).toBe('tx-123')
  })
})
