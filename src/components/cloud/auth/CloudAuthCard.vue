<script setup>
import { ref, watch } from 'vue'

import CloudLoginForm from './CloudLoginForm.vue'
import CloudRegisterForm from './CloudRegisterForm.vue'

const props = defineProps({
  modelValue: {
    type: String,
    default: 'login',
    validator: (val) => ['login', 'register'].includes(val),
  },
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

const emit = defineEmits([
  'update:modelValue',
  'tab-change',
  'login-submit',
  'register-submit',
  'google-click',
  'forgot-password',
])

const currentTab = ref(props.modelValue)

watch(
  () => props.modelValue,
  (val) => {
    currentTab.value = val
  },
)

function setTab(tab) {
  currentTab.value = tab
  emit('update:modelValue', tab)
  emit('tab-change', tab)
}

function handleLoginSubmit(payload) {
  emit('login-submit', payload)
}

function handleRegisterSubmit(payload) {
  emit('register-submit', payload)
}

function handleGoogleClick() {
  emit('google-click')
}

function handleForgotPassword() {
  emit('forgot-password')
}
</script>

<template>
  <div
    class="w-full max-w-md rounded-3xl border border-zinc-200/80 bg-white p-6 shadow-card transition-all sm:p-8"
    data-testid="cloud-auth-card"
  >
    <!-- Segmented Tab Switcher -->
    <div
      class="mb-6 grid grid-cols-2 rounded-2xl bg-zinc-100/80 p-1.5"
      role="tablist"
      aria-label="Mode Autentikasi"
    >
      <button
        id="cloud-tab-login"
        type="button"
        role="tab"
        :aria-selected="currentTab === 'login'"
        data-testid="auth-tab-login"
        :class="[
          'h-10 rounded-xl text-xs font-bold transition-all sm:text-sm',
          currentTab === 'login'
            ? 'bg-white text-ink-primary shadow-soft'
            : 'text-ink-secondary hover:text-ink-primary',
        ]"
        @click="setTab('login')"
      >
        Masuk
      </button>
      <button
        id="cloud-tab-register"
        type="button"
        role="tab"
        :aria-selected="currentTab === 'register'"
        data-testid="auth-tab-register"
        :class="[
          'h-10 rounded-xl text-xs font-bold transition-all sm:text-sm',
          currentTab === 'register'
            ? 'bg-white text-ink-primary shadow-soft'
            : 'text-ink-secondary hover:text-ink-primary',
        ]"
        @click="setTab('register')"
      >
        Daftar
      </button>
    </div>

    <!-- Tab Contents -->
    <div class="transition-opacity duration-200">
      <CloudLoginForm
        v-if="currentTab === 'login'"
        :loading="loading"
        :error-message="errorMessage"
        :disabled="disabled"
        :initial-email="initialEmail"
        @submit="handleLoginSubmit"
        @switch-tab="setTab"
        @google-click="handleGoogleClick"
        @forgot-password="handleForgotPassword"
      />

      <CloudRegisterForm
        v-else-if="currentTab === 'register'"
        :loading="loading"
        :error-message="errorMessage"
        :disabled="disabled"
        :initial-email="initialEmail"
        :initial-name="initialName"
        @submit="handleRegisterSubmit"
        @switch-tab="setTab"
        @google-click="handleGoogleClick"
      />
    </div>
  </div>
</template>
