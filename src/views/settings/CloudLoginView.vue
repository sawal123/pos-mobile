<script setup>
import { ref, computed, watch, onMounted } from 'vue'
import { Capacitor } from '@capacitor/core'

import BaseButton from '@/components/base/BaseButton.vue'
import BaseInput from '@/components/base/BaseInput.vue'
import BaseCard from '@/components/base/BaseCard.vue'
import { useCloudSessionStore } from '@/stores/cloudSessionStore'
import { useSyncPushStore } from '@/stores/syncPushStore'
import { useSyncPullStore } from '@/stores/syncPullStore'
import { useSyncBootstrapStore } from '@/stores/syncBootstrapStore'
import { useSyncConflictStore } from '@/stores/syncConflictStore'
import { useSyncOrchestratorStore } from '@/stores/syncOrchestratorStore'
import { useSyncHealthStore } from '@/stores/syncHealthStore'
import { useSyncRecoveryStore } from '@/stores/syncRecoveryStore'
import { useSyncActivityLogStore } from '@/stores/syncActivityLogStore'

const cloudStore = useCloudSessionStore()
const syncPushStore = useSyncPushStore()
const syncPullStore = useSyncPullStore()
const syncBootstrapStore = useSyncBootstrapStore()
const syncConflictStore = useSyncConflictStore()
const syncOrchestratorStore = useSyncOrchestratorStore()
const syncHealthStore = useSyncHealthStore()
const syncRecoveryStore = useSyncRecoveryStore()
const syncActivityLogStore = useSyncActivityLogStore()

// ── Form state ──────────────────────────────────────────────────────────────
const email = ref('')
const password = ref('')
const step = ref('login') // 'login' | 'select-business' | 'select-outlet' | 'done'
const syncAllMessage = ref('')
const syncAllSuccess = ref(false)
const syncMessage = ref('')
const syncSuccess = ref(false)
const pullMessage = ref('')
const pullSuccess = ref(false)
const bootstrapMessage = ref('')
const bootstrapSuccess = ref(false)
const conflictMessage = ref('')
const conflictSuccess = ref(false)
const recoveryMessage = ref('')
const recoverySuccess = ref(false)
const showClearConfirm = ref(false)

// ── Derived ─────────────────────────────────────────────────────────────────
const isAnySyncOperationBusy = computed(
  () =>
    syncOrchestratorStore.loading ||
    syncPushStore.loading ||
    syncPullStore.loading ||
    syncBootstrapStore.loading ||
    syncConflictStore.loading ||
    syncHealthStore.loading ||
    syncRecoveryStore.loading ||
    syncActivityLogStore.loading ||
    cloudStore.loading,
)

const isZeroBusiness = computed(
  () =>
    cloudStore.isAuthenticated &&
    (cloudStore.hasResolvedZeroBusiness ||
      (cloudStore.hasResolvedBusinessContext && cloudStore.businesses.length === 0)) &&
    !cloudStore.selectedBusiness,
)

const activeBusinessOutlets = computed(() => {
  const biz = cloudStore.businesses.find((b) => b.id === cloudStore.selectedBusiness?.id)
  return (biz?.outlets ?? []).filter((o) => o.status === 'active')
})

const zeroActiveOutlets = computed(
  () => step.value === 'select-outlet' && activeBusinessOutlets.value.length === 0,
)

const canSync = computed(
  () =>
    cloudStore.isAuthenticated &&
    cloudStore.hasCloudAccess &&
    Boolean(cloudStore.selectedBusiness) &&
    Boolean(cloudStore.selectedOutlet) &&
    cloudStore.isDeviceRegistered,
)

const recoveryPlan = computed(() => {
  if (!syncHealthStore.lastResult) return null
  return syncRecoveryStore.getRecoveryPlan(syncHealthStore.lastResult)
})

watch(canSync, async (isReady) => {
  if (isReady) {
    await syncPushStore.refreshPendingCount()
  }
})

// Invalidate health and recovery result when cloud context changes
watch(
  () => [
    cloudStore.user?.id,
    cloudStore.selectedBusiness?.id,
    cloudStore.selectedOutlet?.id,
    cloudStore.cloudAccess,
    cloudStore.deviceIdentifier,
    cloudStore.registeredDeviceId,
  ],
  () => {
    syncHealthStore.resetResult()
    resetRecoveryPresentation()
    showClearConfirm.value = false
  },
)

// ── Helpers ─────────────────────────────────────────────────────────────────
function getPlatform() {
  try {
    const p = Capacitor.getPlatform()
    if (p === 'android' || p === 'ios') return p
  } catch {
    // web / test
  }
  return null
}

function resetRecoveryPresentation() {
  syncRecoveryStore.resetResult()
  recoveryMessage.value = ''
  recoverySuccess.value = false
}

function snapshotCloudContext() {
  return {
    businessId: cloudStore.selectedBusiness?.id != null ? Number(cloudStore.selectedBusiness.id) : null,
    outletId: cloudStore.selectedOutlet?.id != null ? Number(cloudStore.selectedOutlet.id) : null,
    deviceIdentifier: cloudStore.deviceIdentifier != null ? String(cloudStore.deviceIdentifier) : null,
    registeredDeviceId: cloudStore.registeredDeviceId != null ? Number(cloudStore.registeredDeviceId) : null,
  }
}

function formatActivityAction(action) {
  const map = {
    PUSH_NOW: 'Sync Sekarang',
    PULL_NOW: 'Tarik Data Cloud',
    BOOTSTRAP: 'Siapkan Data Lokal',
    SYNC_ALL: 'Sinkronkan Semua',
    USE_SERVER: 'Gunakan Cloud',
    KEEP_LOCAL: 'Pertahankan Lokal',
    CHECK_HEALTH: 'Periksa Status Sync',
    RETRY_INFLIGHT: 'Coba Ulang Push',
    CONTINUE_PENDING: 'Lanjutkan Sinkronisasi',
    PREPARE_BOOTSTRAP: 'Siapkan Data Lokal',
    CONTINUE_BOOTSTRAP: 'Lanjutkan Data Bootstrap',
  }
  return map[action] || action || 'Sinkronisasi'
}

