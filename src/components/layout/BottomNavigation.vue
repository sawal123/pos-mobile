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
  <nav class="fixed inset-x-0 bottom-0 z-30 px-3 pb-[calc(env(safe-area-inset-bottom)+0.5rem)] md:hidden">
    <div class="mx-auto grid max-w-xl grid-cols-5 gap-1 rounded-[1.5rem] border border-white/70 bg-white/85 p-1.5 shadow-[0_18px_45px_rgba(24,24,27,0.16)] backdrop-blur-xl">
      <RouterLink
        v-for="item in items.filter((navItem) => navItem.to)"
        :key="item.to"
        :to="item.to"
        class="group flex min-h-14 flex-col items-center justify-center gap-1 rounded-2xl px-1 py-1.5 text-center text-[11px] font-medium transition sm:text-xs"
        :class="isActive(item.to) ? 'text-primary' : 'text-zinc-500 hover:text-ink-primary'"
        data-testid="bottom-nav-item"
      >
        <span
          class="relative flex h-8 w-8 items-center justify-center rounded-2xl transition"
          :class="isActive(item.to) ? 'bg-[linear-gradient(135deg,_rgba(73,69,214,0.16),_rgba(255,122,0,0.12))] shadow-soft' : 'group-hover:bg-zinc-100'"
        >
          <AppIcon :name="item.icon" />
        </span>
        <span class="max-w-full truncate" :class="isActive(item.to) ? 'font-semibold text-ink-primary' : ''">{{ item.label }}</span>
        <span v-if="isActive(item.to)" class="h-1 w-1 rounded-full bg-primary" />
      </RouterLink>

      <button
        type="button"
        class="group flex min-h-14 flex-col items-center justify-center gap-1 rounded-2xl px-1 py-1.5 text-center text-[11px] font-medium transition sm:text-xs"
        :class="isMoreActive || showMore ? 'text-primary' : 'text-zinc-500 hover:text-ink-primary'"
        data-testid="bottom-nav-item"
        @click="showMore = true"
      >
        <span
          class="flex h-8 w-8 items-center justify-center rounded-2xl transition"
          :class="isMoreActive || showMore ? 'bg-[linear-gradient(135deg,_rgba(73,69,214,0.16),_rgba(255,122,0,0.12))] shadow-soft' : 'group-hover:bg-zinc-100'"
        >
          <AppIcon name="more" />
        </span>
        <span class="max-w-full truncate" :class="isMoreActive || showMore ? 'font-semibold text-ink-primary' : ''">Lainnya</span>
        <span v-if="isMoreActive || showMore" class="h-1 w-1 rounded-full bg-primary" />
      </button>
    </div>
  </nav>

  <BaseSheet :open="showMore" title="Lainnya" @close="showMore = false">
    <div class="grid grid-cols-2 gap-3">
      <RouterLink
        v-for="item in moreItems"
        :key="item.key"
        :to="item.to"
        class="flex min-h-14 items-center gap-3 rounded-2xl border border-zinc-200 bg-white px-4 py-3 text-sm font-medium text-ink-primary shadow-soft"
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
