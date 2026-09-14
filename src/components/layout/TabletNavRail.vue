<script setup>
import { computed } from 'vue'
import { RouterLink, useRoute } from 'vue-router'

import AppIcon from '@/components/base/AppIcon.vue'
import { getOperationalMenuItems } from '@/navigation/operationalMenu'
import { useBusinessStore } from '@/stores/businessStore'

const route = useRoute()
const businessStore = useBusinessStore()

const items = computed(() => [
  { key: 'home', icon: 'home', title: 'Home', to: '/home' },
  ...getOperationalMenuItems(businessStore.normalizedType),
])

function isActive(path) {
  return route.path === path || route.path.startsWith(`${path}/`)
}
</script>

<template>
  <aside class="hidden w-64 shrink-0 border-r border-zinc-200 bg-white md:flex md:flex-col">
    <div class="border-b border-zinc-200 px-5 py-5">
      <p class="text-xs uppercase tracking-[0.2em] text-ink-secondary">Workspace</p>
      <h2 class="mt-2 text-xl font-semibold text-ink-primary">
        {{ businessStore.name || 'Demo POS Store' }}
      </h2>
      <p class="mt-1 text-sm text-ink-secondary">
        {{ businessStore.outlet }} / {{ businessStore.type || 'Business belum diatur' }}
      </p>
    </div>

    <nav class="flex flex-1 flex-col gap-2 overflow-y-auto p-4">
      <RouterLink
        v-for="item in items"
        :key="item.to"
        :to="item.to"
        class="flex items-center gap-3 rounded-2xl px-4 py-3 text-sm font-medium transition"
        :class="isActive(item.to) ? 'bg-primary text-white' : 'text-ink-secondary hover:bg-zinc-100'"
      >
        <AppIcon :name="item.icon" />
        <span class="truncate">{{ item.title }}</span>
      </RouterLink>
    </nav>
  </aside>
</template>
