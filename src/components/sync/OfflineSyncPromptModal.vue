<script setup>
import { computed, ref, watch } from 'vue'
import AppIcon from '@/components/base/AppIcon.vue'
import BaseButton from '@/components/base/BaseButton.vue'
import { useBusinessStore } from '@/stores/businessStore'
import { useCloudSessionStore } from '@/stores/cloudSessionStore'
import { useSyncStatusStore } from '@/stores/syncStatusStore'
import { useSyncPushStore } from '@/stores/syncPushStore'
import { useSyncOrchestratorStore } from '@/stores/syncOrchestratorStore'
import { useSyncProgressStore } from '@/stores/syncProgressStore'

const businessStore = useBusinessStore()
const cloudStore = useCloudSessionStore()
const syncStatusStore = useSyncStatusStore()
const syncPushStore = useSyncPushStore()
const syncOrchestratorStore = useSyncOrchestratorStore()
const syncProgressStore = useSyncProgressStore()

const isOpen = ref(false)
const isSyncing = ref(false)
const syncSuccess = ref(false)
const syncError = ref('')
const dismissedCount = ref(0)

const isCloudMode = computed(
  () => businessStore.mode === 'cloud' || (cloudStore.isLinked && cloudStore.hasCloudAccess),
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
    syncSuccess.value = false
    syncError.value = ''
    isOpen.value = true
  } else if (count === 0) {
    isOpen.value = false
  }
}

// Only check/open modal on initial mount (with leftover offline queue) or when transitioning offline -> online.
watch(
  () => syncStatusStore.online,
  (isOnline, prevOnline) => {
    if (isOnline && (prevOnline === undefined || prevOnline === false)) {
      if (prevOnline === false) {
        dismissedCount.value = 0
      }
      void syncStatusStore.refresh().then(() => {
        void syncPushStore.refreshPendingCount().then(() => {
          checkPromptCondition()
        })
      })
    } else if (!isOnline) {
      isOpen.value = false
    }
  },
  { immediate: true },
)

// Watch pending count changes only to auto-close when queue drains to 0 (never auto-open while online).
watch(
  () => pendingCount.value,
  (count) => {
    if (count === 0) {
      isOpen.value = false
      syncSuccess.value = false
      syncError.value = ''
    }
  },
)

function dismiss() {
  if (isSyncing.value) return
  dismissedCount.value = pendingCount.value
  syncSuccess.value = false
  syncError.value = ''
  isOpen.value = false
}

async function handleSyncNow() {
  if (isSyncing.value) return

  isSyncing.value = true
  syncError.value = ''
  syncSuccess.value = false
  isOpen.value = false

  try {
    await syncProgressStore.runWithProgress(
      {
        type: 'sync',
        title: 'Sinkronisasi Transaksi Offline',
        description: 'Sedang mengirim antrean transaksi offline ke server...',
      },
      async (setProgress) => {
        setProgress(20, 'Menghubungkan ke server cloud...')
        let result = null
        if (syncOrchestratorStore && typeof syncOrchestratorStore.syncAll === 'function') {
          result = await syncOrchestratorStore.syncAll()
        } else {
          result = await syncPushStore.pushNow()
        }

        setProgress(70, 'Memverifikasi status antrean...')
        await syncPushStore.refreshPendingCount()
        await syncStatusStore.refresh()

        if (result && result.ok === false) {
          syncError.value = result.message || 'Sinkronisasi gagal. Coba lagi.'
          return result
        }

        setProgress(100, 'Semua data offline berhasil disinkronkan!')
        syncSuccess.value = true
        dismissedCount.value = 0
        return { ok: true }
      },
    )
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
      @click.self="!isSyncing && dismiss()"
    >
      <div
        class="w-full max-w-sm rounded-3xl bg-white p-6 shadow-2xl border border-zinc-100 transition-all transform animate-in fade-in zoom-in-95 duration-200 dark:border-slate-700/70 dark:bg-[#171C2B]"
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
              <span class="text-xs font-semibold uppercase tracking-wider text-emerald-600"
                >Online</span
              >
            </div>
            <h3 class="text-base font-bold text-ink-primary leading-tight mt-0.5">
              Koneksi Internet Pulih
            </h3>
          </div>
          <button
            type="button"
            :disabled="isSyncing"
            data-testid="offline-sync-close-btn"
            aria-label="Tutup"
            class="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-ink-secondary transition hover:bg-zinc-100 hover:text-ink-primary disabled:opacity-40 dark:hover:bg-slate-800"
            @click="dismiss"
          >
            <svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <!-- Description -->
        <div class="space-y-2 mb-6">
          <p class="text-sm text-ink-secondary leading-relaxed">
            Terdapat
            <strong class="text-ink-primary font-bold">{{ pendingCount }} transaksi offline</strong>
            yang belum disinkronkan ke server database.
          </p>
          <p
            class="text-xs text-ink-secondary/80 leading-relaxed bg-zinc-50 border border-zinc-200/60 rounded-xl p-2.5"
          >
            Sinkronkan sekarang agar data penjualan dan stok langsung tercatat di dashboard web
            Cloud.
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
            :disabled="isSyncing"
            @click="syncSuccess ? dismiss() : handleSyncNow()"
          >
            <AppIcon v-if="!isSyncing && !syncSuccess" name="sync" class="size-4 mr-1.5" />
            <AppIcon v-else-if="!isSyncing && syncSuccess" name="check" class="size-4 mr-1.5" />
            <span>{{
              isSyncing ? 'Menyinkronkan...' : syncSuccess ? 'Selesai' : 'Sinkronkan Sekarang'
            }}</span>
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
