import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createRouter, createWebHistory } from 'vue-router'

import ActiveOrdersSheet from '@/components/pos/ActiveOrdersSheet.vue'
import PaymentSuccessModal from '@/components/payment/PaymentSuccessModal.vue'
import { useBusinessStore } from '@/stores/businessStore'
import { useTransactionStore } from '@/stores/transactionStore'
import PosView from '@/views/pos/PosView.vue'
import PaymentView from '@/views/payment/PaymentView.vue'

function createTestRouter() {
  return createRouter({
    history: createWebHistory(),
    routes: [
      { path: '/', redirect: '/pos' },
      { path: '/pos', component: PosView },
      { path: '/payment', component: PaymentView },
      { path: '/transactions', component: { template: '<div>Transactions</div>' } },
      { path: '/transactions/:id', component: { template: '<div>Transaction Detail</div>' } },
      { path: '/transactions/:id/receipt', component: { template: '<div>Receipt</div>' } },
    ],
  })
}

describe('UX Antrean Pesanan Berjalan (Kombinasi 1 & 2)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('PaymentSuccessModal menyediakan tombol Selesai & Tandai Siap serta Antrean Pesanan', async () => {
    const wrapper = mount(PaymentSuccessModal, {
      props: {
        open: true,
        summary: {
          id: 'trx-101',
          invoiceNumber: 'INV-TEST-001',
          total: 25000,
          paymentMethod: 'cash',
          cashReceived: 25000,
          changeAmount: 0,
        },
      },
    })

    const readyBtn = wrapper.find('[data-testid="success-complete-ready"]')
    expect(readyBtn.exists()).toBe(true)
    expect(readyBtn.text()).toContain('Selesai & Tandai Siap')

    await readyBtn.trigger('click')
    expect(wrapper.emitted('complete-ready')).toBeTruthy()

    const queueBtn = wrapper.find('[data-testid="success-view-transactions"]')
    expect(queueBtn.exists()).toBe(true)
    expect(queueBtn.text()).toContain('Antrean Pesanan')

    await queueBtn.trigger('click')
    expect(wrapper.emitted('view-transactions')).toBeTruthy()
  })

  it('PosView menampilkan badge antrean saat ada pesanan proses dan membuka ActiveOrdersSheet', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const router = createTestRouter()
    await router.push('/pos')

    const trxStore = useTransactionStore()
    trxStore.addTransaction({
      id: 'trx-proses-1',
      invoiceNumber: 'INV-PROSES-01',
      customer: 'Budi',
      items: [{ id: 1, name: 'Americano', price: 18000, qty: 1 }],
      total: 18000,
      orderStatus: 'Proses',
      paymentStatus: 'paid',
      createdAt: new Date().toISOString(),
    })

    const wrapper = mount(PosView, {
      global: { plugins: [pinia, router] },
    })
    await flushPromises()

    const activeBtn = wrapper.find('[data-testid="pos-active-orders-button"]')
    expect(activeBtn.exists()).toBe(true)
    expect(activeBtn.text()).toContain('1 Antrean')

    // Klik tombol antrean untuk membuka sheet
    await activeBtn.trigger('click')
    await flushPromises()

    const sheet = wrapper.findComponent(ActiveOrdersSheet)
    expect(sheet.exists()).toBe(true)
    expect(sheet.props('open')).toBe(true)
  })

  it('ActiveOrdersSheet dapat menandai pesanan Siap dengan 1 klik', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const router = createTestRouter()
    await router.push('/pos')

    const trxStore = useTransactionStore()
    trxStore.addTransaction({
      id: 'trx-proses-2',
      invoiceNumber: 'INV-PROSES-02',
      customer: 'Siti',
      items: [{ id: 2, name: 'Latte', price: 24000, qty: 1 }],
      total: 24000,
      orderStatus: 'Proses',
      paymentStatus: 'paid',
      createdAt: new Date().toISOString(),
    })

    const wrapper = mount(ActiveOrdersSheet, {
      props: { open: true },
      global: { plugins: [pinia, router] },
    })
    await flushPromises()

    expect(wrapper.text()).toContain('INV-PROSES-02')
    expect(wrapper.text()).toContain('Siti')
    expect(wrapper.text()).toContain('Latte')

    // Klik Tandai Siap
    const readyButtons = wrapper.findAll('button')
    const markReadyBtn = readyButtons.find((btn) => btn.text().includes('Tandai Siap'))
    expect(markReadyBtn).toBeDefined()

    await markReadyBtn.trigger('click')
    await flushPromises()

    // Status order di store berubah menjadi Siap
    const updated = trxStore.items.find((item) => item.id === 'trx-proses-2')
    expect(updated.orderStatus).toBe('Siap')

    // Pesanan hilang dari antrean aktif
    await flushPromises()
    expect(wrapper.text()).toContain('Tidak Ada Antrean Berjalan')
  })

  it('ActiveOrdersSheet menyediakan tombol Edit untuk pesanan aktif', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const router = createTestRouter()
    await router.push('/pos')

    const trxStore = useTransactionStore()
    trxStore.addTransaction({
      id: 'trx-proses-3',
      invoiceNumber: 'INV-PROSES-03',
      customer: 'Rian',
      items: [{ id: 3, name: 'Cappuccino', price: 22000, qty: 1 }],
      total: 22000,
      orderStatus: 'Proses',
      paymentStatus: 'paid',
      createdAt: new Date().toISOString(),
    })

    const wrapper = mount(ActiveOrdersSheet, {
      props: { open: true },
      global: { plugins: [pinia, router] },
    })
    await flushPromises()

    const btnEdit = wrapper.find('[data-testid="btn-sheet-edit-order"]')
    expect(btnEdit.exists()).toBe(true)

    await btnEdit.trigger('click')
    await flushPromises()

    // Navigasi ke detail transaksi dengan query edit=items
    expect(router.currentRoute.value.path).toBe('/transactions/trx-proses-3')
    expect(router.currentRoute.value.query.edit).toBe('items')
  })
})
