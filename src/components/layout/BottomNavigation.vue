<script setup>
import { computed, ref } from 'vue'
import { RouterLink, useRoute } from 'vue-router'

import AppIcon from '@/components/base/AppIcon.vue'
import BaseSheet from '@/components/base/BaseSheet.vue'
import SyncLockedModal from '@/components/sync/SyncLockedModal.vue'
import { useSyncAccess } from '@/composables/useSyncAccess'
import { getBottomNavItems, getMoreMenuItems } from '@/navigation/operationalMenu'
import { useBusinessStore } from '@/stores/businessStore'

const route = useRoute()
const businessStore = useBusinessStore()
const { isSyncLocked } = useSyncAccess()
const showMore = ref(false)
const showSyncLockedModal = ref(false)

const items = computed(() => getBottomNavItems(businessStore.normalizedType))
const moreItems = computed(() => getMoreMenuItems(businessStore.normalizedType))

function isItemLocked(item) {
  return item.key === 'sync' && isSyncLocked.value
}

function isActive(path) {
  return route.path === path || route.path.startsWith(`${path}/`)
}

function handleMoreNavClick(event, item, navigate) {
  showMore.value = false
  if (isItemLocked(item)) {
    event.preventDefault()
    showSyncLockedModal.value = true
    return
  }
  navigate(event)
}

const isMoreActive = computed(() => moreItems.value.some((item) => isActive(item.to)))
</script>

<template>
  <nav class="fixed inset-x-0 bottom-0 z-30 px-3 pb-[calc(env(safe-area-inset-bottom)+0.5rem)] md:hidden">
    <div class="mx-auto grid max-w-xl grid-cols-5 gap-1 rounded-[1.5rem] border border-white/70 bg-white/85 p-1.5 shadow-[0_18px_45px_rgba(24,24,27,0.16)] backdrop-blur-xl dark:border-slate-700/60 dark:bg-[#171C2B]/90 dark:shadow-[0_18px_45px_rgba(0,0,0,0.5)]">
      <RouterLink
        v-for="item in items.filter((navItem) => navItem.to)"
        :key="item.to"
        :to="item.to"
        class="group flex min-h-14 flex-col items-center justify-center gap-1 rounded-2xl px-0.5 py-1.5 text-center text-[10px] font-medium transition sm:px-1 sm:text-xs"
        :class="isActive(item.to) ? 'text-primary' : 'text-zinc-500 hover:text-ink-primary'"
        data-testid="bottom-nav-item"
      >
        <span
          class="relative flex h-8 w-8 items-center justify-center rounded-2xl transition"
          :class="isActive(item.to) ? 'bg-[linear-gradient(135deg,_rgba(73,69,214,0.16),_rgba(255,122,0,0.12))] shadow-soft' : 'group-hover:bg-zinc-100 dark:group-hover:bg-slate-800'"
        >
          <AppIcon :name="item.icon" />
        </span>
        <span class="max-w-full truncate" :class="isActive(item.to) ? 'font-semibold text-ink-primary' : ''">{{ item.label }}</span>
        <span v-if="isActive(item.to)" class="h-1 w-1 rounded-full bg-primary" />
      </RouterLink>

      <button
        type="button"
        class="group flex min-h-14 flex-col items-center justify-center gap-1 rounded-2xl px-0.5 py-1.5 text-center text-[10px] font-medium transition sm:px-1 sm:text-xs"
        :class="isMoreActive || showMore ? 'text-primary' : 'text-zinc-500 hover:text-ink-primary'"
        data-testid="bottom-nav-item"
        @click="showMore = true"
      >
        <span
          class="flex h-8 w-8 items-center justify-center rounded-2xl transition"
          :class="isMoreActive || showMore ? 'bg-[linear-gradient(135deg,_rgba(73,69,214,0.16),_rgba(255,122,0,0.12))] shadow-soft' : 'group-hover:bg-zinc-100 dark:group-hover:bg-slate-800'"
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
        v-slot="{ href, navigate }"
        :to="item.to"
        custom
      >
        <a
          :href="href"
          :data-testid="`more-menu-${item.key}`"
          :aria-haspopup="isItemLocked(item) ? 'dialog' : undefined"
          :class="[
            'flex min-h-14 items-center gap-3 rounded-2xl border px-4 py-3 text-left text-sm font-medium text-ink-primary shadow-soft transition active:scale-[0.98]',
            isItemLocked(item)
              ? 'border-amber-200/90 bg-amber-50/40 dark:border-amber-500/30 dark:bg-amber-950/20'
              : 'border-zinc-200 bg-white hover:bg-zinc-50 dark:border-slate-700/60 dark:bg-[#1B2133] dark:hover:bg-slate-800/60',
          ]"
          @click="handleMoreNavClick($event, item, navigate)"
        >
          <span
            :class="[
              'flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl',
              isItemLocked(item)
                ? 'bg-amber-100 text-amber-600 dark:bg-amber-500/20 dark:text-amber-300'
                : 'bg-primary/10 text-primary',
            ]"
          >
            <AppIcon :name="item.icon" />
          </span>
          <span class="min-w-0 flex-1 truncate">{{ item.label }}</span>
          <AppIcon
            v-if="isItemLocked(item)"
            name="lock"
            data-testid="more-menu-sync-lock"
            class="h-4 w-4 shrink-0 text-amber-500"
          />
        </a>
      </RouterLink>
    </div>
  </BaseSheet>

  <SyncLockedModal :open="showSyncLockedModal" @close="showSyncLockedModal = false" />
</template>
