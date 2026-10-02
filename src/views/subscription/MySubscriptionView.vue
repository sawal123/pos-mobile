<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'

import AppIcon from '@/components/base/AppIcon.vue'
import BaseButton from '@/components/base/BaseButton.vue'
import BaseCard from '@/components/base/BaseCard.vue'
import { getToken } from '@/services/cloud/tokenRepository'
import {
  CHECKOUT_ERROR_CODE,
  listSubscriptionPayments,
} from '@/services/premium/subscriptionCheckoutService'
import {
  PAYMENT_STATUS,
  isTerminalPaymentStatus,
  paymentStatusLabel,
  paymentStatusTone,
} from '@/services/premium/paymentStatus'
import { PLAN_PERIOD_LABELS, formatPlanPrice } from '@/services/subscription/planCatalogService'
import {
  formatServerDate,
  formatServerDateTime,
  isExpiringSoon,
  remainingTimeUntil,
  subscriptionStatusLabel,
} from '@/services/subscription/subscriptionPresentation'
import { useCloudSessionStore } from '@/stores/cloudSessionStore'
import { usePremiumCheckoutStore } from '@/stores/premiumCheckoutStore'
import { useSubscriptionPlanStore } from '@/stores/subscriptionPlanStore'
import { useSubscriptionStore } from '@/stores/subscriptionStore'

const router = useRouter()
const cloudStore = useCloudSessionStore()
const subscriptionStore = useSubscriptionStore()
const checkoutStore = usePremiumCheckoutStore()
const planStore = useSubscriptionPlanStore()

const history = ref([])
const historyBusinessId = ref(null)
const historyLoading = ref(false)
const historyError = ref('')
const refreshError = ref('')
const refreshing = ref(false)
const offline = ref(typeof navigator !== 'undefined' ? navigator.onLine === false : false)
const actionNotice = ref('')

const activeBusinessId = computed(() => cloudStore.selectedBusiness?.id ?? null)
const rawSubscription = computed(() => subscriptionStore.selectedSubscription ?? null)

const hasRawActiveSubscription = computed(() => {
  const sub = rawSubscription.value
  return (
    sub !== null &&
    typeof sub === 'object' &&
    String(sub.plan ?? '').toLowerCase() === 'cloud' &&
    String(sub.status ?? '').toLowerCase() === 'active'
  )
})

const startsAtLabel = computed(() => formatServerDate(rawSubscription.value?.starts_at ?? null))
const expiresAtLabel = computed(() => formatServerDate(rawSubscription.value?.expires_at ?? null))
const checkedAtLabel = computed(() => formatServerDateTime(cloudStore.contextCheckedAt))
const remaining = computed(() => remainingTimeUntil(rawSubscription.value?.expires_at ?? null))
const expiringSoon = computed(() => isExpiringSoon(rawSubscription.value?.expires_at ?? null))

const businessName = computed(() => cloudStore.selectedBusiness?.name ?? '-')

const displayStatus = computed(() => {
  if (cloudStore.sessionInvalid) return 'session_invalid'
  if (cloudStore.capabilityState === 'revoked') return 'revoked'
  if (subscriptionStore.status === 'unverified' && hasRawActiveSubscription.value) {
    return 'cached_active'
  }
  return subscriptionStore.status
})

const statusBadge = computed(() => {
  switch (displayStatus.value) {
    case 'premium':
    case 'cached_active':
      return { label: 'Aktif', class: 'bg-emerald-100 text-emerald-700' }
    case 'expired':
      return { label: 'Kedaluwarsa', class: 'bg-red-100 text-red-700' }
    case 'pending':
      return { label: 'Menunggu', class: 'bg-amber-100 text-amber-700' }
    case 'session_invalid':
      return { label: 'Sesi invalid', class: 'bg-red-100 text-red-700' }
    case 'revoked':
      return { label: 'Akses dicabut', class: 'bg-red-100 text-red-700' }
    case 'unverified':
    case 'error':
      return {
        label: subscriptionStatusLabel(subscriptionStore.status),
        class: 'bg-zinc-100 text-zinc-700',
      }
    default:
      return { label: 'Free', class: 'bg-amber-100 text-amber-700' }
  }
})

const statusTitle = computed(() => {
  if (displayStatus.value === 'free') return 'Paket saat ini'
  return 'Premium Cloud'
})

