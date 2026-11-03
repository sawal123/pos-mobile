<script setup>
import { computed, watch, hasInjectionContext } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useSyncStatusStore } from '@/stores/syncStatusStore'
import { useCloudSessionStore } from '@/stores/cloudSessionStore'
import { useSyncPushStore } from '@/stores/syncPushStore'
import { useSyncPullStore } from '@/stores/syncPullStore'
import { useSyncBootstrapStore } from '@/stores/syncBootstrapStore'
import { useSyncConflictStore } from '@/stores/syncConflictStore'
import { useSyncOrchestratorStore } from '@/stores/syncOrchestratorStore'
import { useSyncRecoveryStore } from '@/stores/syncRecoveryStore'
import { useSyncAutoSyncStore } from '@/stores/syncAutoSyncStore'
import {
  deriveSyncUiStatus,
  SYNC_UI_LOCAL,
  SYNC_UI_SYNCING,
  SYNC_UI_CONFLICT,
  SYNC_UI_RECOVERY_REQUIRED,
  SYNC_UI_RECONCILIATION_COMMITTED,
  SYNC_UI_RECONCILIATION_REQUIRED,
  SYNC_UI_RECONCILIATION_WAITING,
  SYNC_UI_ACCESS_DENIED,
  SYNC_UI_CLEANUP_FAILED,
  SYNC_UI_OFFLINE,
  SYNC_UI_PENDING,
  SYNC_UI_UNKNOWN,
  SYNC_UI_CLEAR,
} from '@/services/sync/syncStatusService'

const router = useRouter()
const route = useRoute()

const statusStore = useSyncStatusStore()
const cloudStore = useCloudSessionStore()
const syncPushStore = useSyncPushStore()
const syncPullStore = useSyncPullStore()
const syncBootstrapStore = useSyncBootstrapStore()
const syncConflictStore = useSyncConflictStore()
const syncOrchestratorStore = useSyncOrchestratorStore()
const syncRecoveryStore = useSyncRecoveryStore()
const syncAutoSyncStore = useSyncAutoSyncStore()

const cloudAvailable = computed(
  () =>
    Boolean(
      cloudStore.isAuthenticated &&
        cloudStore.hasCloudAccess &&
        cloudStore.selectedBusiness &&
        cloudStore.selectedOutlet &&
        cloudStore.isDeviceRegistered,
    ),
)

const isSyncing = computed(
  () =>
    Boolean(
      syncPushStore.loading ||
        syncPullStore.loading ||
        syncBootstrapStore.loading ||
        syncConflictStore.loading ||
        syncOrchestratorStore.loading ||
        syncRecoveryStore.loading ||
        syncAutoSyncStore.running,
    ),
)

const uiStatus = computed(() =>
  deriveSyncUiStatus({
    cloudAvailable: cloudAvailable.value,
    syncing: isSyncing.value,
    online: statusStore.online,
    pendingCount: statusStore.pendingCount,
    openConflictCount: statusStore.openConflictCount,
    hasInflight: statusStore.hasInflight,
    acceptance: statusStore.acceptance,
    reconciliationRequired: statusStore.reconciliationRequired,
    reconciliationOutcome: statusStore.reconciliationOutcome,
    readError: Boolean(statusStore.lastError),
  }),
)

