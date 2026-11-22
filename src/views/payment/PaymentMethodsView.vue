<script setup>
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'

import AppIcon from '@/components/base/AppIcon.vue'
import BaseButton from '@/components/base/BaseButton.vue'
import BaseCard from '@/components/base/BaseCard.vue'
import BaseInput from '@/components/base/BaseInput.vue'
import BaseModal from '@/components/base/BaseModal.vue'
import { useCloudSessionStore } from '@/stores/cloudSessionStore'
import { usePaymentMethodStore } from '@/stores/paymentMethodStore'

const router = useRouter()
const cloudStore = useCloudSessionStore()
const paymentStore = usePaymentMethodStore()

const isCashier = computed(
  () => cloudStore.role === 'cashier' || cloudStore.isCashierContext === true,
)

const searchQuery = ref('')
const message = ref('')
const error = ref('')

const isAddModalOpen = ref(false)
const isEditModalOpen = ref(false)
const isDeleteModalOpen = ref(false)

const form = ref({
  name: '',
  type: 'transfer',
  description: '',
  accountNumber: '',
  accountHolder: '',
  isActive: true,
})

const editingId = ref(null)
const methodToDelete = ref(null)

const typeOptions = [
  { value: 'cash', label: 'Tunai (Cash)' },
  { value: 'qris', label: 'QRIS' },
  { value: 'transfer', label: 'Transfer Bank' },
  { value: 'card', label: 'Kartu Debit / EDC' },
  { value: 'unpaid', label: 'Bayar Nanti (Tempo)' },
  { value: 'ewallet', label: 'E-Wallet (GoPay/OVO/ShopeePay)' },
  { value: 'other', label: 'Lainnya' },
]

function resetFeedback() {
  message.value = ''
  error.value = ''
}

const filteredMethods = computed(() => {
  const q = searchQuery.value.trim().toLowerCase()
  if (!q) return paymentStore.allMethods
  return paymentStore.allMethods.filter(
    (m) =>
      m.name.toLowerCase().includes(q) ||
      (m.description && m.description.toLowerCase().includes(q)) ||
      (m.accountNumber && m.accountNumber.toLowerCase().includes(q)),
  )
})

const totalCount = computed(() => paymentStore.allMethods.length)
const activeCount = computed(() => paymentStore.activeMethods.length)

function openAddModal() {
  if (isCashier.value) return
  resetFeedback()
  form.value = {
    name: '',
    type: 'transfer',
    description: '',
    accountNumber: '',
    accountHolder: '',
    isActive: true,
  }
  isAddModalOpen.value = true
}

function handleAddMethod() {
  resetFeedback()
  const res = paymentStore.addMethod({
    name: form.value.name,
    type: form.value.type,
    description: form.value.description,
    accountNumber: form.value.accountNumber,
    accountHolder: form.value.accountHolder,
  })

  if (!res.success) {
    error.value = res.error
    return
  }

  message.value = `✓ Metode "${res.method.name}" berhasil ditambahkan.`
  isAddModalOpen.value = false
}

function openEditModal(method) {
  if (isCashier.value) return
  resetFeedback()
  editingId.value = method.id
  form.value = {
    name: method.name,
    type: method.type,
    description: method.description || '',
    accountNumber: method.accountNumber || '',
    accountHolder: method.accountHolder || '',
    isActive: method.isActive,
  }
  isEditModalOpen.value = true
}

function handleUpdateMethod() {
  resetFeedback()
  const res = paymentStore.updateMethod(editingId.value, {
    name: form.value.name,
    type: form.value.type,
    description: form.value.description,
    accountNumber: form.value.accountNumber,
    accountHolder: form.value.accountHolder,
    isActive: form.value.isActive,
  })

  if (!res.success) {
    error.value = res.error
    return
  }

  message.value = `✓ Metode "${res.method.name}" berhasil diperbarui.`
  isEditModalOpen.value = false
}

function openDeleteModal(method) {
  if (isCashier.value || method.isDefault) return
  resetFeedback()
  methodToDelete.value = method
  isDeleteModalOpen.value = true
}

