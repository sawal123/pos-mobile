<script setup>
import { computed, onBeforeUnmount, onMounted } from 'vue'
import { useRouter } from 'vue-router'

import AppIcon from '@/components/base/AppIcon.vue'
import BaseButton from '@/components/base/BaseButton.vue'
import BaseCard from '@/components/base/BaseCard.vue'
import { PLAN_PERIOD_LABELS } from '@/services/subscription/planCatalogService'
import { useCloudSessionStore } from '@/stores/cloudSessionStore'
import { usePremiumCheckoutStore } from '@/stores/premiumCheckoutStore'
import { useSubscriptionStore } from '@/stores/subscriptionStore'

const router = useRouter()
const cloudStore = useCloudSessionStore()
const subscriptionStore = useSubscriptionStore()
const checkoutStore = usePremiumCheckoutStore()

const toneClasses = {
  warning: 'border-amber-300 bg-amber-50 text-amber-800',
  success: 'border-emerald-300 bg-emerald-50 text-emerald-800',
  danger: 'border-red-200 bg-red-50 text-red-700',
  muted: 'border-zinc-200 bg-zinc-50 text-zinc-700',
}

const statusCardClass = computed(() => toneClasses[checkoutStore.statusTone] ?? toneClasses.muted)

const periodLabel = computed(() => {
  const period =
    checkoutStore.payment?.billingPeriod ?? checkoutStore.pending?.billingPeriod ?? null
  return period ? (PLAN_PERIOD_LABELS[period] ?? period) : null
})

const hasPayment = computed(() => checkoutStore.payment !== null || checkoutStore.pending !== null)

const isActivePremium = computed(() => subscriptionStore.isPremium === true)

const activationInProgress = computed(
  () => checkoutStore.isPaid && checkoutStore.activationInProgress,
)

const offlineNotice = computed(
  () => checkoutStore.errorCode === 'NETWORK_ERROR' && !checkoutStore.isPaid,
)

function formatDate(value) {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return date.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })
}

const expiresAtLabel = computed(() => formatDate(subscriptionStore.expiresAt))
const startsAtLabel = computed(() =>
  formatDate(checkoutStore.payment?.subscription?.startsAt ?? null),
)

function goToSettings() {
  router.replace({ name: 'settings' })
}

async function handleRefresh() {
  await checkoutStore.refreshStatus()
}

async function handleResume() {
  await checkoutStore.launchPayment()
}

let removeVisibilityListener = null

/**
 * PREM-M04: returning to the app (browser closed / app resumed) is NOT proof of
 * payment. On resume we only re-read the authoritative backend status.
 */
async function handleAppResume() {
  if (!cloudStore.isAuthenticated) return
  if (!hasPayment.value) return
  await checkoutStore.refreshStatus()
}

onMounted(async () => {
  if (!cloudStore.isAuthenticated) {
    router.replace({ name: 'cloud' })
    return
  }

  if (!checkoutStore.hasPending) {
    await checkoutStore.hydratePending()
  }

  if (hasPayment.value) {
    await checkoutStore.refreshStatus()
  }

  if (!checkoutStore.isTerminal && hasPayment.value) {
    checkoutStore.startPolling()
  }

  if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        void handleAppResume()
      }
    }
    document.addEventListener('visibilitychange', onVisibility)
    removeVisibilityListener = () => document.removeEventListener('visibilitychange', onVisibility)
  }
})

onBeforeUnmount(() => {
  checkoutStore.stopPolling('unmounted')
  if (removeVisibilityListener) {
    removeVisibilityListener()
    removeVisibilityListener = null
  }
})
</script>

