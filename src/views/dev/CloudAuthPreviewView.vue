<script setup>
import { ref } from 'vue'
import { useRouter } from 'vue-router'

import AppIcon from '@/components/base/AppIcon.vue'
import BaseButton from '@/components/base/BaseButton.vue'
import CloudAuthCard from '@/components/cloud/auth/CloudAuthCard.vue'
import CloudOtpPreviewModal from '@/components/cloud/auth/CloudOtpPreviewModal.vue'

const router = useRouter()

const activeTab = ref('login')
const isLoading = ref(false)
const isDisabled = ref(false)
const selectedError = ref('')
const isMobileFrame = ref(true)
const showOtpModal = ref(false)
const otpEmail = ref('budi@tokoberkah.com')
const googleAlertMessage = ref('')
const showGoogleAlert = ref(false)

const eventLogs = ref([])

const errorPresets = [
  { label: 'Tidak ada error', value: '' },
  { label: 'Kredensial salah', value: 'Email atau password salah. Silakan periksa kembali.' },
  { label: 'Koneksi gagal', value: 'Koneksi ke server terputus. Pastikan perangkat terhubung internet.' },
  { label: 'Akun belum aktif', value: 'Email belum diverifikasi. Silakan cek kotak masuk email Anda.' },
]

function logEvent(name, payload) {
  const timestamp = new Date().toLocaleTimeString('id-ID')
  eventLogs.value.unshift({
    id: Date.now() + Math.random(),
    time: timestamp,
    name,
    payload: payload ? JSON.stringify(payload, null, 2) : 'No payload',
  })
  if (eventLogs.value.length > 20) {
    eventLogs.value.pop()
  }
}

function handleTabChange(tab) {
  activeTab.value = tab
  logEvent('tab-change', { tab })
}

function handleLoginSubmit(payload) {
  logEvent('login-submit (UI-ONLY)', { email: payload.email, passwordLength: payload.password?.length })
}

function handleRegisterSubmit(payload) {
  otpEmail.value = payload.email || 'budi@tokoberkah.com'
  logEvent('register-submit (UI-ONLY)', {
    name: payload.name,
    businessName: payload.businessName,
    email: payload.email,
  })
}

function handleGoogleClick() {
  googleAlertMessage.value = 'Integrasi Google Sign-In Native akan diimplementasikan pada AUTH-M04. Tombol ini tidak memanggil Google SDK atau membuat ID token.'
  showGoogleAlert.value = true
  logEvent('google-click (UI-ONLY)', { provider: 'google', note: 'native integration planned in AUTH-M04' })
}

function handleForgotPassword() {
  logEvent('forgot-password (UI-ONLY)', { action: 'open_modal' })
}

function clearLogs() {
  eventLogs.value = []
}

function goBack() {
  if (window.history.length > 1) {
    router.back()
  } else {
    router.push({ name: 'home' })
  }
}
</script>

