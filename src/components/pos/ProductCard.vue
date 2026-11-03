<script setup>
import { computed } from 'vue'

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

const hasImage = computed(() => Boolean(props.product.imageData))
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
          class="h-full w-full object-cover"
          data-testid="product-card-image"
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
      </div>

      <div class="flex flex-1 flex-col gap-2 p-3.5">
        <h3
          class="line-clamp-2 min-h-[2.5rem] text-sm font-semibold leading-snug text-ink-primary transition group-hover:text-primary sm:text-base"
        >
          {{ product.name }}
        </h3>

        <div class="mt-auto flex items-end justify-between gap-2 pt-0.5">
          <div class="min-w-0">
            <p class="break-words font-mono text-base font-bold text-ink-primary sm:text-lg">
              {{ formatCurrency(product.price) }}
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