const badgeStyles = computed(() => {
  switch (uiStatus.value.status) {
    case SYNC_UI_SYNCING:
      return {
        container:
          'bg-primary/10 text-primary border-primary/20 hover:bg-primary/15 dark:bg-indigo-500/15 dark:text-indigo-300 dark:border-indigo-400/30',
        dot: 'bg-primary dark:bg-indigo-400 animate-pulse',
      }
    case SYNC_UI_CONFLICT:
      return {
        container:
          'bg-danger/10 text-danger border-danger/20 hover:bg-danger/15 dark:bg-rose-500/15 dark:text-rose-300 dark:border-rose-400/30',
        dot: 'bg-danger animate-pulse',
      }
    case SYNC_UI_RECOVERY_REQUIRED:
    case SYNC_UI_RECONCILIATION_REQUIRED:
    case SYNC_UI_CLEANUP_FAILED:
      return {
        container:
          'bg-amber-500/10 text-amber-600 border-amber-500/20 hover:bg-amber-500/15 dark:bg-amber-500/15 dark:text-amber-300 dark:border-amber-400/30',
        dot: 'bg-amber-500 dark:bg-amber-400',
      }
    case SYNC_UI_ACCESS_DENIED:
      return {
        container:
          'bg-danger/10 text-danger border-danger/20 hover:bg-danger/15 dark:bg-rose-500/15 dark:text-rose-300 dark:border-rose-400/30',
        dot: 'bg-danger',
      }
    case SYNC_UI_RECONCILIATION_COMMITTED:
      return {
        container:
          'bg-sky-500/10 text-sky-600 border-sky-500/20 hover:bg-sky-500/15 dark:bg-sky-500/15 dark:text-sky-300 dark:border-sky-400/30',
        dot: 'bg-sky-500 dark:bg-sky-400',
      }
    case SYNC_UI_RECONCILIATION_WAITING:
      return {
        container:
          'bg-zinc-100 text-zinc-600 border-zinc-200 hover:bg-zinc-200/70 dark:bg-slate-800/80 dark:text-slate-300 dark:border-slate-700/70',
        dot: 'bg-zinc-400 dark:bg-slate-400',
      }
    case SYNC_UI_OFFLINE:
      return {
        container:
          'bg-zinc-100 text-zinc-600 border-zinc-200 hover:bg-zinc-200/70 dark:bg-slate-800/80 dark:text-slate-300 dark:border-slate-700/70',
        dot: 'bg-zinc-400 dark:bg-slate-400',
      }
    case SYNC_UI_PENDING:
      return {
        container:
          'bg-sky-500/10 text-sky-600 border-sky-500/20 hover:bg-sky-500/15 dark:bg-sky-500/15 dark:text-sky-300 dark:border-sky-400/30',
        dot: 'bg-sky-500 dark:bg-sky-400',
      }
    case SYNC_UI_UNKNOWN:
      return {
        container:
          'bg-zinc-100 text-zinc-500 border-zinc-200 hover:bg-zinc-200/70 dark:bg-slate-800/80 dark:text-slate-300 dark:border-slate-700/70',
        dot: 'bg-zinc-400 dark:bg-slate-400',
      }
    case SYNC_UI_CLEAR:
    default:
      return {
        container:
          'bg-emerald-500/10 text-emerald-600 border-emerald-500/20 hover:bg-emerald-500/15 dark:bg-emerald-500/15 dark:text-emerald-300 dark:border-emerald-400/30',
        dot: 'bg-emerald-500 dark:bg-emerald-400',
      }
  }
})

function handleClick() {
  if (router && typeof router.push === 'function') {
    router.push({ name: 'settings' })
  }
}

// Refresh local status on route change to keep pending counts up-to-date
watch(
  () => route?.path,
  () => {
    void statusStore.refresh()
  },
)

// Refresh local status on cloud context switches
watch(
  [
    () => cloudStore.user?.id,
    () => cloudStore.selectedBusiness?.id,
    () => cloudStore.selectedOutlet?.id,
    () => cloudStore.registeredDeviceId,
  ],
  () => {
    void statusStore.refresh()
  },
)
</script>

<template>
  <button
    v-if="uiStatus.status !== SYNC_UI_LOCAL"
    id="sync-status-badge"
    type="button"
    class="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors cursor-pointer select-none"
    :class="badgeStyles.container"
    :aria-label="`Status sinkronisasi: ${uiStatus.label}`"
    :title="uiStatus.detail"
    @click="handleClick"
  >
    <span
      class="h-2 w-2 rounded-full shrink-0"
      :class="badgeStyles.dot"
      aria-hidden="true"
    />
    <span class="truncate max-w-[130px]">{{ uiStatus.label }}</span>
  </button>
</template>
