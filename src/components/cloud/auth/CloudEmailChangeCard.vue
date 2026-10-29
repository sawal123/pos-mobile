<script setup>
import { computed, onUnmounted, ref, watch } from 'vue'

import BaseButton from '@/components/base/BaseButton.vue'
import BaseCard from '@/components/base/BaseCard.vue'
import {
  describeEmailChangeError,
  describeGoogleLoginError,
} from '@/services/cloud/cloudLoginErrors'
import { cancelGoogleSignIn, signInWithGoogle } from '@/services/cloud/googleNativeAuthService'
import { useCloudSessionStore } from '@/stores/cloudSessionStore'

const emit = defineEmits(['session-revoked', 'login-again'])

const cloudStore = useCloudSessionStore()

const authMethods = ref(null)
const twoFactorEnabled = ref(false)
const methodsLoading = ref(false)
const methodsError = ref('')

// 'idle' | 'form' | 'otp' | 'success' | 'uncertain'
const flowState = ref('idle')
const flowError = ref('')
const flowMessage = ref('')
const flowLoading = ref(false)

// Proof mode: 'password' | 'google'
const proofMode = ref('password')
const newEmail = ref('')
const currentPassword = ref('')
const totpCode = ref('')
const requiresTotp = ref(false)
const showPassword = ref(false)

// Pending OTP state (in-memory only)
const pendingChangeId = ref(null)
const pendingTargetEmail = ref('')
const pendingOtpExpiresAt = ref(null)
const pendingResendAvailableAt = ref(null)
const otpCode = ref('')
const otpCountdown = ref('')
const isOtpExpired = ref(false)

let componentActive = true
let accountGeneration = 0
let activeAccountId =
  cloudStore.isAuthenticated && cloudStore.user?.id != null
    ? String(cloudStore.user.id)
    : null
let flowSequence = 0
let countdownTimer = null
let isVerifyingOtp = false

const isAuthenticated = computed(() => cloudStore.isAuthenticated)
const currentServerEmail = computed(() => cloudStore.user?.email ?? '')
const hasGoogleMethod = computed(() => authMethods.value?.includes('google') === true)
const hasManualMethod = computed(() => authMethods.value?.includes('manual') === true)
const isKnownGoogleOnly = computed(
  () => authMethods.value !== null && hasGoogleMethod.value && !hasManualMethod.value,
)

const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function clearCountdown() {
  if (countdownTimer) {
    clearInterval(countdownTimer)
    countdownTimer = null
  }
}

function updateCountdown() {
  if (!pendingOtpExpiresAt.value) {
    otpCountdown.value = ''
    isOtpExpired.value = false
    return
  }
  const expiresMs = Date.parse(pendingOtpExpiresAt.value)
  if (!Number.isFinite(expiresMs)) {
    otpCountdown.value = ''
    isOtpExpired.value = false
    return
  }
  const remainingSec = Math.max(0, Math.floor((expiresMs - Date.now()) / 1000))
  if (remainingSec <= 0) {
    otpCountdown.value = 'Kedaluwarsa'
    isOtpExpired.value = true
    clearCountdown()
    return
  }
  isOtpExpired.value = false
  const mins = Math.floor(remainingSec / 60)
  const secs = remainingSec % 60
  otpCountdown.value = `${mins}:${String(secs).padStart(2, '0')}`
}

watch(
  () => pendingOtpExpiresAt.value,
  (val) => {
    clearCountdown()
    if (!val) {
      otpCountdown.value = ''
      isOtpExpired.value = false
      return
    }
    updateCountdown()
    if (!isOtpExpired.value) {
      countdownTimer = setInterval(updateCountdown, 1000)
    }
  },
)

function clearSensitiveProofFields() {
  currentPassword.value = ''
  totpCode.value = ''
  showPassword.value = false
}

function clearAllSecrets() {
  clearSensitiveProofFields()
  otpCode.value = ''
  pendingChangeId.value = null
  pendingTargetEmail.value = ''
  pendingOtpExpiresAt.value = null
  pendingResendAvailableAt.value = null
  clearCountdown()
  otpCountdown.value = ''
  isOtpExpired.value = false
}

function isCurrentAccount(generation, accountId) {
  return (
    componentActive &&
    accountGeneration === generation &&
    activeAccountId === accountId &&
    cloudStore.isAuthenticated &&
    String(cloudStore.user?.id) === accountId
  )
}

