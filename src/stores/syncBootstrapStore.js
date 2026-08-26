import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { createSyncBootstrapService } from '@/services/sync/syncBootstrapService'
import { useCloudSessionStore } from './cloudSessionStore'
import { useProductStore } from './productStore'
import { useCustomerStore } from './customerStore'
import { useExpenseStore } from './expenseStore'
import { useTransactionStore } from './transactionStore'
import { SYNC_RESERVED_CATEGORY } from '@/services/sync/syncConstants'

export const useSyncBootstrapStore = defineStore('syncBootstrap', () => {
  const cloudStore = useCloudSessionStore()
  const productStore = useProductStore()
  const customerStore = useCustomerStore()
  const expenseStore = useExpenseStore()
  const transactionStore = useTransactionStore()

  const loading = ref(false)
  const lastResult = ref(null)
  const lastError = ref(null)
  const bootstrapState = ref(null)

  let _bootstrapService = null
  let _adapter = null
  let _scheduler = null

  const isStaged = computed(() => {
    return bootstrapState.value?.status === 'staged' || bootstrapState.value?.status === 'completed'
  })

  const isStagedForCurrentContext = computed(() => {
    if (!isStaged.value || !bootstrapState.value) {
      return false
    }
    const state = bootstrapState.value
    const isBizMatch = Number(state.businessId) === Number(cloudStore.selectedBusiness?.id)
    const isOutletMatch = Number(state.outletId) === Number(cloudStore.selectedOutlet?.id)
    const isDevMatch = String(state.deviceIdentifier) === String(cloudStore.deviceIdentifier)
    const isRegDevMatch = String(state.registeredDeviceId) === String(cloudStore.registeredDeviceId)

    return isBizMatch && isOutletMatch && isDevMatch && isRegDevMatch
  })

  const hasContextMismatch = computed(() => {
    return isStaged.value && !isStagedForCurrentContext.value
  })

  const previewCounts = computed(() => {
    const categories = (productStore.categories ?? []).filter(
      (c) =>
        typeof c === 'string' &&
        c.trim().length > 0 &&
        c.trim().toLowerCase() !== SYNC_RESERVED_CATEGORY.toLowerCase(),
    )
    const products = productStore.products ?? []
    const customers = customerStore.customers ?? []
    const expenses = expenseStore.expenses ?? []
    const transactions = transactionStore.items ?? transactionStore.transactions ?? []

    return {
      categories: categories.length,
      products: products.length,
      customers: customers.length,
      expenses: expenses.length,
      transactions: transactions.length,
      total:
        categories.length +
        products.length +
        customers.length +
        expenses.length +
        transactions.length,
    }
  })

  function init({ bootstrapService = null, adapter = null, scheduler = null } = {}) {
    if (adapter) {
      _adapter = adapter
    }
    if (scheduler) {
      _scheduler = scheduler
    }
    if (bootstrapService) {
      _bootstrapService = bootstrapService
    } else if (_adapter) {
      _bootstrapService = createSyncBootstrapService({
        adapter: _adapter,
        scheduler: _scheduler,
        cloudStore,
      })
    }
  }

  async function loadBootstrapState() {
    if (_adapter && typeof _adapter.loadSyncBootstrapState === 'function') {
      try {
        bootstrapState.value = await _adapter.loadSyncBootstrapState()
      } catch {
        bootstrapState.value = null
      }
    }
    return bootstrapState.value
  }

  async function bootstrapNow(options = {}) {
    if (!_bootstrapService) {
      if (_adapter) {
        _bootstrapService = createSyncBootstrapService({
          adapter: _adapter,
          scheduler: _scheduler,
          cloudStore,
        })
      } else {
        return {
          ok: false,
          code: 'SERVICE_NOT_INITIALIZED',
          message: 'Sync bootstrap service is not initialized.',
          error: {
            code: 'SERVICE_NOT_INITIALIZED',
            message: 'Sync bootstrap service is not initialized.',
          },
        }
      }
    }

    loading.value = true
    lastError.value = null

    const resolvedContext = options.context ?? {
      user: cloudStore.user,
      selectedBusiness: cloudStore.selectedBusiness,
      selectedOutlet: cloudStore.selectedOutlet,
      cloudAccess: cloudStore.cloudAccess,
      deviceIdentifier: cloudStore.deviceIdentifier,
      registeredDeviceId: cloudStore.registeredDeviceId,
    }

    try {
      const result = await _bootstrapService.bootstrapNow({
        ...options,
        context: resolvedContext,
      })

      lastResult.value = result

      if (result.ok) {
        bootstrapState.value = result.state
      } else {
        lastError.value = result.message ?? result.error?.message ?? 'Bootstrap gagal.'
      }

      return result
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err)
      lastError.value = errorMsg
      const failure = {
        ok: false,
        code: 'UNEXPECTED_BOOTSTRAP_ERROR',
        message: errorMsg,
        error: err,
      }
      lastResult.value = failure
      return failure
    } finally {
      loading.value = false
    }
  }

  return {
    loading,
    lastResult,
    lastError,
    bootstrapState,
    isStaged,
    isStagedForCurrentContext,
    hasContextMismatch,
    previewCounts,
    init,
    loadBootstrapState,
    bootstrapNow,
  }
})
