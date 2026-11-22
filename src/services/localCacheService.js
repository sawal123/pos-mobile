import { Capacitor } from '@capacitor/core'
import { useBusinessStore } from '@/stores/businessStore'
import { useReceiptStore } from '@/stores/receiptStore'
import { normalizeReceiptSettings } from '@/services/printer/receiptSettings'
import { useCartStore } from '@/stores/cartStore'
import { useCashStore } from '@/stores/cashStore'
import { useCashierStore } from '@/stores/cashierStore'
import { useCloudSessionStore } from '@/stores/cloudSessionStore'
import { useCustomerStore } from '@/stores/customerStore'
import { useExpenseStore } from '@/stores/expenseStore'
import { useProductStore } from '@/stores/productStore'
import { usePromoStore } from '@/stores/promoStore'
import { useShiftStore } from '@/stores/shiftStore'
import { useTaxStore } from '@/stores/taxStore'
import { useTransactionStore } from '@/stores/transactionStore'
import { useVariantStore } from '@/stores/variantStore'
import { useTableStore } from '@/stores/tableStore'
import { usePaymentMethodStore } from '@/stores/paymentMethodStore'
import { useIngredientStore } from '@/stores/ingredientStore'
import { getInstallMarker, getToken, saveInstallMarker } from '@/services/cloud/tokenRepository'
import { useSyncPushStore } from '@/stores/syncPushStore'
import { useSyncPullStore } from '@/stores/syncPullStore'
import { useSyncBootstrapStore } from '@/stores/syncBootstrapStore'
import { useSyncConflictStore } from '@/stores/syncConflictStore'
import { useSyncHealthStore } from '@/stores/syncHealthStore'
import { useSyncRecoveryStore } from '@/stores/syncRecoveryStore'
import { useSyncStatusStore } from '@/stores/syncStatusStore'
import { useSyncAutoSyncStore } from '@/stores/syncAutoSyncStore'
import { useSyncContextGuardStore } from '@/stores/syncContextGuardStore'

/**
 * Clear local tenant data cache (products, transactions, cart, customers,
 * expenses, cash, shift, sync queue & metadata).
 *
 * This prevents data overlap when switching cloud accounts or allows users
 * to clear cache directly from Settings without navigating to Android phone settings.
 *
 * @param {object} options
 * @param {import('pinia').Pinia|null} [options.pinia]
 * @param {object|null} [options.adapter]
 * @param {object|null} [options.scheduler]
 * @param {boolean} [options.resetBusiness] - Whether to also reset business profile to blank free mode
 * @returns {Promise<{ ok: boolean }>}
 */
