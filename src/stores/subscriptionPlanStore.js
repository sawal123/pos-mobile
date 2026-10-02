import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

import { getToken } from '@/services/cloud/tokenRepository'
import {
  PLAN_CATALOG_REASON,
  PLAN_CATALOG_STATUS,
  fetchPlanCatalog,
  resolvePlanCatalogPath,
} from '@/services/subscription/planCatalogService'
import { useCloudSessionStore } from './cloudSessionStore'
import { useSubscriptionStore } from './subscriptionStore'

/**
 * PREM-M02 — plan selection store (UI only).
 *
 * Consumes the canonical backend catalog (a plan carries its own
 * `billing_periods`, so one `cloud` plan drives the Bulanan/Tahunan choice) and
 * owns the fetch lifecycle (loading / ready / empty / unavailable / error +
 * retry) plus the user's period/option selection.
 *
 * It grants nothing: entitlement stays derivable only from the authoritative
 * server context through `useSubscriptionStore` (PREM-M01 fail-closed rules
 * unchanged). No checkout is performed; `canContinue` additionally requires the
 * backend's own `purchasable` and `checkout_available` gates, so the UI can
 * never simulate a payment.
 */
/** Local state before the first load attempt; distinct from a confirmed empty catalog. */
export const PLAN_CATALOG_IDLE = 'idle'

