<script setup>
import { ref, computed, watch } from 'vue'

import BaseButton from '@/components/base/BaseButton.vue'
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
  initialName: {
    type: String,
    default: '',
  },
})

const emit = defineEmits(['submit', 'switch-tab', 'google-click'])

const name = ref(props.initialName)
const businessName = ref('')
const email = ref(props.initialEmail)
const password = ref('')
const passwordConfirmation = ref('')

const showPassword = ref(false)
const showPasswordConfirmation = ref(false)
const showNextStepNotice = ref(false)

const touched = ref({
  name: false,
  email: false,
  businessName: false,
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
  () => props.initialName,
  (value) => {
    if (value) name.value = value
  },
)

const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const nameError = computed(() => {
  if (!touched.value.name) return ''
  if (!name.value.trim()) {
    return 'Nama lengkap wajib diisi.'
  }
  return ''
})

const emailError = computed(() => {
  if (!touched.value.email) return ''
  if (!email.value.trim()) {
    return 'Alamat email wajib diisi.'
  }
  if (!emailRegex.test(email.value.trim())) {
    return 'Format email tidak valid (contoh: nama@domain.com).'
  }
  return ''
})

const businessNameError = computed(() => {
  if (!touched.value.businessName) return ''
  if (!businessName.value.trim()) return 'Nama bisnis wajib diisi.'
  return ''
})

const passwordLengthValid = computed(() => password.value.length >= 8)

const passwordError = computed(() => {
  if (!touched.value.password) return ''
  if (!password.value) {
    return 'Password wajib diisi.'
  }
  if (!passwordLengthValid.value) {
    return 'Password minimal 8 karakter.'
  }
  return ''
})

const passwordsMatch = computed(() => {
  return (
    password.value.length > 0 &&
    passwordConfirmation.value.length > 0 &&
    password.value === passwordConfirmation.value
  )
})

const passwordConfirmationError = computed(() => {
  if (!touched.value.passwordConfirmation) return ''
  if (!passwordConfirmation.value) {
    return 'Konfirmasi password wajib diisi.'
  }
  if (password.value !== passwordConfirmation.value) {
    return 'Konfirmasi password tidak cocok.'
  }
  return ''
})

const isFormValid = computed(() => {
  return (
    name.value.trim().length > 0 &&
    businessName.value.trim().length > 0 &&
    email.value.trim().length > 0 &&
    emailRegex.test(email.value.trim()) &&
    passwordLengthValid.value &&
    passwordsMatch.value
  )
})

function handleBlur(field) {
  touched.value[field] = true
}

function handleSubmit() {
  touched.value.name = true
  touched.value.businessName = true
  touched.value.email = true
  touched.value.password = true
  touched.value.passwordConfirmation = true

  if (!isFormValid.value || props.loading || props.disabled) {
    return
  }

  showNextStepNotice.value = true

  emit('submit', {
    name: name.value.trim(),
    businessName: businessName.value.trim(),
    email: email.value.trim(),
    password: password.value,
    passwordConfirmation: passwordConfirmation.value,
  })
}

function handleGoogleClick() {
  emit('google-click')
}

function handleSwitchToLogin() {
  emit('switch-tab', 'login')
}
</script>

<template>
  <div class="space-y-5" data-testid="cloud-register-form">
    <!-- Header -->
    <div class="space-y-1.5 text-center">
      <div class="mx-auto mb-3 flex size-12 items-center justify-center rounded-2xl bg-primary/10 text-primary shadow-soft">
        <AppIcon name="user" class="size-6" />
      </div>
      <h2 class="text-xl font-bold tracking-tight text-ink-primary sm:text-2xl">
        Buat Akun Cloud
      </h2>
      <p class="text-xs leading-relaxed text-ink-secondary sm:text-sm">
        Mulai kelola bisnis Anda dengan lebih mudah.
      </p>
    </div>

    <!-- Step Indicator Pill -->
    <div
      class="flex items-center justify-between rounded-xl border border-zinc-200/80 bg-zinc-50/80 px-3.5 py-2 text-xs text-ink-secondary"
      data-testid="register-step-pill"
    >
      <div class="flex items-center gap-2">
        <span class="flex size-5 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-white">
          1
        </span>
        <span class="font-medium text-ink-primary">Informasi Akun</span>
      </div>
      <span class="text-[11px] text-ink-muted">Langkah 1 dari 2</span>
    </div>

    <!-- Error Alert Banner -->
    <div
      v-if="errorMessage"
      id="register-error-banner"
      role="alert"
      data-testid="register-error-banner"
      class="flex items-start gap-3 rounded-2xl border border-danger/20 bg-danger/5 p-3.5 text-xs text-danger shadow-soft"
    >
      <div class="mt-0.5 shrink-0">
        <AppIcon name="lock" class="size-4" />
      </div>
      <div class="min-w-0 flex-1 leading-relaxed font-medium">
        {{ errorMessage }}
      </div>
    </div>

    <!-- Next Step Info Notice (Preview) -->
    <div
      v-if="showNextStepNotice"
      id="register-next-step-notice"
      data-testid="register-next-step-notice"
      class="flex items-start gap-3 rounded-2xl border border-primary/20 bg-primary/5 p-3.5 text-xs text-primary shadow-soft"
    >
      <div class="mt-0.5 shrink-0">
        <AppIcon name="mail" class="size-4" />
      </div>
      <div class="min-w-0 flex-1 space-y-1">
        <p class="font-semibold text-primary">
          Tahap selanjutnya: Verifikasi Email
        </p>
        <p class="text-ink-secondary text-[11px] leading-relaxed">
          Kode OTP 6 digit akan dikirimkan ke <strong class="text-ink-primary">{{ email }}</strong> untuk memverifikasi akun Anda (akan diimplementasikan pada AUTH-M03).
        </p>
      </div>
    </div>

    <!-- Form -->
    <form class="space-y-4" @submit.prevent="handleSubmit">
      <!-- Full Name Field -->
      <div class="space-y-1.5">
        <label for="register-name" class="block text-xs font-semibold uppercase tracking-wider text-ink-secondary">
          Nama Lengkap <span class="text-danger">*</span>
        </label>
        <div id="cloud-register-name" class="relative">
          <input
            id="register-name"
            v-model="name"
            type="text"
            autocomplete="name"
            placeholder="Contoh: Budi Santoso"
            :disabled="loading || disabled"
            :class="[
              'h-12 w-full rounded-2xl border bg-white px-4 text-sm text-ink-primary outline-none transition placeholder:text-zinc-400 focus:ring-4 disabled:cursor-not-allowed disabled:bg-zinc-50 disabled:opacity-75',
              nameError
                ? 'border-danger focus:border-danger focus:ring-danger/10'
                : 'border-zinc-200 focus:border-primary focus:ring-primary/10',
            ]"
            @blur="handleBlur('name')"
          />
        </div>
        <p v-if="nameError" data-testid="register-name-error" class="text-xs font-medium text-danger">
          {{ nameError }}
        </p>
      </div>

      <!-- Business Name Field (required by the v2 contract) -->
      <div class="space-y-1.5">
        <label for="register-business" class="block text-xs font-semibold uppercase tracking-wider text-ink-secondary">
          Nama Bisnis <span class="text-danger">*</span>
        </label>
        <div id="cloud-register-business" class="relative">
          <input
            id="register-business"
            v-model="businessName"
            type="text"
            autocomplete="organization"
            placeholder="Contoh: Toko Berkah Jaya"
            :disabled="loading || disabled"
            :class="[
              'h-12 w-full rounded-2xl border bg-white px-4 text-sm text-ink-primary outline-none transition placeholder:text-zinc-400 focus:ring-4 disabled:cursor-not-allowed disabled:bg-zinc-50 disabled:opacity-75',
              businessNameError
                ? 'border-danger focus:border-danger focus:ring-danger/10'
                : 'border-zinc-200 focus:border-primary focus:ring-primary/10',
            ]"
            @blur="handleBlur('businessName')"
          />
        </div>
        <p v-if="businessNameError" data-testid="register-business-error" class="text-xs font-medium text-danger">
          {{ businessNameError }}
        </p>
      </div>

      <!-- Email Field -->
      <div class="space-y-1.5">
        <label for="register-email" class="block text-xs font-semibold uppercase tracking-wider text-ink-secondary">
          Alamat Email <span class="text-danger">*</span>
        </label>
        <div id="cloud-register-email" class="relative">
          <input
            id="register-email"
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
            @blur="handleBlur('email')"
          />
        </div>
        <p v-if="emailError" data-testid="register-email-error" class="text-xs font-medium text-danger">
          {{ emailError }}
        </p>
      </div>

      <!-- Password Field -->
      <div class="space-y-1.5">
        <label for="register-password" class="block text-xs font-semibold uppercase tracking-wider text-ink-secondary">
          Password <span class="text-danger">*</span>
        </label>
        <div id="cloud-register-password" class="relative">
          <input
            id="register-password"
            v-model="password"
            :type="showPassword ? 'text' : 'password'"
            autocomplete="new-password"
            placeholder="Minimal 8 karakter"
            :disabled="loading || disabled"
            :class="[
              'h-12 w-full rounded-2xl border bg-white pl-4 pr-12 text-sm text-ink-primary outline-none transition placeholder:text-zinc-400 focus:ring-4 disabled:cursor-not-allowed disabled:bg-zinc-50 disabled:opacity-75',
              passwordError
                ? 'border-danger focus:border-danger focus:ring-danger/10'
                : 'border-zinc-200 focus:border-primary focus:ring-primary/10',
            ]"
            @blur="handleBlur('password')"
          />
          <button
            type="button"
            class="absolute inset-y-0 right-0 flex items-center px-4 text-zinc-400 transition hover:text-ink-primary"
            :aria-label="showPassword ? 'Sembunyikan password' : 'Lihat password'"
            data-testid="toggle-register-password-visibility"
            @click="showPassword = !showPassword"
          >
            <AppIcon :name="showPassword ? 'eye-off' : 'eye'" class="size-5" />
          </button>
        </div>
        <p v-if="passwordError" data-testid="register-password-error" class="text-xs font-medium text-danger">
          {{ passwordError }}
        </p>
      </div>

      <!-- Password Confirmation Field -->
      <div class="space-y-1.5">
        <label for="register-password-confirmation" class="block text-xs font-semibold uppercase tracking-wider text-ink-secondary">
          Konfirmasi Password <span class="text-danger">*</span>
        </label>
        <div id="cloud-register-password-confirmation" class="relative">
          <input
            id="register-password-confirmation"
            v-model="passwordConfirmation"
            :type="showPasswordConfirmation ? 'text' : 'password'"
            autocomplete="new-password"
            placeholder="Ulangi password di atas"
            :disabled="loading || disabled"
            :class="[
              'h-12 w-full rounded-2xl border bg-white pl-4 pr-12 text-sm text-ink-primary outline-none transition placeholder:text-zinc-400 focus:ring-4 disabled:cursor-not-allowed disabled:bg-zinc-50 disabled:opacity-75',
              passwordConfirmationError
                ? 'border-danger focus:border-danger focus:ring-danger/10'
                : 'border-zinc-200 focus:border-primary focus:ring-primary/10',
            ]"
            @blur="handleBlur('passwordConfirmation')"
          />
          <button
            type="button"
            class="absolute inset-y-0 right-0 flex items-center px-4 text-zinc-400 transition hover:text-ink-primary"
            :aria-label="showPasswordConfirmation ? 'Sembunyikan konfirmasi password' : 'Lihat konfirmasi password'"
            data-testid="toggle-register-password-confirmation-visibility"
            @click="showPasswordConfirmation = !showPasswordConfirmation"
          >
            <AppIcon :name="showPasswordConfirmation ? 'eye-off' : 'eye'" class="size-5" />
          </button>
        </div>
        <p v-if="passwordConfirmationError" data-testid="register-password-confirmation-error" class="text-xs font-medium text-danger">
          {{ passwordConfirmationError }}
        </p>
      </div>

      <!-- Password Requirements Checklist -->
      <div class="rounded-xl border border-zinc-100 bg-zinc-50/60 p-3 space-y-1.5 text-xs">
        <div class="flex items-center gap-2">
          <span
            :class="[
              'flex size-4 items-center justify-center rounded-full text-[10px]',
              passwordLengthValid ? 'bg-emerald-500 text-white' : 'bg-zinc-200 text-zinc-500',
            ]"
          >
            <AppIcon :name="passwordLengthValid ? 'check' : 'x'" class="size-3" />
          </span>
          <span :class="passwordLengthValid ? 'font-medium text-emerald-700' : 'text-ink-muted'">
            Minimal 8 karakter
          </span>
        </div>
        <div class="flex items-center gap-2">
          <span
            :class="[
              'flex size-4 items-center justify-center rounded-full text-[10px]',
              passwordsMatch ? 'bg-emerald-500 text-white' : 'bg-zinc-200 text-zinc-500',
            ]"
          >
            <AppIcon :name="passwordsMatch ? 'check' : 'x'" class="size-3" />
          </span>
          <span :class="passwordsMatch ? 'font-medium text-emerald-700' : 'text-ink-muted'">
            Konfirmasi password cocok
          </span>
        </div>
      </div>

      <!-- Submit Button -->
      <BaseButton
        id="cloud-register-submit-btn"
        type="submit"
        variant="primary"
        size="lg"
        block
        :loading="loading"
        :disabled="loading || disabled || !isFormValid"
        @click.prevent="handleSubmit"
        data-testid="register-submit-button"
        class="h-12 rounded-2xl text-sm font-semibold shadow-soft active:scale-[0.99]"
      >
        Daftar Sekarang
      </BaseButton>
    </form>

    <!-- Divider -->
    <CloudAuthDivider label="atau daftar dengan" />

    <!-- Google Button -->
    <CloudGoogleButton
      :disabled="loading || disabled"
      data-testid="register-google-button"
      @click="handleGoogleClick"
    />

    <!-- Switch to Login Link -->
    <div class="pt-2 text-center text-xs text-ink-secondary">
      Sudah punya akun?
      <button
        type="button"
        class="ml-1 font-semibold text-primary transition hover:text-primary-hover hover:underline"
        data-testid="switch-to-login-link"
        @click="handleSwitchToLogin"
      >
        Masuk
      </button>
    </div>
  </div>
</template>
