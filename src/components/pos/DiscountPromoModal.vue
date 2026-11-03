<script setup>
import { computed, ref, watch } from 'vue'

import BaseButton from '@/components/base/BaseButton.vue'
import BaseModal from '@/components/base/BaseModal.vue'
import { useCartStore } from '@/stores/cartStore'
import { usePromoStore } from '@/stores/promoStore'
import { formatCurrency } from '@/utils/formatters'

const QUICK_PERCENT_VALUES = [5, 10, 15, 20, 50]
const QUICK_FIXED_VALUES = [2000, 5000, 10000, 20000]

const props = defineProps({
  open: {
    type: Boolean,
    default: false,
  },
  initialTab: {
    type: String,
    default: '',
  },
})

const emit = defineEmits(['close'])

const cartStore = useCartStore()
const promoStore = usePromoStore()

const activeTab = ref('manual') // 'manual' | 'promo'
const manualType = ref('fixed') // 'fixed' | 'percent'
const manualValueInput = ref('')
const manualErrorMessage = ref('')

const promoCodeInput = ref('')
const promoErrorMessage = ref('')

watch(
  () => props.open,
  (isOpen) => {
    if (!isOpen) return

    promoCodeInput.value = ''
    promoErrorMessage.value = ''
    manualErrorMessage.value = ''

    if (props.initialTab === 'promo' || props.initialTab === 'manual') {
      activeTab.value = props.initialTab
      manualType.value = cartStore.manualDiscountType || 'fixed'
      manualValueInput.value =
        cartStore.manualDiscountValue > 0 ? String(cartStore.manualDiscountValue) : ''
    } else if (cartStore.manualDiscountValue > 0) {
      activeTab.value = 'manual'
      manualType.value = cartStore.manualDiscountType
      manualValueInput.value = String(cartStore.manualDiscountValue)
    } else if (cartStore.appliedPromo || promoStore.activePromos.length > 0) {
      activeTab.value = 'promo'
      manualType.value = 'fixed'
      manualValueInput.value = ''
    } else {
      activeTab.value = 'manual'
      manualType.value = 'fixed'
      manualValueInput.value = ''
    }
  },
)

const parsedManualValue = computed(() => {
  const raw = String(manualValueInput.value ?? '').trim()
  if (!raw) return 0
  const num = Number(raw)
  return Number.isFinite(num) && num > 0 ? num : Number.NaN
})

const previewManualDiscount = computed(() => {
  const val = parsedManualValue.value
  if (!Number.isFinite(val) || val <= 0 || cartStore.subtotal <= 0) return 0

  if (manualType.value === 'percent') {
    const clamped = Math.min(100, val)
    return Math.min(cartStore.subtotal, Math.round((cartStore.subtotal * clamped) / 100))
  }

  return Math.min(cartStore.subtotal, Math.round(val))
})

function switchManualType(type) {
  manualType.value = type
  manualValueInput.value = ''
  manualErrorMessage.value = ''
}

function selectQuickManual(val) {
  manualValueInput.value = String(val)
  manualErrorMessage.value = ''
}

function handleApplyManualDiscount() {
  const raw = String(manualValueInput.value ?? '').trim()
  if (!raw || Number(raw) === 0) {
    cartStore.clearDiscount()
    emit('close')
    return
  }

  const val = Number(raw)
  if (!Number.isFinite(val) || val < 0) {
    manualErrorMessage.value = 'Masukkan nominal diskon yang valid'
    return
  }

  if (manualType.value === 'percent' && val > 100) {
    manualErrorMessage.value = 'Persentase diskon maksimal 100%'
    return
  }

  cartStore.setManualDiscount({
    type: manualType.value,
    value: val,
  })
  emit('close')
}

function handleRemoveDiscount() {
  cartStore.clearDiscount()
  manualValueInput.value = ''
  manualErrorMessage.value = ''
  emit('close')
}

function applyVoucherCode() {
  const code = promoCodeInput.value.trim()
  if (!code) {
    promoErrorMessage.value = 'Masukkan kode voucher terlebih dahulu'
    return
  }

  const promo = promoStore.findPromoByCode(code)
  if (!promo) {
    promoErrorMessage.value = 'Kode promo tidak valid atau telah berakhir'
    return
  }

  cartStore.applyPromo(promo)
  emit('close')
}

function selectPromo(promo) {
  cartStore.applyPromo(promo)
  emit('close')
}
</script>

