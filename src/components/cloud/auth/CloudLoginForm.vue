<script setup>
import { ref, computed, watch } from 'vue'

import BaseButton from '@/components/base/BaseButton.vue'
import BaseModal from '@/components/base/BaseModal.vue'
import AppIcon from '@/components/base/AppIcon.vue'
import CloudGoogleButton from './CloudGoogleButton.vue'
import CloudAuthDivider from './CloudAuthDivider.vue'

const props = defineProps({
  loading: {
    type: Boolean,
    default: false,
  },
  errorMessage: {
    type: String,
    default: '',
  },
  disabled: {
    type: Boolean,
    default: false,
  },
  initialEmail: {
    type: String,
    default: '',
  },
})

const emit = defineEmits(['submit', 'switch-tab', 'google-click', 'forgot-password'])

const email = ref(props.initialEmail)
const password = ref('')
const showPassword = ref(false)
const showForgotPasswordModal = ref(false)
const touched = ref({
  email: false,
  password: false,
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
    emailRegex.test(email.value.trim()) &&
    password.value.length > 0
  )
})

function handleEmailBlur() {
  touched.value.email = true
}

function handlePasswordBlur() {
  touched.value.password = true
}

function handleSubmit() {
  touched.value.email = true
  touched.value.password = true

  if (!isFormValid.value || props.loading || props.disabled) {
    return
  }

  emit('submit', {
    email: email.value.trim(),
    password: password.value,
  })
}

function handleGoogleClick() {
  emit('google-click')
}

function handleForgotPasswordClick() {
  showForgotPasswordModal.value = true
  emit('forgot-password')
}

function handleSwitchToRegister() {
  emit('switch-tab', 'register')
}
</script>

<template>
  <div class="space-y-5" data-testid="cloud-login-form">
    <!-- Header -->
    <div class="space-y-1.5 text-center">
      <div class="mx-auto mb-3 flex size-12 items-center justify-center rounded-2xl bg-primary/10 text-primary shadow-soft">
        <AppIcon name="cloud" class="size-6" />
      </div>
      <h2 class="text-xl font-bold tracking-tight text-ink-primary sm:text-2xl">
        Masuk ke Akun Cloud
      </h2>
      <p class="text-xs leading-relaxed text-ink-secondary sm:text-sm">
        Kelola bisnis Anda dengan aman, kapan saja.
      </p>
    </div>

    <!-- Error Alert Banner -->
    <div
      v-if="errorMessage"
      id="cloud-login-error"
      role="alert"
      data-testid="login-error-banner"
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
    <form class="space-y-4" @submit.prevent="handleSubmit">
      <!-- Email Field -->
      <div class="space-y-1.5">
        <label for="login-email" class="block text-xs font-semibold uppercase tracking-wider text-ink-secondary">
          Alamat Email
        </label>
        <div id="cloud-email" class="relative">
          <input
            id="login-email"
            v-model="email"
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
        <p v-if="emailError" data-testid="login-email-error" class="text-xs font-medium text-danger">
          {{ emailError }}
        </p>
      </div>

      <!-- Password Field -->
      <div class="space-y-1.5">
        <div class="flex items-center justify-between">
          <label for="login-password" class="block text-xs font-semibold uppercase tracking-wider text-ink-secondary">
            Password
          </label>
          <button
            id="login-forgot-password-link"
            type="button"
            data-testid="forgot-password-link"
            class="text-xs font-medium text-primary underline-offset-2 hover:underline"
            @click="handleForgotPasswordClick"
          >
            Lupa Password?
          </button>
        </div>

        <div id="cloud-password" class="relative">
          <input
            id="login-password"
            v-model="password"
            :type="showPassword ? 'text' : 'password'"
            autocomplete="current-password"
            placeholder="••••••••"
            :disabled="loading || disabled"
            class="h-12 w-full rounded-2xl border border-zinc-200 bg-white px-4 pr-11 text-sm text-ink-primary outline-none transition placeholder:text-zinc-400 focus:border-primary focus:ring-4 focus:ring-primary/10 disabled:cursor-not-allowed disabled:bg-zinc-50 disabled:opacity-75"
            @blur="handlePasswordBlur"
          />

          <!-- Password Visibility Toggle -->
          <button
            id="login-toggle-password-btn"
            type="button"
            data-testid="toggle-login-password-visibility"
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
      </div>

      <!-- Submit Button -->
      <BaseButton
        id="cloud-login-btn"
        data-testid="login-submit-button"
        type="submit"
        variant="primary"
        block
        :disabled="!isFormValid || loading || disabled"
        @click.prevent="handleSubmit"
      >
        <span v-if="loading" class="inline-flex items-center gap-2">
          <svg class="size-4 animate-spin" viewBox="0 0 24 24" fill="none">
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
          </svg>
          <span>Memproses...</span>
        </span>
        <span v-else>Masuk</span>
      </BaseButton>
    </form>

    <!-- Divider -->
    <CloudAuthDivider text="atau lanjutkan dengan" />

    <!-- Google Sign-In Button -->
    <CloudGoogleButton
      :loading="loading"
      :disabled="disabled"
      @click="handleGoogleClick"
    />

    <!-- Switch to Register Link -->
    <div class="pt-2 text-center">
      <p class="text-xs text-ink-secondary">
        Belum punya akun Cloud?
        <button
          id="login-switch-register-btn"
          type="button"
          data-testid="switch-to-register-link"
          class="font-semibold text-primary underline-offset-2 hover:underline ml-1 cursor-pointer"
          @click="handleSwitchToRegister"
        >
          Daftar Sekarang
        </button>
      </p>
    </div>

    <!-- Forgot Password Modal -->
    <BaseModal
      :open="showForgotPasswordModal"
      title="Lupa Password Cloud"
      @close="showForgotPasswordModal = false"
    >
      <div class="space-y-4 text-xs leading-relaxed text-ink-secondary sm:text-sm" data-testid="forgot-password-modal">
        <p>
          Untuk alasan keamanan akun, pemulihan dan reset password akun Cloud dilakukan secara terverifikasi melalui Dashboard Web.
        </p>
        <div class="rounded-2xl border border-primary/20 bg-primary/5 p-3.5 text-xs text-ink-primary">
          <p class="font-semibold text-primary">Langkah Reset Password:</p>
          <ol class="mt-1.5 list-decimal space-y-1 pl-4">
            <li>Buka browser dan kunjungi <strong>pos.eradig.my.id/forgot-password</strong>.</li>
            <li>Masukkan alamat email yang terdaftar.</li>
            <li>Buka link konfirmasi yang dikirimkan ke email Anda untuk membuat password baru.</li>
          </ol>
        </div>
        <div class="flex justify-end pt-2">
          <BaseButton
            id="close-forgot-password-modal-btn"
            variant="secondary"
            size="sm"
            @click="showForgotPasswordModal = false"
          >
            Mengerti
          </BaseButton>
        </div>
      </div>
    </BaseModal>
  </div>
</template>
