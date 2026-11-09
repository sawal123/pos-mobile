import { computed } from 'vue'

import { useBusinessStore } from '@/stores/businessStore'
import { useCloudSessionStore } from '@/stores/cloudSessionStore'
import { useSubscriptionStore } from '@/stores/subscriptionStore'

export const SYNC_LOCK_REASON = Object.freeze({
  UNAUTHENTICATED_FREE: 'unauthenticated_free',
  AUTHENTICATED_FREE: 'authenticated_free',
})

/**
 * Pure helper to resolve whether the Sinkronisasi feature/menu is unlocked.
 *
 * Sinkronisasi is unlocked when:
 * 1. The user is logged into a Cloud account (`isAuthenticated === true`), AND
 * 2. The account is linked to a cloud business / operating in cloud mode /
 *    has active cloud access / paid subscription, and is not explicitly expired or restricted.
 */
export function resolveSyncAccess({ cloudStore, subscriptionStore, businessStore = null }) {
  const isAuthenticated = Boolean(cloudStore?.isAuthenticated)
  const isCashier = Boolean(
    cloudStore?.role === 'cashier' || cloudStore?.isCashierContext === true,
  )

  const sub =
    subscriptionStore?.selectedSubscription ||
    cloudStore?.selectedBusiness?.subscription ||
    null

  const planKey = typeof sub?.plan === 'string' ? sub.plan.trim().toLowerCase() : ''
  const statusKey = typeof sub?.status === 'string' ? sub.status.trim().toLowerCase() : ''
  const isFreePlan = planKey === 'free' || planKey === 'none'
  const isExpired =
    statusKey === 'expired' ||
    statusKey === 'ended' ||
    statusKey === 'cancelled' ||
    statusKey === 'canceled'

  // If unauthenticated or explicitly expired or on free plan, lock it
  if (!isAuthenticated || isFreePlan || isExpired) {
    return {
      isAuthenticated,
      isCashier,
      isPaidCloudActive: false,
      isSyncUnlocked: false,
      isSyncLocked: true,
      syncLockReason: !isAuthenticated
        ? SYNC_LOCK_REASON.UNAUTHENTICATED_FREE
        : SYNC_LOCK_REASON.AUTHENTICATED_FREE,
    }
  }

  // Check if session has active cloud tenant status
  const isCloudTenantActive = Boolean(
    cloudStore?.isOperationalCloudAccess === true ||
      cloudStore?.hasCloudAccess === true ||
      cloudStore?.cloudAccess === true ||
      businessStore?.mode === 'cloud' ||
      cloudStore?.isLinked === true ||
      Boolean(cloudStore?.selectedBusiness),
  )

  // Cached plan is paid if it has an active subscription or explicit paid plan key and is not expired
  const isPaidPlanCached = Boolean(
    sub &&
      !isFreePlan &&
      !isExpired &&
      (statusKey === 'active' ||
        !statusKey ||
        ['pro', 'cloud', 'premium', 'business', 'enterprise', 'plus', 'starter'].includes(planKey)),
  )

  const isPaidCloudActive = Boolean(
    subscriptionStore?.isPremium === true ||
      subscriptionStore?.hasCloudAccess === true ||
      (isCashier && isCloudTenantActive) ||
      (isCloudTenantActive && !isFreePlan) ||
      isPaidPlanCached,
  )

  const isSyncUnlocked = Boolean(isAuthenticated && isPaidCloudActive)
  const isSyncLocked = !isSyncUnlocked

  let syncLockReason = null
  if (!isAuthenticated) {
    syncLockReason = SYNC_LOCK_REASON.UNAUTHENTICATED_FREE
  } else if (isSyncLocked) {
    syncLockReason = SYNC_LOCK_REASON.AUTHENTICATED_FREE
  }

  return {
    isAuthenticated,
    isCashier,
    isPaidCloudActive,
    isSyncUnlocked,
    isSyncLocked,
    syncLockReason,
  }
}

export function useSyncAccess() {
  const cloudStore = useCloudSessionStore()
  const subscriptionStore = useSubscriptionStore()
  const businessStore = useBusinessStore()

  const access = computed(() => resolveSyncAccess({ cloudStore, subscriptionStore, businessStore }))

  const isAuthenticated = computed(() => access.value.isAuthenticated)
  const isCashier = computed(() => access.value.isCashier)
  const isPaidCloudActive = computed(() => access.value.isPaidCloudActive)
  const isSyncUnlocked = computed(() => access.value.isSyncUnlocked)
  const isSyncLocked = computed(() => access.value.isSyncLocked)
  const syncLockReason = computed(() => access.value.syncLockReason)

  return {
    isAuthenticated,
    isCashier,
    isPaidCloudActive,
    isSyncUnlocked,
    isSyncLocked,
    syncLockReason,
  }
}
