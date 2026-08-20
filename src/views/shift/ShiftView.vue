<script setup>
import { computed } from 'vue'
import { useRouter } from 'vue-router'

import BaseBadge from '@/components/base/BaseBadge.vue'
import BaseButton from '@/components/base/BaseButton.vue'
import BaseCard from '@/components/base/BaseCard.vue'
import { useShiftStore } from '@/stores/shiftStore'
import { formatCurrency, formatDateTime } from '@/utils/formatters'

const router = useRouter()
const shiftStore = useShiftStore()

const shiftStatus = computed(() => (shiftStore.isOpen ? 'Aktif' : 'Belum Dibuka'))
</script>

<template>
  <div class="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
    <BaseCard class="space-y-4">
      <div class="flex items-center justify-between">
        <div>
          <p class="text-sm text-ink-secondary">Status Shift</p>
          <h2 class="text-2xl font-semibold text-ink-primary">{{ shiftStatus }}</h2>
        </div>
        <BaseBadge :variant="shiftStore.isOpen ? 'success' : 'warning'">
          {{ shiftStore.isOpen ? 'open' : 'draft' }}
        </BaseBadge>
      </div>

      <div class="grid gap-3 md:grid-cols-2">
        <div class="rounded-2xl bg-surface p-4">
          <p class="text-sm text-ink-secondary">Saldo Awal</p>
          <p class="mt-2 text-xl font-semibold text-ink-primary">
            {{ formatCurrency(shiftStore.openingBalance) }}
          </p>
        </div>
        <div class="rounded-2xl bg-surface p-4">
          <p class="text-sm text-ink-secondary">Waktu Dibuka</p>
          <p class="mt-2 text-base font-semibold text-ink-primary">
            {{ formatDateTime(shiftStore.openedAt) }}
          </p>
        </div>
      </div>
    </BaseCard>

    <BaseCard class="space-y-4">
      <h3 class="text-lg font-semibold text-ink-primary">Aksi Cepat</h3>

      <div class="grid gap-3">
        <BaseButton block @click="router.push('/pos')">Masuk ke POS</BaseButton>
        <BaseButton block variant="secondary" @click="router.push('/transactions')">
          Lihat Transaksi
        </BaseButton>
        <BaseButton block variant="danger" @click="router.push('/shift/close')">
          Tutup Shift
        </BaseButton>
      </div>
    </BaseCard>
  </div>
</template>
