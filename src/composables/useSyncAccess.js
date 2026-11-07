import { computed } from 'vue'

import { useCloudSessionStore } from '@/stores/cloudSessionStore'
import { useSubscriptionStore } from '@/stores/subscriptionStore'

export const SYNC_LOCK_REASON = Object.freeze({
  UNAUTHENTICATED_FREE: 'unauthenticated_free',
  AUTHENTICATED_FREE: 'authenticated_free',
})

/**
 * Pure helper to resolve whether the Sinkronisasi feature/menu is unlocked.
 *
 * Sinkronisasi is ONLY unlocked when:
 * 1. The user is logged into a Cloud account (`isAuthenticated === true`), AND
 * 2. Either the selected business has an active Premium/Cloud subscription
 *    (`subscriptionStore.isPremium === true`), OR the logged-in user is a
 *    Cashier operating on an active Cloud business (`isOperationalCloudAccess === true`).
 *
 * When not logged in OR still on Free, Sinkronisasi remains locked.
 */
export function resolveSyncAccess({ cloudStore, subscriptionStore }) {
  const isAuthenticated = Boolean(cloudStore?.isAuthenticated)
  const isCashier = Boolean(
    cloudStore?.role === 'cashier' || cloudStore?.isCashierContext === true,
  )
  const isPaidCloudActive = Boolean(
    subscriptionStore?.isPremium === true ||
      (isCashier && cloudStore?.isOperationalCloudAccess === true),
  )

  const isSyncUnlocked = Boolean(isAuthenticated && isPaidCloudActive)
  const isSyncLocked = !isSyncUnlocked

  let syncLockReason = null
  if (!isAuthenticated) {
    syncLockReason = SYNC_LOCK_REASON.UNAUTHENTICATED_FREE
  } else if (!isPaidCloudActive) {
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

  const access = computed(() => resolveSyncAccess({ cloudStore, subscriptionStore }))

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
