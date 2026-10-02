<script setup>
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import AppIcon from '@/components/base/AppIcon.vue'
import BaseButton from '@/components/base/BaseButton.vue'
import BaseCard from '@/components/base/BaseCard.vue'
import {
  BENEFIT_AVAILABILITY,
  BENEFIT_AVAILABILITY_LABELS,
  LOCAL_GUARANTEES,
  PREMIUM_BENEFITS,
} from '@/services/subscription/premiumBenefits'
import { PLAN_CATALOG_REASON, PLAN_PERIOD_LABELS } from '@/services/subscription/planCatalogService'
import { useSubscriptionPlanStore } from '@/stores/subscriptionPlanStore'
import { useSubscriptionStore } from '@/stores/subscriptionStore'
import { useCloudSessionStore } from '@/stores/cloudSessionStore'
import { usePremiumCheckoutStore } from '@/stores/premiumCheckoutStore'

const router = useRouter()
const route = useRoute()
const subscriptionStore = useSubscriptionStore()
const planStore = useSubscriptionPlanStore()
const cloudStore = useCloudSessionStore()
const checkoutStore = usePremiumCheckoutStore()

const benefits = PREMIUM_BENEFITS
const localGuarantees = LOCAL_GUARANTEES
const periods = PLAN_PERIOD_LABELS
const checkoutNotice = ref('')

const subscriptionStatus = computed(() => subscriptionStore.status)
const isPremium = computed(() => subscriptionStore.isPremium)
const lastKnownPlanLabel = computed(() =>
  subscriptionStatus.value === 'unverified' ? subscriptionStore.planLabel : null,
)

// The status card mirrors the PREM-M01 vocabulary; the copy is page specific.
const statusView = computed(() => {
  switch (subscriptionStatus.value) {
    case 'premium':
      return {
        badge: 'PREMIUM',
        subtitle: 'Langganan Premium aktif. Fitur cloud bisnis Anda sudah terbuka.',
        cardClass: 'border-emerald-300 bg-gradient-to-br from-emerald-50 to-white',
        badgeClass: 'bg-emerald-100 text-emerald-700',
        iconClass: 'bg-emerald-100 text-emerald-600',
      }
    case 'expired':
      return {
        badge: 'EXPIRED',
        subtitle:
          'Langganan Premium sudah berakhir. Pilih paket untuk mengaktifkan kembali sinkronisasi cloud.',
        cardClass: 'border-red-200 bg-gradient-to-br from-red-50 to-white',
        badgeClass: 'bg-red-100 text-red-700',
        iconClass: 'bg-red-100 text-red-600',
      }
    case 'pending':
      return {
        badge: 'MENUNGGU',
        subtitle: 'Pembayaran langganan belum selesai. Selesaikan untuk mengaktifkan Premium.',
        cardClass: 'border-amber-300 bg-gradient-to-br from-amber-50 to-white',
        badgeClass: 'bg-amber-100 text-amber-700',
        iconClass: 'bg-amber-100 text-amber-600',
      }
    case 'unverified':
      return {
        badge: 'BELUM TERVERIFIKASI',
        subtitle: 'Data terakhir yang diketahui. Status langganan belum dikonfirmasi ulang.',
        cardClass: 'border-zinc-300 bg-gradient-to-br from-zinc-50 to-white',
        badgeClass: 'bg-zinc-200 text-zinc-700',
        iconClass: 'bg-zinc-100 text-zinc-500',
      }
    case 'error':
      return {
        badge: 'TIDAK DIKETAHUI',
        subtitle: 'Status langganan belum dapat dipastikan. Periksa koneksi lalu coba lagi.',
        cardClass: 'border-zinc-200 bg-white',
        badgeClass: 'bg-zinc-100 text-zinc-600',
        iconClass: 'bg-zinc-100 text-zinc-500',
      }
    default:
      return {
        badge: 'FREE',
        subtitle: 'Anda memakai paket Free. Pilih paket Premium untuk membuka fitur cloud.',
        cardClass: 'border-amber-300 bg-gradient-to-br from-amber-50 to-white',
        badgeClass: 'bg-amber-100 text-amber-700',
        iconClass: 'bg-amber-100 text-amber-600',
      }
  }
})

const expiresAtLabel = computed(() => {
  if (!subscriptionStore.expiresAt) return ''
  const date = new Date(subscriptionStore.expiresAt)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })
})

