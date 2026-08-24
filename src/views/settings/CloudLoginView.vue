<script setup>
import { ref, computed, onMounted } from 'vue'
import { Capacitor } from '@capacitor/core'

import BaseButton from '@/components/base/BaseButton.vue'
import BaseInput from '@/components/base/BaseInput.vue'
import BaseCard from '@/components/base/BaseCard.vue'
import { useCloudSessionStore } from '@/stores/cloudSessionStore'

const cloudStore = useCloudSessionStore()

// ── Form state ──────────────────────────────────────────────────────────────
const email = ref('')
const password = ref('')
const step = ref('login') // 'login' | 'select-business' | 'select-outlet' | 'done'

// ── Derived ─────────────────────────────────────────────────────────────────
const isZeroBusiness = computed(
  () =>
    cloudStore.isAuthenticated &&
    (cloudStore.hasResolvedZeroBusiness ||
      (cloudStore.hasResolvedBusinessContext && cloudStore.businesses.length === 0)) &&
    !cloudStore.selectedBusiness,
)

const activeBusinessOutlets = computed(() => {
  const biz = cloudStore.businesses.find((b) => b.id === cloudStore.selectedBusiness?.id)
  return (biz?.outlets ?? []).filter((o) => o.status === 'active')
})

const zeroActiveOutlets = computed(
  () => step.value === 'select-outlet' && activeBusinessOutlets.value.length === 0,
)

// ── Helpers ─────────────────────────────────────────────────────────────────
function getPlatform() {
  try {
    const p = Capacitor.getPlatform()
    if (p === 'android' || p === 'ios') return p
  } catch {
    // web / test
  }
  return null
}

// ── Login flow ───────────────────────────────────────────────────────────────
async function handleLogin() {
  if (!email.value || !password.value) return

  const result = await cloudStore.login(email.value, password.value)

  if (!result.ok) return

  const { businesses } = result

  if (businesses.length === 0) {
    step.value = 'done'
    return
  }

  if (businesses.length === 1) {
    await cloudStore.selectBusiness(businesses[0].id)
    await advanceAfterBusiness(businesses[0])
    return
  }

  step.value = 'select-business'
}

async function handleSelectBusiness(businessId) {
  const result = await cloudStore.selectBusiness(businessId)
  if (!result.ok) return

  const biz = cloudStore.businesses.find((b) => b.id === businessId)
  await advanceAfterBusiness(biz)
}

async function advanceAfterBusiness(biz) {
  if (!biz.cloud_access) {
    step.value = 'done'
    return
  }

  const actOutlets = (biz.outlets ?? []).filter((o) => o.status === 'active')

  if (actOutlets.length === 0) {
    step.value = 'select-outlet' // zero-outlet error shown
    return
  }

  if (actOutlets.length === 1) {
    const outletResult = await cloudStore.selectOutlet(actOutlets[0].id)
    if (!outletResult.ok) return
    await tryRegisterDevice()
    return
  }

  step.value = 'select-outlet'
}

async function handleSelectOutlet(outletId) {
  const result = await cloudStore.selectOutlet(outletId)
  if (!result.ok) return
  await tryRegisterDevice()
}

async function tryRegisterDevice() {
  await cloudStore.doRegisterDevice({ platform: getPlatform() })
  step.value = 'done'
}

async function handleLogout() {
  await cloudStore.logout()
  email.value = ''
  password.value = ''
  step.value = 'login'
}

// Sync context to adapter on mount (if already hydrated)
onMounted(() => {
  if (cloudStore.isAuthenticated) {
    step.value = 'done'
  }
})
</script>

