/**
 * Pengaman data lokal untuk operasi destruktif.
 *
 * "Hapus cache lalu muat ulang dari Cloud" menghapus seluruh data tenant
 * (produk, transaksi, pelanggan, kas, shift, antrean sync) LEBIH DULU, kemudian
 * baru menarik data Cloud. Kalau penarikan gagal — offline, prasyarat Cloud
 * belum lengkap, konflik, atau proses lain sedang berjalan — data pengguna yang
 * tadinya ada ikut hilang.
 *
 * Modul ini mengambil snapshot cepat sebelum penghapusan dan mengembalikannya
 * apa adanya bila pemuatan Cloud tidak berhasil, sehingga operasi tersebut tidak
 * pernah menghilangkan data.
 */

export const SAFETY_BACKUP_STORAGE_KEY = 'netkasir.local_safety_backup.v1'

let memorySnapshot = null

/**
 * Ambil snapshot data lokal yang akan dihapus oleh `clearLocalCache()`.
 *
 * @param {object} options
 * @param {object} options.adapter
 * @returns {Promise<object|null>} Snapshot, atau null bila adapter tidak siap.
 */
export async function captureLocalSafetyBackup({ adapter } = {}) {
  if (!adapter) return null

  const read = async (fn, fallback) => {
    try {
      return typeof adapter[fn] === 'function' ? await adapter[fn]() : fallback
    } catch {
      return fallback
    }
  }

  const products = await read('loadProducts', { products: [], categories: [], stockMovements: [] })

  const snapshot = {
    version: 1,
    capturedAt: new Date().toISOString(),
    products: Array.isArray(products?.products) ? products.products : [],
    categories: Array.isArray(products?.categories) ? products.categories : [],
    stockMovements: Array.isArray(products?.stockMovements) ? products.stockMovements : [],
    customers: (await read('loadCustomers', [])) ?? [],
    expenses: (await read('loadExpenses', [])) ?? [],
    transactions: (await read('loadTransactions', [])) ?? [],
    cashState: (await read('loadCashState', null)) ?? null,
    shiftState: (await read('loadShiftState', null)) ?? null,
    syncQueue: (await read('listSyncQueueItems', [])) ?? [],
    syncIdentityMap: (await read('loadSyncIdentityMap', null)) ?? null,
    syncPushBinding: (await read('loadSyncPushBinding', null)) ?? null,
    syncPullBinding: (await read('loadSyncPullBinding', null)) ?? null,
    syncPullState: (await read('loadSyncPullState', null)) ?? null,
    syncServerVersions: (await read('loadSyncServerVersions', null)) ?? null,
    syncBootstrapState: (await read('loadSyncBootstrapState', null)) ?? null,
  }

  memorySnapshot = snapshot

  // Best-effort mirror so a crash during the reload does not lose the data.
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(SAFETY_BACKUP_STORAGE_KEY, JSON.stringify(snapshot))
    }
  } catch {
    // Quota exceeded / unavailable: the in-memory snapshot still protects the
    // current session (the failure path we actually need to survive).
  }

  return snapshot
}

/**
 * Apakah snapshot berisi data yang layak dipulihkan.
 */
export function hasRestorableData(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return false

  const lists = [
    snapshot.products,
    snapshot.categories,
    snapshot.stockMovements,
    snapshot.customers,
    snapshot.expenses,
    snapshot.transactions,
    snapshot.syncQueue,
  ]

  if (lists.some((list) => Array.isArray(list) && list.length > 0)) return true
  if (Array.isArray(snapshot.cashState?.entries) && snapshot.cashState.entries.length > 0) {
    return true
  }

  return Boolean(snapshot.shiftState && typeof snapshot.shiftState === 'object')
}

/**
 * Kembalikan snapshot ke adapter + store Pinia.
 *
 * @param {object} snapshot
 * @param {object} options
 * @param {object} [options.adapter]
 * @param {object|null} [options.pinia]
 * @returns {Promise<{ok: boolean, restored?: boolean, reason?: string}>}
 */
