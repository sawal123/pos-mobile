<script setup>
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'

import AppIcon from '@/components/base/AppIcon.vue'
import BaseButton from '@/components/base/BaseButton.vue'
import BaseCard from '@/components/base/BaseCard.vue'
import { PLAN_PERIOD_LABELS } from '@/services/subscription/planCatalogService'
import { useCloudSessionStore } from '@/stores/cloudSessionStore'
import { usePremiumCheckoutStore } from '@/stores/premiumCheckoutStore'
import { useSubscriptionPlanStore } from '@/stores/subscriptionPlanStore'

const router = useRouter()
const cloudStore = useCloudSessionStore()
const planStore = useSubscriptionPlanStore()
const checkoutStore = usePremiumCheckoutStore()

const redirectNotice = ref('')

const option = computed(() => planStore.selectedOption)
const businessName = computed(() => cloudStore.selectedBusiness?.name ?? '-')
const periodLabel = computed(
  () => option.value?.periodLabel ?? PLAN_PERIOD_LABELS[option.value?.period] ?? '-',
)
const priceLabel = computed(() => option.value?.priceLabel ?? null)

const eligibilityMessage = computed(() => {
  if (!cloudStore.isAuthenticated) return 'Masuk ke Cloud terlebih dahulu untuk melanjutkan.'
  if (!cloudStore.isLinked) return 'Tautkan bisnis Cloud terlebih dahulu.'
  if (!option.value) return 'Pilih paket Premium terlebih dahulu.'
  if (option.value.available === false) return 'Paket ini sedang tidak tersedia.'
  if (option.value.hasPrice !== true) return 'Harga paket belum tersedia dari server.'
  if (option.value.purchasable !== true) return 'Paket ini belum dapat dibeli saat ini.'
  if (planStore.checkoutAvailable !== true) return 'Pembayaran Premium belum tersedia.'
  return null
})

const canPay = computed(() => eligibilityMessage.value === null && !checkoutStore.isCreating)

function goBack() {
  router.back()
}

function goToSubscription() {
  router.replace({ name: 'subscription' })
}

onMounted(async () => {
  if (!cloudStore.isAuthenticated) {
    router.replace({ name: 'cloud' })
    return
  }
  if (!cloudStore.isLinked) {
    router.replace({ name: 'cloud' })
    return
  }
  if (planStore.isIdle) {
    await planStore.loadCatalog()
  }
  if (checkoutStore.phase === 'idle' || checkoutStore.attempt === null) {
    checkoutStore.startAttempt(option.value)
  }
})

async function handlePay() {
  redirectNotice.value = ''
  if (!canPay.value) return

  const created = await checkoutStore.createCheckout()
  if (!created.ok) return

  await checkoutStore.launchPayment()
  router.push({ name: 'premium-payment-status' })
}
</script>

<template>
  <div class="mx-auto max-w-3xl space-y-5" data-testid="premium-checkout-view">
    <div class="flex items-center gap-3">
      <button
        type="button"
        data-testid="premium-checkout-back"
        class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-zinc-200 bg-white text-ink-primary transition active:scale-95"
        aria-label="Kembali"
        @click="goBack"
      >
        <AppIcon name="chevron-left" />
      </button>
      <div class="min-w-0">
        <p class="text-xs font-medium uppercase tracking-[0.18em] text-primary">Premium</p>
        <h2 class="truncate text-2xl font-semibold text-ink-primary">Pembayaran Premium</h2>
      </div>
    </div>

    <BaseCard class="space-y-4" data-testid="checkout-summary">
      <div class="flex items-center gap-3">
        <span
          class="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary"
        >
          <AppIcon name="crown" />
        </span>
        <div>
          <p class="text-base font-semibold text-ink-primary">Premium Cloud</p>
          <p class="text-xs text-ink-secondary">Aktifkan sinkronisasi cloud dan dashboard.</p>
        </div>
      </div>

      <dl class="space-y-2 text-sm">
        <div class="flex items-center justify-between rounded-2xl bg-surface px-4 py-3">
          <dt class="text-ink-secondary">Paket</dt>
          <dd class="font-medium text-ink-primary" data-testid="checkout-plan">
            {{ option?.name ?? 'Premium Cloud' }}
          </dd>
        </div>
        <div class="flex items-center justify-between rounded-2xl bg-surface px-4 py-3">
          <dt class="text-ink-secondary">Periode</dt>
          <dd class="font-medium text-ink-primary" data-testid="checkout-period">
            {{ periodLabel }}
          </dd>
        </div>
        <div class="flex items-center justify-between rounded-2xl bg-surface px-4 py-3">
          <dt class="text-ink-secondary">Harga</dt>
          <dd class="font-medium text-ink-primary" data-testid="checkout-price">
            {{ priceLabel || 'Harga belum tersedia' }}
          </dd>
        </div>
        <div class="flex items-center justify-between rounded-2xl bg-surface px-4 py-3">
          <dt class="text-ink-secondary">Bisnis</dt>
          <dd class="font-medium text-ink-primary" data-testid="checkout-business">
            {{ businessName }}
          </dd>
        </div>
      </dl>

      <p class="rounded-2xl bg-surface px-4 py-3 text-xs leading-relaxed text-ink-secondary">
        Pilih metode pembayaran pada halaman pembayaran. Pembayaran dan aktivasi Premium diproses
        oleh server setelah pembayaran terverifikasi.
      </p>

      <p
        v-if="eligibilityMessage"
        class="rounded-2xl bg-amber-50 px-4 py-3 text-sm text-amber-700"
        data-testid="checkout-ineligible"
      >
        {{ eligibilityMessage }}
      </p>

      <p
        v-if="checkoutStore.error"
        class="rounded-2xl bg-danger/10 px-4 py-3 text-sm text-danger"
        role="status"
        data-testid="checkout-error"
      >
        {{ checkoutStore.error }}
      </p>

      <p v-if="redirectNotice" class="text-xs text-ink-secondary" role="status">
        {{ redirectNotice }}
      </p>

      <div class="flex flex-wrap gap-3">
        <BaseButton
          data-testid="checkout-pay-cta"
          :disabled="!canPay"
          :loading="checkoutStore.isCreating"
          @click="handlePay"
        >
          Lanjut ke Pembayaran
        </BaseButton>
        <BaseButton variant="ghost" data-testid="checkout-cancel" @click="goToSubscription">
          Batal
        </BaseButton>
      </div>
    </BaseCard>
  </div>
</template>
