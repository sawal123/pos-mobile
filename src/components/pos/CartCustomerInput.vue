<script setup>
import { computed, ref, watch } from 'vue'
import AppIcon from '@/components/base/AppIcon.vue'
import { useCartStore } from '@/stores/cartStore'

defineProps({ inputId: { type: String, required: true } })
const cart = useCartStore()
const customer = computed(() => cart.selectedCustomer)
const lookup = computed(() => cart.customerPhoneMatch)

const activeTab = ref(cart.customerName && !cart.customerPhone ? 'name' : 'phone')

watch(
  () => [cart.customerPhone, cart.customerName],
  ([phone, name]) => {
    if (name && !phone && activeTab.value !== 'name') {
      activeTab.value = 'name'
    }
  },
)

function setTab(tab) {
  activeTab.value = tab
  if (tab === 'name') {
    cart.setCustomerPhone('')
  } else {
    cart.setCustomerName('')
  }
}
</script>

<template>
  <div class="space-y-2" data-testid="cart-customer-input">
    <!-- Tabs: Pilih Member vs Ketik Nama Tamu -->
    <div class="flex items-center justify-between gap-2">
      <div
        class="flex items-center rounded-lg bg-zinc-100 p-0.5 text-xs font-semibold dark:bg-slate-800"
      >
        <button
          type="button"
          class="rounded-md px-2.5 py-1 transition cursor-pointer"
          :class="
            activeTab === 'phone'
              ? 'bg-white text-primary shadow-xs dark:bg-slate-700 dark:text-white'
              : 'text-ink-secondary hover:text-ink-primary'
          "
          data-testid="tab-customer-phone"
          @click="setTab('phone')"
        >
          Pilih Member
        </button>
        <button
          type="button"
          class="rounded-md px-2.5 py-1 transition cursor-pointer"
          :class="
            activeTab === 'name'
              ? 'bg-white text-primary shadow-xs dark:bg-slate-700 dark:text-white'
              : 'text-ink-secondary hover:text-ink-primary'
          "
          data-testid="tab-customer-name"
          @click="setTab('name')"
        >
          Ketik Nama Tamu
        </button>
      </div>
      <span class="text-[11px] text-ink-secondary">Opsional</span>
    </div>

    <!-- Phone input mode -->
    <div v-if="activeTab === 'phone'" class="space-y-2">
      <div class="relative">
        <input
          :id="inputId"
          :value="cart.customerPhone"
          type="tel"
          inputmode="tel"
          autocomplete="off"
          maxlength="30"
          placeholder="Nomor HP: 081234567890"
          :aria-describedby="`${inputId}-result`"
          data-testid="cart-customer-phone"
          class="h-11 w-full rounded-xl border border-zinc-200 bg-card px-3 pr-16 text-sm text-ink-primary outline-none transition placeholder:text-zinc-400 focus:border-primary focus:ring-2 focus:ring-primary/10 dark:border-slate-700/70"
          @input="cart.setCustomerPhone($event.target.value)"
        />
        <button
          v-if="cart.customerPhone || customer"
          type="button"
          class="absolute inset-y-0 right-0 min-w-14 rounded-r-xl px-3 text-xs font-medium text-ink-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary cursor-pointer"
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

    <!-- Free guest name input mode -->
    <div v-else class="space-y-2">
      <div class="relative">
        <input
          :id="`${inputId}-guest-name`"
          :value="cart.customerName"
          type="text"
          autocomplete="off"
          maxlength="50"
          placeholder="Ketik nama tamu (misal: Kak Dimas)"
          data-testid="cart-customer-name"
          class="h-11 w-full rounded-xl border border-zinc-200 bg-card px-3 pr-16 text-sm text-ink-primary outline-none transition placeholder:text-zinc-400 focus:border-primary focus:ring-2 focus:ring-primary/10 dark:border-slate-700/70"
          @input="cart.setCustomerName($event.target.value)"
        />
        <button
          v-if="cart.customerName"
          type="button"
          class="absolute inset-y-0 right-0 min-w-14 rounded-r-xl px-3 text-xs font-medium text-ink-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary cursor-pointer"
          aria-label="Hapus nama tamu dari keranjang"
          data-testid="cart-clear-guest-name"
          @click="cart.clearCustomer()"
        >
          Hapus
        </button>
      </div>
      <p class="text-[11px] text-ink-secondary">
        Nama tamu akan dicetak di struk tanpa menyimpan ke daftar member.
      </p>
    </div>
  </div>
</template>
