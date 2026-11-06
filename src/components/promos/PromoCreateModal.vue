<script setup>
import { computed, ref, watch } from 'vue'
import BaseButton from '@/components/base/BaseButton.vue'
import PinConfirmationModal from '@/components/auth/PinConfirmationModal.vue'
import { usePromoStore } from '@/stores/promoStore'
import { useProductStore } from '@/stores/productStore'
import { useCustomerStore } from '@/stores/customerStore'

const props = defineProps({
  open: {
    type: Boolean,
    default: false,
  },
})

const emit = defineEmits(['close', 'saved'])

const promoStore = usePromoStore()
const productStore = useProductStore()
const customerStore = useCustomerStore()

const name = ref('')
const code = ref('')
const discountType = ref('fixed') // 'fixed' | 'percent'
const discountValue = ref('')
const minPurchase = ref('')
const maxDiscount = ref('')
const scope = ref('all') // 'all' | 'category' | 'customer'
const selectedCategory = ref('')
const selectedCustomer = ref('')
const startsAt = ref('')
const endsAt = ref('')
const isActive = ref(true)

const errorMessage = ref('')
const showPinModal = ref(false)

function resetForm() {
  name.value = ''
  code.value = ''
  discountType.value = 'fixed'
  discountValue.value = ''
  minPurchase.value = ''
  maxDiscount.value = ''
  scope.value = 'all'
  selectedCategory.value = ''
  selectedCustomer.value = ''
  startsAt.value = ''
  endsAt.value = ''
  isActive.value = true
  errorMessage.value = ''
  showPinModal.value = false
}

watch(
  () => props.open,
  (isOpen) => {
    if (isOpen) {
      resetForm()
    }
  },
)

const categories = computed(() => productStore.categories || [])
const customers = computed(() => customerStore.customers || [])

function handleCodeInput(event) {
  code.value = String(event.target.value || '').toUpperCase().replace(/[^A-Z0-9_-]/g, '')
}

function validateAndProceed() {
  errorMessage.value = ''

  if (!name.value.trim()) {
    errorMessage.value = 'Nama promo wajib diisi.'
    return
  }

  const discVal = Number(discountValue.value)
  if (!discountValue.value || isNaN(discVal) || discVal <= 0) {
    errorMessage.value = 'Nilai diskon harus lebih besar dari 0.'
    return
  }

  if (discountType.value === 'percent' && discVal > 100) {
    errorMessage.value = 'Diskon persentase tidak boleh lebih dari 100%.'
    return
  }

  if (scope.value === 'category' && !selectedCategory.value) {
    errorMessage.value = 'Pilih kategori produk untuk promo ini.'
    return
  }

  if (startsAt.value && endsAt.value && new Date(endsAt.value) < new Date(startsAt.value)) {
    errorMessage.value = 'Tanggal selesai tidak boleh sebelum tanggal mulai.'
    return
  }

  // Open Cashier PIN Confirmation modal
  showPinModal.value = true
}

function handlePinConfirmed() {
  showPinModal.value = false

  const promoPayload = {
    name: name.value.trim(),
    code: code.value.trim() ? code.value.trim() : null,
    discountType: discountType.value,
    discountValue: Number(discountValue.value),
    scope: scope.value,
    minPurchase: minPurchase.value ? Number(minPurchase.value) : 0,
    maxDiscount: maxDiscount.value ? Number(maxDiscount.value) : null,
    status: isActive.value ? 'active' : 'inactive',
    startsAt: startsAt.value ? new Date(startsAt.value).toISOString() : null,
    endsAt: endsAt.value ? new Date(endsAt.value).toISOString() : null,
    targets:
      scope.value === 'category' && selectedCategory.value
        ? [{ target_type: 'category', target_sync_id: selectedCategory.value, value: selectedCategory.value }]
        : (scope.value === 'customer' && selectedCustomer.value
            ? [{ target_type: 'customer', target_sync_id: selectedCustomer.value, value: selectedCustomer.value }]
            : []),
  }

  const createdPromo = promoStore.createPromo(promoPayload)
  emit('saved', createdPromo)
  emit('close')
}
</script>

