<script setup>
import { computed, nextTick, ref, watch } from 'vue'
import { Capacitor } from '@capacitor/core'
import BaseModal from '@/components/base/BaseModal.vue'
import BaseButton from '@/components/base/BaseButton.vue'
import { useRetailProductCodes } from '@/composables/useRetailProductCodes'
import { useProductStore } from '@/stores/productStore'
import { useCloudSessionStore } from '@/stores/cloudSessionStore'
import { createProductQrDataUrl, downloadProductLabel } from '@/services/products/productQrService'

const props = defineProps({ open: Boolean, product: { type: Object, default: null } })
const emit = defineEmits(['close'])
const products = useProductStore()
const cloud = useCloudSessionStore()
const { canManageCodes, scanContext } = useRetailProductCodes()
const product = computed(() => (props.product ? products.getProductById(props.product.id) : null))
const qr = ref('')
const busy = ref(false)
const error = ref('')
const feedback = ref('')
const native = Capacitor.isNativePlatform()
let renderEpoch = 0

async function renderQr() {
  const token = ++renderEpoch
  qr.value = ''
  error.value = ''
  feedback.value = ''
  if (!props.open || !product.value?.barcode) return
  const code = product.value.barcode
  try {
    await nextTick()
    await cloud.scheduler?.flush?.()
    if (cloud.adapter) {
      const saved = await cloud.adapter.loadProducts()
      if (
        !saved.products.some(
          (entry) => String(entry.id) === String(product.value?.id) && entry.barcode === code,
        )
      ) {
        throw new Error(
          'Kode belum tersimpan pada perangkat. Simpan ulang produk sebelum memakai label QR.',
        )
      }
    }
    if (token !== renderEpoch || !props.open) return
    const image = await createProductQrDataUrl(code)
    if (token === renderEpoch && props.open && code === product.value?.barcode) qr.value = image
  } catch (err) {
    if (token === renderEpoch) error.value = err.message || 'QR belum dapat dibuat.'
  }
}

async function generate() {
  if (busy.value || !product.value) return
  busy.value = true
  const context = scanContext.value
  try {
    const result = products.ensureProductBarcode(product.value.id)
    if (!result.success)
      throw new Error(
        result.errors?.form ||
          result.errors?.barcode ||
          Object.values(result.errors ?? {})[0] ||
          'Kode belum dapat dibuat.',
      )
    if (context === scanContext.value && props.open) await renderQr()
  } catch (err) {
    if (context === scanContext.value && props.open) error.value = err.message
  } finally {
    busy.value = false
  }
}

async function download() {
  if (busy.value || !qr.value || !product.value) return
  busy.value = true
  error.value = ''
  const context = scanContext.value
  try {
    const message = await downloadProductLabel({ ...product.value })
    if (context === scanContext.value && props.open) feedback.value = message
  } catch {
    if (context === scanContext.value && props.open)
      error.value = 'Label belum disimpan. Coba lagi atau tutup menu bagikan.'
  } finally {
    busy.value = false
  }
}

watch(
  () => [props.open, product.value?.id, product.value?.barcode],
  () => {
    if (!busy.value) void renderQr()
  },
  { immediate: true },
)
watch(
  scanContext,
  () => {
    renderEpoch++
    qr.value = ''
    emit('close')
  },
  { flush: 'sync' },
)
</script>

<template>
  <BaseModal :open="open" title="QR Produk" @close="emit('close')">
    <div class="max-h-[75dvh] space-y-4 overflow-y-auto" data-testid="product-qr-modal">
      <template v-if="product">
        <div>
          <p class="text-sm font-semibold text-ink-primary">{{ product.name }}</p>
          <p
            v-if="product.barcode"
            class="mt-1 break-all font-mono text-xs text-ink-secondary"
            data-testid="product-qr-code"
          >
            {{ product.barcode }}
          </p>
        </div>
        <template v-if="product.barcode">
          <img
            v-if="qr"
            :src="qr"
            :alt="`QR produk ${product.name}`"
            class="mx-auto aspect-square w-full max-w-72 rounded-2xl bg-white"
            data-testid="product-qr-image"
          />
          <p v-else-if="!error" class="text-sm text-ink-secondary" role="status">Menyiapkan QR…</p>
          <BaseButton
            block
            :disabled="busy || !qr"
            data-testid="download-product-qr"
            @click="download"
            >{{ native ? 'Simpan / Bagikan PNG' : 'Unduh PNG' }}</BaseButton
          >
        </template>
        <template v-else>
          <p class="text-sm leading-relaxed text-ink-secondary">
            Produk ini belum memiliki kode scan. Buat kode agar produk dapat dipindai di kasir.
          </p>
          <BaseButton
            v-if="canManageCodes"
            block
            :disabled="busy"
            data-testid="generate-product-qr"
            @click="generate"
            >{{ busy ? 'Menyimpan…' : 'Buat Kode & QR' }}</BaseButton
          >
          <p v-else class="text-sm text-ink-secondary">
            Minta pengelola katalog membuat kode produk.
          </p>
        </template>
      </template>
      <p v-else class="text-sm text-ink-secondary">Produk sudah tidak tersedia.</p>
      <p v-if="error" role="alert" class="rounded-2xl bg-danger/10 p-3 text-sm text-danger">
        {{ error }}
      </p>
      <p v-if="feedback" role="status" class="text-sm text-ink-secondary">{{ feedback }}</p>
    </div>
  </BaseModal>
</template>
