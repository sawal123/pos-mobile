<script setup>
import { computed, ref, watch } from 'vue'
import BaseButton from '@/components/base/BaseButton.vue'
import BaseSheet from '@/components/base/BaseSheet.vue'
import { formatCurrency } from '@/utils/formatters'

const props = defineProps({
  open: {
    type: Boolean,
    default: false,
  },
  product: {
    type: Object,
    default: null,
  },
  variantGroups: {
    type: Array,
    default: () => [],
  },
})

const emit = defineEmits(['close', 'confirm'])

// Selections map:
// single: groupId -> option object
// multiple: groupId -> array of option objects
const selectedSingle = ref({})
const selectedMulti = ref({})

// Initialize defaults when modal opens or product/groups change
watch(
  () => [props.open, props.product, props.variantGroups],
  ([isOpen]) => {
    if (!isOpen || !props.product) {
      selectedSingle.value = {}
      selectedMulti.value = {}
      return
    }

    const singleMap = {}
    const multiMap = {}

    for (const group of props.variantGroups) {
      const activeOptions = (group.options || []).filter((opt) => opt.status !== 'deleted')

      if (group.selectionType === 'multiple') {
        const defaultOpts = activeOptions.filter((opt) => opt.isDefault)
        multiMap[group.id] = defaultOpts
      } else {
        const defaultOpt = activeOptions.find((opt) => opt.isDefault)
        if (defaultOpt) {
          singleMap[group.id] = defaultOpt
        } else if (group.isRequired && activeOptions.length > 0) {
          singleMap[group.id] = activeOptions[0]
        }
      }
    }

    selectedSingle.value = singleMap
    selectedMulti.value = multiMap
  },
  { immediate: true },
)

function selectSingleOption(group, option) {
  selectedSingle.value = {
    ...selectedSingle.value,
    [group.id]: option,
  }
}

function toggleMultiOption(group, option) {
  const current = selectedMulti.value[group.id] || []
  const exists = current.some((opt) => (opt.id ?? opt.syncId) === (option.id ?? option.syncId))

  if (exists) {
    selectedMulti.value = {
      ...selectedMulti.value,
      [group.id]: current.filter((opt) => (opt.id ?? opt.syncId) !== (option.id ?? option.syncId)),
    }
  } else {
    if (group.maxSelection && current.length >= group.maxSelection) {
      return
    }
    selectedMulti.value = {
      ...selectedMulti.value,
      [group.id]: [...current, option],
    }
  }
}

function isMultiSelected(group, option) {
  const current = selectedMulti.value[group.id] || []
  return current.some((opt) => (opt.id ?? opt.syncId) === (option.id ?? option.syncId))
}

const allSelectedOptions = computed(() => {
  const result = []
  for (const group of props.variantGroups) {
    if (group.selectionType === 'multiple') {
      const opts = selectedMulti.value[group.id] || []
      result.push(...opts)
    } else {
      const opt = selectedSingle.value[group.id]
      if (opt) {
        result.push(opt)
      }
    }
  }
  return result
})

const variantPriceAdjustment = computed(() => {
  return allSelectedOptions.value.reduce(
    (sum, opt) => sum + (Number(opt.priceAdjustment ?? opt.price_adjustment) || 0),
    0,
  )
})

const totalPrice = computed(() => {
  const base = Number(props.product?.price ?? props.product?.unitPrice) || 0
  return Math.max(0, base + variantPriceAdjustment.value)
})

const validationError = computed(() => {
  for (const group of props.variantGroups) {
    if (group.selectionType === 'multiple') {
      const current = selectedMulti.value[group.id] || []
      const minReq = group.isRequired ? Math.max(1, group.minSelection || 1) : 0
      if (current.length < minReq) {
        return `Pilih minimal ${minReq} opsi untuk ${group.name}`
      }
      if (group.maxSelection && current.length > group.maxSelection) {
        return `Pilih maksimal ${group.maxSelection} opsi untuk ${group.name}`
      }
    } else {
      if (group.isRequired && !selectedSingle.value[group.id]) {
        return `Silakan pilih salah satu opsi untuk ${group.name}`
      }
    }
  }
  return null
})

const isValid = computed(() => !validationError.value)

function handleConfirm() {
  if (!isValid.value || !props.product) return
  emit('confirm', {
    product: props.product,
    selectedOptions: allSelectedOptions.value,
  })
}
</script>

