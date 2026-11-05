<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import BaseButton from '@/components/base/BaseButton.vue'
import ReceiptContent from '@/components/receipt/ReceiptContent.vue'
import {
  MAX_ADDRESS_LENGTH,
  MAX_FOOTER_LENGTH,
  normalizeReceiptSettings,
  prepareReceiptLogo,
  receiptLogoDataUrl,
} from '@/services/printer/receiptSettings'
import { useBusinessStore } from '@/stores/businessStore'
import { useReceiptStore } from '@/stores/receiptStore'

const store = useReceiptStore()
const business = useBusinessStore()
const draft = ref(normalizeReceiptSettings(store.$state))
const processing = ref(false)
const error = ref('')
const feedback = ref('')
const showPreview = ref(false)
const logoUrl = computed(() => receiptLogoDataUrl(draft.value.logo))
let logoVersion = 0
onBeforeUnmount(() => {
  logoVersion += 1
})
watch(
  draft,
  () => {
    feedback.value = ''
  },
  { deep: true, flush: 'sync' },
)
watch(
  () => store.$state,
  (settings) => {
    draft.value = normalizeReceiptSettings(settings)
  },
  { deep: true, flush: 'sync' },
)
const preview = {
  id: 'CONTOH',
  invoiceNumber: 'CONTOH',
  customer: 'Pelanggan',
  createdAt: new Date().toISOString(),
  status: 'paid',
  paymentMethod: 'cash',
  items: [{ name: 'Contoh Produk', qty: 1, price: 10000 }],
  subtotal: 10000,
  total: 10000,
}

async function selectLogo(event) {
  const input = event.target
  const file = input.files?.[0]
  if (!file) return
  const version = ++logoVersion
  processing.value = true
  error.value = ''
  feedback.value = ''
  try {
    const logo = await prepareReceiptLogo(file)
    if (version === logoVersion) draft.value.logo = logo
  } catch (failure) {
    if (version === logoVersion) error.value = failure.message || 'Logo tidak dapat diproses.'
  } finally {
    if (version === logoVersion) processing.value = false
    input.value = ''
  }
}

function save() {
  if (processing.value) return
  store.saveSettings(draft.value)
  draft.value = normalizeReceiptSettings(store.$state)
  error.value = ''
  feedback.value = 'Pengaturan struk berhasil disimpan.'
}
</script>

<template>
  <form class="space-y-4" data-testid="receipt-settings-panel" @submit.prevent="save">
    <div>
      <label for="receipt-address" class="mb-1 block text-sm font-medium text-ink-primary"
        >Alamat pada struk</label
      >
      <textarea
        id="receipt-address"
        v-model="draft.address"
        rows="3"
        :maxlength="MAX_ADDRESS_LENGTH"
        class="w-full rounded-xl border border-zinc-200 bg-card px-3 py-2 text-sm text-ink-primary"
        placeholder="Jalan, nomor, kota"
        data-testid="receipt-address-input"
      />
    </div>
    <div class="space-y-2">
      <label for="receipt-logo" class="block text-sm font-medium text-ink-primary"
        >Logo struk</label
      >
      <p id="receipt-logo-help" class="text-xs text-ink-secondary">
        PNG, JPG, atau WebP, maksimal 2 MB. Otomatis diperkecil maksimal 192 × 96 piksel dan diubah
        menjadi hitam-putih satu warna.
      </p>
      <input
        id="receipt-logo"
        type="file"
        accept="image/png,image/jpeg,image/webp"
        :disabled="processing"
        aria-describedby="receipt-logo-help"
        class="block w-full text-xs text-ink-secondary file:mr-3 file:rounded-lg file:border-0 file:bg-primary/10 file:px-3 file:py-2 file:text-primary"
        data-testid="receipt-logo-input"
        @change="selectLogo"
      />
      <p v-if="processing" role="status" class="text-xs text-ink-secondary">Memproses logo...</p>
      <div v-if="logoUrl" class="flex items-center gap-3 rounded-xl border border-zinc-200 p-3">
        <div class="flex h-16 w-28 items-center justify-center rounded-lg bg-white p-2">
          <img
            :src="logoUrl"
            alt="Pratinjau logo struk hitam-putih"
            class="max-h-12 max-w-24 object-contain"
            data-testid="receipt-logo-preview"
          />
        </div>
        <BaseButton
          size="sm"
          variant="ghost"
          :disabled="processing"
          data-testid="remove-receipt-logo"
          @click="draft.logo = null"
          >Hapus logo</BaseButton
        >
      </div>
    </div>
    <div>
      <label for="receipt-footer" class="mb-1 block text-sm font-medium text-ink-primary"
        >Footer struk</label
      >
      <textarea
        id="receipt-footer"
        v-model="draft.footer"
        rows="3"
        :maxlength="MAX_FOOTER_LENGTH"
        class="w-full rounded-xl border border-zinc-200 bg-card px-3 py-2 text-sm text-ink-primary"
        placeholder="Terima kasih sudah berbelanja!"
        data-testid="receipt-footer-input"
      />
      <p class="mt-1 text-xs text-ink-secondary">
        Kosongkan alamat, logo, atau footer jika tidak ingin ditampilkan.
      </p>
    </div>
    <p v-if="error" role="alert" class="text-sm text-red-600" data-testid="receipt-settings-error">
      {{ error }}
    </p>
    <div class="flex flex-wrap items-center gap-2">
      <BaseButton type="submit" :disabled="processing" data-testid="save-receipt-settings"
        >Simpan</BaseButton
      >
      <BaseButton
        variant="secondary"
        size="sm"
        :disabled="processing"
        @click="showPreview = !showPreview"
        >{{ showPreview ? 'Tutup pratinjau' : 'Pratinjau struk' }}</BaseButton
      >
    </div>
    <p
      v-if="feedback"
      role="status"
      class="text-sm text-emerald-700"
      data-testid="receipt-settings-feedback"
    >
      {{ feedback }}
    </p>
    <ReceiptContent
      v-if="showPreview"
      :transaction="preview"
      :business="business"
      :receipt-settings="draft"
    />
  </form>
</template>
