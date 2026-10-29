<script setup>
import { ref, computed, watch } from 'vue'

import BaseButton from '@/components/base/BaseButton.vue'
import AppIcon from '@/components/base/AppIcon.vue'

const props = defineProps({
  loading: {
    type: Boolean,
    default: false,
  },
  disabled: {
    type: Boolean,
    default: false,
  },
  initialEmail: {
    type: String,
    default: '',
  },
  successMessage: {
    type: String,
    default: '',
  },
  errorMessage: {
    type: String,
    default: '',
  },
})

const emit = defineEmits(['submit', 'back-to-login', 'go-to-reset', 'offline'])

const email = ref(props.initialEmail)
const touched = ref({
  email: false,
})

watch(
  () => props.initialEmail,
  (value) => {
    if (value) email.value = value
  },
)

const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const emailError = computed(() => {
  if (!touched.value.email || !email.value) return ''
  if (!emailRegex.test(email.value.trim())) {
    return 'Format email tidak valid (contoh: nama@domain.com).'
  }
  return ''
})

const isFormValid = computed(() => {
  return (
    email.value.trim().length > 0 &&
    emailRegex.test(email.value.trim())
  )
})

function handleEmailBlur() {
  touched.value.email = true
}

function handleSubmit() {
  touched.value.email = true

  if (!isFormValid.value || props.loading || props.disabled) {
    return
  }

  emit('submit', {
    email: email.value.trim(),
  })
}

function handleBackToLogin() {
  emit('back-to-login')
}

function handleGoToReset() {
  emit('go-to-reset')
}

function handleOfflinePos() {
  emit('offline')
}
</script>

<template>
  <div class="space-y-5" data-testid="forgot-password-form">
    <!-- Header -->
    <div class="space-y-1.5 text-center">
      <div class="mx-auto mb-3 flex size-12 items-center justify-center rounded-2xl bg-primary/10 text-primary shadow-soft">
        <AppIcon name="cloud" class="size-6" />
      </div>
      <h2 class="text-xl font-bold tracking-tight text-ink-primary sm:text-2xl">
        Pemulihan Password
      </h2>
      <p class="text-xs leading-relaxed text-ink-secondary sm:text-sm">
        Masukkan alamat email yang terdaftar untuk menerima instruksi pemulihan.
      </p>
    </div>

    <!-- Error Alert Banner -->
    <div
      v-if="errorMessage"
      role="alert"
      data-testid="forgot-error-banner"
      class="flex items-start gap-3 rounded-2xl border border-danger/20 bg-danger/5 p-3.5 text-xs text-danger shadow-soft"
    >
      <div class="mt-0.5 shrink-0">
        <AppIcon name="lock" class="size-4" />
      </div>
      <div class="min-w-0 flex-1 leading-relaxed font-medium">
        {{ errorMessage }}
      </div>
    </div>

    <!-- Success State -->
    <template v-if="successMessage">
      <!-- Success Banner -->
      <div
        role="status"
        data-testid="forgot-success-message"
        class="flex items-start gap-3 rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-3.5 text-xs text-emerald-700 shadow-soft"
      >
        <div class="mt-0.5 shrink-0">
          <AppIcon name="shield" class="size-4" />
        </div>
        <div class="min-w-0 flex-1 leading-relaxed font-medium">
          {{ successMessage }}
        </div>
      </div>

      <!-- Reset Instructions Info Box -->
      <div class="rounded-2xl border border-primary/20 bg-primary/5 p-3.5 text-xs text-ink-primary">
        <p class="font-semibold text-primary">Langkah selanjutnya:</p>
        <ol class="mt-1.5 list-decimal space-y-1 pl-4">
          <li>Periksa kotak masuk dan folder spam email Anda.</li>
          <li>Buka tautan reset dari email yang diterima.</li>
          <li>Buat password baru melalui halaman reset.</li>
          <li>Kembali ke aplikasi dan masuk dengan password baru.</li>
        </ol>
      </div>

      <!-- Action Buttons -->
      <div class="space-y-3">
        <BaseButton
          data-testid="forgot-go-to-reset"
          variant="secondary"
          size="sm"
          block
          @click="handleGoToReset"
        >
          Saya Sudah Punya Token Reset
        </BaseButton>

        <BaseButton
          data-testid="forgot-back-to-login"
          variant="secondary"
          block
          @click="handleBackToLogin"
        >
          Kembali ke Login
        </BaseButton>

        <p
          data-testid="forgot-google-guidance"
          class="text-center text-xs leading-relaxed text-ink-secondary"
        >
          Jika Anda menggunakan Google untuk masuk, gunakan tombol Google di halaman login.
        </p>
      </div>
    </template>

    <!-- Form State -->
    <template v-else>
      <form class="space-y-4" @submit.prevent="handleSubmit">
        <!-- Email Field -->
        <div class="space-y-1.5">
          <label for="forgot-email" class="block text-xs font-semibold uppercase tracking-wider text-ink-secondary">
            Alamat Email
          </label>
          <div class="relative">
            <input
              id="forgot-email"
              v-model="email"
              type="email"
              inputmode="email"
              autocomplete="email"
              placeholder="nama@domain.com"
              data-testid="forgot-email-input"
              :disabled="loading || disabled"
              :class="[
                'h-12 w-full rounded-2xl border bg-white px-4 text-sm text-ink-primary outline-none transition placeholder:text-zinc-400 focus:ring-4 disabled:cursor-not-allowed disabled:bg-zinc-50 disabled:opacity-75',
                emailError
                  ? 'border-danger focus:border-danger focus:ring-danger/10'
                  : 'border-zinc-200 focus:border-primary focus:ring-primary/10',
              ]"
              @blur="handleEmailBlur"
            />
          </div>
          <p v-if="emailError" data-testid="forgot-email-error" class="text-xs font-medium text-danger">
            {{ emailError }}
          </p>
        </div>

        <!-- Submit Button -->
        <BaseButton
          data-testid="forgot-submit-btn"
          type="submit"
          variant="primary"
          block
          :disabled="loading || disabled"
          @click.prevent="handleSubmit"
        >
          <span v-if="loading" class="inline-flex items-center gap-2">
            <svg class="size-4 animate-spin" viewBox="0 0 24 24" fill="none">
              <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
              <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
            </svg>
            <span>Memproses...</span>
          </span>
          <span v-else>Kirim Instruksi Pemulihan</span>
        </BaseButton>
      </form>

      <!-- Footer -->
      <div class="space-y-3 pt-2 text-center">
        <div>
          <button
            type="button"
            data-testid="forgot-go-to-reset"
            class="text-xs font-medium text-ink-secondary underline-offset-2 hover:text-ink-primary hover:underline cursor-pointer"
            @click="handleGoToReset"
          >
            Saya Sudah Punya Token Reset
          </button>
        </div>
        <div>
          <button
            type="button"
            data-testid="forgot-back-to-login"
            class="font-semibold text-primary underline-offset-2 hover:underline text-xs cursor-pointer"
            @click="handleBackToLogin"
          >
            Kembali ke Login
          </button>
        </div>
        <div>
          <button
            type="button"
            data-testid="forgot-offline-pos"
            class="text-xs font-medium text-ink-secondary underline-offset-2 hover:text-ink-primary hover:underline cursor-pointer"
            @click="handleOfflinePos"
          >
            Gunakan POS Offline
          </button>
        </div>
        <p
          data-testid="forgot-google-guidance"
          class="text-xs leading-relaxed text-ink-secondary"
        >
          Jika Anda menggunakan Google untuk masuk, gunakan tombol Google di halaman login.
        </p>
      </div>
    </template>
  </div>
</template>
