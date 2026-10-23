<script setup>
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'

import AppIcon from '@/components/base/AppIcon.vue'
import BaseButton from '@/components/base/BaseButton.vue'
import BaseCard from '@/components/base/BaseCard.vue'
import BaseInput from '@/components/base/BaseInput.vue'
import { useBusinessStore } from '@/stores/businessStore'
import { useCashierStore } from '@/stores/cashierStore'
import { useCashStore } from '@/stores/cashStore'
import { useShiftStore } from '@/stores/shiftStore'
import { formatCurrency } from '@/utils/formatters'

const openingBalance = ref('100000')
const router = useRouter()
const businessStore = useBusinessStore()
const cashierStore = useCashierStore()
const cashStore = useCashStore()
const shiftStore = useShiftStore()

const presetOpeningBalances = [50000, 100000, 200000, 500000]

const parsedBalance = computed(() => {
  const val = Number(openingBalance.value)
  return Number.isFinite(val) && val >= 0 ? val : 0
})

function selectPreset(amount) {
  openingBalance.value = String(amount)
}

function handleOpenShift() {
  const nominal = parsedBalance.value
  shiftStore.openShift(nominal)
  cashStore.recordOpeningBalance(nominal, shiftStore.openedAt)
  router.push('/home')
}
</script>

<template>
  <div class="mx-auto max-w-xl space-y-4 pb-28">
    <header class="flex items-center gap-3 pt-1">
      <button
        type="button"
        data-testid="open-shift-back-btn"
        class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-zinc-200 bg-white text-ink-primary transition active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
        aria-label="Kembali"
        @click="router.back()"
      >
        <AppIcon name="chevron-left" />
      </button>
      <div class="min-w-0">
        <p class="text-xs font-semibold uppercase tracking-wider text-primary">Operasional</p>
        <h2 class="truncate text-xl font-bold text-ink-primary sm:text-2xl">Buka Shift Kasir</h2>
      </div>
    </header>

    <BaseCard class="space-y-4 p-5" data-testid="open-shift-card">
      <div class="flex items-center gap-3">
        <span class="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary">
          <AppIcon name="shift" class="h-6 w-6" />
        </span>
        <div class="min-w-0">
          <h3 class="text-base font-bold text-ink-primary">Mulai Operasional Kasir</h3>
          <p class="text-xs text-ink-secondary">
            {{ businessStore.name || 'POS' }} • {{ businessStore.outlet || 'Outlet Utama' }}
          </p>
        </div>
      </div>

      <div class="rounded-2xl border border-zinc-200/80 bg-surface/70 p-4 space-y-3">
        <div class="flex items-center justify-between">
          <label class="text-xs font-semibold text-ink-primary">Modal Kas Awal di Laci (Rp)</label>
          <span class="font-mono text-sm font-bold text-primary">
            {{ formatCurrency(parsedBalance) }}
          </span>
        </div>

        <!-- Quick Presets -->
        <div class="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <button
            v-for="preset in presetOpeningBalances"
            :key="preset"
            type="button"
            class="rounded-xl border py-2 text-xs font-semibold transition"
            :class="
              parsedBalance === preset
                ? 'border-primary bg-primary/10 text-primary'
                : 'border-zinc-200 bg-white text-ink-secondary hover:bg-zinc-50'
            "
            @click="selectPreset(preset)"
          >
            {{ formatCurrency(preset) }}
          </button>
        </div>

        <BaseInput
          v-model="openingBalance"
          type="number"
          placeholder="100000"
          hint="Uang tunai awal di laci kasir untuk modal uang kembalian."
        />
      </div>

      <div class="rounded-2xl bg-primary/5 border border-primary/10 p-3.5 text-xs text-ink-secondary space-y-1">
        <p class="font-semibold text-ink-primary">Petugas Kasir</p>
        <p>{{ cashierStore.activeCashier?.name || 'Kasir Utama' }} akan tercatat sebagai kasir aktif shift ini.</p>
      </div>

      <BaseButton
        block
        size="lg"
        data-testid="btn-confirm-open-shift"
        @click="handleOpenShift"
      >
        Buka Shift Sekarang
      </BaseButton>
    </BaseCard>
  </div>
</template>
