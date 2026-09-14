<script setup>
import { computed, ref } from 'vue'
import { RouterLink, useRoute } from 'vue-router'

import AppIcon from '@/components/base/AppIcon.vue'
import BaseSheet from '@/components/base/BaseSheet.vue'
import { getBottomNavItems, getMoreMenuItems } from '@/navigation/operationalMenu'
import { useBusinessStore } from '@/stores/businessStore'

const route = useRoute()
const businessStore = useBusinessStore()
const showMore = ref(false)

const items = getBottomNavItems()
const moreItems = computed(() => getMoreMenuItems(businessStore.normalizedType))

function isActive(path) {
  return route.path === path || route.path.startsWith(`${path}/`)
}

const isMoreActive = computed(() => moreItems.value.some((item) => isActive(item.to)))
</script>

<template>
  <nav class="fixed inset-x-0 bottom-0 z-30 border-t border-zinc-200 bg-white px-2 py-1.5 md:hidden">
    <div class="mx-auto grid max-w-xl grid-cols-5 gap-1">
      <RouterLink
        v-for="item in items.filter((navItem) => navItem.to)"
        :key="item.to"
        :to="item.to"
        class="flex min-h-14 flex-col items-center justify-center gap-1 rounded-2xl px-1 py-2 text-center text-[11px] font-medium transition sm:text-xs"
        :class="isActive(item.to) ? 'bg-primary text-white' : 'text-ink-secondary hover:bg-zinc-100'"
        data-testid="bottom-nav-item"
      >
        <AppIcon :name="item.icon" />
        <span class="max-w-full truncate">{{ item.label }}</span>
      </RouterLink>

      <button
        type="button"
        class="flex min-h-14 flex-col items-center justify-center gap-1 rounded-2xl px-1 py-2 text-center text-[11px] font-medium transition sm:text-xs"
        :class="isMoreActive || showMore ? 'bg-primary text-white' : 'text-ink-secondary hover:bg-zinc-100'"
        data-testid="bottom-nav-item"
        @click="showMore = true"
      >
        <AppIcon name="more" />
        <span class="max-w-full truncate">Lainnya</span>
      </button>
    </div>
  </nav>

  <BaseSheet :open="showMore" title="Lainnya" @close="showMore = false">
    <div class="grid grid-cols-2 gap-3">
      <RouterLink
        v-for="item in moreItems"
        :key="item.key"
        :to="item.to"
        class="flex min-h-14 items-center gap-3 rounded-2xl border border-zinc-200 bg-white px-4 py-3 text-sm font-medium text-ink-primary"
        @click="showMore = false"
      >
        <span class="flex h-9 w-9 items-center justify-center rounded-2xl bg-primary/10 text-primary">
          <AppIcon :name="item.icon" />
        </span>
        <span class="min-w-0 truncate">{{ item.label }}</span>
      </RouterLink>
    </div>
  </BaseSheet>
</template>
