<script setup>
import BaseButton from '@/components/base/BaseButton.vue'
import { formatCurrency } from '@/utils/formatters'

defineProps({
  item: {
    type: Object,
    required: true,
  },
})

defineEmits(['increase', 'decrease', 'remove', 'update-qty'])
</script>

<template>
  <div class="flex items-center justify-between gap-2.5 rounded-2xl border border-zinc-100 bg-surface/80 p-2.5 transition hover:border-zinc-200">
    <div class="min-w-0 flex-1">
      <h4 class="truncate text-xs font-semibold text-ink-primary">{{ item.name }}</h4>
      <p class="text-[11px] text-ink-secondary">
        {{ formatCurrency(item.price) }} / {{ item.pricingUnit || item.unit || 'pcs' }}
      </p>
    </div>

    <div class="flex shrink-0 items-center gap-1.5">
      <!-- Compact Stepper [-] [qty] [+] -->
      <div class="flex items-center rounded-xl border border-zinc-200/90 bg-white p-0.5 shadow-xs">
        <button
          type="button"
          class="flex h-7 w-7 items-center justify-center rounded-lg text-zinc-500 hover:bg-zinc-100 active:scale-95 transition cursor-pointer text-xs font-bold"
          @click="$emit('decrease', item.id)"
          aria-label="Kurang Qty"
        >
          -
        </button>
        <input
          class="h-7 w-11 text-center text-xs font-bold text-ink-primary outline-none"
          type="number"
          :step="item.kind === 'service' && item.pricingUnit === 'kg' ? '0.1' : '1'"
          min="0"
          :value="item.qty"
          @change="$emit('update-qty', item.id, $event.target.value)"
        />
        <button
          type="button"
          class="flex h-7 w-7 items-center justify-center rounded-lg text-zinc-500 hover:bg-zinc-100 active:scale-95 transition cursor-pointer text-xs font-bold"
          @click="$emit('increase', item.id)"
          aria-label="Tambah Qty"
        >
          +
        </button>
      </div>

      <!-- Icon Button Hapus -->
      <button
        type="button"
        class="flex h-8 w-8 items-center justify-center rounded-xl text-zinc-400 hover:bg-rose-50 hover:text-danger active:scale-95 transition cursor-pointer"
        title="Hapus Item"
        aria-label="Hapus Item"
        @click="$emit('remove', item.id)"
      >
        <svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="3 6 5 6 21 6" />
          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
          <line x1="10" y1="11" x2="10" y2="17" />
          <line x1="14" y1="11" x2="14" y2="17" />
        </svg>
      </button>
    </div>
  </div>
</template>
