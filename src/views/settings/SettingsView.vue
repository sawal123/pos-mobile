<script setup>
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'

import BaseButton from '@/components/base/BaseButton.vue'
import BaseCard from '@/components/base/BaseCard.vue'
import BaseInput from '@/components/base/BaseInput.vue'
import BaseModal from '@/components/base/BaseModal.vue'
import BaseSheet from '@/components/base/BaseSheet.vue'
import { useBusinessStore } from '@/stores/businessStore'
import { useCashierStore } from '@/stores/cashierStore'

const businessStore = useBusinessStore()
const cashierStore = useCashierStore()
const router = useRouter()

const showProfileModal = ref(false)
const showActionSheet = ref(false)

const businessSummary = computed(() => [
  { label: 'Nama Toko', value: businessStore.name || '-' },
  { label: 'Jenis Bisnis', value: businessStore.type || '-' },
  { label: 'Owner', value: businessStore.owner || '-' },
  { label: 'Nomor Telepon', value: businessStore.phone || '-' },
  { label: 'Outlet', value: businessStore.outlet || '-' },
  { label: 'Mode', value: businessStore.mode === 'cloud' ? 'Cloud' : 'Free' },
  { label: 'PIN Kasir', value: cashierStore.activeCashier.pinConfigured ? 'Sudah diatur' : 'Belum diatur' },
])
</script>

<template>
  <div class="mx-auto max-w-3xl space-y-5">
    <div>
      <p class="text-sm font-medium uppercase tracking-[0.18em] text-primary">Settings</p>
      <h2 class="mt-2 text-2xl font-semibold text-ink-primary">Pengaturan aplikasi</h2>
    </div>

    <BaseCard class="space-y-4">
      <div
        v-for="item in businessSummary"
        :key="item.label"
        class="flex items-center justify-between rounded-2xl bg-surface px-4 py-3"
      >
        <span class="text-sm text-ink-secondary">{{ item.label }}</span>
        <span class="font-medium text-ink-primary">{{ item.value }}</span>
      </div>

      <div class="flex flex-wrap gap-3">
        <BaseButton variant="secondary" @click="showProfileModal = true">Edit Profil</BaseButton>
        <BaseButton variant="secondary" @click="router.push('/customers')">Kelola Pelanggan</BaseButton>
        <BaseButton variant="secondary" @click="router.push('/expenses')">Kelola Pengeluaran</BaseButton>
        <BaseButton variant="ghost" @click="showActionSheet = true">Aksi Lainnya</BaseButton>
      </div>
    </BaseCard>

    <BaseModal :open="showProfileModal" title="Preview Input Pengaturan" @close="showProfileModal = false">
      <div class="space-y-4">
        <BaseInput :model-value="businessStore.name" label="Nama Toko" />
        <BaseInput :model-value="businessStore.type" label="Jenis Bisnis" />
        <BaseInput :model-value="businessStore.owner" label="Owner" />
        <BaseInput :model-value="businessStore.outlet" label="Outlet" />
      </div>
    </BaseModal>

    <BaseSheet :open="showActionSheet" title="Shortcut Pengaturan" @close="showActionSheet = false">
      <div class="grid gap-3">
        <BaseButton block variant="secondary" @click="router.push('/customers')">Kelola Pelanggan</BaseButton>
        <BaseButton block variant="secondary" @click="router.push('/expenses')">Kelola Pengeluaran</BaseButton>
        <BaseButton block variant="secondary">Export Data</BaseButton>
        <BaseButton block variant="secondary">Sinkronisasi</BaseButton>
        <BaseButton block variant="danger" @click="showActionSheet = false">Tutup</BaseButton>
      </div>
    </BaseSheet>
  </div>
</template>
