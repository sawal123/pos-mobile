<script setup>
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useCashierStore } from '@/stores/cashierStore'

const PIN_LENGTH = 6
const KEYPAD_NUMBERS = ['1', '2', '3', '4', '5', '6', '7', '8', '9']

const props = defineProps({
  open: {
    type: Boolean,
    default: false,
  },
  title: {
    type: String,
    default: 'Verifikasi PIN Kasir',
  },
  subtitle: {
    type: String,
    default: 'Masukkan 6 digit PIN kasir untuk konfirmasi',
  },
})

const emit = defineEmits(['close', 'confirmed'])

const cashierStore = useCashierStore()
const pin = ref('')
const errorMessage = ref('')
const hiddenInputRef = ref(null)

const digits = computed(() =>
  Array.from({ length: PIN_LENGTH }, (_, index) => pin.value[index] ?? ''),
)

function focusInput() {
  nextTick(() => {
    hiddenInputRef.value?.focus()
  })
}

watch(
  () => props.open,
  (isOpen) => {
    if (isOpen) {
      pin.value = ''
      errorMessage.value = ''
      focusInput()
    }
  },
)

function sanitizePin(raw) {
  return String(raw ?? '')
    .replace(/\D/g, '')
    .slice(0, PIN_LENGTH)
}

function handleNativeInput(event) {
  errorMessage.value = ''
  const clean = sanitizePin(event?.target?.value)
  pin.value = clean
  if (event?.target && event.target.value !== clean) {
    event.target.value = clean
  }
  if (clean.length === PIN_LENGTH) {
    verifyAndConfirm()
  }
}

function appendDigit(digit) {
  errorMessage.value = ''
  if (pin.value.length >= PIN_LENGTH) return
  pin.value = `${pin.value}${digit}`
  if (pin.value.length === PIN_LENGTH) {
    verifyAndConfirm()
  }
}

function removeLastDigit() {
  errorMessage.value = ''
  if (!pin.value.length) return
  pin.value = pin.value.slice(0, -1)
}

function clearPin() {
  errorMessage.value = ''
  pin.value = ''
  focusInput()
}

function verifyAndConfirm() {
  if (pin.value.length < PIN_LENGTH) {
    errorMessage.value = 'Masukkan 6 digit PIN terlebih dahulu.'
    return
  }

  const isValid = cashierStore.verifyPin(pin.value)
  if (isValid) {
    emit('confirmed')
    pin.value = ''
    errorMessage.value = ''
  } else {
    errorMessage.value = 'PIN salah. Periksa kembali PIN kasir Anda.'
    pin.value = ''
    focusInput()
  }
}

function handleKeyDown(event) {
  if (!props.open) return
  if (event.key === 'Escape') {
    emit('close')
  }
}

onMounted(() => {
  window.addEventListener('keydown', handleKeyDown)
})

onUnmounted(() => {
  window.removeEventListener('keydown', handleKeyDown)
})
</script>

