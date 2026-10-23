<script setup>
import { computed, ref, watch } from 'vue'
import AppIcon from '@/components/base/AppIcon.vue'
import BaseButton from '@/components/base/BaseButton.vue'
import { useBusinessStore } from '@/stores/businessStore'
import { useCloudSessionStore } from '@/stores/cloudSessionStore'
import { useSyncStatusStore } from '@/stores/syncStatusStore'
import { useSyncPushStore } from '@/stores/syncPushStore'
import { useSyncOrchestratorStore } from '@/stores/syncOrchestratorStore'

const businessStore = useBusinessStore()
const cloudStore = useCloudSessionStore()
const syncStatusStore = useSyncStatusStore()
const syncPushStore = useSyncPushStore()
const syncOrchestratorStore = useSyncOrchestratorStore()

const isOpen = ref(false)
const isSyncing = ref(false)
const syncSuccess = ref(false)
const syncError = ref('')
const dismissedCount = ref(0)

const isCloudMode = computed(
  () =>
    businessStore.mode === 'cloud' ||
    (cloudStore.isLinked && cloudStore.hasCloudAccess),
)

const pendingCount = computed(() => {
  return Math.max(syncStatusStore.pendingCount || 0, syncPushStore.pendingCount || 0)
})

function checkPromptCondition() {
  if (!isCloudMode.value) return
  if (!syncStatusStore.online) return
  if (isSyncing.value) return

  const count = pendingCount.value
  if (count > 0 && count !== dismissedCount.value) {
    isOpen.value = true
  } else if (count === 0) {
    isOpen.value = false
  }
}

// Watch online status: when online becomes true, check if we have pending data to prompt
watch(
  () => syncStatusStore.online,
  (isOnline) => {
    if (isOnline) {
      void syncStatusStore.refresh().then(() => {
        void syncPushStore.refreshPendingCount().then(() => {
          checkPromptCondition()
        })
      })
    } else {
      isOpen.value = false
    }
  },
  { immediate: true },
)

// Watch pending count changes
watch(
  () => pendingCount.value,
  (count) => {
    if (count > 0 && syncStatusStore.online) {
      if (count !== dismissedCount.value) {
        checkPromptCondition()
      }
    } else if (count === 0) {
      isOpen.value = false
    }
  },
)

function dismiss() {
  dismissedCount.value = pendingCount.value
  isOpen.value = false
}

async function handleSyncNow() {
  if (isSyncing.value) return

  isSyncing.value = true
  syncError.value = ''
  syncSuccess.value = false

  try {
    let result = null
    if (syncOrchestratorStore && typeof syncOrchestratorStore.syncAll === 'function') {
      result = await syncOrchestratorStore.syncAll()
    } else {
      result = await syncPushStore.pushNow()
    }

    await syncPushStore.refreshPendingCount()
    await syncStatusStore.refresh()

    if (result && result.ok === false) {
      syncError.value = result.message || 'Sinkronisasi gagal. Coba lagi.'
    } else {
      syncSuccess.value = true
      dismissedCount.value = 0
      setTimeout(() => {
        isOpen.value = false
        syncSuccess.value = false
      }, 1800)
    }
  } catch (err) {
    syncError.value = err.message || 'Terjadi kesalahan saat sinkronisasi.'
  } finally {
    isSyncing.value = false
  }
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="isOpen"
      id="offline-sync-prompt-modal"
      data-testid="offline-sync-prompt-modal"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs p-4"
    >
      <div
        class="w-full max-w-sm rounded-3xl bg-white p-6 shadow-2xl border border-zinc-100 transition-all transform animate-in fade-in zoom-in-95 duration-200"
      >
        <!-- Icon & Header -->
        <div class="flex items-center gap-3.5 mb-4">
          <div
            class="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary border border-primary/20"
          >
            <AppIcon name="sync" class="size-6 animate-spin-slow" />
          </div>
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-1.5">
              <span class="inline-block size-2 rounded-full bg-emerald-500 animate-pulse"></span>
              <span class="text-xs font-semibold uppercase tracking-wider text-emerald-600">Online</span>
            </div>
            <h3 class="text-base font-bold text-ink-primary leading-tight mt-0.5">
              Koneksi Internet Pulih
            </h3>
          </div>
        </div>

        <!-- Description -->
        <div class="space-y-2 mb-6">
          <p class="text-sm text-ink-secondary leading-relaxed">
            Terdapat <strong class="text-ink-primary font-bold">{{ pendingCount }} transaksi offline</strong> yang belum disinkronkan ke server database.
          </p>
          <p class="text-xs text-ink-secondary/80 leading-relaxed bg-zinc-50 border border-zinc-200/60 rounded-xl p-2.5">
            Sinkronkan sekarang agar data penjualan dan stok langsung tercatat di dashboard web Cloud.
          </p>
        </div>

        <!-- Feedback Alert -->
        <div
          v-if="syncSuccess"
          class="mb-5 flex items-center gap-2 rounded-xl bg-emerald-50 border border-emerald-200 px-3.5 py-2.5 text-xs font-medium text-emerald-800"
        >
          <AppIcon name="check" class="size-4 shrink-0 text-emerald-600" />
          <span>Semua data berhasil disinkronkan ke Cloud!</span>
        </div>

        <div
          v-else-if="syncError"
          class="mb-5 rounded-xl bg-danger/10 border border-danger/20 px-3.5 py-2.5 text-xs text-danger"
        >
          {{ syncError }}
        </div>

        <!-- Buttons -->
        <div class="flex flex-col gap-2.5">
          <BaseButton
            id="offline-sync-now-btn"
            data-testid="offline-sync-now-btn"
            variant="primary"
            size="md"
            class="w-full justify-center font-semibold"
            :loading="isSyncing"
            :disabled="isSyncing || syncSuccess"
            @click="handleSyncNow"
          >
            <AppIcon v-if="!isSyncing" name="sync" class="size-4 mr-1.5" />
            <span>{{ isSyncing ? 'Menyinkronkan...' : (syncSuccess ? 'Selesai' : 'Sinkronkan Sekarang') }}</span>
          </BaseButton>

          <BaseButton
            v-if="!syncSuccess"
            id="offline-sync-dismiss-btn"
            data-testid="offline-sync-dismiss-btn"
            variant="ghost"
            size="sm"
            class="w-full justify-center text-xs text-ink-secondary hover:text-ink-primary"
            :disabled="isSyncing"
            @click="dismiss"
          >
            Nanti Saja
          </BaseButton>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
@keyframes spinSlow {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}
.animate-spin-slow {
  animation: spinSlow 8s linear infinite;
}
</style>
