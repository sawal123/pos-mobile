<script setup>
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'

import BaseButton from '@/components/base/BaseButton.vue'
import { useBusinessStore } from '@/stores/businessStore'
import { useCloudSessionStore } from '@/stores/cloudSessionStore'
import { useSyncPullStore } from '@/stores/syncPullStore'
import { useSyncPushStore } from '@/stores/syncPushStore'
import { useSyncStatusStore } from '@/stores/syncStatusStore'

defineProps({
  isOpen: {
    type: Boolean,
    default: false,
  },
})

const emit = defineEmits(['close'])

const router = useRouter()
const businessStore = useBusinessStore()
const cloudStore = useCloudSessionStore()
const syncPushStore = useSyncPushStore()
const syncPullStore = useSyncPullStore()
const syncStatusStore = useSyncStatusStore()

const isSyncing = ref(false)
const syncFeedback = ref('')

const isCloudMode = computed(() => {
  return Boolean(
    businessStore.mode === 'cloud' || (cloudStore.isLinked && cloudStore.hasCloudAccess),
  )
})

const pendingCount = computed(() => {
  return (
    syncPushStore.pendingCount ||
    syncStatusStore.pendingCount ||
    0
  )
})

async function handleManualSync() {
  if (isSyncing.value) return
  isSyncing.value = true
  syncFeedback.value = ''

  try {
    const pushRes = await syncPushStore.pushNow()
    const pullRes = await syncPullStore.pullNow()
    await syncStatusStore.refresh()

    if (pushRes?.ok !== false && pullRes?.ok !== false) {
      syncFeedback.value = 'Sinkronisasi berhasil! Semua data sudah selaras.'
    } else {
      syncFeedback.value =
        pushRes?.error?.message ||
        pullRes?.error?.message ||
        'Sinkronisasi selesai dengan beberapa penyesuaian.'
    }
  } catch (err) {
    syncFeedback.value = err?.message || 'Gagal melakukan sinkronisasi.'
  } finally {
    isSyncing.value = false
    setTimeout(() => {
      syncFeedback.value = ''
    }, 4000)
  }
}

