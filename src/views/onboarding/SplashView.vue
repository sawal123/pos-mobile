<script setup>
import { useRouter } from 'vue-router'

import BaseButton from '@/components/base/BaseButton.vue'

const router = useRouter()
</script>

<template>
  <div class="flex min-h-screen flex-col justify-between bg-primary px-6 py-10 text-white">
    <div class="space-y-4">
      <p class="text-xs uppercase tracking-[0.24em] text-white/70">POS Mobile</p>
      <h1 class="max-w-sm text-4xl font-semibold leading-tight">
        Kelola transaksi harian lebih cepat dari genggaman.
      </h1>
      <p class="max-w-md text-sm text-white/80">
        Scaffold onboarding untuk aplikasi kasir mobile dengan fondasi Tailwind dan Vue 3.
      </p>
    </div>

    <BaseButton variant="secondary" size="lg" block @click="router.push('/welcome')">
      Mulai
    </BaseButton>
  </div>
</template>
