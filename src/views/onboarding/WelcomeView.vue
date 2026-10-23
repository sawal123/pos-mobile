<script setup>
import { useRouter } from 'vue-router'

import AppIcon from '@/components/base/AppIcon.vue'

const router = useRouter()

function goToCloudLogin() {
  router.push({ name: 'cloud-onboarding' })
}

function goToBusinessSetup() {
  router.push({ name: 'business-setup' })
}
</script>

<template>
  <div class="min-h-dvh bg-[#F7F8FC] text-ink-primary">
    <main class="mx-auto flex min-h-dvh w-full max-w-xl flex-col justify-center gap-6 px-4 py-8 sm:px-6">
      <header class="space-y-2">
        <p class="text-sm font-medium uppercase tracking-[0.18em] text-primary">Selamat datang</p>
        <h1 class="text-2xl font-bold leading-tight sm:text-3xl">Bagaimana Anda ingin memulai?</h1>
        <p class="text-sm leading-relaxed text-ink-secondary">
          Pilih masuk jika bisnis Anda sudah terdaftar di Cloud. Pilih mulai baru untuk mengisi data
          toko di perangkat ini.
        </p>
      </header>

      <div class="space-y-3" role="list">
        <button
          id="welcome-has-account-btn"
          type="button"
          role="listitem"
          data-testid="welcome-has-account"
          class="group flex w-full items-start gap-4 rounded-2xl border border-primary/30 bg-white p-4 text-left shadow-sm transition hover:border-primary hover:bg-primary/5 active:scale-[0.99] sm:p-5"
          @click="goToCloudLogin"
        >
          <span
            class="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary text-white"
            aria-hidden="true"
          >
            <AppIcon name="cloud" class="h-5 w-5" />
          </span>
          <span class="min-w-0 flex-1">
            <span class="block text-base font-semibold">Sudah punya akun</span>
            <span class="mt-1 block text-sm leading-relaxed text-ink-secondary">
              Masuk ke akun Cloud, pilih bisnis &amp; outlet, lalu muat produk dari Cloud.
            </span>
          </span>
          <span class="flex size-6 shrink-0 items-center justify-center self-center text-ink-secondary/50 transition group-hover:translate-x-0.5 group-hover:text-primary" aria-hidden="true">
            <AppIcon name="chevron-right" class="h-5 w-5" />
          </span>
        </button>

        <button
          id="welcome-new-business-btn"
          type="button"
          role="listitem"
          data-testid="welcome-new-business"
          class="group flex w-full items-start gap-4 rounded-2xl border border-zinc-200 bg-white p-4 text-left shadow-sm transition hover:border-primary/40 hover:bg-zinc-50 active:scale-[0.99] sm:p-5"
          @click="goToBusinessSetup"
        >
          <span
            class="flex size-11 shrink-0 items-center justify-center rounded-xl bg-zinc-100 text-ink-primary"
            aria-hidden="true"
          >
            <AppIcon name="store" class="h-5 w-5" />
          </span>
          <span class="min-w-0 flex-1">
            <span class="block text-base font-semibold">Belum punya akun</span>
            <span class="mt-1 block text-sm leading-relaxed text-ink-secondary">
              Lanjut mengisi data toko dan gunakan POS secara offline. Cloud bisa dihubungkan nanti.
            </span>
          </span>
          <span class="flex size-6 shrink-0 items-center justify-center self-center text-ink-secondary/50 transition group-hover:translate-x-0.5 group-hover:text-primary" aria-hidden="true">
            <AppIcon name="chevron-right" class="h-5 w-5" />
          </span>
        </button>
      </div>
    </main>
  </div>
</template>
