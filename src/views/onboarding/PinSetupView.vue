<script setup>
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'

import AppIcon from '@/components/base/AppIcon.vue'
import BaseButton from '@/components/base/BaseButton.vue'
import BaseCard from '@/components/base/BaseCard.vue'
import NexaPosLogo from '@/components/base/NexaPosLogo.vue'
import { useBusinessStore } from '@/stores/businessStore'
import { useCashierStore } from '@/stores/cashierStore'
import { useThemeStore } from '@/stores/themeStore'

const PIN_LENGTH = 6
const KEYPAD_NUMBERS = ['1', '2', '3', '4', '5', '6', '7', '8', '9']

const businessStore = useBusinessStore()
const cashierStore = useCashierStore()
const themeStore = useThemeStore()
const router = useRouter()

const pin = ref('')
const showPin = ref(false)
const errorMessage = ref('')
const hiddenInputRef = ref(null)

const digits = computed(() =>
  Array.from({ length: PIN_LENGTH }, (_, index) => pin.value[index] ?? ''),
)

const isComplete = computed(() => pin.value.length === PIN_LENGTH)

function focusPinInput() {
  hiddenInputRef.value?.focus()
}

onMounted(() => {
  focusPinInput()
})

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
}

function appendDigit(digit) {
  errorMessage.value = ''
  if (pin.value.length >= PIN_LENGTH) {
    return
  }
  pin.value = `${pin.value}${digit}`
}

function removeLastDigit() {
  errorMessage.value = ''
  if (!pin.value.length) {
    return
  }
  pin.value = pin.value.slice(0, -1)
}

function clearPin() {
  errorMessage.value = ''
  pin.value = ''
  focusPinInput()
}

function savePin() {
  if (pin.value.length < PIN_LENGTH) {
    errorMessage.value = 'Masukkan 6 digit angka PIN terlebih dahulu.'
    focusPinInput()
    return
  }

  cashierStore.setPin(pin.value)
  router.push('/shift/open')
}
</script>

