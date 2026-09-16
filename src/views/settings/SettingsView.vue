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
import {
  isNativePrinterPlatform,
  listPairedPrinters,
  printTestReceipt,
} from '@/services/printer/bluetoothPrinterService'
import { SUPPORTED_PAPER_WIDTHS } from '@/services/printer/escposReceiptBuilder'
import { useBusinessStore } from '@/stores/businessStore'
import { useCartStore } from '@/stores/cartStore'
import { useCashStore } from '@/stores/cashStore'
import { useCashierStore } from '@/stores/cashierStore'
import { useCustomerStore } from '@/stores/customerStore'
import { useExpenseStore } from '@/stores/expenseStore'
import { usePrinterStore } from '@/stores/printerStore'
import { useProductStore } from '@/stores/productStore'
import { useShiftStore } from '@/stores/shiftStore'
import { useTransactionStore } from '@/stores/transactionStore'

const businessStore = useBusinessStore()
const cartStore = useCartStore()
const cashStore = useCashStore()
const cashierStore = useCashierStore()
const customerStore = useCustomerStore()
const expenseStore = useExpenseStore()
const printerStore = usePrinterStore()
const productStore = useProductStore()
const shiftStore = useShiftStore()
const transactionStore = useTransactionStore()
const router = useRouter()

const showProfileModal = ref(false)
const showActionSheet = ref(false)
const showPrinterSheet = ref(false)
const backupInputRef = ref(null)
const feedbackType = ref('success')
const feedbackMessage = ref('')

const printerDevices = ref([])
const printerBusy = ref(false)
const printerFeedbackType = ref('success')
const printerFeedbackMessage = ref('')

const isNativePrinter = computed(() => isNativePrinterPlatform())
const paperWidths = SUPPORTED_PAPER_WIDTHS
const printerStatusText = computed(() => (
  printerStore.hasSelectedPrinter
    ? (printerStore.selectedPrinter.name || printerStore.selectedPrinter.address)
    : 'Belum memilih printer'
))

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

function setPrinterFeedback(type, message) {
  printerFeedbackType.value = type
  printerFeedbackMessage.value = message
}

function buildBusinessSnapshot() {
  return {
    name: businessStore.name || '-',
    outlet: businessStore.outlet || '-',
    phone: businessStore.phone || '',
  }
}

// Permission/Bluetooth errors are requested here (not at startup).
async function handleSelectPrinterClick() {
  printerBusy.value = true
  setPrinterFeedback('success', '')

  try {
    const result = await listPairedPrinters()

    if (!result.success) {
      printerDevices.value = []
      setPrinterFeedback('error', result.message)
      return
    }

    if (!result.native) {
      printerDevices.value = []
      setPrinterFeedback('error', 'Pilih printer hanya tersedia di perangkat Android.')
      return
    }

    printerDevices.value = result.devices
    showPrinterSheet.value = true

    if (!result.devices.length) {
      setPrinterFeedback('error', 'Tidak ada printer Bluetooth yang sudah dipairing.')
    }
  } finally {
    printerBusy.value = false
  }
}

function handlePrinterSelected(device) {
  printerStore.selectPrinter(device)
  showPrinterSheet.value = false
  setPrinterFeedback('success', `Printer ${device.name || device.address} dipilih.`)
}

function handlePaperWidthChange(width) {
  printerStore.setPaperWidth(width)
}

function handleForgetPrinter() {
  printerStore.clearPrinter()
  setPrinterFeedback('success', 'Printer dilupakan.')
}

async function handleTestPrint() {
  if (!printerStore.hasSelectedPrinter) {
    setPrinterFeedback('error', 'Printer Bluetooth belum dipilih.')
    return
  }

  printerBusy.value = true

  try {
    const result = await printTestReceipt({
      printer: printerStore.selectedPrinter,
      paperWidth: printerStore.paperWidth,
      business: buildBusinessSnapshot(),
    })

    if (!result.success) {
      setPrinterFeedback('error', result.message)
      return
    }

    setPrinterFeedback('success', 'Perintah tes print dikirim ke printer.')
  } finally {
    printerBusy.value = false
  }
}

