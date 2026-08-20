<script setup>
import { useRouter } from 'vue-router'

import BaseButton from '@/components/base/BaseButton.vue'
import BaseCard from '@/components/base/BaseCard.vue'

const router = useRouter()

const highlights = [
  'Onboarding bisnis dan PIN kasir',
  'Mode shift buka dan tutup',
  'POS, pembayaran, dan riwayat transaksi',
]
</script>

<template>
  <div class="mx-auto flex min-h-screen max-w-xl flex-col justify-center gap-5 px-4 py-8">
    <BaseCard class="space-y-4">
      <p class="text-sm font-medium uppercase tracking-[0.18em] text-primary">Welcome</p>
      <h1 class="text-3xl font-semibold text-ink-primary">Siapkan toko Anda dalam beberapa langkah.</h1>

      <ul class="space-y-3 text-sm text-ink-secondary">
        <li v-for="item in highlights" :key="item" class="rounded-2xl bg-surface px-4 py-3">
          {{ item }}
        </li>
      </ul>
    </BaseCard>

    <div class="grid gap-3 sm:grid-cols-2">
      <BaseButton block size="lg" @click="router.push('/setup/business')">
        Setup Bisnis
      </BaseButton>
      <BaseButton block size="lg" variant="secondary" @click="router.push('/pos')">
        Lewati Demo
      </BaseButton>
    </div>
  </div>
</template>
