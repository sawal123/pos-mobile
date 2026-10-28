<script setup>
import { computed, onUnmounted, ref, watch } from 'vue'

import BaseButton from '@/components/base/BaseButton.vue'
import BaseCard from '@/components/base/BaseCard.vue'
import BaseModal from '@/components/base/BaseModal.vue'
import { describeGoogleLinkError } from '@/services/cloud/cloudLoginErrors'
import { cancelGoogleSignIn, signInWithGoogle } from '@/services/cloud/googleNativeAuthService'
import { useCloudSessionStore } from '@/stores/cloudSessionStore'

const props = defineProps({
  collisionDetected: {
    type: Boolean,
    default: false,
  },
})

const cloudStore = useCloudSessionStore()
const authMethods = ref(null)
const methodsLoading = ref(false)
const methodsError = ref('')
const flowState = ref('idle')
const flowError = ref('')
const flowMessage = ref('')
const password = ref('')
const totpCode = ref('')
const requiresTotp = ref(false)
const pickerLoading = ref(false)
const reauthLoading = ref(false)

let componentActive = true
let accountGeneration = 0
let activeAccountId = cloudStore.isAuthenticated && cloudStore.user?.id != null
  ? String(cloudStore.user.id)
  : null
let flowSequence = 0

const isAuthenticated = computed(() => cloudStore.isAuthenticated)
const hasGoogleMethod = computed(() => authMethods.value?.includes('google') === true)
const hasManualMethod = computed(() => authMethods.value?.includes('manual') === true)
const isGoogleOnly = computed(
  () => authMethods.value !== null && hasGoogleMethod.value && !hasManualMethod.value,
)
const canLink = computed(
  () => authMethods.value !== null && hasManualMethod.value && !hasGoogleMethod.value,
)

function clearSensitiveFields() {
  password.value = ''
  totpCode.value = ''
}

function describeError(error) {
  return describeGoogleLinkError(error).message
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
    } else if (result.state !== 'stale_operation') {
      authMethods.value = null
      methodsError.value = describeError(result.error ?? result)
    }
  } finally {
    if (isCurrentAccount(requestGeneration, requestAccountId)) {
      methodsLoading.value = false
    }
  }
}

function openLinkConfirmation() {
  flowError.value = ''
  flowMessage.value = ''
  flowState.value = 'confirmation_required'
}

function closeFlow() {
  flowSequence += 1
  clearSensitiveFields()
  flowError.value = ''
  flowMessage.value = ''
  requiresTotp.value = false
  pickerLoading.value = false
  reauthLoading.value = false
  void cancelGoogleSignIn()
  cloudStore.cancelGoogleAccountLinking()
  flowState.value = 'idle'
}

function continueToReauthentication() {
  flowError.value = ''
  flowState.value = 'reauthenticating'
}

async function submitReauthentication() {
  flowError.value = ''
  if (!password.value.trim()) {
    flowError.value = 'Password saat ini wajib diisi.'
    return
  }
  if (requiresTotp.value && !/^\d{6}$/.test(totpCode.value)) {
    flowError.value = 'Masukkan kode autentikator 6 digit.'
    return
  }

  const requestGeneration = accountGeneration
  const requestAccountId = activeAccountId
  const requestFlowSequence = flowSequence
  reauthLoading.value = true
  try {
    const result = await cloudStore.reauthenticateForGoogleLink(
      password.value,
      totpCode.value || null,
    )
    if (!isCurrentAccount(requestGeneration, requestAccountId) || flowSequence !== requestFlowSequence) {
      return
    }
    if (!result.ok) {
      const code = result.error?.code ?? result.code
      if (code === 'TWO_FACTOR_REQUIRED') {
        requiresTotp.value = true
        totpCode.value = ''
      }
      flowError.value = describeError(result.error ?? result)
      return
    }

    clearSensitiveFields()
    requiresTotp.value = false
    flowState.value = 'google_picker'
  } finally {
    if (isCurrentAccount(requestGeneration, requestAccountId) && flowSequence === requestFlowSequence) {
      reauthLoading.value = false
    }
  }
}

