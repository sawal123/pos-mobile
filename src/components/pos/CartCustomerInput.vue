<script setup>
import { computed } from 'vue'
import AppIcon from '@/components/base/AppIcon.vue'
import { useCartStore } from '@/stores/cartStore'

defineProps({ inputId: { type: String, required: true } })
const cart = useCartStore()
const customer = computed(() => cart.selectedCustomer)
const lookup = computed(() => cart.customerPhoneMatch)
</script>

<template>
  <div class="space-y-2" data-testid="cart-customer-input">
    <div class="flex items-center justify-between gap-2">
      <label :for="inputId" class="text-xs font-semibold text-ink-primary"
        >Nomor HP pelanggan</label
      >
      <span class="text-[11px] text-ink-secondary">Opsional</span>
    </div>
    <div class="relative">
      <input
        :id="inputId"
        :value="cart.customerPhone"
        type="tel"
        inputmode="tel"
        autocomplete="off"
        maxlength="30"
        placeholder="Contoh: 081234567890"
        :aria-describedby="`${inputId}-result`"
        data-testid="cart-customer-phone"
        class="h-11 w-full rounded-xl border border-zinc-200 bg-card px-3 pr-16 text-sm text-ink-primary outline-none transition placeholder:text-zinc-400 focus:border-primary focus:ring-2 focus:ring-primary/10 dark:border-slate-700/70"
        @input="cart.setCustomerPhone($event.target.value)"
      />
      <button
        v-if="cart.customerPhone || customer"
        type="button"
        class="absolute inset-y-0 right-0 min-w-14 rounded-r-xl px-3 text-xs font-medium text-ink-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        aria-label="Hapus pelanggan dari keranjang"
        data-testid="cart-clear-customer"
        @click="cart.clearCustomer()"
      >
        Hapus
      </button>
    </div>
    <div :id="`${inputId}-result`" role="status" aria-live="polite" aria-atomic="true">
      <div
        v-if="customer"
        class="flex items-center gap-2 rounded-xl bg-primary/5 px-3 py-2 text-primary"
        data-testid="cart-customer-match"
      >
        <AppIcon name="customers" class="size-4" />
        <p class="min-w-0 break-words text-sm font-semibold">{{ customer.name }}</p>
      </div>
      <p
        v-else-if="lookup.status === 'ambiguous'"
        class="text-xs leading-relaxed text-amber-600 dark:text-amber-300"
      >
        Nomor ini dipakai beberapa pelanggan. Pilih pelanggan di halaman pembayaran.
      </p>
      <p
        v-else-if="cart.customerPhone.trim()"
        class="text-xs leading-relaxed text-ink-secondary"
        data-testid="cart-customer-not-found"
      >
        Pelanggan belum ditemukan. Transaksi tetap dapat dilanjutkan tanpa pelanggan.
      </p>
      <p v-else class="text-[11px] text-ink-secondary">
        Nama muncul otomatis jika nomor sudah terdaftar.
      </p>
    </div>
  </div>
</template>
