<script setup>
import { onBeforeRouteLeave, useRouter } from 'vue-router'

import BaseButton from '@/components/base/BaseButton.vue'
import BaseCard from '@/components/base/BaseCard.vue'
import { useTransactionStore } from '@/stores/transactionStore'

const router = useRouter()
const transactionStore = useTransactionStore()

onBeforeRouteLeave(() => {
  transactionStore.clearLastTransaction()
})
</script>

<template>
  <div class="mx-auto max-w-xl py-10">
    <BaseCard class="space-y-5 text-center">
      <div class="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-success/10 text-2xl text-success">
        OK
      </div>
      <div>
        <p class="text-sm font-medium uppercase tracking-[0.18em] text-success">Success</p>
        <h2 class="mt-2 text-3xl font-semibold text-ink-primary">Pembayaran berhasil</h2>
        <p class="mt-2 text-sm text-ink-secondary">
          Transaksi telah diselesaikan dan siap masuk ke riwayat penjualan.
        </p>
      </div>

      <div class="grid gap-3 sm:grid-cols-2">
        <BaseButton block variant="secondary" @click="router.push('/transactions')">
          Lihat Transaksi
        </BaseButton>
        <BaseButton block @click="router.push('/pos')">Kembali ke POS</BaseButton>
      </div>
    </BaseCard>
  </div>
</template>
