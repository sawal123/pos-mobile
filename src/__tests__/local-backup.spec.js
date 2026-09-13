import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { describe, expect, it, vi, afterEach } from 'vitest'

import { createAppRouter } from '@/router'
import {
  BACKUP_SCHEMA,
  BACKUP_VERSION,
  RESTORE_CONFIRMATION_MESSAGE,
  createBackupPayload,
  downloadBackupFile,
  restoreBackupPayload,
  validateBackupPayload,
} from '@/services/backupService'
import { useBusinessStore } from '@/stores/businessStore'
import { useCartStore } from '@/stores/cartStore'
import { useCashierStore } from '@/stores/cashierStore'
import { useCustomerStore } from '@/stores/customerStore'
import { useExpenseStore } from '@/stores/expenseStore'
import { useProductStore } from '@/stores/productStore'
import { useShiftStore } from '@/stores/shiftStore'
import { useTransactionStore } from '@/stores/transactionStore'
import SettingsView from '@/views/settings/SettingsView.vue'

function createContext() {
  const pinia = createPinia()
  setActivePinia(pinia)

  return {
    pinia,
    router: createAppRouter(),
    businessStore: useBusinessStore(),
    cartStore: useCartStore(),
    cashierStore: useCashierStore(),
    customerStore: useCustomerStore(),
    expenseStore: useExpenseStore(),
    productStore: useProductStore(),
    shiftStore: useShiftStore(),
    transactionStore: useTransactionStore(),
  }
}

function makeBusinessReady(businessStore, overrides = {}) {
  businessStore.setBusiness({
    name: 'Toko ABC',
    type: 'Cafe',
    owner: 'Budi',
    phone: '08123456789',
    outlet: 'Outlet Utama',
    mode: 'cloud',
    ...overrides,
  })
}

function seedStores(context) {
  makeBusinessReady(context.businessStore)
  context.cashierStore.setPinConfigured(true)
  context.productStore.$patch({
    products: [
      { id: 'p-1', name: 'Es Kopi Susu', category: 'Minuman', price: 22000, stock: 18, isActive: true },
      { id: 'p-2', name: 'Croissant Butter', category: 'Makanan', price: 25000, stock: 9, isActive: false },
    ],
    categories: ['Minuman', 'Makanan'],
    selectedCategory: 'Minuman',
    searchQuery: 'kopi',
  })
  context.customerStore.$patch({
    customers: [
      { id: 'c-1', name: 'Budi', phone: '081234567890', email: 'budi@email.com' },
    ],
  })
  context.expenseStore.$patch({
    expenses: [
      {
        id: 'e-1',
        title: 'Listrik',
        category: 'Operasional',
        amount: 150000,
        note: 'Tagihan bulanan',
        createdAt: '2026-08-21T07:00:00.000Z',
      },
    ],
  })
  context.transactionStore.$patch({
    items: [
      {
        id: 'trx-1',
        invoiceNumber: 'INV-123',
        customer: 'Budi',
        customerId: 'c-1',
        customerSnapshot: {
          id: 'c-1',
          name: 'Budi',
          phone: '081234567890',
          email: 'budi@email.com',
        },
        businessSnapshot: {
          name: 'Toko ABC',
          outlet: 'Outlet Utama',
          phone: '08123456789',
        },
        status: 'paid',
        items: [
          { id: 'p-1', name: 'Es Kopi Susu', price: 22000, qty: 1 },
        ],
        itemCount: 1,
        subtotal: 22000,
        tax: 2420,
        total: 24420,
        paymentMethod: 'cash',
        cashReceived: 50000,
        changeAmount: 25580,
        createdAt: '2026-08-21T08:00:00.000Z',
      },
    ],
    lastTransaction: {
      id: 'trx-last',
      invoiceNumber: 'INV-LAST',
    },
  })
  context.cartStore.$patch({
    items: [
      { id: 'p-cart', name: 'Americano', price: 18000, qty: 1 },
    ],
  })
}