<template>
  <BaseSheet :open="open" title="Pilih Varian Menu" @close="$emit('close')">
    <div v-if="product" class="flex flex-col gap-4 max-h-[75vh]" data-testid="product-variant-sheet">
      <!-- Product Header -->
      <div class="flex items-center justify-between border-b border-zinc-100 dark:border-slate-800 pb-3">
        <div>
          <h4 class="text-base font-bold text-ink-primary">{{ product.name }}</h4>
          <p class="text-xs text-ink-secondary">Harga Dasar: {{ formatCurrency(product.price) }}</p>
        </div>
        <span class="text-sm font-semibold text-primary dark:text-indigo-400">
          {{ formatCurrency(totalPrice) }}
        </span>
      </div>

      <!-- Variant Groups List -->
      <div class="overflow-y-auto no-scrollbar space-y-4 pr-0.5">
        <div
          v-for="group in variantGroups"
          :key="group.id"
          class="rounded-2xl border border-zinc-100 dark:border-slate-800 bg-surface/50 p-3.5 space-y-2.5"
        >
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-2">
              <span class="text-sm font-bold text-ink-primary">{{ group.name }}</span>
              <span
                class="rounded-md px-1.5 py-0.5 text-[10px] font-semibold"
                :class="
                  group.isRequired
                    ? 'bg-rose-100 text-danger dark:bg-rose-950/40 dark:text-rose-300'
                    : 'bg-zinc-100 text-zinc-500 dark:bg-slate-800 dark:text-slate-400'
                "
              >
                {{ group.isRequired ? 'Wajib' : 'Opsional' }}
              </span>
            </div>
            <span class="text-[11px] text-ink-secondary">
              {{ group.selectionType === 'multiple' ? `Maks ${group.maxSelection || 'bebas'}` : 'Pilih 1' }}
            </span>
          </div>

          <!-- Options -->
          <div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <template v-if="group.selectionType === 'multiple'">
              <button
                v-for="opt in group.options"
                :key="opt.id ?? opt.syncId"
                type="button"
                class="flex items-center justify-between rounded-xl border p-2.5 text-left text-xs transition cursor-pointer"
                :class="
                  isMultiSelected(group, opt)
                    ? 'border-primary bg-primary/5 text-primary dark:border-indigo-500 dark:bg-indigo-950/30 dark:text-indigo-300 font-semibold'
                    : 'border-zinc-200/80 bg-white dark:border-slate-700/60 dark:bg-[#1A2234] text-ink-primary hover:border-zinc-300'
                "
                @click="toggleMultiOption(group, opt)"
              >
                <div class="flex items-center gap-2 min-w-0">
                  <span
                    class="flex size-4 shrink-0 items-center justify-center rounded border"
                    :class="
                      isMultiSelected(group, opt)
                        ? 'border-primary bg-primary text-white dark:border-indigo-500 dark:bg-indigo-500'
                        : 'border-zinc-300 dark:border-slate-600'
                    "
                  >
                    <svg
                      v-if="isMultiSelected(group, opt)"
                      class="size-3"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M5 13l4 4L19 7" />
                    </svg>
                  </span>
                  <span class="truncate">{{ opt.name }}</span>
                </div>
                <span class="shrink-0 text-[11px] font-medium text-ink-secondary tabular-nums">
                  {{
                    opt.priceAdjustment || opt.price_adjustment
                      ? `+${formatCurrency(opt.priceAdjustment || opt.price_adjustment)}`
                      : 'Gratis'
                  }}
                </span>
              </button>
            </template>

            <template v-else>
              <button
                v-for="opt in group.options"
                :key="opt.id ?? opt.syncId"
                type="button"
                class="flex items-center justify-between rounded-xl border p-2.5 text-left text-xs transition cursor-pointer"
                :class="
                  selectedSingle[group.id]?.id === opt.id || selectedSingle[group.id]?.syncId === opt.syncId
                    ? 'border-primary bg-primary/5 text-primary dark:border-indigo-500 dark:bg-indigo-950/30 dark:text-indigo-300 font-semibold'
                    : 'border-zinc-200/80 bg-white dark:border-slate-700/60 dark:bg-[#1A2234] text-ink-primary hover:border-zinc-300'
                "
                @click="selectSingleOption(group, opt)"
              >
                <div class="flex items-center gap-2 min-w-0">
                  <span
                    class="flex size-4 shrink-0 items-center justify-center rounded-full border"
                    :class="
                      selectedSingle[group.id]?.id === opt.id || selectedSingle[group.id]?.syncId === opt.syncId
                        ? 'border-primary dark:border-indigo-500'
                        : 'border-zinc-300 dark:border-slate-600'
                    "
                  >
                    <span
                      v-if="selectedSingle[group.id]?.id === opt.id || selectedSingle[group.id]?.syncId === opt.syncId"
                      class="size-2 rounded-full bg-primary dark:bg-indigo-500"
                    />
                  </span>
                  <span class="truncate">{{ opt.name }}</span>
                </div>
                <span class="shrink-0 text-[11px] font-medium text-ink-secondary tabular-nums">
                  {{
                    opt.priceAdjustment || opt.price_adjustment
                      ? `+${formatCurrency(opt.priceAdjustment || opt.price_adjustment)}`
                      : 'Gratis'
                  }}
                </span>
              </button>
            </template>
          </div>
        </div>
      </div>

      <!-- Footer CTA -->
      <div class="border-t border-zinc-100 dark:border-slate-800 pt-3 space-y-2">
        <p v-if="validationError" class="text-xs text-danger text-center font-medium">
          {{ validationError }}
        </p>
        <BaseButton
          block
          :disabled="!isValid"
          class="h-11 text-sm font-bold shadow-sm shadow-primary/25 cursor-pointer"
          data-testid="confirm-variant-button"
          @click="handleConfirm"
        >
          Tambah ke Pesanan — {{ formatCurrency(totalPrice) }}
        </BaseButton>
      </div>
    </div>
  </BaseSheet>
</template>