<template>
  <div class="mx-auto max-w-3xl space-y-5">
    <div>
      <p class="text-sm font-medium uppercase tracking-[0.18em] text-primary">Cloud</p>
      <h2 class="mt-2 text-2xl font-semibold text-ink-primary">Cloud Login</h2>
    </div>

    <!-- ZERO BUSINESS STATE (Reachable when authenticated but has 0 businesses) -->
    <BaseCard
      v-if="isZeroBusiness"
      id="cloud-no-business"
      class="space-y-3"
    >
      <p class="rounded-2xl bg-danger/10 px-4 py-3 text-sm text-danger">
        Akun Anda belum memiliki Business. Buat Business terlebih dahulu di dashboard web.
      </p>
      <BaseButton
        id="cloud-logout-btn"
        variant="danger"
        :loading="cloudStore.loading"
        @click="handleLogout"
      >
        Logout Cloud
      </BaseButton>
    </BaseCard>

    <!-- LOGGED IN STATE -->
    <BaseCard
      v-else-if="cloudStore.isAuthenticated && step === 'done'"
      id="cloud-logged-in"
      class="space-y-4"
    >
      <div class="space-y-2">
        <div class="flex items-center justify-between rounded-2xl bg-surface px-4 py-3">
          <span class="text-sm text-ink-secondary">Email</span>
          <span class="font-medium text-ink-primary">{{ cloudStore.user?.email ?? '-' }}</span>
        </div>
        <div class="flex items-center justify-between rounded-2xl bg-surface px-4 py-3">
          <span class="text-sm text-ink-secondary">Business</span>
          <span class="font-medium text-ink-primary">{{ cloudStore.selectedBusiness?.name ?? '-' }}</span>
        </div>
        <div class="flex items-center justify-between rounded-2xl bg-surface px-4 py-3">
          <span class="text-sm text-ink-secondary">Outlet</span>
          <span class="font-medium text-ink-primary">{{ cloudStore.selectedOutlet?.name ?? '-' }}</span>
        </div>
        <div class="flex items-center justify-between rounded-2xl bg-surface px-4 py-3">
          <span class="text-sm text-ink-secondary">Cloud Access</span>
          <span
            class="font-medium"
            :class="cloudStore.cloudAccess ? 'text-emerald-600' : 'text-danger'"
          >
            {{ cloudStore.cloudAccess ? 'Aktif' : 'Tidak aktif' }}
          </span>
        </div>
        <div
          v-if="cloudStore.isDeviceRegistered"
          class="flex items-center justify-between rounded-2xl bg-surface px-4 py-3"
        >
          <span class="text-sm text-ink-secondary">Device</span>
          <span class="font-medium text-emerald-600">Terdaftar</span>
        </div>
      </div>

      <!-- Cloud access warning -->
      <p
        v-if="!cloudStore.cloudAccess"
        id="cloud-no-access-notice"
        class="rounded-2xl bg-amber-50 px-4 py-3 text-sm text-amber-700"
      >
        Subscription Anda tidak memiliki akses Cloud Sync. POS lokal tetap dapat digunakan.
      </p>

      <!-- Device registration error -->
      <p
        v-if="cloudStore.error && step === 'done'"
        id="cloud-device-error"
        class="rounded-2xl bg-danger/10 px-4 py-3 text-sm text-danger"
      >
        {{ cloudStore.error }}
      </p>

      <BaseButton
        id="cloud-logout-btn"
        variant="danger"
        :loading="cloudStore.loading"
        @click="handleLogout"
      >
        Logout Cloud
      </BaseButton>
    </BaseCard>

    <!-- SELECT BUSINESS -->
    <BaseCard v-else-if="step === 'select-business'" id="cloud-select-business" class="space-y-3">
      <p class="text-sm font-medium text-ink-primary">Pilih Business</p>
      <div
        v-for="biz in cloudStore.businesses"
        :key="biz.id"
        class="flex cursor-pointer items-center justify-between rounded-2xl bg-surface px-4 py-3 hover:bg-surface/80"
        :id="`cloud-business-${biz.id}`"
        @click="handleSelectBusiness(biz.id)"
      >
        <span class="font-medium text-ink-primary">{{ biz.name }}</span>
        <span class="text-sm text-ink-secondary">Pilih →</span>
      </div>

      <p v-if="cloudStore.error" class="rounded-2xl bg-danger/10 px-4 py-3 text-sm text-danger">
        {{ cloudStore.error }}
      </p>
    </BaseCard>

    <!-- SELECT OUTLET -->
    <BaseCard v-else-if="step === 'select-outlet'" id="cloud-select-outlet" class="space-y-3">
      <p class="text-sm font-medium text-ink-primary">Pilih Outlet</p>

      <p
        v-if="zeroActiveOutlets"
        id="cloud-no-active-outlet"
        class="rounded-2xl bg-danger/10 px-4 py-3 text-sm text-danger"
      >
        Tidak ada outlet aktif untuk business ini. Aktifkan outlet terlebih dahulu di dashboard web.
      </p>

      <template v-else>
        <div
          v-for="outlet in activeBusinessOutlets"
          :key="outlet.id"
          class="flex cursor-pointer items-center justify-between rounded-2xl bg-surface px-4 py-3 hover:bg-surface/80"
          :id="`cloud-outlet-${outlet.id}`"
          @click="handleSelectOutlet(outlet.id)"
        >
          <span class="font-medium text-ink-primary">{{ outlet.name }}</span>
          <span class="text-sm text-ink-secondary">Pilih →</span>
        </div>
      </template>

      <p v-if="cloudStore.error" class="rounded-2xl bg-danger/10 px-4 py-3 text-sm text-danger">
        {{ cloudStore.error }}
      </p>
    </BaseCard>

    <!-- LOGIN FORM -->
    <BaseCard v-else class="space-y-4" id="cloud-login-form">
      <BaseInput
        id="cloud-email"
        v-model="email"
        label="Email"
        type="email"
        placeholder="email@domain.com"
        :disabled="cloudStore.loading"
      />

      <BaseInput
        id="cloud-password"
        v-model="password"
        label="Password"
        type="password"
        placeholder="••••••••"
        :disabled="cloudStore.loading"
      />

      <p
        v-if="cloudStore.error"
        id="cloud-login-error"
        class="rounded-2xl bg-danger/10 px-4 py-3 text-sm text-danger"
      >
        {{ cloudStore.error }}
      </p>

      <BaseButton
        id="cloud-login-btn"
        block
        :loading="cloudStore.loading"
        :disabled="!email || !password || cloudStore.loading"
        @click="handleLogin"
      >
        Login Cloud
      </BaseButton>
    </BaseCard>
  </div>
</template>
