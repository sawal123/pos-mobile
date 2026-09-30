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
 * Owns the catalog fetch lifecycle (loading / ready / empty / unavailable /
 * error + retry) and the user's plan + period selection. It grants nothing:
 * entitlement stays derivable only from the authoritative server context through
 * `useSubscriptionStore` (PREM-M01 fail-closed rules unchanged).
 *
 * No checkout is performed here. When the backend does not advertise checkout,
 * `canContinue` stays `false` and the UI reports "belum tersedia" instead of
 * simulating a payment.
 */
/** Local state before the first load attempt; distinct from a confirmed empty catalog. */
export const PLAN_CATALOG_IDLE = 'idle'

export const useSubscriptionPlanStore = defineStore('subscriptionPlan', () => {
  const cloudStore = useCloudSessionStore()
  const subscriptionStore = useSubscriptionStore()

  const state = ref(PLAN_CATALOG_IDLE)
  const plans = ref([])
  const checkoutAvailable = ref(false)
  const supportsBothPeriods = ref(false)
  const selectedPeriod = ref(null)
  const selectedPlanCode = ref(null)
  const error = ref(null)
  const reason = ref(null)

  const isLoading = ref(false)

  const isIdle = computed(() => state.value === PLAN_CATALOG_IDLE)
  const isReady = computed(() => state.value === PLAN_CATALOG_STATUS.READY)
  const isEmpty = computed(() => state.value === PLAN_CATALOG_STATUS.EMPTY)
  const isUnavailable = computed(() => state.value === PLAN_CATALOG_STATUS.UNAVAILABLE)
  const hasError = computed(() => state.value === PLAN_CATALOG_STATUS.ERROR)

  const availablePeriods = computed(() => {
    const seen = []
    for (const plan of plans.value) {
      if (plan.period && !seen.includes(plan.period)) seen.push(plan.period)
    }
    return seen
  })

  /** Plans shown for the active period; period-less plans are always shown. */
  const visiblePlans = computed(() => {
    if (!supportsBothPeriods.value) return plans.value
    return plans.value.filter(
      (plan) => plan.period === null || plan.period === selectedPeriod.value,
    )
  })

  const selectedPlan = computed(
    () => plans.value.find((plan) => plan.code === selectedPlanCode.value) ?? null,
  )

  /** True only for a plan the current subscription already grants. */
  function isCurrentPlan(plan) {
    if (!plan || !subscriptionStore.isPremium) return false
    return plan.code === subscriptionStore.plan
  }

  /** A plan may only be acted upon when it has a real price and is not owned. */
  function isSelectable(plan) {
    if (!plan) return false
    return plan.purchasable && !isCurrentPlan(plan)
  }

  /** The continue action stays inert until a validated, purchasable plan exists. */
  const canContinue = computed(
    () =>
      checkoutAvailable.value === true &&
      !isLoading.value &&
      isSelectable(selectedPlan.value) === true,
  )

  /** True when a plan is chosen but checkout itself is not offered yet. */
  const checkoutBlocked = computed(
    () => selectedPlan.value !== null && checkoutAvailable.value !== true,
  )

  function clearSelection() {
    selectedPlanCode.value = null
  }

  function reconcileSelection() {
    const periods = availablePeriods.value

    if (supportsBothPeriods.value) {
      if (!periods.includes(selectedPeriod.value)) {
        selectedPeriod.value = periods[0] ?? null
      }
    } else {
      selectedPeriod.value = null
    }

    if (selectedPlanCode.value === null) return

    const stillVisible = visiblePlans.value.some((plan) => plan.code === selectedPlanCode.value)
    if (!stillVisible) clearSelection()
  }

  /**
   * Load the plan catalog. Safe to call repeatedly; the last call wins.
   *
   * @param {object} [options]
   * @param {string|null} [options.path] Override the configured endpoint.
   * @returns {Promise<{status: string, reason: string|null}>}
   */
  async function loadCatalog({ path } = {}) {
    isLoading.value = true
    error.value = null
    reason.value = null
    state.value = PLAN_CATALOG_STATUS.EMPTY

    try {
      const resolvedPath = path ?? resolvePlanCatalogPath()

      if (!resolvedPath) {
        plans.value = []
        supportsBothPeriods.value = false
        checkoutAvailable.value = false
        reason.value = PLAN_CATALOG_REASON.NOT_CONFIGURED
        state.value = PLAN_CATALOG_STATUS.UNAVAILABLE
        clearSelection()
        return { status: state.value, reason: reason.value }
      }

      if (!cloudStore.isAuthenticated) {
        plans.value = []
        supportsBothPeriods.value = false
        checkoutAvailable.value = false
        reason.value = PLAN_CATALOG_REASON.NOT_AUTHENTICATED
        state.value = PLAN_CATALOG_STATUS.UNAVAILABLE
        clearSelection()
        return { status: state.value, reason: reason.value }
      }

      let token = null
      try {
        token = await getToken()
      } catch {
        token = null
      }

      if (!token) {
        plans.value = []
        supportsBothPeriods.value = false
        checkoutAvailable.value = false
        reason.value = PLAN_CATALOG_REASON.NOT_AUTHENTICATED
        state.value = PLAN_CATALOG_STATUS.UNAVAILABLE
        clearSelection()
        return { status: state.value, reason: reason.value }
      }

      const result = await fetchPlanCatalog({ path: resolvedPath, token })

      if (result.status === PLAN_CATALOG_STATUS.READY) {
        plans.value = result.plans
        checkoutAvailable.value = result.checkoutAvailable === true
        supportsBothPeriods.value = result.supportsBothPeriods === true
        state.value = PLAN_CATALOG_STATUS.READY
        reconcileSelection()
      } else if (result.status === PLAN_CATALOG_STATUS.EMPTY) {
        plans.value = []
        checkoutAvailable.value = false
        supportsBothPeriods.value = false
        state.value = PLAN_CATALOG_STATUS.EMPTY
        clearSelection()
      } else if (result.status === PLAN_CATALOG_STATUS.UNAVAILABLE) {
        plans.value = []
        checkoutAvailable.value = false
        supportsBothPeriods.value = false
        reason.value = result.reason ?? PLAN_CATALOG_REASON.ENDPOINT_MISSING
        state.value = PLAN_CATALOG_STATUS.UNAVAILABLE
        clearSelection()
      } else {
        plans.value = []
        checkoutAvailable.value = false
        supportsBothPeriods.value = false
        reason.value = result.reason ?? PLAN_CATALOG_REASON.REQUEST_FAILED
        state.value = PLAN_CATALOG_STATUS.ERROR
        error.value = result.error?.message ?? 'Katalog paket gagal dimuat.'
        clearSelection()
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
   * Select a billing period. Only a period actually present in the catalog is
   * accepted; a selection that no longer fits the period is dropped.
   *
   * @param {string} period
   * @returns {boolean}
   */
  function selectPeriod(period) {
    if (!availablePeriods.value.includes(period)) return false

    selectedPeriod.value = period

    const plan = selectedPlan.value
    if (plan && plan.period !== null && plan.period !== period) clearSelection()

    return true
  }

  /**
   * Select a plan by code. A plan that is not currently visible (filtered out by
   * the active period) cannot be selected.
   *
   * @param {string|null} code
   * @returns {boolean}
   */
  function selectPlan(code) {
    if (code === null) {
      clearSelection()
      return true
    }

    const plan = visiblePlans.value.find((candidate) => candidate.code === code)
    if (!plan) {
      clearSelection()
      return false
    }

    selectedPlanCode.value = plan.code
    return true
  }

  function reset() {
    plans.value = []
    checkoutAvailable.value = false
    supportsBothPeriods.value = false
    selectedPeriod.value = null
    selectedPlanCode.value = null
    error.value = null
    reason.value = null
    state.value = PLAN_CATALOG_IDLE
  }

  return {
    // state
    state,
    plans,
    checkoutAvailable,
    supportsBothPeriods,
    selectedPeriod,
    selectedPlanCode,
    error,
    reason,
    isLoading,
    // computed
    isIdle,
    isReady,
    isEmpty,
    isUnavailable,
    hasError,
    availablePeriods,
    visiblePlans,
    selectedPlan,
    canContinue,
    checkoutBlocked,
    // helpers
    isCurrentPlan,
    isSelectable,
    // actions
    loadCatalog,
    retry,
    selectPeriod,
    selectPlan,
    reset,
  }
})
