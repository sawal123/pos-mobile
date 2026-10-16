/**
 * Conservative safety gate for connecting the single local POS workspace to a
 * Cloud business. This application does not yet have a multi-business local
 * workspace manager, so any existing operational data or sync metadata means
 * the workspace must remain untouched.
 */

const REQUIRED_READERS = [
  'loadBusiness',
  'loadProducts',
  'loadCustomers',
  'loadExpenses',
  'loadTransactions',
  'loadCashState',
  'loadShiftState',
  'listSyncQueueItems',
  'loadSyncPushBinding',
  'loadSyncPullBinding',
  'loadSyncPushInflight',
  'loadSyncBootstrapState',
  'loadSyncIdentityMap',
  'loadSyncServerVersions',
  'loadSyncAutoSettings',
]

function isNonEmptyText(value) {
  return typeof value === 'string' && value.trim().length > 0
}

function hasRows(value) {
  return Array.isArray(value) && value.length > 0
}

function hasMeaningfulShift(value) {
  return Boolean(
    value &&
      (value.isOpen === true ||
        value.id ||
        value.shiftNumber ||
        value.status ||
        value.openedAt ||
        value.closedAt),
  )
}

function hasMeaningfulBusiness(value) {
  return Boolean(value && (isNonEmptyText(value.name) || isNonEmptyText(value.type)))
}

function normalizeBusinessSnapshot(value) {
  return {
    name: typeof value?.name === 'string' ? value.name.trim() : '',
    type: typeof value?.type === 'string' ? value.type.trim() : '',
    outlet: typeof value?.outlet === 'string' ? value.outlet.trim() : '',
  }
}

/**
 * Read every data family capable of tying the singleton local workspace to a
 * business. Missing readers and read failures fail closed.
 */
export async function inspectLocalBusinessWorkspace({ adapter, runtime = null } = {}) {
  if (!adapter || REQUIRED_READERS.some((key) => typeof adapter[key] !== 'function')) {
    return {
      ok: false,
      code: 'LOCAL_WORKSPACE_UNAVAILABLE',
      safeToActivate: false,
      reasons: ['workspace_reader_unavailable'],
      localBusiness: normalizeBusinessSnapshot(runtime?.business),
    }
  }

  try {
    const [
      storedBusiness,
      storedProducts,
      storedCustomers,
      storedExpenses,
      storedTransactions,
      storedCash,
      storedShift,
      syncQueue,
      pushBinding,
      pullBinding,
      inflight,
      bootstrap,
      identityMap,
      serverVersions,
      autoSettings,
    ] = await Promise.all([
      adapter.loadBusiness(),
      adapter.loadProducts(),
      adapter.loadCustomers(),
      adapter.loadExpenses(),
      adapter.loadTransactions(),
      adapter.loadCashState(),
      adapter.loadShiftState(),
      adapter.listSyncQueueItems({ limit: 1 }),
      adapter.loadSyncPushBinding(),
      adapter.loadSyncPullBinding(),
      adapter.loadSyncPushInflight(),
      adapter.loadSyncBootstrapState(),
      adapter.loadSyncIdentityMap(),
      adapter.loadSyncServerVersions(),
      adapter.loadSyncAutoSettings(),
    ])

    const reasons = []
    const localBusiness = normalizeBusinessSnapshot(
      hasMeaningfulBusiness(runtime?.business) ? runtime.business : storedBusiness,
    )
    if (hasMeaningfulBusiness(storedBusiness) || hasMeaningfulBusiness(runtime?.business)) {
      reasons.push('business_metadata')
    }

    const products = storedProducts?.products ?? []
    const categories = storedProducts?.categories ?? []
    const stockMovements = storedProducts?.stockMovements ?? []
    if (hasRows(products) || hasRows(categories) || hasRows(stockMovements)) reasons.push('catalog_or_stock')
    if (hasRows(storedCustomers)) reasons.push('customers')
    if (hasRows(storedExpenses)) reasons.push('expenses')
    if (hasRows(storedTransactions)) reasons.push('transactions')
    if (hasRows(storedCash?.entries)) reasons.push('cash')
    if (hasMeaningfulShift(storedShift)) reasons.push('shift')
    if (hasRows(syncQueue)) reasons.push('sync_queue')

    if (pushBinding || pullBinding || inflight || bootstrap || identityMap || serverVersions || autoSettings) {
      reasons.push('sync_metadata')
    }

    return {
      ok: true,
      code: reasons.length === 0 ? 'LOCAL_WORKSPACE_EMPTY' : 'LOCAL_WORKSPACE_PROTECTED',
      safeToActivate: reasons.length === 0,
      reasons,
      localBusiness,
    }
  } catch {
    return {
      ok: false,
      code: 'LOCAL_WORKSPACE_READ_FAILED',
      safeToActivate: false,
      reasons: ['workspace_read_failed'],
      localBusiness: normalizeBusinessSnapshot(runtime?.business),
    }
  }
}

export function formatBusinessTypeForMismatch(type) {
  if (type === 'Cafe / UMKM') return 'Cafe'
  if (type === 'Grosir / Toko Kelontong') return 'Grosir'
  if (type === 'Laundry') return 'Laundry'
  return 'Tidak diketahui'
}

export function buildBusinessMismatchMessage({ localBusiness, cloudBusiness } = {}) {
  const localName = localBusiness?.name || 'Bisnis lokal'
  const localType = localBusiness?.type || 'Tidak diketahui'
  const cloudName = cloudBusiness?.name || 'Bisnis Cloud'
  const cloudType = formatBusinessTypeForMismatch(cloudBusiness?.business_type)

  return `Bisnis lokal saat ini adalah ${localName} (${localType}), sedangkan bisnis Cloud yang dipilih adalah ${cloudName} (${cloudType}). Data kedua bisnis tidak boleh digabungkan. Gunakan ruang kerja bisnis terpisah sebelum mengaktifkan bisnis Cloud ini.`
}
