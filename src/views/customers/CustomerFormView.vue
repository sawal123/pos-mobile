<script setup>
import { computed, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import BaseButton from '@/components/base/BaseButton.vue'
import BaseCard from '@/components/base/BaseCard.vue'
import BaseInput from '@/components/base/BaseInput.vue'
import { useCustomerStore } from '@/stores/customerStore'

const customerStore = useCustomerStore()
const route = useRoute()
const router = useRouter()

const form = reactive({
  name: '',
  phone: '',
  email: '',
})

const errors = ref({})
const formError = ref('')

const isEditMode = computed(() => Boolean(route.params.id))

function resetForm() {
  form.name = ''
  form.phone = ''
  form.email = ''
  errors.value = {}
  formError.value = ''
}

function loadCustomer() {
  resetForm()

  if (!isEditMode.value) {
    return
  }

  const customer = customerStore.getCustomerById(route.params.id)

  if (!customer) {
    router.replace({ name: 'customers' })
    return
  }

  form.name = customer.name
  form.phone = customer.phone
  form.email = customer.email
}

async function handleSubmit() {
  formError.value = ''

  const payload = {
    name: form.name,
    phone: form.phone,
    email: form.email,
  }

  const result = isEditMode.value
    ? customerStore.updateCustomer(route.params.id, payload)
    : customerStore.createCustomer(payload)

  if (!result.success) {
    errors.value = result.errors ?? {}
    formError.value = result.errors?.form ?? ''
    return
  }

  errors.value = {}
  await router.push({ name: 'customers' })
}

watch(
  () => route.params.id,
  () => {
    loadCustomer()
  },
  { immediate: true },
)
</script>

<template>
  <div class="space-y-6">
    <section>
      <p class="text-sm font-medium uppercase tracking-[0.18em] text-primary">Customer Management</p>
      <h1 class="mt-2 text-3xl font-semibold text-ink-primary">
        {{ isEditMode ? 'Edit Customer' : 'Tambah Customer' }}
      </h1>
      <p class="mt-2 text-sm text-ink-secondary">
        {{ isEditMode ? 'Perbarui data pelanggan yang sudah ada.' : 'Tambahkan pelanggan baru untuk dipilih saat pembayaran.' }}
      </p>
    </section>

    <BaseCard>
      <form class="space-y-5" @submit.prevent="handleSubmit">
        <p v-if="formError" class="rounded-2xl bg-danger/10 px-4 py-3 text-sm text-danger">
          {{ formError }}
        </p>

        <div class="space-y-2">
          <BaseInput
            :model-value="form.name"
            label="Nama"
            placeholder="Masukkan nama pelanggan"
            @update:model-value="form.name = $event"
          />
          <p v-if="errors.name" class="text-sm text-danger">{{ errors.name }}</p>
        </div>

        <BaseInput
          :model-value="form.phone"
          label="Phone"
          placeholder="Masukkan nomor telepon"
          @update:model-value="form.phone = $event"
        />

        <BaseInput
          :model-value="form.email"
          label="Email"
          placeholder="Masukkan email"
          @update:model-value="form.email = $event"
        />

        <div class="flex flex-wrap gap-3">
          <BaseButton type="submit">
            {{ isEditMode ? 'Simpan Perubahan' : 'Simpan Customer' }}
          </BaseButton>
          <BaseButton type="button" variant="secondary" @click="router.push({ name: 'customers' })">
            Batal
          </BaseButton>
        </div>
      </form>
    </BaseCard>
  </div>
</template>
