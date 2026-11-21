<script setup>
import { computed, ref } from 'vue'
import { useRoute } from 'vue-router'

import { useBusinessStore } from '@/stores/businessStore'
import { useCloudSessionStore } from '@/stores/cloudSessionStore'
import { useSyncPushStore } from '@/stores/syncPushStore'
import { useSyncStatusStore } from '@/stores/syncStatusStore'
import { useThemeStore } from '@/stores/themeStore'
import AppIcon from '@/components/base/AppIcon.vue'
import NexaPosLogo from '@/components/base/NexaPosLogo.vue'
import NotificationCenterModal from '@/components/layout/NotificationCenterModal.vue'
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
const syncPushStore = useSyncPushStore()
const syncStatusStore = useSyncStatusStore()
const themeStore = useThemeStore()

const showNotifications = ref(false)

const isCloudMode = computed(() => {
  return Boolean(cloudStore.isAuthenticated && businessStore.mode === 'cloud')
})

const pendingCount = computed(() => {
  return (
    syncPushStore.pendingCount ||
    syncStatusStore.pendingCount ||
    0
  )
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
    class="safe-area-top sticky top-0 z-30 border-b border-zinc-200/80 bg-white/95 backdrop-blur dark:border-slate-800/80 dark:bg-[#141826]/95"
  >
    <div class="safe-area-inline flex items-center justify-between gap-2 py-2.5 sm:gap-3 md:py-3.5">
      <!-- Left side: Navigation / Brand / Title -->
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
          <p class="truncate text-[10px] font-semibold uppercase tracking-[0.12em] text-primary sm:text-xs sm:tracking-[0.16em] dark:text-sky-400">
            {{ businessStore.name || APP_NAME }}
          </p>
          <h1 class="truncate text-base font-bold leading-tight text-ink-primary sm:text-lg tracking-tight dark:text-white">
            {{ pageTitle }}
          </h1>
        </div>
      </div>

      <!-- Right side: Notifications, Theme, Sync, Outlet -->
      <div class="flex shrink-0 items-center gap-1.5 sm:gap-2">
        <!-- Notification Bell Icon (Pusat Notifikasi & Pending Sync) -->
        <button
          type="button"
          data-testid="header-notification-bell"
          class="relative flex h-8 w-8 sm:h-9 sm:w-9 shrink-0 items-center justify-center rounded-xl border border-zinc-200/90 bg-white text-zinc-700 shadow-xs transition-all hover:border-primary/40 hover:bg-primary/5 hover:text-primary active:scale-95 cursor-pointer dark:border-slate-700/70 dark:bg-[#1B2133] dark:text-slate-200"
          title="Pusat Notifikasi & Status"
          aria-label="Pusat Notifikasi & Status"
          @click="showNotifications = true"
        >
          <svg class="h-4 w-4 text-zinc-700 dark:text-slate-200" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0"
            />
          </svg>
          <!-- Badge counter for pending sync / unread alert -->
          <span
            v-if="pendingCount > 0"
            data-testid="notification-bell-badge"
            class="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-rose-500 text-[9px] font-bold text-white shadow-xs animate-pulse ring-2 ring-white dark:ring-[#141826]"
          >
            {{ pendingCount > 9 ? '9+' : pendingCount }}
          </span>
          <span
            v-else-if="!syncStatusStore.online"
            class="absolute -top-0.5 -right-0.5 flex h-2 w-2 rounded-full bg-amber-400 ring-2 ring-white dark:ring-[#141826]"
          />
        </button>

        <!-- Theme Toggle Button -->
        <button
          type="button"
          data-testid="header-theme-toggle"
          class="flex h-8 w-8 sm:h-9 sm:w-9 shrink-0 items-center justify-center rounded-xl border border-zinc-200/90 bg-white text-zinc-700 shadow-xs transition-all hover:border-primary/40 hover:bg-primary/5 hover:text-primary active:scale-95 cursor-pointer dark:border-slate-700/70 dark:bg-[#1B2133] dark:text-amber-300 dark:hover:border-amber-400/40"
          :title="themeStore.isDark ? 'Ganti ke Tema Light' : 'Ganti ke Tema Dark'"
          :aria-label="themeStore.isDark ? 'Ganti ke Tema Light' : 'Ganti ke Tema Dark'"
          @click="themeStore.toggleTheme()"
        >
          <AppIcon :name="themeStore.isDark ? 'sun' : 'moon'" class="h-4 w-4 text-zinc-700 dark:text-amber-300" />
        </button>

        <!-- Sync Status Badge (Sleek on tablet/desktop to avoid mobile overcrowding) -->
        <div class="hidden sm:flex items-center">
          <SyncStatusBadge />
        </div>

        <!-- Outlet & Mode Badge -->
        <div
          class="rounded-xl border border-zinc-200/80 bg-surface px-2.5 py-1 text-right text-xs text-ink-secondary dark:border-slate-700/60 dark:bg-[#1B2133]"
        >
          <p class="max-w-[80px] sm:max-w-[130px] md:max-w-[160px] truncate font-bold text-ink-primary text-[11px] sm:text-xs dark:text-white">
            {{ businessStore.outlet }}
          </p>
          <p class="text-[8px] sm:text-[9px] font-bold uppercase tracking-wider text-primary dark:text-sky-400">
            {{ isCloudMode ? 'Cloud Mode' : 'Free Mode' }}
          </p>
        </div>
      </div>
    </div>

    <!-- Notification & Status Center Modal -->
    <NotificationCenterModal
      :is-open="showNotifications"
      @close="showNotifications = false"
    />
  </header>
</template>
