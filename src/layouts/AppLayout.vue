<script setup>
import { computed, onMounted, onUnmounted, provide, ref, watch } from 'vue'
import { RouterView, useRoute } from 'vue-router'

import AppHeader from '@/components/layout/AppHeader.vue'
import AppNotificationModal from '@/components/base/AppNotificationModal.vue'
import BottomNavigation from '@/components/layout/BottomNavigation.vue'
import TabletNavRail from '@/components/layout/TabletNavRail.vue'
import OfflineSyncPromptModal from '@/components/sync/OfflineSyncPromptModal.vue'
import SyncLockedModal from '@/components/sync/SyncLockedModal.vue'
import SyncProgressModal from '@/components/sync/SyncProgressModal.vue'
import { usePullToRefresh } from '@/composables/usePullToRefresh'
import { PAGE_REFRESH_KEY } from '@/composables/usePageRefresh'
import { useSyncProgressStore } from '@/stores/syncProgressStore'

import { useSyncStatusStore } from '@/stores/syncStatusStore'
import { useCloudSessionStore } from '@/stores/cloudSessionStore'
import { useSyncPullStore } from '@/stores/syncPullStore'
import { useProductStore } from '@/stores/productStore'
import { useTransactionStore } from '@/stores/transactionStore'
import { useCustomerStore } from '@/stores/customerStore'
import { useExpenseStore } from '@/stores/expenseStore'
import { useCashStore } from '@/stores/cashStore'
import { useUnitStore } from '@/stores/unitStore'
import { usePromoStore } from '@/stores/promoStore'
import { useSubscriptionStore } from '@/stores/subscriptionStore'
import { useSubscriptionPlanStore } from '@/stores/subscriptionPlanStore'
import { useSyncPushStore } from '@/stores/syncPushStore'
import { usePremiumCheckoutStore } from '@/stores/premiumCheckoutStore'

const route = useRoute()
const syncProgressStore = useSyncProgressStore()
const isSidebarDrawerOpen = ref(false)
const showDrawerSyncLockedModal = ref(false)

const isSidebarHiddenRoute = computed(() => {
  const path = route.path
  const name = route.name
  return path === '/pos' || name === 'pos' || path === '/payment' || name === 'payment'
})

const mainContentRef = ref(null)
const pageRefreshHandler = ref(null)

provide(PAGE_REFRESH_KEY, (handler) => {
  pageRefreshHandler.value = handler
})

function getStoreSafe(storeHook) {
  try {
    return storeHook()
  } catch {
    return null
  }
}

async function handleLayoutRefresh() {
  const currentRouteName = route.name || ''
  let customResult = null

  if (typeof pageRefreshHandler.value === 'function') {
    try {
      customResult = await pageRefreshHandler.value()
    } catch (err) {
      console.warn('Page refresh handler error:', err)
      return { ok: false, message: err?.message || 'Gagal memperbarui data' }
    }
  }

  const syncStatusStore = getStoreSafe(useSyncStatusStore)
  const cloudStore = getStoreSafe(useCloudSessionStore)
  const syncPullStore = getStoreSafe(useSyncPullStore)
  const productStore = getStoreSafe(useProductStore)
  const transactionStore = getStoreSafe(useTransactionStore)
  const customerStore = getStoreSafe(useCustomerStore)
  const expenseStore = getStoreSafe(useExpenseStore)
  const cashStore = getStoreSafe(useCashStore)
  const unitStore = getStoreSafe(useUnitStore)
  const promoStore = getStoreSafe(usePromoStore)
  const subscriptionStore = getStoreSafe(useSubscriptionStore)
  const subscriptionPlanStore = getStoreSafe(useSubscriptionPlanStore)
  const syncPushStore = getStoreSafe(useSyncPushStore)
  const premiumCheckoutStore = getStoreSafe(usePremiumCheckoutStore)

  const tasks = []

  if (syncStatusStore?.refresh) {
    tasks.push(syncStatusStore.refresh().catch(() => {}))
  }

  if (
    cloudStore?.isLinked &&
    cloudStore?.isOperationalCloudAccess &&
    syncPullStore?.ensureCatalogLoaded
  ) {
    if (['home', 'pos', 'products', 'stock', 'categories', 'units'].includes(currentRouteName)) {
      tasks.push(syncPullStore.ensureCatalogLoaded().catch(() => {}))
    }
  }

  if (['products', 'pos', 'stock', 'categories'].includes(currentRouteName)) {
    if (productStore?.loadProducts) tasks.push(productStore.loadProducts().catch(() => {}))
  }

  if (
    [
      'transactions',
      'transaction-detail',
      'reports',
      'home',
      'laundry-orders',
      'laundry-order-detail',
    ].includes(currentRouteName)
  ) {
    if (transactionStore?.loadTransactions)
      tasks.push(transactionStore.loadTransactions().catch(() => {}))
  }

  if (['customers', 'customer-create', 'customer-edit'].includes(currentRouteName)) {
    if (customerStore?.loadCustomers) tasks.push(customerStore.loadCustomers().catch(() => {}))
  }

  if (['expenses', 'expense-create', 'expense-edit'].includes(currentRouteName)) {
    if (expenseStore?.loadExpenses) tasks.push(expenseStore.loadExpenses().catch(() => {}))
  }

  if (['cash'].includes(currentRouteName)) {
    if (cashStore?.refresh) tasks.push(cashStore.refresh().catch(() => {}))
  }

  if (['units'].includes(currentRouteName)) {
    if (unitStore?.loadSavedUnits) unitStore.loadSavedUnits()
  }

  if (['promos'].includes(currentRouteName)) {
    if (promoStore?.loadPromos) tasks.push(promoStore.loadPromos().catch(() => {}))
  }

  if (['subscription', 'my-subscription'].includes(currentRouteName)) {
    if (subscriptionPlanStore?.loadCatalog)
      tasks.push(subscriptionPlanStore.loadCatalog().catch(() => {}))
    if (subscriptionStore?.refresh) tasks.push(subscriptionStore.refresh().catch(() => {}))
  }

  if (['premium-checkout', 'premium-payment-status'].includes(currentRouteName)) {
    if (premiumCheckoutStore?.refreshStatus)
      tasks.push(premiumCheckoutStore.refreshStatus().catch(() => {}))
  }

  if (['sync'].includes(currentRouteName)) {
    if (syncPushStore?.refreshPendingCount)
      tasks.push(syncPushStore.refreshPendingCount().catch(() => {}))
  }

  if (['cloud'].includes(currentRouteName)) {
    if (cloudStore?.refreshContext) tasks.push(cloudStore.refreshContext().catch(() => {}))
  }

  await Promise.allSettled(tasks)

  if (customResult && customResult.ok === false) {
    return customResult
  }

  return { ok: true }
}