const showStatusSkeleton = computed(() => subscriptionStatus.value === 'loading')

// ── Catalog ─────────────────────────────────────────────────────────────────

const showCatalogSkeleton = computed(() => planStore.isIdle || planStore.isLoading)
const showPeriodSelector = computed(() => planStore.supportsBothPeriods)
const visibleOptions = computed(() => planStore.visibleOptions)
const renewalMode = computed(() => planStore.renewalMode)

const unavailableHint = computed(() => {
  switch (planStore.reason) {
    case PLAN_CATALOG_REASON.NOT_AUTHENTICATED:
      return 'Hubungkan akun cloud bisnis Anda untuk melihat paket yang tersedia.'
    case PLAN_CATALOG_REASON.NO_BUSINESS:
      return 'Pilih bisnis aktif terlebih dahulu agar paket untuk bisnis tersebut dapat dimuat.'
    case PLAN_CATALOG_REASON.ENDPOINT_MISSING:
      return 'Server belum menyediakan katalog paket. Hubungi admin untuk mengaktifkan langganan.'
    case PLAN_CATALOG_REASON.REQUEST_FAILED:
      return 'Katalog paket belum dapat dimuat saat ini.'
    default:
      return 'Katalog paket belum tersedia dari server. Harga dan paket tidak ditampilkan sebelum dikonfirmasi backend.'
  }
})

function isCurrentPlan(option) {
  return planStore.isCurrentPlan(option)
}

function isPlanSelectable(option) {
  return planStore.isSelectable(option)
}

/** Honest reason why an option cannot be chosen yet. */
function unavailablePlanNote(option) {
  if (!option.hasPrice) {
    return 'Harga belum tersedia. Paket belum dapat dipilih sebelum harga resmi dikonfigurasi server.'
  }
  if (option.purchasable !== true) {
    return 'Paket ini belum dapat dibeli karena pembelian belum diaktifkan server.'
  }
  return 'Paket ini belum tersedia untuk dibeli saat ini.'
}

function handleSelectPeriod(period) {
  planStore.selectPeriod(period)
}

function handleSelectOption(option) {
  if (!isPlanSelectable(option)) return
  checkoutNotice.value = ''
  planStore.selectOption(option.key)
}

function handleRetry() {
  checkoutNotice.value = ''
  planStore.retry()
}

/**
 * PREM-M04: the continue action routes into the checkout flow. Entitlement is
 * still never activated here — only the backend activates after payment.
 */
function handleContinue() {
  if (!planStore.canContinue) return

  if (!cloudStore.isAuthenticated) {
    router.push({ name: 'cloud' })
    return
  }
  if (!cloudStore.isLinked) {
    router.push({ name: 'cloud' })
    return
  }

  router.push({ name: 'premium-checkout' })
}

function goToPaymentStatus() {
  router.push({ name: 'premium-payment-status' })
}

function goBack() {
  router.back()
}

onMounted(() => {
  if (route.query?.renew === '1') {
    planStore.enableRenewalMode()
  } else {
    planStore.disableRenewalMode()
  }
  planStore.loadCatalog()
})
</script>

