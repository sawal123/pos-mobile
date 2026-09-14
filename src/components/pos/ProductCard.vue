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
  <article class="group flex h-full overflow-hidden rounded-3xl border border-white/60 bg-white shadow-soft transition hover:-translate-y-0.5 hover:shadow-[0_18px_32px_rgba(24,24,27,0.08)]">
    <div class="flex min-w-0 flex-1 flex-col">
      <div class="relative aspect-[4/3] w-full overflow-hidden bg-[linear-gradient(135deg,_rgba(247,247,252,1),_rgba(233,233,252,0.9))]">
        <img
          v-if="hasImage"
          :src="product.imageData"
          :alt="product.name"
          class="h-full w-full object-cover"
          data-testid="product-card-image"
        />
        <div v-else class="flex h-full w-full items-center justify-center text-primary" data-testid="product-card-fallback">
          <span class="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/80 shadow-soft sm:h-14 sm:w-14">
            <AppIcon :name="product.kind === 'service' ? 'shift' : 'products'" />
          </span>
        </div>
        <span
          class="absolute left-2 top-2 max-w-[calc(100%-1rem)] truncate rounded-full bg-white/85 px-2 py-1 text-[10px] font-medium text-ink-secondary shadow-soft"
        >
          {{ product.category }}
        </span>
      </div>

      <div class="flex flex-1 flex-col gap-2 p-3">
        <h3 class="line-clamp-2 min-h-[2.5rem] text-sm font-semibold leading-snug text-ink-primary transition group-hover:text-primary sm:text-base">
        {{ product.name }}
        </h3>

        <div class="mt-auto flex items-end justify-between gap-2">
          <div class="min-w-0">
            <p class="break-words text-base font-semibold text-ink-primary sm:text-lg">
              {{ formatCurrency(product.price) }}
            </p>
            <p class="mt-0.5 truncate text-xs" :class="isOutOfStock(product) ? 'text-danger' : 'text-ink-secondary'">
              {{ product.kind === 'service' ? `/${product.pricingUnit}` : isOutOfStock(product) ? 'Stok habis' : `Stok ${product.stock} ${product.unit || 'pcs'}` }}
            </p>
          </div>

          <BaseButton size="sm" class="h-10 min-w-10 rounded-2xl px-0 text-base" :disabled="isOutOfStock(product)" aria-label="Tambah item" @click="$emit('add', product)">
            +
          </BaseButton>
        </div>
      </div>
    </div>
  </article>
</template>
