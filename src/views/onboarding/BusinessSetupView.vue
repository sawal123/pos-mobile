<script setup>
import { computed, reactive } from 'vue'
import { useRouter } from 'vue-router'

import BaseButton from '@/components/base/BaseButton.vue'
import BaseInput from '@/components/base/BaseInput.vue'
import { BUSINESS_TYPES, normalizeBusinessType } from '@/data/businessTemplates'
import { useBusinessStore } from '@/stores/businessStore'
import { useProductStore } from '@/stores/productStore'

const businessStore = useBusinessStore()
const productStore = useProductStore()
const router = useRouter()

const form = reactive({
  name: businessStore.name,
  type: businessStore.type ? normalizeBusinessType(businessStore.type) : '',
  owner: businessStore.owner,
  phone: businessStore.phone,
  outlet: businessStore.outlet,
  mode: businessStore.mode,
})

const businessTypes = [
  {
    value: BUSINESS_TYPES[0],
    description: 'Menu makanan, minuman, dan usaha harian.',
    icon: 'cafe',
  },
  {
    value: BUSINESS_TYPES[1],
    description: 'Layanan cuci kiloan, satuan, dan express.',
    icon: 'laundry',
  },
  {
    value: BUSINESS_TYPES[2],
    description: 'Kelola produk, persediaan, dan penjualan.',
    icon: 'store',
  },
]

const businessModes = [
  {
    value: 'free',
    label: 'Free Offline',
    description: 'Data tersimpan di perangkat, tanpa internet.',
  },
  {
    value: 'cloud',
    label: 'Cloud',
    description: 'Untuk akun yang memiliki akses sinkronisasi.',
  },
]

const canContinue = computed(() => Boolean(form.name.trim()) && Boolean(form.type))

let isSubmitting = false

function saveBusinessProfile() {
  if (!canContinue.value || isSubmitting) return
  isSubmitting = true

  const isInitialSetup = !businessStore.isSetup

  businessStore.setBusiness({
    ...form,
    name: form.name.trim(),
    outlet: form.outlet.trim() || 'Outlet Utama',
    owner: form.owner.trim(),
    phone: form.phone.trim(),
  })

  if (isInitialSetup) {
    productStore.applyBusinessTemplate(form.type)
  }

  router.push('/setup/pin')
}
</script>

