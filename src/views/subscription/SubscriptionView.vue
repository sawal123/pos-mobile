<script setup>
import { computed } from 'vue'
import { useRouter } from 'vue-router'

import AppIcon from '@/components/base/AppIcon.vue'
import BaseButton from '@/components/base/BaseButton.vue'
import BaseCard from '@/components/base/BaseCard.vue'
import { useSubscriptionStore } from '@/stores/subscriptionStore'

const router = useRouter()
const subscriptionStore = useSubscriptionStore()

const planText = computed(() => {
  if (!subscriptionStore.isPremium) return 'Paket saat ini: Free'
  return `Paket saat ini: ${subscriptionStore.planLabel}`
})

const benefits = [
  'Sinkronisasi data antar perangkat',
  'Dashboard bisnis di web',
  'Pencadangan cloud otomatis',
]

function goBack() {
  router.back()
}
</script>

<template>
  <div class="mx-auto max-w-3xl space-y-5" data-testid="subscription-view">
    <div class="flex items-center gap-3">
      <button
        type="button"
        data-testid="subscription-back-btn"
        class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-zinc-200 bg-white text-ink-primary transition active:scale-95"
        aria-label="Kembali"
        @click="goBack"
      >
        <AppIcon name="chevron-left" />
      </button>
      <div>
        <p class="text-xs font-medium uppercase tracking-[0.18em] text-primary">Langganan</p>
        <h2 class="text-xl font-semibold text-ink-primary">Langganan Premium</h2>
      </div>
    </div>

    <BaseCard class="space-y-4" data-testid="subscription-placeholder">
      <div class="flex items-center gap-3">
        <span class="flex h-11 w-11 items-center justify-center rounded-2xl bg-amber-100 text-amber-600">
          <AppIcon name="crown" />
        </span>
        <div>
          <p class="text-sm font-semibold text-ink-primary" data-testid="subscription-plan-text">
            {{ planText }}
          </p>
          <p class="text-xs text-ink-secondary">Halaman paket sedang disiapkan.</p>
        </div>
      </div>

      <div class="space-y-2 rounded-2xl bg-surface p-4">
        <p class="text-xs font-semibold uppercase tracking-widest text-ink-secondary">
          Keuntungan Premium
        </p>
        <div
          v-for="benefit in benefits"
          :key="benefit"
          class="flex items-center gap-2 text-sm text-ink-primary"
        >
          <AppIcon name="chevron-right" class="text-primary" />
          <span>{{ benefit }}</span>
        </div>
      </div>

      <p class="text-xs text-ink-secondary" data-testid="subscription-placeholder-note">
        Pemilihan paket dan pembayaran akan tersedia pada PREM-M02. Tidak ada pembayaran yang
        diproses di halaman ini.
      </p>

      <BaseButton block variant="secondary" data-testid="subscription-back-cta" @click="goBack">
        Kembali
      </BaseButton>
    </BaseCard>
  </div>
</template>
