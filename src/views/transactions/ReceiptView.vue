<script setup>
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import BaseButton from '@/components/base/BaseButton.vue'
import BaseCard from '@/components/base/BaseCard.vue'
import ReceiptContent from '@/components/receipt/ReceiptContent.vue'
import { useBusinessStore } from '@/stores/businessStore'
import { useTransactionStore } from '@/stores/transactionStore'

const route = useRoute()
const router = useRouter()
const businessStore = useBusinessStore()
const transactionStore = useTransactionStore()

const transaction = computed(() => (
  transactionStore.items.find((item) => String(item.id) === String(route.params.id)) ?? null
))

const business = computed(() => {
  if (transaction.value?.businessSnapshot) {
    return {
      name: transaction.value.businessSnapshot.name || '-',
      outlet: transaction.value.businessSnapshot.outlet || '-',
      phone: transaction.value.businessSnapshot.phone || '',
    }
  }

  return {
    name: businessStore.name || '-',
    outlet: businessStore.outlet || '-',
    phone: businessStore.phone || '',
  }
})

function handlePrint() {
  window.print()
}
</script>

<template>
  <div class="mx-auto max-w-3xl space-y-5 print:max-w-none">
    <div class="flex flex-wrap gap-3 print:hidden">
      <BaseButton variant="secondary" @click="router.back()">Kembali</BaseButton>
      <BaseButton @click="handlePrint">Print</BaseButton>
    </div>

    <ReceiptContent v-if="transaction" :transaction="transaction" :business="business" />

    <BaseCard v-else>
      <p class="text-sm text-ink-secondary">Transaksi tidak ditemukan.</p>
    </BaseCard>
  </div>
</template>