const canStartOnlineFlow = computed(
  () => offline.value !== true && cloudStore.isAuthenticated && cloudStore.isLinked,
)

const primaryCtaLabel = computed(() =>
  displayStatus.value === 'free' ? 'Upgrade ke Premium' : 'Perpanjang Langganan',
)

const pendingPayment = computed(() => {
  if (checkoutStore.pending?.status === PAYMENT_STATUS.PENDING) return checkoutStore.pending
  if (checkoutStore.payment?.status === PAYMENT_STATUS.PENDING) return checkoutStore.payment
  return null
})

const paidActivationPending = computed(
  () => checkoutStore.isPaid && subscriptionStore.isPremium !== true,
)

const latestTerminalPayment = computed(() => {
  const payment = history.value.find((item) => isTerminalPaymentStatus(item.status))
  if (!payment || payment.status === PAYMENT_STATUS.PAID) return null
  return payment
})

function periodLabel(period) {
  return PLAN_PERIOD_LABELS[period] ?? period ?? '-'
}

function formatAmount(payment) {
  if (payment?.amount === null || payment?.amount === undefined) return '-'
  return formatPlanPrice(payment.amount, payment.currency || 'IDR')
}

function paymentToneClass(status) {
  switch (paymentStatusTone(status)) {
    case 'success':
      return 'bg-emerald-100 text-emerald-700'
    case 'danger':
      return 'bg-red-100 text-red-700'
    case 'warning':
      return 'bg-amber-100 text-amber-700'
    default:
      return 'bg-zinc-100 text-zinc-700'
  }
}

function resetHistoryForBusiness() {
  history.value = []
  historyBusinessId.value = activeBusinessId.value
  historyError.value = ''
}

async function loadPaymentHistory() {
  if (!cloudStore.isAuthenticated || !cloudStore.isLinked || activeBusinessId.value === null) {
    resetHistoryForBusiness()
    return { ok: false, code: 'NO_LINKED_BUSINESS' }
  }

  historyLoading.value = true
  historyError.value = ''

  try {
    const token = await getToken().catch(() => null)
    if (!token) {
      history.value = []
      historyError.value = 'Sesi Cloud tidak valid. Silakan masuk kembali.'
      return { ok: false, code: 'NO_TOKEN' }
    }

    const businessId = activeBusinessId.value
    const result = await listSubscriptionPayments({ token, businessId })

    if (!result.ok) {
      history.value = []
      if (result.code === CHECKOUT_ERROR_CODE.UNAUTHENTICATED) {
        await cloudStore.invalidateCloudSession()
        historyError.value = 'Sesi Cloud tidak valid. Silakan masuk kembali.'
      } else if (
        Number(result.status) === 403 ||
        result.code === CHECKOUT_ERROR_CODE.BUSINESS_ACCESS_DENIED
      ) {
        historyError.value = 'Akses riwayat pembayaran ditolak.'
      } else if (result.code === CHECKOUT_ERROR_CODE.NETWORK_ERROR) {
        historyError.value = 'Status belum diperiksa ulang.'
      } else {
        historyError.value = 'Riwayat pembayaran tidak dapat dimuat.'
      }
      return result
    }

    if (businessId !== activeBusinessId.value) {
      resetHistoryForBusiness()
      return { ok: false, code: 'BUSINESS_CHANGED' }
    }

    historyBusinessId.value = businessId
    history.value = result.payments.slice(0, 20)
    return { ok: true }
  } finally {
    historyLoading.value = false
  }
}

async function refreshAll() {
  if (refreshing.value) return { ok: false, code: 'IN_FLIGHT' }
  if (offline.value) {
    refreshError.value = 'Status belum diperiksa ulang.'
    return { ok: false, code: 'OFFLINE' }
  }

  refreshing.value = true
  refreshError.value = ''
  actionNotice.value = ''

  try {
    const contextResult = await cloudStore.refreshContext()
    const paymentResult =
      checkoutStore.hasPending || checkoutStore.payment
        ? await checkoutStore.refreshStatus()
        : { ok: true, skipped: true }
    const historyResult = await loadPaymentHistory()

    if (!contextResult?.ok || paymentResult?.ok === false || historyResult?.ok === false) {
      refreshError.value = 'Status belum diperiksa ulang.'
      return { ok: false }
    }

    return { ok: true }
  } finally {
    refreshing.value = false
  }
}