export async function restoreLocalSafetyBackup(snapshot, { adapter = null, pinia = null } = {}) {
  const data = snapshot ?? memorySnapshot
  if (!hasRestorableData(data)) {
    return { ok: true, restored: false, reason: 'EMPTY_SNAPSHOT' }
  }
  if (!adapter) {
    return { ok: false, restored: false, reason: 'NO_ADAPTER' }
  }

  try {
    if (typeof adapter.saveProducts === 'function') {
      await adapter.saveProducts(data.products ?? [], data.categories ?? [], data.stockMovements ?? [])
    }
    if (typeof adapter.saveCustomers === 'function') {
      await adapter.saveCustomers(data.customers ?? [])
    }
    if (typeof adapter.saveExpenses === 'function') {
      await adapter.saveExpenses(data.expenses ?? [])
    }
    if (typeof adapter.saveTransactions === 'function') {
      await adapter.saveTransactions(data.transactions ?? [])
    }
    if (typeof adapter.saveCashState === 'function' && data.cashState) {
      await adapter.saveCashState(data.cashState)
    }
    if (typeof adapter.saveShiftState === 'function') {
      await adapter.saveShiftState(data.shiftState ?? null)
    }
    if (typeof adapter.replaceSyncQueueItems === 'function' && Array.isArray(data.syncQueue)) {
      await adapter.replaceSyncQueueItems(data.syncQueue)
    }
    if (typeof adapter.saveSyncIdentityMap === 'function' && data.syncIdentityMap) {
      await adapter.saveSyncIdentityMap(data.syncIdentityMap)
    }
    if (typeof adapter.saveSyncPushBinding === 'function') {
      await adapter.saveSyncPushBinding(data.syncPushBinding ?? null)
    }
    if (typeof adapter.saveSyncPullBinding === 'function') {
      await adapter.saveSyncPullBinding(data.syncPullBinding ?? null)
    }
    if (typeof adapter.saveSyncPullState === 'function') {
      await adapter.saveSyncPullState(data.syncPullState ?? null)
    }
    if (typeof adapter.saveSyncServerVersions === 'function') {
      await adapter.saveSyncServerVersions(data.syncServerVersions ?? null)
    }
    if (typeof adapter.saveSyncBootstrapState === 'function') {
      await adapter.saveSyncBootstrapState(data.syncBootstrapState ?? null)
    }
  } catch (error) {
    return {
      ok: false,
      restored: false,
      reason: error instanceof Error ? error.message : String(error),
    }
  }

  await restoreStoresFromSnapshot(data, pinia)

  memorySnapshot = null
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(SAFETY_BACKUP_STORAGE_KEY)
    }
  } catch {
    // ignore
  }

  return { ok: true, restored: true }
}

/** Buang snapshot (operasi berhasil, data Cloud sudah terpasang). */
export function clearLocalSafetyBackup() {
  memorySnapshot = null
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(SAFETY_BACKUP_STORAGE_KEY)
    }
  } catch {
    // ignore
  }
}

/** Snapshot yang sedang dipegang (untuk test/diagnostik). */
export function peekLocalSafetyBackup() {
  return memorySnapshot
}

async function restoreStoresFromSnapshot(data, pinia) {
  const { useProductStore } = await import('@/stores/productStore')
  const { useCustomerStore } = await import('@/stores/customerStore')
  const { useExpenseStore } = await import('@/stores/expenseStore')
  const { useTransactionStore } = await import('@/stores/transactionStore')
  const { useCashStore } = await import('@/stores/cashStore')
  const { useShiftStore } = await import('@/stores/shiftStore')

  const safe = (fn) => {
    try {
      fn()
    } catch {
      // Store tidak aktif (mis. di luar konteks Pinia) — data di adapter tetap utuh.
    }
  }

  safe(() => {
    const store = useProductStore(pinia)
    store.products = data.products ?? []
    store.categories = data.categories ?? []
    store.stockMovements = data.stockMovements ?? []
    store.selectedCategory = 'Semua'
    store.searchQuery = ''
  })
  safe(() => {
    useCustomerStore(pinia).customers = data.customers ?? []
  })
  safe(() => {
    useExpenseStore(pinia).expenses = data.expenses ?? []
  })
  safe(() => {
    useTransactionStore(pinia).items = data.transactions ?? []
  })
  safe(() => {
    useCashStore(pinia).entries = data.cashState?.entries ?? []
  })
  safe(() => {
    const store = useShiftStore(pinia)
    const shift = data.shiftState
    store.isOpen = shift?.isOpen === true
    store.openingBalance = shift?.openingBalance ?? 0
    store.openedAt = shift?.openedAt ?? null
    store.id = shift?.id ?? null
    store.shiftNumber = shift?.shiftNumber ?? null
    store.status = shift?.status ?? 'closed'
    store.closingBalance = shift?.closingBalance ?? null
    store.closedAt = shift?.closedAt ?? null
    store.notes = shift?.notes ?? ''
  })
}