<template>
  <div class="min-h-dvh bg-[#F7F8FC] text-ink-primary">
    <main class="mx-auto w-full max-w-6xl px-4 pb-6 pt-5 sm:px-6 sm:pt-8 lg:px-8">
      <header class="mb-6">
        <div class="mb-5 flex items-center justify-between gap-3">
          <div class="flex min-w-0 items-center gap-2.5">
            <div class="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary text-sm font-bold tracking-tight text-white">
              POS
            </div>
            <div class="min-w-0">
              <p class="text-sm font-semibold leading-tight">POS Mobile</p>
              <p class="mt-0.5 text-xs text-ink-secondary">Pengaturan awal</p>
            </div>
          </div>
          <span class="shrink-0 rounded-full border border-primary/15 bg-primary/5 px-3 py-1.5 text-xs font-semibold text-primary">
            Langkah 1 dari 2
          </span>
        </div>

        <div
          class="mb-5 flex gap-1.5"
          role="progressbar"
          aria-label="Progres pengaturan bisnis"
          aria-valuemin="0"
          aria-valuemax="2"
          aria-valuenow="1"
        >
          <div class="h-1 flex-1 rounded-full bg-primary"></div>
          <div class="h-1 flex-1 rounded-full bg-primary/15"></div>
        </div>

        <h1 class="text-[1.65rem] font-bold leading-tight tracking-tight sm:text-3xl">
          Siapkan profil toko
        </h1>
        <p class="mt-2 max-w-2xl text-sm leading-relaxed text-ink-secondary">
          Isi informasi dasar dan pilih jenis usaha agar POS sesuai kebutuhan toko Anda.
        </p>
      </header>

      <form @submit.prevent="saveBusinessProfile">
        <div class="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_290px] lg:gap-7">
          <div class="space-y-4">
            <section class="rounded-2xl border border-zinc-200/80 bg-white p-4 shadow-sm sm:p-6" aria-labelledby="identity-title">
              <div class="mb-5 flex items-start gap-3">
                <span class="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-xs font-bold text-primary">
                  01
                </span>
                <div>
                  <h2 id="identity-title" class="text-base font-bold sm:text-lg">Identitas toko</h2>
                  <p class="mt-0.5 text-xs leading-relaxed text-ink-secondary sm:text-sm">
                    Nama toko dan outlet yang akan digunakan kasir.
                  </p>
                </div>
              </div>

              <div class="grid gap-4 sm:grid-cols-2">
                <div>
                  <BaseInput
                    v-model="form.name"
                    label="Nama Toko"
                    placeholder="Contoh: Kopi Sore"
                  />
                  <p class="mt-1.5 text-xs text-ink-secondary">Wajib diisi</p>
                </div>
                <BaseInput
                  v-model="form.outlet"
                  label="Nama Outlet"
                  placeholder="Outlet Utama"
                />
              </div>
            </section>

            <section class="rounded-2xl border border-zinc-200/80 bg-white p-4 shadow-sm sm:p-6" aria-labelledby="business-type-title">
              <div class="mb-5 flex items-start gap-3">
                <span class="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-xs font-bold text-primary">
                  02
                </span>
                <div>
                  <h2 id="business-type-title" class="text-base font-bold sm:text-lg">Jenis bisnis</h2>
                  <p class="mt-0.5 text-xs leading-relaxed text-ink-secondary sm:text-sm">
                    Pilih satu untuk menyiapkan kategori yang relevan.
                  </p>
                </div>
              </div>

              <div class="grid gap-2.5" role="radiogroup" aria-label="Jenis Bisnis">
                <button
                  v-for="type in businessTypes"
                  :key="type.value"
                  type="button"
                  role="radio"
                  :aria-checked="form.type === type.value"
                  class="flex min-h-20 w-full items-center gap-3 rounded-xl border px-3.5 py-3.5 text-left outline-none transition focus-visible:ring-4 focus-visible:ring-primary/20"
                  :class="
                    form.type === type.value
                      ? 'border-primary bg-[#F3F2FF] ring-1 ring-primary'
                      : 'border-zinc-200 bg-white hover:border-primary/40 hover:bg-zinc-50'
                  "
                  @click="form.type = type.value"
                >
                  <span
                    class="flex size-11 shrink-0 items-center justify-center rounded-xl"
                    :class="form.type === type.value ? 'bg-primary text-white' : 'bg-[#F1F2FA] text-primary'"
                    aria-hidden="true"
                  >
                    <svg
                      v-if="type.icon === 'cafe'"
                      width="22" height="22" viewBox="0 0 24 24" fill="none"
                      stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"
                    >
                      <path d="M4 8h13v7a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5V8Z"/>
                      <path d="M17 9h2a3 3 0 0 1 0 6h-2M3 22h16M8 3v2M13 3v2"/>
                    </svg>
                    <svg
                      v-else-if="type.icon === 'laundry'"
                      width="22" height="22" viewBox="0 0 24 24" fill="none"
                      stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"
                    >
                      <rect x="4" y="2" width="16" height="20" rx="2"/>
                      <path d="M4 7h16M8 4.5h.01M11 4.5h.01"/>
                      <circle cx="12" cy="14.5" r="4.5"/>
                      <path d="M10 14.5c1.5-1.2 2.5 1.2 4 0"/>
                    </svg>
                    <svg
                      v-else
                      width="22" height="22" viewBox="0 0 24 24" fill="none"
                      stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"
                    >
                      <path d="M3 9 5 3h14l2 6v12H3V9ZM3 9h18M9 21v-8h6v8"/>
                      <path d="M3 9c0 3 4.5 3 4.5 0 0 3 4.5 3 4.5 0 0 3 4.5 3 4.5 0 0 3 4.5 3 4.5 0"/>
                    </svg>
                  </span>

                  <span class="min-w-0 flex-1">
                    <span class="block text-sm font-semibold leading-snug text-ink-primary">{{ type.value }}</span>
                    <span class="mt-1 block text-xs leading-relaxed text-ink-secondary">{{ type.description }}</span>
                  </span>

                  <span
                    class="flex size-5 shrink-0 items-center justify-center rounded-full border"
                    :class="form.type === type.value ? 'border-primary bg-primary text-white' : 'border-zinc-300 bg-white'"
                    aria-hidden="true"
                  >
                    <svg v-if="form.type === type.value" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
                      <path d="m5 12 4 4L19 6"/>
                    </svg>
                  </span>
                </button>
              </div>
            </section>

            <section class="rounded-2xl border border-zinc-200/80 bg-white p-4 shadow-sm sm:p-6" aria-labelledby="additional-title">
              <div class="mb-4 flex items-start justify-between gap-3">
                <div class="flex items-start gap-3">
                  <span class="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-xs font-bold text-primary">
                    03
                  </span>
                  <div>
                    <h2 id="additional-title" class="text-base font-bold sm:text-lg">Informasi tambahan</h2>
                    <p class="mt-0.5 text-xs leading-relaxed text-ink-secondary sm:text-sm">
                      Bisa dilengkapi sekarang atau nanti.
                    </p>
                  </div>
                </div>
                <span class="rounded-full bg-zinc-100 px-2.5 py-1 text-[11px] font-medium text-zinc-600">
                  Opsional
                </span>
              </div>
              <div class="grid gap-4 sm:grid-cols-2">
                <BaseInput v-model="form.owner" label="Nama Owner" placeholder="Nama pemilik" />
                <BaseInput v-model="form.phone" label="Nomor Telepon" type="tel" placeholder="08xxxxxxxxxx" />
              </div>
            </section>

            <section class="rounded-2xl border border-zinc-200/80 bg-white p-4 shadow-sm sm:p-6" aria-labelledby="mode-title">
              <div class="mb-4 flex items-start gap-3">
                <span class="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-xs font-bold text-primary">
                  04
                </span>
                <div>
                  <h2 id="mode-title" class="text-base font-bold sm:text-lg">Mode penggunaan</h2>
                  <p class="mt-0.5 text-xs leading-relaxed text-ink-secondary sm:text-sm">
                    Mode offline siap digunakan tanpa koneksi internet.
                  </p>
                </div>
              </div>
              <div class="grid gap-2.5 sm:grid-cols-2" role="radiogroup" aria-label="Mode Operasional">
                <button
                  v-for="mode in businessModes"
                  :key="mode.value"
                  type="button"
                  role="radio"
                  :aria-checked="form.mode === mode.value"
                  class="rounded-xl border p-3.5 text-left outline-none transition focus-visible:ring-4 focus-visible:ring-primary/20"
                  :class="form.mode === mode.value ? 'border-primary bg-[#F3F2FF] ring-1 ring-primary' : 'border-zinc-200 hover:border-primary/40'"
                  @click="form.mode = mode.value"
                >
                  <div class="flex items-center justify-between gap-2">
                    <span class="text-sm font-semibold text-ink-primary">{{ mode.label }}</span>
                    <span class="size-4 shrink-0 rounded-full border-[4px]" :class="form.mode === mode.value ? 'border-primary bg-white' : 'border-zinc-300 bg-white'" aria-hidden="true"></span>
                  </div>
                  <p class="mt-2 text-xs leading-relaxed text-ink-secondary">{{ mode.description }}</p>
                </button>
              </div>
            </section>

            <div class="flex items-center gap-3 rounded-xl border border-primary/10 bg-primary/5 px-4 py-3 lg:hidden">
              <div class="flex size-9 shrink-0 items-center justify-center rounded-lg bg-white text-primary" aria-hidden="true">
                <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M3 9 5 3h14l2 6v12H3V9ZM3 9h18M9 21v-8h6v8"/>
                </svg>
              </div>
              <div class="min-w-0">
                <p class="text-[11px] font-medium uppercase tracking-wide text-primary">Pratinjau toko</p>
                <p class="truncate text-sm font-semibold">{{ form.name.trim() || 'Nama toko Anda' }}</p>
                <p class="truncate text-xs text-ink-secondary">{{ form.type || 'Pilih jenis bisnis' }} · {{ form.outlet.trim() || 'Outlet Utama' }}</p>
              </div>
            </div>
          </div>

          <aside class="hidden lg:sticky lg:top-6 lg:block" aria-label="Pratinjau profil toko">
            <div class="overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm">
              <div class="border-b border-zinc-100 bg-gradient-to-br from-[#4945D6] to-[#5B55E7] p-5 text-white">
                <p class="text-xs font-medium uppercase tracking-widest text-white/75">Pratinjau profil</p>
                <div class="mt-5 flex size-12 items-center justify-center rounded-xl bg-white/20" aria-hidden="true">
                  <svg width="25" height="25" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M3 9 5 3h14l2 6v12H3V9ZM3 9h18M9 21v-8h6v8"/>
                  </svg>
                </div>
                <h2 class="mt-3 break-words text-xl font-bold leading-tight">{{ form.name.trim() || 'Nama toko Anda' }}</h2>
                <p class="mt-1 break-words text-sm text-white/80">{{ form.outlet.trim() || 'Outlet Utama' }}</p>
              </div>
              <dl class="divide-y divide-zinc-100 px-5">
                <div class="py-4">
                  <dt class="text-xs text-ink-secondary">Jenis bisnis</dt>
                  <dd class="mt-1 text-sm font-semibold">{{ form.type || 'Belum dipilih' }}</dd>
                </div>
                <div class="py-4">
                  <dt class="text-xs text-ink-secondary">Owner</dt>
                  <dd class="mt-1 break-words text-sm font-medium">{{ form.owner || 'Belum diisi' }}</dd>
                </div>
                <div class="py-4">
                  <dt class="text-xs text-ink-secondary">Mode</dt>
                  <dd class="mt-1 text-sm font-medium">{{ form.mode === 'cloud' ? 'Cloud' : 'Free Offline' }}</dd>
                </div>
              </dl>
            </div>
            <p class="mt-3 px-1 text-xs leading-relaxed text-ink-secondary">
              Informasi toko diperbarui pada pratinjau saat Anda mengetik.
            </p>
          </aside>
        </div>

        <footer class="sticky bottom-0 z-20 -mx-4 mt-5 border-t border-zinc-200 bg-white/95 px-4 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] shadow-[0_-8px_24px_rgba(24,24,27,0.04)] backdrop-blur-md sm:-mx-6 sm:px-6 lg:static lg:mx-0 lg:mt-6 lg:rounded-2xl lg:border lg:pb-3 lg:shadow-sm">
          <div class="mx-auto flex max-w-6xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div class="hidden sm:block">
              <p class="text-sm font-semibold">Selanjutnya: Buat PIN kasir</p>
              <p class="mt-0.5 text-xs text-ink-secondary">Nama toko dan jenis bisnis wajib diisi.</p>
            </div>
            <BaseButton type="submit" size="lg" :disabled="!canContinue" class="w-full sm:w-auto">
              Lanjut Setup PIN
              <svg class="ml-2" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="m9 18 6-6-6-6"/>
              </svg>
            </BaseButton>
          </div>
        </footer>
      </form>
    </main>
  </div>
</template>