function makeValidBackup(overrides = {}) {
  const base = {
    schema: BACKUP_SCHEMA,
    version: BACKUP_VERSION,
    exportedAt: '2026-08-21T07:00:00.000Z',
    data: {
      business: {
        name: 'Toko Backup',
        type: 'Cafe',
        owner: 'Sari',
        phone: '081111111111',
        outlet: 'Outlet Backup',
      },
      products: {
        products: [
          { id: 'p-backup', name: 'Latte', category: 'Minuman', price: 28000, stock: 10, isActive: true },
        ],
        categories: ['Minuman'],
      },
      customers: [
        { id: 'c-backup', name: 'Nadia', phone: '081222222222', email: 'nadia@email.com' },
      ],
      expenses: [
        {
          id: 'e-backup',
          title: 'Gas',
          category: 'Operasional',
          amount: 90000,
          note: 'Isi ulang',
          createdAt: '2026-08-21T09:00:00.000Z',
        },
      ],
      transactions: [
        {
          id: 'trx-backup',
          invoiceNumber: 'INV-BACKUP',
          customer: 'Nadia',
          customerId: 'c-backup',
          customerSnapshot: {
            id: 'c-backup',
            name: 'Nadia',
            phone: '081222222222',
            email: 'nadia@email.com',
          },
          businessSnapshot: {
            name: 'Toko Backup',
            outlet: 'Outlet Backup',
            phone: '081111111111',
          },
          status: 'paid',
          items: [
            { id: 'p-backup', name: 'Latte', price: 28000, qty: 2 },
          ],
          itemCount: 2,
          subtotal: 56000,
          tax: 6160,
          total: 62160,
          paymentMethod: 'qris',
          cashReceived: null,
          changeAmount: null,
          createdAt: '2026-08-21T10:00:00.000Z',
        },
      ],
    },
  }

  const payload = { ...base, ...overrides, data: { ...base.data, ...overrides.data } }

  return typeof globalThis.structuredClone === 'function'
    ? globalThis.structuredClone(payload)
    : JSON.parse(JSON.stringify(payload))
}

function snapshotState(context) {
  return JSON.stringify({
    business: {
      name: context.businessStore.name,
      type: context.businessStore.type,
      owner: context.businessStore.owner,
      phone: context.businessStore.phone,
      outlet: context.businessStore.outlet,
      mode: context.businessStore.mode,
    },
    products: context.productStore.products,
    categories: context.productStore.categories,
    selectedCategory: context.productStore.selectedCategory,
    searchQuery: context.productStore.searchQuery,
    customers: context.customerStore.customers,
    expenses: context.expenseStore.expenses,
    transactions: context.transactionStore.items,
    lastTransaction: context.transactionStore.lastTransaction,
    cart: context.cartStore.items,
    shift: {
      isOpen: context.shiftStore.isOpen,
      openingBalance: context.shiftStore.openingBalance,
      openedAt: context.shiftStore.openedAt,
    },
  })
}

async function mountSettings() {
  const context = createContext()
  seedStores(context)

  await context.router.push('/settings')
  await flushPromises()

  const wrapper = mount(SettingsView, {
    global: {
      plugins: [context.pinia, context.router],
    },
  })

  return { wrapper, ...context }
}

function getButtonByText(wrapper, label) {
  return wrapper.findAll('button').find((button) => button.text().includes(label))
}

async function openSettingsSheet(wrapper) {
  await getButtonByText(wrapper, 'Aksi Lainnya').trigger('click')
  await flushPromises()
}

