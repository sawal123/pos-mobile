import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

const STORAGE_KEY = 'nexapos_master_payment_methods'

export const DEFAULT_PAYMENT_METHODS = [
  {
    id: 'cash',
    name: 'Cash',
    type: 'cash',
    label: 'Cash',
    description: 'Pembayaran tunai langsung di kasir',
    accountNumber: '',
    accountHolder: '',
    isActive: true,
    isDefault: true,
    sortOrder: 1,
  },
  {
    id: 'qris',
    name: 'QRIS',
    type: 'qris',
    label: 'QRIS',
    description: 'Scan kode QRIS standar Bank Indonesia',
    accountNumber: '',
    accountHolder: '',
    isActive: true,
    isDefault: false,
    sortOrder: 2,
  },
  {
    id: 'transfer',
    name: 'Transfer Bank',
    type: 'transfer',
    label: 'Transfer',
    description: 'Transfer ke rekening bank (BCA, Mandiri, BRI, BNI)',
    accountNumber: '',
    accountHolder: '',
    isActive: true,
    isDefault: false,
    sortOrder: 3,
  },
  {
    id: 'card',
    name: 'Card / EDC',
    type: 'card',
    label: 'Card',
    description: 'Gesek / tap kartu debit & kredit pada mesin EDC',
    accountNumber: '',
    accountHolder: '',
    isActive: true,
    isDefault: false,
    sortOrder: 4,
  },
  {
    id: 'unpaid',
    name: 'Bayar Nanti',
    type: 'unpaid',
    label: 'Bayar Nanti',
    description: 'Transaksi tempo / piutang pelanggan',
    accountNumber: '',
    accountHolder: '',
    isActive: true,
    isDefault: false,
    sortOrder: 5,
  },
]

function loadStoredMethods() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULT_PAYMENT_METHODS.map((m) => ({ ...m }))
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed) || parsed.length === 0) {
      return DEFAULT_PAYMENT_METHODS.map((m) => ({ ...m }))
    }

    // Ensure all default methods exist even if user loaded older custom list
    const existingIds = new Set(parsed.map((p) => p.id))
    const merged = [...parsed]
    for (const def of DEFAULT_PAYMENT_METHODS) {
      if (!existingIds.has(def.id)) {
        merged.push({ ...def })
      }
    }
    return merged
  } catch {
    return DEFAULT_PAYMENT_METHODS.map((m) => ({ ...m }))
  }
}

export const usePaymentMethodStore = defineStore('paymentMethodStore', () => {
  const methods = ref(loadStoredMethods())

  function persist() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(methods.value))
    } catch {
      // Ignore storage errors in test or restricted environments
    }
  }

  const allMethods = computed(() => {
    return [...methods.value].sort((a, b) => (a.sortOrder || 99) - (b.sortOrder || 99))
  })

  const activeMethods = computed(() => {
    return allMethods.value.filter((m) => m.isActive)
  })

  function toggleMethodActive(id) {
    const item = methods.value.find((m) => m.id === id)
    if (!item) return
    // Cash must remain active for operational stability
    if (item.id === 'cash' && item.isActive) {
      return
    }
    item.isActive = !item.isActive
    persist()
  }

  function addMethod({ name, type = 'transfer', description = '', accountNumber = '', accountHolder = '' }) {
    const trimmedName = String(name || '').trim()
    if (!trimmedName) return { success: false, error: 'Nama metode wajib diisi.' }

    const id = `custom_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
    const newMethod = {
      id,
      name: trimmedName,
      label: trimmedName,
      type,
      description: String(description || '').trim(),
      accountNumber: String(accountNumber || '').trim(),
      accountHolder: String(accountHolder || '').trim(),
      isActive: true,
      isDefault: false,
      sortOrder: methods.value.length + 1,
    }
    methods.value.push(newMethod)
    persist()
    return { success: true, method: newMethod }
  }

  function updateMethod(id, updates) {
    const item = methods.value.find((m) => m.id === id)
    if (!item) return { success: false, error: 'Metode tidak ditemukan.' }

    if (updates.name !== undefined) {
      const trimmed = String(updates.name || '').trim()
      if (!trimmed) return { success: false, error: 'Nama metode wajib diisi.' }
      item.name = trimmed
      item.label = trimmed
    }
    if (updates.type !== undefined) item.type = updates.type
    if (updates.description !== undefined) item.description = String(updates.description || '').trim()
    if (updates.accountNumber !== undefined) item.accountNumber = String(updates.accountNumber || '').trim()
    if (updates.accountHolder !== undefined) item.accountHolder = String(updates.accountHolder || '').trim()
    if (updates.isActive !== undefined && !(item.id === 'cash' && updates.isActive === false)) {
      item.isActive = Boolean(updates.isActive)
    }
    persist()
    return { success: true, method: item }
  }

  function deleteMethod(id) {
    const item = methods.value.find((m) => m.id === id)
    if (!item) return { success: false, error: 'Metode tidak ditemukan.' }
    if (item.isDefault) {
      return { success: false, error: 'Metode bawaan sistem tidak dapat dihapus.' }
    }
    methods.value = methods.value.filter((m) => m.id !== id)
    persist()
    return { success: true }
  }

  function resetToDefaults() {
    methods.value = DEFAULT_PAYMENT_METHODS.map((m) => ({ ...m }))
    persist()
  }

  return {
    methods,
    allMethods,
    activeMethods,
    toggleMethodActive,
    addMethod,
    updateMethod,
    deleteMethod,
    resetToDefaults,
  }
})