export async function clearLocalCache({
  pinia = null,
  adapter = null,
  scheduler = null,
  resetBusiness = false,
} = {}) {
  let cloudStore = null
  try {
    cloudStore = useCloudSessionStore(pinia)
  } catch {
    cloudStore = null
  }

  const resolvedAdapter =
    adapter ??
    cloudStore?.adapter?.value ??
    cloudStore?.adapter ??
    (typeof cloudStore?.getPersistenceAdapter === 'function' ? cloudStore.getPersistenceAdapter() : null)

  const resolvedScheduler =
    scheduler ??
    cloudStore?.scheduler?.value ??
    cloudStore?.scheduler ??
    (typeof cloudStore?.getPersistenceScheduler === 'function' ? cloudStore.getPersistenceScheduler() : null)

  // 1. Wipe database tables via adapter if available
  if (resolvedAdapter) {
    try {
      if (typeof resolvedAdapter.saveProducts === 'function') {
        await resolvedAdapter.saveProducts([], [], [])
      }
      if (typeof resolvedAdapter.saveTransactions === 'function') {
        await resolvedAdapter.saveTransactions([])
      }
      if (typeof resolvedAdapter.saveCustomers === 'function') {
        await resolvedAdapter.saveCustomers([])
      }
      if (typeof resolvedAdapter.saveExpenses === 'function') {
        await resolvedAdapter.saveExpenses([])
      }
      if (typeof resolvedAdapter.savePromos === 'function') {
        await resolvedAdapter.savePromos([])
      }
      if (typeof resolvedAdapter.saveVariantGroups === 'function') {
        await resolvedAdapter.saveVariantGroups([])
      }
      if (typeof resolvedAdapter.savePaymentMethods === 'function') {
        await resolvedAdapter.savePaymentMethods([])
      }
      if (resetBusiness && typeof resolvedAdapter.saveTaxState === 'function') {
        await resolvedAdapter.saveTaxState({ enabled: false, rate: 0 })
      }
      if (typeof resolvedAdapter.saveCashState === 'function') {
        await resolvedAdapter.saveCashState({ entries: [] })
      }
      if (typeof resolvedAdapter.saveShiftState === 'function') {
        await resolvedAdapter.saveShiftState(null)
      }
      if (typeof resolvedAdapter.saveCashierState === 'function') {
        await resolvedAdapter.saveCashierState(null)
      }
      if (resetBusiness && typeof resolvedAdapter.saveBusiness === 'function') {
        await resolvedAdapter.saveReceiptSettings?.(normalizeReceiptSettings())
        await resolvedAdapter.saveBusiness({
          name: '',
          type: '',
          owner: '',
          phone: '',
          outlet: 'Outlet Utama',
          mode: 'free',
        })
      }
      if (typeof resolvedAdapter.replaceSyncQueueItems === 'function') {
        await resolvedAdapter.replaceSyncQueueItems([])
      }
      if (typeof resolvedAdapter.saveSyncIdentityMap === 'function') {
        await resolvedAdapter.saveSyncIdentityMap(null)
      }
      if (typeof resolvedAdapter.saveSyncPushBinding === 'function') {
        await resolvedAdapter.saveSyncPushBinding(null)
      }
      if (typeof resolvedAdapter.saveSyncPullBinding === 'function') {
        await resolvedAdapter.saveSyncPullBinding(null)
      }
      if (typeof resolvedAdapter.clearSyncPushInflight === 'function') {
        await resolvedAdapter.clearSyncPushInflight()
      }
      if (typeof resolvedAdapter.saveSyncPullState === 'function') {
        await resolvedAdapter.saveSyncPullState(null)
      }
      if (typeof resolvedAdapter.saveSyncServerVersions === 'function') {
        await resolvedAdapter.saveSyncServerVersions(null)
      }
      if (typeof resolvedAdapter.saveSyncBootstrapState === 'function') {
        await resolvedAdapter.saveSyncBootstrapState(null)
      }
      if (typeof resolvedAdapter.saveSyncConflicts === 'function') {
        await resolvedAdapter.saveSyncConflicts(null)
      }
      if (typeof resolvedAdapter.saveSyncAutoSettings === 'function') {
        await resolvedAdapter.saveSyncAutoSettings(null)
      }
      if (typeof resolvedAdapter.clearCloudInitializationJournal === 'function') {
        await resolvedAdapter.clearCloudInitializationJournal()
      }
      if (resetBusiness && typeof resolvedAdapter.saveWorkspaceRegistry === 'function') {
        await resolvedAdapter.saveWorkspaceRegistry({
          version: 1,
          activeWorkspaceId: 'local:default',
          workspaces: {},
        })
      }
    } catch (err) {
      console.error('Error clearing database tables:', err)
    }
  }

  // 2. Clear Pinia stores
  try {
    const productStore = useProductStore(pinia)
    productStore.products = []
    productStore.categories = []
    productStore.stockMovements = []
    productStore.selectedCategory = 'Semua'
    productStore.searchQuery = ''
  } catch {}

  try {
    const transactionStore = useTransactionStore(pinia)
    transactionStore.items = []
    transactionStore.lastTransaction = null
  } catch {}

  try {
    const cartStore = useCartStore(pinia)
    cartStore.clearCart?.()
  } catch {}

  try {
    const customerStore = useCustomerStore(pinia)
    customerStore.customers = []
  } catch {}

  try {
    const expenseStore = useExpenseStore(pinia)
    expenseStore.expenses = []
  } catch {}

  try {
    const promoStore = usePromoStore(pinia)
    promoStore.promos = []
  } catch {}

  try {
    const variantStore = useVariantStore(pinia)
    variantStore.groups = []
    const tableStore = useTableStore(pinia)
    tableStore.tables = []
    const paymentMethodStore = usePaymentMethodStore(pinia)
    paymentMethodStore.clearMethods()
    const ingredientStore = useIngredientStore(pinia)
    ingredientStore.ingredients = []
    ingredientStore.recipes = {}
    ingredientStore.movements = []
  } catch {}

  if (resetBusiness) {
    try {
      const taxStore = useTaxStore(pinia)
      taxStore.enabled = false
      taxStore.rate = 0
    } catch {}
  }

  try {
    const cashStore = useCashStore(pinia)
    cashStore.entries = []
  } catch {}

  try {
    const shiftStore = useShiftStore(pinia)
    shiftStore.isOpen = false
    shiftStore.openingBalance = 0
    shiftStore.openedAt = null
    shiftStore.id = null
    shiftStore.shiftNumber = null
    shiftStore.status = 'closed'
    shiftStore.closingBalance = null
    shiftStore.closedAt = null
    shiftStore.notes = ''
    if (Array.isArray(shiftStore.shiftHistory)) {
      shiftStore.shiftHistory = []
    }
  } catch {}

  try {
    const cashierStore = useCashierStore(pinia)
    cashierStore.activeCashier = {
      name: cashierStore.activeCashier?.name || 'Kasir Utama',
      pinConfigured: !resetBusiness,
    }
  } catch {}

  if (resetBusiness) {
    useReceiptStore(pinia).$reset()
    try {
      const businessStore = useBusinessStore(pinia)
      businessStore.name = ''
      businessStore.type = ''
      businessStore.owner = ''
      businessStore.phone = ''
      businessStore.outlet = 'Outlet Utama'
      businessStore.mode = 'free'
    } catch {}
  }

  // 3. Reset sync stores
  try {
    const syncPushStore = useSyncPushStore(pinia)
    syncPushStore.resetPresentation?.()
    if (typeof syncPushStore.refreshPendingCount === 'function') {
      void syncPushStore.refreshPendingCount()
    }
  } catch {}

  try {
    const syncPullStore = useSyncPullStore(pinia)
    syncPullStore.resetPresentation?.()
  } catch {}

  try {
    const syncBootstrapStore = useSyncBootstrapStore(pinia)
    syncBootstrapStore.resetPresentation?.()
  } catch {}

  try {
    const syncConflictStore = useSyncConflictStore(pinia)
    syncConflictStore.resetPresentation?.()
  } catch {}

  try {
    const syncHealthStore = useSyncHealthStore(pinia)
    syncHealthStore.resetResult?.()
  } catch {}

  try {
    const syncRecoveryStore = useSyncRecoveryStore(pinia)
    syncRecoveryStore.resetPresentation?.()
  } catch {}

  try {
    const syncStatusStore = useSyncStatusStore(pinia)
    syncStatusStore.resetPresentation?.()
    void syncStatusStore.refresh?.()
  } catch {}

  try {
    const syncContextGuardStore = useSyncContextGuardStore(pinia)
    syncContextGuardStore.resetPresentation?.()
  } catch {}

  try {
    const syncAutoSyncStore = useSyncAutoSyncStore(pinia)
    syncAutoSyncStore.resetPresentation?.()
  } catch {}

  if (resolvedScheduler?.flush) {
    try {
      await resolvedScheduler.flush()
    } catch {}
  }

  return { ok: true }
}