async function refreshMethods() {
  if (!isAuthenticated.value || methodsLoading.value) return
  const requestGeneration = accountGeneration
  const requestAccountId = activeAccountId
  methodsLoading.value = true
  methodsError.value = ''
  try {
    const result = await cloudStore.refreshAuthenticationMethods()
    if (!isCurrentAccount(requestGeneration, requestAccountId)) return
    if (result.ok) {
      authMethods.value = result.authenticationMethods
      twoFactorEnabled.value = result.twoFactorEnabled === true
      if (twoFactorEnabled.value) {
        requiresTotp.value = true
      }
      if (
        result.authenticationMethods.includes('google') &&
        !result.authenticationMethods.includes('manual')
      ) {
        proofMode.value = 'google'
      } else {
        proofMode.value = 'password'
      }
    } else if (result.state !== 'stale_operation') {
      authMethods.value = null
      methodsError.value = describeEmailChangeError(result.error ?? result).message
    }
  } finally {
    if (isCurrentAccount(requestGeneration, requestAccountId)) {
      methodsLoading.value = false
    }
  }
}

function openEmailChangeForm() {
  if (!isAuthenticated.value || flowLoading.value) return
  flowSequence += 1
  clearAllSecrets()
  newEmail.value = ''
  flowError.value = ''
  flowMessage.value = ''
  requiresTotp.value = twoFactorEnabled.value === true
  proofMode.value = isKnownGoogleOnly.value ? 'google' : 'password'
  flowState.value = 'form'
  if (authMethods.value === null && !methodsLoading.value) {
    void refreshMethods()
  }
}

function selectProofMode(mode) {
  if (flowLoading.value) return
  proofMode.value = mode
  flowError.value = ''
  clearSensitiveProofFields()
}

function cancelFlow() {
  flowSequence += 1
  clearAllSecrets()
  newEmail.value = ''
  flowError.value = ''
  flowMessage.value = ''
  flowLoading.value = false
  requiresTotp.value = false
  void cancelGoogleSignIn()
  cloudStore.cancelEmailChange()
  flowState.value = 'idle'
}

async function submitPasswordRequest() {
  if (flowLoading.value || !isAuthenticated.value) return
  flowError.value = ''

  const trimmedEmail = newEmail.value.trim()
  if (!trimmedEmail || !emailRegex.test(trimmedEmail)) {
    flowError.value = 'Format alamat email baru tidak valid.'
    return
  }
  if (
    currentServerEmail.value &&
    trimmedEmail.toLowerCase() === currentServerEmail.value.trim().toLowerCase()
  ) {
    flowError.value = 'Email baru harus berbeda dari email saat ini.'
    return
  }
  if (!currentPassword.value) {
    flowError.value = 'Password saat ini wajib diisi.'
    return
  }
  if (requiresTotp.value && !/^\d{6}$/.test(totpCode.value.trim())) {
    flowError.value = 'Masukkan kode autentikator 6 digit untuk melanjutkan.'
    return
  }

  const requestGeneration = accountGeneration
  const requestAccountId = activeAccountId
  const requestSeq = ++flowSequence
  const passwordProof = currentPassword.value
  const totpProof = totpCode.value.trim() || null
  flowLoading.value = true

  // Wipe password from reactive input state immediately while request is in-flight
  clearSensitiveProofFields()

  try {
    const result = await cloudStore.requestEmailChange({
      newEmail: trimmedEmail,
      currentPassword: passwordProof,
      totpCode: totpProof,
    })

    if (!isCurrentAccount(requestGeneration, requestAccountId) || flowSequence !== requestSeq) {
      return
    }

    if (!result.ok) {
      const code = String(result.error?.code ?? result.code ?? '').toUpperCase()
      if (code === 'TWO_FACTOR_REQUIRED') {
        requiresTotp.value = true
      }
      flowError.value = describeEmailChangeError(result.error ?? result).message
      return
    }

    pendingChangeId.value = result.changeId
    pendingTargetEmail.value = trimmedEmail
    pendingOtpExpiresAt.value = result.otpExpiresAt
    pendingResendAvailableAt.value = result.resendAvailableAt
    otpCode.value = ''
    flowError.value = ''
    flowState.value = 'otp'
  } finally {
    if (flowSequence === requestSeq) {
      flowLoading.value = false
    }
  }
}