async function pickGoogleAccount() {
  if (pickerLoading.value) return
  const requestGeneration = accountGeneration
  const requestAccountId = activeAccountId
  const requestFlowSequence = flowSequence
  pickerLoading.value = true
  flowError.value = ''
  let providerResult = null

  try {
    providerResult = await signInWithGoogle()
    if (!isCurrentAccount(requestGeneration, requestAccountId) || flowSequence !== requestFlowSequence) {
      return
    }
    if (!providerResult.ok) {
      if (providerResult.code === 'USER_CANCELLED') {
        closeFlow()
        return
      }
      flowError.value = describeError(providerResult)
      return
    }

    const result = await cloudStore.linkGoogleAccount(providerResult.idToken, 'android')
    if (!isCurrentAccount(requestGeneration, requestAccountId) || flowSequence !== requestFlowSequence) {
      return
    }
    if (result.state === 'stale_operation') {
      closeFlow()
      return
    }
    if (!result.ok) {
      flowError.value = describeError(result.error ?? result)
      if (result.code === 'REAUTHENTICATION_EXPIRED') {
        flowState.value = 'idle'
        clearSensitiveFields()
      }
      return
    }

    if (Array.isArray(result.authenticationMethods)) {
      authMethods.value = result.authenticationMethods
    }
    flowMessage.value = result.methodsVerified
      ? 'Akun Google berhasil dihubungkan. Metode login sudah diverifikasi.'
      : 'Link berhasil, status metode login belum dapat diverifikasi.'
    flowState.value = 'linked'
  } catch {
    flowError.value = 'Penghubungan belum dapat dipastikan. Jangan mencoba ulang otomatis.'
  } finally {
    if (providerResult) providerResult.idToken = null
    if (isCurrentAccount(requestGeneration, requestAccountId) && flowSequence === requestFlowSequence) {
      pickerLoading.value = false
    }
  }
}

watch(
  () => [cloudStore.isAuthenticated, cloudStore.user?.id],
  ([authenticated, rawAccountId]) => {
    const nextAccountId = authenticated && rawAccountId != null ? String(rawAccountId) : null
    if (nextAccountId === activeAccountId) return

    activeAccountId = nextAccountId
    accountGeneration += 1
    authMethods.value = null
    methodsError.value = ''
    methodsLoading.value = false
    closeFlow()

    if (!authenticated) {
      authMethods.value = null
      return
    }

    // A new authenticated identity must never inherit the previous account's
    // methods. Re-verify it from the server without replacing its session.
    void refreshMethods()
  },
)

onUnmounted(() => {
  componentActive = false
  accountGeneration += 1
  clearSensitiveFields()
  void cancelGoogleSignIn()
  cloudStore.cancelGoogleAccountLinking()
})
</script>

