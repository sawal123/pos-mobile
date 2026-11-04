<script setup>
import { computed } from 'vue'
import { useRoute } from 'vue-router'

import { useBusinessStore } from '@/stores/businessStore'
import { useCloudSessionStore } from '@/stores/cloudSessionStore'
import { useThemeStore } from '@/stores/themeStore'
import AppIcon from '@/components/base/AppIcon.vue'
import NexaPosLogo from '@/components/base/NexaPosLogo.vue'
import SyncStatusBadge from '@/components/sync/SyncStatusBadge.vue'
import { APP_NAME } from '@/constants/appInfo'

defineProps({
  showHamburger: {
    type: Boolean,
    default: false,
  },
})

const emit = defineEmits(['toggleSidebar'])

const route = useRoute()
const businessStore = useBusinessStore()
const cloudStore = useCloudSessionStore()
const themeStore = useThemeStore()

const isCloudMode = computed(() => {
  return Boolean(cloudStore.isAuthenticated && businessStore.mode === 'cloud')
})

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
    promos: 'Promo & Diskon',
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
    subscription: 'Langganan',
    cloud: 'Cloud Login',
    'cloud-onboarding': 'Cloud Login',
    'premium-checkout': 'Pembayaran Premium',
    'premium-payment-status': 'Status Pembayaran',
  }

  return titleMap[route?.name] ?? APP_NAME
})
</script>

<template>
  <header
    data-testid="app-header"
    class="safe-area-top sticky top-0 z-30 border-b border-zinc-200/70 bg-white/90 backdrop-blur dark:border-slate-700/60 dark:bg-[#141826]/90"
  >
    <div class="safe-area-inline flex items-center justify-between gap-2 py-3 sm:gap-3 md:py-4">
      <div class="flex min-w-0 flex-1 items-center gap-2.5 sm:gap-3">
        <!-- Hamburger Button to open sidebar -->
        <button
          v-if="showHamburger"
          id="btn-sidebar-hamburger"
          type="button"
          @click="emit('toggleSidebar')"
          class="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-zinc-200/90 bg-white text-zinc-700 shadow-xs hover:border-primary/40 hover:bg-primary/5 hover:text-primary active:scale-95 transition-all cursor-pointer dark:border-slate-700/70 dark:bg-[#1B2133] dark:text-slate-200"
          title="Buka Menu"
          aria-label="Buka Menu"
        >
          <svg
            class="h-5 w-5"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2.2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <line x1="3" y1="12" x2="21" y2="12" />
            <line x1="3" y1="6" x2="21" y2="6" />
            <line x1="3" y1="18" x2="21" y2="18" />
          </svg>
        </button>

        <NexaPosLogo v-if="!showHamburger" size="sm" class="md:hidden" />

        <div class="min-w-0 flex-1">
          <p class="truncate text-[11px] font-medium uppercase tracking-[0.12em] text-ink-secondary sm:text-xs sm:tracking-[0.18em]">
            {{ businessStore.name || APP_NAME }}
          </p>
          <h1 class="truncate text-base font-bold leading-tight text-ink-primary sm:text-lg">{{ pageTitle }}</h1>
        </div>
      </div>

      <div class="flex shrink-0 items-center gap-1.5 sm:gap-2">
        <button
          type="button"
          data-testid="header-theme-toggle"
          class="flex h-8 w-8 sm:h-9 sm:w-9 shrink-0 items-center justify-center rounded-xl border border-zinc-200/90 bg-white text-zinc-700 shadow-xs transition-all hover:border-primary/40 hover:bg-primary/5 hover:text-primary active:scale-95 cursor-pointer dark:border-slate-700/70 dark:bg-[#1B2133] dark:text-amber-300 dark:hover:border-amber-400/40"
          :title="themeStore.isDark ? 'Ganti ke Tema Light' : 'Ganti ke Tema Dark'"
          :aria-label="themeStore.isDark ? 'Ganti ke Tema Light' : 'Ganti ke Tema Dark'"
          @click="themeStore.toggleTheme()"
        >
          <AppIcon :name="themeStore.isDark ? 'sun' : 'moon'" class="h-4 w-4" />
        </button>

        <SyncStatusBadge />
        <div
          class="rounded-2xl bg-surface px-2.5 py-1 text-right text-xs sm:px-3 sm:py-1.5 sm:text-sm text-ink-secondary dark:border dark:border-slate-700/50"
        >
          <p class="max-w-[96px] truncate font-medium text-ink-primary sm:max-w-[160px] md:max-w-none">
            {{ businessStore.outlet }}
          </p>
          <p class="text-[9px] font-medium uppercase tracking-[0.1em] sm:text-[10px] sm:tracking-[0.14em]">
            {{ isCloudMode ? 'Cloud Mode' : 'Free Mode' }}
          </p>
        </div>
      </div>
    </div>
  </header>
</template>
