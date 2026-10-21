import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { describe, expect, it } from 'vitest'

import { createAppRouter } from '@/router'
import { useBusinessStore } from '@/stores/businessStore'
import { useCashierStore } from '@/stores/cashierStore'
import { useCashStore } from '@/stores/cashStore'
import { formatCurrency } from '@/utils/formatters'
import CashView from '@/views/cash/CashView.vue'

function setupContext() {
  const pinia = createPinia()
  setActivePinia(pinia)
  const router = createAppRouter()
  const businessStore = useBusinessStore()
  const cashierStore = useCashierStore()
  const cashStore = useCashStore()

  businessStore.setBusiness({
    name: 'Kopi Nusantara',
    type: 'Cafe',
    owner: 'Owner',
    phone: '08123456789',
    outlet: 'Outlet Utama',
    mode: 'cloud',
  })
  cashierStore.setPinConfigured(true)

  return { pinia, router, businessStore, cashierStore, cashStore }
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
})
