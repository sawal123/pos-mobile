<script setup>
import { useNotificationStore } from '@/stores/notificationStore'

const notificationStore = useNotificationStore()
</script>

<template>
  <Teleport to="body">
    <Transition
      enter-active-class="transition duration-200 ease-out"
      enter-from-class="opacity-0"
      enter-to-class="opacity-100"
      leave-active-class="transition duration-150 ease-in"
      leave-from-class="opacity-100"
      leave-to-class="opacity-0"
    >
      <div
        v-if="notificationStore.isOpen"
        data-testid="app-notification-modal"
        class="fixed inset-0 z-[70] flex items-center justify-center bg-black/45 p-4 backdrop-blur-xs"
        @click.self="notificationStore.close()"
      >
        <div
          class="w-full max-w-xs rounded-3xl border border-zinc-200/80 bg-white p-6 text-center shadow-2xl dark:border-slate-700/70 dark:bg-[#171C2B]"
        >
          <div
            class="mx-auto flex h-14 w-14 items-center justify-center rounded-full"
            :class="
              notificationStore.type === 'error'
                ? 'bg-rose-100 text-rose-600 dark:bg-rose-500/20 dark:text-rose-300'
                : 'bg-emerald-100 text-emerald-600 dark:bg-emerald-500/20 dark:text-emerald-300'
            "
          >
            <svg
              v-if="notificationStore.type === 'error'"
              class="h-7 w-7"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2.5"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
            <svg
              v-else
              class="h-7 w-7"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2.5"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path d="M20 6L9 17l-5-5" />
            </svg>
          </div>

          <h3 class="mt-3.5 text-base font-bold text-ink-primary">
            {{ notificationStore.title }}
          </h3>
          <p v-if="notificationStore.message" class="mt-1.5 text-sm text-ink-secondary leading-relaxed">
            {{ notificationStore.message }}
          </p>

          <button
            type="button"
            data-testid="app-notification-close"
            class="mt-5 inline-flex h-10 w-full items-center justify-center rounded-2xl bg-primary px-4 text-sm font-semibold text-white transition hover:bg-primary-light active:scale-[0.98]"
            @click="notificationStore.close()"
          >
            OK
          </button>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