function generateInstallMarker() {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID()
  }
  return `install-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

/**
 * Guard against stale SQLite snapshots silently restored by OS Auto Backup
 * after an uninstall + reinstall. Because Android Keystore keys/entries are
 * deleted on uninstall while Auto Backup can restore SQLite/SharedPreferences,
 * finding neither an install marker nor a Cloud token on a native build indicates
 * a fresh install or reinstall where any residual local database data must be wiped.
 */
export async function ensureCleanInstallState({
  pinia = null,
  adapter = null,
  scheduler = null,
  isNative = Capacitor.isNativePlatform(),
} = {}) {
  if (!isNative || !adapter) {
    return { ok: true, cleared: false, reason: 'skipped' }
  }

  let installMarker = null
  try {
    installMarker = await getInstallMarker()
  } catch {
    installMarker = null
  }

  if (typeof installMarker === 'string' && installMarker.trim().length > 0) {
    return { ok: true, cleared: false, reason: 'already_marked' }
  }

  let token = null
  try {
    token = await getToken()
  } catch {
    token = null
  }

  if (typeof token === 'string' && token.trim().length > 0) {
    try {
      await saveInstallMarker(generateInstallMarker())
    } catch {
      // Non-blocking: Keystore marker write failure must not break existing session
    }
    return { ok: true, cleared: false, reason: 'existing_session_marked' }
  }

  await clearLocalCache({
    pinia,
    adapter,
    scheduler,
    resetBusiness: true,
  })

  try {
    await adapter.clearCloudContext?.()
  } catch {
    // non-blocking
  }
  try {
    await adapter.saveDeviceIdentifier?.(null)
  } catch {
    // non-blocking
  }
  if (scheduler?.flush) {
    try {
      await scheduler.flush()
    } catch {
      // non-blocking
    }
  }

  try {
    await saveInstallMarker(generateInstallMarker())
  } catch {
    // non-blocking
  }

  return { ok: true, cleared: true, reason: 'fresh_install_cleanup' }
}
