<script setup>
import { computed, onMounted, onUnmounted } from 'vue'
import AppIcon from '@/components/base/AppIcon.vue'
import BaseButton from '@/components/base/BaseButton.vue'
import { useSyncProgressStore } from '@/stores/syncProgressStore'

const syncProgressStore = useSyncProgressStore()

// SVG Circle parameters for radial progress
const radius = 42
const circumference = 2 * Math.PI * radius
const strokeDashoffset = computed(() => {
  const p = Math.min(100, Math.max(0, syncProgressStore.progress))
  return circumference - (p / 100) * circumference
})

function handleBackdropClick() {
  if (syncProgressStore.status === 'running') {
    return // Block closing while running
  }
  syncProgressStore.close()
}

function handleKeydown(e) {
  if (e.key === 'Escape' && syncProgressStore.status !== 'running' && syncProgressStore.isOpen) {
    syncProgressStore.close()
  }
}

onMounted(() => {
  window.addEventListener('keydown', handleKeydown)
})

onUnmounted(() => {
  window.removeEventListener('keydown', handleKeydown)
})
</script>

<template>
  <Teleport to="body">
    <div
      v-if="syncProgressStore.isOpen"
      data-testid="sync-progress-modal-backdrop"
      class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs transition-opacity duration-200"
      @click.self="handleBackdropClick"
    >
      <div
        data-testid="sync-progress-modal-card"
        class="relative w-full max-w-sm rounded-3xl bg-card border border-zinc-200/80 p-6 shadow-2xl text-center space-y-5 animate-in fade-in zoom-in-95 duration-200"
        role="dialog"
        aria-modal="true"
        :aria-label="syncProgressStore.title"
      >
        <!-- Icon & Radial Progress Spinner -->
        <div class="flex flex-col items-center justify-center pt-2">
          <!-- Running State: Radial Progress Ring with Percentage -->
          <div
            v-if="syncProgressStore.status === 'running'"
            data-testid="sync-progress-circle"
            class="relative inline-flex items-center justify-center"
          >
            <svg class="h-32 w-32 -rotate-90 transform" viewBox="0 0 100 100">
              <!-- Background Circle Track -->
              <circle
                class="text-zinc-100"
                stroke-width="7"
                stroke="currentColor"
                fill="transparent"
                :r="radius"
                cx="50"
                cy="50"
              />
              <!-- Progress Circle Bar -->
              <circle
                class="text-primary transition-all duration-300 ease-out"
                stroke-width="7"
                :stroke-dasharray="circumference"
                :stroke-dashoffset="strokeDashoffset"
                stroke-linecap="round"
                stroke="currentColor"
                fill="transparent"
                :r="radius"
                cx="50"
                cy="50"
              />
            </svg>
            <!-- Percentage Number Center -->
            <div class="absolute inset-0 flex flex-col items-center justify-center">
              <span
                data-testid="sync-progress-percent"
                class="font-mono text-3xl font-black tracking-tight text-primary"
              >
                {{ Math.round(syncProgressStore.progress) }}%
              </span>
              <span
                class="text-[10px] font-semibold tracking-widest uppercase text-ink-secondary mt-0.5"
                >Progres</span
              >
            </div>
          </div>

          <!-- Success State Icon -->
          <div
            v-else-if="syncProgressStore.status === 'success'"
            class="flex h-20 w-20 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-600"
          >
            <AppIcon name="check" class="h-10 w-10 animate-bounce" />
          </div>

          <!-- Error State Icon -->
          <div
            v-else-if="syncProgressStore.status === 'error'"
            class="flex h-20 w-20 items-center justify-center rounded-full bg-rose-500/10 text-rose-600"
          >
            <AppIcon name="warning" class="h-10 w-10" />
          </div>
        </div>

        <!-- Title & Subtitle -->
        <div class="space-y-1.5">
          <h3 data-testid="sync-progress-title" class="text-lg font-bold text-ink-primary">
            {{ syncProgressStore.title }}
          </h3>
          <p
            data-testid="sync-progress-description"
            class="text-sm text-ink-secondary leading-relaxed"
          >
            {{ syncProgressStore.description }}
          </p>
        </div>

        <!-- Warning Callout Box: Jangan Keluar atau Pindah Halaman -->
        <div
          v-if="syncProgressStore.status === 'running'"
          data-testid="sync-progress-warning"
          class="flex items-start gap-2.5 rounded-2xl bg-amber-500/10 border border-amber-500/25 p-3.5 text-left text-xs leading-snug text-amber-800"
        >
          <AppIcon name="warning" class="h-4 w-4 shrink-0 text-amber-600 mt-0.5" />
          <div>
            <p class="font-bold text-amber-900">Perhatian: Jangan keluar aplikasi</p>
            <p class="text-amber-700/90 mt-0.5">
              Mohon jangan berpindah halaman atau menutup aplikasi hingga proses selesai agar data
              tersimpan aman dan tidak terputus.
            </p>
          </div>
        </div>

        <!-- Action Button when Error -->
        <div v-if="syncProgressStore.status === 'error'" class="pt-2">
          <BaseButton
            variant="outline"
            class="w-full"
            data-testid="sync-progress-close-btn"
            @click="syncProgressStore.close"
          >
            Tutup
          </BaseButton>
        </div>
      </div>
    </div>
  </Teleport>
</template>