<template>
  <div class="min-h-screen bg-zinc-100 text-ink-primary font-sans">
    <!-- Dev Banner Header -->
    <header class="sticky top-0 z-30 border-b border-zinc-200 bg-white/95 backdrop-blur-md px-4 py-3 shadow-xs">
      <div class="mx-auto flex max-w-7xl items-center justify-between gap-4">
        <div class="flex items-center gap-3">
          <button
            type="button"
            class="flex size-9 items-center justify-center rounded-xl border border-zinc-200 text-ink-secondary hover:bg-zinc-100 hover:text-ink-primary"
            data-testid="dev-preview-back-button"
            @click="goBack"
          >
            <AppIcon name="chevron-left" class="size-5" />
          </button>
          <div>
            <div class="flex items-center gap-2">
              <h1 class="text-sm font-bold text-ink-primary sm:text-base">
                Cloud Auth Preview
              </h1>
              <span class="rounded-md bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-800">
                DEV ONLY
              </span>
              <span class="rounded-md bg-primary/10 px-2 py-0.5 text-[10px] font-bold text-primary">
                AUTH-M02 UI-ONLY
              </span>
            </div>
            <p class="text-[11px] text-ink-muted">
              Lingkungan uji visual tanpa request jaringan atau modifikasi session store
            </p>
          </div>
        </div>

        <div class="flex items-center gap-2">
          <button
            type="button"
            class="flex items-center gap-1.5 rounded-xl border border-zinc-200 bg-white px-3 py-1.5 text-xs font-semibold text-ink-secondary hover:bg-zinc-50"
            data-testid="toggle-frame-mode"
            @click="isMobileFrame = !isMobileFrame"
          >
            <AppIcon :name="isMobileFrame ? 'smartphone' : 'monitor'" class="size-4" />
            <span>{{ isMobileFrame ? 'Android View' : 'Fluid View' }}</span>
          </button>
        </div>
      </div>
    </header>

    <!-- Main Content Container -->
    <main class="mx-auto max-w-7xl p-4 sm:p-6 lg:p-8">
      <div class="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <!-- Left Column: Interactive Dev Controls -->
        <aside class="space-y-4 lg:col-span-4">
          <!-- Control Panel Card -->
          <div class="rounded-2xl border border-zinc-200 bg-white p-4 shadow-xs space-y-4">
            <h2 class="text-xs font-bold uppercase tracking-wider text-ink-muted">
              Panel Kontrol State UI
            </h2>

            <!-- Tab Switcher -->
            <div class="space-y-1.5">
              <label class="block text-xs font-semibold text-ink-secondary">Tampilan Aktif</label>
              <div class="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  data-testid="dev-switch-login"
                  :class="[
                    'h-9 rounded-xl text-xs font-semibold border transition',
                    activeTab === 'login'
                      ? 'border-primary bg-primary text-white'
                      : 'border-zinc-200 bg-zinc-50 text-ink-secondary hover:bg-zinc-100',
                  ]"
                  @click="activeTab = 'login'"
                >
                  Form Login
                </button>
                <button
                  type="button"
                  data-testid="dev-switch-register"
                  :class="[
                    'h-9 rounded-xl text-xs font-semibold border transition',
                    activeTab === 'register'
                      ? 'border-primary bg-primary text-white'
                      : 'border-zinc-200 bg-zinc-50 text-ink-secondary hover:bg-zinc-100',
                  ]"
                  @click="activeTab = 'register'"
                >
                  Form Register
                </button>
              </div>
            </div>

            <!-- Loading & Disabled Toggles -->
            <div class="space-y-2 pt-1 border-t border-zinc-100">
              <label class="block text-xs font-semibold text-ink-secondary">State Tombol & Form</label>
              <div class="flex flex-wrap gap-3">
                <label class="flex items-center gap-2 text-xs text-ink-secondary cursor-pointer">
                  <input
                    v-model="isLoading"
                    type="checkbox"
                    data-testid="dev-toggle-loading"
                    class="rounded border-zinc-300 text-primary focus:ring-primary"
                  />
                  <span>Loading State</span>
                </label>
                <label class="flex items-center gap-2 text-xs text-ink-secondary cursor-pointer">
                  <input
                    v-model="isDisabled"
                    type="checkbox"
                    data-testid="dev-toggle-disabled"
                    class="rounded border-zinc-300 text-primary focus:ring-primary"
                  />
                  <span>Disabled State</span>
                </label>
              </div>
            </div>

            <!-- Error State Presets -->
            <div class="space-y-1.5 pt-1 border-t border-zinc-100">
              <label for="dev-error-select" class="block text-xs font-semibold text-ink-secondary">
                Simulasi Pesan Error
              </label>
              <select
                id="dev-error-select"
                v-model="selectedError"
                data-testid="dev-error-selector"
                class="h-10 w-full rounded-xl border border-zinc-200 bg-white px-3 text-xs text-ink-primary outline-none focus:border-primary"
              >
                <option v-for="preset in errorPresets" :key="preset.value" :value="preset.value">
                  {{ preset.label }}
                </option>
              </select>
            </div>

            <!-- OTP Preview Trigger -->
            <div class="space-y-1.5 pt-1 border-t border-zinc-100">
              <label class="block text-xs font-semibold text-ink-secondary">Screen Lanjutan (AUTH-M03)</label>
              <BaseButton
                variant="outline"
                size="sm"
                block
                data-testid="dev-trigger-otp-modal"
                class="h-9 rounded-xl text-xs font-medium"
                @click="showOtpModal = true"
              >
                <AppIcon name="mail" class="mr-1.5 size-4" />
                Lihat Preview OTP Modal
              </BaseButton>
            </div>
          </div>

          <!-- Event Log Monitor -->
          <div class="rounded-2xl border border-zinc-200 bg-white p-4 shadow-xs space-y-3">
            <div class="flex items-center justify-between">
              <h2 class="text-xs font-bold uppercase tracking-wider text-ink-muted">
                Emitted Events Log
              </h2>
              <button
                type="button"
                class="text-[11px] font-semibold text-zinc-400 hover:text-zinc-600"
                @click="clearLogs"
              >
                Bersihkan
              </button>
            </div>

            <div
              v-if="eventLogs.length === 0"
              class="rounded-xl border border-dashed border-zinc-200 p-4 text-center text-xs text-ink-muted"
            >
              Belum ada event lokal yang di-emit. Lakukan interaksi pada form di samping.
            </div>

            <div v-else class="max-h-56 space-y-2 overflow-y-auto pr-1">
              <div
                v-for="log in eventLogs"
                :key="log.id"
                class="rounded-xl border border-zinc-100 bg-zinc-50 p-2.5 text-xs font-mono space-y-1"
              >
                <div class="flex items-center justify-between text-[11px]">
                  <span class="font-bold text-primary">{{ log.name }}</span>
                  <span class="text-zinc-400">{{ log.time }}</span>
                </div>
                <div class="text-[11px] text-zinc-600 break-all whitespace-pre-wrap">
                  {{ log.payload }}
                </div>
              </div>
            </div>

            <p class="text-[10px] text-zinc-400 leading-normal">
              Semua event di atas bersifat presentasional. Tidak ada request HTTP atau mutasi store yang dilakukan.
            </p>
          </div>
        </aside>

        <!-- Right Column: Component Display Frame -->
        <section class="flex flex-col items-center justify-start lg:col-span-8">
          <!-- Android Phone Viewport Simulator Frame -->
          <div
            :class="[
              'transition-all duration-300 w-full flex justify-center',
              isMobileFrame ? 'max-w-[430px]' : 'max-w-2xl',
            ]"
          >
            <div
              :class="[
                'w-full bg-white transition-all overflow-hidden',
                isMobileFrame
                  ? 'rounded-[2.5rem] border-[8px] border-zinc-800 shadow-2xl min-h-[780px] flex flex-col justify-between'
                  : 'rounded-3xl border border-zinc-200 p-6 sm:p-8 shadow-card',
              ]"
            >
              <!-- Android Status Bar Simulation (Only in mobile frame) -->
              <div
                v-if="isMobileFrame"
                class="flex items-center justify-between px-6 pt-3 pb-2 text-[11px] font-semibold text-zinc-700 select-none"
              >
                <span>09:41</span>
                <div class="flex items-center gap-1.5 text-zinc-600">
                  <AppIcon name="wifi" class="size-3.5" />
                  <AppIcon name="battery" class="size-3.5" />
                </div>
              </div>

              <!-- Main Scrollable App Canvas -->
              <div
                :class="[
                  'w-full flex-1 overflow-y-auto',
                  isMobileFrame ? 'px-5 py-6 sm:px-6' : '',
                ]"
              >
                <CloudAuthCard
                  v-model="activeTab"
                  :loading="isLoading"
                  :disabled="isDisabled"
                  :error-message="selectedError"
                  @login-submit="handleLoginSubmit"
                  @register-submit="handleRegisterSubmit"
                  @google-click="handleGoogleClick"
                  @forgot-password="handleForgotPassword"
                />
              </div>

              <!-- Android Home Navigation Indicator Bar (Only in mobile frame) -->
              <div v-if="isMobileFrame" class="pb-2 pt-1 flex justify-center">
                <div class="h-1 w-32 rounded-full bg-zinc-300"></div>
              </div>
            </div>
          </div>
        </section>
      </div>
    </main>

    <!-- Google Sign-In Informational Alert Modal -->
    <div
      v-if="showGoogleAlert"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-xs"
      data-testid="google-info-modal"
    >
      <div class="w-full max-w-sm rounded-3xl border border-zinc-200 bg-white p-6 shadow-xl space-y-4">
        <div class="mx-auto flex size-12 items-center justify-center rounded-2xl bg-zinc-100 text-zinc-700">
          <AppIcon name="info" class="size-6" />
        </div>
        <div class="text-center space-y-1.5">
          <h3 class="text-base font-bold text-ink-primary">
            Informasi Google Sign-In
          </h3>
          <p class="text-xs text-ink-secondary leading-relaxed">
            {{ googleAlertMessage }}
          </p>
        </div>
        <BaseButton
          variant="primary"
          block
          size="lg"
          class="h-11 rounded-2xl text-xs font-semibold"
          @click="showGoogleAlert = false"
        >
          Mengerti
        </BaseButton>
      </div>
    </div>

    <!-- OTP Preview Modal -->
    <CloudOtpPreviewModal
      v-model="showOtpModal"
      :email="otpEmail"
      @close="showOtpModal = false"
    />
  </div>
</template>
