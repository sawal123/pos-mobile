<script setup>
import { ref } from 'vue'
import { useRouter } from 'vue-router'

import BaseButton from '@/components/base/BaseButton.vue'
import BaseCard from '@/components/base/BaseCard.vue'
import BaseInput from '@/components/base/BaseInput.vue'
import { useCashierStore } from '@/stores/cashierStore'

const cashierStore = useCashierStore()
const router = useRouter()
const pin = ref('')

function savePin() {
  cashierStore.setPinConfigured(Boolean(pin.value))
  router.push('/shift/open')
}
</script>

<template>
  <div class="mx-auto max-w-xl space-y-5">
    <BaseCard class="space-y-5">
      <div>
        <p class="text-sm font-medium uppercase tracking-[0.18em] text-primary">Pin Setup</p>
        <h2 class="mt-2 text-2xl font-semibold text-ink-primary">Buat PIN kasir</h2>
        <p class="mt-2 text-sm text-ink-secondary">
          Gunakan PIN ini untuk mengamankan transaksi dan membuka shift.
        </p>
      </div>

      <BaseInput
        v-model="pin"
        label="PIN 6 digit"
        type="password"
        placeholder="******"
        hint="Untuk scaffold ini, PIN hanya disimpan sebagai status terkonfigurasi."
      />
    </BaseCard>

    <div class="flex justify-end">
      <BaseButton size="lg" @click="savePin">Simpan dan Buka Shift</BaseButton>
    </div>
  </div>
</template>
