<script setup>
import { computed } from 'vue'
import { useRouter } from 'vue-router'

import AppIcon from '@/components/base/AppIcon.vue'
import BaseButton from '@/components/base/BaseButton.vue'
import BaseModal from '@/components/base/BaseModal.vue'
import { SYNC_LOCK_REASON, useSyncAccess } from '@/composables/useSyncAccess'
import { useCloudSessionStore } from '@/stores/cloudSessionStore'

defineProps({
  open: {
    type: Boolean,
    default: false,
  },
})

const emit = defineEmits(['close'])

const router = useRouter()
const cloudStore = useCloudSessionStore()
const { isAuthenticated, isCashier, syncLockReason } = useSyncAccess()

const isUnauthenticated = computed(
  () => syncLockReason.value === SYNC_LOCK_REASON.UNAUTHENTICATED_FREE || !isAuthenticated.value,
)

function handleOpenSettings() {
  emit('close')
  router.push({ name: 'settings', query: { section: 'cloud' } })
}

function handleUpgradeCloud() {
  emit('close')
  if (isCashier.value) return
  router.push({ name: cloudStore.isLinked ? 'my-subscription' : 'subscription' })
}
</script>

<template>
  <BaseModal :open="open" title="Menu Sinkronisasi Terkunci" @close="emit('close')">
    <div class="space-y-4" data-testid="sync-locked-modal">
      <div
        class="flex items-start gap-3.5 rounded-2xl border border-amber-200/90 bg-amber-50/80 p-4 dark:border-amber-500/30 dark:bg-amber-950/35"
      >
        <span
          class="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-amber-100 text-amber-600 dark:bg-amber-500/20 dark:text-amber-300"
        >
          <AppIcon name="lock" class="h-5 w-5" />
        </span>

        <div class="min-w-0 space-y-1">
          <div class="flex flex-wrap items-center gap-1.5">
            <p class="text-sm font-bold text-ink-primary" data-testid="sync-locked-heading">
              {{
                isUnauthenticated
                  ? 'Belum Login & Paket Masih Free'
                  : 'Memerlukan Upgrade Paket Cloud'
              }}
            </p>
            <span
              class="inline-flex items-center gap-1 rounded-full bg-amber-200/70 px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wide text-amber-800 dark:bg-amber-500/25 dark:text-amber-200"
            >
              Cloud
            </span>
          </div>

          <p class="text-xs leading-relaxed text-ink-secondary" data-testid="sync-locked-message">
            <template v-if="isUnauthenticated">
              Menu Sinkronisasi terkunci karena Anda belum login ke Akun Cloud dan masih menggunakan
              mode Free. Silakan login Akun Cloud melalui menu Pengaturan dan upgrade ke Paket Cloud
              untuk mengaktifkan sinkronisasi data.
            </template>
            <template v-else>
              Menu Sinkronisasi terkunci karena akun Anda masih menggunakan paket Free (atau
              langganan belum aktif). Upgrade ke Paket Cloud untuk menyinkronkan transaksi, stok,
              dan menu ke server &amp; dashboard.
            </template>
          </p>
        </div>
      </div>

      <div
        class="flex items-start gap-2.5 rounded-2xl border border-zinc-200/80 bg-surface/60 p-3.5 text-xs dark:border-slate-700/60"
      >
        <AppIcon name="settings" class="mt-0.5 h-4 w-4 shrink-0 text-primary" />
        <p class="leading-relaxed text-ink-secondary">
          Seluruh pengaturan <strong class="font-semibold text-ink-primary">Login</strong> dan
          <strong class="font-semibold text-ink-primary">Logout</strong> Akun Cloud terletak di menu
          <strong class="font-semibold text-ink-primary">Pengaturan &rarr; Akun Cloud</strong>.
        </p>
      </div>

      <div class="flex flex-col gap-2 pt-1">
        <template v-if="isUnauthenticated">
          <BaseButton
            block
            data-testid="sync-locked-go-settings-btn"
            @click="handleOpenSettings"
          >
            <AppIcon name="settings" class="h-4 w-4" />
            <span>Buka Pengaturan (Login Cloud)</span>
          </BaseButton>
          <BaseButton
            v-if="!isCashier"
            variant="secondary"
            block
            data-testid="sync-locked-upgrade-btn"
            @click="handleUpgradeCloud"
          >
            <AppIcon name="cloud" class="h-4 w-4" />
            <span>Lihat Paket Cloud</span>
          </BaseButton>
        </template>

        <template v-else>
          <BaseButton
            v-if="!isCashier"
            block
            data-testid="sync-locked-upgrade-btn"
            @click="handleUpgradeCloud"
          >
            <AppIcon name="cloud" class="h-4 w-4" />
            <span>Upgrade ke Paket Cloud</span>
          </BaseButton>
          <BaseButton
            variant="secondary"
            block
            data-testid="sync-locked-go-settings-btn"
            @click="handleOpenSettings"
          >
            <AppIcon name="settings" class="h-4 w-4" />
            <span>Buka Pengaturan Akun</span>
          </BaseButton>
        </template>

        <BaseButton variant="ghost" block @click="emit('close')"> Tutup </BaseButton>
      </div>
    </div>
  </BaseModal>
</template>