function handleDeleteMethod() {
  if (!methodToDelete.value) return
  resetFeedback()
  const res = paymentStore.deleteMethod(methodToDelete.value.id)
  if (!res.success) {
    error.value = res.error
    return
  }
  message.value = `✓ Metode "${methodToDelete.value.name}" berhasil dihapus.`
  isDeleteModalOpen.value = false
  methodToDelete.value = null
}

function getTypeBadgeClass(type) {
  switch (type) {
    case 'cash':
      return 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800'
    case 'qris':
      return 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-800'
    case 'transfer':
      return 'bg-indigo-50 text-indigo-700 border-indigo-200 dark:bg-indigo-950/40 dark:text-indigo-300 dark:border-indigo-800'
    case 'card':
      return 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800'
    case 'unpaid':
      return 'bg-orange-50 text-orange-700 border-orange-200 dark:bg-orange-950/40 dark:text-orange-300 dark:border-orange-800'
    default:
      return 'bg-zinc-50 text-zinc-700 border-zinc-200 dark:bg-slate-800 dark:text-zinc-300 dark:border-slate-700'
  }
}
</script>

<template>
  <div class="min-h-screen bg-surface px-4 py-6 text-ink-primary sm:px-6">
    <div class="mx-auto max-w-4xl space-y-6">
      <!-- Top Navigation & Action -->
      <div class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <button
            type="button"
            class="mb-2 inline-flex items-center gap-1.5 text-xs font-semibold text-primary transition hover:underline cursor-pointer"
            data-testid="btn-back-settings"
            @click="router.push({ name: 'settings' })"
          >
            <AppIcon name="arrow-left" class="h-3.5 w-3.5" />
            <span>Kembali ke Pengaturan</span>
          </button>
          <h1 class="text-2xl font-bold tracking-tight text-ink-primary">Master Metode Pembayaran</h1>
          <p class="text-xs text-ink-secondary">
            Kelola metode bayar aktif di kasir POS dan informasi rekening tujuan
          </p>
        </div>

        <BaseButton
          v-if="!isCashier"
          variant="primary"
          size="md"
          data-testid="btn-add-payment-method"
          class="shrink-0"
          @click="openAddModal"
        >
          <AppIcon name="plus" class="h-4 w-4" />
          <span>Tambah Metode</span>
        </BaseButton>
      </div>

      <!-- Feedback Alerts -->
      <div
        v-if="message"
        data-testid="payment-methods-success-alert"
        class="flex items-center justify-between rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs font-medium text-emerald-800 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-300"
      >
        <span>{{ message }}</span>
        <button type="button" class="text-emerald-600 hover:text-emerald-800" @click="message = ''">✕</button>
      </div>

      <div
        v-if="error"
        data-testid="payment-methods-error-alert"
        class="flex items-center justify-between rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs font-medium text-rose-800 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-300"
      >
        <span>{{ error }}</span>
        <button type="button" class="text-rose-600 hover:text-rose-800" @click="error = ''">✕</button>
      </div>

      <!-- Metric Cards -->
      <div class="grid grid-cols-2 gap-3 sm:gap-4">
        <BaseCard class="p-4">
          <p class="text-xs font-semibold text-ink-secondary">Total Metode Bayar</p>
          <p class="mt-1 text-2xl font-bold text-ink-primary" data-testid="total-methods-count">
            {{ totalCount }}
          </p>
        </BaseCard>

        <BaseCard class="p-4">
          <p class="text-xs font-semibold text-ink-secondary">Metode Aktif di POS</p>
          <p class="mt-1 text-2xl font-bold text-primary dark:text-indigo-400" data-testid="active-methods-count">
            {{ activeCount }}
          </p>
        </BaseCard>
      </div>

      <!-- Search Bar -->
      <div class="flex items-center gap-3">
        <div class="relative flex-1">
          <BaseInput
            v-model="searchQuery"
            data-testid="input-search-method"
            placeholder="Cari metode pembayaran..."
            class="w-full"
          />
        </div>
      </div>

      <!-- Methods List -->
      <div class="space-y-3" data-testid="payment-methods-list">
        <BaseCard
          v-for="method in filteredMethods"
          :key="method.id"
          class="flex flex-col gap-3.5 p-4 transition sm:flex-row sm:items-center sm:justify-between border border-zinc-200/80 dark:border-slate-800"
          :data-testid="`payment-method-row-${method.id}`"
        >
          <!-- Left: Icon & Info -->
          <div class="flex items-start gap-3 min-w-0">
            <!-- Icon -->
            <div
              class="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border transition-colors"
              :class="
                method.isActive
                  ? 'border-primary/20 bg-primary/10 text-primary dark:bg-indigo-500/20 dark:text-indigo-300'
                  : 'border-zinc-200 bg-zinc-100 text-zinc-400 dark:border-slate-700 dark:bg-slate-800'
              "
            >
              <!-- Cash -->
              <svg v-if="method.type === 'cash'" class="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="2" y="6" width="20" height="12" rx="2" />
                <circle cx="12" cy="12" r="2" />
                <path d="M6 12h.01M18 12h.01" />
              </svg>
              <!-- QRIS -->
              <svg v-else-if="method.type === 'qris'" class="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="3" y="3" width="7" height="7" rx="1" />
                <rect x="14" y="3" width="7" height="7" rx="1" />
                <rect x="3" y="14" width="7" height="7" rx="1" />
                <rect x="14" y="14" width="3" height="3" />
                <path d="M21 14v.01M18 18v3M21 21v.01M14 21v.01" />
              </svg>
              <!-- Unpaid -->
              <svg v-else-if="method.type === 'unpaid'" class="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="10" />
                <polyline points="12 6 12 12 16 14" />
              </svg>
              <!-- Transfer / Bank -->
              <svg v-else-if="method.type === 'transfer'" class="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M3 21h18M3 10h18M5 10v11M19 10v11M9 10v11M15 10v11M12 2L2 7h20L12 2z" />
              </svg>
              <!-- Card / Other -->
              <svg v-else class="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="2" y="5" width="20" height="14" rx="2" />
                <line x1="2" y1="10" x2="22" y2="10" />
              </svg>
            </div>

            <!-- Details -->
            <div class="min-w-0 space-y-1">
              <div class="flex flex-wrap items-center gap-2">
                <h3 class="text-sm font-bold text-ink-primary dark:text-white">{{ method.name }}</h3>
                <span
                  class="rounded-lg border px-2 py-0.5 text-[10px] font-semibold"
                  :class="getTypeBadgeClass(method.type)"
                >
                  {{ typeOptions.find((t) => t.value === method.type)?.label || method.type }}
                </span>
                <span
                  v-if="method.isDefault"
                  class="rounded-lg bg-zinc-100 px-1.5 py-0.5 text-[10px] font-medium text-zinc-500 dark:bg-slate-800 dark:text-zinc-400"
                >
                  Sistem
                </span>
              </div>

              <p v-if="method.accountNumber" class="text-xs font-mono font-medium text-primary dark:text-indigo-400">
                {{ method.accountNumber }} <span v-if="method.accountHolder" class="text-ink-secondary font-sans font-normal">({{ method.accountHolder }})</span>
              </p>

              <p v-if="method.description" class="text-xs text-ink-secondary">
                {{ method.description }}
              </p>
            </div>
          </div>

          <!-- Right: Status Toggle Switch & Action Buttons -->
          <div class="flex items-center justify-between sm:justify-end gap-3 pt-2 sm:pt-0 border-t sm:border-t-0 border-zinc-100 dark:border-slate-800">
            <!-- Active Toggle (Clean iOS switch without checkmark inside) -->
            <div class="flex items-center gap-2">
              <span class="text-xs font-semibold" :class="method.isActive ? 'text-primary' : 'text-zinc-400'">
                {{ method.isActive ? 'Aktif di POS' : 'Nonaktif' }}
              </span>
              <button
                type="button"
                role="switch"
                :aria-checked="method.isActive"
                :disabled="isCashier || (method.id === 'cash' && method.isActive)"
                class="relative inline-flex h-6 w-11 shrink-0 rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none"
                :class="[
                  method.isActive ? 'bg-primary' : 'bg-zinc-200 dark:bg-slate-700',
                  isCashier || (method.id === 'cash' && method.isActive) ? 'cursor-not-allowed opacity-60' : 'cursor-pointer',
                ]"
                :title="method.id === 'cash' ? 'Metode tunai tidak dapat dinonaktifkan' : 'Ubah status aktif'"
                :data-testid="`toggle-method-active-${method.id}`"
                @click="paymentStore.toggleMethodActive(method.id)"
              >
                <span
                  class="pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-md transition duration-200 ease-in-out"
                  :class="method.isActive ? 'translate-x-5' : 'translate-x-0'"
                />
              </button>
            </div>

            <!-- Edit Button -->
            <button
              v-if="!isCashier"
              type="button"
              class="rounded-xl border border-zinc-200 p-2 text-zinc-600 hover:bg-zinc-100 active:scale-95 transition cursor-pointer dark:border-slate-700 dark:text-zinc-300 dark:hover:bg-slate-800"
              title="Edit Metode"
              :data-testid="`btn-edit-method-${method.id}`"
              @click="openEditModal(method)"
            >
              <AppIcon name="edit" class="h-4 w-4" />
            </button>

            <!-- Delete Button (Only for Custom Methods) -->
            <button
              v-if="!isCashier && !method.isDefault"
              type="button"
              class="rounded-xl border border-rose-200 bg-rose-50 p-2 text-rose-600 hover:bg-rose-100 active:scale-95 transition cursor-pointer dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-400"
              title="Hapus Metode"
              :data-testid="`btn-delete-method-${method.id}`"
              @click="openDeleteModal(method)"
            >
              <AppIcon name="trash" class="h-4 w-4" />
            </button>
          </div>
        </BaseCard>

        <!-- Empty State -->
        <div
          v-if="filteredMethods.length === 0"
          class="rounded-2xl border border-dashed border-zinc-200 p-8 text-center text-xs text-ink-secondary dark:border-slate-700"
        >
          Tidak ada metode pembayaran yang sesuai pencarian.
        </div>
      </div>

      <!-- Modal Tambah Metode -->
      <BaseModal
        :open="isAddModalOpen"
        title="Tambah Metode Pembayaran"
        @close="isAddModalOpen = false"
      >
        <form class="space-y-4" @submit.prevent="handleAddMethod">
          <div>
            <label class="block text-xs font-semibold text-ink-primary mb-1">Nama Metode *</label>
            <BaseInput
              v-model="form.name"
              placeholder="Contoh: Transfer Bank BCA / QRIS Outlet"
              required
              data-testid="input-method-name"
            />
          </div>

          <div>
            <label class="block text-xs font-semibold text-ink-primary mb-1">Tipe Pembayaran</label>
            <select
              v-model="form.type"
              class="w-full rounded-2xl border border-zinc-200 bg-card px-3.5 py-2.5 text-xs text-ink-primary focus:border-primary focus:outline-none dark:border-slate-700"
              data-testid="select-method-type"
            >
              <option v-for="opt in typeOptions" :key="opt.value" :value="opt.value">
                {{ opt.label }}
              </option>
            </select>
          </div>

          <div>
            <label class="block text-xs font-semibold text-ink-primary mb-1">Nomor Rekening / No. HP E-Wallet (Opsional)</label>
            <BaseInput
              v-model="form.accountNumber"
              placeholder="Contoh: 1234567890 / 08123456789"
              data-testid="input-method-account"
            />
          </div>

          <div>
            <label class="block text-xs font-semibold text-ink-primary mb-1">Atas Nama Rekening (Opsional)</label>
            <BaseInput
              v-model="form.accountHolder"
              placeholder="Contoh: PT Temuan Space"
              data-testid="input-method-holder"
            />
          </div>

          <div>
            <label class="block text-xs font-semibold text-ink-primary mb-1">Keterangan / Instruksi</label>
            <BaseInput
              v-model="form.description"
              placeholder="Contoh: Tunjukkan bukti transfer ke kasir"
              data-testid="input-method-desc"
            />
          </div>

          <div class="flex justify-end gap-2 pt-2">
            <BaseButton variant="secondary" size="md" type="button" @click="isAddModalOpen = false">
              Batal
            </BaseButton>
            <BaseButton variant="primary" size="md" type="submit" data-testid="btn-save-new-method">
              Simpan Metode
            </BaseButton>
          </div>
        </form>
      </BaseModal>

      <!-- Modal Edit Metode -->
      <BaseModal
        :open="isEditModalOpen"
        title="Edit Metode Pembayaran"
        @close="isEditModalOpen = false"
      >
        <form class="space-y-4" @submit.prevent="handleUpdateMethod">
          <div>
            <label class="block text-xs font-semibold text-ink-primary mb-1">Nama Metode *</label>
            <BaseInput
              v-model="form.name"
              placeholder="Contoh: Transfer Bank BCA"
              required
              data-testid="input-edit-method-name"
            />
          </div>

          <div>
            <label class="block text-xs font-semibold text-ink-primary mb-1">Tipe Pembayaran</label>
            <select
              v-model="form.type"
              class="w-full rounded-2xl border border-zinc-200 bg-card px-3.5 py-2.5 text-xs text-ink-primary focus:border-primary focus:outline-none dark:border-slate-700"
              data-testid="select-edit-method-type"
            >
              <option v-for="opt in typeOptions" :key="opt.value" :value="opt.value">
                {{ opt.label }}
              </option>
            </select>
          </div>

          <div>
            <label class="block text-xs font-semibold text-ink-primary mb-1">Nomor Rekening / No. HP E-Wallet</label>
            <BaseInput
              v-model="form.accountNumber"
              placeholder="Contoh: 1234567890"
              data-testid="input-edit-method-account"
            />
          </div>

          <div>
            <label class="block text-xs font-semibold text-ink-primary mb-1">Atas Nama Rekening</label>
            <BaseInput
              v-model="form.accountHolder"
              placeholder="Contoh: PT Temuan Space"
              data-testid="input-edit-method-holder"
            />
          </div>

          <div>
            <label class="block text-xs font-semibold text-ink-primary mb-1">Keterangan / Instruksi</label>
            <BaseInput
              v-model="form.description"
              placeholder="Contoh: Tunjukkan bukti transfer ke kasir"
              data-testid="input-edit-method-desc"
            />
          </div>

          <div class="flex justify-end gap-2 pt-2">
            <BaseButton variant="secondary" size="md" type="button" @click="isEditModalOpen = false">
              Batal
            </BaseButton>
            <BaseButton variant="primary" size="md" type="submit" data-testid="btn-update-method">
              Simpan Perubahan
            </BaseButton>
          </div>
        </form>
      </BaseModal>

      <!-- Modal Hapus Metode -->
      <BaseModal
        :open="isDeleteModalOpen"
        title="Hapus Metode Pembayaran"
        @close="isDeleteModalOpen = false"
      >
        <div class="space-y-4">
          <p class="text-xs text-ink-secondary leading-relaxed">
            Apakah Anda yakin ingin menghapus metode pembayaran
            <strong>"{{ methodToDelete?.name }}"</strong>?
            Metode ini tidak akan muncul lagi di pilihan transaksi kasir POS.
          </p>

          <div class="flex justify-end gap-2 pt-2">
            <BaseButton variant="secondary" size="md" type="button" @click="isDeleteModalOpen = false">
              Batal
            </BaseButton>
            <BaseButton
              variant="danger"
              size="md"
              type="button"
              data-testid="btn-confirm-delete-method"
              @click="handleDeleteMethod"
            >
              Hapus
            </BaseButton>
          </div>
        </div>
      </BaseModal>
    </div>
  </div>
</template>
