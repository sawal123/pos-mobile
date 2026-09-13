<script setup>
import { reactive } from 'vue'
import { useRouter } from 'vue-router'

import BaseButton from '@/components/base/BaseButton.vue'
import BaseCard from '@/components/base/BaseCard.vue'
import BaseInput from '@/components/base/BaseInput.vue'
import { useBusinessStore } from '@/stores/businessStore'
import { useProductStore } from '@/stores/productStore'

const businessStore = useBusinessStore()
const productStore = useProductStore()
const router = useRouter()

const form = reactive({
  name: businessStore.name,
  type: businessStore.type,
  owner: businessStore.owner,
  phone: businessStore.phone,
  outlet: businessStore.outlet,
  mode: businessStore.mode,
})

function saveBusinessProfile() {
  const isInitialSetup = !businessStore.isSetup

  businessStore.setBusiness(form)

  if (isInitialSetup) {
    productStore.applyBusinessTemplate(form.type)
  }

  router.push('/setup/pin')
}

const businessTypes = [
  'Cafe',
  'Restoran',
  'Retail',
  'Laundry',
  'Barbershop',
  'Lainnya',
]

const businessModes = [
  { label: 'Free', value: 'free', description: 'Mode offline lokal untuk satu outlet.' },
  { label: 'Cloud', value: 'cloud', description: 'Siap dikembangkan untuk sinkronisasi online.' },
]
</script>

