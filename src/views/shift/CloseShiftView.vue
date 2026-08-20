<script setup>
import { useRouter } from 'vue-router'

import BaseButton from '@/components/base/BaseButton.vue'
import BaseCard from '@/components/base/BaseCard.vue'
import { useShiftStore } from '@/stores/shiftStore'
import { formatCurrency } from '@/utils/formatters'

const router = useRouter()
const shiftStore = useShiftStore()

function handleCloseShift() {
  shiftStore.closeShift()
  router.push('/welcome')
}
</script>

<template>
  <div class="mx-auto max-w-xl space-y-5">
    <BaseCard class="space-y-4">
      <p class="text-sm font-medium uppercase tracking-[0.18em] text-danger">Close Shift</p>
      <h2 class="text-2xl font-semibold text-ink-primary">Tutup shift saat ini?</h2>
      <p class="text-sm text-ink-secondary">
        Saldo awal yang tercatat untuk shift ini adalah
        <span class="font-semibold text-ink-primary">{{ formatCurrency(shiftStore.openingBalance) }}</span>.
      </p>
    </BaseCard>

    <div class="flex justify-end gap-3">
      <BaseButton variant="secondary" @click="router.push('/shift')">Batal</BaseButton>
      <BaseButton variant="danger" @click="handleCloseShift">Konfirmasi Tutup</BaseButton>
    </div>
  </div>
</template>