function handleBackup() {
  const payload = createBackupPayload(getStoreContext())
  downloadBackupFile(payload)
  setFeedback('success', 'Backup berhasil dibuat.')
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

    <BaseCard class="space-y-4" data-testid="printer-settings-card">
      <div class="flex items-center justify-between">
        <h3 class="text-base font-semibold text-ink-primary">Printer Bluetooth</h3>
        <span class="text-xs text-ink-secondary">Android</span>
      </div>

      <div class="rounded-2xl bg-surface px-4 py-3">
        <p class="text-xs text-ink-secondary">Status</p>
        <p class="text-sm font-medium text-ink-primary" data-testid="printer-status">
          {{ printerStatusText }}
        </p>
        <p
          v-if="printerStore.hasSelectedPrinter"
          class="text-xs text-ink-secondary"
          data-testid="printer-address"
        >
          {{ printerStore.selectedPrinter.address }}
        </p>
      </div>

      <div>
        <p class="text-xs font-medium text-ink-secondary">Paper</p>
        <div class="mt-2 grid grid-cols-2 gap-2">
          <button
            v-for="width in paperWidths"
            :key="width"
            type="button"
            :data-testid="`paper-width-${width}`"
            class="h-12 rounded-2xl border text-sm font-semibold transition"
            :class="printerStore.paperWidth === width
              ? 'border-primary bg-primary/10 text-primary'
              : 'border-zinc-200 bg-white text-ink-secondary'"
            @click="handlePaperWidthChange(width)"
          >
            {{ width }} mm
          </button>
        </div>
      </div>

      <p
        v-if="printerFeedbackMessage"
        class="rounded-2xl px-4 py-3 text-sm"
        :class="printerFeedbackType === 'error' ? 'bg-danger/10 text-danger' : 'bg-emerald-100 text-emerald-700'"
        data-testid="printer-feedback"
      >
        {{ printerFeedbackMessage }}
      </p>

      <div class="flex flex-wrap gap-3">
        <BaseButton
          variant="secondary"
          :disabled="printerBusy"
          data-testid="btn-select-printer"
          @click="handleSelectPrinterClick"
        >
          Pilih Printer
        </BaseButton>
        <BaseButton
          variant="secondary"
          :disabled="printerBusy || !printerStore.hasSelectedPrinter || !isNativePrinter"
          data-testid="btn-test-print"
          @click="handleTestPrint"
        >
          Tes Print
        </BaseButton>
        <BaseButton
          variant="ghost"
          :disabled="!printerStore.hasSelectedPrinter"
          data-testid="btn-forget-printer"
          @click="handleForgetPrinter"
        >
          Lupakan Printer
        </BaseButton>
      </div>

      <p v-if="!isNativePrinter" class="text-xs text-ink-secondary">
        Tes print Bluetooth hanya tersedia di perangkat Android.
      </p>
    </BaseCard>

    <BaseModal :open="showProfileModal" title="Preview Input Pengaturan" @close="showProfileModal = false">
      <div class="space-y-4">
        <BaseInput :model-value="businessStore.name" label="Nama Toko" />
        <BaseInput :model-value="businessStore.normalizedType" label="Jenis Bisnis" />
        <BaseInput :model-value="businessStore.owner" label="Owner" />
        <BaseInput :model-value="businessStore.outlet" label="Outlet" />
      </div>
    </BaseModal>

    <BaseSheet :open="showPrinterSheet" title="Pilih Printer Bluetooth" @close="showPrinterSheet = false">
      <div class="grid gap-2">
        <template v-if="printerDevices.length">
          <button
            v-for="device in printerDevices"
            :key="device.address"
            type="button"
            :data-testid="`printer-device-${device.address}`"
            class="flex min-h-12 w-full flex-col items-start justify-center rounded-2xl border border-zinc-200 px-4 py-2 text-left transition active:bg-zinc-100"
            @click="handlePrinterSelected(device)"
          >
            <span class="text-sm font-semibold text-ink-primary">{{ device.name || 'Tanpa nama' }}</span>
            <span class="text-xs text-ink-secondary">{{ device.address }}</span>
          </button>
        </template>

        <template v-else>
          <p class="text-sm text-ink-secondary" data-testid="printer-empty-message">
            Tidak ada printer Bluetooth yang sudah dipairing.
          </p>
          <p class="text-sm text-ink-secondary">
            Pair printer melalui pengaturan Bluetooth Android terlebih dahulu.
          </p>
        </template>
      </div>
    </BaseSheet>

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
