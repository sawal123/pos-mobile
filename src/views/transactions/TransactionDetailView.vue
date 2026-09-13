<script setup>
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import BaseBadge from '@/components/base/BaseBadge.vue'
import BaseButton from '@/components/base/BaseButton.vue'
import BaseCard from '@/components/base/BaseCard.vue'
import { useTransactionStore } from '@/stores/transactionStore'
import { formatCurrency, formatDateTime } from '@/utils/formatters'

const route = useRoute()
const router = useRouter()
const transactionStore = useTransactionStore()

const transaction = computed(() =>
  transactionStore.items.find((item) => item.id === route.params.id),
)

const laundryStatuses = ['Masuk', 'Diproses', 'Siap Diambil', 'Selesai']

function statusVariant(status) {
  if (status === 'paid') return 'success'
  if (status === 'refunded') return 'warning'
  return 'neutral'
}
</script>

<template>
  <div class="mx-auto max-w-2xl space-y-5">
    <div class="flex flex-wrap gap-3">
      <BaseButton variant="ghost" @click="router.push('/transactions')">Kembali</BaseButton>
      <BaseButton
        v-if="transaction"
        variant="secondary"
        @click="router.push(`/transactions/${transaction.id}/receipt`)"
      >
        Lihat Struk
      </BaseButton>
    </div>

    <BaseCard v-if="transaction" class="space-y-5">
      <div class="flex items-start justify-between gap-4">
        <div>
          <p class="text-sm text-ink-secondary">{{ transaction.id }}</p>
          <h2 class="text-2xl font-semibold text-ink-primary">{{ transaction.customer }}</h2>
        </div>
        <BaseBadge :variant="statusVariant(transaction.status)">
          {{ transaction.status }}
        </BaseBadge>
      </div>

      <div class="grid gap-4 md:grid-cols-2">
        <div class="rounded-2xl bg-surface p-4">
          <p class="text-sm text-ink-secondary">Metode Pembayaran</p>
          <p class="mt-2 font-semibold text-ink-primary">{{ transaction.paymentMethod }}</p>
        </div>
        <div class="rounded-2xl bg-surface p-4">
          <p class="text-sm text-ink-secondary">Tanggal</p>
          <p class="mt-2 font-semibold text-ink-primary">{{ formatDateTime(transaction.createdAt) }}</p>
        </div>
      </div>

      <div class="rounded-2xl border border-zinc-200 p-4">
        <p class="text-sm text-ink-secondary">Total Transaksi</p>
        <p class="mt-2 text-3xl font-semibold text-ink-primary">
          {{ formatCurrency(transaction.total) }}
        </p>
      </div>

      <div v-if="transaction.orderStatus" class="rounded-2xl border border-zinc-200 p-4">
        <p class="text-sm text-ink-secondary">Status Order Laundry</p>
        <div class="mt-3 flex flex-wrap gap-2">
          <BaseButton
            v-for="status in laundryStatuses"
            :key="status"
            size="sm"
            :variant="transaction.orderStatus === status ? 'primary' : 'secondary'"
            @click="transactionStore.updateOrderStatus(transaction.id, status)"
          >
            {{ status }}
          </BaseButton>
        </div>
      </div>
    </BaseCard>

    <BaseCard v-else>
      <p class="text-sm text-ink-secondary">Transaksi tidak ditemukan.</p>
    </BaseCard>
  </div>
</template>
