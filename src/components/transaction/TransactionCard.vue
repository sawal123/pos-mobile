<script setup>
import BaseBadge from '@/components/base/BaseBadge.vue'
import BaseCard from '@/components/base/BaseCard.vue'
import { formatCurrency, formatDateTime } from '@/utils/formatters'

defineProps({
  transaction: {
    type: Object,
    required: true,
  },
})

function statusVariant(status) {
  if (status === 'paid') return 'success'
  if (status === 'refunded') return 'warning'
  return 'neutral'
}
</script>

<template>
  <BaseCard class="space-y-3">
    <div class="flex items-start justify-between gap-3">
      <div>
        <p class="text-xs uppercase tracking-[0.16em] text-ink-secondary">{{ transaction.id }}</p>
        <h3 class="mt-1 text-base font-semibold text-ink-primary">{{ transaction.customer }}</h3>
      </div>

      <BaseBadge :variant="statusVariant(transaction.status)">
        {{ transaction.status }}
      </BaseBadge>
    </div>

    <div class="flex items-center justify-between text-sm text-ink-secondary">
      <span>{{ transaction.items }} item • {{ transaction.paymentMethod }}</span>
      <span>{{ formatDateTime(transaction.createdAt) }}</span>
    </div>

    <div class="text-lg font-semibold text-ink-primary">
      {{ formatCurrency(transaction.total) }}
    </div>
  </BaseCard>
</template>
