<script setup>
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { App } from '@capacitor/app'
import { Capacitor } from '@capacitor/core'
import AppIcon from '@/components/base/AppIcon.vue'
import BaseButton from '@/components/base/BaseButton.vue'
import {
  createProductScannerSession,
  decodeProductBarcodeFromFile,
} from '@/services/scanner/productScannerService'

const props = defineProps({
  open: Boolean,
  contextKey: { type: String, required: true },
  title: { type: String, default: 'Scan Produk' },
  continuous: { type: Boolean, default: false },
  lastScannedText: { type: String, default: '' },
  lastScanError: { type: Boolean, default: false },
  cartCount: { type: Number, default: 0 },
})
const emit = defineEmits(['close', 'scanned'])
const route = useRoute()
const video = ref(null)
const fileInput = ref(null)
const error = ref('')
const nativePreview = ref(false)
const closeButton = ref(null)
const scanCount = ref(0)
let session = null
let epoch = 0
let previousFocus = null
let appListener = null
let backListener = null
let disposed = false
let lifecycleEpoch = 0
let wasInert = false

function setNativePreview(active) {
  nativePreview.value = active
  document.documentElement.classList.toggle('product-scanner-native', active)
  document.body.classList.toggle('product-scanner-native', active)
}

async function stop() {
  epoch++
  const current = session
  session = null
  await current?.stop()
  if (!session) setNativePreview(false)
}

function close() {
  void stop()
  emit('close')
}

function triggerImagePicker() {
  fileInput.value?.click()
}

async function handleImageSelected(event) {
  const input = event.target
  const file = input?.files?.[0]
  if (input) input.value = ''
  if (!file || !props.open) return
  error.value = ''
  const context = props.contextKey
  try {
    const code = await decodeProductBarcodeFromFile(file)
    if (!props.open || context !== props.contextKey || !code) return
    scanCount.value += 1
    emit('scanned', code)
    if (!props.continuous) close()
  } catch (err) {
    if (props.open && context === props.contextKey) {
      error.value = err?.message || 'Tidak ditemukan barcode atau QR pada gambar.'
    }
  }
}

async function start() {
  await stop()
  if (!props.open || disposed) return
  error.value = ''
  await nextTick()
  const token = ++epoch
  const context = props.contextKey
  session = createProductScannerSession({
    video: video.value,
    continuous: props.continuous,
    onNativeChange: setNativePreview,
    onResult(code) {
      if (!props.open || token !== epoch || context !== props.contextKey) return
      scanCount.value += 1
      emit('scanned', code)
      if (!props.continuous) close()
    },
    onError(message) {
      if (token === epoch && props.open) error.value = message
    },
  })
  await session.start()
}

function keydown(event) {
  if (!props.open) return
  if (event.key === 'Escape') close()
  if (event.key === 'Tab') {
    const buttons = [...document.querySelectorAll('[data-product-scanner] button')].filter(
      (button) => !button.disabled,
    )
    const first = buttons[0]
    const last = buttons.at(-1)
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last?.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first?.focus()
    }
  }
}
function visibilityChanged() {
  if (document.hidden && props.open) close()
}

watch(
  () => props.open,
  async (open) => {
    const lifecycle = ++lifecycleEpoch
    if (open) {
      const appRoot = document.getElementById('app')
      wasInert = appRoot?.inert ?? false
      if (appRoot) appRoot.inert = true
      previousFocus = document.activeElement
      document.addEventListener('keydown', keydown)
      document.addEventListener('visibilitychange', visibilityChanged)
      if (Capacitor.isNativePlatform()) {
        const app = await App.addListener('appStateChange', ({ isActive }) => {
          if (!isActive && props.open) close()
        })
        if (disposed || !props.open || lifecycle !== lifecycleEpoch) await app.remove()
        else appListener = app
        const back = await App.addListener('backButton', () => {
          if (props.open) close()
        })
        if (disposed || !props.open || lifecycle !== lifecycleEpoch) await back.remove()
        else backListener = back
      }
      if (!props.open || disposed || lifecycle !== lifecycleEpoch) return
      await nextTick()
      closeButton.value?.focus()
      await start()
    } else {
      const appRoot = document.getElementById('app')
      if (appRoot) appRoot.inert = wasInert
      void stop()
      document.removeEventListener('keydown', keydown)
      document.removeEventListener('visibilitychange', visibilityChanged)
      void appListener?.remove()
      appListener = null
      void backListener?.remove()
      backListener = null
      if (previousFocus?.isConnected) previousFocus.focus()
    }
  },
  { immediate: true },
)

