<script setup>
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'

import BaseButton from '@/components/base/BaseButton.vue'
import BaseCard from '@/components/base/BaseCard.vue'
import BaseInput from '@/components/base/BaseInput.vue'
import BaseModal from '@/components/base/BaseModal.vue'
import BaseSheet from '@/components/base/BaseSheet.vue'
import {
  RESTORE_CONFIRMATION_MESSAGE,
  createBackupPayload,
  downloadBackupFile,
  restoreBackupPayload,
  validateBackupPayload,
} from '@/services/backupService'
import { useBusinessStore } from '@/stores/businessStore'
import { useCartStore } from '@/stores/cartStore'
import { useCashStore } from '@/stores/cashStore'
import { useCashierStore } from '@/stores/cashierStore'
import { useCustomerStore } from '@/stores/customerStore'
import { useExpenseStore } from '@/stores/expenseStore'
import { useProductStore } from '@/stores/productStore'
import { useShiftStore } from '@/stores/shiftStore'
import { useTransactionStore } from '@/stores/transactionStore'
import { formatCurrency, formatDateTime } from '@/utils/formatters'

const businessStore = useBusinessStore()
const cartStore = useCartStore()
const cashStore = useCashStore()
const cashierStore = useCashierStore()
const customerStore = useCustomerStore()
const expenseStore = useExpenseStore()
const productStore = useProductStore()
const shiftStore = useShiftStore()
const transactionStore = useTransactionStore()
const router = useRouter()

const showProfileModal = ref(false)
const showActionSheet = ref(false)
const backupInputRef = ref(null)
const feedbackType = ref('success')
const feedbackMessage = ref('')
const cashForm = ref({
  type: 'in',
  amount: '',
  category: 'Modal',
  note: '',
})
const cashError = ref('')

const businessSummary = computed(() => [
  { label: 'Nama Toko', value: businessStore.name || '-' },
  { label: 'Jenis Bisnis', value: businessStore.normalizedType || '-' },
  { label: 'Owner', value: businessStore.owner || '-' },
  { label: 'Nomor Telepon', value: businessStore.phone || '-' },
  { label: 'Outlet', value: businessStore.outlet || '-' },
  { label: 'Mode', value: businessStore.mode === 'cloud' ? 'Cloud' : 'Free' },
  { label: 'PIN Kasir', value: cashierStore.activeCashier.pinConfigured ? 'Sudah diatur' : 'Belum diatur' },
])

function getStoreContext() {
  return {
    businessStore,
    productStore,
    customerStore,
    expenseStore,
    transactionStore,
    cashStore,
    cartStore,
    shiftStore,
  }
}

function setFeedback(type, message) {
  feedbackType.value = type
  feedbackMessage.value = message
}

function handleBackup() {
  const payload = createBackupPayload(getStoreContext())
  downloadBackupFile(payload)
  setFeedback('success', 'Backup berhasil dibuat.')
}

function handleManualCash() {
  cashError.value = ''

  const result = cashStore.recordEntry({
    type: cashForm.value.type,
    amount: cashForm.value.amount,
    category: cashForm.value.category,
    note: cashForm.value.note,
  })

  if (!result.success) {
    cashError.value = result.error
    return
  }

  cashForm.value.amount = ''
  cashForm.value.note = ''
  setFeedback('success', 'Transaksi kas berhasil dicatat.')
}

function handleRestoreClick() {
  if (shiftStore.isOpen) {
    setFeedback('error', 'Restore backup tidak dapat dilakukan saat shift aktif. Tutup shift terlebih dahulu.')
    return
  }

  backupInputRef.value?.click()
}

async function handleRestoreFileChange(event) {
  const input = event.target
  const [file] = input.files ?? []

  if (!file) {
    input.value = ''
    return
  }

  try {
    const text = await file.text()
    let payload

    try {
      payload = JSON.parse(text)
    } catch {
      setFeedback('error', 'File backup tidak valid.')
      return
    }

    const validation = validateBackupPayload(payload)

    if (!validation.valid) {
      setFeedback('error', validation.error)
      return
    }

    if (!window.confirm(RESTORE_CONFIRMATION_MESSAGE)) {
      return
    }

    const result = restoreBackupPayload(payload, getStoreContext())

    if (!result.success) {
      setFeedback('error', result.error)
      return
    }

    setFeedback('success', 'Backup berhasil dipulihkan.')
  } finally {
    input.value = ''
  }
}
</script>

