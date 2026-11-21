<script setup>
import { computed, ref, watch } from 'vue'

import BaseButton from '@/components/base/BaseButton.vue'
import BaseInput from '@/components/base/BaseInput.vue'
import BaseModal from '@/components/base/BaseModal.vue'
import {
  PAIRING_CODE_LENGTH,
  PAIRING_ERROR,
  defaultDeviceName,
  isValidPairingCode,
  normalizePairingCode,
} from '@/services/cloud/devicePairingService'
import { useCloudSessionStore } from '@/stores/cloudSessionStore'

const props = defineProps({
  open: { type: Boolean, default: false },
  businessName: { type: String, default: '' },
})

const emit = defineEmits(['close', 'paired'])

const cloudStore = useCloudSessionStore()

const code = ref('')
const deviceName = ref(defaultDeviceName())
const busy = ref(false)
const errorMessage = ref('')

watch(
  () => props.open,
  (open) => {
    if (!open) return
    code.value = ''
    deviceName.value = defaultDeviceName()
    errorMessage.value = ''
    busy.value = false
  },
)

const deviceIdentifierLabel = computed(() => cloudStore.deviceIdentifier || '—')
const canSubmit = computed(
  () => isValidPairingCode(code.value) && deviceName.value.trim().length > 0 && !busy.value,
)

function handleCodeInput(event) {
  code.value = normalizePairingCode(event.target.value)
  errorMessage.value = ''
}

async function submit() {
  if (busy.value) return

  if (!isValidPairingCode(code.value)) {
    errorMessage.value = `Kode pairing harus ${PAIRING_CODE_LENGTH} digit angka.`
    return
  }

  const name = deviceName.value.trim()
  if (!name) {
    errorMessage.value = 'Nama perangkat tidak boleh kosong.'
    return
  }

  busy.value = true
  errorMessage.value = ''

  try {
    const result = await cloudStore.pairDeviceWithCode({ code: code.value, deviceName: name })

    if (!result?.ok) {
      if (
        result?.code === 'DEVICE_LIMIT_EXCEEDED' ||
        result?.code === PAIRING_ERROR.DEVICE_LIMIT_EXCEEDED ||
        result?.status === 403
      ) {
        errorMessage.value =
          'Batas perangkat terhubung untuk bisnis ini telah mencapai batas maksimal. Silakan minta pemilik bisnis menambah batas perangkat di dashboard.'
      } else {
        errorMessage.value = result?.message || 'Pairing perangkat gagal. Coba lagi.'
      }
      return
    }

    emit('paired', result.device ?? null)
  } catch (err) {
    if (
      err?.code === 'DEVICE_LIMIT_EXCEEDED' ||
      err?.code === PAIRING_ERROR.DEVICE_LIMIT_EXCEEDED ||
      err?.status === 403
    ) {
      errorMessage.value =
        'Batas perangkat terhubung untuk bisnis ini telah mencapai batas maksimal. Silakan minta pemilik bisnis menambah batas perangkat di dashboard.'
    } else {
      errorMessage.value = err?.message || 'Pairing perangkat gagal. Coba lagi.'
    }
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <BaseModal
    :open="open"
    title="Pasangkan Perangkat Kasir"
    data-testid="device-pairing-modal"
    @close="emit('close')"
  >
    <form class="space-y-4" data-testid="device-pairing-form" @submit.prevent="submit">
      <div
        class="rounded-2xl border border-primary/15 bg-primary/5 p-3 text-[11px] leading-relaxed text-ink-secondary"
      >
        <p class="font-semibold text-ink-primary">Kode dari pemilik</p>
        <p class="mt-1">
          Minta kode <strong>4 digit</strong> dari pemilik (Dashboard → Perangkat →
          <strong>Kode Kasir</strong>). Kode berlaku <strong>30 menit</strong> dan hanya bisa dipakai
          sekali.
        </p>
        <p v-if="businessName" class="mt-1">Bisnis: {{ businessName }}</p>
      </div>

      <div>
        <label
          for="pairingCodeInput"
          class="mb-1.5 block text-xs font-semibold text-ink-secondary"
          >Kode Pairing</label
        >
        <input
          id="pairingCodeInput"
          :value="code"
          data-testid="pairing-code-input"
          type="text"
          inputmode="numeric"
          autocomplete="one-time-code"
          :maxlength="PAIRING_CODE_LENGTH"
          placeholder="••••"
          aria-describedby="pairing-code-help"
          class="h-14 w-full rounded-2xl border border-zinc-200 bg-card text-center font-mono text-2xl font-bold tracking-[0.6em] text-ink-primary outline-none transition focus:border-primary focus:ring-4 focus:ring-primary/10 dark:border-slate-700/70 dark:bg-[#121726]"
          @input="handleCodeInput"
        />
        <p id="pairing-code-help" class="mt-1 text-[11px] text-ink-secondary">
          Hanya angka, {{ PAIRING_CODE_LENGTH }} digit.
        </p>
      </div>

      <BaseInput
        v-model="deviceName"
        label="Nama Perangkat"
        data-testid="pairing-device-name"
        placeholder="mis. Kasir Depan"
      />

      <div class="rounded-2xl bg-surface px-3 py-2.5 text-[11px] leading-relaxed text-ink-secondary">
        <p>
          Identitas perangkat ini:
          <span class="break-all font-mono text-ink-primary" data-testid="pairing-device-identifier">
            {{ deviceIdentifierLabel }}
          </span>
        </p>
        <p class="mt-1">
          Saat kode dikirim, server mencatat nama perangkat, IP, user agent, platform, dan versi
          aplikasi sebagai bukti keamanan.
        </p>
      </div>

      <p
        v-if="errorMessage"
        class="rounded-2xl bg-danger/10 px-3 py-2 text-xs font-medium text-danger"
        role="alert"
        data-testid="pairing-error"
      >
        {{ errorMessage }}
      </p>

      <div class="flex items-center justify-end gap-2 pt-1">
        <BaseButton type="button" variant="ghost" size="sm" @click="emit('close')">Batal</BaseButton>
        <BaseButton type="submit" size="sm" :disabled="!canSubmit" data-testid="pairing-submit">
          {{ busy ? 'Memasangkan…' : 'Pasangkan Perangkat' }}
        </BaseButton>
      </div>
    </form>
  </BaseModal>
</template>