async function uploadBackupFile(wrapper, fileLike) {
  const input = wrapper.find('input[type="file"]')
  Object.defineProperty(input.element, 'files', {
    configurable: true,
    value: [fileLike],
  })
  await input.trigger('change')
  await flushPromises()
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('P7 local backup & restore JSON', () => {
  it('backup menghasilkan schema yang benar', () => {
    const context = createContext()
    seedStores(context)

    expect(createBackupPayload(context).schema).toBe(BACKUP_SCHEMA)
  })

  it('backup menghasilkan version 1', () => {
    const context = createContext()
    seedStores(context)

    expect(createBackupPayload(context).version).toBe(1)
  })

  it('exportedAt valid ISO date', () => {
    const context = createContext()
    seedStores(context)

    const payload = createBackupPayload(context)

    expect(Number.isNaN(new Date(payload.exportedAt).getTime())).toBe(false)
  })

  it('business profile masuk backup', () => {
    const context = createContext()
    seedStores(context)

    expect(createBackupPayload(context).data.business).toEqual({
      name: 'Toko ABC',
      type: 'Cafe / UMKM',
      owner: 'Budi',
      phone: '08123456789',
      outlet: 'Outlet Utama',
    })
  })

  it('business mode tidak masuk backup', () => {
    const context = createContext()
    seedStores(context)

    expect(createBackupPayload(context).data.business.mode).toBeUndefined()
  })

  it('products masuk backup', () => {
    const context = createContext()
    seedStores(context)

    expect(createBackupPayload(context).data.products.products).toHaveLength(2)
  })

  it('categories masuk backup', () => {
    const context = createContext()
    seedStores(context)

    expect(createBackupPayload(context).data.products.categories).toEqual(['Minuman', 'Makanan'])
  })

  it('selectedCategory tidak masuk backup', () => {
    const context = createContext()
    seedStores(context)

    expect(createBackupPayload(context).data.products.selectedCategory).toBeUndefined()
  })

  it('searchQuery tidak masuk backup', () => {
    const context = createContext()
    seedStores(context)

    expect(createBackupPayload(context).data.products.searchQuery).toBeUndefined()
  })

  it('customers masuk backup', () => {
    const context = createContext()
    seedStores(context)

    expect(createBackupPayload(context).data.customers).toHaveLength(1)
  })

  it('expenses masuk backup', () => {
    const context = createContext()
    seedStores(context)

    expect(createBackupPayload(context).data.expenses).toHaveLength(1)
  })

  it('transactions masuk backup', () => {
    const context = createContext()
    seedStores(context)

    expect(createBackupPayload(context).data.transactions).toHaveLength(1)
  })

  it('transaction nested snapshots ikut backup', () => {
    const context = createContext()
    seedStores(context)

    const transaction = createBackupPayload(context).data.transactions[0]

    expect(transaction.customerSnapshot).toEqual({
      id: 'c-1',
      name: 'Budi',
      phone: '081234567890',
      email: 'budi@email.com',
    })
    expect(transaction.businessSnapshot).toEqual({
      name: 'Toko ABC',
      outlet: 'Outlet Utama',
      phone: '08123456789',
    })
  })

  it('lastTransaction tidak masuk backup', () => {
    const context = createContext()
    seedStores(context)

    expect(createBackupPayload(context).data.lastTransaction).toBeUndefined()
  })

  it('cart tidak masuk backup', () => {
    const context = createContext()
    seedStores(context)

    expect(createBackupPayload(context).data.cart).toBeUndefined()
  })

  it('shift tidak masuk backup', () => {
    const context = createContext()
    seedStores(context)

    expect(createBackupPayload(context).data.shift).toBeUndefined()
  })

  it('cashier/PIN tidak masuk backup', () => {
    const context = createContext()
    seedStores(context)

    expect(createBackupPayload(context).data.cashier).toBeUndefined()
  })

  it('backup merupakan deep copy dari store state', () => {
    const context = createContext()
    seedStores(context)

    const payload = createBackupPayload(context)
    context.productStore.products[0].name = 'Nama Baru'

    expect(payload.data.products.products[0].name).toBe('Es Kopi Susu')
  })

  it('invalid JSON ditangani tanpa crash', async () => {
    const { wrapper, productStore } = await mountSettings()
    const initialProducts = JSON.stringify(productStore.products)

    await openSettingsSheet(wrapper)
    await uploadBackupFile(wrapper, {
      name: 'broken.json',
      text: async () => '{ invalid json',
    })

    expect(wrapper.text()).toContain('File backup tidak valid.')
    expect(JSON.stringify(productStore.products)).toBe(initialProducts)
  })

  it('invalid schema ditolak', () => {
    const payload = makeValidBackup({ schema: 'something-else' })

    expect(validateBackupPayload(payload)).toEqual({
      valid: false,
      error: 'File backup tidak valid.',
    })
  })

  it('unsupported version ditolak', () => {
    const payload = makeValidBackup({ version: 99 })

    expect(validateBackupPayload(payload)).toEqual({
      valid: false,
      error: 'Versi backup tidak didukung.',
    })
  })

  it('data section hilang ditolak', () => {
    const payload = { schema: BACKUP_SCHEMA, version: BACKUP_VERSION, exportedAt: '2026-08-21T07:00:00.000Z' }

    expect(validateBackupPayload(payload)).toEqual({
      valid: false,
      error: 'File backup tidak valid.',
    })
  })

  it('invalid product ditolak', () => {
    const payload = makeValidBackup()
    payload.data.products.products[0].price = Infinity

    expect(validateBackupPayload(payload)).toEqual({
      valid: false,
      error: 'File backup tidak valid.',
    })
  })

  it('category product yang tidak terdaftar ditolak', () => {
    const payload = makeValidBackup()
    payload.data.products.products[0].category = 'Tidak Ada'

    expect(validateBackupPayload(payload)).toEqual({
      valid: false,
      error: 'File backup tidak valid.',
    })
  })

  it('invalid customer ditolak', () => {
    const payload = makeValidBackup()
    payload.data.customers[0].phone = 812345

    expect(validateBackupPayload(payload)).toEqual({
      valid: false,
      error: 'File backup tidak valid.',
    })
  })

  it('invalid expense amount ditolak', () => {
    const payload = makeValidBackup()
    payload.data.expenses[0].amount = 0

    expect(validateBackupPayload(payload)).toEqual({
      valid: false,
      error: 'File backup tidak valid.',
    })
  })

  it('invalid transaction ditolak', () => {
    const payload = makeValidBackup()
    payload.data.transactions[0].items[0].qty = 0

    expect(validateBackupPayload(payload)).toEqual({
      valid: false,
      error: 'File backup tidak valid.',
    })
  })

  it('validation gagal tidak mengubah store mana pun', () => {
    const context = createContext()
    seedStores(context)
    const before = snapshotState(context)
    const payload = makeValidBackup()
    payload.data.products.products[0].category = 'Tidak Ada'

    const result = restoreBackupPayload(payload, context)

    expect(result.success).toBe(false)
    expect(snapshotState(context)).toBe(before)
  })

  it('restore mengganti products, bukan merge', () => {
    const context = createContext()
    seedStores(context)

    restoreBackupPayload(makeValidBackup(), context)

    expect(context.productStore.products).toEqual([
      { id: 'p-backup', name: 'Latte', category: 'Minuman', price: 28000, stock: 10, isActive: true },
    ])
  })

  it('restore mengganti categories, bukan merge', () => {
    const context = createContext()
    seedStores(context)

    restoreBackupPayload(makeValidBackup(), context)

    expect(context.productStore.categories).toEqual(['Minuman'])
  })

  it('restore mengganti customers, bukan merge', () => {
    const context = createContext()
    seedStores(context)

    restoreBackupPayload(makeValidBackup(), context)

    expect(context.customerStore.customers).toEqual([
      { id: 'c-backup', name: 'Nadia', phone: '081222222222', email: 'nadia@email.com' },
    ])
  })

  it('restore mengganti expenses, bukan merge', () => {
    const context = createContext()
    seedStores(context)

    restoreBackupPayload(makeValidBackup(), context)

    expect(context.expenseStore.expenses).toEqual([
      {
        id: 'e-backup',
        title: 'Gas',
        category: 'Operasional',
        amount: 90000,
        note: 'Isi ulang',
        createdAt: '2026-08-21T09:00:00.000Z',
      },
    ])
  })

  it('restore mengganti transactions, bukan merge', () => {
    const context = createContext()
    seedStores(context)

    restoreBackupPayload(makeValidBackup(), context)

    expect(context.transactionStore.items).toHaveLength(1)
    expect(context.transactionStore.items[0].id).toBe('trx-backup')
  })

  it('restore mempertahankan product ID', () => {
    const context = createContext()
    seedStores(context)

    restoreBackupPayload(makeValidBackup(), context)

    expect(context.productStore.products[0].id).toBe('p-backup')
  })

  it('restore mempertahankan customer ID', () => {
    const context = createContext()
    seedStores(context)

    restoreBackupPayload(makeValidBackup(), context)

    expect(context.customerStore.customers[0].id).toBe('c-backup')
  })

  it('restore mempertahankan expense ID/createdAt', () => {
    const context = createContext()
    seedStores(context)

    restoreBackupPayload(makeValidBackup(), context)

    expect(context.expenseStore.expenses[0].id).toBe('e-backup')
    expect(context.expenseStore.expenses[0].createdAt).toBe('2026-08-21T09:00:00.000Z')
  })

  it('restore mempertahankan transaction ID/invoiceNumber', () => {
    const context = createContext()
    seedStores(context)

    restoreBackupPayload(makeValidBackup(), context)

    expect(context.transactionStore.items[0].id).toBe('trx-backup')
    expect(context.transactionStore.items[0].invoiceNumber).toBe('INV-BACKUP')
  })

  it('transaction snapshot tetap utuh setelah restore', () => {
    const context = createContext()
    seedStores(context)

    restoreBackupPayload(makeValidBackup(), context)

    expect(context.transactionStore.items[0].customerSnapshot).toEqual({
      id: 'c-backup',
      name: 'Nadia',
      phone: '081222222222',
      email: 'nadia@email.com',
    })
    expect(context.transactionStore.items[0].businessSnapshot).toEqual({
      name: 'Toko Backup',
      outlet: 'Outlet Backup',
      phone: '081111111111',
    })
  })

  it('business profile berhasil direstore', () => {
    const context = createContext()
    seedStores(context)

    restoreBackupPayload(makeValidBackup(), context)

    expect(context.businessStore.name).toBe('Toko Backup')
    expect(context.businessStore.outlet).toBe('Outlet Backup')
  })

  it('business mode tidak berubah saat restore', () => {
    const context = createContext()
    seedStores(context)

    restoreBackupPayload(makeValidBackup(), context)

    expect(context.businessStore.mode).toBe('cloud')
  })

  it('selectedCategory reset ke Semua', () => {
    const context = createContext()
    seedStores(context)

    restoreBackupPayload(makeValidBackup(), context)

    expect(context.productStore.selectedCategory).toBe('Semua')
  })

  it('searchQuery reset menjadi kosong', () => {
    const context = createContext()
    seedStores(context)

    restoreBackupPayload(makeValidBackup(), context)

    expect(context.productStore.searchQuery).toBe('')
  })

  it('lastTransaction menjadi null setelah restore', () => {
    const context = createContext()
    seedStores(context)

    restoreBackupPayload(makeValidBackup(), context)

    expect(context.transactionStore.lastTransaction).toBeNull()
  })

  it('cart dibersihkan setelah restore sukses', () => {
    const context = createContext()
    seedStores(context)

    restoreBackupPayload(makeValidBackup(), context)

    expect(context.cartStore.items).toHaveLength(0)
  })

  it('restore gagal tidak membersihkan cart', () => {
    const context = createContext()
    seedStores(context)
    const payload = makeValidBackup()
    payload.data.products.products[0].stock = -1

    restoreBackupPayload(payload, context)

    expect(context.cartStore.items).toHaveLength(1)
  })

  it('restore diblok ketika shift aktif', () => {
    const context = createContext()
    seedStores(context)
    context.shiftStore.openShift(100000)

    const result = restoreBackupPayload(makeValidBackup(), context)

    expect(result).toEqual({
      success: false,
      error: 'Restore backup tidak dapat dilakukan saat shift aktif. Tutup shift terlebih dahulu.',
    })
  })

  it('shift aktif tidak otomatis ditutup', () => {
    const context = createContext()
    seedStores(context)
    context.shiftStore.openShift(100000)

    restoreBackupPayload(makeValidBackup(), context)

    expect(context.shiftStore.isOpen).toBe(true)
  })

  it('cancel confirmation tidak mengubah data', async () => {
    const { wrapper, productStore } = await mountSettings()
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)
    const before = JSON.stringify(productStore.products)

    await openSettingsSheet(wrapper)
    await uploadBackupFile(wrapper, {
      name: 'backup.json',
      text: async () => JSON.stringify(makeValidBackup()),
    })

    expect(confirmSpy).toHaveBeenCalledWith(RESTORE_CONFIRMATION_MESSAGE)
    expect(JSON.stringify(productStore.products)).toBe(before)
  })

  it('Backup Data memicu proses download', async () => {
    const createObjectURLSpy = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test')
    const revokeObjectURLSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    const clickSpy = vi.fn()
    const originalCreateElement = document.createElement.bind(document)
    vi.spyOn(document, 'createElement').mockImplementation((tagName) => {
      if (tagName === 'a') {
        return {
          click: clickSpy,
          set href(value) {
            this._href = value
          },
          get href() {
            return this._href
          },
          set download(value) {
            this._download = value
          },
          get download() {
            return this._download
          },
        }
      }

      return originalCreateElement(tagName)
    })

    const { wrapper } = await mountSettings()
    await openSettingsSheet(wrapper)
    await getButtonByText(wrapper, 'Backup Data').trigger('click')

    expect(createObjectURLSpy).toHaveBeenCalledTimes(1)
    expect(clickSpy).toHaveBeenCalledTimes(1)
    expect(revokeObjectURLSpy).toHaveBeenCalledTimes(1)
  })

  it('filename berakhiran .json', () => {
    const createObjectURLSpy = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test')
    const revokeObjectURLSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    const anchor = {
      click: vi.fn(),
      href: '',
      download: '',
    }
    vi.spyOn(document, 'createElement').mockReturnValue(anchor)

    const filename = downloadBackupFile(makeValidBackup())

    expect(filename.endsWith('.json')).toBe(true)
    expect(anchor.download.endsWith('.json')).toBe(true)
    expect(createObjectURLSpy).toHaveBeenCalledTimes(1)
    expect(revokeObjectURLSpy).toHaveBeenCalledTimes(1)
  })

  it('Restore Backup menerima file JSON', async () => {
    const { wrapper } = await mountSettings()
    const input = wrapper.find('input[type="file"]')

    expect(input.attributes('accept')).toBe('.json,application/json')
  })
})