const {
  indicatorOffset,
  isDragging,
  isRefreshing,
  isVisible: isRefreshIndicatorVisible,
  message: refreshMessage,
  resetGesture,
} = usePullToRefresh({
  root: mainContentRef,
  onRefresh: handleLayoutRefresh,
})

// Close drawer automatically on route navigation
watch(
  () => route.fullPath,
  () => {
    isSidebarDrawerOpen.value = false
    pageRefreshHandler.value = null
    resetGesture?.()
  },
)

function handleKeydown(e) {
  if (e.key === 'Escape' && isSidebarDrawerOpen.value) {
    isSidebarDrawerOpen.value = false
  }
}

function handleBeforeUnload(e) {
  if (syncProgressStore.isRunning) {
    e.preventDefault()
    e.returnValue = ''
  }
}

onMounted(() => {
  window.addEventListener('keydown', handleKeydown)
  window.addEventListener('beforeunload', handleBeforeUnload)
})

onUnmounted(() => {
  window.removeEventListener('keydown', handleKeydown)
  window.removeEventListener('beforeunload', handleBeforeUnload)
})
</script>

<template>
  <div
    class="min-h-screen bg-surface text-ink-primary overflow-x-clip md:h-screen md:overflow-hidden print:min-h-0 print:h-auto print:overflow-visible print:bg-white"
  >
    <!-- Overlay Drawer for Sidebar (used when on /pos or /payment or triggered via hamburger) -->
    <div v-if="isSidebarDrawerOpen" class="fixed inset-0 z-50 flex print:hidden">
      <!-- Backdrop -->
      <div
        class="fixed inset-0 bg-black/40 backdrop-blur-xs transition-opacity"
        @click="isSidebarDrawerOpen = false"
      />

      <!-- Drawer Content -->
      <div class="relative z-10 flex h-full w-72 max-w-[85vw] flex-col bg-card shadow-2xl">
        <TabletNavRail
          is-drawer
          @close="isSidebarDrawerOpen = false"
          @open-sync-lock="showDrawerSyncLockedModal = true"
        />
      </div>
    </div>

    <div
      class="mx-auto flex min-h-screen w-full max-w-7xl items-stretch md:min-h-0 md:h-screen md:overflow-hidden print:min-h-0 print:h-auto print:max-w-none print:overflow-visible"
    >
      <!-- Static sidebar on desktop: Hidden when on /pos or /payment -->
      <div v-if="!isSidebarHiddenRoute" class="print:hidden">
        <TabletNavRail />
      </div>

      <div
        class="flex min-h-screen w-full min-w-0 flex-1 flex-col md:min-h-0 md:h-screen md:overflow-hidden print:min-h-0 print:h-auto print:overflow-visible"
      >
        <AppHeader
          class="shrink-0 print:hidden"
          :show-hamburger="isSidebarHiddenRoute"
          @toggle-sidebar="isSidebarDrawerOpen = !isSidebarDrawerOpen"
        />

        <main
          ref="mainContentRef"
          data-testid="app-pull-to-refresh"
          class="relative w-full min-w-0 flex-1 px-4 pb-28 pt-4 md:px-6 md:pb-6 md:overflow-y-auto print:p-0 print:overflow-visible"
        >
          <!-- Pull to refresh spinner indicator -->
          <div
            v-show="isRefreshIndicatorVisible"
            class="pointer-events-none absolute inset-x-0 -top-1 z-30 flex items-center justify-center gap-2 text-sm font-medium text-ink-secondary"
            aria-live="polite"
            :style="{ transform: `translateY(${indicatorOffset}px)` }"
          >
            <span
              class="h-4 w-4 rounded-full border-2 border-primary/25 border-t-primary"
              :class="isRefreshing ? 'animate-spin' : ''"
            />
            <span>{{ refreshMessage }}</span>
          </div>

          <div
            data-testid="app-pull-content"
            class="min-h-full"
            :class="
              isDragging || isRefreshing || indicatorOffset > 0
                ? isDragging || isRefreshing
                  ? 'transition-transform duration-150'
                  : 'transition-transform duration-300'
                : ''
            "
            :style="
              indicatorOffset > 0 ? { transform: `translateY(${indicatorOffset}px)` } : undefined
            "
          >
            <RouterView />
          </div>
        </main>

        <div class="print:hidden">
          <BottomNavigation />
        </div>
      </div>
    </div>

    <!-- Modal to prompt sync when internet reconnects with unsynced transactions -->
    <div class="print:hidden">
      <AppNotificationModal />
      <OfflineSyncPromptModal />
      <SyncLockedModal
        :open="showDrawerSyncLockedModal"
        @close="showDrawerSyncLockedModal = false"
      />
      <SyncProgressModal />
    </div>
  </div>
</template>
