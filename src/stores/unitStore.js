import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { apiRequest } from '@/services/cloud/apiClient'
import { getToken } from '@/services/cloud/tokenRepository'
import { useCloudSessionStore } from '@/stores/cloudSessionStore'
import { useProductStore } from '@/stores/productStore'

export const DEFAULT_UNITS = [
  'botol',
  'pcs',
  'ml',
  'gr',
  'gram',
  'kg',
  'liter',
  'cup',
  'box',
  'pouch',
  'sachet',
  'bks',
  'butir',
  'potong',
  'galon',
  'ons',
  'kotak',
  'pack',
  'porsi',
]

const STORAGE_KEY = 'nexamobile_master_units'

function loadSavedUnits() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed) && parsed.length > 0) {
        // Ensure standard defaults like 'gr', 'ml', 'pcs' are included
        const merged = [...new Set([...DEFAULT_UNITS, ...parsed.map((u) => String(u).toLowerCase().trim())])]
        return merged
      }
    }
  } catch {
    // fallback
  }
  return [...DEFAULT_UNITS]
}

export const useUnitStore = defineStore('unit', () => {
  const units = ref(loadSavedUnits())
  const loading = ref(false)

  const sortedUnits = computed(() => {
    return [...units.value].sort((a, b) => a.localeCompare(b, 'id', { sensitivity: 'base' }))
  })

  function saveUnits() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(units.value))
    } catch {
      // ignore
    }
  }

  function getUnitUsage(name) {
    if (!name || typeof name !== 'string') return 0
    try {
      const productStore = useProductStore()
      if (!productStore?.products || !Array.isArray(productStore.products)) return 0
      const target = name.trim().toLowerCase()
      return productStore.products.filter(
        (p) => p.unit && String(p.unit).trim().toLowerCase() === target,
      ).length
    } catch {
      return 0
    }
  }

  function isUnitInUse(name) {
    return getUnitUsage(name) > 0
  }

  function addUnit(name) {
    if (!name || typeof name !== 'string') return
    const trimmed = name.trim().toLowerCase()
    if (!trimmed) return

    const exists = units.value.some((u) => u.toLowerCase() === trimmed)
    if (!exists) {
      units.value.push(trimmed)
      saveUnits()
    }
  }

  function createUnit(name) {
    let isCashier = false
    try {
      const cloudStore = useCloudSessionStore()
      isCashier = cloudStore.role === 'cashier' || cloudStore.isCashierContext === true
    } catch {
      // ignore
    }
    if (isCashier) {
      return { success: false, error: 'Kasir tidak diizinkan menambah satuan baru.' }
    }

    if (!name || typeof name !== 'string') {
      return { success: false, error: 'Nama satuan tidak boleh kosong.' }
    }
    const trimmed = name.trim().toLowerCase()
    if (!trimmed) {
      return { success: false, error: 'Nama satuan tidak boleh kosong.' }
    }
    if (trimmed.length > 30) {
      return { success: false, error: 'Nama satuan maksimal 30 karakter.' }
    }

    const exists = units.value.some((u) => u.toLowerCase() === trimmed)
    if (exists) {
      return { success: false, error: `Satuan "${trimmed}" sudah terdaftar.` }
    }

    units.value.push(trimmed)
    saveUnits()

    // Try cloud sync if session is active
    syncRemoteCreate(trimmed).catch(() => {})

    return { success: true, unit: trimmed }
  }

  function updateUnit(currentName, nextName) {
    let isCashier = false
    try {
      const cloudStore = useCloudSessionStore()
      isCashier = cloudStore.role === 'cashier' || cloudStore.isCashierContext === true
    } catch {
      // ignore
    }
    if (isCashier) {
      return { success: false, error: 'Kasir tidak diizinkan mengubah satuan.' }
    }

    if (!currentName || !nextName || typeof currentName !== 'string' || typeof nextName !== 'string') {
      return { success: false, error: 'Nama satuan lama dan baru wajib diisi.' }
    }

    const oldTrimmed = currentName.trim().toLowerCase()
    const newTrimmed = nextName.trim().toLowerCase()

    if (!newTrimmed) {
      return { success: false, error: 'Nama satuan baru tidak boleh kosong.' }
    }

    const index = units.value.findIndex((u) => u.toLowerCase() === oldTrimmed)
    if (index === -1) {
      return { success: false, error: `Satuan "${currentName}" tidak ditemukan.` }
    }

    if (oldTrimmed !== newTrimmed) {
      const duplicate = units.value.some((u, i) => i !== index && u.toLowerCase() === newTrimmed)
      if (duplicate) {
        return { success: false, error: `Satuan "${newTrimmed}" sudah terdaftar.` }
      }
    }

    units.value.splice(index, 1, newTrimmed)
    saveUnits()

    // Also update any products in productStore that use the old unit name!
    let updatedProductsCount = 0
    try {
      const productStore = useProductStore()
      if (productStore?.products && Array.isArray(productStore.products)) {
        productStore.products = productStore.products.map((product) => {
          if (product.unit && String(product.unit).trim().toLowerCase() === oldTrimmed) {
            updatedProductsCount++
            return { ...product, unit: newTrimmed }
          }
          return product
        })
      }
    } catch {
      // ignore
    }

    return {
      success: true,
      unit: newTrimmed,
      updatedProductsCount,
    }
  }

  function deleteUnit(name, force = false) {
    let isCashier = false
    try {
      const cloudStore = useCloudSessionStore()
      isCashier = cloudStore.role === 'cashier' || cloudStore.isCashierContext === true
    } catch {
      // ignore
    }
    if (isCashier) {
      return { success: false, error: 'Kasir tidak diizinkan menghapus satuan.' }
    }

    if (!name || typeof name !== 'string') {
      return { success: false, error: 'Nama satuan tidak valid.' }
    }
    const trimmed = name.trim().toLowerCase()

    const index = units.value.findIndex((u) => u.toLowerCase() === trimmed)
    if (index === -1) {
      return { success: false, error: `Satuan "${name}" tidak ditemukan.` }
    }

    const usageCount = getUnitUsage(trimmed)
    if (usageCount > 0 && !force) {
      return {
        success: false,
        inUse: true,
        usageCount,
        error: `Satuan "${trimmed}" sedang digunakan oleh ${usageCount} produk.`,
      }
    }

    units.value.splice(index, 1)
    saveUnits()

    return { success: true }
  }

  function mergeUnits(newUnits) {
    if (!Array.isArray(newUnits)) return
    let changed = false
    for (const item of newUnits) {
      const name = typeof item === 'string' ? item : item?.name
      if (name && typeof name === 'string') {
        const trimmed = name.trim().toLowerCase()
        if (trimmed && !units.value.some((u) => u.toLowerCase() === trimmed)) {
          units.value.push(trimmed)
          changed = true
        }
      }
    }
    if (changed) {
      saveUnits()
    }
  }

  async function syncRemoteCreate(unitName) {
    try {
      const cloudStore = useCloudSessionStore()
      if (!cloudStore?.isLinked || !cloudStore?.selectedBusiness?.id) return
      const token = await getToken()
      if (!token) return

      await apiRequest('/api/mobile/units', {
        method: 'POST',
        token,
        body: {
          business_id: cloudStore.selectedBusiness.id,
          name: unitName,
          symbol: unitName,
        },
      })
    } catch {
      // Non-blocking offline fallback
    }
  }

  async function fetchRemoteUnits(businessId) {
    if (!businessId) return
    loading.value = true
    try {
      const token = await getToken()
      if (!token) return

      const res = await apiRequest(`/api/mobile/units?business_id=${businessId}`, {
        method: 'GET',
        token,
      })

      if (res?.ok && res.data?.data) {
        mergeUnits(res.data.data)
      }
    } catch (err) {
      console.warn('Failed to fetch remote units:', err)
    } finally {
      loading.value = false
    }
  }

  return {
    units,
    sortedUnits,
    loading,
    addUnit,
    createUnit,
    updateUnit,
    deleteUnit,
    getUnitUsage,
    isUnitInUse,
    mergeUnits,
    fetchRemoteUnits,
  }
})