<template>
  <div class="mx-auto max-w-3xl space-y-5" data-testid="subscription-view">
    <div class="flex items-center gap-3">
      <button
        type="button"
        data-testid="subscription-back-btn"
        class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-zinc-200 bg-white text-ink-primary transition active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
        aria-label="Kembali"
        @click="goBack"
      >
        <AppIcon name="chevron-left" />
      </button>
      <div class="min-w-0">
        <p class="text-xs font-medium uppercase tracking-[0.18em] text-primary">Langganan</p>
        <h2 class="truncate text-2xl font-semibold text-ink-primary">Premium</h2>
      </div>
    </div>

    <!-- PREM-M04: pending payment recovery entry -->
    <button
      v-if="checkoutStore.hasPending"
      type="button"
      data-testid="pending-payment-banner"
      class="flex w-full items-center justify-between rounded-3xl border border-amber-300 bg-amber-50 px-4 py-3 text-left"
      @click="goToPaymentStatus"
    >
      <span class="text-sm font-medium text-amber-800">Ada pembayaran Premium yang menunggu</span>
      <AppIcon name="chevron-right" class="text-amber-700" />
    </button>

    <!-- Current subscription status -->
    <div
      v-if="showStatusSkeleton"
      class="animate-pulse rounded-3xl border border-zinc-200 bg-white p-4"
      data-testid="subscription-skeleton"
    >
      <div class="flex items-center gap-3">
        <div class="h-11 w-11 rounded-2xl bg-zinc-100" />
        <div class="flex-1 space-y-2">
          <div class="h-3 w-20 rounded bg-zinc-100" />
          <div class="h-3 w-52 rounded bg-zinc-100" />
        </div>
      </div>
    </div>

    <BaseCard
      v-else
      class="space-y-3 border-2"
      :class="statusView.cardClass"
      data-testid="subscription-status-card"
    >
      <div class="flex items-start gap-3">
        <span
          class="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl"
          :class="statusView.iconClass"
        >
          <AppIcon name="crown" />
        </span>
        <div class="min-w-0 flex-1">
          <div class="flex flex-wrap items-center gap-2">
            <span
              class="rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide"
              :class="statusView.badgeClass"
              data-testid="subscription-badge"
            >
              {{ statusView.badge }}
            </span>
            <span
              v-if="isPremium"
              class="text-sm font-semibold text-ink-primary"
              data-testid="subscription-plan"
            >
              Paket {{ subscriptionStore.planLabel }}
            </span>
          </div>

          <p
            class="mt-1 text-xs leading-relaxed text-ink-secondary"
            data-testid="subscription-subtitle"
          >
            {{ statusView.subtitle }}
          </p>

          <p
            v-if="isPremium && expiresAtLabel"
            class="mt-1 text-xs text-ink-secondary"
            data-testid="subscription-expiry"
          >
            Berlaku sampai {{ expiresAtLabel }}
          </p>

          <p
            v-if="lastKnownPlanLabel"
            class="mt-1 text-xs text-ink-secondary"
            data-testid="subscription-last-known-plan"
          >
            Paket terakhir: {{ lastKnownPlanLabel }}
          </p>
        </div>
      </div>
    </BaseCard>

    <!-- Benefits -->
    <BaseCard class="space-y-4" data-testid="premium-benefits">
      <div>
        <h3 class="text-base font-semibold text-ink-primary">Manfaat Premium</h3>
        <p class="mt-1 text-xs text-ink-secondary">
          Manfaat yang sudah didukung server ditandai Tersedia.
        </p>
      </div>

      <ul class="space-y-3">
        <li
          v-for="benefit in benefits"
          :key="benefit.key"
          class="flex items-start gap-3 rounded-2xl bg-surface p-3"
          :data-testid="`premium-benefit-${benefit.key}`"
        >
          <span
            class="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary"
          >
            <AppIcon :name="benefit.icon" />
          </span>
          <div class="min-w-0 flex-1">
            <div class="flex flex-wrap items-center gap-2">
              <span class="text-sm font-semibold text-ink-primary">{{ benefit.title }}</span>
              <span
                class="rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide"
                :class="
                  benefit.availability === BENEFIT_AVAILABILITY.AVAILABLE
                    ? 'bg-emerald-100 text-emerald-700'
                    : 'bg-zinc-200 text-zinc-600'
                "
                :data-testid="`benefit-status-${benefit.key}`"
              >
                {{ BENEFIT_AVAILABILITY_LABELS[benefit.availability] }}
              </span>
            </div>
            <p class="mt-1 text-xs leading-relaxed text-ink-secondary">
              {{ benefit.description }}
            </p>
            <p class="mt-1 text-xs leading-relaxed text-ink-secondary">
              {{ benefit.availabilityNote }}
            </p>
          </div>
        </li>
      </ul>
    </BaseCard>

    <BaseCard class="space-y-3" data-testid="local-guarantees">
      <div class="flex items-center gap-2">
        <AppIcon name="lock" class="text-primary" />
        <h3 class="text-base font-semibold text-ink-primary">Tetap tersedia tanpa Premium</h3>
      </div>
      <ul class="space-y-2">
        <li
          v-for="guarantee in localGuarantees"
          :key="guarantee"
          class="flex items-start gap-2 text-xs leading-relaxed text-ink-secondary"
        >
          <AppIcon name="chevron-right" class="text-primary" />
          <span>{{ guarantee }}</span>
        </li>
      </ul>
    </BaseCard>

    <!-- Plan selection -->
    <BaseCard class="space-y-4" data-testid="plan-catalog">
      <div>
        <h3 class="text-base font-semibold text-ink-primary">Pilih Paket</h3>
        <p class="mt-1 text-xs text-ink-secondary">
          Nama paket, harga dan fitur diambil langsung dari server.
        </p>
        <p
          v-if="renewalMode"
          class="mt-2 rounded-2xl bg-primary/5 px-4 py-3 text-xs leading-relaxed text-primary"
          data-testid="renewal-mode-note"
        >
          Perpanjangan dibuat sebagai checkout baru. Masa aktif baru ditentukan server setelah
          pembayaran terverifikasi.
        </p>
      </div>

      <!-- Loading -->
      <div
        v-if="showCatalogSkeleton"
        class="animate-pulse space-y-3"
        data-testid="plan-catalog-loading"
      >
        <div v-for="index in 2" :key="index" class="rounded-2xl border border-zinc-200 p-4">
          <div class="h-3 w-24 rounded bg-zinc-100" />
          <div class="mt-3 h-3 w-32 rounded bg-zinc-100" />
          <div class="mt-3 h-3 w-full rounded bg-zinc-100" />
        </div>
      </div>

      <!-- Error -->
      <div v-else-if="planStore.hasError" class="space-y-3" data-testid="plan-catalog-error">
        <p class="rounded-2xl bg-danger/10 px-4 py-3 text-sm text-danger">
          {{ planStore.error || 'Katalog paket gagal dimuat.' }}
        </p>
        <BaseButton variant="secondary" data-testid="plan-catalog-retry" @click="handleRetry">
          Coba Lagi
        </BaseButton>
      </div>

      <!-- Not offered by the backend yet -->
      <div
        v-else-if="planStore.isUnavailable"
        class="space-y-2 rounded-2xl border border-dashed border-zinc-300 p-4"
        data-testid="plan-catalog-unavailable"
      >
        <div class="flex items-center gap-2">
          <AppIcon name="lock" class="text-ink-secondary" />
          <p class="text-sm font-semibold text-ink-primary">Paket belum tersedia</p>
        </div>
        <p class="text-xs leading-relaxed text-ink-secondary" data-testid="plan-catalog-hint">
          {{ unavailableHint }}
        </p>
        <BaseButton variant="secondary" data-testid="plan-catalog-retry" @click="handleRetry">
          Muat Ulang
        </BaseButton>
      </div>

      <!-- Empty -->
      <div
        v-else-if="planStore.isEmpty"
        class="space-y-2 rounded-2xl border border-dashed border-zinc-300 p-4"
        data-testid="plan-catalog-empty"
      >
        <p class="text-sm font-semibold text-ink-primary">Belum ada paket</p>
        <p class="text-xs leading-relaxed text-ink-secondary">
          Server tidak mengembalikan paket apa pun. Hubungi admin untuk mengaktifkan langganan.
        </p>
        <BaseButton variant="secondary" data-testid="plan-catalog-retry" @click="handleRetry">
          Muat Ulang
        </BaseButton>
      </div>

      <!-- Ready -->
      <template v-else>
        <div
          v-if="showPeriodSelector"
          class="grid grid-cols-2 gap-2"
          role="group"
          aria-label="Periode paket"
          data-testid="period-toggle"
        >
          <button
            v-for="period in planStore.availablePeriods"
            :key="period"
            type="button"
            :data-testid="`period-option-${period}`"
            :aria-pressed="planStore.selectedPeriod === period"
            class="h-11 rounded-2xl border text-sm font-semibold transition"
            :class="
              planStore.selectedPeriod === period
                ? 'border-primary bg-primary/10 text-primary'
                : 'border-zinc-200 bg-white text-ink-secondary'
            "
            @click="handleSelectPeriod(period)"
          >
            {{ periods[period] }}
          </button>
        </div>

        <div class="space-y-3">
          <div
            v-for="option in visibleOptions"
            :key="option.key"
            class="rounded-2xl border p-4 transition"
            :class="
              planStore.selectedOptionKey === option.key
                ? 'border-primary bg-primary/5'
                : 'border-zinc-200 bg-white'
            "
            :data-testid="`plan-card-${option.code}`"
          >
            <div class="flex items-start justify-between gap-3">
              <div class="min-w-0">
                <p
                  class="text-sm font-semibold text-ink-primary"
                  :data-testid="`plan-name-${option.code}`"
                >
                  {{ option.name }}
                </p>
                <p
                  class="mt-0.5 text-sm font-semibold text-primary"
                  :data-testid="`plan-price-${option.code}`"
                >
                  {{ option.priceLabel || 'Harga belum tersedia' }}
                </p>
                <p
                  v-if="option.periodLabel"
                  class="text-xs text-ink-secondary"
                  :data-testid="`plan-period-${option.code}`"
                >
                  per {{ option.periodLabel }}
                </p>
              </div>

              <span
                v-if="isCurrentPlan(option)"
                class="shrink-0 rounded-full bg-emerald-100 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-emerald-700"
                :data-testid="`plan-current-${option.code}`"
              >
                Paket Anda saat ini
              </span>
            </div>

            <ul
              v-if="option.benefits.length"
              class="mt-3 space-y-1"
              :data-testid="`plan-benefits-${option.code}`"
            >
              <li
                v-for="benefit in option.benefits"
                :key="benefit"
                class="flex items-start gap-2 text-xs text-ink-secondary"
              >
                <AppIcon name="chevron-right" class="text-primary" />
                <span>{{ benefit }}</span>
              </li>
            </ul>

            <p
              v-if="option.terms"
              class="mt-3 text-xs leading-relaxed text-ink-secondary"
              :data-testid="`plan-terms-${option.code}`"
            >
              {{ option.terms }}
            </p>

            <p
              v-if="!isPlanSelectable(option) && !isCurrentPlan(option)"
              class="mt-3 text-xs leading-relaxed text-ink-secondary"
              :data-testid="`plan-unpurchasable-${option.code}`"
            >
              {{ unavailablePlanNote(option) }}
            </p>

            <BaseButton
              class="mt-3"
              block
              :variant="planStore.selectedOptionKey === option.key ? 'primary' : 'secondary'"
              :disabled="!isPlanSelectable(option) || planStore.selectedOptionKey === option.key"
              :data-testid="`plan-select-${option.code}`"
              @click="handleSelectOption(option)"
            >
              {{ planStore.selectedOptionKey === option.key ? 'Paket dipilih' : 'Pilih paket ini' }}
            </BaseButton>
          </div>
        </div>
      </template>
    </BaseCard>

    <!-- Summary + CTA -->
    <BaseCard class="space-y-3" data-testid="plan-summary">
      <div v-if="planStore.selectedOption" class="space-y-1" data-testid="selected-plan-summary">
        <p class="text-xs uppercase tracking-[0.16em] text-ink-secondary">Paket dipilih</p>
        <p class="text-sm font-semibold text-ink-primary" data-testid="selected-plan-name">
          {{ planStore.selectedOption.name }}
        </p>
        <p class="text-xs text-ink-secondary" data-testid="selected-plan-price">
          {{ planStore.selectedOption.priceLabel || 'Harga belum tersedia' }}
          <template v-if="planStore.selectedOption.periodLabel">
            / {{ planStore.selectedOption.periodLabel }}
          </template>
        </p>
      </div>

      <p v-else class="text-xs text-ink-secondary" data-testid="selected-plan-empty">
        Pilih satu paket untuk melanjutkan.
      </p>

      <p
        v-if="planStore.selectionNotPurchasable"
        class="text-xs leading-relaxed text-ink-secondary"
        data-testid="plan-not-purchasable-note"
      >
        Paket ini belum dapat dilanjutkan karena harga atau pembelian belum tersedia dari server.
      </p>

      <BaseButton
        block
        :disabled="!planStore.canContinue"
        data-testid="continue-cta"
        @click="handleContinue"
      >
        {{ planStore.checkoutAvailable ? 'Lanjutkan' : 'Checkout belum tersedia' }}
      </BaseButton>

      <p
        v-if="!planStore.checkoutAvailable"
        class="text-xs leading-relaxed text-ink-secondary"
        data-testid="checkout-unavailable-note"
      >
        Checkout belum tersedia. Aplikasi ini tidak memproses pembayaran dan tidak menagih apa pun.
      </p>

      <p
        v-if="checkoutNotice"
        class="rounded-2xl bg-primary/5 px-4 py-3 text-xs text-ink-secondary"
        role="status"
        data-testid="checkout-notice"
      >
        {{ checkoutNotice }}
      </p>
    </BaseCard>

    <BaseButton block variant="secondary" data-testid="subscription-back-cta" @click="goBack">
      Kembali
    </BaseButton>
  </div>
</template>
