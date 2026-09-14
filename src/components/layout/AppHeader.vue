<script setup>
import { computed } from 'vue'
import { useRoute } from 'vue-router'

import { useBusinessStore } from '@/stores/businessStore'
import SyncStatusBadge from '@/components/sync/SyncStatusBadge.vue'

const route = useRoute()
const businessStore = useBusinessStore()

const pageTitle = computed(() => {
  const titleMap = {
    splash: 'Splash',
    welcome: 'Welcome',
    'business-setup': 'Setup Bisnis',
    'pin-setup': 'Setup PIN',
    home: 'Home',
    'open-shift': 'Buka Shift',
    shift: 'Shift Aktif',
    'close-shift': 'Tutup Shift',
    pos: 'POS',
    products: 'Produk / Layanan',
    stock: 'Stok',
    customers: 'Pelanggan',
    expenses: 'Pengeluaran',
    cash: 'Kas',
    payment: 'Pembayaran',
    'payment-success': 'Pembayaran Berhasil',
    transactions: 'Transaksi',
    'transaction-detail': 'Detail Transaksi',
    'laundry-orders': 'Order Laundry',
    'laundry-order-create': 'Order Laundry Baru',
    'laundry-order-detail': 'Detail Order Laundry',
    reports: 'Laporan',
    settings: 'Pengaturan',
    cloud: 'Cloud Login',
  }

  return titleMap[route?.name] ?? 'POS Mobile'
})
</script>

<template>
  <header class="sticky top-0 z-30 border-b border-zinc-200/70 bg-white/90 backdrop-blur">
    <div class="flex items-center justify-between gap-3 px-4 py-3.5 md:px-6 md:py-4">
      <div class="min-w-0 flex-1">
        <p class="truncate text-xs uppercase tracking-[0.2em] text-ink-secondary">
          {{ businessStore.name || 'POS Mobile' }}
        </p>
        <h1 class="truncate text-lg font-semibold text-ink-primary">{{ pageTitle }}</h1>
      </div>

      <div class="flex shrink-0 items-center gap-2">
        <SyncStatusBadge />
        <div class="rounded-2xl bg-surface px-2.5 py-1.5 text-right text-xs sm:px-3 sm:py-2 sm:text-sm text-ink-secondary">
          <p class="max-w-[120px] truncate font-medium text-ink-primary sm:max-w-none">{{ businessStore.outlet }}</p>
          <p class="text-[10px] uppercase tracking-[0.14em] sm:text-xs">
            {{ businessStore.mode === 'cloud' ? 'Cloud Mode' : 'Free Mode' }}
          </p>
        </div>
      </div>
    </div>
  </header>
</template>