async function submitGoogleProofRequest() {
  if (flowLoading.value || !isAuthenticated.value) return
  flowError.value = ''

  const trimmedEmail = newEmail.value.trim()
  if (!trimmedEmail || !emailRegex.test(trimmedEmail)) {
    flowError.value = 'Format alamat email baru tidak valid.'
    return
  }
  if (
    currentServerEmail.value &&
    trimmedEmail.toLowerCase() === currentServerEmail.value.trim().toLowerCase()
  ) {
    flowError.value = 'Email baru harus berbeda dari email saat ini.'
    return
  }
  if (requiresTotp.value && !/^\d{6}$/.test(totpCode.value.trim())) {
    flowError.value = 'Masukkan kode autentikator 6 digit untuk melanjutkan.'
    return
  }

  const requestGeneration = accountGeneration
  const requestAccountId = activeAccountId
  const requestSeq = ++flowSequence
  const totpProof = totpCode.value.trim() || null
  flowLoading.value = true

  clearSensitiveProofFields()

  try {
    const providerResult = await signInWithGoogle()
    if (!isCurrentAccount(requestGeneration, requestAccountId) || flowSequence !== requestSeq) {
      return
    }

    if (!providerResult.ok) {
      const described = describeGoogleLoginError(providerResult)
      if (described.kind !== 'cancelled') {
        flowError.value = described.message
      }
      return
    }

    const freshIdToken = providerResult.idToken
    const result = await cloudStore.requestEmailChange({
      newEmail: trimmedEmail,
      idToken: freshIdToken,
      clientPlatform: 'android',
      totpCode: totpProof,
    })

    if (!isCurrentAccount(requestGeneration, requestAccountId) || flowSequence !== requestSeq) {
      return
    }

    if (!result.ok) {
      const code = String(result.error?.code ?? result.code ?? '').toUpperCase()
      if (code === 'TWO_FACTOR_REQUIRED') {
        requiresTotp.value = true
      }
      flowError.value = describeEmailChangeError(result.error ?? result).message
      return
    }

    pendingChangeId.value = result.changeId
    pendingTargetEmail.value = trimmedEmail
    pendingOtpExpiresAt.value = result.otpExpiresAt
    pendingResendAvailableAt.value = result.resendAvailableAt
    otpCode.value = ''
    flowError.value = ''
    flowState.value = 'otp'
  } finally {
    if (flowSequence === requestSeq) {
      flowLoading.value = false
    }
  }
}

async function submitOtpVerification() {
  if (flowLoading.value || !isAuthenticated.value) return
  flowError.value = ''

  const normalizedOtp = otpCode.value.trim()
  if (!/^\d{6}$/.test(normalizedOtp)) {
    flowError.value = 'Masukkan kode OTP 6 digit.'
    return
  }
  if (isOtpExpired.value) {
    flowError.value = 'Kode verifikasi sudah kedaluwarsa. Mulai permintaan baru.'
    return
  }

  const requestGeneration = accountGeneration
  const requestAccountId = activeAccountId
  const requestSeq = ++flowSequence
  const targetChangeId = pendingChangeId.value
  flowLoading.value = true

  // Clear OTP input immediately so the same OTP cannot be replayed automatically
  otpCode.value = ''
  isVerifyingOtp = true

  try {
    const result = await cloudStore.verifyEmailChange({
      changeId: targetChangeId,
      code: normalizedOtp,
    })

    if (!componentActive || flowSequence !== requestSeq) {
      return
    }

    if (result.state === 'stale_operation') {
      clearAllSecrets()
      flowError.value = 'Sesi Cloud berubah. Perubahan email dibatalkan.'
      flowState.value = 'idle'
      return
    }

    if (result.uncertain) {
      clearAllSecrets()
      flowMessage.value = ''
      flowError.value = result.sessionRevoked
        ? 'Sesi Cloud telah berakhir, tetapi perubahan email belum dapat dipastikan. Periksa email akun atau masuk kembali.'
        : describeEmailChangeError(result.error ?? result).message
      flowState.value = 'uncertain'
      if (result.sessionRevoked) {
        emit('session-revoked', { outcome: 'uncertain' })
      }
      return
    }

    if (!result.ok) {
      if (
        !isCurrentAccount(requestGeneration, requestAccountId) ||
        result.sessionInvalidated
      ) {
        clearAllSecrets()
        flowError.value = describeEmailChangeError(result.error ?? result).message
        flowState.value = 'idle'
        return
      }
      flowError.value = describeEmailChangeError(result.error ?? result).message
      return
    }

    // HTTP 200 verified: session has been revoked by backend and cleared locally
    clearAllSecrets()
    newEmail.value = ''
    flowError.value = ''
    flowMessage.value = 'Email berhasil diperbarui. Silakan masuk kembali.'
    flowState.value = 'success'
    emit('session-revoked', { outcome: 'verified', state: result.state })
  } finally {
    isVerifyingOtp = false
    if (flowSequence === requestSeq) {
      flowLoading.value = false
    }
  }
}

