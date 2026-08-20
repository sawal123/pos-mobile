<script setup>
import { computed } from 'vue'
import { useRoute } from 'vue-router'

import { useBusinessStore } from '@/stores/businessStore'

const route = useRoute()
const businessStore = useBusinessStore()

const pageTitle = computed(() => {
  const titleMap = {
    splash: 'Splash',
    welcome: 'Welcome',
    'business-setup': 'Setup Bisnis',
    'pin-setup': 'Setup PIN',
    'open-shift': 'Buka Shift',
    shift: 'Shift Aktif',
    'close-shift': 'Tutup Shift',
    pos: 'POS',
    payment: 'Pembayaran',
    'payment-success': 'Pembayaran Berhasil',
    transactions: 'Transaksi',
    'transaction-detail': 'Detail Transaksi',
    settings: 'Pengaturan',
  }

  return titleMap[route.name] ?? 'POS Mobile'
})
</script>

<template>
  <header class="sticky top-0 z-30 border-b border-zinc-200/70 bg-white/90 backdrop-blur">
    <div class="flex items-center justify-between px-4 py-4 md:px-6">
      <div>
        <p class="text-xs uppercase tracking-[0.2em] text-ink-secondary">
          {{ businessStore.name || 'POS Mobile' }}
        </p>
        <h1 class="text-lg font-semibold text-ink-primary">{{ pageTitle }}</h1>
      </div>

      <div class="rounded-2xl bg-surface px-3 py-2 text-right text-sm text-ink-secondary">
        <p class="font-medium text-ink-primary">{{ businessStore.outlet }}</p>
        <p class="text-xs uppercase tracking-[0.14em]">
          {{ businessStore.mode === 'cloud' ? 'Cloud Mode' : 'Free Mode' }}
        </p>
      </div>
    </div>
  </header>
</template>
