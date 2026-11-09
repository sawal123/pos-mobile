<script setup>
import { useRouter } from 'vue-router'

import AppIcon from '@/components/base/AppIcon.vue'
import BaseButton from '@/components/base/BaseButton.vue'
import NexaPosLogo from '@/components/base/NexaPosLogo.vue'
import { APP_VERSION } from '@/constants/appInfo'
import { useThemeStore } from '@/stores/themeStore'

const router = useRouter()
const themeStore = useThemeStore()
</script>

<template>
  <div
    class="flex min-h-screen flex-col justify-between bg-gradient-to-br from-[#F7F8FC] via-white to-[#EEF0FF] px-6 py-10 text-ink-primary transition-colors duration-200 dark:from-[#0F131F] dark:via-[#14192B] dark:to-[#1A1F38]"
  >
    <div class="space-y-6 pt-4">
      <div class="flex items-center justify-between gap-3">
        <NexaPosLogo size="lg" with-wordmark show-version />

        <button
          type="button"
          data-testid="splash-theme-toggle"
          class="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-zinc-200/90 bg-white text-zinc-700 shadow-xs transition hover:border-primary/40 hover:text-primary active:scale-95 cursor-pointer dark:border-slate-700/70 dark:bg-[#1B2133] dark:text-amber-300"
          :title="themeStore.isDark ? 'Ganti ke Tema Light' : 'Ganti ke Tema Dark'"
          :aria-label="themeStore.isDark ? 'Ganti ke Tema Light' : 'Ganti ke Tema Dark'"
          @click="themeStore.toggleTheme()"
        >
          <AppIcon :name="themeStore.isDark ? 'sun' : 'moon'" class="h-4 w-4" />
        </button>
      </div>

      <div class="space-y-3">
        <h1 class="max-w-sm text-3xl font-bold leading-tight text-ink-primary sm:text-4xl">
          Kelola transaksi harian lebih cepat dari genggaman.
        </h1>
        <p class="max-w-md text-sm leading-relaxed text-ink-secondary">
          Sistem kasir pintar offline-first dengan sinkronisasi Cloud real-time untuk bisnis modern.
        </p>
      </div>
    </div>

    <div class="space-y-3">
      <BaseButton variant="primary" size="lg" block @click="router.push('/welcome')">
        Mulai
      </BaseButton>
      <p class="text-center font-mono text-[11px] tracking-widest uppercase text-ink-secondary">
        Net Kasir v{{ APP_VERSION }}
      </p>
    </div>
  </div>
</template>