function handleLoginAgain() {
  flowState.value = 'idle'
  flowMessage.value = ''
  flowError.value = ''
  emit('login-again')
}

watch(
  () => [cloudStore.isAuthenticated, cloudStore.user?.id],
  ([authenticated, nextId]) => {
    const normalizedId =
      authenticated && nextId !== null && nextId !== undefined ? String(nextId) : null
    if (normalizedId === activeAccountId) return

    accountGeneration += 1
    activeAccountId = normalizedId
    authMethods.value = null
    twoFactorEnabled.value = false
    methodsLoading.value = false
    methodsError.value = ''

    // Preserve terminal 'success' or 'uncertain' display when session revocation
    // transitions `cloudStore.isAuthenticated` from true to false.
    if (
      normalizedId === null &&
      (isVerifyingOtp || flowState.value === 'success' || flowState.value === 'uncertain')
    ) {
      return
    }

    // Account switched (A -> B) or logged out during an active flow: cancel immediately.
    flowSequence += 1
    clearAllSecrets()
    newEmail.value = ''
    flowLoading.value = false
    requiresTotp.value = false
    void cancelGoogleSignIn()
    cloudStore.cancelEmailChange()
    flowState.value = 'idle'
    flowMessage.value = ''
    flowError.value = normalizedId ? 'Sesi Cloud berubah. Perubahan email dibatalkan.' : ''
  },
)

onUnmounted(() => {
  componentActive = false
  accountGeneration += 1
  flowSequence += 1
  clearAllSecrets()
  void cancelGoogleSignIn()
  cloudStore.cancelEmailChange()
})
</script>