function goBack() {
  router.back()
}

function goToCloud() {
  router.push({ name: 'cloud' })
}

function goToPlanSelection() {
  actionNotice.value = ''
  if (!canStartOnlineFlow.value) {
    actionNotice.value = 'Koneksi internet dan akun Cloud tertaut diperlukan untuk checkout.'
    return
  }

  planStore.reset()
  if (displayStatus.value !== 'free') {
    planStore.enableRenewalMode()
    router.push({ name: 'subscription', query: { renew: '1' } })
    return
  }

  planStore.disableRenewalMode()
  router.push({ name: 'subscription' })
}

async function continuePendingPayment() {
  actionNotice.value = ''
  if (offline.value) {
    actionNotice.value = 'Koneksi internet diperlukan untuk melanjutkan pembayaran.'
    return
  }

  const result = await checkoutStore.launchPayment()
  if (!result.ok) {
    actionNotice.value =
      checkoutStore.error || 'Tautan pembayaran tidak tersedia. Perbarui status terlebih dahulu.'
  }
}

function handleOnline() {
  offline.value = false
}

function handleOffline() {
  offline.value = true
}

watch(activeBusinessId, () => {
  resetHistoryForBusiness()
})

onMounted(async () => {
  if (typeof window !== 'undefined') {
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
  }

  if (!checkoutStore.hasPending) {
    await checkoutStore.hydratePending()
  }
  await loadPaymentHistory()
})

onBeforeUnmount(() => {
  if (typeof window !== 'undefined') {
    window.removeEventListener('online', handleOnline)
    window.removeEventListener('offline', handleOffline)
  }
})

defineExpose({
  loadPaymentHistory,
  refreshAll,
})
</script>

