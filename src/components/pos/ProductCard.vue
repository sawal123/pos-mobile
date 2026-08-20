<script setup>
import BaseButton from '@/components/base/BaseButton.vue'
import BaseCard from '@/components/base/BaseCard.vue'
import { formatCurrency } from '@/utils/formatters'

defineProps({
  product: {
    type: Object,
    required: true,
  },
})

defineEmits(['add'])
</script>

<template>
  <BaseCard class="group flex h-full flex-col gap-4 overflow-hidden border border-white/40 bg-white/90 transition hover:-translate-y-1 hover:shadow-[0_20px_35px_rgba(24,24,27,0.08)]">
    <div class="rounded-[1.4rem] bg-[linear-gradient(135deg,_rgba(247,247,252,1),_rgba(233,233,252,0.9))] p-4">
      <div class="flex items-start justify-between gap-3">
        <p class="rounded-full bg-white/80 px-3 py-1 text-xs font-medium uppercase tracking-[0.16em] text-ink-secondary shadow-soft">
          {{ product.category }}
        </p>
        <span class="rounded-full bg-white/80 px-3 py-1 text-xs font-medium text-primary shadow-soft">
          Stok {{ product.stock }}
        </span>
      </div>

      <h3 class="mt-4 text-lg font-semibold text-ink-primary transition group-hover:text-primary">
        {{ product.name }}
      </h3>
      <p class="mt-1 text-sm text-ink-secondary">
        Menu siap jual untuk transaksi cepat di kasir.
      </p>
    </div>

    <div class="mt-auto flex items-end justify-between gap-3">
      <div>
        <p class="text-xs uppercase tracking-[0.16em] text-ink-secondary">Harga</p>
        <p class="mt-1 text-lg font-semibold text-ink-primary">
          {{ formatCurrency(product.price) }}
        </p>
        <p class="mt-1 text-sm text-ink-secondary">{{ product.category }}</p>
      </div>

      <BaseButton size="sm" class="min-w-24" @click="$emit('add', product)">Tambah</BaseButton>
    </div>
  </BaseCard>
</template>