<template>
  <div
    v-if="open"
    class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs animate-in fade-in duration-200"
    @click.self="$emit('close')"
  >
    <div
      class="w-full max-w-sm rounded-3xl border border-zinc-200/80 bg-card p-5 shadow-2xl transition-all duration-200 dark:border-slate-700/60 dark:bg-[#1B2133]"
    >
      <!-- Modal Header -->
      <div class="flex items-center justify-between border-b border-zinc-100 pb-3 dark:border-slate-800">
        <div class="flex items-center gap-2.5">
          <div
            class="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-500/10 text-amber-600 dark:bg-amber-400/10 dark:text-amber-400"
          >
            <svg
              class="h-5 w-5"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
          </div>
          <div>
            <h3 class="text-base font-bold text-ink-primary">{{ title }}</h3>
            <p class="text-xs text-ink-secondary">{{ cashierStore.activeCashier?.name || 'Kasir' }}</p>
          </div>
        </div>
        <button
          type="button"
          class="rounded-xl p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-slate-800 dark:hover:text-zinc-200 cursor-pointer"
          @click="$emit('close')"
        >
          <svg
            class="h-5 w-5"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      <!-- Description -->
      <div class="my-4 text-center">
        <p class="text-xs text-ink-secondary">{{ subtitle }}</p>
      </div>

      <!-- Visual PIN Slots + Native Hidden Input -->
      <div class="relative mb-3" @click="focusInput">
        <input
          ref="hiddenInputRef"
          type="password"
          inputmode="numeric"
          pattern="[0-9]*"
          maxlength="6"
          autocomplete="off"
          :value="pin"
          aria-label="PIN 6 digit"
          class="sr-only"
          @input="handleNativeInput"
        />

        <div class="grid grid-cols-6 gap-2" data-testid="pin-confirm-slots">
          <div
            v-for="(digit, index) in digits"
            :key="index"
            class="flex h-11 items-center justify-center rounded-xl border text-base font-bold transition-all"
            :class="[
              digit
                ? 'border-primary/60 bg-primary/10 shadow-xs dark:border-indigo-400/60 dark:bg-indigo-500/20'
                : index === pin.length
                  ? 'border-primary ring-2 ring-primary/20 bg-card dark:border-indigo-400'
                  : 'border-zinc-200 bg-surface dark:border-slate-700/70',
            ]"
          >
            <span
              v-if="digit"
              class="h-2.5 w-2.5 rounded-full bg-primary dark:bg-indigo-400"
            />
            <span
              v-else-if="index === pin.length"
              class="h-4 w-0.5 animate-pulse rounded-full bg-primary dark:bg-indigo-400"
            />
          </div>
        </div>
      </div>

      <!-- Error Message -->
      <div v-if="errorMessage" class="mb-3 text-center">
        <p class="text-xs font-semibold text-rose-500">{{ errorMessage }}</p>
      </div>

      <!-- Keypad -->
      <div class="grid grid-cols-3 gap-2" data-testid="pin-confirm-keypad">
        <button
          v-for="num in KEYPAD_NUMBERS"
          :key="num"
          type="button"
          class="flex h-11 items-center justify-center rounded-xl border border-zinc-200/80 bg-surface font-mono text-base font-bold text-ink-primary transition hover:border-primary/40 hover:bg-primary/5 active:scale-95 cursor-pointer dark:border-slate-700/60 dark:bg-[#121726] dark:hover:border-indigo-400/40"
          @click="appendDigit(num)"
        >
          {{ num }}
        </button>

        <button
          type="button"
          :disabled="!pin.length"
          class="flex h-11 items-center justify-center rounded-xl border border-zinc-200/80 bg-surface text-xs font-semibold text-ink-secondary transition hover:border-rose-300 hover:text-rose-500 active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer dark:border-slate-700/60 dark:bg-[#121726]"
          @click="clearPin"
        >
          Ulangi
        </button>

        <button
          type="button"
          class="flex h-11 items-center justify-center rounded-xl border border-zinc-200/80 bg-surface font-mono text-base font-bold text-ink-primary transition hover:border-primary/40 hover:bg-primary/5 active:scale-95 cursor-pointer dark:border-slate-700/60 dark:bg-[#121726] dark:hover:border-indigo-400/40"
          @click="appendDigit('0')"
        >
          0
        </button>

        <button
          type="button"
          :disabled="!pin.length"
          aria-label="Hapus"
          class="flex h-11 items-center justify-center rounded-xl border border-zinc-200/80 bg-surface text-ink-secondary transition hover:border-primary/40 hover:text-ink-primary active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer dark:border-slate-700/60 dark:bg-[#121726]"
          @click="removeLastDigit"
        >
          <svg
            class="h-4 w-4"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path d="M21 4H8l-7 8 7 8h13a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2z" />
            <line x1="18" y1="9" x2="12" y2="15" />
            <line x1="12" y1="9" x2="18" y2="15" />
          </svg>
        </button>
      </div>

      <!-- Action Buttons -->
      <div class="mt-4 flex gap-2">
        <button
          type="button"
          class="flex-1 rounded-xl border border-zinc-200 bg-surface py-2.5 text-xs font-semibold text-ink-secondary transition hover:bg-zinc-100 dark:border-slate-700 dark:bg-[#121726] dark:hover:bg-slate-800 cursor-pointer"
          @click="$emit('close')"
        >
          Batal
        </button>
      </div>
    </div>
  </div>
</template>
