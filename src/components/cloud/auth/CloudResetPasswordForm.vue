<script setup>
import { ref, computed, watch, onUnmounted } from 'vue'

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
  errorMessage: {
    type: String,
    default: '',
  },
  successMessage: {
    type: String,
    default: '',
  },
})

const emit = defineEmits(['submit', 'back-to-login', 'back-to-forgot'])

const email = ref(props.initialEmail)
const token = ref('')
const password = ref('')
const passwordConfirmation = ref('')
const showPassword = ref(false)
const showConfirmation = ref(false)
const touched = ref({
  email: false,
  token: false,
  password: false,
  passwordConfirmation: false,
})

watch(
  () => props.initialEmail,
  (value) => {
    if (value) email.value = value
  },
)

watch(
  () => props.successMessage,
  (value) => {
    if (value) {
      token.value = ''
      password.value = ''
      passwordConfirmation.value = ''
    }
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

const tokenError = computed(() => {
  if (!touched.value.token) return ''
  if (!token.value.trim()) {
    return 'Token reset wajib diisi.'
  }
  return ''
})

const passwordError = computed(() => {
  if (!touched.value.password) return ''
  if (password.value.length < 8) {
    return 'Password minimal 8 karakter.'
  }
  return ''
})

const passwordConfirmationError = computed(() => {
  if (!touched.value.passwordConfirmation) return ''
  if (passwordConfirmation.value !== password.value) {
    return 'Konfirmasi password tidak cocok.'
  }
  return ''
})

const isFormValid = computed(() => {
  return (
    email.value.trim().length > 0 &&
    emailRegex.test(email.value.trim()) &&
    token.value.trim().length > 0 &&
    password.value.length >= 8 &&
    passwordConfirmation.value === password.value
  )
})

function handleEmailBlur() {
  touched.value.email = true
}

function handleTokenBlur() {
  touched.value.token = true
}

function handlePasswordBlur() {
  touched.value.password = true
}

function handlePasswordConfirmationBlur() {
  touched.value.passwordConfirmation = true
}

function handleSubmit() {
  touched.value.email = true
  touched.value.token = true
  touched.value.password = true
  touched.value.passwordConfirmation = true

  if (!isFormValid.value || props.loading || props.disabled) {
    return
  }

  emit('submit', {
    email: email.value.trim(),
    token: token.value.trim(),
    password: password.value,
    password_confirmation: passwordConfirmation.value,
  })
}

function handleBackToLogin() {
  emit('back-to-login')
}

function handleBackToForgot() {
  emit('back-to-forgot')
}

onUnmounted(() => {
  email.value = ''
  token.value = ''
  password.value = ''
  passwordConfirmation.value = ''
})
</script>

<template>
  <div class="space-y-5" data-testid="reset-password-form">
    <!-- Header -->
    <div class="space-y-1.5 text-center">
      <div class="mx-auto mb-3 flex size-12 items-center justify-center rounded-2xl bg-primary/10 text-primary shadow-soft">
        <AppIcon name="lock" class="size-6" />
      </div>
      <h2 class="text-xl font-bold tracking-tight text-ink-primary sm:text-2xl">
        Reset Password
      </h2>
      <p class="text-xs leading-relaxed text-ink-secondary sm:text-sm">
        Masukkan token dari email dan buat password baru.
      </p>
    </div>

    <!-- Success Banner -->
    <div
      v-if="successMessage"
      data-testid="reset-success-message"
      role="status"
      class="flex items-start gap-3 rounded-2xl border border-green-500/20 bg-green-500/5 p-3.5 text-xs text-green-700 shadow-soft"
    >
      <div class="mt-0.5 shrink-0">
        <svg xmlns="http://www.w3.org/2000/svg" class="size-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.8">
          <path stroke-linecap="round" stroke-linejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
        </svg>
      </div>
      <div class="min-w-0 flex-1 leading-relaxed font-medium">
        {{ successMessage }}
      </div>
    </div>

    <!-- Success Action -->
    <div v-if="successMessage" class="space-y-4">
      <BaseButton
        data-testid="reset-back-to-login"
        type="button"
        variant="primary"
        block
        @click="handleBackToLogin"
      >
        Masuk dengan Password Baru
      </BaseButton>
    </div>

    <!-- Error Alert Banner -->
    <div
      v-if="errorMessage && !successMessage"
      role="alert"
      data-testid="reset-error-banner"
      class="flex items-start gap-3 rounded-2xl border border-danger/20 bg-danger/5 p-3.5 text-xs text-danger shadow-soft"
    >
      <div class="mt-0.5 shrink-0">
        <AppIcon name="lock" class="size-4" />
      </div>
      <div class="min-w-0 flex-1 leading-relaxed font-medium">
        {{ errorMessage }}
      </div>
    </div>

    <!-- Form -->
    <form v-if="!successMessage" class="space-y-4" @submit.prevent="handleSubmit">
      <!-- Email Field -->
      <div class="space-y-1.5">
        <label for="reset-email" class="block text-xs font-semibold uppercase tracking-wider text-ink-secondary">
          Alamat Email
        </label>
        <div class="relative">
          <input
            id="reset-email"
            v-model="email"
            data-testid="reset-email-input"
            type="email"
            inputmode="email"
            autocomplete="email"
            placeholder="nama@domain.com"
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
        <p v-if="emailError" data-testid="reset-email-error" class="text-xs font-medium text-danger">
          {{ emailError }}
        </p>
      </div>

      <!-- Token Field -->
      <div class="space-y-1.5">
        <label for="reset-token" class="block text-xs font-semibold uppercase tracking-wider text-ink-secondary">
          Token Reset
        </label>
        <div class="relative">
          <input
            id="reset-token"
            v-model="token"
            data-testid="reset-token-input"
            type="text"
            autocomplete="off"
            placeholder="Paste token dari email..."
            :disabled="loading || disabled"
            :class="[
              'h-12 w-full rounded-2xl border bg-white px-4 font-mono text-sm text-ink-primary outline-none transition placeholder:font-sans placeholder:text-zinc-400 focus:ring-4 disabled:cursor-not-allowed disabled:bg-zinc-50 disabled:opacity-75',
              tokenError
                ? 'border-danger focus:border-danger focus:ring-danger/10'
                : 'border-zinc-200 focus:border-primary focus:ring-primary/10',
            ]"
            @blur="handleTokenBlur"
          />
        </div>
        <p v-if="tokenError" data-testid="reset-token-error" class="text-xs font-medium text-danger">
          {{ tokenError }}
        </p>
      </div>

      <!-- Password Field -->
      <div class="space-y-1.5">
        <label for="reset-password" class="block text-xs font-semibold uppercase tracking-wider text-ink-secondary">
          Password Baru
        </label>
        <div class="relative">
          <input
            id="reset-password"
            v-model="password"
            data-testid="reset-password-input"
            :type="showPassword ? 'text' : 'password'"
            autocomplete="new-password"
            placeholder="Minimal 8 karakter"
            :disabled="loading || disabled"
            :class="[
              'h-12 w-full rounded-2xl border bg-white px-4 pr-11 text-sm text-ink-primary outline-none transition placeholder:text-zinc-400 focus:ring-4 disabled:cursor-not-allowed disabled:bg-zinc-50 disabled:opacity-75',
              passwordError
                ? 'border-danger focus:border-danger focus:ring-danger/10'
                : 'border-zinc-200 focus:border-primary focus:ring-primary/10',
            ]"
            @blur="handlePasswordBlur"
          />

          <!-- Password Visibility Toggle -->
          <button
            type="button"
            :aria-label="showPassword ? 'Sembunyikan password' : 'Lihat password'"
            class="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-ink-secondary/70 hover:text-ink-primary"
            @click="showPassword = !showPassword"
          >
            <svg
              v-if="!showPassword"
              xmlns="http://www.w3.org/2000/svg"
              class="size-5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              stroke-width="1.8"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                d="M2.036 12.322a1.012 1.012 0 0 1 0-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178Z"
              />
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z"
              />
            </svg>
            <svg
              v-else
              xmlns="http://www.w3.org/2000/svg"
              class="size-5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              stroke-width="1.8"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                d="M3.98 8.223A10.477 10.477 0 0 0 1.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.451 10.451 0 0 1 12 4.5c4.756 0 8.773 3.162 10.065 7.498a10.522 10.522 0 0 1-4.293 5.774M6.228 6.228 3 3m3.228 3.228 3.65 3.65m7.894 7.894L21 21m-3.228-3.228-3.65-3.65m0 0a3 3 0 1 0-4.243-4.243m4.242 4.242L9.88 9.88"
              />
            </svg>
          </button>
        </div>
        <p v-if="passwordError" data-testid="reset-password-error" class="text-xs font-medium text-danger">
          {{ passwordError }}
        </p>
      </div>

      <!-- Password Confirmation Field -->
      <div class="space-y-1.5">
        <label for="reset-password-confirm" class="block text-xs font-semibold uppercase tracking-wider text-ink-secondary">
          Konfirmasi Password Baru
        </label>
        <div class="relative">
          <input
            id="reset-password-confirm"
            v-model="passwordConfirmation"
            data-testid="reset-password-confirm-input"
            :type="showConfirmation ? 'text' : 'password'"
            autocomplete="new-password"
            placeholder="Ulangi password baru"
            :disabled="loading || disabled"
            :class="[
              'h-12 w-full rounded-2xl border bg-white px-4 pr-11 text-sm text-ink-primary outline-none transition placeholder:text-zinc-400 focus:ring-4 disabled:cursor-not-allowed disabled:bg-zinc-50 disabled:opacity-75',
              passwordConfirmationError
                ? 'border-danger focus:border-danger focus:ring-danger/10'
                : 'border-zinc-200 focus:border-primary focus:ring-primary/10',
            ]"
            @blur="handlePasswordConfirmationBlur"
          />

          <!-- Confirmation Visibility Toggle -->
          <button
            type="button"
            :aria-label="showConfirmation ? 'Sembunyikan password' : 'Lihat password'"
            class="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-ink-secondary/70 hover:text-ink-primary"
            @click="showConfirmation = !showConfirmation"
          >
            <svg
              v-if="!showConfirmation"
              xmlns="http://www.w3.org/2000/svg"
              class="size-5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              stroke-width="1.8"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                d="M2.036 12.322a1.012 1.012 0 0 1 0-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178Z"
              />
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z"
              />
            </svg>
            <svg
              v-else
              xmlns="http://www.w3.org/2000/svg"
              class="size-5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              stroke-width="1.8"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                d="M3.98 8.223A10.477 10.477 0 0 0 1.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.451 10.451 0 0 1 12 4.5c4.756 0 8.773 3.162 10.065 7.498a10.522 10.522 0 0 1-4.293 5.774M6.228 6.228 3 3m3.228 3.228 3.65 3.65m7.894 7.894L21 21m-3.228-3.228-3.65-3.65m0 0a3 3 0 1 0-4.243-4.243m4.242 4.242L9.88 9.88"
              />
            </svg>
          </button>
        </div>
        <p v-if="passwordConfirmationError" data-testid="reset-password-confirm-error" class="text-xs font-medium text-danger">
          {{ passwordConfirmationError }}
        </p>
      </div>

      <!-- Submit Button -->
      <BaseButton
        data-testid="reset-submit-btn"
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
        <span v-else>Reset Password</span>
      </BaseButton>
    </form>

    <!-- Footer Links -->
    <div v-if="!successMessage" class="space-y-2 pt-2 text-center">
      <p class="text-xs text-ink-secondary">
        <button
          type="button"
          data-testid="reset-back-to-forgot"
          class="font-semibold text-primary underline-offset-2 hover:underline cursor-pointer"
          @click="handleBackToForgot"
        >
          Kembali ke Pemulihan
        </button>
      </p>
      <p class="text-xs text-ink-secondary">
        <button
          type="button"
          data-testid="reset-back-to-login"
          class="font-semibold text-primary underline-offset-2 hover:underline cursor-pointer"
          @click="handleBackToLogin"
        >
          Kembali ke Login
        </button>
      </p>
    </div>
  </div>
</template>
