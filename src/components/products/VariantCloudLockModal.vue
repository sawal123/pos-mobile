<script setup>
import { computed } from 'vue'
import { useRouter } from 'vue-router'

import AppIcon from '@/components/base/AppIcon.vue'
import BaseButton from '@/components/base/BaseButton.vue'
import BaseModal from '@/components/base/BaseModal.vue'
import { useCloudSessionStore } from '@/stores/cloudSessionStore'
import { useSubscriptionStore } from '@/stores/subscriptionStore'
import { useVariantStore } from '@/stores/variantStore'

defineProps({
  open: {
    type: Boolean,
    default: false,
  },
})

const emit = defineEmits(['close'])

const router = useRouter()
const cloudStore = useCloudSessionStore()
const subscriptionStore = useSubscriptionStore()
const variantStore = useVariantStore()

const isCashier = computed(
  () => cloudStore.role === 'cashier' || cloudStore.isCashierContext === true,
)

const hasCloudAccess = computed(
  () =>
    subscriptionStore.isPremium === true ||
    subscriptionStore.hasCloudAccess === true ||
    cloudStore.isOperationalCloudAccess === true,
)

const activeVariantGroups = computed(() => variantStore.activeGroups || [])

function handleUpgrade() {
  emit('close')
  if (isCashier.value) return
  router.push({ name: cloudStore.isLinked ? 'my-subscription' : 'subscription' })
}
</script>

<template>
  <BaseModal
    :open="open"
    :title="hasCloudAccess ? 'Varian Menu (Cloud)' : 'Fitur Khusus Paket Cloud'"
    @close="emit('close')"
  >
    <!-- Locked State: Must Upgrade to Cloud -->
    <div v-if="!hasCloudAccess" class="space-y-4" data-testid="variant-cloud-lock-modal">
      <div
        class="flex items-start gap-3.5 rounded-2xl border border-amber-200/90 bg-amber-50/80 p-4 dark:border-amber-500/30 dark:bg-amber-950/35"
      >
        <span
          class="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-amber-100 text-amber-600 dark:bg-amber-500/20 dark:text-amber-300"
        >
          <AppIcon name="lock" class="h-5 w-5" />
        </span>
        <div class="min-w-0 space-y-1">
          <div class="flex flex-wrap items-center gap-1.5">
            <p class="text-sm font-bold text-ink-primary">Penambahan Varian Menu Terkunci</p>
            <span
              class="inline-flex items-center gap-1 rounded-full bg-amber-200/70 px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wide text-amber-800 dark:bg-amber-500/25 dark:text-amber-200"
            >
              Cloud
            </span>
          </div>
          <p class="text-xs leading-relaxed text-ink-secondary" data-testid="variant-lock-message">
            Untuk menggunakan penambahan varian menu, Anda harus upgrade ke Paket Cloud terlebih
            dahulu. Kelola opsi ukuran, level gula, suhu, dan topping di Dashboard Cloud lalu
            sinkronkan otomatis ke POS Mobile.
          </p>
        </div>
      </div>

      <div class="space-y-2 rounded-2xl border border-zinc-200/80 bg-surface/60 p-3.5 text-xs dark:border-slate-700/60">
        <div class="flex items-start gap-2.5">
          <AppIcon name="variants" class="mt-0.5 h-4 w-4 text-primary" />
          <div>
            <p class="font-bold text-ink-primary">Pilihan Tunggal &amp; Multi Topping</p>
            <p class="text-ink-secondary">
              Buat grup varian wajib atau opsional untuk setiap menu yang dijual.
            </p>
          </div>
        </div>
        <div class="flex items-start gap-2.5">
          <AppIcon name="cash" class="mt-0.5 h-4 w-4 text-emerald-600" />
          <div>
            <p class="font-bold text-ink-primary">Penyesuaian Harga Otomatis</p>
            <p class="text-ink-secondary">
              Tambahan harga per varian langsung dihitung otomatis saat transaksi di kasir.
            </p>
          </div>
        </div>
        <div class="flex items-start gap-2.5">
          <AppIcon name="stock" class="mt-0.5 h-4 w-4 text-indigo-600" />
          <div>
            <p class="font-bold text-ink-primary">Potong Stok Bahan Baku</p>
            <p class="text-ink-secondary">
              Hubungkan opsi varian dengan stok bahan baku agar terpotong otomatis.
            </p>
          </div>
        </div>
      </div>

      <div class="flex flex-col gap-2 pt-1 sm:flex-row-reverse">
        <BaseButton
          v-if="!isCashier"
          block
          data-testid="variant-lock-upgrade-btn"
          @click="handleUpgrade"
        >
          <AppIcon name="cloud" class="h-4 w-4" />
          <span>Upgrade ke Paket Cloud</span>
        </BaseButton>
        <BaseButton variant="secondary" block @click="emit('close')"> Tutup </BaseButton>
      </div>
    </div>

    <!-- Active Cloud State: Read-only Synced Summary + Dashboard Notice -->
    <div v-else class="space-y-4" data-testid="variant-cloud-active-modal">
      <div
        class="flex items-start gap-3 rounded-2xl border border-indigo-200/80 bg-indigo-50/70 p-3.5 text-xs dark:border-indigo-500/30 dark:bg-indigo-950/35"
      >
        <span
          class="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/15 text-primary"
        >
          <AppIcon name="cloud" class="h-4 w-4" />
        </span>
        <div class="space-y-1">
          <p class="font-bold text-ink-primary">Dikelola melalui Dashboard Cloud</p>
          <p class="leading-relaxed text-ink-secondary">
            Penambahan &amp; pengaturan template varian menu dilakukan melalui Dashboard Web Cloud,
            kemudian otomatis tersinkron ke perangkat POS Mobile ini.
          </p>
        </div>
      </div>

      <div v-if="activeVariantGroups.length > 0" class="space-y-2">
        <p class="text-xs font-bold uppercase tracking-wider text-ink-secondary">
          Template Varian Tersinkron ({{ activeVariantGroups.length }})
        </p>
        <div class="max-h-52 space-y-2 overflow-y-auto pr-1">
          <div
            v-for="group in activeVariantGroups"
            :key="group.id || group.syncId"
            class="flex items-center justify-between rounded-xl border border-zinc-200/80 bg-white px-3 py-2.5 text-xs dark:border-slate-700/60 dark:bg-[#1B2133]"
          >
            <div class="min-w-0">
              <p class="truncate font-bold text-ink-primary">{{ group.name }}</p>
              <p class="text-[11px] text-ink-secondary">
                {{ group.selectionType === 'multiple' ? 'Pilihan ganda' : 'Pilihan tunggal' }} ·
                {{ group.isRequired ? 'Wajib' : 'Opsional' }}
              </p>
            </div>
            <span
              class="shrink-0 rounded-full bg-primary/10 px-2.5 py-0.5 text-[11px] font-bold text-primary"
            >
              {{ (group.options || []).length }} opsi
            </span>
          </div>
        </div>
      </div>

      <p v-else class="rounded-2xl border border-dashed border-zinc-200 p-4 text-center text-xs text-ink-secondary">
        Belum ada template varian menu. Buat template varian di Dashboard Web Cloud lalu jalankan
        sinkronisasi.
      </p>

      <BaseButton variant="secondary" block @click="emit('close')"> Tutup </BaseButton>
    </div>
  </BaseModal>
</template>
