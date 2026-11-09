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
  lastScannedItemQty: { type: Number, default: 0 },
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
const lastCode = ref('')
const manualCode = ref('')
const compactDock = ref(true)
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

function emitScannedCode(code) {
  const normalized = String(code || '').trim()
  if (!normalized) return
  scanCount.value += 1
  lastCode.value = normalized
  emit('scanned', normalized)
  if (!props.continuous) close()
}

function repeatLastCode() {
  if (!lastCode.value) return
  emitScannedCode(lastCode.value)
}

function submitManualCode() {
  const normalized = String(manualCode.value || '').trim()
  if (!normalized) return
  manualCode.value = ''
  emitScannedCode(normalized)
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
    emitScannedCode(code)
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
      emitScannedCode(code)
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
      scanCount.value = 0
      lastCode.value = ''
      const appRoot = document.getElementById('app')
      wasInert = appRoot?.inert ?? false
      if (appRoot && !props.continuous) appRoot.inert = true
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
      class="product-scanner-overlay fixed z-[100] flex flex-col text-white transition-all"
      :class="[
        nativePreview
          ? 'inset-0 bg-transparent'
          : continuous && compactDock
            ? 'bottom-3 left-3 right-3 sm:right-auto sm:w-[400px] max-h-[82vh] rounded-3xl border-2 border-primary/60 bg-zinc-950 shadow-[0_20px_50px_rgba(0,0,0,0.65)] overflow-hidden'
            : 'inset-0 bg-zinc-950',
      ]"
    >
      <header
        class="flex items-center justify-between gap-3 bg-zinc-950/90 px-4 py-3"
        :class="
          !continuous || !compactDock ? 'pt-[calc(var(--app-safe-area-top,0px)+0.85rem)]' : ''
        "
      >
        <div class="min-w-0">
          <div class="flex items-center gap-2">
            <h2 id="product-scanner-title" class="truncate text-sm sm:text-base font-semibold">
              {{ title }}
            </h2>
            <span
              v-if="continuous"
              class="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-500/20 px-2 py-0.5 text-[10px] font-semibold text-emerald-300 border border-emerald-400/30"
            >
              <span class="size-1.5 rounded-full bg-emerald-400 animate-pulse" />
              LIVE (N+1)
            </span>
          </div>
          <p class="mt-0.5 truncate text-[11px] text-zinc-300">
            {{
              continuous
                ? 'Kamera & Alat Scanner aktif • Scan produk sama = tambah Qty (N+1)'
                : 'Arahkan kamera ke QR atau barcode produk.'
            }}
          </p>
        </div>
        <div class="flex items-center gap-1.5 shrink-0">
          <button
            v-if="continuous && !nativePreview"
            type="button"
            class="min-h-9 rounded-xl border border-white/20 bg-white/10 px-2.5 text-xs font-semibold"
            @click="compactDock = !compactDock"
          >
            {{ compactDock ? 'Penuh' : 'Pojok' }}
          </button>
          <button
            ref="closeButton"
            type="button"
            aria-label="Tutup scanner"
            class="min-h-9 shrink-0 rounded-xl border border-white/30 bg-white/10 px-3 text-xs sm:text-sm font-semibold"
            @click="close"
          >
            {{ continuous ? (cartCount > 0 ? `Selesai (${cartCount})` : 'Selesai') : 'Tutup' }}
          </button>
        </div>
      </header>

      <!-- Continuous Scan Live Status Banner (Placed prominently at top so result & N+1 are always clear) -->
      <div
        v-if="continuous"
        class="border-y px-3.5 py-2 transition-all"
        :class="
          !lastScannedText
            ? 'border-zinc-800 bg-zinc-900 text-zinc-200'
            : lastScanError
              ? 'border-rose-500/60 bg-rose-950/95 text-rose-100'
              : 'border-emerald-400/70 bg-emerald-950/95 text-emerald-100'
        "
        data-testid="scanner-continuous-banner"
      >
        <div class="flex items-center justify-between gap-2 text-xs">
          <div class="flex items-center gap-2 min-w-0">
            <span
              class="flex size-5 shrink-0 items-center justify-center rounded-md text-[11px] font-black"
              :class="
                !lastScannedText
                  ? 'bg-zinc-700 text-zinc-200'
                  : lastScanError
                    ? 'bg-rose-500 text-white'
                    : 'bg-emerald-400 text-zinc-950'
              "
            >
              {{ !lastScannedText ? '⋯' : lastScanError ? '✕' : '✓' }}
            </span>
            <p class="min-w-0 truncate font-semibold">
              {{ lastScannedText || 'Menunggu scan... Arahkan barcode/QR atau gunakan Alat Scanner' }}
            </p>
          </div>
          <div class="flex items-center gap-1.5 shrink-0">
            <button
              v-if="lastCode && !lastScanError"
              type="button"
              data-testid="scanner-repeat-plus-button"
              class="rounded-lg bg-emerald-400 px-2 py-1 text-[11px] font-extrabold text-zinc-950 transition active:scale-95"
              @click="repeatLastCode"
            >
              +1 Lagi
            </button>
            <span
              class="shrink-0 rounded-lg bg-white/15 px-2 py-0.5 font-mono text-[11px] font-bold text-white"
            >
              {{ lastScannedItemQty > 0 ? `Qty: ${lastScannedItemQty}x` : `Total: ${cartCount}` }}
            </span>
          </div>
        </div>
      </div>

      <div
        class="relative flex items-center justify-center overflow-hidden"
        :class="continuous && compactDock && !nativePreview ? 'h-48 sm:h-52' : 'min-h-0 flex-1'"
      >
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
          class="pointer-events-none relative mx-6 rounded-3xl border-2 border-white/90 shadow-[0_0_0_100vmax_rgba(0,0,0,0.35)]"
          :class="continuous && compactDock ? 'h-32 w-56' : 'h-48 w-full max-w-sm'"
          aria-hidden="true"
        >
          <AppIcon name="scan" class="absolute -top-8 left-1/2 -translate-x-1/2" />
        </div>
        <div
          v-else
          class="relative m-4 max-w-sm space-y-3 rounded-2xl bg-card p-4 text-ink-primary"
          role="alert"
        >
          <p class="text-xs sm:text-sm leading-relaxed" data-testid="scanner-error">{{ error }}</p>
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
      </div>

      <!-- Direct Alat Scanner / Manual Code Input inside Scanner -->
      <div
        v-if="continuous"
        class="flex items-center gap-2 border-t border-zinc-800 bg-zinc-900/95 px-3.5 py-2"
      >
        <input
          v-model="manualCode"
          type="text"
          placeholder="Alat Scanner (USB/Bluetooth) / ketik barcode + Enter..."
          class="min-w-0 flex-1 rounded-xl border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-xs text-white placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-primary"
          @keydown.enter.prevent="submitManualCode"
        />
        <button
          type="button"
          class="shrink-0 rounded-xl bg-primary px-3 py-1.5 text-xs font-bold text-white"
          @click="submitManualCode"
        >
          + Tambah
        </button>
      </div>

      <div
        class="flex flex-wrap items-center justify-between gap-2 bg-zinc-950/90 px-4 py-2.5 text-center"
        :class="
          !continuous || !compactDock ? 'pb-[calc(var(--app-safe-area-bottom,0px)+0.85rem)]' : ''
        "
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
          class="inline-flex min-h-9 items-center gap-1.5 rounded-xl border border-white/25 bg-white/10 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-white/20"
          @click="triggerImagePicker"
        >
          <AppIcon name="qr" class="size-4" />
          <span>Pilih / Scan dari Gambar</span>
        </button>
        <p class="text-[11px] text-zinc-400">
          {{
            continuous
              ? 'Scan berulang produk yang sama otomatis menambah Qty (N+1).'
              : 'Satu scan untuk satu produk.'
          }}
        </p>
      </div>
    </div>
  </Teleport>
</template>
