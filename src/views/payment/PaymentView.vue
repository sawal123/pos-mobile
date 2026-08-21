<script setup>
import { ref } from 'vue'
import { useRouter } from 'vue-router'

import BaseButton from '@/components/base/BaseButton.vue'
import BaseCard from '@/components/base/BaseCard.vue'
import PaymentMethodCard from '@/components/payment/PaymentMethodCard.vue'
import CartSummary from '@/components/pos/CartSummary.vue'
import { useCartStore } from '@/stores/cartStore'
import { useTransactionStore } from '@/stores/transactionStore'

const cartStore = useCartStore()
const transactionStore = useTransactionStore()
const router = useRouter()
const selectedMethod = ref('cash')

const paymentMethods = [
  { id: 'cash', label: 'Cash', description: 'Pembayaran tunai di kasir' },
  { id: 'qris', label: 'QRIS', description: 'Scan QR untuk pelanggan' },
  { id: 'card', label: 'Card', description: 'Debit atau kartu kredit' },
]

function completePayment() {
  if (!cartStore.items.length) {
    router.push('/pos')
    return
  }

  transactionStore.createTransaction({
    items: cartStore.items,
    subtotal: cartStore.subtotal,
    tax: cartStore.tax,
    total: cartStore.total,
    paymentMethod: selectedMethod.value,
  })

  cartStore.clearCart()
  router.push('/payment/success')
}
</script>

<template>
  <div class="grid gap-6 lg:grid-cols-[1fr_0.8fr]">
    <section class="space-y-4">
      <div>
        <p class="text-sm font-medium uppercase tracking-[0.18em] text-primary">Payment</p>
        <h2 class="mt-2 text-2xl font-semibold text-ink-primary">Pilih metode pembayaran</h2>
      </div>

      <div class="grid gap-4">
        <button
          v-for="method in paymentMethods"
          :key="method.id"
          class="text-left"
          @click="selectedMethod = method.id"
        >
          <PaymentMethodCard :method="method" :active="selectedMethod === method.id" />
        </button>
      </div>
    </section>

    <section class="space-y-4">
      <BaseCard class="space-y-4">
        <h3 class="text-lg font-semibold text-ink-primary">Ringkasan Pembayaran</h3>
        <CartSummary
          :subtotal="cartStore.subtotal"
          :tax="cartStore.tax"
          :total="cartStore.total"
          :show-action="false"
        />
      </BaseCard>

      <BaseButton block size="lg" :disabled="!cartStore.items.length" @click="completePayment">
        Selesaikan Pembayaran
      </BaseButton>
    </section>
  </div>
</template>