<template>
  <BaseModal
    :open="open"
    title="Diskon & Promo"
    @close="emit('close')"
  >
    <div class="space-y-4">
      <!-- Segmented Tab Switcher -->
      <div class="grid grid-cols-2 gap-1 rounded-xl bg-zinc-100 p-1">
        <button
          type="button"
          data-testid="tab-manual-discount"
          class="rounded-lg px-3 py-2 text-xs font-semibold transition cursor-pointer"
          :class="activeTab === 'manual'
            ? 'bg-white text-ink-primary shadow-xs'
            : 'text-ink-secondary hover:text-ink-primary'"
          @click="activeTab = 'manual'"
        >
          Diskon Manual (Rp / %)
        </button>
        <button
          type="button"
          data-testid="tab-promo-voucher"
          class="rounded-lg px-3 py-2 text-xs font-semibold transition cursor-pointer"
          :class="activeTab === 'promo'
            ? 'bg-white text-ink-primary shadow-xs'
            : 'text-ink-secondary hover:text-ink-primary'"
          @click="activeTab = 'promo'"
        >
          Promo &amp; Voucher
          <span
            v-if="promoStore.activePromos.length"
            class="ml-1 rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-bold text-primary"
          >
            {{ promoStore.activePromos.length }}
          </span>
        </button>
      </div>

      <!-- TAB 1: Manual Discount (Rp or %) -->
      <div v-if="activeTab === 'manual'" class="space-y-3.5">
        <div class="flex items-center justify-between gap-2">
          <span class="text-xs font-semibold text-ink-secondary">Tipe Potongan</span>
          <div class="inline-flex rounded-xl border border-zinc-200 bg-zinc-50 p-0.5">
            <button
              type="button"
              data-testid="manual-type-fixed"
              class="rounded-lg px-3 py-1 text-xs font-semibold transition cursor-pointer"
              :class="manualType === 'fixed'
                ? 'bg-primary text-white shadow-xs'
                : 'text-ink-secondary hover:text-ink-primary'"
              @click="switchManualType('fixed')"
            >
              Nominal (Rp)
            </button>
            <button
              type="button"
              data-testid="manual-type-percent"
              class="rounded-lg px-3 py-1 text-xs font-semibold transition cursor-pointer"
              :class="manualType === 'percent'
                ? 'bg-primary text-white shadow-xs'
                : 'text-ink-secondary hover:text-ink-primary'"
              @click="switchManualType('percent')"
            >
              Persen (%)
            </button>
          </div>
        </div>

        <div class="space-y-2">
          <label class="block text-xs font-semibold text-ink-primary">
            {{ manualType === 'percent' ? 'Persentase Diskon (%)' : 'Nominal Diskon (Rp)' }}
          </label>
          <input
            v-model="manualValueInput"
            type="text"
            inputmode="decimal"
            data-testid="modal-manual-discount-input"
            :placeholder="manualType === 'percent' ? 'Contoh: 10' : 'Contoh: 5000'"
            class="w-full rounded-2xl border border-zinc-200 bg-white px-4 py-2.5 text-sm font-semibold text-ink-primary outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15"
            @keydown.enter="handleApplyManualDiscount"
          />

          <!-- Quick Chips -->
          <div class="flex flex-wrap gap-1.5 pt-0.5">
            <button
              v-for="preset in (manualType === 'percent' ? QUICK_PERCENT_VALUES : QUICK_FIXED_VALUES)"
              :key="preset"
              type="button"
              class="rounded-xl border border-zinc-200 bg-zinc-50 px-2.5 py-1 text-xs font-semibold text-ink-secondary hover:border-primary/40 hover:text-primary active:scale-95 transition cursor-pointer"
              @click="selectQuickManual(preset)"
            >
              {{ manualType === 'percent' ? `${preset}%` : formatCurrency(preset) }}
            </button>
          </div>

          <p v-if="manualErrorMessage" class="text-xs font-medium text-danger">
            {{ manualErrorMessage }}
          </p>
        </div>

        <!-- Discount Preview -->
        <div class="rounded-2xl border border-zinc-100 bg-zinc-50/80 p-3 space-y-1 text-xs">
          <div class="flex items-center justify-between">
            <span class="text-ink-secondary">Subtotal Pesanan</span>
            <span class="font-medium text-ink-primary">{{ formatCurrency(cartStore.subtotal) }}</span>
          </div>
          <div class="flex items-center justify-between text-emerald-700">
            <span>Potongan Diskon</span>
            <span class="font-bold">-{{ formatCurrency(previewManualDiscount) }}</span>
          </div>
        </div>

        <div class="flex items-center gap-2 pt-1">
          <BaseButton
            v-if="cartStore.discount > 0 || cartStore.appliedPromo"
            variant="secondary"
            size="sm"
            data-testid="modal-remove-discount"
            @click="handleRemoveDiscount"
          >
            Hapus Diskon
          </BaseButton>
          <BaseButton
            block
            data-testid="modal-apply-manual-discount"
            @click="handleApplyManualDiscount"
          >
            Terapkan Diskon
          </BaseButton>
        </div>
      </div>

      <!-- TAB 2: Promo & Voucher -->
      <div v-else class="space-y-3.5">
        <div class="space-y-1.5">
          <label class="block text-xs font-semibold text-ink-secondary">Kode Voucher</label>
          <div class="flex h-10 items-center gap-1.5 rounded-xl border border-zinc-200/90 bg-surface px-2 focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/15 dark:border-slate-700/70 dark:bg-[#121624]">
            <input
              :value="promoCodeInput"
              type="text"
              placeholder="Ketik kode (cth: DISKON10)"
              class="min-w-0 flex-1 bg-transparent px-1.5 text-xs font-semibold uppercase text-ink-primary outline-none placeholder:normal-case placeholder:font-normal placeholder:text-ink-secondary/70"
              @input="promoCodeInput = $event.target.value"
              @keydown.enter="applyVoucherCode"
            />
            <button
              type="button"
              class="h-7 shrink-0 rounded-lg bg-primary px-3 text-xs font-semibold text-white transition hover:bg-primary-light active:scale-95 cursor-pointer"
              @click="applyVoucherCode"
            >
              Terapkan
            </button>
          </div>
          <p v-if="promoErrorMessage" class="text-xs font-medium text-danger">
            {{ promoErrorMessage }}
          </p>
        </div>

        <div class="border-t border-zinc-100 pt-3 dark:border-slate-700/50">
          <p class="mb-2 text-xs font-semibold text-ink-secondary">Voucher &amp; Promo Aktif</p>

          <div v-if="promoStore.activePromos.length" class="max-h-60 space-y-2 overflow-y-auto no-scrollbar pr-0.5">
            <div
              v-for="promo in promoStore.activePromos"
              :key="promo.id"
              class="flex items-center justify-between gap-3 rounded-xl border px-3 py-2.5 transition"
              :class="
                cartStore.appliedPromo?.id === promo.id
                  ? 'border-emerald-500/60 bg-emerald-50/70 dark:border-emerald-500/40 dark:bg-emerald-500/12'
                  : 'border-zinc-200/80 bg-surface hover:border-primary/40 dark:border-slate-700/60 dark:bg-[#121726]'
              "
            >
              <div class="min-w-0 space-y-0.5">
                <div class="flex items-center gap-1.5">
                  <span class="truncate text-xs font-bold text-ink-primary">{{ promo.name }}</span>
                  <span
                    v-if="promo.code"
                    class="shrink-0 rounded-md border border-primary/20 bg-primary/8 px-1.5 py-0.5 font-mono text-[10px] font-bold text-primary dark:border-indigo-400/30 dark:bg-indigo-500/15 dark:text-indigo-300"
                  >
                    {{ promo.code }}
                  </span>
                </div>
                <p class="text-[11px] text-ink-secondary">
                  <span v-if="(promo.discountType ?? promo.discount_type ?? promo.type) === 'percent'">
                    Diskon {{ Number(promo.discountValue ?? promo.discount_value ?? 0) / 100 }}%
                  </span>
                  <span v-else-if="(promo.discountType ?? promo.discount_type ?? promo.type) === 'fixed'">
                    Potongan {{ formatCurrency(promo.discountValue ?? promo.discount_value ?? 0) }}
                  </span>
                  <span v-else-if="(promo.discountType ?? promo.discount_type ?? promo.type) === 'price_override'">
                    Harga Khusus {{ formatCurrency(promo.discountValue ?? promo.discount_value ?? 0) }}
                  </span>
                  <span v-if="Number(promo.minPurchase ?? promo.min_purchase ?? 0) > 0">
                    &bull; Min. {{ formatCurrency(promo.minPurchase ?? promo.min_purchase) }}
                  </span>
                </p>
              </div>

              <div class="shrink-0">
                <span
                  v-if="cartStore.appliedPromo?.id === promo.id"
                  class="rounded-lg bg-emerald-500/15 px-2.5 py-1 text-[11px] font-bold text-emerald-700 dark:text-emerald-300"
                >
                  Aktif ✓
                </span>
                <button
                  v-else
                  type="button"
                  class="rounded-lg border border-primary/30 bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary transition hover:bg-primary hover:text-white active:scale-95 cursor-pointer dark:border-indigo-400/35 dark:bg-indigo-500/15 dark:text-indigo-300 dark:hover:bg-primary dark:hover:text-white"
                  @click="selectPromo(promo)"
                >
                  Pakai
                </button>
              </div>
            </div>
          </div>

          <p v-else class="py-4 text-center text-xs text-ink-secondary">
            Belum ada promo aktif saat ini. Gunakan tab Diskon Manual untuk potongan langsung.
          </p>
        </div>
      </div>
    </div>
  </BaseModal>
</template>