function goToSyncMenu() {
  emit('close')
  router.push('/sync')
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="isOpen"
      data-testid="notification-center-modal"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs transition-opacity"
    >
      <!-- Backdrop dismiss -->
      <div class="fixed inset-0" @click="emit('close')" />

      <!-- Centered Modal Panel -->
      <div
        class="relative z-10 w-full max-w-md max-h-[85vh] overflow-y-auto rounded-3xl bg-white p-5 shadow-2xl dark:bg-[#121927] border border-zinc-200/80 dark:border-slate-800 space-y-4"
      >
        <!-- Header -->
        <div class="flex items-center justify-between border-b border-zinc-100 pb-3 dark:border-slate-800/80">
          <div class="flex items-center gap-2.5">
            <div
              class="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-[#0c182a] to-[#1e293b] text-sky-400 shadow-sm border border-slate-700"
            >
              <svg class="h-5 w-5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0"
                />
              </svg>
            </div>
            <div>
              <h3 class="text-base font-bold text-ink-primary dark:text-white">Pusat Notifikasi & Status</h3>
              <p class="text-xs text-ink-secondary dark:text-slate-400">Status sinkronisasi & informasi sistem</p>
            </div>
          </div>

          <button
            type="button"
            class="flex h-8 w-8 items-center justify-center rounded-xl text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-slate-800 dark:hover:text-slate-200 transition"
            @click="emit('close')"
          >
            <svg class="h-5 w-5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

      <!-- Sync Status Section -->
      <div class="space-y-3">
        <!-- Card 1: Data Pending Sync -->
        <div
          v-if="pendingCount > 0"
          class="rounded-2xl border border-amber-200 bg-amber-50/70 p-4 space-y-2.5 dark:border-amber-500/30 dark:bg-amber-950/20"
        >
          <div class="flex items-start gap-3">
            <div class="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-amber-500/20 text-amber-600 dark:text-amber-400">
              <svg class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
              </svg>
            </div>
            <div class="min-w-0 flex-1">
              <h4 class="text-xs font-bold text-amber-900 dark:text-amber-200">
                {{ pendingCount }} Data Menunggu Sinkronisasi
              </h4>
              <p class="text-[11px] text-amber-800/90 dark:text-amber-300/80 mt-0.5 leading-relaxed">
                Terdapat pesanan atau perubahan katalog yang belum tersinkron ke server web Cloud.
              </p>
            </div>
          </div>

          <div class="flex items-center gap-2 pt-1">
            <BaseButton
              size="sm"
              variant="primary"
              class="w-full text-xs shadow-xs"
              :disabled="isSyncing || !syncStatusStore.online"
              @click="handleManualSync"
            >
              <svg
                v-if="isSyncing"
                class="mr-1.5 h-3.5 w-3.5 animate-spin"
                fill="none"
                viewBox="0 0 24 24"
              >
                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
                <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
              </svg>
              <span>{{ isSyncing ? 'Menyinkronkan...' : 'Sinkronkan Sekarang' }}</span>
            </BaseButton>
          </div>
        </div>

        <!-- Card 2: All In Sync (No pending) -->
        <div
          v-else-if="syncStatusStore.online"
          class="flex items-center gap-3 rounded-2xl border border-emerald-200 bg-emerald-50/70 p-3.5 dark:border-emerald-500/30 dark:bg-emerald-950/20"
        >
          <div class="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-emerald-500/20 text-emerald-600 dark:text-emerald-400">
            <svg class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" d="M4.5 12.75l6 6 9-13.5" />
            </svg>
          </div>
          <div class="min-w-0 flex-1">
            <h4 class="text-xs font-bold text-emerald-900 dark:text-emerald-200">Semua Data Telah Sinkron</h4>
            <p class="text-[11px] text-emerald-800/80 dark:text-emerald-300/80">
              Transaksi dan katalog selaras dengan dashboard web Cloud.
            </p>
          </div>
        </div>

        <!-- Card 3: Offline status -->
        <div
          v-if="!syncStatusStore.online"
          class="flex items-center gap-3 rounded-2xl border border-zinc-200 bg-zinc-50 p-3.5 dark:border-slate-700/60 dark:bg-slate-800/50"
        >
          <div class="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-zinc-200 text-zinc-600 dark:bg-slate-700 dark:text-slate-300">
            <svg class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" d="M3 3l18 18M10.5 10.5a6 6 0 00-6.708 5.708M15 15a6 6 0 012.208-4.708" />
            </svg>
          </div>
          <div class="min-w-0 flex-1">
            <h4 class="text-xs font-bold text-zinc-800 dark:text-slate-200">Perangkat Sedang Offline</h4>
            <p class="text-[11px] text-zinc-600 dark:text-slate-400">
              Aplikasi tetap beroperasi penuh. Data tersimpan aman di HP dan disinkronkan saat online.
            </p>
          </div>
        </div>

        <!-- Sync Feedback Message -->
        <p v-if="syncFeedback" class="text-center text-xs font-semibold text-primary dark:text-sky-400">
          {{ syncFeedback }}
        </p>
      </div>

      <!-- Feature & Branch Updates Section -->
      <div class="rounded-2xl border border-zinc-100 bg-zinc-50/80 p-3.5 space-y-2 dark:border-slate-800 dark:bg-slate-800/40">
        <p class="text-[10px] font-bold uppercase tracking-wider text-ink-secondary dark:text-slate-400">
          Informasi Cabang & Fitur
        </p>
        <div class="space-y-1.5 text-xs">
          <div class="flex items-center justify-between text-ink-primary dark:text-slate-200">
            <span class="text-zinc-500 dark:text-slate-400">Cabang Aktif:</span>
            <span class="font-bold">{{ businessStore.outlet || 'Outlet Utama' }}</span>
          </div>
          <div class="flex items-center justify-between text-ink-primary dark:text-slate-200">
            <span class="text-zinc-500 dark:text-slate-400">Mode Operasi:</span>
            <span class="font-semibold text-sky-600 dark:text-sky-400">{{ isCloudMode ? 'Cloud Mode' : 'Free Mode' }}</span>
          </div>
          <div class="flex items-center justify-between text-ink-primary dark:text-slate-200">
            <span class="text-zinc-500 dark:text-slate-400">Auto-Sync Realtime:</span>
            <span class="font-semibold text-emerald-600 dark:text-emerald-400">Aktif</span>
          </div>
        </div>
      </div>

      <!-- Footer Action -->
      <div class="flex gap-2 pt-1">
        <BaseButton
          variant="secondary"
          size="sm"
          class="w-full text-xs"
          @click="goToSyncMenu"
        >
          Buka Halaman Sinkronisasi Lengkap
        </BaseButton>
      </div>
    </div>
  </div>
  </Teleport>
</template>
