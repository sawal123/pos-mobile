<script setup>
import { storeToRefs } from 'pinia'
import { useRouter } from 'vue-router'

import BaseButton from '@/components/base/BaseButton.vue'
import BaseCard from '@/components/base/BaseCard.vue'
import { useCustomerStore } from '@/stores/customerStore'

const customerStore = useCustomerStore()
const router = useRouter()

const { customers } = storeToRefs(customerStore)

function goToCreate() {
  router.push({ name: 'customer-create' })
}

function goToEdit(customer) {
  router.push({ name: 'customer-edit', params: { id: customer.id } })
}

function handleDelete(customer) {
  if (!window.confirm(`Hapus pelanggan "${customer.name}"?`)) {
    return
  }

  customerStore.deleteCustomer(customer.id)
}
</script>

<template>
  <div class="space-y-6">
    <section class="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
      <div>
        <p class="text-sm font-medium uppercase tracking-[0.18em] text-primary">Customer Management</p>
        <h1 class="mt-2 text-3xl font-semibold text-ink-primary">Daftar Pelanggan</h1>
        <p class="mt-2 text-sm text-ink-secondary">
          Kelola data pelanggan yang bisa dipilih saat pembayaran.
        </p>
      </div>

      <BaseButton @click="goToCreate">Tambah Customer</BaseButton>
    </section>

    <BaseCard class="space-y-4">
      <div class="flex items-center justify-between">
        <h2 class="text-lg font-semibold text-ink-primary">Semua Pelanggan</h2>
        <span class="text-sm text-ink-secondary">{{ customers.length }} pelanggan</span>
      </div>

      <div v-if="customers.length" class="space-y-3">
        <div
          v-for="customer in customers"
          :key="customer.id"
          class="flex flex-col gap-4 rounded-2xl border border-zinc-200 bg-white p-4 lg:flex-row lg:items-start lg:justify-between"
        >
          <div class="space-y-2">
            <h3 class="text-lg font-semibold text-ink-primary">{{ customer.name }}</h3>
            <p class="text-sm text-ink-secondary">Phone: {{ customer.phone || '-' }}</p>
            <p class="text-sm text-ink-secondary">Email: {{ customer.email || '-' }}</p>
          </div>

          <div class="flex flex-wrap gap-2">
            <BaseButton size="sm" variant="secondary" @click="goToEdit(customer)">Edit</BaseButton>
            <BaseButton size="sm" variant="danger" @click="handleDelete(customer)">Delete</BaseButton>
          </div>
        </div>
      </div>

      <div v-else class="rounded-2xl border border-dashed border-zinc-200 p-6 text-center text-sm text-ink-secondary">
        Belum ada pelanggan yang ditambahkan.
      </div>
    </BaseCard>
  </div>
</template>
