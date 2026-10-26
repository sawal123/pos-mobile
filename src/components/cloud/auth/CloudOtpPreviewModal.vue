<script setup>
import { computed } from 'vue'

import BaseModal from '@/components/base/BaseModal.vue'
import BaseButton from '@/components/base/BaseButton.vue'
import AppIcon from '@/components/base/AppIcon.vue'

const props = defineProps({
  modelValue: {
    type: Boolean,
    default: false,
  },
  email: {
    type: String,
    default: 'pengguna@contoh.com',
  },
})

const emit = defineEmits(['update:modelValue', 'close'])

const isOpen = computed({
  get: () => props.modelValue,
  set: (val) => emit('update:modelValue', val),
})

function handleClose() {
  isOpen.value = false
  emit('close')
}
</script>

<template>
  <BaseModal
    :open="isOpen"
    title="Preview Verifikasi OTP"
    data-testid="cloud-otp-preview-modal"
    @close="handleClose"
  >
    <div class="space-y-5 text-center">
      <!-- Icon -->
      <div class="mx-auto flex size-14 items-center justify-center rounded-2xl bg-primary/10 text-primary shadow-soft">
        <AppIcon name="mail" class="size-7" />
      </div>

      <!-- Title & Email info -->
      <div class="space-y-1">
        <h3 class="text-lg font-bold text-ink-primary">
          Verifikasi Alamat Email
        </h3>
        <p class="text-xs text-ink-secondary">
          Masukkan 6 digit kode verifikasi yang dikirimkan ke:
        </p>
        <p class="text-xs font-semibold text-ink-primary">
          {{ email }}
        </p>
      </div>

      <!-- 6-digit Box Preview (Visual Only) -->
      <div class="flex justify-center gap-2 py-2" data-testid="otp-boxes-preview">
        <div
          v-for="i in 6"
          :key="i"
          class="flex size-11 items-center justify-center rounded-xl border border-zinc-200 bg-zinc-50 text-base font-bold text-ink-primary shadow-xs"
        >
          <span v-if="i <= 3" class="text-primary font-mono">•</span>
          <span v-else class="text-zinc-300 font-mono">-</span>
        </div>
      </div>

      <!-- Countdown & Resend info -->
      <div class="space-y-1.5 text-xs text-ink-muted">
        <p>Kirim ulang kode dalam <span class="font-semibold text-ink-primary">00:54</span></p>
        <div class="flex items-center justify-center gap-4 text-xs">
          <button
            type="button"
            disabled
            class="font-semibold text-zinc-400 cursor-not-allowed"
          >
            Kirim Ulang
          </button>
          <span class="text-zinc-300">•</span>
          <button
            type="button"
            class="font-semibold text-primary hover:underline"
            @click="handleClose"
          >
            Ganti Email
          </button>
        </div>
      </div>

      <!-- Scope Notice Badge -->
      <div class="rounded-2xl border border-amber-200/80 bg-amber-50/70 p-3 text-left text-xs text-amber-800">
        <div class="flex items-start gap-2">
          <div class="mt-0.5 shrink-0 text-amber-600">
            <AppIcon name="alert-triangle" class="size-4" />
          </div>
          <div class="min-w-0 flex-1 leading-relaxed">
            <p class="font-semibold">Handoff ke AUTH-M03</p>
            <p class="text-[11px] text-amber-700">
              Tampilan ini merupakan representasi preview visual. Logika input digit otomatis, countdown timer, resend backend, dan verifikasi akun akan diimplementasikan pada task AUTH-M03.
            </p>
          </div>
        </div>
      </div>

      <!-- Close Button -->
      <div class="pt-2">
        <BaseButton
          variant="secondary"
          block
          size="lg"
          data-testid="otp-preview-close-button"
          class="h-11 rounded-2xl text-xs font-semibold"
          @click="handleClose"
        >
          Tutup Preview
        </BaseButton>
      </div>
    </div>
  </BaseModal>
</template>
