<script setup>
import { computed, ref, watch } from 'vue'

import AppIcon from '@/components/base/AppIcon.vue'
import BaseButton from '@/components/base/BaseButton.vue'
import { formatCurrency } from '@/utils/formatters'

const props = defineProps({
  product: {
    type: Object,
    required: true,
  },
})

defineEmits(['add'])

function isOutOfStock(product) {
  return (product.kind ?? 'product') !== 'service' && Number(product.stock ?? 0) <= 0
}

const imageLoadError = ref(false)
watch(
  () => props.product.imageData,
  () => {
    imageLoadError.value = false
  },
)

const hasImage = computed(() => Boolean(props.product.imageData && !imageLoadError.value))
const hasVariants = computed(
  () =>
    Boolean(props.product.variantGroupIds?.length || props.product.variant_group_ids?.length || props.product.hasVariants),
)

const promoPriceVal = computed(() => {
  const val = Number(props.product.promoPrice ?? props.product.promo_price)
  return Number.isFinite(val) && val > 0 && val < Number(props.product.price) ? val : null
})

const discountPercent = computed(() => {
  if (!promoPriceVal.value) return 0
  const regularPrice = Number(props.product.price)
  if (!regularPrice || regularPrice <= 0) return 0
  return Math.round(((regularPrice - promoPriceVal.value) / regularPrice) * 100)
})

const effectivePrice = computed(() => {
  return promoPriceVal.value ?? props.product.price
})
</script>

<template>
  <article
    class="group flex h-full overflow-hidden rounded-3xl border border-zinc-200/80 bg-card shadow-soft transition hover:-translate-y-0.5 hover:border-primary/35 hover:shadow-[0_18px_32px_rgba(24,24,27,0.08)] dark:border-slate-700/60 dark:bg-[#171C2B] dark:hover:border-indigo-400/45"
  >
    <div class="flex min-w-0 flex-1 flex-col">
      <div
        class="relative aspect-[4/3] w-full overflow-hidden bg-gradient-to-br from-[#F5F6FF] via-[#EEF0FC] to-[#E5E8FA] dark:from-[#1F273E] dark:via-[#192034] dark:to-[#141A2B]"
      >
        <img
          v-if="hasImage"
          :src="product.imageData"
          :alt="product.name"
          loading="lazy"
          class="h-full w-full object-cover"
          data-testid="product-card-image"
          @error="imageLoadError = true"
        />
        <div
          v-else
          class="flex h-full w-full items-center justify-center text-primary dark:text-indigo-300"
          data-testid="product-card-fallback"
        >
          <span
            class="flex h-12 w-12 items-center justify-center rounded-2xl border border-white/80 bg-white/90 shadow-soft dark:border-indigo-400/20 dark:bg-[#242D48] sm:h-14 sm:w-14"
          >
            <AppIcon :name="product.kind === 'service' ? 'shift' : 'products'" />
          </span>
        </div>
        <span
          class="absolute left-2.5 top-2.5 max-w-[calc(100%-1.25rem)] truncate rounded-full border border-zinc-200/70 bg-white/90 px-2.5 py-0.5 text-[10px] font-semibold text-zinc-700 shadow-xs backdrop-blur-xs dark:border-slate-600/60 dark:bg-[#101523]/85 dark:text-slate-200"
        >
          {{ product.category }}
        </span>
        <span
          v-if="hasVariants"
          class="absolute right-2.5 top-2.5 rounded-full border border-primary/25 bg-primary px-2 py-0.5 text-[10px] font-bold text-white shadow-xs backdrop-blur-xs"
        >
          Varian
        </span>
        <span
          v-if="discountPercent > 0"
          data-testid="promo-discount-badge"
          class="absolute left-2.5 bottom-2.5 rounded-full border border-rose-500/30 bg-rose-600 px-2.5 py-0.5 text-[11px] font-extrabold text-white shadow-md backdrop-blur-xs flex items-center gap-0.5"
        >
          -{{ discountPercent }}%
        </span>
      </div>

      <div class="flex flex-1 flex-col gap-2 p-3.5">
        <h3
          class="line-clamp-2 min-h-[2.5rem] text-sm font-semibold leading-snug text-ink-primary transition group-hover:text-primary sm:text-base"
        >
          {{ product.name }}
        </h3>

        <div class="mt-auto flex items-end justify-between gap-2 pt-0.5">
          <div class="min-w-0">
            <div v-if="discountPercent > 0" class="flex items-center gap-1.5 flex-wrap">
              <span class="text-xs text-ink-secondary line-through">
                {{ formatCurrency(product.price) }}
              </span>
              <span class="rounded-md bg-rose-500/10 px-1 py-0.5 text-[10px] font-bold text-rose-600 dark:bg-rose-500/20 dark:text-rose-400">
                -{{ discountPercent }}%
              </span>
            </div>
            <p
              class="break-words font-mono text-base font-bold sm:text-lg"
              :class="discountPercent > 0 ? 'text-rose-600 dark:text-rose-400' : 'text-ink-primary'"
            >
              {{ formatCurrency(effectivePrice) }}
            </p>
            <p
              class="mt-0.5 truncate text-xs"
              :class="isOutOfStock(product) ? 'font-medium text-danger' : 'text-ink-secondary'"
            >
              {{
                product.kind === 'service'
                  ? `/${product.pricingUnit}`
                  : isOutOfStock(product)
                    ? 'Stok habis'
                    : `Stok ${product.stock} ${product.unit || 'pcs'}`
              }}
            </p>
          </div>

          <BaseButton
            size="sm"
            class="h-10 min-w-10 rounded-2xl px-0 text-lg font-bold shadow-sm shadow-primary/25 cursor-pointer"
            :disabled="isOutOfStock(product)"
            aria-label="Tambah item"
            @click="$emit('add', product)"
          >
            +
          </BaseButton>
        </div>
      </div>
    </div>
  </article>
</template>