<template>
  <BaseCard v-if="isAuthenticated" class="space-y-4" data-testid="cloud-google-link-card">
    <div>
      <p class="text-sm font-semibold text-ink-primary">Metode login Cloud</p>
      <p class="mt-1 text-xs text-ink-secondary">
        {{ cloudStore.user?.name }} · {{ cloudStore.user?.email }}
      </p>
    </div>

    <p
      v-if="props.collisionDetected"
      class="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800"
      data-testid="google-link-collision-message"
    >
      Akun Google ini sudah memiliki akun Cloud. Anda sudah masuk ke akun manual; setujui
      penghubungan di sini jika ingin memakai kedua metode login.
    </p>

    <div v-if="authMethods === null" class="space-y-3">
      <p class="rounded-2xl bg-surface px-4 py-3 text-sm text-ink-secondary">
        Metode login belum diverifikasi. Jangan menganggap Google sudah atau belum terhubung.
      </p>
      <p v-if="methodsError" class="rounded-2xl bg-danger/10 px-4 py-3 text-sm text-danger" role="status">
        {{ methodsError }}
      </p>
      <BaseButton
        data-testid="google-link-refresh-methods"
        variant="secondary"
        :loading="methodsLoading"
        :disabled="methodsLoading"
        @click="refreshMethods"
      >
        Periksa metode login
      </BaseButton>
    </div>

    <div v-else-if="hasGoogleMethod" class="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3">
      <p class="text-sm font-semibold text-emerald-800" data-testid="google-linked-status">
        Google Terhubung
      </p>
      <p class="mt-1 text-xs text-emerald-700">Google terhubung ke akun Cloud ini.</p>
    </div>

    <div v-else-if="isGoogleOnly" class="rounded-2xl border border-sky-200 bg-sky-50 px-4 py-3">
      <p class="text-sm font-semibold text-sky-800">Akun Google-only</p>
      <p class="mt-1 text-xs text-sky-700">Penghubungan manual tidak tersedia untuk akun ini.</p>
    </div>

    <div v-else-if="canLink" class="space-y-3">
      <p class="text-sm text-ink-secondary">Akun manual ini belum memiliki metode login Google.</p>
      <BaseButton data-testid="google-link-open" @click="openLinkConfirmation">
        Hubungkan Google
      </BaseButton>
    </div>

    <p
      v-if="flowMessage"
      class="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700"
      data-testid="google-link-success"
      role="status"
    >
      {{ flowMessage }}
    </p>

    <p
      v-if="flowError && flowState !== 'reauthenticating' && flowState !== 'google_picker'"
      class="rounded-2xl bg-danger/10 px-4 py-3 text-sm text-danger"
      data-testid="google-link-error"
      role="alert"
    >
      {{ flowError }}
    </p>

    <BaseModal
      :open="flowState === 'confirmation_required'"
      title="Hubungkan Akun Google"
      @close="closeFlow"
    >
      <div class="space-y-4" data-testid="google-link-confirmation">
        <p class="text-sm leading-relaxed text-ink-secondary">
          Setelah terhubung, akun Google ini menjadi metode login tambahan pada akun Cloud yang
          sama. Data bisnis, transaksi, dan pengaturan POS tidak berubah.
        </p>
        <div class="flex flex-wrap gap-2">
          <BaseButton data-testid="google-link-continue" @click="continueToReauthentication">
            Lanjutkan
          </BaseButton>
          <BaseButton variant="ghost" data-testid="google-link-cancel" @click="closeFlow">
            Batal
          </BaseButton>
        </div>
      </div>
    </BaseModal>

    <BaseModal
      :open="flowState === 'reauthenticating'"
      title="Verifikasi ulang akun"
      @close="closeFlow"
    >
      <form class="space-y-4" data-testid="google-link-reauth-form" @submit.prevent="submitReauthentication">
        <p class="text-sm text-ink-secondary">
          Masukkan password akun Cloud saat ini. Verifikasi ulang diperlukan meskipun Anda sudah login.
        </p>
        <label class="flex w-full flex-col gap-2">
          <span class="text-sm font-medium text-ink-secondary">Password saat ini</span>
          <input
            v-model="password"
            type="password"
            autocomplete="current-password"
            data-testid="google-link-password"
            class="h-12 rounded-2xl border border-zinc-200 bg-white px-4 text-sm text-ink-primary outline-none transition focus:border-primary focus:ring-4 focus:ring-primary/10"
          />
        </label>
        <label v-if="requiresTotp" class="flex w-full flex-col gap-2">
          <span class="text-sm font-medium text-ink-secondary">Kode autentikator</span>
          <input
            v-model="totpCode"
            type="text"
            inputmode="numeric"
            maxlength="6"
            autocomplete="one-time-code"
            data-testid="google-link-totp"
            class="h-12 rounded-2xl border border-zinc-200 bg-white px-4 text-sm text-ink-primary outline-none transition focus:border-primary focus:ring-4 focus:ring-primary/10"
          />
        </label>
        <p v-if="flowError" class="rounded-2xl bg-danger/10 px-4 py-3 text-sm text-danger" role="alert">
          {{ flowError }}
        </p>
        <div class="flex flex-wrap gap-2">
          <BaseButton type="submit" :loading="reauthLoading" :disabled="reauthLoading">
            {{ reauthLoading ? 'Memverifikasi...' : 'Verifikasi dan pilih Google' }}
          </BaseButton>
          <BaseButton type="button" variant="ghost" :disabled="reauthLoading" @click="closeFlow">
            Batal
          </BaseButton>
        </div>
      </form>
    </BaseModal>

    <BaseModal
      :open="flowState === 'google_picker'"
      title="Pilih akun Google"
      @close="closeFlow"
    >
      <div class="space-y-4" data-testid="google-link-picker-step">
        <p class="text-sm text-ink-secondary">
          Pilih akun Google yang ingin dihubungkan. Token Google baru hanya digunakan untuk satu
          permintaan link.
        </p>
        <p v-if="flowError" class="rounded-2xl bg-danger/10 px-4 py-3 text-sm text-danger" role="alert">
          {{ flowError }}
        </p>
        <div class="flex flex-wrap gap-2">
          <BaseButton
            data-testid="google-link-picker-button"
            :loading="pickerLoading"
            :disabled="pickerLoading"
            @click="pickGoogleAccount"
          >
            {{ pickerLoading ? 'Membuka Google...' : 'Pilih akun Google' }}
          </BaseButton>
          <BaseButton variant="ghost" :disabled="pickerLoading" @click="closeFlow">Batal</BaseButton>
        </div>
      </div>
    </BaseModal>
  </BaseCard>
</template>
