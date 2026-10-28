<script setup>
import { computed, onMounted, onUnmounted, ref } from 'vue'

import AppIcon from '@/components/base/AppIcon.vue'
import BaseButton from '@/components/base/BaseButton.vue'

const props = defineProps({
  registrationId: { type: String, required: true },
  email: { type: String, default: '' },
  otpExpiresAt: { type: [String, Number], default: null },
  resendAvailableAt: { type: [String, Number], default: null },
  loading: { type: Boolean, default: false },
  errorMessage: { type: String, default: '' },
})

const emit = defineEmits(['verify', 'resend', 'back', 'offline'])

const code = ref('')
const now = ref(Date.now())
let timer = null

function timestamp(value) {
  const parsed = typeof value === 'number' ? value : Date.parse(value || '')
  return Number.isFinite(parsed) ? parsed : 0
}

const expiresInSeconds = computed(() => Math.max(0, Math.ceil((timestamp(props.otpExpiresAt) - now.value) / 1000)))
const resendInSeconds = computed(() => Math.max(0, Math.ceil((timestamp(props.resendAvailableAt) - now.value) / 1000)))
const isExpired = computed(() => expiresInSeconds.value === 0)
const canResend = computed(() => resendInSeconds.value === 0 && !props.loading)

function formatCountdown(seconds) {
  const minutes = Math.floor(seconds / 60)
  const remainder = seconds % 60
  return `${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`
}

function sanitize(value) {
  return String(value ?? '').replace(/\D/g, '').slice(0, 6)
}

function handleInput(event) {
  code.value = sanitize(event.target.value)
}

function handlePaste(event) {
  const pasted = sanitize(event.clipboardData?.getData('text') ?? '')
  if (!pasted) return
  event.preventDefault()
  code.value = pasted
}

function handleSubmit() {
  if (code.value.length !== 6 || props.loading || isExpired.value) return
  emit('verify', { registrationId: props.registrationId, code: code.value })
}

function handleResend() {
  if (!canResend.value) return
  emit('resend', { registrationId: props.registrationId })
}

onMounted(() => {
  timer = window.setInterval(() => {
    now.value = Date.now()
  }, 1000)
})

onUnmounted(() => {
  if (timer) window.clearInterval(timer)
})
</script>

<template>
  <div class="w-full max-w-md space-y-5" data-testid="cloud-email-otp-view">
    <div class="space-y-1.5 text-center">
      <div class="mx-auto mb-3 flex size-12 items-center justify-center rounded-2xl bg-primary/10 text-primary shadow-soft">
        <AppIcon name="mail" class="size-6" />
      </div>
      <h2 class="text-xl font-bold tracking-tight text-ink-primary sm:text-2xl">Verifikasi Alamat Email</h2>
      <p class="text-xs leading-relaxed text-ink-secondary sm:text-sm">
        Masukkan kode 6 digit yang dikirim ke <strong class="text-ink-primary">{{ email }}</strong>.
      </p>
    </div>

    <div
      v-if="errorMessage"
      id="otp-error-banner"
      class="flex items-start gap-3 rounded-2xl border border-danger/20 bg-danger/5 p-3.5 text-xs text-danger shadow-soft"
      role="alert"
      data-testid="otp-error-banner"
    >
      <AppIcon name="alert-triangle" class="mt-0.5 size-4 shrink-0" />
      <span class="font-medium leading-relaxed">{{ errorMessage }}</span>
    </div>

    <form class="space-y-4" @submit.prevent="handleSubmit">
      <label for="cloud-otp-code" class="block text-xs font-semibold uppercase tracking-wider text-ink-secondary">
        Kode OTP
      </label>
      <input
        id="cloud-otp-code"
        :value="code"
        type="text"
        inputmode="numeric"
        autocomplete="one-time-code"
        maxlength="6"
        pattern="[0-9]{6}"
        aria-label="Kode OTP 6 digit"
        class="h-14 w-full rounded-2xl border border-zinc-200 bg-white px-4 text-center text-2xl font-bold tracking-[0.45em] text-ink-primary outline-none transition focus:border-primary focus:ring-4 focus:ring-primary/10 disabled:cursor-not-allowed disabled:bg-zinc-50 disabled:opacity-75"
        :disabled="loading"
        @input="handleInput"
        @paste="handlePaste"
      />

      <div class="grid grid-cols-2 gap-2 text-center text-xs text-ink-secondary">
        <div class="rounded-xl bg-zinc-50 px-3 py-2">
          Kode berlaku<br /><strong data-testid="otp-expiry-countdown" class="text-ink-primary">{{ formatCountdown(expiresInSeconds) }}</strong>
        </div>
        <div class="rounded-xl bg-zinc-50 px-3 py-2">
          Kirim ulang<br /><strong data-testid="otp-resend-countdown" class="text-ink-primary">{{ resendInSeconds ? formatCountdown(resendInSeconds) : 'Siap' }}</strong>
        </div>
      </div>

      <p
        v-if="isExpired"
        id="otp-expired-state"
        data-testid="otp-expired-state"
        class="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-center text-xs font-medium text-amber-800"
      >
        Kode OTP sudah kedaluwarsa. Kirim ulang kode terbaru.
      </p>

      <BaseButton
        id="otp-verify-btn"
        type="submit"
        variant="primary"
        block
        :loading="loading"
        :disabled="code.length !== 6 || loading || isExpired"
      >
        Verifikasi
      </BaseButton>
    </form>

    <button
      id="otp-resend-btn"
      type="button"
      class="w-full text-center text-xs font-semibold text-primary disabled:cursor-not-allowed disabled:text-ink-muted"
      :disabled="!canResend"
      @click="handleResend"
    >
      Kirim Ulang Kode
    </button>

    <div class="flex flex-col gap-2 pt-1 text-center">
      <button id="otp-back-btn" type="button" class="text-xs font-medium text-ink-secondary hover:text-ink-primary" :disabled="loading" @click="emit('back')">
        Kembali ke form registrasi
      </button>
      <button id="otp-offline-btn" type="button" class="text-xs font-medium text-primary hover:underline" :disabled="loading" @click="emit('offline')">
        Gunakan POS offline
      </button>
    </div>
  </div>
</template>
