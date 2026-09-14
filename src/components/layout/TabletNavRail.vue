<script setup>
import { computed } from 'vue'
import { RouterLink, useRoute } from 'vue-router'

import AppIcon from '@/components/base/AppIcon.vue'
import { getOperationalMenuItems } from '@/navigation/operationalMenu'
import { useBusinessStore } from '@/stores/businessStore'
import { useCashierStore } from '@/stores/cashierStore'
import { useShiftStore } from '@/stores/shiftStore'

const route = useRoute()
const businessStore = useBusinessStore()
const cashierStore = useCashierStore()
const shiftStore = useShiftStore()

const items = computed(() => [
  { key: 'home', icon: 'home', title: 'Home', to: '/home' },
  ...getOperationalMenuItems(businessStore.normalizedType),
])

const businessInitial = computed(() => {
  const name = businessStore.name || 'P'
  return name.trim().charAt(0).toUpperCase()
})

const cashierInitial = computed(() => {
  const name = cashierStore.activeCashier?.name || 'K'
  return name.trim().charAt(0).toUpperCase()
})

function isActive(path) {
  return route.path === path || route.path.startsWith(`${path}/`)
}
</script>

<template>
  <aside
    class="hidden w-64 shrink-0 border-r border-zinc-200/80 bg-white md:sticky md:top-0 md:flex md:h-screen md:flex-col md:self-start shadow-[1px_0_12px_rgba(0,0,0,0.03)] z-20"
  >
    <!-- Brand Header -->
    <div class="border-b border-zinc-100 bg-gradient-to-b from-zinc-50/80 to-white px-5 py-5">
      <div class="flex items-center gap-3">
        <div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-tr from-primary to-indigo-500 text-white shadow-[0_4px_14px_rgba(73,69,214,0.32)]">
          <span class="text-base font-black tracking-tight">
            {{ businessInitial }}
          </span>
        </div>
        <div class="min-w-0 flex-1">
          <h2 class="truncate text-base font-bold tracking-tight text-ink-primary">
            {{ businessStore.name || 'Demo POS Store' }}
          </h2>
          <p class="truncate text-xs text-ink-secondary">
            {{ businessStore.outlet || 'Outlet Utama' }}
          </p>
        </div>
      </div>

      <div class="mt-3 flex items-center justify-between rounded-xl bg-zinc-100/80 px-2.5 py-1.5 text-xs">
        <span class="font-medium text-ink-secondary">Tipe Bisnis</span>
        <span class="inline-flex items-center rounded-lg bg-primary/10 px-2 py-0.5 font-semibold text-primary">
          {{ businessStore.normalizedType }}
        </span>
      </div>
    </div>

    <!-- Navigation items (internal scroll only if needed) -->
    <nav class="no-scrollbar flex flex-1 flex-col gap-1.5 overflow-y-auto px-3 py-4">
      <p class="px-3 pb-1 text-[10px] font-bold uppercase tracking-[0.16em] text-zinc-400">
        Menu Operasional
      </p>

      <RouterLink
        v-for="item in items"
        :key="item.to"
        :to="item.to"
        class="group relative flex items-center gap-3 rounded-2xl px-3.5 py-2.5 text-sm font-semibold transition-all duration-200"
        :class="isActive(item.to)
          ? 'bg-gradient-to-r from-primary to-indigo-600 text-white shadow-[0_6px_18px_rgba(73,69,214,0.28)]'
          : 'text-zinc-600 hover:bg-zinc-100/90 hover:text-ink-primary hover:translate-x-1'"
      >
        <span
          class="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl transition-colors"
          :class="isActive(item.to)
            ? 'bg-white/20 text-white'
            : 'bg-zinc-100 text-zinc-500 group-hover:bg-primary/10 group-hover:text-primary'"
        >
          <AppIcon :name="item.icon" />
        </span>
        <span class="truncate">{{ item.title }}</span>
        <span
          v-if="isActive(item.to)"
          class="ml-auto h-1.5 w-1.5 rounded-full bg-white shadow-[0_0_8px_rgba(255,255,255,0.9)]"
        />
      </RouterLink>
    </nav>

    <!-- Cashier / Shift Footer -->
    <div class="border-t border-zinc-100 bg-zinc-50/60 p-3">
      <div class="flex items-center gap-2.5 rounded-2xl border border-zinc-200/70 bg-white p-2.5 shadow-sm">
        <div class="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-xs font-bold text-primary">
          <span>{{ cashierInitial }}</span>
          <span
            class="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-white"
            :class="shiftStore.isOpen ? 'bg-success' : 'bg-amber-400'"
          />
        </div>
        <div class="min-w-0 flex-1 text-xs">
          <p class="truncate font-semibold text-ink-primary">{{ cashierStore.activeCashier?.name || 'Kasir' }}</p>
          <p class="truncate text-[11px] text-ink-secondary">
            {{ shiftStore.isOpen ? 'Shift Aktif' : 'Shift Belum Buka' }}
          </p>
        </div>
      </div>
    </div>
  </aside>
</template>