export const useSubscriptionPlanStore = defineStore('subscriptionPlan', () => {
  const cloudStore = useCloudSessionStore()
  const subscriptionStore = useSubscriptionStore()

  const state = ref(PLAN_CATALOG_IDLE)
  /** Selectable options: one per (plan, priced billing period). */
  const options = ref([])
  /** Billing periods the catalog genuinely offers. */
  const periods = ref([])
  const checkoutAvailable = ref(false)
  const supportsBothPeriods = ref(false)
  const selectedPeriod = ref(null)
  const selectedOptionKey = ref(null)
  const error = ref(null)
  const reason = ref(null)
  const renewalMode = ref(false)

  const isLoading = ref(false)

  const isIdle = computed(() => state.value === PLAN_CATALOG_IDLE)
  const isReady = computed(() => state.value === PLAN_CATALOG_STATUS.READY)
  const isEmpty = computed(() => state.value === PLAN_CATALOG_STATUS.EMPTY)
  const isUnavailable = computed(() => state.value === PLAN_CATALOG_STATUS.UNAVAILABLE)
  const hasError = computed(() => state.value === PLAN_CATALOG_STATUS.ERROR)

  const availablePeriods = computed(() => periods.value)

  /** Options shown for the active period; without a toggle every option shows. */
  const visibleOptions = computed(() => {
    if (!supportsBothPeriods.value) return options.value
    return options.value.filter((option) => option.period === selectedPeriod.value)
  })

  const selectedOption = computed(
    () => options.value.find((option) => option.key === selectedOptionKey.value) ?? null,
  )

  /** True only for a plan the current subscription already grants. */
  function isCurrentPlan(option) {
    if (!option || !subscriptionStore.isPremium) return false
    return option.code === subscriptionStore.plan
  }

  /**
   * An option may only be acted upon when the backend offered it, priced it and
   * marked it purchasable — and when the business does not own it already.
   */
  function isSelectable(option) {
    if (!option) return false
    if (option.available === false) return false
    if (option.hasPrice !== true) return false
    if (option.purchasable !== true) return false
    if (isCurrentPlan(option) && renewalMode.value !== true) return false
    return true
  }

  /** Both gates are honoured: the plan's `purchasable` and `checkout_available`. */
  const canContinue = computed(
    () =>
      checkoutAvailable.value === true &&
      !isLoading.value &&
      isSelectable(selectedOption.value) === true,
  )

  /** True when an option is chosen but checkout itself is not offered yet. */
  const checkoutBlocked = computed(
    () => selectedOption.value !== null && checkoutAvailable.value !== true,
  )

  /** True when the chosen option is not purchasable (no price and/or backend gate). */
  const selectionNotPurchasable = computed(
    () => selectedOption.value !== null && !isSelectable(selectedOption.value),
  )

  function clearSelection() {
    selectedOptionKey.value = null
  }

  function clearCatalog() {
    options.value = []
    periods.value = []
    checkoutAvailable.value = false
    supportsBothPeriods.value = false
    selectedPeriod.value = null
    clearSelection()
  }

  function reconcileSelection() {
    if (!supportsBothPeriods.value) {
      selectedPeriod.value = null
    } else if (!periods.value.includes(selectedPeriod.value)) {
      selectedPeriod.value = periods.value[0] ?? null
    }

    if (selectedOptionKey.value === null) return

    if (!options.value.some((option) => option.key === selectedOptionKey.value)) {
      clearSelection()
    }
  }

  /**
   * Load the catalog for the active business. Safe to call repeatedly.
   *
   * @param {object} [options]
   * @param {string|null} [options.path] Override the catalog endpoint.
   * @param {number|string|null} [options.businessId] Override the active business.
   * @returns {Promise<{status: string, reason: string|null}>}
   */
  async function loadCatalog({ path, businessId } = {}) {
    isLoading.value = true
    error.value = null
    reason.value = null
    state.value = PLAN_CATALOG_STATUS.EMPTY

    try {
      if (!cloudStore.isAuthenticated) {
        clearCatalog()
        reason.value = PLAN_CATALOG_REASON.NOT_AUTHENTICATED
        state.value = PLAN_CATALOG_STATUS.UNAVAILABLE
        return { status: state.value, reason: reason.value }
      }

      // The backend requires the active business; never use another tenant.
      const activeBusinessId = businessId ?? cloudStore.selectedBusiness?.id ?? null

      if (
        activeBusinessId === null ||
        activeBusinessId === undefined ||
        `${activeBusinessId}`.trim() === ''
      ) {
        clearCatalog()
        reason.value = PLAN_CATALOG_REASON.NO_BUSINESS
        state.value = PLAN_CATALOG_STATUS.UNAVAILABLE
        return { status: state.value, reason: reason.value }
      }

      let token = null
      try {
        token = await getToken()
      } catch {
        token = null
      }

      if (!token) {
        clearCatalog()
        reason.value = PLAN_CATALOG_REASON.NOT_AUTHENTICATED
        state.value = PLAN_CATALOG_STATUS.UNAVAILABLE
        return { status: state.value, reason: reason.value }
      }

      const result = await fetchPlanCatalog({
        path: path ?? resolvePlanCatalogPath(),
        token,
        businessId: activeBusinessId,
      })

      if (result.status === PLAN_CATALOG_STATUS.READY) {
        options.value = result.options
        periods.value = result.periods
        checkoutAvailable.value = result.checkoutAvailable === true
        supportsBothPeriods.value = result.supportsBothPeriods === true
        state.value = PLAN_CATALOG_STATUS.READY
        reconcileSelection()
      } else if (result.status === PLAN_CATALOG_STATUS.EMPTY) {
        clearCatalog()
        state.value = PLAN_CATALOG_STATUS.EMPTY
      } else if (result.status === PLAN_CATALOG_STATUS.UNAVAILABLE) {
        clearCatalog()
        reason.value = result.reason ?? PLAN_CATALOG_REASON.ENDPOINT_MISSING
        state.value = PLAN_CATALOG_STATUS.UNAVAILABLE
      } else {
        clearCatalog()
        reason.value = result.reason ?? PLAN_CATALOG_REASON.REQUEST_FAILED
        state.value = PLAN_CATALOG_STATUS.ERROR
        error.value = result.error?.message ?? 'Katalog paket gagal dimuat.'
      }

      return { status: state.value, reason: reason.value }
    } finally {
      isLoading.value = false
    }
  }

  function retry() {
    return loadCatalog()
  }

  /**
   * Select a billing period. Only a period the catalog offers is accepted; a
   * selection is carried over to the same plan's other period when it exists.
   *
   * @param {string} period
   * @returns {boolean}
   */
  function selectPeriod(period) {
    if (!periods.value.includes(period)) return false

    selectedPeriod.value = period

    if (selectedOptionKey.value === null) return true

    const selected = selectedOption.value
    const carried = options.value.find(
      (option) => option.code === selected?.code && option.period === period,
    )

    if (carried) {
      selectedOptionKey.value = carried.key
      return true
    }

    clearSelection()
    return true
  }

  /**
   * Select an option by key. An option filtered out by the active period cannot
   * be selected.
   *
   * @param {string|null} key
   * @returns {boolean}
   */
  function selectOption(key) {
    if (key === null) {
      clearSelection()
      return true
    }

    const option = visibleOptions.value.find((candidate) => candidate.key === key)
    if (!option) {
      clearSelection()
      return false
    }

    selectedOptionKey.value = option.key
    return true
  }

  function reset() {
    clearCatalog()
    error.value = null
    reason.value = null
    state.value = PLAN_CATALOG_IDLE
    renewalMode.value = false
  }

  function enableRenewalMode() {
    renewalMode.value = true
  }

  function disableRenewalMode() {
    renewalMode.value = false
  }

  return {
    // state
    state,
    options,
    periods,
    checkoutAvailable,
    supportsBothPeriods,
    selectedPeriod,
    selectedOptionKey,
    error,
    reason,
    renewalMode,
    isLoading,
    // computed
    isIdle,
    isReady,
    isEmpty,
    isUnavailable,
    hasError,
    availablePeriods,
    visibleOptions,
    selectedOption,
    canContinue,
    checkoutBlocked,
    selectionNotPurchasable,
    // helpers
    isCurrentPlan,
    isSelectable,
    // actions
    loadCatalog,
    retry,
    selectPeriod,
    selectOption,
    reset,
    enableRenewalMode,
    disableRenewalMode,
  }
})
