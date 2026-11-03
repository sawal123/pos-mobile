<script setup>
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { RouterView, useRoute } from 'vue-router'

import AppHeader from '@/components/layout/AppHeader.vue'
import BottomNavigation from '@/components/layout/BottomNavigation.vue'
import TabletNavRail from '@/components/layout/TabletNavRail.vue'
import OfflineSyncPromptModal from '@/components/sync/OfflineSyncPromptModal.vue'

const route = useRoute()
const isSidebarDrawerOpen = ref(false)

const isSidebarHiddenRoute = computed(() => {
  const path = route.path
  const name = route.name
  return (
    path === '/pos' ||
    name === 'pos' ||
    path === '/payment' ||
    name === 'payment'
  )
})

// Close drawer automatically on route navigation
watch(
  () => route.fullPath,
  () => {
    isSidebarDrawerOpen.value = false
  }
)

function handleKeydown(e) {
  if (e.key === 'Escape' && isSidebarDrawerOpen.value) {
    isSidebarDrawerOpen.value = false
  }
}

onMounted(() => {
  window.addEventListener('keydown', handleKeydown)
})

onUnmounted(() => {
  window.removeEventListener('keydown', handleKeydown)
})
</script>

<template>
  <div class="min-h-screen bg-surface text-ink-primary overflow-x-clip md:h-screen md:overflow-hidden print:min-h-0 print:h-auto print:overflow-visible print:bg-white">
    <!-- Overlay Drawer for Sidebar (used when on /pos or /payment or triggered via hamburger) -->
    <div
      v-if="isSidebarDrawerOpen"
      class="fixed inset-0 z-50 flex print:hidden"
    >
      <!-- Backdrop -->
      <div
        class="fixed inset-0 bg-black/40 backdrop-blur-xs transition-opacity"
        @click="isSidebarDrawerOpen = false"
      />

      <!-- Drawer Content -->
      <div class="relative z-10 flex h-full w-72 max-w-[85vw] flex-col bg-card shadow-2xl">
        <TabletNavRail is-drawer @close="isSidebarDrawerOpen = false" />
      </div>
    </div>

    <div class="mx-auto flex min-h-screen w-full max-w-7xl items-stretch md:min-h-0 md:h-screen md:overflow-hidden print:min-h-0 print:h-auto print:max-w-none print:overflow-visible">
      <!-- Static sidebar on desktop: Hidden when on /pos or /payment -->
      <div v-if="!isSidebarHiddenRoute" class="print:hidden">
        <TabletNavRail />
      </div>

      <div class="flex min-h-screen w-full min-w-0 flex-1 flex-col md:min-h-0 md:h-screen md:overflow-hidden print:min-h-0 print:h-auto print:overflow-visible">
        <AppHeader
          class="shrink-0 print:hidden"
          :show-hamburger="isSidebarHiddenRoute"
          @toggle-sidebar="isSidebarDrawerOpen = !isSidebarDrawerOpen"
        />

        <main class="w-full min-w-0 flex-1 px-4 pb-28 pt-4 md:px-6 md:pb-6 md:overflow-y-auto print:p-0 print:overflow-visible">
          <RouterView />
        </main>

        <div class="print:hidden">
          <BottomNavigation />
        </div>
      </div>
    </div>

    <!-- Modal to prompt sync when internet reconnects with unsynced transactions -->
    <div class="print:hidden">
      <OfflineSyncPromptModal />
    </div>
  </div>
</template>

