<script setup>
import { computed } from 'vue'

import BaseCard from '@/components/base/BaseCard.vue'
import { useExpenseStore } from '@/stores/expenseStore'
import { isPaidTransaction, useTransactionStore } from '@/stores/transactionStore'
import { formatCurrency } from '@/utils/formatters'

const expenseStore = useExpenseStore()
const transactionStore = useTransactionStore()

const paidTransactions = computed(() => transactionStore.items.filter(isPaidTransaction))
const revenue = computed(() => paidTransactions.value.reduce((sum, transaction) => sum + Number(transaction.total || 0), 0))
const grossProfit = computed(() => paidTransactions.value.reduce((sum, transaction) => sum + Number(transaction.grossProfit || 0), 0))
</script>

<template>
  <div class="space-y-5">
    <div>
      <p class="text-sm font-medium uppercase tracking-[0.18em] text-primary">Laporan</p>
      <h2 class="mt-2 text-2xl font-semibold text-ink-primary">Ringkasan performa</h2>
    </div>

    <div class="grid gap-3 md:grid-cols-4">
      <BaseCard>
        <p class="text-sm text-ink-secondary">Omzet</p>
        <p class="mt-2 break-words text-2xl font-semibold text-ink-primary">{{ formatCurrency(revenue) }}</p>
      </BaseCard>
      <BaseCard>
        <p class="text-sm text-ink-secondary">Transaksi</p>
        <p class="mt-2 text-2xl font-semibold text-ink-primary">{{ transactionStore.items.length }}</p>
      </BaseCard>
      <BaseCard>
        <p class="text-sm text-ink-secondary">Gross Profit</p>
        <p class="mt-2 break-words text-2xl font-semibold text-success">{{ formatCurrency(grossProfit) }}</p>
      </BaseCard>
      <BaseCard>
        <p class="text-sm text-ink-secondary">Pengeluaran</p>
        <p class="mt-2 break-words text-2xl font-semibold text-danger">{{ formatCurrency(expenseStore.totalExpenses) }}</p>
      </BaseCard>
    </div>
  </div>
</template>
