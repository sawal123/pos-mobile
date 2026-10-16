<script setup>
import { computed } from 'vue'
import { formatCurrency } from '@/utils/formatters'

const props = defineProps({
  item: {
    type: Object,
    required: true,
  },
  // Larger touch targets for the Android bottom sheet.
  touch: {
    type: Boolean,
    default: false,
  },
  // Show the per-line subtotal (price x qty).
  showSubtotal: {
    type: Boolean,
    default: false,
  },
})

const emit = defineEmits(['increase', 'decrease', 'remove', 'update-qty'])

const isServiceKg = computed(
  () => props.item.kind === 'service' && props.item.pricingUnit === 'kg',
)

const step = computed(() => (isServiceKg.value ? 0.1 : 1))

/**
 * Minimum quantity for this line:
 * - Laundry services priced per kg keep their fractional rule (0.1 kg default,
 *   or the product's own minimum quantity);
 * - everything else is an integer of at least 1.
 */
const minQty = computed(() => {
  if (!isServiceKg.value) {
    return 1
  }

  const configured = Number(props.item.minQuantity)
  return Number.isFinite(configured) && configured > 0 ? configured : 0.1
})

const lineSubtotal = computed(() => (Number(props.item.price) || 0) * (Number(props.item.qty) || 0))

const unitLabel = computed(() => props.item.pricingUnit || props.item.unit || 'pcs')

// The minus button is disabled at the minimum: reaching the minimum must never
// silently remove the line — that is what the explicit "Hapus" button is for.
const canDecrease = computed(() => Number(props.item.qty) > minQty.value + 1e-9)

const stepperButtonClass = computed(() => [
  'flex items-center justify-center rounded-lg text-zinc-500 transition active:scale-95 cursor-pointer text-xs font-bold disabled:cursor-not-allowed disabled:opacity-40 disabled:active:scale-100 hover:bg-zinc-100',
  props.touch ? 'h-9 w-9' : 'h-7 w-7',
])

const removeButtonClass = computed(() => [
  'flex items-center justify-center rounded-xl text-zinc-400 transition active:scale-95 cursor-pointer hover:bg-rose-50 hover:text-danger',
  props.touch ? 'h-10 w-10' : 'h-8 w-8',
])

function roundQty(value) {
  return isServiceKg.value ? Math.round(value * 100) / 100 : Math.floor(value)
}

function handleDecrease() {
  if (!canDecrease.value) {
    return
  }

  if (isServiceKg.value) {
    emit('update-qty', props.item.id, Math.max(minQty.value, roundQty(Number(props.item.qty) - step.value)))
    return
  }

  emit('decrease', props.item.id)
}

function handleIncrease() {
  // Laundry-by-kg keeps its fractional step (+0.1) instead of jumping by 1.
  if (isServiceKg.value) {
    emit('update-qty', props.item.id, roundQty(Number(props.item.qty) + step.value))
    return
  }

  emit('increase', props.item.id)
}

function handleQtyInput(event) {
  const parsed = Number(event?.target?.value)
  let next = Number.isFinite(parsed) ? parsed : minQty.value

  if (next < minQty.value) {
    next = minQty.value
  }

  next = roundQty(next)

  if (next < minQty.value) {
    next = minQty.value
  }

  emit('update-qty', props.item.id, next)

  // Keep the visible input in sync even when the store value is unchanged.
  if (event?.target) {
    event.target.value = String(next)
  }
}
</script>

<template>
  <div class="flex items-center justify-between gap-2.5 rounded-2xl border border-zinc-100 bg-surface/80 p-2.5 transition hover:border-zinc-200">
    <div class="min-w-0 flex-1">
      <h4 class="truncate text-xs font-semibold text-ink-primary">{{ item.name }}</h4>
      <p class="text-[11px] text-ink-secondary">
        {{ formatCurrency(item.price) }} / {{ unitLabel }}
      </p>
      <p
        v-if="showSubtotal"
        class="mt-0.5 text-[11px] font-semibold text-ink-primary"
        data-testid="cart-item-subtotal"
      >
        Subtotal: {{ formatCurrency(lineSubtotal) }}
      </p>
    </div>

    <div class="flex shrink-0 items-center gap-1.5">
      <!-- Compact Stepper [-] [qty] [+] -->
      <div class="flex items-center rounded-xl border border-zinc-200/90 bg-white p-0.5 shadow-xs">
        <button
          type="button"
          :class="stepperButtonClass"
          :disabled="!canDecrease"
          :data-testid="`cart-item-decrease-${item.id}`"
          @click="handleDecrease"
          aria-label="Kurang Qty"
        >
          -
        </button>
        <input
          class="h-7 text-center text-xs font-bold text-ink-primary outline-none"
          :class="touch ? 'w-12' : 'w-11'"
          type="number"
          :step="step"
          :min="minQty"
          :value="item.qty"
          :aria-label="`Qty ${item.name}`"
          @change="handleQtyInput"
        />
        <button
          type="button"
          :class="stepperButtonClass"
          :data-testid="`cart-item-increase-${item.id}`"
          @click="handleIncrease"
          aria-label="Tambah Qty"
        >
          +
        </button>
      </div>

      <!-- Icon Button Hapus -->
      <button
        type="button"
        :class="removeButtonClass"
        :data-testid="`cart-item-remove-${item.id}`"
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