<template>
  <div class="mx-auto max-w-6xl">
    <div class="grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
      <section class="space-y-5">
        <div class="overflow-hidden rounded-[2rem] bg-[radial-gradient(circle_at_top_left,_rgba(91,85,231,0.95),_rgba(73,69,214,1)_48%,_rgba(24,24,27,1)_100%)] p-6 text-white shadow-[0_20px_60px_rgba(73,69,214,0.28)] md:p-8">
          <div class="flex items-center justify-between">
            <div>
              <p class="text-xs uppercase tracking-[0.28em] text-white/70">Step 01</p>
              <h1 class="mt-3 max-w-sm text-3xl font-semibold leading-tight">
                Bangun identitas outlet yang siap dipakai kasir.
              </h1>
            </div>
            <div class="rounded-full border border-white/20 bg-white/10 px-4 py-2 text-xs font-medium">
              Business Setup
            </div>
          </div>

          <div class="mt-8 grid gap-3">
            <div class="rounded-3xl bg-white/10 p-4 backdrop-blur-sm">
              <p class="text-xs uppercase tracking-[0.18em] text-white/70">Store Preview</p>
              <h2 class="mt-2 text-2xl font-semibold">
                {{ form.name || 'Nama toko Anda' }}
              </h2>
              <p class="mt-1 text-sm text-white/75">
                {{ form.type || 'Pilih jenis bisnis' }} • {{ form.outlet || 'Outlet Utama' }}
              </p>
            </div>

            <div class="grid gap-3 sm:grid-cols-3">
              <div class="rounded-3xl bg-white/10 p-4 backdrop-blur-sm">
                <p class="text-xs uppercase tracking-[0.16em] text-white/65">Owner</p>
                <p class="mt-2 text-sm font-medium text-white">{{ form.owner || 'Belum diisi' }}</p>
              </div>
              <div class="rounded-3xl bg-white/10 p-4 backdrop-blur-sm">
                <p class="text-xs uppercase tracking-[0.16em] text-white/65">Mode</p>
                <p class="mt-2 text-sm font-medium text-white">
                  {{ form.mode === 'cloud' ? 'Cloud Ready' : 'Free Offline' }}
                </p>
              </div>
              <div class="rounded-3xl bg-white/10 p-4 backdrop-blur-sm">
                <p class="text-xs uppercase tracking-[0.16em] text-white/65">Kontak</p>
                <p class="mt-2 text-sm font-medium text-white">{{ form.phone || 'Belum diisi' }}</p>
              </div>
            </div>
          </div>
        </div>

        <BaseCard class="space-y-4 border border-white/40 bg-white/80 backdrop-blur-sm">
          <div class="flex items-center justify-between">
            <div>
              <p class="text-sm font-medium uppercase tracking-[0.18em] text-primary">Checklist</p>
              <h2 class="mt-2 text-xl font-semibold text-ink-primary">Yang akan disiapkan</h2>
            </div>
            <div class="rounded-full bg-primary/10 px-3 py-1 text-sm font-semibold text-primary">
              {{ [form.name, form.type, form.owner, form.phone].filter(Boolean).length }}/4
            </div>
          </div>

          <div class="space-y-3">
            <div class="flex items-center justify-between rounded-2xl bg-surface px-4 py-3">
              <span class="text-sm text-ink-secondary">Identitas bisnis</span>
              <span class="text-sm font-medium" :class="form.name && form.type ? 'text-success' : 'text-warning'">
                {{ form.name && form.type ? 'Siap' : 'Belum lengkap' }}
              </span>
            </div>
            <div class="flex items-center justify-between rounded-2xl bg-surface px-4 py-3">
              <span class="text-sm text-ink-secondary">Info owner</span>
              <span class="text-sm font-medium" :class="form.owner ? 'text-success' : 'text-warning'">
                {{ form.owner ? 'Siap' : 'Opsional' }}
              </span>
            </div>
            <div class="flex items-center justify-between rounded-2xl bg-surface px-4 py-3">
              <span class="text-sm text-ink-secondary">Mode operasional</span>
              <span class="text-sm font-medium text-primary">
                {{ form.mode === 'cloud' ? 'Cloud' : 'Free' }}
              </span>
            </div>
          </div>
        </BaseCard>
      </section>

      <section class="space-y-5">
        <BaseCard class="space-y-6 border border-white/40 bg-white/90 shadow-[0_18px_40px_rgba(24,24,27,0.05)]">
          <div>
            <p class="text-sm font-medium uppercase tracking-[0.18em] text-primary">Business Setup</p>
            <h2 class="mt-2 text-3xl font-semibold text-ink-primary">Lengkapi identitas toko</h2>
            <p class="mt-2 max-w-2xl text-sm text-ink-secondary">
              Data ini akan dipakai untuk personalisasi outlet, ringkasan settings, dan flow operasional kasir.
            </p>
          </div>

          <div class="grid gap-4 md:grid-cols-2">
            <BaseInput v-model="form.name" label="Nama Toko" placeholder="Contoh: Kopi Sore" />
            <BaseInput v-model="form.outlet" label="Nama Outlet" placeholder="Outlet Utama" />
            <BaseInput v-model="form.owner" label="Nama Owner" placeholder="Nama pemilik" />
            <BaseInput v-model="form.phone" label="Nomor Telepon" placeholder="08xxxxxxxxxx" />
          </div>

          <div class="space-y-3">
            <div class="flex items-center justify-between">
              <p class="text-sm font-medium text-ink-secondary">Jenis Bisnis</p>
              <p class="text-xs uppercase tracking-[0.16em] text-ink-secondary">Pilih satu</p>
            </div>

            <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              <button
                v-for="type in businessTypes"
                :key="type"
                type="button"
                class="rounded-3xl border px-4 py-4 text-left transition"
                :class="
                  form.type === type
                    ? 'border-primary bg-primary text-white shadow-[0_10px_25px_rgba(73,69,214,0.22)]'
                    : 'border-zinc-200 bg-white text-ink-primary hover:border-primary/40 hover:bg-primary/5'
                "
                @click="form.type = type"
              >
                <p class="text-base font-semibold">{{ type }}</p>
                <p class="mt-1 text-sm" :class="form.type === type ? 'text-white/80' : 'text-ink-secondary'">
                  Template kategori untuk kebutuhan {{ type.toLowerCase() }}.
                </p>
              </button>
            </div>
          </div>

          <div class="space-y-3">
            <p class="text-sm font-medium text-ink-secondary">Mode Operasional</p>
            <div class="grid gap-3 md:grid-cols-2">
              <button
                v-for="mode in businessModes"
                :key="mode.value"
                type="button"
                class="rounded-[1.75rem] border p-5 text-left transition"
                :class="
                  form.mode === mode.value
                    ? 'border-primary bg-primary/6 ring-4 ring-primary/10'
                    : 'border-zinc-200 bg-white hover:border-primary/40'
                "
                @click="form.mode = mode.value"
              >
                <div class="flex items-center justify-between gap-3">
                  <h3 class="text-lg font-semibold text-ink-primary">{{ mode.label }}</h3>
                  <span
                    class="rounded-full px-3 py-1 text-xs font-medium"
                    :class="form.mode === mode.value ? 'bg-primary text-white' : 'bg-zinc-100 text-zinc-600'"
                  >
                    {{ form.mode === mode.value ? 'Aktif' : 'Pilih' }}
                  </span>
                </div>
                <p class="mt-3 text-sm text-ink-secondary">{{ mode.description }}</p>
              </button>
            </div>
          </div>
        </BaseCard>

        <div class="flex flex-col gap-3 rounded-[1.75rem] bg-white/80 p-4 shadow-soft sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p class="text-sm font-medium text-ink-primary">Langkah berikutnya</p>
            <p class="text-sm text-ink-secondary">Simpan bisnis lalu lanjut ke pengaturan PIN kasir.</p>
          </div>
          <BaseButton size="lg" :disabled="!form.name || !form.type" @click="saveBusinessProfile">
            Lanjut Setup PIN
          </BaseButton>
        </div>
      </section>
    </div>
  </div>
</template>
