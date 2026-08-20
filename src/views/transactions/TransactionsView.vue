<script setup>
import { RouterLink } from 'vue-router'

import TransactionCard from '@/components/transaction/TransactionCard.vue'
import { useTransactionStore } from '@/stores/transactionStore'

const transactionStore = useTransactionStore()
</script>

<template>
  <div class="space-y-5">
    <div>
      <p class="text-sm font-medium uppercase tracking-[0.18em] text-primary">Transactions</p>
      <h2 class="mt-2 text-2xl font-semibold text-ink-primary">Riwayat transaksi</h2>
    </div>

    <div class="grid gap-4">
      <RouterLink
        v-for="transaction in transactionStore.items"
        :key="transaction.id"
        :to="`/transactions/${transaction.id}`"
      >
        <TransactionCard :transaction="transaction" />
      </RouterLink>
    </div>
  </div>
</template>