<template>
  <div class="mx-auto max-w-3xl space-y-5" data-testid="my-subscription-view">
    <div class="flex items-center gap-3">
      <button
        type="button"
        data-testid="my-subscription-back"
        class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-zinc-200 bg-white text-ink-primary transition active:scale-95"
        aria-label="Kembali"
        @click="goBack"
      >
        <AppIcon name="chevron-left" />
      </button>
      <div class="min-w-0">
        <p class="text-xs font-medium uppercase tracking-[0.18em] text-primary">Langganan</p>
        <h2 class="truncate text-2xl font-semibold text-ink-primary">Langganan Saya</h2>
      </div>
    </div>

    <p
      v-if="offline || refreshError"
      class="rounded-2xl bg-amber-50 px-4 py-3 text-sm text-amber-700"
      data-testid="subscription-stale-notice"
    >
      Status belum diperiksa ulang.
    </p>

    <BaseCard v-if="cloudStore.sessionInvalid" class="space-y-3" data-testid="session-invalid">
      <p class="text-base font-semibold text-ink-primary">Sesi Cloud tidak valid</p>
      <p class="text-sm text-ink-secondary">
        Masuk kembali untuk melihat status langganan bisnis Cloud.
      </p>
      <BaseButton data-testid="session-login-cta" @click="goToCloud">Masuk ke Cloud</BaseButton>
    </BaseCard>

    <BaseCard
      v-else-if="cloudStore.capabilityState === 'revoked'"
      class="space-y-3"
      data-testid="membership-revoked"
    >
      <p class="text-base font-semibold text-ink-primary">Akses bisnis dicabut</p>
      <p class="text-sm text-ink-secondary">
        Pilih bisnis Cloud lain yang masih authorized. Data POS lokal tetap aman.
      </p>
      <BaseButton data-testid="revoked-cloud-cta" @click="goToCloud">Kelola Akun Cloud</BaseButton>
    </BaseCard>

    <BaseCard v-else class="space-y-4" data-testid="subscription-management-card">
      <div class="flex items-start justify-between gap-3">
        <div class="flex items-center gap-3">
          <span
            class="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary"
          >
            <AppIcon name="crown" />
          </span>
          <div>
            <p class="text-xs uppercase tracking-[0.16em] text-ink-secondary">
              {{ statusTitle }}
            </p>
            <h3
              class="text-base font-semibold text-ink-primary"
              data-testid="my-subscription-title"
            >
              {{ displayStatus === 'free' ? 'Free' : 'Premium Cloud' }}
            </h3>
          </div>
        </div>
        <span
          class="rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide"
          :class="statusBadge.class"
          data-testid="my-subscription-status"
        >
          {{ statusBadge.label }}
        </span>
      </div>

      <p
        v-if="displayStatus === 'cached_active'"
        class="rounded-2xl bg-amber-50 px-4 py-3 text-sm text-amber-700"
        data-testid="cached-active-note"
      >
        Data terakhir menunjukkan aktif, tetapi status belum diperiksa ulang.
      </p>

      <p
        v-if="expiringSoon && displayStatus !== 'expired'"
        class="rounded-2xl bg-amber-50 px-4 py-3 text-sm text-amber-700"
        data-testid="expiring-soon-note"
      >
        Akan berakhir dalam {{ remaining.days }} hari
      </p>

      <dl class="space-y-2 text-sm">
        <div class="flex items-center justify-between rounded-2xl bg-surface px-4 py-3">
          <dt class="text-ink-secondary">Paket</dt>
          <dd class="font-medium text-ink-primary" data-testid="my-subscription-plan">
            {{ displayStatus === 'free' ? 'Free' : 'Cloud' }}
          </dd>
        </div>
        <div
          v-if="startsAtLabel"
          class="flex items-center justify-between rounded-2xl bg-surface px-4 py-3"
        >
          <dt class="text-ink-secondary">Mulai</dt>
          <dd class="font-medium text-ink-primary" data-testid="my-subscription-starts-at">
            {{ startsAtLabel }}
          </dd>
        </div>
        <div
          v-if="expiresAtLabel"
          class="flex items-center justify-between rounded-2xl bg-surface px-4 py-3"
        >
          <dt class="text-ink-secondary">
            {{ displayStatus === 'expired' ? 'Berakhir' : 'Berlaku hingga' }}
          </dt>
          <dd class="font-medium text-ink-primary" data-testid="my-subscription-expires-at">
            {{ expiresAtLabel }}
          </dd>
        </div>
        <div
          v-if="displayStatus !== 'free'"
          class="flex items-center justify-between rounded-2xl bg-surface px-4 py-3"
        >
          <dt class="text-ink-secondary">Sisa masa aktif</dt>
          <dd class="font-medium text-ink-primary" data-testid="my-subscription-remaining">
            {{ remaining.label }}
          </dd>
        </div>
        <div class="flex items-center justify-between rounded-2xl bg-surface px-4 py-3">
          <dt class="text-ink-secondary">Bisnis</dt>
          <dd class="font-medium text-ink-primary" data-testid="my-subscription-business">
            {{ businessName }}
          </dd>
        </div>
        <div class="flex items-center justify-between rounded-2xl bg-surface px-4 py-3">
          <dt class="text-ink-secondary">Status diperiksa</dt>
          <dd class="font-medium text-ink-primary" data-testid="my-subscription-checked-at">
            {{ checkedAtLabel || 'Belum diperiksa ulang' }}
          </dd>
        </div>
      </dl>

      <p
        v-if="displayStatus === 'free'"
        class="text-sm text-ink-secondary"
        data-testid="free-state-copy"
      >
        Fitur lokal tetap tersedia. Upgrade Premium memakai katalog harga terbaru dari server.
      </p>

      <div class="flex flex-wrap gap-3">
        <BaseButton data-testid="renewal-cta" :disabled="refreshing" @click="goToPlanSelection">
          {{ primaryCtaLabel }}
        </BaseButton>
        <BaseButton
          variant="secondary"
          data-testid="refresh-subscription-cta"
          :disabled="refreshing"
          :loading="refreshing"
          @click="refreshAll"
        >
          Perbarui Status
        </BaseButton>
      </div>
    </BaseCard>

    <BaseCard
      v-if="pendingPayment"
      class="space-y-3 border-amber-300"
      data-testid="pending-payment-panel"
    >
      <div class="flex items-center justify-between">
        <p class="text-base font-semibold text-ink-primary">Pembayaran Menunggu</p>
        <span
          class="rounded-full bg-amber-100 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-amber-700"
        >
          Menunggu
        </span>
      </div>
      <dl class="space-y-1 text-sm">
        <div class="flex items-center justify-between">
          <dt class="text-ink-secondary">Paket</dt>
          <dd class="font-medium text-ink-primary" data-testid="pending-payment-period">
            {{ periodLabel(pendingPayment.billingPeriod) }}
          </dd>
        </div>
        <div class="flex items-center justify-between">
          <dt class="text-ink-secondary">Jumlah</dt>
          <dd class="font-medium text-ink-primary" data-testid="pending-payment-amount">
            {{ formatAmount(pendingPayment) }}
          </dd>
        </div>
        <div class="flex items-center justify-between">
          <dt class="text-ink-secondary">Status</dt>
          <dd class="font-medium text-ink-primary">Menunggu pembayaran</dd>
        </div>
      </dl>
      <div class="flex flex-wrap gap-3">
        <BaseButton
          data-testid="continue-pending-payment"
          :disabled="offline"
          @click="continuePendingPayment"
        >
          Lanjutkan Pembayaran
        </BaseButton>
        <BaseButton variant="secondary" data-testid="refresh-pending-payment" @click="refreshAll">
          Perbarui Status
        </BaseButton>
      </div>
    </BaseCard>

    <BaseCard v-if="paidActivationPending" class="space-y-3" data-testid="activation-pending-panel">
      <p class="text-base font-semibold text-ink-primary">Pembayaran berhasil</p>
      <p class="text-sm text-ink-secondary">Aktivasi Premium sedang diproses</p>
      <BaseButton variant="secondary" data-testid="activation-refresh-cta" @click="refreshAll">
        Perbarui Status
      </BaseButton>
    </BaseCard>

    <BaseCard v-if="latestTerminalPayment" class="space-y-3" data-testid="terminal-payment-panel">
      <p class="text-base font-semibold text-ink-primary">Status Pembayaran</p>
      <span
        class="inline-flex rounded-full px-2.5 py-1 text-xs font-semibold"
        :class="paymentToneClass(latestTerminalPayment.status)"
        data-testid="terminal-payment-status"
      >
        {{ paymentStatusLabel(latestTerminalPayment.status) }}
      </span>
      <p class="text-sm text-ink-secondary">
        Status pembayaran ini terpisah dari status langganan yang berasal dari context server.
      </p>
    </BaseCard>

    <BaseCard class="space-y-3" data-testid="payment-history-section">
      <div class="flex items-center justify-between gap-3">
        <div>
          <h3 class="text-base font-semibold text-ink-primary">Riwayat Pembayaran</h3>
          <p class="text-xs text-ink-secondary">Maksimal 20 pembayaran terbaru dari backend.</p>
        </div>
        <BaseButton
          size="sm"
          variant="secondary"
          :disabled="historyLoading"
          @click="loadPaymentHistory"
        >
          Muat
        </BaseButton>
      </div>

      <p v-if="historyLoading" class="text-sm text-ink-secondary" data-testid="history-loading">
        Memuat riwayat...
      </p>
      <p
        v-else-if="historyError"
        class="rounded-2xl bg-amber-50 px-4 py-3 text-sm text-amber-700"
        data-testid="history-error"
      >
        {{ historyError }}
      </p>
      <p v-else-if="!history.length" class="text-sm text-ink-secondary" data-testid="history-empty">
        Belum ada riwayat pembayaran.
      </p>
      <div v-else class="space-y-2" data-testid="history-list">
        <div
          v-for="payment in history"
          :key="payment.id"
          class="rounded-2xl border border-zinc-200 px-4 py-3"
          :data-testid="`history-payment-${payment.id}`"
        >
          <div class="flex items-center justify-between gap-3">
            <div>
              <p class="text-sm font-semibold text-ink-primary">
                {{ periodLabel(payment.billingPeriod) }}
              </p>
              <p class="text-xs text-ink-secondary">
                {{ formatServerDateTime(payment.paidAt) || '-' }}
              </p>
            </div>
            <span
              class="rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide"
              :class="paymentToneClass(payment.status)"
            >
              {{ paymentStatusLabel(payment.status) }}
            </span>
          </div>
          <p class="mt-2 text-sm font-medium text-ink-primary">
            {{ formatAmount(payment) }}
          </p>
        </div>
      </div>
    </BaseCard>

    <p
      v-if="actionNotice"
      class="rounded-2xl bg-amber-50 px-4 py-3 text-sm text-amber-700"
      role="status"
      data-testid="subscription-action-notice"
    >
      {{ actionNotice }}
    </p>
  </div>
</template>