<template>
  <BaseCard
    v-if="isAuthenticated || flowState === 'success' || flowState === 'uncertain'"
    data-testid="email-change-card"
    class="space-y-3"
  >
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div>
        <p class="text-xs font-semibold uppercase tracking-[0.16em] text-primary">
          Keamanan Akun Cloud
        </p>
        <h3 class="mt-1 text-base font-semibold text-ink-primary">
          Ganti Alamat Email
        </h3>
      </div>

      <BaseButton
        v-if="isAuthenticated && flowState === 'idle'"
        data-testid="email-change-refresh-methods"
        variant="secondary"
        size="sm"
        :loading="methodsLoading"
        :disabled="methodsLoading || flowLoading"
        @click="refreshMethods"
      >
        Periksa Metode Akun
      </BaseButton>
    </div>

    <!-- Current Server Email -->
    <p
      v-if="isAuthenticated && currentServerEmail"
      data-testid="email-change-current-email"
      class="text-sm text-ink-secondary"
    >
      Email saat ini: <strong class="text-ink-primary">{{ currentServerEmail }}</strong>
    </p>

    <!-- Success Banner (shown after authoritative HTTP 200 verification) -->
    <div
      v-if="flowState === 'success' && flowMessage"
      data-testid="email-change-success"
      role="status"
      class="space-y-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700"
    >
      <p class="font-medium">{{ flowMessage }}</p>
      <BaseButton
        data-testid="email-change-login-again"
        variant="primary"
        size="sm"
        @click="handleLoginAgain"
      >
        Masuk Kembali
      </BaseButton>
    </div>

    <!-- Uncertain Outcome Banner (shown after verification network timeout) -->
    <div
      v-if="flowState === 'uncertain'"
      data-testid="email-change-uncertain"
      role="alert"
      class="space-y-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800"
    >
      <p>{{ flowError }}</p>
      <BaseButton
        data-testid="email-change-login-again"
        variant="secondary"
        size="sm"
        @click="handleLoginAgain"
      >
        Kembali ke Login Cloud
      </BaseButton>
    </div>

    <!-- Error Banner -->
    <p
      v-if="(flowError || methodsError) && flowState !== 'uncertain'"
      data-testid="email-change-error"
      role="alert"
      class="rounded-2xl border border-danger/20 bg-danger/5 px-4 py-3 text-sm text-danger"
    >
      {{ flowError || methodsError }}
    </p>

    <!-- Idle State -->
    <div v-if="isAuthenticated && flowState === 'idle'" class="space-y-2">
      <p class="text-xs leading-relaxed text-ink-secondary">
        Perubahan email memerlukan bukti kepemilikan akun dan verifikasi kode OTP 6 digit ke alamat email baru. Seluruh sesi Cloud akan dicabut setelah verifikasi berhasil.
      </p>
      <BaseButton
        data-testid="email-change-open"
        variant="primary"
        size="sm"
        :disabled="flowLoading"
        @click="openEmailChangeForm"
      >
        Ganti Email
      </BaseButton>
    </div>

    <!-- Form State: New Email + Ownership Proof -->
    <div
      v-if="isAuthenticated && flowState === 'form'"
      data-testid="email-change-form-step"
      class="space-y-4 rounded-2xl border border-zinc-200 bg-surface/50 p-4"
    >
      <div class="space-y-1.5">
        <label
          for="email-change-new-email"
          class="block text-xs font-semibold uppercase tracking-wider text-ink-secondary"
        >
          Email Baru
        </label>
        <input
          id="email-change-new-email"
          v-model="newEmail"
          data-testid="email-change-email-input"
          type="email"
          inputmode="email"
          autocomplete="email"
          placeholder="emailbaru@domain.com"
          :disabled="flowLoading"
          class="h-11 w-full rounded-2xl border border-zinc-200 bg-white px-4 text-sm text-ink-primary outline-none focus:border-primary"
        />
      </div>

      <!-- Proof Policy Guidance & Mode Switcher -->
      <div class="space-y-2">
        <p
          data-testid="email-change-proof-guidance"
          class="text-xs leading-relaxed text-ink-secondary"
        >
          Akun dengan login password (termasuk akun manual yang terhubung ke Google) wajib membuktikan kepemilikan dengan password saat ini. Akun khusus Google menggunakan verifikasi Google terbaru.
        </p>

        <div class="flex flex-wrap gap-2">
          <button
            type="button"
            data-testid="email-change-proof-password"
            :disabled="flowLoading"
            :class="[
              'rounded-xl px-3 py-1.5 text-xs font-semibold transition',
              proofMode === 'password'
                ? 'bg-primary text-white'
                : 'border border-zinc-200 bg-white text-ink-secondary hover:text-ink-primary',
            ]"
            @click="selectProofMode('password')"
          >
            Gunakan Password
          </button>
          <button
            type="button"
            data-testid="email-change-proof-google"
            :disabled="flowLoading"
            :class="[
              'rounded-xl px-3 py-1.5 text-xs font-semibold transition',
              proofMode === 'google'
                ? 'bg-primary text-white'
                : 'border border-zinc-200 bg-white text-ink-secondary hover:text-ink-primary',
            ]"
            @click="selectProofMode('google')"
          >
            Verifikasi Google (Khusus Akun Google-Only)
          </button>
        </div>
      </div>

      <!-- Password Proof Input -->
      <div v-if="proofMode === 'password'" class="space-y-1.5">
        <label
          for="email-change-current-password"
          class="block text-xs font-semibold uppercase tracking-wider text-ink-secondary"
        >
          Password Saat Ini
        </label>
        <input
          id="email-change-current-password"
          v-model="currentPassword"
          data-testid="email-change-password-input"
          :type="showPassword ? 'text' : 'password'"
          autocomplete="current-password"
          placeholder="Masukkan password saat ini"
          :disabled="flowLoading"
          class="h-11 w-full rounded-2xl border border-zinc-200 bg-white px-4 text-sm text-ink-primary outline-none focus:border-primary"
        />
      </div>

      <!-- Conditional TOTP Input -->
      <div v-if="requiresTotp" class="space-y-1.5">
        <label
          for="email-change-totp"
          class="block text-xs font-semibold uppercase tracking-wider text-ink-secondary"
        >
          Kode Autentikator 6 Digit (2FA)
        </label>
        <input
          id="email-change-totp"
          v-model="totpCode"
          data-testid="email-change-totp-input"
          type="text"
          inputmode="numeric"
          maxlength="6"
          autocomplete="one-time-code"
          placeholder="123456"
          :disabled="flowLoading"
          class="h-11 w-full rounded-2xl border border-zinc-200 bg-white px-4 text-sm tracking-[0.2em] text-ink-primary outline-none focus:border-primary"
        />
      </div>

      <!-- Submit / Cancel Actions -->
      <div class="flex flex-wrap justify-end gap-2 pt-1">
        <BaseButton
          data-testid="email-change-cancel"
          type="button"
          variant="secondary"
          size="sm"
          :disabled="flowLoading"
          @click="cancelFlow"
        >
          Batal
        </BaseButton>

        <BaseButton
          v-if="proofMode === 'password'"
          data-testid="email-change-submit"
          type="button"
          variant="primary"
          size="sm"
          :loading="flowLoading"
          :disabled="flowLoading"
          @click="submitPasswordRequest"
        >
          Kirim Permintaan
        </BaseButton>

        <BaseButton
          v-else
          data-testid="email-change-google-proof"
          type="button"
          variant="primary"
          size="sm"
          :loading="flowLoading"
          :disabled="flowLoading"
          @click="submitGoogleProofRequest"
        >
          Verifikasi dengan Google
        </BaseButton>
      </div>
    </div>

    <!-- OTP Verification State -->
    <div
      v-if="isAuthenticated && flowState === 'otp'"
      data-testid="email-change-otp-step"
      class="space-y-4 rounded-2xl border border-zinc-200 bg-surface/50 p-4"
    >
      <div class="space-y-1">
        <p class="text-sm font-medium text-ink-primary">
          Kode verifikasi telah dikirim ke <strong>{{ pendingTargetEmail }}</strong>
        </p>
        <p class="text-xs text-ink-secondary">
          Email akun Anda tetap <strong>{{ currentServerEmail }}</strong> sampai kode OTP 6 digit berhasil diverifikasi oleh server.
        </p>
      </div>

      <div v-if="otpCountdown" class="flex items-center justify-between text-xs text-ink-secondary">
        <span>Masa berlaku kode:</span>
        <strong data-testid="email-change-countdown" class="font-mono text-ink-primary">
          {{ otpCountdown }}
        </strong>
      </div>

      <div class="space-y-1.5">
        <label
          for="email-change-otp-code"
          class="block text-xs font-semibold uppercase tracking-wider text-ink-secondary"
        >
          Kode OTP Email Baru (6 Digit)
        </label>
        <input
          id="email-change-otp-code"
          v-model="otpCode"
          data-testid="email-change-otp-input"
          type="text"
          inputmode="numeric"
          maxlength="6"
          autocomplete="one-time-code"
          placeholder="123456"
          :disabled="flowLoading"
          class="h-11 w-full rounded-2xl border border-zinc-200 bg-white px-4 font-mono text-sm tracking-[0.25em] text-ink-primary outline-none focus:border-primary"
        />
      </div>

      <p
        data-testid="email-change-no-resend-notice"
        class="rounded-xl border border-zinc-200 bg-white px-3 py-2 text-xs leading-relaxed text-ink-secondary"
      >
        Pengiriman ulang kode OTP otomatis belum tersedia untuk perubahan email. Jika kode kedaluwarsa, batalkan dan ajukan permintaan baru setelah masa tunggu berakhir.
      </p>

      <div class="flex flex-wrap justify-end gap-2 pt-1">
        <BaseButton
          data-testid="email-change-cancel"
          type="button"
          variant="secondary"
          size="sm"
          :disabled="flowLoading"
          @click="cancelFlow"
        >
          Batal
        </BaseButton>
        <BaseButton
          data-testid="email-change-verify"
          type="button"
          variant="primary"
          size="sm"
          :loading="flowLoading"
          :disabled="flowLoading"
          @click="submitOtpVerification"
        >
          Verifikasi OTP
        </BaseButton>
      </div>
    </div>
  </BaseCard>
</template>