<template>
  <div>
    <!-- Main Promo Create Modal -->
    <div
      v-if="open"
      class="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs animate-in fade-in duration-200"
      @click.self="$emit('close')"
    >
      <div
        class="flex max-h-[90vh] w-full max-w-lg flex-col rounded-3xl border border-zinc-200/80 bg-card shadow-2xl transition-all duration-200 dark:border-slate-700/60 dark:bg-[#1B2133]"
      >
        <!-- Modal Header -->
        <div class="flex items-center justify-between border-b border-zinc-100 p-5 dark:border-slate-800">
          <div class="flex items-center gap-2.5">
            <div
              class="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary dark:bg-indigo-400/10 dark:text-indigo-400"
            >
              <svg
                class="h-5 w-5"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82Z" />
                <line x1="7" y1="7" x2="7.01" y2="7" />
              </svg>
            </div>
            <div>
              <h3 class="text-base font-bold text-ink-primary">Buat Promo Baru</h3>
              <p class="text-xs text-ink-secondary">Tambah diskon atau voucher belanja</p>
            </div>
          </div>
          <button
            type="button"
            class="rounded-xl p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-slate-800 dark:hover:text-zinc-200 cursor-pointer"
            @click="$emit('close')"
          >
            <svg
              class="h-5 w-5"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <!-- Form Body (Scrollable) -->
        <div class="flex-1 space-y-4 overflow-y-auto p-5 text-sm">
          <!-- Error alert -->
          <div
            v-if="errorMessage"
            class="rounded-2xl border border-rose-200 bg-rose-50 p-3 text-xs font-semibold text-rose-600 dark:border-rose-900/50 dark:bg-rose-950/40 dark:text-rose-400"
          >
            {{ errorMessage }}
          </div>

          <!-- Nama Promo -->
          <div>
            <label class="mb-1 block text-xs font-semibold text-ink-secondary">
              Nama Promo <span class="text-rose-500">*</span>
            </label>
            <input
              v-model="name"
              type="text"
              placeholder="Contoh: Diskon Kopi Senja, Happy Hour 20%"
              class="h-11 w-full rounded-2xl border border-zinc-200 bg-white px-3.5 text-sm text-ink-primary outline-none transition placeholder:text-zinc-400 focus:border-primary focus:ring-4 focus:ring-primary/10 dark:border-slate-700/70 dark:bg-[#121624] dark:placeholder:text-slate-500"
            />
          </div>

          <!-- Kode Promo (Opsional) -->
          <div>
            <label class="mb-1 block text-xs font-semibold text-ink-secondary">
              Kode Promo (Opsional)
            </label>
            <input
              :value="code"
              type="text"
              placeholder="Contoh: HEMAT10, SENJA20 (Opsional)"
              class="h-11 w-full font-mono uppercase rounded-2xl border border-zinc-200 bg-white px-3.5 text-sm text-ink-primary outline-none transition placeholder:text-zinc-400 focus:border-primary focus:ring-4 focus:ring-primary/10 dark:border-slate-700/70 dark:bg-[#121624] dark:placeholder:text-slate-500"
              @input="handleCodeInput"
            />
            <p class="mt-1 text-[11px] text-ink-secondary">
              Kosongkan jika promo otomatis berlaku tanpa kode voucher.
            </p>
          </div>

          <!-- Tipe Diskon & Nilai Diskon -->
          <div class="space-y-2">
            <label class="block text-xs font-semibold text-ink-secondary">
              Tipe Diskon <span class="text-rose-500">*</span>
            </label>
            <div class="grid grid-cols-2 gap-2">
              <button
                type="button"
                class="flex h-10 items-center justify-center gap-2 rounded-2xl border text-xs font-bold transition cursor-pointer"
                :class="[
                  discountType === 'fixed'
                    ? 'border-primary bg-primary/10 text-primary dark:border-indigo-400 dark:bg-indigo-500/20 dark:text-indigo-300'
                    : 'border-zinc-200 bg-surface text-ink-secondary hover:border-zinc-300 dark:border-slate-700/70 dark:bg-[#121624]',
                ]"
                @click="discountType = 'fixed'"
              >
                <span>Rp (Nominal)</span>
              </button>
              <button
                type="button"
                class="flex h-10 items-center justify-center gap-2 rounded-2xl border text-xs font-bold transition cursor-pointer"
                :class="[
                  discountType === 'percent'
                    ? 'border-primary bg-primary/10 text-primary dark:border-indigo-400 dark:bg-indigo-500/20 dark:text-indigo-300'
                    : 'border-zinc-200 bg-surface text-ink-secondary hover:border-zinc-300 dark:border-slate-700/70 dark:bg-[#121624]',
                ]"
                @click="discountType = 'percent'"
              >
                <span>% (Persentase)</span>
              </button>
            </div>

            <!-- Input Nilai Diskon -->
            <div class="relative mt-2">
              <div
                class="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3.5 text-xs font-bold text-ink-secondary"
              >
                {{ discountType === 'fixed' ? 'Rp' : '%' }}
              </div>
              <input
                v-model="discountValue"
                type="number"
                min="0"
                :max="discountType === 'percent' ? 100 : undefined"
                :placeholder="discountType === 'fixed' ? 'Contoh: 10000' : 'Contoh: 20'"
                class="h-11 w-full rounded-2xl border border-zinc-200 bg-white pl-11 pr-3.5 text-sm font-semibold text-ink-primary outline-none transition placeholder:text-zinc-400 focus:border-primary focus:ring-4 focus:ring-primary/10 dark:border-slate-700/70 dark:bg-[#121624] dark:placeholder:text-slate-500"
              />
            </div>
          </div>

          <!-- Minimal Belanja & Maksimal Potongan -->
          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="mb-1 block text-xs font-semibold text-ink-secondary">
                Min. Belanja (Rp)
              </label>
              <input
                v-model="minPurchase"
                type="number"
                min="0"
                placeholder="0 (Tanpa syarat)"
                class="h-11 w-full rounded-2xl border border-zinc-200 bg-white px-3 text-sm text-ink-primary outline-none transition placeholder:text-zinc-400 focus:border-primary focus:ring-4 focus:ring-primary/10 dark:border-slate-700/70 dark:bg-[#121624] dark:placeholder:text-slate-500"
              />
            </div>

            <div v-if="discountType === 'percent'">
              <label class="mb-1 block text-xs font-semibold text-ink-secondary">
                Maks. Potongan (Rp)
              </label>
              <input
                v-model="maxDiscount"
                type="number"
                min="0"
                placeholder="Tak terbatas"
                class="h-11 w-full rounded-2xl border border-zinc-200 bg-white px-3 text-sm text-ink-primary outline-none transition placeholder:text-zinc-400 focus:border-primary focus:ring-4 focus:ring-primary/10 dark:border-slate-700/70 dark:bg-[#121624] dark:placeholder:text-slate-500"
              />
            </div>
          </div>

          <!-- Cakupan Promo -->
          <div>
            <label class="mb-1 block text-xs font-semibold text-ink-secondary">
              Berlaku Untuk
            </label>
            <div class="grid grid-cols-3 gap-1.5">
              <button
                type="button"
                class="h-10 rounded-2xl border text-xs font-bold transition cursor-pointer"
                :class="[
                  scope === 'all'
                    ? 'border-primary bg-primary/10 text-primary dark:border-indigo-400 dark:bg-indigo-500/20 dark:text-indigo-300'
                    : 'border-zinc-200 bg-surface text-ink-secondary hover:border-zinc-300 dark:border-slate-700/70 dark:bg-[#121624]',
                ]"
                @click="scope = 'all'"
              >
                Semua Menu
              </button>
              <button
                type="button"
                class="h-10 rounded-2xl border text-xs font-bold transition cursor-pointer"
                :class="[
                  scope === 'category'
                    ? 'border-primary bg-primary/10 text-primary dark:border-indigo-400 dark:bg-indigo-500/20 dark:text-indigo-300'
                    : 'border-zinc-200 bg-surface text-ink-secondary hover:border-zinc-300 dark:border-slate-700/70 dark:bg-[#121624]',
                ]"
                @click="scope = 'category'"
              >
                Kategori
              </button>
              <button
                type="button"
                class="h-10 rounded-2xl border text-xs font-bold transition cursor-pointer"
                :class="[
                  scope === 'customer'
                    ? 'border-primary bg-primary/10 text-primary dark:border-indigo-400 dark:bg-indigo-500/20 dark:text-indigo-300'
                    : 'border-zinc-200 bg-surface text-ink-secondary hover:border-zinc-300 dark:border-slate-700/70 dark:bg-[#121624]',
                ]"
                @click="scope = 'customer'"
              >
                Pelanggan
              </button>
            </div>

            <!-- Pilih Kategori jika scope category -->
            <div v-if="scope === 'category'" class="mt-2">
              <select
                v-model="selectedCategory"
                class="h-11 w-full rounded-2xl border border-zinc-200 bg-white px-3 text-sm text-ink-primary outline-none transition focus:border-primary focus:ring-4 focus:ring-primary/10 dark:border-slate-700/70 dark:bg-[#121624]"
              >
                <option value="" disabled>-- Pilih Kategori --</option>
                <option v-for="cat in categories" :key="cat" :value="cat">
                  {{ cat }}
                </option>
              </select>
            </div>

            <!-- Pilih Pelanggan jika scope customer -->
            <div v-if="scope === 'customer'" class="mt-2">
              <select
                v-model="selectedCustomer"
                class="h-11 w-full rounded-2xl border border-zinc-200 bg-white px-3 text-sm text-ink-primary outline-none transition focus:border-primary focus:ring-4 focus:ring-primary/10 dark:border-slate-700/70 dark:bg-[#121624]"
              >
                <option value="">-- Semua Pelanggan Terdaftar (Member) --</option>
                <option v-for="cust in customers" :key="cust.id" :value="cust.syncId || cust.id">
                  {{ cust.name }}{{ cust.phone ? ` (${cust.phone})` : '' }}
                </option>
              </select>
              <p class="mt-1 text-[11px] text-ink-secondary">
                Pilih pelanggan tertentu atau biarkan "Semua Pelanggan Terdaftar" untuk seluruh member.
              </p>
            </div>
          </div>

          <!-- Periode Promo (Tanggal Mulai & Selesai) -->
          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="mb-1 block text-xs font-semibold text-ink-secondary">
                Tanggal Mulai (Opsional)
              </label>
              <input
                v-model="startsAt"
                type="date"
                class="h-11 w-full rounded-2xl border border-zinc-200 bg-white px-3 text-xs text-ink-primary outline-none transition focus:border-primary focus:ring-4 focus:ring-primary/10 dark:border-slate-700/70 dark:bg-[#121624]"
              />
            </div>
            <div>
              <label class="mb-1 block text-xs font-semibold text-ink-secondary">
                Tanggal Berakhir (Opsional)
              </label>
              <input
                v-model="endsAt"
                type="date"
                class="h-11 w-full rounded-2xl border border-zinc-200 bg-white px-3 text-xs text-ink-primary outline-none transition focus:border-primary focus:ring-4 focus:ring-primary/10 dark:border-slate-700/70 dark:bg-[#121624]"
              />
            </div>
          </div>

          <!-- Status Aktif Langsung -->
          <label class="flex items-center gap-3 rounded-2xl border border-zinc-200/80 bg-surface p-3 cursor-pointer dark:border-slate-700/60 dark:bg-[#121624]">
            <input
              v-model="isActive"
              type="checkbox"
              class="h-4 w-4 rounded text-primary focus:ring-primary cursor-pointer"
            />
            <div class="flex-1">
              <p class="text-xs font-bold text-ink-primary">Aktifkan Sekarang</p>
              <p class="text-[11px] text-ink-secondary">Promo langsung dapat digunakan saat transaksi POS.</p>
            </div>
          </label>
        </div>

        <!-- Footer Actions -->
        <div class="flex items-center justify-between border-t border-zinc-100 p-4 dark:border-slate-800">
          <button
            type="button"
            class="rounded-xl px-4 py-2.5 text-xs font-semibold text-ink-secondary hover:bg-zinc-100 dark:hover:bg-slate-800 cursor-pointer"
            @click="$emit('close')"
          >
            Batal
          </button>
          <BaseButton
            variant="primary"
            class="gap-1.5"
            data-testid="submit-promo-btn"
            @click="validateAndProceed"
          >
            <svg
              class="h-4 w-4"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
            <span>Verifikasi PIN & Simpan</span>
          </BaseButton>
        </div>
      </div>
    </div>

    <!-- PIN Confirmation Step -->
    <PinConfirmationModal
      :open="showPinModal"
      title="Otorisasi PIN Kasir"
      subtitle="Konfirmasi PIN kasir untuk membuat promo ini."
      @close="showPinModal = false"
      @confirmed="handlePinConfirmed"
    />
  </div>
</template>
