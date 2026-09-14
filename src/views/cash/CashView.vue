<script setup>
import { ref } from 'vue'

import BaseButton from '@/components/base/BaseButton.vue'
import BaseCard from '@/components/base/BaseCard.vue'
import BaseInput from '@/components/base/BaseInput.vue'
import { useCashStore } from '@/stores/cashStore'
import { formatCurrency, formatDateTime } from '@/utils/formatters'

const cashStore = useCashStore()

const cashForm = ref({
  type: 'in',
  amount: '',
  category: 'Modal',
  note: '',
})
const cashError = ref('')
const feedbackMessage = ref('')

function handleManualCash() {
  cashError.value = ''
  feedbackMessage.value = ''

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
  feedbackMessage.value = 'Transaksi kas berhasil dicatat.'
}
</script>

<template>
  <div class="mx-auto max-w-5xl space-y-5">
    <div>
      <p class="text-sm font-medium uppercase tracking-[0.18em] text-primary">Kas</p>
      <h2 class="mt-2 text-2xl font-semibold text-ink-primary">Ledger kas operasional</h2>
    </div>

    <div class="grid gap-3 md:grid-cols-3">
      <BaseCard>
        <p class="text-sm text-ink-secondary">Saldo Berjalan</p>
        <p class="mt-2 break-words text-2xl font-semibold text-ink-primary">{{ formatCurrency(cashStore.balance) }}</p>
      </BaseCard>
      <BaseCard>
        <p class="text-sm text-ink-secondary">Kas Masuk Hari Ini</p>
        <p class="mt-2 break-words text-2xl font-semibold text-success">{{ formatCurrency(cashStore.todayCashIn) }}</p>
      </BaseCard>
      <BaseCard>
        <p class="text-sm text-ink-secondary">Kas Keluar Hari Ini</p>
        <p class="mt-2 break-words text-2xl font-semibold text-danger">{{ formatCurrency(cashStore.todayCashOut) }}</p>
      </BaseCard>
    </div>

    <BaseCard class="space-y-4">
      <div>
        <h3 class="text-lg font-semibold text-ink-primary">Catat Kas</h3>
      </div>

      <p v-if="cashError" class="rounded-2xl bg-danger/10 px-4 py-3 text-sm text-danger">
        {{ cashError }}
      </p>
      <p v-if="feedbackMessage" class="rounded-2xl bg-emerald-100 px-4 py-3 text-sm text-emerald-700">
        {{ feedbackMessage }}
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
    </BaseCard>

    <BaseCard class="space-y-4">
      <div class="flex items-center justify-between gap-3">
        <h3 class="text-lg font-semibold text-ink-primary">Riwayat Kas</h3>
        <span class="shrink-0 text-sm text-ink-secondary">{{ cashStore.entries.length }} transaksi</span>
      </div>

      <div v-if="cashStore.entries.length" class="space-y-3">
        <div
          v-for="entry in cashStore.entries"
          :key="entry.id"
          class="flex flex-col gap-3 rounded-2xl border border-zinc-200 bg-white p-4 sm:flex-row sm:items-center sm:justify-between"
        >
          <div class="min-w-0">
            <p class="font-medium text-ink-primary">{{ entry.category }}</p>
            <p class="mt-1 text-sm text-ink-secondary">{{ entry.note || '-' }}</p>
            <p class="mt-1 text-xs text-ink-secondary">{{ formatDateTime(entry.createdAt) }}</p>
          </div>
          <p class="shrink-0 text-right font-semibold" :class="entry.type === 'in' ? 'text-success' : 'text-danger'">
            {{ entry.type === 'in' ? '+' : '-' }}{{ formatCurrency(entry.amount) }}
          </p>
        </div>
      </div>

      <p v-else class="rounded-2xl border border-dashed border-zinc-200 p-6 text-center text-sm text-ink-secondary">
        Belum ada riwayat kas.
      </p>
    </BaseCard>
  </div>
</template>