<template>
  <div class="mx-auto max-w-3xl space-y-5" data-testid="premium-payment-status-view">
    <div class="flex items-center gap-3">
      <button
        type="button"
        data-testid="premium-status-back"
        class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-zinc-200 bg-white text-ink-primary transition active:scale-95"
        aria-label="Kembali"
        @click="goToSettings"
      >
        <AppIcon name="chevron-left" />
      </button>
      <div class="min-w-0">
        <p class="text-xs font-medium uppercase tracking-[0.18em] text-primary">Premium</p>
        <h2 class="truncate text-2xl font-semibold text-ink-primary">Status Pembayaran</h2>
      </div>
    </div>

    <BaseCard v-if="!hasPayment" class="space-y-3">
      <p class="text-sm text-ink-secondary" data-testid="status-no-payment">
        Tidak ada pembayaran Premium yang sedang diproses.
      </p>
      <BaseButton data-testid="status-back-cta" @click="goToSettings">
        Kembali ke Pengaturan
      </BaseButton>
    </BaseCard>

    <template v-else>
      <div
        class="rounded-3xl border p-4"
        :class="statusCardClass"
        data-testid="payment-status-card"
      >
        <div class="flex items-center gap-3">
          <span class="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-white/60">
            <AppIcon name="crown" />
          </span>
          <div class="min-w-0">
            <p class="text-xs uppercase tracking-[0.16em] opacity-80">Premium Cloud</p>
            <p class="text-base font-semibold" data-testid="payment-status-label">
              {{ checkoutStore.statusLabel }}
            </p>
            <p v-if="periodLabel" class="text-xs opacity-80">Paket {{ periodLabel }}</p>
          </div>
        </div>
      </div>

      <p
        v-if="activationInProgress"
        class="rounded-2xl bg-primary/5 px-4 py-3 text-sm text-primary"
        data-testid="activation-in-progress"
      >
        Pembayaran diterima. Aktivasi Premium sedang diproses oleh server…
      </p>

      <p
        v-if="offlineNotice"
        class="rounded-2xl bg-amber-50 px-4 py-3 text-sm text-amber-700"
        data-testid="payment-offline-notice"
      >
        Status belum diperiksa ulang. Periksa koneksi internet lalu perbarui status.
      </p>

      <p
        v-if="checkoutStore.error && !offlineNotice"
        class="rounded-2xl bg-danger/10 px-4 py-3 text-sm text-danger"
        role="status"
        data-testid="payment-error"
      >
        {{ checkoutStore.error }}
      </p>

      <!-- SUCCESS -->
      <BaseCard
        v-if="checkoutStore.isPaid && isActivePremium"
        class="space-y-3"
        data-testid="payment-success"
      >
        <p class="text-base font-semibold text-ink-primary">Premium Cloud Aktif</p>
        <dl class="space-y-1 text-sm">
          <div class="flex items-center justify-between">
            <dt class="text-ink-secondary">Paket</dt>
            <dd class="font-medium text-ink-primary" data-testid="success-plan">
              {{ subscriptionStore.planLabel || 'Cloud' }}
            </dd>
          </div>
          <div v-if="expiresAtLabel" class="flex items-center justify-between">
            <dt class="text-ink-secondary">Aktif sampai</dt>
            <dd class="font-medium text-ink-primary" data-testid="success-expires-at">
              {{ expiresAtLabel }}
            </dd>
          </div>
          <div v-if="startsAtLabel" class="flex items-center justify-between">
            <dt class="text-ink-secondary">Mulai</dt>
            <dd class="font-medium text-ink-primary" data-testid="success-starts-at">
              {{ startsAtLabel }}
            </dd>
          </div>
        </dl>
        <BaseButton data-testid="success-back-cta" @click="goToSettings">
          Kembali ke Pengaturan
        </BaseButton>
      </BaseCard>

      <div v-else class="flex flex-wrap gap-3">
        <BaseButton
          v-if="checkoutStore.canResumePayment"
          data-testid="payment-resume-cta"
          @click="handleResume"
        >
          Lanjutkan Pembayaran
        </BaseButton>
        <BaseButton
          variant="secondary"
          data-testid="payment-refresh-cta"
          :disabled="checkoutStore.isCreating"
          @click="handleRefresh"
        >
          Perbarui Status
        </BaseButton>
        <BaseButton variant="ghost" data-testid="payment-back-cta" @click="goToSettings">
          Kembali ke Pengaturan
        </BaseButton>
      </div>
    </template>
  </div>
</template>
