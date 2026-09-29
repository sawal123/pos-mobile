import { defineStore } from 'pinia'
import { computed } from 'vue'

import { ENTITLEMENT_STATUS, resolveEntitlement } from '@/services/subscription/entitlementService'
import { useCloudSessionStore } from './cloudSessionStore'

/**
 * PREM-M01 — subscription/entitlement store (UI adapter).
 *
 * Bridges the authoritative server context held by `useCloudSessionStore` into
 * a small, stable entitlement contract for the UI. It adds no authorization:
 * the backend keeps deciding what is actually allowed. When the context is
 * unknown (loading / error / no selected business) it fails closed to Free.
 */
export const useSubscriptionStore = defineStore('subscription', () => {
  const cloudStore = useCloudSessionStore()

  /**
   * The subscription attached to the *currently selected* business only. The
   * fresh context list is preferred so switching business never surfaces the
   * previous business' entitlement; the persisted snapshot is a fallback for a
   * cold start before the next context refresh.
   */
  const selectedSubscription = computed(() => {
    if (!cloudStore.isAuthenticated) return null

    const businessId = cloudStore.selectedBusiness?.id
    if (businessId === null || businessId === undefined) return null

    const match = cloudStore.businesses.find((business) => business.id === businessId)
    if (match) return match.subscription ?? null

    return cloudStore.selectedBusiness?.subscription ?? null
  })

  const entitlement = computed(() =>
    resolveEntitlement({
      subscription: selectedSubscription.value,
      loading: cloudStore.loading,
      error: cloudStore.error,
    }),
  )

  const status = computed(() => entitlement.value.status)
  const isPremium = computed(() => entitlement.value.isPremium)
  const plan = computed(() => entitlement.value.plan)
  const planLabel = computed(() => entitlement.value.planLabel)
  const expiresAt = computed(() => entitlement.value.expiresAt)
  const isLoading = computed(() => status.value === ENTITLEMENT_STATUS.LOADING)

  return {
    selectedSubscription,
    entitlement,
    status,
    isPremium,
    plan,
    planLabel,
    expiresAt,
    isLoading,
  }
})
