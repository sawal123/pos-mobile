import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

const STORAGE_KEY = 'nexapos_master_payment_methods'

export const DEFAULT_PAYMENT_METHODS = [
  {
    id: 'cash',
    name: 'Tunai',
    code: 'cash',
    category: 'cash',
    type: 'cash',
    label: 'Tunai',
    description: 'Pembayaran tunai langsung di kasir',
    is_cash: true,
    isCash: true,
    sort_order: 1,
    sortOrder: 1,
    enabled_outlet_ids: [],
    accountNumber: '',
    accountHolder: '',
    isActive: true,
    isDefault: true,
  },
  {
    id: 'qris',
    name: 'QRIS',
    code: 'qris',
    category: 'ewallet',
    type: 'qris',
    label: 'QRIS',
    description: 'Scan kode QRIS standar Bank Indonesia',
    is_cash: false,
    isCash: false,
    sort_order: 2,
    sortOrder: 2,
    enabled_outlet_ids: [],
    accountNumber: '',
    accountHolder: '',
    isActive: true,
    isDefault: true,
  },
  {
    id: 'card',
    name: 'Kartu / EDC',
    code: 'card',
    category: 'card',
    type: 'card',
    label: 'Kartu / EDC',
    description: 'Gesek / tap kartu debit & kredit pada mesin EDC',
    is_cash: false,
    isCash: false,
    sort_order: 3,
    sortOrder: 3,
    enabled_outlet_ids: [],
    accountNumber: '',
    accountHolder: '',
    isActive: true,
    isDefault: true,
  },
  {
    id: 'transfer',
    name: 'Transfer Bank',
    code: 'transfer',
    category: 'transfer',
    type: 'transfer',
    label: 'Transfer Bank',
    description: 'Transfer ke rekening bank (BCA, Mandiri, BRI, BNI)',
    is_cash: false,
    isCash: false,
    sort_order: 4,
    sortOrder: 4,
    enabled_outlet_ids: [],
    accountNumber: '',
    accountHolder: '',
    isActive: true,
    isDefault: true,
  },
]

function normalizeMethod(raw, index = 0) {
  const code = String(raw.code || raw.id || `method_${index}`).toLowerCase()
  const id = raw.id !== undefined && raw.id !== null ? raw.id : code
  const isCash = Boolean(raw.is_cash ?? raw.isCash ?? (code === 'cash' || code === 'tunai'))
  const sortOrder = Number(raw.sort_order ?? raw.sortOrder ?? index + 1) || index + 1
  const name = String(raw.name || raw.label || code).trim()

  let enabledOutlets = []
  if (Array.isArray(raw.enabled_outlet_ids)) {
    enabledOutlets = raw.enabled_outlet_ids
  } else if (typeof raw.enabled_outlet_ids === 'string') {
    try {
      const parsed = JSON.parse(raw.enabled_outlet_ids)
      if (Array.isArray(parsed)) enabledOutlets = parsed
    } catch {
      enabledOutlets = []
    }
  }

  return {
    id,
    code,
    name,
    label: name,
    category: raw.category || raw.type || (isCash ? 'cash' : 'other'),
    type: raw.type || raw.category || (isCash ? 'cash' : 'other'),
    is_cash: isCash,
    isCash,
    sort_order: sortOrder,
    sortOrder,
    description: String(raw.description || '').trim(),
    enabled_outlet_ids: enabledOutlets,
    accountNumber: String(raw.accountNumber || '').trim(),
    accountHolder: String(raw.accountHolder || '').trim(),
    isActive: raw.isActive !== false,
    isDefault: raw.isDefault ?? ['cash', 'qris', 'card', 'transfer'].includes(code),
    updated_at: raw.updated_at || raw.updatedAt || null,
  }
}

