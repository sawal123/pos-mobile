<script setup>
defineProps({
  method: {
    type: Object,
    required: true,
  },
  active: {
    type: Boolean,
    default: false,
  },
})
</script>

<template>
  <div
    class="relative flex flex-col items-center justify-center gap-1.5 rounded-2xl border-2 p-3 text-center transition-all cursor-pointer select-none"
    :class="active
      ? 'border-primary bg-primary/5 text-primary shadow-xs ring-2 ring-primary/20'
      : 'border-zinc-200/80 bg-white text-zinc-600 hover:border-zinc-300 hover:bg-zinc-50/80'"
  >
    <!-- Method Icon -->
    <div
      class="flex h-10 w-10 items-center justify-center rounded-xl transition-colors"
      :class="active ? 'bg-primary text-white shadow-xs' : 'bg-zinc-100 text-zinc-500'"
    >
      <!-- Cash Icon -->
      <svg v-if="method.id === 'cash'" class="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <rect x="2" y="6" width="20" height="12" rx="2" />
        <circle cx="12" cy="12" r="2" />
        <path d="M6 12h.01M18 12h.01" />
      </svg>
      <!-- QRIS Icon -->
      <svg v-else-if="method.id === 'qris'" class="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <rect x="3" y="3" width="7" height="7" rx="1" />
        <rect x="14" y="3" width="7" height="7" rx="1" />
        <rect x="3" y="14" width="7" height="7" rx="1" />
        <rect x="14" y="14" width="3" height="3" />
        <path d="M21 14v.01M18 18v3M21 21v.01M14 21v.01" />
      </svg>
      <!-- Card Icon -->
      <svg v-else class="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <rect x="2" y="5" width="20" height="14" rx="2" />
        <line x1="2" y1="10" x2="22" y2="10" />
      </svg>
    </div>

    <!-- Label -->
    <span class="text-sm font-bold tracking-tight">{{ method.label }}</span>

    <!-- Status badge -->
    <span
      class="text-[11px] font-semibold transition-colors"
      :class="active ? 'text-primary' : 'text-zinc-400'"
    >
      {{ active ? 'Dipilih' : 'Pilih' }}
    </span>
  </div>
</template>

