<script setup>
import { computed, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import BaseButton from '@/components/base/BaseButton.vue'
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

const AVATAR_PALETTES = [
  'bg-gradient-to-br from-indigo-500 to-violet-600 text-white',
  'bg-gradient-to-br from-emerald-500 to-teal-600 text-white',
  'bg-gradient-to-br from-blue-500 to-cyan-600 text-white',
  'bg-gradient-to-br from-amber-500 to-orange-600 text-white',
  'bg-gradient-to-br from-rose-500 to-pink-600 text-white',
  'bg-gradient-to-br from-purple-500 to-fuchsia-600 text-white',
]

function getAvatarPalette(name = '') {
  let hash = 0
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash)
  }
  const index = Math.abs(hash) % AVATAR_PALETTES.length
  return AVATAR_PALETTES[index]
}

function getInitials(name = '') {
  const parts = (name || '').trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[1][0]).toUpperCase()
}

const previewInitials = computed(() => getInitials(form.name))
const previewAvatarClass = computed(() => getAvatarPalette(form.name || 'Preview'))

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
  <div class="space-y-5 pb-28">
    <!-- Header with Back Button -->
    <header class="flex items-center gap-3">
      <button
        type="button"
        class="flex h-10 w-10 items-center justify-center rounded-2xl border border-zinc-200/80 bg-white text-ink-primary shadow-xs transition hover:bg-zinc-50 active:scale-95"
        aria-label="Kembali"
        @click="router.push({ name: 'customers' })"
      >
        <svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
        </svg>
      </button>

      <div>
        <p class="text-[11px] font-bold uppercase tracking-widest text-primary">Customer Management</p>
        <h1 class="text-xl font-black tracking-tight text-ink-primary sm:text-2xl">
          {{ isEditMode ? 'Edit Customer' : 'Tambah Customer' }}
        </h1>
      </div>
    </header>

    <!-- Eyecatching Live Card Preview -->
    <section class="rounded-3xl border border-zinc-200/80 bg-white p-5 shadow-soft space-y-3">
      <div class="flex items-center justify-between">
        <span class="text-xs font-semibold uppercase tracking-wider text-ink-secondary">
          Pratinjau Kartu Pelanggan
        </span>
        <span class="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-bold text-primary">
          <span class="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
          Live Preview
        </span>
      </div>

      <div class="rounded-2xl border border-zinc-200/70 bg-gradient-to-br from-surface to-white p-4 shadow-xs">
        <div class="flex items-center gap-3.5">
          <div
            class="flex h-13 w-13 shrink-0 items-center justify-center rounded-2xl shadow-soft text-base font-black transition-transform duration-300"
            :class="previewAvatarClass"
          >
            {{ previewInitials }}
          </div>
          <div class="min-w-0 flex-1">
            <h3 class="truncate text-base font-bold" :class="form.name ? 'text-ink-primary' : 'text-zinc-400 italic'">
              {{ form.name || 'Nama Pelanggan' }}
            </h3>
            <div class="mt-1 flex flex-wrap items-center gap-2 text-xs">
              <span v-if="form.phone" class="inline-flex items-center gap-1 font-mono text-[11px] text-zinc-700 bg-white px-2 py-0.5 rounded-md border border-zinc-200">
                <svg class="h-3 w-3 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                </svg>
                {{ form.phone }}
              </span>
              <span v-else class="text-[11px] text-zinc-400 italic">Belum ada no. HP</span>

              <span v-if="form.email" class="inline-flex items-center gap-1 text-[11px] text-zinc-600 bg-white px-2 py-0.5 rounded-md border border-zinc-200 truncate max-w-[160px]">
                <svg class="h-3 w-3 text-indigo-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                </svg>
                <span class="truncate">{{ form.email }}</span>
              </span>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- Form Section -->
    <section class="rounded-3xl border border-zinc-200/80 bg-white p-5 shadow-soft">
      <form class="space-y-4" @submit.prevent="handleSubmit">
        <p v-if="formError" class="rounded-2xl bg-danger/10 px-4 py-3 text-sm text-danger">
          {{ formError }}
        </p>

        <!-- Input Nama -->
        <div class="space-y-1.5">
          <BaseInput
            :model-value="form.name"
            label="Nama Lengkap"
            placeholder="Contoh: Budi Santoso"
            @update:model-value="form.name = $event"
          />
          <p v-if="errors.name" class="text-xs text-danger font-medium">{{ errors.name }}</p>
        </div>

        <!-- Input Phone -->
        <div class="space-y-1.5">
          <BaseInput
            :model-value="form.phone"
            label="Nomor Telepon / WhatsApp"
            placeholder="Contoh: 081234567890"
            hint="Dapat digunakan untuk pencarian instan di kasir POS dan kirim struk WhatsApp."
            @update:model-value="form.phone = $event"
          />
        </div>

        <!-- Input Email -->
        <div class="space-y-1.5">
          <BaseInput
            :model-value="form.email"
            label="Alamat Email (Opsional)"
            placeholder="Contoh: budi@gmail.com"
            hint="Untuk korespondensi struk digital atau faktur penjualan."
            @update:model-value="form.email = $event"
          />
        </div>

        <!-- Action Buttons -->
        <div class="grid grid-cols-2 gap-3 pt-3 border-t border-zinc-100">
          <BaseButton type="button" variant="secondary" @click="router.push({ name: 'customers' })">
            Batal
          </BaseButton>
          <BaseButton type="submit">
            {{ isEditMode ? 'Simpan Perubahan' : 'Simpan Customer' }}
          </BaseButton>
        </div>
      </form>
    </section>
  </div>
</template>