function loadStoredMethods() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULT_PAYMENT_METHODS.map((m, idx) => normalizeMethod(m, idx))
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed) || parsed.length === 0) {
      return DEFAULT_PAYMENT_METHODS.map((m, idx) => normalizeMethod(m, idx))
    }

    const existingCodes = new Set(parsed.map((p) => String(p.code || p.id).toLowerCase()))
    const merged = parsed.map((m, idx) => normalizeMethod(m, idx))
    for (let idx = 0; idx < DEFAULT_PAYMENT_METHODS.length; idx++) {
      const def = DEFAULT_PAYMENT_METHODS[idx]
      if (!existingCodes.has(def.code)) {
        merged.push(normalizeMethod(def, merged.length))
      }
    }
    return merged
  } catch {
    return DEFAULT_PAYMENT_METHODS.map((m, idx) => normalizeMethod(m, idx))
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
    return [...methods.value].sort(
      (a, b) => (a.sort_order ?? a.sortOrder ?? 99) - (b.sort_order ?? b.sortOrder ?? 99),
    )
  })

  const activeMethods = computed(() => {
    return allMethods.value.filter((m) => m.isActive !== false)
  })

  function getMethodsForOutlet(outletId) {
    const active = activeMethods.value
    if (!outletId && outletId !== 0) {
      return active
    }

    const outIdStr = String(outletId)
    const outIdNum = Number(outletId)

    return active.filter((m) => {
      if (!Array.isArray(m.enabled_outlet_ids) || m.enabled_outlet_ids.length === 0) {
        return true
      }
      return m.enabled_outlet_ids.some(
        (id) => String(id) === outIdStr || (!Number.isNaN(outIdNum) && Number(id) === outIdNum),
      )
    })
  }

  function isCashMethod(codeOrId) {
    if (!codeOrId) return false
    const target = String(codeOrId).toLowerCase().trim()
    if (target === 'cash' || target === 'tunai') return true
    const found = methods.value.find(
      (m) => String(m.code || m.id).toLowerCase() === target,
    )
    if (found) {
      return Boolean(found.is_cash ?? found.isCash)
    }
    return false
  }

  function getMethodName(codeOrId) {
    if (!codeOrId) return ''
    const target = String(codeOrId).toLowerCase().trim()
    if (target === 'unpaid') return 'Bayar Nanti'
    if (target === 'cash' || target === 'tunai') return 'Tunai'
    if (target === 'qris') return 'QRIS'
    if (target === 'card') return 'Kartu / EDC'
    if (target === 'transfer') return 'Transfer Bank'

    const found = methods.value.find(
      (m) => String(m.code || m.id).toLowerCase() === target,
    )
    if (found && found.name) return found.name
    return String(codeOrId).toUpperCase()
  }

  function setMethods(list) {
    if (!Array.isArray(list) || list.length === 0) {
      return
    }

    const normalized = list.map((item, idx) => normalizeMethod(item, idx))

    // Ensure Tunai/Cash is always available in the methods list
    const hasCash = normalized.some((m) => m.code === 'cash' || m.is_cash)
    if (!hasCash) {
      normalized.unshift(normalizeMethod(DEFAULT_PAYMENT_METHODS[0], 0))
    }

    methods.value = normalized
    persist()
  }

  function clearMethods() {
    methods.value = DEFAULT_PAYMENT_METHODS.map((m, idx) => normalizeMethod(m, idx))
    persist()
  }

  function toggleMethodActive(id) {
    const item = methods.value.find((m) => m.id === id || m.code === id)
    if (!item) return
    // Cash must remain active for operational stability
    if ((item.id === 'cash' || item.code === 'cash') && item.isActive) {
      return
    }
    item.isActive = !item.isActive
    persist()
  }

  function addMethod({
    name,
    type = 'transfer',
    category = null,
    is_cash = false,
    description = '',
    accountNumber = '',
    accountHolder = '',
    enabled_outlet_ids = [],
  }) {
    const trimmedName = String(name || '').trim()
    if (!trimmedName) return { success: false, error: 'Nama metode wajib diisi.' }

    const id = `custom_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
    const code = trimmedName.toLowerCase().replace(/[^a-z0-9]/g, '_')
    const newMethod = normalizeMethod(
      {
        id,
        code,
        name: trimmedName,
        type: type || category || 'other',
        category: category || type || 'other',
        is_cash: Boolean(is_cash),
        description,
        accountNumber,
        accountHolder,
        enabled_outlet_ids,
        isActive: true,
        isDefault: false,
        sort_order: methods.value.length + 1,
      },
      methods.value.length,
    )
    methods.value.push(newMethod)
    persist()
    return { success: true, method: newMethod }
  }

  function updateMethod(id, updates) {
    const item = methods.value.find((m) => m.id === id || m.code === id)
    if (!item) return { success: false, error: 'Metode tidak ditemukan.' }

    if (updates.name !== undefined) {
      const trimmed = String(updates.name || '').trim()
      if (!trimmed) return { success: false, error: 'Nama metode wajib diisi.' }
      item.name = trimmed
      item.label = trimmed
    }
    if (updates.code !== undefined) item.code = String(updates.code).toLowerCase()
    if (updates.type !== undefined) item.type = updates.type
    if (updates.category !== undefined) item.category = updates.category
    if (updates.is_cash !== undefined) {
      item.is_cash = Boolean(updates.is_cash)
      item.isCash = item.is_cash
    }
    if (updates.description !== undefined) item.description = String(updates.description || '').trim()
    if (updates.accountNumber !== undefined) item.accountNumber = String(updates.accountNumber || '').trim()
    if (updates.accountHolder !== undefined) item.accountHolder = String(updates.accountHolder || '').trim()
    if (Array.isArray(updates.enabled_outlet_ids)) item.enabled_outlet_ids = updates.enabled_outlet_ids
    if (updates.sort_order !== undefined) {
      item.sort_order = Number(updates.sort_order) || 0
      item.sortOrder = item.sort_order
    }
    if (updates.isActive !== undefined && !((item.id === 'cash' || item.code === 'cash') && updates.isActive === false)) {
      item.isActive = Boolean(updates.isActive)
    }
    persist()
    return { success: true, method: item }
  }

  function deleteMethod(id) {
    const item = methods.value.find((m) => m.id === id || m.code === id)
    if (!item) return { success: false, error: 'Metode tidak ditemukan.' }
    if (item.isDefault) {
      return { success: false, error: 'Metode bawaan sistem tidak dapat dihapus.' }
    }
    methods.value = methods.value.filter((m) => m.id !== id && m.code !== id)
    persist()
    return { success: true }
  }

  function resetToDefaults() {
    clearMethods()
  }

  return {
    methods,
    allMethods,
    activeMethods,
    getMethodsForOutlet,
    isCashMethod,
    getMethodName,
    setMethods,
    clearMethods,
    toggleMethodActive,
    addMethod,
    updateMethod,
    deleteMethod,
    resetToDefaults,
  }
})
