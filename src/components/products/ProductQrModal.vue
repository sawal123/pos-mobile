<script setup>
import { computed, nextTick, ref, watch } from 'vue'
import { Capacitor } from '@capacitor/core'
import AppIcon from '@/components/base/AppIcon.vue'
import BaseModal from '@/components/base/BaseModal.vue'
import BaseButton from '@/components/base/BaseButton.vue'
import { useRetailProductCodes } from '@/composables/useRetailProductCodes'
import { useProductStore } from '@/stores/productStore'
import { useCloudSessionStore } from '@/stores/cloudSessionStore'
import {
  createProductQrDataUrl,
  downloadProductLabel,
  printProductLabel,
} from '@/services/products/productQrService'

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
const copies = ref(1)
const native = Capacitor.isNativePlatform()
let renderEpoch = 0

function formatPrice(val) {
  const num = Number(val)
  if (!Number.isFinite(num) || num <= 0) return ''
  return `Rp ${Math.round(num).toLocaleString('id-ID')}`
}

async function renderQr() {
  const token = ++renderEpoch
  qr.value = ''
  error.value = ''
  feedback.value = ''
  if (!props.open || !product.value?.barcode) return
  const code = product.value.barcode
  try {
    await nextTick()
    const scheduler = cloud.scheduler ?? cloud.getPersistenceScheduler?.()
    await scheduler?.flush?.()
    const adapter = cloud.adapter ?? cloud.getPersistenceAdapter?.()
    if (adapter) {
      const saved = await adapter.loadProducts()
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
  error.value = ''
  feedback.value = ''
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
    if (context === scanContext.value && props.open) {
      await renderQr()
      if (!error.value) {
        feedback.value = 'Kode & QR produk berhasil dibuat dan siap dicetak atau diunduh.'
      }
    }
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

async function printLabel() {
  if (busy.value || !qr.value || !product.value) return
  busy.value = true
  error.value = ''
  const context = scanContext.value
  try {
    const message = await printProductLabel({ ...product.value }, { copies: copies.value })
    if (context === scanContext.value && props.open) feedback.value = message
  } catch {
    if (context === scanContext.value && props.open)
      error.value = 'Label belum dapat dicetak. Coba unduh PNG.'
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
  <BaseModal :open="open" title="Label Kode & QR Produk" @close="emit('close')">
    <div class="max-h-[75dvh] space-y-4 overflow-y-auto" data-testid="product-qr-modal">
      <template v-if="product">
        <div
          class="rounded-2xl border border-dashed border-zinc-300 bg-white p-4 text-center shadow-xs dark:border-slate-700"
        >
          <p class="text-sm font-bold text-ink-primary">{{ product.name }}</p>
          <p v-if="formatPrice(product.price)" class="mt-0.5 text-xs font-extrabold text-primary">
            {{ formatPrice(product.price) }}
          </p>
          <p v-if="product.sku" class="mt-0.5 font-mono text-[11px] text-ink-secondary">
            SKU: {{ product.sku }}
          </p>
          <template v-if="product.barcode">
            <img
              v-if="qr"
              :src="qr"
              :alt="`QR produk ${product.name}`"
              class="mx-auto my-3 aspect-square w-full max-w-56 rounded-xl bg-white p-2"
              data-testid="product-qr-image"
            />
            <p v-else-if="!error" class="my-6 text-sm text-ink-secondary" role="status">
              Menyiapkan QR…
            </p>
            <p
              class="mt-1 inline-block rounded-lg bg-zinc-100 px-2.5 py-1 break-all font-mono text-xs font-bold text-ink-primary"
              data-testid="product-qr-code"
            >
              {{ product.barcode }}
            </p>
          </template>
        </div>

        <template v-if="product.barcode">
          <div
            class="flex items-center justify-between gap-3 rounded-2xl border border-zinc-200/80 bg-surface px-3.5 py-2.5"
          >
            <label for="qr-sticker-copies" class="text-xs font-semibold text-ink-secondary">
              Jumlah Stiker Cetak:
            </label>
            <select
              id="qr-sticker-copies"
              v-model.number="copies"
              data-testid="qr-copies-select"
              class="h-8 rounded-xl border border-zinc-200 bg-white px-2.5 text-xs font-bold text-ink-primary outline-none focus:border-primary"
            >
              <option :value="1">1 Stiker</option>
              <option :value="4">4 Stiker</option>
              <option :value="8">8 Stiker</option>
              <option :value="12">12 Stiker (1 Baris A4)</option>
              <option :value="24">24 Stiker (1 Lembar A4)</option>
            </select>
          </div>

          <div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <BaseButton
              variant="secondary"
              block
              :disabled="busy || !qr"
              data-testid="download-product-qr"
              @click="download"
            >
              <AppIcon name="download" class="h-4 w-4" />
              <span>{{ native ? 'Simpan / Bagikan PNG' : 'Unduh PNG' }}</span>
            </BaseButton>
            <BaseButton
              block
              :disabled="busy || !qr"
              data-testid="print-product-qr"
              @click="printLabel"
            >
              <AppIcon name="printer" class="h-4 w-4" />
              <span>Cetak Label QR</span>
            </BaseButton>
          </div>
          <p class="text-center text-[11px] text-ink-secondary">
            Cetak atau unduh label QR untuk ditempel pada kemasan / produk fisik.
          </p>
        </template>
        <template v-else>
          <p class="text-sm leading-relaxed text-ink-secondary">
            Produk ini belum memiliki kode scan. Buat kode agar produk dapat dipindai di kasir dan
            dicetak label QR-nya.
          </p>
          <BaseButton
            v-if="canManageCodes"
            block
            :disabled="busy"
            data-testid="generate-product-qr"
            @click="generate"
            >{{ busy ? 'Menyimpan…' : '+ Buat Kode & QR' }}</BaseButton
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
      <p
        v-if="feedback"
        role="status"
        class="rounded-2xl bg-emerald-50 p-3 text-xs font-semibold text-emerald-700"
      >
        {{ feedback }}
      </p>
    </div>
  </BaseModal>
</template>
