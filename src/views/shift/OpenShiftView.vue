<script setup>
import { ref } from 'vue'
import { useRouter } from 'vue-router'

import BaseButton from '@/components/base/BaseButton.vue'
import BaseCard from '@/components/base/BaseCard.vue'
import BaseInput from '@/components/base/BaseInput.vue'
import { useCashStore } from '@/stores/cashStore'
import { useShiftStore } from '@/stores/shiftStore'

const openingBalance = ref('100000')
const router = useRouter()
const cashStore = useCashStore()
const shiftStore = useShiftStore()

function handleOpenShift() {
  shiftStore.openShift(openingBalance.value)
  cashStore.recordOpeningBalance(openingBalance.value, shiftStore.openedAt)
  router.push('/home')
}
</script>

<template>
  <div class="mx-auto max-w-xl space-y-5">
    <BaseCard class="space-y-5">
      <div>
        <p class="text-sm font-medium uppercase tracking-[0.18em] text-primary">Open Shift</p>
        <h2 class="mt-2 text-2xl font-semibold text-ink-primary">Mulai operasional hari ini</h2>
      </div>

      <BaseInput
        v-model="openingBalance"
        type="number"
        label="Saldo Awal Kas"
        placeholder="100000"
        hint="Nominal awal akan disimpan di store shift."
      />
    </BaseCard>

    <div class="flex justify-end">
      <BaseButton size="lg" @click="handleOpenShift">Buka Shift</BaseButton>
    </div>
  </div>
</template>
