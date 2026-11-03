<script setup>
import { onMounted, ref } from 'vue'
import { storeToRefs } from 'pinia'
import { useRouter } from 'vue-router'

import BaseButton from '@/components/base/BaseButton.vue'
import BaseCard from '@/components/base/BaseCard.vue'
import BaseInput from '@/components/base/BaseInput.vue'
import BaseModal from '@/components/base/BaseModal.vue'
import CartItem from '@/components/pos/CartItem.vue'
import CartSummary from '@/components/pos/CartSummary.vue'
import CategoryPill from '@/components/pos/CategoryPill.vue'
import MobileCartSheet from '@/components/pos/MobileCartSheet.vue'
import ProductCard from '@/components/pos/ProductCard.vue'
import { useCartStore } from '@/stores/cartStore'
import { usePromoStore } from '@/stores/promoStore'
import { useProductStore } from '@/stores/productStore'
import { useTaxStore } from '@/stores/taxStore'
import { useCloudSessionStore } from '@/stores/cloudSessionStore'
import { useSyncPullStore } from '@/stores/syncPullStore'
import { formatCurrency } from '@/utils/formatters'

const productStore = useProductStore()
const cartStore = useCartStore()
const promoStore = usePromoStore()
const taxStore = useTaxStore()
const cloudStore = useCloudSessionStore()
const syncPullStore = useSyncPullStore()
const router = useRouter()

const { filterCategories, filteredProducts, searchQuery, selectedCategory } = storeToRefs(productStore)
const { items, subtotal, tax, total } = storeToRefs(cartStore)

const showCartSheet = ref(false)
const showPromoModal = ref(false)
const promoCodeInput = ref('')
const promoErrorMessage = ref('')

onMounted(async () => {
  if (cloudStore.isLinked && cloudStore.isOperationalCloudAccess) {
    await syncPullStore.ensureCatalogLoaded()
  }
})

function openCartSheet() {
  if (!items.value.length) {
    return
  }

  showCartSheet.value = true
}

function closeCartSheet() {
  showCartSheet.value = false
}

function openPromoModal() {
  promoCodeInput.value = ''
  promoErrorMessage.value = ''
  showPromoModal.value = true
}

function closePromoModal() {
  showPromoModal.value = false
  promoErrorMessage.value = ''
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
  closePromoModal()
}

function selectPromo(promo) {
  cartStore.applyPromo(promo)
  closePromoModal()
}

function handleCheckout() {
  if (!items.value.length) {
    return
  }

  showCartSheet.value = false
  router.push('/payment')
}
</script>