<template>
  <div class="min-h-dvh bg-surface text-ink-primary transition-colors duration-200">
    <main class="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center gap-4 px-4 py-6 sm:px-6">
      <!-- Top Brand + Theme Bar -->
      <div class="flex items-center justify-between gap-3">
        <NexaPosLogo size="sm" with-wordmark show-version />

        <button
          type="button"
          data-testid="pin-theme-toggle"
          class="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-zinc-200/90 bg-card text-zinc-700 shadow-xs transition hover:border-primary/40 hover:text-primary active:scale-95 cursor-pointer dark:border-slate-700/70 dark:bg-[#1B2133] dark:text-amber-300"
          :title="themeStore.isDark ? 'Ganti ke Tema Light' : 'Ganti ke Tema Dark'"
          :aria-label="themeStore.isDark ? 'Ganti ke Tema Light' : 'Ganti ke Tema Dark'"
          @click="themeStore.toggleTheme()"
        >
          <AppIcon :name="themeStore.isDark ? 'sun' : 'moon'" class="h-4 w-4" />
        </button>
      </div>

      <BaseCard class="space-y-5 p-5 sm:p-6" data-testid="pin-setup-card">
        <!-- Header -->
        <div class="flex items-start justify-between gap-3">
          <div class="space-y-1.5">
            <span class="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-[0.14em] text-primary">
              <AppIcon name="shield" class="h-3.5 w-3.5" />
              Keamanan Kasir
            </span>
            <h1 class="text-2xl font-bold tracking-tight text-ink-primary">Buat PIN Kasir</h1>
            <p class="text-xs leading-relaxed text-ink-secondary sm:text-sm">
              Gunakan 6 digit angka untuk mengamankan pembukaan shift dan akses operasional kasir.
            </p>
          </div>
        </div>

        <!-- Cashier Context Strip -->
        <div class="flex items-center justify-between gap-3 rounded-2xl border border-zinc-200/80 bg-surface px-3.5 py-2.5 text-xs dark:border-slate-700/60">
          <div class="flex min-w-0 items-center gap-2.5">
            <span class="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-primary/12 font-bold text-primary">
              {{ (cashierStore.activeCashier?.name || 'K').charAt(0).toUpperCase() }}
            </span>
            <div class="min-w-0">
              <p class="truncate font-semibold text-ink-primary">
                {{ cashierStore.activeCashier?.name || 'Kasir Utama' }}
              </p>
              <p class="truncate text-[11px] text-ink-secondary">
                {{ businessStore.name || 'Outlet Aktif' }}
              </p>
            </div>
          </div>

          <button
            type="button"
            data-testid="pin-visibility-toggle"
            class="inline-flex shrink-0 items-center gap-1 rounded-xl border border-zinc-200/90 bg-card px-2.5 py-1.5 text-[11px] font-semibold text-ink-secondary transition hover:border-primary/40 hover:text-primary cursor-pointer dark:border-slate-700/70"
            @click="showPin = !showPin"
          >
            <!-- Eye / Eye-off SVG -->
            <svg
              v-if="!showPin"
              class="h-3.5 w-3.5"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
            <svg
              v-else
              class="h-3.5 w-3.5"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
              <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
              <line x1="1" y1="1" x2="23" y2="23" />
            </svg>
            <span>{{ showPin ? 'Sembunyikan' : 'Lihat PIN' }}</span>
          </button>
        </div>

        <!-- 6-Digit Visual PIN Slots + Accessible Native Input -->
        <div class="space-y-2">
          <div class="flex items-center justify-between text-xs">
            <label for="cashier-pin-input" class="font-semibold text-ink-secondary">
              PIN 6 Digit
            </label>
            <span
              class="font-mono text-[11px] font-semibold"
              :class="isComplete ? 'text-emerald-600 dark:text-emerald-400' : 'text-ink-secondary'"
            >
              {{ pin.length }}/{{ PIN_LENGTH }} digit
            </span>
          </div>

          <div class="relative" @click="focusPinInput">
            <input
              id="cashier-pin-input"
              ref="hiddenInputRef"
              data-testid="pin-input"
              :type="showPin ? 'text' : 'password'"
              inputmode="numeric"
              pattern="[0-9]*"
              maxlength="6"
              autocomplete="off"
              :value="pin"
              aria-label="PIN 6 digit"
              class="sr-only"
              @input="handleNativeInput"
              @keydown.enter.prevent="savePin"
            />

            <div class="grid grid-cols-6 gap-2 sm:gap-2.5" data-testid="pin-slots">
              <div
                v-for="(digit, index) in digits"
                :key="index"
                class="flex h-12 sm:h-13 items-center justify-center rounded-2xl border text-lg font-bold transition-all cursor-text select-none"
                :class="[
                  digit
                    ? 'border-primary/60 bg-primary/8 text-ink-primary shadow-xs dark:border-indigo-400/60 dark:bg-indigo-500/15'
                    : index === pin.length
                      ? 'border-primary ring-4 ring-primary/12 bg-card dark:border-indigo-400'
                      : 'border-zinc-200 bg-surface text-ink-secondary dark:border-slate-700/70',
                ]"
              >
                <span v-if="digit && showPin" class="font-mono text-base sm:text-lg">{{ digit }}</span>
                <span
                  v-else-if="digit"
                  class="h-3 w-3 rounded-full bg-primary dark:bg-indigo-400"
                />
                <span
                  v-else-if="index === pin.length"
                  class="h-5 w-0.5 animate-pulse rounded-full bg-primary dark:bg-indigo-400"
                />
              </div>
            </div>
          </div>

          <p
            v-if="errorMessage"
            data-testid="pin-error"
            class="text-xs font-medium text-danger"
          >
            {{ errorMessage }}
          </p>
        </div>

        <!-- Tactile Numeric Keypad -->
        <div class="grid grid-cols-3 gap-2 sm:gap-2.5" data-testid="pin-keypad">
          <button
            v-for="num in KEYPAD_NUMBERS"
            :key="num"
            type="button"
            :data-testid="`pin-key-${num}`"
            class="flex h-12 sm:h-13 items-center justify-center rounded-2xl border border-zinc-200/80 bg-surface font-mono text-lg font-bold text-ink-primary transition hover:border-primary/40 hover:bg-primary/6 active:scale-95 cursor-pointer dark:border-slate-700/60 dark:bg-[#121726] dark:hover:border-indigo-400/40"
            @click="appendDigit(num)"
          >
            {{ num }}
          </button>

          <button
            type="button"
            data-testid="pin-key-clear"
            :disabled="!pin.length"
            class="flex h-12 sm:h-13 items-center justify-center rounded-2xl border border-zinc-200/80 bg-surface text-xs font-semibold text-ink-secondary transition hover:border-rose-300 hover:text-danger active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer dark:border-slate-700/60 dark:bg-[#121726]"
            @click="clearPin"
          >
            Ulangi
          </button>

          <button
            type="button"
            data-testid="pin-key-0"
            class="flex h-12 sm:h-13 items-center justify-center rounded-2xl border border-zinc-200/80 bg-surface font-mono text-lg font-bold text-ink-primary transition hover:border-primary/40 hover:bg-primary/6 active:scale-95 cursor-pointer dark:border-slate-700/60 dark:bg-[#121726] dark:hover:border-indigo-400/40"
            @click="appendDigit('0')"
          >
            0
          </button>

          <button
            type="button"
            data-testid="pin-key-backspace"
            :disabled="!pin.length"
            aria-label="Hapus digit terakhir"
            class="flex h-12 sm:h-13 items-center justify-center rounded-2xl border border-zinc-200/80 bg-surface text-ink-secondary transition hover:border-primary/40 hover:text-ink-primary active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer dark:border-slate-700/60 dark:bg-[#121726]"
            @click="removeLastDigit"
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
              <path d="M21 4H8l-7 8 7 8h13a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2z" />
              <line x1="18" y1="9" x2="12" y2="15" />
              <line x1="12" y1="9" x2="18" y2="15" />
            </svg>
          </button>
        </div>

        <!-- Primary Save CTA -->
        <BaseButton
          size="lg"
          block
          data-testid="pin-save-btn"
          :disabled="!isComplete"
          @click="savePin"
        >
          Simpan PIN Kasir
        </BaseButton>
      </BaseCard>
    </main>
  </div>
</template>