function formatActivitySummary(entry) {
  const s = entry.summary || {}
  if (entry.type === 'push') {
    return `${s.sent ?? 0} dikirim${s.remaining != null ? ` • ${s.remaining} sisa` : ''}${s.blocked ? ` • ${s.blocked} diblokir` : ''}`
  }
  if (entry.type === 'pull') {
    return `${s.applied ?? 0} diterapkan • ${s.fetched ?? 0} ditarik${s.ignored ? ` • ${s.ignored} diabaikan` : ''}`
  }
  if (entry.type === 'full_sync') {
    return `${s.pushed ?? 0} dikirim • ${s.pulled ?? 0} diterapkan`
  }
  if (entry.type === 'bootstrap') {
    return `${s.stagedCount ?? 0} data disiapkan`
  }
  if (entry.type === 'health') {
    return `Status: ${s.healthStatus || 'unknown'} • ${s.pending ?? 0} pending • ${s.conflicts ?? 0} konflik`
  }
  if (entry.type === 'recovery') {
    return `Pemulihan: ${formatActivityAction(entry.action)}`
  }
  if (entry.type === 'conflict') {
    return `Penyelesaian: ${formatActivityAction(entry.action)}`
  }
  return entry.code || ''
}

function formatActivityTime(dateStr) {
  if (!dateStr) return '-'
  try {
    const d = new Date(dateStr)
    return d.toLocaleString('id-ID', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return dateStr
  }
}

async function handleRefreshActivityLog() {
  if (isAnySyncOperationBusy.value) return
  await syncActivityLogStore.refresh({ limit: 10 })
}

async function handleConfirmClearActivityLog() {
  if (isAnySyncOperationBusy.value) return
  await syncActivityLogStore.clearHistory()
  showClearConfirm.value = false
}

async function handleCheckSyncHealth() {
  if (isAnySyncOperationBusy.value) return
  resetRecoveryPresentation()
  const startedAt = new Date().toISOString()
  const ctx = snapshotCloudContext()
  let result
  try {
    result = await syncHealthStore.checkHealth()
  } catch {
    const finishedAt = new Date().toISOString()
    void syncActivityLogStore.record({
      type: 'health',
      action: 'CHECK_HEALTH',
      status: 'failed',
      code: 'EXCEPTION',
      startedAt,
      finishedAt,
      ...ctx,
      summary: {},
    })
    return
  }

  const finishedAt = new Date().toISOString()
  const status =
    result.status === 'ready'
      ? 'success'
      : result.status === 'attention'
        ? 'attention'
        : result.status === 'blocked'
          ? 'blocked'
          : 'failed'

  void syncActivityLogStore.record({
    type: 'health',
    action: 'CHECK_HEALTH',
    status,
    code: result.code || 'HEALTH_CHECK_COMPLETED',
    startedAt,
    finishedAt,
    ...ctx,
    summary: {
      healthStatus: result.status,
      pending: result.summary?.pendingCount ?? 0,
      conflicts: result.summary?.openConflictCount ?? 0,
      hasInflight: result.summary?.hasInflight ?? false,
    },
  })
}

async function handleRecovery(action) {
  if (isAnySyncOperationBusy.value) return
  syncHealthStore.resetResult()
  resetRecoveryPresentation()
  const startedAt = new Date().toISOString()
  const ctx = snapshotCloudContext()
  let result
  try {
    result = await syncRecoveryStore.recover(action)
  } catch (err) {
    const finishedAt = new Date().toISOString()
    void syncActivityLogStore.record({
      type: 'recovery',
      action,
      status: 'failed',
      code: 'EXCEPTION',
      startedAt,
      finishedAt,
      ...ctx,
      summary: {},
    })
    recoverySuccess.value = false
    recoveryMessage.value = err.message || 'Pemulihan gagal.'
    return
  }

  const finishedAt = new Date().toISOString()
  const status = result.ok
    ? 'success'
    : ['SYNC_RECOVERY_CONFLICT_ACTION_REQUIRED', 'SYNC_RECOVERY_MANUAL_INTERVENTION_REQUIRED'].includes(
          result.code,
        )
      ? 'blocked'
      : 'failed'

  void syncActivityLogStore.record({
    type: 'recovery',
    action,
    status,
    code: result.code || (result.ok ? 'RECOVERY_COMPLETED' : 'RECOVERY_FAILED'),
    startedAt,
    finishedAt,
    ...ctx,
    summary: {
      action,
      stage: result.stage || null,
    },
  })

  try {
    await syncPushStore.refreshPendingCount()
  } catch {
    // Non-blocking best-effort refresh
  }

  try {
    await syncConflictStore.loadConflicts()
  } catch {
    // Non-blocking best-effort refresh
  }

  if (result.ok) {
    recoverySuccess.value = true
    recoveryMessage.value = result.message || 'Pemulihan sinkronisasi berhasil.'
  } else {
    recoverySuccess.value = false
    recoveryMessage.value = result.message || result.error?.message || 'Pemulihan gagal.'
  }
}

async function handleSyncAll() {
  if (isAnySyncOperationBusy.value) return
  resetRecoveryPresentation()
  syncHealthStore.resetResult()
  syncAllMessage.value = ''
  const startedAt = new Date().toISOString()
  const ctx = snapshotCloudContext()
  let result
  try {
    result = await syncOrchestratorStore.syncAll()
  } catch (err) {
    const finishedAt = new Date().toISOString()
    void syncActivityLogStore.record({
      type: 'full_sync',
      action: 'SYNC_ALL',
      status: 'failed',
      code: 'EXCEPTION',
      startedAt,
      finishedAt,
      ...ctx,
      summary: {},
    })
    syncAllSuccess.value = false
    syncAllMessage.value = err.message || 'Sinkronisasi gagal.'
    return
  }

  const finishedAt = new Date().toISOString()
  const status = result.ok
    ? 'success'
    : ['SYNC_CONFLICT_PENDING', 'SYNC_PUSH_BLOCKED_PENDING'].includes(result.code)
      ? 'blocked'
      : 'failed'

  void syncActivityLogStore.record({
    type: 'full_sync',
    action: 'SYNC_ALL',
    status,
    code: result.code || (result.ok ? 'SYNC_ALL_COMPLETED' : 'SYNC_ALL_FAILED'),
    startedAt,
    finishedAt,
    ...ctx,
    summary: {
      pushed: result.push?.removedQueueIds?.length ?? 0,
      pulled: result.pull?.applied ?? 0,
      stage: result.stage || null,
    },
  })

  await syncConflictStore.loadConflicts()
  await syncPushStore.refreshPendingCount()

  if (result.ok) {
    syncAllSuccess.value = true
    const sent = result.push?.removedQueueIds?.length ?? 0
    const applied = result.pull?.applied ?? 0
    if (sent === 0 && applied === 0) {
      syncAllMessage.value = 'Sinkronisasi selesai. Semua data sudah terbaru.'
    } else {
      syncAllMessage.value = `Sinkronisasi selesai. ${sent} data dikirim, ${applied} perubahan diterapkan.`
    }
  } else {
    syncAllSuccess.value = false
    if (result.code === 'SYNC_MORE_PUSH_PENDING') {
      syncAllMessage.value =
        'Masih ada data lokal yang menunggu dikirim. Tekan Sinkronkan Semua kembali.'
    } else if (result.code === 'SYNC_CONFLICT_PENDING') {
      syncAllMessage.value =
        'Ada konflik sinkronisasi yang harus diselesaikan terlebih dahulu.'
    } else if (result.code === 'SYNC_PUSH_BLOCKED_PENDING') {
      syncAllMessage.value =
        'Ada data lokal yang belum dapat disinkronkan dan perlu diperiksa.'
    } else {
      syncAllMessage.value =
        result.error?.message ?? result.message ?? 'Sinkronisasi gagal.'
    }
  }
}

async function handleSyncNow() {
  if (isAnySyncOperationBusy.value) return
  resetRecoveryPresentation()
  syncHealthStore.resetResult()
  syncMessage.value = ''
  const startedAt = new Date().toISOString()
  const ctx = snapshotCloudContext()
  let result
  try {
    result = await syncPushStore.pushNow()
  } catch (err) {
    const finishedAt = new Date().toISOString()
    void syncActivityLogStore.record({
      type: 'push',
      action: 'PUSH_NOW',
      status: 'failed',
      code: 'EXCEPTION',
      startedAt,
      finishedAt,
      ...ctx,
      summary: {},
    })
    syncSuccess.value = false
    syncMessage.value = err.message || 'Sinkronisasi gagal.'
    return
  }

  const finishedAt = new Date().toISOString()
  const status = result.ok
    ? 'success'
    : ['SYNC_CONFLICT', 'SYNC_CONFLICT_PENDING'].includes(result.code)
      ? 'blocked'
      : 'failed'

  void syncActivityLogStore.record({
    type: 'push',
    action: 'PUSH_NOW',
    status,
    code: result.code || (result.ok ? 'SYNC_PUSH_SUCCESS' : 'SYNC_PUSH_FAILED'),
    startedAt,
    finishedAt,
    ...ctx,
    summary: {
      sent: result.removedQueueIds?.length ?? 0,
      remaining: result.remaining ?? null,
      blocked: result.blocked?.length ?? 0,
    },
  })

  await syncConflictStore.loadConflicts()
  if (result.ok) {
    syncSuccess.value = true
    const sent = result.removedQueueIds?.length ?? 0
    const rem = result.remaining ?? 0
    if (sent === 0 && rem === 0) {
      syncMessage.value = 'Semua data telah tersinkronisasi.'
    } else {
      syncMessage.value = `${sent} data berhasil dikirim, ${rem} masih menunggu.`
    }
  } else {
    syncSuccess.value = false
    syncMessage.value = result.error?.message ?? result.message ?? 'Sinkronisasi gagal.'
  }
}

async function handlePullNow() {
  if (isAnySyncOperationBusy.value) return
  resetRecoveryPresentation()
  syncHealthStore.resetResult()
  pullMessage.value = ''
  const startedAt = new Date().toISOString()
  const ctx = snapshotCloudContext()
  let result
  try {
    result = await syncPullStore.pullNow()
  } catch (err) {
    const finishedAt = new Date().toISOString()
    void syncActivityLogStore.record({
      type: 'pull',
      action: 'PULL_NOW',
      status: 'failed',
      code: 'EXCEPTION',
      startedAt,
      finishedAt,
      ...ctx,
      summary: {},
    })
    pullSuccess.value = false
    pullMessage.value = err.message || 'Gagal menarik data cloud.'
    return
  }

  const finishedAt = new Date().toISOString()
  const status = result.ok ? 'success' : result.code === 'SYNC_CONFLICT' ? 'blocked' : 'failed'

  void syncActivityLogStore.record({
    type: 'pull',
    action: 'PULL_NOW',
    status,
    code: result.code || (result.ok ? 'SYNC_PULL_SUCCESS' : 'SYNC_PULL_FAILED'),
    startedAt,
    finishedAt,
    ...ctx,
    summary: {
      fetched: result.fetched ?? 0,
      applied: result.applied ?? 0,
      ignored: result.ignored ?? 0,
      cursorBefore: result.cursorBefore ?? null,
      cursorAfter: result.cursorAfter ?? null,
    },
  })

  await syncConflictStore.loadConflicts()
  if (result.ok) {
    pullSuccess.value = true
    const applied = result.applied ?? 0
    if (applied === 0) {
      pullMessage.value = 'Data lokal sudah terbaru.'
    } else {
      pullMessage.value = `${applied} perubahan cloud diterapkan.`
    }
  } else {
    pullSuccess.value = false
    pullMessage.value = result.error?.message ?? result.message ?? 'Gagal menarik data cloud.'
  }
}

async function handleBootstrapNow() {
  if (isAnySyncOperationBusy.value) return
  resetRecoveryPresentation()
  syncHealthStore.resetResult()
  bootstrapMessage.value = ''
  const startedAt = new Date().toISOString()
  const ctx = snapshotCloudContext()
  let result
  try {
    result = await syncBootstrapStore.bootstrapNow()
  } catch (err) {
    const finishedAt = new Date().toISOString()
    void syncActivityLogStore.record({
      type: 'bootstrap',
      action: 'BOOTSTRAP',
      status: 'failed',
      code: 'EXCEPTION',
      startedAt,
      finishedAt,
      ...ctx,
      summary: {},
    })
    bootstrapSuccess.value = false
    bootstrapMessage.value = err.message || 'Gagal menyiapkan data lokal.'
    return
  }

  const finishedAt = new Date().toISOString()
  const status = result.ok
    ? 'success'
    : result.code === 'BOOTSTRAP_PREFLIGHT_FAILED'
      ? 'blocked'
      : 'failed'

  void syncActivityLogStore.record({
    type: 'bootstrap',
    action: 'BOOTSTRAP',
    status,
    code: result.code || (result.ok ? 'BOOTSTRAP_STAGED' : 'BOOTSTRAP_FAILED'),
    startedAt,
    finishedAt,
    ...ctx,
    summary: {
      stagedCount: result.stagedCount ?? 0,
    },
  })

  if (result.ok) {
    bootstrapSuccess.value = true
    bootstrapMessage.value = 'Data lokal siap disinkronkan. Gunakan Sync Sekarang.'
    await syncPushStore.refreshPendingCount()
  } else {
    bootstrapSuccess.value = false
    if (result.code === 'BOOTSTRAP_PREFLIGHT_FAILED') {
      bootstrapMessage.value = 'Sebagian data lokal belum kompatibel untuk sinkronisasi.'
    } else {
      bootstrapMessage.value =
        result.error?.message ?? result.message ?? 'Gagal menyiapkan data lokal.'
    }
  }
}

async function handleUseServer(conflictId) {
  if (isAnySyncOperationBusy.value) return
  resetRecoveryPresentation()
  syncHealthStore.resetResult()
  conflictMessage.value = ''
  const startedAt = new Date().toISOString()
  const ctx = snapshotCloudContext()
  let result
  try {
    result = await syncConflictStore.useServer(conflictId)
  } catch (err) {
    const finishedAt = new Date().toISOString()
    void syncActivityLogStore.record({
      type: 'conflict',
      action: 'USE_SERVER',
      status: 'failed',
      code: 'EXCEPTION',
      startedAt,
      finishedAt,
      ...ctx,
      summary: {},
    })
    conflictSuccess.value = false
    conflictMessage.value = err.message || 'Gagal menyelesaikan konflik.'
    return
  }

  const finishedAt = new Date().toISOString()
  void syncActivityLogStore.record({
    type: 'conflict',
    action: 'USE_SERVER',
    status: result.ok ? 'success' : 'failed',
    code: result.code || (result.ok ? 'CONFLICT_USE_SERVER_RESOLVED' : 'CONFLICT_RESOLUTION_FAILED'),
    startedAt,
    finishedAt,
    ...ctx,
    summary: {},
  })

  if (result.ok) {
    conflictSuccess.value = true
    conflictMessage.value = 'Gunakan Tarik Data Cloud untuk mengambil data server.'
    await syncPushStore.refreshPendingCount()
  } else {
    conflictSuccess.value = false
    conflictMessage.value = result.message || 'Gagal menyelesaikan konflik.'
  }
}

async function handleKeepLocal(conflictId) {
  if (isAnySyncOperationBusy.value) return
  resetRecoveryPresentation()
  syncHealthStore.resetResult()
  conflictMessage.value = ''
  const startedAt = new Date().toISOString()
  const ctx = snapshotCloudContext()
  let result
  try {
    result = await syncConflictStore.keepLocal(conflictId)
  } catch (err) {
    const finishedAt = new Date().toISOString()
    void syncActivityLogStore.record({
      type: 'conflict',
      action: 'KEEP_LOCAL',
      status: 'failed',
      code: 'EXCEPTION',
      startedAt,
      finishedAt,
      ...ctx,
      summary: {},
    })
    conflictSuccess.value = false
    conflictMessage.value = err.message || 'Gagal menyelesaikan konflik.'
    return
  }

  const finishedAt = new Date().toISOString()
  void syncActivityLogStore.record({
    type: 'conflict',
    action: 'KEEP_LOCAL',
    status: result.ok ? 'success' : 'failed',
    code: result.code || (result.ok ? 'CONFLICT_KEEP_LOCAL_RESOLVED' : 'CONFLICT_RESOLUTION_FAILED'),
    startedAt,
    finishedAt,
    ...ctx,
    summary: {},
  })

  if (result.ok) {
    conflictSuccess.value = true
    conflictMessage.value =
      'Konflik selesai. Gunakan Sync Sekarang untuk mengirim ulang data lokal.'
    await syncPushStore.refreshPendingCount()
  } else {
    conflictSuccess.value = false
    conflictMessage.value = result.message || 'Gagal menyelesaikan konflik.'
  }
}

// ── Login flow ───────────────────────────────────────────────────────────────
async function handleLogin() {
  if (!email.value || !password.value) return

  const result = await cloudStore.login(email.value, password.value)

  if (!result.ok) return

  const { businesses } = result

  if (businesses.length === 0) {
    step.value = 'done'
    return
  }

  if (businesses.length === 1) {
    await cloudStore.selectBusiness(businesses[0].id)
    await advanceAfterBusiness(businesses[0])
    return
  }

  step.value = 'select-business'
}

async function handleSelectBusiness(businessId) {
  const result = await cloudStore.selectBusiness(businessId)
  if (!result.ok) return

  const biz = cloudStore.businesses.find((b) => b.id === businessId)
  await advanceAfterBusiness(biz)
}

async function advanceAfterBusiness(biz) {
  if (!biz.cloud_access) {
    step.value = 'done'
    return
  }

  const actOutlets = (biz.outlets ?? []).filter((o) => o.status === 'active')

  if (actOutlets.length === 0) {
    step.value = 'select-outlet' // zero-outlet error shown
    return
  }

  if (actOutlets.length === 1) {
    const outletResult = await cloudStore.selectOutlet(actOutlets[0].id)
    if (!outletResult.ok) return
    await tryRegisterDevice()
    return
  }

  step.value = 'select-outlet'
}

async function handleSelectOutlet(outletId) {
  const result = await cloudStore.selectOutlet(outletId)
  if (!result.ok) return
  await tryRegisterDevice()
}

async function tryRegisterDevice() {
  await cloudStore.doRegisterDevice({ platform: getPlatform() })
  step.value = 'done'
}

async function handleLogout() {
  if (isAnySyncOperationBusy.value) return
  resetRecoveryPresentation()
  syncHealthStore.resetResult()
  await cloudStore.logout()
  email.value = ''
  password.value = ''
  step.value = 'login'
}

// Sync context to adapter on mount (if already hydrated)
onMounted(async () => {
  if (cloudStore.isAuthenticated) {
    step.value = 'done'
    try {
      await syncPushStore.refreshPendingCount()
      await syncConflictStore.loadConflicts()
      await syncActivityLogStore.refresh({ limit: 10 })
    } catch {
      // Non-blocking best-effort refresh
    }
  }
})
</script>

<template>
  <div class="mx-auto max-w-3xl space-y-5">
    <div>
      <p class="text-sm font-medium uppercase tracking-[0.18em] text-primary">Cloud</p>
      <h2 class="mt-2 text-2xl font-semibold text-ink-primary">Cloud Login</h2>
    </div>

    <!-- ZERO BUSINESS STATE (Reachable when authenticated but has 0 businesses) -->
    <BaseCard
      v-if="isZeroBusiness"
      id="cloud-no-business"
      class="space-y-3"
    >
      <p class="rounded-2xl bg-danger/10 px-4 py-3 text-sm text-danger">
        Akun Anda belum memiliki Business. Buat Business terlebih dahulu di dashboard web.
      </p>
      <BaseButton
        id="cloud-logout-btn"
        variant="danger"
        :disabled="isAnySyncOperationBusy"
        :loading="cloudStore.loading"
        @click="handleLogout"
      >
        Logout Cloud
      </BaseButton>
    </BaseCard>

    <!-- LOGGED IN STATE -->
    <BaseCard
      v-else-if="cloudStore.isAuthenticated && step === 'done'"
      id="cloud-logged-in"
      class="space-y-4"
    >
      <div class="space-y-2">
        <div class="flex items-center justify-between rounded-2xl bg-surface px-4 py-3">
          <span class="text-sm text-ink-secondary">Email</span>
          <span class="font-medium text-ink-primary">{{ cloudStore.user?.email ?? '-' }}</span>
        </div>
        <div class="flex items-center justify-between rounded-2xl bg-surface px-4 py-3">
          <span class="text-sm text-ink-secondary">Business</span>
          <span class="font-medium text-ink-primary">{{ cloudStore.selectedBusiness?.name ?? '-' }}</span>
        </div>
        <div class="flex items-center justify-between rounded-2xl bg-surface px-4 py-3">
          <span class="text-sm text-ink-secondary">Outlet</span>
          <span class="font-medium text-ink-primary">{{ cloudStore.selectedOutlet?.name ?? '-' }}</span>
        </div>
        <div class="flex items-center justify-between rounded-2xl bg-surface px-4 py-3">
          <span class="text-sm text-ink-secondary">Cloud Access</span>
          <span
            class="font-medium"
            :class="cloudStore.cloudAccess ? 'text-emerald-600' : 'text-danger'"
          >
            {{ cloudStore.cloudAccess ? 'Aktif' : 'Tidak aktif' }}
          </span>
        </div>
        <div
          v-if="cloudStore.isDeviceRegistered"
          class="flex items-center justify-between rounded-2xl bg-surface px-4 py-3"
        >
          <span class="text-sm text-ink-secondary">Device</span>
          <span class="font-medium text-emerald-600">Terdaftar</span>
        </div>
      </div>

      <!-- P14: Initial Bootstrap Section (Free to Cloud) -->
      <div
        v-if="canSync && !syncBootstrapStore.isStaged"
        id="cloud-bootstrap-section"
        class="space-y-3 rounded-2xl border border-primary/20 bg-primary/5 p-4"
      >
        <div class="flex items-center justify-between">
          <div>
            <p class="text-sm font-semibold text-ink-primary">Siapkan Data Lokal ke Cloud</p>
            <p class="text-xs text-ink-secondary">
              Upload data offline/FREE yang sudah ada ke server cloud untuk pertama kali
            </p>
          </div>
          <BaseButton
            id="bootstrap-btn"
            variant="primary"
            size="sm"
            :disabled="isAnySyncOperationBusy"
            :loading="syncBootstrapStore.loading"
            @click="handleBootstrapNow"
          >
            Siapkan Data Lokal ke Cloud
          </BaseButton>
        </div>

        <div class="grid grid-cols-2 gap-2 text-xs text-ink-secondary sm:grid-cols-3">
          <div id="preview-products">Produk: {{ syncBootstrapStore.previewCounts.products }}</div>
          <div id="preview-categories">Kategori: {{ syncBootstrapStore.previewCounts.categories }}</div>
          <div id="preview-customers">Pelanggan: {{ syncBootstrapStore.previewCounts.customers }}</div>
          <div id="preview-expenses">Pengeluaran: {{ syncBootstrapStore.previewCounts.expenses }}</div>
          <div id="preview-transactions">Transaksi: {{ syncBootstrapStore.previewCounts.transactions }}</div>
        </div>

        <p
          v-if="bootstrapMessage && !syncBootstrapStore.isStaged"
          id="bootstrap-result-message"
          class="rounded-xl px-3 py-2 text-xs font-medium"
          :class="bootstrapSuccess ? 'bg-emerald-50 text-emerald-700' : 'bg-danger/10 text-danger'"
        >
          {{ bootstrapMessage }}
        </p>
      </div>

      <!-- P14: Bootstrap Context Mismatch Notice -->
      <div
        v-if="canSync && syncBootstrapStore.hasContextMismatch"
        id="cloud-bootstrap-mismatch-notice"
        class="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs font-medium text-amber-800"
      >
        Data lokal sudah disiapkan untuk Business/Outlet lain.
      </div>

      <!-- P14: Bootstrap Staged Notice -->
      <div
        v-else-if="canSync && syncBootstrapStore.isStagedForCurrentContext"
        id="cloud-bootstrap-staged-notice"
        class="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs font-medium text-emerald-800"
      >
        Data lokal siap disinkronkan. Gunakan Sync Sekarang.
      </div>

      <!-- P17: Sync Health & Diagnostics Section -->
      <div
        v-if="canSync"
        id="cloud-health-section"
        class="space-y-3 rounded-2xl border border-primary/20 bg-primary/5 p-4"
      >
        <div class="flex items-center justify-between">
          <div>
            <p class="text-sm font-semibold text-ink-primary">Status Sinkronisasi</p>
            <p class="text-xs text-ink-secondary">
              Periksa kondisi outbox, konflik, envelope, dan binding lokal
            </p>
          </div>
          <BaseButton
            id="sync-health-btn"
            variant="secondary"
            size="sm"
            :disabled="isAnySyncOperationBusy"
            :loading="syncHealthStore.loading"
            @click="handleCheckSyncHealth"
          >
            Periksa Status Sync
          </BaseButton>
        </div>

        <div v-if="syncHealthStore.summary" class="grid grid-cols-2 gap-2 text-xs text-ink-secondary sm:grid-cols-3">
          <div id="health-pending-count">Pending: {{ syncHealthStore.summary.pendingCount }}</div>
          <div id="health-conflict-count">Konflik: {{ syncHealthStore.summary.openConflictCount }}</div>
          <div id="health-inflight-status">In-flight: {{ syncHealthStore.summary.hasInflight ? 'Ya' : 'Tidak' }}</div>
          <div id="health-pull-cursor">Pull Cursor: {{ syncHealthStore.summary.pullCursor }}</div>
          <div id="health-bootstrap-status">
            Bootstrap: {{
              syncHealthStore.summary.bootstrapStatus === 'completed'
                ? 'Completed'
                : syncHealthStore.summary.bootstrapStatus === 'staged'
                  ? 'Staged'
                  : syncHealthStore.summary.bootstrapStatus === 'invalid'
                    ? 'Invalid'
                    : 'Belum'
            }}
          </div>
        </div>

        <div v-if="syncHealthStore.status">
          <p
            id="sync-health-status-message"
            class="rounded-xl px-3 py-2 text-xs font-medium"
            :class="{
              'bg-emerald-50 text-emerald-700': syncHealthStore.status === 'ready',
              'bg-amber-50 text-amber-700': syncHealthStore.status === 'attention',
              'bg-danger/10 text-danger': syncHealthStore.status === 'blocked',
            }"
          >
            {{
              syncHealthStore.status === 'ready'
                ? 'Status sinkronisasi lokal sehat.'
                : syncHealthStore.status === 'attention'
                  ? 'Sinkronisasi memerlukan perhatian.'
                  : 'Sinkronisasi memerlukan tindakan sebelum dapat dilanjutkan.'
            }}
          </p>

          <div v-if="syncHealthStore.issues && syncHealthStore.issues.length > 0" class="mt-2 space-y-1">
            <div
              v-for="(issue, index) in syncHealthStore.issues"
              :key="`${issue.code}-${index}`"
              :id="`health-issue-${issue.code}-${index}`"
              class="flex items-center justify-between rounded-lg px-3 py-1.5 text-xs"
              :class="issue.severity === 'blocked' ? 'bg-danger/5 text-danger' : 'bg-amber-500/10 text-amber-800'"
            >
              <span>{{ issue.message }}</span>
              <span class="font-mono uppercase font-semibold text-[10px]">{{ issue.severity }}</span>
            </div>
          </div>

          <p
            v-if="syncHealthStore.lastCheckedAt"
            id="health-last-checked-at"
            class="mt-2 text-[10px] text-ink-secondary"
          >
            Terakhir diperiksa: {{ syncHealthStore.lastCheckedAt }}
          </p>
        </div>
      </div>

      <!-- P18: Manual Sync Recovery Center -->
      <div
        v-if="canSync && (syncHealthStore.lastResult || syncRecoveryStore.loading || recoveryMessage || syncRecoveryStore.lastResult)"
        id="cloud-recovery-section"
        class="space-y-3 rounded-2xl border border-primary/20 bg-primary/5 p-4"
      >
        <div>
          <p class="text-sm font-semibold text-ink-primary">Pemulihan Sinkronisasi</p>
          <p id="recovery-plan-message" class="text-xs text-ink-secondary">
            {{ recoveryPlan?.message || 'Pilih tindakan pemulihan yang sesuai berdasarkan status diagnostik.' }}
          </p>
        </div>

        <div
          v-if="recoveryPlan?.availableActions && recoveryPlan.availableActions.length > 0"
          class="flex flex-wrap gap-2"
        >
          <BaseButton
            v-if="recoveryPlan.availableActions.includes('RETRY_INFLIGHT')"
            id="recovery-retry-inflight-btn"
            variant="primary"
            size="sm"
            :disabled="isAnySyncOperationBusy"
            :loading="syncRecoveryStore.loading && syncRecoveryStore.lastAction === 'RETRY_INFLIGHT'"
            @click="handleRecovery('RETRY_INFLIGHT')"
          >
            Coba Ulang Push
          </BaseButton>

          <BaseButton
            v-if="recoveryPlan.availableActions.includes('CONTINUE_PENDING')"
            id="recovery-continue-pending-btn"
            variant="primary"
            size="sm"
            :disabled="isAnySyncOperationBusy"
            :loading="syncRecoveryStore.loading && syncRecoveryStore.lastAction === 'CONTINUE_PENDING'"
            @click="handleRecovery('CONTINUE_PENDING')"
          >
            Lanjutkan Sinkronisasi
          </BaseButton>

          <BaseButton
            v-if="recoveryPlan.availableActions.includes('PREPARE_BOOTSTRAP')"
            id="recovery-prepare-bootstrap-btn"
            variant="primary"
            size="sm"
            :disabled="isAnySyncOperationBusy"
            :loading="syncRecoveryStore.loading && syncRecoveryStore.lastAction === 'PREPARE_BOOTSTRAP'"
            @click="handleRecovery('PREPARE_BOOTSTRAP')"
          >
            Siapkan Data Lokal
          </BaseButton>

          <BaseButton
            v-if="recoveryPlan.availableActions.includes('CONTINUE_BOOTSTRAP')"
            id="recovery-continue-bootstrap-btn"
            variant="primary"
            size="sm"
            :disabled="isAnySyncOperationBusy"
            :loading="syncRecoveryStore.loading && syncRecoveryStore.lastAction === 'CONTINUE_BOOTSTRAP'"
            @click="handleRecovery('CONTINUE_BOOTSTRAP')"
          >
            Lanjutkan Data Bootstrap
          </BaseButton>
        </div>

        <p
          v-if="recoveryMessage"
          id="recovery-result-message"
          class="rounded-xl px-3 py-2 text-xs font-medium"
          :class="recoverySuccess ? 'bg-emerald-50 text-emerald-700' : 'bg-danger/10 text-danger'"
        >
          {{ recoveryMessage }}
        </p>
      </div>

      <!-- P16: Manual Full Sync Section -->
      <div
        v-if="canSync"
        id="cloud-sync-all-section"
        class="space-y-3 rounded-2xl border border-primary/20 bg-primary/5 p-4"
      >
        <div class="flex items-center justify-between">
          <div>
            <p class="text-sm font-semibold text-ink-primary">Sinkronkan Semua</p>
            <p class="text-xs text-ink-secondary">
              Kirim data lokal tertunda lalu ambil pembaruan dari cloud
            </p>
          </div>
          <BaseButton
            id="sync-all-btn"
            variant="primary"
            size="sm"
            :disabled="syncBootstrapStore.hasContextMismatch || isAnySyncOperationBusy"
            :loading="syncOrchestratorStore.loading"
            @click="handleSyncAll"
          >
            Sinkronkan Semua
          </BaseButton>
        </div>

        <p
          v-if="syncAllMessage"
          id="sync-all-result-message"
          class="rounded-xl px-3 py-2 text-xs font-medium"
          :class="syncAllSuccess ? 'bg-emerald-50 text-emerald-700' : 'bg-danger/10 text-danger'"
        >
          {{ syncAllMessage }}
        </p>
      </div>

      <!-- P12: Manual Sync Section -->
      <div
        v-if="canSync"
        id="cloud-sync-section"
        class="space-y-3 rounded-2xl border border-primary/20 bg-primary/5 p-4"
      >
        <div class="flex items-center justify-between">
          <div>
            <p class="text-sm font-semibold text-ink-primary">Sinkronisasi Cloud</p>
            <p id="sync-pending-label" class="text-xs text-ink-secondary">
              {{ syncPushStore.pendingCount }} data menunggu sinkronisasi
            </p>
          </div>
          <BaseButton
            id="sync-now-btn"
            variant="primary"
            size="sm"
            :disabled="syncBootstrapStore.hasContextMismatch || isAnySyncOperationBusy"
            :loading="syncPushStore.loading"
            @click="handleSyncNow"
          >
            Sync Sekarang
          </BaseButton>
        </div>

        <p
          v-if="syncMessage"
          id="sync-result-message"
          class="rounded-xl px-3 py-2 text-xs font-medium"
          :class="syncSuccess ? 'bg-emerald-50 text-emerald-700' : 'bg-danger/10 text-danger'"
        >
          {{ syncMessage }}
        </p>
      </div>

      <!-- P13: Manual Pull Section -->
      <div
        v-if="canSync"
        id="cloud-pull-section"
        class="space-y-3 rounded-2xl border border-primary/20 bg-primary/5 p-4"
      >
        <div class="flex items-center justify-between">
          <div>
            <p class="text-sm font-semibold text-ink-primary">Tarik Data Cloud</p>
            <p class="text-xs text-ink-secondary">
              Ambil perubahan data dari server cloud ke POS lokal
            </p>
          </div>
          <BaseButton
            id="pull-now-btn"
            variant="secondary"
            size="sm"
            :disabled="isAnySyncOperationBusy"
            :loading="syncPullStore.loading"
            @click="handlePullNow"
          >
            Tarik Data Cloud
          </BaseButton>
        </div>

        <p
          v-if="pullMessage"
          id="pull-result-message"
          class="rounded-xl px-3 py-2 text-xs font-medium"
          :class="pullSuccess ? 'bg-emerald-50 text-emerald-700' : 'bg-danger/10 text-danger'"
        >
          {{ pullMessage }}
        </p>
      </div>

      <!-- P15: Manual Conflict Resolution Section -->
      <div
        v-if="canSync && syncConflictStore.openConflictCount > 0"
        id="cloud-conflict-section"
        class="space-y-3 rounded-2xl border border-danger/20 bg-danger/5 p-4"
      >
        <div>
          <p class="text-sm font-semibold text-danger">Konflik Sinkronisasi</p>
          <p class="text-xs text-ink-secondary">
            Ada {{ syncConflictStore.openConflictCount }} data konflik yang memerlukan keputusan manual Anda
          </p>
        </div>

        <div class="space-y-2">
          <div
            v-for="conflict in syncConflictStore.openConflicts"
            :key="conflict.id"
            :id="`conflict-item-${conflict.id}`"
            class="flex flex-col gap-2 rounded-xl bg-surface p-3 sm:flex-row sm:items-center sm:justify-between"
          >
            <div class="text-xs">
              <span class="font-semibold text-ink-primary uppercase">{{ conflict.serverEntity || conflict.entityType }}</span>
              <span class="text-ink-secondary"> • ID: {{ conflict.entityId }}</span>
              <span class="text-ink-secondary"> • Server Version: {{ conflict.serverSyncVersion }}</span>
            </div>
            <div class="flex items-center gap-2">
              <BaseButton
                :id="`use-server-btn-${conflict.id}`"
                variant="secondary"
                size="sm"
                :disabled="isAnySyncOperationBusy"
                :loading="syncConflictStore.loading"
                @click="handleUseServer(conflict.id)"
              >
                Gunakan Cloud
              </BaseButton>
              <BaseButton
                :id="`keep-local-btn-${conflict.id}`"
                variant="primary"
                size="sm"
                :disabled="isAnySyncOperationBusy"
                :loading="syncConflictStore.loading"
                @click="handleKeepLocal(conflict.id)"
              >
                Pertahankan Lokal
              </BaseButton>
            </div>
          </div>
        </div>

        <p
          v-if="conflictMessage"
          id="conflict-result-message"
          class="rounded-xl px-3 py-2 text-xs font-medium"
          :class="conflictSuccess ? 'bg-emerald-50 text-emerald-700' : 'bg-danger/10 text-danger'"
        >
          {{ conflictMessage }}
        </p>
      </div>

      <!-- P19: Sync Activity Log Section -->
      <div
        v-if="canSync"
        id="sync-activity-section"
        class="space-y-3 rounded-2xl border border-primary/20 bg-primary/5 p-4"
      >
        <div class="flex items-center justify-between">
          <div>
            <p class="text-sm font-semibold text-ink-primary">Riwayat Sinkronisasi</p>
            <p class="text-xs text-ink-secondary">
              Aktivitas dan audit trail sinkronisasi lokal (10 operasi terbaru)
            </p>
          </div>
          <div class="flex items-center gap-2">
            <BaseButton
              id="sync-activity-refresh-btn"
              variant="secondary"
              size="sm"
              :disabled="isAnySyncOperationBusy"
              :loading="syncActivityLogStore.loading"
              @click="handleRefreshActivityLog"
            >
              Muat Ulang Riwayat
            </BaseButton>
            <BaseButton
              v-if="syncActivityLogStore.entries.length > 0"
              id="sync-activity-clear-btn"
              variant="danger"
              size="sm"
              :disabled="isAnySyncOperationBusy"
              :loading="syncActivityLogStore.loading"
              @click="showClearConfirm = true"
            >
              Hapus Riwayat
            </BaseButton>
          </div>
        </div>

        <!-- Inline clear confirmation -->
        <div
          v-if="showClearConfirm"
          id="sync-activity-clear-confirm"
          class="rounded-xl border border-danger/20 bg-danger/5 p-3 space-y-2 text-xs"
        >
          <p class="font-medium text-danger">
            Hanya riwayat aktivitas sinkronisasi yang dihapus. Data POS dan antrean sinkronisasi tidak terpengaruh.
          </p>
          <div class="flex items-center gap-2">
            <BaseButton
              id="sync-activity-confirm-clear-btn"
              variant="danger"
              size="sm"
              :disabled="isAnySyncOperationBusy"
              @click="handleConfirmClearActivityLog"
            >
              Ya, Hapus Riwayat
            </BaseButton>
            <BaseButton
              id="sync-activity-cancel-clear-btn"
              variant="secondary"
              size="sm"
              @click="showClearConfirm = false"
            >
              Batal
            </BaseButton>
          </div>
        </div>

        <!-- Activity list -->
        <div v-if="syncActivityLogStore.entries.length === 0" class="text-xs text-ink-secondary italic py-2">
          Belum ada riwayat aktivitas sinkronisasi.
        </div>

        <div v-else class="space-y-2">
          <div
            v-for="entry in syncActivityLogStore.entries"
            :key="entry.id"
            :id="`activity-entry-${entry.id}`"
            class="flex flex-col gap-1 rounded-xl bg-surface p-3 text-xs sm:flex-row sm:items-center sm:justify-between"
          >
            <div class="space-y-0.5">
              <div class="flex items-center gap-2">
                <span class="font-semibold text-ink-primary">{{ formatActivityAction(entry.action) }}</span>
                <span
                  class="rounded px-1.5 py-0.5 font-mono text-[10px] uppercase font-semibold"
                  :class="{
                    'bg-emerald-50 text-emerald-700': entry.status === 'success',
                    'bg-amber-50 text-amber-700': entry.status === 'attention',
                    'bg-danger/10 text-danger': entry.status === 'blocked' || entry.status === 'failed',
                  }"
                >
                  {{ entry.status }}
                </span>
                <span v-if="entry.code" class="text-[10px] text-ink-secondary font-mono">{{ entry.code }}</span>
              </div>
              <p class="text-[11px] text-ink-secondary">
                {{ formatActivitySummary(entry) }}
              </p>
            </div>
            <div class="text-[10px] text-ink-secondary whitespace-nowrap">
              {{ formatActivityTime(entry.finishedAt || entry.startedAt) }}
            </div>
          </div>
        </div>
      </div>

      <!-- Cloud access warning -->
      <p
        v-if="!cloudStore.cloudAccess"
        id="cloud-no-access-notice"
        class="rounded-2xl bg-amber-50 px-4 py-3 text-sm text-amber-700"
      >
        Subscription Anda tidak memiliki akses Cloud Sync. POS lokal tetap dapat digunakan.
      </p>

      <!-- Device registration error -->
      <p
        v-if="cloudStore.error && step === 'done'"
        id="cloud-device-error"
        class="rounded-2xl bg-danger/10 px-4 py-3 text-sm text-danger"
      >
        {{ cloudStore.error }}
      </p>

      <BaseButton
        id="cloud-logout-btn"
        variant="danger"
        :disabled="isAnySyncOperationBusy"
        :loading="cloudStore.loading"
        @click="handleLogout"
      >
        Logout Cloud
      </BaseButton>
    </BaseCard>

    <!-- SELECT BUSINESS -->
    <BaseCard v-else-if="step === 'select-business'" id="cloud-select-business" class="space-y-3">
      <p class="text-sm font-medium text-ink-primary">Pilih Business</p>
      <div
        v-for="biz in cloudStore.businesses"
        :key="biz.id"
        class="flex cursor-pointer items-center justify-between rounded-2xl bg-surface px-4 py-3 hover:bg-surface/80"
        :id="`cloud-business-${biz.id}`"
        @click="handleSelectBusiness(biz.id)"
      >
        <span class="font-medium text-ink-primary">{{ biz.name }}</span>
        <span class="text-sm text-ink-secondary">Pilih →</span>
      </div>

      <p v-if="cloudStore.error" class="rounded-2xl bg-danger/10 px-4 py-3 text-sm text-danger">
        {{ cloudStore.error }}
      </p>
    </BaseCard>

    <!-- SELECT OUTLET -->
    <BaseCard v-else-if="step === 'select-outlet'" id="cloud-select-outlet" class="space-y-3">
      <p class="text-sm font-medium text-ink-primary">Pilih Outlet</p>

      <p
        v-if="zeroActiveOutlets"
        id="cloud-no-active-outlet"
        class="rounded-2xl bg-danger/10 px-4 py-3 text-sm text-danger"
      >
        Tidak ada outlet aktif untuk business ini. Aktifkan outlet terlebih dahulu di dashboard web.
      </p>

      <template v-else>
        <div
          v-for="outlet in activeBusinessOutlets"
          :key="outlet.id"
          class="flex cursor-pointer items-center justify-between rounded-2xl bg-surface px-4 py-3 hover:bg-surface/80"
          :id="`cloud-outlet-${outlet.id}`"
          @click="handleSelectOutlet(outlet.id)"
        >
          <span class="font-medium text-ink-primary">{{ outlet.name }}</span>
          <span class="text-sm text-ink-secondary">Pilih →</span>
        </div>
      </template>

      <p v-if="cloudStore.error" class="rounded-2xl bg-danger/10 px-4 py-3 text-sm text-danger">
        {{ cloudStore.error }}
      </p>
    </BaseCard>

    <!-- LOGIN FORM -->
    <BaseCard v-else class="space-y-4" id="cloud-login-form">
      <BaseInput
        id="cloud-email"
        v-model="email"
        label="Email"
        type="email"
        placeholder="email@domain.com"
        :disabled="cloudStore.loading"
      />

      <BaseInput
        id="cloud-password"
        v-model="password"
        label="Password"
        type="password"
        placeholder="••••••••"
        :disabled="cloudStore.loading"
      />

      <p
        v-if="cloudStore.error"
        id="cloud-login-error"
        class="rounded-2xl bg-danger/10 px-4 py-3 text-sm text-danger"
      >
        {{ cloudStore.error }}
      </p>

      <BaseButton
        id="cloud-login-btn"
        block
        :loading="cloudStore.loading"
        :disabled="!email || !password || cloudStore.loading"
        @click="handleLogin"
      >
        Login Cloud
      </BaseButton>
    </BaseCard>
  </div>
</template>
