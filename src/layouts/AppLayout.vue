<script setup>
import { RouterView } from 'vue-router'

import AppHeader from '@/components/layout/AppHeader.vue'
import BottomNavigation from '@/components/layout/BottomNavigation.vue'
import TabletNavRail from '@/components/layout/TabletNavRail.vue'
</script>

<template>
  <div class="min-h-screen bg-surface text-ink-primary overflow-x-hidden">
    <div class="mx-auto flex min-h-screen w-full max-w-7xl">
      <TabletNavRail />

      <div class="flex min-h-screen w-full min-w-0 flex-1 flex-col">
        <AppHeader />

        <main class="w-full min-w-0 flex-1 px-4 pb-28 pt-4 md:px-6 md:pb-6">
          <RouterView />
        </main>

        <BottomNavigation />
      </div>
    </div>
  </div>
</template>