<template>
  <div class="mx-auto max-w-3xl space-y-5">
    <input
      ref="backupInputRef"
      class="hidden"
      type="file"
      accept=".json,application/json"
      @change="handleRestoreFileChange"
    />

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
        <BaseButton id="settings-cloud-btn" variant="secondary" @click="router.push('/cloud')">Cloud Login</BaseButton>
        <BaseButton variant="ghost" @click="showActionSheet = true">Aksi Lainnya</BaseButton>
      </div>
    </BaseCard>

    <BaseCard class="space-y-4">
      <div class="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <p class="text-sm font-medium uppercase tracking-[0.18em] text-primary">Kas Offline</p>
          <h3 class="mt-2 text-xl font-semibold text-ink-primary">Saldo Kas Tunai</h3>
          <p class="mt-1 text-sm text-ink-secondary">Catat modal, pembelian bahan, listrik, gaji, dan biaya operasional.</p>
        </div>
        <div class="rounded-2xl bg-surface px-4 py-3 text-right">
          <p class="text-xs uppercase tracking-[0.16em] text-ink-secondary">Saldo Berjalan</p>
          <p class="mt-1 text-2xl font-semibold text-ink-primary">{{ formatCurrency(cashStore.balance) }}</p>
        </div>
      </div>

      <p v-if="cashError" class="rounded-2xl bg-danger/10 px-4 py-3 text-sm text-danger">
        {{ cashError }}
      </p>

      <div class="grid gap-3 md:grid-cols-[0.8fr_1fr_1fr]">
        <label class="flex flex-col gap-2">
          <span class="text-sm font-medium text-ink-secondary">Tipe</span>
          <select
            v-model="cashForm.type"
            class="h-12 rounded-2xl border border-zinc-200 bg-white px-4 text-sm text-ink-primary outline-none transition focus:border-primary focus:ring-4 focus:ring-primary/10"
          >
            <option value="in">Kas Masuk</option>
            <option value="out">Kas Keluar</option>
          </select>
        </label>
        <BaseInput
          :model-value="cashForm.amount"
          label="Nominal"
          type="number"
          placeholder="0"
          @update:model-value="cashForm.amount = $event"
        />
        <BaseInput
          :model-value="cashForm.category"
          label="Kategori"
          placeholder="Modal, Bahan, Listrik, Gaji"
          @update:model-value="cashForm.category = $event"
        />
        <div class="md:col-span-2">
          <BaseInput
            :model-value="cashForm.note"
            label="Catatan"
            placeholder="Catatan transaksi kas"
            @update:model-value="cashForm.note = $event"
          />
        </div>
        <div class="flex items-end">
          <BaseButton block @click="handleManualCash">Catat Kas</BaseButton>
        </div>
      </div>

      <div class="grid gap-3 md:grid-cols-3">
        <div class="rounded-2xl bg-emerald-50 px-4 py-3">
          <p class="text-sm text-emerald-700">Kas Masuk</p>
          <p class="mt-1 font-semibold text-emerald-700">{{ formatCurrency(cashStore.cashIn) }}</p>
        </div>
        <div class="rounded-2xl bg-red-50 px-4 py-3">
          <p class="text-sm text-red-700">Kas Keluar</p>
          <p class="mt-1 font-semibold text-red-700">{{ formatCurrency(cashStore.cashOut) }}</p>
        </div>
        <div class="rounded-2xl bg-surface px-4 py-3">
          <p class="text-sm text-ink-secondary">Jumlah Transaksi</p>
          <p class="mt-1 font-semibold text-ink-primary">{{ cashStore.entries.length }}</p>
        </div>
      </div>

      <div v-if="cashStore.entries.length" class="space-y-2">
        <div
          v-for="entry in cashStore.entries.slice(0, 5)"
          :key="entry.id"
          class="flex flex-col gap-2 rounded-2xl border border-zinc-200 bg-white p-4 md:flex-row md:items-center md:justify-between"
        >
          <div>
            <p class="font-medium text-ink-primary">{{ entry.category }}</p>
            <p class="text-sm text-ink-secondary">{{ entry.note || '-' }} &bull; {{ formatDateTime(entry.createdAt) }}</p>
          </div>
          <p class="font-semibold" :class="entry.type === 'in' ? 'text-success' : 'text-danger'">
            {{ entry.type === 'in' ? '+' : '-' }}{{ formatCurrency(entry.amount) }}
          </p>
        </div>
      </div>
    </BaseCard>

    <BaseModal :open="showProfileModal" title="Preview Input Pengaturan" @close="showProfileModal = false">
      <div class="space-y-4">
        <BaseInput :model-value="businessStore.name" label="Nama Toko" />
        <BaseInput :model-value="businessStore.normalizedType" label="Jenis Bisnis" />
        <BaseInput :model-value="businessStore.owner" label="Owner" />
        <BaseInput :model-value="businessStore.outlet" label="Outlet" />
      </div>
    </BaseModal>

    <BaseSheet :open="showActionSheet" title="Shortcut Pengaturan" @close="showActionSheet = false">
      <div class="grid gap-3">
        <p
          v-if="feedbackMessage"
          class="rounded-2xl px-4 py-3 text-sm"
          :class="feedbackType === 'error' ? 'bg-danger/10 text-danger' : 'bg-emerald-100 text-emerald-700'"
        >
          {{ feedbackMessage }}
        </p>
        <BaseButton block variant="secondary" @click="router.push('/customers')">Kelola Pelanggan</BaseButton>
        <BaseButton block variant="secondary" @click="router.push('/expenses')">Kelola Pengeluaran</BaseButton>
        <BaseButton block variant="secondary" @click="handleBackup">Backup Data</BaseButton>
        <BaseButton block variant="secondary" @click="handleRestoreClick">Restore Backup</BaseButton>
        <BaseButton block variant="secondary">Sinkronisasi</BaseButton>
        <BaseButton block variant="danger" @click="showActionSheet = false">Tutup</BaseButton>
      </div>
    </BaseSheet>
  </div>
</template>