<template>
  <div class="w-full min-w-0 space-y-4 md:space-y-5">
    <div class="grid gap-5 md:grid-cols-[1fr_340px] lg:grid-cols-[1fr_380px] xl:grid-cols-[1fr_420px] items-start">
      <!-- Left Column: Product Catalog -->
      <section class="min-w-0 space-y-3 sm:space-y-4">
        <div class="space-y-3">
          <BaseInput
            :model-value="searchQuery"
            placeholder="Cari produk..."
            aria-label="Cari produk"
            @update:model-value="productStore.setSearchQuery"
          />

          <div class="flex gap-2 overflow-x-auto pb-1 sm:gap-3">
            <CategoryPill
              v-for="category in filterCategories"
              :key="category"
              :label="category"
              :active="selectedCategory === category"
              @click="productStore.selectCategory(category)"
            />
          </div>
        </div>

        <div v-if="filteredProducts.length" class="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3 2xl:grid-cols-4" data-testid="pos-product-grid">
          <ProductCard
            v-for="product in filteredProducts"
            :key="product.id"
            :product="product"
            @add="cartStore.addItem"
          />
        </div>
        <BaseCard v-else-if="syncPullStore.loading" class="py-12 text-center space-y-3">
          <div class="inline-flex size-10 items-center justify-center rounded-full bg-primary/10 text-primary animate-spin">
            <svg class="size-5" fill="none" viewBox="0 0 24 24">
              <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
              <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
          </div>
          <p class="text-base font-semibold text-ink-primary">Memuat menu dari Cloud...</p>
          <p class="text-xs text-ink-secondary">Mengambil katalog produk &amp; kategori terbaru dari server...</p>
        </BaseCard>
        <BaseCard v-else class="py-10 text-center">
          <p class="text-base font-semibold text-ink-primary">Produk tidak ditemukan</p>
          <p class="mt-2 text-sm text-ink-secondary">
            Coba ganti kategori atau ubah kata kunci pencarian Anda.
          </p>
        </BaseCard>
      </section>

      <!-- Right Column: Cart Details (Sticky on the right side) -->
      <section class="hidden min-w-0 space-y-4 md:block md:sticky md:top-4">
        <BaseCard class="space-y-4 border border-zinc-200/70 bg-white/95 shadow-sm">
          <div class="flex items-center justify-between border-b border-zinc-100 pb-3">
            <div>
              <h2 class="text-base font-bold text-ink-primary">Keranjang</h2>
              <p class="text-xs text-ink-secondary">Daftar item pesanan</p>
            </div>
            <span class="rounded-lg bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary">
              {{ items.length }} item
            </span>
          </div>

          <div v-if="items.length" class="no-scrollbar max-h-[calc(100vh-340px)] space-y-3 overflow-y-auto pr-1">
            <CartItem
              v-for="item in items"
              :key="item.id"
              :item="item"
              @increase="cartStore.increaseQty"
              @decrease="cartStore.decreaseQty"
              @update-qty="cartStore.updateQty"
              @remove="cartStore.removeItem"
            />
          </div>
          <div v-else class="py-8 text-center text-sm text-ink-secondary">
            <p class="font-medium text-ink-primary">Belum ada item yang ditambahkan.</p>
            <p class="mt-1 text-xs text-ink-secondary">Pilih produk di sebelah kiri untuk menambahkan ke keranjang.</p>
          </div>
        </BaseCard>

        <CartSummary
          :subtotal="subtotal"
          :discount="cartStore.discount"
          :applied-promo="cartStore.appliedPromo"
          :tax="tax"
          :tax-enabled="taxStore.enabled"
          :tax-rate="taxStore.rate"
          :total="total"
          :disabled="!items.length"
          @checkout="handleCheckout"
          @select-promo="openPromoModal"
          @remove-promo="cartStore.removePromo"
        />
      </section>
    </div>

    <!-- Floating Mobile Checkout Bar for convenient POS checkout on phone screens -->
    <div
      v-if="items.length"
      class="fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+5.25rem)] z-20 px-4 py-2 md:hidden"
    >
      <div class="flex items-center gap-2 rounded-2xl bg-ink-primary px-3 py-2.5 text-white shadow-2xl backdrop-blur-md">
        <!-- Tapping the summary opens the cart bottom sheet for editing. -->
        <button
          type="button"
          class="flex min-w-0 flex-1 items-center justify-between gap-3 rounded-xl px-1.5 py-1 text-left transition active:scale-[0.99]"
          data-testid="mobile-cart-summary"
          aria-label="Buka keranjang untuk ubah jumlah"
          @click="openCartSheet"
        >
          <span class="min-w-0">
            <span class="block text-xs text-white/70">{{ items.length }} item &bull; Total</span>
            <span class="block truncate text-base font-bold text-white">{{ formatCurrency(total) }}</span>
          </span>
          <span class="shrink-0 text-[11px] font-semibold text-white/70">Ubah</span>
        </button>

        <button
          type="button"
          class="flex shrink-0 items-center gap-1.5 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-white shadow-md transition active:scale-95"
          data-testid="mobile-checkout-btn"
          @click="handleCheckout"
        >
          <span>Bayar</span>
          <span aria-hidden="true">&rarr;</span>
        </button>
      </div>
    </div>

    <MobileCartSheet
      :open="showCartSheet"
      @close="closeCartSheet"
      @checkout="handleCheckout"
      @select-promo="openPromoModal"
    />

    <!-- Promo / Voucher Selection Modal -->
    <BaseModal
      :open="showPromoModal"
      title="Pilih Promo & Voucher"
      @close="closePromoModal"
    >
      <div class="space-y-4">
        <!-- Input Kode Voucher -->
        <div class="space-y-2">
          <label class="text-xs font-semibold text-ink-secondary">Punya kode voucher?</label>
          <div class="flex gap-2">
            <BaseInput
              :model-value="promoCodeInput"
              placeholder="Contoh: DISKON10"
              class="flex-1 uppercase"
              @update:model-value="(val) => (promoCodeInput = val)"
              @keydown.enter="applyVoucherCode"
            />
            <BaseButton
              variant="outline"
              size="sm"
              class="shrink-0 px-4"
              @click="applyVoucherCode"
            >
              Terapkan
            </BaseButton>
          </div>
          <p v-if="promoErrorMessage" class="text-xs font-medium text-red-500">
            {{ promoErrorMessage }}
          </p>
        </div>

        <div class="border-t border-zinc-100 pt-3">
          <p class="mb-2 text-xs font-semibold text-ink-secondary">Promo Tersedia</p>

          <div v-if="promoStore.activePromos.length" class="max-h-60 space-y-2 overflow-y-auto no-scrollbar pr-0.5">
            <div
              v-for="promo in promoStore.activePromos"
              :key="promo.id"
              class="flex items-center justify-between rounded-xl border p-3 transition"
              :class="cartStore.appliedPromo?.id === promo.id
                ? 'border-emerald-500 bg-emerald-50/50 dark:border-emerald-500/80 dark:bg-emerald-950/20'
                : 'border-zinc-200 bg-white hover:border-primary/40'"
            >
              <div class="min-w-0 space-y-1 pr-2">
                <div class="flex items-center gap-2">
                  <span class="text-sm font-bold text-ink-primary">{{ promo.name }}</span>
                  <span
                    v-if="promo.code"
                    class="rounded bg-zinc-100 px-1.5 py-0.5 font-mono text-[10px] font-bold text-zinc-600"
                  >
                    {{ promo.code }}
                  </span>
                </div>
                <p class="text-xs text-ink-secondary">
                  <span v-if="promo.type === 'percent'">Diskon {{ promo.discount_value / 100 }}%</span>
                  <span v-else-if="promo.type === 'fixed'">Potongan {{ formatCurrency(promo.discount_value) }}</span>
                  <span v-else-if="promo.type === 'price_override'">Harga Khusus {{ formatCurrency(promo.discount_value) }}</span>
                  <span v-if="promo.min_purchase > 0"> &bull; Min. {{ formatCurrency(promo.min_purchase) }}</span>
                </p>
              </div>

              <div class="shrink-0">
                <span
                  v-if="cartStore.appliedPromo?.id === promo.id"
                  class="rounded-lg bg-emerald-100 px-2.5 py-1 text-xs font-semibold text-emerald-800"
                >
                  Digunakan ✓
                </span>
                <BaseButton
                  v-else
                  size="sm"
                  variant="outline"
                  @click="selectPromo(promo)"
                >
                  Pakai
                </BaseButton>
              </div>
            </div>
          </div>

          <p v-else class="py-4 text-center text-xs text-ink-secondary">
            Belum ada promo aktif saat ini.
          </p>
        </div>
      </div>
    </BaseModal>
  </div>
</template>