watch(
  () => [props.contextKey, route?.fullPath],
  () => {
    if (props.open) close()
  },
  { flush: 'sync' },
)
onBeforeUnmount(() => {
  disposed = true
  lifecycleEpoch++
  const appRoot = document.getElementById('app')
  if (appRoot && props.open) appRoot.inert = wasInert
  void stop()
  document.removeEventListener('keydown', keydown)
  document.removeEventListener('visibilitychange', visibilityChanged)
  void appListener?.remove()
  void backListener?.remove()
})
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open"
      data-product-scanner
      data-testid="product-scanner"
      role="dialog"
      aria-modal="true"
      aria-labelledby="product-scanner-title"
      class="product-scanner-overlay fixed inset-0 z-[100] flex flex-col text-white"
      :class="nativePreview ? 'bg-transparent' : 'bg-zinc-950'"
    >
      <header
        class="flex items-center justify-between gap-4 bg-zinc-950/80 px-5 pb-4 pt-[calc(var(--app-safe-area-top,0px)+1rem)]"
      >
        <div>
          <div class="flex items-center gap-2">
            <h2 id="product-scanner-title" class="text-lg font-semibold">{{ title }}</h2>
            <span
              v-if="continuous"
              class="inline-flex items-center gap-1 rounded-full bg-emerald-500/20 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-300 border border-emerald-400/30"
            >
              <span class="size-1.5 rounded-full bg-emerald-400 animate-pulse" />
              Beruntun Aktif
            </span>
          </div>
          <p class="mt-1 text-xs text-zinc-300">
            {{
              continuous
                ? 'Kamera tetap menyala otomatis. Arahkan produk satu per satu tanpa klik Scan lagi.'
                : 'Arahkan kamera ke QR atau barcode produk.'
            }}
          </p>
        </div>
        <button
          ref="closeButton"
          type="button"
          aria-label="Tutup scanner"
          class="min-h-11 shrink-0 rounded-xl border border-white/30 bg-white/10 px-4 text-sm font-semibold"
          @click="close"
        >
          {{ continuous ? (cartCount > 0 ? `Selesai (${cartCount})` : 'Selesai') : 'Tutup' }}
        </button>
      </header>
      <div class="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden">
        <video
          v-show="!nativePreview && !error"
          ref="video"
          autoplay
          muted
          playsinline
          class="absolute inset-0 h-full w-full object-cover"
        />
        <div
          v-if="!error"
          class="pointer-events-none relative mx-8 h-48 w-full max-w-sm rounded-3xl border-2 border-white/90 shadow-[0_0_0_100vmax_rgba(0,0,0,0.35)]"
          aria-hidden="true"
        >
          <AppIcon name="scan" class="absolute -top-10 left-1/2 -translate-x-1/2" />
        </div>
        <div
          v-else
          class="relative m-5 max-w-sm space-y-4 rounded-3xl bg-card p-5 text-ink-primary"
          role="alert"
        >
          <p class="text-sm leading-relaxed" data-testid="scanner-error">{{ error }}</p>
          <div class="flex flex-wrap items-center gap-2">
            <BaseButton @click="start">Coba Lagi</BaseButton>
            <BaseButton
              variant="secondary"
              data-testid="scanner-error-image-btn"
              @click="triggerImagePicker"
            >
              Scan dari Gambar
            </BaseButton>
          </div>
        </div>

        <!-- Continuous Scan Live Status Banner -->
        <div
          v-if="continuous && !error"
          class="pointer-events-none absolute inset-x-4 bottom-3 z-10 mx-auto max-w-md rounded-2xl border px-3.5 py-2.5 backdrop-blur-md transition-all"
          :class="
            lastScanError
              ? 'border-rose-400/50 bg-rose-950/90 text-rose-100'
              : 'border-emerald-400/50 bg-emerald-950/90 text-emerald-100'
          "
          data-testid="scanner-continuous-banner"
        >
          <div class="flex items-center justify-between gap-2 text-xs">
            <p class="min-w-0 truncate font-semibold">
              {{ lastScannedText || 'Siap scan beruntun — arahkan barcode/QR produk ke kotak' }}
            </p>
            <span
              class="shrink-0 rounded-lg bg-white/15 px-2 py-0.5 font-mono text-[11px] font-bold text-white"
            >
              Keranjang: {{ cartCount }}
            </span>
          </div>
        </div>
      </div>
      <div
        class="flex flex-col items-center gap-2.5 bg-zinc-950/80 px-5 pt-3 pb-[calc(var(--app-safe-area-bottom,0px)+1rem)] text-center"
      >
        <input
          ref="fileInput"
          type="file"
          accept="image/*"
          class="hidden"
          data-testid="scanner-image-input"
          @change="handleImageSelected"
        />
        <button
          type="button"
          data-testid="scanner-image-button"
          class="inline-flex min-h-10 items-center gap-2 rounded-xl border border-white/25 bg-white/10 px-4 py-2 text-xs font-semibold text-white transition hover:bg-white/20"
          @click="triggerImagePicker"
        >
          <AppIcon name="qr" class="size-4" />
          <span>Pilih / Scan dari Gambar</span>
        </button>
        <p class="text-xs text-zinc-300">
          {{
            continuous
              ? 'Mode Scan Beruntun: Kamera tetap aktif setelah produk masuk keranjang. Tekan Selesai jika sudah semua.'
              : 'Satu scan untuk satu produk. Kamera berhenti setelah kode terbaca.'
          }}
        </p>
      </div>
    </div>
  </Teleport>
</template>
