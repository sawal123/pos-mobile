<script setup>
defineProps({
  loading: {
    type: Boolean,
    default: false,
  },
  disabled: {
    type: Boolean,
    default: false,
  },
  label: {
    type: String,
    default: 'Lanjutkan dengan Google',
  },
  block: {
    type: Boolean,
    default: true,
  },
})

const emit = defineEmits(['click'])

function handleClick(event) {
  emit('click', event)
}
</script>

<template>
  <button
    id="cloud-google-signin-btn"
    type="button"
    data-testid="cloud-google-button"
    :disabled="disabled || loading"
    :class="[
      'group relative inline-flex h-12 items-center justify-center gap-3 rounded-2xl border border-zinc-200 bg-white px-5 text-sm font-medium text-ink-primary shadow-sm transition hover:border-zinc-300 hover:bg-zinc-50/80 active:scale-[0.99] focus:outline-none focus:ring-4 focus:ring-primary/10 disabled:cursor-not-allowed disabled:opacity-60',
      block ? 'w-full' : '',
    ]"
    @click="handleClick"
  >
    <!-- Google Multi-Color G Icon -->
    <svg
      v-if="!loading"
      data-testid="google-icon"
      class="h-5 w-5 shrink-0 transition group-hover:scale-105"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <path
        d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17Z"
        fill="#4285F4"
      />
      <path
        d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.1-6.72-4.93H1.26v3.15C3.25 21.37 7.31 24 12 24Z"
        fill="#34A853"
      />
      <path
        d="M5.28 14.27c-.25-.72-.38-1.49-.38-2.27s.14-1.55.38-2.27V6.58H1.26C.46 8.16 0 9.99 0 12s.46 3.84 1.26 5.42l4.02-3.15Z"
        fill="#FBBC05"
      />
      <path
        d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.25 2.63 1.26 6.58l4.02 3.15c.95-2.83 3.6-4.98 6.72-4.98Z"
        fill="#EA4335"
      />
    </svg>

    <!-- Loading Spinner -->
    <svg
      v-else
      data-testid="google-loading-spinner"
      class="h-5 w-5 animate-spin text-primary"
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <circle
        class="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        stroke-width="4"
      />
      <path
        class="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
      />
    </svg>

    <span class="truncate">{{ loading ? 'Menghubungkan...' : label }}</span>
  </button>
</template>
