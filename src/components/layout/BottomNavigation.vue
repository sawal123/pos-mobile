<script setup>
import { RouterLink, useRoute } from 'vue-router'

const route = useRoute()

const items = [
  { label: 'Shift', to: '/shift' },
  { label: 'POS', to: '/pos' },
  { label: 'Bayar', to: '/payment' },
  { label: 'Riwayat', to: '/transactions' },
  { label: 'Setting', to: '/settings' },
]

function isActive(path) {
  return route.path === path || route.path.startsWith(`${path}/`)
}
</script>

<template>
  <nav class="fixed inset-x-0 bottom-0 z-30 border-t border-zinc-200 bg-white px-2 py-2 md:hidden">
    <div class="mx-auto grid max-w-xl grid-cols-5 gap-1">
      <RouterLink
        v-for="item in items"
        :key="item.to"
        :to="item.to"
        class="rounded-2xl px-2 py-3 text-center text-xs font-medium transition"
        :class="isActive(item.to) ? 'bg-primary text-white' : 'text-ink-secondary hover:bg-zinc-100'"
      >
        {{ item.label }}
      </RouterLink>
    </div>
  </nav>
</template>
