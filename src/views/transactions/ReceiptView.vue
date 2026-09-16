<script setup>
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import BaseButton from '@/components/base/BaseButton.vue'
import BaseCard from '@/components/base/BaseCard.vue'
import ReceiptContent from '@/components/receipt/ReceiptContent.vue'
import {
  isNativePrinterPlatform,
  printReceipt,
} from '@/services/printer/bluetoothPrinterService'
import { useBusinessStore } from '@/stores/businessStore'
import { usePrinterStore } from '@/stores/printerStore'
import { useTransactionStore } from '@/stores/transactionStore'

const route = useRoute()
const router = useRouter()
const businessStore = useBusinessStore()
const printerStore = usePrinterStore()
const transactionStore = useTransactionStore()

const isPrinting = ref(false)
const printFeedback = ref('')
const printError = ref('')

const transaction = computed(() => (
  transactionStore.items.find((item) => String(item.id) === String(route.params.id)) ?? null
))

const business = computed(() => {
  if (transaction.value?.businessSnapshot) {
    return {
      name: transaction.value.businessSnapshot.name || '-',
      outlet: transaction.value.businessSnapshot.outlet || '-',
      phone: transaction.value.businessSnapshot.phone || '',
    }
  }

  return {
    name: businessStore.name || '-',
    outlet: businessStore.outlet || '-',
    phone: businessStore.phone || '',
  }
})

const isNativePrinter = computed(() => isNativePrinterPlatform())
const needsPrinterSelection = computed(() => isNativePrinter.value && !printerStore.hasSelectedPrinter)

async function handlePrint() {
  if (isPrinting.value || !transaction.value) {
    return
  }

  printFeedback.value = ''
  printError.value = ''

  if (needsPrinterSelection.value) {
    printError.value = 'Printer Bluetooth belum dipilih.'
    return
  }

  isPrinting.value = true

  try {
    const result = await printReceipt({
      transaction: transaction.value,
      business: business.value,
      printer: printerStore.selectedPrinter,
      paperWidth: printerStore.paperWidth,
    })

    if (!result.success) {
      printError.value = result.message
      return
    }

    // Web keeps the browser print dialog; only native Bluetooth reports delivery.
    if (result.mode === 'native') {
      printFeedback.value = 'Struk berhasil dikirim ke printer.'
    }
  } finally {
    isPrinting.value = false
  }
}
</script>

<template>
  <div class="mx-auto max-w-3xl space-y-5 print:max-w-none">
    <div class="flex flex-wrap gap-3 print:hidden">
      <BaseButton variant="secondary" @click="router.back()">Kembali</BaseButton>
      <BaseButton
        :disabled="isPrinting"
        data-testid="btn-print-receipt"
        @click="handlePrint"
      >
        {{ isPrinting ? 'Mencetak...' : 'Print' }}
      </BaseButton>
    </div>

    <p
      v-if="printFeedback"
      class="rounded-2xl bg-emerald-100 px-4 py-3 text-sm text-emerald-700 print:hidden"
      data-testid="print-feedback"
    >
      {{ printFeedback }}
    </p>

    <div
      v-if="printError"
      class="space-y-1 rounded-2xl bg-danger/10 px-4 py-3 text-sm text-danger print:hidden"
      data-testid="print-error"
    >
      <p>{{ printError }}</p>
      <button
        v-if="needsPrinterSelection"
        type="button"
        class="font-semibold underline"
        data-testid="link-configure-printer"
        @click="router.push('/settings')"
      >
        Atur Printer
      </button>
    </div>

    <ReceiptContent v-if="transaction" :transaction="transaction" :business="business" />

    <BaseCard v-else>
      <p class="text-sm text-ink-secondary">Transaksi tidak ditemukan.</p>
    </BaseCard>
  </div>
</template>
